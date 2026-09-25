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
import { makeRateFor } from './rate.js';
import {
  paddleApi,
  paddleAmount,
  paddlePlan,
  paddlePriceId,
  paddleSignatureOk,
  paddlePayment,
  paddleSubscription,
  paddleUpdate,
  isPaddlePeriod,
  isPerSeatPlan,
  invoiceNumber,
  isoDay,
  keyShape,
  moneyWords,
  paddleCurrency,
  seatDeal,
  tenantMoney,
  yearPrice,
  PADDLE_PERIODS,
  PER_SEAT_PLANS,
  type PaddlePeriod,
  type PaddlePrices,
  toUah,
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
  /**
   * Оповестить нас о том, что клиент сказал «оплатил».
   *
   * Отдельной зависимостью, а не прямым вызовом очереди: счета — про
   * деньги, оповещения — про телеграм, и связывать их напрямую значит
   * тащить одно в тесты другого.
   */
  announcePaid: (info: {
    tenantId: string;
    who: string;
    number: string;
    amount: string;
    currency: string;
  }) => Promise<void>;
  /**
   * Страница оплаты на одобренном Paddle домене.
   *
   * Пустая строка означает «открывать окно прямо в кабинете» — так
   * было до того, как выяснилось, что субдомен кабинета Paddle
   * одобряет отдельно от витрины и может не одобрить вовсе.
   */
  payUrl: string;
}

const auth401 = { error: 'unauthorized' };

/**
 * Сколько дней ждём денег по счёту.
 *
 * Три дня — не срок перевода, а срок терпения: банковский платёж внутри
 * страны идёт день, и если через три дня денег нет, значит их и не
 * отправляли. Дальше просим квитанцию, а не отключаем молча: у человека
 * может быть и платёжка, и болезнь бухгалтера.
 */
export const INVOICE_DUE_DAYS = 3;

/** Тот же вид, что и у идентификаторов в базе: иначе withTenant упадёт. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Тариф, который предлагаем купить.
 *
 * Показывать всем один pro было ошибкой: организация на корпоративном
 * видела у себя чужую цену и кнопку, которая перевела бы её на тариф
 * дешевле собственного. Тариф для оплаты выводится из того, на чём
 * клиент сидит, а не задан списком.
 *
 * trial и start покупают pro: первый раздаётся сам, второй остался
 * следом прошлой линейки — продавать его нельзя, но у тех, кто на нём
 * сидит, он обязан работать. Корпоративный покупает сам себя, по числу
 * людей.
 */
const DEFAULT_PLAN = 'pro';

function sellPlan(plan: string): string {
  return isPerSeatPlan(plan) ? plan : DEFAULT_PLAN;
}

/** Тарифы, которые заводим в Paddle: оба продаются картой. */
const SYNC_PLANS = [DEFAULT_PLAN, ...PER_SEAT_PLANS];

/**
 * Цена тарифа в той валюте, в которой он заведён в Paddle.
 *
 * Сверять цену клиента с прайсом надо по той же валюте, по которой
 * заводился товар, иначе сверка ответит «не совпало» там, где всё
 * совпало, — просто в разных деньгах.
 */
function seatListed(prices: Record<string, Record<string, number>>, plan: string): number {
  const byCur = prices[plan] ?? {};
  const cur = paddleCurrency(byCur);
  return cur ? Number(byCur[cur]) || 0 : 0;
}

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
  log: { warn: (o: unknown, m: string) => void },
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
    const message = err?.detail ?? err?.code ?? text.slice(0, 300);
    // В журнал — обязательно. Без этого отказ виден только тому, кто
    // сидит перед экраном, и разбирать его приходится по скриншоту.
    log.warn({ path, status: res.status, code: err?.code, detail: message }, 'Paddle отказал');
    return { ok: false, status: res.status, message };
  }
  return { ok: true, data: (parsed as { data?: unknown } | null)?.data ?? null };
}

export function registerBilling(app: FastifyInstance, deps: BillingDeps): void {
  const { pool, requireAuth } = deps;
  const rateFor = makeRateFor(pool);

  /**
   * Забыть привязку к Paddle, которой в этом кабинете нет.
   *
   * Переезд из песочницы в боевой Paddle — это другой кабинет: клиент,
   * подписка и сделка остаются в старом, а у нас в базе лежат их
   * идентификаторы. С ними оплата отвечала бы «клиента не найдено»
   * ровно в тот момент, когда человек решил заплатить, и понять
   * причину по этому ответу было бы нельзя.
   *
   * Стираем только на прямой ответ «нет такого». Сетевая беда или
   * отказ по правам — не повод забывать оплату клиента.
   */
  async function forgetPaddle(tenantId: string, why: string, log: { warn: (o: unknown, m: string) => void }) {
    await withTenant(pool, tenantId, async (db) => {
      await db.query(
        `UPDATE tenants SET paddle_customer_id = NULL, paddle_subscription_id = NULL,
                            paddle_status = NULL, paddle_txn = NULL
          WHERE id = $1`,
        [tenantId],
      );
    });
    log.warn({ tenantId, why }, 'Привязка к Paddle из другого кабинета — забыли её');
  }

  /** Клиент Paddle, если он есть в том кабинете, с которым мы работаем. */
  async function customerNow(
    tenantId: string,
    id: string | null,
    log: { warn: (o: unknown, m: string) => void },
  ): Promise<string | null> {
    if (!id) return null;
    const got = await paddleFetch(deps, log, `/customers/${id}`, { method: 'GET' });
    if (got.ok) return id;
    if (got.status !== 404) return id;
    await forgetPaddle(tenantId, 'customer_not_found', log);
    return null;
  }

  /** Организация в том виде, в каком её касается оплата. */
  async function tenantNow(tenantId: string): Promise<{
    plan: string;
    paid_until: string | null;
    seats_limit: number;
    seats_free: number;
    seat_price: string | null;
    currency: string;
    paddle_status: string | null;
    paddle_customer_id: string | null;
    paddle_subscription_id: string | null;
  } | null> {
    return withTenant(pool, tenantId, async (db) => {
      const { rows } = await db.query<{
        plan: string;
        paid_until: string | null;
        seats_limit: number;
        seats_free: number;
        seat_price: string | null;
        currency: string;
        paddle_status: string | null;
        paddle_customer_id: string | null;
        paddle_subscription_id: string | null;
      }>(
        `SELECT plan, paid_until, seats_limit, seats_free, seat_price, currency, paddle_status,
                paddle_customer_id, paddle_subscription_id
           FROM tenants WHERE id = $1`,
        [tenantId],
      );
      return rows[0] ?? null;
    });
  }

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

    const me = await tenantNow(a.tenantId);
    if (!me) return reply.code(404).send({ error: 'no_tenant' });

    const plan = sellPlan(me.plan);
    const perSeat = isPerSeatPlan(plan);
    const seats = Math.max(1, Number(me.seats_limit ?? 1));
    // Цену за человека сверяем с прайсом, а не проверяем на пустоту.
    // Вписанная руками, но совпадающая с прайсом — это та же цена, и
    // в Paddle она заведена: платить картой можно. Другая — отдельная
    // договорённость, продать по ней нечем, и клиент платит счётом.
    const own = Number(String(me.seat_price ?? '0').replace(',', '.')) || 0;
    const deal = seatDeal(own, seatListed(planPrices, plan));
    const individual = perSeat && deal.individual;

    // Цена за месяц. Для тарифа по головам это цена человека, умноженная
    // на число людей: пятнадцать по шесть — девяносто, и складывать это
    // руками не должен никто.
    const month: Record<string, number> = {};
    for (const [cur, v] of Object.entries(planPrices[plan] ?? {})) {
      month[cur] = perSeat
        ? tenantMoney(
            { plan, seatsLimit: seats, currency: cur, seatPrice: own > 0 ? own : null },
            planPrices,
          ).monthTotal
        : Number(v);
    }
    // Годовую цену не храним отдельно: она выводится из месячной по
    // одному правилу. Две цены в настройках однажды разошлись бы, и
    // год оказался бы дороже двенадцати месяцев.
    const year: Record<string, number> = {};
    for (const [cur, v] of Object.entries(month)) year[cur] = yearPrice(v);

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
      perSeat,
      seats,
      individual,
      plans: [
        {
          plan,
          perSeat,
          seats,
          month: {
            price: month,
            priceId: individual ? null : paddlePriceId(prices, plan, 'month'),
          },
          year: {
            price: year,
            priceId: individual ? null : paddlePriceId(prices, plan, 'year'),
          },
        },
      ],
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

    const me = await tenantNow(a.tenantId);
    if (!me) return reply.code(404).send({ error: 'no_tenant' });

    // Тариф берём не из тела запроса, а из организации: иначе тариф
    // выбирает тот, кто сидит в браузере, и корпоративный клиент купит
    // себе pro за пятьдесят.
    const plan = sellPlan(me.plan);
    if (String(req.body?.plan ?? plan) !== plan) {
      return reply.code(400).send({ error: 'bad_plan' });
    }
    const period: PaddlePeriod = isPaddlePeriod(req.body?.period) ? req.body.period : 'year';

    const p = await platform(pool);

    // Индивидуальная цена за человека в Paddle не заведена, и продать
    // по ней нечем: такой клиент платит счётом.
    const own = Number(String(me.seat_price ?? '0').replace(',', '.')) || 0;
    if (isPerSeatPlan(plan) && seatDeal(own, seatListed(p.plan_prices ?? {}, plan)).individual) {
      return reply.code(409).send({ error: 'individual_plan' });
    }

    const priceId = paddlePriceId(p.paddle_prices ?? {}, plan, period);
    if (!priceId) return reply.code(409).send({ error: 'no_price' });

    const customer = await customerNow(a.tenantId, me.paddle_customer_id, req.log);
    // За человека — столько единиц, сколько людей в тарифе. Paddle сам
    // умножит цену на количество, и сумма в окне оплаты совпадёт с той,
    // что клиент видел на странице.
    const quantity = isPerSeatPlan(plan) ? Math.max(1, Number(me.seats_limit ?? 1)) : 1;

    const made = await paddleFetch(deps, req.log, '/transactions', {
      method: 'POST',
      body: {
        items: [{ price_id: priceId, quantity }],
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

    // Номер сделки запоминаем: по нему можно узнать подписку, даже если
    // вебхук не дойдёт. Оплата — не то место, где допустимо зависеть от
    // одного канала связи.
    await withTenant(pool, a.tenantId, async (db) => {
      await db.query(`UPDATE tenants SET paddle_txn = $2 WHERE id = $1`, [a.tenantId, id]);
    });

    return {
      transactionId: id,
      env: deps.env,
      clientToken: deps.clientToken,
      // Кабинет решает не сам: домен, с которого можно продавать,
      // знает только сервер.
      payUrl: deps.payUrl ? `${deps.payUrl}?_ptxn=${encodeURIComponent(id)}` : '',
    };
  });

  /**
   * Оплаты клиента.
   *
   * Берём у Paddle, а не храним у себя. Своя копия списка оплат
   * означала бы, что она однажды разойдётся с настоящей — после
   * возврата, частичного возврата или спора с банком, — и человек
   * увидит у нас одно, а в выписке другое. Источник правды здесь не
   * наш, и делать вид, что наш, нечестно.
   */
  app.get('/billing/payments', async (req, reply) => {
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
    // Ни одной оплаты не было — это не ошибка, а пустой список.
    if (!customer) return { payments: [] };

    const got = await paddleFetch(
      deps,
      req.log,
      `/transactions?customer_id=${encodeURIComponent(customer)}&status=completed,billed,past_due&per_page=50`,
      { method: 'GET' },
    );
    if (!got.ok) {
      // Клиента из другого кабинета Paddle не знает. Это не поломка, а
      // пустой список: оплат в этом кабинете действительно не было.
      if (got.status === 404 || got.status === 400) {
        await forgetPaddle(a.tenantId, 'transactions_' + got.status, req.log);
        return { payments: [] };
      }
      return reply.code(502).send({ error: 'paddle_failed', why: got.message });
    }

    const rows = Array.isArray(got.data) ? (got.data as Record<string, unknown>[]) : [];
    return { payments: rows.map(paddlePayment) };
  });

  /**
   * Чек за оплату.
   *
   * Ссылку берём в момент нажатия и не храним: Paddle выдаёт её
   * подписанной и ненадолго. Сохранённая ссылка — это ссылка, которая
   * перестанет работать ровно тогда, когда чек понадобится.
   */
  app.get<{ Params: { id: string } }>('/billing/payments/:id/invoice', async (req, reply) => {
    const a = requireAuth(req);
    if (!a) return reply.code(401).send(auth401);
    if (!deps.apiKey) return reply.code(503).send({ error: 'paddle_not_configured' });

    const id = String(req.params?.id ?? '');
    if (!/^txn_[a-z0-9]+$/i.test(id)) return reply.code(400).send({ error: 'bad_id' });

    // Чужую сделку по чужому номеру не отдаём: сверяем клиента.
    const customer = await withTenant(pool, a.tenantId, async (db) => {
      const { rows } = await db.query<{ paddle_customer_id: string | null }>(
        `SELECT paddle_customer_id FROM tenants WHERE id = $1`,
        [a.tenantId],
      );
      return rows[0]?.paddle_customer_id ?? null;
    });
    if (!customer) return reply.code(409).send({ error: 'no_customer' });

    const txn = await paddleFetch(deps, req.log, `/transactions/${id}`, { method: 'GET' });
    if (!txn.ok) return reply.code(502).send({ error: 'paddle_failed', why: txn.message });
    if ((txn.data as { customer_id?: string } | null)?.customer_id !== customer) {
      return reply.code(403).send({ error: 'not_yours' });
    }

    const inv = await paddleFetch(deps, req.log, `/transactions/${id}/invoice`, { method: 'GET' });
    if (!inv.ok) return reply.code(502).send({ error: 'paddle_failed', why: inv.message });
    const url = (inv.data as { url?: string } | null)?.url ?? null;
    if (!url) return reply.code(502).send({ error: 'paddle_failed', why: 'no_invoice_url' });
    return { url };
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

    const stored = await withTenant(pool, a.tenantId, async (db) => {
      const { rows } = await db.query<{ paddle_customer_id: string | null }>(
        `SELECT paddle_customer_id FROM tenants WHERE id = $1`,
        [a.tenantId],
      );
      return rows[0]?.paddle_customer_id ?? null;
    });
    const customer = await customerNow(a.tenantId, stored, req.log);
    if (!customer) return reply.code(409).send({ error: 'no_customer' });

    const got = await paddleFetch(deps, req.log, `/customers/${customer}/portal-sessions`, { method: 'POST' });
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

    for (const plan of SYNC_PLANS) {
      const ids = { ...(have[plan] ?? {}) };

      // Запомненное проверяем, а не принимаем на веру. Переезд из
      // песочницы в боевой Paddle — это другой кабинет с другими
      // товарами, а идентификаторы у нас остались прежние: без
      // проверки кнопка отвечала бы «всё уже заведено», и клиент
      // упирался бы в цену, которой в этом Paddle нет.
      for (const key of ['product', 'month', 'year'] as const) {
        const id = ids[key];
        if (!id) continue;
        const path = key === 'product' ? `/products/${id}` : `/prices/${id}`;
        const found = await paddleFetch(deps, req.log, path, { method: 'GET' });
        if (!found.ok && found.status === 404) delete ids[key];
      }

      // Обе цены уже на месте — тариф пропускаем целиком.
      if (ids.month && ids.year) {
        have[plan] = ids;
        continue;
      }

      const byCur = planPrices[plan] ?? {};
      const currency = paddleCurrency(byCur);
      const monthly = currency ? byCur[currency] : undefined;
      if (!currency || monthly === undefined || !paddleAmount(monthly)) {
        failed.push({ plan, why: 'no_price' });
        continue;
      }

      // Товар заводим один на тариф и запоминаем: вторая цена должна
      // лечь к нему же, а не создать рядом второй с тем же названием.
      if (!ids.product) {
        const product = await paddleFetch(deps, req.log, '/products', {
          method: 'POST',
          body: {
            name: `Rozmovio ${plan}`,
            ...(isPerSeatPlan(plan)
              ? { description: 'Ціна за одного користувача на місяць' }
              : {}),
            tax_category: 'standard',
          },
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
        const price = await paddleFetch(deps, req.log, '/prices', {
          method: 'POST',
          body: {
            product_id: ids.product,
            description: `Rozmovio ${plan}, ${period === 'year' ? 'рік' : 'місяць'}` +
              (isPerSeatPlan(plan) ? ', за користувача' : ''),
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

    // Записываем и тогда, когда только вычеркнули чужое: иначе
    // идентификаторы из песочницы остались бы в настройках и следующая
    // проверка снова ходила бы за ними в Paddle.
    if (done.length || JSON.stringify(have) !== JSON.stringify(p.paddle_prices ?? {})) {
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
   * Применить состояние подписки к клиенту.
   *
   * Одна функция на два пути: вебхук и запрос состояния у Paddle. Два
   * разных куска кода, делающих одно и то же, — это две разные правды
   * о том, какой у клиента тариф, и расходиться они начинают в тот
   * день, когда правят один из них.
   *
   * eventId пустой означает «мы сами спросили»: отметки о событии в
   * этом случае нет, повторять нечего.
   */
  async function applyState(
    tenantId: string,
    st: {
      eventId?: string;
      eventType?: string;
      subscriptionId: string | null;
      customerId: string | null;
      priceId: string | null;
      status: string | null;
      paidUntil: string | null;
      live: boolean;
    },
  ): Promise<{ applied: string; plan: string | null }> {
    if (!UUID_RE.test(tenantId)) return { applied: 'bad_tenant', plan: null };

    const p = await platform(pool);
    const found = paddlePlan(st.priceId, p.paddle_prices ?? {});
    const plan = found?.plan ?? null;

    const applied = await withTenant(pool, tenantId, async (db) => {
      if (st.eventId) {
        const seen = await db.query(
          `INSERT INTO paddle_events (id, event_type, tenant_id) VALUES ($1, $2, $3)
           ON CONFLICT (id) DO NOTHING RETURNING id`,
          [st.eventId, st.eventType ?? '', tenantId],
        );
        if (!seen.rows.length) return 'repeat';
      }

      // Тариф меняем только по известной цене: цена, заведённая мимо
      // нас, не должна понизить клиента до trial.
      const sets = [
        `paddle_subscription_id = COALESCE($2, paddle_subscription_id)`,
        `paddle_customer_id = COALESCE($3, paddle_customer_id)`,
        `paddle_status = COALESCE($4, paddle_status)`,
      ];
      const vals: unknown[] = [tenantId, st.subscriptionId, st.customerId, st.status];
      if (st.paidUntil) {
        vals.push(st.paidUntil);
        sets.push(`paid_until = $${vals.length}::date`);
      }
      if (plan && st.live) {
        vals.push(plan);
        sets.push(`plan = $${vals.length}`);
      }
      const done = await db.query(
        `UPDATE tenants SET ${sets.join(', ')} WHERE id = $1 RETURNING id`,
        vals,
      );
      return done.rows.length ? 'applied' : 'no_tenant';
    });

    return { applied, plan };
  }

  /**
   * Спросить Paddle, что там с подпиской.
   *
   * Вебхук быстрее, но зависеть только от него нельзя: он теряется,
   * настраивается отдельно от всего остального и до первой настоящей
   * оплаты его никто не проверял. Поэтому есть и второй путь — спросить
   * прямо. Он медленнее на один запрос и всегда говорит правду.
   *
   * Подписку знаем не сразу: до первого вебхука её идентификатора у нас
   * нет. Зато есть номер сделки, которую мы сами и завели, — по нему
   * Paddle называет и клиента, и подписку.
   */
  app.post('/billing/refresh', async (req, reply) => {
    const a = requireAuth(req);
    if (!a) return reply.code(401).send(auth401);
    if (!deps.apiKey) return reply.code(503).send({ error: 'paddle_not_configured' });

    const me = await withTenant(pool, a.tenantId, async (db) => {
      const { rows } = await db.query<{
        paddle_subscription_id: string | null;
        paddle_txn: string | null;
      }>(
        `SELECT paddle_subscription_id, paddle_txn FROM tenants WHERE id = $1`,
        [a.tenantId],
      );
      return rows[0] ?? null;
    });

    let subId = me?.paddle_subscription_id ?? null;
    let customerId: string | null = null;

    /*
     * Ни подписки, ни сделки — значит человек заплатил раньше, чем мы
     * научились запоминать номер. Спрашивать вроде бы не о чем, но
     * подписка-то есть: она у Paddle, на почту того, кто платил.
     *
     * Поэтому ищем по почтам людей этой организации. Чужую подписку так
     * не подхватить: берём только ту, в которой стоит наш же
     * идентификатор организации, либо, если его нет, — ту, что куплена
     * по нашей цене.
     */
    if (!subId && !me?.paddle_txn) {
      const emails = await withTenant(pool, a.tenantId, async (db) => {
        const { rows } = await db.query<{ email: string }>(
          `SELECT email FROM users
            WHERE tenant_id = $1 AND is_active AND role IN ('owner','admin')
            ORDER BY role, created_at LIMIT 5`,
          [a.tenantId],
        );
        return rows.map((r) => r.email);
      });

      for (const email of emails) {
        const found = await paddleFetch(
          deps, req.log, `/customers?email=${encodeURIComponent(email)}`, { method: 'GET' },
        );
        if (!found.ok) continue;
        const list = Array.isArray(found.data) ? (found.data as Record<string, unknown>[]) : [];
        const cid = typeof list[0]?.['id'] === 'string' ? (list[0]['id'] as string) : null;
        if (!cid) continue;

        const subs = await paddleFetch(
          deps, req.log,
          `/subscriptions?customer_id=${encodeURIComponent(cid)}&status=active,trialing,past_due`,
          { method: 'GET' },
        );
        if (!subs.ok) continue;
        const rows = Array.isArray(subs.data) ? (subs.data as Record<string, unknown>[]) : [];

        const p = await platform(pool);
        const prices = p.paddle_prices ?? {};
        const mine = rows.find((r) => {
          const custom = (r['custom_data'] ?? {}) as Record<string, unknown>;
          if (custom['tenant_id'] === a.tenantId) return true;
          const parsed = paddleSubscription(r);
          return Boolean(parsed && paddlePlan(parsed.priceId, prices));
        });
        if (mine && typeof mine['id'] === 'string') {
          subId = mine['id'] as string;
          customerId = cid;
          req.log.info({ tenant: a.tenantId, email, sub: subId }, 'Подписка Paddle найдена по почте');
          break;
        }
      }
    }

    if (!subId && me?.paddle_txn) {
      const txn = await paddleFetch(deps, req.log, `/transactions/${me.paddle_txn}`, { method: 'GET' });
      if (!txn.ok) return reply.code(502).send({ error: 'paddle_failed', why: txn.message });
      const d = txn.data as { subscription_id?: string; customer_id?: string } | null;
      subId = d?.subscription_id ?? null;
      customerId = d?.customer_id ?? null;
      // Оплата прошла, а подписки нет — так бывает у разовой покупки.
      // Клиента всё равно запоминаем: по нему открывается кабинет.
      if (!subId) {
        await applyState(a.tenantId, {
          subscriptionId: null, customerId, priceId: null,
          status: null, paidUntil: null, live: false,
        });
        return { ok: true, applied: 'no_subscription' };
      }
    }
    if (!subId) return { ok: true, applied: 'nothing_to_ask' };

    const sub = await paddleFetch(deps, req.log, `/subscriptions/${subId}`, { method: 'GET' });
    if (!sub.ok) return reply.code(502).send({ error: 'paddle_failed', why: sub.message });

    const got = paddleSubscription(sub.data);
    if (!got) return reply.code(502).send({ error: 'paddle_failed', why: 'bad_subscription' });

    const done = await applyState(a.tenantId, {
      subscriptionId: subId,
      customerId: got.customerId ?? customerId,
      priceId: got.priceId,
      status: got.status,
      paidUntil: got.paidUntil,
      live: got.live,
    });
    req.log.info(
      { tenant: a.tenantId, sub: subId, status: got.status, plan: done.plan, applied: done.applied },
      'Состояние подписки забрано у Paddle',
    );
    return { ok: true, applied: done.applied, status: got.status };
  });

  /* ══════════════ Счёт по безналу ══════════════ */

  /**
   * Реквизиты продавца: они одни на все счета.
   *
   * Лежат в настройках платформы, потому что это наши реквизиты, а не
   * клиентские. Клиенту их показываем целиком — он по ним платит.
   */
  async function sellerSide(): Promise<Record<string, unknown>> {
    return withSystem(pool, 'реквизиты продавца', async (db) => {
      const { rows } = await db.query(
        `SELECT seller_name, seller_tax_id, seller_iban, seller_bank, seller_bank_code,
                seller_address, seller_phone, seller_signer, seller_note
           FROM platform_settings WHERE id = 1`,
      );
      return (rows[0] ?? {}) as Record<string, unknown>;
    });
  }

  /** Реквизиты покупателя: их вписывает сама организация. */
  async function buyerSide(tenantId: string): Promise<Record<string, unknown>> {
    return withTenant(pool, tenantId, async (db) => {
      const { rows } = await db.query(
        `SELECT name, legal_name, tax_id, vat_id, legal_address, bank_name, iban,
                bank_code, vat_payer, signer
           FROM tenants WHERE id = $1`,
        [tenantId],
      );
      return (rows[0] ?? {}) as Record<string, unknown>;
    });
  }

  /**
   * Счета организации: список, реквизиты обеих сторон и правило трёх дней.
   *
   * Всё одним ответом, потому что печатать счёт без реквизитов нельзя,
   * а спрашивать их тремя запросами — значит однажды напечатать счёт,
   * у которого одна половина пришла, а вторая нет.
   */
  app.get('/billing/invoices', async (req, reply) => {
    const a = requireAuth(req);
    if (!a) return reply.code(401).send(auth401);

    const invoices = await withTenant(pool, a.tenantId, async (db) => {
      const { rows } = await db.query(
        `SELECT id, number, issued_on, due_on, amount, currency, rate, rate_day,
                amount_uah, period_start, period_end, subject, status, paid_at,
                claimed_at, created_at
           FROM platform_invoices
          WHERE status <> 'void'
          ORDER BY issued_on DESC, created_at DESC LIMIT 24`,
      );
      return rows;
    });

    return {
      // Сумма прописью считается здесь: словарь числительных живёт в
      // ядре, и второй его копии в браузере быть не должно.
      invoices: invoices.map((r) => {
        const row = r as Record<string, unknown>;
        const uah = String(row['currency'] ?? 'UAH') !== 'UAH';
        return { ...row, words: moneyWords(String(uah ? row['amount_uah'] : row['amount']), 'UAH') };
      }),
      seller: await sellerSide(),
      buyer: await buyerSide(a.tenantId),
      dueDays: INVOICE_DUE_DAYS,
    };
  });

  /**
   * Выставить счёт самому себе.
   *
   * Раньше счёт мог выставить только владелец платформы, и путь клиента
   * выглядел так: написать в поддержку, дождаться ответа, получить
   * счёт письмом. Между «решил заплатить» и «смог заплатить» стоял
   * человек, а человек спит и болеет.
   *
   * Цена берётся оттуда же, откуда её берёт карта, — из тарифа
   * организации. Вписать свою сумму клиент не может: счёт, который
   * выставляет сам себе покупатель, называется как угодно, только не
   * счётом.
   */
  app.post<{ Body: { period?: string } }>('/billing/invoice', async (req, reply) => {
    const a = requireAuth(req);
    if (!a) return reply.code(401).send(auth401);

    const me = await tenantNow(a.tenantId);
    if (!me) return reply.code(404).send({ error: 'no_tenant' });

    const period: PaddlePeriod = isPaddlePeriod(req.body?.period) ? req.body.period : 'year';
    const plan = sellPlan(me.plan);
    const p = await platform(pool);
    const planPrices = p.plan_prices ?? {};
    const currency = String(me.currency || 'UAH').toUpperCase();

    // Сумма — цена тарифа за выбранный период, по тем же правилам, что
    // и на кнопке оплаты картой. Два способа посчитать одну цену — это
    // два разных счёта за один и тот же месяц.
    const month = tenantMoney(
      {
        plan,
        seatsLimit: Math.max(1, Number(me.seats_limit ?? 1)),
        currency,
        priceMonth: planPrices[plan]?.[currency],
        seatsFree: me.seats_free,
        seatPrice: me.seat_price,
      },
      planPrices,
    ).monthTotal;
    const amount = period === 'year' ? yearPrice(month) : month;
    if (!(amount > 0)) return reply.code(409).send({ error: 'no_price' });

    const today = isoDay(new Date());
    const got = await rateFor(currency, today);
    if (!got) return reply.code(502).send({ error: 'no_rate', day: today });

    const number = await withSystem(pool, 'номер счёта', async (db) => {
      const { rows } = await db.query<{ invoice_seq: number; invoice_prefix: string }>(
        `UPDATE platform_settings SET invoice_seq = invoice_seq + 1 WHERE id = 1
         RETURNING invoice_seq, invoice_prefix`,
      );
      const r = rows[0];
      return invoiceNumber(r?.invoice_seq ?? 1, Number(today.slice(0, 4)), r?.invoice_prefix ?? '');
    });

    const subject = `Послуги Rozmovio, тариф ${plan}, ${period === 'year' ? 'рік' : 'місяць'}`;
    const id = await withTenant(pool, a.tenantId, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO platform_invoices
           (tenant_id, number, issued_on, due_on, amount, currency, rate, rate_day, rate_source,
            amount_uah, period_start, period_end, subject, created_by)
         VALUES ($1, $2, $3::date, $3::date + $4::int, $5, $6, $7, $8::date, 'nbu', $9,
                 $3::date, $3::date + $10::interval, $11, $12)
         RETURNING id`,
        [
          a.tenantId,
          number,
          today,
          INVOICE_DUE_DAYS,
          amount,
          currency,
          got.rate,
          got.day,
          toUah(amount, got.rate),
          period === 'year' ? '1 year' : '1 month',
          subject,
          'клієнт',
        ],
      );
      return rows[0]!.id;
    });

    req.log.info({ tenantId: a.tenantId, number, amount, currency }, 'Клиент выставил себе счёт');
    return reply.code(201).send({ id, number, amount, currency, amountUah: toUah(amount, got.rate) });
  });

  /**
   * «Оплату здійснено».
   *
   * Это не оплата, и отмечать счёт оплаченным нельзя: деньги приходят
   * на счёт и сверяются с выпиской. Но между «заплатил» и «увидели»
   * проходит день-другой, и всё это время человек не знает, дошло ли.
   * Кнопка закрывает разрыв с обеих сторон: клиент видит, что нажатие
   * принято, мы получаем оповещение туда, куда смотрим.
   */
  app.post<{ Params: { id: string } }>('/billing/invoices/:id/paid', async (req, reply) => {
    const a = requireAuth(req);
    if (!a) return reply.code(401).send(auth401);
    if (!UUID_RE.test(String(req.params?.id ?? ''))) {
      return reply.code(400).send({ error: 'bad_id' });
    }

    const inv = await withTenant(pool, a.tenantId, async (db) => {
      const { rows } = await db.query<{ number: string; amount: string; currency: string }>(
        `UPDATE platform_invoices SET claimed_at = coalesce(claimed_at, now())
          WHERE id = $1 AND status = 'issued'
        RETURNING number, amount, currency`,
        [req.params.id],
      );
      return rows[0] ?? null;
    });
    if (!inv) return reply.code(404).send({ error: 'not_found' });

    const who = await withTenant(pool, a.tenantId, async (db) => {
      const { rows } = await db.query<{ name: string }>(`SELECT name FROM tenants WHERE id = $1`, [
        a.tenantId,
      ]);
      return rows[0]?.name ?? '';
    });

    // Оповещение не должно ронять ответ: клиент своё сделал, и сказать
    // ему «не получилось» из-за нашей очереди было бы враньём.
    await deps
      .announcePaid({
        tenantId: a.tenantId,
        who,
        number: inv.number,
        amount: inv.amount,
        currency: inv.currency,
      })
      .catch((err: unknown) => req.log.warn({ err }, 'Оповещение об оплате не поставлено'));

    return { ok: true };
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
      // Форма ключа, а не сам ключ: по ней видно, тот ли секрет вписан
      // — от этого ли destination, целиком ли скопирован, не приехал ли
      // вместе с переводом строки.
      req.log.warn(
        { why: sig.reason, secret: keyShape(deps.webhookSecret) },
        'Вебхук Paddle не прошёл проверку подписи',
      );
      return reply.code(401).send({ error: 'bad_signature' });
    }

    const update = paddleUpdate(req.body);
    if (!update) {
      /*
       * Раньше здесь был молчаливый выход. Из-за него первая же
       * настоящая оплата выглядела так: деньги списаны, тариф прежний,
       * а в журнале ни строки — и непонятно, дошёл ли вебхук вообще.
       * Теперь каждое событие оставляет след, даже то, которое мы не
       * разбираем.
       */
      const body = (req.body ?? {}) as { event_type?: unknown; event_id?: unknown };
      req.log.info(
        { event: String(body.event_type ?? '?'), id: String(body.event_id ?? '?') },
        'Событие Paddle пропущено: не подписка или нет клиента в custom_data',
      );
      return { ok: true, skipped: 'not_subscription' };
    }

    const done = await applyState(update.tenantId, {
      eventId: update.eventId,
      eventType: update.eventType,
      subscriptionId: update.subscriptionId,
      customerId: update.customerId,
      priceId: update.priceId,
      status: update.status,
      paidUntil: update.paidUntil,
      live: update.live,
    });

    req.log.info(
      { event: update.eventType, tenant: update.tenantId, status: update.status,
        plan: done.plan, applied: done.applied },
      'Событие подписки Paddle',
    );
    return { ok: true, applied: done.applied };
  });
}
