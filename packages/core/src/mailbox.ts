/**
 * Существующий почтовый ящик клиента.
 *
 * Второй способ подключить почту, и он же обычный: у компании уже есть
 * info@фирма.com, на этот адрес пишут годами, и заводить рядом ещё
 * один — значит просить клиентов переучиться. Поэтому письма читаются
 * из самого ящика по IMAP, а ответы уходят из него же по SMTP.
 *
 * Отличие от варианта с поддоменом — в том, кто хранит доступ. Здесь
 * пароль клиента у нас, и это его осознанное решение; зато не нужно
 * трогать DNS, а письма приходят с настоящего адреса, а не с нового.
 *
 * Здесь только правила: как выглядят настройки, что подставить по
 * известному домену и как превратить разобранное письмо в наше
 * сообщение. Сама сеть — в воркере: её нельзя проверить тестом, а всё
 * остальное можно.
 */

import { lookup } from 'node:dns/promises';
import type { ReceivedEmail } from './email.js';

/**
 * Адрес почтового сервера, до которого мы действительно доедем.
 *
 * У большинства почтовых серверов есть и A, и AAAA. Node спрашивает
 * систему и берёт первый ответ, а система в контейнере отдаёт сначала
 * IPv6 — и соединение падает с «connect ENETUNREACH 2a06:...:465»,
 * потому что наружу по IPv6 из контейнера хода нет. Для человека это
 * выглядит так, будто не подошёл пароль.
 *
 * Поэтому адрес выбираем сами: спрашиваем A-запись и подключаемся по
 * ней. Имя при этом передаётся отдельно, в servername: сертификат
 * выписан на имя, а не на адрес, и без этого проверка не прошла бы.
 *
 * Если A-записи нет вовсе — сервер только на IPv6 — возвращаем имя как
 * было. Пусть решает система: отказ в этом случае честный, и мы о нём
 * скажем словами.
 */
export async function mailAddress(host: string): Promise<{ host: string; servername?: string }> {
  try {
    const found = await lookup(host, { family: 4 });
    return { host: found.address, servername: host };
  } catch {
    return { host };
  }
}

export interface MailHost {
  host: string;
  port: number;
  /** true — TLS с первого байта (993, 465); false — STARTTLS (143, 587). */
  secure: boolean;
}

export interface MailboxCreds {
  /** Адрес, с которого ведётся переписка. */
  address: string;
  /** Логин: у большинства совпадает с адресом, но не у всех. */
  user: string;
  pass: string;
  imap: MailHost;
  smtp: MailHost;
}

/**
 * Известные почтовые службы.
 *
 * Спрашивать у человека «хост IMAP и порт» — значит спрашивать то,
 * чего он не знает; в девяти случаях из десяти это одна из этих служб,
 * и адреса у них постоянные. Поля всё равно показываются: у своей
 * почты на хостинге они другие, и вписать их должно быть можно.
 */
export const MAIL_PRESETS: Record<string, { imap: MailHost; smtp: MailHost; note?: string }> = {
  'gmail.com': {
    imap: { host: 'imap.gmail.com', port: 993, secure: true },
    smtp: { host: 'smtp.gmail.com', port: 465, secure: true },
    note: 'Потрібен пароль застосунку Google, звичайний пароль Gmail не підійде.',
  },
  'googlemail.com': {
    imap: { host: 'imap.gmail.com', port: 993, secure: true },
    smtp: { host: 'smtp.gmail.com', port: 465, secure: true },
  },
  'ukr.net': {
    imap: { host: 'imap.ukr.net', port: 993, secure: true },
    smtp: { host: 'smtp.ukr.net', port: 465, secure: true },
    note: 'Потрібен пароль для зовнішніх застосунків з налаштувань ukr.net.',
  },
  'i.ua': {
    imap: { host: 'imap.i.ua', port: 993, secure: true },
    smtp: { host: 'smtp.i.ua', port: 465, secure: true },
  },
  'meta.ua': {
    imap: { host: 'imap.meta.ua', port: 993, secure: true },
    smtp: { host: 'smtp.meta.ua', port: 465, secure: true },
  },
  'zoho.com': {
    imap: { host: 'imap.zoho.com', port: 993, secure: true },
    smtp: { host: 'smtp.zoho.com', port: 465, secure: true },
  },
  'zoho.eu': {
    imap: { host: 'imap.zoho.eu', port: 993, secure: true },
    smtp: { host: 'smtp.zoho.eu', port: 465, secure: true },
  },
  'yahoo.com': {
    imap: { host: 'imap.mail.yahoo.com', port: 993, secure: true },
    smtp: { host: 'smtp.mail.yahoo.com', port: 465, secure: true },
  },
  'icloud.com': {
    imap: { host: 'imap.mail.me.com', port: 993, secure: true },
    smtp: { host: 'smtp.mail.me.com', port: 587, secure: false },
    note: 'Потрібен пароль застосунку Apple.',
  },
};

/**
 * Microsoft закрыла вход по паролю для IMAP и SMTP: личный Outlook и
 * рабочий 365 пускают только по OAuth. Подставлять им адреса серверов
 * бессмысленно — человек введёт пароль и получит отказ, которого не
 * поймёт. Говорим об этом сразу.
 */
export const MICROSOFT_MAIL = [
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'office365.com', 'microsoft.com',
];

export function isMicrosoftMail(domain: string): boolean {
  const d = (domain ?? '').trim().toLowerCase();
  return MICROSOFT_MAIL.some((x) => d === x || d.endsWith('.' + x));
}

/** Домен адреса: всё после последней собачки, в нижнем регистре. */
export function mailDomain(address: string): string {
  const at = (address ?? '').lastIndexOf('@');
  return at < 0 ? '' : address.slice(at + 1).trim().toLowerCase();
}

/**
 * Что подставить в форму по адресу.
 *
 * Для незнакомого домена — догадка по правилу «imap.домен» и
 * «smtp.домен». Она верна чаще, чем кажется: так настроены почти все
 * почтовые службы на хостингах. Неверную человек поправит, а пустые
 * поля он не заполнит никак.
 */
export function guessMailbox(address: string): { imap: MailHost; smtp: MailHost; note?: string } {
  const domain = mailDomain(address);
  const preset = MAIL_PRESETS[domain];
  if (preset) return preset;
  if (!domain) {
    return {
      imap: { host: '', port: 993, secure: true },
      smtp: { host: '', port: 465, secure: true },
    };
  }
  return {
    imap: { host: `imap.${domain}`, port: 993, secure: true },
    smtp: { host: `smtp.${domain}`, port: 465, secure: true },
  };
}

const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?([.][a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const ADDRESS = /^[^\s@]+@[^\s@]+[.][^\s@]+$/;

function host(raw: unknown, fallback: MailHost): MailHost | null {
  const v = (raw ?? {}) as { host?: unknown; port?: unknown; secure?: unknown };
  const name = String(v.host ?? fallback.host).trim().toLowerCase();
  if (!HOST.test(name)) return null;
  const port = Math.round(Number(v.port ?? fallback.port));
  if (!Number.isFinite(port) || port < 1 || port > 65535) return null;
  return { host: name, port, secure: v.secure === undefined ? port !== 143 && port !== 587 : v.secure === true };
}

/**
 * Настройки из формы.
 *
 * Возвращает либо готовые настройки, либо причину отказа — словом, по
 * которому интерфейс покажет нужную подпись. Пароль не трогаем вовсе:
 * его правила придумывает почтовая служба, а не мы.
 */
export function parseMailbox(raw: unknown): { creds: MailboxCreds } | { error: string } {
  const b = (raw ?? {}) as Record<string, unknown>;
  const address = String(b.address ?? '').trim().toLowerCase();
  if (!ADDRESS.test(address)) return { error: 'bad_address' };
  if (isMicrosoftMail(mailDomain(address))) return { error: 'microsoft_mail' };

  const pass = String(b.pass ?? '');
  if (!pass) return { error: 'no_password' };

  const fallback = guessMailbox(address);
  const imap = host(b.imap, fallback.imap);
  const smtp = host(b.smtp, fallback.smtp);
  if (!imap) return { error: 'bad_imap' };
  if (!smtp) return { error: 'bad_smtp' };

  const user = String(b.user ?? '').trim() || address;
  return { creds: { address, user, pass, imap, smtp } };
}

/** Письмо из ящика в том виде, в каком его отдаёт разборщик. */
export interface ParsedMail {
  messageId?: string | null;
  subject?: string | null;
  text?: string | null;
  html?: string | false | null;
  date?: Date | null;
  from?: { text?: string; value?: Array<{ address?: string; name?: string }> } | null;
  to?: { text?: string; value?: Array<{ address?: string; name?: string }> } | null;
  cc?: { text?: string; value?: Array<{ address?: string; name?: string }> } | null;
  references?: string[] | string | null;
  attachments?: Array<{
    filename?: string;
    contentType?: string;
    size?: number;
    content?: unknown;
    contentDisposition?: string;
  }>;
}

function addresses(box: ParsedMail['to']): string[] {
  const list = box?.value ?? [];
  return list.map((x) => (x.address ?? '').trim()).filter(Boolean);
}

/**
 * Письмо ящика в общий вид.
 *
 * Общий вид — тот же, в котором приходят письма с поддомена: дальше по
 * дороге одно и то же сообщение, одна и та же лента и один и тот же
 * разбор. Две дороги отличаются только тем, кто принёс письмо.
 *
 * Идентификатор берём из Message-ID, а не из номера письма в ящике:
 * номер принадлежит папке и меняется при переносе, а Message-ID
 * принадлежит письму. Нет его — собираем из номера, иначе дубли
 * пролезут при повторном обходе.
 */
export function mailboxReceived(mail: ParsedMail, uid: number): ReceivedEmail {
  const id = (mail.messageId ?? '').trim() || `uid-${uid}`;
  const refs = Array.isArray(mail.references)
    ? mail.references.join(' ')
    : (mail.references ?? '').toString();

  const out: ReceivedEmail = {
    id,
    from: mail.from?.text ?? '',
    to: addresses(mail.to),
    cc: addresses(mail.cc),
    subject: (mail.subject ?? '').trim(),
    text: mail.text ?? null,
    html: typeof mail.html === 'string' ? mail.html : null,
    message_id: (mail.messageId ?? '').trim(),
    created_at: (mail.date ?? new Date()).toISOString(),
    ...(refs ? { headers: { references: refs } } : {}),
  };

  const atts = (mail.attachments ?? []).filter(
    (a) => a.contentDisposition !== 'inline' || a.filename,
  );
  if (atts.length) {
    out.attachments = atts.map((a, i) => ({
      // Свой номер, потому что у письма из ящика чужого нет: вложения
      // приходят вместе с письмом, а не ссылками.
      id: `${id}#${i}`,
      ...(a.filename ? { filename: a.filename } : {}),
      ...(a.contentType ? { content_type: a.contentType } : {}),
      ...(typeof a.size === 'number' ? { size: a.size } : {}),
    }));
  }

  return out;
}
