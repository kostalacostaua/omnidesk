import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { withTenant } from '@omnidesk/core';

/**
 * Журнал действий.
 *
 * «Кто из ваших сотрудников может прочитать нашу переписку?» — этот
 * вопрос задают в каждой анкете безопасности, и до сих пор ответить на
 * него было нечем: таблица audit_log стояла в схеме с индексом и
 * изоляцией, а писать в неё было некому. Пустой журнал хуже, чем
 * отсутствующий: он выглядит ответом и не является им.
 *
 * Главное решение — запись изменений ведётся сама, а не вызовом в
 * обработчике. Тот же довод, по которому права проверяются в одном
 * месте: в полусотне ручек запись однажды забудут дописать, и в
 * журнале не окажется ровно того действия, ради которого его завели.
 * Поэтому пишется каждый удавшийся запрос, который что-то менял, —
 * новая ручка попадает в журнал в день, когда её написали, и ничего
 * для этого делать не нужно.
 *
 * Чтение — наоборот, поимённо. Запросов на чтение на три порядка
 * больше (кабинет опрашивает список каждые три секунды), и писать их
 * все значит утопить журнал в строках «посмотрел список». Отмечаем то,
 * за что отвечают перед клиентом: кто открыл переписку и кто выгрузил
 * данные.
 *
 * Тела запросов не пишутся никогда и ни в каком виде. Не из
 * осторожности, а по устройству: в журнал идут метод, маршрут и
 * опознаватели из адреса. Коду входа, паролю и ключу от CRM туда
 * нечем попасть — не потому, что их вычистили, а потому, что их никто
 * не брал.
 */

export interface AuditDeps {
  pool: Pool;
  requireAuth: (req: unknown) => { tenantId: string; userId: string } | null;
  /** Срок хранения. Короче договора с клиентом быть не должен. */
  keepDays?: number;
}

/** Что записываем. Поля те же, что в таблице. */
export interface AuditEntry {
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
}

/*
 * Ручки, запись о которых ничего не говорит.
 *
 * Отметка «прочитано», отметка о визите и продление сеанса — это следы
 * открытой вкладки, а не решения человека. В журнале, где ищут «кто
 * сменил роль», сотня таких строк в час означает, что нужную строку не
 * найдут.
 */
const QUIET = [
  '/auth/session',
  '/conversations/:id/read',
  '/me/seen',
];

/** Путь, по которому за действием стоит не человек, а канал или счёт. */
function machinePath(route: string): boolean {
  return (
    route.startsWith('/webhooks/') ||
    route.startsWith('/paddle/') ||
    route === '/channels/custom/messages' ||
    route === '/leads'
  );
}

/** Короткое имя действия: метод и маршрут без опознавателей. */
export function actionOf(method: string, route: string): string {
  return `${method.toUpperCase()} ${route}`;
}

/**
 * Опознаватель предмета — из адреса, а не из тела.
 *
 * Параметр маршрута у нас почти всегда один и почти всегда это он:
 * /conversations/:id, /users/:id, /channels/:id.
 */
function resourceFrom(params: unknown): { type: string | null; id: string | null } {
  const p = (params ?? {}) as Record<string, unknown>;
  const key = Object.keys(p).find((k) => typeof p[k] === 'string');
  if (!key) return { type: null, id: null };
  return { type: key, id: String(p[key]).slice(0, 200) };
}

/** Первый адрес из цепочки прокси: за нашим стоит прокси площадки. */
function ipOf(req: FastifyRequest): string | null {
  const fwd = req.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
  const ip = first || req.ip;
  // inet не принимает мусор, а падать из-за журнала нельзя.
  return /^[0-9a-f.:]{3,45}$/i.test(ip ?? '') ? ip! : null;
}

export function registerAudit(app: FastifyInstance, deps: AuditDeps) {
  const { pool, requireAuth } = deps;
  const keepDays = deps.keepDays ?? 365;

  /**
   * Сама запись.
   *
   * Ошибка журнала не отменяет действия: человек сменил роль, и строка
   * об этом не записалась — это плохо, но откатывать ему смену роли
   * из-за нашей беды ещё хуже. Поэтому пишем в сторону и только
   * жалуемся в логи.
   */
  function write(
    tenantId: string,
    userId: string | null,
    req: FastifyRequest,
    entry: AuditEntry,
  ): void {
    void withTenant(pool, tenantId, async (db) => {
      await db.query(
        `INSERT INTO audit_log
           (tenant_id, user_id, action, resource_type, resource_id, ip, user_agent, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        [
          tenantId,
          userId,
          entry.action.slice(0, 200),
          entry.resourceType ?? null,
          entry.resourceId ?? null,
          ipOf(req),
          String(req.headers['user-agent'] ?? '').slice(0, 300) || null,
          JSON.stringify(entry.metadata ?? {}),
        ],
      );
    }).catch((err: unknown) => {
      app.log.warn({ err, action: entry.action }, 'Запись в журнал действий не удалась');
    });
  }

  /**
   * Чтение, за которое отвечают перед клиентом.
   *
   * Одна и та же переписка открывается заново при каждом обновлении
   * ленты, а лента обновляется сама. Поэтому одно открытие в полчаса —
   * это и есть ответ на вопрос «кто её читал»; сто строк об одном и том
   * же ответом не являются.
   */
  const seen = new Map<string, number>();
  const SEEN_MS = 30 * 60_000;

  function recent(key: string): boolean {
    const now = Date.now();
    const hit = seen.get(key);
    if (hit && now - hit < SEEN_MS) return true;
    seen.set(key, now);
    // Карта не должна расти вечно в процессе, который живёт неделями.
    if (seen.size > 20_000) {
      for (const [k, at] of seen) if (now - at > SEEN_MS) seen.delete(k);
    }
    return false;
  }

  function note(req: FastifyRequest, entry: AuditEntry, once?: string): void {
    const auth = requireAuth(req);
    if (!auth) return;
    if (once && recent(`${auth.userId}:${once}`)) return;
    write(auth.tenantId, auth.userId, req, entry);
  }

  /*
   * Изменения пишутся сами.
   *
   * onResponse, а не preHandler: записывать надо то, что случилось, а
   * не то, что попытались. Запрос, отбитый правами или оплатой, —
   * не действие, и в журнале ему места нет; попытки видны в логах.
   */
  app.addHook('onResponse', async (req: FastifyRequest, reply: FastifyReply) => {
    const method = req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
    if (reply.statusCode >= 400) return;

    const route = req.routeOptions?.url ?? (req.raw.url ?? '').split('?')[0] ?? '';
    if (!route || machinePath(route) || QUIET.includes(route)) return;

    const auth = requireAuth(req);
    if (!auth) return;

    const res = resourceFrom(req.params);
    write(auth.tenantId, auth.userId, req, {
      action: actionOf(method, route),
      resourceType: res.type,
      resourceId: res.id,
    });
  });

  /**
   * Что видно владельцу.
   *
   * Отдаётся только своей организации — через withTenant, изоляцией, а
   * не сравнением в коде. Уровень прав ставит общая проверка: /audit
   * лежит под администраторскими путями.
   */
  app.get<{ Querystring: { limit?: string; before?: string; action?: string; userId?: string } }>(
    '/audit',
    async (req, reply) => {
      const auth = requireAuth(req);
      if (!auth) return reply.code(401).send({ error: 'unauthorized' });

      const limit = Math.min(Math.max(Number(req.query.limit ?? 100) || 100, 1), 500);
      const params: unknown[] = [];
      const where: string[] = [];
      const push = (v: unknown): string => {
        params.push(v);
        return `$${params.length}`;
      };

      if (req.query.before) where.push(`a.created_at < ${push(req.query.before)}::timestamptz`);
      if (req.query.action) where.push(`a.action ILIKE ${push('%' + req.query.action + '%')}::text`);
      if (req.query.userId) where.push(`a.user_id = ${push(req.query.userId)}::uuid`);

      const rows = await withTenant(pool, auth.tenantId, async (db) => {
        const { rows } = await db.query(
          `SELECT a.id, a.action, a.resource_type, a.resource_id, a.ip, a.user_agent,
                  a.metadata, a.created_at,
                  u.full_name AS user_name, u.email AS user_email
             FROM audit_log a
             LEFT JOIN users u ON u.id = a.user_id
            ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
            ORDER BY a.created_at DESC, a.id DESC
            LIMIT ${limit}`,
          params,
        );
        return rows;
      });

      return { entries: rows, keepDays };
    },
  );

  return { note, write };
}

export type Audit = ReturnType<typeof registerAudit>;
