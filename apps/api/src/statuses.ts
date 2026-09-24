import type { FastifyInstance } from 'fastify';
import {
  STATUS_LIMIT,
  parseStatusInput,
  isStatusKind,
  statusColor,
  statusName,
  systemStatusFor,
  withTenant,
  type Pool,
  type StatusKind,
  type TenantClient,
} from '@omnidesk/core';

/**
 * Свои статусы диалога: справочник.
 *
 * Читать список может любой вошедший — он нужен в чате и в фильтре, а
 * не только в настройках. Править может тоже любой: то же правило, что
 * у остальных настроек, где роль разводится интерфейсом, а не ручкой.
 *
 * Самое важное здесь — не CRUD, а то, что происходит при смене рода.
 * Статус «Чекаємо оплату» сделали закрытым — значит все диалоги, на
 * которых он надет, обязаны в тот же момент уехать в «Закриті». Иначе
 * получится список, где вкладка говорит одно, а статус в строке —
 * другое, и человек перестаёт верить обоим.
 */

interface Auth {
  tenantId: string;
  userId: string;
}

export interface StatusesDeps {
  pool: Pool;
  requireAuth: (req: unknown) => Auth | null;
}

interface StatusRow {
  id: string;
  name: string;
  color: string;
  kind: StatusKind;
  sort: number;
}

/**
 * Перевести диалоги под статусом в его системное состояние.
 *
 * resolved_at ставится и снимается здесь же по той же причине, что и
 * при закрытии руками: переоткрытый диалог с датой закрытия ломает
 * любой отчёт о времени.
 */
const SYNC_SQL = `
  UPDATE conversations
     SET status = $2::text,
         resolved_at = CASE WHEN $2::text = 'resolved' THEN coalesce(resolved_at, now()) END
   WHERE status_id = $1::uuid AND status <> $2::text`;

export function registerStatuses(app: FastifyInstance, deps: StatusesDeps): void {
  const { pool, requireAuth } = deps;
  const auth401 = { error: 'unauthorized' } as const;

  const list = (db: TenantClient) =>
    db.query<StatusRow>(
      `SELECT id, name, color, kind, sort FROM conversation_statuses
        ORDER BY sort, name`,
    );

  // ── Список ────────────────────────────────────────────────────────
  app.get('/statuses', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const rows = await withTenant(pool, auth.tenantId, async (db) => (await list(db)).rows);
    return { statuses: rows };
  });

  // ── Создание ──────────────────────────────────────────────────────
  app.post<{ Body: { name?: string; color?: string; kind?: string; sort?: number } }>(
    '/statuses',
    async (req, reply) => {
      const auth = requireAuth(req);
      if (!auth) return reply.code(401).send(auth401);

      const parsed = parseStatusInput(req.body);
      if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
      const v = parsed.value;

      const out = await withTenant(pool, auth.tenantId, async (db) => {
        const { rows: countRows } = await db.query<{ n: string }>(
          `SELECT count(*) AS n FROM conversation_statuses`,
        );
        if (Number(countRows[0]?.n ?? 0) >= STATUS_LIMIT) return { error: 'too_many' as const };

        /*
         * Новый статус без указанного порядка становится последним, а не
         * первым: список настраивают сверху вниз, и дописанное в конец
         * не переставляет то, к чему уже привыкли.
         */
        const sort = v.sort || (await nextSort(db));

        try {
          const { rows } = await db.query<StatusRow>(
            `INSERT INTO conversation_statuses (tenant_id, name, color, kind, sort)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, name, color, kind, sort`,
            [auth.tenantId, v.name, v.color, v.kind, sort],
          );
          return { status: rows[0]! };
        } catch (err) {
          if ((err as { code?: string }).code === '23505') return { error: 'duplicate' as const };
          throw err;
        }
      });

      if ('error' in out) return reply.code(out.error === 'duplicate' ? 409 : 400).send(out);
      return out;
    },
  );

  // ── Правка ────────────────────────────────────────────────────────
  app.patch<{
    Params: { id: string };
    Body: { name?: string; color?: string; kind?: string; sort?: number };
  }>('/statuses/:id', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const b = req.body ?? {};
    if (b.kind !== undefined && !isStatusKind(b.kind)) {
      return reply.code(400).send({ error: 'bad_kind' });
    }
    if (b.name !== undefined && !statusName(b.name)) {
      return reply.code(400).send({ error: 'name_required' });
    }

    const out = await withTenant(pool, auth.tenantId, async (db) => {
      const sets: string[] = [];
      const params: unknown[] = [req.params.id];
      const push = (v: unknown) => {
        params.push(v);
        return '$' + params.length;
      };

      if (b.name !== undefined) sets.push(`name = ${push(statusName(b.name))}::text`);
      if (b.color !== undefined) sets.push(`color = ${push(statusColor(b.color))}::text`);
      if (b.kind !== undefined) sets.push(`kind = ${push(b.kind)}::text`);
      if (b.sort !== undefined) {
        const n = Number(b.sort);
        sets.push(`sort = ${push(Number.isFinite(n) ? Math.min(Math.max(Math.round(n), 0), 999) : 0)}::smallint`);
      }
      if (!sets.length) return { error: 'nothing' as const };

      let row: StatusRow | undefined;
      try {
        const res = await db.query<StatusRow>(
          `UPDATE conversation_statuses SET ${sets.join(', ')}
            WHERE id = $1::uuid
            RETURNING id, name, color, kind, sort`,
          params,
        );
        row = res.rows[0];
      } catch (err) {
        if ((err as { code?: string }).code === '23505') return { error: 'duplicate' as const };
        throw err;
      }
      if (!row) return { error: 'not_found' as const };

      // Род поменялся — диалоги едут следом, в том же запросе.
      if (b.kind !== undefined) {
        await db.query(SYNC_SQL, [row.id, systemStatusFor(row.kind)]);
      }
      return { status: row };
    });

    if ('error' in out) {
      const code = out.error === 'not_found' ? 404 : out.error === 'duplicate' ? 409 : 400;
      return reply.code(code).send(out);
    }
    return out;
  });

  // ── Удаление ──────────────────────────────────────────────────────
  /*
   * Диалоги не трогаем: внешний ключ снимает статус сам (ON DELETE SET
   * NULL), а системный status у них уже правильный — он ставился при
   * выборе статуса и при каждой смене рода. Переоткрывать закрытые
   * диалоги из-за удаления статуса было бы хуже всего: человек убрал
   * слово из справочника, а получил сотню чатов обратно в работу.
   */
  app.delete<{ Params: { id: string } }>('/statuses/:id', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send(auth401);

    const gone = await withTenant(pool, auth.tenantId, async (db) => {
      const { rowCount } = await db.query(`DELETE FROM conversation_statuses WHERE id = $1::uuid`, [
        req.params.id,
      ]);
      return (rowCount ?? 0) > 0;
    });

    if (!gone) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });
}

async function nextSort(db: TenantClient): Promise<number> {
  const { rows } = await db.query<{ next: number }>(
    `SELECT coalesce(max(sort), 0) + 10 AS next FROM conversation_statuses`,
  );
  return Math.min(Number(rows[0]?.next ?? 10), 999);
}
