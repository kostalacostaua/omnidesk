import type { FastifyInstance } from 'fastify';
import {
  INVOICE_CURRENCIES,
  accountState,
  isTenantKind,
  invoiceNumber,
  isInvoiceCurrency,
  isoDay,
  monthRange,
  nbuRate,
  payState,
  toUah,
  withSystem,
  withTenant,
  type Pool,
} from '@omnidesk/core';

/**
 * Панель владельца платформы.
 *
 * Здесь видно то, чего не видно нигде: кто зарегистрировался, кто
 * платит, сколько сообщений прошло через нас за месяц и что с
 * организацией происходит прямо сейчас.
 *
 * Все цифры собираются обходом организаций, а не одним запросом с
 * группировкой. Причина не в лени: под RLS соединение без контекста
 * тенанта не видит ни одной строки, а заводить соединение, которое
 * видит переписку всех клиентов сразу, ради красивого запроса — плохая
 * сделка. Обход стоит одного дешёвого запроса на организацию, и страница
 * сознательно листается по пятьдесят, а не показывает всех разом.
 *
 * Права проверяются не здесь, а единой точкой в main.ts: посторонний
 * получает 404 ещё до входа в любой из этих обработчиков.
 */

interface Owner {
  tenantId: string;
  userId: string;
  email: string;
}

export interface AdminDeps {
  pool: Pool;
  /** Кто спрашивает. null — не владелец платформы; сюда такой запрос не доходит. */
  owner: (req: unknown) => Promise<Owner | null>;
  /** Токен входа под клиентом. Живёт час: это визит, а не вторая учётная запись. */
  impersonate: (tenantId: string, userId: string, actorEmail: string) => string;
  /** Курс берём из НБУ; в проверках его подменяют. */
  fetchImpl?: typeof fetch;
}

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  plan: string;
  kind: string;
  status: string;
  source: string;
  seats_limit: number;
  paid_until: string | null;
  price_month: string | null;
  currency: string;
  note: string;
  created_at: string;
}

const PLANS = ['trial', 'start', 'pro', 'custom'];
const TENANT_STATUS = ['active', 'suspended'];

/** Число из формы: пусто и мусор — это ноль, а не падение. */
function money(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

/** Дата из формы. Пусто — значит «не задано», и это законное значение. */
function day(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s)) return null;
  return s;
}

export function registerAdmin(app: FastifyInstance, deps: AdminDeps): void {
  const { pool } = deps;

  /** Счётчики одной организации. Один запрос в её контексте. */
  async function metrics(tenantId: string, monthFrom: Date) {
    return withTenant(pool, tenantId, async (db) => {
      const { rows } = await db.query<{
        users: string;
        channels: string;
        conversations: string;
        messages_month: string;
        last_at: string | null;
      }>(
        `SELECT (SELECT count(*) FROM users WHERE is_active)            AS users,
                (SELECT count(*) FROM channels WHERE status <> 'banned') AS channels,
                (SELECT count(*) FROM conversations)                    AS conversations,
                (SELECT count(*) FROM messages WHERE sent_at >= $1)     AS messages_month,
                (SELECT max(sent_at) FROM messages)                     AS last_at`,
        [monthFrom],
      );
      const r = rows[0];
      return {
        users: Number(r?.users ?? 0),
        channels: Number(r?.channels ?? 0),
        conversations: Number(r?.conversations ?? 0),
        messagesMonth: Number(r?.messages_month ?? 0),
        lastAt: r?.last_at ?? null,
      };
    });
  }

  /**
   * Список организаций.
   *
   * Сортировка по дате регистрации: новые сверху. Владельцу важнее
   * вчерашняя регистрация, чем клиент, который платит второй год, —
   * второй и так работает, а первый или заплатит, или уйдёт.
   */
  app.get<{ Querystring: { q?: string; limit?: string; offset?: string } }>(
    '/admin/tenants',
    async (req) => {
      const q = String(req.query?.q ?? '').trim().slice(0, 80);
      const limit = Math.min(100, Math.max(1, Number(req.query?.limit) || 50));
      const offset = Math.max(0, Number(req.query?.offset) || 0);
      const month = monthRange(new Date());

      const { rows, total } = await withSystem(pool, 'список организаций', async (db) => {
        const like = `%${q.toLowerCase()}%`;
        const { rows } = await db.query<TenantRow>(
          `SELECT id, name, slug, plan, kind, status, source, seats_limit,
                  paid_until, price_month, currency, note, created_at
             FROM tenants
            WHERE $1 = '' OR lower(name) LIKE $2 OR lower(slug) LIKE $2
            ORDER BY created_at DESC
            LIMIT $3 OFFSET $4`,
          [q, like, limit, offset],
        );
        const { rows: cnt } = await db.query<{ n: string }>(
          `SELECT count(*) AS n FROM tenants WHERE $1 = '' OR lower(name) LIKE $2 OR lower(slug) LIKE $2`,
          [q, like],
        );
        return { rows, total: Number(cnt[0]?.n ?? 0) };
      });

      const tenants = [];
      for (const t of rows) {
        const m = await metrics(t.id, month.from);
        tenants.push({
          id: t.id,
          name: t.name,
          slug: t.slug,
          plan: t.plan,
          kind: t.kind,
          status: t.status,
          source: t.source,
          seatsLimit: t.seats_limit,
          paidUntil: t.paid_until,
          priceMonth: t.price_month === null ? null : Number(t.price_month),
          currency: t.currency,
          createdAt: t.created_at,
          pay: accountState(t.kind, t.paid_until),
          ...m,
        });
      }

      return { tenants, total, month: month.label };
    },
  );

  /**
   * Сводка сверху.
   *
   * Четыре числа, а не двадцать: сколько организаций, сколько из них
   * живых, сколько платят и сколько денег в месяц. Всё остальное
   * читается в списке.
   */
  app.get('/admin/summary', async () => {
    const month = monthRange(new Date());
    const rows = await withSystem(pool, 'сводка по организациям', async (db) => {
      const { rows } = await db.query<{
        id: string;
        kind: string;
        price_month: string | null;
        paid_until: string | null;
        created_at: string;
      }>(`SELECT id, kind, price_month, paid_until, created_at FROM tenants WHERE status <> 'deleted'`);
      return rows;
    });

    let mrr = 0;
    let paying = 0;
    let fresh = 0;
    let messages = 0;
    let active = 0;
    let partners = 0;
    for (const t of rows) {
      if (new Date(t.created_at) >= month.from) fresh += 1;
      // Партнёр в деньгах не участвует: он не платит и не должен.
      // Считать его в «платят» — врать себе о выручке.
      if (t.kind === 'partner') partners += 1;
      else if (payState(t.paid_until) !== 'unpaid') {
        paying += 1;
        mrr += Number(t.price_month ?? 0);
      }
      const m = await metrics(t.id, month.from);
      messages += m.messagesMonth;
      if (m.messagesMonth > 0) active += 1;
    }

    return {
      month: month.label,
      tenants: rows.length,
      fresh,
      paying,
      partners,
      active,
      mrr: Math.round(mrr * 100) / 100,
      messages,
    };
  });

  /** Карточка организации: кто внутри, что подключено, чем платили. */
  app.get<{ Params: { id: string } }>('/admin/tenants/:id', async (req, reply) => {
    const t = await withSystem(pool, 'организация', async (db) => {
      const { rows } = await db.query<TenantRow>(
        `SELECT id, name, slug, plan, kind, status, source, seats_limit,
                paid_until, price_month, currency, note, created_at
           FROM tenants WHERE id = $1 LIMIT 1`,
        [req.params.id],
      );
      return rows[0] ?? null;
    });
    if (!t) return reply.code(404).send({ error: 'not_found' });

    const month = monthRange(new Date());
    const inside = await withTenant(pool, t.id, async (db) => {
      const { rows: users } = await db.query(
        `SELECT id, email, full_name, role, is_active, created_at
           FROM users ORDER BY created_at LIMIT 100`,
      );
      const { rows: channels } = await db.query(
        `SELECT id, type, display_name, status, created_at
           FROM channels ORDER BY created_at LIMIT 100`,
      );
      // Полгода по месяцам: меньше — не видно динамики, больше — не
      // помещается в карточку и никому не нужно.
      const { rows: months } = await db.query(
        `SELECT to_char(date_trunc('month', sent_at), 'YYYY-MM') AS month,
                count(*) FILTER (WHERE direction = 'in')  AS msg_in,
                count(*) FILTER (WHERE direction = 'out') AS msg_out
           FROM messages
          WHERE sent_at >= date_trunc('month', now()) - interval '5 months'
          GROUP BY 1 ORDER BY 1`,
      );
      const { rows: invoices } = await db.query(
        `SELECT id, number, issued_on, due_on, amount, currency, rate, rate_day, rate_source,
                amount_uah, period_start, period_end, subject, status, paid_at, created_at
           FROM platform_invoices ORDER BY issued_on DESC, created_at DESC LIMIT 50`,
      );
      const { rows: payments } = await db.query(
        `SELECT id, amount, currency, period_start, period_end, method, note, created_by, created_at
           FROM platform_payments ORDER BY created_at DESC LIMIT 50`,
      );
      const { rows: audit } = await db.query(
        `SELECT actor_email, action, detail, created_at
           FROM admin_audit ORDER BY created_at DESC LIMIT 20`,
      );
      return { users, channels, months, invoices, payments, audit };
    });

    return {
      tenant: {
        id: t.id,
        name: t.name,
        slug: t.slug,
        plan: t.plan,
        kind: t.kind,
        status: t.status,
        source: t.source,
        seatsLimit: t.seats_limit,
        paidUntil: t.paid_until,
        priceMonth: t.price_month === null ? null : Number(t.price_month),
        currency: t.currency,
        note: t.note,
        createdAt: t.created_at,
        pay: accountState(t.kind, t.paid_until),
      },
      ...inside,
      // Счётчики отдельным полем: в списках выше уже есть users и
      // channels, и смешивать число с массивом под одним именем — это
      // ошибка, которую заметишь только в интерфейсе.
      counts: await metrics(t.id, month.from),
    };
  });

  /**
   * Изменение тарифа.
   *
   * Меняется только то, что прислали: панель правит одно поле за раз, и
   * присланный частично объект не должен обнулять остальные.
   */
  app.patch<{
    Params: { id: string };
    Body: {
      plan?: string;
      kind?: string;
      status?: string;
      seatsLimit?: number;
      paidUntil?: string | null;
      priceMonth?: number | string;
      currency?: string;
      note?: string;
    };
  }>('/admin/tenants/:id', async (req, reply) => {
    const who = await deps.owner(req);
    const b = req.body ?? {};
    const sets: string[] = [];
    const vals: unknown[] = [req.params.id];
    const put = (sql: string, v: unknown) => {
      vals.push(v);
      sets.push(`${sql} = $${vals.length}`);
    };

    if (b.plan !== undefined) {
      if (!PLANS.includes(String(b.plan))) return reply.code(400).send({ error: 'bad_plan' });
      put('plan', b.plan);
    }
    if (b.status !== undefined) {
      if (!TENANT_STATUS.includes(String(b.status))) return reply.code(400).send({ error: 'bad_status' });
      put('status', b.status);
    }
    if (b.kind !== undefined) {
      if (!isTenantKind(b.kind)) return reply.code(400).send({ error: 'bad_kind' });
      put('kind', b.kind);
    }
    if (b.seatsLimit !== undefined) {
      const n = Math.max(1, Math.min(1000, Math.round(Number(b.seatsLimit) || 1)));
      put('seats_limit', n);
    }
    if (b.paidUntil !== undefined) put('paid_until', day(b.paidUntil));
    if (b.priceMonth !== undefined) put('price_month', money(b.priceMonth));
    if (b.currency !== undefined) put('currency', String(b.currency).slice(0, 8).toUpperCase());
    if (b.note !== undefined) put('note', String(b.note).slice(0, 2000));
    if (!sets.length) return reply.code(400).send({ error: 'nothing_to_change' });

    const ok = await withSystem(pool, 'изменение тарифа', async (db) => {
      const { rowCount } = await db.query(
        `UPDATE tenants SET ${sets.join(', ')} WHERE id = $1`,
        vals,
      );
      return (rowCount ?? 0) > 0;
    });
    if (!ok) return reply.code(404).send({ error: 'not_found' });

    await note(req.params.id, who?.email ?? '', 'tenant.update', b as Record<string, unknown>);
    return { ok: true };
  });

  /** Запись в журнал. Ошибка журнала не должна отменять само действие. */
  async function note(
    tenantId: string,
    actor: string,
    action: string,
    detail: Record<string, unknown>,
  ): Promise<void> {
    try {
      await withTenant(pool, tenantId, async (db) => {
        await db.query(
          `INSERT INTO admin_audit (tenant_id, actor_email, action, detail)
           VALUES ($1, $2, $3, $4::jsonb)`,
          [tenantId, actor, action, JSON.stringify(detail)],
        );
      });
    } catch (err) {
      app.log.warn({ err, tenantId, action }, 'Запись в журнал владельца не удалась');
    }
  }

  /**
   * Оплата.
   *
   * Вносится руками: шлюза пока нет, а знать, кто заплатил, надо уже
   * сегодня. Дата «оплачено до» двигается сама, если прислали конец
   * периода: иначе её каждый раз забывают поправить, и клиент из
   * оплативших переезжает в должники.
   */
  app.post<{
    Params: { id: string };
    Body: {
      amount?: number | string;
      currency?: string;
      periodStart?: string;
      periodEnd?: string;
      method?: string;
      note?: string;
    };
  }>('/admin/tenants/:id/payments', async (req, reply) => {
    const who = await deps.owner(req);
    const amount = money(req.body?.amount);
    if (amount <= 0) return reply.code(400).send({ error: 'bad_amount' });

    const exists = await withSystem(pool, 'проверка организации', async (db) => {
      const { rows } = await db.query(`SELECT 1 FROM tenants WHERE id = $1`, [req.params.id]);
      return rows.length > 0;
    });
    if (!exists) return reply.code(404).send({ error: 'not_found' });

    const end = day(req.body?.periodEnd);
    const id = await withTenant(pool, req.params.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO platform_payments
           (tenant_id, amount, currency, period_start, period_end, method, note, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          req.params.id,
          amount,
          String(req.body?.currency ?? 'UAH').slice(0, 8).toUpperCase(),
          day(req.body?.periodStart),
          end,
          String(req.body?.method ?? '').slice(0, 40),
          String(req.body?.note ?? '').slice(0, 500),
          who?.email ?? '',
        ],
      );
      return rows[0]!.id;
    });

    if (end) {
      await withSystem(pool, 'продление оплаты', async (db) => {
        // Только вперёд: задним числом сокращать оплату платёж не может.
        await db.query(
          `UPDATE tenants SET paid_until = GREATEST(COALESCE(paid_until, $2::date), $2::date)
            WHERE id = $1`,
          [req.params.id, end],
        );
      });
    }

    await note(req.params.id, who?.email ?? '', 'payment.add', { amount, periodEnd: end });
    return reply.code(201).send({ id, paidUntil: end });
  });

  /** Ошибочная оплата убирается целиком: исправлять сумму задним числом хуже. */
  app.delete<{ Params: { id: string; paymentId: string } }>(
    '/admin/tenants/:id/payments/:paymentId',
    async (req, reply) => {
      const who = await deps.owner(req);
      const ok = await withTenant(pool, req.params.id, async (db) => {
        const { rowCount } = await db.query(`DELETE FROM platform_payments WHERE id = $1`, [
          req.params.paymentId,
        ]);
        return (rowCount ?? 0) > 0;
      });
      if (!ok) return reply.code(404).send({ error: 'not_found' });
      await note(req.params.id, who?.email ?? '', 'payment.delete', { paymentId: req.params.paymentId });
      return { ok: true };
    },
  );


  /**
   * Реквизиты и нумерация счетов.
   *
   * Лежат одной строкой: счета выставляет один человек от одного лица.
   * Заводить справочник продавцов ради того, чего пока нет, — верный
   * способ получить пустую таблицу и лишний экран.
   */
  app.get('/admin/settings', async () => {
    const row = await withSystem(pool, 'реквизиты', async (db) => {
      const { rows } = await db.query(
        `SELECT seller_name, seller_tax_id, seller_iban, seller_bank,
                seller_address, seller_note, invoice_prefix, invoice_seq, plan_prices
           FROM platform_settings WHERE id = 1`,
      );
      return rows[0] ?? null;
    });
    return { settings: row, currencies: INVOICE_CURRENCIES };
  });

  app.patch<{
    Body: {
      sellerName?: string;
      sellerTaxId?: string;
      sellerIban?: string;
      sellerBank?: string;
      sellerAddress?: string;
      sellerNote?: string;
      invoicePrefix?: string;
      /** Прайс: тариф → валюта → цена. Пустая цена значит «нет в прайсе». */
      planPrices?: Record<string, Record<string, number | string>>;
    };
  }>('/admin/settings', async (req, reply) => {
    const b = req.body ?? {};
    const map: Array<[string, string | undefined]> = [
      ['seller_name', b.sellerName],
      ['seller_tax_id', b.sellerTaxId],
      ['seller_iban', b.sellerIban],
      ['seller_bank', b.sellerBank],
      ['seller_address', b.sellerAddress],
      ['seller_note', b.sellerNote],
      ['invoice_prefix', b.invoicePrefix],
    ];
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [col, v] of map) {
      if (v === undefined) continue;
      vals.push(String(v).slice(0, 300));
      sets.push(`${col} = $${vals.length}`);
    }
    if (b.planPrices !== undefined) {
      // Прайс чистим сами: в базу должны попасть только known валюты и
      // числа, иначе форма однажды запишет туда что угодно.
      const clean: Record<string, Record<string, number>> = {};
      for (const [plan, byCur] of Object.entries(b.planPrices ?? {})) {
        if (!PLANS.includes(String(plan))) continue;
        const row: Record<string, number> = {};
        for (const [cur, v] of Object.entries(byCur ?? {})) {
          if (!(INVOICE_CURRENCIES as readonly string[]).includes(cur)) continue;
          const n = money(v);
          if (n > 0) row[cur] = n;
        }
        if (Object.keys(row).length) clean[plan] = row;
      }
      vals.push(JSON.stringify(clean));
      sets.push(`plan_prices = $${vals.length}::jsonb`);
    }
    if (!sets.length) return reply.code(400).send({ error: 'nothing_to_change' });

    await withSystem(pool, 'правка реквизитов', async (db) => {
      await db.query(
        `UPDATE platform_settings SET ${sets.join(', ')}, updated_at = now() WHERE id = 1`,
        vals,
      );
    });
    return { ok: true };
  });

  /**
   * Курс НБУ на дату.
   *
   * Сначала смотрим свой справочник: курс за прошедший день больше не
   * меняется, и ходить за ним в чужой сервис на каждое открытие формы
   * незачем. Отказ возвращается значением, а не ошибкой: НБУ может
   * молчать, а счёт выставить надо — тогда курс вписывают руками.
   */
  async function rateFor(
    code: string,
    day: string,
  ): Promise<{ rate: number; day: string; source: 'nbu' | 'cache' } | null> {
    if (code === 'UAH') return { rate: 1, day, source: 'nbu' };

    const cached = await withSystem(pool, 'курс из справочника', async (db) => {
      const { rows } = await db.query<{ rate: string; day: string }>(
        `SELECT rate, to_char(day, 'YYYY-MM-DD') AS day
           FROM nbu_rates WHERE code = $1 AND day <= $2::date
          ORDER BY day DESC LIMIT 1`,
        [code, day],
      );
      return rows[0] ?? null;
    });
    // Курс из справочника годится, только если он за сам этот день:
    // более ранний мог быть последним известным, а мог просто значить,
    // что за свежие дни мы ещё не спрашивали.
    if (cached && cached.day === day) {
      return { rate: Number(cached.rate), day: cached.day, source: 'cache' };
    }

    const got = await nbuRate(code, day, deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {});
    if (!got) return cached ? { rate: Number(cached.rate), day: cached.day, source: 'cache' } : null;

    await withSystem(pool, 'запись курса', async (db) => {
      await db.query(
        `INSERT INTO nbu_rates (day, code, rate) VALUES ($1::date, $2, $3)
         ON CONFLICT (day, code) DO UPDATE SET rate = EXCLUDED.rate, fetched_at = now()`,
        [got.day, code, got.rate],
      );
    });
    return { ...got, source: 'nbu' };
  }

  /** Курс для формы: видно до того, как счёт выставлен. */
  app.get<{ Querystring: { code?: string; day?: string } }>('/admin/rate', async (req, reply) => {
    const code = String(req.query?.code ?? 'USD').toUpperCase();
    if (!isInvoiceCurrency(code)) return reply.code(400).send({ error: 'bad_currency' });
    const day = isoDay(String(req.query?.day ?? '')) || isoDay(new Date());
    const got = await rateFor(code, day);
    if (!got) return reply.code(502).send({ error: 'no_rate', day });
    return got;
  });

  /**
   * Выставить счёт.
   *
   * Курс берётся на день выставления и остаётся в счёте навсегда: это
   * не справочная величина, а часть обязательства. Поэтому же сумма в
   * гривнах считается здесь и хранится, а не пересчитывается при
   * каждом показе.
   *
   * Номер выдаёт счётчик в настройках. «Максимум по таблице» здесь не
   * работает: счета лежат под RLS, и максимум виден только внутри одной
   * организации — у второго клиента нумерация началась бы заново.
   */
  app.post<{
    Params: { id: string };
    Body: {
      amount?: number | string;
      currency?: string;
      issuedOn?: string;
      dueOn?: string;
      periodStart?: string;
      periodEnd?: string;
      subject?: string;
      /** Курс руками: когда НБУ молчит, а счёт нужен сегодня. */
      rate?: number | string;
    };
  }>('/admin/tenants/:id/invoices', async (req, reply) => {
    const who = await deps.owner(req);
    const amount = money(req.body?.amount);
    if (amount <= 0) return reply.code(400).send({ error: 'bad_amount' });

    const currency = String(req.body?.currency ?? 'UAH').toUpperCase();
    if (!isInvoiceCurrency(currency)) return reply.code(400).send({ error: 'bad_currency' });

    const issued = day(req.body?.issuedOn) ?? isoDay(new Date());

    const exists = await withSystem(pool, 'проверка организации', async (db) => {
      const { rows } = await db.query(`SELECT 1 FROM tenants WHERE id = $1`, [req.params.id]);
      return rows.length > 0;
    });
    if (!exists) return reply.code(404).send({ error: 'not_found' });

    const manual = money(req.body?.rate);
    let rate = manual > 0 ? manual : 0;
    let rateDay = issued;
    // Источник курса виден в счёте: «по НБУ» и «вписан руками» —
    // разные основания, и спорить потом придётся именно об этом.
    const source = manual > 0 ? 'manual' : 'nbu';

    if (!rate) {
      const got = await rateFor(currency, issued);
      if (!got) {
        // Молчание НБУ — не повод выставить счёт по выдуманному курсу.
        return reply.code(502).send({ error: 'no_rate', day: issued });
      }
      rate = got.rate;
      rateDay = got.day;
    }

    const number = await withSystem(pool, 'номер счёта', async (db) => {
      const { rows } = await db.query<{ invoice_seq: number; invoice_prefix: string }>(
        `UPDATE platform_settings SET invoice_seq = invoice_seq + 1 WHERE id = 1
         RETURNING invoice_seq, invoice_prefix`,
      );
      const r = rows[0];
      return invoiceNumber(r?.invoice_seq ?? 1, Number(issued.slice(0, 4)), r?.invoice_prefix ?? '');
    });

    const id = await withTenant(pool, req.params.id, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO platform_invoices
           (tenant_id, number, issued_on, due_on, amount, currency, rate, rate_day, rate_source,
            amount_uah, period_start, period_end, subject, created_by)
         VALUES ($1,$2,$3::date,$4::date,$5,$6,$7,$8::date,$9,$10,$11::date,$12::date,$13,$14)
         RETURNING id`,
        [
          req.params.id,
          number,
          issued,
          day(req.body?.dueOn),
          amount,
          currency,
          rate,
          rateDay,
          source,
          toUah(amount, rate),
          day(req.body?.periodStart),
          day(req.body?.periodEnd),
          String(req.body?.subject ?? '').slice(0, 300),
          who?.email ?? '',
        ],
      );
      return rows[0]!.id;
    });

    await note(req.params.id, who?.email ?? '', 'invoice.issue', { number, amount, currency, rate });
    return reply.code(201).send({ id, number, rate, rateDay, amountUah: toUah(amount, rate) });
  });

  /**
   * Счёт оплачен.
   *
   * Одна кнопка делает три вещи, потому что в жизни это одно событие:
   * счёт становится оплаченным, появляется запись о деньгах, и «оплачено
   * до» двигается на конец оплаченного периода. Разделить их значило бы
   * заставлять человека помнить порядок.
   */
  app.post<{ Params: { id: string; invoiceId: string } }>(
    '/admin/tenants/:id/invoices/:invoiceId/paid',
    async (req, reply) => {
      const who = await deps.owner(req);

      const inv = await withTenant(pool, req.params.id, async (db) => {
        const { rows } = await db.query<{
          id: string;
          number: string;
          amount: string;
          currency: string;
          period_end: string | null;
          status: string;
        }>(
          `SELECT id, number, amount, currency, to_char(period_end, 'YYYY-MM-DD') AS period_end, status
             FROM platform_invoices WHERE id = $1 LIMIT 1`,
          [req.params.invoiceId],
        );
        return rows[0] ?? null;
      });
      if (!inv) return reply.code(404).send({ error: 'not_found' });
      if (inv.status === 'paid') return { ok: true, already: true };

      await withTenant(pool, req.params.id, async (db) => {
        await db.query(
          `UPDATE platform_invoices SET status = 'paid', paid_at = now() WHERE id = $1`,
          [inv.id],
        );
        await db.query(
          `INSERT INTO platform_payments
             (tenant_id, amount, currency, period_end, method, note, created_by, invoice_id)
           VALUES ($1,$2,$3,$4::date,'','Рахунок ' || $5, $6, $7)`,
          [req.params.id, inv.amount, inv.currency, inv.period_end, inv.number, who?.email ?? '', inv.id],
        );
      });

      if (inv.period_end) {
        await withSystem(pool, 'продление оплаты', async (db) => {
          await db.query(
            `UPDATE tenants SET paid_until = GREATEST(COALESCE(paid_until, $2::date), $2::date)
              WHERE id = $1`,
            [req.params.id, inv.period_end],
          );
        });
      }

      await note(req.params.id, who?.email ?? '', 'invoice.paid', { number: inv.number });
      return { ok: true, paidUntil: inv.period_end };
    },
  );

  /**
   * Счёт отменён.
   *
   * Не удаление: выставленный счёт с номером уже уехал клиенту, и
   * исчезнувший номер в нумерации выглядит как потерянный документ.
   * Отменённый счёт остаётся видимым и перечёркнутым.
   */
  app.post<{ Params: { id: string; invoiceId: string } }>(
    '/admin/tenants/:id/invoices/:invoiceId/void',
    async (req, reply) => {
      const who = await deps.owner(req);
      const ok = await withTenant(pool, req.params.id, async (db) => {
        const { rowCount } = await db.query(
          `UPDATE platform_invoices SET status = 'void' WHERE id = $1 AND status <> 'paid'`,
          [req.params.invoiceId],
        );
        return (rowCount ?? 0) > 0;
      });
      if (!ok) return reply.code(409).send({ error: 'cannot_void' });
      await note(req.params.id, who?.email ?? '', 'invoice.void', { invoiceId: req.params.invoiceId });
      return { ok: true };
    },
  );

  /**
   * Вход под клиентом.
   *
   * Нужен для разбора: «у нас не приходят сообщения» объясняется за
   * минуту, если видишь то же, что и человек, и за неделю переписки —
   * если не видишь.
   *
   * Токен выдаётся на час и от имени владельца организации: под
   * наблюдателем половину проблем не увидеть. В токене остаётся отметка
   * imp — кто именно вошёл, — и такая же строка ложится в журнал
   * организации. Вход без следа — это ответы в переписке, которых никто
   * из сотрудников не писал.
   */
  app.post<{ Params: { id: string } }>('/admin/tenants/:id/login', async (req, reply) => {
    const who = await deps.owner(req);
    if (!who) return reply.code(404).send({ error: 'not_found' });

    const target = await withTenant(pool, req.params.id, async (db) => {
      const { rows } = await db.query<{ id: string; email: string; role: string }>(
        `SELECT id, email, role FROM users
          WHERE is_active
          ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, created_at
          LIMIT 1`,
      );
      return rows[0] ?? null;
    });
    if (!target) return reply.code(409).send({ error: 'no_users' });

    await note(req.params.id, who.email, 'login', { as: target.email, role: target.role });
    app.log.warn({ actor: who.email, tenantId: req.params.id, as: target.email }, 'Вход под клиентом');

    return { token: deps.impersonate(req.params.id, target.id, who.email), as: target.email };
  });
}
