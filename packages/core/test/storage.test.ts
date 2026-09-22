import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createStorage, mediaKey, __safeJoinForTests, __signV4ForTests } from '../src/storage.js';

describe('ключи хранилища', () => {
  it('тенант идёт первым сегментом — чтобы удалять всё одним префиксом', () => {
    expect(mediaKey('t1', 'm1', 0)).toBe('t1/m1/0');
  });

  it('разные вложения одного сообщения не перезаписывают друг друга', () => {
    expect(mediaKey('t1', 'm1', 0)).not.toBe(mediaKey('t1', 'm1', 1));
  });
});

describe('защита от выхода за пределы каталога', () => {
  it('обычный ключ разрешён', () => {
    expect(__safeJoinForTests('/data/media', 't1/m1/0')).toBe('/data/media/t1/m1/0');
  });

  it('КЛЮЧЕВОЕ: путь вверх по дереву отклоняется', () => {
    expect(() => __safeJoinForTests('/data/media', '../../etc/passwd')).toThrow(/Небезопасный/);
  });

  it('отклоняется и спрятанный в середине', () => {
    expect(() => __safeJoinForTests('/data/media', 't1/../../../root/.ssh/id_rsa')).toThrow();
  });

  it('абсолютный путь трактуется как относительный и остаётся внутри корня', () => {
    // Node в join() считает ведущий слэш обычным разделителем, поэтому
    // «/etc/shadow» превращается в «<корень>/etc/shadow». Наружу это
    // не выводит, но поведение неочевидное — фиксируем его тестом,
    // чтобы смена реализации не превратила его в дыру незаметно.
    expect(__safeJoinForTests('/data/media', '/etc/shadow')).toBe('/data/media/etc/shadow');
  });
});

describe('локальный драйвер', () => {
  it('сохраняет и отдаёт файл вместе с типом содержимого', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'omnidesk-'));
    const s = createStorage({ STORAGE_DRIVER: 'local', STORAGE_LOCAL_PATH: dir } as never);
    const data = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

    await s.put('t1/m1/0', data, 'image/png');
    const got = await s.get('t1/m1/0');

    expect(got).not.toBeNull();
    expect(got!.body.equals(data)).toBe(true);
    expect(got!.contentType).toBe('image/png');
    expect(got!.size).toBe(data.length);
  });

  it('отсутствующий объект возвращает null, а не бросает исключение', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'omnidesk-'));
    const s = createStorage({ STORAGE_DRIVER: 'local', STORAGE_LOCAL_PATH: dir } as never);
    expect(await s.get('нет/такого/0')).toBeNull();
  });
});

describe('подпись SigV4', () => {
  const cfg = {
    endpoint: 'https://accountid.r2.cloudflarestorage.com',
    bucket: 'media',
    accessKey: 'AKIAIOSFODNN7EXAMPLE',
    secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    region: 'auto',
  };

  it('подставляет все обязательные заголовки', () => {
    const { headers } = __signV4ForTests(cfg, 'PUT', 't1/m1/0', Buffer.from('x'), {
      'content-type': 'image/png',
    });
    expect(headers['authorization']).toMatch(/^AWS4-HMAC-SHA256 Credential=/);
    expect(headers['authorization']).toContain('SignedHeaders=');
    expect(headers['authorization']).toContain('Signature=');
    expect(headers['x-amz-content-sha256']).toMatch(/^[0-9a-f]{64}$/);
    expect(headers['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/);
  });

  it('хеш тела реально зависит от содержимого', () => {
    const a = __signV4ForTests(cfg, 'PUT', 'k', Buffer.from('первое'));
    const b = __signV4ForTests(cfg, 'PUT', 'k', Buffer.from('второе'));
    expect(a.headers['x-amz-content-sha256']).not.toBe(b.headers['x-amz-content-sha256']);
    expect(a.headers['authorization']).not.toBe(b.headers['authorization']);
  });

  it('подпись меняется при смене ключа объекта', () => {
    const a = __signV4ForTests(cfg, 'GET', 'a/1/0', Buffer.alloc(0));
    const b = __signV4ForTests(cfg, 'GET', 'b/1/0', Buffer.alloc(0));
    expect(a.headers['authorization']).not.toBe(b.headers['authorization']);
  });

  it('URL собирается из эндпоинта, бакета и ключа', () => {
    const { url } = __signV4ForTests(cfg, 'GET', 't1/m1/0', Buffer.alloc(0));
    expect(url).toBe('https://accountid.r2.cloudflarestorage.com/media/t1/m1/0');
  });
});

describe('выбор драйвера', () => {
  it('по умолчанию локальный', () => {
    expect(createStorage({} as never).kind).toBe('local');
  });

  it('s3 без настроек падает на старте, а не при первом файле', () => {
    expect(() => createStorage({ STORAGE_DRIVER: 's3' } as never)).toThrow(/не заданы/);
  });

  it('s3 с полными настройками создаётся', () => {
    expect(createStorage({
      STORAGE_DRIVER: 's3', S3_ENDPOINT: 'https://x.r2.cloudflarestorage.com',
      S3_BUCKET: 'b', S3_ACCESS_KEY: 'k', S3_SECRET_KEY: 's',
    } as never).kind).toBe('s3');
  });
});

import { objectUrl } from '../src/storage.js';

/**
 * Адресация бакета. Railway Buckets принимают только virtual-hosted
 * адреса, R2 и MinIO — path-style. Ошибка в выборе даёт 403 или
 * NoSuchBucket на каждом запросе, без намёка на причину.
 */
describe('objectUrl', () => {
  const base = { bucket: 'media-x1', accessKey: 'a', secretKey: 's' };

  it('path-style кладёт бакет в путь', () => {
    const u = objectUrl({ ...base, endpoint: 'https://acc.r2.cloudflarestorage.com' }, 't/m/0');
    expect(u.toString()).toBe('https://acc.r2.cloudflarestorage.com/media-x1/t/m/0');
  });

  it('virtual-hosted кладёт бакет в имя хоста', () => {
    const u = objectUrl(
      { ...base, endpoint: 'https://t3.storageapi.dev', urlStyle: 'virtual' },
      't/m/0',
    );
    expect(u.toString()).toBe('https://media-x1.t3.storageapi.dev/t/m/0');
    // Подпись считается по host — он обязан включать бакет.
    expect(u.host).toBe('media-x1.t3.storageapi.dev');
  });

  it('хвостовой слэш в endpoint не удваивается', () => {
    const u = objectUrl({ ...base, endpoint: 'https://t3.storageapi.dev/', urlStyle: 'virtual' }, 'k');
    expect(u.toString()).toBe('https://media-x1.t3.storageapi.dev/k');
  });
});
