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
  | 'telegram_business'
  /** Личный аккаунт Telegram по номеру телефона (MTProto, вход по QR). */
  | 'telegram_user'
  /**
   * Viber для бизнеса через партнёра: имя отправителя вместо номера.
   * Личного аккаунта Viber здесь нет и быть не может — открытого
   * протокола у них нет, а обходные библиотеки ведут к блокировке.
   */
  | 'viber_business'
  /**
   * Свой канал: на той стороне код клиента, а не платформа. Он шлёт нам
   * входящие и принимает исходящие — доставка целиком его забота.
   */
  | 'custom'
  /**
   * Чат на сайте клиента. Собеседник — посетитель страницы: у него нет
   * ни номера, ни аккаунта, только идентификатор, выданный нами.
   */
  | 'webchat'
  /**
   * Комментарии под постами страницы Facebook и публикациями Instagram.
   * Отдельно от личных сообщений: ответ здесь видят все, а не один
   * человек, и уходит он под пост, а не в переписку.
   */
  | 'messenger_comments'
  | 'instagram_comments'
  /**
   * Почта. Собеседник пишет с обычного ящика, и у переписки есть тема и
   * цепочка — то, чего нет ни в одном мессенджере.
   */
  | 'email';

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
  /**
   * Комментарий: под каким постом он написан и на какой комментарий
   * отвечает. Лежит здесь, а не в raw, потому что это нужно показать
   * оператору и ответить туда же, а не когда-нибудь при разборе.
   */
  comment?: {
    commentId?: string;
    postId?: string;
    parentId?: string;
    url?: string;
    /** Ответ ушёл в личные, а не под пост. */
    private?: boolean;
  };
  /**
   * Instagram: история и рилс.
   *
   * Ответ на историю приходит обычным сообщением, а упоминание в
   * истории и рилс — обычным вложением. Без пометки оператор видит в
   * ленте «видео» и не понимает, на что ему отвечают: история живёт
   * сутки, и через час её уже не посмотреть.
   */
  ig?: {
    kind: 'story_reply' | 'story_mention' | 'reel' | 'share';
    /** Ссылка на саму историю или рилс, пока она жива. */
    url?: string;
    id?: string;
  };

  /**
   * Письмо: тема и цепочка. Лежит рядом с текстом, потому что нужно и
   * оператору на экране, и при ответе — чтобы он ушёл в ту же цепочку,
   * а не отдельным письмом.
   */
  email?: {
    subject?: string;
    messageId?: string;
    references?: string;
    to?: string[];
    cc?: string[];
  };
}

export interface UnifiedMessage {
  tenantId: string;
  channelId: string;
  channelType: ChannelType;
  /** wamid / mid / message_id провайдера. Ключ дедупликации. */
  externalId: string;
  /** Идентификатор собеседника у провайдера: wa_id / igsid / psid / telegram user id. */
  peerId: string;
  peerProfile: {
    name?: string;
    username?: string;
    phone?: string;
    avatarUrl?: string;
    /** MTProto: без access_hash написать пользователю нельзя. */
    accessHash?: string;
    /**
     * Почта собеседника. Отдельно от username: по ней ищут клиента в
     * CRM, и складывать туда «ник, который выглядит как адрес» —
     * значит однажды отправить письмо в никуда.
     */
    email?: string;
  };
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

    // Viber считает разговор сессией: клиент написал — сутки на ответ.
    // То же правило, что у Instagram и Messenger, только без тега.
    case 'viber_business':
      return { type: 'standard', expiresAt: new Date(t + 24 * HOUR) };

    // В чате на сайте окон нет: это наш собственный канал, и никакой
    // чужой платформы, которая ограничивала бы ответ, здесь не стоит.
    // В своём канале окно тоже не наше дело: если платформа на той
    // стороне что-то ограничивает, знает об этом клиент, а не мы.
    // Комментарий можно написать под постом когда угодно: окна там нет.
    // Семь дней на приватный ответ — правило не этого окна, а одной
    // кнопки, и живут они в том месте, где кнопка.
    case 'messenger_comments':
    case 'instagram_comments':
    // У почты окон нет и быть не может: это не чужая площадка с
    // правилами, а протокол, которому тридцать лет.
    case 'email':
    case 'webchat':
    case 'custom':
    case 'telegram_bot':
    case 'telegram_user':
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
      // После 24 часов живой оператор может ответить ещё 6 дней с тегом
      // HUMAN_AGENT: тег ставит воркер при отправке. Дальше — только
      // когда клиент напишет сам.
      if (window.expiresAt && now.getTime() < window.expiresAt.getTime() + 6 * 24 * HOUR) {
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: 'Клиент не писал больше 7 дней. Meta разрешит ответить, когда он напишет снова.',
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

/**
 * Нужен ли тег HUMAN_AGENT для ответа в Messenger / Instagram.
 * Внутри 24 часов тег не нужен, после — обязателен, иначе Meta отказывает.
 */
export function needsHumanAgentTag(windowExpiresAt: Date | null, now: Date = new Date()): boolean {
  return windowExpiresAt !== null && now.getTime() >= windowExpiresAt.getTime();
}
