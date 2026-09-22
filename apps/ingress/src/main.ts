import Fastify from 'fastify';
import { Redis } from 'ioredis';
import { Queue } from 'bullmq';
import {
  QUEUE_INBOUND,
  defaultJobOptions,
  dedupeKey,
  verifyMetaSignature,
  verifyMetaSubscription,
  verifyTelegramSecret,
  type InboundJob,
} from '@omnidesk/core';

/**
 * ingress-gateway.
 *
 * Делает ровно три вещи и ничего больше:
 *   1. проверяет подпись,
 *   2. кладёт сырой payload в очередь,
 *   3. возвращает 200.
 *
 * Никаких запросов в Postgres на горячем пути. Причина: Messenger требует
 * 200 OK за 20 секунд и при неуспехе Meta ретраит до 7 дней. Если вебхуки
 * упираются в тот же процесс, что рендерит настройки и считает биллинг,
 * любой всплеск нагрузки превращается в лавину ретраев и деградацию
 * quality rating канала.
 */

const PORT = Number(process.env.PORT ?? 3001);
const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const META_APP_SECRET = process.env.META_APP_SECRET ?? '';
const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN ?? '';
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';

/** Сколько помним обработанные message_id. Meta ретраит до 7 дней. */
const DEDUP_TTL_SECONDS = 7 * 24 * 3600;

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    // Тела сообщений и токены в логи не попадают никогда.
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers["x-hub-signature-256"]',
        'req.headers["x-telegram-bot-api-secret-token"]',
        'req.body',
      ],
      remove: true,
    },
  },
  // Ограничение размера тела: защита от простейшего DoS.
  bodyLimit: 2 * 1024 * 1024,
  trustProxy: true,
});

/**
 * Сырое тело обязательно для проверки HMAC.
 * JSON.parse + повторная сериализация меняет байты — подпись не сойдётся,
 * и вы полдня будете искать несуществующую ошибку в секрете.
 */
app.addContentTypeParser(
  'application/json',
  { parseAs: 'buffer' },
  (req, body, done) => {
    (req as { rawBody?: Buffer }).rawBody = body as Buffer;
    try {
      done(null, JSON.parse((body as Buffer).toString('utf8')));
    } catch {
      done(null, {});
    }
  },
);

// family: 0 — поиск и IPv4, и IPv6. Внутренняя сеть Railway отдаёт
// адреса *.railway.internal по IPv6, а ioredis по умолчанию ищет
// только IPv4: без этой опции соединение с Redis просто не устанавливается.
const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null, family: 0 });
const inboundQueue = new Queue<InboundJob>(QUEUE_INBOUND, {
  connection: redis,
  defaultJobOptions,
});

/**
 * Дедуп через Redis SET NX.
 * Второй рубеж — UNIQUE-индекс в БД. Нужны оба: Redis может потерять ключ
 * при перезапуске, а база не должна принять дубль ни при каких условиях.
 */
async function seenBefore(channelId: string, externalId: string): Promise<boolean> {
  const key = dedupeKey(channelId, externalId);
  const set = await redis.set(key, '1', 'EX', DEDUP_TTL_SECONDS, 'NX');
  return set === null;
}

app.get('/health', async () => {
  const redisOk = redis.status === 'ready';
  return { status: redisOk ? 'ok' : 'degraded', redis: redis.status };
});

// ─────────────────────────────────────────────────────────────────────────
// Meta: WhatsApp, Instagram, Messenger
// ─────────────────────────────────────────────────────────────────────────

/** Верификация подписки при настройке вебхука в App Dashboard. */
app.get('/webhooks/meta', async (req, reply) => {
  const challenge = verifyMetaSubscription(
    req.query as Record<string, unknown>,
    META_VERIFY_TOKEN,
  );
  if (challenge === null) {
    app.log.warn('Неудачная верификация вебхука Meta');
    return reply.code(403).send('forbidden');
  }
  return reply.type('text/plain').send(challenge);
});

app.post('/webhooks/meta', async (req, reply) => {
  const raw = (req as { rawBody?: Buffer }).rawBody;
  const sig = req.headers['x-hub-signature-256'];

  if (!raw || !verifyMetaSignature(raw, typeof sig === 'string' ? sig : undefined, META_APP_SECRET)) {
    app.log.warn({ ip: req.ip }, 'Отклонён вебхук Meta: неверная подпись');
    return reply.code(401).send({ error: 'invalid_signature' });
  }

  // Отвечаем 200 немедленно, разбираем асинхронно.
  // Даже если payload кривой — Meta не должна получить ошибку и начать ретраи.
  void inboundQueue
    .add(
      'meta',
      {
        provider: 'meta',
        // Маршрутизация на конкретный канал/тенанта — работа воркера:
        // в payload есть phone_number_id / page_id / ig_id, по ним ищем канал.
        channelId: '',
        tenantId: '',
        payload: req.body,
        receivedAt: new Date().toISOString(),
      },
      { jobId: undefined },
    )
    .catch((err) => app.log.error({ err }, 'Не удалось поставить задачу meta в очередь'));

  return reply.code(200).send({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────
// Telegram
// ─────────────────────────────────────────────────────────────────────────

/**
 * Отдельный путь на канал: у каждого бота свой вебхук.
 * channelId в URL позволяет не искать канал по токену на горячем пути.
 */
app.post<{ Params: { channelId: string } }>(
  '/webhooks/telegram/:channelId',
  async (req, reply) => {
    const headerSecret = req.headers['x-telegram-bot-api-secret-token'];

    // Второй аргумент проверки — идентификатор канала: у клиента со
    // своим ботом секрет производный от него, и чужой не подойдёт.
    if (!verifyTelegramSecret(
      typeof headerSecret === 'string' ? headerSecret : undefined,
      TELEGRAM_WEBHOOK_SECRET,
      req.params.channelId,
    )) {
      app.log.warn({ ip: req.ip }, 'Отклонён вебхук Telegram: неверный secret_token');
      return reply.code(401).send({ error: 'invalid_secret' });
    }

    const { channelId } = req.params;
    const body = req.body as { update_id?: number; message?: { message_id?: number; chat?: { id?: number } } };

    // Дедуп по update_id: Telegram повторяет апдейт, пока не получит 200.
    if (typeof body?.update_id === 'number') {
      if (await seenBefore(channelId, `upd:${body.update_id}`)) {
        app.log.debug({ channelId, updateId: body.update_id }, 'Дубликат апдейта, пропущен');
        return reply.code(200).send({ ok: true, deduped: true });
      }
    }

    void inboundQueue
      .add('telegram', {
        provider: 'telegram',
        channelId,
        tenantId: '',
        payload: body,
        receivedAt: new Date().toISOString(),
      })
      .catch((err) => app.log.error({ err }, 'Не удалось поставить задачу telegram в очередь'));

    return reply.code(200).send({ ok: true });
  },
);

// ─────────────────────────────────────────────────────────────────────────

async function start(): Promise<void> {
  if (!META_APP_SECRET) app.log.warn('META_APP_SECRET не задан — вебхуки Meta будут отклоняться');
  if (!TELEGRAM_WEBHOOK_SECRET) {
    app.log.warn('TELEGRAM_WEBHOOK_SECRET не задан — вебхуки Telegram будут отклоняться');
  }

  await app.listen({ port: PORT, host: '0.0.0.0' });
  app.log.info(`ingress слушает :${PORT}`);
}

async function shutdown(signal: string): Promise<void> {
  app.log.info(`${signal}: завершаю работу`);
  // Порядок важен: сначала перестаём принимать, потом закрываем очередь.
  await app.close();
  await inboundQueue.close();
  redis.disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

start().catch((err) => {
  app.log.error({ err }, 'Не удалось запустить ingress');
  process.exit(1);
});
