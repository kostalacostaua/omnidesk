/**
 * Страница оплаты на домене-витрине.
 *
 * Paddle разрешает продавать только с тех доменов, которые он одобрил,
 * и субдомен одобряется отдельно от основного: одобренный rozmovio.com
 * не даёт права открыть окно оплаты на app.rozmovio.com. Пока субдомен
 * ждёт проверки, платить в кабинете нечем.
 *
 * Поэтому окно оплаты живёт здесь — на домене, который одобрен первым и
 * всегда. Кабинет заводит сделку у себя, как и раньше, и отправляет
 * человека сюда с её номером.
 *
 * Второе, ради чего эта страница нужна независимо от проверок. Paddle
 * сам рассылает ссылки на неоплаченные сделки — письмом о неудавшемся
 * списании, например, — и ведёт по адресу, который мы указали как
 * default payment link. Если это адрес кабинета, человек попадает на
 * форму входа: он хотел заплатить, а его спрашивают пароль. Здесь входа
 * не требуется, потому что номер сделки уже и есть доступ к ней, а
 * больше страница ничего не показывает.
 */

import type { FastifyInstance } from 'fastify';
import type { PaddleEnv } from '@omnidesk/core';

export interface PayDeps {
  env: PaddleEnv;
  /** Открытый токен окна оплаты. Он публичный по устройству Paddle. */
  clientToken: string;
  /** Куда вернуться после оплаты. */
  appUrl: string;
  contactEmail: string;
}

/** Номер сделки в том виде, в каком его выдаёт Paddle. */
export function payTxn(value: unknown): string | null {
  const s = String(value ?? '');
  return /^txn_[a-z0-9]+$/i.test(s) ? s : null;
}

/**
 * Разметка страницы.
 *
 * Собирается один раз при старте: она одна на всех, а номер сделки
 * читается в браузере из адреса. Отдавать её сборкой на каждый запрос
 * значило бы собирать одно и то же ради одной подстановки.
 */
export function payPage(deps: PayDeps): string {
  const back = deps.appUrl || 'https://app.rozmovio.com';
  return `<!doctype html><html lang="uk"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Оплата — Rozmovio</title>
<style>
  :root{color-scheme:light dark}
  body{font:16px/1.6 -apple-system,"Segoe UI",Roboto,sans-serif;max-width:560px;margin:0 auto;
       padding:64px 20px;background:#fff;color:#16161a}
  @media(prefers-color-scheme:dark){body{background:#0f0f12;color:#f0f0f3}a{color:#a5a7ff}}
  h1{font-size:24px;margin:0 0 8px}
  p{margin:0 0 12px}
  .muted{opacity:.65;font-size:14px}
  .btn{display:inline-block;margin-top:8px;padding:11px 18px;border-radius:10px;
       background:#3b40e8;color:#fff;text-decoration:none;font-weight:600}
  .err{color:#c2352f}
</style></head><body>
<h1 id="ttl">Відкриваємо оплату…</h1>
<p id="msg" class="muted">Вікно оплати відкриється саме. Якщо цього не сталося, перевірте блокувальник реклами.</p>
<p id="act"></p>
<p class="muted">Оплату проводить Paddle: він приймає картку, нараховує податок вашої країни і надсилає чек.
Питання — <a href="mailto:${deps.contactEmail}">${deps.contactEmail}</a>.</p>
<script>
var TOKEN = ${JSON.stringify(deps.clientToken)};
var ENV = ${JSON.stringify(deps.env)};
var BACK = ${JSON.stringify(back)};

function say(title, text, link){
  document.getElementById('ttl').textContent = title;
  document.getElementById('msg').textContent = text;
  document.getElementById('msg').className = link ? 'muted' : 'muted err';
  document.getElementById('act').innerHTML = link
    ? '<a class="btn" href="' + BACK + '">' + link + '</a>'
    : '';
}

/* Номер сделки Paddle кладёт в адрес сам, когда ведёт человека по
   своей ссылке на оплату. Свой параметр принимаем тоже: по нему сюда
   приходит кнопка из кабинета. */
function txnOf(){
  var q = new URLSearchParams(location.search);
  var v = q.get('_ptxn') || q.get('txn') || '';
  return /^txn_[a-z0-9]+$/i.test(v) ? v : null;
}

function done(ev){
  if (!ev || ev.name !== 'checkout.completed') return;
  say('Оплата пройшла', 'Дякуємо. Тариф оновиться протягом хвилини.', 'Повернутися в кабінет');
}

var txn = txnOf();
if (!txn) {
  say('Немає чого оплачувати', 'Посилання неповне: у ньому немає номера платежу. Відкрийте оплату з кабінету.', 'У кабінет');
} else if (!TOKEN) {
  say('Оплата поки недоступна', 'Сервіс оплати ще не налаштований. Напишіть нам, і ми виставимо рахунок.', '');
} else {
  var s = document.createElement('script');
  s.src = 'https://cdn.paddle.com/paddle/v2/paddle.js';
  s.onload = function(){
    try {
      if (ENV !== 'production') window.Paddle.Environment.set('sandbox');
      window.Paddle.Initialize({ token: TOKEN, eventCallback: done });
      window.Paddle.Checkout.open({ transactionId: txn });
      say('Оплата', 'Вікно оплати відкрите. Після оплати поверніться в кабінет.', 'У кабінет');
    } catch (e) {
      say('Не вдалося відкрити оплату', 'Спробуйте ще раз або напишіть нам.', 'У кабінет');
    }
  };
  s.onerror = function(){
    say('Не вдалося завантажити вікно оплати', 'Найчастіше це блокувальник реклами. Вимкніть його і оновіть сторінку.', 'У кабінет');
  };
  document.head.appendChild(s);
}
</script>
</body></html>`;
}

export function registerPay(app: FastifyInstance, deps: PayDeps): void {
  const html = payPage(deps);
  // Кэш короткий: страница одна на всех и меняется только с выкладкой,
  // но держать её в браузере сутками незачем — оплата случается редко,
  // а устаревшая страница оплаты стоит дороже лишнего запроса.
  app.get('/pay', async (_req, reply) =>
    reply
      .type('text/html; charset=utf-8')
      .header('cache-control', 'public, max-age=300')
      .send(html),
  );
}
