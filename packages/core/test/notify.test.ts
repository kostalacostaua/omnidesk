import { describe, expect, it } from 'vitest';
import {
  NOTIFY_EVENTS,
  dedupKey,
  escapeHtml,
  isNotifyEvent,
  renderNotify,
  shorten,
  telegramText,
} from '../src/notify.js';

/**
 * Оповещение читает человек, который в этот момент не смотрит в
 * приложение. Поэтому проверяется не «собралась ли строка», а то, от
 * чего зависит решение бросать всё и открывать инбокс: видно ли, кто
 * написал, что написал и куда идти.
 */

const ctx = { tenantId: 't1', channelId: 'c1' };

describe('текст оповещения', () => {
  it('о новом диалоге видно, кто написал и что', () => {
    const m = renderNotify('conversation.new', {
      who: 'Олена',
      text: 'Доброго дня, є сумки?',
      channel: 'instagram',
      conversationId: 'conv-1',
    });
    expect(m.title).toContain('instagram');
    expect(m.body).toContain('Олена');
    expect(m.body).toContain('сумки');
    expect(m.path).toBe('/#chat=conv-1');
  });

  it('без имени пишем «клієнт», а не пустое место', () => {
    const m = renderNotify('conversation.new', { who: null, text: 'привіт' });
    expect(m.body.startsWith('клієнт')).toBe(true);
  });

  it('сообщение без текста не выглядит пустым', () => {
    const m = renderNotify('conversation.new', { who: 'Ігор', text: null });
    expect(m.body).toContain('вкладення');
  });

  it('в ожидании видно, сколько человек ждёт', () => {
    const m = renderNotify('message.waiting', { who: 'Ігор', text: 'ну що там', waitingMinutes: 40 });
    expect(m.title).toContain('40');
  });

  it('упавший канал ведёт в каналы, а не в диалог', () => {
    const m = renderNotify('channel.down', { channel: 'Продажі', text: 'Токен відкликано' });
    expect(m.title).toContain('Продажі');
    expect(m.path).toBe('/#view=channels');
  });

  it('в заявке с сайта видно, как ответить', () => {
    const m = renderNotify('lead.new', {
      who: 'Петро, ТОВ Ромашка',
      email: 'p@example.com',
      phone: '+380671112233',
      text: 'Цікавить Instagram',
    });
    expect(m.body).toContain('p@example.com');
    expect(m.body).toContain('+380671112233');
  });

  it('у каждого события есть текст: забытое событие молчало бы', () => {
    for (const event of NOTIFY_EVENTS) {
      const m = renderNotify(event, { who: 'Х', text: 'Y', conversationId: 'c' });
      expect(m.title.length).toBeGreaterThan(0);
      expect(m.body.length).toBeGreaterThan(0);
    }
  });
});

describe('длина и разметка', () => {
  it('длинное сообщение обрезается, а не уезжает целиком', () => {
    const long = 'а'.repeat(500);
    expect(shorten(long).length).toBeLessThanOrEqual(160);
    expect(shorten(long).endsWith('…')).toBe(true);
  });

  it('перенос строки не ломает однострочное оповещение', () => {
    expect(shorten('перший\nдругий')).toBe('перший другий');
  });

  it('угловые скобки клиента не становятся разметкой телеграма', () => {
    const m = renderNotify('conversation.new', { who: '<b>Олена</b>', text: 'де <i>замовлення</i>?' });
    const text = telegramText(m, 'https://app.rozmovio.com');
    expect(text).toContain('&lt;b&gt;');
    expect(text).not.toContain('<b>Олена');
  });

  it('ссылка собирается один раз и без двойного слэша', () => {
    const m = renderNotify('conversation.new', { conversationId: 'c-7' });
    expect(telegramText(m, 'https://app.rozmovio.com/')).toContain(
      'https://app.rozmovio.com/#chat=c-7',
    );
  });

  it('без адреса приложения ссылки нет, а текст остаётся', () => {
    const m = renderNotify('conversation.new', { who: 'Олена', conversationId: 'c-7' });
    const text = telegramText(m, '');
    expect(text).toContain('Олена');
    expect(text).not.toContain('#chat');
  });

  it('экранируются только опасные символы', () => {
    expect(escapeHtml('ціна < 100 & дешевше')).toBe('ціна &lt; 100 &amp; дешевше');
  });
});

describe('повторы', () => {
  it('одно и то же ожидание даёт один и тот же ключ', () => {
    const a = dedupKey('message.waiting', { conversationId: 'c1' }, 'm5');
    const b = dedupKey('message.waiting', { conversationId: 'c1' }, 'm5');
    expect(a).toBe(b);
  });

  it('разные диалоги не глушат друг друга', () => {
    expect(dedupKey('conversation.new', { conversationId: 'c1' })).not.toBe(
      dedupKey('conversation.new', { conversationId: 'c2' }),
    );
  });

  it('чужое событие в подписку не проходит', () => {
    expect(isNotifyEvent('conversation.new')).toBe(true);
    expect(isNotifyEvent('conversation.deleted')).toBe(false);
  });
});

describe('ctx не участвует в тексте', () => {
  it('идентификаторы компании и канала в оповещение не попадают', () => {
    const m = renderNotify('conversation.new', { who: 'Олена', conversationId: 'conv-1' });
    expect(m.body).not.toContain(ctx.tenantId);
    expect(m.body).not.toContain(ctx.channelId);
  });
});
