import Fastify, { type FastifyReply } from 'fastify';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import {
  QUEUE_INBOUND,
  QUEUE_OUTBOUND,
  QUEUE_MEDIA,
  QUEUE_CRM_SYNC,
  QUEUE_MTPROTO_LOGIN,
  assertRlsIntegrity,
  canSendFreeform,
  createPool,
  createStorage,
  avatarKey,
  mediaKey,
  defaultJobOptions,
  jobKey,
  messageEventKey,
  parseWorkHours,
  recordEvent,
  workedSeconds,
  encryptJson,
  maskSecret,
  parseMasterKey,
  verifyZohoWidgetSignature,
  withSystem,
  withTenant,
  type ChannelType,
  type InboundJob,
  type OutboundJob,
  type MediaJob,
  type CrmSyncJob,
  type MtprotoLoginJob,
} from '@omnidesk/core';
import { INBOX_HTML, UI_BUILD } from './ui.js';
import { registerSettings } from './settings.js';
import { registerInbox } from './inbox.js';
import { registerEmailAuth } from './auth-email.js';
import { createMailer } from './mailer.js';
import { registerLegal } from './legal.js';
import { registerLanding, landingPage } from './landing.js';
import { registerZoho } from './zoho.js';
import { registerWidget } from './widget.js';
import { registerDocs } from './openapi.js';
import { registerAi } from './ai.js';
import { registerNotify } from './notify.js';
import { registerWebchat } from './webchat.js';
import { registerCustom } from './custom.js';
import { registerStatuses } from './statuses.js';
import { registerAnalytics } from './analytics.js';
import { crmPhoneReader, registerCrm } from './crm.js';
import { denial, requiredLevel, roleAllows } from './roles.js';
import { channelScope } from './scope.js';
import { APP_ICON_180, APP_ICON_192, APP_ICON_512, APP_ICON_SVG } from './brand.js';
import { SESSION_COOKIE, SESSION_TTL, isHttps, readCookie, sessionCookie } from './session.js';

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
/**
 * Входящие из чата на сайте.
 *
 * У остальных каналов входящие принимает ingress, но у этого нет
 * вебхука: сообщение приходит прямо со страницы посетителя, а страницу
 * отдаём мы. Дальше — та же очередь и тот же воркер, что у всех.
 */
const inboundQueue = new Queue<InboundJob>(QUEUE_INBOUND, {
  connection: redis,
  defaultJobOptions,
});
/** Очередь скачивания: сюда идёт кнопка «повторить» у зависшего вложения. */
const mediaQueue = new Queue<MediaJob>(QUEUE_MEDIA, {
  connection: redis,
  defaultJobOptions,
});
/** Вход в номерной Telegram: задачу выполняет сервис sessions. */
const crmQueue = new Queue<CrmSyncJob>(QUEUE_CRM_SYNC, {
  connection: redis,
  defaultJobOptions,
});

const mtprotoLoginQueue = new Queue<MtprotoLoginJob>(QUEUE_MTPROTO_LOGIN, {
  connection: redis,
  defaultJobOptions: { ...defaultJobOptions, attempts: 1 },
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
  // Адрес со слешем на конце и без него — один и тот же адрес.
  // Meta и Zoho иногда дописывают слеш сами, и без этого их проверка
  // получает 404 на существующей странице.
  ignoreTrailingSlash: true,
});

// ─────────────────────────────────────────────────────────────────────────
// Минимальный JWT (HS256). В проде возьмите библиотеку — здесь показан
// принцип. Токен страницы живёт в localStorage, а рядом кладётся cookie
// того же токена: без неё новая вкладка встречала форму входа у уже
// вошедшего человека. Виджет внутри рамки Zoho cookie не получит
// (SameSite), и входит заголовком — см. session.ts.
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

/** Запомнить вход в cookie. Вызывается страницей сразу после входа. */
app.post('/auth/session', async (req, reply) => {
  const header = req.headers['authorization'];
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'unauthorized' });
  }
  const token = header.slice(7);
  if (!requireAuth(req as never)) return reply.code(401).send({ error: 'unauthorized' });
  return reply
    .header('set-cookie', sessionCookie(token, isHttps(req.headers['x-forwarded-proto']), SESSION_TTL))
    .send({ ok: true });
});

/** Отдать токен новой вкладке, если сеанс ещё жив. */
app.get('/auth/session', async (req, reply) => {
  const token = readCookie(req.headers['cookie'], SESSION_COOKIE);
  if (!token) return reply.code(401).send({ error: 'no_session' });
  const payload = verifyJwt(token);
  if (!payload) {
    return reply
      .header('set-cookie', sessionCookie('', isHttps(req.headers['x-forwarded-proto']), 0))
      .code(401)
      .send({ error: 'expired' });
  }
  return { token };
});

/** Выход: cookie гасится, иначе следующая вкладка снова войдёт. */
app.delete('/auth/session', async (req, reply) =>
  reply.header('set-cookie', sessionCookie('', isHttps(req.headers['x-forwarded-proto']), 0)).send({ ok: true }));

/**
 * Права ролей — одной проверкой на все запросы.
 *
 * Раньше проверялся только вход: кто вошёл, тот мог всё — отключить
 * канал, стереть сценарий, сменить ключ от модели, выдать себе роль
 * владельца. Оператора нанимают отвечать клиентам, и такие права у
 * него не удобство, а способ потерять компанию за вечер.
 *
 * Проверка стоит здесь, а не в полусотне обработчиков: там её однажды
 * забудут дописать, и дыра появится в ручке, о которой никто не
 * вспомнит. Что кому можно — в roles.ts, отдельно и с тестами.
 *
 * Роль берётся из базы, а не из токена: разжалованный оператор иначе
 * оставался бы администратором до конца недели, пока жив его токен.
 * Чтобы не ходить в базу на каждый запрос, ответ держится минуту —
 * этого хватает, чтобы смена роли применилась почти сразу.
 */
const roleCache = new Map<string, { role: string; until: number }>();
const ROLE_TTL_MS = 60_000;

async function roleOf(tenantId: string, userId: string): Promise<string> {
  const hit = roleCache.get(userId);
  if (hit && hit.until > Date.now()) return hit.role;

  const role = await withTenant(pool, tenantId, async (db) => {
    const { rows } = await db.query<{ role: string }>(
      `SELECT role FROM users WHERE id = $1 AND is_active LIMIT 1`,
      [userId],
    );
    return rows[0]?.role ?? '';
  });

  roleCache.set(userId, { role, until: Date.now() + ROLE_TTL_MS });
  return role;
}

app.addHook('preHandler', async (req, reply) => {
  const path = (req.raw.url ?? '').split('?')[0] ?? '';
  const level = requiredLevel(req.method, path);
  if (level === 'any') return;

  const auth = requireAuth(req as never);
  // Не вошёл — пусть обработчик сам ответит 401: он знает, чем именно
  // отвечать, а мы здесь занимаемся только правами.
  if (!auth) return;

  const role = await roleOf(auth.tenantId, auth.userId);
  if (roleAllows(role, level)) return;

  app.log.info({ userId: auth.userId, role, path, method: req.method }, 'Отказано по роли');
  return reply.code(403).send({ error: 'forbidden', detail: denial(role, level) });
});

// ─────────────────────────────────────────────────────────────────────────

/**
 * Отметка «прочитано» у провайдера.
 *
 * Ищем последнее входящее с идентификатором провайдера и ставим задачу
 * тому же конвейеру, что и отправку: доступ к каналу есть только у него.
 * Каналы, где отметки нет (бот Telegram, Viber через партнёра),
 * отсеиваются здесь же — задача ради ничего никому не нужна.
 */
const READ_RECEIPT_CHANNELS = ['telegram_user', 'instagram', 'messenger', 'whatsapp'];

function markReadUpstream(task: { tenantId: string; conversationId: string }): void {
  void (async () => {
    const row = await withTenant(pool, task.tenantId, async (db) => {
      const { rows } = await db.query<{
        message_id: string;
        channel_id: string;
        external_id: string;
        channel_type: string;
      }>(
        `SELECT m.id AS message_id, m.channel_id, m.external_id, ch.type AS channel_type
           FROM messages m
           JOIN channels ch ON ch.id = m.channel_id
          WHERE m.conversation_id = $1 AND m.direction = 'in' AND m.external_id IS NOT NULL
          ORDER BY m.sent_at DESC LIMIT 1`,
        [task.conversationId],
      );
      return rows[0] ?? null;
    });
    if (!row || !READ_RECEIPT_CHANNELS.includes(row.channel_type)) return;

    await outboundQueue.add(
      'read',
      {
        tenantId: task.tenantId,
        channelId: row.channel_id,
        conversationId: task.conversationId,
        messageId: row.message_id,
        kind: 'read',
        readUpTo: { externalId: row.external_id },
        idempotencyKey: `read:${row.message_id}`,
      },
      // Один ключ на сообщение: открыли диалог десять раз — отметка
      // уедет один раз, а не десять.
      { jobId: jobKey('read', row.message_id), attempts: 2 },
    );
  })().catch((err: unknown) => {
    app.log.warn({ err }, 'Не удалось поставить отметку о прочтении');
  });
}

/**
 * Записать, что оператор ответил.
 *
 * Два события, а не одно. message.out — сколько всего написали, и это
 * нагрузка. reply — что клиент дождался, и это качество. Из десяти
 * исходящих подряд ответом на ожидание был первый, и складывать их в
 * одно значило бы получить среднее время ответа, равное нулю.
 *
 * Время ожидания считается в рабочих часах компании и записывается
 * числом здесь же, а не выводится потом. Расписание могут изменить, и
 * тогда пересчёт молча переписал бы прошлые отчёты — цифра за июнь
 * обязана остаться той, какой её видели в июне.
 */
async function recordReply(x: {
  tenantId: string;
  userId: string;
  conversationId: string;
  channelId: string;
  messageId: string;
  waitingSince: Date | null;
}): Promise<void> {
  const wh = await withSystem(pool, 'рабочие часы для отчёта', async (db) => {
    const { rows } = await db.query<{ work_hours: unknown }>(
      `SELECT work_hours FROM tenants WHERE id = $1 LIMIT 1`,
      [x.tenantId],
    );
    return parseWorkHours(rows[0]?.work_hours);
  });

  await withTenant(pool, x.tenantId, async (db) => {
    await recordEvent(db, x.tenantId, {
      type: 'message.out',
      conversationId: x.conversationId,
      channelId: x.channelId,
      userId: x.userId,
      dedupeKey: messageEventKey('message.out', x.messageId),
      payload: { by: 'agent' },
    });

    if (!x.waitingSince) return;

    const now = new Date();
    await recordEvent(db, x.tenantId, {
      type: 'reply',
      conversationId: x.conversationId,
      channelId: x.channelId,
      userId: x.userId,
      dedupeKey: messageEventKey('reply', x.messageId),
      payload: {
        // Оба числа: по часам компании — для отчёта, по календарю —
        // чтобы было с чем сверить, когда цифра покажется странной.
        waitSeconds: workedSeconds(x.waitingSince, now, wh),
        clockSeconds: Math.round((now.getTime() - x.waitingSince.getTime()) / 1000),
        since: x.waitingSince.toISOString(),
      },
    });
  });
}

registerInbox(app, {
  pool,
  requireAuth: (req) => requireAuth(req as never),
  markReadUpstream,
});

registerEmailAuth(app, {
  pool,
  requireAuth: (req) => requireAuth(req as never),
  // Семь дней: смена не такая частая, чтобы просить код каждый день,
  // и не такая долгая, чтобы забытая вкладка жила месяцами.
  issueToken: (tenantId, userId) => signJwt({ sub: userId, tid: tenantId }, 7 * 24 * 3600),
  mailer: createMailer(process.env, (line) => app.log.info(line)),
  appName: process.env['APP_NAME'] ?? 'Rozmovio',
  // Регистрация открыта: сервис продаётся пробным периодом, и требовать
  // ради него письма владельцу — терять клиента на ровном месте.
  // Выключается переменной, если понадобится закрытый доступ.
  allowSignup: process.env['ALLOW_SIGNUP'] !== 'off',
  onSignup: (info) => {
    app.log.info(info, 'Новая компания зарегистрировалась');
    const to = process.env['LEADS_TO'] ?? process.env['CONTACT_EMAIL'];
    if (!to) return;
    const lines = [
      'Новая компания в Rozmovio',
      '',
      'Компания: ' + info.company,
      'Почта: ' + info.email,
      'Тенант: ' + info.tenantId,
    ].join(String.fromCharCode(10));
    createMailer(process.env, (line) => app.log.info(line))
      .send({ to, subject: 'Rozmovio: регистрация ' + info.company, text: lines, html:
        '<pre style="font:14px/1.6 ui-monospace,Menlo,monospace">' + lines + '</pre>' })
      .catch((err: unknown) => app.log.warn({ err }, 'Письмо о регистрации не ушло'));
  },
});

registerSettings(app, {
  pool,
  masterKey,
  requireAuth: (req) => requireAuth(req as never),
  telegramApiRoot: TELEGRAM_API_ROOT,
  publicUrl: PUBLIC_URL,
  telegramWebhookSecret: TELEGRAM_WEBHOOK_SECRET,
  mtproto: { redis, loginQueue: mtprotoLoginQueue },
  ...(process.env['META_APP_ID'] && process.env['META_APP_SECRET']
    ? {
        meta: {
          appId: process.env['META_APP_ID'],
          appSecret: process.env['META_APP_SECRET'],
          // Адрес, на который Facebook возвращает после входа. Он же
          // прописан в настройках приложения Meta и должен совпадать побуквенно.
          appUrl: (process.env['APP_URL'] ?? '').replace(/[/]+$/, ''),
          stateSecret: JWT_SECRET,
          redis,
          ...(process.env['META_LOGIN_CONFIG_ID'] ? { configId: process.env['META_LOGIN_CONFIG_ID'] } : {}),
        },
      }
    : {}),
});

registerWidget(app, {
  pool,
  requireAuth: (req) => requireAuth(req as never),
  crmPhone: crmPhoneReader({
    pool,
    masterKey,
    requireAuth: (req) => requireAuth(req as never),
    pipedrive: {
      clientId: process.env['PIPEDRIVE_CLIENT_ID'] ?? '',
      clientSecret: process.env['PIPEDRIVE_CLIENT_SECRET'] ?? '',
      appUrl: (process.env['APP_URL'] ?? '').replace(/[/]+$/, ''),
    },
  }),
});

registerAi(app, { pool, masterKey, requireAuth: (req) => requireAuth(req as never) });

const notify = registerNotify(app, {
  pool,
  connection: redis,
  masterKey,
  requireAuth: (req) => requireAuth(req as never),
  log: (level, msg, extra) => app.log.info(extra ?? {}, `${level}: ${msg}`),
});

registerWebchat(app, {
  pool,
  inboundQueue,
  storage,
  appUrl: (process.env['APP_URL'] ?? '').replace(/[/]+$/, '') || PUBLIC_URL,
  log: (level, msg, extra) => app.log.info(extra ?? {}, `${level}: ${msg}`),
});

registerCustom(app, {
  pool,
  inboundQueue,
  log: (level, msg, extra) => app.log.info(extra ?? {}, `${level}: ${msg}`),
});

registerStatuses(app, {
  pool,
  requireAuth: (req) => requireAuth(req as never),
});

registerAnalytics(app, {
  pool,
  requireAuth: (req) => requireAuth(req as never),
});

registerCrm(app, {
  pool,
  masterKey,
  requireAuth: (req) => requireAuth(req as never),
  // Ключи приложения Pipedrive нужны только для панели в карточке.
  // Без них подключение по токену работает как прежде.
  pipedrive: {
    clientId: process.env['PIPEDRIVE_CLIENT_ID'] ?? '',
    clientSecret: process.env['PIPEDRIVE_CLIENT_SECRET'] ?? '',
    appUrl: (process.env['APP_URL'] ?? '').replace(/[/]+$/, ''),
  },
  redis,
});

registerDocs(app, (process.env['APP_URL'] ?? '').replace(/[/]+$/, ''));

registerZoho(app, {
  pool,
  masterKey,
  requireAuth: (req) => requireAuth(req as never),
  clientId: process.env['ZOHO_CLIENT_ID'] ?? '',
  clientSecret: process.env['ZOHO_CLIENT_SECRET'] ?? '',
  appUrl: (process.env['APP_URL'] ?? '').replace(/[/]+$/, ''),
  stateSecret: JWT_SECRET,
});

registerLegal(app, {
  contactEmail: process.env['CONTACT_EMAIL'] ?? 'support@rozmovio.com',
  operator: process.env['LEGAL_OPERATOR'] ?? 'KL Systems',
  pool,
  appUrl: (process.env['APP_URL'] ?? '').replace(/[/]+$/, ''),
  metaAppSecret: process.env['META_APP_SECRET'] ?? '',
});

/**
 * Только https.
 *
 * Railway принимает и http, и https и сообщает протокол заголовком
 * x-forwarded-proto. Без этой проверки страница открывается по http,
 * и браузер пишет «Не защищено» — при живом и действительном
 * сертификате. Для сервиса, где вводят почту и код входа, такая
 * надпись дороже любой экономии на редиректе.
 *
 * Строгий транспорт (HSTS) на год говорит браузеру больше никогда
 * не ходить сюда по http: второй и последующие заходы не будут
 * тратить лишний запрос на перенаправление.
 *
 * Проверка здоровья приходит внутрь контейнера напрямую, без этого
 * заголовка, — её редирект не затрагивает.
 */
app.addHook('onRequest', async (req, reply) => {
  const proto = String(req.headers['x-forwarded-proto'] ?? '');
  if (proto === 'http') {
    const host = String(req.headers['host'] ?? '');
    if (host) return reply.code(301).redirect(`https://${host}${req.url}`);
  }
  if (proto === 'https') {
    reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
  }
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

registerLanding(app, {
  pool,
  mailer: createMailer(process.env, (line) => app.log.info(line)),
  notifyTo: process.env['LEADS_TO'] ?? process.env['CONTACT_EMAIL'] ?? 'slastin.kv@gmail.com',
  webchatKey: process.env['WEBCHAT_SITE_KEY'] ?? '',
  log: (level, msg, extra) => app.log[level](extra ?? {}, msg),
  // Письмо о заявке уходило и раньше. Оповещение — это то же самое,
  // но там, где человек смотрит: в группе поддержки и пушем.
  onLead: (lead) => {
    void notify.announceLead(lead).catch((err: unknown) => {
      app.log.warn({ err }, 'Не удалось поставить оповещение о заявке');
    });
  },
});

/**
 * Что отдавать по корню — решает имя домена.
 *
 * rozmovio.com и www.rozmovio.com — промо-страница, app.rozmovio.com —
 * рабочее место. Один процесс на оба адреса намеренно: второй сервис
 * ради одной статической страницы означал бы второй деплой, второй
 * набор переменных и второе место, где оформление живёт своей жизнью.
 *
 * Список доменов промо задаётся переменной, а не зашит в код: на
 * проверочных стендах домены другие, и менять из-за этого код нельзя.
 */
/** Та же страница, что по /promo: собирается один раз вместе с виджетом. */
const SITE_PAGE = landingPage(process.env['WEBCHAT_SITE_KEY'] ?? '');

const SITE_HOSTS = (process.env['SITE_HOSTS'] ?? 'rozmovio.com,www.rozmovio.com')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

function isSiteHost(req: { headers: Record<string, unknown> }): boolean {
  const host = String(req.headers['host'] ?? '').toLowerCase().split(':')[0] ?? '';
  return SITE_HOSTS.includes(host);
}

app.get('/', async (req, reply) => {
  if (isSiteHost(req as never)) {
    return reply
      .type('text/html; charset=utf-8')
      .header('cache-control', 'public, max-age=300')
      .send(SITE_PAGE);
  }
  return sendUi(req, reply);
});
app.get('/app', sendUi);

// Браузер всегда просит favicon. Без этой строки в консоли висит 404,
// который потом маскирует настоящие ошибки при отладке.
app.get('/favicon.ico', async (_req, reply) => reply.redirect('/favicon.svg'));
app.get('/favicon.svg', async (_req, reply) =>
  reply.type('image/svg+xml').header('cache-control', 'public, max-age=86400').send(APP_ICON_SVG),
);

/**
 * Значок на домашнем экране и манифест приложения.
 *
 * Инбокс открывают с телефона, и браузерная вкладка для сменной работы
 * неудобна: адресная строка съедает высоту, жест «назад» уводит с
 * сайта. Добавленный на домашний экран, он открывается как приложение —
 * без адресной строки и с собственным значком.
 *
 * iOS не понимает SVG в apple-touch-icon, поэтому PNG. Оба размера
 * отдаются из кода: тома со статикой у контейнера нет.
 */
const png = (reply: FastifyReply, body: Buffer) =>
  reply.type('image/png').header('cache-control', 'public, max-age=604800').send(body);

app.get('/icon-180.png', async (_req, reply) => png(reply, APP_ICON_180));
app.get('/icon-192.png', async (_req, reply) => png(reply, APP_ICON_192));
app.get('/icon-512.png', async (_req, reply) => png(reply, APP_ICON_512));
app.get('/apple-touch-icon.png', async (_req, reply) => png(reply, APP_ICON_180));
app.get('/apple-touch-icon-precomposed.png', async (_req, reply) => png(reply, APP_ICON_180));

app.get('/manifest.webmanifest', async (_req, reply) =>
  reply
    .type('application/manifest+json; charset=utf-8')
    .header('cache-control', 'public, max-age=3600')
    .send({
      name: process.env['APP_NAME'] ?? 'Rozmovio',
      short_name: 'Rozmovio',
      description: 'Месенджери клієнтів в одному вікні',
      start_url: '/app',
      scope: '/',
      display: 'standalone',
      orientation: 'portrait-primary',
      background_color: '#0E1530',
      theme_color: '#0E1530',
      lang: 'uk',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    }),
);

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
      detail: 'Цей бот уже підключений в іншому акаунті. Відключіть його там або візьміть іншого бота.',
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
         JOIN conversations c ON c.id = m.conversation_id
         LEFT JOIN messages q
                ON q.channel_id  = m.channel_id
               AND q.external_id = m.content->>'replyToExternalId'
        WHERE m.conversation_id = $1
          AND ${channelScope('c.channel_id', '$2')}
        ORDER BY m.sent_at ASC
        LIMIT 200`,
      [req.params.id, auth.userId],
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

  const contactId = req.params.contactId;

  const stored = await withTenant(pool, auth.tenantId, async (db) => {
    const { rows } = await db.query<{ avatar_url: string | null }>(
      `SELECT avatar_url FROM contacts WHERE id = $1`,
      [contactId],
    );
    return rows[0]?.avatar_url ?? null;
  });

  let key = stored;
  let file = key ? await storage.get(key) : null;

  /**
   * Починка потерянной связи.
   *
   * Картинка и запись о ней пишутся в разных местах: файл кладёт тот,
   * кто его скачал (воркер или служба сессий), а ссылку в контакте
   * проставляет обработчик сообщения. Между этими двумя шагами сервис
   * может перезапуститься, задача — не дойти, сообщение — оказаться
   * дубликатом. Тогда файл в хранилище есть, а контакт про него не знает,
   * и в списке вместо лица остаются инициалы. Снаружи это выглядит как
   * «аватарки не работают», хотя всё скачано и лежит.
   *
   * Поэтому при отсутствии ссылки пробуем известные способы, которыми
   * ключ мог быть составлен, и, если файл нашёлся, связь восстанавливаем.
   * Дальше он отдаётся из ссылки, без перебора.
   */
  if (!file) {
    const candidates = await withTenant(pool, auth.tenantId, async (db) => {
      const { rows } = await db.query<{ channel_id: string; external_id: string }>(
        `SELECT ch.id AS channel_id, ci.external_id
           FROM contact_identities ci
           JOIN channels ch ON ch.type = ci.channel_type
          WHERE ci.contact_id = $1 AND ci.channel_type = 'telegram_user'`,
        [contactId],
      );
      return rows;
    });

    const keys = [
      avatarKey(auth.tenantId, contactId),
      ...candidates.map((c) => `${auth.tenantId}/avatars/tgu-${c.channel_id}-${c.external_id}`),
    ].filter((k) => k !== stored);

    for (const candidate of keys) {
      const found = await storage.get(candidate);
      if (!found) continue;
      key = candidate;
      file = found;
      await withTenant(pool, auth.tenantId, async (db) => {
        await db.query(`UPDATE contacts SET avatar_url = $2 WHERE id = $1`, [contactId, candidate]);
      });
      app.log.info({ contactId, key: candidate }, 'Аватар нашёлся в хранилище, связь восстановлена');
      break;
    }
  }

  if (!file) return reply.code(404).send({ error: 'no_avatar' });

  return reply
    .type(file.contentType || 'image/jpeg')
    .header('cache-control', 'private, max-age=86400')
    .send(file.body);
});

/**
 * Отправить контакт в CRM руками.
 *
 * Автоматика срабатывает на первое сообщение, но случаи бывают разные:
 * CRM подключили позже, чем пришёл человек; лид удалили и нужен заново;
 * оператор хочет завести карточку прямо сейчас, не дожидаясь следующего
 * сообщения. Кнопка делает ровно то же, что и автоматика.
 */
app.post<{ Params: { id: string } }>('/contacts/:id/crm', async (req, reply) => {
  const auth = requireAuth(req as never);
  if (!auth) return reply.code(401).send({ error: 'unauthorized' });

  const info = await withTenant(pool, auth.tenantId, async (db) => {
    const { rows } = await db.query<{
      crm_record_id: string | null;
      channel_type: string | null;
      conversation_id: string | null;
      first_text: string | null;
    }>(
      `SELECT c.crm_record_id,
              ch.type AS channel_type,
              cv.id   AS conversation_id,
              (SELECT m.content->>'text' FROM messages m
                WHERE m.conversation_id = cv.id AND m.direction = 'in'
                ORDER BY m.sent_at ASC LIMIT 1) AS first_text
         FROM contacts c
         LEFT JOIN conversations cv ON cv.contact_id = c.id
         LEFT JOIN channels ch ON ch.id = cv.channel_id
        WHERE c.id = $1
        ORDER BY cv.last_message_at DESC NULLS LAST
        LIMIT 1`,
      [req.params.id],
    );
    return rows[0] ?? null;
  });

  if (!info) return reply.code(404).send({ error: 'not_found' });
  if (info.crm_record_id) return reply.code(409).send({ error: 'already_linked' });

  const zoho = await withTenant(pool, auth.tenantId, async (db) => {
    const { rows } = await db.query(`SELECT 1 FROM zoho_installations WHERE status = 'active' LIMIT 1`);
    return rows.length > 0;
  });
  if (!zoho) return reply.code(409).send({ error: 'crm_not_connected' });

  // Ключ с отметкой времени: ручной повтор должен выполняться, а не
  // считаться дубликатом уже сделанной задачи.
  await crmQueue.add(
    'sync',
    {
      tenantId: auth.tenantId,
      contactId: req.params.id,
      conversationId: info.conversation_id,
      channelType: info.channel_type ?? 'unknown',
      ...(info.first_text ? { firstText: info.first_text.slice(0, 500) } : {}),
    },
    { jobId: jobKey('crm-manual', req.params.id, String(Date.now())) },
  );

  return { ok: true };
});

/* ── Файлы шаблонов ──────────────────────────────────────────────────
   Шаблон с прайсом полезнее шаблона с текстом «сейчас пришлю прайс».
   Файл кладётся в то же хранилище, что и вложения переписки, а в
   шаблоне остаётся только описание. */

/** Загрузка файла в шаблон. */
app.post<{
  Params: { id: string };
  Body: { filename?: string; mime?: string; type?: string; dataBase64?: string };
}>(
  '/quick-replies/:id/attachment',
  { bodyLimit: 32 * 1024 * 1024 },
  async (req, reply) => {
    const auth = requireAuth(req as never);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });

    const b64 = req.body?.dataBase64 ?? '';
    if (!b64) return reply.code(400).send({ error: 'empty_file' });
    const bytes = Buffer.from(b64, 'base64');
    if (bytes.length === 0) return reply.code(400).send({ error: 'empty_file' });
    if (bytes.length > 20 * 1024 * 1024) {
      return reply.code(413).send({ error: 'file_too_large', limit: 20 * 1024 * 1024 });
    }

    const key = `${auth.tenantId}/quick-replies/${req.params.id}-${randomUUID()}`;
    try {
      await storage.put(key, bytes, req.body?.mime || 'application/octet-stream');
    } catch (err) {
      app.log.error({ err, key }, 'Не удалось сохранить файл шаблона');
      return reply.code(500).send({ error: 'storage_write_failed' });
    }

    const item = {
      type: req.body?.type || 'document',
      storageKey: key,
      mime: req.body?.mime || 'application/octet-stream',
      filename: req.body?.filename || 'file',
      size: bytes.length,
    };

    // Больше трёх файлов в одном шаблоне — это уже не шаблон ответа,
    // а папка. Ограничение рисуется в интерфейсе, но держится здесь.
    const ok = await withTenant(pool, auth.tenantId, async (db) => {
      const { rowCount } = await db.query(
        `UPDATE quick_replies
            SET attachments = attachments || $2::jsonb
          WHERE id = $1 AND jsonb_array_length(attachments) < 3`,
        [req.params.id, JSON.stringify([item])],
      );
      return (rowCount ?? 0) > 0;
    });
    if (!ok) return reply.code(409).send({ error: 'too_many_files' });

    return reply.code(201).send({ ok: true, attachment: item });
  },
);

/** Просмотр файла шаблона: тем же путём, что и вложения переписки. */
app.get<{ Params: { id: string; index: string } }>(
  '/quick-replies/:id/attachment/:index',
  async (req, reply) => {
    const auth = requireAuth(req as never);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });

    const index = Number(req.params.index);
    const picked = await withTenant(pool, auth.tenantId, async (db) => {
      const { rows } = await db.query<{ attachments: unknown[] }>(
        `SELECT attachments FROM quick_replies WHERE id = $1`,
        [req.params.id],
      );
      const list = (rows[0]?.attachments ?? []) as Array<Record<string, string>>;
      return list[Number.isFinite(index) ? index : 0] ?? null;
    });
    if (!picked?.['storageKey']) return reply.code(404).send({ error: 'not_found' });

    const file = await storage.get(String(picked['storageKey']));
    if (!file) return reply.code(404).send({ error: 'not_found' });

    return reply
      .type(file.contentType || 'application/octet-stream')
      .header('cache-control', 'private, max-age=86400')
      .send(file.body);
  },
);

/** Убрать файл из шаблона. Сам файл в хранилище остаётся: он мог уже уйти клиенту. */
app.delete<{ Params: { id: string; index: string } }>(
  '/quick-replies/:id/attachment/:index',
  async (req, reply) => {
    const auth = requireAuth(req as never);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });

    const index = Number(req.params.index);
    if (!Number.isFinite(index) || index < 0) return reply.code(400).send({ error: 'bad_index' });

    const ok = await withTenant(pool, auth.tenantId, async (db) => {
      const { rowCount } = await db.query(
        `UPDATE quick_replies SET attachments = attachments - $2::int WHERE id = $1`,
        [req.params.id, index],
      );
      return (rowCount ?? 0) > 0;
    });
    if (!ok) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  },
);

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
    /**
     * Одобренный шаблон WhatsApp.
     *
     * Вне суточного окна свободный текст запрещён самим WhatsApp, и
     * единственный способ продолжить разговор — шаблон. Поэтому он
     * проходит там, где обычный текст уже отклоняется.
     */
    template?: { name?: string; language?: string; params?: string[] };
    attachment?: {
      filename?: string;
      mime?: string;
      type?: string;
      dataBase64?: string;
      /** Вложение из шаблона: файл уже лежит в хранилище, заново его не льём. */
      fromQuickReply?: { id?: string; index?: number };
    };
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

    /*
     * Шаблон: имя и язык обязательны, остальное — значения переменных.
     * Текст для ленты собирается в интерфейсе, здесь хранится то, что
     * поедет в Meta.
     */
    const tpl = req.body?.template;
    const template = tpl?.name
      ? {
          name: String(tpl.name),
          language: String(tpl.language ?? 'uk'),
          params: (tpl.params ?? []).map((p) => String(p)).slice(0, 10),
        }
      : null;
    const upload = req.body?.attachment;
    const fromQr = upload?.fromQuickReply;
    if (!text && !upload?.dataBase64 && !fromQr?.id && !template) {
      return reply.code(400).send({ error: 'empty_text' });
    }
    if (text.length > 4096) {
      return reply.code(400).send({ error: 'text_too_long', limit: 4096 });
    }

    // Файл кладём в хранилище ДО записи сообщения. Обратный порядок дал бы
    // сообщение со ссылкой на файл, которого нет, — и вечное «отправляется».
    let attachment: Record<string, unknown> | null = null;

    /**
     * Вложение из шаблона.
     *
     * Файл уже лежит в хранилище с тех пор, как его загрузили в шаблон.
     * Перекладывать его копией на каждую отправку — значит на сотне
     * отправленных прайсов хранить сто одинаковых прайсов. Берём
     * описание из шаблона и ссылаемся на тот же ключ.
     */
    if (fromQr?.id) {
      const picked = await withTenant(pool, auth.tenantId, async (db) => {
        const { rows } = await db.query<{ attachments: unknown[] }>(
          `SELECT attachments FROM quick_replies WHERE id = $1`,
          [fromQr.id],
        );
        const list = (rows[0]?.attachments ?? []) as Array<Record<string, unknown>>;
        return list[Number(fromQr.index ?? 0)] ?? null;
      });
      if (!picked) return reply.code(404).send({ error: 'quick_reply_file_not_found' });
      attachment = { ...picked, ready: true };
    }

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
          detail: 'Сховище не приймає запис. Перевірте том /data/media у контейнера api.',
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
          WHERE c.id = $1 AND ${channelScope('c.channel_id', '$2')}
          LIMIT 1`,
        [req.params.id, auth.userId],
      );

      const conv = rows[0];
      if (!conv) return { error: 'conversation_not_found' as const };

      const verdict = canSendFreeform(conv.channel_type, {
        type: (conv.window_type as never) ?? 'none',
        expiresAt: conv.window_expires_at,
      });

      // Шаблон — и есть разрешённый способ писать вне окна. Отказывать
      // ему по тому же правилу означало бы запретить единственное, что
      // WhatsApp там разрешает.
      if (!verdict.allowed && !(template && verdict.requiresTemplate)) {
        return {
          error: 'window_closed' as const,
          reason: verdict.reason,
          requiresTemplate: verdict.requiresTemplate,
        };
      }

      /*
       * Сколько клиент ждал этого ответа — считается ДО вставки: после
       * неё «последнее исходящее» станет вот этим самым, и ожидание
       * схлопнется в ноль.
       *
       * Начало ожидания — первое сообщение клиента после нашего
       * последнего человеческого ответа. Именно первое: клиент написал
       * три раза подряд, и ждал он с первого, а не с третьего.
       *
       * Ответ бота ожидание не прекращает. Приветствие — не ответ, и
       * засчитывать его значит получить отчёт, где на всё отвечают за
       * четыре секунды.
       */
      const { rows: waitRows } = await db.query<{ since: Date | null }>(
        `SELECT min(m.sent_at) AS since
           FROM messages m
          WHERE m.conversation_id = $1 AND m.direction = 'in'
            AND m.sent_at > COALESCE((SELECT max(o.sent_at) FROM messages o
                                       WHERE o.conversation_id = $1
                                         AND o.direction = 'out'
                                         AND o.sender_type <> 'bot'),
                                     '-infinity'::timestamptz)`,
        [conv.id],
      );
      const waitingSince = waitRows[0]?.since ?? null;

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
              template ? { template } : {},
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

      return {
        messageId: ins[0]!.id,
        channelId: conv.channel_id,
        waitingSince,
        conversationId: conv.id,
      };
    });

    if ('error' in result) {
      if (result.error === 'conversation_not_found') {
        return reply.code(404).send({ error: result.error });
      }
      return reply.code(409).send(result);
    }

    /*
     * События для отчётов. После ответа клиенту, а не до: отчёт важен,
     * но не настолько, чтобы из-за него не уйти сообщению. По той же
     * причине ошибка здесь только пишется в лог.
     */
    recordReply({
      tenantId: auth.tenantId,
      userId: auth.userId,
      conversationId: result.conversationId,
      channelId: result.channelId,
      messageId: result.messageId,
      waitingSince: result.waitingSince,
    }).catch((err: unknown) => app.log.warn({ err }, 'Событие ответа не записано'));

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
