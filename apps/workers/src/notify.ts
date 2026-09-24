import { Queue, UnrecoverableError, Worker } from 'bullmq';
import webpush from 'web-push';
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import {
  QUEUE_NOTIFY,
  createHttpMailer,
  decryptJson,
  defaultJobOptions,
  escapeHtml,
  isNotifyEvent,
  isWorkTime,
  parseSla,
  parseWorkHours,
  workedSeconds,
  jobKey,
  renderNotify,
  telegramText,
  withSystem,
  withTenant,
  type NotifyEvent,
  type NotifyJob,
  type NotifyPayload,
} from '@omnidesk/core';

/**
 * Оповещения наружу.
 *
 * Зачем это вообще. Инбокс открыт не всегда: ночью, в выходной, в
 * дороге. Клиент написал — и об этом некому узнать. Поэтому событие
 * едет туда, куда человек и так смотрит: в группу Telegram, пушем в
 * браузер, письмом.
 *
 * Три правила, из которых сделан этот файл.
 *
 * Первое: оповещение никогда не мешает основной работе. Отправка идёт
 * отдельной очередью, и если Telegram отвечает пятисотыми, сообщение
 * клиента всё равно записано и показано оператору.
 *
 * Второе: одно событие — одно оповещение. Событие «клиент ждёт ответа»
 * ищется обходом по кругу, и без отметки об отправке оператор получал
 * бы его каждую минуту, пока не ответит. Отметка ставится ДО постановки
 * задачи: тогда повтор задачи после падения воркера всё ещё доедет, а
 * второй обход уже ничего не поставит.
 *
 * Третье: адресат, который не работает, должен быть виден. У каждого
 * адресата последняя ошибка лежит рядом с ним и показывается в
 * настройках. Молчащий телеграм-бот без этого выглядит как «оповещения
 * не сделали».
 */

export interface NotifyDeps {
  pool: Pool;
  connection: Redis;
  masterKey: Buffer;
  log: (level: string, msg: string, extra?: Record<string, unknown>) => void;
  telegramRoot: string;
  /** Адрес приложения: из него собираются ссылки в оповещениях. */
  appUrl: string;
}

interface TargetRow {
  id: string;
  kind: 'telegram' | 'email' | 'push';
  title: string;
  config: Record<string, unknown>;
  events: string[];
  /** Токен собственного бота адресата. Пусто — берём у канала. */
  credentials_enc: Buffer | null;
}

/** Ключ задачи. Двоеточия в ключе идемпотентности BullMQ не принимает. */
function notifyJobId(tenantId: string, dedupKey: string): string {
  return jobKey('nt', tenantId, dedupKey.replace(/[:]/g, '--'));
}

export function createNotifier(deps: NotifyDeps) {
  const { pool, connection, masterKey, log, telegramRoot, appUrl } = deps;

  const queue = new Queue<NotifyJob>(QUEUE_NOTIFY, {
    connection,
    defaultJobOptions: { ...defaultJobOptions, attempts: 3 },
  });

  const mailer = createHttpMailer(
    {
      RESEND_API_KEY: process.env['RESEND_API_KEY'],
      MAIL_FROM: process.env['MAIL_FROM'],
      RESEND_API_ROOT: process.env['RESEND_API_ROOT'],
    },
    (line) => log('info', line),
  );

  // Ключи VAPID — это подпись, которой пуш-сервис браузера убеждается,
  // что отправитель тот же, кому человек разрешил присылать. Нет
  // ключей — пуш не работает, и об этом надо сказать словами, а не
  // молча ничего не отправлять.
  const vapidPublic = process.env['VAPID_PUBLIC_KEY'] ?? '';
  const vapidPrivate = process.env['VAPID_PRIVATE_KEY'] ?? '';
  const vapidSubject = process.env['VAPID_SUBJECT'] ?? 'mailto:support@rozmovio.com';
  const pushReady = Boolean(vapidPublic && vapidPrivate);
  if (pushReady) webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  /**
   * Поставить оповещение в очередь.
   *
   * Отметка об отправке ставится здесь же: если её поставил другой
   * обход или другой воркер, задача не создаётся вовсе.
   */
  async function notify(
    tenantId: string,
    event: NotifyEvent,
    payload: NotifyPayload,
    dedup: string,
  ): Promise<boolean> {
    const fresh = await withTenant(pool, tenantId, async (db) => {
      const { rowCount } = await db.query(
        `INSERT INTO notify_sent (tenant_id, dedup_key) VALUES ($1, $2)
         ON CONFLICT (tenant_id, dedup_key) DO NOTHING`,
        [tenantId, dedup],
      );
      return (rowCount ?? 0) > 0;
    });
    if (!fresh) return false;

    await queue.add(
      'notify',
      { tenantId, event, payload, dedupKey: dedup },
      { jobId: notifyJobId(tenantId, dedup) },
    );
    return true;
  }

  /** Проверка адресата из настроек: мимо подписки и мимо отметок. */
  async function notifyTest(tenantId: string, targetId: string): Promise<void> {
    await queue.add('test', {
      tenantId,
      event: 'conversation.new',
      payload: {
        who: 'Перевірка',
        text: 'Це тестове оповіщення від Rozmovio. Якщо ви його бачите — адресат працює.',
        channel: null,
      },
      dedupKey: `test:${targetId}:${Date.now()}`,
      targetId,
    }, { jobId: notifyJobId(tenantId, `test--${targetId}--${Date.now()}`) });
  }

  async function targetsFor(
    tenantId: string,
    event: string,
    onlyId?: string,
  ): Promise<TargetRow[]> {
    return withTenant(pool, tenantId, async (db) => {
      const { rows } = await db.query<TargetRow>(
        `SELECT id, kind, title, config, events, credentials_enc FROM notify_targets
          WHERE tenant_id = $1 AND is_active = true
            AND ($2::uuid IS NULL OR id = $2::uuid)
            AND ($2::uuid IS NOT NULL OR $3 = ANY (events))`,
        [tenantId, onlyId ?? null, event],
      );
      return rows;
    });
  }

  async function markTarget(
    tenantId: string,
    targetId: string,
    failure: { reason: string; detail: string } | null,
  ): Promise<void> {
    await withTenant(pool, tenantId, async (db) => {
      await db.query(
        failure
          ? `UPDATE notify_targets SET last_error = $2::jsonb WHERE id = $1`
          : `UPDATE notify_targets SET last_error = NULL, last_sent_at = now() WHERE id = $1`,
        failure ? [targetId, JSON.stringify(failure)] : [targetId],
      );
    });
  }

  /**
   * Отправка в группу Telegram.
   *
   * Бот бывает двух видов. Если у компании уже подключён канал-бот,
   * адресат ссылается на него и своего токена не хранит: второй
   * экземпляр секрета — второе место, откуда он может утечь. Если
   * канала-бота нет — а его чаще нет, клиенты пишут в Instagram и на
   * номер, — у адресата свой токен, зашифрованный ключом компании.
   */
  async function sendTelegram(
    tenantId: string,
    target: TargetRow,
    text: string,
  ): Promise<void> {
    const config = target.config;
    const chatId = String(config['chatId'] ?? '');
    if (!chatId) throw new UnrecoverableError('Не вказано групу');

    // Свой бот адресата, если он есть; иначе — бот подключённого
    // канала. Второй путь остаётся ради тех, у кого канал уже заведён:
    // лишний токен в базе — лишнее место, откуда он может утечь.
    const token = target.credentials_enc
      ? decryptJson<{ token: string }>(masterKey, tenantId, target.credentials_enc).token
      : await withTenant(pool, tenantId, async (db) => {
          const channelId = String(config['channelId'] ?? '');
          if (!channelId) return null;
          const { rows } = await db.query<{ credentials_enc: Buffer }>(
            `SELECT credentials_enc FROM channels
              WHERE id = $1 AND type IN ('telegram_bot', 'telegram_business') LIMIT 1`,
            [channelId],
          );
          const enc = rows[0]?.credentials_enc;
          if (!enc) return null;
          return decryptJson<{ token: string }>(masterKey, tenantId, enc).token;
        });
    if (!token) throw new UnrecoverableError('Бот для оповіщень не знайдений');

    const res = await fetch(`${telegramRoot}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { description?: string };
      const detail = body.description ?? `Telegram відповів ${res.status}`;
      // 400 «chat not found» и 403 «bot was kicked» повторять
      // бессмысленно: нужно исправить настройку, а не подождать.
      if (res.status === 400 || res.status === 403) throw new UnrecoverableError(detail);
      throw new Error(detail);
    }
  }

  async function sendEmail(
    config: Record<string, unknown>,
    subject: string,
    body: string,
    link: string,
  ): Promise<void> {
    const list = String(config['to'] ?? '')
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter((s) => s.includes('@'));
    if (!list.length) throw new UnrecoverableError('Не вказано адресу пошти');

    const html =
      `<p style="font:15px -apple-system,Segoe UI,Roboto,sans-serif"><b>${escapeHtml(subject)}</b><br>` +
      `${escapeHtml(body)}</p>` +
      (link
        ? `<p style="font:14px -apple-system,Segoe UI,Roboto,sans-serif"><a href="${link}">Відкрити у Rozmovio</a></p>`
        : '');

    for (const to of list) {
      await mailer.send({
        to,
        subject: `Rozmovio: ${subject}`,
        text: [subject, body, link].filter(Boolean).join('\n'),
        html,
      });
    }
  }

  /**
   * Пуш в браузер.
   *
   * Подписок у компании много — по одной на каждый браузер, где человек
   * разрешил уведомления. Отвалившиеся (404 и 410 от пуш-сервиса)
   * удаляем сразу: это не ошибка отправки, а закрытый навсегда адрес,
   * и держать его означает получать ту же ошибку каждый раз.
   */
  async function sendPush(
    tenantId: string,
    title: string,
    body: string,
    link: string,
  ): Promise<void> {
    if (!pushReady) {
      throw new UnrecoverableError('Пуш не налаштований на сервері: немає ключів VAPID');
    }

    const subs = await withTenant(pool, tenantId, async (db) => {
      const { rows } = await db.query<{ id: string; endpoint: string; p256dh: string; auth: string }>(
        `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE tenant_id = $1`,
        [tenantId],
      );
      return rows;
    });
    if (!subs.length) throw new UnrecoverableError('Ніхто не підписався на пуш');

    const payload = JSON.stringify({ title, body, link });
    const dead: string[] = [];
    let sent = 0;
    let lastError = '';

    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          { TTL: 3600 },
        );
        sent += 1;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) dead.push(sub.id);
        else lastError = err instanceof Error ? err.message : String(err);
      }
    }

    if (dead.length) {
      await withTenant(pool, tenantId, async (db) => {
        await db.query(`DELETE FROM push_subscriptions WHERE id = ANY ($1::uuid[])`, [dead]);
      });
    }

    if (!sent) throw new Error(lastError || 'Жодна підписка не прийняла пуш');
  }

  async function handle(job: NotifyJob): Promise<void> {
    if (!isNotifyEvent(job.event)) throw new UnrecoverableError(`Невідома подія: ${job.event}`);

    const targets = await targetsFor(job.tenantId, job.event, job.targetId);
    if (!targets.length) return;

    const message = renderNotify(job.event, job.payload);
    const link = message.path ? `${appUrl.replace(/\/+$/, '')}${message.path}` : '';
    const failures: string[] = [];

    for (const target of targets) {
      try {
        if (target.kind === 'telegram') {
          await sendTelegram(job.tenantId, target, telegramText(message, appUrl));
        } else if (target.kind === 'email') {
          await sendEmail(target.config, message.title, message.body, link);
        } else {
          await sendPush(job.tenantId, message.title, message.body, link);
        }
        await markTarget(job.tenantId, target.id, null);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        await markTarget(job.tenantId, target.id, { reason: target.kind, detail: detail.slice(0, 300) });
        log('warn', 'Оповещение не доставлено', {
          tenantId: job.tenantId, targetId: target.id, kind: target.kind, detail,
        });
        // Неисправимое (неверная группа, нет адреса) не роняет задачу:
        // остальные адресаты своё получить обязаны.
        if (!(err instanceof UnrecoverableError)) failures.push(detail);
      }
    }

    if (failures.length) throw new Error(failures[0]);
  }

  const worker = new Worker<NotifyJob>(QUEUE_NOTIFY, async (job) => handle(job.data), {
    connection,
    concurrency: 4,
  });

  worker.on('failed', (job, err) => {
    log('error', 'Задача оповещения упала', { jobId: job?.id, error: err.message });
  });

  /**
   * Обход «клиент ждёт ответа».
   *
   * Ищем диалоги, где последнее сообщение — от клиента, и оно старше
   * порога. Порог задаёт компания; ноль означает «не искать».
   *
   * Отметка об отправке привязана к сообщению, а не к диалогу: клиент
   * написал, дождался ответа, потом написал снова — это второе
   * ожидание, и о нём нужно сказать.
   */
  async function waitingTick(): Promise<void> {
    const tenants = await withSystem(pool, 'пороги оповещений', async (db) => {
      const { rows } = await db.query<{
        id: string;
        waiting_alert_minutes: number;
        work_hours: unknown;
        sla: unknown;
      }>(
        `SELECT id, waiting_alert_minutes, work_hours, sla
           FROM tenants WHERE waiting_alert_minutes > 0 OR sla <> '{}'::jsonb`,
      );
      return rows;
    });

    for (const tenant of tenants) {
      const sla = parseSla(tenant.sla);

      /*
       * Есть обещание — предупреждаем по нему, а простой порог молчит.
       *
       * Два числа про одно и то же («через сколько напомнить» и «за
       * сколько обещали ответить») означают два оповещения об одном
       * диалоге с разницей в минуту. Человек выключает оба.
       */
      if (sla.firstReplyMinutes > 0) {
        await slaWarnTick(tenant.id, parseWorkHours(tenant.work_hours), sla.firstReplyMinutes);
        continue;
      }
      if (tenant.waiting_alert_minutes <= 0) continue;
      /*
       * Вне рабочих часов не беспокоим.
       *
       * Оповещение «клиент ждёт двадцать минут» в три ночи будит
       * человека ради того, на что всё равно никто не ответит. После
       * второй такой ночи оповещения выключают целиком — и тогда они не
       * сработают уже и днём, когда были бы к месту.
       *
       * Диалог при этом никуда не девается: утром он всё так же ждёт,
       * и оповещение придёт с первой же проверкой в рабочее время.
       */
      if (!isWorkTime(parseWorkHours(tenant.work_hours))) continue;

      const rows = await withTenant(pool, tenant.id, async (db) => {
        const { rows } = await db.query<{
          conversation_id: string;
          message_id: string;
          text: string | null;
          contact: string | null;
          channel_type: string;
          minutes: number;
        }>(
          `SELECT c.id AS conversation_id, m.id AS message_id,
                  m.content->>'text' AS text,
                  ct.display_name AS contact, ch.type AS channel_type,
                  floor(extract(epoch FROM now() - m.sent_at) / 60)::int AS minutes
             FROM conversations c
             JOIN channels ch ON ch.id = c.channel_id
             JOIN contacts ct ON ct.id = c.contact_id
             JOIN LATERAL (
               SELECT id, direction, content, sent_at FROM messages
                 WHERE conversation_id = c.id
                 ORDER BY sent_at DESC LIMIT 1
             ) m ON true
            WHERE c.status = 'open'
              AND m.direction = 'in'
              AND m.sent_at < now() - make_interval(mins => $1::int)
              AND m.sent_at > now() - interval '2 days'
            LIMIT 50`,
          [tenant.waiting_alert_minutes],
        );
        return rows;
      });

      for (const row of rows) {
        await notify(
          tenant.id,
          'message.waiting',
          {
            who: row.contact,
            text: row.text,
            channel: row.channel_type,
            conversationId: row.conversation_id,
            waitingMinutes: row.minutes,
          },
          `message.waiting:${row.message_id}`,
        );
      }
    }
  }

  /**
   * Предупреждение до нарушения обещания.
   *
   * Смысл — успеть. Узнать о просрочке из отчёта через неделю можно, но
   * сделать с этим уже ничего нельзя: клиент ушёл. Поэтому оповещение
   * приходит, когда срок ещё идёт, и говорит, сколько осталось.
   *
   * Порог — четыре пятых обещанного. Не половина: на половине ещё рано,
   * и оповещение станет фоновым шумом, от которого отписываются. Не в
   * последнюю минуту: за минуту человек не успеет ни прочитать, ни
   * ответить.
   *
   * Считается в рабочих часах — тех же, что в отчёте. Написанное в
   * пятницу вечером не будит в выходные и не приходит в понедельник с
   * числом «ждёт три тысячи минут»: по рабочим часам он ждёт первую
   * минуту понедельника.
   */
  const SLA_WARN_SHARE = 0.8;

  async function slaWarnTick(
    tenantId: string,
    wh: ReturnType<typeof parseWorkHours>,
    targetMinutes: number,
  ): Promise<void> {
    // Вне рабочих часов не беспокоим и не считаем: срок в это время не
    // идёт, и предупреждать не о чем.
    if (!isWorkTime(wh)) return;

    const warnSeconds = Math.round(targetMinutes * 60 * SLA_WARN_SHARE);

    const rows = await withTenant(pool, tenantId, async (db) => {
      const { rows } = await db.query<{
        conversation_id: string;
        message_id: string;
        text: string | null;
        contact: string | null;
        channel_type: string;
        since: Date;
      }>(
        /*
         * Кандидаты отбираются по календарю: рабочее время никогда не
         * больше календарного, поэтому всё, что ждёт меньше порога по
         * часам, точно не ждёт его по рабочим часам. Точный счёт —
         * дальше, в коде, тем же способом, что и в отчёте.
         */
        `SELECT c.id AS conversation_id, w.id AS message_id,
                w.content->>'text' AS text,
                ct.display_name AS contact, ch.type AS channel_type,
                w.sent_at AS since
           FROM conversations c
           JOIN channels ch ON ch.id = c.channel_id
           JOIN contacts ct ON ct.id = c.contact_id
           JOIN LATERAL (
             SELECT id, direction FROM messages
              WHERE conversation_id = c.id ORDER BY sent_at DESC LIMIT 1
           ) last ON true
           JOIN LATERAL (
             -- Первое сообщение клиента после нашего последнего
             -- человеческого ответа: ждёт он с него, а не с последнего.
             SELECT id, content, sent_at FROM messages i
              WHERE i.conversation_id = c.id AND i.direction = 'in'
                AND i.sent_at > COALESCE((SELECT max(o.sent_at) FROM messages o
                                           WHERE o.conversation_id = c.id
                                             AND o.direction = 'out'
                                             AND o.sender_type <> 'bot'),
                                         '-infinity'::timestamptz)
              ORDER BY i.sent_at LIMIT 1
           ) w ON true
          WHERE c.status = 'open'
            AND last.direction = 'in'
            AND w.sent_at < now() - make_interval(secs => $1::int)
            AND w.sent_at > now() - interval '14 days'
          LIMIT 50`,
        [warnSeconds],
      );
      return rows;
    });

    const now = new Date();
    for (const row of rows) {
      const waited = workedSeconds(row.since, now, wh);
      if (waited < warnSeconds) continue;

      await notify(
        tenantId,
        'sla.warning',
        {
          who: row.contact,
          text: row.text,
          channel: row.channel_type,
          conversationId: row.conversation_id,
          waitingMinutes: Math.round(waited / 60),
          slaLeftMinutes: Math.round((targetMinutes * 60 - waited) / 60),
        },
        // Ключ по сообщению: одно предупреждение на одно ожидание, а не
        // каждые полминуты до самого ответа.
        `sla.warning:${row.message_id}`,
      );
    }
  }

  /** Отметки старше недели больше ничего не защищают — чистим. */
  async function cleanupTick(): Promise<void> {
    await withSystem(pool, 'чистка отметок оповещений', async (db) => {
      await db.query(`DELETE FROM notify_sent WHERE sent_at < now() - interval '7 days'`);
    });
  }

  return { queue, worker, notify, notifyTest, waitingTick, cleanupTick, pushReady };
}

export type Notifier = ReturnType<typeof createNotifier>;
