import { createHash, createHmac } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve } from 'node:path';

/**
 * Хранилище вложений: два драйвера за одним интерфейсом.
 *
 *   STORAGE_DRIVER=local  — диск (том Docker). Работает сегодня, без аккаунтов.
 *   STORAGE_DRIVER=s3     — Cloudflare R2 или любое S3-совместимое.
 *
 * Смысл абстракции не в красоте, а в том, что при переезде на сервер
 * меняется одна переменная окружения, а не код. Локально вы пишете на диск,
 * в проде — в R2, и ни один вызывающий об этом не знает.
 *
 * S3 подписывается вручную (SigV4 на node:crypto), а не через AWS SDK.
 * Причина простая: SDK тянет за собой десятки мегабайт в каждый образ ради
 * трёх операций — PUT, GET, HEAD. Подпись занимает восемьдесят строк
 * и покрыта тестами.
 */

export interface StoredObject {
  body: Buffer;
  contentType: string;
  size: number;
}

export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  readonly kind: 'local' | 's3';
}

// ─────────────────────────────────────────────────────────────────────────
// Локальный диск
// ─────────────────────────────────────────────────────────────────────────

/**
 * Ключ приходит из данных (идентификаторы тенанта и сообщения), поэтому
 * его нужно считать недоверенным. Без этой проверки ключ вида
 * `../../etc/passwd` увёл бы запись за пределы каталога хранилища.
 */
function safeJoin(root: string, key: string): string {
  const full = resolve(join(root, normalize(key)));
  const base = resolve(root);
  if (full !== base && !full.startsWith(base + '/')) {
    throw new Error(`Небезопасный ключ хранилища: ${key}`);
  }
  return full;
}

class LocalStorage implements Storage {
  readonly kind = 'local' as const;
  constructor(private readonly root: string) {}

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const path = safeJoin(this.root, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    // Тип содержимого хранится рядом: файловая система его не помнит,
    // а отдавать вложение с неправильным Content-Type — значит показать
    // пользователю скачивание вместо картинки.
    await writeFile(path + '.type', contentType, 'utf8');
  }

  async get(key: string): Promise<StoredObject | null> {
    const path = safeJoin(this.root, key);
    try {
      const [body, info] = await Promise.all([readFile(path), stat(path)]);
      let contentType = 'application/octet-stream';
      try {
        contentType = (await readFile(path + '.type', 'utf8')).trim();
      } catch {
        /* тип не сохранился — отдаём как поток байтов */
      }
      return { body, contentType, size: info.size };
    } catch {
      return null;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// S3 / Cloudflare R2
// ─────────────────────────────────────────────────────────────────────────

export interface S3Config {
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  region?: string;
  /**
   * Способ адресации бакета.
   *
   *   path    — https://endpoint/bucket/key   (R2, MinIO, старые бакеты)
   *   virtual — https://bucket.endpoint/key   (AWS, Railway Buckets)
   *
   * Перепутать их — значит получить 403 SignatureDoesNotMatch или
   * NoSuchBucket на каждой операции, причём сообщение об ошибке
   * на причину никак не указывает.
   */
  urlStyle?: 'path' | 'virtual';
}

/**
 * Адрес объекта в выбранном стиле. Вынесено отдельно ради тестов:
 * это то место, где ошибка не видна, пока не упадёт живой запрос.
 */
export function objectUrl(cfg: S3Config, key: string): URL {
  const base = new URL(cfg.endpoint.replace(/\/$/, ''));
  if (cfg.urlStyle === 'virtual') {
    return new URL(`${base.protocol}//${cfg.bucket}.${base.host}/${key}`);
  }
  return new URL(`${base.protocol}//${base.host}${base.pathname.replace(/\/$/, '')}/${cfg.bucket}/${key}`);
}

function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

/**
 * Подпись AWS Signature Version 4.
 *
 * Единственное место, где легко ошибиться незаметно: канонический запрос
 * должен совпадать байт в байт с тем, что построит сервер. Поэтому здесь
 * нет «упрощений» — порядок заголовков, кодирование пути и хеш тела
 * ровно по спецификации.
 */
function signV4(
  cfg: S3Config,
  method: string,
  key: string,
  payload: Buffer,
  extraHeaders: Record<string, string> = {},
): { url: string; headers: Record<string, string> } {
  const url = objectUrl(cfg, key);
  const region = cfg.region ?? 'auto';
  const service = 's3';

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(payload);

  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...extraHeaders,
  };

  const sortedNames = Object.keys(headers)
    .map((h) => h.toLowerCase())
    .sort();
  const canonicalHeaders = sortedNames
    .map((h) => `${h}:${String(headers[h] ?? headers[Object.keys(headers).find((k) => k.toLowerCase() === h)!]).trim()}\n`)
    .join('');
  const signedHeaders = sortedNames.join(';');

  const canonicalUri = url.pathname
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');

  const canonicalRequest = [
    method,
    canonicalUri,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmac(`AWS4${cfg.secretKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  headers['authorization'] =
    `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { url: url.toString(), headers };
}

class S3Storage implements Storage {
  readonly kind = 's3' as const;
  constructor(private readonly cfg: S3Config) {}

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const { url, headers } = signV4(this.cfg, 'PUT', key, body, {
      'content-type': contentType,
    });
    const res = await fetch(url, { method: 'PUT', headers, body });
    if (!res.ok) {
      throw new Error(`Не удалось загрузить в S3: ${res.status} ${await res.text()}`);
    }
  }

  async get(key: string): Promise<StoredObject | null> {
    const empty = Buffer.alloc(0);
    const { url, headers } = signV4(this.cfg, 'GET', key, empty);
    const res = await fetch(url, { method: 'GET', headers });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Не удалось прочитать из S3: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      body: buf,
      contentType: res.headers.get('content-type') ?? 'application/octet-stream',
      size: buf.length,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────

export function createStorage(env: NodeJS.ProcessEnv = process.env): Storage {
  const driver = (env['STORAGE_DRIVER'] ?? 'local').toLowerCase();

  if (driver === 's3') {
    const endpoint = env['S3_ENDPOINT'];
    const bucket = env['S3_BUCKET'];
    const accessKey = env['S3_ACCESS_KEY'];
    const secretKey = env['S3_SECRET_KEY'];
    if (!endpoint || !bucket || !accessKey || !secretKey) {
      throw new Error(
        'STORAGE_DRIVER=s3, но не заданы S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY или S3_SECRET_KEY',
      );
    }
    return new S3Storage({
      endpoint,
      bucket,
      accessKey,
      secretKey,
      region: env['S3_REGION'] ?? 'auto',
      urlStyle: env['S3_URL_STYLE'] === 'virtual' ? 'virtual' : 'path',
    });
  }

  return new LocalStorage(env['STORAGE_LOCAL_PATH'] ?? '/data/media');
}

/**
 * Ключ объекта. Тенант идёт первым сегментом осознанно: так вложения
 * одного клиента лежат под общим префиксом, и удалить их все при
 * расторжении договора — одна операция, а не обход базы.
 */
export function mediaKey(tenantId: string, messageId: string, index: number): string {
  return `${tenantId}/${messageId}/${index}`;
}

export { safeJoin as __safeJoinForTests, signV4 as __signV4ForTests };


/**
 * Ключ аватара.
 *
 * Без номера версии: аватар перезаписывается на месте. Хранить историю
 * аватаров незачем, а вот вечно растущий каталог мусора — вполне
 * реальная плата за «на всякий случай».
 */
export function avatarKey(tenantId: string, contactId: string): string {
  return `${tenantId}/avatars/${contactId}`;
}
