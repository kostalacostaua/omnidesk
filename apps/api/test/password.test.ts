import { describe, expect, it } from 'vitest';
import { MIN_LENGTH, checkPassword, hashPassword, verifyPassword } from '../src/password.js';

/**
 * Пароль — единственное место, где ошибка не видна ни в интерфейсе, ни
 * в логах: неверная проверка либо пускает чужого, либо не пускает
 * своего. Поэтому проверяется и то, что пароль подходит, и то, что
 * похожий — нет.
 */

describe('проверочная строка', () => {
  it('пароль в ней не лежит', async () => {
    const stored = await hashPassword('верный-пароль-2026');
    expect(stored).not.toContain('верный');
    expect(stored.startsWith('scrypt$')).toBe(true);
  });

  it('два одинаковых пароля дают разные строки: соль у каждого своя', async () => {
    const a = await hashPassword('одинаковый');
    const b = await hashPassword('одинаковый');
    expect(a).not.toBe(b);
  });

  it('свой пароль подходит, чужой — нет', async () => {
    const stored = await hashPassword('правильный пароль');
    await expect(verifyPassword('правильный пароль', stored)).resolves.toBe(true);
    await expect(verifyPassword('правильный парол', stored)).resolves.toBe(false);
    await expect(verifyPassword('', stored)).resolves.toBe(false);
  });

  it('разные формы записи одного текста считаются одним паролем', async () => {
    // Одна и та же буква с диакритикой набирается двумя способами;
    // человек этой разницы не видит, и вход по ней ломаться не должен.
    const composed = 'пароль-é-2026';
    const decomposed = 'пароль-e' + String.fromCharCode(0x301) + '-2026';
    const stored = await hashPassword(composed);
    await expect(verifyPassword(decomposed.normalize('NFD'), stored)).resolves.toBe(true);
  });

  it('испорченная строка из базы не пускает никого', async () => {
    await expect(verifyPassword('x', 'мусор')).resolves.toBe(false);
    await expect(verifyPassword('x', 'scrypt$16384$8$1$соль')).resolves.toBe(false);
    await expect(verifyPassword('x', '')).resolves.toBe(false);
  });

  it('параметры записаны рядом: старые строки проверяются своими', async () => {
    const stored = await hashPassword('какой-то пароль');
    const [algo, n, r, p] = stored.split('$');
    expect(algo).toBe('scrypt');
    expect(Number(n)).toBeGreaterThanOrEqual(16384);
    expect(Number(r)).toBe(8);
    expect(Number(p)).toBe(1);
  });
});

describe('годится ли пароль', () => {
  it('короткий не годится', () => {
    expect(checkPassword('1234567').reason).toBe('short');
    expect(MIN_LENGTH).toBe(8);
  });

  it('самые частые не годятся, даже нужной длины', () => {
    expect(checkPassword('password').reason).toBe('weak');
    expect(checkPassword('12345678').reason).toBe('weak');
    expect(checkPassword('PassWord').reason).toBe('weak');
  });

  it('килобайтный «пароль» — это нагрузка на сервер, а не пароль', () => {
    expect(checkPassword('a'.repeat(500)).reason).toBe('long');
  });

  it('обычный человеческий пароль проходит', () => {
    expect(checkPassword('сумки-опт-2026').ok).toBe(true);
    expect(checkPassword('kostya rozmovio kyiv').ok).toBe(true);
  });
});
