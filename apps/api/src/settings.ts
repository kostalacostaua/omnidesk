import { channelListScope, folderScope } from './scope.js';
import type { FastifyInstance } from 'fastify';
import { createHmac, randomUUID } from 'node:crypto';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import QRCode from 'qrcode';
import {
  GRAPH_VERSION,
  VIBER_CHANNEL,
  ViberError,
  viberSenders,
  META_LOGIN_SCOPES,
  COMMENT_SUBSCRIBED_FIELDS,
  PAGE_SUBSCRIBED_FIELDS,
  MetaApiError,
  decryptJson,
  graphGet,
  parseTemplates,
  folderNames,
  groupByFolder,
  replyFolder,
  canSendWhatsapp,
  wabaFromDebug,
  type DebugTokenReply,
  CUSTOM_CHANNEL,
  ResendError,
  isPublicMailDomain,
  dnsRows,
  domainReady,
  resendCreateDomain,
  resendFindDomain,
  resendGetDomain,
  resendVerifyDomain,
  newCustomKey,
  newCustomSecret,
  WEBCHAT_CHANNEL,
  WEBCHAT_DEFAULTS,
  embedSnippet,
  iframeSnippet,
  normalizeDomain,
  parseRouting,
  parseKpi,
  parseSla,
  parseWorkHours,
  ROUTING_DEFAULT,
  webchatSettings,
  graphPost,
  safeEqual,
  telegramForwardSecret,
  mtprotoLoginKey,
  mtprotoPasswordKey,
  type MtprotoLoginJob,
  type MtprotoLoginState,
  encryptJson,
  maskSecret,
  withSystem,
  withTenant,
  type Pool,
} from '@omnidesk/core';

/**
 * Настройки: каналы, пользователи, шаблоны, профиль.
 *
 * Вынесено отдельным файлом не ради чистоты, а потому что настройки растут
 * быстрее всего остального: каждый новый канал добавляет сюда ручку.
 * В main.ts они бы утопили логику сообщений.
 */

interface Auth {
  tenantId: string;
  userId: string;
}

export interface SettingsDeps {
  pool: Pool;
  masterKey: Buffer;
  requireAuth: (req: unknown) => Auth | null;
  telegramApiRoot: string;
  publicUrl: string;
  telegramWebhookSecret: string;
  mtproto?: { redis: Redis; loginQueue: Queue<MtprotoLoginJob> };
  meta?: { appId: string; appSecret: string; appUrl: string; stateSecret: string; redis: Redis; configId?: string };
  /** Ключ Resend: домены почтовых каналов живут в нашем аккаунте. */
  resendApiKey?: string;
  resendRoot?: string;
  /**
   * Кто смотрит: владелец платформы и не под клиентом ли он сейчас.
   *
   * Отдаётся в /me, потому что интерфейс решает по этому два вопроса:
   * показывать ли панель владельца и рисовать ли полосу «вы под
   * клиентом». Оба ответа нужны на первом же экране.
   */
  platform?: (req: unknown) => Promise<{ owner: boolean; impersonatedBy: string | null }>;
}

export function registerSettings(app: FastifyInstance, deps: SettingsDeps): void {
  const { pool, masterKey, requireAuth } = deps;
  // Адрес приложения нужен коду для вставки на чужой сайт: там ссылка
  // обязана быть абсолютной, относительная ведёт в никуда.
  const appUrl = deps.meta?.appUrl || deps.publicUrl || 'https://app.rozmovio.com';

  const auth401 = { error: 'unauthorized' } as const;

  // ── Профиль: кто я и что за организация ───────────────────────────
  app.get('/me', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const data = await withTenant(pool, auth.tenantId, async (db) => {
      const { rows: users } = await db.query(
        // Сам хэш пароля наружу не идёт — только признак «задан».
        `SELECT id, email, full_name, role, last_seen_at, created_at, password_set_at
           FROM users WHERE id = $1 LIMIT 1`,
        [auth.userId],
      );
      const { rows: counts } = await db.query<{
        channels: string; users: string; conversations: string; messages: string;
      }>(
        `SELECT (SELECT count(*) FROM channels)      AS channels,
                (SELECT count(*) FROM users)         AS users,
                (SELECT count(*) FROM conversations) AS conversations,
                (SELECT count(*) FROM messages)      AS messages`,
      );
      return { user: users[0] ?? null, counts: counts[0] ?? null };
    });

    // Организация лежит в tenants — таблице без RLS, читаем по явному id.
    const tenant = await withSystem(pool, 'профиль организации', async (db) => {
      const { rows } = await db.query(
        `SELECT id, slug, name, plan, seats_limit, region, created_at, bot_pause_minutes,
                work_hours
           FROM tenants WHERE id = $1 LIMIT 1`,
        [auth.tenantId],
      );
      return rows[0] ?? null;
    });

    // Отметка последнего визита — по ней потом видно, кто реально работает.
    await withTenant(pool, auth.tenantId, async (db) => {
      await db.query(`UPDATE users SET last_seen_at = now() WHERE id = $1`, [auth.userId]);
    });

    const platform = deps.platform
      ? await deps.platform(req)
      : { owner: false, impersonatedBy: null };

    return { tenant, ...data, platform };
  });

  /**
   * Правка своего имени.
   *
   * Имя видно клиентам в подписи ответа и коллегам в списке
   * ответственных, поэтому менять его человек должен сам, не прося
   * администратора. Почта здесь не меняется: по ней приходит код
   * входа, и смена почты — это смена ключа от аккаунта, такое делается
   * через приглашение, а не текстовым полем в профиле.
   */
  app.patch<{ Body: { fullName?: string } }>('/me', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const fullName = (req.body?.fullName ?? '').trim().slice(0, 120);
    if (!fullName) return reply.code(400).send({ error: 'name_required' });

    await withTenant(pool, auth.tenantId, async (db) => {
      await db.query(`UPDATE users SET full_name = $2 WHERE id = $1`, [auth.userId, fullName]);
    });
    return { ok: true, fullName };
  });

  /**
   * Снять себя со всех чатов.
   *
   * Конец смены: оператор уходит, и десяток диалогов, где он записан
   * ответственным, остаются «чьими-то». Следующая смена их не берёт —
   * они выглядят занятыми, — и клиент ждёт до утра.
   *
   * Закрытые диалоги не трогаем. Там ответственный — не обязанность, а
   * запись о том, кто разобрался; стереть её значит потерять ответ на
   * вопрос «кто это вёл» ровно тогда, когда он возникнет.
   *
   * Уровень прав здесь любой, вплоть до наблюдателя: человек снимает
   * себя, а не раздаёт чужую работу.
   */
  app.post('/me/unassign', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const freed = await withTenant(pool, auth.tenantId, async (db) => {
      const { rowCount } = await db.query(
        `UPDATE conversations SET assignee_id = NULL
          WHERE assignee_id = $1::uuid AND status <> 'resolved'`,
        [auth.userId],
      );
      return rowCount ?? 0;
    });

    return { freed };
  });

  /**
   * Название организации. Оно попадает в письма и в карточку Zoho,
   * поэтому правится в одном месте — и только администратором:
   * это вывеска компании, а не подпись оператора.
   */
  app.patch<{ Body: { name?: string } }>('/tenant', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const name = (req.body?.name ?? '').trim().slice(0, 160);
    if (!name) return reply.code(400).send({ error: 'name_required' });

    await withSystem(pool, 'переименование организации', async (db) => {
      await db.query(`UPDATE tenants SET name = $2 WHERE id = $1`, [auth.tenantId, name]);
    });
    return { ok: true, name };
  });

  /**
   * Пауза бота после ответа оператора.
   *
   * Живёт рядом со сценариями, потому что объясняет их поведение:
   * без неё человек проверяет сценарий в диалоге, где сам только что
   * отвечал, ничего не происходит — и он решает, что сценарии сломаны.
   */
  app.patch<{ Body: { botPauseMinutes?: number } }>('/settings/bot', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const raw = Number(req.body?.botPauseMinutes);
    if (!Number.isFinite(raw) || raw < 0 || raw > 1440) {
      return reply.code(400).send({ error: 'bad_pause' });
    }
    const minutes = Math.round(raw);

    await withSystem(pool, 'пауза бота', async (db) => {
      await db.query(`UPDATE tenants SET bot_pause_minutes = $2 WHERE id = $1`, [
        auth.tenantId, minutes,
      ]);
    });
    return { botPauseMinutes: minutes };
  });

  /**
   * Рабочие часы организации.
   *
   * Живут у арендатора, а не у канала: клиент пишет в компанию, а не в
   * Telegram, и «по будням до шести» — свойство компании. Канальные
   * исключения, если понадобятся, лягут сверху, но начинать с них
   * значит просить настроить семь расписаний вместо одного.
   */
  app.patch<{ Body: { tz?: string; days?: unknown[] } }>(
    '/settings/work-hours',
    async (req, reply) => {
      const auth = requireAuth(req);
      if (!auth) return reply.code(401).send(auth401);

      /*
       * Дни можно не присылать: часовой пояс правится в профиле
       * компании отдельно от расписания, и запрос оттуда приходит с
       * одним полем. Без этой оговорки разбор подставил бы дни по
       * умолчанию и молча стёр настроенное расписание.
       */
      const current = await withSystem(pool, 'текущие рабочие часы', async (db) => {
        const { rows } = await db.query<{ work_hours: unknown }>(
          `SELECT work_hours FROM tenants WHERE id = $1 LIMIT 1`,
          [auth.tenantId],
        );
        return parseWorkHours(rows[0]?.work_hours);
      });

      const wh = parseWorkHours({
        tz: req.body?.tz ?? current.tz,
        days: req.body?.days ?? current.days,
      });
      // Проверяем пояс на существование здесь, а не в разборе: разбор
      // обязан вернуть что-то рабочее, а форма — сказать человеку, что
      // он выбрал несуществующее.
      try {
        new Intl.DateTimeFormat('en-GB', { timeZone: wh.tz });
      } catch {
        return reply.code(400).send({ error: 'bad_tz', detail: 'Невідомий часовий пояс' });
      }

      await withSystem(pool, 'рабочие часы', async (db) => {
        await db.query(`UPDATE tenants SET work_hours = $2::jsonb WHERE id = $1`, [
          auth.tenantId,
          JSON.stringify(wh),
        ]);
      });

      return { workHours: wh };
    },
  );

  /**
   * Обещание по времени.
   *
   * Два числа и ничего больше. Ноль означает «не обещаем»: пустое
   * обещание честнее подставленного за человека, потому что отчёт
   * потом называет его нарушения просрочкой от имени компании.
   */
  app.patch<{ Body: { firstReplyMinutes?: number; resolveMinutes?: number } }>(
    '/settings/sla',
    async (req, reply) => {
      const auth = requireAuth(req);
      if (!auth) return reply.code(401).send(auth401);

      const current = await withSystem(pool, 'текущее обещание', async (db) => {
        const { rows } = await db.query<{ sla: unknown }>(
          `SELECT sla FROM tenants WHERE id = $1 LIMIT 1`,
          [auth.tenantId],
        );
        return parseSla(rows[0]?.sla);
      });

      const sla = parseSla({
        firstReplyMinutes: req.body?.firstReplyMinutes ?? current.firstReplyMinutes,
        resolveMinutes: req.body?.resolveMinutes ?? current.resolveMinutes,
      });

      await withSystem(pool, 'обещание по времени', async (db) => {
        await db.query(`UPDATE tenants SET sla = $2::jsonb WHERE id = $1`, [
          auth.tenantId,
          JSON.stringify(sla),
        ]);
      });

      return { sla };
    },
  );

  /**
   * Цели сотрудников.
   *
   * Одна ручка на общую цель и на личные: отдаёт и то, и другое сразу,
   * потому что в интерфейсе они стоят рядом и различить их человек
   * должен с одного взгляда, а не открывая по очереди.
   */
  app.get('/kpi', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const rows = await withTenant(pool, auth.tenantId, async (db) => {
      const { rows } = await db.query<{
        user_id: string | null;
        replies_per_day: number;
        resolved_per_day: number;
        in_time_percent: number;
      }>(
        `SELECT user_id, replies_per_day, resolved_per_day, in_time_percent FROM kpi_goals`,
      );
      return rows;
    });

    const one = (r: (typeof rows)[number] | undefined) =>
      parseKpi({
        repliesPerDay: r?.replies_per_day,
        resolvedPerDay: r?.resolved_per_day,
        inTimePercent: r?.in_time_percent,
      });

    const byUser: Record<string, ReturnType<typeof one>> = {};
    for (const r of rows) if (r.user_id) byUser[r.user_id] = one(r);

    return {
      default: one(rows.find((r) => !r.user_id)),
      byUser,
    };
  });

  /**
   * Задать цель: общую или одному человеку.
   *
   * Пустой userId — общая. Все нули убирают строку целиком, а не
   * сохраняют нулевую цель: «цели нет» и «цель ноль» для отчёта разные
   * вещи, и хранить их одинаково значит путать их навсегда.
   */
  app.put<{
    Body: {
      userId?: string | null;
      repliesPerDay?: number;
      resolvedPerDay?: number;
      inTimePercent?: number;
    };
  }>('/kpi', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const goal = parseKpi(req.body);
    const userId = req.body?.userId || null;
    const empty = !goal.repliesPerDay && !goal.resolvedPerDay && !goal.inTimePercent;

    await withTenant(pool, auth.tenantId, async (db) => {
      if (empty) {
        await db.query(
          userId
            ? `DELETE FROM kpi_goals WHERE user_id = $1::uuid`
            : `DELETE FROM kpi_goals WHERE user_id IS NULL`,
          userId ? [userId] : [],
        );
        return;
      }

      // Частичные уникальные индексы не подходят под ON CONFLICT без
      // повторения их предиката, и с двумя случаями это читалось бы
      // хуже, чем честные UPDATE и INSERT.
      const { rowCount } = await db.query(
        userId
          ? `UPDATE kpi_goals SET replies_per_day = $2, resolved_per_day = $3,
                    in_time_percent = $4, updated_at = now()
              WHERE user_id = $1::uuid`
          : `UPDATE kpi_goals SET replies_per_day = $1, resolved_per_day = $2,
                    in_time_percent = $3, updated_at = now()
              WHERE user_id IS NULL`,
        userId
          ? [userId, goal.repliesPerDay, goal.resolvedPerDay, goal.inTimePercent]
          : [goal.repliesPerDay, goal.resolvedPerDay, goal.inTimePercent],
      );
      if (rowCount) return;

      await db.query(
        `INSERT INTO kpi_goals (tenant_id, user_id, replies_per_day, resolved_per_day, in_time_percent)
         VALUES ($1, $2::uuid, $3, $4, $5)`,
        [auth.tenantId, userId, goal.repliesPerDay, goal.resolvedPerDay, goal.inTimePercent],
      );
    });

    return { goal, userId };
  });

  /**
   * Подключение номера WhatsApp.
   *
   * Через Cloud API: номер живёт в аккаунте WhatsApp Business клиента, а
   * мы получаем к нему постоянный токен. Embedded Signup — «войти через
   * Facebook и выбрать номер» — требует проверки приложения в Meta, и до
   * неё подключение идёт токеном: так клиент может начать работать
   * сегодня, а не через две недели ожидания.
   *
   * Проверяем номер сразу: спрашиваем у Meta, чей он и как выглядит.
   * Иначе неверный идентификатор выясняется в момент, когда оператор
   * отвечает клиенту, — то есть слишком поздно.
   */
  app.post<{
    Body: { token?: string; phoneNumberId?: string; displayName?: string; wabaId?: string };
  }>(
    '/settings/channels/whatsapp',
    async (req, reply) => {
      const auth = requireAuth(req);
      if (!auth) return reply.code(401).send(auth401);

      const token = (req.body?.token ?? '').trim();
      const phoneNumberId = (req.body?.phoneNumberId ?? '').trim();
      if (!token || !phoneNumberId) {
        return reply.code(400).send({ error: 'token_and_number_required' });
      }

      let number: { display_phone_number?: string; verified_name?: string; id?: string };
      try {
        number = await graphGet(phoneNumberId, {
          access_token: token,
          fields: 'id,display_phone_number,verified_name,quality_rating',
        });
      } catch (err) {
        return reply.code(400).send({
          error: 'check_failed',
          detail: err instanceof Error ? err.message : 'Meta не підтвердила номер',
        });
      }

      /**
       * Подписка аккаунта WhatsApp Business на наше приложение.
       *
       * Без неё канал выглядит рабочим и даже умеет отправлять, но
       * входящие не приходят никогда: подписки приложения на события
       * мало, Meta шлёт вебхуки только тем приложениям, которые
       * подписаны на конкретный аккаунт. Найти это глазами почти
       * невозможно — «отправка работает, входящих нет» ни на что не
       * указывает, — поэтому делаем сами при подключении.
       *
       * Идентификатор аккаунта спрашиваем у самого токена: у номера
       * такого поля нет, а проверка токена возвращает список объектов,
       * на которые выданы права.
       */
      let waba: string | null = (req.body?.wabaId ?? '').trim() || null;
      let subscribe: string | null = null;
      try {
        /**
         * Способа узнать аккаунт по номеру у Graph нет, поэтому идём
         * тремя путями, от самого удобного к самому надёжному.
         *
         * Первый — проверка токена. Он работает для токена из
         * Embedded Signup: там granular_scopes перечисляют аккаунты, на
         * которые выданы права. Для токена системного пользователя
         * таких списков нет, и это не сбой, а другое устройство токена.
         *
         * Второй — спросить у самого номера. Поле недокументировано и
         * есть не всегда, но когда есть, избавляет человека от лишнего
         * копирования.
         *
         * Третий — идентификатор, введённый руками. Он и был причиной
         * стольких попыток: пока автоматика не сработала, человеку
         * нечем было помочь себе самому.
         */
        const debug = await graphGet<DebugTokenReply>('debug_token', {
          input_token: token,
          access_token: token,
        });
        /* Право на отправку проверяем до всего остального: без него
           канал подключится, входящие пойдут, а ответы будут молча
           отваливаться — и связать это с забытой галочкой в окне
           генерации маркера человеку неоткуда. */
        if (!canSendWhatsapp(debug)) {
          return reply.code(400).send({
            error: 'token_cannot_send',
            detail:
              'У маркера немає права whatsapp_business_messaging. ' +
              'Згенеруйте маркер заново і відмітьте обидва права: ' +
              'whatsapp_business_messaging і whatsapp_business_management.',
          });
        }
        if (!waba) waba = wabaFromDebug(debug);

        if (!waba) {
          try {
            const parent = await graphGet<{ whatsapp_business_account?: { id?: string } }>(
              phoneNumberId,
              { access_token: token, fields: 'whatsapp_business_account' },
            );
            waba = parent.whatsapp_business_account?.id ?? null;
          } catch {
            /* поля нет — идём дальше, это ожидаемо */
          }
        }

        /**
         * Введённое руками число может оказаться не тем.
         *
         * В адресе кабинета Meta рядом стоят два идентификатора —
         * business_id и asset_id, — и первый бросается в глаза раньше.
         * Разница видна только по ответу Graph, и звучит он как
         * «объект не существует», что человека окончательно запутывает.
         *
         * Поэтому не придираемся: если число оказалось портфолио,
         * спрашиваем у него аккаунты и выбираем тот, к которому
         * действительно привязан подключаемый номер. Заодно это решает
         * случай нескольких аккаунтов с похожими названиями — угадывать
         * по имени было бы гаданием.
         */
        if (waba) waba = await resolveWaba(waba, token, phoneNumberId);

        if (waba) {
          await graphPost(`${waba}/subscribed_apps`, { access_token: token }, undefined);
        } else {
          subscribe = 'no_waba';
        }
      } catch (err) {
        // Не роняем подключение: номер проверен, отправка будет
        // работать. Но причину сохраняем и показываем — иначе человек
        // останется с тишиной вместо объяснения.
        subscribe = err instanceof Error ? err.message : 'subscribe_failed';
      }

      const owner = await withSystem(pool, 'владелец номера WhatsApp', async (db) => {
        const { rows } = await db.query<{ channel_id: string; tenant_id: string }>(
          `SELECT channel_id, tenant_id FROM channel_routes
            WHERE channel_type = 'whatsapp' AND external_id = $1 LIMIT 1`,
          [phoneNumberId],
        );
        return rows[0] ?? null;
      });

      if (owner && owner.tenant_id !== auth.tenantId) {
        return reply.code(409).send({
          error: 'channel_belongs_to_another_tenant',
          detail: 'Цей номер уже підключений в іншому акаунті.',
        });
      }

      const channelId = owner?.channel_id ?? randomUUID();
      const title =
        req.body?.displayName?.trim() ||
        number.verified_name ||
        number.display_phone_number ||
        'WhatsApp';

      await withTenant(pool, auth.tenantId, async (db) => {
        await db.query(
          `INSERT INTO channels (id, tenant_id, type, display_name, external_id,
                                 credentials_enc, meta, status)
           VALUES ($1, $2, 'whatsapp', $3, $4, $5, $6, 'active')
           ON CONFLICT (type, external_id) DO UPDATE
             SET display_name = EXCLUDED.display_name,
                 credentials_enc = EXCLUDED.credentials_enc,
                 meta = EXCLUDED.meta, status = 'active', last_error = NULL`,
          [
            channelId,
            auth.tenantId,
            title,
            phoneNumberId,
            // pageId и pageToken — общие имена для всех каналов Meta:
            // отправка ходит через один и тот же код.
            encryptJson(masterKey, auth.tenantId, { pageId: phoneNumberId, pageToken: token }),
            JSON.stringify({
              phone: number.display_phone_number ?? null,
              verifiedName: number.verified_name ?? null,
              wabaId: waba,
            }),
          ],
        );
      });

      if (subscribe) {
        // Причина уезжает прямо в текст сообщения: вложенные поля
        // видны не во всех просмотрщиках логов, и ошибка, ради
        // которой всё это писалось, там как раз и терялась.
        app.log.warn(
          { channelId },
          'Аккаунт WhatsApp не подписан на приложение: ' + subscribe,
        );
      }

      return {
        channelId,
        phone: number.display_phone_number ?? null,
        /** Пусто — всё в порядке. Иначе входящие не придут, и это надо сказать. */
        subscribeError: subscribe,
      };
    },
  );

  /**
   * Одобренные шаблоны номера.
   *
   * Их показывают оператору вместо поля ответа, когда суточное окно
   * закрыто. Список спрашиваем у Meta каждый раз: шаблон могли одобрить
   * или отклонить пять минут назад, и устаревший список означает отказ
   * при отправке.
   */
  app.get<{ Params: { id: string } }>(
    '/channels/:id/whatsapp-templates',
    async (req, reply) => {
      const auth = requireAuth(req);
      if (!auth) return reply.code(401).send(auth401);

      const channel = await withTenant(pool, auth.tenantId, async (db) => {
        const { rows } = await db.query<{ credentials_enc: Buffer; meta: Record<string, unknown> }>(
          `SELECT credentials_enc, meta FROM channels
            WHERE id = $1 AND type = 'whatsapp' LIMIT 1`,
          [req.params.id],
        );
        return rows[0] ?? null;
      });
      if (!channel) return reply.code(404).send({ error: 'not_found' });

      const creds = decryptJson<{ pageId: string; pageToken: string }>(
        masterKey,
        auth.tenantId,
        channel.credentials_enc,
      );

      // Шаблоны принадлежат не номеру, а аккаунту WhatsApp Business.
      // Его идентификатор спрашиваем у самого номера.
      let wabaId = String(channel.meta?.['wabaId'] ?? '');
      if (!wabaId) {
        try {
          const info = await graphGet<{ whatsapp_business_account?: { id?: string } }>(
            creds.pageId,
            { access_token: creds.pageToken, fields: 'whatsapp_business_account' },
          );
          wabaId = info.whatsapp_business_account?.id ?? '';
          if (wabaId) {
            await withTenant(pool, auth.tenantId, async (db) => {
              await db.query(
                `UPDATE channels SET meta = meta || jsonb_build_object('wabaId', $2::text)
                  WHERE id = $1`,
                [req.params.id, wabaId],
              );
            });
          }
        } catch {
          wabaId = '';
        }
      }
      if (!wabaId) return { templates: [], detail: 'Не вдалося визначити акаунт WhatsApp Business' };

      try {
        const raw = await graphGet(`${wabaId}/message_templates`, {
          access_token: creds.pageToken,
          limit: '100',
        });
        return { templates: parseTemplates(raw).filter((t) => t.status === 'APPROVED') };
      } catch (err) {
        return reply.code(502).send({
          error: 'templates_unavailable',
          detail: err instanceof Error ? err.message : 'Meta не віддала шаблони',
        });
      }
    },
  );

  /**
   * Чат на сайте.
   *
   * Канал создаётся сразу рабочим: ключ выдан, код для вставки готов.
   * Настройки — заголовок, приветствие, цвет и домены — правятся потом
   * и без переподключения: человек ставит виджет за минуту, а подбирает
   * цвет уже спокойно.
   */
  app.post<{ Body: { displayName?: string } }>(
    '/settings/channels/webchat',
    async (req, reply) => {
      const auth = requireAuth(req);
      if (!auth) return reply.code(401).send(auth401);

      // Ключ публичный: он виден в коде страницы у каждого посетителя.
      // Секретом он не является — по нему можно начать разговор, но не
      // прочитать чужой.
      const siteKey = 'wc' + randomUUID().replace(/-/g, '').slice(0, 22);
      const channelId = randomUUID();
      const title = req.body?.displayName?.trim().slice(0, 80) || 'Чат на сайті';

      await withTenant(pool, auth.tenantId, async (db) => {
        await db.query(
          `INSERT INTO channels (id, tenant_id, type, display_name, external_id,
                                 credentials_enc, meta, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')`,
          [
            channelId,
            auth.tenantId,
            WEBCHAT_CHANNEL,
            title,
            siteKey,
            // Секретов у канала нет: шифровать нечего, но колонка
            // обязательная — кладём пустой объект.
            encryptJson(masterKey, auth.tenantId, {}),
            JSON.stringify({ ...WEBCHAT_DEFAULTS, title }),
          ],
        );
      });

      return {
        channelId,
        siteKey,
        snippet: embedSnippet(appUrl, siteKey),
        iframe: iframeSnippet(appUrl, siteKey),
      };
    },
  );

  /**
   * Свой канал.
   *
   * Даём ключ и берём адрес — на этом подключение заканчивается. Всё
   * остальное на стороне клиента: чем доставлены сообщения, как устроен
   * его бот и что он делает между нашими вызовами, нас не касается.
   *
   * Ключ показываем в интерфейсе и потом: в отличие от токена чужой
   * платформы, он наш собственный, и прятать его от владельца канала
   * значило бы заставлять пересоздавать канал при каждой потере.
   */
  app.post<{ Body: { displayName?: string; outUrl?: string } }>(
    '/settings/channels/custom',
    async (req, reply) => {
      const auth = requireAuth(req);
      if (!auth) return reply.code(401).send(auth401);

      const outUrl = String(req.body?.outUrl ?? '').trim();
      const bad = badOutUrl(outUrl);
      if (bad) return reply.code(400).send({ error: 'bad_url', detail: bad });

      const key = newCustomKey();
      const secret = newCustomSecret();
      const channelId = randomUUID();
      const title = req.body?.displayName?.trim().slice(0, 80) || 'Власний канал';

      await withTenant(pool, auth.tenantId, async (db) => {
        await db.query(
          `INSERT INTO channels (id, tenant_id, type, display_name, external_id,
                                 credentials_enc, meta, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')`,
          [
            channelId,
            auth.tenantId,
            CUSTOM_CHANNEL,
            title,
            key,
            encryptJson(masterKey, auth.tenantId, { outUrl, secret }),
            JSON.stringify({ outUrl }),
          ],
        );
      });

      return { channelId, key, secret, outUrl, inUrl: `${appUrl}/channels/custom/messages` };
    },
  );

  /**
   * Почта.
   *
   * Подключение — это домен, а не логин с паролем: письма принимает
   * наш сервер, и для этого у домена должна стоять MX-запись на него.
   * Поэтому просим поддомен (help.firma.com), а не основной домен:
   * MX у домена один, и перенаправив его, клиент потеряет собственную
   * почту сотрудников. Об этом написано прямо в форме — молчаливое
   * «упс» здесь стоит рабочего ящика.
   *
   * Домен заводится в нашем аккаунте Resend, поэтому ключ здесь наш, а
   * не клиента: клиенту незачем заводить учётную запись у почтового
   * провайдера ради того, чтобы им пользовались мы.
   */
  app.post<{ Body: { domain?: string; localPart?: string; displayName?: string } }>(
    '/settings/channels/email',
    async (req, reply) => {
      const auth = requireAuth(req);
      if (!auth) return reply.code(401).send(auth401);
      if (!deps.resendApiKey) return reply.code(503).send({ error: 'email_unavailable' });

      const domain = String(req.body?.domain ?? '').trim().toLowerCase().replace(/^https?:[/][/]/, '');
      if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?([.][a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
        return reply.code(400).send({ error: 'bad_domain' });
      }
      /*
       * Чужая почта. gmail.com, ukr.net и прочее — домены, где записи
       * DNS человеку не принадлежат: подключить их нельзя никак. Без
       * этой проверки он ждёт минуту и получает отказ Resend чужими
       * словами.
       */
      if (isPublicMailDomain(domain)) return reply.code(400).send({ error: 'public_domain' });

      const local = (String(req.body?.localPart ?? '').trim().toLowerCase() || 'support')
        .replace(/[^a-z0-9._-]/g, '')
        .slice(0, 40);
      if (!local) return reply.code(400).send({ error: 'bad_address' });
      const address = `${local}@${domain}`;

      // Домен занят другой организацией — это не ошибка ввода, а чужой
      // домен, и объяснить это надо прямо.
      const owner = await withSystem(pool, 'владелец почтового домена', async (db) => {
        const { rows } = await db.query<{ channel_id: string; tenant_id: string }>(
          `SELECT channel_id, tenant_id FROM channel_routes
            WHERE channel_type = 'email' AND external_id = $1 LIMIT 1`,
          [domain],
        );
        return rows[0] ?? null;
      });
      if (owner && owner.tenant_id !== auth.tenantId) {
        return reply.code(409).send({ error: 'domain_taken' });
      }

      const opts = { apiKey: deps.resendApiKey, ...(deps.resendRoot ? { root: deps.resendRoot } : {}) };
      let dom;
      try {
        dom = await resendCreateDomain(opts, domain);
      } catch (err) {
        // Домен мог остаться в Resend от прошлой неудачной попытки:
        // второй раз его не заведут, и без этого человек упирается в
        // «уже существует» без выхода.
        const found = err instanceof ResendError ? await resendFindDomain(opts, domain).catch(() => null) : null;
        if (!found) {
          const detail =
            err instanceof ResendError
              ? err.reason || err.detail.slice(0, 300)
              : String(err);
          app.log.warn({ err, domain }, 'Resend не завёл домен');
          return reply.code(502).send({ error: 'resend_refused', detail });
        }
        dom = await resendGetDomain(opts, found.id).catch(() => found);
      }

      const channelId = owner?.channel_id ?? randomUUID();
      const title = req.body?.displayName?.trim().slice(0, 80) || address;
      await withTenant(pool, auth.tenantId, async (db) => {
        await db.query(
          `INSERT INTO channels (id, tenant_id, type, display_name, external_id,
                                 credentials_enc, meta, status)
           VALUES ($1, $2, 'email', $3, $4, $5, $6, $7)
           ON CONFLICT (type, external_id) DO UPDATE
             SET display_name = EXCLUDED.display_name,
                 credentials_enc = EXCLUDED.credentials_enc,
                 meta = EXCLUDED.meta, status = EXCLUDED.status, last_error = NULL`,
          [
            channelId,
            auth.tenantId,
            title,
            domain,
            encryptJson(masterKey, auth.tenantId, { domainId: dom.id, domain, address }),
            JSON.stringify({ domain, address, records: dnsRows(dom), status: dom.status }),
            domainReady(dom) ? 'active' : 'pending',
          ],
        );
      });

      return { channelId, domain, address, status: dom.status, records: dnsRows(dom) };
    },
  );

  /**
   * Перепроверка домена.
   *
   * DNS расходится не мгновенно, и первая проверка почти всегда
   * отвечает «ещё нет». Поэтому кнопка, а не единственная попытка при
   * подключении: человек добавил записи и нажал, когда готов.
   */
  app.post<{ Params: { id: string } }>('/channels/:id/email/verify', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);
    if (!deps.resendApiKey) return reply.code(503).send({ error: 'email_unavailable' });

    const row = await withTenant(pool, auth.tenantId, async (db) => {
      const { rows } = await db.query<{ credentials_enc: Buffer }>(
        `SELECT credentials_enc FROM channels WHERE id = $1 AND type = 'email' LIMIT 1`,
        [req.params.id],
      );
      return rows[0] ?? null;
    });
    if (!row) return reply.code(404).send({ error: 'not_found' });

    const creds = decryptJson<{ domainId: string; domain: string; address: string }>(
      masterKey,
      auth.tenantId,
      row.credentials_enc,
    );
    const opts = { apiKey: deps.resendApiKey, ...(deps.resendRoot ? { root: deps.resendRoot } : {}) };

    try {
      await resendVerifyDomain(opts, creds.domainId);
    } catch (err) {
      // Просьба проверить могла не пройти по лимиту — состояние всё
      // равно читаем: оно могло подтвердиться до нашего нажатия.
      app.log.info({ err }, 'Resend не принял просьбу о проверке домена');
    }

    let dom;
    try {
      dom = await resendGetDomain(opts, creds.domainId);
    } catch (err) {
      const detail =
        err instanceof ResendError ? err.reason || err.detail.slice(0, 300) : String(err);
      return reply.code(502).send({ error: 'resend_refused', detail });
    }

    const ready = domainReady(dom);
    await withTenant(pool, auth.tenantId, async (db) => {
      await db.query(
        `UPDATE channels
            SET meta = meta || $2::jsonb, status = $3,
                last_error = CASE WHEN $3 = 'active' THEN NULL ELSE last_error END
          WHERE id = $1`,
        [
          req.params.id,
          JSON.stringify({ records: dnsRows(dom), status: dom.status }),
          ready ? 'active' : 'pending',
        ],
      );
    });

    return { status: dom.status, ready, records: dnsRows(dom) };
  });

  /** Ключ, секрет подписи и адрес: их показывают и меняют после подключения. */
  app.get<{ Params: { id: string } }>('/channels/:id/custom', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const row = await withTenant(pool, auth.tenantId, async (db) => {
      const { rows } = await db.query<{ external_id: string; credentials_enc: Buffer }>(
        `SELECT external_id, credentials_enc FROM channels
          WHERE id = $1 AND type = $2 LIMIT 1`,
        [req.params.id, CUSTOM_CHANNEL],
      );
      return rows[0] ?? null;
    });
    if (!row) return reply.code(404).send({ error: 'not_found' });

    const creds = decryptJson<{ outUrl?: string; secret?: string }>(
      masterKey,
      auth.tenantId,
      row.credentials_enc,
    );
    return {
      key: row.external_id,
      secret: creds.secret ?? '',
      outUrl: creds.outUrl ?? '',
      inUrl: `${appUrl}/channels/custom/messages`,
    };
  });

  app.patch<{ Params: { id: string }; Body: { outUrl?: string } }>(
    '/channels/:id/custom',
    async (req, reply) => {
      const auth = requireAuth(req);
      if (!auth) return reply.code(401).send(auth401);

      const outUrl = String(req.body?.outUrl ?? '').trim();
      const bad = badOutUrl(outUrl);
      if (bad) return reply.code(400).send({ error: 'bad_url', detail: bad });

      const updated = await withTenant(pool, auth.tenantId, async (db) => {
        const { rows } = await db.query<{ credentials_enc: Buffer }>(
          `SELECT credentials_enc FROM channels WHERE id = $1 AND type = $2 LIMIT 1`,
          [req.params.id, CUSTOM_CHANNEL],
        );
        const row = rows[0];
        if (!row) return false;

        const creds = decryptJson<{ outUrl?: string; secret?: string }>(
          masterKey,
          auth.tenantId,
          row.credentials_enc,
        );
        await db.query(
          `UPDATE channels
              SET credentials_enc = $2, meta = meta || $3::jsonb
            WHERE id = $1`,
          [
            req.params.id,
            encryptJson(masterKey, auth.tenantId, { ...creds, outUrl }),
            JSON.stringify({ outUrl }),
          ],
        );
        return true;
      });
      if (!updated) return reply.code(404).send({ error: 'not_found' });

      return { outUrl };
    },
  );

  /** Настройки виджета и код для вставки. */
  app.get<{ Params: { id: string } }>('/channels/:id/webchat', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const row = await withTenant(pool, auth.tenantId, async (db) => {
      const { rows } = await db.query<{ external_id: string; meta: unknown }>(
        `SELECT external_id, meta FROM channels WHERE id = $1 AND type = $2`,
        [req.params.id, WEBCHAT_CHANNEL],
      );
      return rows[0] ?? null;
    });
    if (!row) return reply.code(404).send({ error: 'not_found' });

    return {
      siteKey: row.external_id,
      settings: webchatSettings(row.meta),
      snippet: embedSnippet(appUrl, row.external_id, webchatSettings(row.meta).position),
      iframe: iframeSnippet(appUrl, row.external_id),
    };
  });

  app.patch<{
    Params: { id: string };
    Body: {
      title?: string;
      subtitle?: string;
      greeting?: string;
      color?: string;
      logo?: string;
      position?: string;
      launcher?: string;
      anim?: string;
      showMode?: string;
      showAfter?: number;
      domains?: string;
    };
    // Логотип едет внутри JSON как data:image, поэтому тело крупнее
    // обычного. Мегабайта хватает с большим запасом: интерфейс ужимает
    // картинку до 128 точек ещё до отправки.
  }>('/channels/:id/webchat', { bodyLimit: 1024 * 1024 }, async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const domains = String(req.body?.domains ?? '')
      .split(/[,;\s]+/)
      .map((d) => normalizeDomain(d))
      .filter(Boolean)
      .slice(0, 20);

    const logo = String(req.body?.logo ?? '');
    /**
     * Настройки прогоняются через тот же разбор, которым их потом
     * читает виджет. Переписывать здесь проверки заново — значит рано
     * или поздно разойтись с ним в мелочи: поле, добавленное в одном
     * месте, молча теряется в другом.
     *
     * Пустая строка в логотипе — это «убрать», а не «не трогать»:
     * убрать его иначе было бы нечем.
     */
    const patch = webchatSettings({
      title: String(req.body?.title ?? WEBCHAT_DEFAULTS.title).trim(),
      subtitle: String(req.body?.subtitle ?? '').trim(),
      greeting: String(req.body?.greeting ?? '').trim(),
      color: req.body?.color,
      logo,
      position: req.body?.position,
      launcher: req.body?.launcher,
      anim: req.body?.anim,
      showMode: req.body?.showMode,
      showAfter: req.body?.showAfter,
      domains,
    });

    if (logo && !patch.logo) {
      return reply.code(400).send({
        error: 'bad_logo',
        detail: 'Логотип має бути картинкою до 190 КБ',
      });
    }

    const updated = await withTenant(pool, auth.tenantId, async (db) => {
      const { rowCount } = await db.query(
        `UPDATE channels SET meta = meta || $2::jsonb, display_name = $3
          WHERE id = $1 AND type = $4`,
        [req.params.id, JSON.stringify(patch), patch.title, WEBCHAT_CHANNEL],
      );
      return (rowCount ?? 0) > 0;
    });
    if (!updated) return reply.code(404).send({ error: 'not_found' });

    return { settings: patch };
  });

  /**
   * Кто видит канал и кому достаются новые диалоги.
   *
   * Обе настройки живут на странице канала, а не только в разделе людей:
   * человек настраивает канал и там же решает, кто с ним работает.
   * Ходить за этим в другой раздел — значит не настроить вовсе.
   */
  app.get<{ Params: { id: string } }>('/channels/:id/team', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const data = await withTenant(pool, auth.tenantId, async (db) => {
      const { rows: ch } = await db.query<{ routing: unknown }>(
        `SELECT routing FROM channels WHERE id = $1`,
        [req.params.id],
      );
      if (!ch[0]) return null;

      const { rows: users } = await db.query<{
        id: string;
        full_name: string | null;
        email: string;
        role: string;
        restricted: boolean;
        allowed: boolean;
      }>(
        `SELECT u.id, u.full_name, u.email, u.role,
                EXISTS (SELECT 1 FROM user_channels uc WHERE uc.user_id = u.id) AS restricted,
                EXISTS (SELECT 1 FROM user_channels uc
                         WHERE uc.user_id = u.id AND uc.channel_id = $1) AS allowed
           FROM users u
          WHERE u.is_active
          ORDER BY lower(coalesce(u.full_name, u.email)), u.id`,
        [req.params.id],
      );

      return { routing: parseRouting(ch[0].routing), users };
    });
    if (!data) return reply.code(404).send({ error: 'not_found' });

    return {
      routing: data.routing,
      users: data.users.map((u) => ({
        id: u.id,
        name: u.full_name || u.email,
        role: u.role,
        // Владелец и администратор видят всё по роли: ограничивать их
        // нечем, и галочка у них была бы обманом.
        unrestricted: u.role === 'owner' || u.role === 'admin',
        sees: u.role === 'owner' || u.role === 'admin' || !u.restricted || u.allowed,
      })),
    };
  });

  /** Задать доступ к каналу и правило распределения. */
  app.put<{
    Params: { id: string };
    Body: { userIds?: string[]; routing?: { mode?: string; userId?: string | null } };
  }>('/channels/:id/team', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const ids = Array.isArray(req.body?.userIds) ? req.body!.userIds!.slice(0, 200) : null;
    const mode = req.body?.routing?.mode;
    const routing = {
      mode: mode === 'round_robin' || mode === 'user' ? mode : 'none',
      userId: req.body?.routing?.userId || null,
    };

    const done = await withTenant(pool, auth.tenantId, async (db) => {
      const { rowCount } = await db.query(
        `UPDATE channels
            SET routing = routing || jsonb_build_object(
                  'mode', $2::text,
                  'userId', $3::text)
          WHERE id = $1`,
        [req.params.id, routing.mode, routing.userId],
      );
      if (!rowCount) return false;

      /*
       * Доступ задаётся «от канала»: отмеченные его видят, остальные —
       * нет. Тонкость в том, что пустой список у человека означает «ему
       * видно всё». Поэтому снятая галочка превращается в явный список
       * остальных каналов, иначе она бы ничего не изменила.
       */
      if (ids) {
        const { rows: people } = await db.query<{ id: string; role: string }>(
          `SELECT id, role FROM users WHERE is_active`,
        );
        const { rows: channels } = await db.query<{ id: string }>(`SELECT id FROM channels`);

        for (const person of people) {
          if (person.role === 'owner' || person.role === 'admin') continue;
          const wanted = ids.includes(person.id);

          if (wanted) {
            const { rowCount: had } = await db.query(
              `SELECT 1 FROM user_channels WHERE user_id = $1 LIMIT 1`,
              [person.id],
            );
            // Пока список пуст, человеку и так видно всё: добавлять
            // строку значило бы отнять у него остальные каналы.
            if (!had) continue;
            await db.query(
              `INSERT INTO user_channels (tenant_id, user_id, channel_id)
               VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
              [auth.tenantId, person.id, req.params.id],
            );
          } else {
            const { rowCount: had } = await db.query(
              `SELECT 1 FROM user_channels WHERE user_id = $1 LIMIT 1`,
              [person.id],
            );
            if (!had) {
              // Ограничений не было — вводим их: все каналы, кроме этого.
              for (const channel of channels) {
                if (channel.id === req.params.id) continue;
                await db.query(
                  `INSERT INTO user_channels (tenant_id, user_id, channel_id)
                   VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
                  [auth.tenantId, person.id, channel.id],
                );
              }
            } else {
              await db.query(
                `DELETE FROM user_channels WHERE user_id = $1 AND channel_id = $2`,
                [person.id, req.params.id],
              );
            }
          }
        }
      }
      return true;
    });

    if (!done) return reply.code(404).send({ error: 'not_found' });
    return { ok: true, routing: { ...ROUTING_DEFAULT, ...routing } };
  });

  // ── Каналы ────────────────────────────────────────────────────────
  app.get('/channels', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const rows = await withTenant(pool, auth.tenantId, async (db) => {
      // credentials_enc НЕ выбираем: токены не должны покидать сервер даже
      // в зашифрованном виде. Показываем только то, по чему канал узнают.
      const { rows } = await db.query(
        // Каналы, к которым у человека нет доступа, не показываем
        // вовсе: иначе фильтр предлагает канал, который всегда
        // возвращает пустой список.
        `SELECT c.id, c.type, c.display_name, c.external_id, c.status,
                c.meta, c.last_error, c.created_at,
                (SELECT count(*) FROM conversations v WHERE v.channel_id = c.id) AS conversations
           FROM channels c
          WHERE ${channelListScope('$1')}
          ORDER BY c.created_at DESC`,
        [auth.userId],
      );
      return rows;
    });

    return { channels: rows };
  });

  /**
   * Доступ сотрудника к каналам.
   *
   * Пустой список означает «все каналы», поэтому ручка отдаёт и то,
   * что выбрано, и признак «ограничений нет»: в интерфейсе это два
   * разных состояния, и путать их нельзя — иначе администратор,
   * сняв все галочки, думает, что запретил всё, а на деле открыл всё.
   */
  app.get<{ Params: { id: string } }>('/users/:id/channels', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const data = await withTenant(pool, auth.tenantId, async (db) => {
      const { rows } = await db.query<{ channel_id: string }>(
        `SELECT channel_id FROM user_channels WHERE user_id = $1`,
        [req.params.id],
      );
      const { rows: role } = await db.query<{ role: string }>(
        `SELECT role FROM users WHERE id = $1`,
        [req.params.id],
      );
      return { ids: rows.map((r) => r.channel_id), role: role[0]?.role ?? '' };
    });

    return {
      channelIds: data.ids,
      // У владельца и администратора ограничений не бывает: они
      // отвечают за компанию целиком.
      unrestricted: data.ids.length === 0,
      manageable: data.role !== 'owner' && data.role !== 'admin',
    };
  });

  /**
   * Доступ сотрудника к папкам шаблонов. Устроено как у каналов, и это
   * не случайность: одно правило на две разные вещи человек помнит,
   * два — путает.
   */
  app.get<{ Params: { id: string } }>('/users/:id/folders', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const data = await withTenant(pool, auth.tenantId, async (db) => {
      const { rows } = await db.query<{ folder_id: string }>(
        `SELECT folder_id FROM user_reply_folders WHERE user_id = $1`,
        [req.params.id],
      );
      const { rows: role } = await db.query<{ role: string }>(
        `SELECT role FROM users WHERE id = $1`,
        [req.params.id],
      );
      return { ids: rows.map((r) => r.folder_id), role: role[0]?.role ?? '' };
    });

    return {
      folderIds: data.ids,
      unrestricted: data.ids.length === 0,
      manageable: data.role !== 'owner' && data.role !== 'admin',
    };
  });

  /** Задать список папок. Пустой список снимает ограничение. */
  app.put<{ Params: { id: string }; Body: { folderIds?: string[] } }>(
    '/users/:id/folders',
    async (req, reply) => {
      const auth = requireAuth(req);
      if (!auth) return reply.code(401).send(auth401);

      const ids = Array.isArray(req.body?.folderIds) ? req.body!.folderIds!.slice(0, 200) : [];

      const result = await withTenant(pool, auth.tenantId, async (db) => {
        const { rows: who } = await db.query<{ role: string }>(
          `SELECT role FROM users WHERE id = $1`,
          [req.params.id],
        );
        const role = who[0]?.role;
        if (!role) return { error: 'not_found' as const };
        if (role === 'owner' || role === 'admin') return { error: 'role_unrestricted' as const };

        await db.query(`DELETE FROM user_reply_folders WHERE user_id = $1`, [req.params.id]);
        if (ids.length) {
          await db.query(
            `INSERT INTO user_reply_folders (tenant_id, user_id, folder_id)
             SELECT $1, $2, f.id FROM reply_folders f WHERE f.id = ANY($3::uuid[])
             ON CONFLICT DO NOTHING`,
            [auth.tenantId, req.params.id, ids],
          );
        }
        const { rows } = await db.query<{ folder_id: string }>(
          `SELECT folder_id FROM user_reply_folders WHERE user_id = $1`,
          [req.params.id],
        );
        return { ids: rows.map((r) => r.folder_id) };
      });

      if ('error' in result) {
        return reply.code(result.error === 'not_found' ? 404 : 400).send({
          error: result.error,
          detail: result.error === 'role_unrestricted'
            ? 'Власник і адміністратор бачать усі папки за своєю роллю'
            : 'Співробітника не знайдено',
        });
      }

      return { folderIds: result.ids, unrestricted: result.ids.length === 0 };
    },
  );

  /**
   * Доступы одной таблицей.
   *
   * Человек и канал — это пересечение, и раздавать его по одному
   * человеку значит открывать десять карточек, чтобы ответить на
   * вопрос «кто вообще видит Instagram». Поэтому здесь сразу всё:
   * люди, каналы, папки и отмеченные клетки.
   *
   * Пустой список у человека означает «всё», и ручка отдаёт это
   * признаком, а не пустым массивом: в таблице пустая строка читается
   * как «ничего не видит», и перепутать эти два состояния — значит
   * закрыть человеку работу, думая, что открыл.
   */
  app.get('/access', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const data = await withTenant(pool, auth.tenantId, async (db) => {
      const { rows: users } = await db.query<{
        id: string;
        full_name: string | null;
        email: string;
        role: string;
      }>(
        `SELECT id, full_name, email, role FROM users
          WHERE is_active ORDER BY lower(coalesce(full_name, email)), id`,
      );
      const { rows: channels } = await db.query<{ id: string; display_name: string; type: string }>(
        `SELECT id, display_name, type FROM channels ORDER BY created_at`,
      );
      const { rows: folders } = await db.query<{ id: string; name: string }>(
        `SELECT id, name FROM reply_folders ORDER BY lower(name)`,
      );
      const { rows: uc } = await db.query<{ user_id: string; channel_id: string }>(
        `SELECT user_id, channel_id FROM user_channels`,
      );
      const { rows: uf } = await db.query<{ user_id: string; folder_id: string }>(
        `SELECT user_id, folder_id FROM user_reply_folders`,
      );
      return { users, channels, folders, uc, uf };
    });

    const pick = (rows: { user_id: string }[], key: 'channel_id' | 'folder_id') => {
      const out: Record<string, string[]> = {};
      for (const row of rows) {
        const id = (row as unknown as Record<string, string>)[key]!;
        (out[row.user_id] ??= []).push(id);
      }
      return out;
    };

    return {
      users: data.users.map((u) => ({
        id: u.id,
        name: u.full_name || u.email,
        role: u.role,
        // Владельца и администратора ограничивать нечем: они отвечают
        // за компанию целиком, и галочка у них была бы обманом.
        unrestricted: u.role === 'owner' || u.role === 'admin',
      })),
      channels: data.channels.map((c) => ({ id: c.id, name: c.display_name, type: c.type })),
      folders: data.folders.map((f) => ({ id: f.id, name: f.name })),
      channelIds: pick(data.uc, 'channel_id'),
      folderIds: pick(data.uf, 'folder_id'),
    };
  });

  /** Задать список каналов. Пустой список снимает ограничение. */
  app.put<{ Params: { id: string }; Body: { channelIds?: string[] } }>(
    '/users/:id/channels',
    async (req, reply) => {
      const auth = requireAuth(req);
      if (!auth) return reply.code(401).send(auth401);

      const ids = Array.isArray(req.body?.channelIds) ? req.body!.channelIds!.slice(0, 200) : [];

      const result = await withTenant(pool, auth.tenantId, async (db) => {
        const { rows: who } = await db.query<{ role: string }>(
          `SELECT role FROM users WHERE id = $1`,
          [req.params.id],
        );
        const role = who[0]?.role;
        if (!role) return { error: 'not_found' as const };
        // Ограничивать администратора бессмысленно: он и так видит всё
        // по своей роли, и строки в таблице создавали бы ложное
        // впечатление, будто ограничение работает.
        if (role === 'owner' || role === 'admin') return { error: 'role_unrestricted' as const };

        await db.query(`DELETE FROM user_channels WHERE user_id = $1`, [req.params.id]);
        if (ids.length) {
          await db.query(
            `INSERT INTO user_channels (tenant_id, user_id, channel_id)
             SELECT $1, $2, c.id FROM channels c WHERE c.id = ANY($3::uuid[])
             ON CONFLICT DO NOTHING`,
            [auth.tenantId, req.params.id, ids],
          );
        }
        const { rows } = await db.query<{ channel_id: string }>(
          `SELECT channel_id FROM user_channels WHERE user_id = $1`,
          [req.params.id],
        );
        return { ids: rows.map((r) => r.channel_id) };
      });

      if ('error' in result) {
        return reply.code(result.error === 'not_found' ? 404 : 400).send({
          error: result.error,
          detail: result.error === 'role_unrestricted'
            ? 'Власник і адміністратор бачать усі канали за своєю роллю'
            : 'Співробітника не знайдено',
        });
      }

      app.log.info({ userId: req.params.id, channels: result.ids.length }, 'Доступ к каналам изменён');
      return { channelIds: result.ids, unrestricted: result.ids.length === 0 };
    },
  );

  app.patch<{ Params: { id: string }; Body: { displayName?: string; status?: string } }>(
    '/channels/:id',
    async (req, reply) => {
      const auth = requireAuth(req);
      if (!auth) return reply.code(401).send(auth401);

      const { displayName, status } = req.body ?? {};
      if (status && !['active', 'disconnected'].includes(status)) {
        return reply.code(400).send({ error: 'bad_status' });
      }

      const updated = await withTenant(pool, auth.tenantId, async (db) => {
        const { rowCount } = await db.query(
          `UPDATE channels
              SET display_name = COALESCE($2, display_name),
                  status       = COALESCE($3, status)
            WHERE id = $1`,
          [req.params.id, displayName ?? null, status ?? null],
        );
        return (rowCount ?? 0) > 0;
      });

      if (!updated) return reply.code(404).send({ error: 'not_found' });
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>('/channels/:id', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const removed = await withTenant(pool, auth.tenantId, async (db) => {
      const { rowCount } = await db.query(`DELETE FROM channels WHERE id = $1`, [req.params.id]);
      return (rowCount ?? 0) > 0;
    });

    if (!removed) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  // ── Пользователи ──────────────────────────────────────────────────
  app.get('/users', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const rows = await withTenant(pool, auth.tenantId, async (db) => {
      const { rows } = await db.query(
        `SELECT id, email, full_name, role, is_active, last_seen_at, created_at
           FROM users ORDER BY created_at ASC`,
      );
      return rows;
    });

    return { users: rows };
  });

  app.post<{ Body: { email?: string; fullName?: string; role?: string } }>(
    '/users',
    async (req, reply) => {
      const auth = requireAuth(req);
      if (!auth) return reply.code(401).send(auth401);

      const { email, fullName, role } = req.body ?? {};
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return reply.code(400).send({ error: 'bad_email' });
      }
      const r = role ?? 'agent';
      if (!['owner', 'admin', 'agent', 'viewer'].includes(r)) {
        return reply.code(400).send({ error: 'bad_role' });
      }

      const result = await withTenant(pool, auth.tenantId, async (db) => {
        // Лимит мест — из тарифа. Проверяем здесь, а не в интерфейсе:
        // интерфейс можно обойти, ручку — нет.
        const { rows: seats } = await db.query<{ used: string }>(
          `SELECT count(*) AS used FROM users WHERE is_active`,
        );
        const limit = await withSystem(pool, 'лимит мест', async (sdb) => {
          const { rows } = await sdb.query<{ seats_limit: number }>(
            `SELECT seats_limit FROM tenants WHERE id = $1`,
            [auth.tenantId],
          );
          return rows[0]?.seats_limit ?? 3;
        });
        if (Number(seats[0]!.used) >= limit) {
          return { error: 'seats_limit_reached' as const, limit };
        }

        const { rows } = await db.query<{ id: string }>(
          `INSERT INTO users (tenant_id, email, full_name, role, is_active)
           VALUES ($1, $2, $3, $4, true)
           ON CONFLICT (tenant_id, email) DO UPDATE
             SET is_active = true, role = EXCLUDED.role,
                 full_name = COALESCE(EXCLUDED.full_name, users.full_name)
           RETURNING id`,
          [auth.tenantId, email, fullName ?? '', r],
        );
        return { id: rows[0]!.id };
      });

      if ('error' in result) return reply.code(409).send(result);
      return reply.code(201).send(result);
    },
  );

  app.patch<{ Params: { id: string }; Body: { role?: string; isActive?: boolean } }>(
    '/users/:id',
    async (req, reply) => {
      const auth = requireAuth(req);
      if (!auth) return reply.code(401).send(auth401);

      const { role, isActive } = req.body ?? {};
      if (role && !['owner', 'admin', 'agent', 'viewer'].includes(role)) {
        return reply.code(400).send({ error: 'bad_role' });
      }

      // Нельзя отключить самого себя: иначе владелец одним кликом
      // лишает себя доступа и восстановить может только через консоль.
      if (req.params.id === auth.userId && isActive === false) {
        return reply.code(409).send({ error: 'cannot_disable_self' });
      }

      const ok = await withTenant(pool, auth.tenantId, async (db) => {
        const { rowCount } = await db.query(
          `UPDATE users
              SET role = COALESCE($2, role),
                  is_active = COALESCE($3, is_active)
            WHERE id = $1`,
          [req.params.id, role ?? null, isActive ?? null],
        );
        return (rowCount ?? 0) > 0;
      });

      if (!ok) return reply.code(404).send({ error: 'not_found' });
      return { ok: true };
    },
  );

  // ── Шаблоны быстрых ответов ───────────────────────────────────────
  app.get('/quick-replies', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    /*
     * Шаблоны отдаются только из тех папок, которыми человеку
     * разрешено пользоваться. Условие стоит в запросе, а не проверкой
     * после: список уходит и в поле ответа, и в настройки, и забыть
     * его в одном из мест — значит открыть всё.
     *
     * Шаблоны вне папок видны всем: «без папки» — это не папка, дать
     * или отнять там нечего.
     */
    const rows = await withTenant(pool, auth.tenantId, async (db) => {
      const { rows } = await db.query<{ shortcut: string; folder: string }>(
        `SELECT id, shortcut, body, attachments, folder, created_at
           FROM quick_replies q
          WHERE q.folder = '' OR ${folderScope('q.folder', '$1')}`,
        [auth.userId],
      );
      return rows;
    });

    /*
     * Порядок задаёт код, а не SQL: тот же список показывается в поле
     * ответа, и правило «папки по алфавиту, без папки — в конец, внутри
     * по сокращению» должно быть записано ровно в одном месте. В SQL
     * оно жило бы вторым, чуть-чуть другим — с иным пониманием
     * регистра и украинской буквы «і».
     */
    const groups = groupByFolder(rows);

    /*
     * Пустая папка существует: человек заводит её заранее, чтобы было
     * куда класть. Поэтому список папок — это список, а не то, что
     * удалось вычитать из шаблонов. Имена с шаблонов всё равно
     * подмешиваем: если строка в списке когда-нибудь потеряется, папка
     * не должна пропасть из настроек вместе с ней.
     */
    const list = await withTenant(pool, auth.tenantId, async (db) => {
      const { rows } = await db.query<{ name: string }>(
        `SELECT name FROM reply_folders f WHERE ${folderScope('f.name', '$1')}`,
        [auth.userId],
      );
      return rows.map((r) => r.name);
    });

    const seen = new Set<string>();
    const folders: string[] = [];
    for (const name of [...list, ...folderNames(rows)]) {
      const key = replyFolder(name).toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      folders.push(replyFolder(name));
    }
    folders.sort((a, b) => a.localeCompare(b, 'uk'));

    return { quickReplies: groups.flatMap((g) => g.items), folders };
  });

  app.post<{ Body: { shortcut?: string; body?: string; folder?: string } }>(
    '/quick-replies',
    async (req, reply) => {
      const auth = requireAuth(req);
      if (!auth) return reply.code(401).send(auth401);

      const shortcut = (req.body?.shortcut ?? '').trim().replace(/^\//, '');
      const body = (req.body?.body ?? '').trim();
      if (!shortcut || !body) return reply.code(400).send({ error: 'shortcut_and_body_required' });
      if (shortcut.length > 32) return reply.code(400).send({ error: 'shortcut_too_long' });

      const folder = replyFolder(req.body?.folder);

      const id = await withTenant(pool, auth.tenantId, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `INSERT INTO quick_replies (tenant_id, shortcut, body, folder)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (tenant_id, shortcut)
             DO UPDATE SET body = EXCLUDED.body, folder = EXCLUDED.folder
           RETURNING id`,
          [auth.tenantId, shortcut, body, folder],
        );
        if (folder) {
          await db.query(
            `INSERT INTO reply_folders (tenant_id, name) VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [auth.tenantId, folder],
          );
        }
        return rows[0]!.id;
      });

      return reply.code(201).send({ id, shortcut, folder });
    },
  );

  /**
   * Заведение пустой папки.
   *
   * Пустая папка — это не недоделанная папка, а нормальное начало: люди
   * раскладывают по папкам так же, как бумаги, — сперва подписывают
   * ящик, потом кладут. Без этого «создать папку» означало бы «создать
   * шаблон», и человек не нашёл бы, где вообще создаются папки.
   */
  app.post<{ Body: { name?: string } }>('/quick-replies/folders', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const name = replyFolder(req.body?.name);
    if (!name) return reply.code(400).send({ error: 'folder_required' });

    const made = await withTenant(pool, auth.tenantId, async (db) => {
      try {
        await db.query(`INSERT INTO reply_folders (tenant_id, name) VALUES ($1, $2)`, [
          auth.tenantId,
          name,
        ]);
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === '23505') return false;
        throw err;
      }
    });

    if (!made) return reply.code(409).send({ error: 'duplicate' });
    return reply.code(201).send({ folder: name });
  });

  /**
   * Удаление папки.
   *
   * Шаблоны остаются. Папку убрали — они выходят из неё и лежат дальше
   * сами по себе. Удалять переписку заготовок заодно с ящиком, в
   * котором они лежали, — не то, чего ждут от кнопки «видалити папку»,
   * и не то, что можно потом вернуть.
   *
   * Имя приходит телом, а не в адресе: в имени бывает косая черта, и
   * маршрут с ней разбирается по-разному в разных местах.
   */
  app.delete<{ Body: { name?: string } }>('/quick-replies/folders', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const name = replyFolder(req.body?.name);
    if (!name) return reply.code(400).send({ error: 'folder_required' });

    const out = await withTenant(pool, auth.tenantId, async (db) => {
      const { rowCount } = await db.query(
        `DELETE FROM reply_folders WHERE lower(name) = lower($1)`,
        [name],
      );
      const moved = await db.query(
        `UPDATE quick_replies SET folder = '' WHERE lower(folder) = lower($1)`,
        [name],
      );
      return { gone: (rowCount ?? 0) > 0, moved: moved.rowCount ?? 0 };
    });

    // Папки могло не быть в списке, но имя стоять на шаблонах: тогда
    // удалять всё равно есть что, и отвечать «не найдено» — врать.
    if (!out.gone && !out.moved) return reply.code(404).send({ error: 'not_found' });
    return { ok: true, moved: out.moved };
  });

  /**
   * Переименование папки.
   *
   * Отдельной ручкой, а не перебором шаблонов из браузера: папка на
   * двадцать шаблонов переименовалась бы двадцатью запросами, и любой
   * обрыв посередине оставил бы половину в старой папке, половину в
   * новой. Здесь это один UPDATE.
   *
   * Он же — способ склеить две папки: переименовали «доставку» в
   * «Доставка» — шаблоны сошлись. И способ вынести из папки: пустое имя
   * означает «без папки».
   */
  app.patch<{ Body: { from?: string; to?: string } }>(
    '/quick-replies/folders',
    async (req, reply) => {
      const auth = requireAuth(req);
      if (!auth) return reply.code(401).send(auth401);

      const from = replyFolder(req.body?.from);
      const to = replyFolder(req.body?.to);
      if (!from) return reply.code(400).send({ error: 'folder_required' });

      const out = await withTenant(pool, auth.tenantId, async (db) => {
        // Сравнение без регистра: человек переименовывает ту папку,
        // которую видит, а видит он её в том виде, в каком показали.
        const { rowCount } = await db.query(
          `UPDATE quick_replies SET folder = $2 WHERE lower(folder) = lower($1)`,
          [from, to],
        );

        /*
         * Список папок правится тем же запросом. Пустое новое имя
         * означает «вынести всё из папки», и сама папка при этом
         * удаляется: иначе в настройках осталась бы папка без имени.
         */
        if (!to) {
          await db.query(`DELETE FROM reply_folders WHERE lower(name) = lower($1)`, [from]);
        } else {
          try {
            await db.query(
              `UPDATE reply_folders SET name = $2 WHERE lower(name) = lower($1)`,
              [from, to],
            );
          } catch (err) {
            // Переименовали в имя, которое уже занято: две папки
            // сливаются в одну, и лишнюю строку списка просто убираем.
            if ((err as { code?: string }).code !== '23505') throw err;
            await db.query(`DELETE FROM reply_folders WHERE lower(name) = lower($1)`, [from]);
          }
        }
        return rowCount ?? 0;
      });

      return { moved: out, folder: to };
    },
  );

  /** Перенос одного шаблона: та же папка, но для одной строки. */
  app.patch<{ Params: { id: string }; Body: { folder?: string } }>(
    '/quick-replies/:id',
    async (req, reply) => {
      const auth = requireAuth(req);
      if (!auth) return reply.code(401).send(auth401);
      if (req.body?.folder === undefined) return reply.code(400).send({ error: 'nothing' });

      const folder = replyFolder(req.body.folder);
      const ok = await withTenant(pool, auth.tenantId, async (db) => {
        const { rowCount } = await db.query(
          `UPDATE quick_replies SET folder = $2 WHERE id = $1`,
          [req.params.id, folder],
        );
        // Папка, названная при переносе, заводится сама: человек уже
        // сказал, куда класть, и переспрашивать «а создать её?» незачем.
        if ((rowCount ?? 0) > 0 && folder) {
          await db.query(
            `INSERT INTO reply_folders (tenant_id, name) VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [auth.tenantId, folder],
          );
        }
        return (rowCount ?? 0) > 0;
      });

      if (!ok) return reply.code(404).send({ error: 'not_found' });
      return { ok: true, folder };
    },
  );

  app.delete<{ Params: { id: string } }>('/quick-replies/:id', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const ok = await withTenant(pool, auth.tenantId, async (db) => {
      const { rowCount } = await db.query(`DELETE FROM quick_replies WHERE id = $1`, [
        req.params.id,
      ]);
      return (rowCount ?? 0) > 0;
    });

    if (!ok) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  /**
   * Подключение Viber для бизнеса.
   *
   * «Номерного» Viber здесь нет намеренно: открытого протокола для
   * личных аккаунтов у Viber не существует, а библиотеки, которые
   * притворяются телефоном, нарушают правила — номер за это блокируют.
   * Подключается Viber Business Messages через официального партнёра:
   * клиент приносит ключ из кабинета и имя отправителя, которое
   * прошло модерацию.
   *
   * Ключ проверяется сразу: список отправителей заодно показывает, то
   * ли имя написал человек. Иначе про опечатку узнают в тот момент,
   * когда клиент уже написал, а ответ не ушёл.
   */
  app.post<{ Body: { token?: string; sender?: string; displayName?: string } }>(
    '/settings/channels/viber',
    async (req, reply) => {
      const auth = requireAuth(req);
      if (!auth) return reply.code(401).send(auth401);

      const token = (req.body?.token ?? '').trim();
      const sender = (req.body?.sender ?? '').trim();
      if (!token || !sender) return reply.code(400).send({ error: 'token_and_sender_required' });

      let senders: Array<{ id: string; name: string; status: string }> = [];
      try {
        senders = await viberSenders(token);
      } catch (err) {
        const detail = err instanceof ViberError ? err.message : 'Партнер не відповів';
        return reply.code(400).send({ error: 'check_failed', detail });
      }

      const found = senders.find((s) => s.name.toLowerCase() === sender.toLowerCase());
      if (!found) {
        return reply.code(400).send({
          error: 'sender_not_found',
          detail: senders.length
            ? `У вас є відправники: ${senders.map((s) => s.name).join(', ')}`
            : 'У цього ключа немає жодного відправника Viber',
        });
      }

      const owner = await withSystem(pool, 'владелец канала Viber', async (db) => {
        const { rows } = await db.query<{ channel_id: string; tenant_id: string }>(
          `SELECT channel_id, tenant_id FROM channel_routes
            WHERE channel_type = $1 AND external_id = $2 LIMIT 1`,
          [VIBER_CHANNEL, found.name],
        );
        return rows[0] ?? null;
      });

      if (owner && owner.tenant_id !== auth.tenantId) {
        return reply.code(409).send({
          error: 'channel_belongs_to_another_tenant',
          detail: 'Цей відправник уже підключений в іншому акаунті.',
        });
      }

      const channelId = owner?.channel_id ?? randomUUID();

      await withTenant(pool, auth.tenantId, async (db) => {
        await db.query(
          `INSERT INTO channels (id, tenant_id, type, display_name, external_id,
                                 credentials_enc, meta, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
           ON CONFLICT (type, external_id) DO UPDATE
             SET display_name = EXCLUDED.display_name,
                 credentials_enc = EXCLUDED.credentials_enc,
                 meta = EXCLUDED.meta, status = 'active', last_error = NULL`,
          [
            channelId,
            auth.tenantId,
            VIBER_CHANNEL,
            req.body?.displayName?.trim() || found.name,
            found.name,
            encryptJson(masterKey, auth.tenantId, { token, sender: found.name }),
            JSON.stringify({ sender: found.name, senderStatus: found.status, partner: 'turbosms' }),
          ],
        );
      });

      app.log.info({ channelId, sender: found.name }, 'Подключён Viber для бизнеса');
      return reply.code(201).send({ id: channelId, sender: found.name, status: found.status });
    },
  );

  // ── Подключение Telegram-бота из интерфейса ───────────────────────
  app.post<{ Body: { botToken?: string; displayName?: string; mode?: string } }>(
    '/settings/channels/telegram',
    async (req, reply) => {
      const auth = requireAuth(req);
      if (!auth) return reply.code(401).send(auth401);

      const botToken = (req.body?.botToken ?? '').trim();
      if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(botToken)) {
        return reply.code(400).send({ error: 'invalid_bot_token' });
      }

      const meRes = await fetch(`${deps.telegramApiRoot}/bot${botToken}/getMe`);
      const me = (await meRes.json()) as {
        ok: boolean;
        result?: { id: number; username?: string; first_name?: string };
      };
      if (!me.ok || !me.result) {
        return reply.code(400).send({ error: 'telegram_rejected_token' });
      }

      const bot = me.result;
      const externalId = String(bot.id);

      const owner = await withSystem(pool, 'владелец канала', async (db) => {
        const { rows } = await db.query<{ channel_id: string; tenant_id: string }>(
          `SELECT channel_id, tenant_id FROM channel_routes
            WHERE channel_type = 'telegram_bot' AND external_id = $1 LIMIT 1`,
          [externalId],
        );
        return rows[0] ?? null;
      });

      if (owner && owner.tenant_id !== auth.tenantId) {
        return reply.code(409).send({
          error: 'channel_belongs_to_another_tenant',
          detail: 'Цей бот уже підключений в іншому акаунті.',
        });
      }

      const channelId = owner?.channel_id ?? randomUUID();

      await withTenant(pool, auth.tenantId, async (db) => {
        await db.query(
          `INSERT INTO channels (id, tenant_id, type, display_name, external_id,
                                 credentials_enc, meta, status)
           VALUES ($1, $2, 'telegram_bot', $3, $4, $5, $6, 'active')
           ON CONFLICT (type, external_id) DO UPDATE
             SET display_name = EXCLUDED.display_name,
                 credentials_enc = EXCLUDED.credentials_enc,
                 meta = EXCLUDED.meta, status = 'active', last_error = NULL`,
          [
            channelId,
            auth.tenantId,
            req.body?.displayName?.trim() || bot.username || 'Telegram',
            externalId,
            encryptJson(masterKey, auth.tenantId, { botToken }),
            JSON.stringify({ username: bot.username, name: bot.first_name }),
          ],
        );
      });

      let mode: 'polling' | 'webhook' | 'forward' = 'polling';

      /**
       * Свой бот клиента.
       *
       * Вебхук у Telegram один на бота: поставив свой, мы отобрали бы
       * обновления у чужого кода. Поэтому для самописных ботов другой
       * порядок — их код продолжает получать обновления как раньше и
       * присылает нам копию на выданный адрес. Отправка идёт через тот
       * же токен, так что отвечать можно и из Rozmovio, и из их кода.
       */
      if (req.body?.mode === 'forward') {
        await withTenant(pool, auth.tenantId, async (db) => {
          await db.query(
            `UPDATE channels SET meta = meta || $2::jsonb WHERE id = $1`,
            [channelId, JSON.stringify({ mode: 'forward' })],
          );
        });
        app.log.info({ channelId }, 'Подключён свой бот Telegram: режим пересылки');
        return reply.code(201).send({
          id: channelId,
          username: bot.username,
          mode: 'forward',
          forward: {
            url: `${deps.publicUrl}/webhooks/telegram/${channelId}`,
            secret: telegramForwardSecret(deps.telegramWebhookSecret, channelId),
            header: 'X-Telegram-Bot-Api-Secret-Token',
          },
        });
      }

      if (deps.publicUrl) {
        const hookRes = await fetch(`${deps.telegramApiRoot}/bot${botToken}/setWebhook`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            url: `${deps.publicUrl}/webhooks/telegram/${channelId}`,
            secret_token: deps.telegramWebhookSecret,
            max_connections: 40,
            allowed_updates: [
              'message', 'edited_message', 'message_reaction',
              'business_connection', 'business_message',
              'edited_business_message', 'deleted_business_messages',
            ],
            drop_pending_updates: true,
          }),
        });
        const hook = (await hookRes.json()) as { ok: boolean; description?: string };
        if (!hook.ok) {
          await withTenant(pool, auth.tenantId, async (db) => {
            await db.query(
              `UPDATE channels SET status = 'degraded', last_error = $2 WHERE id = $1`,
              [channelId, JSON.stringify({ setWebhook: hook.description })],
            );
          });
          return reply.code(502).send({
            error: 'webhook_registration_failed',
            detail: hook.description,
          });
        }
        mode = 'webhook';
      } else {
        await fetch(`${deps.telegramApiRoot}/bot${botToken}/deleteWebhook`, { method: 'POST' })
          .catch(() => undefined);
      }

      app.log.info(
        { channelId, bot: bot.username, token: maskSecret(botToken), mode },
        'Канал Telegram подключён из интерфейса',
      );

      return { channelId, username: bot.username, mode };
    },
  );

  // ── Номерной Telegram: вход по QR ─────────────────────────────────
  //
  // Сам вход выполняет сервис sessions: там живут MTProto-соединения.
  // api только ставит задачу и отдаёт интерфейсу её состояние из Redis.
  // Состояние привязано к тенанту: чужой loginId ничего не покажет.
  const mtp = deps.mtproto;

  async function readLogin(loginId: string): Promise<MtprotoLoginState | null> {
    if (!mtp) return null;
    const raw = await mtp.redis.get(mtprotoLoginKey(loginId));
    return raw ? (JSON.parse(raw) as MtprotoLoginState) : null;
  }

  app.post<{ Body: { displayName?: string } }>(
    '/settings/channels/telegram-user/start',
    async (req, reply) => {
      const auth = requireAuth(req);
      if (!auth) return reply.code(401).send(auth401);
      if (!mtp) return reply.code(503).send({ error: 'mtproto_unavailable' });

      const loginId = randomUUID();
      const state: MtprotoLoginState = { tenantId: auth.tenantId, state: 'starting' };
      await mtp.redis.set(mtprotoLoginKey(loginId), JSON.stringify(state), 'EX', 600);
      const job: MtprotoLoginJob = { loginId, tenantId: auth.tenantId };
      const name = req.body?.displayName?.trim();
      if (name) job.displayName = name.slice(0, 80);
      await mtp.loginQueue.add('login', job, { jobId: loginId });
      return { loginId };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/settings/channels/telegram-user/login/:id',
    async (req, reply) => {
      const auth = requireAuth(req);
      if (!auth) return reply.code(401).send(auth401);
      const st = await readLogin(req.params.id);
      if (!st || st.tenantId !== auth.tenantId) return reply.code(404).send({ error: 'not_found' });

      // QR рисуем здесь, а не в браузере: так не нужна клиентская
      // библиотека, а страница остаётся одним файлом без зависимостей.
      const qrSvg =
        st.state === 'qr' && st.qrUrl
          ? await QRCode.toString(st.qrUrl, { type: 'svg', margin: 1, width: 240 })
          : null;
      return {
        state: st.state,
        qrSvg,
        passwordHint: st.passwordHint ?? null,
        passwordError: !!st.passwordError,
        channelId: st.channelId ?? null,
        error: st.error ?? null,
      };
    },
  );

  app.post<{ Params: { id: string }; Body: { password?: string } }>(
    '/settings/channels/telegram-user/login/:id/password',
    async (req, reply) => {
      const auth = requireAuth(req);
      if (!auth) return reply.code(401).send(auth401);
      const st = await readLogin(req.params.id);
      if (!mtp || !st || st.tenantId !== auth.tenantId) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const password = req.body?.password ?? '';
      if (!password || password.length > 256) return reply.code(400).send({ error: 'bad_password' });
      // Пароль лежит в Redis 60 секунд максимум и удаляется сразу
      // после чтения сервисом sessions. В базу и в логи не попадает.
      await mtp.redis.set(mtprotoPasswordKey(req.params.id), password, 'EX', 60);
      await mtp.redis.set(
        mtprotoLoginKey(req.params.id),
        JSON.stringify({ ...st, state: 'starting' }),
        'EX',
        600,
      );
      return { ok: true };
    },
  );


  // ── Messenger и Instagram: вход через Facebook ────────────────────
  //
  // Порядок:
  //   1. /settings/channels/meta/start — ссылка на окно входа Facebook;
  //   2. Facebook возвращает человека на /meta/callback с кодом;
  //   3. код меняем на токен, берём список страниц, прячем его в Redis
  //      на 15 минут и отправляем человека обратно в приложение;
  //   4. человек выбирает страницы — /settings/channels/meta/pick/:id.
  //
  // На шаге 2 нашего токена в запросе нет: это переход браузера, а не
  // вызов API. Тенант и пользователь едут в параметре state, подписанном
  // HMAC, — подделать его, чтобы подключить страницу к чужой организации,
  // нельзя.
  const meta = deps.meta;
  const pickKey = (id: string) => `meta:pick:${id}`;

  function signState(payload: Record<string, unknown>): string {
    if (!meta) throw new Error('meta not configured');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = createHmac('sha256', meta.stateSecret).update(body).digest('base64url');
    return `${body}.${sig}`;
  }

  function readState(state: string): { t: string; u: string; exp: number } | null {
    if (!meta) return null;
    const [body, sig] = state.split('.');
    if (!body || !sig) return null;
    const expect = createHmac('sha256', meta.stateSecret).update(body).digest('base64url');
    if (!safeEqual(expect, sig)) return null;
    try {
      const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
        t: string; u: string; exp: number;
      };
      return p.exp > Date.now() ? p : null;
    } catch {
      return null;
    }
  }

  const redirectUri = () => `${meta?.appUrl ?? ''}/meta/callback`;

  interface PickPage {
    id: string;
    name: string;
    token: string;
    picture: string | null;
    ig: { id: string; username: string | null } | null;
  }

  app.get('/settings/channels/meta/start', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);
    if (!meta) return reply.code(503).send({ error: 'meta_unavailable' });
    const state = signState({ t: auth.tenantId, u: auth.userId, exp: Date.now() + 15 * 60_000 });
    const u = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
    u.searchParams.set('client_id', meta.appId);
    u.searchParams.set('redirect_uri', redirectUri());
    u.searchParams.set('state', state);
    u.searchParams.set('response_type', 'code');
    // Приложения типа «Бизнес» входят через «Вход через Facebook для бизнеса»:
    // набор разрешений задаётся конфигурацией в кабинете Meta, и в ссылку
    // идёт её id. Без конфигурации — классический список разрешений.
    if (meta.configId) u.searchParams.set('config_id', meta.configId);
    else u.searchParams.set('scope', META_LOGIN_SCOPES.join(','));
    return { url: u.toString() };
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string; error_reason?: string } }>(
    '/meta/callback',
    async (req, reply) => {
      const back = (hash: string) => reply.redirect(`/app#${hash}`);
      if (!meta) return back('meta-error=unavailable');
      const st = readState(req.query.state ?? '');
      if (!st) return back('meta-error=state');
      if (req.query.error || !req.query.code) return back('meta-error=cancelled');

      try {
        const short = await graphGet<{ access_token: string }>('oauth/access_token', {
          client_id: meta.appId,
          client_secret: meta.appSecret,
          redirect_uri: redirectUri(),
          code: req.query.code,
        });
        // Долгоживущий токен пользователя. Токены страниц, полученные
        // через него, бессрочные — пока владелец не отзовёт доступ.
        const long = await graphGet<{ access_token: string }>('oauth/access_token', {
          grant_type: 'fb_exchange_token',
          client_id: meta.appId,
          client_secret: meta.appSecret,
          fb_exchange_token: short.access_token,
        });
        const accounts = await graphGet<{
          data: Array<{
            id: string;
            name: string;
            access_token: string;
            picture?: { data?: { url?: string } };
            instagram_business_account?: { id: string; username?: string };
          }>;
        }>('me/accounts', {
          fields: 'id,name,access_token,picture{url},instagram_business_account{id,username}',
          limit: '100',
          access_token: long.access_token,
        });

        const pages: PickPage[] = accounts.data.map((p) => ({
          id: p.id,
          name: p.name,
          token: p.access_token,
          picture: p.picture?.data?.url ?? null,
          ig: p.instagram_business_account
            ? { id: p.instagram_business_account.id, username: p.instagram_business_account.username ?? null }
            : null,
        }));

        const pickId = randomUUID();
        // Токены страниц в Redis — только зашифрованными и на 15 минут.
        const blob = encryptJson(masterKey, st.t, { tenantId: st.t, pages }).toString('base64');
        await meta.redis.set(pickKey(pickId), blob, 'EX', 900);
        return back(`meta-pick=${pickId}`);
      } catch (err) {
        app.log.warn({ error: (err as Error).message }, 'Вход через Facebook не удался');
        return back('meta-error=exchange');
      }
    },
  );

  async function loadPick(id: string, tenantId: string): Promise<PickPage[] | null> {
    if (!meta) return null;
    const blob = await meta.redis.get(pickKey(id));
    if (!blob) return null;
    try {
      const data = decryptJson<{ tenantId: string; pages: PickPage[] }>(
        masterKey,
        tenantId,
        Buffer.from(blob, 'base64'),
      );
      return data.tenantId === tenantId ? data.pages : null;
    } catch {
      // Расшифровка ключом другого тенанта не проходит — чужой выбор не виден.
      return null;
    }
  }

  app.get<{ Params: { id: string } }>('/settings/channels/meta/pick/:id', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);
    const pages = await loadPick(req.params.id, auth.tenantId);
    if (!pages) return reply.code(404).send({ error: 'expired' });
    // Токены не отдаём в браузер: только то, по чему страницу узнают.
    return {
      pages: pages.map((p) => ({ id: p.id, name: p.name, picture: p.picture, instagram: p.ig })),
    };
  });

  app.post<{
    Params: { id: string };
    Body: {
      pages?: Array<{
        id: string;
        messenger?: boolean;
        instagram?: boolean;
        messengerComments?: boolean;
        instagramComments?: boolean;
      }>;
    };
  }>('/settings/channels/meta/pick/:id', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);
    if (!meta) return reply.code(503).send({ error: 'meta_unavailable' });
    const pages = await loadPick(req.params.id, auth.tenantId);
    if (!pages) return reply.code(404).send({ error: 'expired' });

    const results: Array<{ page: string; type: string; ok: boolean; error?: string }> = [];

    for (const sel of req.body?.pages ?? []) {
      const page = pages.find((p) => p.id === sel.id);
      if (!page) continue;

      type PickType = 'messenger' | 'instagram' | 'messenger_comments' | 'instagram_comments';
      const wanted: Array<{ type: PickType; externalId: string; name: string }> = [];
      if (sel.messenger) wanted.push({ type: 'messenger', externalId: page.id, name: page.name });
      if (sel.instagram && page.ig) {
        wanted.push({
          type: 'instagram',
          externalId: page.ig.id,
          name: page.ig.username ? `@${page.ig.username}` : page.name,
        });
      }
      // Комментарии — отдельный канал у той же страницы: внешний
      // идентификатор тот же, а тип другой, и это ровно то, что
      // разводит комментарии и личку по разным диалогам.
      if (sel.messengerComments) {
        wanted.push({
          type: 'messenger_comments',
          externalId: page.id,
          name: `${page.name} — коментарі`,
        });
      }
      if (sel.instagramComments && page.ig) {
        wanted.push({
          type: 'instagram_comments',
          externalId: page.ig.id,
          name: (page.ig.username ? `@${page.ig.username}` : page.name) + ' — коментарі',
        });
      }
      if (!wanted.length) continue;

      // Подписка страницы на вебхуки нашего приложения. Без неё Meta
      // не присылает ни Messenger, ни Instagram этой страницы.
      try {
        // Поля подписки зависят от выбора: лента страницы нужна только
        // тем, кто берёт комментарии, и просить её у остальных — значит
        // получать вебхуки на каждый лайк чужой страницы.
        const fields = [...PAGE_SUBSCRIBED_FIELDS];
        if (sel.messengerComments || sel.instagramComments) fields.push(...COMMENT_SUBSCRIBED_FIELDS);
        await graphPost('' + page.id + '/subscribed_apps', {
          subscribed_fields: fields.join(','),
          access_token: page.token,
        }, undefined);
      } catch (err) {
        const msg = err instanceof MetaApiError ? err.body.message ?? err.message : String(err);
        for (const w of wanted) results.push({ page: page.name, type: w.type, ok: false, error: msg });
        continue;
      }

      for (const w of wanted) {
        const owner = await withSystem(pool, 'владелец канала Meta', async (db) => {
          const { rows } = await db.query<{ channel_id: string; tenant_id: string }>(
            `SELECT channel_id, tenant_id FROM channel_routes
              WHERE channel_type = $1 AND external_id = $2 LIMIT 1`,
            [w.type, w.externalId],
          );
          return rows[0] ?? null;
        });
        if (owner && owner.tenant_id !== auth.tenantId) {
          results.push({ page: w.name, type: w.type, ok: false, error: 'Уже подключено в другой организации' });
          continue;
        }
        const creds: Record<string, string> = { pageId: page.id, pageToken: page.token };
        if ((w.type === 'instagram' || w.type === 'instagram_comments') && page.ig) {
          creds['igId'] = page.ig.id;
        }
        await withTenant(pool, auth.tenantId, async (db) => {
          await db.query(
            `INSERT INTO channels (id, tenant_id, type, display_name, external_id,
                                   credentials_enc, meta, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
             ON CONFLICT (type, external_id) DO UPDATE
               SET credentials_enc = EXCLUDED.credentials_enc,
                   meta = EXCLUDED.meta, status = 'active', last_error = NULL`,
            [
              owner?.channel_id ?? randomUUID(),
              auth.tenantId,
              w.type,
              w.name,
              w.externalId,
              encryptJson(masterKey, auth.tenantId, creds),
              JSON.stringify(
                w.type === 'instagram' || w.type === 'instagram_comments'
                  ? { username: page.ig?.username ?? null, pageId: page.id, pageName: page.name }
                  : { pageName: page.name, picture: page.picture },
              ),
            ],
          );
        });
        results.push({ page: w.name, type: w.type, ok: true });
      }
    }

    // При частичной неудаче выбор оставляем: можно исправить причину
    // (например, выдать права на страницу) и нажать ещё раз без повторного входа.
    if (results.every((r) => r.ok)) await meta.redis.del(pickKey(req.params.id));
    app.log.info({ tenantId: auth.tenantId, connected: results.filter((r) => r.ok).length }, 'Страницы Meta подключены');
    return { results };
  });

}

/**
 * Довести введённый идентификатор до настоящего аккаунта WhatsApp.
 *
 * Принимаем и идентификатор аккаунта, и идентификатор бизнес-портфолио:
 * человек берёт их из одного адреса, и путает их закономерно.
 * Принадлежность проверяем по номеру — он тут единственное, что мы знаем
 * наверняка.
 */
async function resolveWaba(
  id: string,
  token: string,
  phoneNumberId: string,
): Promise<string | null> {
  const numbersOf = async (waba: string): Promise<string[]> => {
    const res = await graphGet<{ data?: Array<{ id?: string }> }>(`${waba}/phone_numbers`, {
      access_token: token,
      fields: 'id',
    });
    return (res.data ?? []).map((n) => String(n.id ?? ''));
  };

  // Сам аккаунт: у него есть номера, и среди них должен быть наш.
  try {
    const nums = await numbersOf(id);
    if (nums.includes(phoneNumberId)) return id;
    // Аккаунт настоящий, но номер в другом — значит выбран не тот.
    if (nums.length) return null;
  } catch {
    /* не аккаунт — пробуем как портфолио */
  }

  for (const edge of ['owned_whatsapp_business_accounts', 'client_whatsapp_business_accounts']) {
    try {
      const res = await graphGet<{ data?: Array<{ id?: string }> }>(`${id}/${edge}`, {
        access_token: token,
      });
      for (const row of res.data ?? []) {
        const candidate = String(row.id ?? '');
        if (!candidate) continue;
        try {
          if ((await numbersOf(candidate)).includes(phoneNumberId)) return candidate;
        } catch {
          /* к этому аккаунту доступа нет — смотрим следующий */
        }
      }
    } catch {
      /* портфолио тоже не подошло — остаётся следующая связь */
    }
  }

  return null;
}

/**
 * Адрес, на который мы будем стучаться.
 *
 * Проверка здесь не про опечатки, а про то, куда именно мы пойдём с
 * сервера. Адрес задаёт клиент, а запрос уходит из нашей сети — значит
 * этим полем можно попросить нас постучаться во внутренний адрес,
 * которого снаружи не видно. Поэтому только https и только наружу.
 */
function badOutUrl(raw: string): string | null {
  if (!raw) return 'Вкажіть адресу для вихідних повідомлень';
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return 'Адреса має бути повною, разом з https://';
  }
  if (u.protocol !== 'https:') return 'Адреса має починатися з https://';

  const host = u.hostname.toLowerCase();
  const local =
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^(127|10)\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    host === '0.0.0.0' ||
    host === '[::1]';
  if (local) return 'Адреса має бути доступною ззовні, а не внутрішньою';

  return null;
}
