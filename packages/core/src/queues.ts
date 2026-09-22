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

export interface InboundJob {
  channelId: string;
  tenantId: string;
  provider: 'telegram' | 'meta';
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
  kind?: 'message' | 'reaction';
  reaction?: { targetExternalId: string; emoji: string | null };
  /** Идемпотентность: повторная постановка той же задачи не должна
   *  привести ко второй отправке. */
  idempotencyKey: string;
}

export interface CrmSyncJob {
  tenantId: string;
  conversationId: string;
  action: 'resolve_contact' | 'write_note' | 'raise_signal';
}

export interface MediaJob {
  tenantId: string;
  channelId: string;
  messageId: string;
  attachmentIndex: number;
  provider: 'telegram' | 'meta';
  externalId: string;
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
