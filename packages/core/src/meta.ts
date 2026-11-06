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
   * Нет права отправлять от имени аккаунта.
   *
   * Код 200 означает «не хватает разрешения», и у разных каналов это
   * разного размера беда. В Messenger он чаще про одного собеседника:
   * этому написать нельзя, остальным можно. В WhatsApp — про весь
   * канал: право отправлять выдаётся на аккаунт целиком, и без него не
   * уйдёт ни одно сообщение, сколько ни повторяй.
   *
   * Поэтому признак отдельный, а решение, что с ним делать, принимает
   * тот, кто знает канал. Складывать это в `permanent` было бы
   * неверно: там отказы по одному сообщению, после которых канал
   * продолжает работать.
   */
  get noPermission(): boolean {
    return this.body.code === 200;
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

/**
 * Поля вебхуков для комментариев.
 *
 * Лента страницы (feed) приносит вообще все события страницы, включая
 * лайки и репосты, поэтому подписываемся на неё только тем, кто
 * комментарии действительно взял. Комментарии Instagram приходят в
 * отдельном потоке (object=instagram) и требуют подписки приложения на
 * поля comments в кабинете Meta — подписка страницы её не заменяет.
 */
export const COMMENT_SUBSCRIBED_FIELDS = ['feed'];

/** Разрешения, которые запрашиваем при входе через Facebook. */
export const META_LOGIN_SCOPES = [
  'pages_show_list',
  'pages_messaging',
  'pages_manage_metadata',
  'pages_read_engagement',
  'business_management',
  'instagram_basic',
  'instagram_manage_messages',
  // Комментарии: читать чужие под своими постами и отвечать под ними.
  'pages_read_user_content',
  'pages_manage_engagement',
  'instagram_manage_comments',
];

/**
 * Пост, под которым идёт разговор.
 *
 * Комментарий сам по себе не читается: «а дешевле бывает?» — это ответ
 * на что-то, и без этого чего-то оператор идёт искать пост глазами.
 * Ссылка у нас была и раньше, но ссылка уводит из кабинета, а вопрос
 * стоит здесь.
 */
export interface SocialPost {
  postId: string;
  text?: string;
  permalink?: string;
  picture?: string;
  postedAt?: Date;
}

/**
 * Забрать текст поста у Meta.
 *
 * Поля у Facebook и Instagram называются по-разному и не пересекаются
 * ни одним именем: message против caption, permalink_url против
 * permalink, created_time против timestamp. Поэтому две ветки, а не
 * один список полей: запрос с чужими полями Meta отклоняет целиком, и
 * выглядит это как «поста нет».
 *
 * Пустой текст — не ошибка: под картинкой без подписи комментируют так
 * же охотно. Поэтому возвращаем объект, а не null, даже когда текста
 * нет: ссылка и картинка сами по себе уже говорят, о чём речь.
 *
 * Ошибки не глотаем. «Пост удалён» и «маркер потерял права на страницу»
 * для вызывающего — разные беды, и различить их можно только по коду.
 */
export async function fetchSocialPost(
  kind: 'facebook' | 'instagram',
  postId: string,
  token: string,
  opts: GraphOptions = {},
): Promise<SocialPost> {
  const fields =
    kind === 'instagram'
      ? 'caption,permalink,media_url,thumbnail_url,timestamp'
      : 'message,permalink_url,created_time,full_picture';

  const raw = await graphGet<Record<string, unknown>>(
    postId,
    { access_token: token, fields },
    opts,
  );

  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v ? v : undefined;

  const when = str(kind === 'instagram' ? raw['timestamp'] : raw['created_time']);
  const at = when ? new Date(when) : null;

  const post: SocialPost = { postId };
  const text = str(kind === 'instagram' ? raw['caption'] : raw['message']);
  if (text) post.text = text;
  const link = str(kind === 'instagram' ? raw['permalink'] : raw['permalink_url']);
  if (link) post.permalink = link;
  // У видео в Instagram media_url пустой, а картинка лежит отдельно.
  const pic =
    kind === 'instagram'
      ? str(raw['media_url']) ?? str(raw['thumbnail_url'])
      : str(raw['full_picture']);
  if (pic) post.picture = pic;
  if (at && !Number.isNaN(at.getTime())) post.postedAt = at;

  return post;
}
