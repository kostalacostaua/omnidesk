import { describe, expect, it } from 'vitest';
import { LANDING_HTML, widgetTag } from '../src/landing.js';

/**
 * На промо-странице стоит наш собственный чат. Ключ сайта приходит из
 * окружения, то есть его значение — это то, что кто-то однажды впишет
 * руками. Поэтому проверяется не «работает ли», а что попадает в
 * разметку публичной страницы при опечатке.
 */

describe('виджет на промо-странице', () => {
  it('настоящий ключ даёт строку подключения', () => {
    const tag = widgetTag('wc0f68b51ae39d409ab6a3d1');
    expect(tag).toContain('src="/chat.js"');
    expect(tag).toContain('data-key="wc0f68b51ae39d409ab6a3d1"');
    expect(tag).toContain('async');
  });

  it('пустая переменная означает страницу без чата, а не сломанный тег', () => {
    expect(widgetTag('')).toBe('');
    expect(widgetTag('   ')).toBe('');
  });

  it('мусор в переменной не превращается в разметку', () => {
    expect(widgetTag('wc1" onload="alert(1)')).toBe('');
    expect(widgetTag('<script>alert(1)</script>')).toBe('');
    expect(widgetTag('ключ-українською')).toBe('');
  });

  it('чужой формат ключа не принимается: это не наш канал', () => {
    expect(widgetTag('abc123')).toBe('');
    expect(widgetTag('wc12')).toBe('');
  });
});

describe('сама страница', () => {
  it('закрывает body: иначе вставлять виджет некуда', () => {
    expect(LANDING_HTML).toContain('</body>');
  });
});
