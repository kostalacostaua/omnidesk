import { describe, expect, it } from 'vitest';
import {
  domainAllowed,
  embedSnippet,
  iframeSnippet,
  launcherColor,
  normalizeDomain,
  normalizeWebchat,
  safeColor,
  webchatSettings,
} from '../src/webchat.js';
import { canSendFreeform, computeResponseWindow } from '../src/types.js';

/**
 * Виджет стоит на чужом сайте, и его настройки попадают в страницу,
 * которую открывает посторонний человек. Поэтому здесь проверяется
 * ровно то, через что в такие страницы и пролезают: цвет, домен и
 * содержимое чужого сообщения.
 */

const ctx = { tenantId: 't1', channelId: 'ch1' };
const visitor = '0123456789abcdef0123456789abcdef';

describe('настройки', () => {
  it('цвет принимается только настоящий: строка из настроек идёт в стили', () => {
    expect(safeColor('#1faa53')).toBe('#1faa53');
    expect(safeColor('red; } body { display:none')).toBe('#2F6BFF');
    expect(safeColor('javascript:alert(1)')).toBe('#2F6BFF');
  });

  it('чужие поля в настройках игнорируются, свои подставляются', () => {
    const s = webchatSettings({ title: 'Магазин', script: '<script>', domains: ['Example.com/'] });
    expect(s.title).toBe('Магазин');
    expect(s.domains).toEqual(['example.com']);
    expect(Object.keys(s).sort()).toEqual([
      'anim', 'color', 'domains', 'greeting', 'launcher', 'logo',
      'position', 'showAfter', 'showMode', 'subtitle', 'title',
    ]);
  });

  it('логотип принимается только картинкой: страницу видит посторонний', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    expect(webchatSettings({ logo: png }).logo).toBe(png);
    expect(webchatSettings({ logo: 'https://evil.test/track.gif' }).logo).toBe('');
    expect(webchatSettings({ logo: 'data:text/html;base64,PHNjcmlwdD4=' }).logo).toBe('');
  });

  it('слишком тяжёлый логотип не попадает в страницу', () => {
    const huge = 'data:image/png;base64,' + 'A'.repeat(300 * 1024);
    expect(webchatSettings({ logo: huge }).logo).toBe('');
  });

  it('сторона кнопки — только левая или правая', () => {
    expect(webchatSettings({ position: 'left' }).position).toBe('left');
    expect(webchatSettings({ position: 'посередине' }).position).toBe('right');
  });

  it('цвет кнопки можно не указывать: тогда он тот же, что у чата', () => {
    const s = webchatSettings({ color: '#1faa53' });
    expect(s.launcher).toBe('');
    expect(launcherColor(s)).toBe('#1faa53');

    const own = webchatSettings({ color: '#1faa53', launcher: '#ff0000' });
    expect(launcherColor(own)).toBe('#ff0000');
  });

  it('мусор в цвете кнопки не подменяет цвет чата на синий по умолчанию', () => {
    // Здесь нельзя звать safeColor: он вернул бы #2F6BFF, и кнопка
    // молча стала бы не того цвета, что чат.
    const s = webchatSettings({ color: '#1faa53', launcher: 'красный' });
    expect(s.launcher).toBe('');
    expect(launcherColor(s)).toBe('#1faa53');
  });

  it('способ появления — только из списка', () => {
    expect(webchatSettings({ anim: 'pulse' }).anim).toBe('pulse');
    expect(webchatSettings({ anim: 'сальто' }).anim).toBe('fade');
  });
});

describe('когда показывать кнопку', () => {
  it('по умолчанию сразу', () => {
    const s = webchatSettings({});
    expect(s.showMode).toBe('now');
    expect(s.showAfter).toBe(0);
  });

  it('пустое число не превращает «через n секунд» в «сразу»', () => {
    // Иначе человек выбрал задержку, получил её отсутствие и ищет
    // причину где угодно, только не в пустом поле.
    expect(webchatSettings({ showMode: 'delay', showAfter: '' }).showAfter).toBe(5);
    expect(webchatSettings({ showMode: 'scroll', showAfter: 0 }).showAfter).toBe(30);
  });

  it('слишком большие значения подрезаются, а не принимаются молча', () => {
    expect(webchatSettings({ showMode: 'delay', showAfter: 99999 }).showAfter).toBe(600);
    expect(webchatSettings({ showMode: 'scroll', showAfter: 900 }).showAfter).toBe(100);
  });

  it('при «одразу» число не хранится: иначе оно всплывёт при смене режима', () => {
    expect(webchatSettings({ showMode: 'now', showAfter: 42 }).showAfter).toBe(0);
  });

  it('домен приводится к виду, в котором его можно сравнивать', () => {
    expect(normalizeDomain('https://www.Example.com:443/page')).toBe('example.com');
    expect(normalizeDomain('не домен вовсе')).toBe('');
  });
});

describe('где виджету можно работать', () => {
  it('пустой список означает «де завгодно»: иначе новый виджет молчит', () => {
    expect(domainAllowed([], 'https://anything.test/page')).toBe(true);
  });

  it('поддомен разрешённого домена проходит', () => {
    expect(domainAllowed(['example.com'], 'https://shop.example.com/x')).toBe(true);
  });

  it('похожий домен не проходит: example.com.evil.net — это evil.net', () => {
    expect(domainAllowed(['example.com'], 'https://example.com.evil.net/')).toBe(false);
  });

  it('чужой домен не проходит', () => {
    expect(domainAllowed(['example.com'], 'https://other.test/')).toBe(false);
  });
});

describe('сообщение посетителя', () => {
  it('становится обычным входящим', () => {
    const m = normalizeWebchat(
      { visitorId: visitor, text: 'Скільки коштує?', clientId: 'c1', page: 'https://shop/x' },
      ctx,
    );
    expect(m?.channelType).toBe('webchat');
    expect(m?.direction).toBe('in');
    expect(m?.peerId).toBe(visitor);
    expect(m?.content.text).toBe('Скільки коштує?');
  });

  it('без имени посетители различимы в списке', () => {
    const a = normalizeWebchat({ visitorId: visitor, text: 'привіт', clientId: 'c1' }, ctx);
    const b = normalizeWebchat(
      { visitorId: 'ffffffffffffffffffffffffffffabcd', text: 'привіт', clientId: 'c2' },
      ctx,
    );
    expect(a?.peerProfile.name).not.toBe(b?.peerProfile.name);
  });

  it('пустое сообщение не создаёт диалог', () => {
    expect(normalizeWebchat({ visitorId: visitor, text: '   ', clientId: 'c1' }, ctx)).toBeNull();
  });

  it('очень длинное сообщение обрезается, а не уходит целиком', () => {
    const m = normalizeWebchat(
      { visitorId: visitor, text: 'а'.repeat(9000), clientId: 'c1' },
      ctx,
    );
    expect((m?.content.text ?? '').length).toBe(4000);
  });

  it('страница попадает в сырые данные: оператору это половина контекста', () => {
    const m = normalizeWebchat(
      { visitorId: visitor, text: 'є?', clientId: 'c1', page: 'https://shop/cart' },
      ctx,
    );
    expect((m?.raw as { page?: string }).page).toBe('https://shop/cart');
  });
});

describe('код для вставки', () => {
  it('ссылки абсолютные: относительная на чужом сайте ведёт в никуда', () => {
    expect(embedSnippet('https://app.rozmovio.com/', 'wc_key')).toContain(
      'https://app.rozmovio.com/chat.js',
    );
    expect(iframeSnippet('https://app.rozmovio.com', 'wc_key')).toContain(
      'https://app.rozmovio.com/chat/wc_key',
    );
  });

  it('ключ сайта виден в коде: он публичный и секретом не притворяется', () => {
    expect(embedSnippet('https://app.rozmovio.com', 'wc_key')).toContain('data-key="wc_key"');
  });
});

describe('окно ответа', () => {
  it('его нет: это наш канал, чужих правил тут не действует', () => {
    const w = computeResponseWindow('webchat', new Date('2026-01-01T00:00:00.000Z'));
    expect(w.type).toBe('none');
    expect(canSendFreeform('webchat', w, new Date('2027-01-01T00:00:00.000Z')).allowed).toBe(true);
  });
});
