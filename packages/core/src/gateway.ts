import type { ChannelType, UnifiedMessage } from './types.js';

/**
 * WhatsApp через шлюз.
 *
 * Это не официальный Cloud API, а посредник, который держит у себя
 * сессию WhatsApp Web: клиент подключает свой обычный номер, отсканировав
 * QR телефоном, и дальше шлюз отдаёт нам входящие вебхуком и принимает
 * исходящие обычным HTTP.
 *
 * Зачем он нужен рядом с официальным. Официальный API требует, чтобы у
 * компании был Business Manager, пройденная верификация и номер, не
 * привязанный к обычному WhatsApp. Половина малого бизнеса живёт на
 * номере, на котором уже переписывается годами, и переносить его не
 * будет. Для них это единственный способ увидеть свои чаты в общей
 * скриньке.
 *
 * Чем за это платят — честно. Со стороны WhatsApp это нарушение их
 * условий: сессию держит не телефон, а сервер посредника. Номер могут
 * заблокировать, и восстановить его будет нечем. Поэтому канал
 * помечается в интерфейсе как «сірий», предупреждение показывается до
 * подключения, а не после, и официальный канал остаётся первым в
 * списке.
 *
 * Поставщик первый — Green API: у него открытая документация, оплата
 * по номеру инстанса и вебхук с токеном в заголовке. Разбор их формата
 * живёт в одном месте — readGreen, — поэтому второй поставщик это
 * вторая такая же функция, а не правка всего канала.
 */

export const WHATSAPP_USER_CHANNEL: ChannelType = 'whatsapp_user';

/** Доступ к одному инстансу шлюза. Приходит из кабинета поставщика. */
export interface GatewayCreds {
  /** Номер инстанса у поставщика. Он же наш external_id канала. */
  idInstance: string;
  /** Ключ инстанса. */
  apiToken: string;
  /**
   * Адрес, по которому живёт этот инстанс. Поставщик возвращает его при
   * создании и вправе посадить инстанс на другой хост — свой для
   * каждого региона. Запомнить его дешевле, чем однажды получить
   * «инстанс не найден» на половине клиентов.
   */
  apiUrl?: string;
}

/** Доступ партнёра: один на весь сервис, живёт в переменных окружения. */
export interface PartnerCreds {
  token: string;
  apiUrl?: string;
}

/** Состояние подключения номера. */
export type GatewayState = 'authorized' | 'waiting_qr' | 'blocked' | 'starting' | 'unknown';

/** Сообщение шлюза в нашем виде — до превращения в UnifiedMessage. */
export interface GatewayMessage {
  id: string;
  /** Идентификатор чата у поставщика: 380671234567@c.us. */
  chatId: string;
  name?: string | null;
  text?: string | null;
  fileUrl?: string | null;
  fileName?: string | null;
  mime?: string | null;
  /** true — написал клиент, false — отправлено с телефона самим владельцем. */
  incoming: boolean;
  at: string;
}

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

const GREEN_ROOT = 'https://api.green-api.com';

/** Номер инстанса и ключ на вид: опечатка не должна уходить в сеть. */
export function gatewayCredsOk(creds: Partial<GatewayCreds>): boolean {
  return /^[0-9]{6,20}$/.test(String(creds.idInstance ?? '')) &&
    /^[A-Za-z0-9]{20,120}$/.test(String(creds.apiToken ?? ''));
}

/**
 * Вызов метода поставщика.
 *
 * Ключ у них идёт частью адреса, а не заголовком, — это их формат, и
 * выбора нет. Поэтому адрес нигде не пишется в журнал целиком: в логах
 * остаётся только имя метода.
 */
async function green(
  creds: GatewayCreds,
  method: string,
  body?: Record<string, unknown>,
  doFetch?: FetchLike,
): Promise<unknown> {
  const fetchImpl = doFetch ?? (globalThis.fetch as unknown as FetchLike);
  const root = String(creds.apiUrl || GREEN_ROOT).replace(/[/]+$/, '');
  const url = `${root}/waInstance${creds.idInstance}/${method}/${creds.apiToken}`;

  let res;
  try {
    res = await fetchImpl(url, {
      method: body ? 'POST' : 'GET',
      ...(body
        ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
        : {}),
    });
  } catch {
    throw new GatewayError('Шлюз не відповідає', 'network');
  }

  if (res.status === 401 || res.status === 403) {
    throw new GatewayError('Ключ інстансу не підійшов', 'bad_key');
  }
  if (res.status === 429) {
    throw new GatewayError('Забагато запитів до шлюзу — спробуйте за хвилину', 'rate');
  }
  if (!res.ok) {
    throw new GatewayError(`Шлюз відповів помилкою (${res.status})`, 'refused');
  }

  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Создание инстанса от нашего имени.
 *
 * Это и есть разница между «подключить за минуту» и «сначала заведите
 * себе аккаунт у поставщика». Раньше человек шёл регистрироваться,
 * создавал инстанс, копировал два ключа и вставлял их к нам —
 * половина на этом месте закрывала вкладку, и правильно делала.
 *
 * Теперь инстанс заводим мы на своём партнёрском счету, вебхук ставим
 * сразу при создании, и клиенту остаётся одно действие — навести
 * телефон на QR. Платим за инстанс тоже мы, это часть тарифа.
 */
export async function partnerCreate(
  partner: PartnerCreds,
  opts: { name?: string; hookUrl: string; hookToken: string; fetchImpl?: FetchLike },
): Promise<GatewayCreds> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const root = String(partner.apiUrl || GREEN_ROOT).replace(/[/]+$/, '');

  let res;
  try {
    res = await fetchImpl(`${root}/partner/createInstance/${partner.token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...(opts.name ? { name: opts.name } : {}),
        webhookUrl: opts.hookUrl,
        webhookUrlToken: opts.hookToken,
        incomingWebhook: 'yes',
        outgoingWebhook: 'yes',
        stateWebhook: 'yes',
        markIncomingMessagesReaded: 'no',
      }),
    });
  } catch {
    throw new GatewayError('Шлюз не відповідає', 'network');
  }

  if (res.status === 401 || res.status === 403) {
    throw new GatewayError('Партнерський ключ шлюза не підійшов', 'bad_partner_key');
  }
  if (!res.ok) throw new GatewayError(`Шлюз відповів помилкою (${res.status})`, 'refused');

  const raw = (await res.json()) as {
    idInstance?: number | string;
    apiTokenInstance?: string;
    apiUrl?: string;
  } | null;

  if (!raw?.idInstance || !raw.apiTokenInstance) {
    throw new GatewayError('Шлюз не повернув інстанс', 'no_instance');
  }

  return {
    idInstance: String(raw.idInstance),
    apiToken: String(raw.apiTokenInstance),
    ...(raw.apiUrl ? { apiUrl: String(raw.apiUrl) } : {}),
  };
}

/**
 * Удаление инстанса, созданного нами.
 *
 * Отключённый канал продолжает стоить денег каждые сутки: поставщик
 * считает по инстансам, а не по сообщениям. Забытый инстанс — это
 * счёт, который растёт сам по себе.
 */
export async function partnerDelete(
  partner: PartnerCreds,
  idInstance: string,
  opts: { fetchImpl?: FetchLike } = {},
): Promise<void> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const root = String(partner.apiUrl || GREEN_ROOT).replace(/[/]+$/, '');

  const res = await fetchImpl(`${root}/partner/deleteInstanceAccount/${partner.token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idInstance: Number(idInstance) }),
  });
  if (!res.ok) throw new GatewayError(`Шлюз не видалив інстанс (${res.status})`, 'refused');
}

/**
 * Состояние инстанса.
 *
 * Пять их слов сводим к четырём нашим: интерфейсу важно одно — можно
 * уже писать или ещё нужен телефон. Чужие названия состояний в
 * интерфейс не протекают.
 */
export async function gatewayState(
  creds: GatewayCreds,
  opts: { fetchImpl?: FetchLike } = {},
): Promise<GatewayState> {
  const raw = (await green(creds, 'getStateInstance', undefined, opts.fetchImpl)) as {
    stateInstance?: string;
  } | null;

  switch (String(raw?.stateInstance ?? '')) {
    case 'authorized':
      return 'authorized';
    case 'notAuthorized':
      return 'waiting_qr';
    case 'blocked':
      return 'blocked';
    case 'starting':
      return 'starting';
    default:
      return 'unknown';
  }
}

/**
 * Картинка QR для входа.
 *
 * Отдаётся как base64 без заголовка data:, поэтому заголовок
 * приписываем мы: иначе каждый, кто эту картинку показывает, приписывал
 * бы его сам и однажды ошибся.
 */
export async function gatewayQr(
  creds: GatewayCreds,
  opts: { fetchImpl?: FetchLike } = {},
): Promise<{ ready: boolean; image?: string; message?: string }> {
  const raw = (await green(creds, 'qr', undefined, opts.fetchImpl)) as {
    type?: string;
    message?: string;
  } | null;

  if (raw?.type === 'qrCode' && raw.message) {
    return { ready: true, image: `data:image/png;base64,${raw.message}` };
  }
  // Они же отвечают сюда, когда номер уже подключён или инстанс спит.
  return { ready: false, ...(raw?.message ? { message: String(raw.message) } : {}) };
}

/**
 * Настроить вебхук инстанса на нас.
 *
 * Делаем это мы, а не клиент руками в чужом кабинете: адрес вебхука
 * зависит от номера канала, и человек, который вписывает его сам,
 * ошибается в одном символе и потом полдня не понимает, почему нет
 * входящих.
 *
 * Исходящие сообщения тоже просим: их отправляют с телефона в том же
 * чате, и без них переписка в скриньке выглядит как монолог клиента.
 */
export async function gatewaySetHook(
  creds: GatewayCreds,
  hookUrl: string,
  hookToken: string,
  opts: { fetchImpl?: FetchLike } = {},
): Promise<void> {
  await green(
    creds,
    'setSettings',
    {
      webhookUrl: hookUrl,
      webhookUrlToken: hookToken,
      incomingWebhook: 'yes',
      outgoingMessageWebhook: 'yes',
      outgoingAPIMessageWebhook: 'no',
      stateWebhook: 'yes',
      // Сообщения, которые мы не забрали, поставщик хранит и отдаёт
      // позже. Разумный срок: больше суток копить нечего, переписка
      // уже потеряла смысл.
      markIncomingMessagesReaded: 'no',
    },
    opts.fetchImpl,
  );
}

/** Отключить вебхук: канал отключили, а поставщик продолжал бы стучать. */
export async function gatewayDropHook(
  creds: GatewayCreds,
  opts: { fetchImpl?: FetchLike } = {},
): Promise<void> {
  await green(creds, 'setSettings', { webhookUrl: '', incomingWebhook: 'no' }, opts.fetchImpl);
}

/** Номер телефона в идентификатор чата поставщика и обратно. */
export function phoneToChat(phone: string): string {
  const digits = String(phone ?? '').replace(/[^0-9]/g, '');
  return digits ? `${digits}@c.us` : '';
}

export function chatToPhone(chatId: string): string | null {
  const digits = String(chatId ?? '').split('@')[0]?.replace(/[^0-9]/g, '') ?? '';
  return digits.length >= 9 ? `+${digits}` : null;
}

/**
 * Отправка.
 *
 * Файл уходит ссылкой, а не телом: у поставщика для этого отдельный
 * метод, и он тянет файл сам. Ссылка должна быть открытой — значит,
 * перед отправкой вложение нужно выложить во временный публичный
 * адрес; кто этого не сделал, получит отказ здесь, а не молчание.
 */
export async function gatewaySend(
  creds: GatewayCreds,
  chatId: string,
  content: { text?: string; fileUrl?: string; fileName?: string },
  opts: { fetchImpl?: FetchLike } = {},
): Promise<string> {
  if (!chatId) throw new GatewayError('Немає куди надсилати', 'no_recipient');
  if (!content.text && !content.fileUrl) throw new GatewayError('Немає чого надсилати', 'empty');

  const raw = content.fileUrl
    ? ((await green(
        creds,
        'sendFileByUrl',
        {
          chatId,
          urlFile: content.fileUrl,
          fileName: content.fileName || 'file',
          ...(content.text ? { caption: content.text } : {}),
        },
        opts.fetchImpl,
      )) as { idMessage?: string } | null)
    : ((await green(
        creds,
        'sendMessage',
        { chatId, message: content.text },
        opts.fetchImpl,
      )) as { idMessage?: string } | null);

  const id = raw?.idMessage;
  if (!id) throw new GatewayError('Шлюз не повернув номер повідомлення', 'no_id');
  return String(id);
}

/**
 * Разбор вебхука поставщика.
 *
 * Возвращаем null на всё, что не сообщение: состояния инстанса, отметки
 * о прочтении, звонки. Ошибкой это не считается — поставщик шлёт их в
 * тот же адрес, и падать на каждом было бы способом заполнить журнал.
 *
 * Чужие поля не угадываем: берём ровно то, что у них описано.
 */
export function readGreen(body: unknown): GatewayMessage | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const kind = String(b['typeWebhook'] ?? '');
  if (kind !== 'incomingMessageReceived' && kind !== 'outgoingMessageReceived') return null;

  const id = String(b['idMessage'] ?? '');
  const sender = (b['senderData'] ?? {}) as Record<string, unknown>;
  const chatId = String(sender['chatId'] ?? '');
  if (!id || !chatId) return null;

  // Групповые чаты в скриньку не берём: там переписка многих со многими,
  // и модель «один диалог — один клиент» на них не натягивается.
  if (chatId.endsWith('@g.us')) return null;

  const data = (b['messageData'] ?? {}) as Record<string, unknown>;
  const type = String(data['typeMessage'] ?? '');

  let text: string | null = null;
  let fileUrl: string | null = null;
  let fileName: string | null = null;
  let mime: string | null = null;

  if (type === 'textMessage') {
    const t = (data['textMessageData'] ?? {}) as Record<string, unknown>;
    text = (t['textMessage'] as string) ?? null;
  } else if (type === 'extendedTextMessage') {
    const t = (data['extendedTextMessageData'] ?? {}) as Record<string, unknown>;
    text = (t['text'] as string) ?? null;
  } else if (type === 'imageMessage' || type === 'videoMessage' || type === 'documentMessage' ||
             type === 'audioMessage') {
    const f = (data['fileMessageData'] ?? {}) as Record<string, unknown>;
    fileUrl = (f['downloadUrl'] as string) ?? null;
    fileName = (f['fileName'] as string) ?? null;
    mime = (f['mimeType'] as string) ?? null;
    text = (f['caption'] as string) ?? null;
  } else {
    // Опросы, местоположение, контакты и прочее: показать их нам нечем,
    // а потерять сообщение молча нельзя. Отдаём как текст-заглушку.
    return null;
  }

  if (!text && !fileUrl) return null;

  const stamp = Number(b['timestamp'] ?? 0);
  return {
    id,
    chatId,
    name: (sender['senderName'] as string) || (sender['chatName'] as string) || null,
    text,
    fileUrl,
    fileName,
    mime,
    incoming: kind === 'incomingMessageReceived',
    at: new Date(stamp > 0 ? stamp * 1000 : Date.now()).toISOString(),
  };
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

  const attachments = msg.fileUrl
    ? [
        {
          type: fileKind(msg.mime),
          url: msg.fileUrl,
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
