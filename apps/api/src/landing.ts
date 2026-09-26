import type { FastifyInstance, FastifyReply } from 'fastify';
import { withSystem, type Pool } from '@omnidesk/core';
import { BRAND_CSS, THEME_JS } from './theme.js';
import type { Mailer } from './mailer.js';

/**
 * Промо-страница Rozmovio.
 *
 * Отдаётся тем же процессом, что и приложение: отдельный сайт на этом
 * этапе означал бы второй деплой, второй домен в настройках и второе
 * место, где оформление живёт своей жизнью. Оформление берётся из
 * theme.ts — ровно то же, что в рабочем месте оператора.
 *
 * ⚠️ Внутри шаблонной строки НЕЛЬЗЯ использовать обратные слэши: они
 * съедаются компилятором, и до браузера доезжает не то, что написано.
 * За этим следит scripts/check-ui.mjs.
 *
 * Язык. По умолчанию — по языку браузера: украинский для uk и ru,
 * английский для остальных. Выбор человека сохраняется и побеждает.
 * Тексты лежат в одном словаре T внизу страницы: так видно, что
 * перевод не забыт, и не приходится искать строки по разметке.
 */

const NL = String.fromCharCode(10);

/** Знак Rozmovio. Тот же, что в иконке приложения и в брендбуке. */
const MARK = `<svg viewBox="0 0 100 100" class="mk" aria-hidden="true"><defs><linearGradient id="lgg" x1="10" y1="8" x2="92" y2="94" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#2F6BFF"/><stop offset="1" stop-color="#7A3CF0"/></linearGradient></defs><path fill-rule="evenodd" fill="url(#lgg)" d="M6 22A16 16 0 0 1 22 6H60A32 32 0 0 1 92 38A28 28 0 0 1 72 64.6L93 90.5A5 5 0 0 1 89 94H67.5A5 5 0 0 1 63.6 92.1L44 67L25.2 91.2A8 8 0 0 1 6 86ZM32 23H62A9 9 0 0 1 71 32V41A9 9 0 0 1 62 50H43L30.5 60.5A1.5 1.5 0 0 1 28 59.4V50.2A9 9 0 0 1 23 42V32A9 9 0 0 1 32 23Z"/></svg>`;

const ICON_TG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 4.5 2.8 11.3c-.8.3-.8 1.4 0 1.7l4.4 1.5 1.7 4.9c.2.7 1.2.8 1.6.2l2.3-3.2 4.6 3.4c.6.4 1.4.1 1.6-.6l3-13.4c.2-.8-.7-1.5-1.5-1.3z"/><path d="M7.2 14.5 18 7.2l-7.4 8"/></svg>`;
const ICON_IG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="5.5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.2" cy="6.8" r="1.1" fill="currentColor" stroke="none"/></svg>`;
const ICON_MS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5c-5.3 0-9.5 3.9-9.5 8.8 0 2.8 1.4 5.2 3.6 6.8V22l3.2-1.8c.9.2 1.8.4 2.7.4 5.3 0 9.5-3.9 9.5-8.8S17.3 2.5 12 2.5z"/><path d="M6.6 14.4l3.2-4.8 2.6 2.2 2.4-2.9 2.6 4"/></svg>`;
const ICON_PH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2.5" width="12" height="19" rx="2.6"/><path d="M10.5 18.7h3"/></svg>`;
/**
 * У Messenger, WhatsApp и Viber была одна иконка на троих: в списке из
 * восьми каналов это читается как «три одинаковых», и взгляд по ним
 * скользит мимо. Поэтому у каждого своя форма.
 */
const ICON_WA = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.8a9.2 9.2 0 0 0-7.9 13.9L3 21.2l4.7-1.1A9.2 9.2 0 1 0 12 2.8z"/><path d="M9 8.4c.3-.1.6 0 .8.3l.8 1.3c.1.3.1.6-.1.8l-.5.6c.6 1.1 1.5 2 2.6 2.6l.6-.5c.2-.2.5-.2.8-.1l1.3.8c.3.2.4.5.3.8-.3.8-1.1 1.3-1.9 1.2-2.9-.3-5.4-2.8-5.7-5.7-.1-.8.3-1.6 1-1.9z"/></svg>`;
const ICON_VB = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.6c-4.8 0-8.6 3.3-8.6 7.9 0 2.6 1.2 4.8 3.2 6.3v3.9l3.1-2.1c.7.1 1.5.2 2.3.2 4.8 0 8.6-3.3 8.6-7.9S16.8 2.6 12 2.6z"/><path d="M9.3 7.6c.9-.2 1.4 1.3 1.6 2 .1.4-.2.7-.5.9 .4 1 1.1 1.8 2.1 2.3 .2-.3.5-.6.9-.5.7.2 2.2.7 2 1.6-.2.9-1.2 1.4-2 1.3-2.5-.3-4.7-2.5-5.1-5-.1-.8.2-1.5 1-1.6z"/></svg>`;

/** Чат на сайте: окно браузера с пузырём — по нему канал узнают. */
const ICON_WC = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="3.5" width="19" height="14" rx="2.5"/><path d="M2.5 7.5h19"/><path d="M8 11h8M8 14h5"/></svg>`;
const ICON_ZH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7.5h10M4 12h16M4 16.5h10"/><circle cx="18.5" cy="7.5" r="2"/><circle cx="18.5" cy="16.5" r="2"/></svg>`;

/** Разметка одной карточки канала. */
/*
 * Карточка канала и его состояние.
 *
 * Три состояния, не два: «работает», «скоро» и «закрытый тест». Третье
 * появилось не для красоты — каналы Meta работают, но подключить их
 * пока может не каждый, и зелёная точка напротив них была бы обещанием,
 * которого мы не сдержим в первый же день.
 */
type ChState = 'ready' | 'soon' | 'beta';

function chCard(icon: string, key: string, state: ChState = 'ready'): string {
  const pill =
    state === 'soon'
      ? '<span class="pill flat" data-t="soon"></span>'
      : state === 'beta'
        ? '<span class="pill warn" data-t="beta"></span>'
        : '<span class="pill good" data-t="ready"></span>';

  return `<div class="ch${state === 'soon' ? ' soon' : ''}">
    <div class="ci">${icon}</div>
    <div class="grow">
      <div class="h4" data-t="${key}.t"></div>
      <div class="cs" data-t="${key}.s"></div>
    </div>
    ${pill}
  </div>`;
}

export const LANDING_HTML = `<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rozmovio — всі переписки з клієнтами в одному вікні</title>
<meta name="description" content="Telegram, Instagram Direct, Messenger, WhatsApp і чат на сайті в одній скриньці. Працює у браузері та вбудовується у Zoho CRM, Pipedrive чи Бітрікс24.">
<meta property="og:title" content="Rozmovio — одна скринька для всіх переписок з клієнтами">
<meta property="og:description" content="Месенджери і чат на сайті в одному вікні. У браузері або всередині вашої CRM. 14 днів безкоштовно.">
<meta property="og:type" content="website">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400;14..32,500;14..32,600;14..32,700&display=swap" rel="stylesheet">
<script data-theme-boot>${THEME_JS}</script>
<style>
  ${BRAND_CSS}

  /* ─── Страница ─────────────────────────────────────────────────
     Промо-страница отличается от рабочего места ровно двумя вещами:
     воздухом и подсветкой. Всё остальное — те же токены и блоки. */
  html{scroll-behavior:smooth}
  body{overflow-x:hidden}
  .wrap{max-width:1140px;margin:0 auto;padding:0 20px}
  section{position:relative}

  /* Свечение на фоне. Два размытых пятна бренд-цветами: они дают
     ощущение глубины, не мешая читать, и стоят дешевле картинки. */
  .aura{position:fixed;inset:0;pointer-events:none;z-index:-1;overflow:hidden}
  .aura i{position:absolute;border-radius:50%;filter:blur(90px);opacity:.5}
  .aura i:nth-child(1){width:620px;height:620px;top:-260px;left:-120px;
    background:radial-gradient(circle,var(--brand1),transparent 70%)}
  .aura i:nth-child(2){width:560px;height:560px;top:-180px;right:-160px;
    background:radial-gradient(circle,var(--brand2),transparent 70%)}
  .aura i:nth-child(3){width:700px;height:700px;bottom:-380px;left:30%;
    background:radial-gradient(circle,var(--brand1),transparent 72%);opacity:.3}
  @media(prefers-color-scheme:dark){.aura i{opacity:.34}}

  /* ─── Шапка ────────────────────────────────────────────────────
     Липкая и полупрозрачная: на длинной странице кнопка «спробувати»
     должна быть под рукой в любой момент, но не закрывать текст. */
  header{position:sticky;top:0;z-index:50;background:var(--glass);
    border-bottom:1px solid var(--line);backdrop-filter:var(--blur);
    -webkit-backdrop-filter:var(--blur)}
  header .in{display:flex;align-items:center;gap:var(--s4);height:62px}
  .brand{display:flex;align-items:center;gap:9px;font-family:var(--font-display);
    font-weight:800;font-size:17px;letter-spacing:-.025em;color:var(--t1);text-decoration:none}
  .brand:hover{text-decoration:none}
  .mk{width:26px;height:26px;display:block}
  nav.links{display:flex;gap:var(--s5);margin-left:var(--s5)}
  nav.links a{color:var(--t2);font-size:13px;font-weight:600;text-decoration:none}
  nav.links a:hover{color:var(--t1);text-decoration:none}
  header .acts{margin-left:auto;display:flex;align-items:center;gap:var(--s2)}
  .icob{width:32px;height:32px;padding:0;display:inline-flex;align-items:center;
    justify-content:center;background:var(--panel);border:1px solid var(--line2);
    border-radius:var(--r1);box-shadow:none;color:var(--t2)}
  .icob svg{width:16px;height:16px;stroke:var(--t2);fill:none;stroke-width:1.7;
    stroke-linecap:round;stroke-linejoin:round}
  .icob:hover{background:var(--hover);border-color:var(--t3)}
  .icob:hover svg{stroke:var(--t1)}
  @media(max-width:880px){nav.links,.hide-s{display:none}}

  /* ─── Первый экран ─────────────────────────────────────────────
     Две колонки: слева обещание и действие, справа показ продукта.
     Показ важнее любого описания: человек должен увидеть, как это
     выглядит, до того как решит регистрироваться. */
  .hero{padding:clamp(48px,8vw,96px) 0 clamp(36px,5vw,64px)}
  .hero .in{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);
    gap:clamp(28px,5vw,64px);align-items:center}
  @media(max-width:980px){.hero .in{grid-template-columns:minmax(0,1fr)}}
  .tagb svg{width:14px;height:14px;flex:none}
  .tagb{display:inline-flex;align-items:center;gap:7px;font-size:11.5px;font-weight:700;
    letter-spacing:.02em;text-transform:uppercase;color:var(--accent);
    background:var(--accent-soft);padding:5px 11px;border-radius:var(--rf);
    margin-bottom:var(--s4)}
  .hero .h1{margin-bottom:var(--s4)}
  .hero .lead{max-width:34em;margin-bottom:var(--s5)}
  .cta{display:flex;gap:var(--s2);max-width:460px}
  .cta input{height:46px;border-radius:var(--r2);padding:0 14px;font-size:14px;
    background:var(--solid)}
  .cta button{height:46px;flex:none}
  .note{margin:var(--s3) 0 0;font-size:12px;color:var(--t3)}
  .strip{display:flex;gap:var(--s4);flex-wrap:wrap;margin-top:var(--s6);
    padding-top:var(--s4);border-top:1px solid var(--line)}
  .strip div{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:600;
    color:var(--t2)}
  .strip svg{width:15px;height:15px;color:var(--t3);flex:none}

  /* Показ продукта. Это не картинка, а настоящая разметка: она
     переживает смену темы и не размывается на плотных экранах. */
  .shot{border-radius:var(--r4);border:1px solid var(--glass-line);background:var(--glass);
    backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur);
    box-shadow:var(--lift2);overflow:hidden;transform:perspective(1400px) rotateY(-7deg) rotateX(2deg);
    transition:transform var(--slow) var(--ease)}
  .shot:hover{transform:perspective(1400px) rotateY(-3deg) rotateX(1deg)}
  @media(max-width:980px){.shot{transform:none}}
  .shot .bar{display:flex;align-items:center;gap:6px;padding:9px 12px;
    border-bottom:1px solid var(--line);background:var(--panel2)}
  .shot .bar i{width:9px;height:9px;border-radius:50%;background:var(--line2);display:block}
  .shot .bar span{margin-left:8px;font-size:10.5px;color:var(--t3);font-family:var(--mono)}
  .shot .body{display:grid;grid-template-columns:40px 132px minmax(0,1fr);height:330px}
  .shot .rl{border-right:1px solid var(--line);padding:10px 0;display:flex;
    flex-direction:column;align-items:center;gap:9px;background:var(--rail)}
  .shot .rl b{width:22px;height:22px;border-radius:6px;background:var(--grad);display:block}
  .shot .rl i{width:18px;height:18px;border-radius:5px;background:var(--line);display:block}
  .shot .rl i.on{background:var(--accent-soft)}
  .shot .ls{border-right:1px solid var(--line);padding:9px;display:flex;
    flex-direction:column;gap:9px;overflow:hidden}
  .shot .lr{display:flex;gap:7px;align-items:center}
  .shot .lr .a{width:24px;height:24px;border-radius:6px;flex:none;background:var(--grad)}
  .shot .lr .a.g{background:linear-gradient(120deg,#0ea5e9,#22d3ee)}
  .shot .lr .a.p{background:linear-gradient(120deg,#f43f5e,#f59e0b)}
  .shot .lr .t{flex:1}
  .shot .lr .t b{display:block;height:6px;border-radius:3px;background:var(--line2);
    width:62%;margin-bottom:5px}
  .shot .lr .t i{display:block;height:5px;border-radius:3px;background:var(--line);width:88%}
  .shot .lr.on{background:var(--hover);margin:0 -9px;padding:0 9px}
  .shot .th{padding:14px;display:flex;flex-direction:column;gap:8px;justify-content:flex-end}
  .shot .bb{max-width:70%;width:fit-content;padding:8px 11px;border-radius:10px;
    font-size:11.5px;line-height:1.45}
  .shot .bb.in{align-self:flex-start;background:var(--panel);border:1px solid var(--line);
    border-bottom-left-radius:3px}
  .shot .bb.out{align-self:flex-end;background:var(--accent);color:var(--on-accent);
    border-bottom-right-radius:3px}
  .shot .typ{align-self:flex-start;display:flex;gap:4px;padding:9px 11px;background:var(--panel);
    border:1px solid var(--line);border-radius:10px;border-bottom-left-radius:3px}
  .shot .typ i{width:5px;height:5px;border-radius:50%;background:var(--t3);display:block;
    animation:blink 1.3s ease-in-out infinite}
  .shot .typ i:nth-child(2){animation-delay:.18s}
  .shot .typ i:nth-child(3){animation-delay:.36s}
  @keyframes blink{0%,60%,100%{opacity:.25}30%{opacity:1}}
  @media(prefers-reduced-motion:reduce){.shot .typ i{animation:none}}

  /* ─── Обычная секция ───────────────────────────────────────────── */
  .sec{padding:clamp(44px,6vw,80px) 0}
  .sec.tint{background:var(--bg2)}
  .shd{max-width:640px;margin-bottom:clamp(24px,3vw,40px)}
  .shd .h2{margin-bottom:var(--s3)}
  .grid{display:grid;gap:var(--s3)}
  .g2{grid-template-columns:repeat(2,minmax(0,1fr))}
  .g3{grid-template-columns:repeat(3,minmax(0,1fr))}
  @media(max-width:880px){.g2,.g3{grid-template-columns:minmax(0,1fr)}}

  /* Канал. Иконка, название, одна строка про то, что именно работает,
     и честный статус: «працює» или «скоро». Обещать то, чего нет,
     дороже, чем не обещать. */
  .ch{display:flex;align-items:center;gap:var(--s3);padding:var(--s4);
    background:var(--panel);border:1px solid var(--line);border-radius:var(--r3);
    transition:transform var(--quick) var(--ease),box-shadow var(--quick) ease,
      border-color var(--quick) ease}
  .ch:hover{transform:translateY(-2px);box-shadow:var(--lift);border-color:var(--line2)}
  .ch.soon{opacity:.62}
  .ch .ci{width:40px;height:40px;border-radius:var(--r2);flex:none;display:flex;
    align-items:center;justify-content:center;background:var(--accent-soft);color:var(--accent)}
  .ch .ci svg{width:21px;height:21px}
  .cs{font-size:12px;color:var(--t3);margin-top:3px;line-height:1.45}

  /* Шаг. Номер крупный и бледный: он помогает считать, но не должен
     перетягивать внимание с текста. */
  .step{padding:var(--s4);background:var(--panel);border:1px solid var(--line);
    border-radius:var(--r3);position:relative;overflow:hidden}
  .step .n{font-family:var(--font-display);font-size:46px;font-weight:800;line-height:1;
    letter-spacing:-.04em;background:var(--grad);-webkit-background-clip:text;
    background-clip:text;color:transparent;opacity:.5;margin-bottom:var(--s2)}
  .step .h4{margin-bottom:6px}
  .step p{margin:0;font-size:12.5px;line-height:1.6;color:var(--t2)}

  /* Возможности: плотная сетка коротких фактов. Длинный список
     продающих обещаний никто не читает, короткие факты — читают. */
  .feat{padding:var(--s4);background:var(--panel);border:1px solid var(--line);
    border-radius:var(--r3)}
  .feat .h4{margin-bottom:6px}
  .feat p{margin:0;font-size:12.5px;line-height:1.6;color:var(--t2)}

  /* Zoho: две колонки, слева объяснение, справа показ карточки с
     виджетом — ровно то место, где сервис живёт у клиента. */
  .two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);
    gap:clamp(28px,5vw,56px);align-items:center}
  @media(max-width:980px){.two{grid-template-columns:minmax(0,1fr)}}
  .ulist{margin:var(--s4) 0 0;padding:0;list-style:none;display:flex;
    flex-direction:column;gap:10px}
  .ulist li{display:flex;gap:10px;font-size:13px;line-height:1.55;color:var(--t2)}
  .ulist li::before{content:"✓";width:18px;height:18px;border-radius:50%;flex:none;
    background:var(--accent-soft);color:var(--accent);font-size:10px;font-weight:700;
    display:flex;align-items:center;justify-content:center;margin-top:1px}
  .ulist li b{color:var(--t1)}
  .crm{border:1px solid var(--line);border-radius:var(--r4);overflow:hidden;
    background:var(--solid);box-shadow:var(--lift)}
  .crm .top{padding:11px 14px;border-bottom:1px solid var(--line);background:var(--panel2);
    display:flex;align-items:center;gap:9px;font-size:12px;font-weight:700;color:var(--t2)}
  .crm .top svg{width:16px;height:16px;flex:none}
  .crm .w .wh svg{width:15px;height:15px;flex:none}
  .crm .rec{padding:14px;display:flex;flex-direction:column;gap:9px}
  .crm .f{display:flex;gap:10px;align-items:center;font-size:12px}
  .crm .f span{width:78px;color:var(--t3);flex:none}
  .crm .f b{font-weight:600}
  .crm .w{margin:0 14px 14px;border:1px solid var(--accent-soft);border-radius:var(--r3);
    overflow:hidden}
  .crm .w .wh{padding:8px 11px;background:var(--accent-soft);font-size:11px;font-weight:700;
    color:var(--accent);display:flex;align-items:center;gap:7px}
  .crm .w .wb{padding:11px;display:flex;flex-direction:column;gap:7px}

  /* Цена. Одна карточка: выбор из трёх тарифов на этом этапе только
     мешает — человек начинает сравнивать вместо того, чтобы пробовать. */
  .price{max-width:440px;margin:0 auto;padding:var(--s5);border-radius:var(--r4);
    background:var(--glass);border:1px solid var(--glass-line);backdrop-filter:var(--blur);
    -webkit-backdrop-filter:var(--blur);box-shadow:var(--lift2);text-align:center}
  .price .amt{font-family:var(--font-display);font-size:54px;font-weight:800;line-height:1;
    letter-spacing:-.04em;margin:var(--s3) 0 4px}
  .price .per{font-size:13px;color:var(--t3);margin-bottom:var(--s4)}
  .price ul{list-style:none;margin:0 0 var(--s5);padding:0;text-align:left;
    display:flex;flex-direction:column;gap:9px}
  .price li{font-size:13px;color:var(--t2);display:flex;gap:9px;align-items:flex-start}
  .price li::before{content:"✓";width:16px;height:16px;border-radius:50%;flex:none;
    background:var(--good-bg);color:var(--good);font-size:9.5px;font-weight:700;
    display:flex;align-items:center;justify-content:center;margin-top:2px}
  /* Месячная цена рядом с годовой: мельче, но не сноска. Человек
     должен увидеть обе и выбрать, а не искать вторую глазами. */
  .price .alt{font-size:12.5px;color:var(--t3);margin:-8px 0 var(--s4)}
  .price button{width:100%}

  /* Заявка. Поля подписаны сверху: подпись внутри поля исчезает,
     как только человек начал печатать, и он перестаёт понимать,
     что именно вводит. */
  form.frm{max-width:620px;margin:0 auto}
  .fr{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--s3)}
  @media(max-width:640px){.fr{grid-template-columns:minmax(0,1fr)}}
  label.fl{display:block;font-size:11.5px;font-weight:700;color:var(--t2);
    margin-bottom:5px;letter-spacing:.01em}
  .fld{margin-bottom:var(--s3)}
  .fld input,.fld textarea{background:var(--solid);border-radius:var(--r2);padding:10px 12px;
    font-size:13.5px}
  .fld textarea{min-height:88px;resize:vertical}
  .cbs{display:flex;gap:var(--s2);flex-wrap:wrap}
  .cb{display:inline-flex;align-items:center;gap:7px;padding:8px 13px;border-radius:var(--rf);
    border:1px solid var(--line2);background:var(--panel);font-size:12.5px;font-weight:600;
    color:var(--t2);cursor:pointer;user-select:none;
    transition:background-color var(--quick) ease,border-color var(--quick) ease,
      color var(--quick) ease}
  .cb input{width:auto;margin:0;accent-color:var(--accent)}
  .cb:hover{border-color:var(--t3);color:var(--t1)}
  .cb.on{background:var(--accent-soft);border-color:var(--accent);color:var(--accent)}
  .done{text-align:center;padding:var(--s6) var(--s4)}
  .done .tick{width:54px;height:54px;border-radius:50%;background:var(--good-bg);
    color:var(--good);display:flex;align-items:center;justify-content:center;
    margin:0 auto var(--s4);font-size:26px;font-weight:700}

  footer{border-top:1px solid var(--line);padding:var(--s6) 0;margin-top:var(--s6)}
  footer .in{display:flex;gap:var(--s5);flex-wrap:wrap;align-items:center;
    font-size:12px;color:var(--t3)}
  footer a{color:var(--t2);font-weight:600}
  footer .grow{flex:1}

  /* Появление при прокрутке. Сдвиг на восемь пикселей и полсекунды:
     заметно как оживление страницы, но не заставляет ждать содержимое. */
  .rise{opacity:0;transform:translateY(10px);
    transition:opacity var(--slow) var(--ease),transform var(--slow) var(--ease)}
  .rise.seen{opacity:1;transform:none}
  @media(prefers-reduced-motion:reduce){.rise{opacity:1;transform:none;transition:none}}
</style>
</head>
<body>
<div class="aura" aria-hidden="true"><i></i><i></i><i></i></div>

<header>
  <div class="wrap in">
    <a class="brand" href="/">${MARK}Rozmovio</a>
    <nav class="links">
      <a href="#channels" data-t="nav.channels"></a>
      <a href="#how" data-t="nav.how"></a>
      <a href="#zoho" data-t="nav.zoho"></a>
      <a href="#price" data-t="nav.price"></a>
    </nav>
    <div class="acts">
      <div class="seg" role="group" aria-label="Мова">
        <button data-lang-btn="uk" type="button">UA</button>
        <button data-lang-btn="en" type="button">EN</button>
      </div>
      <button class="icob" id="themeBtn" type="button" title="Тема"></button>
      <button class="ghost hide-s" id="signin" type="button" data-t="nav.signin"></button>
      <button class="grad" id="top-try" type="button" data-t="nav.try"></button>
    </div>
  </div>
</header>

<section class="hero">
  <div class="wrap in">
    <div>
      <div class="tagb" data-t="hero.badge"></div>
      <h1 class="h1"><span data-t="hero.h1a"></span> <span class="grad-text" data-t="hero.h1b"></span></h1>
      <p class="lead" data-t="hero.lead"></p>
      <div class="cta">
        <input id="heroMail" type="email" autocomplete="email" data-tp="hero.mail">
        <button class="grad" id="heroGo" type="button" data-t="hero.go"></button>
      </div>
      <p class="note" data-t="hero.note"></p>
      <div class="strip">
        <div>${ICON_TG}<span data-t="strip.tg"></span></div>
        <div>${ICON_PH}<span data-t="strip.ph"></span></div>
        <div>${ICON_IG}<span data-t="strip.ig"></span></div>
        <div>${ICON_MS}<span data-t="strip.ms"></span></div>
        <div>${ICON_WC}<span data-t="strip.wc"></span></div>
      </div>
    </div>

    <div class="shot" aria-hidden="true">
      <div class="bar"><i></i><i></i><i></i><span>app.rozmovio.com</span></div>
      <div class="body">
        <div class="rl"><b></b><i class="on"></i><i></i><i></i><i></i></div>
        <div class="ls">
          <div class="lr on"><div class="a"></div><div class="t"><b></b><i></i></div></div>
          <div class="lr"><div class="a g"></div><div class="t"><b></b><i></i></div></div>
          <div class="lr"><div class="a p"></div><div class="t"><b></b><i></i></div></div>
          <div class="lr"><div class="a"></div><div class="t"><b></b><i></i></div></div>
        </div>
        <div class="th">
          <div class="bb in" data-t="shot.m1"></div>
          <div class="bb out" data-t="shot.m2"></div>
          <div class="bb in" data-t="shot.m3"></div>
          <div class="typ"><i></i><i></i><i></i></div>
        </div>
      </div>
    </div>
  </div>
</section>

<section class="sec tint" id="channels">
  <div class="wrap">
    <div class="shd rise">
      <h2 class="h2" data-t="ch.h"></h2>
      <p class="lead" data-t="ch.lead"></p>
    </div>
    <div class="grid g2 rise">
      ${chCard(ICON_WC, 'ch.wc')}
      ${chCard(ICON_TG, 'ch.tgbot')}
      ${chCard(ICON_PH, 'ch.tgph')}
      ${chCard(ICON_IG, 'ch.ig', 'beta')}
      ${chCard(ICON_MS, 'ch.ms', 'beta')}
      ${chCard(ICON_WA, 'ch.wa', 'beta')}
      ${chCard(ICON_VB, 'ch.vb')}
      ${chCard(ICON_VB, 'ch.vbn', 'soon')}
    </div>
    <p class="note rise" data-t="ch.beta"></p>
  </div>
</section>

<section class="sec" id="how">
  <div class="wrap">
    <div class="shd rise">
      <h2 class="h2" data-t="how.h"></h2>
      <p class="lead" data-t="how.lead"></p>
    </div>
    <div class="grid g3 rise">
      <div class="step"><div class="n">1</div><div class="h4" data-t="how.s1t"></div>
        <p data-t="how.s1p"></p></div>
      <div class="step"><div class="n">2</div><div class="h4" data-t="how.s2t"></div>
        <p data-t="how.s2p"></p></div>
      <div class="step"><div class="n">3</div><div class="h4" data-t="how.s3t"></div>
        <p data-t="how.s3p"></p></div>
    </div>
  </div>
</section>

<section class="sec tint" id="feat">
  <div class="wrap">
    <div class="shd rise"><h2 class="h2" data-t="ft.h"></h2></div>
    <div class="grid g3 rise">
      <div class="feat"><div class="h4" data-t="ft.f1t"></div><p data-t="ft.f1p"></p></div>
      <div class="feat"><div class="h4" data-t="ft.f2t"></div><p data-t="ft.f2p"></p></div>
      <div class="feat"><div class="h4" data-t="ft.f3t"></div><p data-t="ft.f3p"></p></div>
      <div class="feat"><div class="h4" data-t="ft.f4t"></div><p data-t="ft.f4p"></p></div>
      <div class="feat"><div class="h4" data-t="ft.f5t"></div><p data-t="ft.f5p"></p></div>
      <div class="feat"><div class="h4" data-t="ft.f6t"></div><p data-t="ft.f6p"></p></div>
    </div>
  </div>
</section>

<section class="sec" id="zoho">
  <div class="wrap two">
    <div class="rise">
      <div class="tagb">${ICON_ZH}<span data-t="zh.badge"></span></div>
      <h2 class="h2" data-t="zh.h"></h2>
      <p class="lead" style="margin-top:var(--s3)" data-t="zh.lead"></p>
      <ul class="ulist">
        <li data-t="zh.l1"></li>
        <li data-t="zh.l2"></li>
        <li data-t="zh.l3"></li>
        <li data-t="zh.l4"></li>
      </ul>
    </div>
    <div class="crm rise" aria-hidden="true">
      <div class="top">${ICON_ZH}<span data-t="zh.crm"></span></div>
      <div class="rec">
        <div class="f"><span data-t="zh.f1"></span><b>Олена Ковальчук</b></div>
        <div class="f"><span data-t="zh.f2"></span><b>+380 67 000 00 00</b></div>
        <div class="f"><span data-t="zh.f3"></span><b data-t="zh.f3v"></b></div>
      </div>
      <div class="w">
        <div class="wh">${MARK}<span>Rozmovio</span></div>
        <div class="wb">
          <div class="bb in" style="font-size:11.5px;padding:8px 11px;border-radius:10px;
            background:var(--panel);border:1px solid var(--line);align-self:flex-start;max-width:80%"
            data-t="zh.m1"></div>
          <div class="bb out" style="font-size:11.5px;padding:8px 11px;border-radius:10px;
            background:var(--accent);color:var(--on-accent);align-self:flex-end;max-width:80%"
            data-t="zh.m2"></div>
        </div>
      </div>
    </div>
  </div>
</section>

<section class="sec tint" id="price">
  <div class="wrap">
    <div class="shd rise" style="margin-left:auto;margin-right:auto;text-align:center">
      <h2 class="h2" data-t="pr.h"></h2>
      <p class="lead" data-t="pr.lead"></p>
    </div>
    <div class="price rise">
      <div class="h3" data-t="pr.plan"></div>
      <div class="amt">50 $</div>
      <div class="per" data-t="pr.per"></div>
      <div class="alt" data-t="pr.alt"></div>
      <ul>
        <li data-t="pr.i1"></li>
        <li data-t="pr.i2"></li>
        <li data-t="pr.i3"></li>
        <li data-t="pr.i4"></li>
        <li data-t="pr.i5"></li>
      </ul>
      <button class="grad big" id="priceGo" type="button" data-t="pr.go"></button>
      <p class="note" data-t="pr.note"></p>
      <p class="note" data-t="pr.ent"></p>
    </div>
  </div>
</section>

<section class="sec" id="try">
  <div class="wrap">
    <div class="shd rise" style="margin-left:auto;margin-right:auto;text-align:center">
      <h2 class="h2" data-t="tr.h"></h2>
      <p class="lead" data-t="tr.lead"></p>
    </div>
    <form class="frm card pad5 rise" id="leadForm" autocomplete="on">
      <div class="fr">
        <div class="fld"><label class="fl" for="lName" data-t="tr.name"></label>
          <input id="lName" name="name" autocomplete="name"></div>
        <div class="fld"><label class="fl" for="lCompany" data-t="tr.company"></label>
          <input id="lCompany" name="company" autocomplete="organization"></div>
      </div>
      <div class="fr">
        <div class="fld"><label class="fl" for="lMail" data-t="tr.mail"></label>
          <input id="lMail" name="email" type="email" required autocomplete="email"></div>
        <div class="fld"><label class="fl" for="lPhone" data-t="tr.phone"></label>
          <input id="lPhone" name="phone" autocomplete="tel"></div>
      </div>
      <div class="fld">
        <label class="fl" data-t="tr.chan"></label>
        <div class="cbs" id="lChan">
          <label class="cb"><input type="checkbox" value="telegram"><span>Telegram</span></label>
          <label class="cb"><input type="checkbox" value="telegram_user"><span data-t="tr.tgph"></span></label>
          <label class="cb"><input type="checkbox" value="instagram"><span>Instagram</span></label>
          <label class="cb"><input type="checkbox" value="messenger"><span>Messenger</span></label>
          <label class="cb"><input type="checkbox" value="zoho"><span>Zoho CRM</span></label>
        </div>
      </div>
      <div class="fld"><label class="fl" for="lNote" data-t="tr.note"></label>
        <textarea id="lNote" name="note"></textarea></div>
      <button class="grad big" id="leadGo" type="submit" data-t="tr.go"></button>
      <p class="note" data-t="tr.small"></p>
      <p class="err" id="leadErr" style="display:none"></p>
    </form>
    <div class="done card pad5 rise" id="leadDone" style="display:none;max-width:620px;margin:0 auto">
      <div class="tick">✓</div>
      <div class="h3" data-t="tr.okh"></div>
      <p class="lead" style="margin-top:var(--s2)" data-t="tr.okp"></p>
    </div>
  </div>
</section>

<footer>
  <div class="wrap in">
    <a class="brand" href="/" style="font-size:15px">${MARK}Rozmovio</a>
    <div class="grow"></div>
    <a href="/privacy" data-t="f.privacy"></a>
    <a href="/terms" data-t="f.terms"></a>
    <a href="/refunds" data-t="f.refunds"></a>
    <a href="/data-deletion" data-t="f.deletion"></a>
    <a href="mailto:support@rozmovio.com">support@rozmovio.com</a>
    <span data-t="f.legal"></span>
  </div>
</footer>

<div class="toast" id="toast" role="status" aria-live="polite"></div>

<script>
(function(){
'use strict';

/* ── Тексты ───────────────────────────────────────────────────────
   Оба языка рядом, ключ к ключу: так сразу видно пропущенный перевод,
   и правка формулировки делается в одном месте, а не в двух файлах. */
var T = {
  uk: {
    'nav.channels':'Канали','nav.how':'Як працює','nav.zoho':'CRM','nav.price':'Ціна',
    'nav.signin':'Увійти','nav.try':'Спробувати',
    'hero.badge':'Спільна скринька: у браузері та у вашій CRM',
    'hero.h1a':'Усі переписки з клієнтами —','hero.h1b':'в одному вікні',
    'hero.lead':'Telegram, Instagram Direct, Messenger, WhatsApp і чат на сайті приходять в одну скриньку. Вона працює у браузері сама по собі, а за потреби вбудовується у Zoho CRM, Pipedrive чи Бітрікс24 — і тоді листування стоїть поруч з карткою клієнта.',
    'hero.mail':'Ваша робоча пошта','hero.go':'Спробувати 14 днів',
    'hero.note':'Без картки. Перший канал підключається за 10 хвилин.',
    'strip.tg':'Telegram-бот','strip.ph':'Telegram за номером',
    'strip.ig':'Instagram Direct','strip.ms':'Messenger','strip.wc':'Чат на сайті',
    'shot.m1':'Добрий день! Ще є в наявності?','shot.m2':'Так, є. Відкладу на вас до вечора',
    'shot.m3':'Дякую, буду за годину',
    'ch.h':'Канали, які вже працюють','ch.lead':'Кожен канал підключається у налаштуваннях: чат на сайті — рядком коду, бот — токеном, номер — входом по QR, Instagram і Messenger — входом через Facebook.',
    'ch.wc.t':'Чат на сайті','ch.wc.s':'Один рядок коду — і кнопка чату на ваших сторінках. Переписка одразу в скриньці.',
    'ch.tgbot.t':'Telegram-бот','ch.tgbot.s':'Клієнти пишуть боту компанії. Фото, файли, голосові, реакції.',
    'ch.tgph.t':'Telegram за номером','ch.tgph.s':'Ваш особистий номер як канал: вхід по QR, переписки приходять у скриньку.',
    'ch.ig.t':'Instagram Direct','ch.ig.s':'Повідомлення бізнес-акаунту, відповіді з імені акаунта, історії та реакції.',
    'ch.ms.t':'Facebook Messenger','ch.ms.s':'Повідомлення сторінці. Відповідь оператора доходить і через добу.',
    'ch.wa.t':'WhatsApp Business','ch.wa.s':'Номер компанії через Cloud API. Поза вікном 24 годин — погоджені шаблони.',
    'ch.vb.t':'Viber для бізнесу','ch.vb.s':'Клієнти пишуть на назву компанії. Підключення через офіційного партнера.',
    'ch.vbn.t':'Viber номерний','ch.vbn.s':'У роботі.',
    'ready':'працює','soon':'скоро','beta':'закритий тест',
    'ch.beta':'Instagram, Messenger і WhatsApp Business зараз у закритому тесті: застосунок проходить перевірку Meta, і до її завершення підключити ці канали можуть лише запрошені акаунти. Напишіть нам — додамо вас у тестувальники. Решта каналів працює без обмежень.',
    'how.h':'Три кроки до першого повідомлення','how.lead':'Нічого встановлювати не треба: сервіс працює у браузері та всередині Zoho CRM.',
    'how.s1t':'Реєстрація','how.s1p':'Вводите робочу пошту й код із листа. Пароль вигадувати не потрібно.',
    'how.s2t':'Підключення каналів','how.s2p':'Токен бота, вхід по QR для номера, вхід через Facebook для Instagram і Messenger.',
    'how.s3t':'Робота у CRM','how.s3p':'Віджет стає у картку клієнта Zoho. Команда відповідає звідти, історія зберігається.',
    'ft.h':'Що всередині',
    'ft.f1t':'Одна скринька на команду','ft.f1p':'Діалоги, відповідальні, відкриті й закриті, непрочитане, пошук за іменем і номером.',
    'ft.f2t':'Шаблони відповідей','ft.f2p':'Швидкі відповіді з підстановкою імені — без переписування одного й того ж двадцять разів на день.',
    'ft.f3t':'Сценарії та автовідповіді','ft.f3p':'Привітання, відповідь поза графіком, передача оператору. Налаштовується для кожного каналу.',
    'ft.f4t':'Вкладення','ft.f4p':'Фото, документи, голосові й відео в обидва боки. Файли зберігаються разом з діалогом.',
    'ft.f5t':'Дані у Європі','ft.f5p':'Токени каналів зашифровані окремим ключем на кожного клієнта. Дані компаній розділені на рівні бази.',
    'ft.f6t':'Темна тема й дві мови','ft.f6p':'Українська й англійська, світла й темна — переключається у будь-який момент.',
    'zh.badge':'Вбудовується у CRM',
    'zh.h':'Переписка поруч з карткою клієнта','zh.lead':'Rozmovio стає віджетом усередині CRM — Zoho, Pipedrive або Бітрікс24. Менеджер бачить листування там, де й так працює: у картці угоди чи контакту.',
    'zh.l1':'Вхідне повідомлення знаходить контакт за номером або створює новий лід.',
    'zh.l2':'Відповідь з віджета йде у той самий канал, з якого написав клієнт.',
    'zh.l3':'Історія листування залишається у картці, навіть якщо менеджер змінився.',
    'zh.l4':'У Zoho вхід у віджет — за користувачем CRM: окремих паролів немає.',
    'zh.crm':'Zoho CRM · Контакт','zh.f1':'Ім’я','zh.f2':'Телефон','zh.f3':'Джерело','zh.f3v':'Instagram Direct',
    'zh.m1':'Доброго дня, чи є доставка?','zh.m2':'Так, відправляємо Новою поштою',
    'pr.h':'Ціна','pr.lead':'Один тариф, без прихованих доплат за канал чи за оператора.',
    'pr.plan':'Компанія','pr.per':'за місяць при оплаті за рік',
    'pr.alt':'або 60 $ на місяць при щомісячній оплаті — за рік виходить на два місяці дешевше',
    'pr.i1':'Усі доступні канали','pr.i2':'10 операторів у команді, далі 5 $ за місце',
    'pr.i3':'Віджет у Zoho CRM і замовлення просто з переписки',
    'pr.i4':'Штучний інтелект, шаблони, сценарії','pr.i5':'Підтримка українською',
    'pr.go':'Почати 14 днів безкоштовно','pr.note':'Оплата карткою або рахунком. Скасувати можна будь-коли — доступ триває до кінця оплаченого періоду.',
    'pr.ent':'Велика команда — корпоративний тариф: ціна за кожного користувача, рахунок і договір. Напишіть нам.',
    'tr.h':'Заявка на тестування','tr.lead':'Залиште пошту — надішлю доступ і допоможу підключити перший канал.',
    'tr.name':'Ім’я','tr.company':'Компанія','tr.mail':'Робоча пошта','tr.phone':'Телефон або Telegram',
    'tr.chan':'Які канали цікавлять','tr.tgph':'Telegram за номером','tr.note':'Коротко про задачу',
    'tr.go':'Надіслати заявку','tr.small':'Напишу протягом робочого дня. Пошту не передаю нікому.',
    'tr.okh':'Заявку отримано','tr.okp':'Дякую! Напишу вам на вказану пошту протягом робочого дня.',
    'f.privacy':'Конфіденційність','f.terms':'Умови','f.refunds':'Повернення коштів','f.deletion':'Видалення даних','f.legal':'KL Systems, ФОП Сластін Костянтин Віталійович · Україна',
    'e.mail':'Вкажіть коректну пошту','e.net':'Не вдалося надіслати. Спробуйте ще раз або напишіть на support@rozmovio.com',
    'e.rate':'Заявку з цієї пошти вже отримано. Я відповім найближчим часом.',
    'th.auto':'Тема як у системі','th.light':'Світла тема','th.dark':'Темна тема'
  },
  en: {
    'nav.channels':'Channels','nav.how':'How it works','nav.zoho':'CRM','nav.price':'Pricing',
    'nav.signin':'Sign in','nav.try':'Try it',
    'hero.badge':'Shared inbox: in your browser and in your CRM',
    'hero.h1a':'Every customer conversation —','hero.h1b':'in one window',
    'hero.lead':'Telegram, Instagram Direct, Messenger, WhatsApp and the chat on your website arrive in a single inbox. It works in the browser on its own, and embeds into Zoho CRM, Pipedrive or Bitrix24 when you want the thread next to the customer record.',
    'hero.mail':'Your work email','hero.go':'Start 14-day trial',
    'hero.note':'No card required. First channel connects in 10 minutes.',
    'strip.tg':'Telegram bot','strip.ph':'Telegram by number',
    'strip.ig':'Instagram Direct','strip.ms':'Messenger','strip.wc':'Website chat',
    'shot.m1':'Hi! Is it still in stock?','shot.m2':'Yes, it is. I will hold it for you till tonight',
    'shot.m3':'Thanks, I will be there in an hour',
    'ch.h':'Channels that already work','ch.lead':'Each channel is connected in settings: website chat by a line of code, a bot by token, a phone number by QR sign-in, Instagram and Messenger by Facebook login.',
    'ch.wc.t':'Website chat','ch.wc.s':'One line of code puts a chat button on your pages. Messages land in the same inbox.',
    'ch.tgbot.t':'Telegram bot','ch.tgbot.s':'Customers write to your company bot. Photos, files, voice notes, reactions.',
    'ch.tgph.t':'Telegram by number','ch.tgph.s':'Your personal number as a channel: QR sign-in, chats land in the inbox.',
    'ch.ig.t':'Instagram Direct','ch.ig.s':'Messages to the business account, replies as the account, story replies and reactions.',
    'ch.ms.t':'Facebook Messenger','ch.ms.s':'Messages to the Page. An agent reply is delivered even after 24 hours.',
    'ch.wa.t':'WhatsApp Business','ch.wa.s':'Your company number via Cloud API. Outside the 24-hour window — approved templates.',
    'ch.vb.t':'Viber for Business','ch.vb.s':'Customers write to your company name. Connected through an official partner.',
    'ch.vbn.t':'Viber by number','ch.vbn.s':'In progress.',
    'ready':'live','soon':'soon','beta':'closed beta',
    'ch.beta':'Instagram, Messenger and WhatsApp Business are in closed beta: the app is under review by Meta, and until that is done only invited accounts can connect these channels. Write to us and we will add you as a tester. Every other channel works without limits.',
    'how.h':'Three steps to the first message','how.lead':'Nothing to install: it runs in the browser and inside Zoho CRM.',
    'how.s1t':'Sign up','how.s1p':'Enter your work email and the code from the letter. No password to invent.',
    'how.s2t':'Connect channels','how.s2p':'Bot token, QR sign-in for a phone number, Facebook login for Instagram and Messenger.',
    'how.s3t':'Work inside the CRM','how.s3p':'The widget appears on the Zoho record. Your team replies from there and the history stays.',
    'ft.h':'What is inside',
    'ft.f1t':'One inbox for the team','ft.f1p':'Conversations, assignees, open and closed, unread counts, search by name and number.',
    'ft.f2t':'Reply templates','ft.f2p':'Quick replies with the name filled in — instead of retyping the same answer twenty times a day.',
    'ft.f3t':'Scenarios and auto-replies','ft.f3p':'Greeting, out-of-hours reply, hand-off to an agent. Configured per channel.',
    'ft.f4t':'Attachments','ft.f4p':'Photos, documents, voice notes and video both ways. Files are kept with the conversation.',
    'ft.f5t':'Data in the EU','ft.f5p':'Channel tokens are encrypted with a separate key per customer. Companies are separated at the database level.',
    'ft.f6t':'Dark theme, two languages','ft.f6p':'Ukrainian and English, light and dark — switched at any moment.',
    'zh.badge':'Embedded in the CRM',
    'zh.h':'The thread next to the customer record','zh.lead':'Rozmovio becomes a widget inside your CRM — Zoho, Pipedrive or Bitrix24. The manager sees the conversation where they already work: on the deal or contact record.',
    'zh.l1':'An incoming message finds the contact by phone number or creates a new lead.',
    'zh.l2':'A reply from the widget goes back to the channel the customer wrote from.',
    'zh.l3':'The history stays on the record even when the manager changes.',
    'zh.l4':'In Zoho, access follows the CRM user: no separate passwords.',
    'zh.crm':'Zoho CRM · Contact','zh.f1':'Name','zh.f2':'Phone','zh.f3':'Source','zh.f3v':'Instagram Direct',
    'zh.m1':'Hello, do you deliver?','zh.m2':'Yes, we ship the same day',
    'pr.h':'Pricing','pr.lead':'One plan, no hidden charges per channel or per seat.',
    'pr.plan':'Company','pr.per':'per month, billed yearly',
    'pr.alt':'or 60 $ per month billed monthly — a year costs two months less',
    'pr.i1':'All available channels','pr.i2':'10 agents included, 5 $ per extra seat',
    'pr.i3':'Widget in Zoho CRM and orders straight from the chat',
    'pr.i4':'AI replies, templates, scenarios','pr.i5':'Support in English and Ukrainian',
    'pr.go':'Start 14 days free','pr.note':'Pay by card or by invoice. Cancel at any time — access lasts until the end of the period already paid for.',
    'pr.ent':'Large team — enterprise plan: a price per user, invoice and contract. Write to us.',
    'tr.h':'Request a trial','tr.lead':'Leave your email — I will send access and help connect the first channel.',
    'tr.name':'Name','tr.company':'Company','tr.mail':'Work email','tr.phone':'Phone or Telegram',
    'tr.chan':'Channels you need','tr.tgph':'Telegram by number','tr.note':'A line about your case',
    'tr.go':'Send request','tr.small':'I reply within a business day. Your email goes nowhere else.',
    'tr.okh':'Request received','tr.okp':'Thank you! I will write to the email you left within a business day.',
    'f.privacy':'Privacy','f.terms':'Terms','f.refunds':'Refunds','f.deletion':'Data deletion','f.legal':'KL Systems, FOP Kostiantyn Slastin · Ukraine',
    'e.mail':'Enter a valid email','e.net':'Could not send. Try again or write to support@rozmovio.com',
    'e.rate':'A request from this email is already in. I will get back to you shortly.',
    'th.auto':'System theme','th.light':'Light theme','th.dark':'Dark theme'
  }
};

function langGet(){
  try { var s = localStorage.getItem('rz.lang'); if (s && T[s]) return s } catch(e){}
  var n = (navigator.language || 'en').toLowerCase();
  // Русскоязычному посетителю украинский ближе английского: интерфейс
  // всё равно украинский, и показывать ему английский было бы странно.
  return (n.indexOf('uk') === 0 || n.indexOf('ru') === 0) ? 'uk' : 'en';
}
function langSet(v){
  try { localStorage.setItem('rz.lang', v) } catch(e){}
  paintLang(v);
}
function t(key){ var d = T[langGet()] || T.uk; return d[key] || T.uk[key] || key }

function paintLang(v){
  var d = T[v] || T.uk;
  document.documentElement.setAttribute('lang', v === 'uk' ? 'uk' : 'en');
  var nodes = document.querySelectorAll('[data-t]');
  for (var i = 0; i < nodes.length; i++){
    var k = nodes[i].getAttribute('data-t');
    if (d[k] !== undefined) nodes[i].textContent = d[k];
  }
  var ph = document.querySelectorAll('[data-tp]');
  for (var j = 0; j < ph.length; j++){
    var pk = ph[j].getAttribute('data-tp');
    if (d[pk] !== undefined) ph[j].setAttribute('placeholder', d[pk]);
  }
  var btns = document.querySelectorAll('[data-lang-btn]');
  for (var b = 0; b < btns.length; b++){
    btns[b].classList.toggle('on', btns[b].getAttribute('data-lang-btn') === v);
  }
}

/* ── Тема ─────────────────────────────────────────────────────────
   Кнопка на три положения: как в системе, светлая, тёмная. Функции
   themeGet/themeCycle приходят из общего блока в head — он выполняется
   до отрисовки, чтобы страница не мигала светлой темой. */
var SUN = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
var MOON = '<svg viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
var AUTO = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none"/></svg>';

function paintThemeBtn(){
  var b = document.getElementById('themeBtn');
  var v = themeGet();
  b.innerHTML = v === 'light' ? SUN : v === 'dark' ? MOON : AUTO;
  b.title = v === 'auto' ? t('th.auto') : v === 'light' ? t('th.light') : t('th.dark');
}

/* ── Мелочи ───────────────────────────────────────────────────── */
function el(id){ return document.getElementById(id) }
var toastTimer = null;
function toast(text){
  var n = el('toast');
  n.textContent = text;
  n.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ n.classList.remove('on') }, 4200);
}
function okMail(v){
  v = (v || '').trim();
  var at = v.indexOf('@');
  var dot = v.lastIndexOf('.');
  return at > 0 && dot > at + 1 && dot < v.length - 2 && v.indexOf(' ') < 0;
}
function goForm(mail){
  if (mail) el('lMail').value = mail;
  var y = el('try').getBoundingClientRect().top + window.pageYOffset - 70;
  window.scrollTo({ top: y, behavior: 'smooth' });
  setTimeout(function(){ el(mail ? 'lName' : 'lMail').focus() }, 420);
}

/* ── Появление при прокрутке ───────────────────────────────────── */
function watchRise(){
  var items = document.querySelectorAll('.rise');
  if (!('IntersectionObserver' in window)){
    for (var i = 0; i < items.length; i++) items[i].classList.add('seen');
    return;
  }
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if (e.isIntersecting){ e.target.classList.add('seen'); io.unobserve(e.target) }
    });
  }, { rootMargin: '0px 0px -12% 0px' });
  for (var j = 0; j < items.length; j++) io.observe(items[j]);
}

/* ── Заявка ───────────────────────────────────────────────────────
   Отправляется на сервер, а не в почтовый клиент: письмо из mailto
   теряется в половине случаев, а заявка должна дойти. */
function sendLead(ev){
  ev.preventDefault();
  var mail = el('lMail').value.trim();
  var err = el('leadErr');
  err.style.display = 'none';
  if (!okMail(mail)){ err.textContent = t('e.mail'); err.style.display = 'block'; el('lMail').focus(); return }

  var chan = [];
  var boxes = el('lChan').querySelectorAll('input[type=checkbox]');
  for (var i = 0; i < boxes.length; i++) if (boxes[i].checked) chan.push(boxes[i].value);

  var btn = el('leadGo');
  btn.classList.add('busy');
  btn.disabled = true;

  fetch('/leads', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: el('lName').value.trim(),
      company: el('lCompany').value.trim(),
      email: mail,
      phone: el('lPhone').value.trim(),
      channels: chan.join(','),
      note: el('lNote').value.trim(),
      locale: langGet()
    })
  }).then(function(r){
    if (r.status === 429) { throw new Error('rate') }
    if (!r.ok) { throw new Error('http') }
    el('leadForm').style.display = 'none';
    var done = el('leadDone');
    done.style.display = 'block';
    done.classList.add('seen');
    done.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }).catch(function(e){
    btn.classList.remove('busy');
    btn.disabled = false;
    err.textContent = String(e.message) === 'rate' ? t('e.rate') : t('e.net');
    err.style.display = 'block';
  });
}

/* ── Связывание ─────────────────────────────────────────────────── */
paintLang(langGet());
paintThemeBtn();
watchRise();

var langBtns = document.querySelectorAll('[data-lang-btn]');
for (var i = 0; i < langBtns.length; i++){
  langBtns[i].onclick = function(){ langSet(this.getAttribute('data-lang-btn')) };
}
el('themeBtn').onclick = function(){ themeCycle(); paintThemeBtn() };
el('signin').onclick = function(){ location.href = '/app' };
el('top-try').onclick = function(){ goForm('') };
el('priceGo').onclick = function(){ goForm('') };
el('heroGo').onclick = function(){
  var v = el('heroMail').value.trim();
  if (v && !okMail(v)){ toast(t('e.mail')); el('heroMail').focus(); return }
  goForm(v);
};
el('heroMail').onkeydown = function(e){ if (e.key === 'Enter') el('heroGo').click() };

// Отметка выбранного канала: подсветка всей плашки, а не одной
// галочки — по маленькому квадратику непонятно, что выбрано.
var cbs = document.querySelectorAll('.cb input');
for (var c = 0; c < cbs.length; c++){
  cbs[c].onchange = function(){ this.parentNode.classList.toggle('on', this.checked) };
}

el('leadForm').addEventListener('submit', sendLead);
})();
</script>
</body>
</html>`;

export interface LandingDeps {
  pool: Pool;
  mailer: Mailer;
  /** Кому уходит письмо о новой заявке. */
  notifyTo: string;
  /** Ключ сайта нашего собственного чата: пусто — виджета на странице нет. */
  webchatKey?: string;
  log: (level: 'info' | 'warn', msg: string, extra?: Record<string, unknown>) => void;
  /** Куда ещё сообщить о заявке: группа в Telegram, пуш, почта команды. */
  onLead?: (lead: {
    id: string;
    name?: string | null;
    company?: string | null;
    email: string;
    phone?: string | null;
    note?: string | null;
  }) => void;
}

interface LeadBody {
  name?: string;
  company?: string;
  email?: string;
  phone?: string;
  channels?: string;
  note?: string;
  locale?: string;
}

/** Обрезка до разумной длины: поле формы не должно становиться каналом загрузки данных. */
function clip(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().slice(0, max);
  return s.length ? s : null;
}

function validEmail(v: string): boolean {
  const at = v.indexOf('@');
  const dot = v.lastIndexOf('.');
  return at > 0 && dot > at + 1 && dot < v.length - 2 && !v.includes(' ') && v.length <= 254;
}

/**
 * Наш собственный чат на нашей же промо-странице.
 *
 * Тот же виджет, который мы предлагаем клиентам, и подключён он ровно
 * так же — одной строкой с ключом сайта. Смысл двойной: человеку с
 * вопросом не нужно искать почту, а мы первыми видим, если в виджете
 * что-то сломалось.
 *
 * Ключ приходит из окружения, а не лежит в коде: он привязан к
 * конкретному каналу конкретного арендатора, и его замена не должна
 * требовать правки исходников. Ключ публичный — он и так виден в
 * исходном коде страницы, — но проверяется на вид: случайная опечатка
 * в переменной не должна превращаться в кусок разметки.
 */
export function widgetTag(siteKey: string): string {
  const key = (siteKey ?? '').trim();
  if (!key || !/^wc[a-z0-9]{6,60}$/.test(key)) return '';
  return `<script src="/chat.js" data-key="${key}" async></script>`;
}

/**
 * Готовая промо-страница: разметка плюс наш чат.
 *
 * Собирать её нужно ровно здесь и только так. Страница отдаётся из двух
 * мест — по /promo и по корню на домене сайта, — и первая же попытка
 * приписать виджет к одному из них закончилась тем, что на самом
 * rozmovio.com чата не оказалось: корень отдавал исходную разметку в
 * обход вставки. Поэтому сырой LANDING_HTML остаётся материалом для
 * тестов, а наружу обе точки отдают результат этой функции.
 */
export function landingPage(webchatKey: string): string {
  const tag = widgetTag(webchatKey);
  return tag ? LANDING_HTML.replace('</body>', tag + NL + '</body>') : LANDING_HTML;
}

export function registerLanding(app: FastifyInstance, opts: LandingDeps): void {
  const page = landingPage(opts.webchatKey ?? '');

  const send = async (_req: unknown, reply: FastifyReply) =>
    reply
      .type('text/html; charset=utf-8')
      // Кэш на пять минут: страница публичная и одинаковая для всех,
      // но после правки текста не хочется ждать час.
      .header('cache-control', 'public, max-age=300')
      .send(page);

  app.get('/promo', send);

  /**
   * Заявка с промо-страницы.
   *
   * Публичный обработчик без авторизации, поэтому три ограничения:
   * длина полей, одна заявка с адреса в час и никакого вывода
   * присланного текста в ответ. Ответ всегда одинаковый — по нему
   * нельзя узнать, есть ли уже такой адрес в базе.
   */
  app.post<{ Body: LeadBody }>('/leads', async (req, reply) => {
    const body = req.body ?? {};
    const email = (clip(body.email, 254) ?? '').toLowerCase();
    if (!validEmail(email)) return reply.code(400).send({ error: 'bad_email' });

    const lead = {
      name: clip(body.name, 120),
      company: clip(body.company, 160),
      email,
      phone: clip(body.phone, 60),
      channels: clip(body.channels, 200),
      note: clip(body.note, 2000),
      locale: clip(body.locale, 8),
    };

    const fresh = await withSystem(opts.pool, 'заявка с промо-страницы', async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `SELECT id FROM leads
          WHERE lower(email) = $1 AND created_at > now() - interval '1 hour'
          LIMIT 1`,
        [email],
      );
      if (rows.length) return null;

      const ip = (req.headers['x-forwarded-for'] ?? '').toString().split(',')[0]?.trim() || null;
      const inserted = await db.query<{ id: string }>(
        `INSERT INTO leads (name, email, phone, company, channels, note, locale, ip)
         VALUES ($1,$2,$3,$4,$5,$6,$7, nullif($8,'')::inet)
         RETURNING id`,
        [lead.name, lead.email, lead.phone, lead.company, lead.channels, lead.note, lead.locale, ip],
      );
      return inserted.rows[0]?.id ?? null;
    });

    if (!fresh) {
      opts.log('info', 'Повторная заявка с того же адреса в пределах часа');
      return reply.code(429).send({ error: 'too_soon' });
    }

    opts.log('info', 'Новая заявка с промо-страницы', { id: fresh, channels: lead.channels });

    // Письмо отправляем после записи и не роняем ответ, если почта
    // недоступна: заявка уже в базе, а человек не должен видеть ошибку
    // из-за чужого сбоя.
    const lines = [
      'Новая заявка с промо-страницы Rozmovio',
      '',
      'Имя: ' + (lead.name ?? '—'),
      'Компания: ' + (lead.company ?? '—'),
      'Почта: ' + lead.email,
      'Телефон: ' + (lead.phone ?? '—'),
      'Каналы: ' + (lead.channels ?? '—'),
      'Язык страницы: ' + (lead.locale ?? '—'),
      '',
      'Сообщение:',
      lead.note ?? '—',
    ].join(NL);

    opts.mailer
      .send({
        to: opts.notifyTo,
        subject: 'Rozmovio: заявка от ' + lead.email,
        text: lines,
        html: '<pre style="font:14px/1.6 ui-monospace,Menlo,monospace">' +
          lines.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</pre>',
      })
      .catch((err: unknown) =>
        opts.log('warn', 'Письмо о заявке не ушло', { error: String(err) }),
      );

    opts.onLead?.({
      id: fresh,
      name: lead.name ?? null,
      company: lead.company ?? null,
      email: lead.email,
      phone: lead.phone ?? null,
      note: lead.note ?? null,
    });

    return reply.code(201).send({ ok: true });
  });
}
