/**
 * Комментарии под постами Facebook и Instagram.
 *
 * Комментарий — это не личное сообщение, и притворяться, что это одно и
 * то же, нельзя. Его видят все; ответ на него тоже видят все, и уходит
 * он не в переписку, а под пост. Поэтому комментарии живут отдельным
 * каналом: у них своё право доступа, свой отчёт и своя кнопка ответа.
 *
 * Разбор отделён от воркера намеренно: формы полей у Facebook и
 * Instagram разные, у Instagram их две (вход через Facebook и вход через
 * Instagram), и проверять это удобнее на примерах из документации, чем
 * на живой странице.
 */

import type { MessageContent, UnifiedMessage } from './types.js';
import type { NormalizeContext } from './normalize.js';

export type CommentChannelType = 'messenger_comments' | 'instagram_comments';

/** Событие одного комментария, приведённое к общему виду. */
export interface CommentEvent {
  commentId: string;
  /** Комментарий, на который отвечают. Пусто — это комментарий под самим постом. */
  parentId?: string;
  /** Пост (Facebook) или публикация (Instagram), под которым идёт разговор. */
  postId?: string;
  authorId: string;
  authorName?: string;
  authorUsername?: string;
  text?: string;
  /** Facebook кладёт в вебхук готовые ссылки на вложенное фото или видео. */
  photo?: string;
  video?: string;
  at: Date;
  raw: unknown;
}

export interface CommentEntry {
  channelType: CommentChannelType;
  /** Идентификатор страницы (Facebook) или аккаунта (Instagram). */
  channelExternalId: string;
  events: CommentEvent[];
}

/** Поля вебхуков, в которых приходят комментарии. */
export const COMMENT_FIELDS = ['feed', 'comments', 'live_comments'];

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

/**
 * Разбор пачки вебхука в события комментариев.
 *
 * Facebook присылает под полем feed вообще всё, что случилось со
 * страницей: посты, лайки, репосты, реакции. Нам нужен ровно один вид
 * события — добавленный комментарий. Правки и удаления пропускаем: в
 * ленте оператора задним числом меняться ничего не должно, иначе он
 * отвечает на текст, которого уже нет.
 */
export function splitCommentPayload(payload: unknown): CommentEntry[] {
  const p = obj(payload);
  const object = str(p['object']);
  const type: CommentChannelType | null =
    object === 'page' ? 'messenger_comments' : object === 'instagram' ? 'instagram_comments' : null;
  if (!type) return [];

  const out: CommentEntry[] = [];
  for (const rawEntry of Array.isArray(p['entry']) ? (p['entry'] as unknown[]) : []) {
    const entry = obj(rawEntry);
    const channelExternalId = str(entry['id']);
    if (!channelExternalId) continue;
    const entryTime = typeof entry['time'] === 'number' ? entry['time'] : undefined;

    const events: CommentEvent[] = [];
    for (const rawChange of Array.isArray(entry['changes']) ? (entry['changes'] as unknown[]) : []) {
      const change = obj(rawChange);
      const field = str(change['field']);
      if (!field || !COMMENT_FIELDS.includes(field)) continue;
      const value = obj(change['value']);

      const ev =
        type === 'messenger_comments' ? facebookComment(value, entryTime) : instagramComment(value, entryTime);
      if (ev) events.push(ev);
    }

    if (events.length) out.push({ channelType: type, channelExternalId, events });
  }
  return out;
}

function facebookComment(value: Record<string, unknown>, entryTime?: number): CommentEvent | null {
  if (str(value['item']) !== 'comment') return null;
  if (str(value['verb']) !== 'add') return null;

  const commentId = str(value['comment_id']);
  const from = obj(value['from']);
  const authorId = str(from['id']);
  if (!commentId || !authorId) return null;

  // created_time в секундах, time пачки — в миллисекундах.
  const created = typeof value['created_time'] === 'number' ? value['created_time'] * 1000 : undefined;

  const ev: CommentEvent = {
    commentId,
    authorId,
    at: new Date(created ?? entryTime ?? Date.now()),
    raw: value,
  };
  const parentId = str(value['parent_id']);
  const postId = str(value['post_id']);
  const name = str(from['name']);
  const text = str(value['message']);
  const photo = str(value['photo']);
  const video = str(value['video']);
  // Ответ под постом приходит с parent_id, равным самому посту. Это не
  // ответ на комментарий, и держать его как ссылку на родителя незачем.
  if (parentId && parentId !== postId) ev.parentId = parentId;
  if (postId) ev.postId = postId;
  if (name) ev.authorName = name;
  if (text) ev.text = text;
  if (photo) ev.photo = photo;
  if (video) ev.video = video;
  return ev;
}

function instagramComment(value: Record<string, unknown>, entryTime?: number): CommentEvent | null {
  // Вход через Facebook даёт comment_id, вход через Instagram — id.
  const commentId = str(value['comment_id']) ?? str(value['id']);
  const from = obj(value['from']);
  const authorId = str(from['id']);
  if (!commentId || !authorId) return null;

  const ev: CommentEvent = {
    commentId,
    authorId,
    at: new Date(entryTime ?? Date.now()),
    raw: value,
  };
  const parentId = str(value['parent_id']);
  const media = obj(value['media']);
  const mediaId = str(media['id']);
  const username = str(from['username']);
  const text = str(value['text']);
  if (parentId) ev.parentId = parentId;
  if (mediaId) ev.postId = mediaId;
  if (username) ev.authorUsername = username;
  if (text) ev.text = text;
  return ev;
}

/**
 * События в сообщения ленты.
 *
 * Свои комментарии отбрасываем по идентификатору страницы или аккаунта.
 * Ответы, отправленные нами, уже лежат в базе с тем же идентификатором
 * комментария, а ответы, написанные руками в Business Suite, приходят от
 * имени страницы и собеседника не имеют — превращать их в диалог
 * «страница сама с собой» нельзя.
 */
export function normalizeComments(
  ctx: NormalizeContext,
  entry: CommentEntry,
  selfIds: Array<string | undefined>,
): UnifiedMessage[] {
  const mine = new Set(selfIds.filter((x): x is string => !!x));
  const out: UnifiedMessage[] = [];

  for (const ev of entry.events) {
    if (mine.has(ev.authorId)) continue;

    const content: MessageContent = {};
    if (ev.text) content.text = ev.text;

    const atts: UnifiedMessage['content']['attachments'] = [];
    if (ev.photo) atts.push({ type: 'image', externalId: ev.photo });
    if (ev.video) atts.push({ type: 'video', externalId: ev.video });
    if (atts.length) content.attachments = atts;

    // Ни текста, ни вложения: Facebook присылает такое на стикер и на
    // ответ одним смайлом-реакцией. Пустая строка в ленте хуже пометки.
    if (!content.text && !atts.length) content.text = '[коментар без тексту]';

    const comment: NonNullable<MessageContent['comment']> = { commentId: ev.commentId };
    if (ev.postId) comment.postId = ev.postId;
    if (ev.parentId) comment.parentId = ev.parentId;
    const link = entry.channelType === 'messenger_comments' ? facebookPostUrl(ev.postId) : null;
    if (link) comment.url = link;
    content.comment = comment;

    const peerProfile: UnifiedMessage['peerProfile'] = {};
    if (ev.authorName) peerProfile.name = ev.authorName;
    if (ev.authorUsername) {
      peerProfile.username = ev.authorUsername;
      if (!peerProfile.name) peerProfile.name = '@' + ev.authorUsername;
    }

    out.push({
      tenantId: ctx.tenantId,
      channelId: ctx.channelId,
      channelType: entry.channelType,
      externalId: ev.commentId,
      peerId: ev.authorId,
      peerProfile,
      direction: 'in',
      senderType: 'customer',
      content,
      status: 'delivered',
      sentAt: ev.at,
      raw: ev.raw,
    });
  }

  return out;
}

/**
 * Ссылка на пост Facebook.
 *
 * Идентификатор поста составной: страница_пост. Из него собирается
 * обычный адрес записи, по которому оператор открывает обсуждение
 * целиком. Если форма другая — ссылки не даём: неверная ссылка уводит на
 * чужую страницу и хуже её отсутствия.
 */
export function facebookPostUrl(postId: string | undefined): string | null {
  if (!postId) return null;
  const parts = postId.split('_');
  if (parts.length !== 2) return null;
  const [page, post] = parts as [string, string];
  if (!/^[0-9]+$/.test(page) || !/^[0-9]+$/.test(post)) return null;
  return `https://www.facebook.com/${page}/posts/${post}`;
}

/** Комментарии Instagram и Facebook — один канал по природе, но два типа. */
export function isCommentChannel(type: string): type is CommentChannelType {
  return type === 'messenger_comments' || type === 'instagram_comments';
}
