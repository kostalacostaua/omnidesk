import type { FastifyInstance } from 'fastify';
import { monthRange, payState, withSystem, withTenant, type Pool } from '@omnidesk/core';

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
}

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  plan: string;
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
          `SELECT id, name, slug, plan, status, source, seats_limit,
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
          status: t.status,
          source: t.source,
          seatsLimit: t.seats_limit,
          paidUntil: t.paid_until,
          priceMonth: t.price_month === null ? null : Number(t.price_month),
          currency: t.currency,
          createdAt: t.created_at,
          pay: payState(t.paid_until),
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
      const { rows } = await db.query<{ id: string; price_month: string | null; paid_until: string | null; created_at: string }>(
        `SELECT id, price_month, paid_until, created_at FROM tenants WHERE status <> 'deleted'`,
      );
      return rows;
    });

    let mrr = 0;
    let paying = 0;
    let fresh = 0;
    let messages = 0;
    let active = 0;
    for (const t of rows) {
      if (new Date(t.created_at) >= month.from) fresh += 1;
      if (payState(t.paid_until) !== 'unpaid') {
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
      active,
      mrr: Math.round(mrr * 100) / 100,
      messages,
    };
  });

  /** Карточка организации: кто внутри, что подключено, чем платили. */
  app.get<{ Params: { id: string } }>('/admin/tenants/:id', async (req, reply) => {
    const t = await withSystem(pool, 'организация', async (db) => {
      const { rows } = await db.query<TenantRow>(
        `SELECT id, name, slug, plan, status, source, seats_limit,
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
      const { rows: payments } = await db.query(
        `SELECT id, amount, currency, period_start, period_end, method, note, created_by, created_at
           FROM platform_payments ORDER BY created_at DESC LIMIT 50`,
      );
      const { rows: audit } = await db.query(
        `SELECT actor_email, action, detail, created_at
           FROM admin_audit ORDER BY created_at DESC LIMIT 20`,
      );
      return { users, channels, months, payments, audit };
    });

    return {
      tenant: {
        id: t.id,
        name: t.name,
        slug: t.slug,
        plan: t.plan,
        status: t.status,
        source: t.source,
        seatsLimit: t.seats_limit,
        paidUntil: t.paid_until,
        priceMonth: t.price_month === null ? null : Number(t.price_month),
        currency: t.currency,
        note: t.note,
        createdAt: t.created_at,
        pay: payState(t.paid_until),
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
