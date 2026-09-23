/**
 * Письма по HTTP.
 *
 * Здесь только то, что нужно всем сервисам: отправка через Resend и
 * режим «написать в лог» для местной разработки. SMTP живёт в api
 * (`apps/api/src/mailer.ts`): он тянет nodemailer, а воркерам эта
 * зависимость не нужна — в прод письма уходят по HTTPS.
 *
 * Почему HTTP, а не SMTP. Railway на тарифах Free, Trial и Hobby
 * закрывает исходящие SMTP-порты — это их защита от рассылки спама.
 * Соединение просто не устанавливается, и выглядит это как «почта
 * почему-то не работает». HTTPS на 443 открыт всегда.
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

export interface HttpMailerEnv {
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  RESEND_API_ROOT?: string;
}

/** Resend, если задан ключ; иначе запись в лог. */
export function createHttpMailer(
  env: HttpMailerEnv,
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
          body: JSON.stringify({
            from,
            to: [mail.to],
            subject: mail.subject,
            text: mail.text,
            html: mail.html,
          }),
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

  return {
    kind: 'log',
    async send(mail) {
      log(`ПИСЬМО для ${mail.to}: ${mail.subject}`);
    },
  };
}
