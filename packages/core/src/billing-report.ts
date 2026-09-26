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
  /** Сколько мест входит в цену. Сверх них — доплата за каждое. */
  seats_free: number;
  seat_price: string | null;
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
  /** Цена задана за пользователя: платят за каждого, включённых мест нет. */
  perSeat: boolean;
  priceMonth: number;
  /** Мест сверх включённых и сколько они стоят в месяц. */
  seatsFree: number;
  seatsExtra: number;
  seatPrice: number;
  seatsMonth: number;
  /** База плюс места: столько организация платит в месяц на самом деле. */
  monthTotal: number;
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
  /** Из чего он складывается: тарифы отдельно, места сверх отдельно. */
  mrrBase: Record<string, number>;
  mrrSeats: Record<string, number>;
  /** Сколько всего мест продано сверх включённых. */
  seatsExtra: number;
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

/**
 * Сколько организация платит в месяц.
 *
 * База плюс места сверх включённых. Раньше в цене была одна цифра, и
 * пятнадцать операторов на тарифе с десятью стоили столько же, сколько
 * десять, — то есть пять человек работали бесплатно, и заметить это
 * можно было только вручную, сверяя список команды с ценой.
 *
 * Здесь только доплата за кабинетный тариф. Тарифы, где цена задана за
 * человека, считает tenantMoney: там платят за всех, а не за лишних.
 */
export function seatMoney(
  seatsLimit: number,
  seatsFree: number,
  seatPrice: number,
): { extra: number; month: number } {
  const extra = Math.max(0, Math.round(seatsLimit) - Math.round(seatsFree));
  return { extra, month: Math.round(extra * seatPrice * 100) / 100 };
}

/**
 * Тарифы, где цена задана за пользователя, а не за кабинет.
 *
 * Корпоративный продаётся по головам: цена одного человека умножается
 * на число людей, и никакой базы сверху нет. Раньше это приходилось
 * складывать руками — вписать цену места, вписать сколько мест входит
 * в тариф, проверить, что входит ноль, — и любая из трёх цифр,
 * оставшаяся от прошлого тарифа, давала сумму, которой нет в счёте.
 *
 * Пятнадцать человек по шесть — это девяносто, и считать это должен
 * не человек.
 */
export const PER_SEAT_PLANS = ['custom'];

export function isPerSeatPlan(plan: string | null | undefined): boolean {
  return PER_SEAT_PLANS.includes(String(plan ?? ''));
}

/**
 * Снизу у корпоративного тарифа есть дно.
 *
 * Он продаётся по головам, и без нижней границы три человека по шесть
 * давали восемнадцать долларов — дешевле кабинетного тарифа, который
 * идёт с базой. То есть самый дорогой тариф оказывался самым дешёвым
 * входом, и выгоднее всего было брать корпоративный на двоих.
 *
 * Пятнадцать — это не цена, а условие сделки: тариф командный, и
 * меньшей командой его не берут. Границу держим и на сервере, и в
 * поле ввода: в поле — чтобы человек видел её до оплаты, на
 * сервере — потому что поле можно обойти.
 */
export const PER_SEAT_MIN = 15;

/** Сколько лицензий тариф не продаётся меньше. */
export function seatFloor(plan: string | null | undefined): number {
  return isPerSeatPlan(plan) ? PER_SEAT_MIN : 1;
}

/**
 * Своя цена за человека — та, которой нет в Paddle.
 *
 * Поле «ціна за користувача» в карточке заполняют двумя разными
 * намерениями, и различать их по одному «поле не пустое» нельзя.
 * Вписанная цена, совпадающая с прайсом, — это та же цена, просто
 * записанная руками: в Paddle она заведена, и платить картой можно.
 * Вписанная другая — отдельная договорённость, которой в Paddle нет;
 * продать по ней нечем, и такой клиент платит счётом.
 *
 * Различие не косметическое: из-за него организация, у которой цена
 * совпадала с прайсом, видела «оплата за рахунком» и не имела кнопки
 * оплаты вовсе.
 */
export function seatDeal(
  own: number,
  listed: number,
): { price: number; individual: boolean } {
  const price = own > 0 ? own : listed;
  return { price, individual: own > 0 && own !== listed };
}

/** Прайс владельца: тариф → валюта → цена. */
export type PlanPrices = Record<string, Record<string, number | string>> | null | undefined;

/** Цена тарифа по прайсу. Нет цены в этой валюте — ноль, а не догадка. */
export function planPrice(prices: PlanPrices, plan: string, currency: string): number {
  return money(prices?.[plan]?.[currency]);
}

export interface TenantMoneyInput {
  plan: string;
  seatsLimit: number;
  currency: string;
  priceMonth?: number | string | null;
  seatsFree?: number | null;
  seatPrice?: number | string | null;
}

export interface TenantMoney {
  perSeat: boolean;
  base: number;
  seatsFree: number;
  seatsExtra: number;
  seatPrice: number;
  seatsMonth: number;
  monthTotal: number;
}

/**
 * Сколько организация платит в месяц — одним расчётом на всё приложение.
 *
 * Два вида тарифов, и различие только в том, за что берут деньги. За
 * кабинет: база плюс места сверх включённых. За человека: цена одного
 * умножается на всех, и включённых мест нет — иначе часть команды
 * работала бы бесплатно.
 *
 * Цену человека берём из прайса владельца, а не из поля в карточке:
 * поле нужно ровно для индивидуальной договорённости, и заполненным по
 * умолчанию оно означало бы, что у трёх клиентов на одном тарифе три
 * разные цены, про которые через месяц никто не помнит, откуда они.
 */
export function tenantMoney(t: TenantMoneyInput, prices?: PlanPrices): TenantMoney {
  const seats = Math.max(0, Math.round(Number(t.seatsLimit ?? 0)));
  const currency = t.currency || 'UAH';
  const listed = planPrice(prices, t.plan, currency);

  if (isPerSeatPlan(t.plan)) {
    const own = money(t.seatPrice);
    const seatPrice = own > 0 ? own : listed;
    const month = Math.round(seats * seatPrice * 100) / 100;
    return {
      perSeat: true,
      base: 0,
      seatsFree: 0,
      seatsExtra: seats,
      seatPrice,
      seatsMonth: month,
      monthTotal: month,
    };
  }

  const free = Math.max(0, Math.round(Number(t.seatsFree ?? 0)));
  const seatPrice = money(t.seatPrice);
  const extra = seatMoney(seats, free, seatPrice);
  const base = money(t.priceMonth);
  return {
    perSeat: false,
    base,
    seatsFree: free,
    seatsExtra: extra.extra,
    seatPrice,
    seatsMonth: extra.month,
    monthTotal: Math.round((base + extra.month) * 100) / 100,
  };
}

export function billingRow(
  t: BillingTenant,
  inv: BillingInvoices,
  now: Date = new Date(),
  prices?: PlanPrices,
): BillingRow {
  const paddle = Boolean(t.paddle_subscription_id && LIVE.includes(String(t.paddle_status ?? '')));
  const m = tenantMoney(
    {
      plan: t.plan,
      seatsLimit: Number(t.seats_limit ?? 0),
      currency: t.currency,
      priceMonth: t.price_month,
      seatsFree: t.seats_free,
      seatPrice: t.seat_price,
    },
    prices,
  );
  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    plan: t.plan,
    kind: t.kind,
    seats: Number(t.seats_limit ?? 0),
    paidUntil: t.paid_until,
    state: payState(t.paid_until, now),
    perSeat: m.perSeat,
    priceMonth: m.base,
    seatsFree: m.seatsFree,
    seatsExtra: m.seatsExtra,
    seatPrice: m.seatPrice,
    seatsMonth: m.seatsMonth,
    monthTotal: m.monthTotal,
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
  const mrrBase: Record<string, number> = {};
  const mrrSeats: Record<string, number> = {};
  const add = (map: Record<string, number>, cur: string, v: number) => {
    if (v > 0) map[cur] = Math.round(((map[cur] ?? 0) + v) * 100) / 100;
  };
  let seatsExtra = 0;
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
    seatsExtra += r.seatsExtra;
    add(mrr, r.currency, r.monthTotal);
    add(mrrBase, r.currency, r.priceMonth);
    add(mrrSeats, r.currency, r.seatsMonth);
  }

  return {
    tenants: rows.length,
    paying,
    overdue,
    partners,
    mrr,
    mrrBase,
    mrrSeats,
    seatsExtra,
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
    if (r.state !== 'unpaid' && r.monthTotal > 0) {
      cur.mrr[r.currency] = Math.round(((cur.mrr[r.currency] ?? 0) + r.monthTotal) * 100) / 100;
    }
    map.set(r.plan, cur);
  }
  return [...map.values()].sort((a, b) => b.tenants - a.tenants);
}
