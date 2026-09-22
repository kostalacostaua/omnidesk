/**
 * Клиент Graph API Meta — минимум, который нужен Messenger и Instagram.
 *
 * Своя обёртка, а не SDK: нам нужны пять вызовов, а разбор ошибок Meta
 * важнее всего остального. Код ошибки решает, повторять запрос, помечать
 * канал сломанным или честно сказать оператору «клиент недоступен».
 */

export const GRAPH_VERSION = 'v21.0';

export interface MetaErrorBody {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
}

export class MetaApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: MetaErrorBody,
  ) {
    super(`Meta ${status}: ${body.message ?? 'без описания'} (code ${body.code ?? '?'})`);
    this.name = 'MetaApiError';
  }

  /** Токен страницы больше не действует: пароль сменили, приложение удалили из настроек страницы. */
  get tokenInvalid(): boolean {
    return this.body.code === 190 || this.body.code === 102;
  }

  /** Лимиты: повторить позже. */
  get rateLimited(): boolean {
    return [4, 17, 32, 613, 80001, 80002, 80006].includes(this.body.code ?? 0);
  }

  /**
   * Постоянные отказы по конкретному получателю или сообщению:
   * пользователь недоступен, окно закрыто, нет разрешения. Повтор не поможет.
   */
  get permanent(): boolean {
    const c = this.body.code ?? 0;
    return c === 10 || c === 100 || c === 200 || c === 230 || c === 551 || (c >= 2000 && c < 3000);
  }
}

export interface GraphOptions {
  root?: string;
  fetchImpl?: typeof fetch;
}

function url(path: string, params: Record<string, string>, root: string): string {
  const u = new URL(`${root}/${GRAPH_VERSION}/${path.replace(/^\//, '')}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new MetaApiError(res.status, { message: text.slice(0, 200) });
  }
  const err = (body as { error?: MetaErrorBody }).error;
  if (!res.ok || err) throw new MetaApiError(res.status, err ?? { message: text.slice(0, 200) });
  return body as T;
}

export async function graphGet<T>(
  path: string,
  params: Record<string, string>,
  opts: GraphOptions = {},
): Promise<T> {
  const f = opts.fetchImpl ?? fetch;
  const res = await f(url(path, params, opts.root ?? 'https://graph.facebook.com'), {
    signal: AbortSignal.timeout(20_000),
  });
  return parse<T>(res);
}

export async function graphPost<T>(
  path: string,
  params: Record<string, string>,
  body: unknown,
  opts: GraphOptions = {},
): Promise<T> {
  const f = opts.fetchImpl ?? fetch;
  const isForm = body instanceof FormData;
  const init: RequestInit = {
    method: 'POST',
    signal: AbortSignal.timeout(60_000),
  };
  if (isForm) init.body = body;
  else if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await f(url(path, params, opts.root ?? 'https://graph.facebook.com'), init);
  return parse<T>(res);
}

/** Креды канала Messenger / Instagram. Токен страницы бессрочный, пока страница даёт доступ. */
export interface MetaChannelCredentials {
  pageId: string;
  pageToken: string;
  igId?: string;
}

/** Поля вебхука, на которые подписываем страницу. */
export const PAGE_SUBSCRIBED_FIELDS = [
  'messages',
  'message_echoes',
  'message_reactions',
  'messaging_postbacks',
];

/** Разрешения, которые запрашиваем при входе через Facebook. */
export const META_LOGIN_SCOPES = [
  'pages_show_list',
  'pages_messaging',
  'pages_manage_metadata',
  'pages_read_engagement',
  'business_management',
  'instagram_basic',
  'instagram_manage_messages',
];
