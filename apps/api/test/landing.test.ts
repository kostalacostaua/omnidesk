import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LANDING_HTML, landingPage, widgetTag } from '../src/landing.js';

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

  it('готовая страница содержит виджет, и он внутри body', () => {
    const page = landingPage('wc0f68b51ae39d409ab6a3d1');
    expect(page).toContain('data-key="wc0f68b51ae39d409ab6a3d1"');
    expect(page.indexOf('chat.js')).toBeLessThan(page.indexOf('</body>'));
  });

  it('без ключа страница остаётся прежней', () => {
    expect(landingPage('')).toBe(LANDING_HTML);
  });

  /**
   * Именно так виджет и потерялся в первый раз: страницу отдают два
   * маршрута, вставку приписали к одному, а корень на домене сайта
   * продолжал отдавать исходную разметку. Проверяется не поведение, а
   * то, что второго пути в обход сборки больше нет.
   */
  it('никто не отдаёт разметку в обход сборки', () => {
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    expect(main).toContain('landingPage(');
    expect(main.includes('send(LANDING_HTML)')).toBe(false);
  });
});
