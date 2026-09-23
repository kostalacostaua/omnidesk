import { Queue, UnrecoverableError, Worker } from 'bullmq';
import { createCrmSync } from './crm.js';
import { Redis } from 'ioredis';
import {
  QUEUE_INBOUND,
  QUEUE_MEDIA,
  QUEUE_OUTBOUND,
  QUEUE_MTPROTO_OUT,
  QUEUE_CRM_SYNC,
  QUEUE_SCENARIO,
  computeResponseWindow,
  createPool,
  defaultJobOptions,
  jobKey,
  createStorage,
  decryptJson,
  mediaKey,
  avatarKey,
  parseMasterKey,
  normalizeTelegram,
  normalizeTelegramReaction,
  type ReactionEvent,
  normalizeWhatsApp,
  normalizeMessaging,
  normalizeMessagingReactions,
  splitMessagingPayload,
  graphGet,
  graphPost,
  needsHumanAgentTag,
  MetaApiError,
  type MetaChannelCredentials,
  type MessagingEntry,
  withSystem,
  withTenant,
  answerMatches,
  pickScenario,
  AiError,
  askModel,
  needsHuman,
  type AiTurn,
  type CrmSyncJob,
  type ScenarioJob,
  type ScenarioLike,
  type ScenarioStep,
  type InboundJob,
  type MediaJob,
  type OutboundJob,
  type MetaWebhookPayload,
  type MtprotoInboundPayload,
  type TelegramUpdate,
  type UnifiedMessage,
} from '@omnidesk/core';

/**
 * Воркер входящих сообщений.
 *
 * Здесь происходит настоящая работа: определение канала и тенанта,
 * нормализация, запись в БД, обновление окна ответа.
 *
 * Всё, что пишется в БД, идёт через withTenant() — контекст RLS выставлен,
 * и даже запрос без явного фильтра не сможет тронуть чужие данные.
 */

const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const DATABASE_URL = process.env.DATABASE_URL ?? '';

// family: 0 — поиск и IPv4, и IPv6. Внутренняя сеть Railway отдаёт
// адреса *.railway.internal по IPv6, а ioredis по умолчанию ищет
// только IPv4: без этой опции соединение с Redis просто не устанавливается.
const connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null, family: 0 });
const pool = createPool(DATABASE_URL);
const masterKey = parseMasterKey(process.env['ENCRYPTION_MASTER_KEY']);
const TELEGRAM_API_ROOT = process.env['TELEGRAM_API_ROOT'] ?? 'https://api.telegram.org';
const storage = createStorage();
/** Боту Telegram отдаёт файлы не больше 20 МБ — ограничение платформы. */
const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
/** id нашего приложения Meta: по нему узнаём эхо собственных отправок. */
const META_APP_ID = process.env['META_APP_ID'] ?? '';
/** Meta отдаёт вложения до 25 МБ. */
const MAX_META_MEDIA_BYTES = 25 * 1024 * 1024;

const log = (level: string, msg: string, extra: Record<string, unknown> = {}): void => {
  // Структурированный лог. Содержимое сообщений сюда не попадает никогда.
  console.log(JSON.stringify({ level, msg, ts: new Date().toISOString(), ...extra }));
};

interface ChannelRow {
  id: string;
  tenant_id: string;
  type: string;
}

/**
 * Поиск канала по идентификатору у провайдера.
 *
 * Читаем channel_routes, а НЕ channels: когда пришёл вебхук, тенант ещё
 * неизвестен, а channels под RLS — без контекста запрос вернёт ноль строк.
 * В channel_routes нет пользовательских данных, только соответствие
 * «внешний идентификатор → тенант». Подробности — в 02-schema.sql.
 *
 * UNIQUE (channel_type, external_id) гарантирует, что один номер
 * принадлежит ровно одному тенанту.
 */
async function findChannel(
  type: string,
  externalId: string,
): Promise<ChannelRow | null> {
  return withSystem(pool, 'маршрутизация по внешнему id', async (db) => {
    const { rows } = await db.query<ChannelRow>(
      `SELECT channel_id AS id, tenant_id, channel_type AS type
         FROM channel_routes
        WHERE channel_type = $1 AND external_id = $2 AND status = 'active'
        LIMIT 1`,
      [type, externalId],
    );
    return rows[0] ?? null;
  });
}

async function findChannelById(channelId: string): Promise<ChannelRow | null> {
  return withSystem(pool, 'маршрутизация по id канала', async (db) => {
    const { rows } = await db.query<ChannelRow>(
      `SELECT channel_id AS id, tenant_id, channel_type AS type
         FROM channel_routes
        WHERE channel_id = $1 AND status = 'active'
        LIMIT 1`,
      [channelId],
    );
    return rows[0] ?? null;
  });
}

/**
 * Сохранение сообщения.
 *
 * Три вещи, которые здесь важны:
 *   · ON CONFLICT DO NOTHING по (tenant_id, channel_id, external_id) —
 *     последний рубеж защиты от дублей при ретраях Meta;
 *   · окно ответа пересчитывается на каждое входящее;
 *   · всё в одной транзакции с контекстом RLS.
 */
async function persistMessage(
  msg: UnifiedMessage,
): Promise<{
  inserted: boolean;
  messageId: string | null;
  conversationId: string | null;
  /** Контакт, которому принадлежит сообщение. */
  contactId: string | null;
  /** Заполнен, если у контакта ещё нет аватара — его нужно подтянуть. */
  avatarFor: string | null;
}> {
  return withTenant(pool, msg.tenantId, async (db) => {
    // 1. Контакт — ищем по идентичности в канале, создаём при первом обращении.
    const { rows: identityRows } = await db.query<{ contact_id: string }>(
      `SELECT contact_id FROM contact_identities
        WHERE tenant_id = $1 AND channel_type = $2 AND external_id = $3
        LIMIT 1`,
      [msg.tenantId, msg.channelType, msg.peerId],
    );

    let contactId = identityRows[0]?.contact_id;

    // access_hash у пользователя Telegram может смениться, а без
    // актуального значения ответить ему нельзя. Обновляем при каждом
    // сообщении, где он есть.
    if (contactId && msg.peerProfile.accessHash) {
      await db.query(
        `UPDATE contact_identities
            SET raw_profile = raw_profile || $4::jsonb
          WHERE tenant_id = $1 AND channel_type = $2 AND external_id = $3`,
        [msg.tenantId, msg.channelType, msg.peerId, JSON.stringify(msg.peerProfile)],
      );
    }

    if (!contactId) {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO contacts (tenant_id, display_name, phone_e164)
         VALUES ($1, $2, $3) RETURNING id`,
        [msg.tenantId, msg.peerProfile.name ?? null, msg.peerProfile.phone ?? null],
      );
      contactId = rows[0]!.id;

      // ON CONFLICT на случай гонки двух воркеров на первом сообщении.
      const { rows: linked } = await db.query<{ contact_id: string }>(
        `INSERT INTO contact_identities (tenant_id, contact_id, channel_type, external_id, raw_profile)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, channel_type, external_id) DO UPDATE
           SET raw_profile = EXCLUDED.raw_profile
         RETURNING contact_id`,
        [msg.tenantId, contactId, msg.channelType, msg.peerId, JSON.stringify(msg.peerProfile)],
      );
      // Если гонку выиграл другой воркер — берём его contact_id.
      contactId = linked[0]!.contact_id;
    }

    // 2. Диалог + окно ответа
    const window = computeResponseWindow(msg.channelType, msg.sentAt);

    const { rows: convRows } = await db.query<{ id: string }>(
      `INSERT INTO conversations
         (tenant_id, channel_id, contact_id, status,
          window_expires_at, window_type, last_message_at, unread_count)
       VALUES ($1, $2, $3, 'open', $4, $5, $6, $7::int)
       ON CONFLICT (tenant_id, channel_id, contact_id) DO UPDATE
         SET window_expires_at = CASE WHEN $7::int = 1 THEN EXCLUDED.window_expires_at
                                      ELSE conversations.window_expires_at END,
             window_type       = EXCLUDED.window_type,
             last_message_at   = EXCLUDED.last_message_at,
             unread_count      = conversations.unread_count + $7::int,
             status            = CASE WHEN $7::int = 1 AND conversations.status = 'resolved'
                                      THEN 'open' ELSE conversations.status END
       RETURNING id`,
      [
        msg.tenantId,
        msg.channelId,
        contactId,
        window.expiresAt,
        window.type,
        msg.sentAt,
        // Исходящее, написанное владельцем прямо с телефона (номерной
        // Telegram), не должно помечать диалог непрочитанным и открывать
        // закрытый: это ответ, а не обращение клиента.
        msg.direction === 'in' ? 1 : 0,
      ],
    );
    const conversationId = convRows[0]!.id;

    // 3. Сообщение
    const { rowCount, rows: msgRows } = await db.query<{ id: string }>(
      `INSERT INTO messages
         (tenant_id, conversation_id, channel_id, external_id, direction,
          sender_type, content, status, raw, sent_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       -- Предикат WHERE обязателен: messages_dedupe_idx — ЧАСТИЧНЫЙ уникальный
       -- индекс (external_id IS NOT NULL, т.к. у исходящих его ещё нет до
       -- отправки). Без повторения предиката Postgres не находит индекс
       -- и падает с «no unique or exclusion constraint matching».
       ON CONFLICT (tenant_id, channel_id, external_id)
         WHERE external_id IS NOT NULL
         DO NOTHING
       RETURNING id`,
      [
        msg.tenantId,
        conversationId,
        msg.channelId,
        msg.externalId,
        msg.direction,
        msg.senderType,
        JSON.stringify(msg.content),
        msg.status,
        JSON.stringify(msg.raw),
        msg.sentAt,
      ],
    );

    // Аватара может не быть у совсем нового контакта и у старого,
    // заведённого до появления этой возможности. Проверка одна на оба
    // случая — по факту отсутствия, а не по факту создания.
    const { rows: av } = await db.query<{ avatar_url: string | null }>(
      `SELECT avatar_url FROM contacts WHERE id = $1`,
      [contactId],
    );

    return {
      inserted: (rowCount ?? 0) > 0,
      messageId: msgRows[0]?.id ?? null,
      conversationId,
      contactId,
      avatarFor: av[0]?.avatar_url ? null : contactId,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════
// Вложения
// ═══════════════════════════════════════════════════════════════════════

const mediaQueue = new Queue<MediaJob>(QUEUE_MEDIA, { connection, defaultJobOptions });

/** Исходящие номерного Telegram — их отправляет сервис sessions. */
const mtprotoOutQueue = new Queue<OutboundJob>(QUEUE_MTPROTO_OUT, { connection, defaultJobOptions });

/** Очередь исходящих: сюда бот кладёт свои автоответы. */
const outboundQueue = new Queue<OutboundJob>(QUEUE_OUTBOUND, { connection, defaultJobOptions });

/** Продолжение сценариев после паузы и по истечении ожидания ответа. */
const scenarioQueue = new Queue<ScenarioJob>(QUEUE_SCENARIO, { connection, defaultJobOptions });

/** Связка контактов с CRM: поиск карточки и заведение лида. */
const crmQueue = new Queue<CrmSyncJob>(QUEUE_CRM_SYNC, { connection, defaultJobOptions });

/**
 * Постановка вложений в очередь скачивания.
 *
 * Скачивание вынесено из обработки сообщения намеренно. Файл может весить
 * десяток мегабайт и качаться секундами; держать ради этого транзакцию
 * и место в очереди входящих — значит замедлить приём текста для всех
 * остальных. Текст сообщения появляется у оператора сразу, картинка
 * подтягивается следом.
 */
async function enqueueMedia(
  msg: UnifiedMessage,
  messageId: string,
  provider: 'telegram' | 'meta',
): Promise<void> {
  const list = msg.content.attachments ?? [];
  for (let i = 0; i < list.length; i++) {
    const att = list[i]!;
    if (!att.externalId) continue;
    await mediaQueue.add(
      'download',
      {
        tenantId: msg.tenantId,
        channelId: msg.channelId,
        messageId,
        attachmentIndex: i,
        provider,
        externalId: att.externalId,
      },
      // jobId по сообщению и индексу: повторная постановка того же
      // вложения не приведёт ко второму скачиванию.
      { jobId: jobKey(messageId, i) },
    );
  }
}

/**
 * Постановка аватара в очередь.
 *
 * jobId привязан к контакту, а не к сообщению: пока задача не выполнена,
 * повторные сообщения от того же человека не наплодят десяток одинаковых
 * скачиваний.
 */
async function enqueueAvatar(
  msg: UnifiedMessage,
  contactId: string,
  provider: 'telegram' | 'meta',
  pictureUrl?: string,
): Promise<void> {
  // У Meta фото отдаётся ссылкой вместе с профилем: без ссылки качать нечего.
  if (provider === 'meta' && !pictureUrl) return;
  await mediaQueue.add(
    'avatar',
    {
      tenantId: msg.tenantId,
      channelId: msg.channelId,
      messageId: '',
      attachmentIndex: 0,
      provider,
      externalId: pictureUrl ?? msg.peerId,
      kind: 'avatar',
      contactId,
      peerId: msg.peerId,
    },
    { jobId: jobKey('avatar', contactId), priority: 10 },
  );
}

async function channelToken(tenantId: string, channelId: string): Promise<string | null> {
  const creds = await withTenant(pool, tenantId, async (db) => {
    const { rows } = await db.query<{ credentials_enc: Buffer }>(
      `SELECT credentials_enc FROM channels WHERE id = $1 LIMIT 1`,
      [channelId],
    );
    return rows[0]?.credentials_enc ?? null;
  });
  if (!creds) return null;
  return decryptJson<{ botToken: string }>(masterKey, tenantId, creds).botToken;
}

/**
 * Скачивание аватара контакта.
 *
 * Telegram отдаёт фото профиля только тех, кто уже писал боту, — что
 * ровно наш случай. Отсутствие фото не ошибка: у половины людей его нет,
 * и тогда в интерфейсе остаются инициалы.
 */
async function handleAvatar(job: MediaJob): Promise<void> {
  if (!job.contactId || !job.peerId) return;
  if (job.provider === 'meta') {
    // Ссылка на фото профиля Meta подписана и живёт несколько дней,
    // поэтому храним копию у себя, а не саму ссылку.
    if (!/^https:[/][/]/.test(job.externalId)) return;
    const res = await fetch(job.externalId, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return;
    const bytes = Buffer.from(await res.arrayBuffer());
    const key = avatarKey(job.tenantId, job.contactId);
    await storage.put(key, bytes, res.headers.get('content-type') ?? 'image/jpeg');
    await withTenant(pool, job.tenantId, async (db) => {
      await db.query(`UPDATE contacts SET avatar_url = $2 WHERE id = $1`, [job.contactId, key]);
    });
    return;
  }
  if (job.provider !== 'telegram') return;

  const token = await channelToken(job.tenantId, job.channelId);
  if (!token) throw new UnrecoverableError('Канал удалён или недоступен');

  const res = await fetch(`${TELEGRAM_API_ROOT}/bot${token}/getUserProfilePhotos`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ user_id: Number(job.peerId), limit: 1 }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json()) as {
    ok: boolean;
    result?: { total_count: number; photos: Array<Array<{ file_id: string; width: number }>> };
  };

  const sizes = body.result?.photos?.[0];
  if (!body.ok || !sizes || !sizes.length) {
    log('debug', 'У контакта нет фото профиля', { contactId: job.contactId });
    return;
  }

  // Берём размер около 160 пикселей: в списке аватар 34 пикселя, в карточке 42.
  // Самый большой — это 640 и несколько сот килобайт на каждого клиента,
  // что на тысяче контактов превращается в лишние сотни мегабайт.
  const pick =
    sizes.filter((x) => x.width >= 160)[0] ?? sizes[sizes.length - 1]!;

  const infoRes = await fetch(`${TELEGRAM_API_ROOT}/bot${token}/getFile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ file_id: pick.file_id }),
    signal: AbortSignal.timeout(20_000),
  });
  const info = (await infoRes.json()) as { ok: boolean; result?: { file_path?: string } };
  if (!info.ok || !info.result?.file_path) return;

  const fileRes = await fetch(`${TELEGRAM_API_ROOT}/file/bot${token}/${info.result.file_path}`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!fileRes.ok) throw new Error(`Скачивание аватара вернуло ${fileRes.status}`);

  const bytes = Buffer.from(await fileRes.arrayBuffer());
  const key = avatarKey(job.tenantId, job.contactId);
  await storage.put(key, bytes, fileRes.headers.get('content-type') ?? 'image/jpeg');

  await withTenant(pool, job.tenantId, async (db) => {
    await db.query(`UPDATE contacts SET avatar_url = $2 WHERE id = $1`, [job.contactId, key]);
  });

  log('info', 'Аватар сохранён', { contactId: job.contactId, size: bytes.length });
}

async function handleMedia(job: MediaJob): Promise<void> {
  if (job.kind === 'avatar') return handleAvatar(job);

  if (job.provider === 'meta' && /^https:[/][/]/.test(job.externalId)) {
    return handleMetaMedia(job);
  }
  if (job.provider !== 'telegram') {
    throw new UnrecoverableError(`Скачивание для ${job.provider} ещё не реализовано`);
  }

  const token = await channelToken(job.tenantId, job.channelId);
  if (!token) throw new UnrecoverableError('Канал удалён или недоступен');

  // Шаг 1: узнаём путь к файлу. Он живёт около часа, поэтому качать надо сразу.
  const infoRes = await fetch(`${TELEGRAM_API_ROOT}/bot${token}/getFile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ file_id: job.externalId }),
    signal: AbortSignal.timeout(20_000),
  });
  const info = (await infoRes.json()) as {
    ok: boolean;
    result?: { file_path?: string; file_size?: number };
    description?: string;
  };

  if (!info.ok || !info.result?.file_path) {
    // «file is too big» — постоянная ошибка: боту Telegram отдаёт
    // максимум 20 МБ, и повторять бессмысленно.
    await markAttachment(job, { error: info.description ?? 'getFile failed' });
    throw new UnrecoverableError(`Telegram отказал в файле: ${info.description}`);
  }

  if ((info.result.file_size ?? 0) > MAX_MEDIA_BYTES) {
    await markAttachment(job, { error: 'too_large', size: info.result.file_size });
    throw new UnrecoverableError('Файл больше 20 МБ — Telegram не отдаёт его боту');
  }

  // Шаг 2: качаем.
  const fileRes = await fetch(
    `${TELEGRAM_API_ROOT}/file/bot${token}/${info.result.file_path}`,
    { signal: AbortSignal.timeout(60_000) },
  );
  if (!fileRes.ok) throw new Error(`Скачивание вернуло ${fileRes.status}`);

  const body = Buffer.from(await fileRes.arrayBuffer());
  if (body.length > MAX_MEDIA_BYTES) {
    await markAttachment(job, { error: 'too_large', size: body.length });
    throw new UnrecoverableError('Файл больше допустимого размера');
  }

  const contentType = fileRes.headers.get('content-type') ?? guessType(info.result.file_path);
  const key = mediaKey(job.tenantId, job.messageId, job.attachmentIndex);
  await storage.put(key, body, contentType);

  // Шаг 3: помечаем вложение скачанным прямо в JSONB сообщения.
  // Отдельная таблица здесь была бы лишней сущностью: вложение не живёт
  // без сообщения и всегда читается вместе с ним.
  await withTenant(pool, job.tenantId, async (db) => {
    await db.query(
      `UPDATE messages
          SET content = jsonb_set(
                content,
                ARRAY['attachments', $2::text],
                COALESCE(content->'attachments'->$3::int, '{}'::jsonb)
                  || jsonb_build_object(
                       'storageKey', $4::text,
                       'mime',       $5::text,
                       'size',       $6::int,
                       'ready',      true)
              )
        WHERE id = $1`,
      [
        job.messageId,
        String(job.attachmentIndex),
        job.attachmentIndex,
        key,
        contentType,
        body.length,
      ],
    );
  });

  log('info', 'Вложение сохранено', {
    messageId: job.messageId,
    index: job.attachmentIndex,
    size: body.length,
    storage: storage.kind,
  });
}

/**
 * Вложение из Messenger / Instagram.
 *
 * Meta присылает прямую ссылку на CDN — токен не нужен, но ссылка живёт
 * ограниченное время. Поэтому качаем сразу и храним копию.
 */
async function handleMetaMedia(job: MediaJob): Promise<void> {
  const res = await fetch(job.externalId, { signal: AbortSignal.timeout(60_000) });
  if (res.status === 403 || res.status === 404 || res.status === 410) {
    await markAttachment(job, { error: 'link_expired', status: res.status });
    throw new UnrecoverableError('Ссылка на вложение истекла');
  }
  if (!res.ok) throw new Error(`Скачивание вернуло ${res.status}`);
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length > MAX_META_MEDIA_BYTES) {
    await markAttachment(job, { error: 'too_large', size: body.length });
    throw new UnrecoverableError('Файл больше допустимого размера');
  }
  const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
  const key = mediaKey(job.tenantId, job.messageId, job.attachmentIndex);
  await storage.put(key, body, contentType);
  await withTenant(pool, job.tenantId, async (db) => {
    await db.query(
      `UPDATE messages
          SET content = jsonb_set(
                content,
                ARRAY['attachments', $2::text],
                (COALESCE(content->'attachments'->$3::int, '{}'::jsonb) - 'externalId')
                  || jsonb_build_object(
                       'storageKey', $4::text,
                       'mime',       $5::text,
                       'size',       $6::int,
                       'ready',      true)
              )
        WHERE id = $1`,
      [job.messageId, String(job.attachmentIndex), job.attachmentIndex, key, contentType, body.length],
    );
  });
  log('info', 'Вложение Meta сохранено', { messageId: job.messageId, size: body.length });
}

/** Отмечает вложение как недоступное, чтобы интерфейс не ждал его вечно. */
async function markAttachment(job: MediaJob, failure: Record<string, unknown>): Promise<void> {
  await withTenant(pool, job.tenantId, async (db) => {
    await db.query(
      `UPDATE messages
          SET content = jsonb_set(
                content,
                ARRAY['attachments', $2::text],
                COALESCE(content->'attachments'->$3::int, '{}'::jsonb)
                  || jsonb_build_object('ready', false, 'failure', $4::jsonb)
              )
        WHERE id = $1`,
      [job.messageId, String(job.attachmentIndex), job.attachmentIndex, JSON.stringify(failure)],
    );
  });
}

function guessType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', mp4: 'video/mp4', mov: 'video/quicktime',
    ogg: 'audio/ogg', oga: 'audio/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4',
    pdf: 'application/pdf', webm: 'video/webm',
  };
  return map[ext] ?? 'application/octet-stream';
}

const mediaWorker = new Worker<MediaJob>(QUEUE_MEDIA, async (job) => handleMedia(job.data), {
  connection,
  concurrency: Number(process.env['MEDIA_CONCURRENCY'] ?? 3),
});

mediaWorker.on('failed', (job, err) => {
  log('error', 'Не удалось скачать вложение', {
    messageId: job?.data?.messageId,
    index: job?.data?.attachmentIndex,
    error: err.message,
  });
});

mediaWorker.on('ready', () => log('info', 'Воркер вложений запущен'));

/** Извлекает phone_number_id из вебхука WhatsApp — по нему находим канал. */
function extractWhatsAppPhoneNumberId(payload: MetaWebhookPayload): string | null {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const id = change.value?.metadata?.phone_number_id;
      if (id) return id;
    }
  }
  return null;
}

async function handleInbound(job: InboundJob): Promise<void> {
  if (job.provider === 'mtproto') return handleMtprotoInbound(job);
  if (job.provider === 'telegram') {
    const channel = await findChannelById(job.channelId);
    if (!channel) {
      log('warn', 'Канал не найден или отключён', { channelId: job.channelId });
      return; // не ретраим: канал удалён, это не временная ошибка
    }

    // Реакция приезжает отдельным обновлением и сообщения не создаёт:
    // она меняет уже существующее.
    const reaction = normalizeTelegramReaction(job.payload as TelegramUpdate);
    if (reaction) {
      await applyReaction(channel.tenant_id, channel.id, reaction);
      return;
    }

    const messages = normalizeTelegram(
      { tenantId: channel.tenant_id, channelId: channel.id },
      job.payload as TelegramUpdate,
    );

    for (const m of messages) {
      const { inserted, messageId, conversationId, contactId, avatarFor } = await persistMessage(m);
      log('info', inserted ? 'Сообщение сохранено' : 'Дубликат, пропущен', {
        channelId: channel.id,
        externalId: m.externalId,
      });
      if (inserted && messageId) await enqueueMedia(m, messageId, 'telegram');
      if (inserted && avatarFor) await enqueueAvatar(m, avatarFor, 'telegram');
      if (inserted && contactId && m.direction === 'in') {
        await enqueueCrm(m, contactId, conversationId);
      }
      // Бот запускается только на новых входящих: на дубликате он
      // ответил бы второй раз на то же самое сообщение.
      if (inserted && conversationId && m.direction === 'in') {
        const sent = await runBot(m, conversationId);
        if (sent) log('info', 'Бот ответил', { conversationId, replies: sent });
      }
    }
    return;
  }

  if (job.provider === 'meta') {
    const payload = job.payload as MetaWebhookPayload;
    if (payload.object === 'page' || payload.object === 'instagram') {
      for (const entry of splitMessagingPayload(payload)) await handleMessagingEntry(entry);
      return;
    }
    const phoneNumberId = extractWhatsAppPhoneNumberId(payload);

    if (!phoneNumberId) {
      log('debug', 'Вебхук Meta без phone_number_id — вероятно, только статусы');
      return;
    }

    const channel = await findChannel('whatsapp', phoneNumberId);
    if (!channel) {
      log('warn', 'Канал WhatsApp не найден', { phoneNumberId });
      return;
    }

    const messages = normalizeWhatsApp(
      { tenantId: channel.tenant_id, channelId: channel.id },
      payload,
    );

    for (const m of messages) {
      const { inserted, messageId, conversationId, contactId, avatarFor } = await persistMessage(m);
      log('info', inserted ? 'Сообщение сохранено' : 'Дубликат, пропущен', {
        channelId: channel.id,
        externalId: m.externalId,
      });
      if (inserted && messageId) await enqueueMedia(m, messageId, 'meta');
      if (inserted && avatarFor) await enqueueAvatar(m, avatarFor, 'meta');
      if (inserted && contactId && m.direction === 'in') {
        await enqueueCrm(m, contactId, conversationId);
      }
      if (inserted && conversationId && m.direction === 'in') {
        const sent = await runBot(m, conversationId);
        if (sent) log('info', 'Бот ответил', { conversationId, replies: sent });
      }
    }
  }
}


async function metaCredentials(tenantId: string, channelId: string): Promise<MetaChannelCredentials | null> {
  const creds = await withTenant(pool, tenantId, async (db) => {
    const { rows } = await db.query<{ credentials_enc: Buffer }>(
      `SELECT credentials_enc FROM channels WHERE id = $1 LIMIT 1`,
      [channelId],
    );
    return rows[0]?.credentials_enc ?? null;
  });
  return creds ? decryptJson<MetaChannelCredentials>(masterKey, tenantId, creds) : null;
}

/**
 * Профиль собеседника в Messenger / Instagram.
 *
 * Имя в вебхуке не приходит — только числовой id. Запрашиваем профиль
 * один раз, при первом сообщении нового человека. Ошибку не пробрасываем:
 * без имени диалог всё равно должен появиться, просто с id вместо имени.
 */
async function metaProfile(
  type: 'messenger' | 'instagram',
  peerId: string,
  token: string,
): Promise<{ name?: string; username?: string; picture?: string }> {
  try {
    if (type === 'messenger') {
      const p = await graphGet<{ first_name?: string; last_name?: string; profile_pic?: string }>(
        peerId,
        { fields: 'first_name,last_name,profile_pic', access_token: token },
      );
      const name = [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
      return Object.assign({}, name ? { name } : {}, p.profile_pic ? { picture: p.profile_pic } : {});
    }
    const p = await graphGet<{ name?: string; username?: string; profile_pic?: string }>(peerId, {
      fields: 'name,username,profile_pic',
      access_token: token,
    });
    return Object.assign(
      {},
      p.name || p.username ? { name: p.name || p.username } : {},
      p.username ? { username: p.username } : {},
      p.profile_pic ? { picture: p.profile_pic } : {},
    );
  } catch (err) {
    log('warn', 'Профиль собеседника не получен', { type, peerId, error: (err as Error).message });
    return {};
  }
}

async function identityExists(tenantId: string, type: string, peerId: string): Promise<boolean> {
  return withTenant(pool, tenantId, async (db) => {
    const { rows } = await db.query(
      `SELECT 1 FROM contact_identities WHERE tenant_id = $1 AND channel_type = $2 AND external_id = $3 LIMIT 1`,
      [tenantId, type, peerId],
    );
    return rows.length > 0;
  });
}

async function handleMessagingEntry(entry: MessagingEntry): Promise<void> {
  const channel = await findChannel(entry.channelType, entry.channelExternalId);
  if (!channel) {
    log('warn', 'Канал Meta не найден', { type: entry.channelType, id: entry.channelExternalId });
    return;
  }

  const messages = normalizeMessaging(
    { tenantId: channel.tenant_id, channelId: channel.id },
    entry,
    META_APP_ID,
  );

  const creds = await metaCredentials(channel.tenant_id, channel.id);
  for (const m of messages) {
    // Эхо собственной отправки должно успеть получить external_id,
    // иначе уникальный индекс его не узнает и в ленте будет копия.
    if (m.direction === 'out') await new Promise((r) => setTimeout(r, 3000));

    // Профиль спрашиваем у Meta, если собеседник новый: в вебхуке
    // приходит только числовой id, без имени и фото.
    let profile: { name?: string; username?: string; picture?: string } = {};
    const known = await identityExists(channel.tenant_id, m.channelType, m.peerId);
    if (creds && !known) {
      profile = await metaProfile(entry.channelType, m.peerId, creds.pageToken);
      if (profile.name) m.peerProfile.name = profile.name;
      if (profile.username) m.peerProfile.username = profile.username;
    }

    const { inserted, messageId, conversationId, contactId, avatarFor } = await persistMessage(m);
    log('info', inserted ? 'Сообщение сохранено' : 'Дубликат, пропущен', {
      channelId: channel.id,
      externalId: m.externalId,
    });
    if (inserted && messageId) await enqueueMedia(m, messageId, 'meta');
    if (inserted && contactId && m.direction === 'in') {
      await enqueueCrm(m, contactId, conversationId);
    }

    // Контакт без аватара мог появиться раньше — тогда профиль спрашиваем
    // сейчас. Иначе у давних диалогов аватар не появился бы никогда.
    if (avatarFor && creds) {
      if (!profile.picture && known) profile = await metaProfile(entry.channelType, m.peerId, creds.pageToken);
      if (profile.picture) {
        await enqueueAvatar(m, avatarFor, 'meta', profile.picture);
        log('info', 'Аватар Meta поставлен в очередь', { contactId: avatarFor });
      } else {
        log('warn', 'Meta не отдала фото профиля', { contactId: avatarFor, peerId: m.peerId });
      }
    }
    if (inserted && conversationId && m.direction === 'in') {
      const sent = await runBot(m, conversationId);
      if (sent) log('info', 'Бот ответил', { conversationId, replies: sent });
    }
  }

  // Реакции после сообщений: в одной пачке реакция может прийти
  // на сообщение, которое записывается строкой выше.
  for (const r of normalizeMessagingReactions(entry)) {
    await applyReaction(channel.tenant_id, channel.id, r);
  }
}

/**
 * Входящее из номерного Telegram.
 *
 * Сообщение уже нормализовано сервисом sessions, вложения уже лежат
 * в хранилище. Здесь то же, что для остальных каналов: запись,
 * аватар, бот. Канал перепроверяется по маршрутам: пока задача
 * стояла в очереди, его могли отключить.
 */
async function handleMtprotoInbound(job: InboundJob): Promise<void> {
  const channel = await findChannelById(job.channelId);
  if (!channel || channel.tenant_id !== job.tenantId) {
    log('warn', 'Канал не найден или отключён', { channelId: job.channelId });
    return;
  }
  const payload = job.payload as MtprotoInboundPayload;
  const m: UnifiedMessage = {
    ...payload.message,
    tenantId: channel.tenant_id,
    channelId: channel.id,
    channelType: 'telegram_user',
    sentAt: new Date(payload.message.sentAt),
  };
  const { inserted, conversationId, contactId, avatarFor } = await persistMessage(m);
  log('info', inserted ? 'Сообщение сохранено' : 'Дубликат, пропущен', {
    channelId: channel.id,
    externalId: m.externalId,
  });
  if (inserted && contactId && m.direction === 'in') {
    await enqueueCrm(m, contactId, conversationId);
  }

  if (avatarFor && payload.avatarKey) {
    const set = await withTenant(pool, channel.tenant_id, async (db) => {
      const { rowCount } = await db.query(
        `UPDATE contacts SET avatar_url = $2 WHERE id = $1 AND avatar_url IS NULL`,
        [avatarFor, payload.avatarKey],
      );
      return rowCount ?? 0;
    });
    log(set ? 'info' : 'debug', set ? 'Аватар привязан к контакту' : 'Аватар не привязан', {
      contactId: avatarFor,
      key: payload.avatarKey,
    });
  } else if (avatarFor) {
    log('debug', 'Аватар не приехал вместе с сообщением', { contactId: avatarFor });
  }
  if (inserted && conversationId && m.direction === 'in') {
    const sent = await runBot(m, conversationId);
    if (sent) log('info', 'Бот ответил', { conversationId, replies: sent });
  }
}

/**
 * Запись реакции клиента на сообщение.
 *
 * Telegram присылает полный новый набор реакций пользователя, а не
 * разницу, поэтому здесь нет логики «добавить/убрать» — набор просто
 * заменяется. Пустой массив означает, что реакцию сняли.
 *
 * Если сообщение не нашлось, это не ошибка: реакцию могли поставить
 * на сообщение, отправленное до подключения канала.
 */
async function applyReaction(
  tenantId: string,
  channelId: string,
  event: ReactionEvent,
): Promise<void> {
  const updated = await withTenant(pool, tenantId, async (db) => {
    const { rowCount } = await db.query(
      `UPDATE messages
          SET reactions = $3::jsonb
        WHERE channel_id = $1 AND external_id = $2`,
      [
        channelId,
        event.externalId,
        JSON.stringify(event.emojis.map((emoji) => ({ emoji, by: 'customer' }))),
      ],
    );
    return rowCount ?? 0;
  });

  log(updated ? 'info' : 'debug',
    updated ? 'Реакция записана' : 'Реакция на неизвестное сообщение',
    { externalId: event.externalId, emojis: event.emojis });
}

// ═══════════════════════════════════════════════════════════════════════
// Чат-бот: автоответы по правилам
// ═══════════════════════════════════════════════════════════════════════

/**
 * Почему правила, а не граф сценария.
 *
 * Визуальный конструктор сценариев выглядит внушительнее, но у него есть
 * свойство, которое дорого стоит в поддержке: состояние. Подписчик
 * «застревает» на шаге, и понять, почему он не отвечает, можно только
 * подняв его состояние в базе. Правило же не имеет состояния: пришёл
 * текст — посчитали — ответили. Это покрывает почти все реальные
 * автоответы: приветствие, прайс, часы работы, адрес, «оператор».
 *
 * Три предохранителя, без которых бот превращается в проблему:
 *   · после ответа живого оператора бот в диалоге молчит;
 *   · приветствие уходит ровно один раз за диалог;
 *   · сработавшее правило со stop_after останавливает разбор.
 */

interface BotRule {
  id: string;
  trigger_type: 'welcome' | 'equals' | 'contains' | 'fallback';
  keywords: string[];
  reply_text: string;
  stop_after: boolean;
}

interface ConvState {
  bot_enabled: boolean;
  bot_replied_at: Date | null;
  human_recently: boolean;
  assignee_id: string | null;
  incoming_count: string;
}

/**
 * Пауза бота после ответа оператора.
 *
 * Первая версия молчала до конца диалога: ответил человек — бот выключен
 * навсегда. Это оказалось слишком грубо. Диалог живёт неделями: клиент
 * пишет в понедельник, оператор отвечает, а в пятницу тот же клиент
 * ночью спрашивает про цену — и не получает ничего, хотя правило есть
 * и включено. Со стороны это выглядит просто как «бот не работает».
 *
 * Полчаса — время, за которое разговор либо продолжается, либо
 * заканчивается. Внутри этого окна автоответ действительно перебивал бы
 * живую беседу; за его пределами он снова полезен.
 */
const BOT_PAUSE_AFTER_HUMAN = '30 minutes';

function ruleMatches(rule: BotRule, text: string, isFirstMessage: boolean): boolean {
  const t = text.trim().toLowerCase();

  if (rule.trigger_type === 'welcome') return isFirstMessage;
  if (rule.trigger_type === 'fallback') return true;
  if (!t) return false;

  if (rule.trigger_type === 'equals') {
    return rule.keywords.some((k) => k === t);
  }
  return rule.keywords.some((k) => k.length > 0 && t.includes(k));
}

/**
 * Подбор и отправка автоответа на входящее сообщение.
 *
 * Возвращает число отправленных ответов — для лога.
 */
/**
 * Постановка задачи на связку с CRM.
 *
 * Ставится один раз на контакт: ключ задачи — идентификатор контакта,
 * и повторная постановка за то же сообщение ничего не создаст. Внутри
 * задача ещё раз убеждается, что связи нет, — иначе два входящих
 * подряд от нового человека завели бы в CRM два лида.
 */
async function enqueueCrm(
  msg: UnifiedMessage,
  contactId: string,
  conversationId: string | null,
): Promise<void> {
  const text = typeof msg.content.text === 'string' ? msg.content.text : '';
  await crmQueue.add(
    'sync',
    {
      tenantId: msg.tenantId,
      contactId,
      conversationId,
      channelType: msg.channelType,
      ...(text ? { firstText: text.slice(0, 500) } : {}),
    },
    { jobId: jobKey('crm', contactId) },
  );
}

/**
 * Автоматика: выбор сценария и его выполнение.
 *
 * Сценарий — цепочка шагов, а не одно правило. Поэтому здесь две части:
 * решение «запускать ли и что», и сам ход по шагам, который умеет
 * останавливаться на паузе или ожидании ответа и продолжаться через
 * очередь — даже если сервис между этими моментами перезапустили.
 */

interface ConvState {
  bot_enabled: boolean;
  bot_replied_at: Date | null;
  assignee_id: string | null;
  human_recently: boolean;
  incoming_count: string;
}

interface RunRow {
  id: string;
  scenario_id: string;
  step_index: number;
  waiting_for: string | null;
  answers: Record<string, string>;
  channel_id: string;
}

/** Строка сценария из базы в вид, понятный чистой части в core. */
function toScenario(row: {
  id: string;
  channel_id: string | null;
  trigger_type: string;
  keywords: string[];
  schedule: unknown;
  steps: unknown;
  priority: number;
}): ScenarioLike {
  return {
    id: row.id,
    channelId: row.channel_id,
    triggerType: row.trigger_type as ScenarioLike['triggerType'],
    keywords: row.keywords ?? [],
    schedule: (row.schedule ?? {}) as ScenarioLike['schedule'],
    steps: (row.steps ?? []) as ScenarioStep[],
    priority: row.priority,
  };
}

/**
 * Отправка сообщения от имени бота.
 *
 * Пишется в ту же ленту с пометкой «бот»: оператор должен видеть, что
 * клиенту уже ответили, и что именно. Иначе он здоровается второй раз.
 */
async function botSay(
  tenantId: string,
  conversationId: string,
  channelId: string,
  text: string,
  attachments?: Array<Record<string, unknown>>,
): Promise<void> {
  const messageId = await withTenant(pool, tenantId, async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO messages
         (tenant_id, conversation_id, channel_id, direction, sender_type,
          content, status, sent_at)
       VALUES ($1, $2, $3, 'out', 'bot', $4, 'pending', now())
       RETURNING id`,
      [
        tenantId,
        conversationId,
        channelId,
        JSON.stringify(
          Object.assign(text ? { text } : {}, attachments?.length ? { attachments } : {}),
        ),
      ],
    );
    await db.query(
      `UPDATE conversations SET bot_replied_at = now(), last_message_at = now() WHERE id = $1`,
      [conversationId],
    );
    return rows[0]!.id;
  });

  await outboundQueue.add(
    'send',
    { tenantId, channelId, conversationId, messageId, idempotencyKey: messageId },
    { jobId: messageId },
  );
}

/**
 * Ход по шагам.
 *
 * Возвращает число отправленных сообщений — оно уходит в журнал, чтобы
 * «бот молчит» и «бот отработал, но шагов не было» не выглядели одинаково.
 *
 * Ограничение в сорок шагов за один заход — защита от кольца: развилка,
 * которая прыгает сама на себя, иначе крутилась бы вечно и выжирала
 * соединение с базой.
 */
async function advanceRun(tenantId: string, runId: string): Promise<number> {
  let sent = 0;

  for (let guard = 0; guard < 40; guard++) {
    const run = await withTenant(pool, tenantId, async (db) => {
      const { rows } = await db.query<
        RunRow & { steps: ScenarioStep[]; conversation_id: string; status: string }
      >(
        `SELECT r.id, r.scenario_id, r.step_index, r.waiting_for, r.answers, r.status,
                r.conversation_id, s.steps, c.channel_id
           FROM scenario_runs r
           JOIN scenarios s ON s.id = r.scenario_id
           JOIN conversations c ON c.id = r.conversation_id
          WHERE r.id = $1`,
        [runId],
      );
      return rows[0] ?? null;
    });

    if (!run || run.status === 'done' || run.status === 'stopped') return sent;

    const steps = (run.steps ?? []) as ScenarioStep[];
    const step = steps[run.step_index];

    // Шаги кончились — сценарий отработал.
    if (!step) {
      await withTenant(pool, tenantId, async (db) => {
        await db.query(
          `UPDATE scenario_runs SET status = 'done', waiting_for = NULL, updated_at = now()
            WHERE id = $1`,
          [runId],
        );
        await db.query(
          `UPDATE scenarios SET runs_finished = runs_finished + 1 WHERE id = $1`,
          [run.scenario_id],
        );
      });
      return sent;
    }

    const goNext = async (index: number): Promise<void> => {
      await withTenant(pool, tenantId, async (db) => {
        await db.query(
          `UPDATE scenario_runs
              SET step_index = $2, status = 'running', waiting_for = NULL,
                  wait_until = NULL, updated_at = now()
            WHERE id = $1`,
          [runId, index],
        );
      });
    };

    switch (step.kind) {
      case 'message':
        await botSay(tenantId, run.conversation_id, run.channel_id, step.text, step.attachments);
        sent++;
        await goNext(run.step_index + 1);
        break;

      case 'delay': {
        await withTenant(pool, tenantId, async (db) => {
          await db.query(
            `UPDATE scenario_runs
                SET status = 'waiting', waiting_for = 'time',
                    wait_until = now() + ($2 || ' seconds')::interval,
                    step_index = $3, updated_at = now()
              WHERE id = $1`,
            [runId, String(step.seconds), run.step_index + 1],
          );
        });
        await scenarioQueue.add(
          'continue',
          { tenantId, runId, reason: 'delay' },
          { delay: step.seconds * 1000, jobId: jobKey('scn', runId, String(run.step_index)) },
        );
        return sent;
      }

      case 'ask': {
        await botSay(tenantId, run.conversation_id, run.channel_id, step.text);
        sent++;
        await withTenant(pool, tenantId, async (db) => {
          await db.query(
            `UPDATE scenario_runs
                SET status = 'waiting', waiting_for = 'reply', step_index = $2,
                    wait_until = CASE WHEN $3::int > 0
                                      THEN now() + ($3 || ' minutes')::interval END,
                    updated_at = now()
              WHERE id = $1`,
            [runId, run.step_index + 1, String(step.timeoutMinutes ?? 0)],
          );
        });
        if (step.timeoutMinutes) {
          await scenarioQueue.add(
            'continue',
            { tenantId, runId, reason: 'timeout' },
            {
              delay: step.timeoutMinutes * 60_000,
              jobId: jobKey('scn-to', runId, String(run.step_index)),
            },
          );
        }
        return sent;
      }

      case 'condition': {
        const last = run.answers?.['__last'] ?? '';
        const hit = answerMatches(step.contains, last);
        const next = hit ? step.goto : (step.elseGoto ?? run.step_index + 1);
        // Прыжок назад разрешён — им делают повтор вопроса, — но только
        // в пределах сценария; всё остальное считаем концом.
        await goNext(next >= 0 && next < steps.length ? next : steps.length);
        break;
      }

      case 'tag':
        await withTenant(pool, tenantId, async (db) => {
          await db.query(
            `UPDATE conversations
                SET tags = ARRAY(SELECT DISTINCT unnest(tags || $2::text))
              WHERE id = $1`,
            [run.conversation_id, step.tag],
          );
        });
        await goNext(run.step_index + 1);
        break;

      case 'handoff':
        await withTenant(pool, tenantId, async (db) => {
          // Бот замолкает в этом диалоге: дальше разговор ведёт человек.
          await db.query(
            `UPDATE conversations SET bot_enabled = false, status = 'open' WHERE id = $1`,
            [run.conversation_id],
          );
          await db.query(
            `UPDATE scenario_runs SET status = 'done', waiting_for = NULL, updated_at = now()
              WHERE id = $1`,
            [runId],
          );
        });
        log('info', 'Сценарий передал диалог оператору', {
          conversationId: run.conversation_id,
          note: step.note,
        });
        return sent;

      case 'close':
        await withTenant(pool, tenantId, async (db) => {
          await db.query(`UPDATE conversations SET status = 'resolved' WHERE id = $1`, [
            run.conversation_id,
          ]);
          await db.query(
            `UPDATE scenario_runs SET status = 'done', waiting_for = NULL, updated_at = now()
              WHERE id = $1`,
            [runId],
          );
        });
        return sent;

      default:
        await goNext(run.step_index + 1);
    }
  }

  log('warn', 'Сценарий остановлен: слишком много шагов подряд', { runId });
  await withTenant(pool, tenantId, async (db) => {
    await db.query(`UPDATE scenario_runs SET status = 'stopped' WHERE id = $1`, [runId]);
  });
  return sent;
}

/**
 * Ответ ИИ, когда ни один сценарий не подошёл.
 *
 * Сценарии закрывают известные случаи — приветствие, часы работы,
 * прайс. Всё остальное раньше оставалось без ответа до прихода
 * оператора. Если компания подключила модель и выбрала режим «auto»,
 * отвечает она.
 *
 * Два запрета жёстче любой модели: разговор про деньги, возврат и
 * жалобу, а также прямая просьба позвать человека, оставляются
 * человеку. Ошибка модели в этих местах стоит клиента.
 */
interface AiRow {
  base_url: string;
  model: string;
  api_key_enc: Buffer | null;
  system_prompt: string;
  mode: string;
  history_size: number;
  max_tokens: number;
  is_active: boolean;
}

async function aiAnswer(
  msg: UnifiedMessage,
  conversationId: string,
  text: string,
): Promise<number> {
  const row = await withTenant(pool, msg.tenantId, async (db) => {
    const { rows } = await db.query<AiRow>(
      `SELECT base_url, model, api_key_enc, system_prompt, mode,
              history_size, max_tokens, is_active
         FROM ai_settings WHERE tenant_id = $1`,
      [msg.tenantId],
    );
    return rows[0] ?? null;
  });

  if (!row || !row.is_active || row.mode !== 'auto' || !row.api_key_enc) return 0;

  if (needsHuman(text)) {
    log('info', 'ИИ промолчал: разговор для человека', { conversationId });
    return 0;
  }

  let key = '';
  try {
    key = decryptJson<{ key: string }>(masterKey, msg.tenantId, row.api_key_enc).key;
  } catch {
    log('warn', 'Ключ ИИ не расшифровался', { tenantId: msg.tenantId });
    return 0;
  }

  const turns = await withTenant(pool, msg.tenantId, async (db) => {
    const { rows } = await db.query<{ direction: string; body: string | null }>(
      `SELECT direction, body FROM messages
        WHERE conversation_id = $1 AND body IS NOT NULL AND body <> ''
        ORDER BY created_at DESC
        LIMIT $2`,
      [conversationId, row.history_size],
    );
    return rows.reverse().map<AiTurn>((m) => ({
      fromClient: m.direction === 'in',
      text: m.body ?? '',
    }));
  });
  if (!turns.length) return 0;

  try {
    const answer = await askModel({
      baseUrl: row.base_url,
      apiKey: key,
      model: row.model,
      systemPrompt: row.system_prompt,
      maxTokens: row.max_tokens,
    }, turns);
    await botSay(msg.tenantId, conversationId, msg.channelId, answer);
    log('info', 'ИИ ответил клиенту', { conversationId });
    return 1;
  } catch (err) {
    // Молчание лучше отговорки: оператор увидит непрочитанный диалог,
    // а причина ляжет в настройки, где её ищут.
    const message = err instanceof AiError ? err.message : 'Не удалось обратиться к провайдеру';
    log('warn', 'ИИ не ответил', { conversationId, reason: message });
    await withTenant(pool, msg.tenantId, async (db) => {
      await db.query(`UPDATE ai_settings SET last_error = $2 WHERE tenant_id = $1`,
        [msg.tenantId, message]);
    });
    return 0;
  }
}

/**
 * Реакция на входящее сообщение.
 *
 * Сначала смотрим, не ждёт ли ответа уже запущенный сценарий: клиент
 * пишет в ответ на вопрос бота, и начинать из-за этого второй сценарий
 * было бы разговором двух ботов через голову человека.
 */
async function runBot(msg: UnifiedMessage, conversationId: string): Promise<number> {
  const text = typeof msg.content.text === 'string' ? msg.content.text : '';

  const decision = await withTenant(pool, msg.tenantId, async (db) => {
    const { rows: convRows } = await db.query<ConvState>(
      `SELECT c.bot_enabled, c.bot_replied_at, c.assignee_id,
              (c.human_replied_at IS NOT NULL
                 AND c.human_replied_at > now() - interval '${BOT_PAUSE_AFTER_HUMAN}')
                AS human_recently,
              (SELECT count(*) FROM messages m
                WHERE m.conversation_id = c.id AND m.direction = 'in') AS incoming_count
         FROM conversations c WHERE c.id = $1`,
      [conversationId],
    );
    const conv = convRows[0];
    if (!conv) return { silent: 'диалог не найден' as const };

    // Ручной выключатель в интерфейсе — самый жёсткий: он должен
    // побеждать любую автоматику.
    if (!conv.bot_enabled) return { silent: 'бот выключен для диалога' as const };

    // За диалог взялся конкретный человек — значит он его и ведёт.
    if (conv.assignee_id) return { silent: 'у диалога есть ответственный' as const };

    // Оператор отвечал только что: автоответ вклинился бы в живую беседу.
    if (conv.human_recently) {
      return { silent: 'оператор отвечал менее 30 минут назад' as const };
    }

    // Ждёт ли уже запущенный сценарий ответа на свой вопрос.
    const { rows: live } = await db.query<{ id: string; answers: Record<string, string> }>(
      `SELECT id, answers FROM scenario_runs
        WHERE conversation_id = $1 AND status = 'waiting' AND waiting_for = 'reply'
        LIMIT 1`,
      [conversationId],
    );
    if (live[0]) {
      const answers = Object.assign({}, live[0].answers ?? {}, { __last: text.slice(0, 500) });
      await db.query(
        `UPDATE scenario_runs
            SET answers = $2, status = 'running', waiting_for = NULL,
                wait_until = NULL, updated_at = now()
          WHERE id = $1`,
        [live[0].id, JSON.stringify(answers)],
      );
      return { resume: live[0].id };
    }

    const { rows: list } = await db.query<Parameters<typeof toScenario>[0]>(
      `SELECT id, channel_id, trigger_type, keywords, schedule, steps, priority
         FROM scenarios
        WHERE is_active AND (channel_id IS NULL OR channel_id = $1)`,
      [msg.channelId],
    );
    if (!list.length) return { silent: 'нет включённых сценариев' as const };

    const picked = pickScenario(list.map(toScenario), {
      text,
      channelId: msg.channelId,
      isFirstMessage: Number(conv.incoming_count) <= 1,
      alreadyGreeted: Boolean(conv.bot_replied_at),
      now: new Date(),
    });
    if (!picked) return { silent: 'ни один сценарий не подошёл' as const };

    // Запуск создаём здесь же: частичное условие в индексе не даст
    // второму сценарию стартовать на том же диалоге.
    const { rows: ins } = await db.query<{ id: string }>(
      `INSERT INTO scenario_runs (tenant_id, scenario_id, conversation_id, answers)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [msg.tenantId, picked.id, conversationId, JSON.stringify({ __last: text.slice(0, 500) })],
    );
    if (!ins[0]) return { silent: 'на диалоге уже идёт другой сценарий' as const };

    await db.query(`UPDATE scenarios SET runs_started = runs_started + 1 WHERE id = $1`, [
      picked.id,
    ]);
    return { start: ins[0].id, scenarioId: picked.id };
  });

  // Молчание бота логируется с причиной. Без этого «бот не отвечает»
  // неотличимо от «бот сломан», и проверять приходится наугад.
  if ('silent' in decision) {
    log('info', 'Бот промолчал', { conversationId, reason: decision.silent });
    // Сценария на этот случай нет — но может быть подключён ИИ. Другие
    // причины молчания (взял человек, бот выключен) для него тоже
    // причины молчать, поэтому список явный.
    if (decision.silent === 'нет включённых сценариев' ||
        decision.silent === 'ни один сценарий не подошёл') {
      return aiAnswer(msg, conversationId, text);
    }
    return 0;
  }

  const runId = 'resume' in decision ? decision.resume : decision.start;
  if (!runId) return 0;
  return advanceRun(msg.tenantId, runId);
}

/**
 * Продолжение сценария из очереди.
 *
 * Два повода: истекла пауза и вышло время ожидания ответа. Во втором
 * случае продолжаем только если ответа так и не было — иначе сценарий
 * уже ушёл вперёд, и будить его нельзя.
 */
async function continueScenario(job: ScenarioJob): Promise<void> {
  const ok = await withTenant(pool, job.tenantId, async (db) => {
    const { rows } = await db.query<{ status: string; waiting_for: string | null }>(
      `SELECT status, waiting_for FROM scenario_runs WHERE id = $1`,
      [job.runId],
    );
    const run = rows[0];
    if (!run || run.status !== 'waiting') return false;
    if (job.reason === 'timeout' && run.waiting_for !== 'reply') return false;
    if (job.reason === 'delay' && run.waiting_for !== 'time') return false;

    // Диалог могли взять в работу или выключить бота, пока шла пауза.
    const { rows: conv } = await db.query<{ ok: boolean }>(
      `SELECT (c.bot_enabled AND c.assignee_id IS NULL) AS ok
         FROM conversations c
         JOIN scenario_runs r ON r.conversation_id = c.id
        WHERE r.id = $1`,
      [job.runId],
    );
    if (!conv[0]?.ok) {
      await db.query(`UPDATE scenario_runs SET status = 'stopped' WHERE id = $1`, [job.runId]);
      return false;
    }

    await db.query(
      `UPDATE scenario_runs SET status = 'running', waiting_for = NULL, updated_at = now()
        WHERE id = $1`,
      [job.runId],
    );
    return true;
  });

  if (!ok) return;
  const sent = await advanceRun(job.tenantId, job.runId);
  if (sent) log('info', 'Сценарий продолжен', { runId: job.runId, sent, reason: job.reason });
}

// ═══════════════════════════════════════════════════════════════════════
// Исходящие сообщения
// ═══════════════════════════════════════════════════════════════════════

interface OutboundRow {
  status: string;
  text: string | null;
  content: { attachments?: OutAttachment[]; replyToExternalId?: string } | null;
  peer_id: string | null;
  channel_type: string;
  credentials_enc: Buffer;
  window_expires_at: Date | null;
}

interface OutAttachment {
  type: 'image' | 'video' | 'audio' | 'voice' | 'document' | 'sticker';
  storageKey?: string;
  mime?: string;
  filename?: string;
}

/**
 * Метод Telegram под тип вложения и имя поля с файлом.
 *
 * Разные методы — не прихоть API: от выбора зависит, как файл покажут
 * у клиента. Отправленное через sendDocument голосовое приедет
 * серым файлом, который надо скачивать, вместо кружка с волной.
 */
const TG_MEDIA: Record<string, { method: string; field: string }> = {
  image: { method: 'sendPhoto', field: 'photo' },
  video: { method: 'sendVideo', field: 'video' },
  voice: { method: 'sendVoice', field: 'voice' },
  audio: { method: 'sendAudio', field: 'audio' },
  document: { method: 'sendDocument', field: 'document' },
  sticker: { method: 'sendSticker', field: 'sticker' },
};

/**
 * Постановка и снятие реакции оператора.
 *
 * У реакции нет своего сообщения: она живёт на чужом. Поэтому это
 * отдельный тип задачи, а не сообщение с пустым текстом — иначе
 * в ленте появлялись бы фантомные записи.
 *
 * Telegram принимает МАССИВ реакций и заменяет им прежний набор,
 * а не добавляет к нему. Пустой массив снимает реакцию.
 */
async function handleReaction(job: OutboundJob): Promise<void> {
  const target = job.reaction;
  if (!target) throw new UnrecoverableError('Задача реакции без данных');

  const row = await withTenant(pool, job.tenantId, async (db) => {
    const { rows } = await db.query<{ credentials_enc: Buffer; channel_type: string }>(
      `SELECT credentials_enc, type AS channel_type FROM channels WHERE id = $1`,
      [job.channelId],
    );
    return rows[0] ?? null;
  });

  if (!row) throw new UnrecoverableError('Канал не найден');
  if (row.channel_type === 'telegram_user') {
    await mtprotoOutQueue.add('react', job);
    return;
  }
  if (row.channel_type !== 'telegram_bot') {
    throw new UnrecoverableError(`Реакции для канала ${row.channel_type} не поддерживаются`);
  }

  const parts = target.targetExternalId.split(':');
  const chatId = parts[0];
  const messageId = Number(parts[1]);
  if (!chatId || !Number.isFinite(messageId)) {
    throw new UnrecoverableError('Некорректный идентификатор сообщения');
  }

  const { botToken } = decryptJson<{ botToken: string }>(
    masterKey,
    job.tenantId,
    row.credentials_enc,
  );

  const res = await fetch(`${TELEGRAM_API_ROOT}/bot${botToken}/setMessageReaction`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      reaction: target.emoji ? [{ type: 'emoji', emoji: target.emoji }] : [],
    }),
    signal: AbortSignal.timeout(20_000),
  });

  const body = (await res.json()) as { ok: boolean; description?: string; error_code?: number };

  if (body.ok) {
    // Записываем в сообщение только после подтверждения от Telegram.
    // Иначе оператор видел бы реакцию, которой у клиента нет.
    await withTenant(pool, job.tenantId, async (db) => {
      await db.query(
        `UPDATE messages
            SET reactions = CASE
              WHEN $3::text IS NULL THEN
                COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(reactions) e
                           WHERE e->>'by' <> 'agent'), '[]'::jsonb)
              ELSE
                COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(reactions) e
                           WHERE e->>'by' <> 'agent'), '[]'::jsonb)
                || jsonb_build_array(jsonb_build_object('emoji', $3::text, 'by', 'agent'))
            END
          WHERE channel_id = $1 AND external_id = $2`,
        [job.channelId, target.targetExternalId, target.emoji],
      );
    });
    log('info', 'Реакция отправлена', { target: target.targetExternalId, emoji: target.emoji });
    return;
  }

  // 400 обычно означает, что этот эмодзи не входит в список разрешённых
  // Telegram. Повторять бессмысленно.
  if (body.error_code === 400 || body.error_code === 403) {
    throw new UnrecoverableError(`Telegram отказал в реакции: ${body.description}`);
  }
  throw new Error(`Реакция не поставлена: ${body.description ?? res.status}`);
}

/**
 * Отправка одного сообщения.
 *
 * Три вещи, которые здесь важнее всего остального:
 *
 * · ИДЕМПОТЕНТНОСТЬ. Очередь ретраит задачи — это её работа. Но повторная
 *   отправка означает, что клиент получит сообщение дважды, и это заметит
 *   человек. Поэтому статус проверяется перед каждой отправкой: всё, что
 *   уже не pending, пропускается молча.
 *
 * · РАЗДЕЛЕНИЕ ОШИБОК. «Сеть моргнула» и «пользователь заблокировал бота» —
 *   разные вещи. Первое надо повторить, второе повторять бессмысленно
 *   и вредно: задача будет крутиться в очереди сутками. Постоянные ошибки
 *   помечаются как failed сразу, через UnrecoverableError.
 *
 * · ЛИМИТЫ. Telegram отвечает 429 с полем retry_after. Игнорировать его —
 *   верный способ получить временную блокировку бота.
 */
async function handleOutbound(job: OutboundJob, worker: Worker): Promise<void> {
  if (job.kind === 'reaction') return handleReaction(job);

  const row = await withTenant(pool, job.tenantId, async (db) => {
    const { rows } = await db.query<OutboundRow>(
      `SELECT m.status,
              m.content->>'text'  AS text,
              m.content           AS content,
              ci.external_id      AS peer_id,
              ch.type             AS channel_type,
              ch.credentials_enc,
              c.window_expires_at
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         JOIN channels ch     ON ch.id = m.channel_id
         LEFT JOIN contact_identities ci
                ON ci.contact_id = c.contact_id AND ci.channel_type = ch.type
        WHERE m.id = $1
        LIMIT 1`,
      [job.messageId],
    );
    return rows[0] ?? null;
  });

  if (!row) {
    throw new UnrecoverableError(`Сообщение ${job.messageId} не найдено`);
  }

  // Уже отправлено — значит это ретрай после успеха. Молча выходим.
  if (row.status !== 'pending') {
    log('info', 'Сообщение уже обработано, отправка пропущена', {
      messageId: job.messageId,
      status: row.status,
    });
    return;
  }

  if (!row.peer_id) {
    await markFailed(job, { reason: 'no_peer_identity' });
    throw new UnrecoverableError('Неизвестен получатель: нет идентификатора контакта в канале');
  }

  if (row.channel_type === 'telegram_user') {
    // Отправить может только процесс, у которого открыта MTProto-сессия
    // этого аккаунта. Передаём задачу ему; jobId тот же, повторная
    // передача не приведёт ко второй отправке.
    await mtprotoOutQueue.add('send', job, { jobId: jobKey('mtp', job.messageId) });
    return;
  }

  if (row.channel_type === 'messenger' || row.channel_type === 'instagram') {
    return sendMeta(job, row, row.peer_id, worker);
  }

  if (row.channel_type !== 'telegram_bot') {
    // Осознанный отказ вместо тихой неправильной отправки.
    // telegram_business требует business_connection_id, у Meta свои методы.
    await markFailed(job, { reason: 'channel_not_supported', channelType: row.channel_type });
    throw new UnrecoverableError(`Отправка для канала ${row.channel_type} ещё не реализована`);
  }

  const { botToken } = decryptJson<{ botToken: string }>(
    masterKey,
    job.tenantId,
    row.credentials_enc,
  );

  // Ответ на конкретное сообщение. allow_sending_without_reply обязателен:
  // без него Telegram отказывает целиком, если исходное сообщение удалили,
  // и ответ оператора просто пропадает.
  const replyTo = row.content?.replyToExternalId;
  const replyParams = replyTo
    ? { message_id: Number(replyTo.split(':')[1]), allow_sending_without_reply: true }
    : null;

  const attachment = (row.content?.attachments ?? []).find((a) => a.storageKey);

  let res: Response;

  if (attachment && attachment.storageKey) {
    const file = await storage.get(attachment.storageKey);
    if (!file) {
      await markFailed(job, { reason: 'attachment_missing', key: attachment.storageKey });
      throw new UnrecoverableError('Вложение не найдено в хранилище');
    }

    const spec = TG_MEDIA[attachment.type] ?? TG_MEDIA['document']!;
    const form = new FormData();
    form.append('chat_id', row.peer_id);
    // Подпись к файлу, а не отдельное сообщение: иначе у клиента
    // приходят две записи вместо одной.
    if (row.text) form.append('caption', row.text);
    if (replyParams) form.append('reply_parameters', JSON.stringify(replyParams));
    form.append(
      spec.field,
      new Blob([new Uint8Array(file.body)], { type: attachment.mime || 'application/octet-stream' }),
      attachment.filename || 'file',
    );

    res = await fetch(`${TELEGRAM_API_ROOT}/bot${botToken}/${spec.method}`, {
      method: 'POST',
      body: form,
      // Файл может быть большим и на медленном канале — минута,
      // а не двадцать секунд, как для текста.
      signal: AbortSignal.timeout(60_000),
    });
  } else {
    res = await fetch(`${TELEGRAM_API_ROOT}/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        Object.assign(
          { chat_id: row.peer_id, text: row.text ?? '' },
          replyParams ? { reply_parameters: replyParams } : {},
        ),
      ),
      signal: AbortSignal.timeout(20_000),
    });
  }

  const body = (await res.json()) as {
    ok: boolean;
    result?: { message_id: number };
    description?: string;
    error_code?: number;
    parameters?: { retry_after?: number };
  };

  if (body.ok && body.result) {
    await withTenant(pool, job.tenantId, async (db) => {
      await db.query(
        `UPDATE messages
            SET status = 'sent', external_id = $2
          WHERE id = $1 AND status = 'pending'`,
        [job.messageId, `${row.peer_id}:${body.result!.message_id}`],
      );
    });
    log('info', 'Сообщение отправлено', { messageId: job.messageId });
    return;
  }

  // 429: у Telegram кончилось терпение. Притормаживаем ВЕСЬ воркер
  // на указанное время — иначе следующая задача получит тот же отказ,
  // и так по кругу до временной блокировки бота.
  if (body.error_code === 429) {
    const waitMs = (body.parameters?.retry_after ?? 5) * 1000;
    log('warn', 'Лимит Telegram, притормаживаю', { messageId: job.messageId, waitMs });
    await worker.rateLimit(waitMs);
    throw Worker.RateLimitError();
  }

  // 401 — токен отозван через BotFather. Это самая обидная ошибка:
  // выглядит как временный сбой, а на деле канал мёртв, пока владелец
  // не подключит бота заново. Помечаем канал, иначе оператор будет
  // писать в пустоту и не понимать, почему клиент молчит.
  if (body.error_code === 401) {
    await withTenant(pool, job.tenantId, async (db) => {
      await db.query(
        `UPDATE channels SET status = 'degraded',
                last_error = '{"reason":"token_revoked"}'::jsonb
          WHERE id = $1`,
        [job.channelId],
      );
    });
    await markFailed(job, { code: 401, reason: 'token_revoked' });
    throw new UnrecoverableError('Токен бота отозван — переподключите канал');
  }

  // 400 и 403 — постоянные: бот заблокирован, чат удалён, текст недопустим.
  // Повторять их бессмысленно.
  if (body.error_code === 400 || body.error_code === 403) {
    await markFailed(job, { code: body.error_code, description: body.description });
    throw new UnrecoverableError(`Telegram отказал: ${body.description}`);
  }

  // Остальное считаем временным — очередь повторит с экспоненциальной паузой.
  throw new Error(`Telegram вернул ошибку: ${body.description ?? 'без описания'}`);
}

/** Тип вложения Send API Meta. */
const META_ATTACHMENT: Record<string, string> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  voice: 'audio',
  document: 'file',
  sticker: 'image',
};

/**
 * Отправка в Messenger и Instagram Direct.
 *
 * Окно: первые 24 часа после сообщения клиента — обычный ответ.
 * Дальше ещё 6 дней можно ответить только с тегом HUMAN_AGENT, и только
 * живому человеку: автоответы бота с этим тегом Meta считает нарушением.
 *
 * Вложения. Messenger принимает файл прямо в запросе. Instagram — только
 * ссылкой на публичный файл, а у нас хранилище закрытое; поэтому
 * вложения в Instagram пока честно отклоняем.
 */
async function sendMeta(
  job: OutboundJob,
  row: OutboundRow,
  peerId: string,
  worker: Worker,
): Promise<void> {
  const creds = decryptJson<MetaChannelCredentials>(masterKey, job.tenantId, row.credentials_enc);
  const isIg = row.channel_type === 'instagram';
  const base: Record<string, unknown> = { recipient: { id: peerId } };
  if (needsHumanAgentTag(row.window_expires_at)) {
    base['messaging_type'] = 'MESSAGE_TAG';
    base['tag'] = 'HUMAN_AGENT';
  } else {
    base['messaging_type'] = 'RESPONSE';
  }
  const replyTo = row.content?.replyToExternalId;
  if (isIg && replyTo) base['reply_to'] = { mid: replyTo };

  const token = { access_token: creds.pageToken };
  const attachment = (row.content?.attachments ?? []).find((a) => a.storageKey);

  try {
    let firstId: string | null = null;

    if (attachment?.storageKey) {
      if (isIg) {
        await markFailed(job, { reason: 'instagram_attachments_not_supported' });
        throw new UnrecoverableError('Файлы в Instagram пока не отправляются — только текст');
      }
      const file = await storage.get(attachment.storageKey);
      if (!file) {
        await markFailed(job, { reason: 'attachment_missing' });
        throw new UnrecoverableError('Вложение не найдено в хранилище');
      }
      const form = new FormData();
      for (const [k, v] of Object.entries(base)) {
        form.append(k, typeof v === 'string' ? v : JSON.stringify(v));
      }
      form.append(
        'message',
        JSON.stringify({
          attachment: {
            type: META_ATTACHMENT[attachment.type] ?? 'file',
            payload: { is_reusable: false },
          },
        }),
      );
      form.append(
        'filedata',
        new Blob([new Uint8Array(file.body)], { type: attachment.mime || 'application/octet-stream' }),
        attachment.filename || 'file',
      );
      const r = await graphPost<{ message_id: string }>('me/messages', token, form);
      firstId = r.message_id;
    }

    // Подписи к файлу у Messenger нет: текст уходит вторым сообщением.
    if (row.text) {
      const r = await graphPost<{ message_id: string }>('me/messages', token, {
        ...base,
        message: { text: row.text },
      });
      firstId = firstId ?? r.message_id;
    }

    await withTenant(pool, job.tenantId, async (db) => {
      await db.query(
        `UPDATE messages SET status = 'sent', external_id = $2 WHERE id = $1 AND status = 'pending'`,
        [job.messageId, firstId],
      );
    });
    log('info', 'Сообщение отправлено', { messageId: job.messageId, channel: row.channel_type });
  } catch (err) {
    if (!(err instanceof MetaApiError)) throw err;
    if (err.tokenInvalid) {
      await withTenant(pool, job.tenantId, async (db) => {
        await db.query(
          `UPDATE channels SET status = 'degraded',
                  last_error = '{"reason":"token_revoked"}'::jsonb
            WHERE id = $1`,
          [job.channelId],
        );
      });
      await markFailed(job, { reason: 'token_revoked', code: err.body.code });
      throw new UnrecoverableError('Доступ к странице отозван — подключите её заново');
    }
    if (err.rateLimited) {
      log('warn', 'Лимит Meta, притормаживаю', { messageId: job.messageId });
      await worker.rateLimit(60_000);
      throw Worker.RateLimitError();
    }
    if (err.permanent) {
      await markFailed(job, { code: err.body.code, subcode: err.body.error_subcode, description: err.body.message });
      throw new UnrecoverableError(err.message);
    }
    throw err;
  }
}

async function markFailed(job: OutboundJob, failure: Record<string, unknown>): Promise<void> {
  await withTenant(pool, job.tenantId, async (db) => {
    await db.query(
      `UPDATE messages SET status = 'failed', failure = $2 WHERE id = $1`,
      [job.messageId, JSON.stringify(failure)],
    );
  });
}

const outboundWorker: Worker<OutboundJob> = new Worker<OutboundJob>(
  QUEUE_OUTBOUND,
  async (job) => handleOutbound(job.data, outboundWorker),
  {
    connection,
    concurrency: Number(process.env['OUTBOUND_CONCURRENCY'] ?? 3),
    // Telegram: около 30 сообщений в секунду суммарно. Берём с запасом —
    // упереться в лимит дороже, чем отправить на пару сообщений медленнее.
    limiter: { max: 20, duration: 1000 },
  },
);

outboundWorker.on('failed', (job, err) => {
  log('error', 'Отправка не удалась', {
    messageId: job?.data?.messageId,
    attempt: job?.attemptsMade,
    error: err.message,
  });

  // Попытки исчерпаны — сообщение обязано получить статус failed.
  //
  // Иначе оно навсегда остаётся «отправляется»: оператор видит, что ответ
  // как будто уходит, клиент не получает ничего, и никто не понимает,
  // что произошло. Молчаливое зависание хуже честной ошибки.
  const attempts = job?.opts?.attempts ?? 0;
  if (job && attempts > 0 && (job.attemptsMade ?? 0) >= attempts) {
    void markFailed(job.data, { reason: 'attempts_exhausted', lastError: err.message })
      .then(() =>
        log('warn', 'Сообщение помечено как недоставленное', {
          messageId: job.data.messageId,
        }),
      )
      .catch((e) =>
        log('error', 'Не удалось пометить сообщение недоставленным', {
          messageId: job.data.messageId,
          error: e instanceof Error ? e.message : String(e),
        }),
      );
  }
});

outboundWorker.on('ready', () => log('info', 'Воркер исходящих сообщений запущен'));

const worker = new Worker<InboundJob>(
  QUEUE_INBOUND,
  async (job) => handleInbound(job.data),
  {
    connection,
    // Больше воркеров — больше параллелизма. Начните с 5 и смотрите на лаг.
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 5),
  },
);

worker.on('failed', (job, err) => {
  log('error', 'Задача завершилась ошибкой', {
    jobId: job?.id,
    attempt: job?.attemptsMade,
    error: err.message,
  });
});

worker.on('ready', () => log('info', 'Воркер входящих сообщений запущен'));

/**
 * Воркер сценариев.
 *
 * Один поток намеренно: задачи короткие, а параллельная обработка двух
 * продолжений одного разговора означала бы два сообщения подряд не в том
 * порядке.
 */
const scenarioWorker = new Worker<ScenarioJob>(
  QUEUE_SCENARIO,
  async (job) => continueScenario(job.data),
  { connection, concurrency: 1 },
);

scenarioWorker.on('failed', (job, err) => {
  log('error', 'Продолжение сценария не выполнено', {
    jobId: job?.id,
    error: err.message,
  });
});

scenarioWorker.on('ready', () => log('info', 'Воркер сценариев запущен'));

/**
 * Воркер связки с CRM.
 *
 * Работает, только если у организации подключена Zoho; иначе задача
 * молча завершается. Ключи приложения общие для всего сервиса и берутся
 * из переменных — те же, что у api.
 */
const crmSync = createCrmSync({
  pool,
  redis: connection,
  masterKey,
  clientId: process.env['ZOHO_CLIENT_ID'] ?? '',
  clientSecret: process.env['ZOHO_CLIENT_SECRET'] ?? '',
  log,
});

const crmWorker = new Worker<CrmSyncJob>(
  QUEUE_CRM_SYNC,
  async (job) => crmSync(job.data),
  { connection, concurrency: 2 },
);

crmWorker.on('failed', (job, err) => {
  log('error', 'Связка с CRM не выполнена', { jobId: job?.id, error: err.message });
});

crmWorker.on('ready', () => log('info', 'Воркер связки с CRM запущен'));

// ═══════════════════════════════════════════════════════════════════════
// Удаление данных по запросу из Facebook
// ═══════════════════════════════════════════════════════════════════════
//
// Человек удаляет приложение в настройках Facebook и просит удалить свои
// данные. api принимает запрос и кладёт его в data_deletion_requests,
// а удаление идёт здесь: тенант в момент запроса неизвестен, и найти
// собеседника можно только перебором организаций.
//
// Идентификатор привязан к странице (PSID) или к аккаунту Instagram,
// поэтому ищем по contact_identities. Удаление контакта каскадом уносит
// диалоги, сообщения и заметки — отдельно их чистить не нужно.

const DELETION_POLL_MS = 60_000;

async function processDeletionRequests(): Promise<void> {
  const pending = await withSystem(pool, 'запросы на удаление данных', async (db) => {
    const { rows } = await db.query<{ id: string; external_id: string }>(
      `SELECT id, external_id FROM data_deletion_requests
        WHERE status = 'pending' ORDER BY created_at LIMIT 20`,
    );
    return rows;
  });
  if (!pending.length) return;

  const tenants = await withSystem(pool, 'список организаций', async (db) => {
    const { rows } = await db.query<{ id: string }>(`SELECT id FROM tenants`);
    return rows.map((r) => r.id);
  });

  for (const req of pending) {
    let deleted = 0;
    try {
      for (const tenantId of tenants) {
        deleted += await withTenant(pool, tenantId, async (db) => {
          const { rowCount } = await db.query(
            `DELETE FROM contacts WHERE id IN (
               SELECT contact_id FROM contact_identities
                WHERE channel_type IN ('messenger','instagram') AND external_id = $1)`,
            [req.external_id],
          );
          return rowCount ?? 0;
        });
      }
      await withSystem(pool, 'отметка об удалении', async (db) => {
        await db.query(
          `UPDATE data_deletion_requests
              SET status = 'done', deleted_contacts = $2, processed_at = now()
            WHERE id = $1`,
          [req.id, deleted],
        );
      });
      log('info', 'Запрос на удаление данных выполнен', { requestId: req.id, deleted });
    } catch (err) {
      await withSystem(pool, 'ошибка удаления', async (db) => {
        await db.query(
          `UPDATE data_deletion_requests SET status = 'failed', last_error = $2 WHERE id = $1`,
          [req.id, String((err as Error).message).slice(0, 500)],
        );
      }).catch(() => undefined);
      log('error', 'Запрос на удаление данных не выполнен', {
        requestId: req.id,
        error: (err as Error).message,
      });
    }
  }
}

let deletionTimer: NodeJS.Timeout | null = null;
async function deletionLoop(): Promise<void> {
  try {
    await processDeletionRequests();
  } catch (err) {
    log('error', 'Обход запросов на удаление упал', { error: (err as Error).message });
  }
  deletionTimer = setTimeout(deletionLoop, DELETION_POLL_MS);
}
void deletionLoop();

async function shutdown(signal: string): Promise<void> {
  log('info', `${signal}: завершаю работу`);
  if (deletionTimer) clearTimeout(deletionTimer);
  // Даём текущим задачам доработать, новые не берём.
  await worker.close();
  await scenarioWorker.close();
  await crmWorker.close();
  await outboundWorker.close();
  await mediaWorker.close();
  await mediaQueue.close();
  await scenarioQueue.close();
  await crmQueue.close();
  await pool.end();
  connection.disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
