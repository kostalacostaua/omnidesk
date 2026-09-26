import type { ChannelType, UnifiedMessage } from './types.js';

/**
 * Номерной WhatsApp: сообщение и его приведение к общему виду.
 *
 * Соединение держит служба сессий — такое же, какое держит вкладка
 * WhatsApp Web. Здесь только форма сообщения и превращение его в
 * UnifiedMessage: дальше по системе не видно, пришло оно из
 * официального API или из сессии, и в этом весь смысл — список чатов,
 * боты, отчёты и CRM работают одинаково.
 *
 * Посредника у нас нет намеренно. Шлюз берёт деньги за каждый номер
 * ежемесячно — расход, растущий ровно с числом клиентов, — и становится
 * третьей стороной, через которую идёт чужая переписка.
 *
 * Чем за это платят со стороны WhatsApp: сессию держит не телефон, а
 * наш сервер, и это нарушение их условий. Номер могут заблокировать.
 * Поэтому канал помечен в интерфейсе, предупреждение показывается до
 * подключения, а официальный канал в списке остаётся первым.
 */

export const WHATSAPP_USER_CHANNEL: ChannelType = 'whatsapp_user';

/** Доступ к одному инстансу шлюза. Приходит из кабинета поставщика. */
export interface GatewayMessage {
  id: string;
  /** Идентификатор чата у поставщика: 380671234567@c.us. */
  chatId: string;
  name?: string | null;
  text?: string | null;
  /**
   * Ключ файла в нашем хранилище. Не ссылка: у WhatsApp файл отдаётся
   * зашифрованным и по одноразовому адресу, поэтому его скачивает
   * сессия, а дальше он живёт у нас, как вложение любого канала.
   */
  fileKey?: string | null;
  fileName?: string | null;
  mime?: string | null;
  /** true — написал клиент, false — отправлено с телефона самим владельцем. */
  incoming: boolean;
  at: string;
}

/** Ошибка сессии. Код нужен, чтобы отличить «повторить» от «бесполезно». */
export class GatewayError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

type FetchLike = (
  url: string,
  init?: Record<string, unknown>,
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;








/** Номер телефона в идентификатор чата поставщика и обратно. */
export function phoneToChat(phone: string): string {
  const digits = String(phone ?? '').replace(/[^0-9]/g, '');
  return digits ? `${digits}@c.us` : '';
}

/**
 * Телефон собеседника — только там, где он и правда телефон.
 *
 * WhatsApp адресует часть собеседников внутренним номером (@lid), а не
 * телефоном. Цифр в нём столько же, и принять его за номер — значит
 * завести клиента с телефоном, которого не существует, а потом свести
 * по нему двух разных людей.
 */
export function chatToPhone(chatId: string): string | null {
  const id = String(chatId ?? '');
  const at = id.indexOf('@');
  const domain = at >= 0 ? id.slice(at + 1) : 's.whatsapp.net';
  if (domain !== 's.whatsapp.net' && domain !== 'c.us') return null;

  const digits = id.slice(0, at >= 0 ? at : undefined).replace(/[^0-9]/g, '');
  return digits.length >= 9 ? `+${digits}` : null;
}



/**
 * Привести сообщение шлюза к общему виду.
 *
 * Дальше по системе ходит только UnifiedMessage: по нему не видно, шло
 * сообщение через официальный API или через шлюз, и в этом весь смысл —
 * список чатов, боты, отчёты и CRM работают одинаково.
 */
export function normalizeGateway(
  msg: GatewayMessage,
  ctx: { tenantId: string; channelId: string },
): UnifiedMessage | null {
  const phone = chatToPhone(msg.chatId);

  const attachments = msg.fileKey
    ? [
        {
          type: fileKind(msg.mime),
          storageKey: msg.fileKey,
          ready: true,
          ...(msg.fileName ? { filename: msg.fileName } : {}),
          ...(msg.mime ? { mime: msg.mime } : {}),
        },
      ]
    : undefined;

  if (!msg.text && !attachments) return null;

  return {
    tenantId: ctx.tenantId,
    channelId: ctx.channelId,
    channelType: WHATSAPP_USER_CHANNEL,
    externalId: msg.id,
    peerId: msg.chatId,
    peerProfile: {
      ...(msg.name ? { name: msg.name } : {}),
      ...(phone ? { phone } : {}),
    },
    /* Сообщение, отправленное с телефона владельца, — тоже часть
       переписки. Без него оператор видит вопросы клиента без ответов и
       пишет второй раз то, что уже сказали голосом. */
    direction: msg.incoming ? 'in' : 'out',
    senderType: msg.incoming ? 'customer' : 'agent',
    content: {
      ...(msg.text ? { text: msg.text } : {}),
      ...(attachments ? { attachments } : {}),
    },
    status: 'delivered',
    sentAt: new Date(msg.at),
    raw: msg,
  };
}

/** Тип вложения по MIME. В нашей модели «чего угодно» нет. */
function fileKind(mime: string | null | undefined): 'image' | 'video' | 'audio' | 'document' {
  const m = String(mime ?? '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  return 'document';
}
