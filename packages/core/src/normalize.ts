import type { Attachment, ChannelType, MessageContent, UnifiedMessage } from './types.js';

/**
 * Нормализация входящих апдейтов в UnifiedMessage.
 *
 * Принцип: нормализатор — чистая функция без побочных эффектов и без обращений
 * к сети или БД. Так его можно покрыть тестами на реальных payload'ах,
 * и именно здесь ловится 90% багов интеграции.
 *
 * Возвращаем массив: один вебхук может содержать несколько сообщений,
 * а может — только статусы доставки, тогда массив пустой.
 */

export interface NormalizeContext {
  tenantId: string;
  channelId: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Telegram Bot API
// ─────────────────────────────────────────────────────────────────────────

interface TgUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: { id: number; type: string; username?: string; first_name?: string; last_name?: string };
  date: number;
  text?: string;
  caption?: string;
  photo?: Array<{ file_id: string; file_size?: number; width: number; height: number }>;
  document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
  voice?: { file_id: string; duration: number; mime_type?: string; file_size?: number };
  audio?: { file_id: string; duration: number; mime_type?: string; file_size?: number };
  video?: { file_id: string; duration: number; mime_type?: string; file_size?: number };
  sticker?: { file_id: string; emoji?: string };
  location?: { latitude: number; longitude: number };
  contact?: { phone_number: string; first_name?: string };
  reply_to_message?: {
    message_id: number;
    text?: string;
    caption?: string;
    from?: TgUser;
  };
}

/**
 * Реакция приходит ОТДЕЛЬНЫМ обновлением, а не внутри сообщения,
 * и только если в allowed_updates явно указан message_reaction.
 * Telegram не включает его по умолчанию: подписка на реакции резко
 * увеличивает поток обновлений, и это осознанный выбор владельца бота.
 */
export interface TgMessageReaction {
  chat: { id: number };
  message_id: number;
  user?: TgUser;
  date: number;
  old_reaction: Array<{ type: string; emoji?: string; custom_emoji_id?: string }>;
  new_reaction: Array<{ type: string; emoji?: string; custom_emoji_id?: string }>;
}

export interface TelegramUpdate {
  update_id: number;
  message_reaction?: TgMessageReaction;
  message?: TgMessage;
  edited_message?: TgMessage;
  /** Сообщения из личного чата владельца Business-аккаунта. */
  business_message?: TgMessage & { business_connection_id?: string };
  edited_business_message?: TgMessage & { business_connection_id?: string };
  business_connection?: {
    id: string;
    user: TgUser;
    user_chat_id: number;
    date: number;
    is_enabled: boolean;
    rights?: Record<string, boolean>;
  };
}

function tgDisplayName(u: TgUser | TgMessage['chat'] | undefined): string | undefined {
  if (!u) return undefined;
  const first = 'first_name' in u ? u.first_name : undefined;
  const last = 'last_name' in u ? u.last_name : undefined;
  const name = [first, last].filter(Boolean).join(' ').trim();
  return name || undefined;
}

function tgAttachments(m: TgMessage): Attachment[] {
  const out: Attachment[] = [];

  if (m.photo && m.photo.length > 0) {
    // Telegram присылает массив размеров одного изображения.
    // Берём самый крупный — он последний.
    const largest = m.photo[m.photo.length - 1]!;
    out.push({ type: 'image', externalId: largest.file_id, size: largest.file_size });
  }
  if (m.document) {
    out.push({
      type: 'document',
      externalId: m.document.file_id,
      filename: m.document.file_name,
      mime: m.document.mime_type,
      size: m.document.file_size,
    });
  }
  if (m.voice) {
    out.push({
      type: 'voice',
      externalId: m.voice.file_id,
      mime: m.voice.mime_type,
      size: m.voice.file_size,
      durationSec: m.voice.duration,
    });
  }
  if (m.audio) {
    out.push({
      type: 'audio',
      externalId: m.audio.file_id,
      mime: m.audio.mime_type,
      size: m.audio.file_size,
      durationSec: m.audio.duration,
    });
  }
  if (m.video) {
    out.push({
      type: 'video',
      externalId: m.video.file_id,
      mime: m.video.mime_type,
      size: m.video.file_size,
      durationSec: m.video.duration,
    });
  }
  if (m.sticker) {
    out.push({ type: 'sticker', externalId: m.sticker.file_id });
  }
  return out;
}

export function normalizeTelegram(
  ctx: NormalizeContext,
  update: TelegramUpdate,
): UnifiedMessage[] {
  const isBusiness = Boolean(update.business_message);
  const msg = update.message ?? update.business_message;
  if (!msg) return [];

  const channelType: ChannelType = isBusiness ? 'telegram_business' : 'telegram_bot';

  const content: MessageContent = {};
  const text = msg.text ?? msg.caption;
  if (text) content.text = text;

  const attachments = tgAttachments(msg);
  if (attachments.length > 0) content.attachments = attachments;

  if (msg.location) {
    content.location = { lat: msg.location.latitude, lng: msg.location.longitude };
  }
  if (msg.contact) {
    content.contact = { name: msg.contact.first_name, phone: msg.contact.phone_number };
  }
  if (msg.reply_to_message) {
    const q = msg.reply_to_message;
    // chat.id в паре с message_id: message_id уникален только внутри чата.
    content.replyToExternalId = `${msg.chat.id}:${q.message_id}`;
    const quoted = q.text ?? q.caption;
    if (quoted) content.replyToText = quoted.slice(0, 200);
    const who = tgDisplayName(q.from);
    if (who) content.replyToName = who;
  }

  // Сообщение без текста и без вложений (например, служебное) не заводим.
  if (!content.text && !content.attachments && !content.location && !content.contact) {
    return [];
  }

  const peerId = String(msg.chat.id);

  return [
    {
      tenantId: ctx.tenantId,
      channelId: ctx.channelId,
      channelType,
      // chat.id обязателен в паре: message_id уникален только внутри чата.
      externalId: `${msg.chat.id}:${msg.message_id}`,
      peerId,
      peerProfile: {
        name: tgDisplayName(msg.from) ?? tgDisplayName(msg.chat),
        username: msg.from?.username ?? msg.chat.username,
      },
      direction: 'in',
      senderType: 'customer',
      content,
      status: 'delivered',
      sentAt: new Date(msg.date * 1000),
      raw: update,
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────
// Meta: WhatsApp Cloud API
// ─────────────────────────────────────────────────────────────────────────

interface WaMediaRef {
  id: string;
  mime_type?: string;
  sha256?: string;
  filename?: string;
  voice?: boolean;
}

interface WaMessage {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: WaMediaRef;
  video?: WaMediaRef;
  audio?: WaMediaRef;
  document?: WaMediaRef;
  sticker?: WaMediaRef;
  location?: { latitude: number; longitude: number };
  context?: { id?: string };
}

export interface MetaWebhookPayload {
  object?: string;
  entry?: Array<{
    id: string;
    changes?: Array<{
      field: string;
      value: {
        messaging_product?: string;
        metadata?: { display_phone_number?: string; phone_number_id?: string };
        contacts?: Array<{ profile?: { name?: string }; wa_id: string }>;
        messages?: WaMessage[];
        statuses?: Array<{ id: string; status: string; timestamp: string; recipient_id: string }>;
      };
    }>;
    messaging?: unknown[];
  }>;
}

function waAttachment(m: WaMessage): Attachment | null {
  const map: Array<[keyof WaMessage, Attachment['type']]> = [
    ['image', 'image'],
    ['video', 'video'],
    ['audio', 'audio'],
    ['document', 'document'],
    ['sticker', 'sticker'],
  ];
  for (const [key, type] of map) {
    const ref = m[key] as WaMediaRef | undefined;
    if (ref && typeof ref === 'object' && 'id' in ref) {
      return {
        type: type === 'audio' && ref.voice ? 'voice' : type,
        externalId: ref.id,
        mime: ref.mime_type,
        filename: ref.filename,
      };
    }
  }
  return null;
}

export function normalizeWhatsApp(
  ctx: NormalizeContext,
  payload: MetaWebhookPayload,
): UnifiedMessage[] {
  const out: UnifiedMessage[] = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue;
      const value = change.value;

      const nameByWaId = new Map<string, string>();
      for (const c of value.contacts ?? []) {
        if (c.profile?.name) nameByWaId.set(c.wa_id, c.profile.name);
      }

      for (const m of value.messages ?? []) {
        const content: MessageContent = {};
        if (m.text?.body) content.text = m.text.body;

        const att = waAttachment(m);
        if (att) content.attachments = [att];

        if (m.location) {
          content.location = { lat: m.location.latitude, lng: m.location.longitude };
        }
        if (m.context?.id) content.replyToExternalId = m.context.id;

        if (!content.text && !content.attachments && !content.location) continue;

        out.push({
          tenantId: ctx.tenantId,
          channelId: ctx.channelId,
          channelType: 'whatsapp',
          externalId: m.id, // wamid уже глобально уникален
          peerId: m.from,
          peerProfile: { name: nameByWaId.get(m.from), phone: `+${m.from}` },
          direction: 'in',
          senderType: 'customer',
          content,
          status: 'delivered',
          sentAt: new Date(Number(m.timestamp) * 1000),
          raw: payload,
        });
      }
    }
  }

  return out;
}

/**
 * Статусы доставки WhatsApp приходят тем же вебхуком, что и сообщения.
 * Их надо применять к уже существующим строкам, а не создавать новые.
 */
export interface DeliveryStatusUpdate {
  externalId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  at: Date;
}

export function extractWhatsAppStatuses(payload: MetaWebhookPayload): DeliveryStatusUpdate[] {
  const out: DeliveryStatusUpdate[] = [];
  const allowed = new Set(['sent', 'delivered', 'read', 'failed']);

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const s of change.value?.statuses ?? []) {
        if (!allowed.has(s.status)) continue;
        out.push({
          externalId: s.id,
          status: s.status as DeliveryStatusUpdate['status'],
          at: new Date(Number(s.timestamp) * 1000),
        });
      }
    }
  }
  return out;
}

/**
 * Ключ дедупликации.
 *
 * Meta ретраит вебхуки до 7 дней при любом не-200 ответе. Без дедупа вы
 * получите дубликаты в инбоксе. Redis SET NX по этому ключу + UNIQUE-индекс
 * в БД — два независимых рубежа, нужны оба: Redis может потерять ключ,
 * а БД не должна принять дубль ни при каких обстоятельствах.
 */
export function dedupeKey(channelId: string, externalId: string): string {
  return `dedup:${channelId}:${externalId}`;
}


/**
 * Разбор обновления о реакции.
 *
 * Telegram присылает ПОЛНЫЙ новый набор реакций этого пользователя,
 * а не разницу. Поэтому здесь нет логики «добавить/убрать»: набор
 * просто заменяет предыдущий. Пустой массив означает, что реакцию сняли.
 */
export interface ReactionEvent {
  /** Совпадает с messages.external_id: «chatId:messageId». */
  externalId: string;
  peerId: string;
  emojis: string[];
  at: Date;
}

export function normalizeTelegramReaction(update: TelegramUpdate): ReactionEvent | null {
  const r = update.message_reaction;
  if (!r) return null;

  return {
    externalId: `${r.chat.id}:${r.message_id}`,
    peerId: String(r.chat.id),
    emojis: (r.new_reaction ?? [])
      .map((x) => x.emoji)
      .filter((x): x is string => typeof x === 'string' && x.length > 0),
    at: new Date(r.date * 1000),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Messenger и Instagram Direct
// ─────────────────────────────────────────────────────────────────────────
//
// У обоих один и тот же формат Messenger Platform: entry[].messaging[].
// Разница только в object ('page' или 'instagram') и в том, чей id лежит
// в entry.id — страницы Facebook или бизнес-аккаунта Instagram.

export interface MessagingEvent {
  sender?: { id: string };
  recipient?: { id: string };
  timestamp?: number;
  message?: {
    mid: string;
    text?: string;
    is_echo?: boolean;
    app_id?: number | string;
    is_deleted?: boolean;
    is_unsupported?: boolean;
    reply_to?: { mid?: string; story?: { url?: string; id?: string } };
    attachments?: Array<{ type: string; payload?: { url?: string; title?: string } }>;
  };
  reaction?: { mid: string; action: 'react' | 'unreact'; emoji?: string; reaction?: string };
}

export interface MessagingEntry {
  /** id страницы (Messenger) или бизнес-аккаунта Instagram. */
  channelExternalId: string;
  channelType: 'messenger' | 'instagram';
  events: MessagingEvent[];
}

/** Раскладывает вебхук Meta на пачки событий по каналам. */
export function splitMessagingPayload(payload: MetaWebhookPayload): MessagingEntry[] {
  const type =
    payload.object === 'page' ? 'messenger' : payload.object === 'instagram' ? 'instagram' : null;
  if (!type) return [];
  return (payload.entry ?? [])
    .filter((e) => Array.isArray(e.messaging) && e.messaging.length > 0)
    .map((e) => ({
      channelExternalId: String(e.id),
      channelType: type,
      events: e.messaging as MessagingEvent[],
    }));
}

const MSG_ATTACHMENT: Record<string, Attachment['type']> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  file: 'document',
  // Instagram присылает голосовые как audio, а сторис-упоминания —
  // отдельными типами, которые оператору показываем ссылкой.
  story_mention: 'image',
  ig_reel: 'video',
  reel: 'video',
};

/**
 * Сообщения из одной пачки событий.
 *
 * Эхо (is_echo) — это сообщение, отправленное СО страницы: из Meta
 * Business Suite, с телефона или нами. Своё эхо отбрасываем по app_id,
 * иначе ответ оператора появился бы в ленте дважды. Чужое эхо
 * сохраняем как исходящее: оператор должен видеть, что коллега уже
 * ответил из другого приложения.
 */
export function normalizeMessaging(
  ctx: NormalizeContext,
  entry: MessagingEntry,
  ownAppId: string,
): UnifiedMessage[] {
  const out: UnifiedMessage[] = [];
  for (const ev of entry.events) {
    const m = ev.message;
    if (!m || m.is_deleted) continue;
    const echo = !!m.is_echo;
    if (echo && ownAppId && String(m.app_id ?? '') === ownAppId) continue;

    const peerId = echo ? ev.recipient?.id : ev.sender?.id;
    if (!peerId) continue;

    const content: MessageContent = {};
    if (m.text) content.text = m.text;
    const atts: Attachment[] = [];
    for (const a of m.attachments ?? []) {
      const type = MSG_ATTACHMENT[a.type];
      const url = a.payload?.url;
      if (!type || !url) continue;
      const att: Attachment = { type, externalId: url };
      if (a.payload?.title) att.filename = a.payload.title;
      atts.push(att);
    }
    if (atts.length) content.attachments = atts;
    if (m.reply_to?.mid) content.replyToExternalId = m.reply_to.mid;

    /*
     * История и рилс.
     *
     * Ответ на историю Instagram кладёт в reply_to.story — сама история
     * при этом приходит картинкой, и без пометки в ленте видно только
     * её, без единого намёка, что человек отвечает на неё. Упоминание в
     * истории и присланный рилс различаются типом вложения.
     *
     * Ссылка временная и умрёт вместе с историей — это нормально:
     * пометка останется, и оператор хотя бы будет знать, о чём речь.
     */
    const story = m.reply_to?.story;
    if (story?.url || story?.id) {
      content.ig = { kind: 'story_reply' };
      if (story.url) content.ig.url = story.url;
      if (story.id) content.ig.id = story.id;
    } else {
      const kinds = (m.attachments ?? []).map((a) => a.type);
      if (kinds.includes('story_mention')) {
        content.ig = { kind: 'story_mention' };
        const url = (m.attachments ?? []).find((a) => a.type === 'story_mention')?.payload?.url;
        if (url) content.ig.url = url;
      } else if (kinds.includes('ig_reel') || kinds.includes('reel')) {
        content.ig = { kind: 'reel' };
        const url = (m.attachments ?? []).find((a) => a.type === 'ig_reel' || a.type === 'reel')
          ?.payload?.url;
        if (url) content.ig.url = url;
      } else if (kinds.includes('share')) {
        content.ig = { kind: 'share' };
      }
    }
    if (!content.text && !atts.length) {
      // Репост чужой публикации приходит без текста и без файла, зато с
      // пометкой: показать её честнее, чем выбросить сообщение вовсе.
      if (content.ig) content.text = '[поділився публікацією]';
      else if (!m.is_unsupported) continue;
      else content.text = '[Сообщение этого типа не поддерживается — откройте его в приложении]';
    }

    out.push({
      tenantId: ctx.tenantId,
      channelId: ctx.channelId,
      channelType: entry.channelType,
      externalId: m.mid,
      peerId,
      peerProfile: {},
      direction: echo ? 'out' : 'in',
      senderType: echo ? 'agent' : 'customer',
      content,
      status: echo ? 'sent' : 'delivered',
      sentAt: new Date(ev.timestamp ?? Date.now()),
      raw: ev,
    });
  }
  return out;
}

/** Реакции клиента в Messenger / Instagram. Одна реакция на сообщение, не набор. */
export function normalizeMessagingReactions(entry: MessagingEntry): ReactionEvent[] {
  const out: ReactionEvent[] = [];
  for (const ev of entry.events) {
    const r = ev.reaction;
    if (!r?.mid || !ev.sender?.id) continue;
    const emoji = r.emoji ?? (r.reaction === 'love' ? '❤️' : undefined);
    out.push({
      externalId: r.mid,
      peerId: ev.sender.id,
      emojis: r.action === 'react' && emoji ? [emoji] : [],
      at: new Date(ev.timestamp ?? Date.now()),
    });
  }
  return out;
}
