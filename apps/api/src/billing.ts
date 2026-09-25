/**
 * Оплата подписки клиентом самостоятельно.
 *
 * Разделение ролей здесь такое. Владелец платформы один раз заводит
 * товары в Paddle — из тех же цен, которые он и так задаёт в своей
 * панели. Клиент открывает окно оплаты и платит картой. Paddle шлёт
 * вебхук, и по нему меняется тариф и оплаченный срок.
 *
 * Чего здесь намеренно нет: списания, отмены и смены карты. Всё это
 * делает сам Paddle в своём кабинете, ссылку на который мы выдаём.
 * Повторять чужой интерфейс — значит расходиться с ним ровно тогда,
 * когда человеку нужно срочно поменять карту.
 */

import type { FastifyInstance } from 'fastify';
import {
  paddleApi,
  paddleAmount,
  paddlePlan,
  paddlePriceId,
  paddleSignatureOk,
  paddleUpdate,
  isPaddlePeriod,
  yearPrice,
  PADDLE_PERIODS,
  type PaddlePeriod,
  type PaddlePrices,
  withSystem,
  withTenant,
  type PaddleEnv,
  type Pool,
} from '@omnidesk/core';

export interface BillingDeps {
  pool: Pool;
  requireAuth: (req: unknown) => { tenantId: string; userId: string } | null;
  owner: (req: unknown) => Promise<{ email: string } | null> | { email: string } | null;
  env: PaddleEnv;
  /** Ключ к API Paddle. Без него нельзя ни завести товары, ни открыть кабинет. */
  apiKey: string;
  /** Секрет подписи вебхука. Без него вебхук не принимаем вовсе. */
  webhookSecret: string;
  /** Открытый токен для окна оплаты в браузере. */
  clientToken: string;
}

const auth401 = { error: 'unauthorized' };

/**
 * Тарифы, которые вообще можно купить картой.
 *
 * Один. trial раздаётся сам, custom считается руками и оплачивается
 * счётом, а start остался в списке тарифов как след прошлой линейки:
 * продавать его больше нельзя, но у тех, кто на нём сидит, он обязан
 * продолжать работать.
 */
const SELLABLE = ['pro'];

interface PlatformRow {
  plan_prices: Record<string, Record<string, number>> | null;
  paddle_prices: PaddlePrices | null;
}

async function platform(pool: Pool): Promise<PlatformRow> {
  return withSystem(pool, 'настройки платформы', async (db) => {
    const { rows } = await db.query<PlatformRow>(
      `SELECT plan_prices, paddle_prices FROM platform_settings WHERE id = 1`,
    );
    return rows[0] ?? { plan_prices: {}, paddle_prices: {} };
  });
}

async function paddleFetch(
  deps: BillingDeps,
  path: string,
  init: { method: string; body?: unknown },
): Promise<{ ok: true; data: unknown } | { ok: false; status: number; message: string }> {
  const res = await fetch(paddleApi(deps.env) + path, {
    method: init.method,
    headers: {
      authorization: `Bearer ${deps.apiKey}`,
      'content-type': 'application/json',
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    // Paddle кладёт причину в error.detail — она человеческая, и
    // показывать её полезнее, чем наш пересказ.
    const err = (parsed as { error?: { detail?: string; code?: string } } | null)?.error;
    return { ok: false, status: res.status, message: err?.detail ?? err?.code ?? text.slice(0, 300) };
  }
  return { ok: true, data: (parsed as { data?: unknown } | null)?.data ?? null };
}

export function registerBilling(app: FastifyInstance, deps: BillingDeps): void {
  const { pool, requireAuth } = deps;

  /**
   * Что показать клиенту на странице тарифа.
   *
   * Возвращаем и текущее состояние, и то, чем платить: цену, ключ
   * тарифа в Paddle и открытый токен. Без любого из трёх кнопка оплаты
   * не работает, и лучше узнать об этом здесь, чем в браузере.
   */
  app.get('/billing', async (req, reply) => {
    const a = requireAuth(req);
    if (!a) return reply.code(401).send(auth401);

    const p = await platform(pool);
    const prices = p.paddle_prices ?? {};
    const planPrices = p.plan_prices ?? {};

    const me = await withTenant(pool, a.tenantId, async (db) => {
      const { rows } = await db.query<{
        plan: string;
        paid_until: string | null;
        seats_limit: number;
        paddle_status: string | null;
        paddle_customer_id: string | null;
        paddle_subscription_id: string | null;
      }>(
        `SELECT plan, paid_until, seats_limit, paddle_status,
                paddle_customer_id, paddle_subscription_id
           FROM tenants WHERE id = $1`,
        [a.tenantId],
      );
      return rows[0] ?? null;
    });
    if (!me) return reply.code(404).send({ error: 'no_tenant' });

    return {
      plan: me.plan,
      paidUntil: me.paid_until,
      seatsLimit: me.seats_limit,
      status: me.paddle_status,
      subscribed: Boolean(me.paddle_subscription_id),
      // Кабинет Paddle открываем только тому, у кого там есть клиент.
      portal: Boolean(me.paddle_customer_id && deps.apiKey),
      env: deps.env,
      clientToken: deps.clientToken,
      plans: SELLABLE.map((plan) => {
        const month = planPrices[plan] ?? {};
        // Годовую цену не храним отдельно: она выводится из месячной по
        // одному правилу. Две цены в настройках однажды разошлись бы, и
        // год оказался бы дороже двенадцати месяцев.
        const year: Record<string, number> = {};
        for (const [cur, v] of Object.entries(month)) year[cur] = yearPrice(v);
        return {
          plan,
          month: { price: month, priceId: paddlePriceId(prices, plan, 'month') },
          year: { price: year, priceId: paddlePriceId(prices, plan, 'year') },
        };
      }),
    };
  });

  /**
   * Начать оплату.
   *
   * Сделку заводим на сервере, а браузеру отдаём только её номер.
   * Соблазн был открыть окно оплаты прямо из браузера, передав туда
   * цену и признак клиента, — так короче. Но тогда признак клиента
   * задаёт тот, кто сидит в браузере, и чужую подписку можно привязать
   * к чужой же организации. Здесь его ставим мы, и подменить его
   * снаружи нечем.
   */
  app.post<{ Body: { plan?: string; period?: string } }>('/billing/checkout', async (req, reply) => {
    const a = requireAuth(req);
    if (!a) return reply.code(401).send(auth401);
    if (!deps.apiKey) return reply.code(503).send({ error: 'paddle_not_configured' });

    const plan = String(req.body?.plan ?? '');
    if (!SELLABLE.includes(plan)) return reply.code(400).send({ error: 'bad_plan' });
    const period: PaddlePeriod = isPaddlePeriod(req.body?.period) ? req.body.period : 'year';

    const p = await platform(pool);
    const priceId = paddlePriceId(p.paddle_prices ?? {}, plan, period);
    if (!priceId) return reply.code(409).send({ error: 'no_price' });

    const customer = await withTenant(pool, a.tenantId, async (db) => {
      const { rows } = await db.query<{ paddle_customer_id: string | null }>(
        `SELECT paddle_customer_id FROM tenants WHERE id = $1`,
        [a.tenantId],
      );
      return rows[0]?.paddle_customer_id ?? null;
    });

    const made = await paddleFetch(deps, '/transactions', {
      method: 'POST',
      body: {
        items: [{ price_id: priceId, quantity: 1 }],
        custom_data: { tenant_id: a.tenantId },
        // Клиента передаём, если он уже есть: иначе Paddle заведёт
        // второго на ту же почту, и в его кабинете окажется половина
        // чеков.
        ...(customer ? { customer_id: customer } : {}),
      },
    });
    if (!made.ok) return reply.code(502).send({ error: 'paddle_failed', why: made.message });

    const id = (made.data as { id?: string } | null)?.id;
    if (!id) return reply.code(502).send({ error: 'paddle_failed', why: 'no_transaction_id' });
    return { transactionId: id, env: deps.env, clientToken: deps.clientToken };
  });

  /**
   * Ссылка в кабинет Paddle.
   *
   * Там человек меняет карту, смотрит чеки и отменяет подписку. Ссылка
   * одноразовая и живёт недолго, поэтому берём её в момент нажатия, а
   * не храним.
   */
  app.post('/billing/portal', async (req, reply) => {
    const a = requireAuth(req);
    if (!a) return reply.code(401).send(auth401);
    if (!deps.apiKey) return reply.code(503).send({ error: 'paddle_not_configured' });

    const customer = await withTenant(pool, a.tenantId, async (db) => {
      const { rows } = await db.query<{ paddle_customer_id: string | null }>(
        `SELECT paddle_customer_id FROM tenants WHERE id = $1`,
        [a.tenantId],
      );
      return rows[0]?.paddle_customer_id ?? null;
    });
    if (!customer) return reply.code(409).send({ error: 'no_customer' });

    const got = await paddleFetch(deps, `/customers/${customer}/portal-sessions`, { method: 'POST' });
    if (!got.ok) return reply.code(502).send({ error: 'paddle_failed', why: got.message });

    const urls = (got.data as { urls?: { general?: { overview?: string } } } | null)?.urls;
    const url = urls?.general?.overview ?? null;
    if (!url) return reply.code(502).send({ error: 'paddle_failed', why: 'no_url' });
    return { url };
  });

  /**
   * Завести товары в Paddle из цен, которые уже заданы в панели.
   *
   * Делается раз и владельцем платформы. Руками то же самое — это
   * десяток экранов в чужом кабинете и десяток мест, где можно
   * опечататься в цене; здесь цена берётся оттуда же, откуда её берёт
   * счёт, и разойтись им негде.
   */
  app.post('/owner/paddle/sync', async (req, reply) => {
    const who = await deps.owner(req);
    if (!who) return reply.code(403).send({ error: 'forbidden' });
    if (!deps.apiKey) return reply.code(503).send({ error: 'paddle_not_configured' });

    const p = await platform(pool);
    const planPrices = p.plan_prices ?? {};
    const have: PaddlePrices = { ...(p.paddle_prices ?? {}) };
    const done: Array<{ plan: string; period: PaddlePeriod; priceId: string }> = [];
    const failed: Array<{ plan: string; period?: PaddlePeriod; why: string }> = [];

    for (const plan of SELLABLE) {
      const ids = { ...(have[plan] ?? {}) };
      // Обе цены уже на месте — тариф пропускаем целиком.
      if (ids.month && ids.year) continue;

      const byCur = planPrices[plan] ?? {};
      // Валюту берём одну: Paddle сам показывает её в пересчёте тому,
      // кто платит из другой страны, а вторая цена на тот же тариф
      // означала бы два разных товара на одно и то же.
      const currency = byCur['USD'] !== undefined ? 'USD' : Object.keys(byCur)[0];
      const monthly = currency ? byCur[currency] : undefined;
      if (!currency || monthly === undefined || !paddleAmount(monthly)) {
        failed.push({ plan, why: 'no_price' });
        continue;
      }

      // Товар заводим один на тариф и запоминаем: вторая цена должна
      // лечь к нему же, а не создать рядом второй с тем же названием.
      if (!ids.product) {
        const product = await paddleFetch(deps, '/products', {
          method: 'POST',
          body: { name: `Rozmovio ${plan}`, tax_category: 'standard' },
        });
        if (!product.ok) {
          failed.push({ plan, why: product.message });
          continue;
        }
        const productId = (product.data as { id?: string } | null)?.id;
        if (!productId) {
          failed.push({ plan, why: 'no_product_id' });
          continue;
        }
        ids.product = productId;
      }

      for (const period of PADDLE_PERIODS) {
        if (ids[period]) continue;
        // Год — десять месяцев: два в подарок. Правило одно и здесь, и
        // на витрине, поэтому разойтись им негде.
        const amount = paddleAmount(period === 'year' ? yearPrice(monthly) : monthly);
        if (!amount) {
          failed.push({ plan, period, why: 'no_price' });
          continue;
        }
        const price = await paddleFetch(deps, '/prices', {
          method: 'POST',
          body: {
            product_id: ids.product,
            description: `Rozmovio ${plan}, ${period === 'year' ? 'рік' : 'місяць'}`,
            unit_price: { amount, currency_code: currency },
            billing_cycle: { interval: period, frequency: 1 },
          },
        });
        if (!price.ok) {
          failed.push({ plan, period, why: price.message });
          continue;
        }
        const priceId = (price.data as { id?: string } | null)?.id;
        if (!priceId) {
          failed.push({ plan, period, why: 'no_price_id' });
          continue;
        }
        ids[period] = priceId;
        done.push({ plan, period, priceId });
      }

      have[plan] = ids;
    }

    if (done.length) {
      await withSystem(pool, 'товары Paddle', async (db) => {
        await db.query(
          `UPDATE platform_settings SET paddle_prices = $1::jsonb, updated_at = now() WHERE id = 1`,
          [JSON.stringify(have)],
        );
      });
    }
    return { prices: have, done, failed };
  });

  /**
   * Вебхук Paddle.
   *
   * Три правила, и каждое из них однажды кого-нибудь подводило.
   *
   * Подпись считается от сырого тела, до разбора JSON: любая
   * пересериализация меняет байты. Поэтому ниже берётся rawBody, а не
   * req.body.
   *
   * Повторы. Paddle доставляет, пока не получит 200, и повторяет при
   * своих сбоях. Событие, которое мы уже применили, пропускаем — иначе
   * «подписка отменена» однажды приедет вторым заходом поверх новой
   * оплаты.
   *
   * Отвечаем 200 и на то, что не поняли. Иначе Paddle будет ломиться с
   * этим событием сутки, а событий, которых мы не разбираем, у него
   * десятки.
   */
  app.post('/webhooks/paddle', async (req, reply) => {
    if (!deps.webhookSecret) return reply.code(503).send({ error: 'paddle_not_configured' });

    const raw = (req as { rawBody?: Buffer }).rawBody;
    if (!raw) return reply.code(400).send({ error: 'no_raw_body' });

    const header = (req.headers as Record<string, string | undefined>)['paddle-signature'];
    const sig = paddleSignatureOk(header, raw, deps.webhookSecret);
    if (!sig.ok) {
      req.log.warn({ why: sig.reason }, 'Вебхук Paddle не прошёл проверку подписи');
      return reply.code(401).send({ error: 'bad_signature' });
    }

    const update = paddleUpdate(req.body);
    if (!update) return { ok: true, skipped: 'not_subscription' };

    const p = await platform(pool);
    const found = paddlePlan(update.priceId, p.paddle_prices ?? {});
    const plan = found?.plan ?? null;

    const applied = await withSystem(pool, 'подписка Paddle', async (db) => {
      const seen = await db.query(
        `INSERT INTO paddle_events (id, event_type, tenant_id) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO NOTHING RETURNING id`,
        [update.eventId, update.eventType, update.tenantId],
      );
      if (!seen.rows.length) return 'repeat';

      // Тариф меняем только по известной цене: цена, заведённая мимо
      // нас, не должна понизить клиента до trial.
      const sets = [
        `paddle_subscription_id = $2`,
        `paddle_customer_id = COALESCE($3, paddle_customer_id)`,
        `paddle_status = $4`,
      ];
      const vals: unknown[] = [update.tenantId, update.subscriptionId, update.customerId, update.status];
      if (update.paidUntil) {
        vals.push(update.paidUntil);
        sets.push(`paid_until = $${vals.length}::date`);
      }
      if (plan && update.live) {
        vals.push(plan);
        sets.push(`plan = $${vals.length}`);
      }
      const done = await db.query(
        `UPDATE tenants SET ${sets.join(', ')} WHERE id = $1 RETURNING id`,
        vals,
      );
      return done.rows.length ? 'applied' : 'no_tenant';
    });

    req.log.info(
      { event: update.eventType, tenant: update.tenantId, status: update.status, plan, applied },
      'Событие подписки Paddle',
    );
    return { ok: true, applied };
  });
}
