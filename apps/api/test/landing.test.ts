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

  it('без ключа чата нет, но страница цела', () => {
    const page = landingPage('');
    expect(page).not.toContain('chat.js');
    expect(page).toContain('</body>');
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

/**
 * Поисковик Google умеет выполнить скрипт, а сборщики ответов ИИ —
 * GPTBot, ClaudeBot, PerplexityBot — нет: они берут ровно то, что
 * пришло в HTML. Поэтому проверяется не «есть ли перевод», а что
 * текст уже стоит в разметке до всякого скрипта.
 */
describe('страница без скриптов', () => {
  const empty = (html: string) => html.match(/data-t="[^"]+"><\//g) ?? [];

  it('исходная разметка пуста — там только места под текст', () => {
    expect(empty(LANDING_HTML).length).toBeGreaterThan(50);
  });

  it('готовая страница отдаёт текст сразу', () => {
    for (const lang of ['uk', 'en']) {
      const page = landingPage('', lang);
      expect(empty(page), lang).toEqual([]);
      // Заголовок — первое, что читает и человек, и сборщик.
      expect(/<h1 class="h1">(?:(?!<\/h1>)[\s\S])*\w/.test(page), lang).toBe(true);
    }
  });

  it('заголовок один, и он свой у каждого языка', () => {
    const uk = landingPage('', 'uk');
    const en = landingPage('', 'en');
    expect(uk.match(/<title>/g)).toHaveLength(1);
    expect(en.match(/<title>/g)).toHaveLength(1);
    expect(uk).toContain('<title>Rozmovio — всі переписки з клієнтами в одному вікні</title>');
    expect(en).toContain('<title>Rozmovio — every customer chat in one window</title>');
  });

  // Неизвестный язык — это опечатка в маршруте, а не повод отдать
  // пустую страницу: отдаём украинскую.
  it('незнакомый язык падает на украинский', () => {
    expect(landingPage('', 'de')).toBe(landingPage('', 'uk'));
  });
});

describe('адреса страницы для поиска', () => {
  it('у каждого языка свой canonical, и оба указаны друг на друга', () => {
    const uk = landingPage('', 'uk', 'https://www.rozmovio.com');
    const en = landingPage('', 'en', 'https://www.rozmovio.com');
    expect(uk).toContain('<link rel="canonical" href="https://www.rozmovio.com/">');
    expect(en).toContain('<link rel="canonical" href="https://www.rozmovio.com/en">');
    for (const page of [uk, en]) {
      expect(page).toContain('hreflang="uk" href="https://www.rozmovio.com/"');
      expect(page).toContain('hreflang="en" href="https://www.rozmovio.com/en"');
      expect(page).toContain('hreflang="x-default"');
    }
  });

  /*
   * Признак data-srv — единственное, что отличает осознанно открытый
   * /en от украинской страницы у человека с английской системой. Без
   * него скрипт переключил бы язык обратно и canonical разошёлся бы с
   * тем, что видно на экране.
   */
  it('английская страница помечена как выбранная сервером', () => {
    expect(landingPage('', 'en')).toContain('<html lang="en" data-srv="en">');
    expect(landingPage('', 'uk')).toContain('<html lang="uk">');
    expect(landingPage('', 'uk')).not.toContain('data-srv="');
  });

  it('картинка для карточки ссылки лежит на том же домене', () => {
    const page = landingPage('', 'uk', 'https://www.rozmovio.com');
    expect(page).toContain('<meta property="og:image" content="https://www.rozmovio.com/og.png">');
    expect(page).toContain('twitter:card" content="summary_large_image"');
  });
});

describe('факты о продукте для поисковика', () => {
  const read = (page: string) => {
    const m = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(page);
    return JSON.parse((m?.[1] ?? '[]').replace(/\\u003c/g, '<')) as Record<string, unknown>[];
  };

  it('разбирается как JSON и описывает компанию и продукт', () => {
    const data = read(landingPage('', 'uk'));
    expect(data.map((d) => d['@type'])).toEqual(['Organization', 'SoftwareApplication']);
  });

  /*
   * Цена в разметке и цена на карточке — одно и то же число. Разойдись
   * они, поисковик показал бы в выдаче цифру, которой на странице нет,
   * и это разночтение замечает не разработчик, а клиент.
   */
  it('цена совпадает с той, что стоит на странице', () => {
    const page = landingPage('', 'uk');
    const app = read(page).find((d) => d['@type'] === 'SoftwareApplication');
    const offer = app?.['offers'] as Record<string, string>;
    expect(offer.price).toBe('50');
    expect(offer.priceCurrency).toBe('USD');
    expect(page).toContain('<div class="amt">50 $</div>');
  });

  it('угловая скобка внутри данных не закрывает скрипт', () => {
    const raw = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(landingPage('', 'uk'))?.[1] ?? '';
    expect(raw.length).toBeGreaterThan(100);
    expect(raw.includes('<')).toBe(false);
  });
});
