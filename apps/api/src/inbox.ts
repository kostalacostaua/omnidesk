import type { FastifyInstance } from 'fastify';
import { validateSteps, withTenant, zohoRecordUrl, type Pool } from '@omnidesk/core';
import { channelScope } from './scope.js';

/**
 * Рабочее место оператора: список диалогов с фильтрами, карточка контакта,
 * заметки, правила бота.
 *
 * Ключевое отличие от прежней ручки /conversations — фильтры. Оператор
 * не работает со всем потоком: он работает со своим срезом. «Мои открытые»
 * и «ничьи» — два разных экрана, и без них список из трёхсот диалогов
 * бесполезен одинаково при любом дизайне.
 */

interface Auth {
  tenantId: string;
  userId: string;
}

export interface InboxDeps {
  pool: Pool;
  requireAuth: (req: unknown) => Auth | null;
  /**
   * Сообщить провайдеру, что диалог прочитан.
   *
   * Оператор ответил в Rozmovio, а в телефоне владельца чат всё ещё
   * подсвечен непрочитанным: провайдер об этом не знает. Отметку ставит
   * тот, у кого есть доступ к каналу, — очередь исходящих.
   */
  markReadUpstream?: (task: {
    tenantId: string;
    conversationId: string;
  }) => void;
}

export function registerInbox(app: FastifyInstance, deps: InboxDeps): void {
  const { pool, requireAuth, markReadUpstream } = deps;
  const auth401 = { error: 'unauthorized' } as const;

  // ── Список диалогов ───────────────────────────────────────────────
  app.get<{
    Querystring: {
      status?: string;
      assignee?: string;
      channelId?: string;
      tag?: string;
      q?: string;
      limit?: string;
    };
  }>('/conversations', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const q = req.query ?? {};
    const where: string[] = [];
    const params: unknown[] = [];
    const push = (value: unknown) => {
      params.push(value);
      return '$' + params.length;
    };

    // Статус. «Закрытые» — отдельная вкладка, потому что закрытых со
    // временем становится на порядок больше, чем активных.
    if (q.status === 'closed') where.push(`c.status = 'resolved'`);
    else if (q.status === 'open') where.push(`c.status <> 'resolved'`);
    else if (q.status && q.status !== 'all') where.push(`c.status = ${push(q.status)}::text`);

    // Ответственный. «Мои» и «ничьи» — самые частые срезы за смену.
    if (q.assignee === 'me') where.push(`c.assignee_id = ${push(auth.userId)}::uuid`);
    else if (q.assignee === 'none') where.push(`c.assignee_id IS NULL`);
    else if (q.assignee && q.assignee !== 'all') where.push(`c.assignee_id = ${push(q.assignee)}::uuid`);

    if (q.channelId) where.push(`c.channel_id = ${push(q.channelId)}::uuid`);

    // Доступ к каналам. Условие идёт последним, но действует раньше
    // всех фильтров: оператор с ограниченным списком не увидит чужой
    // канал ни выбрав его в фильтре, ни поиском по имени.
    where.push(channelScope('c.channel_id', push(auth.userId)));
    if (q.tag) where.push(`${push(q.tag)}::text = ANY(c.tags)`);

    // Поиск по имени и телефону. ILIKE, а не полнотекстовый индекс:
    // на объёмах одного клиента это дешевле и не требует словарей,
    // а на больших под это уже есть индекс по tenant_id.
    if (q.q && q.q.trim()) {
      const like = push('%' + q.q.trim() + '%');
      where.push(`(ct.display_name ILIKE ${like}::text OR ct.phone_e164 ILIKE ${like}::text)`);
    }

    const limit = Math.min(Math.max(Number(q.limit ?? 60) || 60, 1), 200);

    const rows = await withTenant(pool, auth.tenantId, async (db) => {
      const { rows } = await db.query(
        `SELECT c.id, c.status, c.last_message_at, c.unread_count, c.tags,
                c.window_expires_at, c.window_type, c.assignee_id, c.bot_enabled,
                c.human_replied_at,
                ct.id AS contact_id, ct.display_name, ct.phone_e164,
                (ct.avatar_url IS NOT NULL) AS has_avatar,
                ch.id AS channel_id, ch.type AS channel_type,
                ch.display_name AS channel_name,
                u.full_name AS assignee_name, u.email AS assignee_email,
                (SELECT m.content->>'text' FROM messages m
                  WHERE m.conversation_id = c.id
                  ORDER BY m.sent_at DESC LIMIT 1) AS preview
           FROM conversations c
           JOIN contacts ct ON ct.id = c.contact_id
           JOIN channels ch ON ch.id = c.channel_id
           LEFT JOIN users u ON u.id = c.assignee_id
          ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
          ORDER BY c.last_message_at DESC NULLS LAST
          LIMIT ${limit}`,
        params,
      );
      return rows;
    });

    return { conversations: rows };
  });

  // ── Счётчики для вкладок ──────────────────────────────────────────
  // Отдельной ручкой, а не полем в списке: счётчики нужны и тогда,
  // когда открыт другой срез, а тащить ради них весь список глупо.
  app.get('/conversations/counts', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const row = await withTenant(pool, auth.tenantId, async (db) => {
      const { rows } = await db.query(
        `SELECT
           count(*) FILTER (WHERE c.status <> 'resolved')                        AS open,
           count(*) FILTER (WHERE c.status <> 'resolved' AND c.assignee_id = $1) AS mine,
           count(*) FILTER (WHERE c.status <> 'resolved' AND c.assignee_id IS NULL) AS unassigned,
           count(*) FILTER (WHERE c.status = 'resolved')                         AS closed,
           coalesce(sum(c.unread_count) FILTER (WHERE c.status <> 'resolved'), 0) AS unread
         FROM conversations c
         WHERE ${channelScope('c.channel_id', '$1')}`,
        [auth.userId],
      );
      return rows[0] ?? {};
    });

    return { counts: row };
  });

  // ── Изменение диалога: статус, ответственный, теги, бот ───────────
  app.patch<{
    Params: { id: string };
    Body: {
      status?: string;
      assigneeId?: string | null;
      addTag?: string;
      removeTag?: string;
      botEnabled?: boolean;
      read?: boolean;
    };
  }>('/conversations/:id', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const b = req.body ?? {};
    if (b.status && !['open', 'pending', 'snoozed', 'resolved'].includes(b.status)) {
      return reply.code(400).send({ error: 'bad_status' });
    }

    const updated = await withTenant(pool, auth.tenantId, async (db) => {
      const sets: string[] = [];
      const params: unknown[] = [req.params.id];
      const push = (v: unknown) => {
        params.push(v);
        return '$' + params.length;
      };

      if (b.status) {
        sets.push(`status = ${push(b.status)}::text`);
        // resolved_at ставим и снимаем вместе со статусом: иначе
        // переоткрытый диалог остаётся с датой закрытия и ломает отчёты.
        sets.push(b.status === 'resolved' ? `resolved_at = now()` : `resolved_at = NULL`);
      }
      if (b.assigneeId !== undefined) {
        sets.push(`assignee_id = ${push(b.assigneeId)}::uuid`);
      }
      if (b.addTag) sets.push(`tags = ARRAY(SELECT DISTINCT unnest(tags || ${push(b.addTag)}::text))`);
      if (b.removeTag) sets.push(`tags = array_remove(tags, ${push(b.removeTag)}::text)`);
      if (b.botEnabled !== undefined) sets.push(`bot_enabled = ${push(b.botEnabled)}::boolean`);
      if (b.read === true) sets.push(`unread_count = 0`);
      if (b.read === false) sets.push(`unread_count = GREATEST(unread_count, 1)`);

      if (!sets.length) return true;

      // Изменять диалог можно только в своём канале: иначе оператор,
      // который его не видит, всё равно мог бы закрыть его по ссылке.
      const uid = push(auth.userId);
      const { rowCount } = await db.query(
        `UPDATE conversations c SET ${sets.join(', ')}
          WHERE c.id = $1 AND ${channelScope('c.channel_id', uid)}`,
        params,
      );
      return (rowCount ?? 0) > 0;
    });

    if (!updated) return reply.code(404).send({ error: 'not_found' });

    // Прочитано у нас — значит прочитано и там. Иначе владелец видит в
    // своём телефоне непрочитанный чат, на который уже ответили.
    if (b.read === true) {
      markReadUpstream?.({ tenantId: auth.tenantId, conversationId: req.params.id });
    }

    return { ok: true };
  });

  // ── Карточка контакта ─────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/conversations/:id/card', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const card = await withTenant(pool, auth.tenantId, async (db) => {
      const { rows: conv } = await db.query<{ contact_id: string }>(
        `SELECT contact_id FROM conversations c
          WHERE c.id = $1 AND ${channelScope('c.channel_id', '$2')}`,
        [req.params.id, auth.userId],
      );
      if (!conv[0]) return null;
      const contactId = conv[0].contact_id;

      const { rows: contact } = await db.query(
        `SELECT id, display_name, phone_e164, email, avatar_url, attributes,
                crm_module, crm_record_id, created_at
           FROM contacts WHERE id = $1`,
        [contactId],
      );
      const { rows: identities } = await db.query(
        `SELECT channel_type, external_id, raw_profile
           FROM contact_identities WHERE contact_id = $1`,
        [contactId],
      );
      const { rows: notes } = await db.query(
        `SELECT n.id, n.body, n.created_at, u.full_name AS author_name
           FROM contact_notes n
           LEFT JOIN users u ON u.id = n.author_id
          WHERE n.contact_id = $1
          ORDER BY n.created_at DESC LIMIT 50`,
        [contactId],
      );
      const { rows: stats } = await db.query(
        `SELECT count(*) AS messages,
                min(sent_at) AS first_at,
                max(sent_at) AS last_at
           FROM messages WHERE conversation_id = $1`,
        [req.params.id],
      );

      // Ссылка на карточку в CRM: собирается здесь, а не в браузере,
      // потому что адрес зависит от зоны Zoho, а её знает только сервер.
      const { rows: inst } = await db.query<{ api_domain: string }>(
        `SELECT api_domain FROM zoho_installations
          WHERE status = 'active' ORDER BY created_at DESC LIMIT 1`,
      );
      const c = contact[0] as { crm_module?: string; crm_record_id?: string } | undefined;

      return {
        contact: contact[0] ?? null,
        identities,
        notes,
        stats: stats[0] ?? null,
        crmUrl: zohoRecordUrl(inst[0]?.api_domain, c?.crm_module, c?.crm_record_id),
      };
    });

    if (!card) return reply.code(404).send({ error: 'not_found' });
    return card;
  });

  // ── Правка контакта ───────────────────────────────────────────────
  app.patch<{
    Params: { id: string };
    Body: { displayName?: string; phone?: string; email?: string; attributes?: unknown };
  }>('/contacts/:id', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const b = req.body ?? {};
    const ok = await withTenant(pool, auth.tenantId, async (db) => {
      const { rowCount } = await db.query(
        `UPDATE contacts
            SET display_name = COALESCE($2, display_name),
                phone_e164   = COALESCE($3, phone_e164),
                email        = COALESCE($4, email),
                attributes   = COALESCE($5::jsonb, attributes)
          WHERE id = $1`,
        [
          req.params.id,
          b.displayName ?? null,
          b.phone ?? null,
          b.email ?? null,
          b.attributes ? JSON.stringify(b.attributes) : null,
        ],
      );
      return (rowCount ?? 0) > 0;
    });

    if (!ok) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  // ── Заметки ───────────────────────────────────────────────────────
  app.post<{ Params: { id: string }; Body: { body?: string } }>(
    '/contacts/:id/notes',
    async (req, reply) => {
      const auth = requireAuth(req);
      if (!auth) return reply.code(401).send(auth401);

      const body = (req.body?.body ?? '').trim();
      if (!body) return reply.code(400).send({ error: 'empty' });

      const id = await withTenant(pool, auth.tenantId, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `INSERT INTO contact_notes (tenant_id, contact_id, author_id, body)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [auth.tenantId, req.params.id, auth.userId, body],
        );
        return rows[0]?.id ?? null;
      });

      if (!id) return reply.code(404).send({ error: 'not_found' });
      return reply.code(201).send({ id });
    },
  );

  app.delete<{ Params: { id: string } }>('/notes/:id', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const ok = await withTenant(pool, auth.tenantId, async (db) => {
      const { rowCount } = await db.query(`DELETE FROM contact_notes WHERE id = $1`, [
        req.params.id,
      ]);
      return (rowCount ?? 0) > 0;
    });

    if (!ok) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  // ── Правила чат-бота ──────────────────────────────────────────────
  // ── Сценарии ──────────────────────────────────────────────────────
  //
  // Правило отвечало одним сообщением. Сценарий — это цепочка шагов,
  // которая умеет ждать паузу и ответ клиента. Старые правила перенесены
  // миграцией, ручки bot-rules ниже остались только для совместимости.

  app.get('/scenarios', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const rows = await withTenant(pool, auth.tenantId, async (db) => {
      const { rows } = await db.query(
        `SELECT s.id, s.channel_id, s.name, s.trigger_type, s.keywords, s.schedule,
                s.steps, s.is_active, s.priority, s.runs_started, s.runs_finished,
                s.updated_at, ch.display_name AS channel_name,
                (SELECT count(*) FROM scenario_runs r
                  WHERE r.scenario_id = s.id AND r.status IN ('running','waiting')) AS live
           FROM scenarios s
           LEFT JOIN channels ch ON ch.id = s.channel_id
          ORDER BY s.trigger_type ASC, s.priority ASC, s.created_at ASC`,
      );
      return rows;
    });

    return { scenarios: rows };
  });

  const TRIGGERS = ['welcome', 'keyword', 'exact', 'off_hours', 'fallback'];

  /** Разбор тела: одна проверка на создание и на правку. */
  function readScenario(b: Record<string, unknown>): { error: string } | {
    name: string;
    triggerType: string;
    keywords: string[];
    schedule: Record<string, unknown>;
    steps: unknown[];
    channelId: string | null;
    priority: number;
    isActive: boolean;
  } {
    const name = String(b['name'] ?? '').trim();
    if (!name) return { error: 'Название обязательно' };
    if (name.length > 80) return { error: 'Название длиннее 80 символов' };

    const triggerType = String(b['triggerType'] ?? 'keyword');
    if (!TRIGGERS.includes(triggerType)) return { error: 'Неизвестное условие запуска' };

    const keywords = (Array.isArray(b['keywords']) ? b['keywords'] : [])
      .map((k) => String(k).trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 40);
    if ((triggerType === 'keyword' || triggerType === 'exact') && !keywords.length) {
      return { error: 'Для этого условия нужны слова' };
    }

    const parsed = validateSteps(b['steps'] ?? []);
    if ('error' in parsed) return parsed;
    if (!parsed.steps.length) return { error: 'В сценарии нет ни одного шага' };

    const schedule = (b['schedule'] ?? {}) as Record<string, unknown>;

    return {
      name,
      triggerType,
      keywords,
      schedule,
      steps: parsed.steps,
      channelId: (b['channelId'] as string) || null,
      priority: Number(b['priority'] ?? 100) || 100,
      isActive: b['isActive'] === undefined ? true : Boolean(b['isActive']),
    };
  }

  app.post<{ Body: Record<string, unknown> }>('/scenarios', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const parsed = readScenario(req.body ?? {});
    if ('error' in parsed) return reply.code(400).send({ error: 'bad_scenario', detail: parsed.error });

    const id = await withTenant(pool, auth.tenantId, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO scenarios (tenant_id, channel_id, name, trigger_type, keywords,
                                schedule, steps, is_active, priority)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [
          auth.tenantId,
          parsed.channelId,
          parsed.name,
          parsed.triggerType,
          parsed.keywords,
          JSON.stringify(parsed.schedule),
          JSON.stringify(parsed.steps),
          parsed.isActive,
          parsed.priority,
        ],
      );
      return rows[0]!.id;
    });

    return reply.code(201).send({ id });
  });

  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/scenarios/:id',
    async (req, reply) => {
      const auth = requireAuth(req);
      if (!auth) return reply.code(401).send(auth401);

      const parsed = readScenario(req.body ?? {});
      if ('error' in parsed) {
        return reply.code(400).send({ error: 'bad_scenario', detail: parsed.error });
      }

      const ok = await withTenant(pool, auth.tenantId, async (db) => {
        const { rowCount } = await db.query(
          `UPDATE scenarios
              SET channel_id = $2, name = $3, trigger_type = $4, keywords = $5,
                  schedule = $6, steps = $7, is_active = $8, priority = $9,
                  updated_at = now()
            WHERE id = $1`,
          [
            req.params.id,
            parsed.channelId,
            parsed.name,
            parsed.triggerType,
            parsed.keywords,
            JSON.stringify(parsed.schedule),
            JSON.stringify(parsed.steps),
            parsed.isActive,
            parsed.priority,
          ],
        );
        return (rowCount ?? 0) > 0;
      });

      if (!ok) return reply.code(404).send({ error: 'not_found' });
      return { ok: true };
    },
  );

  /** Включение и выключение отдельно: это одно нажатие, а не правка целиком. */
  app.patch<{ Params: { id: string }; Body: { isActive?: boolean } }>(
    '/scenarios/:id',
    async (req, reply) => {
      const auth = requireAuth(req);
      if (!auth) return reply.code(401).send(auth401);

      const ok = await withTenant(pool, auth.tenantId, async (db) => {
        const { rowCount } = await db.query(
          `UPDATE scenarios SET is_active = COALESCE($2, is_active), updated_at = now()
            WHERE id = $1`,
          [req.params.id, req.body?.isActive ?? null],
        );
        return (rowCount ?? 0) > 0;
      });

      if (!ok) return reply.code(404).send({ error: 'not_found' });
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>('/scenarios/:id', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const ok = await withTenant(pool, auth.tenantId, async (db) => {
      const { rowCount } = await db.query(`DELETE FROM scenarios WHERE id = $1`, [req.params.id]);
      return (rowCount ?? 0) > 0;
    });

    if (!ok) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  app.get('/bot-rules', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const rows = await withTenant(pool, auth.tenantId, async (db) => {
      const { rows } = await db.query(
        `SELECT r.id, r.channel_id, r.name, r.trigger_type, r.keywords,
                r.reply_text, r.priority, r.stop_after, r.is_active, r.hits,
                r.created_at, ch.display_name AS channel_name
           FROM bot_rules r
           LEFT JOIN channels ch ON ch.id = r.channel_id
          ORDER BY r.priority ASC, r.created_at ASC`,
      );
      return rows;
    });

    return { rules: rows };
  });

  app.post<{
    Body: {
      name?: string;
      triggerType?: string;
      keywords?: string[];
      replyText?: string;
      channelId?: string | null;
      priority?: number;
    };
  }>('/bot-rules', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const b = req.body ?? {};
    const triggerType = b.triggerType ?? 'contains';
    const name = (b.name ?? '').trim();
    const replyText = (b.replyText ?? '').trim();

    if (!name) return reply.code(400).send({ error: 'name_required' });
    if (!replyText) return reply.code(400).send({ error: 'reply_required' });
    if (!['welcome', 'equals', 'contains', 'fallback'].includes(triggerType)) {
      return reply.code(400).send({ error: 'bad_trigger' });
    }

    // Ключевые слова обязательны только там, где по ним и происходит
    // сравнение. У приветствия и «ничего не подошло» условия другие.
    const keywords = (b.keywords ?? [])
      .map((k) => String(k).trim().toLowerCase())
      .filter(Boolean);
    if ((triggerType === 'equals' || triggerType === 'contains') && !keywords.length) {
      return reply.code(400).send({ error: 'keywords_required' });
    }

    const id = await withTenant(pool, auth.tenantId, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO bot_rules (tenant_id, channel_id, name, trigger_type,
                                keywords, reply_text, priority)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          auth.tenantId,
          b.channelId || null,
          name,
          triggerType,
          keywords,
          replyText,
          b.priority ?? 100,
        ],
      );
      return rows[0]!.id;
    });

    return reply.code(201).send({ id });
  });

  app.patch<{ Params: { id: string }; Body: { isActive?: boolean; priority?: number } }>(
    '/bot-rules/:id',
    async (req, reply) => {
      const auth = requireAuth(req);
      if (!auth) return reply.code(401).send(auth401);

      const b = req.body ?? {};
      const ok = await withTenant(pool, auth.tenantId, async (db) => {
        const { rowCount } = await db.query(
          `UPDATE bot_rules
              SET is_active = COALESCE($2, is_active),
                  priority  = COALESCE($3, priority)
            WHERE id = $1`,
          [req.params.id, b.isActive ?? null, b.priority ?? null],
        );
        return (rowCount ?? 0) > 0;
      });

      if (!ok) return reply.code(404).send({ error: 'not_found' });
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>('/bot-rules/:id', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const ok = await withTenant(pool, auth.tenantId, async (db) => {
      const { rowCount } = await db.query(`DELETE FROM bot_rules WHERE id = $1`, [req.params.id]);
      return (rowCount ?? 0) > 0;
    });

    if (!ok) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });
}
