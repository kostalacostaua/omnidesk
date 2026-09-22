import type { FastifyInstance } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { decryptJson, encryptJson, withTenant, type Pool } from '@omnidesk/core';

/**
 * Подключение Zoho CRM.
 *
 * Приложение в консоли Zoho одно — наше. Каждый клиент нажимает
 * «Подключить», входит под своим аккаунтом и разрешает доступ к своей
 * организации; нам возвращается её refresh-токен, который шифруется
 * ключом этого тенанта и лежит в zoho_installations. Ровно та же
 * схема, что с Facebook: приложение общее, организации разные.
 *
 * Про дата-центры. У Zoho их несколько (eu, com, in, com.au, jp), и
 * организация клиента может жить не там, где заведено приложение.
 * Адреса НЕ зашиты в коде: Zoho присылает в callback параметры
 * `location` и `accounts-server`, а в ответе на обмен кода — `api_domain`.
 * Именно их мы и храним. Хардкод `zohoapis.eu` работал бы ровно до
 * первого клиента из другой страны, причём с ошибкой «invalid oauth
 * token», по которой причину не найти.
 */

/**
 * Что просим. Меньше — лучше: каждый лишний пункт в списке разрешений
 * человек читает на экране согласия и каждый лишний вызывает вопрос.
 *
 *   modules.contacts / leads — искать клиента и создавать нового,
 *   users.READ               — сопоставить оператора с пользователем Zoho,
 *   org.READ                 — узнать название организации и её id.
 */
const SCOPES = [
  'ZohoCRM.modules.contacts.ALL',
  'ZohoCRM.modules.leads.ALL',
  'ZohoCRM.users.READ',
  'ZohoCRM.org.READ',
];

/**
 * Дата-центры Zoho: сервер входа и соответствующий ему домен API.
 *
 * Список явный, а не собранный из строки: у Zoho зона API не всегда
 * повторяет зону аккаунтов — канадское облако входит через
 * accounts.zohocloud.ca, а ходить надо на zohoapis.ca. Выведенное
 * правилом «отрезать accounts.» дало бы несуществующий адрес, и ошибка
 * вылезла бы у первого канадского клиента.
 */
const ZONES: Record<string, string> = {
  'accounts.zoho.com': 'https://www.zohoapis.com',
  'accounts.zoho.eu': 'https://www.zohoapis.eu',
  'accounts.zoho.in': 'https://www.zohoapis.in',
  'accounts.zoho.com.au': 'https://www.zohoapis.com.au',
  'accounts.zoho.jp': 'https://www.zohoapis.jp',
  'accounts.zoho.com.cn': 'https://www.zohoapis.com.cn',
  'accounts.zohocloud.ca': 'https://www.zohoapis.ca',
  'accounts.zoho.sa': 'https://www.zohoapis.sa',
};

const ALLOWED_HOSTS = Object.keys(ZONES);

const DEFAULT_ACCOUNTS = 'https://accounts.zoho.eu';

export interface ZohoDeps {
  pool: Pool;
  masterKey: Buffer;
  requireAuth: (req: unknown) => { tenantId: string; userId: string } | null;
  clientId: string;
  clientSecret: string;
  /** Адрес приложения: из него собирается redirect_uri, он же в консоли Zoho. */
  appUrl: string;
  stateSecret: string;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  api_domain?: string;
  expires_in?: number;
  error?: string;
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Проверка адреса сервера Zoho из callback.
 *
 * Параметр приходит из браузера, то есть им управляет кто угодно.
 * Без проверки подменённый `accounts-server` увёл бы обмен кода — вместе
 * с нашим client_secret — на чужой сервер.
 */
export function safeAccountsServer(raw: string | undefined): string | null {
  if (!raw) return DEFAULT_ACCOUNTS;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (!ALLOWED_HOSTS.includes(url.hostname)) return null;
  return `https://${url.hostname}`;
}

/** Домен API той же зоны: им ходим в CRM после обмена кода. */
export function apiDomainFor(accountsServer: string, fromToken: string | undefined): string | null {
  if (fromToken) {
    try {
      const u = new URL(fromToken);
      if (u.protocol === 'https:' && /(^|\.)zohoapis\.[a-z.]+$|(^|\.)zohocloud\.ca$/.test(u.hostname)) {
        return `https://${u.hostname}`;
      }
    } catch {
      // Ниже соберём из адреса аккаунтов.
    }
  }
  return ZONES[accountsServer.replace('https://', '')] ?? null;
}

export function registerZoho(app: FastifyInstance, opts: ZohoDeps): void {
  const { pool, masterKey, requireAuth } = opts;
  const redirectUri = `${opts.appUrl}/zoho/callback`;

  function signState(payload: Record<string, unknown>): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = createHmac('sha256', opts.stateSecret).update(body).digest('base64url');
    return `${body}.${sig}`;
  }

  function readState(state: string): { t: string; u: string; exp: number } | null {
    const [body, sig] = state.split('.');
    if (!body || !sig) return null;
    const expect = createHmac('sha256', opts.stateSecret).update(body).digest('base64url');
    if (!safeEqual(expect, sig)) return null;
    try {
      const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
        t: string;
        u: string;
        exp: number;
      };
      return p.exp > Date.now() ? p : null;
    } catch {
      return null;
    }
  }

  // ── Состояние подключения ─────────────────────────────────────────
  app.get('/settings/zoho', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });

    const rows = await withTenant(pool, auth.tenantId, async (db) => {
      const { rows } = await db.query(
        `SELECT id, zgid, org_name, location, api_domain, status, created_at
           FROM zoho_installations ORDER BY created_at DESC`,
      );
      return rows;
    });

    return { configured: Boolean(opts.clientId && opts.clientSecret), installations: rows };
  });

  // ── Начало подключения ────────────────────────────────────────────
  app.get('/settings/zoho/start', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });
    if (!opts.clientId || !opts.clientSecret) {
      return reply.code(503).send({ error: 'zoho_unavailable' });
    }

    const state = signState({ t: auth.tenantId, u: auth.userId, exp: Date.now() + 15 * 60_000 });
    const u = new URL(`${DEFAULT_ACCOUNTS}/oauth/v2/auth`);
    u.searchParams.set('client_id', opts.clientId);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('scope', SCOPES.join(','));
    // offline — иначе не будет refresh-токена, и через час всё отвалится.
    u.searchParams.set('access_type', 'offline');
    // Согласие спрашиваем всегда: без него повторное подключение
    // возвращает код без refresh-токена, и понять это по ответу нельзя.
    u.searchParams.set('prompt', 'consent');
    u.searchParams.set('state', state);
    return { url: u.toString() };
  });

  // ── Возврат из Zoho ───────────────────────────────────────────────
  app.get<{
    Querystring: {
      code?: string;
      state?: string;
      location?: string;
      'accounts-server'?: string;
      error?: string;
    };
  }>('/zoho/callback', async (req, reply) => {
    const back = (hash: string): unknown => reply.redirect(`/app#${hash}`);

    const st = readState(req.query.state ?? '');
    if (!st) return back('zoho-error=state');
    if (req.query.error || !req.query.code) return back('zoho-error=cancelled');

    const accounts = safeAccountsServer(req.query['accounts-server']);
    if (!accounts) {
      app.log.warn({ server: req.query['accounts-server'] }, 'Неизвестный сервер Zoho в callback');
      return back('zoho-error=server');
    }

    try {
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: opts.clientId,
        client_secret: opts.clientSecret,
        redirect_uri: redirectUri,
        code: req.query.code,
      });
      const res = await fetch(`${accounts}/oauth/v2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(20_000),
      });
      const token = (await res.json()) as TokenResponse;
      if (!res.ok || token.error || !token.refresh_token || !token.access_token) {
        app.log.warn({ status: res.status, error: token.error }, 'Обмен кода Zoho не удался');
        return back('zoho-error=exchange');
      }

      const apiDomain = apiDomainFor(accounts, token.api_domain);
      if (!apiDomain) return back('zoho-error=server');

      // Название и идентификатор организации: по ним человек убеждается,
      // что подключил именно ту, что хотел, а мы маршрутизируем виджет.
      const orgRes = await fetch(`${apiDomain}/crm/v6/org`, {
        headers: { authorization: `Zoho-oauthtoken ${token.access_token}` },
        signal: AbortSignal.timeout(20_000),
      });
      const org = (await orgRes.json()) as {
        org?: Array<{ zgid?: string; company_name?: string; edition?: string }>;
      };
      const first = org.org?.[0];
      if (!orgRes.ok || !first?.zgid) {
        app.log.warn({ status: orgRes.status }, 'Zoho не отдала сведения об организации');
        return back('zoho-error=org');
      }

      await withTenant(pool, st.t, async (db) => {
        await db.query(
          `INSERT INTO zoho_installations
             (tenant_id, zgid, org_name, location, accounts_server, api_domain,
              refresh_token_enc, scopes, edition, installed_by, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active')
           ON CONFLICT (tenant_id, zgid) DO UPDATE
             SET org_name = EXCLUDED.org_name,
                 location = EXCLUDED.location,
                 accounts_server = EXCLUDED.accounts_server,
                 api_domain = EXCLUDED.api_domain,
                 refresh_token_enc = EXCLUDED.refresh_token_enc,
                 scopes = EXCLUDED.scopes,
                 edition = EXCLUDED.edition,
                 status = 'active'`,
          [
            st.t,
            first.zgid,
            first.company_name ?? null,
            req.query.location ?? 'eu',
            accounts,
            apiDomain,
            encryptJson(masterKey, st.t, { refreshToken: token.refresh_token }),
            SCOPES,
            first.edition ?? null,
            st.u,
          ],
        );
      });

      app.log.info({ tenantId: st.t, zgid: first.zgid }, 'Zoho подключена');
      return back('zoho=ok');
    } catch (err) {
      app.log.warn({ error: (err as Error).message }, 'Подключение Zoho не удалось');
      return back('zoho-error=exchange');
    }
  });

  // ── Проверка связи ────────────────────────────────────────────────
  //
  // Кнопка «проверить» существует потому, что молчаливое «подключено»
  // ничего не значит: токен могли отозвать в Zoho, и узнать об этом
  // в момент, когда клиенту нужно найти карточку, — худший вариант.
  app.post<{ Params: { id: string } }>('/settings/zoho/:id/check', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });

    const row = await withTenant(pool, auth.tenantId, async (db) => {
      const { rows } = await db.query<{
        accounts_server: string;
        api_domain: string;
        refresh_token_enc: Buffer;
      }>(
        `SELECT accounts_server, api_domain, refresh_token_enc
           FROM zoho_installations WHERE id = $1`,
        [req.params.id],
      );
      return rows[0] ?? null;
    });
    if (!row) return reply.code(404).send({ error: 'not_found' });

    const { refreshToken } = decryptJson<{ refreshToken: string }>(
      masterKey,
      auth.tenantId,
      row.refresh_token_enc,
    );

    const res = await fetch(`${row.accounts_server}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: opts.clientId,
        client_secret: opts.clientSecret,
        refresh_token: refreshToken,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const token = (await res.json()) as TokenResponse;

    if (!res.ok || !token.access_token) {
      await withTenant(pool, auth.tenantId, async (db) => {
        await db.query(`UPDATE zoho_installations SET status = 'degraded' WHERE id = $1`, [
          req.params.id,
        ]);
      });
      return reply.code(409).send({ error: 'token_rejected', detail: token.error ?? 'нет доступа' });
    }

    const users = await fetch(`${row.api_domain}/crm/v6/users?type=CurrentUser`, {
      headers: { authorization: `Zoho-oauthtoken ${token.access_token}` },
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await users.json()) as { users?: Array<{ full_name?: string; email?: string }> };

    await withTenant(pool, auth.tenantId, async (db) => {
      await db.query(`UPDATE zoho_installations SET status = 'active' WHERE id = $1`, [
        req.params.id,
      ]);
    });

    return { ok: true, user: body.users?.[0]?.full_name ?? body.users?.[0]?.email ?? null };
  });

  // ── Отключение ────────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/settings/zoho/:id', async (req, reply) => {
    const auth = requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });

    const ok = await withTenant(pool, auth.tenantId, async (db) => {
      const { rowCount } = await db.query(`DELETE FROM zoho_installations WHERE id = $1`, [
        req.params.id,
      ]);
      return (rowCount ?? 0) > 0;
    });

    if (!ok) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });
}
