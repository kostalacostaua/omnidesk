import { describe, expect, it } from 'vitest';
import {
  HOOK_EVENTS,
  HOOK_HINTS,
  HOOK_TITLES,
  badHookHeader,
  badOutUrl,
  cleanHookEvents,
  hookBody,
  hookHeaders,
  hookSignatureOk,
  isHookEvent,
  signHook,
} from '../src/webhook.js';

describe('список событий', () => {
  it('у каждого события есть название и пояснение', () => {
    for (const e of HOOK_EVENTS) {
      expect(HOOK_TITLES[e]).toBeTruthy();
      expect(HOOK_HINTS[e]).toBeTruthy();
    }
  });

  it('чужая строка в подписке — молчащий вебхук, поэтому её не берём', () => {
    expect(cleanHookEvents(['message.in', 'ой', 'order.created'])).toEqual([
      'message.in',
      'order.created',
    ]);
    expect(cleanHookEvents('message.in')).toEqual([]);
    expect(isHookEvent('message.in')).toBe(true);
    expect(isHookEvent('message.everything')).toBe(false);
  });

  it('повтор в списке — одна подписка, а не две доставки', () => {
    expect(cleanHookEvents(['message.in', 'message.in'])).toEqual(['message.in']);
  });
});

describe('адрес вебхука', () => {
  it('только https', () => {
    expect(badOutUrl('http://firma.com/hook')).toContain('https');
    expect(badOutUrl('https://firma.com/hook')).toBeNull();
  });

  // Запрос уходит из нашей сети: этим полем можно попросить нас
  // постучаться туда, куда снаружи хода нет.
  it('внутренние адреса запрещены', () => {
    for (const bad of [
      'https://localhost/hook',
      'https://127.0.0.1/hook',
      'https://10.0.0.5/hook',
      'https://192.168.1.1/hook',
      'https://172.16.0.1/hook',
      'https://169.254.169.254/latest/meta-data',
      'https://api.internal/hook',
    ]) {
      expect(badOutUrl(bad), bad).toContain('ззовні');
    }
  });

  it('пустое и кривое отличаются словами', () => {
    expect(badOutUrl('')).toContain('Вкажіть');
    expect(badOutUrl('firma.com/hook')).toContain('https://');
  });
});

describe('свой заголовок', () => {
  it('без заголовка — не ошибка: он нужен не всем', () => {
    expect(badHookHeader('', '')).toBeNull();
    expect(badHookHeader('Authorization', 'Bearer abc')).toBeNull();
  });

  it('половина заголовка не работает', () => {
    expect(badHookHeader('Authorization', '')).toContain('значення');
    expect(badHookHeader('', 'Bearer abc')).toContain('назву');
  });

  // Подменённый x-rozmovio-signature — это тихо выключенная проверка.
  it('наши заголовки перебивать нельзя', () => {
    expect(badHookHeader('X-Rozmovio-Signature', 'что угодно')).toContain('зайняті');
    expect(badHookHeader('x-rozmovio-event', 'ping')).toContain('зайняті');
  });

  it('перенос строки в значении — это вписанный чужой заголовок', () => {
    expect(badHookHeader('Authorization', 'a\r\nX-Admin: 1')).toContain('рядок');
    expect(badHookHeader('Прив кий', 'x')).toContain('латиниця');
  });
});

describe('подпись', () => {
  const secret = 'whsec_' + 'a'.repeat(64);

  it('подписывается время вместе с телом', () => {
    const body = '{"event":"message.in"}';
    // Иначе перехваченный запрос с настоящей подписью остаётся
    // настоящим навсегда.
    expect(signHook(secret, 1000, body)).not.toBe(signHook(secret, 1001, body));
  });

  it('другое тело — другая подпись', () => {
    expect(signHook(secret, 1000, '{"a":1}')).not.toBe(signHook(secret, 1000, '{"a":2}'));
  });

  it('другой секрет — другая подпись', () => {
    expect(signHook('one', 1000, '{}')).not.toBe(signHook('two', 1000, '{}'));
  });

  it('та сторона может её сверить', () => {
    const body = '{"event":"ping"}';
    expect(hookSignatureOk(secret, 1000, body, signHook(secret, 1000, body))).toBe(true);
    expect(hookSignatureOk(secret, 1000, body, signHook(secret, 1001, body))).toBe(false);
    expect(hookSignatureOk(secret, 1000, body, 'sha256=ой')).toBe(false);
  });
});

describe('заголовки запроса', () => {
  const body = JSON.stringify(hookBody('t1', 'message.in', { text: 'привіт' }));

  it('событие и номер доставки видно, не разбирая тело', () => {
    const h = hookHeaders({ secret: 's' }, 'message.in', 'd1', body, 1700000000);
    expect(h['x-rozmovio-event']).toBe('message.in');
    expect(h['x-rozmovio-delivery']).toBe('d1');
    expect(h['x-rozmovio-timestamp']).toBe('1700000000');
    expect(h['x-rozmovio-signature']).toBe(signHook('s', 1700000000, body));
    expect(h['content-type']).toBe('application/json');
  });

  it('свой заголовок клиента приезжает рядом', () => {
    const h = hookHeaders(
      { secret: 's', headerName: 'Authorization', headerValue: 'Bearer abc' },
      'ping',
      'd2',
      body,
    );
    expect(h['Authorization']).toBe('Bearer abc');
  });

  it('половина заголовка не уезжает вовсе', () => {
    const h = hookHeaders({ secret: 's', headerName: 'Authorization' }, 'ping', 'd3', body);
    expect(h['Authorization']).toBeUndefined();
  });
});

describe('тело события', () => {
  it('конверт одинаковый у всех событий', () => {
    const b = hookBody('t1', 'order.created', { orderId: '42' });
    expect(b.event).toBe('order.created');
    expect(b.tenantId).toBe('t1');
    expect(b.data).toEqual({ orderId: '42' });
    expect(Date.parse(b.at)).not.toBeNaN();
  });
});
