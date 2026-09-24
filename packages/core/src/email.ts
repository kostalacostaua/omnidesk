/**
 * Почта как канал.
 *
 * Письмо отличается от сообщения в мессенджере тремя вещами, и все три
 * приходится учитывать: у него есть тема, есть цепочка (кто кому
 * отвечает) и есть два тела — текст и html. Если про это забыть,
 * получится «мессенджер, в котором иногда приходят письма»: ответы
 * уезжают новой перепиской, в теме стоит «(без темы)», а в ленте висит
 * разметка вместо текста.
 *
 * Разбор живёт здесь, а не в воркере: он весь про правила почты, и
 * проверять его удобнее на письмах, а не на живом ящике.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Attachment, MessageContent, UnifiedMessage } from './types.js';
import type { NormalizeContext } from './normalize.js';

export const EMAIL_CHANNEL = 'email' as const;

/** Письмо, каким его отдаёт Resend по идентификатору. */
export interface ReceivedEmail {
  id?: string;
  from?: string;
  to?: string[];
  cc?: string[];
  subject?: string;
  text?: string | null;
  html?: string | null;
  message_id?: string;
  created_at?: string;
  headers?: Record<string, string>;
  attachments?: Array<{
    id?: string;
    filename?: string;
    content_type?: string;
    size?: number;
    content_disposition?: string | null;
  }>;
}

/**
 * Проверка подписи вебхука Resend.
 *
 * Подписывает Svix, и схема у него своя: подписывается не тело, а
 * «идентификатор.время.тело», секрет лежит в base64 после префикса
 * whsec_, а в заголовке может стоять несколько подписей через пробел —
 * так выглядит ротация ключа.
 *
 * Время проверяем обязательно: без этого перехваченный запрос можно
 * повторять годами, и каждый раз в ленте будет появляться письмо.
 */
export function verifyResendSignature(
  rawBody: Buffer,
  headers: { id?: string; timestamp?: string; signature?: string },
  secret: string,
  now: Date = new Date(),
  toleranceSec = 300,
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || !secret) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Math.floor(now.getTime() / 1000) - ts) > toleranceSec) return false;

  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64');
  if (!key.length) return false;

  const expected = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${rawBody.toString('utf8')}`)
    .digest('base64');

  for (const part of signature.split(' ')) {
    // Заголовок: «v1,<подпись> v1,<другая подпись>». Версия впереди.
    const value = part.includes(',') ? part.slice(part.indexOf(',') + 1) : part;
    const a = Buffer.from(expected);
    const b = Buffer.from(value);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

/**
 * Адрес из поля From.
 *
 * Приходит и «Оля Петренко <olya@firma.com>», и голый адрес, и адрес в
 * угловых скобках без имени. Имя берём, если оно есть: в ленте «Оля
 * Петренко» читается, а «olya@firma.com» — это ещё не человек.
 */
export function parseAddress(raw: string | undefined | null): { email: string; name?: string } {
  const s = String(raw ?? '').trim();
  if (!s) return { email: '' };

  const open = s.lastIndexOf('<');
  const close = s.lastIndexOf('>');
  if (open >= 0 && close > open) {
    const email = s.slice(open + 1, close).trim().toLowerCase();
    const name = s.slice(0, open).trim().replace(/^"|"$/g, '').trim();
    return name ? { email, name } : { email };
  }
  return { email: s.toLowerCase() };
}

/** Домен адреса. По нему письмо попадает в нужный канал. */
export function addressDomain(address: string | undefined | null): string {
  const at = String(address ?? '').lastIndexOf('@');
  if (at < 0) return '';
  return String(address).slice(at + 1).trim().toLowerCase();
}

/**
 * Текст письма из html.
 *
 * Полноценный разбор html здесь не нужен и вреден: в ленте показывается
 * текст, а не вёрстка рассылки. Убираем то, что текстом не является, и
 * возвращаем читаемое. Стили и скрипты вырезаются целиком — иначе в
 * ленту попадает содержимое тега style.
 */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';
  const noScript = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const breaks = noScript
    .replace(/<br\s*[/]?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n');
  const bare = breaks.replace(/<[^>]*>/g, ' ');
  const decoded = bare
    .split('&nbsp;').join(' ')
    .split('&amp;').join('&')
    .split('&lt;').join('<')
    .split('&gt;').join('>')
    .split('&quot;').join('"')
    .split('&#39;').join("'");
  return decoded
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Тема ответа.
 *
 * «Re:» ставится один раз. Переписка из пяти писем с темой
 * «Re: Re: Re: Re: Ціна» — признак того, что отвечали не люди, а
 * программа, которая не смотрела на тему.
 */
export function replySubject(subject: string | null | undefined): string {
  const s = String(subject ?? '').trim();
  if (!s) return 'Re:';
  return /^re\s*:/i.test(s) ? s : `Re: ${s}`;
}

/**
 * Заголовки цепочки.
 *
 * Без них ответ приходит клиенту отдельным письмом, а не под тем, на
 * которое отвечают: в Gmail это выглядит как «нам не ответили, а
 * написали что-то новое».
 */
export function threadHeaders(
  inReplyTo: string | null | undefined,
  references: string | null | undefined,
): Record<string, string> {
  const id = String(inReplyTo ?? '').trim();
  if (!id) return {};
  const prev = String(references ?? '').trim();
  return {
    'In-Reply-To': id,
    References: prev ? `${prev} ${id}` : id,
  };
}

/** Заголовок из письма без оглядки на регистр: почта его не различает. */
export function header(email: ReceivedEmail, name: string): string | undefined {
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(email.headers ?? {})) {
    if (k.toLowerCase() === want && typeof v === 'string' && v) return v;
  }
  return undefined;
}

/**
 * Письмо в общее сообщение.
 *
 * Вложения приходят описанием, а не содержимым: скачивает их потом
 * отдельная задача по временной ссылке. Здесь остаётся идентификатор —
 * его хватает, чтобы забрать файл, и он не тухнет, в отличие от ссылки.
 */
export function normalizeEmail(
  ctx: NormalizeContext,
  email: ReceivedEmail,
): UnifiedMessage | null {
  const from = parseAddress(email.from);
  if (!from.email || !email.id) return null;

  const text = (email.text ?? '').trim() || htmlToText(email.html);
  const content: MessageContent = {};
  if (text) content.text = text;

  const atts: Attachment[] = [];
  for (const a of email.attachments ?? []) {
    if (!a.id) continue;
    const att: Attachment = { type: attachmentKind(a.content_type), externalId: a.id };
    if (a.filename) att.filename = a.filename;
    if (a.content_type) att.mime = a.content_type;
    if (typeof a.size === 'number') att.size = a.size;
    atts.push(att);
  }
  if (atts.length) content.attachments = atts;

  // Письмо без текста и без вложений — обычно автоответ или пустая
  // пересылка. Пустая строка в ленте выглядит как сбой, поэтому
  // подписываем прямо.
  if (!content.text && !atts.length) content.text = '[лист без тексту]';

  const mail: NonNullable<MessageContent['email']> = {};
  if (email.subject) mail.subject = email.subject;
  if (email.message_id) mail.messageId = email.message_id;
  const refs = header(email, 'references');
  if (refs) mail.references = refs;
  const to = (email.to ?? []).filter((x) => typeof x === 'string');
  if (to.length) mail.to = to;
  const cc = (email.cc ?? []).filter((x) => typeof x === 'string');
  if (cc.length) mail.cc = cc;
  content.email = mail;

  const peerProfile: UnifiedMessage['peerProfile'] = { username: from.email, email: from.email };
  if (from.name) peerProfile.name = from.name;

  const at = email.created_at ? new Date(email.created_at) : new Date();

  return {
    tenantId: ctx.tenantId,
    channelId: ctx.channelId,
    channelType: EMAIL_CHANNEL,
    externalId: email.id,
    peerId: from.email,
    peerProfile,
    direction: 'in',
    senderType: 'customer',
    content,
    status: 'delivered',
    sentAt: Number.isNaN(at.getTime()) ? new Date() : at,
    raw: email,
  };
}

/** Вид вложения по типу содержимого: от него зависит, как файл покажут. */
export function attachmentKind(mime: string | undefined | null): Attachment['type'] {
  const m = String(mime ?? '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  return 'document';
}

/**
 * Адрес отправителя для ответа.
 *
 * Имя компании перед адресом — не украшение: в списке писем клиент
 * видит отправителя, и «Ромашка» узнаётся, а support@help.romashka.com
 * читается как рассылка.
 */
export function fromHeader(name: string | undefined | null, address: string): string {
  const clean = String(name ?? '').replace(/["<>\r\n]/g, '').trim();
  return clean ? `${clean} <${address}>` : address;
}
