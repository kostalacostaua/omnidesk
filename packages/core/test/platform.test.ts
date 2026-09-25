import { describe, expect, it } from 'vitest';
import {
  accountState,
  isPlatformOwner,
  isTenantKind,
  monthRange,
  parsePlatformOwners,
  payState,
} from '../src/platform.js';

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

describe('вид кабинета', () => {
  const now = new Date('2026-05-10T00:00:00Z');

  it('партнёр оплачен всегда и от дат не зависит', () => {
    expect(accountState('partner', null, now)).toBe('partner');
    expect(accountState('partner', '2020-01-01', now)).toBe('partner');
  });

  it('у клиента всё по-прежнему', () => {
    expect(accountState('client', '2026-06-10', now)).toBe('paid');
    expect(accountState('client', '2026-05-14', now)).toBe('due');
    expect(accountState('client', null, now)).toBe('unpaid');
    expect(accountState(null, null, now)).toBe('unpaid');
  });

  it('чужое слово партнёром не делает', () => {
    expect(isTenantKind('partner')).toBe(true);
    expect(isTenantKind('client')).toBe(true);
    expect(isTenantKind('друг')).toBe(false);
    expect(accountState('друг', null, now)).toBe('unpaid');
  });
});

/*
 * Свод по деньгам. Считается на сервере и показывается владельцу
 * платформы — то есть тем, по чему он принимает решения. Каждое число
 * здесь должно быть объяснимо, поэтому и проверяется отдельно.
 */
describe('свод по деньгам', () => {
  const T = (over: Record<string, unknown> = {}) => ({
    id: '1', name: 'Ромашка', slug: 'romashka', plan: 'pro', kind: 'client',
    status: 'active', seats_limit: 10, paid_until: '2027-01-01',
    price_month: '60', currency: 'USD', created_at: '2026-01-01T00:00:00Z',
    paddle_status: null, paddle_subscription_id: null, ...over,
  }) as never;
  const NO_INV = { issued: 0, paid: 0, debtUah: 0, paidUah: 0, lastPaidAt: null, byMonth: {} };
  const NOW = new Date('2026-09-25T00:00:00Z');

  it('живая подписка важнее старых счетов: деньги идут с карты', async () => {
    const { billingRow } = await import('../src/billing-report.js');
    const paddle = billingRow(
      T({ paddle_status: 'active', paddle_subscription_id: 'sub_1' }),
      { ...NO_INV, issued: 3 }, NOW,
    );
    expect(paddle.source).toBe('paddle');
    // Отменённая подписка деньги уже не приносит — остаются счета.
    const off = billingRow(
      T({ paddle_status: 'canceled', paddle_subscription_id: 'sub_1' }),
      { ...NO_INV, issued: 3 }, NOW,
    );
    expect(off.source).toBe('invoice');
  });

  it('партнёр в выручку не попадает, просроченный тоже', async () => {
    const { billingRow, billingTotals } = await import('../src/billing-report.js');
    const rows = [
      billingRow(T(), NO_INV, NOW),
      billingRow(T({ id: '2', kind: 'partner' }), NO_INV, NOW),
      billingRow(T({ id: '3', paid_until: '2026-01-01' }), NO_INV, NOW),
    ];
    const t = billingTotals(rows);
    expect(t.paying).toBe(1);
    expect(t.partners).toBe(1);
    expect(t.overdue).toBe(1);
    // Шестьдесят, а не сто восемьдесят: партнёр и должник не платят.
    expect(t.mrr).toEqual({ USD: 60 });
  });

  it('валюты не сводятся в одну', async () => {
    const { billingRow, billingTotals } = await import('../src/billing-report.js');
    const t = billingTotals([
      billingRow(T(), NO_INV, NOW),
      billingRow(T({ id: '2', currency: 'UAH', price_month: '2500' }), NO_INV, NOW),
    ]);
    expect(t.mrr).toEqual({ USD: 60, UAH: 2500 });
  });

  it('пустой месяц в отчёте остаётся: это тоже ответ', async () => {
    const { billingMonths } = await import('../src/billing-report.js');
    const m = billingMonths([{ '2026-09': { invoicedUah: 100, paidUah: 40 } }], NOW, 3);
    expect(m).toHaveLength(3);
    expect(m.map((x) => x.month)).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(m[0]).toEqual({ month: '2026-07', invoicedUah: 0, paidUah: 0 });
    expect(m[2]).toEqual({ month: '2026-09', invoicedUah: 100, paidUah: 40 });
  });

  it('долг и полученное складываются по всем организациям', async () => {
    const { billingRow, billingTotals } = await import('../src/billing-report.js');
    const t = billingTotals([
      billingRow(T(), { ...NO_INV, issued: 2, debtUah: 1000.5, paidUah: 2000.25 }, NOW),
      billingRow(T({ id: '2' }), { ...NO_INV, issued: 1, debtUah: 500, paidUah: 0 }, NOW),
    ]);
    expect(t.debtUah).toBe(1500.5);
    expect(t.paidUah).toBe(2000.25);
  });
});

/*
 * Места сверх тарифа. Пока цена была одной цифрой, пятнадцать
 * операторов на тарифе с десятью стоили столько же, сколько десять, —
 * то есть пять человек работали бесплатно, и увидеть это можно было
 * только вручную, сверяя список команды с ценой.
 */
describe('места сверх тарифа', () => {
  const T = (over: Record<string, unknown> = {}) => ({
    id: '1', name: 'Ромашка', slug: 'romashka', plan: 'pro', kind: 'client',
    status: 'active', seats_limit: 15, seats_free: 10, seat_price: '5',
    paid_until: '2027-01-01', price_month: '60', currency: 'USD',
    created_at: '2026-01-01T00:00:00Z',
    paddle_status: null, paddle_subscription_id: null, ...over,
  }) as never;
  const NO_INV = { issued: 0, paid: 0, debtUah: 0, paidUah: 0, lastPaidAt: null, byMonth: {} };
  const NOW = new Date('2026-09-25T00:00:00Z');

  it('доплата считается только за места сверх включённых', async () => {
    const { seatMoney } = await import('../src/billing-report.js');
    expect(seatMoney(15, 10, 5)).toEqual({ extra: 5, month: 25 });
    expect(seatMoney(10, 10, 5)).toEqual({ extra: 0, month: 0 });
    // Мест меньше, чем включено, — доплаты нет, а не отрицательная.
    expect(seatMoney(3, 10, 5)).toEqual({ extra: 0, month: 0 });
  });

  it('в цене организации база и места складываются', async () => {
    const { billingRow } = await import('../src/billing-report.js');
    const r = billingRow(T(), NO_INV, NOW);
    expect(r.priceMonth).toBe(60);
    expect(r.seatsMonth).toBe(25);
    expect(r.monthTotal).toBe(85);
  });

  // Корпоративный считается той же формулой: включённых мест ноль, и
  // вся цена оказывается ценой мест. Второго способа считать деньги
  // быть не должно.
  it('корпоративный считается по головам той же формулой', async () => {
    const { billingRow } = await import('../src/billing-report.js');
    const r = billingRow(
      T({ plan: 'custom', seats_limit: 40, seats_free: 0, seat_price: '12', price_month: '0' }),
      NO_INV, NOW,
    );
    expect(r.seatsExtra).toBe(40);
    expect(r.monthTotal).toBe(480);
  });

  it('в итогах видно, сколько денег от тарифов и сколько от мест', async () => {
    const { billingRow, billingTotals } = await import('../src/billing-report.js');
    const t = billingTotals([
      billingRow(T(), NO_INV, NOW),
      billingRow(T({ id: '2', seats_limit: 12, seats_free: 10 }), NO_INV, NOW),
    ]);
    expect(t.mrrBase).toEqual({ USD: 120 });
    expect(t.mrrSeats).toEqual({ USD: 35 });
    expect(t.mrr).toEqual({ USD: 155 });
    expect(t.seatsExtra).toBe(7);
  });
});
