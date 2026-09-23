/**
 * Битрикс24 и Pipedrive.
 *
 * Обе CRM делают для нас одно и то же: найти клиента по телефону и, если
 * его нет, завести карточку. Поэтому здесь один общий вид ответа —
 * `CrmMatch` — и две реализации под него.
 *
 * Про Битрикс. Подключение идёт входящим вебхуком, а не приложением из
 * маркета: приложение надо публиковать и проводить модерацию, а вебхук
 * клиент создаёт сам за минуту. Адрес вебхука выглядит как
 * `https://company.bitrix24.ru/rest/1/КЛЮЧ/` и одинаково работает и в
 * облаке, и в коробке на своём сервере — меняется только домен.
 *
 * Про Pipedrive. Там токен в заголовке и домен компании. Поиск идёт по
 * их «search» — он ищет по подстроке, поэтому телефон приводится к
 * цифрам: +380 67 123-45-67 и 0671234567 для человека одно и то же, а
 * для поиска по подстроке — нет.
 *
 * Сеть вынесена параметром, чтобы сборку запросов и разбор ответов
 * можно было проверить без единого обращения наружу.
 */

export type CrmKind = 'bitrix24' | 'pipedrive';

export interface CrmMatch {
  /** Что нашли или создали: контакт или лид. */
  module: string;
  /** Идентификатор записи в CRM — по нему строится ссылка. */
  recordId: string;
  /** Ссылка на карточку для оператора. */
  url: string | null;
}

export interface CrmPerson {
  name: string;
  phone?: string | null;
  email?: string | null;
  /** Откуда пришёл: Telegram, Instagram — попадает в название лида. */
  source?: string;
}

export class CrmError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'CrmError';
  }
}

type FetchLike = (url: string, init?: Record<string, unknown>) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

/** Только цифры: у поиска по подстроке нет понятия «тот же номер». */
export function digits(phone: string | null | undefined): string {
  return (phone ?? '').replace(/[^0-9]/g, '');
}

/* ── Битрикс24 ──────────────────────────────────────────────────── */

/**
 * Разобрать адрес вебхука.
 *
 * Клиент копирует его из Битрикса как есть, иногда вместе с именем
 * метода на конце. Нам нужен корень — к нему мы сами дописываем метод.
 */
export function bitrixRoot(webhook: string): string {
  const raw = (webhook ?? '').trim();
  const m = raw.match(/^(https:\/\/[^/]+\/rest\/\d+\/[A-Za-z0-9]+)\//);
  if (!m?.[1]) {
    throw new CrmError(
      'Адрес вебхука выглядит не так. Нужен вид https://вашпортал/rest/1/КЛЮЧ/',
      'bad_webhook',
    );
  }
  return m[1];
}

/** Адрес портала — по нему строится ссылка на карточку. */
export function bitrixPortal(webhook: string): string {
  const root = bitrixRoot(webhook);
  return root.slice(0, root.indexOf('/rest/'));
}

async function bitrixCall(
  webhook: string,
  method: string,
  params: Record<string, unknown>,
  doFetch: FetchLike,
): Promise<unknown> {
  const res = await doFetch(`${bitrixRoot(webhook)}/${method}.json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new CrmError('Битрикс не принял вебхук — проверьте права и адрес', 'bad_key');
    }
    throw new CrmError(`Битрикс ответил ошибкой (${res.status})`, 'refused');
  }

  const payload = (await res.json()) as { result?: unknown; error_description?: string; error?: string };
  if (payload?.error) {
    throw new CrmError(payload.error_description || 'Битрикс отказал', payload.error);
  }
  return payload?.result;
}

/** Найти контакт или лид по телефону, иначе завести лид. */
export async function bitrixFindOrCreate(
  webhook: string,
  person: CrmPerson,
  opts: { fetchImpl?: FetchLike } = {},
): Promise<CrmMatch> {
  const doFetch = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const portal = bitrixPortal(webhook);
  const phone = digits(person.phone);

  if (phone) {
    // crm.duplicate.findbycomm — штатный способ Битрикса спросить
    // «есть ли уже такой телефон»: он сам знает про форматы номера.
    const found = (await bitrixCall(webhook, 'crm.duplicate.findbycomm', {
      type: 'PHONE',
      values: [person.phone],
      entity_type: 'CONTACT',
    }, doFetch)) as { CONTACT?: number[] } | null;

    const contactId = found?.CONTACT?.[0];
    if (contactId) {
      return {
        module: 'contact',
        recordId: String(contactId),
        url: `${portal}/crm/contact/details/${contactId}/`,
      };
    }

    const foundLead = (await bitrixCall(webhook, 'crm.duplicate.findbycomm', {
      type: 'PHONE',
      values: [person.phone],
      entity_type: 'LEAD',
    }, doFetch)) as { LEAD?: number[] } | null;

    const leadId = foundLead?.LEAD?.[0];
    if (leadId) {
      return { module: 'lead', recordId: String(leadId), url: `${portal}/crm/lead/details/${leadId}/` };
    }
  }

  const fields: Record<string, unknown> = {
    TITLE: person.name || `Клиент из ${person.source ?? 'мессенджера'}`,
    NAME: person.name || undefined,
    SOURCE_DESCRIPTION: person.source ? `Rozmovio: ${person.source}` : 'Rozmovio',
    OPENED: 'Y',
  };
  if (person.phone) fields.PHONE = [{ VALUE: person.phone, VALUE_TYPE: 'MOBILE' }];
  if (person.email) fields.EMAIL = [{ VALUE: person.email, VALUE_TYPE: 'WORK' }];

  const created = await bitrixCall(webhook, 'crm.lead.add', { fields }, doFetch);
  const id = typeof created === 'number' ? created : Number(created);
  if (!id || Number.isNaN(id)) throw new CrmError('Битрикс не вернул номер лида', 'no_id');

  return { module: 'lead', recordId: String(id), url: `${portal}/crm/lead/details/${id}/` };
}

/* ── Pipedrive ──────────────────────────────────────────────────── */

/** Корень API компании. Клиент вводит домен, остальное дописываем сами. */
export function pipedriveRoot(domain: string): string {
  const clean = (domain ?? '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  if (!clean || !clean.includes('.')) {
    throw new CrmError('Нужен домен вида company.pipedrive.com', 'bad_domain');
  }
  return `https://${clean}/api/v1`;
}

/**
 * Как представляться Pipedrive.
 *
 * Токен из личных настроек — это `x-api-token`, а токен приложения —
 * обычный Bearer. Различать их по виду строки нельзя, поэтому способ
 * выбирается явно: токен, начинающийся с «Bearer », считается токеном
 * приложения. Так вызывающему коду не нужно знать про два формата.
 */
function pipedriveAuth(token: string): Record<string, string> {
  return token.startsWith('Bearer ')
    ? { authorization: token }
    : { 'x-api-token': token };
}

async function pipedriveCall(
  domain: string,
  token: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
  doFetch?: FetchLike,
): Promise<unknown> {
  const fetchImpl = doFetch ?? (globalThis.fetch as unknown as FetchLike);
  // Токен идёт заголовком, а не параметром ?api_token=: параметр
  // попадает в журналы прокси, а ключ в журнале считается утёкшим.
  const res = await fetchImpl(`${pipedriveRoot(domain)}${path}`, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...pipedriveAuth(token) },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new CrmError('Pipedrive не принял токен', 'bad_key');
    }
    if (res.status === 404) throw new CrmError('Pipedrive не знает такого адреса', 'bad_domain');
    throw new CrmError(`Pipedrive ответил ошибкой (${res.status})`, 'refused');
  }

  const payload = (await res.json()) as { success?: boolean; data?: unknown; error?: string };
  if (payload?.success === false) throw new CrmError(payload.error || 'Pipedrive отказал', 'refused');
  return payload?.data;
}

/** Найти человека по телефону, иначе завести человека и лид к нему. */
export async function pipedriveFindOrCreate(
  domain: string,
  token: string,
  person: CrmPerson,
  opts: { fetchImpl?: FetchLike } = {},
): Promise<CrmMatch> {
  const doFetch = opts.fetchImpl;
  const site = `https://${domain.replace(/^https?:\/\//i, '').replace(/\/.*$/, '')}`;
  const phone = digits(person.phone);

  if (phone) {
    const found = (await pipedriveCall(
      domain, token,
      `/persons/search?term=${encodeURIComponent(phone)}&fields=phone&exact_match=false&limit=1`,
      {}, doFetch,
    )) as { items?: Array<{ item?: { id?: number } }> } | null;

    const id = found?.items?.[0]?.item?.id;
    if (id) {
      return { module: 'person', recordId: String(id), url: `${site}/person/${id}` };
    }
  }

  const created = (await pipedriveCall(domain, token, '/persons', {
    method: 'POST',
    body: {
      name: person.name || `Клиент из ${person.source ?? 'мессенджера'}`,
      ...(person.phone ? { phone: [{ value: person.phone, primary: true }] } : {}),
      ...(person.email ? { email: [{ value: person.email, primary: true }] } : {}),
    },
  }, doFetch)) as { id?: number } | null;

  const id = created?.id;
  if (!id) throw new CrmError('Pipedrive не вернул номер карточки', 'no_id');

  // Лид создаём отдельно: карточка человека без лида не попадает в
  // воронку, и менеджер о клиенте просто не узнает.
  await pipedriveCall(domain, token, '/leads', {
    method: 'POST',
    body: {
      title: `${person.name || 'Клиент'} — ${person.source ?? 'мессенджер'}`,
      person_id: id,
    },
  }, doFetch).catch(() => undefined);

  return { module: 'person', recordId: String(id), url: `${site}/person/${id}` };
}

/**
 * Телефон карточки.
 *
 * Нужен панели внутри Pipedrive: рамке достаётся только номер записи,
 * а диалог ищется по номеру телефона, если связь с карточкой ещё не
 * проставлена.
 */
export async function pipedrivePhone(
  domain: string,
  token: string,
  personId: string,
  opts: { fetchImpl?: FetchLike } = {},
): Promise<string | null> {
  const data = (await pipedriveCall(
    domain, token, `/persons/${encodeURIComponent(personId)}`, {}, opts.fetchImpl,
  )) as { phone?: Array<{ value?: string; primary?: boolean }> } | null;

  const list = data?.phone ?? [];
  const primary = list.find((x) => x.primary) ?? list[0];
  return primary?.value ?? null;
}

/* ── Приложение Pipedrive ───────────────────────────────────────── */

export interface PipedriveTokens {
  accessToken: string;
  refreshToken: string;
  /** Время в миллисекундах, когда токен перестанет работать. */
  expiresAt: number;
  /** Адрес API компании, который Pipedrive вернул вместе с токеном. */
  apiDomain: string;
}

/**
 * Обменять код на токены. Ключи приложения идут в заголовке Basic,
 * как того требует Pipedrive: в теле запроса их не принимают.
 */
export async function pipedriveExchange(
  params: { code?: string; refreshToken?: string; redirectUri?: string },
  app: { clientId: string; clientSecret: string },
  opts: { fetchImpl?: FetchLike } = {},
): Promise<PipedriveTokens> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const basic = Buffer.from(`${app.clientId}:${app.clientSecret}`).toString('base64');

  const body = new URLSearchParams(
    params.refreshToken
      ? { grant_type: 'refresh_token', refresh_token: params.refreshToken }
      : {
          grant_type: 'authorization_code',
          code: params.code ?? '',
          redirect_uri: params.redirectUri ?? '',
        },
  ).toString();

  const res = await fetchImpl('https://oauth.pipedrive.com/oauth/token', {
    method: 'POST',
    headers: {
      authorization: `Basic ${basic}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!res.ok) {
    throw new CrmError(
      res.status === 401 ? 'Pipedrive не принял ключи приложения' : `Pipedrive отказал (${res.status})`,
      res.status === 401 ? 'bad_app' : 'refused',
    );
  }

  const data = (await res.json()) as {
    access_token?: string; refresh_token?: string; expires_in?: number; api_domain?: string;
  };
  if (!data.access_token || !data.api_domain) {
    throw new CrmError('Pipedrive вернул ответ без токена', 'no_token');
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? params.refreshToken ?? '',
    // Минута в запасе: токен, истекающий во время запроса, выглядит
    // как случайный сбой и ищется дольше, чем стоит эта минута.
    expiresAt: Date.now() + Math.max(60, (data.expires_in ?? 3600) - 60) * 1000,
    apiDomain: data.api_domain,
  };
}

/** Адрес, куда отправлять человека за разрешением. */
export function pipedriveAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, state });
  return `https://oauth.pipedrive.com/oauth/authorize?${q.toString()}`;
}

/** Проверка связи при подключении — чтобы опечатку видеть сразу. */
export async function crmPing(
  kind: CrmKind,
  creds: { webhook?: string; domain?: string; token?: string },
  opts: { fetchImpl?: FetchLike } = {},
): Promise<string> {
  const doFetch = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);

  if (kind === 'bitrix24') {
    const who = (await bitrixCall(creds.webhook ?? '', 'profile', {}, doFetch)) as
      { NAME?: string; LAST_NAME?: string; ID?: number } | null;
    const name = [who?.NAME, who?.LAST_NAME].filter(Boolean).join(' ');
    return name || `пользователь ${who?.ID ?? ''}`.trim();
  }

  const me = (await pipedriveCall(creds.domain ?? '', creds.token ?? '', '/users/me', {}, doFetch)) as
    { name?: string; company_name?: string } | null;
  return [me?.name, me?.company_name].filter(Boolean).join(' · ') || 'подключено';
}
