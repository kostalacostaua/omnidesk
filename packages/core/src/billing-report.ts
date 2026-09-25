/**
 * Свод по деньгам платформы.
 *
 * Здесь только расчёты, без базы: всё, что можно проверить тестом,
 * должно быть проверено тестом. Деньги — то самое место, где ошибка не
 * видна на глаз и находится через полгода, при сверке с бухгалтерией.
 *
 * Два потока денег, и смешивать их нельзя.
 *
 * Счета — безнал: выставили, клиент заплатил переводом. Сумма в счёте
 * зафиксирована вместе с курсом на день выставления, поэтому в гривне
 * она известна точно и задним числом не меняется.
 *
 * Paddle — карта: подписка живёт своей жизнью, мы узнаём о ней из
 * состояния клиента. Курса на день списания у нас нет, и выдумывать
 * его, чтобы сложить с гривной, значит показать сумму, которой не было
 * ни в одной выписке.
 *
 * Поэтому в отчёте две колонки денег, а не одна усреднённая.
 */

import { payState } from './platform.js';

/** Что известно об организации до подсчётов. */
export interface BillingTenant {
  id: string;
  name: string;
  slug: string;
  plan: string;
  kind: string;
  status: string;
  seats_limit: number;
  paid_until: string | null;
  price_month: string | null;
  currency: string;
  created_at: string;
  paddle_status: string | null;
  paddle_subscription_id: string | null;
}

/** Итоги по счетам одной организации. */
export interface BillingInvoices {
  issued: number;
  paid: number;
  /** Выставлено и не оплачено, в гривне. */
  debtUah: number;
  /** Оплачено за всё время, в гривне. */
  paidUah: number;
  lastPaidAt: string | null;
  /** По месяцам: ключ «2026-09». */
  byMonth: Record<string, { invoicedUah: number; paidUah: number }>;
}

export interface BillingRow {
  id: string;
  name: string;
  slug: string;
  plan: string;
  kind: string;
  seats: number;
  paidUntil: string | null;
  /** paid — оплачено, due — вот-вот кончится, unpaid — просрочено. */
  state: 'paid' | 'due' | 'unpaid';
  priceMonth: number;
  currency: string;
  /** Чем платит: карта через Paddle, счёт по безналу или ничем. */
  source: 'paddle' | 'invoice' | 'none';
  paddleStatus: string | null;
  invoices: number;
  paidUah: number;
  debtUah: number;
  lastPaidAt: string | null;
  createdAt: string;
}

export interface BillingTotals {
  tenants: number;
  paying: number;
  overdue: number;
  partners: number;
  /** План выручки в месяц по тем, кто платит. В валюте каждого своей. */
  mrr: Record<string, number>;
  paddleActive: number;
  debtUah: number;
  paidUah: number;
}

function money(v: unknown): number {
  const n = Number(String(v ?? '0').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/** Живая подписка в Paddle: за такую клиент платит картой. */
const LIVE = ['active', 'trialing', 'past_due'];

export function billingRow(
  t: BillingTenant,
  inv: BillingInvoices,
  now: Date = new Date(),
): BillingRow {
  const paddle = Boolean(t.paddle_subscription_id && LIVE.includes(String(t.paddle_status ?? '')));
  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    plan: t.plan,
    kind: t.kind,
    seats: Number(t.seats_limit ?? 0),
    paidUntil: t.paid_until,
    state: payState(t.paid_until, now),
    priceMonth: money(t.price_month),
    currency: t.currency || 'UAH',
    // Карта важнее счёта: если подписка жива, деньги идут оттуда, даже
    // когда в прошлом были счета по безналу.
    source: paddle ? 'paddle' : inv.issued > 0 ? 'invoice' : 'none',
    paddleStatus: t.paddle_status,
    invoices: inv.issued,
    paidUah: inv.paidUah,
    debtUah: inv.debtUah,
    lastPaidAt: inv.lastPaidAt,
    createdAt: t.created_at,
  };
}

/**
 * Итоги.
 *
 * MRR держим по валютам раздельно. Свести всё в гривну соблазнительно —
 * одно число красивее пяти, — но курс на «сегодня» превратит вчерашний
 * отчёт в другой сегодня, и сверить его будет не с чем.
 *
 * Партнёры в деньгах не участвуют: они не платят и не должны. Считать
 * их в «платят» — врать себе о выручке.
 */
export function billingTotals(rows: BillingRow[]): BillingTotals {
  const mrr: Record<string, number> = {};
  let paying = 0;
  let overdue = 0;
  let partners = 0;
  let paddleActive = 0;
  let debtUah = 0;
  let paidUah = 0;

  for (const r of rows) {
    debtUah += r.debtUah;
    paidUah += r.paidUah;
    if (r.source === 'paddle') paddleActive += 1;

    if (r.kind === 'partner') {
      partners += 1;
      continue;
    }
    if (r.state === 'unpaid') {
      overdue += 1;
      continue;
    }
    paying += 1;
    if (r.priceMonth > 0) {
      mrr[r.currency] = Math.round(((mrr[r.currency] ?? 0) + r.priceMonth) * 100) / 100;
    }
  }

  return {
    tenants: rows.length,
    paying,
    overdue,
    partners,
    mrr,
    paddleActive,
    debtUah: Math.round(debtUah * 100) / 100,
    paidUah: Math.round(paidUah * 100) / 100,
  };
}

/**
 * Последние двенадцать месяцев подряд, включая пустые.
 *
 * Пустой месяц в отчёте — это тоже ответ: «в июле не выставили ни
 * одного счёта» видно только тогда, когда июль нарисован.
 */
export function billingMonths(
  byTenant: Array<Record<string, { invoicedUah: number; paidUah: number }>>,
  now: Date = new Date(),
  count = 12,
): Array<{ month: string; invoicedUah: number; paidUah: number }> {
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    keys.push(d.toISOString().slice(0, 7));
  }

  return keys.map((month) => {
    let invoicedUah = 0;
    let paidUah = 0;
    for (const t of byTenant) {
      const m = t[month];
      if (!m) continue;
      invoicedUah += m.invoicedUah;
      paidUah += m.paidUah;
    }
    return {
      month,
      invoicedUah: Math.round(invoicedUah * 100) / 100,
      paidUah: Math.round(paidUah * 100) / 100,
    };
  });
}

/** Сводка по тарифам: сколько организаций и сколько денег в месяц. */
export function billingByPlan(
  rows: BillingRow[],
): Array<{ plan: string; tenants: number; mrr: Record<string, number> }> {
  const map = new Map<string, { plan: string; tenants: number; mrr: Record<string, number> }>();
  for (const r of rows) {
    if (r.kind === 'partner') continue;
    const cur = map.get(r.plan) ?? { plan: r.plan, tenants: 0, mrr: {} };
    cur.tenants += 1;
    if (r.state !== 'unpaid' && r.priceMonth > 0) {
      cur.mrr[r.currency] = Math.round(((cur.mrr[r.currency] ?? 0) + r.priceMonth) * 100) / 100;
    }
    map.set(r.plan, cur);
  }
  return [...map.values()].sort((a, b) => b.tenants - a.tenants);
}
