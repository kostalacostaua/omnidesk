import { describe, expect, it } from 'vitest';
import {
  paddleAmount,
  paddleApi,
  paddlePlan,
  paddleSign,
  paddleSignatureOk,
  paddleUpdate,
} from '../src/paddle.js';

const SECRET = 'pdl_ntfset_secret';
const NOW = 1_770_000_000;

describe('подпись вебхука Paddle', () => {
  const body = '{"event_id":"evt_1","event_type":"subscription.updated"}';

  it('принимает своё и отвергает чужое', () => {
    const good = paddleSign(body, SECRET, NOW);
    expect(paddleSignatureOk(good, body, SECRET, { now: NOW })).toEqual({ ok: true });
    expect(paddleSignatureOk(good, body, 'другой секрет', { now: NOW })).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  // Подпись считается от байтов, а не от разобранного и собранного
  // заново объекта: порядок ключей там уже другой.
  it('подделка тела при прежней подписи не проходит', () => {
    const good = paddleSign(body, SECRET, NOW);
    const fake = '{"event_id":"evt_1","event_type":"subscription.canceled"}';
    expect(paddleSignatureOk(good, fake, SECRET, { now: NOW })).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('старую подпись не принимаем: иначе её можно повторять вечно', () => {
    const old = paddleSign(body, SECRET, NOW - 3600);
    expect(paddleSignatureOk(old, body, SECRET, { now: NOW })).toEqual({
      ok: false,
      reason: 'stale_timestamp',
    });
  });

  it('заголовок без ts или h1 — это не подпись', () => {
    expect(paddleSignatureOk('h1=abc', body, SECRET, { now: NOW }).ok).toBe(false);
    expect(paddleSignatureOk(undefined, body, SECRET, { now: NOW })).toEqual({
      ok: false,
      reason: 'missing_signature',
    });
    expect(paddleSignatureOk('ts=x;h1=abc', body, SECRET, { now: NOW })).toEqual({
      ok: false,
      reason: 'bad_timestamp',
    });
  });
});

/** Событие подписки в том виде, в каком его шлёт Paddle. */
const EVENT = {
  event_id: 'evt_01',
  event_type: 'subscription.updated',
  data: {
    id: 'sub_01',
    status: 'active',
    customer_id: 'ctm_01',
    current_billing_period: { starts_at: '2026-09-25T10:00:00Z', ends_at: '2026-10-25T10:00:00Z' },
    custom_data: { tenant_id: '8f14e45f-ceea-467a-9c1e-1f3bcb7f3a11' },
    items: [{ price: { id: 'pri_pro', product_id: 'pro_01' }, quantity: 1 }],
  },
};

describe('событие подписки', () => {
  it('разбирается до того, что мы записываем', () => {
    const u = paddleUpdate(EVENT);
    expect(u).toMatchObject({
      eventId: 'evt_01',
      tenantId: '8f14e45f-ceea-467a-9c1e-1f3bcb7f3a11',
      subscriptionId: 'sub_01',
      customerId: 'ctm_01',
      priceId: 'pri_pro',
      status: 'active',
      paidUntil: '2026-10-25',
      live: true,
    });
  });

  // Просроченная карта — не повод отбирать рабочий инструмент: Paddle
  // ещё пробует списать, и доступ должен дожить до его решения.
  it('past_due считается живой подпиской, а отменённая — нет', () => {
    const due = paddleUpdate({ ...EVENT, data: { ...EVENT.data, status: 'past_due' } });
    const off = paddleUpdate({ ...EVENT, data: { ...EVENT.data, status: 'canceled' } });
    expect(due?.live).toBe(true);
    expect(off?.live).toBe(false);
    expect(off?.paidUntil).toBe('2026-10-25');
  });

  it('без tenant_id событие не наше: применить его некуда', () => {
    expect(paddleUpdate({ ...EVENT, data: { ...EVENT.data, custom_data: {} } })).toBeNull();
  });

  it('события не про подписку пропускаем', () => {
    expect(paddleUpdate({ ...EVENT, event_type: 'transaction.completed' })).toBeNull();
    expect(paddleUpdate({ event_type: 'subscription.updated' })).toBeNull();
    expect(paddleUpdate('мусор')).toBeNull();
  });
});

describe('тариф по цене', () => {
  const prices = { start: 'pri_start', pro: 'pri_pro' };

  it('находится обратным поиском', () => {
    expect(paddlePlan('pri_pro', prices)).toBe('pro');
    expect(paddlePlan('pri_start', prices)).toBe('start');
  });

  // Товар, заведённый в Paddle мимо нас, не должен понизить клиента.
  it('незнакомая цена не меняет тариф', () => {
    expect(paddlePlan('pri_чужой', prices)).toBeNull();
    expect(paddlePlan(null, prices)).toBeNull();
  });
});

describe('сумма и адрес', () => {
  it('цена переводится в наименьшие единицы', () => {
    expect(paddleAmount('1200.00')).toBe('120000');
    expect(paddleAmount(49.5)).toBe('4950');
    expect(paddleAmount('19,90')).toBe('1990');
  });

  it('пустая и отрицательная цена — не цена', () => {
    expect(paddleAmount('')).toBeNull();
    expect(paddleAmount(0)).toBeNull();
    expect(paddleAmount('-5')).toBeNull();
    expect(paddleAmount('дорого')).toBeNull();
  });

  it('песочница и боевой стоят на разных адресах', () => {
    expect(paddleApi('sandbox')).toContain('sandbox-api');
    expect(paddleApi('production')).toBe('https://api.paddle.com');
  });
});
