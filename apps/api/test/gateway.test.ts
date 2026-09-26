import { describe, expect, it } from 'vitest';
import { hookToken, sameToken } from '../src/gateway.js';

/*
 * Дверь вебхука шлюза.
 *
 * Адрес публичный, и единственное, чем чужой запрос отличается от
 * нашего, — ключ. Поэтому проверяем именно его разбор и сравнение.
 */
describe('ключ вебхука', () => {
  it('читается и с Bearer, и без него', () => {
    expect(hookToken('Bearer abc123')).toBe('abc123');
    expect(hookToken('bearer abc123')).toBe('abc123');
    expect(hookToken('abc123')).toBe('abc123');
    expect(hookToken('  Bearer   abc123  ')).toBe('abc123');
    expect(hookToken(undefined)).toBe('');
  });

  /*
   * Обычное === выходит на первом несовпавшем символе, и по времени
   * ответа ключ подбирается посимвольно. Адрес вебхука публичный, и
   * стучаться в него можно сколько угодно, так что это не паранойя.
   */
  it('сравнивается за постоянное время и не путает длины', () => {
    expect(sameToken('abc123', 'abc123')).toBe(true);
    expect(sameToken('abc123', 'abc124')).toBe(false);
    expect(sameToken('abc123', 'abc12')).toBe(false);
    expect(sameToken('', '')).toBe(false);
    expect(sameToken('abc', '')).toBe(false);
  });
});
