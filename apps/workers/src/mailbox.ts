/**
 * Сеть почтового ящика: IMAP на приём, SMTP на отправку.
 *
 * Вынесено из main.ts не ради порядка, а потому что это единственное
 * место, где мы разговариваем не по HTTP. У IMAP свои правила, и три
 * из них стоят отдельного упоминания.
 *
 * Первое: номер письма (UID) принадлежит папке, а не письму. При
 * переносе в другую папку он меняется, а при пересоздании ящика
 * обнуляется — поэтому вместе с ним запоминается uidValidity, и при
 * её смене счёт начинается заново.
 *
 * Второе: диапазон «всё после N» в IMAP пишется как «N:*», и сервер
 * всегда отдаёт хотя бы одно письмо — последнее, даже если оно старее
 * N. Без проверки «uid больше N» последнее письмо приезжало бы в ленту
 * на каждом обходе.
 *
 * Третье: при первом подключении старую переписку не забираем. Тысяча
 * писем за три года — это тысяча диалогов в инбоксе и тысяча
 * оповещений; человек подключил ящик, чтобы видеть новые обращения.
 */

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { createTransport } from 'nodemailer';
import { mailAddress, type MailboxCreds, type ParsedMail } from '@omnidesk/core';

/** Сколько писем берём за один обход: остальные приедут следующим. */
export const MAIL_BATCH = 20;

/** Больше этого в письме не бывает ничего полезного для ленты. */
export const MAIL_MAX_BYTES = 25 * 1024 * 1024;

export interface MailboxState {
  uidValidity: string;
  lastUid: number;
}

export interface FetchedMail {
  uid: number;
  mail: ParsedMail;
  /** Содержимое вложений в том же порядке, что и в mail.attachments. */
  files: Array<{ filename: string; contentType: string; body: Buffer }>;
}

async function client(creds: MailboxCreds): Promise<ImapFlow> {
  // Адрес сервера выбираем сами: система в контейнере отдаёт сначала
  // IPv6, а наружу по нему хода нет. Имя уходит отдельно, в servername.
  const ia = await mailAddress(creds.imap.host);
  return new ImapFlow({
    host: ia.host,
    port: creds.imap.port,
    secure: creds.imap.secure,
    ...(ia.servername ? { tls: { servername: ia.servername } } : {}),
    auth: { user: creds.user, pass: creds.pass },
    // Журнал IMAP многословен до неприличия: каждая команда протокола
    // отдельной строкой. Нам нужны отказы, и их мы пишем сами.
    logger: false,
    socketTimeout: 60_000,
  });
}

/**
 * Проверка доступа: вход по IMAP и по SMTP.
 *
 * Обе половины проверяются сразу. Ящик, из которого можно читать, но
 * нельзя ответить, — это не канал, и узнавать об этом в момент первого
 * ответа клиенту поздно.
 */
export async function verifyMailbox(creds: MailboxCreds): Promise<void> {
  const imap = await client(creds);
  await imap.connect();
  try {
    await imap.mailboxOpen('INBOX', { readOnly: true });
  } finally {
    await imap.logout().catch(() => undefined);
  }

  const sa = await mailAddress(creds.smtp.host);
  const smtp = createTransport({
    host: sa.host,
    port: creds.smtp.port,
    secure: creds.smtp.secure,
    ...(sa.servername ? { tls: { servername: sa.servername } } : {}),
    auth: { user: creds.user, pass: creds.pass },
    connectionTimeout: 20_000,
  });
  try {
    await smtp.verify();
  } finally {
    smtp.close();
  }
}

/**
 * Новые письма с прошлого обхода.
 *
 * Возвращает и новое состояние: его надо сохранить, даже если писем не
 * было, — при первом подключении именно так и запоминается точка
 * отсчёта.
 */
export async function fetchMail(
  creds: MailboxCreds,
  state: MailboxState | null,
): Promise<{ mails: FetchedMail[]; state: MailboxState }> {
  const imap = await client(creds);
  await imap.connect();

  try {
    const box = await imap.mailboxOpen('INBOX');
    const validity = String(box.uidValidity ?? '');
    const next = Number(box.uidNext ?? 1);

    // Ящик подключили только что или его пересоздали: запоминаем, где
    // сейчас конец, и ждём следующих писем.
    if (!state || state.uidValidity !== validity) {
      return { mails: [], state: { uidValidity: validity, lastUid: Math.max(next - 1, 0) } };
    }

    const from = state.lastUid + 1;
    if (from >= next) return { mails: [], state };

    const mails: FetchedMail[] = [];
    let lastUid = state.lastUid;

    for await (const msg of imap.fetch(
      { uid: `${from}:*` },
      { uid: true, source: true, size: true },
    )) {
      const uid = Number(msg.uid);
      // «N:*» всегда отдаёт хотя бы последнее письмо, даже если оно
      // старее N. Без этой проверки оно приезжало бы каждый обход.
      if (!Number.isFinite(uid) || uid <= state.lastUid) continue;
      lastUid = Math.max(lastUid, uid);
      if (mails.length >= MAIL_BATCH) continue;
      if (!msg.source || msg.source.length > MAIL_MAX_BYTES) continue;

      const mail = (await simpleParser(msg.source)) as unknown as ParsedMail & {
        attachments?: Array<{ filename?: string; contentType?: string; content?: Buffer }>;
      };

      const files: FetchedMail['files'] = [];
      for (const a of mail.attachments ?? []) {
        const body = a.content as Buffer | undefined;
        if (!Buffer.isBuffer(body)) continue;
        files.push({
          filename: a.filename || 'file',
          contentType: a.contentType || 'application/octet-stream',
          body,
        });
      }

      mails.push({ uid, mail: mail as ParsedMail, files });
    }

    return { mails, state: { uidValidity: validity, lastUid } };
  } finally {
    await imap.logout().catch(() => undefined);
  }
}

export interface OutgoingMail {
  from: string;
  to: string;
  subject: string;
  text?: string;
  headers?: Record<string, string>;
  attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>;
}

/** Отправка ответа из того же ящика. Возвращает Message-ID письма. */
export async function smtpSend(creds: MailboxCreds, mail: OutgoingMail): Promise<string> {
  const sa = await mailAddress(creds.smtp.host);
  const smtp = createTransport({
    host: sa.host,
    port: creds.smtp.port,
    secure: creds.smtp.secure,
    ...(sa.servername ? { tls: { servername: sa.servername } } : {}),
    auth: { user: creds.user, pass: creds.pass },
    connectionTimeout: 20_000,
  });

  try {
    const sent = await smtp.sendMail({
      from: mail.from,
      to: mail.to,
      subject: mail.subject,
      ...(mail.text ? { text: mail.text } : {}),
      ...(mail.headers ? { headers: mail.headers } : {}),
      ...(mail.attachments?.length
        ? {
            attachments: mail.attachments.map((a) => ({
              filename: a.filename,
              content: a.content,
              ...(a.contentType ? { contentType: a.contentType } : {}),
            })),
          }
        : {}),
    });
    return String(sent.messageId ?? '');
  } finally {
    smtp.close();
  }
}

/**
 * Отказ, который не лечится повтором.
 *
 * Неверный пароль и закрытый сервером вход — это настройка, а не
 * временная беда сети. Повторять такое в очереди значит долбиться в
 * чужой сервер до блокировки адреса.
 */
export function mailAuthFailed(err: unknown): boolean {
  const text = err instanceof Error ? `${err.message}` : String(err);
  return /auth|login|credential|password|535|534|password not accepted/i.test(text);
}
