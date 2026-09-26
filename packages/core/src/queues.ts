import type { UnifiedMessage } from './types.js';

/**
 * Контракт очередей между ingress и воркерами.
 *
 * ingress кладёт в очередь СЫРОЙ payload и не парсит его глубоко: его задача —
 * проверить подпись и вернуть 200 как можно быстрее. Messenger требует ответ
 * за 20 секунд, Meta ретраит до 7 дней при неуспехе.
 */

export const QUEUE_INBOUND = 'inbound';
export const QUEUE_OUTBOUND = 'outbound';
export const QUEUE_MEDIA = 'media';
export const QUEUE_CRM_SYNC = 'crm-sync';
/** Исходящие в номерной Telegram: отправляет сервис sessions, у которого живые MTProto-сессии. */
export const QUEUE_MTPROTO_OUT = 'mtproto-out';
/** Вход в номерной Telegram по QR-коду. */
export const QUEUE_MTPROTO_LOGIN = 'mtproto-login';

/**
 * Продолжение сценария после паузы.
 *
 * Отдельная очередь, а не таймер в памяти: пауза в пятнадцать минут
 * означала бы, что воркер обязан дожить до конца сценария. Перезапуск
 * сервиса — обычное дело, и разговор с клиентом не должен от него
 * зависеть.
 */
export const QUEUE_SCENARIO = 'scenario';

/**
 * Оповещения наружу: группа в Telegram, пуш в браузер, письмо.
 *
 * Отдельная очередь, потому что отправка идёт в чужие сервисы и может
 * встать. Сообщение клиента обязано быть записано и показано оператору
 * независимо от того, ответил ли Telegram на попытку рассказать о нём в
 * группу поддержки.
 */
export const QUEUE_NOTIFY = 'notify';

/** Ключ Redis с состоянием входа по QR. Читает api, пишет sessions. */
export const mtprotoLoginKey = (loginId: string): string => `mtp:login:${loginId}`;
/** Ключ Redis для пароля двухэтапной проверки. Живёт секунды и удаляется после чтения. */
export const mtprotoPasswordKey = (loginId: string): string => `mtp:pw:${loginId}`;

/**
 * Связка контакта с CRM.
 *
 * Отдельная задача, а не часть обработки сообщения: поход в чужой API
 * может занять секунды и упасть, а сообщение клиента обязано быть
 * записано и показано оператору немедленно.
 */
export interface CrmSyncJob {
  tenantId: string;
  contactId: string;
  conversationId: string | null;
  /** Из какого канала пришёл человек — это попадает в источник лида. */
  channelType: string;
  /** Первое сообщение: без него лид выглядит как пустая карточка. */
  firstText?: string;
  /**
   * Зачем пришли. Пусто — прежнее поведение: найти или завести карточку.
   *
   * «owner» — записать карточку на того, кто взял диалог. Отдельной
   * задачей, а не внутри правки диалога: поход в чужой API занимает
   * секунды и падает по чужим причинам, а передача чата должна
   * происходить мгновенно.
   */
  kind?: 'find' | 'owner';
  /** Почта того, кто взял диалог: по ней ищем сотрудника в CRM. */
  ownerEmail?: string | null;
}

/** Задача продолжения сценария: всё состояние лежит в базе, здесь только ключ. */
export interface ScenarioJob {
  tenantId: string;
  runId: string;
  /** Зачем разбудили: истекла пауза или вышло время ожидания ответа. */
  reason: 'delay' | 'timeout';
}

export interface MtprotoLoginJob {
  loginId: string;
  tenantId: string;
  displayName?: string;
}

export interface MtprotoLoginState {
  tenantId: string;
  state: 'starting' | 'qr' | 'password' | 'done' | 'error';
  qrUrl?: string;
  qrExpires?: number;
  passwordHint?: string;
  passwordError?: boolean;
  channelId?: string;
  error?: string;
}

/**
 * Входящее из номерного Telegram.
 *
 * В отличие от вебхуков здесь сообщение уже нормализовано: разобрать
 * объект MTProto может только тот, у кого есть сессия, — это sessions.
 * Вложения тоже уже в хранилище: скачать их можно только через ту же сессию.
 */
export interface MtprotoInboundPayload {
  message: Omit<UnifiedMessage, 'sentAt'> & { sentAt: string };
  /** Ключ аватара в хранилище, если удалось скачать. */
  avatarKey?: string;
}

export interface InboundJob {
  channelId: string;
  tenantId: string;
  provider: 'telegram' | 'meta' | 'mtproto' | 'viber' | 'webchat' | 'custom' | 'resend' | 'gateway';
  /** Сырое тело вебхука как есть. */
  payload: unknown;
  receivedAt: string;
}

export interface OutboundJob {
  tenantId: string;
  channelId: string;
  conversationId: string;
  messageId: string;
  /**
   * Что именно делаем. Реакция ставится на ЧУЖОЕ сообщение, поэтому
   * своего messageId у неё нет — она едет отдельным типом задачи,
   * а не притворяется сообщением.
   */
  kind?: 'message' | 'reaction' | 'read';
  reaction?: { targetExternalId: string; emoji: string | null };
  /**
   * Отметка «прочитано» у провайдера.
   *
   * Оператор ответил в Rozmovio, а в телефоне владельца диалог всё ещё
   * подсвечен непрочитанным — потому что провайдер об этом не знает.
   * Здесь идентификатор последнего входящего у провайдера: Telegram
   * читает историю до него, Meta помечает беседу просмотренной.
   */
  readUpTo?: { externalId: string };
  /** Идемпотентность: повторная постановка той же задачи не должна
   *  привести ко второй отправке. */
  idempotencyKey: string;
}

/**
 * Оповещение о событии.
 *
 * Здесь только само событие и то, о чём оно: текст собирается при
 * отправке (`renderNotify`). Иначе исправление формулировки означало бы,
 * что задачи, уже лежащие в очереди, уедут старым текстом.
 */
export interface NotifyJob {
  tenantId: string;
  event: string;
  payload: {
    who?: string | null;
    text?: string | null;
    channel?: string | null;
    conversationId?: string | null;
    waitingMinutes?: number | null;
    email?: string | null;
    phone?: string | null;
  };
  /** Ключ идемпотентности: одно событие — одно оповещение. */
  dedupKey: string;
  /** Проверка адресата из настроек: уходит мимо подписки на события. */
  targetId?: string;
}

export interface MediaJob {
  tenantId: string;
  channelId: string;
  messageId: string;
  attachmentIndex: number;
  provider: 'telegram' | 'meta' | 'resend';
  externalId: string;
  /**
   * Объект, внутри которого лежит файл: у почты это письмо. Вложение
   * письма нельзя забрать по одному своему идентификатору — ссылку на
   * него выдают только вместе с письмом.
   */
  sourceId?: string;
  /**
   * Аватар едет через ту же очередь, что и вложения.
   *
   * Задача одна и та же: сходить в API канала, скачать файл, положить
   * в хранилище. Отдельная очередь означала бы второй воркер, второй
   * лимитер и второй набор ретраев ради того же самого кода. При этом
   * приоритет у аватара ниже: сообщение без картинки бесполезно,
   * сообщение без аватара — нет.
   */
  kind?: 'attachment' | 'avatar';
  contactId?: string;
  /** Идентификатор собеседника у провайдера — по нему запрашивается фото. */
  peerId?: string;
}

/**
 * Настройки BullMQ по умолчанию.
 *
 * removeOnComplete обязателен: без него Redis распухает и вы упрётесь
 * в maxmemory через пару недель — с политикой noeviction это означает
 * остановку очередей.
 */
export const defaultJobOptions = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 2_000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};


/**
 * Сборка идентификатора задачи.
 *
 * BullMQ запрещает двоеточие в jobId — это его внутренний разделитель
 * ключей Redis. Проверка при этом с историческим исключением: строка
 * ровно из трёх частей проходит, потому что так выглядели старые
 * повторяющиеся задачи. Исключение помечено в исходниках BullMQ
 * как временное.
 *
 * Из-за этого ошибка ведёт себя особенно подло. «messageId:0» — две
 * части, отклоняется. «react:id:emoji» — три, проходит. То есть часть
 * очередей работает, часть молча не работает, и выглядит это не как
 * общая поломка, а как «вложения почему-то не качаются».
 *
 * Поэтому идентификатор собирается только здесь и только через «--».
 */
export function jobKey(...parts: Array<string | number>): string {
  const key = parts.map((p) => String(p)).join('--');
  if (key.includes(':')) {
    throw new Error(`jobId не может содержать двоеточие: ${key}`);
  }
  return key;
}
