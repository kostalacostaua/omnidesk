import type { FastifyInstance } from 'fastify';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import {
  NOTIFY_EVENTS,
  decryptJson,
  encryptJson,
  NOTIFY_HINTS,
  NOTIFY_TITLES,
  QUEUE_NOTIFY,
  defaultJobOptions,
  isNotifyEvent,
  jobKey,
  withSystem,
  withTenant,
  type NotifyEvent,
  type NotifyJob,
  type NotifyPayload,
  type Pool,
} from '@omnidesk/core';

/**
 * Настройка оповещений и подписка браузера на пуш.
 *
 * Оповещение уходит туда, куда человек и так смотрит: в группу
 * Telegram, пушем в браузер, письмом. Отправляют воркеры — здесь только
 * настройка и приём подписок.
 *
 * Телеграм-адресат не хранит токен бота: он ссылается на уже
 * подключённый канал. Бот и так заведён, токен и так зашифрован ключом
 * компании, а второй экземпляр того же секрета — это второе место,
 * откуда он может утечь.
 *
 * Про ключи VAPID. Пуш подписывается парой ключей: публичный уходит в
 * браузер, приватный остаётся на сервере. Если их нет в переменных
 * окружения, пуш не притворяется работающим — интерфейс честно говорит,
 * что канал не настроен, и показывает, чем это лечится.
 */

interface NotifyDeps {
  pool: Pool;
  connection: Redis;
  masterKey: Buffer;
  requireAuth: (req: unknown) => { tenantId: string; userId: string } | null;
  log: (level: string, msg: string, extra?: Record<string, unknown>) => void;
}

const auth401 = { error: 'unauthorized' };

interface TargetBody {
  kind?: string;
  /** Токен собственного бота адресата. Наружу не возвращается. */
  token?: string;
  title?: string;
  config?: Record<string, unknown>;
  events?: string[];
  isActive?: boolean;
}

interface PushBody {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
}

const KINDS = ['telegram', 'email', 'push'];

export interface NotifyApi {
  /** Оповестить о заявке с промо-страницы. Вызывает обработчик /leads. */
  announceLead: (lead: {
    id: string;
    name?: string | null;
    company?: string | null;
    email: string;
    phone?: string | null;
    note?: string | null;
  }) => Promise<void>;
}

/**
 * Проверка настроек адресата.
 *
 * Пустой chat_id или адрес с опечаткой выясняются иначе только в
 * момент, когда оповещение не пришло, — а это ровно тот момент, когда
 * человек на него рассчитывал.
 */
export function checkConfig(
  kind: string,
  config: Record<string, unknown>,
  hasOwnBot = false,
): string | null {
  if (kind === 'telegram') {
    if (!hasOwnBot && !String(config['channelId'] ?? '').trim()) {
      return 'Виберіть бота або вкажіть токен окремого';
    }
    const chat = String(config['chatId'] ?? '').trim();
    if (!chat) return 'Вкажіть ідентифікатор групи';
    // У групп он отрицательный и длинный, у канала — начинается с -100.
    // Числом он быть обязан: @username работает только у публичных
    // каналов, и молча не работать для групп — худший из вариантов.
    if (!/^-?\d+$/.test(chat)) return 'Ідентифікатор групи — це число, наприклад -4846124329';
    return null;
  }
  if (kind === 'email') {
    const to = String(config['to'] ?? '').trim();
    if (!to) return 'Вкажіть адресу пошти';
    const bad = to
      .split(/[,;\s]+/)
      .filter(Boolean)
      .find((a) => !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(a));
    return bad ? `Некоректна адреса: ${bad}` : null;
  }
  return null;
}

/** Только известные события: чужая строка в списке — молчащая подписка. */
export function cleanEvents(events: unknown): NotifyEvent[] {
  if (!Array.isArray(events)) return [];
  const out: NotifyEvent[] = [];
  for (const e of events) {
    const s = String(e);
    if (isNotifyEvent(s) && !out.includes(s)) out.push(s);
  }
  return out;
}

export function registerNotify(app: FastifyInstance, deps: NotifyDeps): NotifyApi {
  const { pool, connection, masterKey, requireAuth, log } = deps;
  const tgRoot = process.env['TELEGRAM_API_ROOT'] ?? 'https://api.telegram.org';

  const queue = new Queue<NotifyJob>(QUEUE_NOTIFY, {
    connection,
    defaultJobOptions: { ...defaultJobOptions, attempts: 3 },
  });

  const vapidPublic = process.env['VAPID_PUBLIC_KEY'] ?? '';
  const pushReady = Boolean(vapidPublic && process.env['VAPID_PRIVATE_KEY']);

  /**
   * Поставить оповещение в очередь.
   *
   * Отметка об отправке ставится здесь: повтор той же заявки или второй
   * обход не должны означать второе оповещение.
   */
  async function enqueue(
    tenantId: string,
    event: NotifyEvent,
    payload: NotifyPayload,
    dedup: string,
  ): Promise<boolean> {
    const fresh = await withTenant(pool, tenantId, async (db) => {
      const { rowCount } = await db.query(
        `INSERT INTO notify_sent (tenant_id, dedup_key) VALUES ($1, $2)
         ON CONFLICT (tenant_id, dedup_key) DO NOTHING`,
        [tenantId, dedup],
      );
      return (rowCount ?? 0) > 0;
    });
    if (!fresh) return false;

    await queue.add(
      'notify',
      { tenantId, event, payload, dedupKey: dedup },
      { jobId: jobKey('nt', tenantId, dedup.replace(/[:]/g, '--')) },
    );
    return true;
  }

  /**
   * Заявка с промо-страницы приходит извне и ничьей компании не
   * принадлежит. Оповещать о ней надо нас, поэтому адресат — наша
   * компания: либо заданная переменной, либо самая первая в базе.
   */
  async function ourTenant(): Promise<string | null> {
    const fixed = process.env['NOTIFY_TENANT_ID'];
    if (fixed) return fixed;
    return withSystem(pool, 'наша компания для оповещений', async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `SELECT id FROM tenants ORDER BY created_at LIMIT 1`,
      );
      return rows[0]?.id ?? null;
    });
  }

  /** Оповещение о заявке с сайта. Вызывается из обработчика /leads. */
  async function announceLead(lead: {
    id: string;
    name?: string | null;
    company?: string | null;
    email: string;
    phone?: string | null;
    note?: string | null;
  }): Promise<void> {
    const tenantId = await ourTenant();
    if (!tenantId) return;
    await enqueue(
      tenantId,
      'lead.new',
      {
        who: [lead.name, lead.company].filter(Boolean).join(', ') || null,
        email: lead.email,
        phone: lead.phone ?? null,
        text: lead.note ?? null,
      },
      `lead.new:${lead.id}`,
    );
  }

  // ── Настройки ────────────────────────────────────────────────────

  app.get('/settings/notify', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const data = await withTenant(pool, auth.tenantId, async (db) => {
      const { rows: targets } = await db.query(
        `SELECT id, kind, title, config, events, is_active, last_error, last_sent_at
           FROM notify_targets WHERE tenant_id = $1 ORDER BY created_at`,
        [auth.tenantId],
      );
      const { rows: bots } = await db.query<{ id: string; display_name: string }>(
        `SELECT id, display_name FROM channels
           WHERE tenant_id = $1 AND type IN ('telegram_bot', 'telegram_business')
           ORDER BY display_name`,
        [auth.tenantId],
      );
      const { rows: tenant } = await db.query<{ waiting_alert_minutes: number }>(
        `SELECT waiting_alert_minutes FROM tenants WHERE id = $1`,
        [auth.tenantId],
      );
      const { rows: subs } = await db.query<{ n: string }>(
        `SELECT count(*) AS n FROM push_subscriptions WHERE tenant_id = $1`,
        [auth.tenantId],
      );
      return {
        targets: targets.map((t) => ({
          id: (t as Record<string, unknown>)['id'],
          kind: (t as Record<string, unknown>)['kind'],
          title: (t as Record<string, unknown>)['title'],
          config: (t as Record<string, unknown>)['config'],
          events: (t as Record<string, unknown>)['events'],
          isActive: (t as Record<string, unknown>)['is_active'],
          lastError: (t as Record<string, unknown>)['last_error'],
          lastSentAt: (t as Record<string, unknown>)['last_sent_at'],
        })),
        bots,
        waitingAlertMinutes: tenant[0]?.waiting_alert_minutes ?? 15,
        pushSubscriptions: Number(subs[0]?.n ?? 0),
      };
    });

    return {
      ...data,
      events: NOTIFY_EVENTS.map((e) => ({ id: e, title: NOTIFY_TITLES[e], hint: NOTIFY_HINTS[e] })),
      push: { ready: pushReady, publicKey: pushReady ? vapidPublic : '' },
    };
  });

  /**
   * Кто этот бот.
   *
   * Токен проверяется до сохранения: неверный выясняется иначе только
   * тогда, когда оповещение не пришло, — а это ровно тот момент, когда
   * на него рассчитывали.
   */
  async function botIdentity(token: string): Promise<{ name: string } | { error: string }> {
    try {
      const res = await fetch(`${tgRoot}/bot${token}/getMe`, {
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        result?: { username?: string; first_name?: string };
        description?: string;
      };
      if (!res.ok || !body.ok) {
        return { error: body.description ?? 'Telegram не прийняв токен' };
      }
      const r = body.result ?? {};
      return { name: r.username ? `@${r.username}` : (r.first_name ?? 'бот') };
    } catch {
      return { error: 'Telegram не відповів' };
    }
  }

  /** Токен адресата: свой, если задан, иначе от подключённого канала. */
  async function targetToken(
    tenantId: string,
    targetId: string,
  ): Promise<string | null> {
    return withTenant(pool, tenantId, async (db) => {
      const { rows } = await db.query<{ credentials_enc: Buffer | null; config: Record<string, unknown> }>(
        `SELECT credentials_enc, config FROM notify_targets WHERE id = $1`,
        [targetId],
      );
      const row = rows[0];
      if (!row) return null;
      if (row.credentials_enc) {
        return decryptJson<{ token: string }>(masterKey, tenantId, row.credentials_enc).token;
      }
      const channelId = String(row.config?.['channelId'] ?? '');
      if (!channelId) return null;
      const { rows: ch } = await db.query<{ credentials_enc: Buffer }>(
        `SELECT credentials_enc FROM channels WHERE id = $1`,
        [channelId],
      );
      const enc = ch[0]?.credentials_enc;
      return enc ? decryptJson<{ token: string }>(masterKey, tenantId, enc).token : null;
    });
  }

  /**
   * Какие группы знает бот.
   *
   * Идентификатор группы негде посмотреть в самом Telegram, и это
   * главная причина, по которой оповещения не доводят до конца: человек
   * упирается в поле «chatId» и уходит искать стороннего бота. Здесь мы
   * спрашиваем это у самого Telegram: он помнит последние обновления, а
   * добавление бота в группу — тоже обновление.
   */
  app.post<{ Body: { channelId?: string; token?: string } }>(
    '/settings/notify/telegram/chats',
    async (req, reply) => {
      const auth = requireAuth(req);
      if (!auth) return reply.code(401).send(auth401);

      let token = String(req.body?.token ?? '').trim();
      if (!token) {
        const channelId = String(req.body?.channelId ?? '').trim();
        if (!channelId) return reply.code(400).send({ error: 'no_bot' });
        token = (await withTenant(pool, auth.tenantId, async (db) => {
          const { rows } = await db.query<{ credentials_enc: Buffer }>(
            `SELECT credentials_enc FROM channels
              WHERE id = $1 AND type IN ('telegram_bot', 'telegram_business')`,
            [channelId],
          );
          const enc = rows[0]?.credentials_enc;
          return enc ? decryptJson<{ token: string }>(masterKey, auth.tenantId, enc).token : '';
        })) as string;
        if (!token) return reply.code(404).send({ error: 'bot_not_found' });
      }

      try {
        const res = await fetch(`${tgRoot}/bot${token}/getUpdates?limit=100`, {
          signal: AbortSignal.timeout(10_000),
        });
        const body = (await res.json()) as {
          ok?: boolean;
          description?: string;
          result?: Array<Record<string, { chat?: { id?: number; title?: string; type?: string } }>>;
        };
        if (!res.ok || !body.ok) {
          return reply.code(400).send({
            error: 'telegram_refused',
            detail: body.description ?? 'Telegram не прийняв токен',
          });
        }

        const seen = new Map<string, { id: string; title: string }>();
        for (const update of body.result ?? []) {
          for (const value of Object.values(update)) {
            const chat = (value as { chat?: { id?: number; title?: string; type?: string } })?.chat;
            if (!chat?.id || !chat.type || chat.type === 'private') continue;
            seen.set(String(chat.id), {
              id: String(chat.id),
              title: chat.title ?? String(chat.id),
            });
          }
        }
        return { chats: [...seen.values()] };
      } catch {
        return reply.code(502).send({ error: 'telegram_unreachable' });
      }
    },
  );

  app.post<{ Body: TargetBody }>('/settings/notify', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const kind = String(req.body?.kind ?? '');
    if (!KINDS.includes(kind)) return reply.code(400).send({ error: 'bad_kind' });

    const config = (req.body?.config ?? {}) as Record<string, unknown>;
    const token = String(req.body?.token ?? '').trim();

    const problem = checkConfig(kind, config, Boolean(token));
    if (problem) return reply.code(400).send({ error: 'bad_config', detail: problem });

    // Свой бот проверяется сразу: в настройках должно быть видно, чей
    // это бот, а не голая строка токена.
    let enc: Buffer | null = null;
    if (kind === 'telegram' && token) {
      const who = await botIdentity(token);
      if ('error' in who) return reply.code(400).send({ error: 'bad_token', detail: who.error });
      config['botName'] = who.name;
      delete config['token'];
      enc = encryptJson(masterKey, auth.tenantId, { token });
    }

    const title = String(req.body?.title ?? '').trim().slice(0, 120) ||
      (kind === 'telegram' ? 'Група Telegram' : kind === 'email' ? 'Пошта' : 'Пуш у браузер');

    const row = await withTenant(pool, auth.tenantId, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO notify_targets (tenant_id, kind, title, config, events, credentials_enc)
         VALUES ($1, $2, $3, $4::jsonb, $5::text[], $6) RETURNING id`,
        [auth.tenantId, kind, title, JSON.stringify(config), cleanEvents(req.body?.events), enc],
      );
      return rows[0] ?? null;
    });

    log('info', 'Адресат оповещений добавлен', { tenantId: auth.tenantId, kind });
    return { id: row?.id ?? null };
  });

  app.patch<{ Params: { id: string }; Body: TargetBody }>(
    '/settings/notify/:id',
    async (req, reply) => {
      const auth = requireAuth(req);
      if (!auth) return reply.code(401).send(auth401);

      const current = await withTenant(pool, auth.tenantId, async (db) => {
        const { rows } = await db.query<{
          kind: string;
          config: Record<string, unknown>;
          credentials_enc: Buffer | null;
        }>(
          `SELECT kind, config, credentials_enc FROM notify_targets WHERE id = $1`,
          [req.params.id],
        );
        return rows[0] ?? null;
      });
      if (!current) return reply.code(404).send({ error: 'not_found' });

      const config = req.body?.config
        ? ({ ...current.config, ...req.body.config } as Record<string, unknown>)
        : current.config;
      const token = String(req.body?.token ?? '').trim();

      const problem = checkConfig(
        current.kind,
        config,
        Boolean(token) || Boolean(current.credentials_enc),
      );
      if (problem) return reply.code(400).send({ error: 'bad_config', detail: problem });

      let enc: Buffer | null = null;
      if (current.kind === 'telegram' && token) {
        const who = await botIdentity(token);
        if ('error' in who) return reply.code(400).send({ error: 'bad_token', detail: who.error });
        config['botName'] = who.name;
        delete config['token'];
        enc = encryptJson(masterKey, auth.tenantId, { token });
      }

      await withTenant(pool, auth.tenantId, async (db) => {
        await db.query(
          `UPDATE notify_targets
              SET title = COALESCE($2, title),
                  config = $3::jsonb,
                  events = COALESCE($4::text[], events),
                  is_active = COALESCE($5, is_active),
                  credentials_enc = COALESCE($6, credentials_enc),
                  last_error = NULL
            WHERE id = $1`,
          [
            req.params.id,
            req.body?.title?.trim().slice(0, 120) ?? null,
            JSON.stringify(config),
            req.body?.events ? cleanEvents(req.body.events) : null,
            typeof req.body?.isActive === 'boolean' ? req.body.isActive : null,
            enc,
          ],
        );
      });
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>('/settings/notify/:id', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);
    await withTenant(pool, auth.tenantId, async (db) => {
      await db.query(`DELETE FROM notify_targets WHERE id = $1`, [req.params.id]);
    });
    return { ok: true };
  });

  /** Проверка: уходит мимо подписки на события и мимо отметок о повторе. */
  app.post<{ Params: { id: string } }>('/settings/notify/:id/test', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const exists = await withTenant(pool, auth.tenantId, async (db) => {
      const { rowCount } = await db.query(`SELECT 1 FROM notify_targets WHERE id = $1`, [
        req.params.id,
      ]);
      return (rowCount ?? 0) > 0;
    });
    if (!exists) return reply.code(404).send({ error: 'not_found' });

    const stamp = Date.now();
    await queue.add(
      'test',
      {
        tenantId: auth.tenantId,
        event: 'conversation.new',
        payload: {
          who: 'Перевірка',
          text: 'Тестове оповіщення від Rozmovio. Бачите його — адресат працює.',
        },
        dedupKey: `test:${req.params.id}:${stamp}`,
        targetId: req.params.id,
      },
      { jobId: jobKey('nt', auth.tenantId, 'test', req.params.id, stamp) },
    );
    return { ok: true };
  });

  /**
   * Через сколько минут молчания считать, что клиент ждёт.
   *
   * Живёт рядом с оповещениями, а не в общих настройках: это параметр
   * одного события, и в отрыве от него число бессмысленно.
   */
  app.patch<{ Body: { waitingAlertMinutes?: number } }>('/settings/notify-waiting', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const raw = Number(req.body?.waitingAlertMinutes);
    if (!Number.isFinite(raw) || raw < 0 || raw > 1440) {
      return reply.code(400).send({ error: 'bad_minutes' });
    }
    const minutes = Math.round(raw);

    await withSystem(pool, 'порог ожидания', async (db) => {
      await db.query(`UPDATE tenants SET waiting_alert_minutes = $2 WHERE id = $1`, [
        auth.tenantId, minutes,
      ]);
    });
    return { waitingAlertMinutes: minutes };
  });

  // ── Пуш ──────────────────────────────────────────────────────────

  /**
   * Подписка браузера.
   *
   * Живёт у человека, а не у компании: один и тот же оператор сидит с
   * рабочего компьютера и из дома, и это две разные подписки.
   */
  app.post<{ Body: PushBody }>('/me/push', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const endpoint = String(req.body?.endpoint ?? '').trim();
    const p256dh = String(req.body?.keys?.p256dh ?? '').trim();
    const authKey = String(req.body?.keys?.auth ?? '').trim();
    if (!endpoint.startsWith('https://') || !p256dh || !authKey) {
      return reply.code(400).send({ error: 'bad_subscription' });
    }

    await withTenant(pool, auth.tenantId, async (db) => {
      await db.query(
        `INSERT INTO push_subscriptions (tenant_id, user_id, endpoint, p256dh, auth, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (tenant_id, endpoint) DO UPDATE
           SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, user_id = EXCLUDED.user_id`,
        [
          auth.tenantId,
          auth.userId,
          endpoint,
          p256dh,
          authKey,
          String(req.headers['user-agent'] ?? '').slice(0, 200),
        ],
      );
    });
    return { ok: true };
  });

  app.delete<{ Body: PushBody }>('/me/push', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);
    const endpoint = String(req.body?.endpoint ?? '').trim();
    await withTenant(pool, auth.tenantId, async (db) => {
      await db.query(
        endpoint
          ? `DELETE FROM push_subscriptions WHERE tenant_id = $1 AND endpoint = $2`
          : `DELETE FROM push_subscriptions WHERE tenant_id = $1 AND user_id = $2`,
        [auth.tenantId, endpoint || auth.userId],
      );
    });
    return { ok: true };
  });

  /**
   * Служебный сценарий браузера.
   *
   * Отдаётся отдельным адресом и без авторизации: браузер запрашивает
   * его сам, своим запросом, и куки туда не кладёт. Ничего секретного
   * внутри нет — только показ уведомления и переход по ссылке.
   */
  app.get('/sw.js', async (_req, reply) =>
    reply
      .type('application/javascript; charset=utf-8')
      .header('cache-control', 'no-store')
      .send(SERVICE_WORKER),
  );

  return { announceLead };
}

/**
 * Сценарий службы: показать уведомление и открыть диалог по щелчку.
 *
 * Обратных слэшей здесь нет намеренно — файл целиком попадает в
 * шаблонную строку при сборке страницы инбокса.
 */
const SERVICE_WORKER = `
self.addEventListener('push', function(event){
  var data = {};
  try { data = event.data ? event.data.json() : {} } catch (e) { data = {} }
  var title = data.title || 'Rozmovio';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    tag: data.link || title,
    data: { link: data.link || '/' }
  }));
});

self.addEventListener('notificationclick', function(event){
  event.notification.close();
  var link = (event.notification.data && event.notification.data.link) || '/';
  event.waitUntil(self.clients.matchAll({ type:'window', includeUncontrolled:true }).then(function(list){
    for (var i = 0; i < list.length; i++){
      if (list[i].url.indexOf(self.registration.scope) === 0){
        list[i].navigate(link);
        return list[i].focus();
      }
    }
    return self.clients.openWindow(link);
  }));
});
`;
