/**
 * Клиент Resend — ровно то, что нужно почтовому каналу.
 *
 * Своя обёртка, а не SDK: нужно семь вызовов, а разбор отказа важнее
 * всего остального. «Домен не подтверждён» и «неверный адрес
 * отправителя» приходят одним кодом, и различить их можно только по
 * тексту — поэтому текст ответа сохраняется и доходит до человека.
 */

import type { ReceivedEmail } from './email.js';

export interface ResendOptions {
  apiKey: string;
  root?: string;
  fetchImpl?: typeof fetch;
}

export class ResendError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`Resend ответил ${status}: ${detail.slice(0, 300)}`);
    this.name = 'ResendError';
  }

  /** Ключ не тот или отозван: чинится не повтором, а настройкой. */
  get authFailed(): boolean {
    return this.status === 401 || this.status === 403;
  }

  /** Лимит запросов: повторить позже. */
  get rateLimited(): boolean {
    return this.status === 429;
  }

  /** Имя ошибки, как его называет сам Resend. */
  get kind(): string {
    try {
      const body = JSON.parse(this.detail) as { name?: unknown };
      return typeof body.name === 'string' ? body.name : '';
    } catch {
      return '';
    }
  }

  /**
   * Что делать, словами.
   *
   * Resend отвечает строкой вида {"statusCode":401,"message":"This API
   * key is restricted to only send emails"}. Показать её человеку —
   * значит показать ему чужой отладочный вывод: он видит «401» и не
   * знает, что дело в галочке при создании ключа.
   *
   * Переводим только то, что узнали. Незнакомый отказ отдаётся как
   * есть: выдумывать объяснение вреднее, чем показать чужое.
   */
  get reason(): string {
    const kind = this.kind;
    if (kind === 'restricted_api_key') {
      return (
        'Ключ Resend виданий лише на відправку листів. У Resend, у розділі API Keys, ' +
        'створіть ключ з повним доступом (Full access) і замініть ним RESEND_API_KEY: ' +
        'домени заводяться тільки повним ключем.'
      );
    }
    if (kind === 'missing_api_key' || kind === 'invalid_api_key') {
      return 'Ключ Resend не підійшов — перевірте RESEND_API_KEY у змінних сервера.';
    }
    if (kind === 'rate_limit_exceeded' || kind === 'daily_quota_exceeded') {
      return 'Resend відповідає «занадто часто» — спробуйте за хвилину.';
    }
    return '';
  }
}

/**
 * Домены, на которых своей записи DNS не заведёшь.
 *
 * Люди вписывают сюда свою личную пошту — gmail.com, ukr.net, — и
 * упираются в отказ Resend через минуту ожидания. Отказать сразу и
 * объяснить честнее: домен должен быть свой, иначе добавить MX
 * некуда.
 */
export const PUBLIC_MAIL_DOMAINS = [
  'gmail.com', 'googlemail.com', 'ukr.net', 'i.ua', 'meta.ua', 'bigmir.net',
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com',
  'mail.ru', 'yandex.ru', 'yandex.ua', 'rambler.ru', 'aol.com', 'gmx.com', 'web.de',
];

export function isPublicMailDomain(domain: string): boolean {
  const clean = (domain ?? '').trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  if (!clean) return false;
  return PUBLIC_MAIL_DOMAINS.some((d) => clean === d || clean.endsWith('.' + d));
}

/** Запись DNS, которую клиент добавляет у своего регистратора. */
export interface DnsRecord {
  record?: string;
  name?: string;
  type?: string;
  ttl?: string;
  status?: string;
  value?: string;
  priority?: number;
}

export interface ResendDomain {
  id: string;
  name: string;
  status: string;
  region?: string;
  records?: DnsRecord[];
  capabilities?: { sending?: string; receiving?: string };
}

async function call<T>(
  opts: ResendOptions,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const f = opts.fetchImpl ?? fetch;
  const res = await f(`${opts.root ?? 'https://api.resend.com'}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${opts.apiKey}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });

  const text = await res.text();
  if (!res.ok) throw new ResendError(res.status, text);
  try {
    return (text ? JSON.parse(text) : {}) as T;
  } catch {
    throw new ResendError(res.status, `не разобрать ответ: ${text.slice(0, 200)}`);
  }
}

/**
 * Завести домен.
 *
 * Приём и отправка включаются вместе: канал, который умеет только
 * принимать, — это ящик, из которого нельзя ответить.
 *
 * Регион европейский: клиенты и сервер здесь, и письма не должны
 * летать через океан ради того, чтобы вернуться обратно.
 */
export function resendCreateDomain(
  opts: ResendOptions,
  name: string,
  region = 'eu-west-1',
): Promise<ResendDomain> {
  return call<ResendDomain>(opts, 'POST', '/domains', {
    name,
    region,
    capabilities: { sending: 'enabled', receiving: 'enabled' },
  });
}

export function resendGetDomain(opts: ResendOptions, id: string): Promise<ResendDomain> {
  return call<ResendDomain>(opts, 'GET', `/domains/${id}`);
}

/** Просьба перепроверить записи. Ответ приходит не мгновенно: DNS расходится. */
export function resendVerifyDomain(opts: ResendOptions, id: string): Promise<unknown> {
  return call(opts, 'POST', `/domains/${id}/verify`);
}

/**
 * Найти уже заведённый домен по имени.
 *
 * Нужно после неудачной попытки: домен в Resend остался, а канал у нас
 * не создался. Второй раз Resend его не заведёт, и без поиска человек
 * упирается в «домен уже существует» без выхода.
 */
export async function resendFindDomain(
  opts: ResendOptions,
  name: string,
): Promise<ResendDomain | null> {
  const body = await call<{ data?: ResendDomain[] }>(opts, 'GET', '/domains');
  const want = name.trim().toLowerCase();
  return (body.data ?? []).find((d) => String(d.name).toLowerCase() === want) ?? null;
}

/** Письмо целиком: в вебхуке приходят только метаданные. */
export function resendReceivedEmail(opts: ResendOptions, id: string): Promise<ReceivedEmail> {
  return call<ReceivedEmail>(opts, 'GET', `/emails/receiving/${id}`);
}

/** Ссылка на вложение. Временная — качать надо сразу, а не когда-нибудь. */
export function resendReceivedAttachment(
  opts: ResendOptions,
  emailId: string,
  attachmentId: string,
): Promise<{ download_url?: string; filename?: string; content_type?: string; size?: number }> {
  return call(opts, 'GET', `/emails/receiving/${emailId}/attachments/${attachmentId}`);
}

export interface SendEmailInput {
  from: string;
  to: string[];
  subject: string;
  text?: string;
  html?: string;
  cc?: string[];
  headers?: Record<string, string>;
  attachments?: Array<{ filename: string; content: string; content_type?: string }>;
}

export function resendSend(opts: ResendOptions, mail: SendEmailInput): Promise<{ id?: string }> {
  return call<{ id?: string }>(opts, 'POST', '/emails', mail);
}

/**
 * Подтверждён ли домен.
 *
 * У Resend несколько состояний («not_started», «pending», «verified»,
 * «failure»), и всё, кроме подтверждённого, для нас одно и то же:
 * письма ещё не ходят.
 */
export function domainReady(d: { status?: string } | null | undefined): boolean {
  return String(d?.status ?? '').toLowerCase() === 'verified';
}

/**
 * Записи, которые надо показать человеку.
 *
 * Показываем все, что отдала Resend: приём без MX не работает, отправка
 * без DKIM попадает в спам, и решать за клиента, что из этого ему
 * «не нужно», мы не вправе.
 */
export function dnsRows(d: ResendDomain | null | undefined): DnsRecord[] {
  return (d?.records ?? []).filter((r) => r && r.type && r.value);
}
