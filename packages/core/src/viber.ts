import type { ChannelType, UnifiedMessage } from './types.js';

/**
 * Viber для бизнеса через партнёра.
 *
 * Про «номерной Viber». Официального способа нет: у Viber нет API для
 * личных аккаунтов. Продают его всё равно — десктоп Viber цепляется к
 * телефону по QR, и агрегаторы держат на каждый номер эмуляцию такого
 * десктопа. Держится это до первой проверки: правила Viber запрещают
 * коммерческое использование личных номеров, и номер блокируют, а
 * продавцы честно пишут в документации, что за блокировку не отвечают.
 * Рисковать чужим номером мы не будем, поэтому здесь то, что в Viber
 * работает по правилам: Viber Business Messages с именем отправителя
 * вместо номера, через официального партнёра.
 *
 * Партнёр первый — TurboSMS: он официальный партнёр Viber в Украине,
 * работает с ФОП и не требует иностранного юрлица. Формат общения с
 * ним простой: мы сами спрашиваем «есть новое?» и сами отправляем
 * ответ. Вебхука у них нет, поэтому входящие забирает служба опроса —
 * та же, что уже ходит за обновлениями Telegram.
 *
 * Про сессии. Viber считает разговор сессией: клиент написал — окно
 * открылось, сутки можно отвечать. Это то же правило, что у Instagram
 * и Messenger, и живёт оно в той же таблице окон ответа.
 */

export const VIBER_CHANNEL: ChannelType = 'viber_business';

/** Сколько Viber даёт на ответ после сообщения клиента. */
export const VIBER_WINDOW_HOURS = 24;

export interface ViberCreds {
  /** Ключ API из личного кабинета партнёра. */
  token: string;
  /** Имя отправителя, которое видит клиент. У Viber это не номер. */
  sender: string;
}

export interface ViberMessage {
  id: string;
  chatId: string;
  phone: string;
  name?: string | null;
  text?: string | null;
  fileUrl?: string | null;
  fileName?: string | null;
  /** true — написал клиент. */
  incoming: boolean;
  at: string;
}

export class ViberError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ViberError';
  }
}

type FetchLike = (url: string, init?: Record<string, unknown>) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

const ROOT = 'https://api.turbosms.ua';

/**
 * Запрос к партнёру.
 *
 * Ключ идёт заголовком Authorization, а не параметром в адресе:
 * параметр попадает в журналы прокси, а ключ в журнале считается
 * утёкшим. Их API принимает оба способа — выбираем безопасный.
 */
async function call(
  token: string,
  path: string,
  params: Record<string, string | number | boolean | undefined>,
  doFetch?: FetchLike,
): Promise<unknown> {
  const fetchImpl = doFetch ?? (globalThis.fetch as unknown as FetchLike);

  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    body.set(key, String(value));
  }

  const res = await fetchImpl(`${ROOT}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new ViberError('Ключ не підійшов — перевірте його в кабінеті партнера', 'bad_key');
    }
    throw new ViberError(`Партнер відповів помилкою (${res.status})`, 'refused');
  }

  const payload = (await res.json()) as {
    response_code?: number;
    response_status?: string;
    response_result?: unknown;
  };

  // У них успех — это код 0 или 800; всё остальное объясняется текстом.
  if (payload?.response_code !== undefined && payload.response_code !== 0 && payload.response_code !== 800) {
    throw new ViberError(payload.response_status || 'Партнер відмовив', 'refused');
  }
  return payload?.response_result;
}

/** Проверка ключа: заодно отдаёт имена отправителей, которые одобрены. */
export async function viberSenders(
  token: string,
  opts: { fetchImpl?: FetchLike } = {},
): Promise<Array<{ id: string; name: string; status: string }>> {
  const result = (await call(token, '/chat/senders.json', {}, opts.fetchImpl)) as
    Array<{ id?: number | string; sender?: string; name?: string; status?: string }> | null;

  return (result ?? []).map((s) => ({
    id: String(s.id ?? ''),
    name: String(s.sender ?? s.name ?? ''),
    status: String(s.status ?? ''),
  }));
}

/**
 * Забрать новые сообщения.
 *
 * `new_only` просит только непрочитанные — партнёр помечает их
 * прочитанными в ответ на выдачу. Поэтому обработка не должна терять
 * сообщения между выдачей и записью в базу: второй раз их уже не
 * отдадут, и переписка молча потеряется.
 */
export async function viberFetch(
  creds: ViberCreds,
  opts: { fetchImpl?: FetchLike; limit?: number } = {},
): Promise<ViberMessage[]> {
  const result = (await call(creds.token, '/chat/messages.json', {
    sender: creds.sender,
    new_only: 1,
    rows: Math.min(Math.max(opts.limit ?? 100, 1), 500),
  }, opts.fetchImpl)) as Array<Record<string, unknown>> | null;

  return (result ?? []).map(readMessage).filter((m): m is ViberMessage => m !== null);
}

/** Разобрать одно сообщение партнёра. Чужие поля не угадываем. */
export function readMessage(raw: Record<string, unknown>): ViberMessage | null {
  const id = String(raw['id'] ?? raw['message_id'] ?? '');
  const chatId = String(raw['chat_id'] ?? '');
  if (!id || !chatId) return null;

  const direction = String(raw['direction'] ?? raw['type'] ?? '').toLowerCase();
  const incoming = direction ? direction.startsWith('in') : Boolean(raw['is_incoming']);

  return {
    id,
    chatId,
    phone: String(raw['phone'] ?? raw['recipient'] ?? ''),
    name: (raw['name'] as string) ?? null,
    text: (raw['message'] as string) ?? (raw['text'] as string) ?? null,
    fileUrl: (raw['file_url'] as string) ?? null,
    fileName: (raw['file_name'] as string) ?? null,
    incoming,
    at: String(raw['created_at'] ?? raw['date'] ?? new Date().toISOString()),
  };
}

/** Отправить ответ в открытую сессию. */
export async function viberSend(
  creds: ViberCreds,
  to: { chatId?: string; phone?: string },
  content: { text?: string; fileUrl?: string; fileName?: string },
  opts: { fetchImpl?: FetchLike } = {},
): Promise<string> {
  if (!to.chatId && !to.phone) throw new ViberError('Немає куди надсилати', 'no_recipient');
  if (!content.text && !content.fileUrl) throw new ViberError('Немає чого надсилати', 'empty');

  const result = (await call(creds.token, '/chat/send.json', {
    chat_id: to.chatId,
    sender: to.chatId ? undefined : creds.sender,
    recipient: to.chatId ? undefined : to.phone,
    message: content.text,
    file_url: content.fileUrl,
    file_name: content.fileName,
  }, opts.fetchImpl)) as { message_id?: string | number } | Array<{ message_id?: string | number }> | null;

  const first = Array.isArray(result) ? result[0] : result;
  const id = first?.message_id;
  if (!id) throw new ViberError('Партнер не повернув номер повідомлення', 'no_id');
  return String(id);
}

/**
 * Привести сообщение Viber к общему виду.
 *
 * Дальше по системе ходит только `UnifiedMessage`, и по нему уже не
 * видно, из какого мессенджера пришёл текст — в этом и смысл.
 */
export function normalizeViber(
  msg: ViberMessage,
  ctx: { tenantId: string; channelId: string },
): UnifiedMessage | null {
  if (!msg.incoming) return null;

  const attachments = msg.fileUrl
    ? [{
        type: 'document' as const,
        url: msg.fileUrl,
        filename: msg.fileName ?? undefined,
      }]
    : undefined;

  if (!msg.text && !attachments) return null;

  return {
    tenantId: ctx.tenantId,
    channelId: ctx.channelId,
    channelType: VIBER_CHANNEL,
    externalId: msg.id,
    // Разговор в Viber ведётся с номером телефона: он же и примета, по
    // которой клиент находится в CRM и в других каналах.
    peerId: msg.chatId || msg.phone,
    peerProfile: {
      ...(msg.name ? { name: msg.name } : {}),
      ...(normalizePhone(msg.phone) ? { phone: normalizePhone(msg.phone) as string } : {}),
    },
    direction: 'in',
    senderType: 'customer',
    content: {
      ...(msg.text ? { text: msg.text } : {}),
      ...(attachments ? { attachments } : {}),
    },
    status: 'delivered',
    sentAt: new Date(msg.at),
    raw: msg,
  };
}

/** Номер в общем виде: плюс и цифры, как это принято по E.164. */
export function normalizePhone(raw: string): string | null {
  const digits = (raw ?? '').replace(/[^0-9]/g, '');
  if (digits.length < 9) return null;
  return `+${digits}`;
}
