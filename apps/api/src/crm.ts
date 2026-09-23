import type { FastifyInstance } from 'fastify';
import {
  CrmError,
  bitrixPortal,
  bitrixRoot,
  crmPing,
  decryptJson,
  encryptJson,
  pipedriveRoot,
  withTenant,
  type CrmKind,
  type Pool,
} from '@omnidesk/core';

/**
 * Подключение Битрикс24 и Pipedrive.
 *
 * Zoho живёт отдельно: там OAuth, дата-центры и виджет в карточке. Эти
 * две подключаются одинаково просто — клиент приносит ключ, мы его
 * шифруем и складываем. Поэтому и ручка одна на обе, с разницей только
 * в том, что считается ключом.
 *
 * Битрикс подключается входящим вебхуком намеренно: приложение из
 * маркета надо публиковать и проводить модерацию, а вебхук клиент
 * создаёт сам за минуту, и он одинаково работает и в облаке, и в
 * коробке на своём сервере.
 *
 * Ключи наружу не возвращаются никогда: в интерфейсе виден адрес
 * портала или домен компании и ничего больше.
 */

interface CrmDeps {
  pool: Pool;
  masterKey: Buffer;
  requireAuth: (req: unknown) => { tenantId: string; userId: string } | null;
}

interface Creds {
  webhook?: string;
  domain?: string;
  token?: string;
}

interface Row {
  id: string;
  kind: string;
  title: string;
  creds_enc: Buffer;
  status: string;
  last_error: string | null;
  created_at: Date;
}

const auth401 = { error: 'unauthorized' };

/** Что показываем человеку. Ключа здесь нет и быть не может. */
function view(row: Row) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    status: row.status,
    lastError: row.last_error,
    createdAt: row.created_at,
  };
}

export function registerCrm(app: FastifyInstance, deps: CrmDeps): void {
  const { pool, masterKey, requireAuth } = deps;

  app.get('/settings/crm', async (req, reply) => {
    const a = requireAuth(req);
    if (!a) return reply.code(401).send(auth401);

    const rows = await withTenant(pool, a.tenantId, async (db) => {
      const { rows } = await db.query<Row>(
        `SELECT id, kind, title, creds_enc, status, last_error, created_at
           FROM crm_connections ORDER BY created_at ASC`,
      );
      return rows;
    });

    return { connections: rows.map(view) };
  });

  /**
   * Подключить. Связь проверяется сразу же: без этого человек узнаёт об
   * опечатке в ключе не сейчас, а когда клиент уже написал и лид никуда
   * не уехал.
   */
  app.post<{ Body: { kind?: string; webhook?: string; domain?: string; token?: string } }>(
    '/settings/crm',
    async (req, reply) => {
      const a = requireAuth(req);
      if (!a) return reply.code(401).send(auth401);

      const b = req.body ?? {};
      const kind = (b.kind === 'bitrix24' || b.kind === 'pipedrive' ? b.kind : '') as CrmKind | '';
      if (!kind) return reply.code(400).send({ error: 'bad_kind' });

      let creds: Creds;
      let title: string;
      try {
        if (kind === 'bitrix24') {
          const webhook = (b.webhook ?? '').trim();
          bitrixRoot(webhook); // бросит понятную ошибку, если адрес не тот
          creds = { webhook };
          title = bitrixPortal(webhook).replace(/^https:\/\//, '');
        } else {
          const domain = (b.domain ?? '').trim();
          const token = (b.token ?? '').trim();
          if (!token) return reply.code(400).send({ error: 'token_required' });
          pipedriveRoot(domain);
          creds = { domain, token };
          title = domain.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
        }
      } catch (err) {
        const message = err instanceof CrmError ? err.message : 'Проверьте данные подключения';
        return reply.code(400).send({ error: 'bad_credentials', detail: message });
      }

      let who = '';
      try {
        who = await crmPing(kind, creds);
      } catch (err) {
        const message = err instanceof CrmError ? err.message : 'Не удалось связаться с CRM';
        return reply.code(400).send({ error: 'check_failed', detail: message });
      }

      const saved = await withTenant(pool, a.tenantId, async (db) => {
        const { rows } = await db.query<Row>(
          `INSERT INTO crm_connections (tenant_id, kind, title, creds_enc, created_by)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (tenant_id, kind) DO UPDATE SET
             title = EXCLUDED.title, creds_enc = EXCLUDED.creds_enc,
             status = 'active', last_error = NULL
           RETURNING id, kind, title, creds_enc, status, last_error, created_at`,
          [a.tenantId, kind, title, encryptJson(masterKey, a.tenantId, creds), a.userId],
        );
        return rows[0]!;
      });

      app.log.info({ tenantId: a.tenantId, kind, title }, 'CRM подключена');
      return { connection: view(saved), who };
    },
  );

  /** Проверить связь. Заодно снимает пометку «нужно переподключить». */
  app.post<{ Params: { id: string } }>('/settings/crm/:id/check', async (req, reply) => {
    const a = requireAuth(req);
    if (!a) return reply.code(401).send(auth401);

    const row = await withTenant(pool, a.tenantId, async (db) => {
      const { rows } = await db.query<Row>(
        `SELECT id, kind, title, creds_enc, status, last_error, created_at
           FROM crm_connections WHERE id = $1`,
        [req.params.id],
      );
      return rows[0] ?? null;
    });
    if (!row) return reply.code(404).send({ error: 'not_found' });

    try {
      const creds = decryptJson<Creds>(masterKey, a.tenantId, row.creds_enc);
      const who = await crmPing(row.kind as CrmKind, creds);
      await withTenant(pool, a.tenantId, async (db) => {
        await db.query(
          `UPDATE crm_connections SET status = 'active', last_error = NULL WHERE id = $1`,
          [row.id],
        );
      });
      return { ok: true, who };
    } catch (err) {
      const message = err instanceof CrmError ? err.message : 'CRM не ответила';
      await withTenant(pool, a.tenantId, async (db) => {
        await db.query(
          `UPDATE crm_connections SET status = 'degraded', last_error = $2 WHERE id = $1`,
          [row.id, message],
        );
      });
      return reply.code(400).send({ error: 'check_failed', detail: message });
    }
  });

  app.delete<{ Params: { id: string } }>('/settings/crm/:id', async (req, reply) => {
    const a = requireAuth(req);
    if (!a) return reply.code(401).send(auth401);

    const ok = await withTenant(pool, a.tenantId, async (db) => {
      const { rowCount } = await db.query(`DELETE FROM crm_connections WHERE id = $1`, [
        req.params.id,
      ]);
      return (rowCount ?? 0) > 0;
    });

    if (!ok) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });
}
