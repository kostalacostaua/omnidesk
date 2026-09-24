import {
  messageEventKey,
  parseWorkHours,
  recordEvent,
  withSystem,
  withTenant,
  workedSeconds,
  type Pool,
  type WorkHours,
} from '@omnidesk/core';

/**
 * Восстановление ленты событий по старой переписке.
 *
 * Лента появилась вчера, а переписка — полгода назад. Отчёт, который
 * начинается с пустого места, человек читает не как «здесь ещё нет
 * данных», а как «сервис ничего не считает», и второй раз в этот
 * раздел уже не заходит.
 *
 * Восстанавливается ровно то, что сохранилось честно: сообщения, их
 * направление и время, начало диалога, закрытие. Ничего не
 * додумывается: чего в переписке нет, того в отчёте и не будет.
 *
 * Время ожидания считается тем же кодом, что и у живых событий, а не
 * вторым его переписыванием на SQL: два способа посчитать одно и то же
 * расходятся, и расходятся молча.
 *
 * Идёт один раз — отметка в backfills. Ключи повтора у событий те же,
 * что при живой записи, поэтому даже запущенный дважды перенос ничего
 * не удвоит.
 */

const NAME = 'events-from-messages';

/** Сколько сообщений берём за раз. Память важнее скорости. */
const CHUNK = 2000;

interface Log {
  (msg: string, extra?: Record<string, unknown>): void;
}

export async function backfillEvents(pool: Pool, log: Log): Promise<void> {
  const done = await withSystem(pool, 'отметка о переносе', async (db) => {
    const { rows } = await db.query<{ name: string }>(
      `SELECT name FROM backfills WHERE name = $1`,
      [NAME],
    );
    return rows.length > 0;
  });
  if (done) return;

  const tenants = await withSystem(pool, 'список арендаторов для переноса', async (db) => {
    const { rows } = await db.query<{ id: string; work_hours: unknown }>(
      `SELECT id, work_hours FROM tenants`,
    );
    return rows;
  });

  let events = 0;
  const started = Date.now();

  for (const t of tenants) {
    const wh = parseWorkHours(t.work_hours);
    events += await backfillTenant(pool, t.id, wh);
  }

  await withSystem(pool, 'отметка о переносе', async (db) => {
    await db.query(
      `INSERT INTO backfills (name, note) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING`,
      [NAME, `событий: ${events}`],
    );
  });

  log('Лента событий восстановлена по старой переписке', {
    events,
    tenants: tenants.length,
    seconds: Math.round((Date.now() - started) / 1000),
  });
}

async function backfillTenant(pool: Pool, tenantId: string, wh: WorkHours): Promise<number> {
  let written = 0;

  /*
   * Начало диалога берём по первому сообщению, а не по created_at:
   * created_at — это когда строку завели, а спрашивают, когда клиент
   * обратился. У перенесённых диалогов это разные дни.
   */
  written += await withTenant(pool, tenantId, async (db) => {
    const { rows } = await db.query<{
      id: string;
      channel_id: string;
      at: Date;
      resolved_at: Date | null;
    }>(
      `SELECT c.id, c.channel_id,
              COALESCE((SELECT min(m.sent_at) FROM messages m WHERE m.conversation_id = c.id),
                       c.created_at) AS at,
              c.resolved_at
         FROM conversations c`,
    );

    let n = 0;
    for (const c of rows) {
      await recordEvent(db, tenantId, {
        type: 'conversation.new',
        conversationId: c.id,
        channelId: c.channel_id,
        at: c.at,
        dedupeKey: 'conversation.new:' + c.id,
      });
      n++;

      // Закрытие: только факт и дата, без того, кто закрыл. Этого в
      // старых данных нет, и придумывать автора отчёту нельзя.
      if (c.resolved_at) {
        await recordEvent(db, tenantId, {
          type: 'status',
          conversationId: c.id,
          channelId: c.channel_id,
          at: c.resolved_at,
          dedupeKey: 'status.resolved:' + c.id,
          payload: { status: 'resolved', resolved: true, backfill: true },
        });
        n++;
      }
    }
    return n;
  });

  // Сообщения — порциями: переписка за полгода в память целиком не
  // нужна, а порция в две тысячи строк не держит соединение надолго.
  let offset = 0;
  for (;;) {
    const chunk = await withTenant(pool, tenantId, async (db) => {
      const { rows } = await db.query<{
        id: string;
        conversation_id: string;
        channel_id: string;
        direction: string;
        sender_type: string;
        sender_user_id: string | null;
        sent_at: Date;
        since: Date | null;
      }>(
        `WITH m AS (
           SELECT id, conversation_id, channel_id, direction, sender_type,
                  sender_user_id, sent_at,
                  max(CASE WHEN direction = 'out' AND sender_type <> 'bot' THEN sent_at END)
                    OVER (PARTITION BY conversation_id ORDER BY sent_at, id
                          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prev_out
             FROM messages
         )
         SELECT m.id, m.conversation_id, m.channel_id, m.direction, m.sender_type,
                m.sender_user_id, m.sent_at, w.since
           FROM m
           LEFT JOIN LATERAL (
             -- Начало ожидания: первое сообщение клиента после нашего
             -- прошлого человеческого ответа. Именно первое — клиент
             -- ждал с него, а не с последнего в очереди.
             SELECT min(i.sent_at) AS since
               FROM messages i
              WHERE i.conversation_id = m.conversation_id
                AND i.direction = 'in'
                AND i.sent_at < m.sent_at
                AND i.sent_at > COALESCE(m.prev_out, '-infinity'::timestamptz)
           ) w ON m.direction = 'out' AND m.sender_type <> 'bot'
          ORDER BY m.sent_at, m.id
          LIMIT ${CHUNK} OFFSET ${offset}`,
      );
      return rows;
    });

    if (!chunk.length) break;
    offset += chunk.length;

    written += await withTenant(pool, tenantId, async (db) => {
      let n = 0;
      for (const m of chunk) {
        const out = m.direction !== 'in';
        await recordEvent(db, tenantId, {
          type: out ? 'message.out' : 'message.in',
          conversationId: m.conversation_id,
          channelId: m.channel_id,
          userId: out ? m.sender_user_id : null,
          at: m.sent_at,
          dedupeKey: messageEventKey(out ? 'message.out' : 'message.in', m.id),
          payload: out ? { by: m.sender_type, backfill: true } : { backfill: true },
        });
        n++;

        if (out && m.sender_type !== 'bot' && m.since) {
          await recordEvent(db, tenantId, {
            type: 'reply',
            conversationId: m.conversation_id,
            channelId: m.channel_id,
            userId: m.sender_user_id,
            at: m.sent_at,
            dedupeKey: messageEventKey('reply', m.id),
            payload: {
              waitSeconds: workedSeconds(m.since, m.sent_at, wh),
              clockSeconds: Math.round((m.sent_at.getTime() - m.since.getTime()) / 1000),
              since: m.since.toISOString(),
              backfill: true,
            },
          });
          n++;
        }
      }
      return n;
    });

    if (chunk.length < CHUNK) break;
  }

  return written;
}
