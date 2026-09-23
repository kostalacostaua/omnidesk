import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Пароль.
 *
 * Хранится не пароль, а проверочная строка scrypt с солью. Параметры
 * записаны рядом со значением — понадобится усилить, и старые строки
 * продолжат проверяться своими параметрами, а новые получат новые.
 * Без этого «поднять стоимость перебора» означало бы «всем сбросить
 * пароль».
 *
 * scrypt, а не голый sha: он намеренно медленный и требует памяти,
 * поэтому перебор по дампу базы стоит денег, а не минут. Взят из
 * стандартной библиотеки Node — внешняя зависимость ради хэширования
 * пароля это ещё один пакет, который однажды окажется заброшенным.
 *
 * Формат: scrypt$N$r$p$соль$хэш, всё в base64url.
 */

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;
const MAXMEM = 64 * 1024 * 1024;

/** Минимум — восемь знаков. Короче подбирается быстрее, чем читается. */
export const MIN_LENGTH = 8;

export interface PasswordCheck {
  ok: boolean;
  reason?: 'short' | 'weak' | 'long';
}

/**
 * Годится ли пароль.
 *
 * Правил намеренно два: длина и «не из списка самых частых». Требование
 * «цифра, заглавная и знак» не делает пароль крепче — оно делает его
 * «Password1!», который стоит первым в тех же словарях.
 */
const COMMON = new Set([
  '12345678', '123456789', '1234567890', 'password', 'qwerty123', 'qwertyui',
  'iloveyou', 'admin123', '11111111', '00000000', 'pass1234', 'password1',
  'rozmovio', 'ukraine1', 'zxcvbnm1',
]);

export function checkPassword(password: string): PasswordCheck {
  const value = password ?? '';
  if (value.length < MIN_LENGTH) return { ok: false, reason: 'short' };
  // Верхняя граница есть у самого scrypt по памяти, но дело не в нём:
  // килобайтный «пароль» — это не пароль, а попытка нагрузить сервер.
  if (value.length > 200) return { ok: false, reason: 'long' };
  if (COMMON.has(value.toLowerCase())) return { ok: false, reason: 'weak' };
  return { ok: true };
}

/** Сделать проверочную строку. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

/**
 * Проверить пароль. Сравнение — с постоянным временем: обычное
 * сравнение строк отвечает тем быстрее, чем раньше расходятся байты,
 * и по этому времени хэш подбирается по одному байту.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = (stored ?? '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!n || !r || !p || n > 1 << 20) return false;

  try {
    const salt = Buffer.from(parts[4]!, 'base64url');
    const expected = Buffer.from(parts[5]!, 'base64url');
    const key = await scrypt(password.normalize('NFKC'), salt, expected.length, {
      N: n, r, p, maxmem: MAXMEM,
    });
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}
