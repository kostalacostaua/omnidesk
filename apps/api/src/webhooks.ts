import type { FastifyInstance } from 'fastify';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  HOOK_EVENTS,
  HOOK_HINTS,
  HOOK_TITLES,
  badHookHeader,
  badOutUrl,
  cleanHookEvents,
  decryptJson,
  encryptJson,
  hookBody,
  hookHeaders,
  withTenant,
  writeHookDelivery,
  type HookAuth,
  type Pool,
  type WebhookJob,
} from '@omnidesk/core';

/**
 * Вебхуки клиента: настройка и журнал.
 *
 * Отправляют воркеры — здесь только подписка, ключи и то, что человек
 * смотрит, когда приём у него не работает.
 *
 * Секрет показывается один раз, при создании и при перевыпуске.
 * Хранить его так, чтобы можно было показать второй раз, значит
 * хранить его в виде, пригодном для чтения, — а он подписывает
 * события, и второй экземпляр это второе место, откуда он утечёт.
 *
 * Проверка вебхука («перевірити») стучится сразу, а не через очередь:
 * человек стоит у кнопки и ждёт ответа чужого сервера именно сейчас.
 * Настоящие события идут очередью с повторами — там ждать некому.
 */

interface WebhookDeps {
  pool: Pool;
  masterKey: Buffer;
  requireAuth: (req: unknown) => { tenantId: string; userId: string } | null;
  /** Очередь доставки: сюда уходят повторы из журнала и живые события. */
  enqueue: (job: WebhookJob) => Promise<unknown>;
  log: (level: string, msg: string, extra?: Record<string, unknown>) => void;
}

const auth401 = { error: 'unauthorized' };

interface HookBodyIn {
  title?: string;
  url?: string;
  events?: unknown;
  isActive?: boolean;
  headerName?: string;
  headerValue?: string;
}

interface HookRow {
  id: string;
  title: string;
  url: string;
  events: string[];
  is_active: boolean;
  last_error: string | null;
  last_ok_at: string | null;
  created_at: string;
  secret_enc: Buffer;
}

/** Секрет подписи. Длиннее человеческого пароля, потому что его не набирают руками. */
function newSecret(): string {
  return 'whsec_' + randomBytes(32).toString('hex');
}

export function registerWebhooks(app: FastifyInstance, deps: WebhookDeps): void {
  const { pool, masterKey, requireAuth, enqueue, log } = deps;

  const view = (r: HookRow, auth: HookAuth): Record<string, unknown> => ({
    id: r.id,
    title: r.title,
    url: r.url,
    events: r.events,
    isActive: r.is_active,
    lastError: r.last_error,
    lastOkAt: r.last_ok_at,
    createdAt: r.created_at,
    // Имя заголовка показываем, значение — нет: это такой же ключ, как
    // и секрет, просто выданный клиентом себе самому.
    headerName: auth.headerName ?? '',
    hasHeader: !!(auth.headerName && auth.headerValue),
  });

  const readAuth = (tenantId: string, enc: Buffer): HookAuth =>
    decryptJson<HookAuth>(masterKey, tenantId, enc);

  /** Список вебхуков и словарь событий: переключатели рисуются по нему. */
  app.get('/settings/webhooks', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const rows = await withTenant(pool, auth.tenantId, async (db) => {
      const { rows } = await db.query<HookRow>(
        `SELECT id, title, url, events, is_active, last_error, last_ok_at, created_at, secret_enc
           FROM webhooks ORDER BY created_at`,
      );
      return rows;
    });

    return {
      webhooks: rows.map((r) => view(r, readAuth(auth.tenantId, r.secret_enc))),
      events: HOOK_EVENTS.map((e) => ({ id: e, title: HOOK_TITLES[e], hint: HOOK_HINTS[e] })),
    };
  });

  app.post<{ Body: HookBodyIn }>('/settings/webhooks', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const url = String(req.body?.url ?? '').trim();
    const bad = badOutUrl(url);
    if (bad) return reply.code(400).send({ error: 'bad_url', detail: bad });

    const headerName = String(req.body?.headerName ?? '').trim();
    const headerValue = String(req.body?.headerValue ?? '').trim();
    const badHead = badHookHeader(headerName, headerValue);
    if (badHead) return reply.code(400).send({ error: 'bad_header', detail: badHead });

    const events = cleanHookEvents(req.body?.events);
    if (!events.length) return reply.code(400).send({ error: 'no_events' });

    const id = randomUUID();
    const secret = newSecret();
    const title = String(req.body?.title ?? '').trim().slice(0, 80);

    await withTenant(pool, auth.tenantId, async (db) => {
      await db.query(
        `INSERT INTO webhooks (id, tenant_id, title, url, secret_enc, events, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, true)`,
        [
          id,
          auth.tenantId,
          title,
          url,
          encryptJson(masterKey, auth.tenantId, {
            secret,
            ...(headerName && headerValue ? { headerName, headerValue } : {}),
          }),
          events,
        ],
      );
    });

    log('info', 'Вебхук создан', { webhookId: id });
    // Единственный раз, когда секрет уходит наружу.
    return { id, secret };
  });

  app.patch<{ Params: { id: string }; Body: HookBodyIn }>(
    '/settings/webhooks/:id',
    async (req, reply) => {
      const auth = requireAuth(req);
      if (!auth) return reply.code(401).send(auth401);

      const has = (k: keyof HookBodyIn): boolean =>
        Object.prototype.hasOwnProperty.call(req.body ?? {}, k);

      const url = String(req.body?.url ?? '').trim();
      if (has('url')) {
        const bad = badOutUrl(url);
        if (bad) return reply.code(400).send({ error: 'bad_url', detail: bad });
      }

      const headerName = String(req.body?.headerName ?? '').trim();
      const headerValue = String(req.body?.headerValue ?? '').trim();
      if (has('headerName') || has('headerValue')) {
        const badHead = badHookHeader(headerName, headerValue);
        if (badHead) return reply.code(400).send({ error: 'bad_header', detail: badHead });
      }

      const events = cleanHookEvents(req.body?.events);
      if (has('events') && !events.length) return reply.code(400).send({ error: 'no_events' });

      const done = await withTenant(pool, auth.tenantId, async (db) => {
        const { rows } = await db.query<{ secret_enc: Buffer }>(
          `SELECT secret_enc FROM webhooks WHERE id = $1`,
          [req.params.id],
        );
        const row = rows[0];
        if (!row) return false;

        const old = readAuth(auth.tenantId, row.secret_enc);
        /*
         * Заголовок правится вместе с именем и значением: пустое имя —
         * это «убрать», а не «оставить как было». Секрет при этом не
         * трогаем — он перевыпускается отдельной кнопкой.
         */
        const next: HookAuth =
          has('headerName') || has('headerValue')
            ? {
                secret: old.secret,
                ...(headerName && headerValue ? { headerName, headerValue } : {}),
              }
            : old;

        await db.query(
          /*
           * Типы у параметров названы явно: пустое поле здесь означает
           * «не трогали», и без приведения Postgres не знает, чем
           * считать NULL в COALESCE.
           */
          `UPDATE webhooks
              SET title = COALESCE($2::text, title),
                  url = COALESCE($3::text, url),
                  events = COALESCE($4::text[], events),
                  is_active = COALESCE($5::boolean, is_active),
                  secret_enc = $6,
                  last_error = CASE WHEN COALESCE($5::boolean, is_active)
                                    THEN last_error ELSE NULL END
            WHERE id = $1`,
          [
            req.params.id,
            has('title') ? String(req.body?.title ?? '').trim().slice(0, 80) : null,
            has('url') ? url : null,
            has('events') ? events : null,
            has('isActive') ? req.body?.isActive === true : null,
            encryptJson(masterKey, auth.tenantId, next),
          ],
        );
        return true;
      });

      if (!done) return reply.code(404).send({ error: 'not_found' });
      return { ok: true };
    },
  );

  /** Перевыпуск секрета: старый перестаёт подходить сразу. */
  app.post<{ Params: { id: string } }>('/settings/webhooks/:id/secret', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const secret = newSecret();
    const done = await withTenant(pool, auth.tenantId, async (db) => {
      const { rows } = await db.query<{ secret_enc: Buffer }>(
        `SELECT secret_enc FROM webhooks WHERE id = $1`,
        [req.params.id],
      );
      const row = rows[0];
      if (!row) return false;
      const old = readAuth(auth.tenantId, row.secret_enc);
      await db.query(`UPDATE webhooks SET secret_enc = $2 WHERE id = $1`, [
        req.params.id,
        encryptJson(masterKey, auth.tenantId, { ...old, secret }),
      ]);
      return true;
    });

    if (!done) return reply.code(404).send({ error: 'not_found' });
    return { secret };
  });

  app.delete<{ Params: { id: string } }>('/settings/webhooks/:id', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);
    await withTenant(pool, auth.tenantId, async (db) => {
      await db.query(`DELETE FROM webhooks WHERE id = $1`, [req.params.id]);
    });
    return { ok: true };
  });

  /**
   * Проверка: постучаться прямо сейчас и показать, что ответили.
   *
   * Событие называется ping и в подписку не входит: это не то, что
   * случилось у клиента, а вопрос «ты меня слышишь». Разбор на той
   * стороне должен уметь его пропустить, и лучше узнать об этом здесь.
   */
  app.post<{ Params: { id: string } }>('/settings/webhooks/:id/test', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const row = await withTenant(pool, auth.tenantId, async (db) => {
      const { rows } = await db.query<{ url: string; secret_enc: Buffer }>(
        `SELECT url, secret_enc FROM webhooks WHERE id = $1`,
        [req.params.id],
      );
      return rows[0] ?? null;
    });
    if (!row) return reply.code(404).send({ error: 'not_found' });

    const deliveryId = randomUUID();
    const body = hookBody(auth.tenantId, 'ping', { hello: 'rozmovio' });
    const text = JSON.stringify(body);

    let status: number | null = null;
    let error: string | null = null;
    try {
      const res = await fetch(row.url, {
        method: 'POST',
        headers: hookHeaders(readAuth(auth.tenantId, row.secret_enc), 'ping', deliveryId, text),
        body: text,
        signal: AbortSignal.timeout(10_000),
      });
      status = res.status;
      if (!res.ok) error = 'Сервер відповів ' + res.status;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    await writeHookDelivery(pool, auth.tenantId, {
      id: deliveryId,
      webhookId: req.params.id,
      event: 'ping',
      status,
      error,
      body,
    });

    return { status, error, deliveryId };
  });

  /** Последние попытки: журнал, по которому чинят приём у себя. */
  app.get<{ Params: { id: string } }>('/settings/webhooks/:id/deliveries', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const rows = await withTenant(pool, auth.tenantId, async (db) => {
      const { rows } = await db.query(
        `SELECT id, event, status, error, tries, created_at
           FROM webhook_deliveries WHERE webhook_id = $1
          ORDER BY created_at DESC LIMIT 50`,
        [req.params.id],
      );
      return rows;
    });
    return { deliveries: rows };
  });

  /** Повтор: то же тело, новый номер доставки. */
  app.post<{ Params: { id: string; did: string } }>(
    '/settings/webhooks/:id/deliveries/:did/retry',
    async (req, reply) => {
      const auth = requireAuth(req);
      if (!auth) return reply.code(401).send(auth401);

      const row = await withTenant(pool, auth.tenantId, async (db) => {
        const { rows } = await db.query<{ event: string; body: unknown }>(
          `SELECT event, body FROM webhook_deliveries WHERE id = $1 AND webhook_id = $2`,
          [req.params.did, req.params.id],
        );
        return rows[0] ?? null;
      });
      if (!row) return reply.code(404).send({ error: 'not_found' });

      const deliveryId = randomUUID();
      await enqueue({
        tenantId: auth.tenantId,
        webhookId: req.params.id,
        deliveryId,
        event: row.event,
        body: row.body,
      });
      return { deliveryId };
    },
  );
}
