import type { FastifyInstance } from 'fastify';
import { parseSla, withSystem, withTenant, type Pool } from '@omnidesk/core';
import { channelScope } from './scope.js';

/**
 * Отчёты.
 *
 * Считаются по ленте событий, а не по текущему состоянию диалогов, и
 * это главное решение здесь. Состояние знает только последнее значение:
 * кто ответственный сейчас, какой статус сейчас. Вопрос же всегда про
 * прошлое — «сколько ждали в июне», «кто сколько закрыл на прошлой
 * неделе», — и по состоянию он либо не отвечается, либо отвечается
 * неправдой: диалог переназначили, и весь июнь задним числом стал
 * заслугой того, кто взял его вчера.
 *
 * Среднее показывается вместе с медианой и девятым децилем не для
 * красоты. Среднее время ответа — величина, которую один забытый на
 * ночь диалог сдвигает вдвое, и человек, глядя на него, делает вывод о
 * смене, которая работала нормально. Медиана говорит про обычный день,
 * девятый дециль — про худшее, что регулярно случается; вместе они
 * говорят правду, по отдельности каждая врёт по-своему.
 */

interface Auth {
  tenantId: string;
  userId: string;
}

export interface AnalyticsDeps {
  pool: Pool;
  requireAuth: (req: unknown) => Auth | null;
}

/** Разбор списка через запятую — тот же, что в списке диалогов. */
function many(v?: string): string[] {
  return String(v ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

const UUID = /^[0-9a-f-]{36}$/i;

/** Границы периода. По умолчанию — последние семь дней. */
function period(q: { from?: string; to?: string }): { from: Date; to: Date } {
  const to = q.to ? new Date(q.to) : new Date();
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 7 * 24 * 3600_000);
  // Мусор в датах не должен превращаться в пустой отчёт без объяснения:
  // непонятную дату заменяем разумной.
  const ok = (d: Date) => !Number.isNaN(d.getTime());
  return {
    from: ok(from) ? from : new Date(Date.now() - 7 * 24 * 3600_000),
    to: ok(to) ? to : new Date(),
  };
}

export function registerAnalytics(app: FastifyInstance, deps: AnalyticsDeps): void {
  const { pool, requireAuth } = deps;
  const auth401 = { error: 'unauthorized' } as const;

  app.get<{
    Querystring: { from?: string; to?: string; channelId?: string; userId?: string };
  }>('/analytics', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const q = req.query ?? {};
    const { from, to } = period(q);
    const channels = many(q.channelId).filter((v) => UUID.test(v));
    const users = many(q.userId).filter((v) => UUID.test(v));

    const params: unknown[] = [auth.userId, from.toISOString(), to.toISOString()];
    const push = (v: unknown) => {
      params.push(v);
      return '$' + params.length;
    };

    const where = [
      `e.at >= $2::timestamptz`,
      `e.at < $3::timestamptz`,
      // Доступ к каналам действует и в отчёте: иначе оператор с одним
      // каналом узнаёт нагрузку всей компании из сводки.
      channelScope('e.channel_id', '$1'),
    ];
    if (channels.length) where.push(`e.channel_id = ANY(${push(channels)}::uuid[])`);
    // Отбор по сотруднику применяется только к тому, что человек делал
    // сам. Входящие сообщения ничьи, и «сколько писем пришло Оле» —
    // вопрос без смысла: клиент пишет в компанию, а не Оле.
    if (users.length) where.push(`(e.user_id = ANY(${push(users)}::uuid[]) OR e.user_id IS NULL)`);

    const sql = where.join(' AND ');
    const wait = `(e.payload->>'waitSeconds')::numeric`;

    // Обещание читается один раз: оно нужно и для подсчёта просрочек,
    // и интерфейсу — показать, с чем сравнивали.
    const sla = await withSystem(pool, 'обещание для отчёта', async (db) => {
      const { rows } = await db.query<{ sla: unknown }>(
        `SELECT sla FROM tenants WHERE id = $1 LIMIT 1`,
        [auth.tenantId],
      );
      return parseSla(rows[0]?.sla);
    });
    const firstTarget = sla.firstReplyMinutes * 60;

    const data = await withTenant(pool, auth.tenantId, async (db) => {
      const { rows: totals } = await db.query(
        `SELECT
           count(*) FILTER (WHERE e.type = 'conversation.new')          AS conversations,
           count(*) FILTER (WHERE e.type = 'message.in')                AS msg_in,
           count(*) FILTER (WHERE e.type = 'message.out')               AS msg_out,
           count(*) FILTER (WHERE e.type = 'reply')                     AS replies,
           count(*) FILTER (WHERE e.type = 'status'
                              AND (e.payload->>'resolved') = 'true')    AS resolved,
           avg(${wait}) FILTER (WHERE e.type = 'reply')                 AS avg_wait,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY ${wait})
             FILTER (WHERE e.type = 'reply')                            AS median_wait,
           percentile_cont(0.9) WITHIN GROUP (ORDER BY ${wait})
             FILTER (WHERE e.type = 'reply')                            AS p90_wait,
           -- Диалогов, в которых вообще ответили: доля от новых
           -- показывает, сколько обращений осталось без ответа вовсе,
           -- а среднее время про них не говорит ничего.
           count(DISTINCT e.conversation_id) FILTER (WHERE e.type = 'reply') AS replied_convs,
           count(*) FILTER (WHERE e.type = 'reply'
                              AND ${wait} <= ${firstTarget})            AS reply_in_time,
           count(*) FILTER (WHERE e.type = 'reply'
                              AND ${wait} > ${firstTarget})             AS reply_late
         FROM events e
         WHERE ${sql}`,
        params,
      );

      const { rows: byChannel } = await db.query(
        `SELECT c.id, c.display_name AS name, c.type,
                count(*) FILTER (WHERE e.type = 'conversation.new') AS conversations,
                count(*) FILTER (WHERE e.type = 'message.in')       AS msg_in,
                count(*) FILTER (WHERE e.type = 'message.out')      AS msg_out,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY ${wait})
                  FILTER (WHERE e.type = 'reply')                   AS median_wait
           FROM events e JOIN channels c ON c.id = e.channel_id
          WHERE ${sql}
          GROUP BY c.id, c.display_name, c.type
          ORDER BY count(*) DESC`,
        params,
      );

      const { rows: byUser } = await db.query(
        `SELECT u.id, coalesce(u.full_name, u.email) AS name,
                count(*) FILTER (WHERE e.type = 'message.out') AS msg_out,
                count(*) FILTER (WHERE e.type = 'reply')       AS replies,
                count(*) FILTER (WHERE e.type = 'status'
                                   AND (e.payload->>'resolved') = 'true') AS resolved,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY ${wait})
                  FILTER (WHERE e.type = 'reply')              AS median_wait
           FROM events e JOIN users u ON u.id = e.user_id
          WHERE ${sql}
          GROUP BY u.id, u.full_name, u.email
          ORDER BY count(*) DESC`,
        params,
      );

      /*
       * По дням — для столбиков. Считается в поясе компании, а не в UTC:
       * иначе у клиента из Киева вечерние обращения попадают в
       * следующий день, и понедельник в отчёте начинается в три часа
       * ночи воскресенья.
       */
      const { rows: byDay } = await db.query(
        `SELECT to_char(date_trunc('day', e.at AT TIME ZONE
                   coalesce(t.work_hours->>'tz', 'UTC')), 'YYYY-MM-DD') AS day,
                count(*) FILTER (WHERE e.type = 'message.in')  AS msg_in,
                count(*) FILTER (WHERE e.type = 'message.out') AS msg_out,
                count(*) FILTER (WHERE e.type = 'conversation.new') AS conversations
           FROM events e CROSS JOIN tenants t
          WHERE t.id = e.tenant_id AND ${sql}
          GROUP BY 1 ORDER BY 1`,
        params,
      );

      /*
       * Время до закрытия — по диалогам, а не по событиям: закрытие
       * одно, а событий у диалога десятки. Берём пару «начался —
       * закрыт» и считаем по календарю: рабочие часы здесь пришлось бы
       * считать в SQL вторым способом, а два способа расходятся молча.
       * В интерфейсе это названо своими словами.
       */
      const { rows: resolveRows } = await db.query(
        `WITH pairs AS (
           SELECT e.conversation_id,
                  min(e.at) FILTER (WHERE e.type = 'conversation.new') AS started,
                  min(e.at) FILTER (WHERE e.type = 'status'
                                      AND (e.payload->>'resolved') = 'true') AS closed
             FROM events e
            WHERE ${sql}
            GROUP BY e.conversation_id
         )
         SELECT count(*) AS n,
                avg(extract(epoch from (closed - started)))    AS avg_resolve,
                percentile_cont(0.5) WITHIN GROUP
                  (ORDER BY extract(epoch from (closed - started))) AS median_resolve
           FROM pairs WHERE started IS NOT NULL AND closed IS NOT NULL AND closed >= started`,
        params,
      );

      return {
        totals: totals[0] ?? {},
        byChannel,
        byUser,
        byDay,
        resolve: resolveRows[0] ?? {},
      };
    });

    const num = (v: unknown) => (v == null ? null : Math.round(Number(v)));

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      sla,
      resolve: {
        count: Number(data.resolve['n'] ?? 0),
        avg: num(data.resolve['avg_resolve']),
        median: num(data.resolve['median_resolve']),
      },
      totals: {
        conversations: Number(data.totals['conversations'] ?? 0),
        messagesIn: Number(data.totals['msg_in'] ?? 0),
        messagesOut: Number(data.totals['msg_out'] ?? 0),
        replies: Number(data.totals['replies'] ?? 0),
        resolved: Number(data.totals['resolved'] ?? 0),
        avgWait: num(data.totals['avg_wait']),
        medianWait: num(data.totals['median_wait']),
        p90Wait: num(data.totals['p90_wait']),
        repliedConversations: Number(data.totals['replied_convs'] ?? 0),
        replyInTime: Number(data.totals['reply_in_time'] ?? 0),
        replyLate: Number(data.totals['reply_late'] ?? 0),
      },
      byChannel: data.byChannel.map((r) => ({
        id: r['id'],
        name: r['name'],
        type: r['type'],
        conversations: Number(r['conversations'] ?? 0),
        messagesIn: Number(r['msg_in'] ?? 0),
        messagesOut: Number(r['msg_out'] ?? 0),
        medianWait: num(r['median_wait']),
      })),
      byUser: data.byUser.map((r) => ({
        id: r['id'],
        name: r['name'],
        messagesOut: Number(r['msg_out'] ?? 0),
        replies: Number(r['replies'] ?? 0),
        resolved: Number(r['resolved'] ?? 0),
        medianWait: num(r['median_wait']),
      })),
      byDay: data.byDay.map((r) => ({
        day: r['day'],
        messagesIn: Number(r['msg_in'] ?? 0),
        messagesOut: Number(r['msg_out'] ?? 0),
        conversations: Number(r['conversations'] ?? 0),
      })),
    };
  });

  /**
   * Просрочки поимённо.
   *
   * Цифра «двенадцать нарушений» не говорит, что делать. Список из
   * двенадцати диалогов с именами и временем — говорит: их открывают и
   * смотрят, что там случилось. Поэтому у отчёта есть дно, а не только
   * итог.
   */
  app.get<{
    Querystring: { from?: string; to?: string; channelId?: string; userId?: string; limit?: string };
  }>('/analytics/breaches', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const q = req.query ?? {};
    const { from, to } = period(q);
    const channels = many(q.channelId).filter((v) => UUID.test(v));
    const users = many(q.userId).filter((v) => UUID.test(v));
    const limit = Math.min(Math.max(Number(q.limit ?? 50) || 50, 1), 200);

    const sla = await withSystem(pool, 'обещание для списка просрочек', async (db) => {
      const { rows } = await db.query<{ sla: unknown }>(
        `SELECT sla FROM tenants WHERE id = $1 LIMIT 1`,
        [auth.tenantId],
      );
      return parseSla(rows[0]?.sla);
    });

    // Без обещания просрочек не бывает: назвать что-то нарушением,
    // когда ничего не обещали, — это придумать обещание за человека.
    if (sla.firstReplyMinutes <= 0) return { breaches: [], sla };

    const params: unknown[] = [auth.userId, from.toISOString(), to.toISOString()];
    const push = (v: unknown) => {
      params.push(v);
      return '$' + params.length;
    };

    const where = [
      `e.type = 'reply'`,
      `e.at >= $2::timestamptz`,
      `e.at < $3::timestamptz`,
      `(e.payload->>'waitSeconds')::numeric > ${sla.firstReplyMinutes * 60}`,
      channelScope('e.channel_id', '$1'),
    ];
    if (channels.length) where.push(`e.channel_id = ANY(${push(channels)}::uuid[])`);
    if (users.length) where.push(`e.user_id = ANY(${push(users)}::uuid[])`);

    const rows = await withTenant(pool, auth.tenantId, async (db) => {
      const { rows } = await db.query(
        `SELECT e.conversation_id, e.at,
                (e.payload->>'waitSeconds')::int AS wait_seconds,
                (e.payload->>'clockSeconds')::int AS clock_seconds,
                ct.display_name, ch.display_name AS channel_name, ch.type AS channel_type,
                coalesce(u.full_name, u.email) AS user_name
           FROM events e
           LEFT JOIN conversations c ON c.id = e.conversation_id
           LEFT JOIN contacts ct ON ct.id = c.contact_id
           LEFT JOIN channels ch ON ch.id = e.channel_id
           LEFT JOIN users u ON u.id = e.user_id
          WHERE ${where.join(' AND ')}
          ORDER BY (e.payload->>'waitSeconds')::int DESC
          LIMIT ${limit}`,
        params,
      );
      return rows;
    });

    return {
      sla,
      breaches: rows.map((r) => ({
        conversationId: r['conversation_id'],
        at: r['at'],
        waitSeconds: Number(r['wait_seconds'] ?? 0),
        clockSeconds: Number(r['clock_seconds'] ?? 0),
        contact: r['display_name'],
        channel: r['channel_name'],
        channelType: r['channel_type'],
        user: r['user_name'],
      })),
    };
  });
}
