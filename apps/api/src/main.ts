import Fastify, { type FastifyReply } from 'fastify';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import {
  QUEUE_OUTBOUND,
  QUEUE_MEDIA,
  assertRlsIntegrity,
  canSendFreeform,
  createPool,
  createStorage,
  mediaKey,
  defaultJobOptions,
  jobKey,
  encryptJson,
  maskSecret,
  parseMasterKey,
  verifyZohoWidgetSignature,
  withSystem,
  withTenant,
  type ChannelType,
  type OutboundJob,
  type MediaJob,
} from '@omnidesk/core';
import { INBOX_HTML, UI_BUILD } from './ui.js';
import { registerSettings } from './settings.js';
import { registerInbox } from './inbox.js';
import { registerEmailAuth } from './auth-email.js';
import { createMailer } from './mailer.js';

const PORT = Number(process.env.PORT ?? 3000);
const DATABASE_URL = process.env.DATABASE_URL ?? '';
const PUBLIC_URL = process.env.PUBLIC_URL ?? '';
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';
const TELEGRAM_API_ROOT = process.env.TELEGRAM_API_ROOT ?? 'https://api.telegram.org';
const ZOHO_WIDGET_SHARED_SECRET = process.env.ZOHO_WIDGET_SHARED_SECRET ?? '';
const JWT_SECRET = process.env.JWT_SECRET ?? '';

const pool = createPool(DATABASE_URL);
const masterKey = parseMasterKey(process.env.ENCRYPTION_MASTER_KEY);

// family: 0 — внутренняя сеть Railway отдаёт адреса по IPv6, а ioredis
// по умолчанию ищет только IPv4 и не находит Redis.
const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
  maxRetriesPerRequest: null,
  family: 0,
});
const outboundQueue = new Queue<OutboundJob>(QUEUE_OUTBOUND, {
  connection: redis,
  defaultJobOptions,
});
/** Очередь скачивания: сюда идёт кнопка «повторить» у зависшего вложения. */
const mediaQueue = new Queue<MediaJob>(QUEUE_MEDIA, {
  connection: redis,
  defaultJobOptions,
});
const storage = createStorage();

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'req.body.token', 'req.body.password'],
      remove: true,
    },
  },
  trustProxy: true,
});

// ─────────────────────────────────────────────────────────────────────────
// Минимальный JWT (HS256). В проде возьмите библиотеку — здесь показан
// принцип: токен живёт 15 минут и держится в памяти вкладки, не в cookie
// (виджет работает в iframe Zoho, third-party cookies убьёт Safari ITP)
// и не в localStorage (XSS).
// ─────────────────────────────────────────────────────────────────────────

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function signJwt(payload: Record<string, unknown>, ttlSeconds: number): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64url(JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds }));
  const sig = createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyJwt(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts as [string, string, string];

  const expected = createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>;
    const exp = payload['exp'];
    if (typeof exp !== 'number' || exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

interface AuthedRequest {
  tenantId: string;
  userId: string;
}

function requireAuth(req: { headers: Record<string, unknown> }): AuthedRequest | null {
  const header = req.headers['authorization'];
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  const payload = verifyJwt(header.slice(7));
  if (!payload) return null;
  const tenantId = payload['tid'];
  const userId = payload['sub'];
  if (typeof tenantId !== 'string' || typeof userId !== 'string') return null;
  return { tenantId, userId };
}

// ─────────────────────────────────────────────────────────────────────────

registerInbox(app, { pool, requireAuth: (req) => requireAuth(req as never) });

registerEmailAuth(app, {
  pool,
  // Семь дней: смена не такая частая, чтобы просить код каждый день,
  // и не такая долгая, чтобы забытая вкладка жила месяцами.
  issueToken: (tenantId, userId) => signJwt({ sub: userId, tid: tenantId }, 7 * 24 * 3600),
  mailer: createMailer(process.env, (line) => app.log.info(line)),
  appName: process.env['APP_NAME'] ?? 'OmniDesk',
});

registerSettings(app, {
  pool,
  masterKey,
  requireAuth: (req) => requireAuth(req as never),
  telegramApiRoot: TELEGRAM_API_ROOT,
  publicUrl: PUBLIC_URL,
  telegramWebhookSecret: TELEGRAM_WEBHOOK_SECRET,
});

app.get('/health', async () => ({ status: 'ok' }));

/**
 * Инбокс. Отдаётся тем же процессом, что и API — отдельного фронтенда,
 * сборки и деплоя на этом этапе нет и не нужно.
 *
 * Страница не содержит секретов: токен вводит человек, он живёт
 * в sessionStorage вкладки и на сервер как часть страницы не попадает.
 */
/**
 * no-store здесь не перестраховка. Страница отдаётся под одним и тем же
 * адресом при каждом обновлении кода: имени файла с хэшем, как у сборщиков,
 * тут нет. Без этого заголовка браузер держит старую версию, а человек
 * видит ошибку, которую вы уже исправили, — и чинит несуществующее.
 */
const sendUi = async (_req: unknown, reply: FastifyReply) =>
  reply
    .type('text/html; charset=utf-8')
    .header('cache-control', 'no-store, must-revalidate')
    .send(INBOX_HTML);

app.get('/', sendUi);
app.get('/app', sendUi);

// Браузер всегда просит favicon. Без этой строки в консоли висит 404,
// который потом маскирует настоящие ошибки при отладке.
app.get('/favicon.ico', async (_req, reply) => reply.code(204).send());

/**
 * Выдача сессии виджету Zoho CRM.
 *
 * ⚠️ Это самое важное место в системе с точки зрения безопасности.
 *
 * Запрос приходит НЕ из браузера, а от Deluge-функции расширения, которая
 * выполняется на серверах Zoho. Только там доступен crmAPIRequest.user_info —
 * единственный источник личности пользователя, который нельзя подделать
 * из браузера.
 *
 * ZOHO.CRM.CONFIG.getCurrentUser() на бэкенде доверять НЕЛЬЗЯ: это JavaScript
 * в iframe, и подставить чужой userId — вопрос пяти секунд в DevTools.
 * Это дыра №1 в интеграциях такого рода.
 *
 * Deluge-функция обязана сама проверить, что auth_type == "oauth":
 * при вызове по API-ключу Zoho подставляет в user_info данные СУПЕР-АДМИНА,
 * а не вызывающего пользователя.
 */
app.post('/zoho/session', async (req, reply) => {
  const body = req.body as { payload?: string; sig?: string };

  if (!body?.payload || !body?.sig) {
    return reply.code(400).send({ error: 'bad_request' });
  }

  let parsed: { zuid?: string; org?: string; email?: string; ts?: number; nonce?: string };
  try {
    parsed = JSON.parse(body.payload);
  } catch {
    return reply.code(400).send({ error: 'bad_payload' });
  }

  const verdict = verifyZohoWidgetSignature(
    body.payload,
    body.sig,
    ZOHO_WIDGET_SHARED_SECRET,
    { timestamp: parsed.ts, maxSkewSeconds: 300 },
  );

  if (!verdict.ok) {
    app.log.warn({ ip: req.ip, reason: verdict.reason }, 'Отклонён запрос сессии виджета Zoho');
    return reply.code(401).send({ error: 'unauthorized' });
  }

  if (!parsed.zuid || !parsed.org) {
    return reply.code(400).send({ error: 'incomplete_user_info' });
  }

  // Находим установку по org id Zoho. Читаем таблицу маршрутизации:
  // тенант ещё неизвестен, а zoho_installations под RLS.
  const found = await withSystem(pool, 'маршрутизация по org id Zoho', async (db) => {
    const { rows } = await db.query<{ tenant_id: string }>(
      `SELECT tenant_id FROM zoho_org_routes WHERE zgid = $1 AND status = 'active' LIMIT 1`,
      [parsed.org],
    );
    return rows[0] ?? null;
  });

  if (!found) {
    return reply.code(404).send({ error: 'installation_not_found' });
  }

  const user = await withTenant(pool, found.tenant_id, async (db) => {
    const { rows } = await db.query<{ id: string; role: string }>(
      `SELECT id, role FROM users WHERE tenant_id = $1 AND zoho_zuid = $2 AND is_active LIMIT 1`,
      [found.tenant_id, parsed.zuid],
    );
    return rows[0] ?? null;
  });

  if (!user) {
    return reply.code(403).send({ error: 'user_not_provisioned' });
  }

  const token = signJwt({ sub: user.id, tid: found.tenant_id, role: user.role, src: 'zoho' }, 900);
  return { token, expiresIn: 900 };
});

/**
 * Подключение Telegram-бота.
 *
 * Токен шифруется ключом тенанта до записи в БД и никогда не логируется
 * целиком — только последние 4 символа, чтобы можно было понять, тот ли это
 * бот, не раскрывая сам токен.
 */
app.post('/channels/telegram', async (req, reply) => {
  const auth = requireAuth(req as never);
  if (!auth) return reply.code(401).send({ error: 'unauthorized' });

  const body = req.body as { botToken?: string; displayName?: string };
  if (!body?.botToken || !/^\d+:[A-Za-z0-9_-]{30,}$/.test(body.botToken)) {
    return reply.code(400).send({ error: 'invalid_bot_token' });
  }

  // Проверяем токен у Telegram и заодно получаем данные бота.
  const meRes = await fetch(`${TELEGRAM_API_ROOT}/bot${body.botToken}/getMe`);
  const me = (await meRes.json()) as { ok: boolean; result?: { id: number; username?: string } };

  if (!me.ok || !me.result) {
    return reply.code(400).send({ error: 'telegram_rejected_token' });
  }

  const externalId = String(me.result.id);

  // Подключение должно быть ИДЕМПОТЕНТНЫМ.
  //
  // Раньше здесь был простой INSERT, и это ломалось так: канал записывался,
  // затем падал setWebhook, ручка возвращала ошибку — а строка оставалась.
  // Повторная попытка упиралась в UNIQUE (type, external_id), и подключить
  // канал становилось невозможно вообще. Пользователь видел «duplicate key»
  // и не мог ничего сделать.
  //
  // Отдельно важно, ЧЕЙ это канал. UNIQUE здесь глобальный: один бот
  // принадлежит ровно одному тенанту. Если номер уже занят другим клиентом —
  // это не ошибка базы, а попытка перехвата чужого канала, и отвечать надо
  // осмысленно, а не 500-й.
  const owner = await withSystem(pool, 'проверка владельца канала', async (db) => {
    const { rows } = await db.query<{ channel_id: string; tenant_id: string }>(
      `SELECT channel_id, tenant_id FROM channel_routes
        WHERE channel_type = 'telegram_bot' AND external_id = $1 LIMIT 1`,
      [externalId],
    );
    return rows[0] ?? null;
  });

  if (owner && owner.tenant_id !== auth.tenantId) {
    app.log.warn(
      { externalId, requestedBy: auth.tenantId },
      'Попытка подключить бота, уже привязанного к другому тенанту',
    );
    return reply.code(409).send({
      error: 'channel_belongs_to_another_tenant',
      detail: 'Этот бот уже подключён в другом аккаунте. Отключите его там или возьмите другого бота.',
    });
  }

  const channelId = owner?.channel_id ?? randomUUID();

  await withTenant(pool, auth.tenantId, async (db) => {
    await db.query(
      `INSERT INTO channels (id, tenant_id, type, display_name, external_id, credentials_enc, meta, status)
       VALUES ($1, $2, 'telegram_bot', $3, $4, $5, $6, 'active')
       ON CONFLICT (type, external_id) DO UPDATE
         SET display_name    = EXCLUDED.display_name,
             credentials_enc = EXCLUDED.credentials_enc,
             meta            = EXCLUDED.meta,
             status          = 'active',
             last_error      = NULL`,
      [
        channelId,
        auth.tenantId,
        body.displayName ?? me.result!.username ?? 'Telegram',
        externalId,
        encryptJson(masterKey, auth.tenantId, { botToken: body.botToken }),
        JSON.stringify({ username: me.result!.username }),
      ],
    );
  });

  // Два режима приёма сообщений, и выбирается он наличием публичного адреса.
  //
  //   PUBLIC_URL задан  → вебхук: Telegram стучится к нам снаружи.
  //   PUBLIC_URL пуст   → polling: сервис poller сам опрашивает Telegram.
  //
  // Второй режим нужен на машине разработчика, где публичного адреса нет,
  // а туннель не везде поднимается — его режут корпоративные сети,
  // антивирусы и часть провайдеров. Для воркеров и базы разницы никакой:
  // апдейты попадают в одну и ту же очередь.
  if (!PUBLIC_URL) {
    // Вебхук и polling взаимоисключающи: при активном вебхуке getUpdates
    // вернёт 409 Conflict. Снимаем оставшийся с прошлых запусков.
    await fetch(`${TELEGRAM_API_ROOT}/bot${body.botToken}/deleteWebhook`, { method: 'POST' })
      .catch(() => undefined);

    app.log.info(
      { channelId, bot: me.result.username, token: maskSecret(body.botToken) },
      'Telegram-канал подключён в режиме polling (PUBLIC_URL не задан)',
    );
    return { channelId, username: me.result.username, mode: 'polling' as const };
  }

  // Регистрируем вебхук. secret_token — единственная встроенная
  // аутентификация вебхука Telegram, без него любой может слать вам апдейты.
  const webhookUrl = `${PUBLIC_URL}/webhooks/telegram/${channelId}`;
  const hookRes = await fetch(`${TELEGRAM_API_ROOT}/bot${body.botToken}/setWebhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: TELEGRAM_WEBHOOK_SECRET,
      max_connections: 40,
      allowed_updates: [
        'message',
        'edited_message',
        'message_reaction',
        'business_connection',
        'business_message',
        'edited_business_message',
        'deleted_business_messages',
      ],
      drop_pending_updates: true,
    }),
  });
  const hook = (await hookRes.json()) as { ok: boolean; description?: string };

  app.log.info(
    { channelId, bot: me.result.username, token: maskSecret(body.botToken), webhookOk: hook.ok },
    'Telegram-канал подключён',
  );

  if (!hook.ok) {
    await withTenant(pool, auth.tenantId, async (db) => {
      await db.query(
        `UPDATE channels SET status = 'degraded', last_error = $2 WHERE id = $1`,
        [channelId, JSON.stringify({ setWebhook: hook.description })],
      );
    });
    return reply.code(502).send({ error: 'webhook_registration_failed', detail: hook.description });
  }

  return { channelId, username: me.result.username, webhookUrl, mode: 'webhook' as const };
});

/** Список диалогов. Изоляция обеспечивается RLS, а не этим запросом. */
/** Лента одного диалога. */
app.get<{ Params: { id: string } }>('/conversations/:id/messages', async (req, reply) => {
  const auth = requireAuth(req as never);
  if (!auth) return reply.code(401).send({ error: 'unauthorized' });

  const rows = await withTenant(pool, auth.tenantId, async (db) => {
    // Фильтра по tenant_id здесь намеренно нет: его ставит RLS.
    // Чужой conversationId просто вернёт пустой список, а не чужую переписку.
    const { rows } = await db.query(
      // Цитата подтягивается тем же запросом. Отдельный поход за
      // каждым процитированным сообщением превратил бы открытие диалога
      // в двадцать запросов вместо одного.
      `SELECT m.id, m.direction, m.sender_type, m.content, m.status,
              m.sent_at, m.failure, m.reactions, m.external_id,
              q.id                AS reply_to_id,
              q.content->>'text'  AS reply_to_text,
              q.direction         AS reply_to_direction
         FROM messages m
         LEFT JOIN messages q
                ON q.channel_id  = m.channel_id
               AND q.external_id = m.content->>'replyToExternalId'
        WHERE m.conversation_id = $1
        ORDER BY m.sent_at ASC
        LIMIT 200`,
      [req.params.id],
    );
    return rows;
  });

  return { messages: rows };
});

/**
 * Аватар контакта.
 *
 * Отдаётся тем же способом, что и вложения: через RLS, без явной
 * проверки тенанта в коде. Чужой идентификатор просто не найдётся.
 *
 * Заголовок кэша здесь длинный намеренно. Аватар меняется раз в год,
 * а список диалогов перерисовывается постоянно — без кэша браузер
 * дёргал бы по запросу на каждого собеседника при каждом обновлении.
 */
app.get<{ Params: { contactId: string } }>('/avatars/:contactId', async (req, reply) => {
  const auth = requireAuth(req as never);
  if (!auth) return reply.code(401).send({ error: 'unauthorized' });

  const key = await withTenant(pool, auth.tenantId, async (db) => {
    const { rows } = await db.query<{ avatar_url: string | null }>(
      `SELECT avatar_url FROM contacts WHERE id = $1`,
      [req.params.contactId],
    );
    return rows[0]?.avatar_url ?? null;
  });

  if (!key) return reply.code(404).send({ error: 'no_avatar' });

  const file = await storage.get(key);
  if (!file) return reply.code(404).send({ error: 'not_found' });

  return reply
    .type(file.contentType || 'image/jpeg')
    .header('cache-control', 'private, max-age=86400')
    .send(file.body);
});

/**
 * Повторная загрузка вложения.
 *
 * Нужна из-за реальной последовательности событий: сообщение с файлом
 * могло прийти, когда воркер вложений ещё не работал или не имел доступа
 * наружу. Задача на скачивание в этом случае не создавалась вовсе, и файл
 * навсегда остаётся в состоянии «загружается» — сам он не подтянется.
 *
 * jobId намеренно с суффиксом времени: обычный ключ «сообщение:индекс»
 * BullMQ считает дубликатом уже выполненной задачи и молча отбрасывает,
 * то есть кнопка «повторить» не делала бы ничего.
 */
app.post<{ Params: { messageId: string; index: string } }>(
  '/media/:messageId/:index/retry',
  async (req, reply) => {
    const auth = requireAuth(req as never);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });

    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0) {
      return reply.code(400).send({ error: 'bad_index' });
    }

    const row = await withTenant(pool, auth.tenantId, async (db) => {
      const { rows } = await db.query<{
        channel_id: string;
        external_id: string | null;
        channel_type: string;
      }>(
        `SELECT m.channel_id,
                -- ::int обязателен. Без него Postgres трактует параметр
                -- как ТЕКСТ и ищет в массиве ключ «0», которого там нет:
                -- в ответ приходит NULL, а вложение выглядит потерянным.
                m.content->'attachments'->($2)::int->>'externalId' AS external_id,
                ch.type AS channel_type
           FROM messages m
           JOIN channels ch ON ch.id = m.channel_id
          WHERE m.id = $1
          LIMIT 1`,
        [req.params.messageId, index],
      );
      return rows[0] ?? null;
    });

    if (!row) return reply.code(404).send({ error: 'not_found' });
    if (!row.external_id) return reply.code(409).send({ error: 'no_file_reference' });

    await mediaQueue.add(
      'download',
      {
        tenantId: auth.tenantId,
        channelId: row.channel_id,
        messageId: req.params.messageId,
        attachmentIndex: index,
        provider: row.channel_type.startsWith('telegram') ? 'telegram' : 'meta',
        externalId: row.external_id,
      },
      // Время в ключе намеренно: без него BullMQ считает задачу
      // дубликатом уже выполненной и молча её отбрасывает.
      { jobId: jobKey(req.params.messageId, index, 'retry', Date.now()) },
    );

    return reply.code(202).send({ queued: true });
  },
);

/**
 * Реакция оператора на сообщение.
 *
 * emoji = null снимает реакцию. Отдельная ручка, а не поле сообщения:
 * реакция ставится на ЧУЖОЕ сообщение, и своей записи в ленте у неё нет.
 *
 * Ответ 202, а не 200: к моменту ответа реакция ещё не у клиента,
 * она только поставлена в очередь. Обещать больше, чем сделано, —
 * верный способ получить «нажал, ничего не произошло».
 */
app.post<{ Params: { id: string }; Body: { emoji?: string | null } }>(
  '/messages/:id/reactions',
  async (req, reply) => {
    const auth = requireAuth(req as never);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });

    const emoji = req.body?.emoji ?? null;
    if (emoji !== null && (typeof emoji !== 'string' || emoji.length > 16)) {
      return reply.code(400).send({ error: 'bad_emoji' });
    }

    const row = await withTenant(pool, auth.tenantId, async (db) => {
      const { rows } = await db.query<{
        channel_id: string;
        conversation_id: string;
        external_id: string | null;
      }>(
        `SELECT channel_id, conversation_id, external_id
           FROM messages WHERE id = $1 LIMIT 1`,
        [req.params.id],
      );
      return rows[0] ?? null;
    });

    if (!row) return reply.code(404).send({ error: 'not_found' });
    // Пока сообщение не ушло, у него нет идентификатора у провайдера —
    // ставить реакцию не на что.
    if (!row.external_id) return reply.code(409).send({ error: 'message_not_delivered_yet' });

    await outboundQueue.add(
      'reaction',
      {
        tenantId: auth.tenantId,
        channelId: row.channel_id,
        conversationId: row.conversation_id,
        messageId: req.params.id,
        idempotencyKey: `${req.params.id}:${emoji ?? 'none'}`,
        kind: 'reaction',
        reaction: { targetExternalId: row.external_id, emoji },
      },
      { jobId: jobKey('react', req.params.id, emoji ?? 'none') },
    );

    return reply.code(202).send({ queued: true });
  },
);

/**
 * Отдача вложения.
 *
 * Права проверяются не сравнением tenant_id в коде, а самим фактом, что
 * запрос идёт через withTenant: RLS не отдаст чужое сообщение, и запрос
 * вернёт пусто. Подобрать чужой идентификатор сообщения бесполезно —
 * ответом будет 404, а не чужая фотография.
 */
app.get<{ Params: { messageId: string; index: string } }>(
  '/media/:messageId/:index',
  async (req, reply) => {
    const auth = requireAuth(req as never);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });

    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0) {
      return reply.code(400).send({ error: 'bad_index' });
    }

    const att = await withTenant(pool, auth.tenantId, async (db) => {
      const { rows } = await db.query<{ storage_key: string | null; mime: string | null }>(
        // ::int обязателен: без приведения параметр считается текстом,
        // и обращение к массиву по ключу «0» возвращает NULL.
        `SELECT content->'attachments'->($2)::int->>'storageKey' AS storage_key,
                content->'attachments'->($2)::int->>'mime'       AS mime
           FROM messages
          WHERE id = $1
          LIMIT 1`,
        [req.params.messageId, index],
      );
      return rows[0] ?? null;
    });

    if (!att?.storage_key) return reply.code(404).send({ error: 'not_found' });

    const obj = await storage.get(att.storage_key);
    if (!obj) return reply.code(404).send({ error: 'not_stored' });

    return reply
      .type(att.mime ?? obj.contentType)
      // Вложения неизменяемы: ключ содержит идентификатор сообщения,
      // и содержимое по нему никогда не поменяется.
      .header('cache-control', 'private, max-age=86400, immutable')
      .header('content-length', String(obj.size))
      .send(obj.body);
  },
);

/**
 * Отправка сообщения.
 *
 * Ключевое решение: окно ответа проверяется ЗДЕСЬ, а не в воркере.
 *
 * Оператор должен узнать «вне окна, нужен шаблон» мгновенно, пока он смотрит
 * в экран — а не через полминуты из очереди, когда он уже переключился
 * на другой диалог. Провайдер всё равно откажет, вопрос только в том,
 * узнает ли об этом человек вовремя.
 */
app.post<{
  Params: { id: string };
  Body: {
    text?: string;
    replyToExternalId?: string;
    attachment?: { filename?: string; mime?: string; type?: string; dataBase64?: string };
  };
}>(
  '/conversations/:id/messages',
  // Файл едет base64 внутри JSON, а не multipart. Причина прагматичная:
  // multipart тянет ещё одну зависимость и отдельный путь обработки ради
  // экономии трети объёма. На файлах до 20 МБ это того не стоит.
  { bodyLimit: 32 * 1024 * 1024 },
  async (req, reply) => {
    const auth = requireAuth(req as never);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });

    const text = (req.body?.text ?? '').trim();
    const upload = req.body?.attachment;
    if (!text && !upload?.dataBase64) return reply.code(400).send({ error: 'empty_text' });
    if (text.length > 4096) {
      return reply.code(400).send({ error: 'text_too_long', limit: 4096 });
    }

    // Файл кладём в хранилище ДО записи сообщения. Обратный порядок дал бы
    // сообщение со ссылкой на файл, которого нет, — и вечное «отправляется».
    let attachment: Record<string, unknown> | null = null;
    if (upload?.dataBase64) {
      const bytes = Buffer.from(upload.dataBase64, 'base64');
      if (bytes.length === 0) return reply.code(400).send({ error: 'empty_file' });
      if (bytes.length > 20 * 1024 * 1024) {
        return reply.code(413).send({ error: 'file_too_large', limit: 20 * 1024 * 1024 });
      }
      const key = mediaKey(auth.tenantId, randomUUID(), 0);
      try {
        await storage.put(key, bytes, upload.mime || 'application/octet-stream');
      } catch (err) {
        // Самая частая причина — том смонтирован только на чтение или
        // принадлежит root. Без явного сообщения это выглядит как
        // «Internal Server Error» и не подсказывает, где искать.
        app.log.error({ err, key }, 'Не удалось сохранить вложение');
        return reply.code(500).send({
          error: 'storage_write_failed',
          detail: 'Хранилище не принимает запись. Проверьте том /data/media у контейнера api.',
        });
      }
      attachment = {
        type: upload.type || 'document',
        storageKey: key,
        mime: upload.mime || 'application/octet-stream',
        filename: upload.filename || 'file',
        size: bytes.length,
        ready: true,
      };
    }

    const result = await withTenant(pool, auth.tenantId, async (db) => {
      const { rows } = await db.query<{
        id: string;
        channel_id: string;
        channel_type: ChannelType;
        window_expires_at: Date | null;
        window_type: string | null;
      }>(
        `SELECT c.id, c.channel_id, ch.type AS channel_type,
                c.window_expires_at, c.window_type
           FROM conversations c
           JOIN channels ch ON ch.id = c.channel_id
          WHERE c.id = $1
          LIMIT 1`,
        [req.params.id],
      );

      const conv = rows[0];
      if (!conv) return { error: 'conversation_not_found' as const };

      const verdict = canSendFreeform(conv.channel_type, {
        type: (conv.window_type as never) ?? 'none',
        expiresAt: conv.window_expires_at,
      });

      if (!verdict.allowed) {
        return {
          error: 'window_closed' as const,
          reason: verdict.reason,
          requiresTemplate: verdict.requiresTemplate,
        };
      }

      // Сообщение сохраняется СРАЗУ, со статусом pending.
      // Оператор видит его в ленте мгновенно, а доставка идёт своим темпом.
      // external_id появится позже — его присваивает провайдер.
      const { rows: ins } = await db.query<{ id: string }>(
        `INSERT INTO messages
           (tenant_id, conversation_id, channel_id, direction, sender_type,
            sender_user_id, content, status, sent_at)
         VALUES ($1, $2, $3, 'out', 'agent', $4, $5, 'pending', now())
         RETURNING id`,
        [
          auth.tenantId,
          conv.id,
          conv.channel_id,
          auth.userId,
          JSON.stringify(
            Object.assign(
              text ? { text } : {},
              attachment ? { attachments: [attachment] } : {},
              req.body?.replyToExternalId
                ? { replyToExternalId: req.body.replyToExternalId }
                : {},
            ),
          ),
        ],
      );

      await db.query(
        // human_replied_at выключает бота в этом диалоге: как только
        // ответил живой человек, автоответы перестают перебивать разговор.
        `UPDATE conversations
            SET last_message_at = now(), unread_count = 0,
                first_response_at = COALESCE(first_response_at, now()),
                human_replied_at = now()
          WHERE id = $1`,
        [conv.id],
      );

      return { messageId: ins[0]!.id, channelId: conv.channel_id };
    });

    if ('error' in result) {
      if (result.error === 'conversation_not_found') {
        return reply.code(404).send({ error: result.error });
      }
      return reply.code(409).send(result);
    }

    // jobId = messageId. Повторный вызов с тем же сообщением не создаст
    // вторую задачу: BullMQ отбросит дубликат по идентификатору.
    // Без этого сетевой ретрай на стороне клиента = два сообщения клиенту.
    await outboundQueue.add(
      'send',
      {
        tenantId: auth.tenantId,
        channelId: result.channelId,
        conversationId: req.params.id,
        messageId: result.messageId,
        idempotencyKey: result.messageId,
      },
      { jobId: result.messageId },
    );

    return reply.code(202).send({ messageId: result.messageId, status: 'pending' });
  },
);

// ─────────────────────────────────────────────────────────────────────────

async function start(): Promise<void> {
  if (!JWT_SECRET) throw new Error('JWT_SECRET не задан');

  // Падаем на старте, если кто-то добавил таблицу с tenant_id без RLS.
  // Лучше не запуститься, чем полгода отдавать чужие данные.
  await assertRlsIntegrity(pool);
  app.log.info('Проверка целостности RLS пройдена');

  await app.listen({ port: PORT, host: '0.0.0.0' });
  app.log.info(`api слушает :${PORT}, интерфейс сборки ${UI_BUILD}`);
}

async function shutdown(signal: string): Promise<void> {
  app.log.info(`${signal}: завершаю работу`);
  await app.close();
  await pool.end();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

start().catch((err) => {
  app.log.error({ err }, 'Не удалось запустить api');
  process.exit(1);
});
