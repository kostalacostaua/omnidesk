import type { FastifyInstance } from 'fastify';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { withSystem, type Pool } from '@omnidesk/core';

/**
 * Политика конфиденциальности и инструкция по удалению данных.
 *
 * Meta не публикует приложение без этих двух адресов: их проверяет
 * человек на ревью, и страница-заглушка ревью не проходит. Текст на
 * английском, потому что ревьюеры Meta читают его на английском, и
 * на украинском — для клиентов.
 */

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — Rozmovio</title>
<style>
  :root{color-scheme:light dark}
  body{font:16px/1.6 -apple-system,"Segoe UI",Roboto,sans-serif;max-width:760px;margin:0 auto;padding:32px 16px;
       background:#fff;color:#16161a}
  @media(prefers-color-scheme:dark){body{background:#0f0f12;color:#f0f0f3}a{color:#a5a7ff}}
  h1{font-size:28px;margin:0 0 4px} h2{font-size:19px;margin:28px 0 8px} .muted{opacity:.65;font-size:14px}
  hr{border:0;border-top:1px solid rgba(128,128,128,.3);margin:40px 0}
</style></head><body>${body}</body></html>`;
}

export interface LegalDeps {
  contactEmail: string;
  operator: string;
  pool: Pool;
  appUrl: string;
  /** Секрет приложения Meta: им подписан запрос на удаление данных. */
  metaAppSecret: string;
}

/**
 * Разбор signed_request от Meta.
 *
 * Формат: «подпись.данные», обе части в base64url. Подпись — HMAC-SHA256
 * от ВТОРОЙ части (строки, а не разобранного JSON) на секрете приложения.
 * Сравнение обязательно постоянного времени: иначе по времени ответа
 * можно подобрать подпись побайтово.
 */
export function parseSignedRequest(
  signed: string,
  appSecret: string,
): { user_id?: string; algorithm?: string } | null {
  const [sigPart, dataPart] = signed.split('.');
  if (!sigPart || !dataPart) return null;
  const expected = createHmac('sha256', appSecret).update(dataPart).digest();
  const given = Buffer.from(sigPart, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(dataPart, 'base64url').toString('utf8')) as {
      user_id?: string;
      algorithm?: string;
    };
    if (payload.algorithm && payload.algorithm.toUpperCase() !== 'HMAC-SHA256') return null;
    return payload;
  } catch {
    return null;
  }
}

export function registerLegal(app: FastifyInstance, opts: LegalDeps): void {
  const email = opts.contactEmail;
  const who = opts.operator;

  const privacy = page(
    'Privacy Policy',
    `<h1>Privacy Policy</h1><div class="muted">Last updated: September 22, 2026</div>
<p>Rozmovio (“we”) is a customer messaging inbox operated by ${who}. Businesses (“customers”) connect their
Telegram, Facebook Messenger and Instagram accounts to Rozmovio so their staff can answer messages from one place,
including inside Zoho CRM.</p>
<h2>What data we process</h2>
<ul>
<li>Messages and attachments sent to or from the business accounts our customers connect.</li>
<li>Basic public profile of people who write to those accounts: name, username and profile picture,
as provided by the messaging platform.</li>
<li>Access tokens issued by the platforms, stored encrypted (AES-256-GCM, separate key per customer).</li>
<li>Email addresses of our customers' staff, used only to sign in.</li>
</ul>
<h2>How we use it</h2>
<p>Solely to display conversations to the business that owns the connected account and to deliver its replies.
We do not sell data, do not use it for advertising and do not share it with third parties, except infrastructure
providers that host the service (Railway, EU region) and deliver sign-in emails (Resend).</p>
<h2>Meta Platform data</h2>
<p>Data received through Facebook Login and the Messenger / Instagram APIs is used only to provide the inbox
features the business has enabled, in line with the Meta Platform Terms. Each business can disconnect a page
at any time in Rozmovio settings or in Facebook → Settings → Business Integrations.</p>
<h2>Retention and deletion</h2>
<p>Data is kept while the business uses Rozmovio. When a business disconnects a channel or closes its account,
related data is deleted within 30 days. See <a href="/data-deletion">Data deletion</a>.</p>
<h2>Contact</h2>
<p><a href="mailto:${email}">${email}</a></p>
<hr>
<h1>Політика конфіденційності</h1>
<p>Rozmovio — сервіс для роботи з повідомленнями клієнтів, який надає ${who}. Ми обробляємо повідомлення та
базові дані профілю лише для того, щоб показати листування компанії, яка підключила свій акаунт, і доставити
її відповіді. Ми не продаємо дані й не використовуємо їх для реклами. Токени доступу зберігаються зашифрованими.
Питання та запити на видалення: <a href="mailto:${email}">${email}</a>.</p>`,
  );

  const deletion = page(
    'Data deletion',
    `<h1>Data deletion</h1>
<p>To delete data Rozmovio received from your Facebook or Instagram account:</p>
<ol>
<li>Go to Facebook → Settings &amp; privacy → Settings → Business integrations, find <b>Rozmovio</b> and click <b>Remove</b>.
Messages will stop arriving immediately.</li>
<li>Send a request to <a href="mailto:${email}">${email}</a> with the name of the page or Instagram account.
We delete the related conversations, contacts and tokens within 30 days and confirm by email.</li>
</ol>
<p>If you wrote to a business that uses Rozmovio and want your messages removed, contact that business
or write to us at the same address.</p>
<hr>
<h1>Видалення даних</h1>
<p>Видаліть застосунок Rozmovio у налаштуваннях Facebook (Бізнес-інтеграції) і напишіть на
<a href="mailto:${email}">${email}</a> — ми видалимо пов'язані дані протягом 30 днів.</p>`,
  );

  const send = (html: string) => async (_req: unknown, reply: { type: (t: string) => { send: (b: string) => unknown } }) =>
    reply.type('text/html; charset=utf-8').send(html);

  app.get('/privacy', send(privacy) as never);

  // Meta шлёт запрос на удаление данных как обычную форму, а не JSON.
  // Fastify такой тип без плагина не разбирает, поэтому парсер здесь.
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req, body, done) => {
      const params = new URLSearchParams(body as string);
      done(null, Object.fromEntries(params.entries()));
    },
  );

  /**
   * Запрос на удаление данных от Meta.
   *
   * Отвечаем сразу: подтверждаем приём, даём код и адрес, по которому
   * человек увидит состояние. Само удаление делает воркер — оно может
   * занять время, а Meta ждёт ответ в пределах секунд.
   */
  app.post<{ Body: { signed_request?: string } }>('/meta/data-deletion', async (req, reply) => {
    const signed = req.body?.signed_request ?? '';
    if (!opts.metaAppSecret) return reply.code(503).send({ error: 'meta_not_configured' });
    const payload = signed ? parseSignedRequest(signed, opts.metaAppSecret) : null;
    if (!payload?.user_id) {
      app.log.warn('Запрос на удаление данных с неверной подписью');
      return reply.code(400).send({ error: 'invalid_signed_request' });
    }

    const code = randomBytes(8).toString('hex');
    await withSystem(opts.pool, 'запрос на удаление данных', async (db) => {
      await db.query(
        `INSERT INTO data_deletion_requests (provider, external_id, confirmation_code)
         VALUES ('meta', $1, $2)`,
        [payload.user_id, code],
      );
    });
    app.log.info({ code }, 'Принят запрос на удаление данных Meta');

    return {
      url: `${opts.appUrl}/data-deletion?code=${code}`,
      confirmation_code: code,
    };
  });

  app.get<{ Querystring: { code?: string } }>('/data-deletion', async (req, reply) => {
    const code = (req.query.code ?? '').replace(/[^a-f0-9]/g, '').slice(0, 32);
    if (!code) return reply.type('text/html; charset=utf-8').send(deletion);

    const row = await withSystem(opts.pool, 'состояние удаления данных', async (db) => {
      const { rows } = await db.query<{ status: string; created_at: Date; processed_at: Date | null }>(
        `SELECT status, created_at, processed_at FROM data_deletion_requests
          WHERE confirmation_code = $1 LIMIT 1`,
        [code],
      );
      return rows[0] ?? null;
    });

    const status = !row
      ? '<p>Request <b>' + code + '</b> was not found. It may have been completed and removed. ' +
        'Write to <a href="mailto:' + email + '">' + email + '</a> and we will check.</p>'
      : row.status === 'done'
        ? '<p>Request <b>' + code + '</b>: <b>completed</b>. All data we had about this account was deleted on ' +
          (row.processed_at ?? row.created_at).toISOString().slice(0, 10) + '.</p>'
        : row.status === 'failed'
          ? '<p>Request <b>' + code + '</b>: we could not complete it automatically. ' +
            'Our team was notified and will finish it manually; write to <a href="mailto:' + email +
            '">' + email + '</a> for the current state.</p>'
          : '<p>Request <b>' + code + '</b>: <b>received</b> on ' +
            row.created_at.toISOString().slice(0, 10) +
            '. Deletion runs within minutes and always within 30 days.</p>';

    return reply
      .type('text/html; charset=utf-8')
      .send(page('Data deletion request', '<h1>Data deletion request</h1>' + status +
        '<p><a href="/data-deletion">How to request deletion</a></p>'));
  });
  // Один и тот же текст под несколькими адресами: проверка ссылки
  // у Meta капризна к написанию, и проще отвечать на все варианты,
  // чем гадать, какой из них она примет.
  for (const path of ['/datadeletion', '/data_deletion', '/deletion']) {
    app.get(path, send(deletion) as never);
  }
}
