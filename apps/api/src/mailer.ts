import nodemailer from 'nodemailer';

/**
 * Отправка писем.
 *
 * Три способа, выбираются по тому, какая переменная задана:
 *
 *   RESEND_API_KEY — HTTP API Resend. Основной вариант на Railway.
 *   SMTP_URL       — обычный SMTP. Для своего сервера.
 *   ничего         — письмо не уходит, а пишется в лог.
 *
 * Почему HTTP, а не SMTP. Railway на тарифах Free, Trial и Hobby закрывает
 * исходящие SMTP-порты: это их защита от рассылки спама с их адресов.
 * Соединение просто не устанавливается, и без этой оговорки выглядело бы
 * как «почта почему-то не работает». HTTPS на порту 443 открыт всегда.
 */

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  readonly kind: 'resend' | 'smtp' | 'log';
  send(mail: Mail): Promise<void>;
}

export class MailError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'MailError';
  }
}

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
  const from = env.MAIL_FROM || 'Rozmovio <no-reply@localhost>';

  if (env.RESEND_API_KEY) {
    const key = env.RESEND_API_KEY;
    const root = env.RESEND_API_ROOT || 'https://api.resend.com';
    return {
      kind: 'resend',
      async send(mail) {
        const res = await fetchImpl(`${root}/emails`, {
          method: 'POST',
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) {
          // Текст ответа Resend здесь полезен: «domain is not verified»
          // и «invalid from address» — две разные ошибки настройки,
          // и по одному коду 403 их не различить.
          const body = await res.text().catch(() => '');
          throw new MailError(`Resend ответил ${res.status}: ${body.slice(0, 300)}`, res.status);
        }
      },
    };
  }

  if (env.SMTP_URL) {
    // Транспорт создаётся один раз: nodemailer держит пул соединений,
    // и пересоздание на каждое письмо означало бы новый TLS-хэндшейк.
    const transport = nodemailer.createTransport(env.SMTP_URL);
    return {
      kind: 'smtp',
      async send(mail) {
        await transport.sendMail({ from, ...mail });
      },
    };
  }

  return {
    kind: 'log',
    async send(mail) {
      // Локальный режим: письмо не уходит. Пишем тему — в ней код.
      log(`ПИСЬМО для ${mail.to}: ${mail.subject}`);
    },
  };
}
