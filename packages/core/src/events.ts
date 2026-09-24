import type { TenantClient } from './db.js';

/**
 * Лента событий.
 *
 * Отчёт спрашивает про прошлое, а состояние диалога знает только
 * настоящее: кто ответственный сейчас, какой статус сейчас. Поэтому
 * всё, из чего потом считаются аналитика, SLA и KPI, записывается в
 * момент, когда оно произошло, и больше не меняется.
 *
 * Типов намеренно мало. Каждый новый тип — это обещание, что его будут
 * писать во всех местах, где событие случается; невыполненное обещание
 * даёт отчёт, который врёт тихо. Поэтому здесь только то, что уже
 * нужно отчёту, и ни одного «на будущее».
 */
export const EVENT_TYPES = [
  /** Пришло сообщение от клиента. */
  'message.in',
  /** Ушло сообщение от нас: оператор или бот. */
  'message.out',
  /** Диалог начался: первое сообщение от этого клиента в этом канале. */
  'conversation.new',
  /** Ответственный назначен, сменён или снят. */
  'assign',
  /** Статус диалога изменён — системный или свой. */
  'status',
  /**
   * Клиент дождался ответа человека.
   *
   * Отдельно от message.out, потому что это не то же самое: из десяти
   * исходящих подряд ответом на ожидание был один, первый. Здесь же
   * лежит и само время ожидания — посчитанное, а не выводимое потом.
   */
  'reply',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export interface EventInput {
  type: EventType;
  conversationId?: string | null;
  channelId?: string | null;
  /** Кто сделал. У входящего — никто: там не наш человек. */
  userId?: string | null;
  /** Повторная запись с тем же ключом ничего не делает. */
  dedupeKey?: string | null;
  at?: Date | null;
  payload?: Record<string, unknown>;
}

/**
 * Записать событие.
 *
 * Молча пропускает повтор: очередь доставляет задачу «хотя бы раз», и
 * перезапуск воркера не должен удваивать числа в отчётах.
 *
 * Ошибку записи события глотать нельзя, а ронять из-за неё доставку
 * сообщения — тем более: клиент не должен остаться без ответа потому,
 * что не записалась строка отчёта. Поэтому вызывающий код ловит ошибку
 * сам и пишет её в лог; здесь мы только не делаем вид, что всё хорошо.
 */
export async function recordEvent(
  db: TenantClient,
  tenantId: string,
  e: EventInput,
): Promise<void> {
  await db.query(
    `INSERT INTO events
       (tenant_id, at, type, conversation_id, channel_id, user_id, dedupe_key, payload)
     VALUES ($1, COALESCE($2::timestamptz, now()), $3, $4::uuid, $5::uuid, $6::uuid, $7, $8::jsonb)
     ON CONFLICT DO NOTHING`,
    [
      tenantId,
      e.at ? e.at.toISOString() : null,
      e.type,
      e.conversationId ?? null,
      e.channelId ?? null,
      e.userId ?? null,
      e.dedupeKey ?? null,
      JSON.stringify(e.payload ?? {}),
    ],
  );
}

/**
 * Ключ повтора для события о сообщении.
 *
 * Идентификатор сообщения у нас свой и уже уникален, поэтому ключ —
 * это просто тип и он. Двоеточия в ключе допустимы: в отличие от
 * ключей очереди, это обычная строка в базе.
 */
export function messageEventKey(type: EventType, messageId: string): string {
  return `${type}:${messageId}`;
}
