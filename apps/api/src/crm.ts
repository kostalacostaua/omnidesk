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
  orderItems,
  orderSubject,
  orderFields,
  orderValues,
  catalogPage,
  sortCatalog,
  CATALOG_PAGE,
  CATALOG_MAX,
  type CatalogItem,
  type OrderField,
  parseCrmSettings,
  withSystem,
  withTenant,
  convertedContactId,
  zohoAccessToken,
  zohoRecordUrl,
  type CrmKind,
  type PipedriveTokens,
  type Pool,
} from '@omnidesk/core';
import { randomUUID } from 'node:crypto';
import { channelScope } from './scope.js';

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
   * Доступ к Zoho для одной операции.
   *
   * Три ручки подряд начинались одинаково: найти установку, расшифровать
   * refresh-токен, обменять его, разобрать отказ. Повторение здесь
   * опаснее обычного: забыть пометить установку испорченной — значит
   * оставить человека без объяснения, почему всё молчит.
   */
  async function zohoFor(
    tenantId: string,
  ): Promise<
    | { inst: { id: string; api_domain: string }; head: Record<string, string> }
    | { error: string; detail?: string }
  > {
    if (!deps.redis || !deps.zoho?.clientId) return { error: 'zoho_not_configured' };

    const inst = await withTenant(pool, tenantId, async (db) => {
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
    if (!inst) return { error: 'zoho_not_connected' };

    const { refreshToken } = decryptJson<{ refreshToken: string }>(
      masterKey,
      tenantId,
      inst.refresh_token_enc,
    );
    const got = await zohoAccessToken({
      cache: deps.redis as never,
      tenantId,
      accountsServer: inst.accounts_server,
      refreshToken,
      clientId: deps.zoho.clientId,
      clientSecret: deps.zoho.clientSecret,
    });

    if (!got.ok) {
      await withTenant(pool, tenantId, async (db) => {
        await db.query(`UPDATE zoho_installations SET status = 'degraded' WHERE id = $1`, [inst.id]);
      });
      return { error: 'token_rejected', detail: got.error };
    }

    return {
      inst: { id: inst.id, api_domain: inst.api_domain },
      head: {
        authorization: `Zoho-oauthtoken ${got.token}`,
        'content-type': 'application/json',
      },
    };
  }

  /**
   * Отказ Zoho, разобранный по причине.
   *
   * Одна причина здесь важнее прочих. Права закреплены за
   * refresh-токеном в момент согласия, и тот, кто подключил Zoho до
   * появления товаров и заказов, живёт со старым коротким списком
   * прав: запросы к товарам она встречает отказом
   * OAUTH_SCOPE_MISMATCH. Лечится это одним действием — подключить
   * Zoho заново, — но угадать его по «Zoho не приняла запрос»
   * невозможно, и человек идёт искать ошибку у себя в CRM.
   *
   * NO_PERMISSION — другое: прав у приложения хватает, а у самого
   * пользователя Zoho нет доступа к модулю. Это чинится в правах
   * профиля внутри CRM, и путать эти два отказа нельзя.
   */
  function whyBody(raw: unknown): { error: string; detail?: string } {
    const body = (raw ?? {}) as { code?: unknown; message?: unknown };
    const code = typeof body.code === 'string' ? body.code : '';
    const detail = typeof body.message === 'string' ? body.message : undefined;
    if (code === 'OAUTH_SCOPE_MISMATCH') return { error: 'zoho_scope' };
    if (code === 'NO_PERMISSION') return { error: 'zoho_no_permission' };
    if (code === 'INVALID_TOKEN' || code === 'AUTHENTICATION_FAILURE') {
      return { error: 'token_rejected' };
    }
    return { error: 'zoho_refused', detail };
  }

  async function zohoWhy(res: Response): Promise<{ error: string; detail?: string }> {
    return whyBody(await res.json().catch(() => ({})));
  }

  /**
   * Каталог и описание полей — в памяти процесса.
   *
   * Не в Redis намеренно: это не состояние, а избавление от повторного
   * похода в чужой API. Каждый процесс сходит за ним сам, и при
   * перезапуске ничего не теряется.
   */
  const CATALOG_TTL = 5 * 60_000;
  const FIELDS_TTL = 10 * 60_000;
  const catalogs = new Map<string, { at: number; items: CatalogItem[]; truncated: boolean }>();
  const orderMeta = new Map<string, { at: number; fields: OrderField[] }>();

  /**
   * Описание полей заказа. Спрашивается и при показе окна, и при
   * создании заказа.
   *
   * Второе место важнее первого: процессов у api несколько, окно могло
   * спросить поля у одного, а заказ уехать к другому. Если бы создание
   * полагалось на память своего процесса, у второго её бы не было — и
   * заполненные человеком поля тихо пропали бы по дороге.
   */
  async function fieldsFor(
    tenantId: string,
    z: { inst: { api_domain: string }; head: Record<string, string> },
  ): Promise<{ fields: OrderField[] } | { error: string; detail?: string }> {
    const fresh = orderMeta.get(tenantId);
    if (fresh && Date.now() - fresh.at < FIELDS_TTL) return { fields: fresh.fields };

    const url = new URL(`${z.inst.api_domain}/crm/v6/settings/fields`);
    url.searchParams.set('module', 'Sales_Orders');
    const res = await fetch(url, { headers: z.head, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return zohoWhy(res);

    const fields = orderFields(await res.json());
    orderMeta.set(tenantId, { at: Date.now(), fields });
    return { fields };
  }

  /**
   * Лид, которого сконвертировали в контакт.
   *
   * Лида конвертируют в Zoho, а не у нас: там нажимают Convert, и лид
   * превращается в контакт с компанией и сделкой. У нас же остаётся
   * ссылка на лида, по которой Zoho отвечает «эта запись уже
   * сконвертирована». Для человека это выглядит как сломанная ссылка в
   * карточке и отказ «у ліда немає компанії» после того, как он всё
   * сделал правильно.
   *
   * Поэтому связь догоняется сама: Zoho отдаёт в самом лиде, во что он
   * превратился. Проверяем это в тот момент, когда связь понадобилась,
   * а не на каждом открытии диалога — лишний поход в чужой API на
   * каждый клик дорог и никому не нужен.
   */
  async function followConversion(
    tenantId: string,
    contactId: string,
    leadId: string,
    z: { inst: { api_domain: string }; head: Record<string, string> },
  ): Promise<string | null> {
    // Поля конвертации у лида настоящие, а не служебные: Converted__s —
    // признак, Converted_Contact — ссылка на получившийся контакт.
    const fields = 'Converted__s,Converted_Contact,Converted_Account';

    /*
     * Два захода, и это не перестраховка.
     *
     * Запись по идентификатору Zoho для сконвертированного лида отдаёт
     * не всегда: в интерфейсе он закрыт, и API местами ведёт себя так
     * же. Списочная ручка с параметром converted=true отдаёт его
     * гарантированно — но только вместе с параметром, без него
     * сконвертированные из списка исключены.
     */
    const urls = [
      `${z.inst.api_domain}/crm/v6/Leads/${leadId}?fields=${fields}`,
      `${z.inst.api_domain}/crm/v6/Leads?converted=true&ids=${leadId}&fields=${fields}`,
    ];

    let row: Record<string, unknown> | null = null;
    for (const url of urls) {
      const res = await fetch(url, { headers: z.head, signal: AbortSignal.timeout(20_000) });
      if (res.status === 204) continue;
      if (!res.ok) continue;
      const body = (await res.json().catch(() => ({}))) as { data?: Array<Record<string, unknown>> };
      const first = body.data?.[0];
      if (convertedContactId(first)) {
        row = first ?? null;
        break;
      }
      // Ответ есть, но лид ещё не сконвертирован — второй заход не поможет.
      if (first) return null;
    }
    if (!row) return null;

    const newId = convertedContactId(row);
    if (!newId) return null;

    await withTenant(pool, tenantId, async (db) => {
      await db.query(
        `UPDATE contacts SET crm_module = 'Contacts', crm_record_id = $2 WHERE id = $1`,
        [contactId, newId],
      );
    });
    app.log.info({ tenantId, contactId, leadId, newId }, 'Лид сконвертирован — связь переставлена на контакт');
    return newId;
  }

  /**
   * Перепроверить связь с CRM вручную.
   *
   * Нужна, когда лида сконвертировали, а в карточке ещё старая ссылка:
   * кнопка дешевле объяснения «подождите, само обновится».
   */
  app.post<{ Params: { id: string } }>('/contacts/:id/crm/refresh', async (req, reply) => {
    const a = requireAuth(req);
    if (!a) return reply.code(401).send(auth401);

    const row = await withTenant(pool, a.tenantId, async (db) => {
      const { rows } = await db.query<{ crm_module: string | null; crm_record_id: string | null }>(
        `SELECT crm_module, crm_record_id FROM contacts WHERE id = $1 LIMIT 1`,
        [req.params.id],
      );
      return rows[0] ?? null;
    });
    if (!row) return reply.code(404).send({ error: 'not_found' });
    if (!row.crm_record_id) return reply.code(409).send({ error: 'not_linked' });
    if (row.crm_module === 'Contacts') return { module: 'Contacts', recordId: row.crm_record_id };

    const z = await zohoFor(a.tenantId);
    if ('error' in z) return reply.code(409).send(z);

    const moved = await followConversion(a.tenantId, req.params.id, row.crm_record_id, z);
    if (!moved) return reply.code(409).send({ error: 'still_lead' });
    return { module: 'Contacts', recordId: moved };
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

      const z = await zohoFor(a.tenantId);
      if ('error' in z) return reply.code(409).send(z);
      const { inst, head } = z;

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
        headers: head,
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
   * Каталог товаров.
   *
   * Раньше здесь был поиск: оператор писал две буквы, мы спрашивали
   * Zoho «что начинается на эти буквы». Это работает, только если
   * человек помнит, как товар называется в CRM. В жизни он помнит
   * «фильтр для второй модели», а в прайсе это FLT-220-B, и поиск по
   * началу названия не находит ничего.
   *
   * Поэтому тянем весь список и отдаём его окну заказа целиком: искать
   * по любому куску строки, листать глазами и выбирать — всё это
   * делается на месте и без похода в чужой API на каждую букву.
   *
   * Список живёт в памяти пять минут. Прайс не меняется в течение
   * разговора, а без кэша каждое открытие окна — это десяток запросов
   * к Zoho, которые она считает.
   */
  app.get('/crm/products', async (req, reply) => {
    const a = requireAuth(req);
    if (!a) return reply.code(401).send(auth401);

    const fresh = catalogs.get(a.tenantId);
    if (fresh && Date.now() - fresh.at < CATALOG_TTL) {
      return { products: fresh.items, truncated: fresh.truncated, cached: true };
    }

    const z = await zohoFor(a.tenantId);
    if ('error' in z) return reply.code(409).send(z);

    const items: CatalogItem[] = [];
    let truncated = false;

    for (let page = 1; page * CATALOG_PAGE <= CATALOG_MAX; page += 1) {
      const url = new URL(`${z.inst.api_domain}/crm/v6/Products`);
      url.searchParams.set('fields', 'Product_Name,Product_Code,Unit_Price,Product_Active');
      url.searchParams.set('per_page', String(CATALOG_PAGE));
      url.searchParams.set('page', String(page));
      const res = await fetch(url, { headers: z.head, signal: AbortSignal.timeout(20_000) });

      // 204 — товаров нет вовсе. Это ответ, а не сбой.
      if (res.status === 204) break;
      if (!res.ok) return reply.code(502).send(await zohoWhy(res));

      const got = catalogPage(await res.json());
      for (const item of got.items) items.push(item);
      if (!got.more) break;
      if ((page + 1) * CATALOG_PAGE > CATALOG_MAX) truncated = true;
    }

    const sorted = sortCatalog(items);
    catalogs.set(a.tenantId, { at: Date.now(), items: sorted, truncated });
    return { products: sorted, truncated, cached: false };
  });

  /**
   * Поля заказа — те, что есть в этой организации.
   *
   * Разметку Sales_Orders правят: где-то обязателен срок поставки,
   * где-то свой «Менеджер», где-то ничего сверх названия. Спрашиваем
   * Zoho, какие поля у заказа есть и какие она считает обязательными,
   * и показываем их в окне. Свой список обязательных полей устарел бы
   * в тот же день, когда клиент добавил своё.
   */
  app.get('/crm/order-fields', async (req, reply) => {
    const a = requireAuth(req);
    if (!a) return reply.code(401).send(auth401);

    const z = await zohoFor(a.tenantId);
    if ('error' in z) return reply.code(409).send(z);

    const got = await fieldsFor(a.tenantId, z);
    if ('error' in got) return reply.code(502).send(got);
    return got;
  });

  /**
   * Заказ из разговора.
   *
   * Zoho требует у заказа компанию — не мы. Поэтому без привязанной
   * компании заказ не создать, и человеку об этом говорится прямо, а не
   * отказом «Zoho не приняла».
   *
   * Компания и контакт берутся из самой CRM, а не из нашего кэша:
   * связь могли поменять там, и заказ обязан уехать туда, где клиент
   * числится сейчас.
   *
   * Цены приходят с клиента, и это намеренно: оператор договаривается о
   * скидке в разговоре, и подставлять прайсовую цену поверх
   * договорённости значит делать заказ, который придётся переписывать
   * руками. Сумму считает Zoho — своё умножение здесь было бы вторым
   * мнением о том, сколько клиент должен.
   */
  app.post<{
    Params: { id: string };
    Body: {
      subject?: string;
      items?: Array<{ productId?: string; quantity?: number; price?: number }>;
      fields?: Record<string, unknown>;
    };
  }>('/conversations/:id/order', async (req, reply) => {
    const a = requireAuth(req);
    if (!a) return reply.code(401).send(auth401);

    const items = orderItems(req.body?.items);
    if (!items.length) return reply.code(400).send({ error: 'items_required' });

    const conv = await withTenant(pool, a.tenantId, async (db) => {
      const { rows } = await db.query<{
        contact_id: string;
        crm_module: string | null;
        crm_record_id: string | null;
        display_name: string | null;
      }>(
        `SELECT c.contact_id, ct.crm_module, ct.crm_record_id, ct.display_name
           FROM conversations c JOIN contacts ct ON ct.id = c.contact_id
          WHERE c.id = $1 AND ${channelScope('c.channel_id', '$2')}`,
        [req.params.id, a.userId],
      );
      return rows[0] ?? null;
    });
    if (!conv) return reply.code(404).send({ error: 'not_found' });
    if (!conv.crm_record_id) return reply.code(409).send({ error: 'not_linked' });

    const z = await zohoFor(a.tenantId);
    if ('error' in z) return reply.code(409).send(z);

    // Лида в заказ положить нельзя: у Sales_Orders поля под лида нет.
    // Но лида могли сконвертировать в Zoho минуту назад — тогда связь
    // догоняется сама, и отказывать не за что.
    let recordId = conv.crm_record_id;
    if (conv.crm_module !== 'Contacts') {
      const moved = await followConversion(a.tenantId, conv.contact_id, recordId, z);
      if (!moved) return reply.code(409).send({ error: 'lead_not_converted' });
      recordId = moved;
    }

    /*
     * Компания. Спрашиваем, но не требуем.
     *
     * В стандартной разметке Zoho компания у заказа обязательна, но
     * разметку меняют, и в половине организаций это поле необязательное.
     * Решать за чужую CRM, что ей обязательно, — верный способ
     * запретить то, что она разрешает. Поэтому компанию подставляем,
     * если она есть, а отказ, если он будет, придёт от самой Zoho и с
     * её словами.
     */
    const who = await fetch(
      `${z.inst.api_domain}/crm/v6/Contacts/${recordId}?fields=Account_Name,Last_Name`,
      { headers: z.head, signal: AbortSignal.timeout(20_000) },
    );
    if (!who.ok) return reply.code(502).send(await zohoWhy(who));
    const whoBody = (await who.json()) as {
      data?: Array<{ Account_Name?: { id?: string; name?: string } }>;
    };
    const accountId = whoBody.data?.[0]?.Account_Name?.id;

    const subject = orderSubject(req.body?.subject, conv.display_name);

    /*
     * Поля заказа. Принимаем только те, что Zoho назвала сама, и
     * заранее проверяем обязательные: отказ «поле такое-то обязательно»
     * приходит от Zoho её словами и её именами полей, а человек видел
     * в окне подписи. Свои подписи мы знаем — ими и отвечаем.
     */
    const meta = await fieldsFor(a.tenantId, z);
    let extra: Record<string, unknown> = {};
    if ('error' in meta) {
      // Описание полей не пришло. Заказ без своих полей уедет и так —
      // он и раньше уезжал. А вот молча выбросить то, что человек
      // заполнил в окне, нельзя: он увидит «создано» и недостающее
      // поле в Zoho.
      const sent = req.body?.fields && Object.keys(req.body.fields).length > 0;
      if (sent) return reply.code(502).send(meta);
    } else {
      const picked = orderValues(meta.fields, req.body?.fields);
      if (picked.missing.length) {
        return reply.code(400).send({ error: 'fields_required', detail: picked.missing.join(', ') });
      }
      extra = picked.values;
    }

    const res = await fetch(`${z.inst.api_domain}/crm/v6/Sales_Orders`, {
      method: 'POST',
      headers: z.head,
      body: JSON.stringify({
        data: [
          {
            ...extra,
            Subject: subject,
            ...(accountId ? { Account_Name: { id: accountId } } : {}),
            Contact_Name: { id: recordId },
            Product_Details: items.map((i) => ({
              product: { id: i.productId },
              quantity: i.quantity,
              list_price: i.price,
            })),
          },
        ],
      }),
      signal: AbortSignal.timeout(25_000),
    });

    const body = (await res.json().catch(() => ({}))) as {
      code?: string;
      message?: string;
      data?: Array<{ code?: string; details?: { id?: string }; message?: string }>;
    };
    const first = body.data?.[0];
    if (!res.ok || first?.code !== 'SUCCESS' || !first.details?.id) {
      // Отказ по правам приходит не в data, а сам по себе: у него нет
      // ни строки заказа, ни сообщения про поле.
      const why = body.data ? { error: 'zoho_refused', detail: first?.message } : whyBody(body);
      return reply.code(502).send(why);
    }

    return {
      orderId: first.details.id,
      subject,
      // В интерфейсе закладка называется иначе, чем модуль в API.
      url: zohoRecordUrl(z.inst.api_domain, 'SalesOrders', first.details.id),
    };
  });

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
