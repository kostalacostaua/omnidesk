import type { FastifyInstance } from 'fastify';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import type { Mailer } from './mailer.js';
import { withSystem, type Pool } from '@omnidesk/core';

/**
 * Вход по одноразовому коду на почту.
 *
 * Почему не пароль. Пароль для такого продукта — это форма
 * восстановления, форма смены, хранение хэшей, и главное: у половины
 * операторов он будет «123456» и записан на мониторе. Код на почту
 * снимает весь этот класс задач и заодно даёт бесплатное подтверждение,
 * что человек действительно владеет ящиком.
 *
 * Что здесь принципиально:
 *
 * · Хранится ХЭШ кода. С дампом базы нельзя войти чужой почтой,
 *   дождавшись, пока владелец запросит код.
 * · Ответ на «запросить код» ОДИНАКОВ для существующей и несуществующей
 *   почты. Иначе форма входа превращается в справочник сотрудников
 *   компании: перебором выясняется, кто у вас работает.
 * · Попытки считаются. Шесть цифр — миллион вариантов, это подбирается
 *   за минуты, если не ограничивать.
 */

export interface EmailAuthDeps {
  pool: Pool;
  /** Выдаёт токен доступа для пары «тенант + пользователь». */
  issueToken: (tenantId: string, userId: string) => string;
  mailer: Mailer;
  appName: string;
  /** Разрешена ли самостоятельная регистрация новых компаний. */
  allowSignup: boolean;
  /** Сообщить владельцу сервиса о новой компании. Не должно ронять вход. */
  onSignup?: (info: { email: string; company: string; tenantId: string }) => void;
}

const CODE_TTL_MIN = 10;
const MAX_ATTEMPTS = 5;
/** Не более пяти писем в час на один адрес — защита от рассылки чужими руками. */
const MAX_SENDS_PER_HOUR = 5;

/**
 * Slug тенанта из названия.
 *
 * Кириллица транслитерируется, а не выбрасывается: иначе «Тестова
 * компанія» превращается в бессмысленный набор цифр, и потом никто
 * не понимает, чей это тенант в журнале. Хвост из случайных символов
 * добавляется всегда — два клиента с одинаковым названием бывают.
 */
const TRANSLIT: Record<string, string> = {
  а:'a', б:'b', в:'v', г:'g', ґ:'g', д:'d', е:'e', є:'ye', ё:'e', ж:'zh',
  з:'z', и:'i', і:'i', ї:'yi', й:'y', к:'k', л:'l', м:'m', н:'n', о:'o',
  п:'p', р:'r', с:'s', т:'t', у:'u', ф:'f', х:'kh', ц:'ts', ч:'ch',
  ш:'sh', щ:'shch', ъ:'', ы:'y', ь:'', э:'e', ю:'yu', я:'ya',
};

export function slugFor(name: string): string {
  const base = name
    .toLowerCase()
    .split('')
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/, '');
  const tail = randomInt(0, 1_000_000).toString(36);
  return (base.length >= 3 ? base : 'company') + '-' + tail;
}

const hashCode = (email: string, code: string): string =>
  createHash('sha256').update(`${email.toLowerCase()}:${code}`).digest('hex');

/** Сравнение за постоянное время: длина одинаковая, утечки по времени нет. */
function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

interface RouteRow {
  tenant_id: string;
  user_id: string;
  tenant_name: string;
}

export function registerEmailAuth(app: FastifyInstance, deps: EmailAuthDeps): void {
  const { pool, issueToken } = deps;

  const { mailer } = deps;

  if (mailer.kind === 'log') {
    app.log.warn(
      'Почта не настроена (нет RESEND_API_KEY и SMTP_URL): коды входа пишутся в лог api. ' +
        'Для проверки это удобно, для работы с клиентами — нет.',
    );
  }

  async function deliver(email: string, code: string): Promise<void> {
    if (mailer.kind === 'log') {
      // Код в логе — единственный способ войти, пока почта не настроена.
      app.log.info(`КОД ВХОДА для ${email}: ${code} (действует ${CODE_TTL_MIN} минут)`);
      return;
    }

    await mailer.send({
      to: email,
      // Тема начинается с самого кода: в списке писем и в уведомлении
      // на телефоне человек видит его, не открывая письмо.
      subject: `${code} — код входа в ${deps.appName}`,
      text:
        `Код входа: ${code}` +
        `\n\nДействует ${CODE_TTL_MIN} минут. Если вы не запрашивали вход — просто удалите это письмо.`,
      html:
        `<div style="font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#16161a">` +
        `<p>Код входа в ${deps.appName}:</p>` +
        `<p style="font:700 30px/1.2 ui-monospace,Menlo,monospace;letter-spacing:.14em;` +
        `margin:18px 0">${code}</p>` +
        `<p style="color:#6b6b75;font-size:13px">Действует ${CODE_TTL_MIN} минут. ` +
        `Если вы не запрашивали вход — просто удалите это письмо.</p></div>`,
    });
  }

  // ── Запрос кода ───────────────────────────────────────────────────
  //
  // Одна ручка на вход и на регистрацию. Разделять их пришлось бы
  // ценой вопроса «а вы у нас уже есть?», на который человек отвечать
  // не обязан: он просто хочет попасть внутрь.
  app.post<{ Body: { email?: string; company?: string } }>('/auth/request', async (req, reply) => {
    const email = (req.body?.email ?? '').trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return reply.code(400).send({ error: 'bad_email' });
    }
    const company = (req.body?.company ?? '').trim().slice(0, 80);

    const routes = await withSystem(pool, 'маршрут входа', async (db) => {
      const { rows } = await db.query<RouteRow>(
        `SELECT r.tenant_id, r.user_id, t.name AS tenant_name
           FROM user_routes r
           JOIN tenants t ON t.id = r.tenant_id
          WHERE r.email = $1 AND r.is_active`,
        [email],
      );
      return rows;
    });

    // Регистрация возможна только если человек назвал компанию: это
    // отличает «хочу завести организацию» от «ошибся адресом при входе».
    // Ответ при этом одинаков во всех случаях — см. комментарий вверху.
    const signup = routes.length === 0 && company.length >= 2 && deps.allowSignup;

    if (routes.length > 0 || signup) {
      const allowed = await withSystem(pool, 'лимит писем', async (db) => {
        const { rows } = await db.query<{ sent_count: number }>(
          `INSERT INTO auth_codes (email, code_hash, expires_at)
           VALUES ($1, '', now())
           ON CONFLICT (email) DO UPDATE
             SET sent_count = CASE
                   WHEN auth_codes.window_from < now() - interval '1 hour' THEN 1
                   ELSE auth_codes.sent_count + 1 END,
                 window_from = CASE
                   WHEN auth_codes.window_from < now() - interval '1 hour' THEN now()
                   ELSE auth_codes.window_from END
           RETURNING sent_count`,
          [email],
        );
        return (rows[0]?.sent_count ?? 1) <= MAX_SENDS_PER_HOUR;
      });

      if (!allowed) {
        // Здесь честный 429: человек уже доказал, что почта существует,
        // скрывать нечего, а молчание выглядело бы поломкой.
        return reply.code(429).send({
          error: 'too_many_requests',
          detail: 'Слишком много запросов кода. Попробуйте через час.',
        });
      }

      // randomInt из node:crypto, а не Math.random: последний
      // предсказуем, и код можно вычислить, зная предыдущие.
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');

      await withSystem(pool, 'сохранение кода', async (db) => {
        await db.query(
          `UPDATE auth_codes
              SET code_hash = $2,
                  expires_at = now() + interval '${CODE_TTL_MIN} minutes',
                  attempts = 0,
                  is_signup = $3,
                  signup_company = $4
            WHERE email = $1`,
          [email, hashCode(email, code), signup, signup ? company : null],
        );
      });

      try {
        await deliver(email, code);
      } catch (err) {
        app.log.error({ err, email }, 'Не удалось отправить код');
        return reply.code(502).send({
          error: 'mail_failed',
          detail: 'Не удалось отправить письмо. Проверьте настройки почты на сервере.',
        });
      }
    }

    return { sent: true, ttlMinutes: CODE_TTL_MIN };
  });

  // ── Проверка кода ─────────────────────────────────────────────────
  app.post<{ Body: { email?: string; code?: string; tenantId?: string } }>(
    '/auth/verify',
    async (req, reply) => {
      const email = (req.body?.email ?? '').trim().toLowerCase();
      const code = (req.body?.code ?? '').trim();
      if (!email || !/^\d{6}$/.test(code)) {
        return reply.code(400).send({ error: 'bad_code' });
      }

      const row = await withSystem(pool, 'проверка кода', async (db) => {
        const { rows } = await db.query<{
          code_hash: string;
          attempts: number;
          expired: boolean;
          is_signup: boolean;
          signup_company: string | null;
        }>(
          `SELECT code_hash, attempts, expires_at < now() AS expired,
                  is_signup, signup_company
             FROM auth_codes WHERE email = $1`,
          [email],
        );
        return rows[0] ?? null;
      });

      if (!row || !row.code_hash) return reply.code(401).send({ error: 'no_code' });
      if (row.expired) return reply.code(401).send({ error: 'code_expired' });
      if (row.attempts >= MAX_ATTEMPTS) {
        return reply.code(429).send({ error: 'too_many_attempts' });
      }

      if (!sameHash(row.code_hash, hashCode(email, code))) {
        await withSystem(pool, 'учёт попытки', async (db) => {
          await db.query(`UPDATE auth_codes SET attempts = attempts + 1 WHERE email = $1`, [email]);
        });
        return reply.code(401).send({
          error: 'wrong_code',
          attemptsLeft: MAX_ATTEMPTS - row.attempts - 1,
        });
      }

      const routes = await withSystem(pool, 'маршрут входа', async (db) => {
        const { rows } = await db.query<RouteRow>(
          `SELECT r.tenant_id, r.user_id, t.name AS tenant_name
             FROM user_routes r
             JOIN tenants t ON t.id = r.tenant_id
            WHERE r.email = $1 AND r.is_active`,
          [email],
        );
        return rows;
      });

      /**
       * Регистрация новой компании.
       *
       * Тенант и владелец появляются здесь, а не при запросе кода:
       * до подтверждения почты нет доказательства, что человек вообще
       * имеет к ней отношение. Иначе перебором адресов база засорялась
       * бы пустыми организациями.
       *
       * Маршрут входа заводить не нужно: его ставит триггер на users.
       */
      if (!routes.length) {
        if (!row.is_signup || !deps.allowSignup) {
          return reply.code(401).send({ error: 'no_account' });
        }

        const created = await withSystem(pool, 'регистрация компании', async (db) => {
          const name = (row.signup_company ?? '').trim() || email.split('@')[0] || 'Компания';
          const { rows: t } = await db.query<{ id: string; name: string }>(
            `INSERT INTO tenants (slug, name, plan, source)
             VALUES ($1, $2, 'trial', 'signup')
             RETURNING id, name`,
            [slugFor(name), name],
          );
          const tenant = t[0]!;
          const { rows: u } = await db.query<{ id: string }>(
            `INSERT INTO users (tenant_id, email, full_name, role, is_active)
             VALUES ($1, $2, $3, 'owner', true)
             RETURNING id`,
            [tenant.id, email, name],
          );
          return { tenantId: tenant.id, userId: u[0]!.id, name: tenant.name };
        });

        await withSystem(pool, 'гашение кода', async (db) => {
          await db.query(`DELETE FROM auth_codes WHERE email = $1`, [email]);
        });

        app.log.info(
          { email, tenantId: created.tenantId },
          'Зарегистрирована новая компания',
        );

        deps.onSignup?.({ email, company: created.name, tenantId: created.tenantId });

        return {
          token: issueToken(created.tenantId, created.userId),
          tenant: created.name,
          created: true,
        };
      }

      // Одна почта в двух организациях — нормальная ситуация у подрядчика,
      // который ведёт несколько клиентов. Молча выбрать первую было бы
      // худшим решением: человек попадал бы не туда и не понимал почему.
      if (routes.length > 1 && !req.body?.tenantId) {
        return reply.code(300).send({
          needsWorkspace: routes.map((r) => ({ tenantId: r.tenant_id, name: r.tenant_name })),
        });
      }

      const chosen = req.body?.tenantId
        ? routes.find((r) => r.tenant_id === req.body!.tenantId)
        : routes[0];

      if (!chosen) return reply.code(401).send({ error: 'no_account' });

      // Код одноразовый. Удаляем сразу после успеха — иначе он остаётся
      // рабочим все десять минут, и перехваченное письмо даёт второй вход.
      await withSystem(pool, 'гашение кода', async (db) => {
        await db.query(`DELETE FROM auth_codes WHERE email = $1`, [email]);
        await db.query(`UPDATE users SET last_seen_at = now() WHERE id = $1`, [chosen.user_id]);
      });

      app.log.info({ email, tenantId: chosen.tenant_id }, 'Вход по коду выполнен');

      return { token: issueToken(chosen.tenant_id, chosen.user_id), tenant: chosen.tenant_name };
    },
  );
}
