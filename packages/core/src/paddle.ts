/**
 * Paddle: оплата подписки клиентом самостоятельно.
 *
 * Почему вообще Paddle, а не банковский эквайринг. Paddle выступает
 * продавцом перед покупателем (merchant of record): он принимает карту,
 * сам считает НДС той страны, где сидит клиент, и сам отчитывается по
 * нему. Нам приходит уже очищенная выплата. Цена этого — процент,
 * заметно больший банковского, и то, что деньги идут не напрямую.
 *
 * Здесь только правила, которые можно проверить тестом: подпись
 * вебхука, разбор события и превращение его в то, что мы записываем в
 * tenants. Сеть — в приложении.
 */

import { createHmac } from 'node:crypto';
import { safeEqual } from './signatures.js';

/** Песочница и боевой стоят на разных адресах и разных ключах. */
export type PaddleEnv = 'sandbox' | 'production';

export function paddleApi(env: PaddleEnv): string {
  return env === 'production' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com';
}

/**
 * Проверка подписи вебхука.
 *
 * Заголовок выглядит как «ts=1671552777;h1=eb4d0d...», подписывается
 * строка «<ts>:<сырое тело>». Сырое — то есть до JSON.parse: любая
 * пересериализация меняет байты, и подпись не сойдётся.
 *
 * Отдельно проверяем возраст: без окна свежести перехваченный запрос
 * можно повторять сколько угодно, и каждый повтор выглядел бы как
 * новая оплата.
 */
export function paddleSignatureOk(
  header: string | undefined,
  rawBody: Buffer | string,
  secret: string,
  opts: { now?: number; maxSkewSeconds?: number } = {},
): { ok: true } | { ok: false; reason: string } {
  if (!header) return { ok: false, reason: 'missing_signature' };
  if (!secret) return { ok: false, reason: 'missing_secret' };

  let ts = '';
  let h1 = '';
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    const key = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (key === 'ts') ts = value;
    if (key === 'h1') h1 = value;
  }
  if (!ts || !h1) return { ok: false, reason: 'bad_header' };

  const seconds = Number(ts);
  if (!Number.isFinite(seconds)) return { ok: false, reason: 'bad_timestamp' };
  const { now = Math.floor(Date.now() / 1000), maxSkewSeconds = 300 } = opts;
  if (Math.abs(now - seconds) > maxSkewSeconds) return { ok: false, reason: 'stale_timestamp' };

  const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const expected = createHmac('sha256', secret).update(`${ts}:${body}`).digest('hex');
  if (!safeEqual(expected, h1)) return { ok: false, reason: 'bad_signature' };
  return { ok: true };
}

/** Подписать так же, как это делает Paddle. Нужно тестам и только им. */
export function paddleSign(rawBody: string, secret: string, ts: number): string {
  const h1 = createHmac('sha256', secret).update(`${ts}:${rawBody}`).digest('hex');
  return `ts=${ts};h1=${h1}`;
}

/**
 * Состояние подписки у Paddle.
 *
 * Различаем три группы, и различие не косметическое. active и trialing
 * — работает. past_due — оплата не прошла, но Paddle ещё пробует; доступ
 * не отбираем, иначе человек теряет рабочий инструмент из-за
 * просроченной карты. canceled и paused — доступ живёт до конца
 * оплаченного срока, дальше решает paid_until.
 */
export const PADDLE_LIVE = ['active', 'trialing', 'past_due'];

export interface PaddleUpdate {
  /** Идентификатор события: по нему отсекаем повторы. */
  eventId: string;
  eventType: string;
  tenantId: string;
  subscriptionId: string | null;
  customerId: string | null;
  /** Идентификатор цены — по нему находим тариф. */
  priceId: string | null;
  status: string | null;
  /** Конец оплаченного периода, дата без времени. */
  paidUntil: string | null;
  /** Подписка ещё жива: доступ оставляем. */
  live: boolean;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}

function day(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Событие Paddle в том виде, в каком мы его применяем.
 *
 * Берём только то, что меняет доступ: подписка создана, изменена,
 * отменена, просрочена. Оплата разовой покупки (transaction.completed)
 * тоже приходит, но подписку она не описывает — там нет ни статуса, ни
 * конца периода, поэтому её пропускаем: всё нужное приедет событием
 * подписки.
 *
 * Клиента узнаём по custom_data.tenant_id — его кладём при открытии
 * оплаты. Полагаться на почту нельзя: человек может заплатить с другой.
 */
export function paddleUpdate(payload: unknown): PaddleUpdate | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const eventType = str(p['event_type']);
  const eventId = str(p['event_id']);
  if (!eventType || !eventId) return null;
  if (!eventType.startsWith('subscription.')) return null;

  const data = (p['data'] ?? {}) as Record<string, unknown>;
  const custom = (data['custom_data'] ?? {}) as Record<string, unknown>;
  const tenantId = str(custom['tenant_id']);
  if (!tenantId) return null;

  const period = (data['current_billing_period'] ?? {}) as Record<string, unknown>;
  const items = Array.isArray(data['items']) ? (data['items'] as Record<string, unknown>[]) : [];
  const first = items[0] ?? {};
  const price = (first['price'] ?? {}) as Record<string, unknown>;
  const status = str(data['status']);

  return {
    eventId,
    eventType,
    tenantId,
    subscriptionId: str(data['id']),
    customerId: str(data['customer_id']),
    priceId: str(price['id']),
    status,
    paidUntil: day(period['ends_at']),
    live: status ? PADDLE_LIVE.includes(status) : false,
  };
}

/**
 * Период оплаты.
 *
 * Год дешевле месяца ровно на два месяца: платишь за десять, работаешь
 * двенадцать. Правило записано одним числом, а не двумя ценами в
 * настройках, — иначе они однажды разойдутся, и годовая окажется
 * дороже двенадцати месячных.
 */
export type PaddlePeriod = 'month' | 'year';
export const PADDLE_PERIODS: PaddlePeriod[] = ['month', 'year'];
export const PLAN_YEAR_MONTHS = 10;

export function isPaddlePeriod(v: unknown): v is PaddlePeriod {
  return v === 'month' || v === 'year';
}

/** Цена за год из месячной: десять месяцев вместо двенадцати. */
export function yearPrice(monthly: number): number {
  return Math.round(monthly * PLAN_YEAR_MONTHS * 100) / 100;
}

/**
 * Что мы завели в Paddle под один тариф: товар и две цены.
 *
 * Товар запоминаем, чтобы вторая цена легла к тому же товару, а не
 * создала рядом второй с тем же названием.
 */
export interface PaddlePlanIds {
  product?: string;
  month?: string;
  year?: string;
}

export type PaddlePrices = Record<string, PaddlePlanIds>;

export function paddlePriceId(
  prices: PaddlePrices,
  plan: string,
  period: PaddlePeriod,
): string | null {
  return prices[plan]?.[period] ?? null;
}

/**
 * Тариф и период по идентификатору цены.
 *
 * Обратный поиск по карте, которую мы сами и записали, когда заводили
 * товары. Цена, которой в карте нет, — это товар, заведённый мимо нас;
 * тариф в таком случае не трогаем, чтобы чужая покупка не понизила
 * клиента до trial.
 */
export function paddlePlan(
  priceId: string | null,
  prices: PaddlePrices,
): { plan: string; period: PaddlePeriod } | null {
  if (!priceId) return null;
  for (const [plan, ids] of Object.entries(prices ?? {})) {
    for (const period of PADDLE_PERIODS) {
      if (ids?.[period] === priceId) return { plan, period };
    }
  }
  return null;
}

/** Товар и цена, которые заводим в Paddle под наш тариф. */
export interface PaddleProduct {
  name: string;
  description: string;
  /** Сумма в наименьших единицах: 1200 гривен — это 120000. */
  amount: string;
  currency: string;
}

/**
 * Цена тарифа для Paddle.
 *
 * Paddle берёт сумму строкой в наименьших единицах валюты и не любит
 * дробей. Наши цены в панели владельца записаны как «1200.00», поэтому
 * переводим через копейки и округляем: половина копейки в счёте не
 * стоит ни одного спора с клиентом.
 */
export function paddleAmount(price: unknown): string | null {
  const n = Number(String(price ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  return String(Math.round(n * 100));
}
