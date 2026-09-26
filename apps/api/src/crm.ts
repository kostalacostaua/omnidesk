import type { FastifyInstance } from 'fastify';
import {
  CrmError,
  bitrixLink,
  bitrixPhone,
  bitrixWhoAmI,
  bitrixPortal,
  bitrixRoot,
  type BitrixCreds,
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
  orderReady,
  parseOrderSettings,
  pipelineFields,
  pipelines,
  subforms,
  subformColumns,
  guessColumns,
  isOrderModule,
  STOCK_SUBFORM,
  STOCK_COLUMNS,
  discountAmount,
  orderTotal,
  type OrderModule,
  type OrderPipeline,
  type OrderSettings,
  type SubformRef,
  type SubformColumn,
  type PipelineRef,
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
  return async function crmPhone(
    tenantId: string,
    recordId: string,
    kind = 'pipedrive',
    module = '',
  ): Promise<string | null> {
    const want = kind === 'bitrix24' ? 'bitrix24' : 'pipedrive';
    const row = await withTenant(deps.pool, tenantId, async (db) => {
      const { rows } = await db.query<{ id: string; creds_enc: Buffer }>(
        `SELECT id, creds_enc FROM crm_connections
          WHERE kind = $1 AND status = 'active' LIMIT 1`,
        [want],
      );
      return rows[0] ?? null;
    });
    if (!row) return null;

    try {
      const creds = decryptJson<Creds>(deps.masterKey, tenantId, row.creds_enc);
      if (want === 'bitrix24') {
        const link = await bitrixLink({
          pool: deps.pool,
          masterKey: deps.masterKey,
          tenantId,
          rowId: row.id,
          creds: creds as BitrixCreds,
        });
        return await bitrixPhone(link.call, module, recordId);
      }
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
  const metas = new Map<string, { at: number; meta: OrderMeta }>();
  const forms = new Map<string, { at: number; form: unknown }>();

  interface OrderMeta {
    fields: OrderField[];
    subforms: Array<SubformRef & { columns: SubformColumn[]; guess: ReturnType<typeof guessColumns> }>;
    pipelines: PipelineRef[];
  }

  /** Настройки заказа этой организации. */
  async function orderSettings(tenantId: string): Promise<OrderSettings> {
    return withSystem(pool, 'настройки заказа', async (db) => {
      const { rows } = await db.query<{ crm: { order?: unknown } | null }>(
        `SELECT crm FROM tenants WHERE id = $1 LIMIT 1`,
        [tenantId],
      );
      return parseOrderSettings(rows[0]?.crm?.order);
    });
  }

  /**
   * Разметка модуля: поля, подформы с их колонками и воронки.
   *
   * Спрашивается и при настройке, и при создании заказа. Второе важнее
   * первого: процессов у api несколько, окно могло спросить поля у
   * одного, а заказ уехать к другому. Если бы создание полагалось на
   * память своего процесса, у второго её бы не было — и заполненные
   * человеком поля тихо пропали бы по дороге.
   */
  async function metaFor(
    tenantId: string,
    z: { inst: { api_domain: string }; head: Record<string, string> },
    module: OrderModule,
  ): Promise<OrderMeta | { error: string; detail?: string }> {
    const key = tenantId + ':' + module;
    const fresh = metas.get(key);
    if (fresh && Date.now() - fresh.at < FIELDS_TTL) return fresh.meta;

    const ask = async (path: string, params: Record<string, string>) => {
      const url = new URL(`${z.inst.api_domain}/crm/v6/settings/${path}`);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      const res = await fetch(url, { headers: z.head, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) return { error: await zohoWhy(res) };
      return { body: await res.json() };
    };

    const own = await ask('fields', { module });
    if ('error' in own) return own.error as { error: string; detail?: string };

    const meta: OrderMeta = {
      fields: orderFields(own.body),
      subforms: [],
      pipelines: [],
    };

    /*
     * Стандартная таблица товаров подформой не считается и в списке
     * полей её нет. Но складывать товары надо именно в неё, поэтому в
     * «Замовленнях» она стоит первой и с известными колонками.
     */
    for (const sub of subforms(own.body)) {
      let columns: SubformColumn[] = [];
      if (sub.module) {
        const got = await ask('fields', { module: sub.module });
        if (!('error' in got)) columns = subformColumns(got.body);
      }
      /*
       * Таблица товаров приходит обычным полем-подформой, но без
       * модуля, из которого можно прочитать её устройство: её колонки
       * зашиты в самом API. Своего списка сюда не подставляли — и в
       * настройках на месте выбора колонок было четыре пустых списка.
       *
       * Узнаём её по имени: у заказа Ordered_Items, и это имя нам
       * известно, потому что в этот модуль мы и создаём.
       */
      const stock = sub.api === STOCK_SUBFORM.api;
      if (!columns.length && stock) columns = STOCK_COLUMNS;
      meta.subforms.push({
        ...sub,
        columns,
        guess: stock
          ? {
              product: STOCK_SUBFORM.product,
              quantity: STOCK_SUBFORM.quantity,
              price: STOCK_SUBFORM.price,
              discount: STOCK_SUBFORM.discount,
            }
          : guessColumns(columns),
      });
    }

    /*
     * Воронки живут внутри макетов: у Zoho список воронок сам по себе
     * не существует, его спрашивают у макета. Поэтому сначала макеты,
     * потом воронки каждого — иначе у компании с двумя макетами
     * половина воронок просто не появилась бы в настройках.
     */
    if (module === 'Deals') {
      const lays = await ask('layouts', { module });
      if ('error' in lays) return lays.error as { error: string; detail?: string };
      const list = ((lays.body ?? {}) as { layouts?: unknown }).layouts;
      const layouts = Array.isArray(list) ? list.slice(0, 10) : [];

      for (const one of layouts) {
        const l = (one ?? {}) as { id?: unknown; name?: unknown; status?: unknown };
        const id = String(l.id ?? '');
        if (!/^[0-9]+$/.test(id) || l.status === 'inactive') continue;
        const got = await ask('pipeline', { layout_id: id });
        if ('error' in got) continue;
        for (const p of pipelines(got.body, id, String(l.name ?? ''))) meta.pipelines.push(p);
      }
    }

    metas.set(key, { at: Date.now(), meta });
    return meta;
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
   * Сконвертировать лида в контакт.
   *
   * Заказ делается на контакт — так устроена Zoho, и спорить с этим
   * нечем. До сих пор оператору говорили «сконвертуйте його там»: уйти
   * в другую вкладку, найти карточку, нажать Convert, вернуться и
   * нажать «оновити звʼязок». Пять действий ради одного, и все пять —
   * в разгар разговора с клиентом.
   *
   * Теперь это одна кнопка. Конвертацию делает Zoho своими правилами:
   * компанию заводит, если у лида есть название, сделку не создаёт —
   * её создаст заказ, и вторая сделка про то же самое никому не нужна.
   */
  app.post<{ Params: { id: string } }>('/contacts/:id/crm/convert', async (req, reply) => {
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

    // Его могли сконвертировать минуту назад в самой Zoho. Тогда
    // конвертировать нечего, и это не ошибка, а готовый ответ.
    const already = await followConversion(a.tenantId, req.params.id, row.crm_record_id, z);
    if (already) return { module: 'Contacts', recordId: already, already: true };

    const res = await fetch(
      `${z.inst.api_domain}/crm/v6/Leads/${row.crm_record_id}/actions/convert`,
      {
        method: 'POST',
        headers: z.head,
        // Сделку не создаём: заказ из разговора сам заведёт то, что
        // нужно, а пустая сделка «Костя Сластин» в воронке — мусор,
        // который потом закрывают руками.
        body: JSON.stringify({ data: [{ overwrite: false, notify_lead_owner: false }] }),
        signal: AbortSignal.timeout(25_000),
      },
    );

    const body = (await res.json().catch(() => ({}))) as {
      code?: string;
      message?: string;
      data?: Array<{ Contacts?: unknown; Accounts?: unknown; code?: string; message?: string }>;
    };
    const first = body.data?.[0];
    const made = first?.Contacts;
    const contactId = typeof made === 'string' || typeof made === 'number' ? String(made) : '';

    if (!res.ok || !/^[0-9]+$/.test(contactId)) {
      const why = body.data
        ? { error: 'zoho_refused', detail: first?.message }
        : whyBody(body);
      return reply.code(502).send(why);
    }

    await withTenant(pool, a.tenantId, async (db) => {
      await db.query(
        `UPDATE contacts SET crm_module = 'Contacts', crm_record_id = $2 WHERE id = $1`,
        [req.params.id, contactId],
      );
    });
    app.log.info(
      { tenantId: a.tenantId, leadId: row.crm_record_id, contactId },
      'Лид сконвертирован по кнопке',
    );
    return { module: 'Contacts', recordId: contactId };
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
   * Разметка модуля, в который уедет заказ.
   *
   * Отвечает на три вопроса настройки разом: какие поля есть, где
   * лежат строки товаров и какие воронки заведены. Три отдельные
   * ручки означали бы три состояния загрузки на одной странице и три
   * повода ей рассыпаться.
   */
  app.get<{ Querystring: { module?: string } }>('/crm/order-meta', async (req, reply) => {
    const a = requireAuth(req);
    if (!a) return reply.code(401).send(auth401);

    const module = isOrderModule(req.query?.module) ? req.query.module : 'Sales_Orders';
    const z = await zohoFor(a.tenantId);
    if ('error' in z) return reply.code(409).send(z);

    const got = await metaFor(a.tenantId, z, module);
    if ('error' in got) return reply.code(502).send(got);
    return got;
  });

  /**
   * Настройки заказа: что показывать оператору и куда складывать.
   *
   * Лежат в тех же настройках CRM, что и «кого заводить»: это одно
   * решение одного человека про одну связку, и разводить его по двум
   * страницам незачем.
   */
  app.get('/settings/orders', async (req, reply) => {
    const a = requireAuth(req);
    if (!a) return reply.code(401).send(auth401);
    return { settings: await orderSettings(a.tenantId) };
  });

  app.patch<{ Body: Record<string, unknown> }>('/settings/orders', async (req, reply) => {
    const a = requireAuth(req);
    if (!a) return reply.code(401).send(auth401);

    const next = parseOrderSettings(req.body);

    /*
     * Пишем слиянием, а не заменой всего поля: рядом живёт «кого
     * заводить», и перезапись целиком стёрла бы его — молча и
     * необратимо.
     */
    await withSystem(pool, 'настройки заказа', async (db) => {
      await db.query(
        `UPDATE tenants SET crm = COALESCE(crm, '{}'::jsonb) || jsonb_build_object('order', $2::jsonb)
          WHERE id = $1`,
        [a.tenantId, JSON.stringify(next)],
      );
    });

    // Разметка могла не меняться, а настройка — да: окно заказа
    // собирается из обеих, и старый ответ показал бы старые поля.
    forms.delete(a.tenantId);
    return { settings: next };
  });

  /**
   * Окно заказа, собранное для оператора.
   *
   * Здесь сходятся настройка и разметка: какие воронки ему открыты,
   * какие поля спрашивать в каждой и готова ли связка вообще. Считать
   * это в браузере значило бы отдать туда весь список полей модуля и
   * правило «одинаковые поля» — а оно обязано совпадать с тем, по
   * которому потом проверяется сам заказ.
   */
  app.get('/crm/order-form', async (req, reply) => {
    const a = requireAuth(req);
    if (!a) return reply.code(401).send(auth401);

    const fresh = forms.get(a.tenantId);
    if (fresh && Date.now() - fresh.at < FIELDS_TTL) return fresh.form;

    const z = await zohoFor(a.tenantId);
    if ('error' in z) return reply.code(409).send(z);

    const s = await orderSettings(a.tenantId);
    const meta = await metaFor(a.tenantId, z, s.module);
    if ('error' in meta) return reply.code(502).send(meta);

    const pick = (names: string[]) => {
      const chosen = meta.fields.filter((f) => names.includes(f.api) || f.required);
      return chosen;
    };

    const form = {
      module: s.module,
      ready: orderReady(s),
      // Скидки показываем, только если им есть куда уехать: поле
      // скидки в окне, которое никуда не пишется, — это обещание,
      // которого не будет в заказе.
      lineOff: Boolean(s.subform.discount),
      wholeOff: Boolean(s.discountField),
      // Названия воронок берём из разметки, а не из сохранённой
      // настройки: воронку переименовали — оператор должен увидеть
      // новое имя, а не то, что записали полгода назад.
      pipelines: s.pipelines.map((p) => {
        const live = meta.pipelines.filter((x) => x.id === p.id)[0];
        return {
          id: p.id,
          name: live?.name || p.name || p.id,
          fields: pick(pipelineFields(s, p.id)),
        };
      }),
      fields: pick(s.fields),
    };

    forms.set(a.tenantId, { at: Date.now(), form });
    return form;
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
      items?: Array<{ productId?: string; quantity?: number; price?: number; discount?: string }>;
      discount?: string;
      fields?: Record<string, unknown>;
      pipeline?: string;
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

    const s = await orderSettings(a.tenantId);
    if (!orderReady(s)) return reply.code(409).send({ error: 'order_not_set_up' });

    /*
     * Воронка. Оператор выбирает из тех, что ему открыли в настройках,
     * и проверяем это здесь, а не полагаемся на выпадающий список:
     * список живёт в браузере, а браузер присылает что угодно.
     */
    let pipe: OrderPipeline | null = null;
    if (s.module === 'Deals') {
      const asked = String(req.body?.pipeline ?? '');
      pipe = s.pipelines.filter((p) => p.id === asked)[0] ?? (asked ? null : s.pipelines[0] ?? null);
      if (!pipe) return reply.code(400).send({ error: 'pipeline_not_allowed' });
    }

    /*
     * Поля заказа. Принимаем только те, что Zoho назвала сама и что
     * открыты в этой воронке. Обязательные проверяем заранее: отказ
     * «поле такое-то обязательно» приходит от Zoho её словами и её
     * именами полей, а человек видел в окне подписи. Свои подписи мы
     * знаем — ими и отвечаем.
     */
    const meta = await metaFor(a.tenantId, z, s.module);
    if ('error' in meta) return reply.code(502).send(meta);

    const open = pipelineFields(s, pipe?.id);
    const shown = meta.fields.filter((f) => open.includes(f.api) || f.required);
    const picked = orderValues(shown, req.body?.fields);
    if (picked.missing.length) {
      return reply.code(400).send({ error: 'fields_required', detail: picked.missing.join(', ') });
    }

    /*
     * Строки товаров. Имена колонок берём из настроек: у стандартной
     * таблицы «Замовлень» они известны Zoho, у подформы сделки их
     * придумали на месте, и угадать «Кількість» против «Qty» нельзя.
     *
     * Товар кладём ссылкой, если колонка — ссылка на товары, и
     * названием, если это обычный текст: в половине подформ товар
     * записан строкой, и ссылка туда не влезет.
     */
    const sub = s.subform;
    const cols = meta.subforms.filter((x) => x.api === sub.api)[0];
    const col = cols?.columns.filter((c) => c.api === sub.product)[0];
    // Колонку не нашли — считаем ссылкой: так устроены и стандартная
    // таблица, и девять подформ из десяти.
    const link = !col || col.lookup !== '';

    let names = new Map<string, string>();
    if (!link) {
      // Товар записывается строкой. Название берём из каталога, а если
      // этот процесс его ещё не тянул — спрашиваем Zoho: записать в
      // заказ идентификатор вместо названия значит испортить заказ
      // молча.
      const have = catalogs.get(a.tenantId);
      if (have) names = new Map(have.items.map((i) => [i.id, i.name || i.code]));
      const lack = items.filter((i) => !names.has(i.productId)).map((i) => i.productId);
      if (lack.length) {
        const url = new URL(`${z.inst.api_domain}/crm/v6/Products`);
        url.searchParams.set('ids', lack.slice(0, 100).join(','));
        url.searchParams.set('fields', 'Product_Name,Product_Code');
        const got = await fetch(url, { headers: z.head, signal: AbortSignal.timeout(20_000) });
        if (got.ok) {
          for (const row of catalogPage(await got.json()).items) {
            names.set(row.id, row.name || row.code);
          }
        }
      }
      const unknown = items.filter((i) => !names.get(i.productId));
      if (unknown.length) return reply.code(502).send({ error: 'product_unknown' });
    }

    const rows = items.map((i) => {
      const row: Record<string, unknown> = {};
      row[sub.product] = link ? { id: i.productId } : names.get(i.productId);
      if (sub.quantity) row[sub.quantity] = i.quantity;
      if (sub.price) row[sub.price] = i.price;
      // Скидку кладём, только если колонка для неё указана: писать её
      // в поле, которого нет, — это отказ всего заказа из-за уступки в
      // двести гривен.
      if (sub.discount && i.discount > 0) row[sub.discount] = i.discount;
      return row;
    });

    /*
     * Скидка на весь заказ. Считается от суммы со скидками строк:
     * «минус десять процентов сверху» означает десять процентов от
     * того, что человек назвал клиенту, а не от прайса.
     */
    const whole = s.discountField
      ? discountAmount(req.body?.discount, orderTotal(items))
      : 0;

    const record: Record<string, unknown> = {
      ...picked.values,
      ...(whole > 0 ? { [s.discountField]: whole } : {}),
      ...(accountId ? { Account_Name: { id: accountId } } : {}),
      Contact_Name: { id: recordId },
      [sub.api]: rows,
    };

    if (s.module === 'Deals' && pipe) {
      record.Deal_Name = subject;
      record.Stage = pipe.stage;
      record.Pipeline = { id: pipe.id };
      if (pipe.layout) record.Layout = { id: pipe.layout };
    } else {
      record.Subject = subject;
    }

    const res = await fetch(`${z.inst.api_domain}/crm/v6/${s.module}`, {
      method: 'POST',
      headers: z.head,
      body: JSON.stringify({ data: [record] }),
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
      // В интерфейсе закладки называются иначе, чем модули в API.
      url: zohoRecordUrl(
        z.inst.api_domain,
        s.module === 'Deals' ? 'Potentials' : 'SalesOrders',
        first.details.id,
      ),
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
        // Слиянием, а не заменой: рядом в этом же поле лежат настройки
        // заказа, и замена целиком стёрла бы их молча.
        await db.query(
          `UPDATE tenants SET crm = COALESCE(crm, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
          [
            a.tenantId,
            JSON.stringify(next),
          ],
        );
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
      /*
       * Битрикс бывает подключён приложением, а не вебхуком: тогда и
       * здороваемся мы токеном. Одно место решает чем — иначе проверка
       * связи отвечала бы «нет связи» там, где связь есть.
       */
      const who = row.kind === 'bitrix24'
        ? await bitrixWhoAmI(
            (await bitrixLink({
              pool, masterKey, tenantId: a.tenantId, rowId: row.id, creds: creds as BitrixCreds,
            })).call,
          )
        : await crmPing(row.kind as CrmKind, creds);
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

    const gone = await withTenant(pool, a.tenantId, async (db) => {
      const { rows } = await db.query<{ kind: string }>(
        `DELETE FROM crm_connections WHERE id = $1 RETURNING kind`,
        [req.params.id],
      );
      return rows[0] ?? null;
    });

    if (!gone) return reply.code(404).send({ error: 'not_found' });

    /*
     * Отключили Битрикс — отпускаем и портал. Иначе тот же портал
     * нельзя будет подключить ни в другой компании, ни здесь заново:
     * он так и останется числиться занятым за той записью, которой
     * больше нет.
     */
    if (gone.kind === 'bitrix24') {
      await withSystem(pool, 'портал Битрикса', async (db) => {
        await db.query(`DELETE FROM bitrix_portals WHERE tenant_id = $1`, [a.tenantId]);
      });
    }

    return { ok: true };
  });
}
