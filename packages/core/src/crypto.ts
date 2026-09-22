import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Шифрование секретов клиентов (envelope encryption).
 *
 * Что здесь лежит: токены WhatsApp Business, токены Telegram-ботов,
 * refresh-токены Zoho. То есть ключи от бизнеса каждого вашего клиента.
 * Утечка дампа БД без мастер-ключа не должна давать ничего.
 *
 * Схема:
 *   мастер-ключ (в KMS / секрет-менеджере, НЕ в БД)
 *     └─ HKDF-SHA256 с солью = tenantId
 *          └─ ключ тенанта (никогда не хранится, выводится на лету)
 *               └─ AES-256-GCM для конкретного секрета
 *
 * Зачем ключ на тенанта, а не один общий: компрометация или ротация
 * затрагивает одного клиента, а не всех. И это то, что вы напишете на
 * trust-странице — конкретика, которую можно проверить.
 */

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;   // рекомендованная длина nonce для GCM
const TAG_LEN = 16;
const KEY_LEN = 32;
const VERSION = 1;   // чтобы можно было сменить схему без миграции всех данных

export class CryptoError extends Error {}

function deriveTenantKey(masterKey: Buffer, tenantId: string): Buffer {
  if (masterKey.length < 32) {
    throw new CryptoError('Мастер-ключ короче 32 байт — так нельзя');
  }
  // info привязывает ключ к назначению: тот же мастер-ключ для другой цели
  // даст другой ключ, и перепутать их случайно не выйдет.
  return Buffer.from(
    hkdfSync('sha256', masterKey, Buffer.from(tenantId, 'utf8'), 'omnidesk:channel-credentials:v1', KEY_LEN),
  );
}

export function parseMasterKey(raw: string | undefined): Buffer {
  if (!raw) throw new CryptoError('ENCRYPTION_MASTER_KEY не задан');
  const key = Buffer.from(raw, 'base64');
  if (key.length < 32) {
    throw new CryptoError(
      'ENCRYPTION_MASTER_KEY должен быть минимум 32 байта в base64 (openssl rand -base64 32)',
    );
  }
  return key;
}

/**
 * Формат результата: [версия:1][iv:12][tag:16][ciphertext:...]
 * Всё в одном Buffer — кладётся в колонку bytea без дополнительной обвязки.
 */
export function encryptForTenant(
  masterKey: Buffer,
  tenantId: string,
  plaintext: string | Buffer,
): Buffer {
  const key = deriveTenantKey(masterKey, tenantId);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);

  // AAD связывает шифротекст с тенантом: перенести запись в другого
  // тенанта и расшифровать не получится — тег не сойдётся.
  cipher.setAAD(Buffer.from(tenantId, 'utf8'));

  const data = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext;
  const ct = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();

  key.fill(0); // не оставляем ключ в памяти дольше необходимого
  return Buffer.concat([Buffer.from([VERSION]), iv, tag, ct]);
}

export function decryptForTenant(
  masterKey: Buffer,
  tenantId: string,
  blob: Buffer,
): Buffer {
  if (blob.length < 1 + IV_LEN + TAG_LEN) {
    throw new CryptoError('Повреждённый шифротекст: слишком короткий');
  }
  const version = blob[0];
  if (version !== VERSION) {
    throw new CryptoError(`Неизвестная версия формата шифрования: ${version}`);
  }

  const iv = blob.subarray(1, 1 + IV_LEN);
  const tag = blob.subarray(1 + IV_LEN, 1 + IV_LEN + TAG_LEN);
  const ct = blob.subarray(1 + IV_LEN + TAG_LEN);

  const key = deriveTenantKey(masterKey, tenantId);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAAD(Buffer.from(tenantId, 'utf8'));
  decipher.setAuthTag(tag);

  try {
    const out = Buffer.concat([decipher.update(ct), decipher.final()]);
    return out;
  } catch {
    // Сюда попадём при неверном ключе, чужом tenantId или подмене данных.
    throw new CryptoError('Расшифровка не удалась: неверный ключ или повреждённые данные');
  } finally {
    key.fill(0);
  }
}

export function decryptJson<T>(masterKey: Buffer, tenantId: string, blob: Buffer): T {
  return JSON.parse(decryptForTenant(masterKey, tenantId, blob).toString('utf8')) as T;
}

export function encryptJson(masterKey: Buffer, tenantId: string, value: unknown): Buffer {
  return encryptForTenant(masterKey, tenantId, JSON.stringify(value));
}

/**
 * Маскирование секретов для логов.
 * Правило: токен не должен попасть в лог никогда. Но иногда нужно понять,
 * «тот ли это токен» — для этого хватает хвоста.
 */
export function maskSecret(secret: string): string {
  if (secret.length <= 8) return '***';
  return `***${secret.slice(-4)}`;
}

/** Сравнение секретов, пришедших извне (например, токена вебхука). */
export function secretsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
