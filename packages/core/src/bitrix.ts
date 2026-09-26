import { CrmError, bitrixPortal, bitrixWebhookCall, type BitrixCall } from './crm-simple.js';
import { encryptJson } from './crypto.js';
import { withTenant, type Pool } from './db.js';

/**
 * Битрикс24 как приложение, а не как вебхук.
 *
 * Вебхук умеет заводить лиды — и на этом всё. Виджет в карточке
 * клиента он поставить не может: Битрикс отвечает на placement.bind
 * отказом «нужен контекст приложения». А виджет — это и есть то, ради
 * чего к CRM подключаются: переписка должна быть видна там, где
 * менеджер работает, а не в соседней вкладке.
 *
 * Приложение из маркета пришлось бы публиковать и проводить модерацию.
 * Локальное — нет: клиент заводит его у себя за минуту, и оно
 * одинаково работает в облаке и в коробке. Плата — два ключа, которые
 * он копирует к нам: обновлять токен без них нельзя, а живёт токен час.
 *
 * Сеть вынесена параметром, чтобы сборку запросов и разбор ответов
 * можно было проверить без единого обращения наружу.
 */

type FetchLike = (url: string, init?: Record<string, unknown>) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

/**
 * Права, которые просим при создании приложения.
 *
 * crm — сами карточки, placement — виджет в них, user — имена
 * сотрудников для «ответственного». Больше не просим: список прав
 * человек видит глазами, и каждая лишняя строка в нём — повод
 * отказаться.
 */
export const BITRIX_SCOPES = 'crm, placement, user';

export interface BitrixApp {
  clientId: string;
  clientSecret: string;
}

export interface BitrixTokens {
  accessToken: string;
  refreshToken: string;
  /** Время в миллисекундах, когда токен перестанет работать. */
  expiresAt: number;
  /** Опознаватель портала. Не адрес: адрес клиент меняет, этот — нет. */
  memberId: string;
  /** Адрес портала: по нему идут запросы и строятся ссылки на карточки. */
  domain: string;
}

/** Что лежит в зашифрованном блоке подключения Битрикса. */
export interface BitrixCreds {
  /** Ключи локального приложения: без них токен не обновить. */
  app?: BitrixApp;
  oauth?: BitrixTokens;
  /** Старый путь — входящий вебхук. Остаётся у тех, кто уже подключён. */
  webhook?: string;
}

/**
 * Адрес портала из того, что прислали.
 *
 * Он приходит снаружи и попадает в адрес запроса и в заголовок рамки,
 * поэтому проверяется как чужой ввод, а не как наш: «своё» в этих двух
 * местах значит, что чужую страницу можно показать под нашим именем.
 */
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export function bitrixHost(raw: unknown): string {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '');
  if (s.length > 190 || !HOST.test(s)) {
    throw new CrmError('Битрикс прислал непонятный адрес порталу', 'bad_domain');
  }
  return s;
}

export function bitrixEndpoint(host: string): string {
  return `https://${bitrixHost(host)}/rest/`;
}

/* ── Рукопожатие ───────────────────────────────────────────────── */

/**
 * То, что Битрикс присылает на наш адрес.
 *
 * Присылает он это не только при установке, а при каждом открытии
 * приложения и каждого виджета: отдельного «события установки» у
 * приложения с интерфейсом нет. Поэтому разбор один на все случаи, а
 * что именно открылось — написано в PLACEMENT.
 */
export interface BitrixHandshake {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  memberId: string;
  domain: string;
  /** Постоянный ключ приложения: им Битрикс подписывает свои события. */
  appToken: string;
  /** DEFAULT — открыли само приложение; иначе код места. */
  placement: string;
  /** Что открыто: номер карточки и прочее, строкой JSON. */
  options: string;
}

const TOKEN = /^[A-Za-z0-9._-]{8,512}$/;
const MEMBER = /^[A-Za-z0-9]{8,64}$/;

function str(v: unknown): string {
  return typeof v === 'string' ? v : Array.isArray(v) ? String(v[0] ?? '') : v == null ? '' : String(v);
}

export function readHandshake(
  query: Record<string, unknown>,
  body: Record<string, unknown>,
): BitrixHandshake {
  const accessToken = str(body['AUTH_ID']);
  const refreshToken = str(body['REFRESH_ID']);
  const memberId = str(body['member_id']);
  if (!TOKEN.test(accessToken) || !TOKEN.test(refreshToken)) {
    throw new CrmError('Битрикс прислал запрос без токенов', 'no_token');
  }
  if (!MEMBER.test(memberId)) {
    throw new CrmError('Битрикс прислал запрос без опознавателя портала', 'no_member');
  }

  // Минута в запасе: токен, истекающий во время запроса, выглядит как
  // случайный сбой и ищется дольше, чем стоит эта минута.
  const life = Math.max(60, Number(str(body['AUTH_EXPIRES'])) || 3600);
  return {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + (life - 60) * 1000,
    memberId,
    domain: bitrixHost(str(query['DOMAIN']) || str(body['DOMAIN'])),
    appToken: str(body['APPLICATION_TOKEN']).slice(0, 256),
    placement: str(body['PLACEMENT']).slice(0, 120) || 'DEFAULT',
    options: str(body['PLACEMENT_OPTIONS']).slice(0, 4096),
  };
}

/**
 * Номер карточки, в которой открыт виджет.
 *
 * Тип карточки отсюда не берём: в этих настройках он приходит то
 * числом, то строкой, то не приходит вовсе, а знать его можно точно —
 * по тому, какое именно место открылось.
 */
export function placementRecord(options: string): string {
  try {
    const o = JSON.parse(options || '{}') as Record<string, unknown>;
    const id = str(o['ID'] ?? o['id'] ?? o['entityId']);
    return /^[0-9]{1,18}$/.test(id) ? id : '';
  } catch {
    return '';
  }
}

/** Где ставим виджет и какая карточка за этим местом стоит. */
export const BITRIX_PLACEMENTS: Array<{ code: string; module: string }> = [
  { code: 'CRM_CONTACT_DETAIL_TAB', module: 'contact' },
  { code: 'CRM_LEAD_DETAIL_TAB', module: 'lead' },
  { code: 'CRM_DEAL_DETAIL_TAB', module: 'deal' },
  { code: 'CRM_COMPANY_DETAIL_TAB', module: 'company' },
];

export function placementModule(code: string): string {
  const found = BITRIX_PLACEMENTS.filter((p) => p.code === code)[0];
  return found ? found.module : '';
}

/* ── Токены ────────────────────────────────────────────────────── */

/**
 * Обновление токена.
 *
 * Токен живёт час, обновляющий — полгода, и каждое обновление выдаёт
 * новый обновляющий. Старый после этого считаем недействительным и
 * сразу сохраняем новый: потерять его значит отправить клиента
 * переустанавливать приложение.
 *
 * Сервер обмена один на все облачные порталы — oauth.bitrix.info, — а
 * адрес самого портала он возвращает отдельно. Свой адрес портала у
 * коробки, и берём мы его из ответа, а не из памяти: портал могли
 * переименовать.
 */
export async function bitrixRefresh(
  app: BitrixApp,
  tokens: BitrixTokens,
  opts: { fetchImpl?: FetchLike } = {},
): Promise<BitrixTokens> {
  const doFetch = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const q = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: app.clientId,
    client_secret: app.clientSecret,
    refresh_token: tokens.refreshToken,
  });

  const res = await doFetch(`https://oauth.bitrix.info/oauth/token/?${q.toString()}`, {
    method: 'GET',
  });
  const data = (await res.json().catch(() => null)) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    member_id?: string;
    client_endpoint?: string;
    error?: string;
    error_description?: string;
  } | null;

  if (!res.ok || !data?.access_token) {
    /*
     * Отказ здесь означает не «сеть подвела», а «этим ключом больше не
     * войти»: приложение удалили, ключи сменили, полгода прошло.
     * Отдельный код, потому что чинится это только переустановкой, и
     * человеку надо сказать именно это.
     */
    const code = String(data?.error ?? '');
    throw new CrmError(
      code === 'invalid_grant' || code === 'invalid_client' || res.status === 400
        ? 'Битрикс больше не принимает ключи приложения — подключите заново'
        : `Битрикс не обновил доступ (${res.status})`,
      code === 'invalid_grant' || code === 'invalid_client' ? 'bad_app' : 'refused',
    );
  }

  const fromEndpoint = String(data.client_endpoint ?? '')
    .replace(/^https?:\/\//, '')
    .replace(/\/rest\/?$/, '');

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? tokens.refreshToken,
    expiresAt: Date.now() + Math.max(60, (data.expires_in ?? 3600) - 60) * 1000,
    memberId: data.member_id ?? tokens.memberId,
    domain: fromEndpoint && HOST.test(fromEndpoint) ? fromEndpoint : tokens.domain,
  };
}

/* ── Запрос к порталу ──────────────────────────────────────────── */

/**
 * Вызов метода с токеном приложения.
 *
 * Токен идёт в теле, а не в адресе: адрес целиком попадает в журналы
 * прокси, а ключ в журнале считается утёкшим.
 */
export async function bitrixApi(
  tokens: { domain: string; accessToken: string },
  method: string,
  params: Record<string, unknown>,
  opts: { fetchImpl?: FetchLike } = {},
): Promise<unknown> {
  const doFetch = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const res = await doFetch(`${bitrixEndpoint(tokens.domain)}${method}.json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...params, auth: tokens.accessToken }),
  });

  const data = (await res.json().catch(() => null)) as {
    result?: unknown;
    error?: string;
    error_description?: string;
  } | null;

  const err = String(data?.error ?? '');
  if (err) throw new CrmError(bitrixWhy(err, data?.error_description), bitrixCode(err));
  if (!res.ok) throw new CrmError(`Битрикс ответил ошибкой (${res.status})`, 'refused');
  return data?.result;
}

/** Свой код на каждую причину: чинятся они по-разному. */
function bitrixCode(error: string): string {
  const e = error.toLowerCase();
  if (e === 'expired_token' || e === 'invalid_token') return 'expired_token';
  if (e === 'no_auth_found' || e === 'invalid_credentials') return 'bad_key';
  if (e === 'insufficient_scope') return 'scope';
  if (e === 'wrong_auth_type') return 'wrong_auth';
  if (e === 'access_denied') return 'plan';
  return 'refused';
}

function bitrixWhy(error: string, detail?: string): string {
  const code = bitrixCode(error);
  if (code === 'expired_token') return 'Доступ к Битриксу истёк';
  if (code === 'bad_key') return 'Битрикс не принял доступ — подключите заново';
  if (code === 'scope') return 'Приложению в Битриксе не хватает прав: отметьте crm, placement и user';
  if (code === 'wrong_auth') return 'Этот метод Битрикса работает только у приложения, не у вебхука';
  if (code === 'plan') return 'На этом тарифе Битрикса доступ к API закрыт';
  return detail || 'Битрикс отказал';
}

/* ── Подключение ───────────────────────────────────────────────── */

export interface BitrixLink {
  /** Вызов метода: одинаковый и у приложения, и у старого вебхука. */
  call: BitrixCall;
  /** Адрес портала без хвоста — из него строятся ссылки на карточки. */
  portal: string;
  /** Есть ли контекст приложения: виджеты ставятся только с ним. */
  asApp: boolean;
}

/**
 * Готовое к работе подключение.
 *
 * Одно место, где решается, чем мы говорим с Битриксом — токеном
 * приложения или старым вебхуком. Иначе каждый вызывающий выбирал бы
 * сам, и половина забыла бы обновить токен.
 *
 * Обновлённый токен сразу пишется обратно: иначе каждое открытие
 * карточки начиналось бы с обмена, а Битрикс такие обмены считает.
 */
export async function bitrixLink(p: {
  pool: Pool;
  masterKey: Buffer;
  tenantId: string;
  rowId: string;
  creds: BitrixCreds;
  fetchImpl?: FetchLike;
}): Promise<BitrixLink> {
  const { creds } = p;

  if (creds.oauth && creds.app) {
    let t = creds.oauth;
    if (t.expiresAt <= Date.now()) {
      t = await bitrixRefresh(creds.app, t, { fetchImpl: p.fetchImpl });
      const next: BitrixCreds = { ...creds, oauth: t };
      await withTenant(p.pool, p.tenantId, async (db) => {
        await db.query(`UPDATE crm_connections SET creds_enc = $2 WHERE id = $1`, [
          p.rowId,
          encryptJson(p.masterKey, p.tenantId, next),
        ]);
      });
    }
    const live = t;
    return {
      asApp: true,
      portal: `https://${live.domain}`,
      call: (method, params) => bitrixApi(live, method, params, { fetchImpl: p.fetchImpl }),
    };
  }

  if (creds.webhook) {
    return {
      asApp: false,
      portal: bitrixPortal(creds.webhook),
      call: bitrixWebhookCall(creds.webhook, p.fetchImpl),
    };
  }

  throw new CrmError('Битрикс не подключён', 'no_conn');
}

/**
 * Поставить виджеты в карточки.
 *
 * Ставим при каждой установке, а не один раз: клиент переустанавливает
 * приложение, когда меняет права, и привязки при этом пропадают.
 * Повторная привязка того же места — ошибка, и она здесь не ошибка:
 * значит, виджет уже стоит.
 */
export async function bitrixBindWidgets(
  call: BitrixCall,
  handler: string,
  title: string,
): Promise<number> {
  let done = 0;
  for (const place of BITRIX_PLACEMENTS) {
    try {
      await call('placement.bind', {
        PLACEMENT: place.code,
        HANDLER: handler,
        TITLE: title,
      });
      done += 1;
    } catch {
      // Место занято нами же или недоступно на этом тарифе — идём
      // дальше: один непоставленный виджет не повод остановить
      // установку целиком.
    }
  }
  return done;
}
