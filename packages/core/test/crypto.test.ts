import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CryptoError,
  decryptForTenant,
  decryptJson,
  encryptForTenant,
  encryptJson,
  maskSecret,
  parseMasterKey,
} from '../src/crypto.js';

const MASTER = randomBytes(32);
const TENANT_A = '019283ab-cdef-4123-8456-789abcdef012';
const TENANT_B = '019283ab-cdef-4123-8456-789abcdef999';

describe('шифрование секретов каналов', () => {
  it('расшифровывает то, что зашифровало', () => {
    const secret = '7123456789:AAH-abcdefghijklmnopqrstuvwxyz123456';
    const blob = encryptForTenant(MASTER, TENANT_A, secret);
    expect(decryptForTenant(MASTER, TENANT_A, blob).toString('utf8')).toBe(secret);
  });

  it('шифротекст не содержит открытый текст', () => {
    const secret = 'super-secret-whatsapp-token';
    const blob = encryptForTenant(MASTER, TENANT_A, secret);
    expect(blob.toString('utf8')).not.toContain(secret);
    expect(blob.toString('hex')).not.toContain(Buffer.from(secret).toString('hex'));
  });

  it('два шифрования одного значения дают разный шифротекст (случайный IV)', () => {
    const a = encryptForTenant(MASTER, TENANT_A, 'одно и то же');
    const b = encryptForTenant(MASTER, TENANT_A, 'одно и то же');
    expect(a.equals(b)).toBe(false);
  });

  it('КЛЮЧЕВОЕ: секрет тенанта A не расшифровывается ключом тенанта B', () => {
    const blob = encryptForTenant(MASTER, TENANT_A, 'токен клиента А');
    expect(() => decryptForTenant(MASTER, TENANT_B, blob)).toThrow(CryptoError);
  });

  it('КЛЮЧЕВОЕ: перенос записи в другого тенанта не даёт расшифровать (AAD)', () => {
    // Сценарий: злоумышленник с доступом на запись в БД копирует строку
    // с токеном другого клиента себе. AAD привязывает шифротекст к tenant_id,
    // поэтому тег аутентичности не сойдётся.
    const blob = encryptForTenant(MASTER, TENANT_A, 'секрет');
    expect(() => decryptForTenant(MASTER, TENANT_B, blob)).toThrow(/Расшифровка не удалась/);
  });

  it('КЛЮЧЕВОЕ: дамп БД без мастер-ключа бесполезен', () => {
    const blob = encryptForTenant(MASTER, TENANT_A, 'секрет');
    const stolenMaster = randomBytes(32);
    expect(() => decryptForTenant(stolenMaster, TENANT_A, blob)).toThrow(CryptoError);
  });

  it('обнаруживает подмену шифротекста', () => {
    const blob = encryptForTenant(MASTER, TENANT_A, 'секрет');
    const tampered = Buffer.from(blob);
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => decryptForTenant(MASTER, TENANT_A, tampered)).toThrow(CryptoError);
  });

  it('обнаруживает подмену тега аутентичности', () => {
    const blob = encryptForTenant(MASTER, TENANT_A, 'секрет');
    const tampered = Buffer.from(blob);
    tampered[15] ^= 0x01;
    expect(() => decryptForTenant(MASTER, TENANT_A, tampered)).toThrow(CryptoError);
  });

  it('отклоняет неизвестную версию формата', () => {
    const blob = encryptForTenant(MASTER, TENANT_A, 'секрет');
    const future = Buffer.from(blob);
    future[0] = 99;
    expect(() => decryptForTenant(MASTER, TENANT_A, future)).toThrow(/версия формата/);
  });

  it('отклоняет обрезанный шифротекст', () => {
    const blob = encryptForTenant(MASTER, TENANT_A, 'секрет');
    expect(() => decryptForTenant(MASTER, TENANT_A, blob.subarray(0, 10))).toThrow(/слишком короткий/);
  });

  it('работает с JSON-объектами учётных данных', () => {
    const creds = { botToken: '7123:AAH-xyz', webhookSecret: 'abc' };
    const blob = encryptJson(MASTER, TENANT_A, creds);
    expect(decryptJson<typeof creds>(MASTER, TENANT_A, blob)).toEqual(creds);
  });

  it('корректно обрабатывает не-ASCII и эмодзи', () => {
    const text = 'Привет, 世界 🔐 — токен';
    const blob = encryptForTenant(MASTER, TENANT_A, text);
    expect(decryptForTenant(MASTER, TENANT_A, blob).toString('utf8')).toBe(text);
  });
});

describe('parseMasterKey', () => {
  it('принимает 32-байтный ключ в base64', () => {
    expect(parseMasterKey(randomBytes(32).toString('base64')).length).toBe(32);
  });

  it('отклоняет незаданный ключ', () => {
    expect(() => parseMasterKey(undefined)).toThrow(/не задан/);
  });

  it('отклоняет слишком короткий ключ', () => {
    expect(() => parseMasterKey(randomBytes(16).toString('base64'))).toThrow(/32 байта/);
  });
});

describe('maskSecret', () => {
  it('оставляет только хвост длинного секрета', () => {
    expect(maskSecret('7123456789:AAH-abcdefghij')).toBe('***ghij');
  });

  it('полностью скрывает короткий секрет', () => {
    expect(maskSecret('short')).toBe('***');
  });

  it('никогда не возвращает секрет целиком', () => {
    const secret = '7123456789:AAH-abcdefghijklmnop';
    expect(maskSecret(secret)).not.toContain(secret.slice(0, 10));
  });
});
