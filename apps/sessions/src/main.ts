import { Queue, UnrecoverableError, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import bigInt from 'big-integer';
import tg from 'telegram';
import sessions from 'telegram/sessions/index.js';
import events from 'telegram/events/index.js';
import uploads from 'telegram/client/uploads.js';
import type { NewMessageEvent } from 'telegram/events/NewMessage.js';
import { startWa } from './wa.js';
import {
  QUEUE_INBOUND,
  QUEUE_MTPROTO_LOGIN,
  QUEUE_MTPROTO_OUT,
  createPool,
  createStorage,
  decryptJson,
  defaultJobOptions,
  encryptJson,
  jobKey,
  mtprotoLoginKey,
  mtprotoPasswordKey,
  parseMasterKey,
  withSystem,
  withTenant,
  type Attachment,
  type InboundJob,
  type MtprotoInboundPayload,
  type MtprotoLoginJob,
  type MtprotoLoginState,
  type OutboundJob,
} from '@omnidesk/core';

const { TelegramClient, Api } = tg;
const { StringSession } = sessions;
const { NewMessage } = events;
const { CustomFile } = uploads;
type Client = InstanceType<typeof TelegramClient>;

/**
 * Сервис сессий номерного Telegram.
 *
 * Бот и Business получают сообщения вебхуком: Telegram сам стучится к нам.
 * С личным аккаунтом так нельзя. Нужно держать открытое MTProto-соединение
 * от имени пользователя — как это делает приложение Telegram на телефоне.
 * Поэтому здесь долгоживущий процесс, в котором на каждый подключённый
 * номер открыт свой клиент.
 *
 * Отсюда главное ограничение: ОДНА реплика. Две копии сервиса открыли бы
 * по два соединения на аккаунт, и каждое сообщение пришло бы дважды.
 * Дубли отсёк бы уникальный индекс, но исходящие ушли бы дважды.
 *
 * Сервис делает три вещи:
 *   · вход по QR-коду (задачи из очереди mtproto-login);
 *   · приём сообщений — нормализует и кладёт в общую очередь входящих,
 *     дальше их пишет в базу обычный воркер, как для любого канала;
 *   · отправку (очередь mtproto-out): отправить может только тот,
 *     у кого открыта сессия.
 */

const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379';
const API_ID = Number(process.env['TG_API_ID'] ?? '');
const API_HASH = process.env['TG_API_HASH'] ?? '';
const RECONCILE_MS = 30_000;
const HEALTH_MS = 10 * 60_000;
const LOGIN_TIMEOUT_MS = 3 * 60_000;
const PASSWORD_WAIT_MS = 2 * 60_000;
const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
/** Служебный аккаунт Telegram. Через него приходят коды входа — их не показываем никому. */
const TELEGRAM_SERVICE_ID = '777000';

const log = (level: string, msg: string, extra: Record<string, unknown> = {}): void => {
  console.log(JSON.stringify({ level, msg, ts: new Date().toISOString(), ...extra }));
};

if (!API_ID || !API_HASH) {
  log('error', 'TG_API_ID и TG_API_HASH не заданы — номерной Telegram работать не может');
  process.exit(1);
}

const connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null, family: 0 });
const pool = createPool(process.env['DATABASE_URL'] ?? '');
const masterKey = parseMasterKey(process.env['ENCRYPTION_MASTER_KEY']);
const storage = createStorage();
const inboundQueue = new Queue<InboundJob>(QUEUE_INBOUND, { connection, defaultJobOptions });

interface Live {
  client: Client;
  channelId: string;
  tenantId: string;
  /** Сообщения, отправленные из OmniDesk. Их эхо не должно превращаться во второе сообщение. */
  recentSent: Set<string>;
  /** Собеседники, чей аватар уже запрашивали в этом процессе. */
  avatarsChecked: Set<string>;
  lastHealth: number;
}

const live = new Map<string, Live>();
const starting = new Set<string>();

function newClient(session: string): Client {
  const client = new TelegramClient(new StringSession(session), API_ID, API_HASH, {
    connectionRetries: 5,
    autoReconnect: true,
    deviceModel: 'Rozmovio',
    appVersion: '1.0',
    systemVersion: 'Server',
  });
  // GramJS по умолчанию пишет в консоль каждое переподключение.
  client.setLogLevel('error' as never);
  return client;
}

function errText(err: unknown): string {
  const e = err as { errorMessage?: string; message?: string };
  return e?.errorMessage ?? e?.message ?? String(err);
}

/** Ошибки, после которых сессия мертва: пользователь завершил её в «Устройствах» или аккаунт удалён. */
const DEAD_SESSION = /AUTH_KEY_UNREGISTERED|SESSION_REVOKED|USER_DEACTIVATED|AUTH_KEY_DUPLICATED|SESSION_EXPIRED/;

// ═══════════════════════════════════════════════════════════════════════
// Запуск и остановка сессий
// ═══════════════════════════════════════════════════════════════════════

async function markDegraded(tenantId: string, channelId: string, reason: string): Promise<void> {
  await withTenant(pool, tenantId, async (db) => {
    await db.query(
      `UPDATE channels SET status = 'degraded', last_error = $2 WHERE id = $1`,
      [channelId, JSON.stringify({ reason })],
    );
  });
}

async function stopSession(channelId: string): Promise<void> {
  const l = live.get(channelId);
  if (!l) return;
  live.delete(channelId);
  await l.client.destroy().catch(() => undefined);
  log('info', 'Сессия остановлена', { channelId });
}

async function startSession(channelId: string, tenantId: string): Promise<void> {
  const row = await withTenant(pool, tenantId, async (db) => {
    const { rows } = await db.query<{ credentials_enc: Buffer }>(
      `SELECT credentials_enc FROM channels WHERE id = $1 AND type = 'telegram_user'`,
      [channelId],
    );
    return rows[0] ?? null;
  });
  if (!row) return;

  const { session } = decryptJson<{ session: string }>(masterKey, tenantId, row.credentials_enc);
  const client = newClient(session);
  await client.connect();

  if (!(await client.checkAuthorization())) {
    // Самая частая причина — владелец завершил сеанс «Rozmovio»
    // в Telegram → Настройки → Устройства. Это не сбой, а его решение,
    // поэтому не переподключаемся, а показываем в настройках.
    await client.destroy().catch(() => undefined);
    await markDegraded(tenantId, channelId, 'session_revoked');
    log('warn', 'Сессия отозвана владельцем', { channelId });
    return;
  }

  const l: Live = {
    client,
    channelId,
    tenantId,
    recentSent: new Set(),
    avatarsChecked: new Set(),
    lastHealth: Date.now(),
  };
  client.addEventHandler((ev: NewMessageEvent) => {
    onMessage(l, ev).catch((err) =>
      log('error', 'Не удалось обработать входящее', { channelId, error: errText(err) }),
    );
  }, new NewMessage({}));

  // Кэш собеседников. Без access_hash написать человеку нельзя, а после
  // перезапуска процесса кэш пуст: список диалогов его заполняет.
  await client.getDialogs({ limit: 100 }).catch(() => undefined);

  live.set(channelId, l);
  log('info', 'Сессия запущена', { channelId });
}

/**
 * Сверка запущенных сессий с базой.
 *
 * Не через события «канал добавлен / удалён», а сверкой по таймеру:
 * событие можно потерять при перезапуске, а сверка сама приводит
 * состояние в порядок в пределах полуминуты.
 */
async function reconcile(): Promise<void> {
  const routes = await withSystem(pool, 'сессии номерного Telegram', async (db) => {
    const { rows } = await db.query<{ channel_id: string; tenant_id: string }>(
      `SELECT channel_id, tenant_id FROM channel_routes
        WHERE channel_type = 'telegram_user' AND status = 'active'`,
    );
    return rows;
  });
  const wanted = new Map(routes.map((r) => [r.channel_id, r.tenant_id]));

  for (const id of [...live.keys()]) {
    if (!wanted.has(id)) await stopSession(id);
  }

  for (const [channelId, tenantId] of wanted) {
    if (live.has(channelId) || starting.has(channelId)) continue;
    starting.add(channelId);
    startSession(channelId, tenantId)
      .catch(async (err) => {
        const text = errText(err);
        log('error', 'Сессия не запустилась', { channelId, error: text });
        if (DEAD_SESSION.test(text)) await markDegraded(tenantId, channelId, 'session_revoked');
      })
      .finally(() => starting.delete(channelId));
  }

  // Проверка живости. autoReconnect лечит обрывы сети, но не отзыв сессии:
  // клиент будет вечно переподключаться к аккаунту, который его выгнал.
  const now = Date.now();
  for (const l of live.values()) {
    if (now - l.lastHealth < HEALTH_MS) continue;
    l.lastHealth = now;
    try {
      await l.client.getMe();
    } catch (err) {
      const text = errText(err);
      if (DEAD_SESSION.test(text)) {
        await markDegraded(l.tenantId, l.channelId, 'session_revoked');
        await stopSession(l.channelId);
      } else {
        log('warn', 'Проверка сессии не прошла', { channelId: l.channelId, error: text });
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Входящие
// ═══════════════════════════════════════════════════════════════════════

type TgMessage = NewMessageEvent['message'];

function attachmentOf(msg: TgMessage): { att: Attachment; size: number } | null {
  const media = msg.media;
  if (!media) return null;
  if (media instanceof Api.MessageMediaPhoto) {
    return { att: { type: 'image', mime: 'image/jpeg', filename: 'photo.jpg' }, size: 0 };
  }
  if (media instanceof Api.MessageMediaDocument && media.document instanceof Api.Document) {
    const doc = media.document;
    let type: Attachment['type'] = 'document';
    let filename: string | undefined;
    let durationSec: number | undefined;
    for (const a of doc.attributes) {
      if (a instanceof Api.DocumentAttributeFilename) filename = a.fileName;
      if (a instanceof Api.DocumentAttributeAudio) {
        type = a.voice ? 'voice' : 'audio';
        durationSec = a.duration;
      }
      if (a instanceof Api.DocumentAttributeVideo) {
        type = 'video';
        durationSec = Math.round(a.duration);
      }
      if (a instanceof Api.DocumentAttributeSticker) type = 'sticker';
    }
    const att: Attachment = { type, mime: doc.mimeType };
    if (filename) att.filename = filename;
    if (durationSec !== undefined) att.durationSec = durationSec;
    return { att, size: Number(doc.size.toString()) };
  }
  return null;
}

async function onMessage(l: Live, ev: NewMessageEvent): Promise<void> {
  const msg = ev.message;
  // Только личные переписки. Группы и каналы — это не обращения клиентов,
  // и выливать их в общий список значит утопить в них операторов.
  if (!msg.isPrivate) return;
  const peerId = msg.chatId?.toString();
  if (!peerId || peerId === TELEGRAM_SERVICE_ID) return;

  const externalId = `${peerId}:${msg.id}`;
  if (msg.out) {
    // Своё отправленное из Rozmovio может вернуться эхом. Даём отправке
    // время записать идентификатор, иначе в ленте будет две копии.
    await new Promise((r) => setTimeout(r, 1500));
    if (l.recentSent.has(externalId)) return;
  }

  const chat = await msg.getChat();
  if (!(chat instanceof Api.User)) return;
  // Служебные боты (BotFather, банки, доставка) — не клиенты.
  if (chat.bot) return;

  const name = [chat.firstName, chat.lastName].filter(Boolean).join(' ').trim();
  const peerProfile: MtprotoInboundPayload['message']['peerProfile'] = {};
  if (name) peerProfile.name = name;
  if (chat.username) peerProfile.username = chat.username;
  if (chat.phone) peerProfile.phone = `+${chat.phone}`;
  if (chat.accessHash) peerProfile.accessHash = chat.accessHash.toString();

  const attachments: Attachment[] = [];
  const found = attachmentOf(msg);
  if (found) {
    const { att, size } = found;
    if (size > MAX_MEDIA_BYTES) {
      att.ready = false;
      att.failure = { error: 'too_large', detail: String(size) };
    } else {
      try {
        const buf = await l.client.downloadMedia(msg, {});
        if (buf && typeof buf !== 'string') {
          const key = `${l.tenantId}/tgu/${l.channelId}/${peerId}-${msg.id}-0`;
          await storage.put(key, buf, att.mime ?? 'application/octet-stream');
          att.storageKey = key;
          att.size = buf.length;
          att.ready = true;
        }
      } catch (err) {
        att.ready = false;
        att.failure = { error: 'download_failed', detail: errText(err) };
      }
    }
    attachments.push(att);
  }

  let avatarKey: string | undefined;
  if (!l.avatarsChecked.has(peerId)) {
    try {
      const photo = await l.client.downloadProfilePhoto(chat, { isBig: false });
      if (photo && typeof photo !== 'string' && photo.length > 0) {
        avatarKey = `${l.tenantId}/avatars/tgu-${l.channelId}-${peerId}`;
        await storage.put(avatarKey, photo, 'image/jpeg');
        // Отмечаем собеседника только после успеха: иначе одна неудачная
        // попытка оставила бы его без аватара до перезапуска сервиса.
        l.avatarsChecked.add(peerId);
        log('info', 'Аватар скачан', { peerId, size: photo.length });
      } else {
        l.avatarsChecked.add(peerId);
        log('debug', 'У собеседника нет фото профиля', { peerId });
      }
    } catch (err) {
      log('warn', 'Не удалось скачать аватар', { peerId, error: errText(err) });
    }
  }

  const replyToId = msg.replyTo instanceof Api.MessageReplyHeader ? msg.replyTo.replyToMsgId : undefined;
  const content: MtprotoInboundPayload['message']['content'] = {};
  if (msg.message) content.text = msg.message;
  if (attachments.length) content.attachments = attachments;
  if (replyToId) content.replyToExternalId = `${peerId}:${replyToId}`;
  if (!content.text && !attachments.length) return;

  const payload: MtprotoInboundPayload = {
    message: {
      tenantId: l.tenantId,
      channelId: l.channelId,
      channelType: 'telegram_user',
      externalId,
      peerId,
      peerProfile,
      direction: msg.out ? 'out' : 'in',
      senderType: msg.out ? 'agent' : 'customer',
      content,
      status: msg.out ? 'sent' : 'delivered',
      sentAt: new Date(msg.date * 1000).toISOString(),
      // Объект MTProto целиком не сериализуется (BigInt) и полон служебного.
      raw: { id: msg.id, date: msg.date, out: msg.out, media: msg.media?.className ?? null },
    },
  };
  if (avatarKey) payload.avatarKey = avatarKey;

  await inboundQueue.add(
    'mtproto',
    {
      channelId: l.channelId,
      tenantId: l.tenantId,
      provider: 'mtproto',
      payload,
      receivedAt: new Date().toISOString(),
    },
    { jobId: jobKey('mtp', l.channelId, peerId, msg.id) },
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Исходящие
// ═══════════════════════════════════════════════════════════════════════

interface OutRow {
  status: string;
  content: {
    text?: string;
    replyToExternalId?: string;
    attachments?: Array<{ type: string; storageKey?: string; filename?: string; mime?: string }>;
  } | null;
  peer_id: string | null;
  raw_profile: { accessHash?: string } | null;
}

async function markFailed(job: OutboundJob, failure: Record<string, unknown>): Promise<void> {
  await withTenant(pool, job.tenantId, async (db) => {
    await db.query(`UPDATE messages SET status = 'failed', failure = $2 WHERE id = $1`, [
      job.messageId,
      JSON.stringify(failure),
    ]);
  });
}

async function resolvePeer(l: Live, peerId: string, accessHash?: string) {
  if (accessHash) {
    return new Api.InputPeerUser({ userId: bigInt(peerId), accessHash: bigInt(accessHash) });
  }
  return l.client.getInputEntity(peerId);
}

/** Постоянные отказы: повторять бессмысленно. */
const PERMANENT = /PEER_ID_INVALID|USER_IS_BLOCKED|INPUT_USER_DEACTIVATED|YOU_BLOCKED_USER|PRIVACY_RESTRICTED|USER_PRIVACY_RESTRICTED|MESSAGE_EMPTY|CHAT_WRITE_FORBIDDEN|REACTION_INVALID/;

async function handleSend(job: OutboundJob, worker: Worker): Promise<void> {
  const l = live.get(job.channelId);
  // Сессия может подниматься после перезапуска — очередь повторит.
  if (!l) throw new Error('Сессия канала не запущена');

  if (job.kind === 'reaction') return handleReaction(l, job);
  if (job.kind === 'read') return handleRead(l, job);

  const row = await withTenant(pool, job.tenantId, async (db) => {
    const { rows } = await db.query<OutRow>(
      `SELECT m.status, m.content, ci.external_id AS peer_id, ci.raw_profile
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         LEFT JOIN contact_identities ci
                ON ci.contact_id = c.contact_id AND ci.channel_type = 'telegram_user'
        WHERE m.id = $1 LIMIT 1`,
      [job.messageId],
    );
    return rows[0] ?? null;
  });
  if (!row) throw new UnrecoverableError('Сообщение не найдено');
  if (row.status !== 'pending') return;
  if (!row.peer_id) {
    await markFailed(job, { reason: 'no_peer_identity' });
    throw new UnrecoverableError('Неизвестен получатель');
  }

  try {
    const peer = await resolvePeer(l, row.peer_id, row.raw_profile?.accessHash);
    const replyTo = row.content?.replyToExternalId
      ? Number(row.content.replyToExternalId.split(':')[1])
      : undefined;
    const text = row.content?.text ?? '';
    const att = (row.content?.attachments ?? []).find((a) => a.storageKey);

    let sentId: number;
    if (att?.storageKey) {
      const file = await storage.get(att.storageKey);
      if (!file) {
        await markFailed(job, { reason: 'attachment_missing' });
        throw new UnrecoverableError('Вложение не найдено в хранилище');
      }
      const sent = await l.client.sendFile(peer, {
        file: new CustomFile(att.filename || 'file', file.body.length, '', file.body),
        caption: text,
        ...(replyTo ? { replyTo } : {}),
        voiceNote: att.type === 'voice',
        forceDocument: att.type === 'document',
      });
      sentId = sent.id;
    } else {
      const sent = await l.client.sendMessage(peer, {
        message: text,
        ...(replyTo ? { replyTo } : {}),
      });
      sentId = sent.id;
    }

    const externalId = `${row.peer_id}:${sentId}`;
    l.recentSent.add(externalId);
    if (l.recentSent.size > 5000) l.recentSent.clear();

    await withTenant(pool, job.tenantId, async (db) => {
      await db.query(
        `UPDATE messages SET status = 'sent', external_id = $2 WHERE id = $1 AND status = 'pending'`,
        [job.messageId, externalId],
      );
    });
    log('info', 'Сообщение отправлено', { messageId: job.messageId });
  } catch (err) {
    if (err instanceof UnrecoverableError) throw err;
    const e = err as { seconds?: number };
    const text = errText(err);
    if (typeof e.seconds === 'number' && /FLOOD/.test(text)) {
      // Для личного аккаунта FLOOD_WAIT — последнее предупреждение
      // перед ограничением. Ждём столько, сколько сказали, и весь воркер.
      await worker.rateLimit(e.seconds * 1000);
      throw Worker.RateLimitError();
    }
    if (PERMANENT.test(text)) {
      await markFailed(job, { reason: text });
      throw new UnrecoverableError(`Telegram отказал: ${text}`);
    }
    if (DEAD_SESSION.test(text)) {
      await markFailed(job, { reason: 'session_revoked' });
      await markDegraded(l.tenantId, l.channelId, 'session_revoked');
      await stopSession(l.channelId);
      throw new UnrecoverableError('Сессия отозвана — подключите номер заново');
    }
    throw err;
  }
}

/**
 * Отметить переписку прочитанной в самом Telegram.
 *
 * Оператор ответил из Rozmovio, а в телефоне владельца тот же чат висит
 * непрочитанным: аккаунт-то один, но приложение об ответе не знает.
 * Человек открывает чат второй раз — увидеть, что там уже всё отвечено.
 *
 * Идентификатор входящего у нас составной, «кому:номер», и номер
 * сообщения здесь — граница: Telegram читает историю ДО неё
 * включительно.
 */
async function handleRead(l: Live, job: OutboundJob): Promise<void> {
  const external = job.readUpTo?.externalId;
  if (!external) return;
  const [peerId, msgIdRaw] = external.split(':');
  const maxId = Number(msgIdRaw);
  if (!peerId || !Number.isFinite(maxId)) return;

  const hash = await withTenant(pool, job.tenantId, async (db) => {
    const { rows } = await db.query<{ raw_profile: { accessHash?: string } | null }>(
      `SELECT raw_profile FROM contact_identities
        WHERE channel_type = 'telegram_user' AND external_id = $1 LIMIT 1`,
      [peerId],
    );
    return rows[0]?.raw_profile?.accessHash;
  });

  try {
    await l.client.invoke(
      new Api.messages.ReadHistory({ peer: await resolvePeer(l, peerId, hash), maxId }),
    );
  } catch (err) {
    // Отметка о прочтении — не сообщение клиенту. Не доехала, значит
    // чат останется подсвеченным; ломать из-за этого очередь незачем.
    const text = errText(err);
    log('warn', 'Не удалось отметить прочитанным', { peerId, error: text });
  }
}

async function handleReaction(l: Live, job: OutboundJob): Promise<void> {
  const target = job.reaction;
  if (!target) throw new UnrecoverableError('Задача реакции без данных');
  const [peerId, msgIdRaw] = target.targetExternalId.split(':');
  const msgId = Number(msgIdRaw);
  if (!peerId || !Number.isFinite(msgId)) throw new UnrecoverableError('Некорректный идентификатор');

  const hash = await withTenant(pool, job.tenantId, async (db) => {
    const { rows } = await db.query<{ raw_profile: { accessHash?: string } | null }>(
      `SELECT raw_profile FROM contact_identities
        WHERE channel_type = 'telegram_user' AND external_id = $1 LIMIT 1`,
      [peerId],
    );
    return rows[0]?.raw_profile?.accessHash;
  });

  try {
    await l.client.invoke(
      new Api.messages.SendReaction({
        peer: await resolvePeer(l, peerId, hash),
        msgId,
        reaction: target.emoji ? [new Api.ReactionEmoji({ emoticon: target.emoji })] : [],
      }),
    );
  } catch (err) {
    const text = errText(err);
    if (PERMANENT.test(text)) throw new UnrecoverableError(`Telegram отказал в реакции: ${text}`);
    throw err;
  }

  await withTenant(pool, job.tenantId, async (db) => {
    await db.query(
      `UPDATE messages
          SET reactions = COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(reactions) e
                                     WHERE e->>'by' <> 'agent'), '[]'::jsonb)
                          || CASE WHEN $3::text IS NULL THEN '[]'::jsonb
                                  ELSE jsonb_build_array(jsonb_build_object('emoji', $3::text, 'by', 'agent')) END
        WHERE channel_id = $1 AND external_id = $2`,
      [job.channelId, target.targetExternalId, target.emoji],
    );
  });
}

// ═══════════════════════════════════════════════════════════════════════
// Вход по QR-коду
// ═══════════════════════════════════════════════════════════════════════

async function setState(loginId: string, patch: Partial<MtprotoLoginState>): Promise<void> {
  const key = mtprotoLoginKey(loginId);
  const prev = JSON.parse((await connection.get(key)) ?? '{}') as MtprotoLoginState;
  await connection.set(key, JSON.stringify({ ...prev, ...patch }), 'EX', 600);
}

async function waitPassword(loginId: string): Promise<string> {
  const key = mtprotoPasswordKey(loginId);
  const until = Date.now() + PASSWORD_WAIT_MS;
  while (Date.now() < until) {
    // GETDEL: пароль лежит в Redis доли секунды и исчезает сразу после чтения.
    const pw = await connection.getdel(key);
    if (pw) return pw;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('PASSWORD_TIMEOUT');
}

async function handleLogin(job: MtprotoLoginJob): Promise<void> {
  const { loginId, tenantId } = job;
  const client = newClient('');
  let passwordAsked = false;
  let cancelled = false;

  const timer = setTimeout(() => {
    cancelled = true;
    client.destroy().catch(() => undefined);
  }, LOGIN_TIMEOUT_MS);

  try {
    await client.connect();
    const user = await client.signInUserWithQrCode(
      { apiId: API_ID, apiHash: API_HASH },
      {
        qrCode: async ({ token, expires }) => {
          await setState(loginId, {
            state: 'qr',
            qrUrl: `tg://login?token=${token.toString('base64url')}`,
            qrExpires: expires,
          });
        },
        password: async (hint?: string) => {
          await setState(loginId, {
            state: 'password',
            passwordError: passwordAsked,
            ...(hint ? { passwordHint: hint } : {}),
          });
          passwordAsked = true;
          return waitPassword(loginId);
        },
        onError: async (err: Error) => {
          const text = errText(err);
          // Неверный пароль — даём ввести ещё раз. Остальное — конец попытки.
          if (/PASSWORD_HASH_INVALID/.test(text) && !cancelled) return false;
          return true;
        },
      },
    );

    if (!(user instanceof Api.User)) throw new Error('Telegram не вернул пользователя');
    const session = (client.session as InstanceType<typeof StringSession>).save();
    const externalId = user.id.toString();

    const owner = await withSystem(pool, 'владелец номерного Telegram', async (db) => {
      const { rows } = await db.query<{ channel_id: string; tenant_id: string }>(
        `SELECT channel_id, tenant_id FROM channel_routes
          WHERE channel_type = 'telegram_user' AND external_id = $1 LIMIT 1`,
        [externalId],
      );
      return rows[0] ?? null;
    });
    if (owner && owner.tenant_id !== tenantId) {
      // Сессию, которую мы только что создали, закрываем: она не нужна.
      await client.invoke(new Api.auth.LogOut()).catch(() => undefined);
      await setState(loginId, {
        state: 'error',
        error: 'Этот аккаунт Telegram уже подключён в другой организации.',
      });
      return;
    }

    const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
    const phone = user.phone ? `+${user.phone}` : '';
    const channelId = owner?.channel_id ?? randomUUID();

    await withTenant(pool, tenantId, async (db) => {
      await db.query(
        `INSERT INTO channels (id, tenant_id, type, display_name, external_id,
                               credentials_enc, meta, status)
         VALUES ($1, $2, 'telegram_user', $3, $4, $5, $6, 'active')
         ON CONFLICT (type, external_id) DO UPDATE
           SET credentials_enc = EXCLUDED.credentials_enc,
               meta = EXCLUDED.meta, status = 'active', last_error = NULL`,
        [
          channelId,
          tenantId,
          job.displayName?.trim() || phone || name || 'Telegram',
          externalId,
          encryptJson(masterKey, tenantId, { session }),
          JSON.stringify({ phone, username: user.username ?? null, name }),
        ],
      );
    });

    await setState(loginId, { state: 'done', channelId });
    log('info', 'Номерной Telegram подключён', { channelId, tenantId });

    // Старая сессия этого же номера (переподключение) — заменяем новой.
    await client.destroy().catch(() => undefined);
    await stopSession(channelId);
    await reconcile();
  } catch (err) {
    const text = errText(err);
    const human = cancelled
      ? 'Время на вход вышло. Нажмите «Подключить» ещё раз.'
      : /PASSWORD_TIMEOUT/.test(text)
        ? 'Пароль не был введён. Попробуйте ещё раз.'
        : `Не удалось войти: ${text}`;
    await setState(loginId, { state: 'error', error: human });
    log('warn', 'Вход по QR не удался', { loginId, error: text });
  } finally {
    clearTimeout(timer);
    await client.destroy().catch(() => undefined);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Запуск
// ═══════════════════════════════════════════════════════════════════════

const sendWorker: Worker<OutboundJob> = new Worker<OutboundJob>(
  QUEUE_MTPROTO_OUT,
  async (job) => handleSend(job.data, sendWorker),
  {
    connection,
    concurrency: 2,
    // Личный аккаунт — не бот. Массовая отправка с него быстро
    // заканчивается ограничением, поэтому темп заметно ниже, чем у бота.
    limiter: { max: 3, duration: 1000 },
  },
);
sendWorker.on('failed', async (job, err) => {
  log('error', 'Отправка не удалась', { messageId: job?.data?.messageId, error: err.message });
  // Последняя попытка исчерпана, а сообщение всё ещё «отправляется» —
  // помечаем, чтобы оператор увидел ошибку, а не вечные часики.
  if (job && job.attemptsMade >= (job.opts.attempts ?? 1)
      && job.data.kind !== 'reaction' && job.data.kind !== 'read') {
    await withTenant(pool, job.data.tenantId, async (db) => {
      await db.query(
        `UPDATE messages SET status = 'failed', failure = $2 WHERE id = $1 AND status = 'pending'`,
        [job.data.messageId, JSON.stringify({ reason: err.message })],
      );
    }).catch(() => undefined);
  }
});

const loginWorker = new Worker<MtprotoLoginJob>(
  QUEUE_MTPROTO_LOGIN,
  async (job) => handleLogin(job.data),
  { connection, concurrency: 5, lockDuration: LOGIN_TIMEOUT_MS + 60_000 },
);

/*
 * Номерной WhatsApp живёт в этой же службе: это тот же род работы —
 * держать живое соединение от имени аккаунта. Отдельный процесс
 * означал бы второй Dockerfile, вторую выкладку и второй способ
 * однажды запустить две реплики там, где можно только одну.
 */
const wa = startWa({ pool, connection, redis: connection, masterKey, storage, inboundQueue, log });

let timer: NodeJS.Timeout | null = null;
async function loop(): Promise<void> {
  try {
    await reconcile();
  } catch (err) {
    log('error', 'Сверка сессий упала', { error: errText(err) });
  }
  timer = setTimeout(loop, RECONCILE_MS);
}
void loop();
log('info', 'Сервис сессий запущен');

async function shutdown(): Promise<void> {
  log('info', 'Остановка сервиса сессий');
  if (timer) clearTimeout(timer);
  await Promise.allSettled([sendWorker.close(), loginWorker.close(), wa.stop()]);
  for (const id of [...live.keys()]) await stopSession(id);
  await pool.end().catch(() => undefined);
  await connection.quit().catch(() => undefined);
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
