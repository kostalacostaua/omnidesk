import { createHmac, randomBytes } from 'node:crypto';
import type { Attachment, UnifiedMessage } from './types.js';

/**
 * Свой канал.
 *
 * Канал, у которого нет платформы: на той стороне код клиента. Он
 * присылает нам входящие и принимает исходящие, а чем они доставлены —
 * его дело.
 *
 * Появился из упрямого случая. У клиента уже работает самописный бот
 * Telegram со своими сценариями, и забрать у него вебхук нельзя: токен
 * допускает ровно один. Делать ради этого отдельный «Telegram, но
 * чужой» — значит потом делать то же для Viber, для SMS-шлюза, для
 * формы на сайте. Один канал вместо очереди частных случаев.
 *
 * Устроен он из двух половин, и каждая односторонняя:
 *
 *   входящие — клиент шлёт нам, предъявляя ключ канала;
 *   исходящие — мы шлём клиенту на его адрес, подписывая тело.
 *
 * Симметрия намеренная: каждая сторона проверяет другую тем, чем
 * владеет сама. Ключ доказывает нам, что пишет владелец канала;
 * подпись доказывает клиенту, что пришли мы, а не тот, кто узнал адрес.
 */

export const CUSTOM_CHANNEL = 'custom' as const;

/**
 * Ключ канала.
 *
 * Видимая часть отличает его от прочих ключей в чужих логах и записках:
 * когда у человека в руках три строки подряд, он должен понимать, какая
 * из них чья, не открывая документацию.
 */
export function newCustomKey(): string {
  return `chan_live_${randomBytes(24).toString('hex')}`;
}

export function isCustomKey(value: string): boolean {
  return /^chan_live_[0-9a-f]{48}$/.test((value ?? '').trim());
}

/** Секрет подписи исходящих. Свой у каждого канала. */
export function newCustomSecret(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Подпись исходящего.
 *
 * Считается по телу целиком, а не по отдельным полям: клиент проверяет
 * ровно то, что получил, и ему не нужно знать, в каком порядке мы
 * собираем JSON.
 */
export function signCustom(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

export interface CustomIncoming {
  /** Кто написал: идентификатор у клиента. Телефон, chat id, что угодно. */
  peerId?: string;
  /** Имя собеседника, если клиент его знает. */
  name?: string | null;
  text?: string;
  /**
   * Идентификатор сообщения у клиента. Нужен только для дедупликации
   * повторов; если его нет, мы выдадим свой.
   */
  externalId?: string | null;
  attachments?: Attachment[];
}

/**
 * Разбор входящего от клиента.
 *
 * Правило здесь одно: ничему не верить. Тело присылает чужой код, и
 * ошибка в нём не должна становиться нашей — ни пустым собеседником, ни
 * сообщением на мегабайт.
 */
export function normalizeCustom(
  msg: CustomIncoming,
  ctx: { tenantId: string; channelId: string; externalId: string },
): UnifiedMessage | null {
  const peerId = String(msg.peerId ?? '').trim().slice(0, 190);
  if (!peerId) return null;

  const text = String(msg.text ?? '').trim();
  const files = Array.isArray(msg.attachments) ? msg.attachments.slice(0, 10) : [];
  // Сообщение без текста и без файлов нечего показывать оператору.
  if (!text && !files.length) return null;

  return {
    tenantId: ctx.tenantId,
    channelId: ctx.channelId,
    channelType: CUSTOM_CHANNEL,
    externalId: ctx.externalId,
    peerId,
    peerProfile: {
      name: String(msg.name ?? '').trim().slice(0, 120) || `Гість ${peerId.slice(-4)}`,
    },
    direction: 'in',
    senderType: 'customer',
    content: {
      ...(text ? { text: text.slice(0, 4000) } : {}),
      ...(files.length ? { attachments: files } : {}),
    },
    status: 'delivered',
    sentAt: new Date(),
    raw: { peerId },
  };
}

/** Тело, которое уходит клиенту при ответе оператора. */
export interface CustomOutgoing {
  /** Наш идентификатор сообщения: по нему клиент может отчитаться о доставке. */
  messageId: string;
  channelId: string;
  peerId: string;
  text: string;
  /** Ссылки на вложения живут ограниченное время и требуют ключа канала. */
  attachments: Array<{ url: string; name: string; mime: string }>;
  sentAt: string;
}
