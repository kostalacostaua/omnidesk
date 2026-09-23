import nodemailer from 'nodemailer';
import { createHttpMailer, MailError } from '@omnidesk/core';
import type { Mail, Mailer } from '@omnidesk/core';

/**
 * Отправка писем из api.
 *
 * Три способа, выбираются по тому, какая переменная задана:
 *
 *   RESEND_API_KEY — HTTP API Resend. Основной вариант на Railway.
 *   SMTP_URL       — обычный SMTP. Для своего сервера.
 *   ничего         — письмо не уходит, а пишется в лог.
 *
 * Resend и лог живут в ядре (`packages/core/src/mail.ts`): письма
 * отправляют и воркеры, когда уходит оповещение. SMTP остался здесь,
 * потому что тянет nodemailer, а в образ воркеров эта зависимость не
 * нужна.
 */

export type { Mail, Mailer };
export { MailError };

interface MailerEnv {
  RESEND_API_KEY?: string;
  SMTP_URL?: string;
  MAIL_FROM?: string;
  RESEND_API_ROOT?: string;
}

export function createMailer(
  env: MailerEnv,
  log: (line: string) => void,
  fetchImpl: typeof fetch = fetch,
): Mailer {
  if (env.RESEND_API_KEY) return createHttpMailer(env, log, fetchImpl);

  if (env.SMTP_URL) {
    // Транспорт создаётся один раз: nodemailer держит пул соединений,
    // и пересоздание на каждое письмо означало бы новый TLS-хэндшейк.
    const from = env.MAIL_FROM || 'Rozmovio <no-reply@localhost>';
    const transport = nodemailer.createTransport(env.SMTP_URL);
    return {
      kind: 'smtp',
      async send(mail) {
        await transport.sendMail({ from, ...mail });
      },
    };
  }

  return createHttpMailer(env, log, fetchImpl);
}
