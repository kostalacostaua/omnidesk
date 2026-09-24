import { describe, expect, it } from 'vitest';
import { isPlatformOwner, monthRange, parsePlatformOwners, payState } from '../src/platform.js';

describe('список владельцев платформы', () => {
  it('читает список через запятую, пробел и перевод строки', () => {
    expect(parsePlatformOwners('a@b.com, c@d.com')).toEqual(['a@b.com', 'c@d.com']);
    expect(parsePlatformOwners('a@b.com c@d.com')).toEqual(['a@b.com', 'c@d.com']);
    expect(parsePlatformOwners('a@b.com\nc@d.com;e@f.com')).toHaveLength(3);
  });

  it('регистр и пробелы значения не имеют', () => {
    expect(parsePlatformOwners('  Kostya@Example.COM ')).toEqual(['kostya@example.com']);
  });

  it('повторы схлопываются', () => {
    expect(parsePlatformOwners('a@b.com,A@B.com')).toEqual(['a@b.com']);
  });

  it('мусор в список не попадает', () => {
    expect(parsePlatformOwners('всем, кто хочет')).toEqual([]);
    expect(parsePlatformOwners('*')).toEqual([]);
    expect(parsePlatformOwners('@')).toEqual([]);
    expect(parsePlatformOwners(undefined)).toEqual([]);
    expect(parsePlatformOwners('')).toEqual([]);
  });
});

describe('признак владельца', () => {
  const owners = parsePlatformOwners('kostya@example.com');

  it('своя почта в любом регистре', () => {
    expect(isPlatformOwner('kostya@example.com', owners)).toBe(true);
    expect(isPlatformOwner('Kostya@Example.com', owners)).toBe(true);
  });

  it('чужая почта — нет', () => {
    expect(isPlatformOwner('kostya@example.com.evil.com', owners)).toBe(false);
    expect(isPlatformOwner('other@example.com', owners)).toBe(false);
    expect(isPlatformOwner('', owners)).toBe(false);
    expect(isPlatformOwner(null, owners)).toBe(false);
  });

  it('пустой список закрывает панель всем', () => {
    expect(isPlatformOwner('kostya@example.com', [])).toBe(false);
  });
});

describe('границы месяца', () => {
  it('текущий месяц в UTC', () => {
    const r = monthRange(new Date('2026-03-17T12:00:00Z'));
    expect(r.from.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(r.label).toBe('2026-03');
  });

  it('шаг назад переходит через год', () => {
    const r = monthRange(new Date('2026-01-05T00:00:00Z'), 1);
    expect(r.label).toBe('2025-12');
    expect(r.to.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('последний день месяца остаётся в своём месяце', () => {
    expect(monthRange(new Date('2026-01-31T23:59:59Z')).label).toBe('2026-01');
  });
});

describe('состояние оплаты', () => {
  const now = new Date('2026-05-10T00:00:00Z');

  it('без даты — не оплачено', () => {
    expect(payState(null, now)).toBe('unpaid');
    expect(payState('', now)).toBe('unpaid');
    expect(payState('не знаю', now)).toBe('unpaid');
  });

  it('вчерашняя дата — долг', () => {
    expect(payState('2026-05-09', now)).toBe('unpaid');
  });

  it('неделя до конца — пора напомнить', () => {
    expect(payState('2026-05-14', now)).toBe('due');
  });

  it('месяц впереди — оплачено', () => {
    expect(payState('2026-06-10', now)).toBe('paid');
  });
});
