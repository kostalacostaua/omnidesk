import type { FastifyInstance } from 'fastify';

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

export function registerLegal(app: FastifyInstance, opts: { contactEmail: string; operator: string }): void {
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
  app.get('/data-deletion', send(deletion) as never);
}
