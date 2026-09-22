import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import {
  encryptJson,
  maskSecret,
  withSystem,
  withTenant,
  type Pool,
} from '@omnidesk/core';

/**
 * Настройки: каналы, пользователи, шаблоны, профиль.
 *
 * Вынесено отдельным файлом не ради чистоты, а потому что настройки растут
 * быстрее всего остального: каждый новый канал добавляет сюда ручку.
 * В main.ts они бы утопили логику сообщений.
 */

interface Auth {
  tenantId: string;
  userId: string;
}

export interface SettingsDeps {
  pool: Pool;
  masterKey: Buffer;
  requireAuth: (req: unknown) => Auth | null;
  telegramApiRoot: string;
  publicUrl: string;
  telegramWebhookSecret: string;
}

export function registerSettings(app: FastifyInstance, deps: SettingsDeps): void {
  const { pool, masterKey, requireAuth } = deps;

  const auth401 = { error: 'unauthorized' } as const;

  // ── Профиль: кто я и что за организация ───────────────────────────
  app.get('/me', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const data = await withTenant(pool, auth.tenantId, async (db) => {
      const { rows: users } = await db.query(
        `SELECT id, email, full_name, role, last_seen_at, created_at
           FROM users WHERE id = $1 LIMIT 1`,
        [auth.userId],
      );
      const { rows: counts } = await db.query<{
        channels: string; users: string; conversations: string; messages: string;
      }>(
        `SELECT (SELECT count(*) FROM channels)      AS channels,
                (SELECT count(*) FROM users)         AS users,
                (SELECT count(*) FROM conversations) AS conversations,
                (SELECT count(*) FROM messages)      AS messages`,
      );
      return { user: users[0] ?? null, counts: counts[0] ?? null };
    });

    // Организация лежит в tenants — таблице без RLS, читаем по явному id.
    const tenant = await withSystem(pool, 'профиль организации', async (db) => {
      const { rows } = await db.query(
        `SELECT id, slug, name, plan, seats_limit, region, created_at
           FROM tenants WHERE id = $1 LIMIT 1`,
        [auth.tenantId],
      );
      return rows[0] ?? null;
    });

    // Отметка последнего визита — по ней потом видно, кто реально работает.
    await withTenant(pool, auth.tenantId, async (db) => {
      await db.query(`UPDATE users SET last_seen_at = now() WHERE id = $1`, [auth.userId]);
    });

    return { tenant, ...data };
  });

  // ── Каналы ────────────────────────────────────────────────────────
  app.get('/channels', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const rows = await withTenant(pool, auth.tenantId, async (db) => {
      // credentials_enc НЕ выбираем: токены не должны покидать сервер даже
      // в зашифрованном виде. Показываем только то, по чему канал узнают.
      const { rows } = await db.query(
        `SELECT c.id, c.type, c.display_name, c.external_id, c.status,
                c.meta, c.last_error, c.created_at,
                (SELECT count(*) FROM conversations v WHERE v.channel_id = c.id) AS conversations
           FROM channels c
          ORDER BY c.created_at DESC`,
      );
      return rows;
    });

    return { channels: rows };
  });

  app.patch<{ Params: { id: string }; Body: { displayName?: string; status?: string } }>(
    '/channels/:id',
    async (req, reply) => {
      const auth = requireAuth(req);
      if (!auth) return reply.code(401).send(auth401);

      const { displayName, status } = req.body ?? {};
      if (status && !['active', 'disconnected'].includes(status)) {
        return reply.code(400).send({ error: 'bad_status' });
      }

      const updated = await withTenant(pool, auth.tenantId, async (db) => {
        const { rowCount } = await db.query(
          `UPDATE channels
              SET display_name = COALESCE($2, display_name),
                  status       = COALESCE($3, status)
            WHERE id = $1`,
          [req.params.id, displayName ?? null, status ?? null],
        );
        return (rowCount ?? 0) > 0;
      });

      if (!updated) return reply.code(404).send({ error: 'not_found' });
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>('/channels/:id', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const removed = await withTenant(pool, auth.tenantId, async (db) => {
      const { rowCount } = await db.query(`DELETE FROM channels WHERE id = $1`, [req.params.id]);
      return (rowCount ?? 0) > 0;
    });

    if (!removed) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  // ── Пользователи ──────────────────────────────────────────────────
  app.get('/users', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const rows = await withTenant(pool, auth.tenantId, async (db) => {
      const { rows } = await db.query(
        `SELECT id, email, full_name, role, is_active, last_seen_at, created_at
           FROM users ORDER BY created_at ASC`,
      );
      return rows;
    });

    return { users: rows };
  });

  app.post<{ Body: { email?: string; fullName?: string; role?: string } }>(
    '/users',
    async (req, reply) => {
      const auth = requireAuth(req);
      if (!auth) return reply.code(401).send(auth401);

      const { email, fullName, role } = req.body ?? {};
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return reply.code(400).send({ error: 'bad_email' });
      }
      const r = role ?? 'agent';
      if (!['owner', 'admin', 'agent', 'viewer'].includes(r)) {
        return reply.code(400).send({ error: 'bad_role' });
      }

      const result = await withTenant(pool, auth.tenantId, async (db) => {
        // Лимит мест — из тарифа. Проверяем здесь, а не в интерфейсе:
        // интерфейс можно обойти, ручку — нет.
        const { rows: seats } = await db.query<{ used: string }>(
          `SELECT count(*) AS used FROM users WHERE is_active`,
        );
        const limit = await withSystem(pool, 'лимит мест', async (sdb) => {
          const { rows } = await sdb.query<{ seats_limit: number }>(
            `SELECT seats_limit FROM tenants WHERE id = $1`,
            [auth.tenantId],
          );
          return rows[0]?.seats_limit ?? 3;
        });
        if (Number(seats[0]!.used) >= limit) {
          return { error: 'seats_limit_reached' as const, limit };
        }

        const { rows } = await db.query<{ id: string }>(
          `INSERT INTO users (tenant_id, email, full_name, role, is_active)
           VALUES ($1, $2, $3, $4, true)
           ON CONFLICT (tenant_id, email) DO UPDATE
             SET is_active = true, role = EXCLUDED.role,
                 full_name = COALESCE(EXCLUDED.full_name, users.full_name)
           RETURNING id`,
          [auth.tenantId, email, fullName ?? '', r],
        );
        return { id: rows[0]!.id };
      });

      if ('error' in result) return reply.code(409).send(result);
      return reply.code(201).send(result);
    },
  );

  app.patch<{ Params: { id: string }; Body: { role?: string; isActive?: boolean } }>(
    '/users/:id',
    async (req, reply) => {
      const auth = requireAuth(req);
      if (!auth) return reply.code(401).send(auth401);

      const { role, isActive } = req.body ?? {};
      if (role && !['owner', 'admin', 'agent', 'viewer'].includes(role)) {
        return reply.code(400).send({ error: 'bad_role' });
      }

      // Нельзя отключить самого себя: иначе владелец одним кликом
      // лишает себя доступа и восстановить может только через консоль.
      if (req.params.id === auth.userId && isActive === false) {
        return reply.code(409).send({ error: 'cannot_disable_self' });
      }

      const ok = await withTenant(pool, auth.tenantId, async (db) => {
        const { rowCount } = await db.query(
          `UPDATE users
              SET role = COALESCE($2, role),
                  is_active = COALESCE($3, is_active)
            WHERE id = $1`,
          [req.params.id, role ?? null, isActive ?? null],
        );
        return (rowCount ?? 0) > 0;
      });

      if (!ok) return reply.code(404).send({ error: 'not_found' });
      return { ok: true };
    },
  );

  // ── Шаблоны быстрых ответов ───────────────────────────────────────
  app.get('/quick-replies', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const rows = await withTenant(pool, auth.tenantId, async (db) => {
      const { rows } = await db.query(
        `SELECT id, shortcut, body, created_at
           FROM quick_replies ORDER BY shortcut ASC`,
      );
      return rows;
    });

    return { quickReplies: rows };
  });

  app.post<{ Body: { shortcut?: string; body?: string } }>(
    '/quick-replies',
    async (req, reply) => {
      const auth = requireAuth(req);
      if (!auth) return reply.code(401).send(auth401);

      const shortcut = (req.body?.shortcut ?? '').trim().replace(/^\//, '');
      const body = (req.body?.body ?? '').trim();
      if (!shortcut || !body) return reply.code(400).send({ error: 'shortcut_and_body_required' });
      if (shortcut.length > 32) return reply.code(400).send({ error: 'shortcut_too_long' });

      const id = await withTenant(pool, auth.tenantId, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `INSERT INTO quick_replies (tenant_id, shortcut, body)
           VALUES ($1, $2, $3)
           ON CONFLICT (tenant_id, shortcut) DO UPDATE SET body = EXCLUDED.body
           RETURNING id`,
          [auth.tenantId, shortcut, body],
        );
        return rows[0]!.id;
      });

      return reply.code(201).send({ id, shortcut });
    },
  );

  app.delete<{ Params: { id: string } }>('/quick-replies/:id', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const ok = await withTenant(pool, auth.tenantId, async (db) => {
      const { rowCount } = await db.query(`DELETE FROM quick_replies WHERE id = $1`, [
        req.params.id,
      ]);
      return (rowCount ?? 0) > 0;
    });

    if (!ok) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  // ── Подключение Telegram-бота из интерфейса ───────────────────────
  app.post<{ Body: { botToken?: string; displayName?: string } }>(
    '/settings/channels/telegram',
    async (req, reply) => {
      const auth = requireAuth(req);
      if (!auth) return reply.code(401).send(auth401);

      const botToken = (req.body?.botToken ?? '').trim();
      if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(botToken)) {
        return reply.code(400).send({ error: 'invalid_bot_token' });
      }

      const meRes = await fetch(`${deps.telegramApiRoot}/bot${botToken}/getMe`);
      const me = (await meRes.json()) as {
        ok: boolean;
        result?: { id: number; username?: string; first_name?: string };
      };
      if (!me.ok || !me.result) {
        return reply.code(400).send({ error: 'telegram_rejected_token' });
      }

      const bot = me.result;
      const externalId = String(bot.id);

      const owner = await withSystem(pool, 'владелец канала', async (db) => {
        const { rows } = await db.query<{ channel_id: string; tenant_id: string }>(
          `SELECT channel_id, tenant_id FROM channel_routes
            WHERE channel_type = 'telegram_bot' AND external_id = $1 LIMIT 1`,
          [externalId],
        );
        return rows[0] ?? null;
      });

      if (owner && owner.tenant_id !== auth.tenantId) {
        return reply.code(409).send({
          error: 'channel_belongs_to_another_tenant',
          detail: 'Этот бот уже подключён в другом аккаунте.',
        });
      }

      const channelId = owner?.channel_id ?? randomUUID();

      await withTenant(pool, auth.tenantId, async (db) => {
        await db.query(
          `INSERT INTO channels (id, tenant_id, type, display_name, external_id,
                                 credentials_enc, meta, status)
           VALUES ($1, $2, 'telegram_bot', $3, $4, $5, $6, 'active')
           ON CONFLICT (type, external_id) DO UPDATE
             SET display_name = EXCLUDED.display_name,
                 credentials_enc = EXCLUDED.credentials_enc,
                 meta = EXCLUDED.meta, status = 'active', last_error = NULL`,
          [
            channelId,
            auth.tenantId,
            req.body?.displayName?.trim() || bot.username || 'Telegram',
            externalId,
            encryptJson(masterKey, auth.tenantId, { botToken }),
            JSON.stringify({ username: bot.username, name: bot.first_name }),
          ],
        );
      });

      let mode: 'polling' | 'webhook' = 'polling';

      if (deps.publicUrl) {
        const hookRes = await fetch(`${deps.telegramApiRoot}/bot${botToken}/setWebhook`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            url: `${deps.publicUrl}/webhooks/telegram/${channelId}`,
            secret_token: deps.telegramWebhookSecret,
            max_connections: 40,
            allowed_updates: [
              'message', 'edited_message', 'message_reaction',
              'business_connection', 'business_message',
              'edited_business_message', 'deleted_business_messages',
            ],
            drop_pending_updates: true,
          }),
        });
        const hook = (await hookRes.json()) as { ok: boolean; description?: string };
        if (!hook.ok) {
          await withTenant(pool, auth.tenantId, async (db) => {
            await db.query(
              `UPDATE channels SET status = 'degraded', last_error = $2 WHERE id = $1`,
              [channelId, JSON.stringify({ setWebhook: hook.description })],
            );
          });
          return reply.code(502).send({
            error: 'webhook_registration_failed',
            detail: hook.description,
          });
        }
        mode = 'webhook';
      } else {
        await fetch(`${deps.telegramApiRoot}/bot${botToken}/deleteWebhook`, { method: 'POST' })
          .catch(() => undefined);
      }

      app.log.info(
        { channelId, bot: bot.username, token: maskSecret(botToken), mode },
        'Канал Telegram подключён из интерфейса',
      );

      return { channelId, username: bot.username, mode };
    },
  );
}
