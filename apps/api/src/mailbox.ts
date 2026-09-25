/**
 * Проверка доступа к почтовому ящику.
 *
 * Отдельным файлом и отдельной зависимостью: это единственное место в
 * api, которое ходит не по HTTP. Проверка нужна именно здесь, а не в
 * воркере: человек нажал «підключити» и должен узнать про неверный
 * пароль сейчас, а не через минуту молчания.
 *
 * Проверяются обе половины. Ящик, из которого можно читать, но нельзя
 * ответить, — не канал, и выясняться это должно не в момент первого
 * ответа клиенту.
 */

import { ImapFlow } from 'imapflow';
import { createTransport } from 'nodemailer';
import type { MailboxCreds } from '@omnidesk/core';

export async function verifyMailbox(creds: MailboxCreds): Promise<void> {
  const imap = new ImapFlow({
    host: creds.imap.host,
    port: creds.imap.port,
    secure: creds.imap.secure,
    auth: { user: creds.user, pass: creds.pass },
    logger: false,
    socketTimeout: 30_000,
  });

  await imap.connect();
  try {
    await imap.mailboxOpen('INBOX', { readOnly: true });
  } finally {
    await imap.logout().catch(() => undefined);
  }

  const smtp = createTransport({
    host: creds.smtp.host,
    port: creds.smtp.port,
    secure: creds.smtp.secure,
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
 * Отказ ящика человеческими словами.
 *
 * Почтовые серверы отвечают строками вроде «535 5.7.8 Username and
 * Password not accepted» со ссылкой на справку. Показывать это целиком
 * — значит показывать чужой протокол; нам важно одно: это пароль, имя
 * сервера или сеть.
 */
export function mailboxWhy(err: unknown): string {
  /*
   * «Command failed» — это фраза библиотеки, а не сервера. Настоящий
   * ответ лежит рядом, в responseText: «Invalid credentials»,
   * «Application-specific password required», «LOGIN failed». Без него
   * человек видит два слова по-английски и не знает, что делать.
   */
  const e = (err ?? {}) as { message?: unknown; responseText?: unknown; code?: unknown };
  const said = typeof e.responseText === 'string' ? e.responseText : '';
  const text = [said, typeof e.message === 'string' ? e.message : String(err), String(e.code ?? '')]
    .filter(Boolean)
    .join(' ');

  if (/application-specific|app password|web login required|please log in via your web browser/i.test(text)) {
    return 'Пошта вимагає окремий пароль застосунку: звичайний пароль скриньки сюди не підходить.';
  }
  if (/imap.{0,20}disabled|imap access|not enabled/i.test(text)) {
    return 'У цій скриньці вимкнено IMAP — увімкніть його в налаштуваннях пошти.';
  }
  if (/auth|credential|password|535|534|login failed|invalid user|no \[/i.test(text)) {
    return 'Пошта не прийняла адресу або пароль. У Gmail, ukr.net та iCloud потрібен окремий пароль застосунку.';
  }
  if (/enotfound|getaddrinfo|dns/i.test(text)) return 'Сервер з такою назвою не знайдено — перевірте адреси IMAP і SMTP.';
  if (/timeout|etimedout|econnrefused|econnreset/i.test(text)) {
    return 'Сервер не відповідає на цьому порту — перевірте порт або зачекайте хвилину.';
  }
  if (/certificate|self signed|altname/i.test(text)) return 'Сертифікат сервера не підходить — перевірте назву сервера.';
  // Незнакомый отказ отдаём словами сервера, а не библиотеки: чужое
  // объяснение всё равно полезнее нашего «не вийшло».
  return (said || text).slice(0, 200);
}
