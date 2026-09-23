import { describe, expect, it } from 'vitest';
import { SESSION_COOKIE, isHttps, readCookie, sessionCookie } from '../src/session.js';

/**
 * Cookie сеанса — то, благодаря чему новая вкладка не спрашивает вход
 * заново. Ошибка здесь не падает с исключением, а тихо возвращает
 * человека на форму входа, поэтому разбор и сборка проверяются отдельно.
 */

describe('cookie сеанса', () => {
  it('находит свою cookie среди чужих', () => {
    const header = 'foo=1; rz_session=abc.def.ghi; _ga=GA1.2.3';
    expect(readCookie(header, SESSION_COOKIE)).toBe('abc.def.ghi');
  });

  it('пусто, когда cookie нет или заголовка нет вовсе', () => {
    expect(readCookie('foo=1; bar=2', SESSION_COOKIE)).toBe('');
    expect(readCookie(undefined, SESSION_COOKIE)).toBe('');
    expect(readCookie('', SESSION_COOKIE)).toBe('');
  });

  it('не путает похожее имя', () => {
    expect(readCookie('xrz_session=chужой', SESSION_COOKIE)).toBe('');
  });

  it('cookie закрыта от скриптов и от чужих сайтов', () => {
    const set = sessionCookie('tok', true, 604800);
    expect(set).toContain('HttpOnly');
    expect(set).toContain('SameSite=Lax');
    expect(set).toContain('Secure');
    expect(set).toContain('Max-Age=604800');
  });

  it('без https признак Secure не ставится: иначе cookie не сохранится локально', () => {
    expect(sessionCookie('tok', false, 10)).not.toContain('Secure');
  });

  it('гашение — это то же имя с нулевым сроком', () => {
    const off = sessionCookie('', true, 0);
    expect(off.startsWith(SESSION_COOKIE + '=;')).toBe(true);
    expect(off).toContain('Max-Age=0');
  });

  it('за прокси https виден только по заголовку, и список читается слева', () => {
    expect(isHttps('https')).toBe(true);
    expect(isHttps('https,http')).toBe(true);
    expect(isHttps('http')).toBe(false);
    expect(isHttps(undefined)).toBe(false);
  });
});
