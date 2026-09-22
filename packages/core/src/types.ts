/**
 * Унифицированная модель сообщения.
 *
 * Ядро продукта. Всё, что приходит из четырёх разных API с четырьмя разными
 * форматами, приводится сюда. Дальше по системе ходит только это.
 */

export type ChannelType =
  | 'whatsapp'
  | 'instagram'
  | 'messenger'
  | 'telegram_bot'
  | 'telegram_business';

export type Direction = 'in' | 'out';
export type SenderType = 'customer' | 'agent' | 'bot' | 'system';
export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface Attachment {
  type: 'image' | 'video' | 'audio' | 'voice' | 'document' | 'sticker';
  /** Идентификатор файла у провайдера. Скачиваем асинхронно в воркере. */
  externalId?: string;
  url?: string;
  mime?: string;
  /** Ключ в нашем хранилище. Появляется после скачивания вложения
   *  или сразу — если файл загрузил оператор. */
  storageKey?: string;
  /** false = скачать не удалось; причина в failure. */
  ready?: boolean;
  failure?: { error: string; detail?: string };
  size?: number;
  filename?: string;
  durationSec?: number;
}

export interface MessageContent {
  text?: string;
  attachments?: Attachment[];
  replyToExternalId?: string;
  /** Кусок процитированного текста и автор — чтобы оператор видел,
   *  на что именно отвечают, не поднимая ленту. */
  replyToText?: string;
  replyToName?: string;
  location?: { lat: number; lng: number };
  contact?: { name?: string; phone?: string };
  /** Для исходящих шаблонов WhatsApp вне 24-часового окна. */
  template?: { name: string; language: string; params: unknown[] };
}

export interface UnifiedMessage {
  tenantId: string;
  channelId: string;
  channelType: ChannelType;
  /** wamid / mid / message_id провайдера. Ключ дедупликации. */
  externalId: string;
  /** Идентификатор собеседника у провайдера: wa_id / igsid / psid / telegram user id. */
  peerId: string;
  peerProfile: { name?: string; username?: string; phone?: string; avatarUrl?: string };
  direction: Direction;
  senderType: SenderType;
  content: MessageContent;
  status: MessageStatus;
  sentAt: Date;
  /** Сырой payload. Храните всегда — первые полгода будете находить поля,
   *  о существовании которых не подозревали. */
  raw: unknown;
}

/**
 * Окно ответа. У каждого канала своё, и вне окна свободный ответ запрещён.
 * Унифицируется один раз здесь, иначе получите четыре разных костыля.
 */
export type WindowType = 'standard' | 'human_agent' | 'free_entry' | 'none';

export interface ResponseWindow {
  type: WindowType;
  expiresAt: Date | null;
}

const HOUR = 3600_000;

/**
 * Окно ответа по каналу от момента последнего входящего сообщения.
 *
 *   WhatsApp            24 ч (CSW); 72 ч после Click-to-WhatsApp Ads
 *   Messenger           24 ч; тег HUMAN_AGENT продлевает до 7 дней
 *   Instagram           24 ч
 *   Telegram Business   24 ч — право `reply` действует только в чатах
 *                       с входящим за последние сутки
 *   Telegram Bot        без ограничения по времени, но писать первым нельзя,
 *                       пока пользователь не начал диалог
 */
export function computeResponseWindow(
  channelType: ChannelType,
  lastInboundAt: Date,
  opts: { freeEntryPoint?: boolean; humanAgentTag?: boolean } = {},
): ResponseWindow {
  const t = lastInboundAt.getTime();

  switch (channelType) {
    case 'whatsapp':
      if (opts.freeEntryPoint) {
        return { type: 'free_entry', expiresAt: new Date(t + 72 * HOUR) };
      }
      return { type: 'standard', expiresAt: new Date(t + 24 * HOUR) };

    case 'messenger':
      if (opts.humanAgentTag) {
        return { type: 'human_agent', expiresAt: new Date(t + 7 * 24 * HOUR) };
      }
      return { type: 'standard', expiresAt: new Date(t + 24 * HOUR) };

    case 'instagram':
      if (opts.humanAgentTag) {
        return { type: 'human_agent', expiresAt: new Date(t + 7 * 24 * HOUR) };
      }
      return { type: 'standard', expiresAt: new Date(t + 24 * HOUR) };

    case 'telegram_business':
      return { type: 'standard', expiresAt: new Date(t + 24 * HOUR) };

    case 'telegram_bot':
      return { type: 'none', expiresAt: null };
  }
}

export function isWindowOpen(w: ResponseWindow, now: Date = new Date()): boolean {
  if (w.type === 'none') return true;
  return w.expiresAt !== null && w.expiresAt.getTime() > now.getTime();
}

/**
 * Можно ли отправить свободное (не шаблонное) сообщение прямо сейчас.
 * Если нет — UI обязан предложить одобренный шаблон, а не молча отправить
 * и получить ошибку от провайдера.
 */
export function canSendFreeform(
  channelType: ChannelType,
  window: ResponseWindow,
  now: Date = new Date(),
): { allowed: true } | { allowed: false; reason: string; requiresTemplate: boolean } {
  if (isWindowOpen(window, now)) return { allowed: true };

  switch (channelType) {
    case 'whatsapp':
      return {
        allowed: false,
        reason: 'Окно 24 часа закрыто. Доступны только одобренные шаблоны.',
        requiresTemplate: true,
      };
    case 'messenger':
    case 'instagram':
      return {
        allowed: false,
        reason: 'Окно 24 часа закрыто. Доступен ответ оператора по тегу HUMAN_AGENT (до 7 дней).',
        requiresTemplate: false,
      };
    case 'telegram_business':
      return {
        allowed: false,
        reason: 'Окно 24 часа закрыто. Telegram не позволяет писать от имени владельца аккаунта вне окна.',
        requiresTemplate: false,
      };
    default:
      return { allowed: true } as const;
  }
}
