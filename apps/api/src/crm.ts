import type { FastifyInstance } from 'fastify';
import {
  CrmError,
  bitrixPortal,
  bitrixRoot,
  crmPing,
  decryptJson,
  encryptJson,
  pipedriveAuthorizeUrl,
  pipedriveExchange,
  pipedrivePhone,
  pipedriveRoot,
  parseCrmSettings,
  withSystem,
  withTenant,
  zohoAccessToken,
  type CrmKind,
  type PipedriveTokens,
  type Pool,
} from '@omnidesk/core';
import { randomUUID } from 'node:crypto';

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
  /** Ключи приложения Pipedrive: нужны только для панели в карточке. */
  pipedrive?: { clientId: string; clientSecret: string; appUrl: string };
  /**
   * Короткая память под установку приложения. Тип широкий намеренно:
   * здесь нужны три операции, а не весь клиент Redis.
   */
  redis?: {
    setex: (key: string, seconds: number, value: string) => Promise<unknown>;
    get: (key: string) => Promise<string | null>;
    del: (key: string) => Promise<unknown>;
    set: (key: string, value: string, mode: 'EX', seconds: number) => Promise<unknown>;
  };
  /** Ключи приложения Zoho: нужны, чтобы говорить с её API отсюда. */
  zoho?: { clientId: string; clientSecret: string };
}

interface Creds {
  webhook?: string;
  domain?: string;
  /** Токен из личных настроек Pipedrive или Bearer от приложения. */
  token?: string;
  /** Токены приложения: с ними работает панель в карточке. */
  oauth?: PipedriveTokens;
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

/**
 * Телефон карточки в подключённой CRM. Вынесено отдельно, потому что
 * этим пользуется панель в карточке, а не только настройки.
 */
/**
 * Действующий токен Pipedrive.
 *
 * У приложения токен живёт час, у токена из личных настроек срока нет.
 * Обновлённый токен сразу кладётся обратно: иначе каждое открытие
 * карточки начиналось бы с обмена, а Pipedrive такие обмены считает.
 */
async function pipedriveToken(deps: CrmDeps, tenantId: string, creds: Creds, rowId: string): Promise<{
  domain: string;
  token: string;
}> {
  if (!creds.oauth) return { domain: creds.domain ?? '', token: creds.token ?? '' };

  let tokens = creds.oauth;
  if (tokens.expiresAt <= Date.now() && deps.pipedrive) {
    tokens = await pipedriveExchange({ refreshToken: tokens.refreshToken }, deps.pipedrive);
    const next: Creds = { ...creds, oauth: tokens };
    await withTenant(deps.pool, tenantId, async (db) => {
      await db.query(`UPDATE crm_connections SET creds_enc = $2 WHERE id = $1`, [
        rowId, encryptJson(deps.masterKey, tenantId, next),
      ]);
    });
  }

  return {
    domain: tokens.apiDomain.replace(/^https?:\/\//i, ''),
    token: `Bearer ${tokens.accessToken}`,
  };
}

export function crmPhoneReader(deps: CrmDeps) {
  return async function crmPhone(tenantId: string, recordId: string): Promise<string | null> {
    const row = await withTenant(deps.pool, tenantId, async (db) => {
      const { rows } = await db.query<{ id: string; creds_enc: Buffer }>(
        `SELECT id, creds_enc FROM crm_connections
          WHERE kind = 'pipedrive' AND status = 'active' LIMIT 1`,
      );
      return rows[0] ?? null;
    });
    if (!row) return null;

    try {
      const creds = decryptJson<Creds>(deps.masterKey, tenantId, row.creds_enc);
      const { domain, token } = await pipedriveToken(deps, tenantId, creds, row.id);
      return await pipedrivePhone(domain, token, recordId);
    } catch {
      return null;
    }
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

    const behaviour = await withSystem(pool, 'настройки CRM', async (db) => {
      const { rows } = await db.query<{ crm: unknown }>(
        `SELECT crm FROM tenants WHERE id = $1 LIMIT 1`,
        [a.tenantId],
      );
      return parseCrmSettings(rows[0]?.crm);
    });

    return { connections: rows.map(view), settings: behaviour };
  });

  /**
   * Компания клиента в CRM.
   *
   * Просьба звучит как «создать компанию», но на деле их две: завести
   * компанию, если такой ещё нет, и привязать к ней карточку человека.
   * Вторая и есть главная — компания сама по себе в CRM не нужна
   * никому, нужна связь «этот человек оттуда».
   *
   * Лид и контакт устроены по-разному, и притворяться, что одинаково,
   * нельзя: у контакта компания — ссылка на карточку компании, у лида
   * просто поле с текстом. Поэтому у лида мы пишем название, а карточку
   * компании не заводим: она повиснет пустой и ни с чем не связанной, а
   * при конвертации лида Zoho создаст свою.
   */
  app.post<{ Params: { id: string }; Body: { name?: string } }>(
    '/contacts/:id/company',
    async (req, reply) => {
      const a = requireAuth(req);
      if (!a) return reply.code(401).send(auth401);

      const name = String(req.body?.name ?? '').trim().slice(0, 200);
      if (!name) return reply.code(400).send({ error: 'name_required' });
      if (!deps.redis || !deps.zoho?.clientId) {
        return reply.code(400).send({ error: 'zoho_not_configured' });
      }

      const link = await withTenant(pool, a.tenantId, async (db) => {
        const { rows } = await db.query<{ crm_module: string | null; crm_record_id: string | null }>(
          `SELECT crm_module, crm_record_id FROM contacts WHERE id = $1`,
          [req.params.id],
        );
        return rows[0] ?? null;
      });
      if (!link?.crm_record_id || !link.crm_module) {
        return reply.code(409).send({ error: 'not_linked' });
      }

      const inst = await withTenant(pool, a.tenantId, async (db) => {
        const { rows } = await db.query<{
          id: string;
          accounts_server: string;
          api_domain: string;
          refresh_token_enc: Buffer;
        }>(
          `SELECT id, accounts_server, api_domain, refresh_token_enc
             FROM zoho_installations WHERE status = 'active'
            ORDER BY created_at DESC LIMIT 1`,
        );
        return rows[0] ?? null;
      });
      if (!inst) return reply.code(409).send({ error: 'zoho_not_connected' });

      const { refreshToken } = decryptJson<{ refreshToken: string }>(
        masterKey,
        a.tenantId,
        inst.refresh_token_enc,
      );
      const got = await zohoAccessToken({
        cache: deps.redis as never,
        tenantId: a.tenantId,
        accountsServer: inst.accounts_server,
        refreshToken,
        clientId: deps.zoho.clientId,
        clientSecret: deps.zoho.clientSecret,
      });
      if (!got.ok) {
        await withTenant(pool, a.tenantId, async (db) => {
          await db.query(`UPDATE zoho_installations SET status = 'degraded' WHERE id = $1`, [
            inst.id,
          ]);
        });
        return reply.code(409).send({ error: 'token_rejected', detail: got.error });
      }

      const head = {
        authorization: `Zoho-oauthtoken ${got.token}`,
        'content-type': 'application/json',
      };

      // У лида компания — текстовое поле, и на этом всё.
      if (link.crm_module === 'Leads') {
        const res = await fetch(`${inst.api_domain}/crm/v6/Leads/${link.crm_record_id}`, {
          method: 'PUT',
          headers: head,
          body: JSON.stringify({ data: [{ Company: name }] }),
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) return reply.code(502).send({ error: 'zoho_refused' });
        await rememberCompany(a.tenantId, req.params.id, name);
        return { company: name, module: 'Leads' };
      }

      /*
       * Ищем компанию по точному названию, прежде чем заводить. Иначе
       * с каждым клиентом из одной фирмы в CRM появляется ещё одна
       * «Ромашка», и через месяц их там шесть.
       */
      const search = new URL(`${inst.api_domain}/crm/v6/Accounts/search`);
      search.searchParams.set('criteria', `(Account_Name:equals:${name})`);
      const found = await fetch(search, {
        headers: { authorization: head.authorization },
        signal: AbortSignal.timeout(20_000),
      });

      let accountId: string | null = null;
      if (found.status !== 204 && found.ok) {
        const body = (await found.json()) as { data?: Array<{ id?: string }> };
        accountId = body.data?.[0]?.id ?? null;
      }

      if (!accountId) {
        const made = await fetch(`${inst.api_domain}/crm/v6/Accounts`, {
          method: 'POST',
          headers: head,
          body: JSON.stringify({ data: [{ Account_Name: name }] }),
          signal: AbortSignal.timeout(20_000),
        });
        const body = (await made.json().catch(() => ({}))) as {
          data?: Array<{ code?: string; details?: { id?: string }; message?: string }>;
        };
        const first = body.data?.[0];
        if (!made.ok || first?.code !== 'SUCCESS' || !first.details?.id) {
          return reply.code(502).send({ error: 'zoho_refused', detail: first?.message });
        }
        accountId = first.details.id;
      }

      const tied = await fetch(`${inst.api_domain}/crm/v6/Contacts/${link.crm_record_id}`, {
        method: 'PUT',
        headers: head,
        body: JSON.stringify({ data: [{ Account_Name: { id: accountId } }] }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!tied.ok) return reply.code(502).send({ error: 'zoho_refused' });

      await rememberCompany(a.tenantId, req.params.id, name);
      return { company: name, module: 'Contacts', accountId };
    },
  );

  /**
   * Запоминаем название у себя — чтобы показать его в карточке, не
   * спрашивая Zoho при каждом открытии диалога. Это кэш, а не правда:
   * правда живёт в CRM, и переименование там сюда не приедет.
   */
  async function rememberCompany(
    tenantId: string,
    contactId: string,
    name: string,
  ): Promise<void> {
    await withTenant(pool, tenantId, async (db) => {
      await db.query(
        `UPDATE contacts
            SET attributes = attributes || jsonb_build_object('company', $2::text)
          WHERE id = $1`,
        [contactId, name],
      );
    });
  }

  /**
   * Поведение связки: кого заводить и назначать ли ответственного.
   *
   * Живёт у арендатора, а не у подключения: правило одно на компанию,
   * какой бы CRM она ни пользовалась, и повторять его для каждой —
   * значит однажды получить две разные настройки и вопрос, какая
   * главнее.
   */
  app.patch<{ Body: { createAs?: string; ownerByEmail?: boolean } }>(
    '/settings/crm-behaviour',
    async (req, reply) => {
      const a = requireAuth(req);
      if (!a) return reply.code(401).send(auth401);

      const current = await withSystem(pool, 'настройки CRM', async (db) => {
        const { rows } = await db.query<{ crm: unknown }>(
          `SELECT crm FROM tenants WHERE id = $1 LIMIT 1`,
          [a.tenantId],
        );
        return parseCrmSettings(rows[0]?.crm);
      });

      const next = parseCrmSettings({
        createAs: req.body?.createAs ?? current.createAs,
        ownerByEmail: req.body?.ownerByEmail ?? current.ownerByEmail,
      });

      await withSystem(pool, 'настройки CRM', async (db) => {
        await db.query(`UPDATE tenants SET crm = $2::jsonb WHERE id = $1`, [
          a.tenantId,
          JSON.stringify(next),
        ]);
      });

      return { settings: next };
    },
  );

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

  /**
   * Установка приложения Pipedrive.
   *
   * Панель в карточке появляется только у установленного приложения,
   * а установка идёт через их же разрешение. Человек может начать её и
   * у нас, и в самом Pipedrive, поэтому порядок такой: их страница
   * возвращает нас сюда, токены кладутся в короткую память, а
   * привязывает их к компании уже вошедший человек в нашем интерфейсе.
   * Так токен не попадает ни в адрес, ни к чужому тенанту.
   */
  app.get('/settings/pipedrive/start', async (req, reply) => {
    const a = requireAuth(req);
    if (!a) return reply.code(401).send(auth401);
    if (!deps.pipedrive?.clientId) return reply.code(400).send({ error: 'app_not_configured' });

    return {
      url: pipedriveAuthorizeUrl(
        deps.pipedrive.clientId,
        `${deps.pipedrive.appUrl}/pipedrive/callback`,
        randomUUID(),
      ),
    };
  });

  app.get<{ Querystring: { code?: string; error?: string } }>(
    '/pipedrive/callback',
    async (req, reply) => {
      const appUrl = deps.pipedrive?.appUrl ?? '';
      if (req.query.error || !req.query.code || !deps.pipedrive || !deps.redis) {
        return reply.redirect(`${appUrl}/app#pipedrive-error=cancelled`);
      }

      try {
        const tokens = await pipedriveExchange(
          { code: req.query.code, redirectUri: `${deps.pipedrive.appUrl}/pipedrive/callback` },
          deps.pipedrive,
        );
        const id = randomUUID();
        await deps.redis.setex(`pd:install:${id}`, 600, JSON.stringify(tokens));
        return reply.redirect(`${appUrl}/app#pipedrive=${id}`);
      } catch (err) {
        app.log.warn({ err: (err as Error).message }, 'Установка Pipedrive не удалась');
        return reply.redirect(`${appUrl}/app#pipedrive-error=exchange`);
      }
    },
  );

  /** Привязать установку к компании. Делает уже вошедший человек. */
  app.post<{ Body: { installId?: string } }>('/settings/pipedrive/attach', async (req, reply) => {
    const a = requireAuth(req);
    if (!a) return reply.code(401).send(auth401);
    if (!deps.redis) return reply.code(400).send({ error: 'app_not_configured' });

    const id = (req.body?.installId ?? '').replace(/[^a-z0-9-]/gi, '').slice(0, 64);
    if (!id) return reply.code(400).send({ error: 'bad_install' });

    const raw = await deps.redis.get(`pd:install:${id}`);
    if (!raw) return reply.code(400).send({ error: 'install_expired' });
    await deps.redis.del(`pd:install:${id}`);

    const tokens = JSON.parse(raw) as PipedriveTokens;
    const domain = tokens.apiDomain.replace(/^https?:\/\//i, '');
    const creds: Creds = { domain, oauth: tokens };

    const saved = await withTenant(pool, a.tenantId, async (db) => {
      const { rows } = await db.query<Row>(
        `INSERT INTO crm_connections (tenant_id, kind, title, creds_enc, created_by)
         VALUES ($1,'pipedrive',$2,$3,$4)
         ON CONFLICT (tenant_id, kind) DO UPDATE SET
           title = EXCLUDED.title, creds_enc = EXCLUDED.creds_enc,
           status = 'active', last_error = NULL
         RETURNING id, kind, title, creds_enc, status, last_error, created_at`,
        [a.tenantId, domain, encryptJson(masterKey, a.tenantId, creds), a.userId],
      );
      return rows[0]!;
    });

    app.log.info({ tenantId: a.tenantId, domain }, 'Приложение Pipedrive установлено');
    return { connection: view(saved) };
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
