/**
 * Рабочее место оператора.
 *
 * Раскладка повторяет то, к чему люди привыкли в SendPulse и подобных
 * сервисах, и это осознанно: оператор не должен переучиваться, переходя
 * на новый инструмент. Слева узкая панель разделов, затем список диалогов
 * с фильтрами, посередине переписка, справа карточка клиента.
 *
 * Страница по-прежнему без сборщика и в одном файле. Плата за это —
 * одно правило, которое нельзя нарушать: ВНУТРИ ЭТОЙ СТРОКИ НЕЛЬЗЯ
 * ИСПОЛЬЗОВАТЬ ОБРАТНЫЕ СЛЭШИ. Она проходит через обработку escape-
 * последовательностей TypeScript, и написанное как "перевод строки"
 * превратится в настоящий перенос посреди строкового литерала.
 * Компилятор этого не заметит: для него тут просто текст. Поэтому
 * вместо перевода строки используется константа NL, а вместо
 * регулярных выражений — строковые проверки. За соблюдением следит
 * scripts/check-ui.mjs, который разбирает уже собранный результат.
 *
 * Токен живёт в sessionStorage, а не в cookie: виджет будет работать
 * внутри iframe Zoho, а сторонние cookie там режет Safari.
 */

/**
 * Метка сборки. Нужна ровно для одного вопроса, который возникает
 * каждый раз: «браузер показывает старое — это кэш или контейнер?».
 * Видна в исходнике страницы и в логе запуска api.
 */
import { BRAND_CSS, EMOJI_CSS, EMOJI_JS, THEME_JS } from './theme.js';
import { I18N_JS } from './i18n.js';

export const UI_BUILD = '2026-09-22-5';

export const INBOX_HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="omnidesk-build" content="${UI_BUILD}">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0E1530">
<!-- Значок и режим приложения на телефоне. На iOS раздел «Поделиться →
     На экран Домой» после этого открывает инбокс без адресной строки. -->
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<!-- default, а не black-translucent: при translucent приложение
     занимает и полосу статуса, и логотип уезжает под «остров». -->
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Rozmovio">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" sizes="180x180" href="/icon-180.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400;14..32,500;14..32,600;14..32,700&display=swap" rel="stylesheet">
<title>Rozmovio</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<script data-theme-boot>${THEME_JS}${EMOJI_JS}${I18N_JS}</script>
<style>
  /* ═══ Оформление ═══
     Токены, теги и готовые блоки живут в theme.ts — одном месте на весь
     продукт: и рабочее место, и промо-страница берут их оттуда. Здесь
     ниже — только то, что есть исключительно в рабочем месте: раскладка
     из четырёх колонок, список диалогов, переписка, панель разделов. */
  ${BRAND_CSS}
  .qrwrap{display:flex;gap:20px;align-items:center;flex-wrap:wrap;margin:14px 0 4px;
    padding:16px;border:1px solid var(--line);border-radius:12px;background:var(--bg)}
  /* Именно .qrwrap .qr, а не просто .qr: тот же класс носит строка в
     списке шаблонов, и без этой оговорки каждый шаблон превращался в
     белый квадрат 220×220 — на телефоне из-за этого в панели помещался
     ровно один шаблон, а между ними зияла пустота. */
  .qrwrap .qr{width:220px;height:220px;background:#fff;border-radius:10px;padding:8px;flex:none}
  .qrwrap .qr svg{width:100%;height:100%;display:block}
  .steps{margin:0;padding-left:18px;line-height:1.9;font-size:13px}

  /* ─── Вход ─────────────────────────────────────────────────────── */
  #gate{display:flex;align-items:center;justify-content:center;height:100vh;padding:20px}
  #gate .box{background:var(--panel);border:1px solid var(--line);border-radius:10px;
    padding:26px;max-width:400px;width:100%}
  #gate .mark{width:32px;height:32px;border-radius:7px;background:var(--accent);
    color:var(--on-accent);display:flex;align-items:center;justify-content:center;
    font-weight:700;font-size:12px;letter-spacing:-.03em;margin-bottom:16px}
  #gate h1{margin:0 0 5px;font-size:18px;letter-spacing:-.02em;font-weight:700}
  #gate p{margin:0 0 16px;color:var(--t2);font-size:12.5px;line-height:1.55}
  #gate code{background:var(--panel2);padding:2px 5px;border-radius:4px;font-size:11.5px;
    font-family:ui-monospace,Menlo,monospace;display:block;margin-top:8px;word-break:break-all}
  #gate .alt{margin-top:14px;font-size:12px;color:var(--t3);text-align:center}
  #gate .alt a{color:var(--link);cursor:pointer;text-decoration:none;font-weight:600}
  #code{letter-spacing:.32em;font-size:19px;text-align:center;
    font-family:ui-monospace,Menlo,monospace}

  /* ─── Каркас ───────────────────────────────────────────────────── */
  /* 100vh на iOS — это высота БЕЗ адресной строки: поле ответа
     уезжает под неё, и человек видит переписку, но не видит, куда
     писать. dvh считает видимую часть, а при открытой клавиатуре
     высоту доставляет visualViewport (см. fitHeight). */
  #app{display:none;grid-template-columns:66px 316px minmax(0,1fr) 284px;height:100vh;height:100dvh}
  #app.no-card{grid-template-columns:66px 316px minmax(0,1fr)}
  #app[data-view="bots"]{grid-template-columns:66px minmax(0,1fr)}
  #app[data-view="bots"] #list,#app[data-view="bots"] #thread,
  #app[data-view="bots"] #card{display:none}
  #app[data-view="chats"] #bots{display:none}
  #app.no-card #card{display:none}
  @media(max-width:1180px){#app{grid-template-columns:66px 306px minmax(0,1fr)}
    #app #card{display:none}}
  @media(max-width:820px){
    /* 62, а не 56: «Сповіщення» иначе переносится одной буквой. */
    #app{grid-template-columns:62px minmax(0,1fr)}
    #app.thread-open #list{display:none}
    #app:not(.thread-open) #thread{display:none}}

  /* ─── Панель разделов ──────────────────────────────────────────── */
  #rail{background:var(--rail);border-right:1px solid var(--glass-line);display:flex;
    -webkit-backdrop-filter:var(--blur);backdrop-filter:var(--blur);
    flex-direction:column;align-items:center;padding:12px 0;gap:2px}
  #rail .logo{width:30px;height:30px;display:flex;align-items:center;justify-content:center;
    margin-bottom:14px}
  #rail .logo svg{width:28px;height:28px;display:block}
  .rbtn{background:transparent;border:0;color:var(--railT);width:54px;padding:9px 0;
    border-radius:var(--r2);
    border-radius:6px;font-size:10px;font-weight:600;display:flex;flex-direction:column;
    align-items:center;gap:5px;cursor:pointer;line-height:1.2;position:relative}
  .rbtn svg{width:19px;height:19px;stroke:currentColor;fill:none;stroke-width:1.6;
    stroke-linecap:round;stroke-linejoin:round}
  .rbtn{box-shadow:none;transition:background-color .13s ease,color .13s ease,transform .06s ease}
  .rbtn:hover{color:var(--t1);background:var(--hover)}
  .rbtn:active{transform:scale(.94)}
  .rbtn.on{color:var(--railOn);background:var(--railOnBg);
    box-shadow:var(--sheen-soft),0 6px 16px -10px rgba(11,16,34,.4)}
  .rbtn.live{color:var(--good)}
  .rbtn .cnt{position:absolute;top:3px;right:6px;min-width:16px;height:16px;border-radius:8px;
    background:var(--crit);color:#fff;font-size:9.5px;font-weight:700;display:flex;
    align-items:center;justify-content:center;padding:0 4px;font-variant-numeric:tabular-nums}
  #rail .grow{flex:1}

  /* Кнопка «назад» нужна только там, где список и переписка
     не помещаются рядом. На широком экране она лишняя. */
  .thead .back{display:none;flex:none}
  @media(max-width:820px){.thead .back{display:inline-flex}}

  #toast{position:fixed;left:50%;bottom:22px;transform:translate(-50%,12px);opacity:0;
    pointer-events:none;background:var(--accent);color:var(--on-accent);padding:10px 14px;
    border-radius:8px;font-size:12.5px;font-weight:600;max-width:min(520px,calc(100% - 32px));
    box-shadow:0 10px 30px rgba(0,0,0,.2);z-index:95;transition:opacity .18s ease,transform .18s ease}
  #toast.on{opacity:1;transform:translate(-50%,0)}

  /* ─── Список диалогов ──────────────────────────────────────────── */
  #list{background:var(--panel);border-right:1px solid var(--line);
    display:flex;flex-direction:column;min-height:0}
  .lhead{padding:12px 14px 0;flex:none;border-bottom:1px solid var(--line)}
  .lhead .top{display:flex;justify-content:space-between;align-items:center;gap:8px}
  .lhead b{font-size:14.5px;letter-spacing:-.015em;font-weight:700}
  .filters{display:flex;gap:6px;margin-top:10px}
  .filters select{padding:6px 8px;font-size:12px;border-radius:6px;background:var(--panel)}
  .search{margin-top:8px}
  .search input{padding:7px 10px;font-size:12.5px;border-radius:6px}
  .lhead .tabs{margin-top:11px}
  #convs{overflow-y:auto;flex:1;min-height:0}
  .conv{padding:10px 14px;border-bottom:1px solid var(--line);cursor:pointer;
    display:flex;gap:10px;transition:background-color .1s ease}
  .conv:active{background:var(--panel2)}
  .conv:hover{background:var(--hover)}
  .conv.on{background:var(--hover);box-shadow:inset 2px 0 0 var(--accent)}
  .conv .body{min-width:0;flex:1}
  .conv .r1{display:flex;justify-content:space-between;gap:8px;align-items:baseline}
  .conv .nm{font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;
    white-space:nowrap}
  .conv.unread .nm{font-weight:700}
  .conv .tm{font-size:10.5px;color:var(--t3);white-space:nowrap;font-variant-numeric:tabular-nums}
  .conv .pv{font-size:12px;color:var(--t3);overflow:hidden;text-overflow:ellipsis;
    white-space:nowrap;margin-top:2px}
  .conv .r3{display:flex;gap:5px;align-items:center;margin-top:6px;flex-wrap:wrap}
  .chip.who{background:var(--panel2);color:var(--t2)}
  .conv .badge{margin-left:auto}
  .dot{width:7px;height:7px;border-radius:50%;flex:none}
  .dot.open{background:var(--crit)}
  .dot.closed{background:var(--t3)}

  /* ─── Переписка ────────────────────────────────────────────────── */
  #thread{display:flex;flex-direction:column;min-height:0;min-width:0}
  .thead{padding:10px 14px;border-bottom:1px solid var(--line);display:flex;
    justify-content:space-between;align-items:center;gap:12px;flex:none;background:var(--panel)}
  .thead .who{display:flex;gap:10px;align-items:center;min-width:0}
  .thead .nm{font-weight:700;font-size:14px;letter-spacing:-.015em;overflow:hidden;
    text-overflow:ellipsis;white-space:nowrap}
  .thead .sub{font-size:11px;color:var(--t3);margin-top:1px;overflow:hidden;
    text-overflow:ellipsis;white-space:nowrap}
  .thead .acts{display:flex;gap:6px;flex:none}
  #msgs{flex:1;overflow-y:auto;padding:18px 16px;display:flex;flex-direction:column;
    gap:7px;min-height:0}
  .mwrap{display:flex;flex-direction:column;max-width:min(540px,76%);
    animation:rise .16s ease-out}
  @keyframes rise{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
  @media(prefers-reduced-motion:reduce){.mwrap{animation:none}}
  .mwrap.out{align-self:flex-end;align-items:flex-end}
  .mwrap.in{align-self:flex-start;align-items:flex-start}
  .m{max-width:100%;padding:8px 12px;border-radius:9px;font-size:13px;line-height:1.5;
    word-wrap:break-word;white-space:pre-wrap}
  .m.in{background:var(--panel);border:1px solid var(--line);border-bottom-left-radius:3px}
  .m.out{background:var(--accent);color:var(--on-accent);border-bottom-right-radius:3px}
  .m.bot{background:#4a3f8f;color:#fff}
  .m.failed{background:var(--crit);color:#fff}
  .m .meta{font-size:10px;opacity:.7;margin-top:3px;display:flex;gap:5px;align-items:center;
    font-variant-numeric:tabular-nums}
  .quote{border-left:2px solid currentColor;padding:2px 0 2px 8px;margin:0 0 5px;
    font-size:11.5px;opacity:.72;line-height:1.35;max-height:42px;overflow:hidden}
  .quote b{display:block;font-size:10.5px;opacity:.9}
  .rx{display:flex;gap:3px;margin-top:3px;flex-wrap:wrap}
  .rx .r{background:var(--panel);border:1px solid var(--line);border-radius:10px;
    padding:0 6px;font-size:12.5px;line-height:1.6}
  .rx .r.mine{background:var(--panel2);border-color:var(--line2)}
  .mtools{display:flex;gap:3px;margin-top:2px;opacity:0;transition:opacity .12s}
  .mwrap:hover .mtools{opacity:1}
  .mtools button{background:transparent;border:1px solid var(--line);color:var(--t3);
    border-radius:5px;padding:1px 7px;font-size:11px;font-weight:600}
  .mtools button{box-shadow:none;transition:opacity .12s ease,color .12s ease,background-color .12s ease}
  .mtools button:hover{color:var(--t1);background:var(--hover);border-color:var(--t3)}
  .picker{position:absolute;background:var(--panel);border:1px solid var(--line2);
    border-radius:9px;padding:5px;display:flex;gap:1px;z-index:60;
    box-shadow:0 10px 30px rgba(0,0,0,.18)}
  .picker button{background:transparent;border:0;font-size:18px;padding:3px 5px;
    border-radius:6px;line-height:1;color:inherit}
  .picker button{box-shadow:none;transition:transform .08s ease,background-color .12s ease}
  .picker button:hover{background:var(--hover);transform:scale(1.18)}
  .picker button:active{transform:scale(.95)}
  .att{margin:-2px 0 6px;display:block}
  .att img{max-width:100%;max-height:320px;border-radius:6px;display:block;cursor:zoom-in}
  .att video{max-width:100%;max-height:320px;border-radius:6px;display:block}
  .att audio{width:250px;max-width:100%;display:block}
  .att .file{display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:6px;
    background:rgba(127,127,127,.14);text-decoration:none;color:inherit;font-size:12.5px}
  .att .file .ic{font-size:16px;line-height:1}
  .att .file .nm{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .att .wait{font-size:11.5px;opacity:.7;font-style:italic;padding:6px 0}
  .lightbox{position:fixed;inset:0;background:rgba(0,0,0,.88);display:flex;align-items:center;
    justify-content:center;z-index:99;cursor:zoom-out;padding:24px}
  .lightbox img{max-width:100%;max-height:100%;border-radius:4px}
  .composer{border-top:1px solid var(--line);padding:11px 14px;background:var(--panel);flex:none}
  .composer .row{display:flex;gap:8px;align-items:flex-end}
  .composer textarea{min-height:36px;max-height:150px;border-radius:7px}
  .blocked{background:var(--warn-bg);border:1px solid var(--line);border-radius:7px;
    padding:10px 12px;font-size:12.5px;color:var(--t2);line-height:1.5}
  .icob{width:34px;height:34px;padding:0;display:flex;align-items:center;justify-content:center;
    flex:none;background:var(--panel);border:1px solid var(--line2);border-radius:6px}
  .icob svg{width:16px;height:16px;stroke:var(--t2);fill:none;stroke-width:1.7;
    stroke-linecap:round;stroke-linejoin:round}
  .icob{box-shadow:none;transition:background-color .13s ease,border-color .13s ease,transform .06s ease}
  .icob:hover{background:var(--hover);border-color:var(--t3)}
  .icob:active{transform:translateY(1px)}
  .icob:hover svg{stroke:var(--t1)}
  /* Панель смайлов — общее оформление с виджетом. */
  ${EMOJI_CSS}

  /* Файл, приложенный к шаблону. */
  .fchips{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}
  .fchip{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;padding:3px 8px;
    border-radius:var(--rf);background:var(--panel2);color:var(--t2);max-width:100%}
  .fchip a{color:var(--link);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .fchip .x{cursor:pointer;color:var(--t3);font-weight:700}
  .fchip .x:hover{color:var(--crit)}

  /* ─── Сценарии ─────────────────────────────────────────────────
     Цепочка рисуется вертикально и соединяется линией: порядок шагов
     здесь — главное, что должно читаться с первого взгляда. */
  .sc.off{opacity:.62}
  .sc-h{display:flex;gap:12px;align-items:flex-start;justify-content:space-between}
  .sc-h .s{font-size:12px;color:var(--t3);margin-top:3px}
  .sc-steps{display:flex;gap:5px;flex-wrap:wrap;margin:12px 0}
  .sc-f{display:flex;gap:12px;align-items:center;justify-content:space-between;
    padding-top:10px;border-top:1px solid var(--line);font-size:11.5px;flex-wrap:wrap}

  .chain{display:flex;flex-direction:column}
  .st-link{width:2px;height:14px;background:var(--line2);margin-left:22px;flex:none}
  .step{border:1px solid var(--line);border-radius:var(--r2);background:var(--bg);overflow:hidden}
  .st-h{display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--panel2);
    border-bottom:1px solid var(--line);font-size:12.5px}
  .st-h .n{width:20px;height:20px;border-radius:50%;background:var(--accent-soft);
    color:var(--accent);font-size:11px;font-weight:700;display:flex;align-items:center;
    justify-content:center;flex:none}
  .st-h .ic{font-size:14px;line-height:1}
  .st-h button{padding:2px 7px;font-size:12px;line-height:1.2}
  .st-b{padding:10px}
  .st-b .row2{display:flex;gap:8px}
  .addrow{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px;padding-top:12px;
    border-top:1px dashed var(--line2)}

  .tplbox{border:1px solid var(--line);border-radius:7px;margin-bottom:8px;
    max-height:180px;overflow-y:auto;background:var(--panel)}
  .tplbox .qr{padding:8px 11px;cursor:pointer;border-bottom:1px solid var(--line);font-size:12.5px}
  .tplbox .qr:last-child{border-bottom:0}
  .tplbox .qr:hover{background:var(--hover)}
  .tplbox .qr b{color:var(--link);font-family:ui-monospace,Menlo,monospace;font-size:11.5px}
  .tplbox .qr .x{color:var(--t3);display:block;margin-top:2px;overflow:hidden;
    text-overflow:ellipsis;white-space:nowrap}
  .replybar,.fileprev{display:flex;justify-content:space-between;align-items:center;gap:10px;
    background:var(--panel2);border-radius:7px;padding:7px 10px;margin-bottom:8px;font-size:12px}
  .replybar .t,.fileprev .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
    color:var(--t2)}
  .replybar .c,.fileprev .c{cursor:pointer;color:var(--t3);font-size:15px;line-height:1}

  /* ─── Карточка клиента ─────────────────────────────────────────── */
  #card{border-left:1px solid var(--line);background:var(--panel);overflow-y:auto;padding:13px 14px}
  #card h4{margin:16px 0 8px;font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;
    color:var(--t3);font-weight:700}
  #card h4:first-child{margin-top:0}
  #card .fld{margin-bottom:7px}
  #card .fld label{font-size:10.5px;color:var(--t3);display:block;margin-bottom:3px}
  #card input{padding:6px 9px;font-size:12.5px;border-radius:6px}
  .tags{display:flex;gap:5px;flex-wrap:wrap}
  .tag{background:var(--panel2);color:var(--t2);border-radius:4px;padding:2px 7px;
    font-size:11px;font-weight:600;display:flex;gap:5px;align-items:center}
  .tag .x{cursor:pointer;opacity:.55;font-weight:400}
  .tag .x:hover{opacity:1}
  .note{border-left:2px solid var(--accent);padding:5px 0 5px 9px;margin-bottom:8px;font-size:12px}
  .note .who{font-size:10.5px;color:var(--t3);margin-top:2px}
  .kv2{font-size:12px;display:grid;grid-template-columns:auto 1fr;gap:4px 10px}
  .kv2 .k{color:var(--t3)}

  /* ─── Чат-боты ─────────────────────────────────────────────────── */
  #bots{overflow-y:auto;padding:20px 22px;min-width:0}
  #bots h2{margin:0 0 4px;font-size:17px;letter-spacing:-.02em;font-weight:700}
  #bots .lead{color:var(--t2);font-size:12.5px;margin:0 0 14px;max-width:640px;line-height:1.6}
  .card{border:1px solid var(--line);border-radius:9px;padding:14px 16px;margin-bottom:11px;
    background:var(--panel);max-width:820px}
  .card h3{margin:0 0 10px;font-size:12.5px;letter-spacing:-.01em;font-weight:700}
  .row2{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .row2>input,.row2>select,.row2>textarea{flex:1;min-width:150px}
  /* Подпись слева от поля: в узкой колонке настроек она переносится
     вниз вместе с полем, потому и фиксированная ширина, а не таблица. */
  .lbl{font-size:11.5px;color:var(--t3);width:104px;flex:none;align-self:center}
  .item{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;
    padding:10px 0;border-bottom:1px solid var(--line)}
  .item:last-child{border-bottom:0;padding-bottom:0}
  .item .t{font-weight:600;font-size:13px;display:flex;gap:7px;align-items:center;flex-wrap:wrap}
  .item .s{font-size:11.5px;color:var(--t3);margin-top:3px;line-height:1.5}
  .pill{font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;
    background:var(--good-bg);color:var(--good)}
  .pill.warn{background:var(--warn-bg);color:var(--warn)}
  .pill.crit{background:var(--crit-bg);color:var(--crit)}
  .pill.soon{background:var(--panel2);color:var(--t3)}
  .hint{font-size:11.5px;color:var(--t3);line-height:1.55;margin-top:8px}

  /* ─── Настройки ────────────────────────────────────────────────── */
  #settings{display:none;position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:80;
    align-items:center;justify-content:center;padding:24px}
  #settings.on{display:flex}
  #settings .sheet{background:var(--bg);border:1px solid var(--line);border-radius:10px;
    width:min(860px,100%);max-height:100%;display:flex;flex-direction:column;overflow:hidden}
  .shead{padding:12px 16px;border-bottom:1px solid var(--line);display:flex;
    justify-content:space-between;align-items:center;background:var(--panel);flex:none;
    font-weight:700}
  .stabs{display:flex;gap:16px;padding:0 16px;border-bottom:1px solid var(--line);
    background:var(--panel);flex-wrap:wrap;flex:none}
  .stab{background:transparent;border:0;color:var(--t3);font-weight:600;padding:10px 0;
    font-size:12.5px;border-bottom:2px solid transparent;margin-bottom:-1px;border-radius:0}
  .stab{box-shadow:none;transition:color .13s ease,border-color .13s ease}
  .stab:hover{background:transparent;color:var(--t2);border-color:var(--line2)}
  .stab:active{transform:none}
  .stab.on{color:var(--t1);border-color:var(--accent)}
  .sbody{padding:16px;overflow-y:auto;min-height:240px;flex:1}
  /* Профиль: шапка, строки данных и числа. Не таблица и не карточки
     в ряд — обычное представление, в котором правится то, что можно
     править, и видно, что править нельзя. */
  /* Карточка интеграции. Одинаковая для всех CRM: разный размер
     читается как разная важность. */
  .int{margin-bottom:12px}
  .int-h{display:flex;align-items:center;gap:12px}
  .int-t{font-size:15px;font-weight:600;letter-spacing:-.015em}
  .int-s{font-size:12.5px;color:var(--t3);line-height:1.55}
  .int-b{margin-top:14px;padding-top:14px;border-top:1px solid var(--line)}
  .int-a{margin-top:14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
  .int-a .err,.int-a .ok{margin-top:0}
  .int-row{display:flex;align-items:center;gap:12px;padding:6px 0}
  .int-n{font-size:13.5px;font-weight:600}
  .int-rb{display:flex;gap:6px;margin-left:auto;flex:none}
  .chico.zoho{background:linear-gradient(140deg,#3b82f6,#1d4ed8)}
  .chico.bitrix{background:linear-gradient(140deg,#2fc7f7,#0b7fd4);font-size:11px}
  .chico.pipedrive{background:linear-gradient(140deg,#2b2b2b,#4d4d4d)}
  .aclbox{padding:2px 0 14px}
  .aclgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:6px}
  .aclrow{display:flex;align-items:center;gap:9px;padding:8px 11px;border-radius:var(--r1);
    background:var(--panel2);font-size:12.5px;cursor:pointer}
  .aclrow input{width:auto;flex:none;margin:0}
  .aclrow .dim{margin-left:auto;font-size:11px}
  .prof{display:flex;align-items:center;gap:14px;padding:16px 18px;margin-bottom:14px;
    background:var(--panel);border:1px solid var(--line);border-radius:var(--r2)}
  .prof-av{width:56px;height:56px;border-radius:50%;flex:none;display:flex;
    align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:20px;
    background-size:cover;background-position:center}
  .prof-nm{font-size:20px;font-weight:600;letter-spacing:-.02em}
  .prof-sub{font-size:12.5px;color:var(--t3);margin-top:2px}
  .prow{display:flex;align-items:flex-start;gap:14px;padding:11px 0;
    border-bottom:1px solid var(--line)}
  .prow:last-of-type{border-bottom:0}
  .prow .pk{width:150px;flex:none;color:var(--t3);font-size:12.5px;padding-top:2px}
  .prow .pv{flex:1;min-width:0;font-size:13.5px}
  .prow>button{flex:none}
  .nums{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}
  .numbox{background:var(--panel);border:1px solid var(--line);border-radius:var(--r2);
    padding:14px 16px}
  .numbox .n{font-size:24px;font-weight:700;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
  .numbox .l{font-size:12px;color:var(--t3);margin-top:2px}
  @media(max-width:620px){
    .prow{flex-wrap:wrap}
    .prow .pk{width:100%}
  }
  .kv{display:grid;grid-template-columns:170px 1fr;gap:7px 14px;font-size:12.5px}
  .kv .k{color:var(--t3)}
  .kv code{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;
    background:var(--panel2);padding:1px 5px;border-radius:4px}

  /* ═══ Оформление «Стекло» ═══════════════════════════════════════
     Второй слой поверх базовых правил: те же классы, но другая
     поверхность. Панели полупрозрачные и размывают фон, цвет живёт
     в знаке и в одном акценте, движение короткое и без отскоков.

     Почему слоем, а не правкой по месту: базовые правила описывают
     раскладку и поведение, этот блок — только вид. Так видно,
     что именно относится к оформлению, и его можно заменить целиком. */

  body{background:var(--bg);
    background-image:
      radial-gradient(60vw 48vh at 8% -8%, rgba(47,107,255,.16), transparent 60%),
      radial-gradient(52vw 44vh at 104% 8%, rgba(122,60,240,.14), transparent 62%),
      radial-gradient(44vw 40vh at 50% 118%, rgba(47,107,255,.09), transparent 64%);
    background-attachment:fixed;}

  .glass{background:var(--panel);backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur)}

  /* ─── Поля и кнопки ───────────────────────────────────────────── */
  textarea,input,select{background:var(--panel);border-color:var(--line2);border-radius:11px;
    padding:10px 12px;backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur);
    transition:border-color .16s ease,box-shadow .16s ease,background-color .16s ease}
  textarea:hover,input:hover,select:hover{border-color:var(--line2);background:var(--solid)}
  textarea:focus,input:focus,select:focus{border-color:var(--accent);background:var(--solid);
    box-shadow:0 0 0 4px var(--ring)}
  input::placeholder,textarea::placeholder{color:var(--t3)}

  button{border-radius:11px;padding:9px 15px;letter-spacing:-.01em;box-shadow:var(--shadow);
    transition:background-color .16s ease,border-color .16s ease,color .16s ease,
      box-shadow .2s ease,transform .08s cubic-bezier(.2,.8,.3,1),opacity .16s ease}
  button:hover{box-shadow:var(--lift)}
  button:active{transform:translateY(1px) scale(.99)}
  button.ghost{background:var(--panel);border-color:var(--line2);
    backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur)}
  button.ghost:hover{background:var(--solid);border-color:var(--line2);color:var(--t1)}
  .mini{border-radius:9px;padding:6px 11px}

  /* ─── Вход ─────────────────────────────────────────────────────── */
  #gate{padding:24px}
  #gate .box{width:100%;max-width:418px;padding:30px 30px 26px;border-radius:24px;
    background:var(--panel);border:1px solid var(--line);
    backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur);
    box-shadow:var(--lift);animation:gateIn .5s cubic-bezier(.2,.8,.3,1) both}
  @keyframes gateIn{from{opacity:0;transform:translateY(14px) scale(.985)}to{opacity:1;transform:none}}
  #gate .mark{width:46px;height:46px;border-radius:0;background:none;margin:0 0 18px;
    display:block;box-shadow:none}
  #gate .mark svg{width:46px;height:46px;display:block}
  #gate h1{font-size:27px;font-weight:600;letter-spacing:-.03em;margin:0 0 6px}
  #gate p{font-size:13.5px;color:var(--t2);margin:0 0 18px;line-height:1.55}
  #gate input{height:46px;font-size:14px;border-radius:13px}
  #gate button{width:100%;height:46px;font-size:14px;border-radius:13px}
  #gate .row2{display:flex;gap:8px}
  #gate .alt{margin-top:16px;font-size:12.5px}
  #gate .foot{margin-top:22px;padding-top:16px;border-top:1px solid var(--line);
    font-size:11.5px;color:var(--t3);line-height:1.6;text-align:center}
  #gate .step{animation:stepIn .32s cubic-bezier(.2,.8,.3,1) both}
  @keyframes stepIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
  #code{letter-spacing:.34em;font-size:22px;font-weight:700;height:56px;text-align:center}

  /* ─── Каркас ───────────────────────────────────────────────────── */
  #app{gap:0;padding:0}
  #rail{background:var(--rail);border-right:1px solid var(--line);
    backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur);padding:14px 0 12px}
  #rail .logo{width:34px;height:34px;margin-bottom:18px}
  #rail .logo svg{width:32px;height:32px}
  .rbtn{border-radius:12px;width:54px;padding:9px 0;font-size:9.5px;letter-spacing:.01em;
    transition:background-color .16s ease,color .16s ease,transform .1s cubic-bezier(.2,.8,.3,1)}
  .rbtn:hover{background:var(--hover)}
  .rbtn.on{background:var(--railOnBg);color:var(--accent)}
  .rbtn.on svg{stroke:var(--accent)}
  .rbtn .cnt{background:var(--crit);box-shadow:0 0 0 2px var(--bg)}

  #list{background:var(--panel);border-right:1px solid var(--line);
    backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur)}
  .lhead{padding:16px 16px 0;border-bottom:1px solid var(--line)}
  .lhead b{font-size:18px;font-weight:600;letter-spacing:-.024em}
  .filters select,.search input{border-radius:10px;font-size:12.5px}
  .tabs{gap:6px;margin:12px 0 0}
  .tab{border-radius:10px 10px 0 0;padding:8px 10px;border-bottom:2px solid transparent}
  .tab.on{color:var(--accent);border-color:var(--accent);background:var(--accent-soft)}
  .tab .n{background:none}

  .conv{padding:12px 14px;border-bottom:1px solid var(--line);
    transition:background-color .16s ease,box-shadow .16s ease}
  .conv:hover{background:var(--hover)}
  .conv.on{background:var(--accent-soft);box-shadow:inset 3px 0 0 var(--accent)}
  .av{width:38px;height:38px;border-radius:13px;font-weight:700;
    background:linear-gradient(140deg,var(--brand1),var(--brand2));color:#fff;
    border:0;font-size:13px;letter-spacing:-.02em}
  .av img{border-radius:13px}
  .conv .nm{font-size:13.5px}
  .chip{border-radius:7px;padding:2px 7px;background:var(--panel2);color:var(--t2)}

  /* ─── Переписка ────────────────────────────────────────────────── */
  #thread{background:transparent}
  .thead{background:var(--panel);border-bottom:1px solid var(--line);padding:12px 16px;
    backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur)}
  .thead .nm{font-size:15px;font-weight:600;letter-spacing:-.018em}
  #msgs{padding:22px 18px;gap:9px}
  .m{border-radius:18px;padding:10px 14px;font-size:13.5px;line-height:1.52;
    box-shadow:var(--shadow)}
  .m.in{background:var(--panel);border:1px solid var(--line);border-bottom-left-radius:7px;
    backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur)}
  .m.out{background:linear-gradient(135deg,var(--brand1),var(--brand2));color:#fff;
    border:0;border-bottom-right-radius:7px}
  .m.bot{background:linear-gradient(135deg,#5b4bd6,#7a3cf0);color:#fff}
  .m.failed{background:var(--crit);color:#fff}
  .mwrap{animation:rise .24s cubic-bezier(.2,.8,.3,1)}
  @keyframes rise{from{opacity:0;transform:translateY(8px) scale(.985)}to{opacity:1;transform:none}}
  .rx .r{border-radius:12px;background:var(--panel);border:1px solid var(--line)}
  .mtools button{border-radius:9px}
  .picker{border-radius:14px;box-shadow:var(--lift);background:var(--panel);
    backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur)}
  .att img,.att video{border-radius:14px}
  .att .file{border-radius:12px}

  .composer{background:var(--panel);border-top:1px solid var(--line);padding:12px 16px;
    backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur)}
  .composer textarea{border-radius:14px;min-height:42px;padding:11px 13px}
  .icob{width:38px;height:38px;border-radius:12px;background:var(--panel);border-color:var(--line2)}
  .icob:hover{background:var(--solid)}
  .blocked{border-radius:12px;background:var(--warn-bg);border-color:var(--line)}
  .replybar,.fileprev,.tplbox{border-radius:12px}

  /* ─── Карточка клиента и настройки ─────────────────────────────── */
  #card{background:var(--panel);border-left:1px solid var(--line);padding:16px;
    backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur)}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:18px;
    box-shadow:var(--shadow);backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur)}
  .modal{border-radius:22px;box-shadow:var(--lift);background:var(--panel);
    backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur)}
  .stab{border-radius:10px 10px 0 0;padding:10px 12px}
  .stab.on{color:var(--accent);border-color:var(--accent);background:var(--accent-soft)}
  .item{border-radius:12px}
  #toast{border-radius:14px;box-shadow:var(--lift);backdrop-filter:var(--blur);
    -webkit-backdrop-filter:var(--blur)}
  .qrwrap{border-radius:18px;background:var(--panel);border-color:var(--line)}
  .pill,.badge{border-radius:999px}

  @media(prefers-reduced-motion:reduce){
    #gate .box,#gate .step,.mwrap{animation:none}
  }

  /* ─── Разделы ──────────────────────────────────────────────────── */
  /* Каналы, сценарии, шаблоны и команда — полноценные страницы,
     а не вкладки в окне поверх чатов: в них живёт настройка продукта,
     и работать в модальном окне с этим неудобно. */
  #page{display:none;overflow-y:auto;min-width:0}
  #app:not([data-view="chats"]) #list,
  #app:not([data-view="chats"]) #thread,
  #app:not([data-view="chats"]) #card{display:none}
  #app:not([data-view="chats"]){grid-template-columns:66px minmax(0,1fr)}
  #app:not([data-view="chats"]) #page{display:block}
  /* Колонка уже прежней: строка длиной во весь экран читается плохо,
     а на широком мониторе содержимое расползалось по краям. */
  .pg{max-width:900px;margin:0 auto;padding:38px 28px 70px}
  .pg-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;
    margin-bottom:22px;flex-wrap:wrap}
  .pg-head h2{margin:0;font-size:30px;font-weight:600;letter-spacing:-.028em;line-height:1.15;
    font-family:var(--font-display,var(--font))}
  /* Строка описания короче колонки: длинная строка читается хуже, а
     обрывок в две с половиной строки выглядел неряшливо. */
  .pg-head p{margin:8px 0 0;color:var(--t2);font-size:13.5px;max-width:52ch;line-height:1.6}
  .pg-sec{margin-top:30px}
  /* Подпись раздела, а не ещё один заголовок: капслок мелким кеглем
     отделяет разделы, не перебивая название страницы. */
  .pg-sec h3{margin:0 0 12px;font-size:11px;text-transform:uppercase;letter-spacing:.07em;
    color:var(--t3);font-weight:600}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:14px}
  .tile{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:16px;
    backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur);box-shadow:var(--shadow);
    display:flex;flex-direction:column;gap:10px;
    transition:box-shadow .2s ease,transform .12s cubic-bezier(.2,.8,.3,1),border-color .2s ease}
  .tile.click{cursor:pointer}
  .tile.click:hover{box-shadow:var(--lift);transform:translateY(-2px);border-color:var(--line2)}
  .tile .t1{display:flex;gap:11px;align-items:center;min-width:0}
  .tile .ttl{font-weight:600;font-size:14.5px;letter-spacing:-.015em;overflow:hidden;
    text-overflow:ellipsis;white-space:nowrap}
  .tile .sub{color:var(--t3);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .tile .acts{display:flex;gap:7px;margin-top:auto;padding-top:4px;flex-wrap:wrap}
  .tile .stat{display:flex;gap:18px;font-size:12px;color:var(--t2)}
  .tile .stat b{display:block;font-size:19px;font-weight:700;color:var(--t1);
    font-variant-numeric:tabular-nums;font-family:var(--font-display,var(--font))}
  .chico{width:38px;height:38px;border-radius:12px;flex:none;display:flex;align-items:center;
    justify-content:center;color:#fff;font-weight:700;font-size:12px}
  .chico.telegram_bot,.chico.telegram_user{background:linear-gradient(140deg,#37aee2,#1e96c8)}
  .chico.instagram{background:linear-gradient(140deg,#f9a03f,#d92e7f 55%,#8a3ab9)}
  .chico.messenger{background:linear-gradient(140deg,#00b2ff,#006aff)}
  .chico.whatsapp{background:linear-gradient(140deg,#5bd066,#1faa53)}
  .chico.viber_business{background:linear-gradient(140deg,#8f5db7,#665cac)}
  .chico.webchat{background:linear-gradient(140deg,#2F6BFF,#7A3CF0);font-size:9px}
  .snip{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:10px 12px;
    font:12px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap;word-break:break-all;margin:10px 0 0}
  .ntevs{display:flex;flex-wrap:wrap;gap:6px 14px;margin:2px 0 4px}
  .ntev{display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--t2);cursor:pointer}
  .ntev input{width:auto;margin:0}
  .chico.soon{background:var(--panel2);color:var(--t3)}
  .pill{font-size:11px;font-weight:600;padding:3px 9px;border-radius:999px;
    background:var(--panel2);color:var(--t2);white-space:nowrap}
  .pill.ok{background:var(--good-bg);color:var(--good)}
  .pill.warn{background:var(--warn-bg);color:var(--warn)}
  .pill.crit{background:var(--crit-bg);color:var(--crit)}
  .back-link{background:transparent;border:0;color:var(--t3);font-weight:600;font-size:12.5px;
    padding:0;box-shadow:none;margin-bottom:10px}
  .back-link:hover{background:transparent;color:var(--t1);box-shadow:none}
  @media(max-width:760px){
    #app:not([data-view="chats"]){grid-template-columns:66px minmax(0,1fr)}
    .pg{padding:20px 16px 50px}
  }

  /* ─── Телефон ───────────────────────────────────────────────────
     Не «адаптив ради адаптива»: на 390 точках ширины поле ответа в
     одной строке с четырьмя кнопками сжимается до сотни пикселей —
     человек не видит, что печатает. Поэтому на телефоне поле стоит
     отдельной строкой во всю ширину, а кнопки уходят под него.

     Шапка переписки там же переносится: имя клиента и кнопки не
     помещаются в одну строку, и до этого имя просто пропадало —
     сжималось до нуля, потому что кнопки не сжимаются. */
  @media(max-width:820px){
    /* Страница на телефоне не прокручивается: прокручиваются ленты
       внутри неё. Без этого Safari, показывая поле ввода, уводит весь
       документ вверх — и поле уезжает под клавиатуру вместе с ним. */
    html,body{height:100%;overflow:hidden;overscroll-behavior:none}
    /* Строка сетки обязана считаться от высоты окна, а не от
       содержимого: иначе переписка «выталкивает» поле ответа за
       нижний край, и высота, выставленная под клавиатуру, ничего не
       меняет — поле просто оказывается за пределами экрана. */
    #app{position:fixed;top:0;left:0;width:100%;
      grid-template-rows:minmax(0,1fr);overflow:hidden;
      /* Безопасные зоны телефона: сверху полоса статуса и «остров»,
         снизу — черта жеста. В браузере они нулевые, в приложении на
         домашнем экране — нет, и без этого отступа логотип оказывался
         под «островом». */
      padding-top:env(safe-area-inset-top);box-sizing:border-box}
    #rail{padding-bottom:calc(12px + env(safe-area-inset-bottom))}
    #convs,#page,#bots{padding-bottom:env(safe-area-inset-bottom)}
    /* Вход — исключение: с открытой клавиатурой форма выше экрана,
       и закреплённая страница спрятала бы поле ввода кода. */
    #gate{height:100dvh;overflow-y:auto;align-items:flex-start;padding-top:8vh}

    /* «Сповіщення» и «Notifications» в 56 точек одной строкой не
       влезают: переносим слово, а не обрезаем его. */
    .rbtn{width:60px;font-size:9px;padding:8px 2px;white-space:normal;
      overflow-wrap:anywhere;line-height:1.1}
    .thead{flex-wrap:wrap;row-gap:8px;padding:10px 12px}
    .thead .back{order:1;flex:none}
    /* Действия сжимаются и прокручиваются вбок, а не переносятся:
       перенос забирал третью строку у переписки. */
    .thead .acts{order:2;flex:1 1 0;min-width:0;justify-content:flex-start;
      overflow-x:auto;overflow-y:hidden;scrollbar-width:none}
    .thead .acts::-webkit-scrollbar{display:none}
    .thead .who{order:3;flex:1 1 100%;min-width:0}

    .composer{padding:9px 12px calc(9px + env(safe-area-inset-bottom))}
    .composer .row{flex-wrap:wrap;gap:6px}
    .composer .row textarea{order:-1;flex:1 1 100%;width:100%}
    .composer .row #send{margin-left:auto}
    /* 16 пикселей — не про вкус. При меньшем размере Safari на iOS
       увеличивает страницу при фокусе в поле, и вёрстка разъезжается
       уже необратимо: обратно он её не уменьшает. */
    .composer textarea,.composer input{font-size:16px}
    .composer textarea{min-height:46px;max-height:30vh}

    /* Список шаблонов занимал треть экрана и почти весь был пустым. */
    .tplbox{max-height:152px}
    .tplbox .qr{padding:7px 10px;font-size:13px}
    .tplbox .qr .x{margin-top:1px;font-size:12px}
    .emobox{max-height:34vh}

    /* 30 точек заголовка на телефоне съедают четверть экрана. */
    .pg{padding:18px 16px 60px}
    .pg-head{margin-bottom:16px}
    .pg-head h2{font-size:23px}
    .pg-head p{font-size:13px}
  }
</style>
</head>
<body>

<div id="gate">
  <div class="box">
    <div class="mark"><svg viewBox="0 0 100 100" aria-label="Rozmovio"><defs><linearGradient id="gmk" x1="10" y1="8" x2="92" y2="94" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#2F6BFF"/><stop offset="1" stop-color="#7A3CF0"/></linearGradient></defs><path fill-rule="evenodd" fill="url(#gmk)" d="M6 22A16 16 0 0 1 22 6H60A32 32 0 0 1 92 38A28 28 0 0 1 72 64.6L93 90.5A5 5 0 0 1 89 94H67.5A5 5 0 0 1 63.6 92.1L44 67L25.2 91.2A8 8 0 0 1 6 86ZM32 23H62A9 9 0 0 1 71 32V41A9 9 0 0 1 62 50H43L30.5 60.5A1.5 1.5 0 0 1 28 59.4V50.2A9 9 0 0 1 23 42V32A9 9 0 0 1 32 23Z"/></svg></div>

    <div id="stepEmail" class="step">
      <h1>Rozmovio</h1>
      <p data-t>Усе листування з клієнтами — в одному вікні. Введіть робочу пошту, і ми надішлемо код із шести цифр.</p>
      <input id="email" type="email" placeholder="you@company.com" autocomplete="email">
      <div class="err" id="gateErr"></div>
      <div style="margin-top:14px"><button id="ask" data-t>Отримати код</button></div>
      <div class="alt"><a id="toPass" data-t>Увійти паролем</a> · <a id="toSignup" data-t>Створити компанію</a>
        · <a id="toToken" data-t>Вхід за токеном</a></div>
    </div>

    <div id="stepPass" class="step" style="display:none">
      <h1 data-t>Вхід паролем</h1>
      <p data-t>Пароль задається в профілі. Не памʼятаєте — увійдіть кодом з пошти.</p>
      <input id="pEmail" type="email" placeholder="you@company.com" autocomplete="email">
      <input id="pPass" type="password" placeholder="пароль" data-tp autocomplete="current-password"
             style="margin-top:9px">
      <div class="err" id="pErr"></div>
      <div class="row2" style="margin-top:14px">
        <button id="pGo" data-t>Увійти</button>
        <button class="ghost" id="pBack" data-t>Кодом з пошти</button>
      </div>
    </div>

    <div id="stepSignup" class="step" style="display:none">
      <h1 data-t>Нова компанія</h1>
      <p data-t>Чотирнадцять днів безкоштовно. Пароль вигадувати не потрібно — вхід за кодом на пошту.</p>
      <input id="suCompany" placeholder="Назва компанії" data-tp autocomplete="organization">
      <input id="suEmail" type="email" placeholder="you@company.com" autocomplete="email"
             style="margin-top:9px">
      <div class="err" id="suErr"></div>
      <div class="row2" style="margin-top:14px">
        <button id="suGo" data-t>Створити</button>
        <button class="ghost" id="suBack" data-t>Назад</button>
      </div>
    </div>

    <div id="stepCode" class="step" style="display:none">
      <h1 data-t>Код надіслано</h1>
      <p><span data-t>Перевірте пошту</span> <b id="sentTo"></b><span data-t>. Код діє 10 хвилин.</span></p>
      <input id="code" inputmode="numeric" maxlength="6" placeholder="000000" autocomplete="one-time-code">
      <div class="err" id="codeErr"></div>
      <div class="row2" style="margin-top:14px">
        <button id="verify" data-t>Увійти</button>
        <button class="ghost" id="again" data-t>Інша пошта</button>
      </div>
    </div>

    <div id="stepWs" class="step" style="display:none">
      <h1 data-t>Куди входимо?</h1>
      <p data-t>Ця пошта заведена в кількох організаціях.</p>
      <div id="wsList"></div>
    </div>

    <div id="stepToken" class="step" style="display:none">
      <h1 data-t>Вхід за токеном</h1>
      <p>Токен видає команда на сервері:
        <code>docker compose exec api node apps/api/dist/seed.js --name "Компания" --email you@example.com</code>
      </p>
      <input id="tok" type="password" placeholder="eyJhbGciOi..." autocomplete="off">
      <div class="err" id="tokErr"></div>
      <div class="row2" style="margin-top:14px">
        <button id="enter" data-t>Увійти</button>
        <button class="ghost" id="toEmail" data-t>Назад до пошти</button>
      </div>
    </div>

    <div class="foot" data-t>Telegram, Instagram і Messenger в одному вікні — і в картці клієнта в Zoho CRM.</div>
  </div>
</div>

<div id="app" data-view="chats">
  <nav id="rail">
    <div class="logo" id="logo" title="До чатів" data-tt style="cursor:pointer"><svg viewBox="0 0 100 100" aria-label="Rozmovio"><defs><linearGradient id="rzg" x1="10" y1="8" x2="92" y2="94" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#2F6BFF"/><stop offset="1" stop-color="#7A3CF0"/></linearGradient></defs><path fill-rule="evenodd" fill="url(#rzg)" d="M6 22A16 16 0 0 1 22 6H60A32 32 0 0 1 92 38A28 28 0 0 1 72 64.6L93 90.5A5 5 0 0 1 89 94H67.5A5 5 0 0 1 63.6 92.1L44 67L25.2 91.2A8 8 0 0 1 6 86ZM32 23H62A9 9 0 0 1 71 32V41A9 9 0 0 1 62 50H43L30.5 60.5A1.5 1.5 0 0 1 28 59.4V50.2A9 9 0 0 1 23 42V32A9 9 0 0 1 32 23Z"/></svg></div>
    <button class="rbtn on" data-view="chats" data-icon="chat" data-t>Чати<span class="cnt" id="railCnt" style="display:none"></span></button>
    <button class="rbtn" data-view="channels" data-icon="plug" data-admin="1" data-t>Канали</button>
    <button class="rbtn" data-view="bots" data-icon="bot" data-admin="1" data-t>Сценарії</button>
    <button class="rbtn" data-view="replies" data-icon="bolt" data-t>Шаблони</button>
    <button class="rbtn" data-view="integrations" data-icon="link" data-admin="1" data-t>Інтеграції</button>
    <button class="rbtn" data-view="users" data-icon="team" data-admin="1" data-t>Команда</button>
    <button class="rbtn" data-view="notify" data-icon="bell" data-admin="1" data-t>Сповіщення</button>
    <div class="grow"></div>
    <button class="rbtn" id="themeTitle" data-icon="sun" data-t>Тема</button>
    <button class="rbtn" id="bell" data-icon="bell" data-t>Звук</button>
    <button class="rbtn" data-view="profile" data-icon="gear" data-t>Профіль</button>
    <button class="rbtn" id="out" data-icon="exit" data-t>Вийти</button>
  </nav>

  <div id="list">
    <div class="lhead">
      <div class="top"><b data-t>Чати</b><button class="ghost mini" id="cardBtn" data-t>Клієнт</button></div>
      <div class="filters">
        <select id="fCh"><option value="" data-t>Усі канали</option></select>
        <select id="fAs">
          <option value="all" data-t>Усі відповідальні</option>
          <option value="me" data-t>Мої</option>
          <option value="none" data-t>Без відповідального</option>
        </select>
      </div>
      <div class="search"><input id="fQ" placeholder="Пошук за імʼям або телефоном" data-tp autocomplete="off"></div>
      <div class="tabs">
        <button class="tab on" data-status="open" data-t>Відкриті<span class="n" id="nOpen"></span></button>
        <button class="tab" data-status="closed" data-t>Закриті<span class="n" id="nClosed"></span></button>
        <button class="tab" data-status="all" data-t>Усі</button>
      </div>
    </div>
    <div id="convs"></div>
  </div>

  <div id="thread">
    <div class="thead" id="thead"><div class="dim" data-t>Оберіть діалог зліва</div></div>
    <div id="msgs"></div>
    <div class="composer" id="composer" style="display:none"></div>
  </div>

  <aside id="card"><div class="empty" data-t>Картка клієнта зʼявиться, коли відкриєте діалог</div></aside>

  <main id="page"></main>
</div>

<div id="toast" role="status" aria-live="polite"></div>


<script>
(function(){
'use strict';

/**
 * Токен доступа.
 *
 * Лежит в localStorage, а не в cookie: страница работает внутри рамки
 * Zoho, а сторонние cookie там режет Safari. Раньше это был
 * sessionStorage — он живёт в пределах одной вкладки, и человек,
 * открывший вторую, попадал на форму входа, хотя только что вошёл.
 * Из sessionStorage тоже читаем: у тех, кто уже вошёл, сеанс не
 * оборвётся на этом обновлении.
 */
function tokenRead(){
  try {
    var v = localStorage.getItem('omnidesk_token');
    if (v) return v;
    // Перенос со старого хранения. Вкладка, открытая до этого
    // обновления, держит токен в sessionStorage — она одна про него и
    // знает. Переписываем в постоянное, чтобы соседние вкладки не
    // встречали форму входа у уже вошедшего человека.
    var old = sessionStorage.getItem('omnidesk_token');
    if (old) { localStorage.setItem('omnidesk_token', old); return old }
    return '';
  } catch(e){ return '' }
}
function tokenWrite(v){
  try {
    if (v) { localStorage.setItem('omnidesk_token', v); sessionStorage.setItem('omnidesk_token', v) }
    else { localStorage.removeItem('omnidesk_token'); sessionStorage.removeItem('omnidesk_token') }
  } catch(e){}
}

var TOKEN = tokenRead();

/** Перевод строки. В этом файле его нельзя написать escape-последовательностью. */
var NL = String.fromCharCode(10);
var current = null, convs = [], timer = null;
var QR = [], CHANNELS = [], USERS = [], ME = null, COUNTS = {};
// Подключён ли ИИ: от этого зависит, показывать ли кнопку черновика.
var AI = { ready:false };
// Роль вошедшего. До ответа сервера считаем оператором: показать
// лишнее и убрать — хуже, чем показать нужное чуть позже.
var ROLE = 'agent';
var F = { status:'open', assignee:'all', channelId:'', q:'' };
var S = { tab:'profile' };
var replyTo = null;   // сообщение, на которое отвечаем
var pendingFile = null; // выбранный, но ещё не отправленный файл
var el = function(id){ return document.getElementById(id) };

function api(path, opts){
  opts = opts || {};
  return fetch(path, {
    method: opts.method || 'GET',
    headers: Object.assign({ Authorization: 'Bearer ' + TOKEN },
      opts.body ? { 'content-type':'application/json' } : {}),
    body: opts.body ? JSON.stringify(opts.body) : undefined
  }).then(function(r){
    return r.json().catch(function(){ return {} }).then(function(j){
      if (!r.ok) throw Object.assign(new Error(j.error || r.status), { payload: j, status: r.status });
      return j;
    });
  });
}


/**
 * Кнопка в состоянии ожидания.
 *
 * Отдельная функция, а не пара строк на месте: раньше кнопки просто
 * блокировались, и при медленной сети между нажатием и результатом
 * не происходило ничего — люди жмут второй раз.
 */
function busy(node, on){
  if (!node) return;
  node.classList.toggle('busy', !!on);
  node.disabled = !!on;
}

function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(ch){
    return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch];
  });
}

/**
 * Локаль для дат. Берётся из выбранного языка: интерфейс по-польски с
 * датой «14 августа» выглядит как недоделка, и это она и есть.
 */
function locale(){
  return LANG === 'en' ? 'en-GB' : LANG === 'pl' ? 'pl-PL' : 'uk-UA';
}

function fmtTime(iso){
  if (!iso) return '';
  var d = new Date(iso), now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString(locale(),{hour:'2-digit',minute:'2-digit'})
    : d.toLocaleDateString(locale(),{day:'2-digit',month:'2-digit'});
}

function fmtDate(iso){
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(locale(),{day:'2-digit',month:'long',year:'numeric'});
}

var CH = { telegram_bot:'Telegram', telegram_business:'Telegram Business',
  telegram_user:L('Telegram номерний'), whatsapp_cloud:'WhatsApp', whatsapp:'WhatsApp',
  whatsapp_user:L('WhatsApp номерний'), instagram:'Instagram',
  messenger:'Messenger', viber_business:L('Viber для бізнесу'), webchat:L('Чат на сайті'),
  viber_user:L('Viber номерний') };

var ROLES = { owner:L('Власник'), admin:L('Адміністратор'), agent:L('Оператор'), viewer:L('Спостерігач') };

function statusLabel(s){
  return { pending:L('надсилається'), sent:L('надіслано'), delivered:L('доставлено'),
           read:L('прочитано'), failed:L('не доставлено') }[s] || s;
}

/** Окно ответа считаем на клиенте — лишний запрос ради этого не нужен. */
function windowState(c){
  if (!c || !c.window_expires_at || c.window_type === 'none') return { open:true };
  var left = new Date(c.window_expires_at) - new Date();
  if (left <= 0) return { open:false };
  var h = Math.floor(left/3600000), m = Math.floor(left%3600000/60000);
  return { open:true, left: h > 0 ? h + L(' год ') + m + L(' хв') : m + L(' хв') };
}

function initials(name){
  var s = String(name || '?').trim();
  if (!s) return '?';
  var parts = s.split(' ').filter(Boolean);
  return (parts.length > 1 ? parts[0].charAt(0) + parts[1].charAt(0) : s.slice(0,2)).toUpperCase();
}

/* Цвет аватара выводится из имени, а не назначается случайно: один
   и тот же клиент всегда одного цвета, и список читается взглядом. */
function avatarColor(seed){
  var s = String(seed || ''), sum = 0;
  for (var i = 0; i < s.length; i++) sum = (sum * 31 + s.charCodeAt(i)) % 360;
  return 'hsl(' + sum + ' 45% 42%)';
}

/* ══════════════ Список диалогов ══════════════ */

var lastList = null;

function query(){
  var p = ['status=' + encodeURIComponent(F.status), 'assignee=' + encodeURIComponent(F.assignee)];
  if (F.channelId) p.push('channelId=' + encodeURIComponent(F.channelId));
  if (F.q) p.push('q=' + encodeURIComponent(F.q));
  return '/conversations?' + p.join('&');
}

function renderList(){
  if (!convs.length){
    lastList = null;
    el('convs').innerHTML = '<div class="empty">' +
      (F.q ? L('Нічого не знайдено.') : L('Поки порожньо.<br>Напишіть своєму боту — діалог зʼявиться тут.')) +
      '</div>';
    return;
  }

  var html = convs.map(function(c){
    var unread = c.unread_count > 0;
    var who = c.assignee_name || c.assignee_email;
    return '<div class="conv' + (current === c.id ? ' on' : '') + (unread ? ' unread' : '') +
      '" data-id="' + c.id + '">' +
      '<div class="av" data-av="' + c.contact_id + '" style="background-color:' +
        avatarColor(c.display_name || c.id) + '">' + esc(initials(c.display_name)) + '</div>' +
      '<div class="body">' +
        '<div class="r1"><span class="nm">' + esc(c.display_name || L('Без імені')) + '</span>' +
        '<span class="tm">' + esc(fmtTime(c.last_message_at)) + '</span></div>' +
        '<div class="pv">' + esc(c.preview || '') + '</div>' +
        '<div class="r3">' +
          '<span class="dot ' + (c.status === 'resolved' ? 'closed' : 'open') + '"></span>' +
          '<span class="chip">' + esc(CH[c.channel_type] || c.channel_type) + '</span>' +
          (who ? '<span class="chip who">' + esc(who) + '</span>' : '') +
          (c.tags || []).map(function(t){ return '<span class="chip">' + esc(t) + '</span>' }).join('') +
          (unread ? '<span class="badge">' + c.unread_count + '</span>' : '') +
        '</div>' +
      '</div></div>';
  }).join('');

  // Перерисовываем только при реальном изменении: опрос идёт раз в три
  // секунды, и безусловная замена сбрасывала бы прокрутку под руками.
  if (html === lastList) return;
  lastList = html;

  el('convs').innerHTML = html;
  paintAvatars();
  Array.prototype.forEach.call(el('convs').children, function(node){
    if (!node.dataset.id) return;
    node.onclick = function(){ openConv(node.dataset.id) };
  });
}

function renderCounts(){
  el('nOpen').textContent = COUNTS.open ? ' ' + COUNTS.open : '';
  el('nClosed').textContent = COUNTS.closed ? ' ' + COUNTS.closed : '';
  var u = Number(COUNTS.unread || 0);
  el('railCnt').style.display = u > 0 ? 'block' : 'none';
  el('railCnt').textContent = u > 99 ? '99+' : u;
}

function currentConv(){
  return convs.filter(function(x){ return x.id === current })[0] || null;
}

/* ══════════════ Переписка ══════════════ */

var lastThread = null;

function openConv(id, fromHistory){
  current = id;
  lastThread = null;
  replyTo = null;
  pendingFile = null;
  el('app').classList.add('thread-open');
  // Открытый диалог — это шаг в истории браузера. Без него жест «назад»
  // на телефоне уводит с сайта целиком, хотя человек ждал возврата к
  // списку чатов.
  if (!fromHistory) {
    try { history.pushState({ conv:id }, '', location.pathname + location.search) } catch (e) {}
  }
  renderList();
  renderHead();
  loadThread();
  loadCard();
  // Открыли — значит прочитали. Счётчик гасим сразу, не дожидаясь опроса.
  api('/conversations/' + id, { method:'PATCH', body:{ read:true } })
    .then(refresh).catch(function(){});
}

function renderHead(){
  var c = currentConv();
  if (!c){ el('thead').innerHTML = L('<div class="dim">Виберіть діалог ліворуч</div>'); return }

  var w = windowState(c);
  var closed = c.status === 'resolved';
  var mine = ME && ME.user && c.assignee_id === ME.user.id;

  el('thead').innerHTML =
    L('<button class="ghost mini back" id="aBack" title="До списку чатів">← Чати</button>') +
    '<div class="who">' +
      '<div class="av" data-av="' + c.contact_id + '" style="background-color:' +
        avatarColor(c.display_name || c.id) + '">' + esc(initials(c.display_name)) + '</div>' +
      '<div style="min-width:0"><div class="nm">' + esc(c.display_name || L('Без імені')) + '</div>' +
      '<div class="sub">' + esc(CH[c.channel_type] || c.channel_type) +
        (w.open && w.left ? L(' · вікно відповіді ще ') + w.left : (w.open ? '' : L(' · вікно закрито'))) +
        ' · ' + esc(c.assignee_name || L('без відповідального')) +
      '</div></div>' +
    '</div>' +
    '<div class="acts">' +
      (mine ? '' : L('<button class="ghost mini" id="aTake">Взяти собі</button>')) +
      '<button class="ghost mini" id="aBot" title="' + esc(botState(c).why) + L('">Бот: ') +
        esc(botState(c).label) + '</button>' +
      '<button class="' + (closed ? '' : 'ghost ') + 'mini" id="aClose">' +
        (closed ? L('Відкрити заново') : L('Закрити чат')) + '</button>' +
    '</div>';

  if (el('aTake')) el('aTake').onclick = function(){
    if (ME && ME.user) patchConv({ assigneeId: ME.user.id });
  };
  paintAvatars();
  el('aBot').onclick = function(){ patchConv({ botEnabled: !c.bot_enabled }) };
  el('aClose').onclick = function(){
    var closing = !closed;
    patchConv({ status: closing ? 'resolved' : 'open' }).then(function(){
      // Закрытый чат исчезает из «Открытых» — это правильно, но без
      // подсказки выглядит как потеря переписки. Говорим, где он теперь.
      if (closing) toast(L('Чат закрито. Він у вкладці «Закриті» і повернеться у «Відкриті», як тільки клієнт напише.'));
    });
  };
  el('aBack').onclick = backToList;
}

/** Возврат к списку. На узком экране список и переписка не помещаются вместе. */
function backToList(){
  // Если диалог открывали мы и шаг в истории наш — уходим через историю:
  // тогда экранная кнопка и жест «назад» делают одно и то же, а лишние
  // шаги не копятся.
  if (history.state && history.state.conv) { history.back(); return }
  closeThread();
}

function closeThread(){
  el('app').classList.remove('thread-open');
}

/**
 * Жест «назад» на телефоне.
 *
 * Возврат из диалога — в список, а не из приложения. Если в истории
 * лежит другой диалог (человек листал несколько), открываем его.
 */
window.addEventListener('popstate', function(e){
  var st = e.state || {};
  if (st.conv) { if (st.conv !== current) openConv(st.conv, true); return }
  closeThread();
});

/**
 * Высота окна на телефоне.
 *
 * iOS не уменьшает окно, когда открывается клавиатура: она просто
 * закрывает нижнюю часть страницы вместе с полем ответа. visualViewport
 * знает настоящую видимую высоту — по ней и живём.
 */
/** Телефон. Ширина, а не «мобильность»: подписи считаем по месту. */
function narrow(){ return window.innerWidth <= 820 }

/**
 * Подгонка под клавиатуру на телефоне.
 *
 * Одной высоты мало, и это главное, что тут надо понимать. Когда на iOS
 * выезжает клавиатура, окно страницы не уменьшается: Safari оставляет
 * его прежним и ПРОКРУЧИВАЕТ, чтобы показать поле ввода. Приложение при
 * этом уезжает вверх, под адресную строку, а нижняя часть — вместе с
 * полем ответа — оказывается за клавиатурой.
 *
 * Поэтому три вещи сразу: страница закреплена и не прокручивается,
 * высота берётся у visualViewport (он знает видимую часть), и весь
 * каркас сдвигается на offsetTop — ровно настолько, насколько Safari
 * увёл окно. Тогда поле ответа стоит над клавиатурой, а не под ней.
 */
function fitHeight(){
  var vv = window.visualViewport;
  var app = el('app');
  if (!vv || !app) return;

  // На широком экране высотой распоряжается вёрстка: снимаем свою.
  if (window.innerWidth > 820){
    app.style.height = '';
    app.style.transform = '';
    return;
  }

  // Высоту перехватываем ТОЛЬКО пока открыта клавиатура. В остальное
  // время ею распоряжается вёрстка (100dvh): в приложении на домашнем
  // экране visualViewport не считает нижнюю безопасную зону, и снизу
  // оставалась пустая полоса высотой с эту зону.
  var keyboard = vv.height < window.innerHeight - 120;
  if (!keyboard){
    app.style.height = '';
    app.style.transform = '';
    return;
  }

  app.style.height = Math.round(vv.height) + 'px';
  var off = Math.round(vv.offsetTop || 0);
  app.style.transform = off ? 'translateY(' + off + 'px)' : '';

  // Клавиатура выехала — последнее сообщение должно остаться на виду.
  var box = el('msgs');
  if (box) box.scrollTop = box.scrollHeight;
}

if (window.visualViewport){
  window.visualViewport.addEventListener('resize', fitHeight);
  window.visualViewport.addEventListener('scroll', fitHeight);
}
window.addEventListener('orientationchange', function(){ setTimeout(fitHeight, 250) });

/*
 * Фокус в поле. Safari к этому моменту ещё не сообщил новую высоту:
 * клавиатура выезжает с задержкой и анимацией. Поэтому пересчитываем
 * несколько раз подряд — дешевле, чем поймать единственный верный
 * момент, которого у разных версий iOS нет.
 */
document.addEventListener('focusin', function(e){
  var t = e.target;
  if (!t || (t.tagName !== 'TEXTAREA' && t.tagName !== 'INPUT')) return;
  [80, 250, 500].forEach(function(ms){ setTimeout(fitHeight, ms) });
});

document.addEventListener('focusout', function(){
  // Клавиатура ушла — окно должно вернуться на место. Без этого
  // страница остаётся прокрученной, и сверху висит пустая полоса.
  setTimeout(function(){ window.scrollTo(0, 0); fitHeight() }, 120);
});

var toastTimer = null;
function toast(text){
  var t = el('toast');
  t.textContent = text;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ t.classList.remove('on') }, 5000);
}

/**
 * Состояние бота в этом диалоге.
 *
 * Бот может молчать по трём разным причинам, и для оператора это
 * три разные ситуации. «Выключен» — он сам так решил. «Пауза» —
 * временно, само пройдёт. «Вкл» — работает. Без этого различия
 * молчащий бот выглядит сломанным.
 */
function botState(c){
  if (!c.bot_enabled) return { label:L('вимк'), why:L('Автовідповіді вимкнені для цього діалогу') };
  if (c.assignee_id) return { label:L('пауза'), why:L('У діалогу є відповідальний — бот не втручається') };
  if (c.human_replied_at && (new Date() - new Date(c.human_replied_at)) < 30*60*1000) {
    return { label:L('пауза'), why:L('Оператор відповідав менше 30 хвилин тому. Бот увімкнеться сам') };
  }
  return { label:L('увімк'), why:L('Бот відповідає на відповідні повідомлення') };
}

function patchConv(body){
  if (!current) return Promise.resolve();
  return api('/conversations/' + current, { method:'PATCH', body: body })
    .then(function(){ return refresh() })
    .then(function(){ renderHead() })
    .catch(showErr);
}

function loadThread(){
  if (!current) return;
  api('/conversations/' + current + '/messages').then(function(d){
    var wasBottom = isAtBottom();
    var html = (d.messages || []).map(function(m){
      var c = m.content || {};
      var isOut = m.direction !== 'in';
      var cls = 'm ' + (isOut ? 'out' : 'in') +
        (m.sender_type === 'bot' ? ' bot' : '') +
        (m.status === 'failed' ? ' failed' : '');
      var meta = fmtTime(m.sent_at) +
        (m.sender_type === 'bot' ? L(' · бот') : '') +
        (isOut ? ' · ' + statusLabel(m.status) : '');

      // Цитата. Текст берём с сервера, если исходное сообщение нашлось,
      // иначе — сохранённый снимок из самого сообщения: клиент мог
      // ответить на то, чего у нас нет.
      var qText = m.reply_to_text || c.replyToText;
      var quote = (qText || c.replyToExternalId)
        ? '<div class="quote"><b>' +
            esc(m.reply_to_direction === 'out' ? L('Ви') : (c.replyToName || L('Клієнт'))) + '</b>' +
            esc(qText || L('повідомлення')) + '</div>'
        : '';

      var rx = (m.reactions || []).map(function(r){
        return '<span class="r' + (r.by === 'agent' ? ' mine' : '') + '">' + esc(r.emoji) + '</span>';
      }).join('');

      var body = quote + renderAttachments(m.id, c.attachments) + (c.text ? esc(c.text) : '');

      return '<div class="mwrap ' + (isOut ? 'out' : 'in') + '" data-mid="' + m.id +
        '" data-ext="' + esc(m.external_id || '') + '" data-text="' + esc((c.text || '').slice(0,120)) + '">' +
        '<div class="' + cls + '">' + body +
          '<div class="meta">' + esc(meta) + '</div></div>' +
        (rx ? '<div class="rx">' + rx + '</div>' : '') +
        '<div class="mtools">' +
          '<button data-reply="' + m.id + L('">Відповісти</button>') +
          (m.external_id ? '<button data-react="' + m.id + L('">Реакція</button>') : '') +
        '</div>' +
      '</div>';
    }).join('');

    if (html === lastThread){ renderComposer(); return }
    lastThread = html;
    el('msgs').innerHTML = html;

    Array.prototype.forEach.call(el('msgs').querySelectorAll('.att img'), function(img){
      img.onclick = function(){
        var lb = document.createElement('div');
        lb.className = 'lightbox';
        lb.innerHTML = '<img src="' + img.src + '">';
        lb.onclick = function(){ lb.remove() };
        document.body.appendChild(lb);
      };
    });
    bindMessageTools();
    if (wasBottom) el('msgs').scrollTop = el('msgs').scrollHeight;
    renderComposer();
  }).catch(showErr);
}

var ICONS = { document:'📄', sticker:'😀', video:'🎬', audio:'🎵', voice:'🎤', image:'🖼' };

/**
 * Вложения.
 *
 * Ключевой момент — состояние «ещё качается». Текст сохраняется сразу,
 * а файл подтягивается отдельной задачей. Показывать в это время пустоту
 * нельзя: оператор решит, что клиент прислал пустое сообщение.
 */
function renderAttachments(messageId, list){
  if (!list || !list.length) return '';
  return list.map(function(a, i){
    if (a.ready === false) {
      var why = a.failure && a.failure.error === 'too_large'
        ? L('Файл більший за 20 МБ — Telegram не віддає його боту')
        : L('Вкладення недоступне');
      return '<div class="att"><div class="wait">' + esc(why) + '</div></div>';
    }
    if (!a.storageKey) {
      // Кнопка повтора нужна не для красоты: если задача на скачивание
      // не создалась (воркер лежал, не было сети), файл не подтянется
      // никогда — состояние «загружается» будет вечным.
      return '<div class="att"><div class="wait">' +
        esc(labelFor(a.type)) + L(' завантажується... ') +
        '<span class="x" data-retry="' + messageId + '" data-i="' + i +
        L('" style="cursor:pointer;text-decoration:underline">повторити</span></div></div>');
    }

    // Токен нельзя положить в src: браузер не отправит заголовок
    // Authorization для картинки. Забираем файл через fetch как blob.
    var id = 'att-' + messageId + '-' + i;
    fetchMedia(messageId, i, id);

    if (a.type === 'image' || a.type === 'sticker')
      return '<div class="att"><img id="' + id + '" alt="' + esc(labelFor(a.type)) + '"></div>';
    if (a.type === 'video')
      return '<div class="att"><video id="' + id + '" controls></video></div>';
    if (a.type === 'voice' || a.type === 'audio')
      return '<div class="att"><audio id="' + id + '" controls></audio></div>';

    return '<div class="att"><a class="file" id="' + id + '" download="' +
      esc(a.filename || 'file') + '"><span class="ic">' +
      (ICONS[a.type] || ICONS.document) + '</span><span class="nm">' +
      esc(a.filename || labelFor(a.type)) + '</span></a></div>';
  }).join('');
}

function labelFor(t){
  return { image:L('Зображення'), video:L('Відео'), voice:L('Голосове повідомлення'),
           audio:L('Аудіо'), document:L('Документ'), sticker:L('Стікер') }[t] || L('Вкладення');
}

var mediaCache = {};

function fetchMedia(messageId, index, elementId){
  var key = messageId + ':' + index;
  var apply = function(url){
    var node = document.getElementById(elementId);
    if (!node) return;
    if (node.tagName === 'A') node.href = url; else node.src = url;
  };
  if (mediaCache[key]) { setTimeout(function(){ apply(mediaCache[key]) }, 0); return }

  fetch('/media/' + messageId + '/' + index, { headers:{ Authorization:'Bearer ' + TOKEN } })
    .then(function(r){ return r.ok ? r.blob() : Promise.reject(r.status) })
    .then(function(blob){
      var url = URL.createObjectURL(blob);
      mediaCache[key] = url;
      apply(url);
    })
    .catch(function(){ /* ещё не скачалось — подтянется на следующем обновлении */ });
}

function isAtBottom(){
  var m = el('msgs');
  return m.scrollHeight - m.scrollTop - m.clientHeight < 60;
}

/**
 * Поле ответа.
 *
 * Главное здесь — ранний выход. Опрос сервера идёт раз в три секунды,
 * и раньше каждый цикл заново собирал разметку поля: набранный, но не
 * отправленный текст стирался на полуслове. Состояние поля зависит
 * только от того, открыто окно ответа или нет; не менялось — не трогаем.
 */
function renderComposer(force){
  var c = currentConv();
  var box = el('composer');
  box.style.display = 'block';
  var w = windowState(c);

  // В ключ входят цитата и выбранный файл: их появление обязано
  // перерисовать поле, иначе оператор не увидит, на что отвечает.
  var mode = (w.open ? 'open' : 'blocked') + ':' + current + ':' + QR.length +
    ':' + (replyTo ? replyTo.id : '') + ':' + (pendingFile ? (pendingFile.name || '') : '');
  if (!force && box.dataset.mode === mode) return;

  // Набранный текст переживает перерисовку — его теряют только вместе
  // со сменой диалога.
  var keep = el('txt') && box.dataset.mode && box.dataset.mode.indexOf(':' + current + ':') > 0
    ? el('txt').value : '';
  box.dataset.mode = mode;

  if (!w.open){
    // Не прячем поле молча — объясняем, почему нельзя. Иначе оператор
    // решит, что сломался интерфейс, и пойдёт писать в поддержку.
    // Не прячем поле молча — объясняем, почему нельзя. Причина у каналов
    // разная: в WhatsApp остаются шаблоны, в Viber не остаётся ничего,
    // пока клиент не напишет сам. Обещать шаблоны там — обманывать.
    box.innerHTML = L('<div class="blocked"><b>Вікно відповіді закрито.</b> ') +
      L('Вільний текст надіслати не можна — так влаштовані правила каналу, ') +
      L('а не наш застосунок. ') +
      (c.channel_type === 'viber_business'
        ? L('Viber закриває сесію через добу: відповісти можна буде, коли клієнт напише знову.</div>')
        : L('Доступні тільки схвалені шаблони.</div>'));
    return;
  }

  box.innerHTML =
    (replyTo
      ? L('<div class="replybar"><div class="t"><b>Відповідь ') +
        (replyTo.mine ? L('на своє повідомлення') : L('клієнту')) + ':</b> ' +
        esc(replyTo.text || L('повідомлення')) + '</div><div class="c" id="rCancel">×</div></div>'
      : '') +
    (pendingFile
      ? '<div class="fileprev"><div class="t">' + esc(pendingFile.name) + ' · ' +
        Math.round(pendingFile.size / 1024) + L(' КБ</div><div class="c" id="fCancel">×</div></div>')
      : '') +
    '<div class="tplbox" id="tplBox" style="display:none"></div>' +
    '<div class="emobox" id="emoBox" style="display:none"></div>' +
    '<div class="row">' +
    '<input type="file" id="file" style="display:none">' +
    L('<button class="icob" id="clip" title="Прикріпити файл">') + icon('clip') + '</button>' +
    L('<button class="icob" id="emo" title="Смайли">') + icon('smile') + '</button>' +
    L('<button class="icob" id="tpl" title="Шаблони відповідей">') + icon('bolt') + '</button>' +
    // Кнопка черновика появляется, только когда ИИ подключён: пустая
    // кнопка, которая на нажатие отвечает «не настроено», — это
    // обещание, которого интерфейс не держит.
    (AI.ready ? L('<button class="icob" id="ai" title="Чернетка відповіді від ШІ">✨</button>') : '') +
    (narrow()
      ? L('<textarea id="txt" rows="1" placeholder="Відповідь клієнту"></textarea>')
      : L('<textarea id="txt" rows="1" placeholder="Відповідь клієнту. Enter — надіслати, Shift+Enter — перенос"></textarea>')) +
    L('<button id="send">Надіслати</button></div><div class="err" id="sendErr"></div>');

  var ta = el('txt');
  if (keep) ta.value = keep;

  if (el('rCancel')) el('rCancel').onclick = function(){ replyTo = null; renderComposer(true) };
  if (el('fCancel')) el('fCancel').onclick = function(){ pendingFile = null; renderComposer(true) };

  el('clip').onclick = function(){ el('file').click() };
  el('file').onchange = function(){
    var f = this.files && this.files[0];
    if (!f) return;
    // Двадцать мегабайт — предел Telegram для бота. Проверяем здесь,
    // чтобы человек узнал об этом до долгой загрузки, а не после.
    if (f.size > 20 * 1024 * 1024){ alertLine(L('Файл більший за 20 МБ — Telegram не пропустить')); return }
    pendingFile = f;
    renderComposer(true);
  };
  ta.oninput = function(){ ta.style.height='auto'; ta.style.height=Math.min(ta.scrollHeight,150)+'px' };
  ta.onkeydown = function(e){
    if (e.key === 'Enter' && !e.shiftKey){
      e.preventDefault();
      // Строка вида «/цена» разворачивается в шаблон, а не улетает клиенту.
      // Отправка требует второго Enter — так виден текст перед отправкой.
      if (expand(ta)) return;
      send();
    }
  };
  el('send').onclick = send;
  el('emo').onclick = toggleEmoji;
  el('tpl').onclick = toggleTemplates;
  if (el('ai')) el('ai').onclick = aiDraft;
  ta.focus();
}

/**
 * Черновик от ИИ.
 *
 * Текст подставляется в поле ответа и не уходит клиенту: последнее
 * слово за оператором. Уже набранное не затирается — дописываем ниже,
 * иначе одно нажатие стёрло бы готовую фразу.
 */
function aiDraft(){
  var b = el('ai'), ta = el('txt');
  if (!b || !current) return;
  busy(b, true);
  api('/conversations/' + current + '/ai-draft', { method:'POST' })
    .then(function(r){
      var text = (r && r.text) || '';
      if (!text) return;
      ta.value = ta.value.trim() ? ta.value.trim() + NL + text : text;
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 150) + 'px';
      ta.focus();
    })
    .catch(function(e){
      var p = e.payload || {};
      alertLine(p.error === 'not_connected'
        ? L('ШІ не підключений — увімкніть його в розділі «Інтеграції»')
        : p.error === 'nothing_to_answer' ? L('У діалозі ще немає тексту, на який відповідати')
        : (p.detail || L('ШІ не відповів')));
    })
    .then(function(){ busy(b, false) });
}

function expand(ta){
  var t = ta.value.trim();
  if (t.charAt(0) !== '/') return false;
  var hit = QR.filter(function(q){ return q.shortcut === t.slice(1) })[0];
  if (!hit) return false;
  useTemplate(hit);
  return true;
}

/**
 * Подстановка шаблона в поле ответа.
 *
 * Файл шаблона не скачивается в браузер и не загружается заново: он уже
 * лежит в хранилище, и при отправке уходит ссылка на него. Оператор
 * видит прикреплённый файл ровно так же, как если бы выбрал его с диска,
 * и может снять его крестиком.
 */
function useTemplate(q){
  var ta = el('txt');
  ta.value = q.body;
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 150) + 'px';
  var f = (q.attachments || [])[0];
  pendingFile = f
    ? { qr: { id: q.id, index: 0 }, name: f.filename || L('файл'), size: f.size || 0, type: f.mime }
    : null;
  renderComposer(true);
  var t2 = el('txt');
  if (t2) { t2.focus(); t2.setSelectionRange(t2.value.length, t2.value.length) }
}

function toggleTemplates(){
  var b = el('tplBox');
  if (b.style.display !== 'none'){ b.style.display='none'; return }
  if (!QR.length){
    b.innerHTML = L('<div class="qr" style="cursor:default"><b>Шаблонів поки немає.</b> ') +
      L('<span class="x">Створіть їх у розділі «Шаблони» — потім вставляються командою /імʼя ') +
      L('або звідси, разом з файлом.</span></div>');
    b.style.display = 'block';
    return;
  }
  b.innerHTML = QR.map(function(q, i){
    var n = (q.attachments || []).length;
    return '<div class="qr" data-i="' + i + '"><b>/' + esc(q.shortcut) + '</b>' +
      (n ? '<span class="chip">📎 ' + n + '</span> ' : '') +
      '<span class="x">' + esc(q.body) + '</span></div>';
  }).join('');
  b.style.display = 'block';
  Array.prototype.forEach.call(b.children, function(node){
    node.onclick = function(){
      useTemplate(QR[Number(node.dataset.i)]);
      b.style.display = 'none';
    };
  });
}


/* ── Шаблоны WhatsApp ─────────────────────────────────────────────
   Вне суточного окна WhatsApp разрешает только их. Список берём у Meta
   при каждом открытии: шаблон могли одобрить или отклонить только что,
   а устаревший список означает отказ при отправке. */

var WATPL = { list:[], conv:null };

function waTemplates(box, c){
  WATPL.conv = c;
  box.innerHTML = L('<div class="blocked"><b>Вікно 24 години закрито.</b> ') +
    L('WhatsApp дозволяє продовжити розмову лише погодженим шаблоном.</div>') +
    L('<div id="waPick" class="hint">Завантажую шаблони...</div>');

  api('/channels/' + c.channel_id + '/whatsapp-templates')
    .then(function(d){
      WATPL.list = d.templates || [];
      if (!WATPL.list.length){
        el('waPick').innerHTML = L('<div class="hint">Погоджених шаблонів немає. ') +
          L('Створіть їх у кабінеті Meta: WhatsApp → Message templates.</div>');
        return;
      }
      el('waPick').innerHTML =
        '<div class="row2"><select id="waTpl">' +
        WATPL.list.map(function(t, i){
          return '<option value="' + i + '">' + esc(t.name) + ' · ' + esc(t.language) + '</option>';
        }).join('') + '</select></div><div id="waVars"></div>' +
        L('<div class="acts"><button id="waSend">Надіслати шаблон</button></div>') +
        '<div class="err" id="waTplErr"></div>';

      el('waTpl').onchange = waVars;
      el('waSend').onclick = waSendTemplate;
      waVars();
    })
    .catch(function(){
      el('waPick').innerHTML = L('<div class="hint">Не вдалося отримати шаблони від Meta.</div>');
    });
}

/* Значения переменных. Показываем и сам текст шаблона: по имени вроде
   order_update_v3 оператор не поймёт, что именно уйдёт клиенту. */
function waVars(){
  var t = WATPL.list[Number(el('waTpl').value)] || {};
  var rows = '';
  for (var i = 1; i <= (t.variables || 0); i++){
    rows += '<div class="row2"><input class="waVar" data-n="' + i + '" placeholder="{{' + i + '}}"></div>';
  }
  el('waVars').innerHTML =
    '<div class="hint" style="white-space:pre-wrap">' + esc(t.body || '') + '</div>' + rows;
}

/* Подстановка значений вместо {{1}}, {{2}} …
   Без регулярного выражения намеренно: обратные слэши в этом файле
   запрещены — он целиком попадает в шаблонную строку, и «слэш эс»
   доехал бы до браузера просто буквой «эс». */
function waFill(text, params){
  var out = String(text || '');
  for (var i = 0; i < params.length; i++){
    var n = String(i + 1);
    out = out.split('{{' + n + '}}').join(params[i]);
    out = out.split('{{ ' + n + ' }}').join(params[i]);
  }
  return out;
}

function waSendTemplate(){
  var t = WATPL.list[Number(el('waTpl').value)];
  if (!t) return;

  var params = Array.prototype.map.call(document.querySelectorAll('.waVar'), function(x){
    return x.value.trim();
  });
  if (params.some(function(v){ return !v })){
    el('waTplErr').textContent = L('Заповніть усі значення шаблону');
    return;
  }

  // В ленте показываем текст с подставленными значениями: оператор
  // должен видеть, что именно ушло клиенту, а не имя шаблона.
  var shown = waFill(t.body || t.name, params);

  busy(el('waSend'), true);
  api('/conversations/' + current + '/messages', { method:'POST', body:{
    text: shown,
    template: { name:t.name, language:t.language, params:params }
  }})
    .then(function(){ lastThread = null; loadThread(); renderComposer(true) })
    .catch(function(e){
      busy(el('waSend'), false);
      el('waTplErr').textContent = ((e.payload||{}).detail) || L('Не вдалося надіслати');
    });
}


/* ── Смайлы ───────────────────────────────────────────────────────
   Набор и вставка — общие с виджетом в карточке Zoho, они приходят
   из theme.ts. Здесь остаётся только показ и скрытие панели. */

function toggleEmoji(){
  var b = el('emoBox');
  if (!b) return;
  if (b.style.display !== 'none'){ b.style.display = 'none'; return }
  b.innerHTML = emoPanel();
  b.style.display = 'block';
  Array.prototype.forEach.call(b.querySelectorAll('[data-e]'), function(x){
    x.onclick = function(){ emoInsert(el('txt'), x.dataset.e) };
  });
}

/* ── Ответ на сообщение и реакции ────────────────────────────────── */

/**
 * Набор эмодзи не произвольный. Telegram принимает только фиксированный
 * список; всё остальное отклоняется с 400. Здесь — самые ходовые из него.
 */
var EMOJI = ['👍','👎','❤','🔥','🎉','😁','😢','🙏','👌','🤔'];

function bindMessageTools(){
  Array.prototype.forEach.call(el('msgs').querySelectorAll('[data-retry]'), function(x){
    x.onclick = function(){
      x.textContent = L('ставлю в чергу...');
      api('/media/' + x.dataset.retry + '/' + x.dataset.i + '/retry', { method:'POST' })
        .then(function(){
          x.textContent = L('завантажую...');
          setTimeout(function(){ lastThread = null; loadThread() }, 2500);
        })
        .catch(function(e){
          // Показываем причину, а не «не вышло». Разница между
          // «нет ссылки на файл» и «сообщение не найдено» — это разница
          // между двумя совершенно разными поломками.
          var p = e.payload || {};
          x.textContent =
            p.error === 'no_file_reference' ? L('немає посилання на файл у Telegram')
            : p.error === 'not_found' ? L('повідомлення не знайдено')
            : p.error === 'unauthorized' ? L('немає доступу')
            : L('помилка ') + (e.status || '');
        });
    };
  });

  Array.prototype.forEach.call(el('msgs').querySelectorAll('[data-reply]'), function(b){
    b.onclick = function(){
      var wrap = b.closest('.mwrap');
      replyTo = {
        id: wrap.dataset.mid,
        ext: wrap.dataset.ext,
        text: wrap.dataset.text,
        mine: wrap.classList.contains('out')
      };
      renderComposer(true);
      if (el('txt')) el('txt').focus();
    };
  });

  Array.prototype.forEach.call(el('msgs').querySelectorAll('[data-react]'), function(b){
    b.onclick = function(e){
      e.stopPropagation();
      showPicker(b, b.dataset.react);
    };
  });
}

function showPicker(anchor, messageId){
  var old = document.querySelector('.picker');
  if (old) old.remove();

  var box = document.createElement('div');
  box.className = 'picker';
  box.innerHTML = EMOJI.map(function(x){
    return '<button data-e="' + x + '">' + x + '</button>';
  }).join('') + '<button data-e="">✖</button>';
  document.body.appendChild(box);

  var r = anchor.getBoundingClientRect();
  box.style.left = Math.max(8, Math.min(r.left, window.innerWidth - box.offsetWidth - 8)) + 'px';
  box.style.top = Math.max(8, r.top - box.offsetHeight - 6) + 'px';

  Array.prototype.forEach.call(box.children, function(btn){
    btn.onclick = function(){
      box.remove();
      api('/messages/' + messageId + '/reactions', {
        method:'POST', body:{ emoji: btn.dataset.e || null }
      }).then(function(){
        // Реакция уходит в очередь: в ленте она появится, когда Telegram
        // подтвердит. Обновляем чуть позже, а не мгновенно.
        setTimeout(function(){ lastThread = null; loadThread() }, 900);
      }).catch(function(e){
        var p = e.payload || {};
        if (p.error === 'message_not_delivered_yet') alertLine(L('Повідомлення ще не доставлено'));
      });
    };
  });

  setTimeout(function(){
    document.addEventListener('click', function once(){
      box.remove();
      document.removeEventListener('click', once);
    });
  }, 0);
}

function alertLine(text){
  var e = el('sendErr');
  if (!e) return;
  e.textContent = text;
  setTimeout(function(){ if (el('sendErr')) el('sendErr').textContent = '' }, 3000);
}

/** Тип вложения по MIME — от него зависит, как файл покажут у клиента. */
function fileKind(mime, name){
  var m = String(mime || '');
  if (m.indexOf('image/') === 0) return 'image';
  if (m.indexOf('video/') === 0) return 'video';
  if (m.indexOf('audio/') === 0) return 'audio';
  return 'document';
}

function readAsBase64(file){
  return new Promise(function(resolve, reject){
    var fr = new FileReader();
    fr.onload = function(){
      // readAsDataURL отдаёт «data:тип;base64,ДАННЫЕ» — нужен хвост.
      var s = String(fr.result);
      resolve(s.slice(s.indexOf(',') + 1));
    };
    fr.onerror = function(){ reject(new Error('read_failed')) };
    fr.readAsDataURL(file);
  });
}

function send(){
  var ta = el('txt'), text = ta.value.trim();
  if (!text && !pendingFile) return;
  busy(el('send'), true);
  el('sendErr').textContent = '';

  var payload = { text: text };
  if (replyTo && replyTo.ext) payload.replyToExternalId = replyTo.ext;

  if (pendingFile && pendingFile.qr) {
    payload.attachment = { fromQuickReply: pendingFile.qr };
  }

  var prepared = pendingFile && !pendingFile.qr
    ? readAsBase64(pendingFile).then(function(b64){
        payload.attachment = {
          filename: pendingFile.name,
          mime: pendingFile.type || 'application/octet-stream',
          type: fileKind(pendingFile.type, pendingFile.name),
          dataBase64: b64
        };
      })
    : Promise.resolve();

  prepared
    .then(function(){
      return api('/conversations/' + current + '/messages', { method:'POST', body: payload });
    })
    .then(function(){
      ta.value = ''; ta.style.height = 'auto';
      replyTo = null; pendingFile = null;
      renderComposer(true);
      lastThread = null;
      loadThread();
    })
    .catch(function(e){
      // Окно могло закрыться, пока оператор печатал — показываем причину,
      // а не «ошибка 409».
      var p = e.payload || {};
      el('sendErr').textContent =
        p.error === 'file_too_large' ? L('Файл більший за 20 МБ')
        : p.error === 'storage_write_failed' ? p.detail
        : p.reason || p.error || L('Не вдалося надіслати');
    })
    .then(function(){ busy(el('send'), false) });
}

/* ══════════════ Карточка клиента ══════════════ */

var cardData = null;

function loadCard(){
  if (!current) return;
  api('/conversations/' + current + '/card').then(function(d){
    cardData = d;
    renderCard();
  }).catch(function(){});
}

function renderCard(){
  var d = cardData;
  if (!d || !d.contact){ el('card').innerHTML = L('<div class="empty">Немає даних</div>'); return }
  var ct = d.contact, c = currentConv();

  el('card').innerHTML =
    '<div style="display:flex;gap:11px;align-items:center;margin-bottom:14px">' +
      '<div class="av" data-av="' + ct.id + '" ' +
        'style="width:44px;height:44px;font-size:15px;background-color:' +
        avatarColor(ct.display_name || ct.id) + '">' + esc(initials(ct.display_name)) + '</div>' +
      '<div style="min-width:0"><div style="font-weight:700;font-size:14.5px">' +
        esc(ct.display_name || L('Без імені')) + '</div>' +
      L('<div class="dim" style="font-size:12px">клієнт з ') + esc(fmtDate(ct.created_at)) + '</div></div>' +
    '</div>' +

    L('<h4>Контакт</h4>') +
    L('<div class="fld"><label>Імʼя</label><input id="cNm" value="') + esc(ct.display_name || '') + '"></div>' +
    L('<div class="fld"><label>Телефон</label><input id="cPh" value="') + esc(ct.phone_e164 || '') + '"></div>' +
    L('<div class="fld"><label>Пошта</label><input id="cEm" value="') + esc(ct.email || '') + '"></div>' +
    L('<button class="ghost mini" id="cSave">Зберегти</button>') +
    '<span class="ok" id="cOk" style="margin-left:8px"></span>' +

    L('<h4>Канали клієнта</h4>') +
    '<div class="kv2">' + (d.identities || []).map(function(i){
      var p = i.raw_profile || {};
      return '<div class="k">' + esc(CH[i.channel_type] || i.channel_type) + '</div>' +
        '<div>' + esc(p.username ? '@' + p.username : i.external_id) + '</div>';
    }).join('') + '</div>' +

    L('<h4>Мітки</h4>') +
    '<div class="tags" id="cTags">' +
      ((c && c.tags) || []).map(function(t){
        return '<span class="tag">' + esc(t) + '<span class="x" data-tag="' + esc(t) + '">×</span></span>';
      }).join('') +
    '</div>' +
    '<div class="row2" style="margin-top:8px">' +
      L('<input id="cTag" placeholder="нова мітка" style="font-size:12.5px;padding:6px 9px">') +
      L('<button class="ghost mini" id="cTagAdd">Додати</button>') +
    '</div>' +

    L('<h4>Нотатки</h4>') +
    L('<textarea id="cNote" rows="2" placeholder="Видно тільки вашій команді"></textarea>') +
    L('<button class="ghost mini" id="cNoteAdd" style="margin-top:7px">Додати</button>') +
    '<div style="margin-top:12px">' +
      ((d.notes || []).length ? d.notes.map(function(n){
        return '<div class="note">' + esc(n.body) +
          '<div class="who">' + esc(n.author_name || L('хтось')) + ' · ' + esc(fmtTime(n.created_at)) +
          ' <span class="x" data-note="' + n.id + L('" style="cursor:pointer">видалити</span></div></div>');
      }).join('') : L('<div class="dim" style="font-size:12.5px">Поки немає.</div>')) +
    '</div>' +

    '<h4>CRM</h4>' +
    (d.crmUrl
      ? L('<div class="kv2"><div class="k">Картка</div>') +
        '<div><a href="' + esc(d.crmUrl) + L('" target="_blank" rel="noopener">відкрити в Zoho</a></div></div>')
      : L('<div class="row2"><button class="ghost mini" id="cCrm">Надіслати в Zoho</button></div>') +
        L('<div class="hint" style="margin-top:6px">Знайдемо за номером і привʼяжемо картку, ') +
        L('а якщо такого клієнта ще немає — створимо лід.</div>') +
        '<div class="err" id="cCrmErr"></div>') +

    L('<h4>Діалог</h4>') +
    '<div class="kv2">' +
      L('<div class="k">Повідомлень</div><div>') + esc((d.stats && d.stats.messages) || 0) + '</div>' +
      L('<div class="k">Перше</div><div>') + esc(fmtDate(d.stats && d.stats.first_at)) + '</div>' +
      L('<div class="k">Останнє</div><div>') + esc(fmtDate(d.stats && d.stats.last_at)) + '</div>' +
    '</div>';

  paintAvatars();

  el('cSave').onclick = function(){
    busy(el('cSave'), true);
    api('/contacts/' + ct.id, { method:'PATCH', body:{
      displayName: el('cNm').value.trim(),
      phone: el('cPh').value.trim(),
      email: el('cEm').value.trim()
    }}).then(function(){
      el('cOk').textContent = L('збережено');
      setTimeout(function(){ if (el('cOk')) el('cOk').textContent = '' }, 2000);
      refresh();
    }).catch(showErr).then(function(){ busy(el('cSave'), false) });
  };

  if (el('cCrm')) el('cCrm').onclick = function(){
    busy(el('cCrm'), true);
    el('cCrmErr').textContent = '';
    api('/contacts/' + ct.id + '/crm', { method:'POST' })
      .then(function(){
        toast(L('Надсилаю в Zoho...'));
        // Связка идёт задачей: ответ приходит не мгновенно, и карточку
        // имеет смысл перечитать через пару секунд, а не сразу.
        setTimeout(loadCard, 2500);
        setTimeout(loadCard, 6000);
      })
      .catch(function(e){
        var p = e.payload || {};
        el('cCrmErr').textContent = p.error === 'crm_not_connected'
          ? L('Zoho не підключена — зробіть це на сторінці «Інтеграції»')
          : p.error === 'already_linked' ? L('Картка вже звʼязана') : L('Не вдалося надіслати');
        busy(el('cCrm'), false);
      });
  };

  el('cTagAdd').onclick = function(){
    var t = el('cTag').value.trim();
    if (t) patchConv({ addTag: t }).then(renderCard);
  };
  Array.prototype.forEach.call(el('card').querySelectorAll('[data-tag]'), function(x){
    x.onclick = function(){ patchConv({ removeTag: x.dataset.tag }).then(renderCard) };
  });

  el('cNoteAdd').onclick = function(){
    var body = el('cNote').value.trim();
    if (!body) return;
    api('/contacts/' + ct.id + '/notes', { method:'POST', body:{ body: body } })
      .then(loadCard).catch(showErr);
  };
  Array.prototype.forEach.call(el('card').querySelectorAll('[data-note]'), function(x){
    x.onclick = function(){
      api('/notes/' + x.dataset.note, { method:'DELETE' }).then(loadCard).catch(showErr);
    };
  });
}

/* ══════════════ Сценарии ══════════════ */

/**
 * Сценарий — цепочка шагов, а не одно правило «слово → ответ».
 *
 * Редактор устроен как сама цепочка: шаги идут сверху вниз, каждый можно
 * поднять, опустить и убрать. Формы у шагов разные, но карточка одна —
 * так видно, что это один и тот же механизм, а не семь разных настроек.
 *
 * Состояние правки живёт в одной переменной SC. Пока она не пуста,
 * на странице редактор; как только сохранили или отменили — список.
 */

var TRIG = {
  welcome:{ t:L('Привітання'), h:L('Перше повідомлення в діалозі, один раз') },
  keyword:{ t:L('Містить слово'), h:L('У повідомленні зустрілося одне зі слів') },
  exact:{ t:L('Точний збіг'), h:L('Повідомлення цілком дорівнює слову') },
  off_hours:{ t:L('Поза графіком'), h:L('Повідомлення надійшло в неробочий час') },
  fallback:{ t:L('Нічого не підійшло'), h:L('Перевіряється останнім') }
};

var KINDS = {
  message:{ t:L('Повідомлення'), i:'💬' },
  ask:{ t:L('Питання і очікування відповіді'), i:'❓' },
  delay:{ t:L('Пауза'), i:'⏱' },
  condition:{ t:L('Розгалуження'), i:'🔀' },
  tag:{ t:L('Мітка на діалог'), i:'🏷' },
  handoff:{ t:L('Передати оператору'), i:'🙋' },
  close:{ t:L('Закрити діалог'), i:'✅' }
};

var SC = null;
var SCENARIOS = [];

/** Короткая сводка цепочки для карточки в списке. */
function stepsSummary(steps){
  return (steps || []).map(function(st){
    var k = KINDS[st.kind] || { i:'•', t:st.kind };
    var extra = st.kind === 'delay'
      ? ' ' + (st.seconds >= 3600 ? Math.round(st.seconds / 3600) + L(' год')
          : st.seconds >= 60 ? Math.round(st.seconds / 60) + L(' хв') : st.seconds + L(' с'))
      : '';
    return '<span class="chip">' + k.i + ' ' + esc(k.t.split(' ')[0]) + extra + '</span>';
  }).join(' ');
}

/**
 * Пауза бота после ответа оператора.
 *
 * Стоит первой на странице сценариев, потому что объясняет их
 * молчание. Самая частая жалоба «сценарии не работают» — это проверка
 * в том же диалоге, где человек только что отвечал сам: бот честно
 * молчит, а выглядит это как поломка. Теперь число видно и его можно
 * поставить в ноль на время проверки.
 */
function pauseRow(){
  var minutes = (ME && ME.tenant && typeof ME.tenant.bot_pause_minutes === 'number')
    ? ME.tenant.bot_pause_minutes : 30;
  var opts = [0, 5, 15, 30, 60, 180];
  if (opts.indexOf(minutes) < 0) opts.push(minutes);

  return '<div class="card" style="margin-bottom:14px">' +
    '<div class="row2">' +
    '<div class="lbl" style="width:auto">' + L('Пауза після відповіді оператора') + '</div>' +
    '<select id="scPause" style="max-width:200px">' +
    opts.sort(function(a, b){ return a - b }).map(function(m){
      return '<option value="' + m + '"' + (m === minutes ? ' selected' : '') + '>' +
        (m === 0 ? L('без паузи') : m + ' ' + L('хв')) + '</option>';
    }).join('') + '</select></div>' +
    '<div class="hint">' +
    L('Поки пауза йде, бот мовчить у цьому діалозі — щоб не влізти в живу розмову. ') +
    L('Для перевірки сценарію поставте «без паузи».') + '</div>' +
    '<div class="err" id="scPauseErr"></div></div>';
}

function wirePause(){
  if (!el('scPause')) return;
  el('scPause').onchange = function(){
    var value = Number(this.value);
    api('/settings/bot', { method:'PATCH', body:{ botPauseMinutes: value } })
      .then(function(r){
        if (ME && ME.tenant) ME.tenant.bot_pause_minutes = r.botPauseMinutes;
        toast(value ? L('Пауза збережена') : L('Пауза вимкнена'));
      })
      .catch(function(){ el('scPauseErr').textContent = L('Не вдалося зберегти') });
  };
}

function renderBots(){
  if (SC) return renderScEditor();
  api('/scenarios').then(function(d){
    SCENARIOS = d.scenarios || [];
    pageBox().innerHTML = '<div class="pg">' +
      pageHead(L('Сценарії'),
        L('Ланцюжок кроків, який веде розмову за оператора: привітатися, запитати, ') +
        L('почекати, поставити мітку і покликати людину, коли справа дійшла до справи.'),
        '<button id="scNew">' + L('Новий сценарій') + '</button>') +

      pauseRow() +

      (SCENARIOS.length
        ? '<div class="grid">' + SCENARIOS.map(function(sc){
            var tr = TRIG[sc.trigger_type] || { t:sc.trigger_type };
            var kw = (sc.keywords || []).join(', ');
            return '<div class="card sc' + (sc.is_active ? '' : ' off') + '">' +
              '<div class="sc-h">' +
                '<div style="min-width:0">' +
                  '<div class="h4">' + esc(sc.name) + '</div>' +
                  '<div class="s">' + esc(tr.t) + (kw ? ': ' + esc(kw) : '') +
                    ' · ' + esc(sc.channel_name || L('всі канали')) + '</div>' +
                '</div>' +
                '<span class="pill ' + (sc.is_active ? 'good' : '') + '">' +
                  (sc.is_active ? L('працює') : L('вимкнений')) + '</span>' +
              '</div>' +
              '<div class="sc-steps">' + stepsSummary(sc.steps) + '</div>' +
              '<div class="sc-f">' +
                L('<span class="dim">запусків ') + esc(sc.runs_started) +
                  L(' · дійшли до кінця ') + esc(sc.runs_finished) +
                  (Number(sc.live) ? L(' · зараз триває ') + esc(sc.live) : '') + '</span>' +
                '<span class="row" style="gap:6px">' +
                  '<button class="ghost mini" data-scedit="' + sc.id + L('">Змінити</button>') +
                  '<button class="ghost mini" data-sctog="' + sc.id + '" data-on="' +
                    (sc.is_active ? 'false' : 'true') + '">' +
                    (sc.is_active ? L('Вимкнути') : L('Увімкнути')) + '</button>' +
                  '<button class="ghost mini" data-scdel="' + sc.id + L('">Видалити</button>') +
                '</span>' +
              '</div></div>';
          }).join('') + '</div>'
        : L('<div class="card"><div class="empty"><div class="ttl">Сценаріїв поки немає</div>') +
          L('Почніть з привітання: клієнт пише вперше — бот вітається і обіцяє, ') +
          L('що оператор відповість. Це одна хвилина і відразу видимий ефект.</div></div>')) +
      '</div>';

    wirePause();

    el('scNew').onclick = function(){
      SC = { name:'', channel_id:null, trigger_type:'welcome', keywords:[],
             schedule:{ from:'09:00', to:'19:00', days:[1,2,3,4,5], tzOffset:3 },
             steps:[{ kind:'message', text:'' }], is_active:true, priority:100 };
      renderScEditor();
    };

    Array.prototype.forEach.call(pageBox().querySelectorAll('[data-scedit]'), function(b){
      b.onclick = function(){
        var found = SCENARIOS.filter(function(x){ return x.id === b.dataset.scedit })[0];
        if (!found) return;
        SC = JSON.parse(JSON.stringify(found));
        SC.schedule = SC.schedule && SC.schedule.from ? SC.schedule
          : { from:'09:00', to:'19:00', days:[1,2,3,4,5], tzOffset:3 };
        renderScEditor();
      };
    });

    Array.prototype.forEach.call(pageBox().querySelectorAll('[data-sctog]'), function(b){
      b.onclick = function(){
        api('/scenarios/' + b.dataset.sctog, { method:'PATCH',
          body:{ isActive: b.dataset.on === 'true' } }).then(renderBots).catch(showErr);
      };
    });

    armDelete(pageBox().querySelectorAll('[data-scdel]'), function(b){
      return api('/scenarios/' + b.dataset.scdel, { method:'DELETE' }).then(renderBots);
    });
  }).catch(showErr);
}

/** Поле шага: одна строка разметки на все виды, отличается содержимым. */
function stepFields(st, i){
  if (st.kind === 'message') {
    return '<textarea data-f="text" data-i="' + i + '" rows="2" ' +
      L('placeholder="Що надіслати клієнту">') + esc(st.text || '') + '</textarea>';
  }
  if (st.kind === 'ask') {
    return '<textarea data-f="text" data-i="' + i + '" rows="2" ' +
      L('placeholder="Про що запитати">') + esc(st.text || '') + '</textarea>' +
      '<div class="row2" style="margin-top:8px">' +
      '<input data-f="save" data-i="' + i + L('" placeholder="Запамʼятати відповідь як (необовʼязково)" value="') +
        esc(st.save || '') + '">' +
      '<input data-f="timeoutMinutes" data-i="' + i + '" type="number" min="0" ' +
        L('placeholder="Чекати, хвилин" value="') + esc(st.timeoutMinutes || '') + '">' +
      '</div>';
  }
  if (st.kind === 'delay') {
    return '<div class="row2"><input data-f="minutes" data-i="' + i + '" type="number" min="1" ' +
      L('placeholder="Пауза у хвилинах" value="') + esc(Math.max(1, Math.round((st.seconds || 60) / 60))) +
      L('"><div class="hint" style="margin:0;align-self:center">Довше за добу — це вже розсилка, а не розмова</div></div>');
  }
  if (st.kind === 'condition') {
    return '<div class="row2">' +
      '<input data-f="contains" data-i="' + i + L('" placeholder="Слова через кому: так, хочу, беру" value="') +
        esc((st.contains || []).join(', ')) + '">' +
      '<input data-f="goto" data-i="' + i + '" type="number" min="1" ' +
        L('placeholder="Якщо так — на крок" value="') + esc(st.goto !== undefined ? st.goto + 1 : '') + '">' +
      '<input data-f="elseGoto" data-i="' + i + '" type="number" min="1" ' +
        L('placeholder="Якщо ні — на крок" value="') +
        esc(st.elseGoto !== undefined ? st.elseGoto + 1 : '') + '">' +
      L('</div><div class="hint">Дивиться на останню відповідь клієнта. Порожньо в «якщо ні» — просто йдемо далі.</div>');
  }
  if (st.kind === 'tag') {
    return '<input data-f="tag" data-i="' + i + L('" placeholder="Назва мітки, наприклад «опт»" value="') +
      esc(st.tag || '') + '">';
  }
  if (st.kind === 'handoff') {
    return '<input data-f="note" data-i="' + i + L('" placeholder="Нотатка оператору (необовʼязково)" value="') +
      esc(st.note || '') + '">' +
      L('<div class="hint">Бот замовкає в цьому діалозі, далі відповідає людина.</div>');
  }
  return L('<div class="hint">Діалог іде в «Закриті». Повернеться сам, коли клієнт напише знову.</div>');
}

function renderScEditor(){
  var chOpts = L('<option value="">Всі канали</option>') + CHANNELS.map(function(c){
    return '<option value="' + c.id + '"' + (SC.channel_id === c.id ? ' selected' : '') + '>' +
      esc(c.display_name) + '</option>';
  }).join('');
  var trOpts = Object.keys(TRIG).map(function(k){
    return '<option value="' + k + '"' + (SC.trigger_type === k ? ' selected' : '') + '>' +
      TRIG[k].t + '</option>';
  }).join('');
  var needKw = SC.trigger_type === 'keyword' || SC.trigger_type === 'exact';
  var needSchedule = SC.trigger_type === 'off_hours';
  var sch = SC.schedule || {};

  var steps = SC.steps.map(function(st, i){
    var k = KINDS[st.kind] || { t:st.kind, i:'•' };
    return '<div class="step"><div class="st-h">' +
      '<span class="n">' + (i + 1) + '</span>' +
      '<span class="ic">' + k.i + '</span>' +
      '<b>' + esc(k.t) + '</b>' +
      '<span class="grow"></span>' +
      '<button class="quiet mini" data-up="' + i + L('" title="Вище"') + (i ? '' : ' disabled') + '>↑</button>' +
      '<button class="quiet mini" data-down="' + i + L('" title="Нижче"') +
        (i === SC.steps.length - 1 ? ' disabled' : '') + '>↓</button>' +
      '<button class="quiet mini" data-drop="' + i + L('" title="Прибрати">×</button>') +
      '</div><div class="st-b">' + stepFields(st, i) + '</div></div>';
  }).join('<div class="st-link"></div>');

  pageBox().innerHTML = '<div class="pg">' +
    pageHead(SC.id ? L('Сценарій') : L('Новий сценарій'),
      L('Кроки виконуються зверху вниз. Пауза і питання зупиняють ланцюжок до строку ') +
      L('або до відповіді клієнта — все це переживає перезапуск сервісу.'),
      L('<button class="ghost" id="scBack">До списку</button>')) +

    '<div class="card">' +
      L('<div class="row2"><input id="scName" placeholder="Назва, наприклад «Привітання»" value="') +
        esc(SC.name) + '"></div>' +
      '<div class="row2" style="margin-top:9px">' +
        '<select id="scTr">' + trOpts + '</select>' +
        '<select id="scCh">' + chOpts + '</select>' +
      '</div>' +
      '<div class="hint">' + esc((TRIG[SC.trigger_type] || {}).h || '') + '</div>' +
      (needKw
        ? '<div class="row2" style="margin-top:9px"><input id="scKw" ' +
          L('placeholder="Слова через кому: ціна, прайс, вартість" value="') +
          esc((SC.keywords || []).join(', ')) + '"></div>'
        : '') +
      (needSchedule
        ? '<div class="row2" style="margin-top:9px">' +
          L('<input id="scFrom" placeholder="з 09:00" value="') + esc(sch.from || '09:00') + '">' +
          L('<input id="scTo" placeholder="до 19:00" value="') + esc(sch.to || '19:00') + '">' +
          L('<input id="scTz" type="number" placeholder="часовий пояс" value="') +
            esc(sch.tzOffset === undefined ? 3 : sch.tzOffset) + '">' +
          L('</div><div class="hint">Часовий пояс зсувом від UTC: для Києва — 3. ') +
          L('Робочі дні — з понеділка по пʼятницю.</div>')
        : '') +
    '</div>' +

    L('<div class="card"><h3>Кроки</h3><div class="chain">') + steps + '</div>' +
      '<div class="addrow">' + Object.keys(KINDS).map(function(k){
        return '<button class="ghost mini" data-add="' + k + '">' + KINDS[k].i + ' ' +
          esc(KINDS[k].t) + '</button>';
      }).join('') + '</div>' +
    '</div>' +

    '<div class="card"><div class="row" style="gap:8px">' +
      L('<button id="scSave">Зберегти</button>') +
      L('<button class="ghost" id="scCancel">Скасувати</button>') +
      '<span class="grow"></span>' +
      '<label class="row" style="gap:6px;font-size:12.5px;color:var(--t2)">' +
      '<input type="checkbox" id="scOn" style="width:auto"' + (SC.is_active ? ' checked' : '') +
      L('> увімкнено</label>') +
      '</div><div class="err" id="scErr"></div></div>' +
    '</div>';

  // Собираем значения полей в SC при каждом изменении: иначе правка
  // текста шага терялась бы при добавлении следующего.
  function collect(){
    SC.name = el('scName').value;
    SC.trigger_type = el('scTr').value;
    SC.channel_id = el('scCh').value || null;
    if (el('scKw')) SC.keywords = el('scKw').value.split(',').map(function(x){ return x.trim() })
      .filter(Boolean);
    if (el('scFrom')) SC.schedule = { from: el('scFrom').value, to: el('scTo').value,
      days:[1,2,3,4,5], tzOffset: Number(el('scTz').value) || 0 };
    SC.is_active = el('scOn').checked;
    Array.prototype.forEach.call(pageBox().querySelectorAll('[data-f]'), function(f){
      var st = SC.steps[Number(f.dataset.i)];
      if (!st) return;
      var v = f.value;
      if (f.dataset.f === 'minutes') st.seconds = Math.max(1, Number(v) || 1) * 60;
      else if (f.dataset.f === 'contains') st.contains = v.split(',').map(function(x){ return x.trim() })
        .filter(Boolean);
      else if (f.dataset.f === 'goto' || f.dataset.f === 'elseGoto') {
        if (String(v).trim() === '') delete st[f.dataset.f];
        else st[f.dataset.f] = Math.max(0, (Number(v) || 1) - 1);
      }
      else if (f.dataset.f === 'timeoutMinutes') st.timeoutMinutes = Number(v) || 0;
      else st[f.dataset.f] = v;
    });
  }

  el('scBack').onclick = function(){ SC = null; renderBots() };
  el('scCancel').onclick = function(){ SC = null; renderBots() };
  el('scTr').onchange = function(){ collect(); renderScEditor() };

  Array.prototype.forEach.call(pageBox().querySelectorAll('[data-add]'), function(b){
    b.onclick = function(){
      collect();
      var k = b.dataset.add;
      var blank = { message:{ kind:'message', text:'' },
        ask:{ kind:'ask', text:'' },
        delay:{ kind:'delay', seconds:300 },
        condition:{ kind:'condition', contains:[], goto:0 },
        tag:{ kind:'tag', tag:'' },
        handoff:{ kind:'handoff' },
        close:{ kind:'close' } };
      SC.steps.push(blank[k]);
      renderScEditor();
    };
  });

  Array.prototype.forEach.call(pageBox().querySelectorAll('[data-up]'), function(b){
    b.onclick = function(){
      collect();
      var i = Number(b.dataset.up);
      var t = SC.steps[i - 1]; SC.steps[i - 1] = SC.steps[i]; SC.steps[i] = t;
      renderScEditor();
    };
  });
  Array.prototype.forEach.call(pageBox().querySelectorAll('[data-down]'), function(b){
    b.onclick = function(){
      collect();
      var i = Number(b.dataset.down);
      var t = SC.steps[i + 1]; SC.steps[i + 1] = SC.steps[i]; SC.steps[i] = t;
      renderScEditor();
    };
  });
  Array.prototype.forEach.call(pageBox().querySelectorAll('[data-drop]'), function(b){
    b.onclick = function(){
      collect();
      SC.steps.splice(Number(b.dataset.drop), 1);
      if (!SC.steps.length) SC.steps.push({ kind:'message', text:'' });
      renderScEditor();
    };
  });

  el('scSave').onclick = function(){
    collect();
    el('scErr').textContent = '';
    busy(el('scSave'), true);
    var body = { name: SC.name, triggerType: SC.trigger_type, channelId: SC.channel_id,
      keywords: SC.keywords || [], schedule: SC.schedule || {}, steps: SC.steps,
      isActive: SC.is_active, priority: SC.trigger_type === 'fallback' ? 900 : 100 };
    var req = SC.id
      ? api('/scenarios/' + SC.id, { method:'PUT', body: body })
      : api('/scenarios', { method:'POST', body: body });
    req.then(function(){ SC = null; renderBots(); toast(L('Сценарій збережено')) })
      .catch(function(e){
        var p = e.payload || {};
        el('scErr').textContent = p.detail || L('Не вдалося зберегти');
        busy(el('scSave'), false);
      });
  };
}

/**
 * Удаление подтверждается вторым кликом по той же кнопке, а не окном
 * браузера: окно блокирует страницу и внутри iframe Zoho ведёт себя
 * непредсказуемо.
 */
function armDelete(nodes, action){
  Array.prototype.forEach.call(nodes, function(b){
    var armed = false, label = b.textContent;
    b.onclick = function(){
      if (!armed){
        armed = true; b.textContent = L('Точно?');
        setTimeout(function(){ armed = false; b.textContent = label }, 4000);
        return;
      }
      busy(b, true);
      action(b).catch(function(){ busy(b, false) });
    };
  });
}

/* ══════════════ Настройки ══════════════ */

/* Разделы рисуются в одном контейнере #page. Заголовок страницы
   задаётся здесь, чтобы каждый раздел не собирал его заново. */
function pageHead(title, sub, right){
  return '<div class="pg-head"><div><h2>' + esc(title) + '</h2>' +
    (sub ? '<p>' + sub + '</p>' : '') + '</div>' + (right || '') + '</div>';
}

function pageBox(){ return el('page') }

function sErr(e){
  pageBox().innerHTML = L('<div class="pg"><div class="empty">Не вдалося завантажити: ') +
    esc((e && e.message) || L('помилка')) + '</div></div>';
}

/**
 * Профиль.
 *
 * Было три карточки-колонки с двоеточиями — витрина, на которой ничего
 * нельзя тронуть. Стало обычное представление: шапка с именем и ролью,
 * под ней строки данных, у изменяемых — кнопка «Изменить». Правится на
 * месте, без перехода на другую страницу: правка тут одна-две, и ради
 * неё открывать отдельный экран незачем.
 *
 * Название организации меняет только администратор — это вывеска
 * компании, а не подпись оператора. Почта не меняется вовсе: по ней
 * приходит код входа, и её смена — это смена ключа от аккаунта.
 */
function tabProfile(){
  api('/me').then(function(d){
    ME = d;
    ROLE = (d && d.user && d.user.role) || 'agent';
    applyRole();

    var t = d.tenant || {}, u = d.user || {}, c = d.counts || {};
    var admin = isAdmin();

    pageBox().innerHTML = '<div class="pg">' +
      pageHead(L('Профіль'), L('Ваші дані і дані організації.')) +

      '<div class="prof">' +
      '<div class="prof-av" style="background-color:' + avatarColor(u.full_name || u.email || 'x') + '">' +
        esc(initials(u.full_name || u.email)) + '</div>' +
      '<div style="min-width:0">' +
      '<div class="prof-nm" id="pfName">' + esc(u.full_name || L('Без імені')) + '</div>' +
      '<div class="prof-sub">' + esc(u.email || '') + '</div>' +
      '</div>' +
      '<div class="grow"></div>' +
      '<span class="pill">' + esc(ROLES[u.role] || u.role || '') + '</span>' +
      '</div>' +

      L('<div class="pg-sec"><h3>Ви</h3><div class="card">') +
      row(L('Імʼя'), esc(u.full_name || '—'), 'nm', true) +
      row(L('Пошта'), esc(u.email || '—'), 'em', false,
        L('Пошта — це вхід в акаунт. Змінити її може адміністратор, надіславши запрошення на нову.')) +
      langRow() +
      passRow(u) +
      row(L('Роль'), esc(ROLES[u.role] || u.role || '—'), 'rl', false,
        admin ? L('Ролі роздаються в розділі «Команда».')
              : L('Роль призначає власник або адміністратор.')) +
      row(L('У системі з'), esc(fmtDate(u.created_at)), 'sn', false) +
      '<div class="err" id="pfErr"></div>' +
      '</div></div>' +

      L('<div class="pg-sec"><h3>Організація</h3><div class="card">') +
      row(L('Назва'), esc(t.name || '—'), 'org', admin) +
      row(L('Ідентифікатор'), '<code>' + esc(t.slug || '') + '</code>', 'sl', false,
        L('За ним адреса вашої компанії в сервісі. Вона не змінюється.')) +
      row(L('Тариф'), esc(t.plan || 'trial') + L(' · місць: ') + esc(t.seats_limit), 'pl', false) +
      row(L('Регіон даних'), esc((t.region || 'eu').toUpperCase()), 'rg', false,
        L('Де фізично лежать листування і файли.')) +
      row(L('Підключена'), esc(fmtDate(t.created_at)), 'cr', false) +
      '<div class="err" id="orgErr"></div>' +
      '</div></div>' +

      L('<div class="pg-sec"><h3>Зараз в акаунті</h3>') +
      '<div class="nums">' +
      num(c.channels, L('каналів')) + num(c.users, L('співробітників')) +
      num(c.conversations, L('діалогів')) + num(c.messages, L('повідомлень')) +
      '</div></div>' +
      '</div>';

    wirePass();

    el('langSel').onchange = function(){
      langSet(this.value);
      // Перерисовываем всё, а не только профиль: подписи внутри уже
      // собранных разделов переводятся при сборке, и без этого список
      // чатов и поле ответа оставались на прежнем языке до обновления
      // страницы.
      redrawAll();
    };

    // Правка имени человека.
    if (el('edit-nm')) el('edit-nm').onclick = function(){
      editRow('nm', u.full_name || '', function(value){
        return api('/me', { method:'PATCH', body:{ fullName: value } }).then(function(){
          toast(L('Імʼя змінено'));
          tabProfile();
        });
      }, 'pfErr');
    };

    // Правка названия организации — только у администратора.
    if (el('edit-org')) el('edit-org').onclick = function(){
      editRow('org', t.name || '', function(value){
        return api('/tenant', { method:'PATCH', body:{ name: value } }).then(function(){
          toast(L('Назву змінено'));
          tabProfile();
        });
      }, 'orgErr');
    };
  }).catch(sErr);
}

/**
 * Язык интерфейса.
 *
 * Стоит в профиле, а не в общих настройках компании: язык — дело
 * человека, а не организации. Оператор в Варшаве и владелец в Киеве
 * работают в одном аккаунте и каждый читает на своём.
 */
function langRow(){
  return '<div class="prow"><div class="pk">' + L('Мова') + '</div>' +
    '<div class="pv"><div class="row2" style="max-width:280px">' +
    '<select id="langSel">' + LANGS.map(function(l){
      return '<option value="' + l.id + '"' + (l.id === LANG ? ' selected' : '') + '>' +
        esc(l.title) + '</option>';
    }).join('') + '</select></div>' +
    '<div class="hint" style="margin-top:4px">' +
    L('Вибір запамʼятовується в цьому браузері.') + '</div></div><span></span></div>';
}

/**
 * Пароль.
 *
 * Задаётся тем, кто уже вошёл, и убирается так же. «Забыли пароль»
 * здесь не нужно: код на почту и есть восстановление, и он никуда не
 * девается — пароль только второй способ, для тех, кто заходит каждое
 * утро и не хочет ждать письма.
 */
function passRow(u){
  var set = Boolean(u.password_set_at);
  return '<div class="prow" id="row-pw"><div class="pk">' + L('Пароль') + '</div>' +
    '<div class="pv" id="val-pw">' +
    (set ? L('Задано') : L('Не задано — вхід лише кодом з пошти')) +
    '</div>' +
    '<div style="display:flex;gap:6px;flex:none">' +
    '<button class="ghost mini" id="pwEdit">' + (set ? L('Змінити') : L('Задати')) + '</button>' +
    (set ? '<button class="ghost mini" id="pwOff">' + L('Прибрати') + '</button>' : '') +
    '</div></div>';
}

function wirePass(){
  el('pwEdit').onclick = function(){
    var cell = el('val-pw');
    if (cell.dataset.editing) return;
    cell.dataset.editing = '1';
    el('pwEdit').style.display = 'none';
    cell.innerHTML = '<div class="row2" style="max-width:320px">' +
      '<input id="pwNew" type="password" autocomplete="new-password" placeholder="' +
      L('новий пароль, від 8 знаків') + '"></div>' +
      '<div class="row2" style="margin-top:6px">' +
      '<button class="mini" id="pwSave">' + L('Зберегти') + '</button>' +
      '<button class="ghost mini" id="pwCancel">' + L('Скасувати') + '</button></div>';

    el('pwNew').focus();
    el('pwCancel').onclick = tabProfile;
    el('pwSave').onclick = function(){
      var value = el('pwNew').value;
      busy(el('pwSave'), true);
      api('/me/password', { method:'PUT', body:{ password: value } })
        .then(function(){ toast(L('Пароль збережено')); tabProfile() })
        .catch(function(e){
          var p = e.payload || {};
          el('pfErr').textContent =
            p.reason === 'short' ? L('Пароль коротший за 8 знаків') :
            p.reason === 'weak' ? L('Такий пароль підбирають першим — придумайте інший') :
            L('Не вдалося зберегти');
          busy(el('pwSave'), false);
        });
    };
    el('pwNew').onkeydown = function(e){
      if (e.key === 'Enter') el('pwSave').click();
      if (e.key === 'Escape') tabProfile();
    };
  };

  if (el('pwOff')) armDelete([el('pwOff')], function(){
    return api('/me/password', { method:'DELETE' }).then(function(){
      toast(L('Пароль прибрано'));
      tabProfile();
    });
  });
}

/** Строка данных: подпись, значение, при необходимости — «Изменить». */
function row(label, value, id, editable, hint){
  return '<div class="prow" id="row-' + id + '">' +
    '<div class="pk">' + esc(label) + '</div>' +
    '<div class="pv" id="val-' + id + '">' + value +
      (hint ? '<div class="hint" style="margin-top:2px">' + esc(hint) + '</div>' : '') + '</div>' +
    (editable ? '<button class="ghost mini" id="edit-' + id + L('">Змінити</button>')
              : '<span></span>') +
    '</div>';
}

/** Число с подписью: четыре таких заменяют таблицу из двух колонок. */
function num(value, label){
  return '<div class="numbox"><div class="n">' + esc(value == null ? '—' : value) + '</div>' +
    '<div class="l">' + esc(label) + '</div></div>';
}

/**
 * Правка на месте: строка превращается в поле с кнопками, Enter
 * сохраняет, Esc возвращает как было. Отдельная форма здесь была бы
 * длиннее самой правки.
 */
function editRow(id, value, save, errId){
  var cell = el('val-' + id), btn = el('edit-' + id);
  if (!cell || cell.dataset.editing) return;
  cell.dataset.editing = '1';
  btn.style.display = 'none';
  cell.innerHTML = '<div class="row2"><input id="in-' + id + '"></div>' +
    '<div class="row2" style="margin-top:6px">' +
    '<button class="mini" id="ok-' + id + L('">Зберегти</button>') +
    '<button class="ghost mini" id="no-' + id + L('">Скасувати</button></div>');

  var input = el('in-' + id);
  input.value = value;
  input.focus();
  input.select();

  function done(){ tabProfile() }

  el('no-' + id).onclick = done;
  el('ok-' + id).onclick = function(){
    var v = input.value.trim();
    if (!v){ el(errId).textContent = L('Порожнє значення не зберігається'); return }
    busy(el('ok-' + id), true);
    save(v).catch(function(e){
      var p = e.payload || {};
      el(errId).textContent = p.error === 'forbidden' ? (p.detail || L('Недостатньо прав'))
        : p.error === 'name_required' ? L('Порожнє значення не зберігається')
        : L('Не вдалося зберегти');
      busy(el('ok-' + id), false);
    });
  };
  input.onkeydown = function(e){
    if (e.key === 'Enter') el('ok-' + id).click();
    if (e.key === 'Escape') done();
  };
}

/* ── Каналы ──────────────────────────────────────────────────────
   Отдельная страница: слева плитки подключённых каналов, ниже —
   витрина «подключить». Настройки конкретного канала живут на своей
   странице (openChannel), а не в общем списке: там будут приветствие,
   автоответы и расписание, и в списке им места нет. */

var CH_ICON = { telegram_bot:'TG', telegram_user:'TG', instagram:'IG', messenger:'FB',
  whatsapp:'WA', whatsapp_cloud:'WA', whatsapp_user:'WA', viber_business:'VB', viber_user:'VB',
  webchat:'WEB' };

function chPill(c){
  return c.status === 'active' ? L('<span class="pill ok">працює</span>')
    : c.status === 'degraded' ? L('<span class="pill crit">потрібно перепідключити</span>')
    : L('<span class="pill warn">вимкнений</span>');
}

function chSub(c){
  var bits = [CH[c.type] || c.type];
  if (c.meta && c.meta.username) bits.push('@' + c.meta.username);
  if (c.meta && c.meta.phone) bits.push(c.meta.phone);
  return bits.join(' · ');
}

function tabChannels(){
  api('/channels').then(function(d){
    CHANNELS = d.channels || [];
    fillChannelFilter();

    var tiles = CHANNELS.map(function(c){
      return '<div class="tile click" data-open="' + c.id + '">' +
        '<div class="t1"><div class="chico ' + esc(c.type) + '">' + (CH_ICON[c.type] || '••') + '</div>' +
        '<div style="min-width:0"><div class="ttl">' + esc(c.display_name) + '</div>' +
        '<div class="sub">' + esc(chSub(c)) + '</div></div></div>' +
        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' + chPill(c) +
        (c.last_error ? '<span class="pill crit">' + esc(errLabel(c.last_error)) + '</span>' : '') +
        '</div>' +
        '<div class="stat"><div><b>' + esc(c.conversations) + L('</b>діалогів</div></div>') +
        '<div class="acts"><button class="ghost mini" data-open2="' + c.id + L('">Налаштувати</button>') +
        '<button class="ghost mini" data-toggle="' + c.id + '" data-to="' +
          (c.status === 'active' ? 'disconnected' : 'active') + '">' +
          (c.status === 'active' ? L('Вимкнути') : L('Увімкнути')) + '</button></div></div>';
    }).join('');

    var connect =
      '<div class="tile"><div class="t1"><div class="chico telegram_bot">TG</div>' +
      L('<div><div class="ttl">Telegram-бот</div><div class="sub">Окремий бот для підтримки</div></div></div>') +
      L('<div class="sub" style="white-space:normal">Токен видає <b>@BotFather</b>: /newbot для нового бота ') +
      L('або /token для наявного.</div>') +
      '<div class="row2"><input id="btok" type="password" placeholder="123456789:AAF..." autocomplete="off">' +
      L('<button id="badd">Підключити</button></div>') +
      '<label class="row" style="gap:7px;margin-top:8px;font-size:12px;color:var(--t2);cursor:pointer">' +
      L('<input type="checkbox" id="bown" style="width:auto"> у мене свій бот зі своїм кодом</label>') +
      L('<div class="hint" id="bownHint" style="display:none">Ми не будемо торкатися його вебхука. ') +
      L('Ваш код продовжить отримувати оновлення і надсилатиме нам копію — адресу і секрет ') +
      L('покажемо після підключення.</div>') +
      '<div class="err" id="berr"></div><div class="ok" id="bok"></div>' +
      '<div id="bfwd" style="display:none;margin-top:10px"></div></div>' +

      '<div class="tile" id="metaCard"><div class="t1"><div class="chico instagram">IG</div>' +
      L('<div><div class="ttl">Instagram і Messenger</div><div class="sub">Через сторінку Facebook</div></div></div>') +
      L('<div id="metaBody"><div class="sub" style="white-space:normal">Увійдіть під акаунтом, який керує ') +
      L('сторінкою. Instagram має бути професійним акаунтом і привʼязаний до цієї сторінки.</div>') +
      L('<div class="acts"><button id="metaGo">Увійти через Facebook</button></div>') +
      '<div class="err" id="metaErr"></div></div></div>' +

      '<div class="tile"><div class="t1"><div class="chico telegram_user">TG</div>' +
      L('<div><div class="ttl">Telegram за номером</div><div class="sub">Особистий або робочий акаунт</div></div></div>') +
      L('<div class="sub" style="white-space:normal">Клієнти пишуть на ваш номер як завжди, листування зʼявляється тут, ') +
      L('відповіді йдуть від вашого імені.</div>') +
      L('<div class="row2"><input id="uname" placeholder="Назва, наприклад: Продажі" autocomplete="off">') +
      L('<button id="uqr">Показати QR-код</button></div><div id="uqrbox"></div></div>') +

      '<div class="tile"><div class="t1"><div class="chico viber_business">VB</div>' +
      L('<div><div class="ttl">Viber для бізнесу</div><div class="sub">Імʼя відправника замість номера</div></div></div>') +
      L('<div class="sub" style="white-space:normal">Клієнти пишуть у Viber на назву вашої компанії, ') +
      L('листування зʼявляється тут. Підключення — через офіційного партнера <b>TurboSMS</b>.</div>') +
      L('<div class="hint">Ключ API і погоджене імʼя відправника — у кабінеті партнера, розділ Viber. ') +
      L('Відповідати можна добу після повідомлення клієнта: далі Viber закриває сесію.</div>') +
      '<div class="row2"><input id="vbToken" type="password" placeholder="API key" autocomplete="off">' +
      L('<input id="vbSender" placeholder="Імʼя відправника"></div>') +
      L('<div class="acts"><button id="vbGo">Підключити</button></div>') +
      '<div class="err" id="vbErr"></div></div>' +

      '<div class="tile"><div class="t1"><div class="chico webchat">WEB</div>' +
      L('<div><div class="ttl">Чат на сайті</div><div class="sub">Кнопка на ваших сторінках</div></div></div>') +
      L('<div class="sub" style="white-space:normal">Створюється за секунду: ми даємо один рядок коду, ') +
      L('ви вставляєте його на сайт. Переписка живе на нашому домені, тож чужі скрипти її не бачать.</div>') +
      L('<div class="acts"><button id="wcGo">Створити віджет</button></div>') +
      '<div class="err" id="wcErr"></div></div>' +

      '<div class="tile"><div class="t1"><div class="chico whatsapp">WA</div>' +
      L('<div><div class="ttl">WhatsApp Business</div><div class="sub">Номер компанії через Cloud API</div></div></div>') +
      L('<div class="sub" style="white-space:normal">Потрібні токен і <b>Phone number ID</b> з кабінету ') +
      L('Meta for Developers: розділ WhatsApp → API Setup. Там же вкажіть адресу вебхука ') +
      L('(вона у розділі «Інтеграції»).</div>') +
      '<div class="row2"><input id="waTok" type="password" placeholder="EAAG..." autocomplete="off">' +
      '<input id="waNum" placeholder="Phone number ID" autocomplete="off"></div>' +
      L('<div class="acts"><button id="waGo">Підключити</button></div>') +
      L('<div class="hint">Поза вікном 24 годин WhatsApp дозволяє лише погоджені шаблони — ') +
      L('вони підтягнуться з вашого акаунта самі.</div>') +
      '<div class="err" id="waErr"></div></div>' +

      ['whatsapp_user','viber_user'].map(function(t){
        return '<div class="tile"><div class="t1"><div class="chico soon">' + (CH_ICON[t] || '••') + '</div>' +
          '<div><div class="ttl">' + esc(CH[t]) + '</div>' +
          L('<div class="sub">Готується</div></div></div>') +
          L('<div class="acts"><button class="ghost mini" disabled>Скоро</button></div></div>');
      }).join('');

    pageBox().innerHTML = '<div class="pg">' +
      pageHead(L('Канали'), L('Месенджери, з яких надходять повідомлення. У кожного каналу свої налаштування: ') +
        L('привітання, автовідповіді і робочі години.')) +
      (CHANNELS.length
        ? L('<div class="pg-sec"><h3>Підключено · ') + CHANNELS.length + '</h3><div class="grid">' + tiles + '</div></div>'
        : '') +
      L('<div class="pg-sec"><h3>Підключити канал</h3><div class="grid">') + connect + '</div></div>' +
      '</div>';

    el('uqr').onclick = function(){ startTgUser(el('uname').value.trim()) };

    if (el('wcGo')) el('wcGo').onclick = function(){
      busy(el('wcGo'), true);
      api('/settings/channels/webchat', { method:'POST' })
        .then(function(d){ toast(L('Віджет створено')); openChannel(d.channelId) })
        .catch(function(){
          el('wcErr').textContent = L('Не вдалося створити');
          busy(el('wcGo'), false);
        });
    };

    if (el('waGo')) el('waGo').onclick = function(){
      el('waErr').textContent = '';
      busy(el('waGo'), true);
      api('/settings/channels/whatsapp', { method:'POST', body:{
        token: el('waTok').value.trim(), phoneNumberId: el('waNum').value.trim()
      }})
        .then(function(){ toast(L('WhatsApp підключено')); tabChannels() })
        .catch(function(e){
          el('waErr').textContent = ((e.payload||{}).detail) || L('Не вдалося підключити');
          busy(el('waGo'), false);
        });
    };

    if (el('vbGo')) el('vbGo').onclick = function(){
      el('vbErr').textContent = '';
      busy(el('vbGo'), true);
      api('/settings/channels/viber', { method:'POST', body:{
        token: el('vbToken').value.trim(), sender: el('vbSender').value.trim()
      }})
        .then(function(){ toast(L('Viber підключено')); tabChannels() })
        .catch(function(e){
          var p = e.payload || {};
          el('vbErr').textContent = p.detail || L('Не вдалося підключити');
          busy(el('vbGo'), false);
        });
    };
    el('metaGo').onclick = startMeta;
    if (S.metaError && !S.metaPick) { el('metaErr').textContent = S.metaError; S.metaError = null; }
    if (S.metaPick) showMetaPick(S.metaPick);

    el('bown').onchange = function(){
      el('bownHint').style.display = this.checked ? 'block' : 'none';
    };

    el('badd').onclick = function(){
      var token = el('btok').value.trim();
      var own = el('bown').checked;
      el('berr').textContent = ''; el('bok').textContent = '';
      if (!token) return;
      busy(el('badd'), true);
      api('/settings/channels/telegram', { method:'POST',
        body: own ? { botToken: token, mode: 'forward' } : { botToken: token } })
        .then(function(r){
          el('bok').textContent = L('Готово: @') + (r.username || L('бот')) +
            (r.mode === 'forward' ? L(' (свій бот)')
              : r.mode === 'polling' ? L(' (режим опитування)') : L(' (вебхук)'));
          el('btok').value = '';

          // Свой бот: показываем, куда слать копию обновлений. Список
          // каналов не перерисовываем — иначе адрес с секретом исчезнет
          // с экрана раньше, чем человек успеет их скопировать.
          if (r.mode === 'forward' && r.forward) {
            el('bfwd').style.display = 'block';
            el('bfwd').innerHTML =
              L('<div class="hint" style="margin:0 0 6px">У своєму боті на кожне оновлення ') +
              L('надішліть його ж тілом на цю адресу, із заголовком секрета. Відповіді можна надсилати ') +
              L('і з вашого коду, і з Rozmovio — токен один.</div>') +
              '<div class="kv2">' +
              L('<div class="k">Адреса</div><div><code id="fwdUrl">') + esc(r.forward.url) + '</code></div>' +
              L('<div class="k">Заголовок</div><div><code>') + esc(r.forward.header) + '</code></div>' +
              L('<div class="k">Секрет</div><div><code id="fwdSec">') + esc(r.forward.secret) + '</code></div>' +
              '</div>' +
              '<div class="row2" style="margin-top:8px">' +
              L('<button class="ghost mini" id="fwdCopy">Скопіювати адресу і секрет</button>') +
              L('<button class="ghost mini" id="fwdDone">Готово</button></div>');

            el('fwdCopy').onclick = function(){
              var text = 'URL: ' + r.forward.url + NL +
                r.forward.header + ': ' + r.forward.secret;
              if (navigator.clipboard) navigator.clipboard.writeText(text)
                .then(function(){ toast(L('Скопійовано')) });
              else {
                var t = document.createElement('textarea');
                t.value = text; document.body.appendChild(t); t.select();
                document.execCommand('copy'); document.body.removeChild(t);
                toast(L('Скопійовано'));
              }
            };
            el('fwdDone').onclick = tabChannels;
            return;
          }
          setTimeout(tabChannels, 900);
        })
        .catch(function(e){
          var p = e.payload || {};
          el('berr').textContent = p.detail ||
            (p.error === 'telegram_rejected_token'
              ? L('Telegram не прийняв токен — перевірте, що скопійований цілком')
              : p.error === 'invalid_bot_token' ? L('Не схоже на токен бота')
              : L('Не вдалося підключити'));
          busy(el('badd'), false);
        });
    };

    Array.prototype.forEach.call(pageBox().querySelectorAll('[data-toggle]'), function(b){
      b.onclick = function(ev){
        ev.stopPropagation();
        busy(b, true);
        api('/channels/' + b.dataset.toggle, { method:'PATCH', body:{ status: b.dataset.to } })
          .then(tabChannels).catch(function(){ busy(b, false) });
      };
    });
    Array.prototype.forEach.call(pageBox().querySelectorAll('[data-open],[data-open2]'), function(b){
      b.onclick = function(ev){
        ev.stopPropagation();
        openChannel(b.dataset.open || b.dataset.open2);
      };
    });
  }).catch(sErr);
}

/* Страница одного канала: всё, что относится к нему, в одном месте. */
/* ── Чат на сайте ─────────────────────────────────────────────────
   Главное здесь — код для вставки: ради него человек и открывает эту
   страницу. Поэтому он стоит первым и копируется одной кнопкой, а
   настройки — цвет, приветствие, домены — идут следом. */

function wcPanel(id){
  api('/channels/' + id + '/webchat').then(function(d){
    var st = d.settings || {};
    el('wcBox').innerHTML =
      L('<div class="pg-sec"><h3>Код для сайту</h3><div class="tile">') +
      L('<div class="sub" style="white-space:normal">Вставте цей рядок перед закриваючим тегом ') +
      '&lt;/body&gt;' + L(' на кожній сторінці, де потрібен чат. Кнопка зʼявиться у правому нижньому куті.</div>') +
      '<pre class="snip" id="wcSnip">' + esc(d.snippet) + '</pre>' +
      L('<div class="acts"><button class="ghost mini" id="wcCopy">Скопіювати</button>') +
      L('<button class="ghost mini" id="wcOpen">Подивитися</button></div>') +
      L('<div class="sub" style="white-space:normal;margin-top:10px">Якщо чат потрібен прямо у сторінці, ') +
      L('а не кнопкою — цей варіант:</div>') +
      '<pre class="snip" id="wcFrame">' + esc(d.iframe) + '</pre>' +
      L('<div class="acts"><button class="ghost mini" id="wcCopy2">Скопіювати рамку</button></div>') +
      '<div class="ok" id="wcOk"></div></div></div>' +

      L('<div class="pg-sec"><h3>Вигляд і доступ</h3><div class="tile">') +
      L('<div class="row2"><div class="lbl" style="width:150px">Заголовок</div>') +
      '<input id="wcTitle" value="' + esc(st.title || '') + '"></div>' +
      L('<div class="row2"><div class="lbl" style="width:150px">Привітання</div>') +
      '<input id="wcGreet" value="' + esc(st.greeting || '') + '"></div>' +
      L('<div class="row2"><div class="lbl" style="width:150px">Колір</div>') +
      '<input id="wcColor" type="color" value="' + esc(st.color || '#2F6BFF') + '" style="max-width:80px"></div>' +
      L('<div class="row2"><div class="lbl" style="width:150px">Дозволені домени</div>') +
      '<input id="wcDom" placeholder="example.com, shop.example.com" value="' +
        esc((st.domains || []).join(', ')) + '"></div>' +
      L('<div class="hint">Порожньо — віджет працює будь-де. Список доменів рятує від забутого ') +
      L('віджета на тестовому сайті, але це не захист: адресу сторінки повідомляє браузер.</div>') +
      L('<div class="acts"><button id="wcSave">Зберегти</button></div>') +
      '<div class="ok" id="wcOk2"></div></div></div>';

    el('wcCopy').onclick = function(){ wcCopy(d.snippet, 'wcOk') };
    el('wcCopy2').onclick = function(){ wcCopy(d.iframe, 'wcOk') };
    el('wcOpen').onclick = function(){ window.open('/chat/' + d.siteKey, '_blank', 'noopener') };

    el('wcSave').onclick = function(){
      busy(el('wcSave'), true);
      api('/channels/' + id + '/webchat', { method:'PATCH', body:{
        title: el('wcTitle').value.trim(),
        greeting: el('wcGreet').value.trim(),
        color: el('wcColor').value,
        domains: el('wcDom').value
      }})
        .then(function(){
          el('wcOk2').textContent = L('Збережено');
          return api('/channels').then(function(r){ CHANNELS = r.channels || [] });
        })
        .catch(function(){ el('wcOk2').textContent = L('Не вдалося зберегти') })
        .then(function(){ busy(el('wcSave'), false) });
    };
  }).catch(function(){
    el('wcBox').innerHTML = L('<div class="pg-sec"><div class="empty">Не вдалося завантажити код віджета.</div></div>');
  });
}

/* Буфер обмена доступен не везде: в старом браузере и по http его нет.
   Поэтому запасной путь через скрытое поле, а не молчание. */
function wcCopy(text, okId){
  var done = function(){ el(okId).textContent = L('Скопійовано') };
  if (navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(done).catch(function(){ wcCopyOld(text, done) });
  } else {
    wcCopyOld(text, done);
  }
}

function wcCopyOld(text, done){
  var a = document.createElement('textarea');
  a.value = text;
  a.style.position = 'fixed';
  a.style.opacity = '0';
  document.body.appendChild(a);
  a.select();
  try { document.execCommand('copy'); done() } catch(e){}
  document.body.removeChild(a);
}


function openChannel(id){
  var c = null;
  for (var i = 0; i < CHANNELS.length; i++) if (CHANNELS[i].id === id) c = CHANNELS[i];
  if (!c) return tabChannels();
  S.channelId = id;

  var meta = c.meta || {};
  var rows = [
    [L('Тип каналу'), esc(CH[c.type] || c.type)],
    [L('Стан'), chPill(c)],
    [L('Ідентифікатор у провайдера'), '<code>' + esc(c.external_id) + '</code>'],
    [L('Діалогів'), esc(c.conversations)],
    [L('Підключений'), esc(fmtDate(c.created_at))]
  ];
  if (meta.username) rows.splice(2, 0, [L('Імʼя користувача'), '@' + esc(meta.username)]);
  if (meta.phone) rows.splice(2, 0, [L('Номер'), esc(meta.phone)]);
  if (meta.pageName) rows.splice(2, 0, [L('Сторінка Facebook'), esc(meta.pageName)]);
  if (c.last_error) rows.push([L('Остання помилка'), '<span class="pill crit">' + esc(errLabel(c.last_error)) + '</span>']);

  pageBox().innerHTML = '<div class="pg">' +
    L('<button class="back-link" id="chBack">← Всі канали</button>') +
    pageHead(c.display_name, esc(chSub(c)),
      '<div class="row2"><button class="ghost mini" id="chToggle">' +
      (c.status === 'active' ? L('Вимкнути') : L('Увімкнути')) + '</button>' +
      L('<button class="ghost mini" id="chDel">Видалити</button></div>')) +

    L('<div class="pg-sec"><h3>Назва в інтерфейсі</h3>') +
    '<div class="tile"><div class="row2"><input id="chName" value="' + esc(c.display_name) + '">' +
    L('<button id="chSave">Зберегти</button></div>') +
    L('<div class="sub" style="white-space:normal">Так канал називається у списку чатів і у фільтрах. ') +
    L('У клієнта назву не видно.</div><div class="ok" id="chOk"></div></div></div>') +

    L('<div class="pg-sec"><h3>Про канал</h3><div class="tile"><div class="kv">') +
    rows.map(function(r){ return '<div class="k">' + r[0] + '</div><div>' + r[1] + '</div>' }).join('') +
    '</div></div></div>' +

    (c.type === 'webchat' ? '<div id="wcBox"></div>' : '') +

    L('<div class="pg-sec"><h3>Автоматизація</h3><div class="grid">') +
    '<div class="tile click" id="chFlows"><div class="t1"><div class="chico soon">⚡</div>' +
    L('<div><div class="ttl">Сценарії цього каналу</div>') +
    L('<div class="sub">Привітання, автовідповіді, ланцюжки</div></div></div>') +
    L('<div class="sub" style="white-space:normal">Правила і ланцюжки, які спрацьовують на повідомлення ') +
    L('саме в цьому каналі.</div>') +
    L('<div class="acts"><button class="ghost mini">Відкрити сценарії</button></div></div>') +
    '</div></div></div>';

  if (c.type === 'webchat') wcPanel(id);

  el('chBack').onclick = tabChannels;
  el('chFlows').onclick = function(){ setView('bots') };
  el('chSave').onclick = function(){
    busy(el('chSave'), true);
    api('/channels/' + id, { method:'PATCH', body:{ displayName: el('chName').value.trim() } })
      .then(function(){
        el('chOk').textContent = L('Збережено');
        return api('/channels').then(function(d){ CHANNELS = d.channels || []; fillChannelFilter() });
      })
      .catch(function(){ el('chOk').textContent = '' })
      .then(function(){ busy(el('chSave'), false) });
  };
  el('chToggle').onclick = function(){
    busy(el('chToggle'), true);
    api('/channels/' + id, { method:'PATCH',
      body:{ status: c.status === 'active' ? 'disconnected' : 'active' } })
      .then(function(){ return api('/channels') })
      .then(function(d){ CHANNELS = d.channels || []; openChannel(id) })
      .catch(function(){ busy(el('chToggle'), false) });
  };
  armDelete([el('chDel')], function(){
    return api('/channels/' + id, { method:'DELETE' }).then(tabChannels);
  });
}

/* ── Интеграции ─────────────────────────────────────────────────── */
/**
 * Интеграции.
 *
 * Пока здесь одна Zoho, но страница сделана как список: вторая CRM
 * встанет рядом без перекладывания разметки.
 *
 * Подключение идёт через вход в Zoho под аккаунтом клиента: приложение
 * в консоли Zoho наше, организация у каждого своя. Дата-центр Zoho
 * подставляет сама при возврате — поэтому клиент из любой страны
 * подключается той же кнопкой.
 */
/** Адрес виджета: тот же сервер, на котором открыто приложение. */
function WIDGET_URL(){ return location.origin + '/widget' }

/**
 * Провайдеры, которых мы умеем спрашивать.
 *
 * Две дороги, а не одна: у OpenAI и всех, кто повторяет его API,
 * общий адрес /chat/completions; у Gemini свой формат запроса и свой
 * заголовок с ключом. Всё остальное здесь — подсказки человеку: где
 * взять ключ и что вписать в поля, если он не знает.
 */
var AI_PROVIDERS = [
  { id:'openai', title:L('OpenAI і сумісні (OpenRouter, Groq, своя модель)'),
    baseUrl:'https://api.openai.com/v1', model:'gpt-4o-mini', keyHint:'sk-…',
    where:L('Ключ — у кабінеті OpenAI, розділ API keys. Для OpenRouter або Groq поміняйте адресу ') +
      L('на їх і візьміть ключ у них.') },
  { id:'gemini', title:'Google Gemini',
    baseUrl:'https://generativelanguage.googleapis.com/v1beta', model:'gemini-3.8-flash',
    keyHint:'AIza…',
    where:L('Ключ — у Google AI Studio, кнопка «Get API key». Адресу змінювати не потрібно.') }
];

function provDefaults(id){
  for (var i = 0; i < AI_PROVIDERS.length; i++){
    if (AI_PROVIDERS[i].id === id) return AI_PROVIDERS[i];
  }
  return AI_PROVIDERS[0];
}

/**
 * Раздел «ИИ» на странице интеграций.
 *
 * Ключ вводится один раз и больше не показывается — в поле остаётся
 * хвост, чтобы человек понимал, тот ли ключ записан. Режим по
 * умолчанию «черновик»: модель пишет подсказку оператору и ничего не
 * отправляет сама. Автоответ включается осознанно.
 */
function aiSection(ai){
  var modes = [
    ['off', L('Вимкнений')],
    ['draft', L('Чернетка оператору')],
    ['auto', L('Відповідає клієнту сам')]
  ];
  var mode = ai.mode || 'draft';
  var prov = ai.provider || 'openai';

  return L('<div class="pg-sec"><h3>ШІ-відповіді</h3><div class="card">') +
    L('<div class="t" style="display:flex;align-items:center;gap:8px">Своя модель') +
    (ai.connected ? L('<span class="pill good">підключена</span>')
                  : L('<span class="pill">не підключена</span>')) + '</div>' +
    '<div class="s" style="color:var(--t2);line-height:1.7;margin-top:6px">' +
    L('Ключ ваш: ви платите провайдеру напряму і бачите витрати в себе. Підходять Google Gemini ') +
    L('і все, що говорить мовою OpenAI — сам OpenAI, OpenRouter, Groq, своя модель на сервері.</div>') +

    L('<div class="row2" style="margin-top:10px"><label class="lbl">Провайдер</label>') +
    '<select id="aiProv">' +
    AI_PROVIDERS.map(function(p){
      return '<option value="' + p.id + '"' + (p.id === prov ? ' selected' : '') + '>' +
        p.title + '</option>';
    }).join('') + '</select></div>' +

    L('<div class="row2" style="margin-top:9px"><label class="lbl">Адреса API</label>') +
    '<input id="aiUrl" placeholder="' + esc(provDefaults(prov).baseUrl) + '" value="' +
      esc(ai.baseUrl || provDefaults(prov).baseUrl) + '"></div>' +

    L('<div class="row2" style="margin-top:9px"><label class="lbl">Модель</label>') +
    '<input id="aiModel" placeholder="' + esc(provDefaults(prov).model) + '" value="' +
      esc(ai.model || provDefaults(prov).model) + '"></div>' +

    L('<div class="row2" style="margin-top:9px"><label class="lbl">Ключ</label>') +
    '<input id="aiKey" type="password" autocomplete="new-password" placeholder="' +
      (ai.keyHint ? L('записаний ') + esc(ai.keyHint) + L(' — залиште порожнім, щоб не змінювати')
                  : esc(provDefaults(prov).keyHint)) +
      '"></div>' +
    '<div class="hint" id="aiWhere">' + provDefaults(prov).where + '</div>' +

    L('<div class="row2" style="margin-top:9px"><label class="lbl">Про компанію</label>') +
    L('<textarea id="aiPrompt" rows="5" placeholder="Що продаєте, ціни, доставка, години роботи, ') +
      L('чого говорити не можна. Чим конкретніше — тим менше вигадок.">') +
      esc(ai.systemPrompt || '') + '</textarea></div>' +

    L('<div class="row2" style="margin-top:9px"><label class="lbl">Режим</label><select id="aiMode">') +
    modes.map(function(m){
      return '<option value="' + m[0] + '"' + (m[0] === mode ? ' selected' : '') + '>' + m[1] + '</option>';
    }).join('') + '</select></div>' +

    L('<div class="hint">У режимі «відповідає сам» ШІ вмикається тільки там, де не спрацював жоден ') +
    L('сценарій, і мовчить, якщо за діалог взявся оператор або розмова пішла про гроші, повернення ') +
    L('або скаргу — таке завжди залишається людині.</div>') +

    '<div class="acts" style="margin-top:10px">' +
    L('<button id="aiSave">Зберегти</button>') +
    (ai.connected ? L('<button class="ghost" id="aiCheck">Перевірити звʼязок</button>') +
                    L('<button class="ghost" id="aiOff">Відключити</button>') : '') +
    '</div>' +
    '<div class="err" id="aiErr">' + esc(ai.lastError || '') + '</div>' +
    '<div class="ok" id="aiOk"></div>' +
    '</div></div>';
}

function wireAi(ai){
  // Смена провайдера подставляет его адрес и модель — но только если
  // человек не вписал своё: затирать введённое руками нельзя.
  el('aiProv').onchange = function(){
    var d = provDefaults(this.value);
    var urlField = el('aiUrl'), modelField = el('aiModel');
    var known = AI_PROVIDERS.map(function(p){ return provDefaults(p.id) });
    var urlIsPreset = !urlField.value || known.some(function(x){ return x.baseUrl === urlField.value });
    var modelIsPreset = !modelField.value || known.some(function(x){ return x.model === modelField.value });
    if (urlIsPreset) urlField.value = d.baseUrl;
    if (modelIsPreset) modelField.value = d.model;
    urlField.placeholder = d.baseUrl;
    modelField.placeholder = d.model;
    el('aiWhere').textContent = d.where;
    if (!ai.keyHint) el('aiKey').placeholder = d.keyHint;
  };

  el('aiSave').onclick = function(){
    el('aiErr').textContent = ''; el('aiOk').textContent = '';
    busy(el('aiSave'), true);
    api('/settings/ai', { method:'PUT', body:{
      provider: el('aiProv').value,
      baseUrl: el('aiUrl').value,
      model: el('aiModel').value,
      apiKey: el('aiKey').value,
      systemPrompt: el('aiPrompt').value,
      mode: el('aiMode').value
    }}).then(function(){ toast(L('ШІ збережено')); pageIntegrations() })
      .catch(function(e){
        var p = e.payload || {};
        el('aiErr').textContent =
          p.error === 'key_required' ? L('Введіть ключ — без нього модель не відповість') :
          p.error === 'model_required' ? L('Вкажіть модель, наприклад gpt-4o-mini') :
          p.error === 'bad_url' ? L('Адреса повинна починатися з https://') :
          L('Не вдалося зберегти');
        busy(el('aiSave'), false);
      });
  };

  if (el('aiCheck')) el('aiCheck').onclick = function(){
    el('aiErr').textContent = ''; el('aiOk').textContent = '';
    busy(el('aiCheck'), true);
    api('/settings/ai/check', { method:'POST' })
      .then(function(r){ el('aiOk').textContent = L('Модель відповіла: ') + (r.sample || L('ок')) })
      .catch(function(e){
        var p = e.payload || {};
        el('aiErr').textContent = p.detail || L('Провайдер не відповів');
      })
      .then(function(){ busy(el('aiCheck'), false) });
  };

  if (el('aiOff')) armDelete([el('aiOff')], function(){
    return api('/settings/ai', { method:'DELETE' }).then(pageIntegrations);
  });
}

/**
 * Интеграции.
 *
 * Все CRM на этой странице выглядят одинаково: значок, название,
 * состояние и действия. Раньше Zoho занимала блок втрое больше
 * остальных — не потому что важнее, а потому что её карточка собиралась
 * отдельно. Разный размер читается как разная важность, и человек
 * ищет глазами, где же тут остальные.
 */
/** Адрес панели для карточки Pipedrive. */
function PANEL_URL(){ return location.origin + '/widget/pipedrive' }

function crmCard(opts){
  return '<div class="card int">' +
    '<div class="int-h">' +
    '<div class="chico ' + opts.icon + '">' + opts.mark + '</div>' +
    '<div style="min-width:0"><div class="int-t">' + esc(opts.title) + '</div>' +
    '<div class="int-s">' + esc(opts.sub) + '</div></div>' +
    '<div class="grow"></div>' + (opts.pill || '') + '</div>' +
    (opts.body ? '<div class="int-b">' + opts.body + '</div>' : '') +
    (opts.acts ? '<div class="int-a">' + opts.acts + '</div>' : '') +
    '</div>';
}

function pageIntegrations(){
  Promise.all([
    api('/settings/zoho'),
    api('/settings/ai').catch(function(){ return null }),
    api('/settings/crm').catch(function(){ return null })
  ]).then(function(res){
    var d = res[0], ai = res[1] || {}, crm = (res[2] && res[2].connections) || [];
    var list = d.installations || [];
    var bx = null, pd = null;
    crm.forEach(function(c){ if (c.kind === 'bitrix24') bx = c; if (c.kind === 'pipedrive') pd = c });

    // ── Zoho ──────────────────────────────────────────────────────
    var zohoBody = !d.configured
      ? L('<div class="int-s" style="white-space:normal">Підключення ще не налаштоване на сервері: ') +
        L('не задані ключі застосунку Zoho.</div>')
      : list.length
        ? list.map(function(z){
            return '<div class="int-row"><div style="min-width:0">' +
              '<div class="int-n">' + esc(z.org_name || L('Організація Zoho')) + '</div>' +
              '<div class="int-s">' + esc(z.api_domain || '') + ' · id ' + esc(z.zgid) + '</div></div>' +
              '<div class="int-rb">' +
              '<button class="ghost mini" data-zcheck="' + z.id + L('">Перевірити</button>') +
              '<button class="ghost mini" data-zdel="' + z.id + L('">Відключити</button></div></div>');
          }).join('')
        : L('<div class="int-s" style="white-space:normal">Увійдіть під акаунтом Zoho тієї ') +
          L('організації, з якою працюєте: ми попросимо доступ до контактів і лідів — рівно ') +
          L('стільки, щоб знайти клієнта за номером і створити нового.</div>');

    var zoho = crmCard({
      icon:'zoho', mark:'Z', title:'Zoho CRM', sub:L('Листування прямо в картці клієнта'),
      pill: list.length ? L('<span class="pill good">підключена</span>')
                        : L('<span class="pill">не підключена</span>'),
      body: zohoBody,
      acts: d.configured
        ? '<button id="zGo">' + (list.length ? L('Підключити ще організацію') : L('Увійти через Zoho')) +
          '</button><span class="err" id="zErr"></span><span class="ok" id="zOk"></span>'
        : ''
    });

    // ── Битрикс24 ─────────────────────────────────────────────────
    var bxBody = bx
      ? '<div class="int-row"><div style="min-width:0">' +
        '<div class="int-n">' + esc(bx.title) + '</div>' +
        '<div class="int-s">' + (bx.lastError ? esc(bx.lastError) : L('ліди йдуть сюди')) + '</div>' +
        '</div><div class="int-rb">' +
        '<button class="ghost mini" data-crmcheck="' + bx.id + L('">Перевірити</button>') +
        '<button class="ghost mini" data-crmdel="' + bx.id + L('">Відключити</button></div></div>')
      : L('<div class="int-s" style="white-space:normal">Підходить і хмара, і коробка на своєму ') +
        L('сервері — відрізняється тільки адреса. У Бітріксі: <b>Розробникам → Інше → ') +
        L('Вхідний вебхук</b>, права <b>crm</b>. Скопіюйте адресу вебхука сюди.</div>') +
        '<div class="row2" style="margin-top:9px">' +
        L('<input id="bxUrl" placeholder="https://компанія.bitrix24.ua/rest/1/ключ/">') +
        L('<button id="bxAdd">Підключити</button></div>');

    var bxSoon = '<div class="hint" style="margin-top:10px">' +
      L('Переписка в «Відкритих лініях» Бітрікса — скоро. Зараз листування живе в Rozmovio, ') +
      L('а в Бітрікс їде картка клієнта і лід.') + '</div>';

    var bitrix = crmCard({
      icon:'bitrix', mark:'B24', title:L('Бітрікс24'), sub:L('Хмара і коробка'),
      pill: bx ? (bx.status === 'active' ? L('<span class="pill good">підключений</span>')
                                         : L('<span class="pill warn">потрібно перепідключити</span>'))
               : L('<span class="pill">не підключений</span>'),
      body: bxBody + bxSoon,
      acts: '<span class="err" id="bxErr"></span><span class="ok" id="bxOk"></span>'
    });

    // ── Pipedrive ─────────────────────────────────────────────────
    var pdBody = pd
      ? '<div class="int-row"><div style="min-width:0">' +
        '<div class="int-n">' + esc(pd.title) + '</div>' +
        '<div class="int-s">' + (pd.lastError ? esc(pd.lastError) : L('ліди йдуть сюди')) + '</div>' +
        '</div><div class="int-rb">' +
        '<button class="ghost mini" data-crmcheck="' + pd.id + L('">Перевірити</button>') +
        '<button class="ghost mini" data-crmdel="' + pd.id + L('">Відключити</button></div></div>')
      : L('<div class="int-s" style="white-space:normal">Токен — у Pipedrive: ') +
        L('<b>Особисті налаштування → API</b>. Домен компанії видно в адресному рядку.</div>') +
        '<div class="row2" style="margin-top:9px">' +
        L('<input id="pdDom" placeholder="компанія.pipedrive.com">') +
        L('<input id="pdTok" type="password" autocomplete="new-password" placeholder="токен API">') +
        L('<button id="pdAdd">Підключити</button></div>');

    // Панель живёт только у установленного приложения — подключение по
    // токену для неё не годится, это разные вещи.
    var pdPanel = pd
      ? '<div class="hint" style="margin-top:10px">' +
        L('Панель Rozmovio в картці клієнта: створіть застосунок у Pipedrive Developer Hub, ') +
        L('у розділі App extensions додайте Custom panel з адресою ') +
        '<code id="pdurl">' + esc(PANEL_URL()) + '</code> ' +
        '<button class="ghost mini" id="pdcopy">' + L('Скопіювати') + '</button>' +
        L(', а потім натисніть «Встановити застосунок».') + '</div>' +
        '<div class="acts" style="margin-top:8px">' +
        '<button class="ghost" id="pdInstall">' + L('Встановити застосунок') + '</button></div>'
      : '';

    var pipedrive = crmCard({
      icon:'pipedrive', mark:'PD', title:'Pipedrive', sub:L('Клієнт і угода у воронці'),
      pill: pd ? (pd.status === 'active' ? L('<span class="pill good">підключений</span>')
                                         : L('<span class="pill warn">потрібно перепідключити</span>'))
               : L('<span class="pill">не підключений</span>'),
      body: pdBody + pdPanel,
      acts: '<span class="err" id="pdErr"></span><span class="ok" id="pdOk"></span>'
    });

    pageBox().innerHTML = '<div class="pg">' +
      pageHead(L('Інтеграції'), L('Rozmovio живе поряд з вашою CRM: листування видно в картці ') +
        L('клієнта, а нові звернення перетворюються на ліди.')) +

      '<div class="pg-sec"><h3>CRM</h3>' + zoho + bitrix + pipedrive + '</div>' +

      (list.length
        ? L('<div class="pg-sec"><h3>Віджет у картці клієнта</h3><div class="card">') +
          L('<div class="int-s" style="white-space:normal;line-height:1.7">Zoho створює віджети ') +
          L('тільки зі своїх налаштувань — програмно їх створити не можна. Це робиться один раз і ') +
          L('займає хвилину.</div>') +
          '<ol class="steps" style="margin-top:10px">' +
          L('<li>У Zoho CRM: <b>Налаштування</b> (шестерня) → <b>Developer Space</b> → ') +
          '<b>Widgets</b> → <b>Create Widget</b>.</li>' +
          L('<li>Імʼя — <b>Rozmovio</b>, тип — <b>Related List</b>, хостинг — <b>External</b>.</li>') +
          L('<li>Base URL — ось ця адреса: <code id="wurl">') + esc(WIDGET_URL()) + '</code> ' +
          L('<button class="ghost mini" id="wcopy">Скопіювати</button></li>') +
          L('<li>Зберегти. Потім <b>Налаштування → Модулі і поля → Контакти → Звʼязані списки</b> ') +
          L('і додати <b>Rozmovio</b>. Те саме для модуля <b>Ліди</b>.</li>') +
          '</ol></div></div>'
        : '') +

      aiSection(ai) +
      '</div>';

    wireAi(ai);

    if (S.zohoNote){ el('zOk').textContent = S.zohoNote; S.zohoNote = null }
    if (S.zohoError){ el('zErr').textContent = S.zohoError; S.zohoError = null }

    if (el('zGo')) el('zGo').onclick = function(){
      busy(el('zGo'), true);
      api('/settings/zoho/start').then(function(r){ location.href = r.url })
        .catch(function(){
          busy(el('zGo'), false);
          el('zErr').textContent = L('Не вдалося почати підключення');
        });
    };

    if (el('wcopy')) el('wcopy').onclick = function(){
      copyText(el('wurl').textContent);
    };

    Array.prototype.forEach.call(pageBox().querySelectorAll('[data-zcheck]'), function(b){
      b.onclick = function(){
        busy(b, true);
        el('zErr').textContent = ''; el('zOk').textContent = '';
        api('/settings/zoho/' + b.dataset.zcheck + '/check', { method:'POST' })
          .then(function(r){
            el('zOk').textContent = L('Звʼязок є') + (r.user ? L(', увійшли як ') + r.user : '');
            pageIntegrations();
          })
          .catch(function(e){
            var p = e.payload || {};
            el('zErr').textContent = p.error === 'token_rejected'
              ? L('Zoho більше не приймає доступ: ') + (p.detail || '') + L('. Підключіть заново.')
              : L('Не вдалося перевірити');
            busy(b, false);
          });
      };
    });

    armDelete(pageBox().querySelectorAll('[data-zdel]'), function(b){
      return api('/settings/zoho/' + b.dataset.zdel, { method:'DELETE' }).then(pageIntegrations);
    });

    // ── Битрикс и Pipedrive: подключение, проверка, отключение ────
    if (el('bxAdd')) el('bxAdd').onclick = function(){
      el('bxErr').textContent = '';
      busy(el('bxAdd'), true);
      api('/settings/crm', { method:'POST', body:{ kind:'bitrix24', webhook: el('bxUrl').value } })
        .then(function(r){ toast(L('Бітрікс підключено') + (r.who ? ': ' + r.who : '')); pageIntegrations() })
        .catch(function(e){
          var p = e.payload || {};
          el('bxErr').textContent = p.detail || L('Не вдалося підключити');
          busy(el('bxAdd'), false);
        });
    };

    if (el('pdAdd')) el('pdAdd').onclick = function(){
      el('pdErr').textContent = '';
      busy(el('pdAdd'), true);
      api('/settings/crm', { method:'POST', body:{
        kind:'pipedrive', domain: el('pdDom').value, token: el('pdTok').value
      }})
        .then(function(r){ toast(L('Pipedrive підключено') + (r.who ? ': ' + r.who : '')); pageIntegrations() })
        .catch(function(e){
          var p = e.payload || {};
          el('pdErr').textContent = p.detail || L('Не вдалося підключити');
          busy(el('pdAdd'), false);
        });
    };

    if (el('pdcopy')) el('pdcopy').onclick = function(){ copyText(el('pdurl').textContent) };

    if (el('pdInstall')) el('pdInstall').onclick = function(){
      busy(el('pdInstall'), true);
      api('/settings/pipedrive/start')
        .then(function(r){ location.href = r.url })
        .catch(function(e){
          var p = e.payload || {};
          el('pdErr').textContent = p.error === 'app_not_configured'
            ? L('Застосунок Pipedrive ще не налаштований на сервері')
            : L('Не вдалося почати встановлення');
          busy(el('pdInstall'), false);
        });
    };

    Array.prototype.forEach.call(pageBox().querySelectorAll('[data-crmcheck]'), function(b){
      b.onclick = function(){
        busy(b, true);
        api('/settings/crm/' + b.dataset.crmcheck + '/check', { method:'POST' })
          .then(function(r){ toast(L('Звʼязок є') + (r.who ? ': ' + r.who : '')); pageIntegrations() })
          .catch(function(e){
            var p = e.payload || {};
            alertLine(p.detail || L('CRM не відповіла'));
            busy(b, false);
          });
      };
    });

    armDelete(pageBox().querySelectorAll('[data-crmdel]'), function(b){
      return api('/settings/crm/' + b.dataset.crmdel, { method:'DELETE' }).then(pageIntegrations);
    });
  }).catch(sErr);
}

/** Копирование с запасным способом: буфер недоступен без https. */
function copyText(text){
  if (navigator.clipboard){
    navigator.clipboard.writeText(text).then(function(){ toast(L('Скопійовано')) });
    return;
  }
  var t = document.createElement('textarea');
  t.value = text; document.body.appendChild(t); t.select();
  document.execCommand('copy'); document.body.removeChild(t);
  toast(L('Скопійовано'));
}

/* ── Подключение Facebook: Messenger и Instagram ──────────────────
   Возврат из Facebook приходит на адрес приложения с меткой в хвосте
   ссылки: там либо идентификатор выбора страниц, либо причина отказа.
   Разбирается один раз при запуске, метка из адресной строки убирается,
   чтобы обновление страницы не пыталось подключить то же самое снова. */

var META_ERRORS = {
  cancelled:L('Вхід через Facebook скасовано.'),
  state:L('Посилання застаріло — натисніть «Увійти через Facebook» ще раз.'),
  exchange:L('Facebook не підтвердив вхід. Спробуйте ще раз.'),
  unavailable:L('Підключення Facebook ще не увімкнено на сервері.')
};

/**
 * Возврат из Pipedrive после разрешения.
 *
 * Их страница возвращает нас с одноразовым номером установки: токены
 * лежат на сервере, в адресе только номер. Привязываем к компании и
 * сразу чистим адресную строку, чтобы обновление страницы не пыталось
 * установить то же самое второй раз.
 */
function readPipedriveHash(){
  var h = location.hash || '';
  var ok = h.match(/pipedrive=([a-z0-9-]+)/i);
  var err = h.indexOf('pipedrive-error=') >= 0;
  if (!ok && !err) return;
  history.replaceState(null, '', location.pathname + location.search);

  if (err){ S.zohoError = L('Pipedrive не підтвердив встановлення'); setView('integrations'); return }

  api('/settings/pipedrive/attach', { method:'POST', body:{ installId: ok[1] } })
    .then(function(){ S.zohoNote = L('Застосунок Pipedrive встановлено'); setView('integrations') })
    .catch(function(){ S.zohoError = L('Встановлення застаріло — почніть заново'); setView('integrations') });
}

var ZOHO_ERRORS = {
  cancelled:L('Підключення Zoho скасовано.'),
  state:L('Посилання застаріло — натисніть «Увійти через Zoho» ще раз.'),
  exchange:L('Zoho не підтвердила доступ. Спробуйте ще раз.'),
  server:L('Zoho повернула невідому адресу сервера. Напишіть нам.'),
  org:L('Zoho не віддала відомості про організацію. Перевірте права акаунта.')
};

/**
 * Переход по ссылке из оповещения.
 *
 * В группу и в пуш уходит адрес вида #chat=<id>: человек нажимает на
 * оповещение и попадает в тот самый диалог, а не на главную, где ещё
 * надо найти, о чём было оповещение.
 */
function readNotifyHash(){
  var h = location.hash || '';
  var chat = h.match(/chat=([0-9a-f-]+)/i);
  var view = h.match(/view=([a-z]+)/i);
  if (!chat && !view) return false;
  history.replaceState(null, '', location.pathname + location.search);
  if (chat){ setView('chats'); openConv(chat[1]); return true }
  if (VIEWS[view[1]]) setView(view[1]);
  return true;
}

function readMetaHash(){
  var h = location.hash || '';

  // Возврат из Zoho: отдельная ветка, но разбирается там же — всё,
  // что приходит хвостом ссылки, должно сниматься в одном месте.
  var zok = h.indexOf('zoho=ok') >= 0;
  var zerr = h.match(/zoho-error=([a-z]+)/);
  if (zok || zerr){
    S.zohoNote = zok ? L('Організація Zoho підключена.') : null;
    S.zohoError = zerr ? (ZOHO_ERRORS[zerr[1]] || L('Не вдалося підключити Zoho')) : null;
    history.replaceState(null, '', location.pathname);
    setView('integrations');
    return true;
  }

  var m = h.match(/meta-pick=([0-9a-f-]+)/);
  var e = h.match(/meta-error=([a-z]+)/);
  if (!m && !e) return false;
  if (m) S.metaPick = m[1];
  if (e) S.metaError = META_ERRORS[e[1]] || L('Не вдалося підключити Facebook');
  history.replaceState(null, '', location.pathname);
  // Раньше здесь открывалась модалка настроек, теперь это раздел.
  setView('channels');
  return true;
}

function startMeta(){
  busy(el('metaGo'), true);
  api('/settings/channels/meta/start').then(function(r){ location.href = r.url })
    .catch(function(e){
      busy(el('metaGo'), false);
      var p = (e && e.payload) || {};
      el('metaErr').textContent = p.error === 'meta_unavailable'
        ? META_ERRORS.unavailable : L('Не вдалося почати вхід');
    });
}

function showMetaPick(id){
  var box = el('metaBody');
  box.innerHTML = L('<div class="empty">Завантажую сторінки...</div>');
  api('/settings/channels/meta/pick/' + id).then(function(d){
    var pages = d.pages || [];
    if (!pages.length){
      S.metaPick = null;
      box.innerHTML = L('<div class="err">У цього акаунта Facebook немає сторінок, або під час входу ') +
        L('не позначена жодна. Натисніть «Увійти через Facebook» і на кроці вибору позначте потрібні сторінки.</div>') +
        L('<div class="row2" style="margin-top:10px"><button id="metaGo">Увійти через Facebook</button></div>');
      el('metaGo').onclick = startMeta;
      return;
    }
    box.innerHTML = L('<div class="hint">Позначте, що підключити:</div>') +
      pages.map(function(p){
        return '<div class="item"><div><div class="t">' + esc(p.name) + '</div>' +
          '<div class="s"><label><input type="checkbox" data-mp="' + esc(p.id) + '" data-k="messenger" checked> Messenger</label>' +
          (p.instagram
            ? ' &nbsp; <label><input type="checkbox" data-mp="' + esc(p.id) + '" data-k="instagram" checked> Instagram' +
              (p.instagram.username ? ' @' + esc(p.instagram.username) : '') + '</label>'
            : L(' &nbsp; <span class="muted">Instagram до сторінки не привʼязаний</span>')) +
          '</div></div></div>';
      }).join('') +
      L('<div class="row2" style="margin-top:10px"><button id="metaSave">Підключити вибране</button></div>') +
      '<div class="err" id="metaErr"></div>';
    if (S.metaError){ el('metaErr').textContent = S.metaError; S.metaError = null; }
    el('metaSave').onclick = function(){
      var sel = {};
      Array.prototype.forEach.call(box.querySelectorAll('[data-mp]'), function(c){
        sel[c.dataset.mp] = sel[c.dataset.mp] || { id: c.dataset.mp };
        sel[c.dataset.mp][c.dataset.k] = c.checked;
      });
      busy(el('metaSave'), true);
      api('/settings/channels/meta/pick/' + id, { method:'POST',
        body:{ pages: Object.keys(sel).map(function(k){ return sel[k] }) } })
        .then(function(r){
          var bad = (r.results || []).filter(function(x){ return !x.ok });
          S.metaPick = bad.length ? id : null;
          var ok = (r.results || []).length - bad.length;
          toast(ok ? L('Підключено каналів: ') + ok : L('Нічого не підключено'));
          if (bad.length){
            S.metaError = bad.map(function(x){ return x.page + ': ' + x.error }).join('; ');
          }
          tabChannels();
        })
        .catch(function(){ busy(el('metaSave'), false); el('metaErr').textContent = L('Не вдалося підключити') });
    };
  }).catch(function(){
    S.metaPick = null;
    box.innerHTML = L('<div class="err">Вибір сторінок застарів (15 хвилин). Увійдіть через Facebook ще раз.</div>') +
      L('<div class="row2" style="margin-top:10px"><button id="metaGo">Увійти через Facebook</button></div>');
    el('metaGo').onclick = startMeta;
  });
}

function errLabel(e){
  var r = (e && e.reason) || '';
  if (r === 'session_revoked') return L('сеанс завершено в Telegram — підключіть номер заново');
  if (r === 'token_revoked') return L('токен бота відкликано — підключіть заново');
  if (r === 'bad_key') return L('ключ партнера не підійшов — перевірте його в кабінеті');
  if (r === 'refused') return L('партнер відмовив — подробиці в кабінеті партнера');
  return L('помилка: ') + (typeof e === 'string' ? e : JSON.stringify(e));
}

/* Вход в номерной Telegram. Сервер отдаёт готовую картинку QR,
   страница только опрашивает состояние раз в полторы секунды. */
var TGU = { id:null, timer:null };

function startTgUser(name){
  var box = el('uqrbox');
  if (TGU.timer) clearTimeout(TGU.timer);
  box.innerHTML = L('<div class="qrwrap"><div class="empty">Готую QR-код...</div></div>');
  busy(el('uqr'), true);
  api('/settings/channels/telegram-user/start', { method:'POST', body:{ displayName: name } })
    .then(function(r){ TGU.id = r.loginId; pollTgUser() })
    .catch(function(e){
      busy(el('uqr'), false);
      var p = (e && e.payload) || {};
      box.innerHTML = '<div class="err">' + (p.error === 'mtproto_unavailable'
        ? L('Номерний Telegram ще не увімкнений на сервері.') : L('Не вдалося почати вхід.')) + '</div>';
    });
}

function pollTgUser(){
  var box = el('uqrbox');
  if (!box || !TGU.id) return;
  var id = TGU.id;
  api('/settings/channels/telegram-user/login/' + id).then(function(st){
    if (TGU.id !== id || !el('uqrbox')) return;
    if (st.state === 'qr' && st.qrSvg) {
      box.innerHTML = '<div class="qrwrap"><div class="qr">' + st.qrSvg + '</div><ol class="steps">' +
        L('<li>Відкрийте Telegram на телефоні</li>') +
        L('<li><b>Налаштування → Пристрої → Підключити пристрій</b></li>') +
        L('<li>Наведіть камеру на цей код</li></ol></div>') +
        L('<div class="hint">Код оновлюється кожні півхвилини — це нормально.</div>');
    } else if (st.state === 'password') {
      if (!el('upw')) {
        box.innerHTML = '<div class="qrwrap"><div>' +
          L('<div class="t">На акаунті увімкнено хмарний пароль</div>') +
          '<div class="hint" id="uphint"></div>' +
          L('<div class="row2"><input id="upw" type="password" placeholder="Хмарний пароль Telegram" autocomplete="off">') +
          L('<button id="upwgo">Увійти</button></div>') +
          '<div class="err" id="upwerr"></div>' +
          L('<div class="hint">Пароль передається в Telegram і ніде в нас не зберігається.</div></div></div>');
        el('upwgo').onclick = function(){
          var pw = el('upw').value;
          if (!pw) return;
          busy(el('upwgo'), true);
          api('/settings/channels/telegram-user/login/' + id + '/password',
              { method:'POST', body:{ password: pw } })
            .catch(function(){ el('upwerr').textContent = L('Не вдалося надіслати пароль') })
            .then(function(){ el('upw').value = '' });
        };
        el('upw').onkeydown = function(ev){ if (ev.key === 'Enter') el('upwgo').click() };
        el('upw').focus();
      } else {
        busy(el('upwgo'), false);
      }
      el('uphint').textContent = st.passwordHint ? L('Підказка: ') + st.passwordHint : '';
      el('upwerr').textContent = st.passwordError ? L('Пароль не підійшов, спробуйте ще раз') : '';
    } else if (st.state === 'done') {
      TGU.id = null;
      box.innerHTML = L('<div class="ok">Номер підключено. Повідомлення почнуть надходити протягом хвилини.</div>');
      toast(L('Telegram за номером підключено'));
      setTimeout(tabChannels, 1500);
      return;
    } else if (st.state === 'error') {
      TGU.id = null;
      busy(el('uqr'), false);
      box.innerHTML = '<div class="err">' + esc(st.error || L('Вхід не вдався')) + '</div>';
      return;
    } else if (el('upwgo')) {
      busy(el('upwgo'), true);
    }
    TGU.timer = setTimeout(pollTgUser, 1500);
  }).catch(function(){
    if (TGU.id === id) TGU.timer = setTimeout(pollTgUser, 3000);
  });
}

/**
 * Доступ сотрудника к каналам.
 *
 * Список каналов галочками прямо под строкой человека: отдельная
 * страница ради пяти флажков — это два лишних перехода и возврат
 * «куда я попал». Пусто означает «все каналы», и это написано словами:
 * администратор, снявший все галочки, должен понимать, что открыл всё,
 * а не запретил всё.
 */
function openAcl(userId, btn){
  var box = el('acl-' + userId);
  if (!box) return;
  if (box.style.display !== 'none'){ box.style.display = 'none'; return }

  busy(btn, true);
  Promise.all([api('/users/' + userId + '/channels'), api('/channels')])
    .then(function(res){
      var picked = {}, list = res[1].channels || [];
      (res[0].channelIds || []).forEach(function(id){ picked[id] = true });

      box.innerHTML = list.length
        ? '<div class="aclgrid">' + list.map(function(c){
            return '<label class="aclrow"><input type="checkbox" data-ch="' + c.id + '"' +
              (picked[c.id] ? ' checked' : '') + '>' +
              '<span>' + esc(c.display_name || CH[c.type] || c.type) + '</span>' +
              '<span class="dim">' + esc(CH[c.type] || c.type) + '</span></label>';
          }).join('') + '</div>' +
          '<div class="hint" id="aclhint-' + userId + '"></div>' +
          '<div class="row2" style="margin-top:8px">' +
          '<button class="mini" id="aclsave-' + userId + L('">Зберегти доступ</button>') +
          '<button class="ghost mini" id="aclall-' + userId + L('">Відкрити всі</button></div>') +
          '<div class="err" id="aclerr-' + userId + '"></div>'
        : L('<div class="hint">Каналів поки немає — спершу підключіть хоча б один.</div>');

      box.style.display = 'block';
      busy(btn, false);
      if (!list.length) return;

      function marks(){
        return Array.prototype.filter.call(box.querySelectorAll('[data-ch]'), function(x){
          return x.checked;
        }).map(function(x){ return x.dataset.ch });
      }
      function hint(){
        var n = marks().length;
        el('aclhint-' + userId).textContent = n
          ? L('Видно тільки вибраний канал') + (n > 1 ? L('и: ') + n : '')
          : L('Жодної галочки — співробітник бачить усі канали.');
      }
      hint();
      Array.prototype.forEach.call(box.querySelectorAll('[data-ch]'), function(x){
        x.onchange = hint;
      });

      el('aclall-' + userId).onclick = function(){
        Array.prototype.forEach.call(box.querySelectorAll('[data-ch]'), function(x){
          x.checked = false;
        });
        hint();
      };

      el('aclsave-' + userId).onclick = function(){
        var save = el('aclsave-' + userId);
        busy(save, true);
        api('/users/' + userId + '/channels', { method:'PUT', body:{ channelIds: marks() } })
          .then(function(){ toast(L('Доступ збережено')); box.style.display = 'none' })
          .catch(function(e){
            var p = e.payload || {};
            el('aclerr-' + userId).textContent = p.detail || L('Не вдалося зберегти');
          })
          .then(function(){ busy(save, false) });
      };
    })
    .catch(function(){ busy(btn, false); alertLine(L('Не вдалося отримати список каналів')) });
}

function tabUsers(){
  api('/users').then(function(d){
    USERS = d.users || [];
    var opts = Object.keys(ROLES).filter(function(r){ return r !== 'owner' })
      .map(function(r){ return '<option value="' + r + '">' + ROLES[r] + '</option>' }).join('');

    pageBox().innerHTML = '<div class="pg">' +
      pageHead(L('Команда'), L('Оператори відповідають клієнтам, спостерігачі тільки читають, ') +
        L('адміністратори змінюють канали і склад команди.')) +
      L('<div class="card"><h3>Запросити співробітника</h3>') +
      L('<div class="row2"><input id="uem" type="email" placeholder="пошта" autocomplete="off">') +
      L('<input id="unm" placeholder="імʼя" autocomplete="off">') +
      '<select id="uro">' + opts + '</select>' +
      L('<button id="uadd">Додати</button></div>') +
      L('<div class="hint">Оператор бачить діалоги і відповідає. Спостерігач тільки читає. ') +
      L('Адміністратор може змінювати канали і склад команди.</div>') +
      '<div class="err" id="uerr"></div></div>' +

      L('<div class="card"><h3>Команда (') + USERS.length + ')</h3>' +
      USERS.map(function(u){
        var pill = u.is_active ? '' : L('<span class="pill warn">відключений</span>');
        var seen = u.last_seen_at ? L('був ') + fmtTime(u.last_seen_at) : L('ще не заходив');
        return '<div class="item"><div>' +
          '<div class="t">' + esc(u.full_name || u.email) + pill + '</div>' +
          '<div class="s">' + esc(u.email) + ' · ' + esc(ROLES[u.role] || u.role) +
          ' · ' + esc(seen) + '</div></div>' +
          '<div style="display:flex;gap:6px;flex:none">' +
          // Доступ к каналам есть только у тех, кого можно ограничить:
          // владелец и администратор видят всё по своей роли.
          (u.role === 'owner' || u.role === 'admin' ? '' :
            '<button class="ghost mini" data-acl="' + u.id + L('">Канали</button>')) +
          (u.role === 'owner' ? '' :
            '<button class="ghost mini" data-user="' + u.id + '" data-active="' +
            (u.is_active ? 'false' : 'true') + '">' +
            (u.is_active ? L('Відключити') : L('Увімкнути')) + '</button>') +
          '</div></div>' +
          '<div class="aclbox" id="acl-' + u.id + '" style="display:none"></div>';
      }).join('') + '</div>';

    el('uadd').onclick = function(){
      el('uerr').textContent = '';
      busy(el('uadd'), true);
      api('/users', { method:'POST', body:{
        email: el('uem').value.trim(), fullName: el('unm').value.trim(), role: el('uro').value
      }}).then(function(){ tabUsers() })
        .catch(function(e){
          var p = e.payload || {};
          el('uerr').textContent = p.error === 'seats_limit_reached'
            ? L('Місць за тарифом: ') + p.limit + L('. Відключіть когось або розширте тариф.')
            : p.error === 'bad_email' ? L('Перевірте адресу пошти') : L('Не вдалося додати');
          busy(el('uadd'), false);
        });
    };

    Array.prototype.forEach.call(pageBox().querySelectorAll('[data-acl]'), function(b){
      b.onclick = function(){ openAcl(b.dataset.acl, b) };
    });

    Array.prototype.forEach.call(pageBox().querySelectorAll('[data-user]'), function(b){
      b.onclick = function(){
        busy(b, true);
        api('/users/' + b.dataset.user, { method:'PATCH',
          body:{ isActive: b.dataset.active === 'true' } })
          .then(tabUsers).catch(function(){ busy(b, false) });
      };
    });
  }).catch(sErr);
}

/* ══════════════ Оповіщення ══════════════
   Инбокс открыт не всегда: ночью, в выходной, в дороге. Клиент
   написал — и об этом некому узнать. Поэтому событие уходит туда,
   куда человек и так смотрит.

   Страница устроена как список адресатов, а не как набор галочек
   «слать/не слать»: групп бывает две — «продажи» и «поломки», — и у
   каждой свой список событий. */

var NT = { data:null };

function ntKind(k){
  return { telegram:L('Група Telegram'), email:L('Пошта'), push:L('Пуш у браузер') }[k] || k;
}

function ntWhere(t){
  var c = t.config || {};
  if (t.kind === 'telegram'){
    var bot = (NT.data.bots || []).filter(function(b){ return b.id === c.channelId })[0];
    var name = c.botName || (bot ? bot.display_name : L('бот не знайдений'));
    return name + ' → ' + (c.chatId || '—');
  }
  if (t.kind === 'email') return c.to || '—';
  return NT.data.pushSubscriptions + ' ' + L('пристроїв');
}

function ntEvents(t){
  return (NT.data.events || []).map(function(e){
    var on = (t.events || []).indexOf(e.id) >= 0;
    return '<label class="ntev" title="' + esc(e.hint) + '">' +
      '<input type="checkbox" data-ev="' + e.id + '" data-tid="' + t.id + '"' +
        (on ? ' checked' : '') + '>' + esc(e.title) + '</label>';
  }).join('');
}

function ntCard(t){
  var err = t.lastError && t.lastError.detail;
  return '<div class="tile">' +
    '<div class="t1"><div style="min-width:0">' +
      '<div class="ttl">' + esc(t.title) + '</div>' +
      '<div class="sub">' + esc(ntKind(t.kind)) + ' · ' + esc(ntWhere(t)) + '</div>' +
    '</div></div>' +
    (t.isActive ? '' : L('<div><span class="pill warn">вимкнено</span></div>')) +
    (err ? '<div><span class="pill crit">' + esc(err) + '</span></div>' : '') +
    '<div class="ntevs">' + ntEvents(t) + '</div>' +
    '<div class="acts">' +
      L('<button class="ghost mini" data-nt-test="') + t.id + L('">Перевірити</button>') +
      '<button class="ghost mini" data-nt-off="' + t.id + '" data-to="' + (t.isActive ? '0' : '1') + '">' +
        (t.isActive ? L('Вимкнути') : L('Увімкнути')) + '</button>' +
      L('<button class="ghost mini" data-nt-del="') + t.id + L('">Видалити</button>') +
    '</div></div>';
}

function ntWaitRow(){
  var minutes = NT.data.waitingAlertMinutes;
  var opts = [0, 5, 10, 15, 30, 60];
  if (opts.indexOf(minutes) < 0) opts.push(minutes);
  return '<div class="card" style="margin-bottom:14px"><div class="row2">' +
    '<div class="lbl" style="width:auto">' + L('Вважати, що клієнт чекає, через') + '</div>' +
    '<select id="ntWait" style="max-width:200px">' +
    opts.sort(function(a,b){ return a-b }).map(function(m){
      return '<option value="' + m + '"' + (m === minutes ? ' selected' : '') + '>' +
        (m === 0 ? L('не перевіряти') : m + ' ' + L('хв')) + '</option>';
    }).join('') + '</select></div>' +
    L('<div class="hint">Стосується події «Клієнт чекає відповіді». Нагадування приходить один раз ') +
    L('на повідомлення, а не щохвилини.</div></div>');
}

function ntAdd(){
  var bots = NT.data.bots || [];
  var push = NT.data.push || {};

  /* Бот для оповещений — отдельная история от бота-канала. Канал-бот
     есть далеко не у всех: клиенты пишут в Instagram и на номер, а
     дежурной группе нужен свой бот, которого клиентам не показывают.
     Поэтому либо выбрать уже подключённого, либо вписать свой токен. */
  var tg = '<div class="tile"><div class="t1"><div class="chico telegram_bot">TG</div>' +
    L('<div><div class="ttl">Група Telegram</div><div class="sub">Повідомлення читають усі, хто в групі</div></div></div>') +
    L('<div class="sub" style="white-space:normal">Створіть бота у <b>@BotFather</b>, додайте його у вашу групу ') +
    L('і зробіть адміністратором. Потім натисніть «Знайти групи» — ми запитаємо їх у Telegram самі.</div>') +
    (bots.length
      ? '<div class="row2"><select id="ntBot">' +
        bots.map(function(b){ return '<option value="' + b.id + '">' + esc(b.display_name) + '</option>' }).join('') +
        L('<option value="">інший бот — за токеном</option></select></div>')
      : '') +
    '<div class="row2"><input id="ntTok" type="password" placeholder="123456789:AAF..." autocomplete="off">' +
    L('<button class="ghost" id="ntFind">Знайти групи</button></div>') +
    '<div id="ntChats"></div>' +
    '<div class="row2"><input id="ntChat" placeholder="-4846124329" autocomplete="off">' +
    L('<button id="ntAddTg">Додати</button></div>') +
    L('<div class="hint">Якщо група не знайшлася — напишіть у ній будь-що і натисніть «Знайти групи» ') +
    L('ще раз: Telegram віддає боту тільки свіжі оновлення.</div>') +
    '<div class="err" id="ntTgErr"></div></div>';

  var mail = '<div class="tile"><div class="t1"><div class="chico soon">@</div>' +
    L('<div><div class="ttl">Пошта</div><div class="sub">Кілька адрес через кому</div></div></div>') +
    '<div class="row2"><input id="ntMail" placeholder="shift@example.com" autocomplete="off">' +
    L('<button id="ntAddMail">Додати</button></div>') +
    '<div class="err" id="ntMailErr"></div></div>';

  var pushTile = '<div class="tile"><div class="t1"><div class="chico soon">!</div>' +
    L('<div><div class="ttl">Пуш у браузер</div><div class="sub">Приходить, навіть коли вкладку закрито</div></div></div>') +
    (push.ready
      ? L('<div class="sub" style="white-space:normal">Дозвольте сповіщення у браузері — на цьому пристрої. ') +
        L('Кожен співробітник вмикає їх собі сам.</div>') +
        L('<div class="acts"><button id="ntPushOn">Дозволити сповіщення</button>') +
        L('<button class="ghost mini" id="ntAddPush">Додати адресата</button></div>')
      : L('<div class="sub" style="white-space:normal">Пуш не налаштований на сервері: немає ключів VAPID. ') +
        L('Їх видає команда npx web-push generate-vapid-keys, далі вони йдуть у змінні ') +
        L('VAPID_PUBLIC_KEY і VAPID_PRIVATE_KEY.</div>')) +
    '<div class="err" id="ntPushErr"></div></div>';

  return L('<div class="pg-sec"><h3>Додати адресата</h3><div class="grid">') +
    tg + mail + pushTile + '</div></div>';
}

function tabNotify(){
  api('/settings/notify').then(function(d){
    NT.data = d;
    var list = (d.targets || []).map(ntCard).join('');

    pageBox().innerHTML = '<div class="pg">' +
      pageHead(L('Сповіщення'),
        L('Куди повідомляти про те, що відбувається в інбоксі, коли на нього ніхто не дивиться.')) +
      ntWaitRow() +
      (list
        ? L('<div class="pg-sec"><h3>Кому надсилати</h3><div class="grid">') + list + '</div></div>'
        : L('<div class="pg-sec"><div class="empty">Поки нікому. Додайте адресата нижче.</div></div>')) +
      ntAdd() +
      '</div>';

    wireNotify();
  }).catch(sErr);
}

function ntSave(id, body, done){
  api('/settings/notify/' + id, { method:'PATCH', body:body })
    .then(function(){ if (done) done() })
    .catch(function(e){ toast(((e.payload||{}).detail) || L('Не вдалося зберегти')) });
}

function wireNotify(){
  el('ntWait').onchange = function(){
    var v = Number(this.value);
    api('/settings/notify-waiting', { method:'PATCH', body:{ waitingAlertMinutes:v } })
      .then(function(){ NT.data.waitingAlertMinutes = v; toast(L('Збережено')) })
      .catch(function(){ toast(L('Не вдалося зберегти')) });
  };

  Array.prototype.forEach.call(document.querySelectorAll('[data-ev]'), function(box){
    box.onchange = function(){
      var t = (NT.data.targets || []).filter(function(x){ return x.id === box.dataset.tid })[0];
      if (!t) return;
      var set = (t.events || []).filter(function(e){ return e !== box.dataset.ev });
      if (box.checked) set.push(box.dataset.ev);
      t.events = set;
      ntSave(t.id, { events:set });
    };
  });

  Array.prototype.forEach.call(document.querySelectorAll('[data-nt-test]'), function(b){
    b.onclick = function(){
      busy(b, true);
      api('/settings/notify/' + b.dataset.ntTest + '/test', { method:'POST' })
        .then(function(){ toast(L('Надіслали перевірку')) })
        .catch(function(){ toast(L('Не вдалося надіслати')) })
        .then(function(){ busy(b, false) });
    };
  });

  Array.prototype.forEach.call(document.querySelectorAll('[data-nt-off]'), function(b){
    b.onclick = function(){
      ntSave(b.dataset.ntOff, { isActive: b.dataset.to === '1' }, tabNotify);
    };
  });

  Array.prototype.forEach.call(document.querySelectorAll('[data-nt-del]'), function(b){
    b.onclick = function(){
      api('/settings/notify/' + b.dataset.ntDel, { method:'DELETE' })
        .then(tabNotify)
        .catch(function(){ toast(L('Не вдалося видалити')) });
    };
  });

  if (el('ntFind')) el('ntFind').onclick = ntFindChats;

  if (el('ntAddTg')) el('ntAddTg').onclick = function(){
    var token = el('ntTok') ? el('ntTok').value.trim() : '';
    var bot = el('ntBot') ? el('ntBot').value : '';
    if (!token && !bot){
      el('ntTgErr').textContent = L('Виберіть бота або вкажіть токен');
      return;
    }
    ntCreate('telegram', { channelId: bot, chatId: el('ntChat').value.trim() }, 'ntTgErr', token);
  };
  if (el('ntAddMail')) el('ntAddMail').onclick = function(){
    ntCreate('email', { to: el('ntMail').value.trim() }, 'ntMailErr');
  };
  if (el('ntAddPush')) el('ntAddPush').onclick = function(){
    ntCreate('push', {}, 'ntPushErr');
  };
  if (el('ntPushOn')) el('ntPushOn').onclick = ntPushSubscribe;
}

/* Новый адресат создаётся сразу подписанным на всё: человек добавляет
   его, чтобы получать оповещения, а не чтобы потом искать галочки. */
function ntCreate(kind, config, errBox, token){
  var events = (NT.data.events || []).map(function(e){ return e.id });
  el(errBox).textContent = '';
  api('/settings/notify', {
    method:'POST',
    body:{ kind:kind, config:config, events:events, token: token || undefined },
  })
    .then(function(){ toast(L('Адресата додано')); tabNotify() })
    .catch(function(e){
      el(errBox).textContent = ((e.payload||{}).detail) || L('Не вдалося додати');
    });
}

/**
 * Найти группы, в которых состоит бот.
 *
 * Идентификатор группы негде посмотреть в самом Telegram, и на этом
 * настройка обычно и заканчивалась: человек упирался в поле «-4846...»
 * и шёл искать стороннего бота. Спрашиваем у Telegram напрямую — для
 * бота добавление в группу тоже обновление.
 */
function ntFindChats(){
  var box = el('ntChats'), err = el('ntTgErr');
  err.textContent = '';
  busy(el('ntFind'), true);

  var body = {};
  var token = el('ntTok') ? el('ntTok').value.trim() : '';
  if (token) body.token = token;
  else if (el('ntBot') && el('ntBot').value) body.channelId = el('ntBot').value;
  else { busy(el('ntFind'), false); err.textContent = L('Виберіть бота або вкажіть токен'); return }

  api('/settings/notify/telegram/chats', { method:'POST', body:body })
    .then(function(d){
      busy(el('ntFind'), false);
      var list = d.chats || [];
      if (!list.length){
        box.innerHTML = L('<div class="hint">Групи не знайшлися. Додайте бота у групу, ') +
          L('напишіть у ній будь-що і спробуйте ще раз.</div>');
        return;
      }
      box.innerHTML = '<div class="row2"><select id="ntChatPick">' +
        list.map(function(c){
          return '<option value="' + esc(c.id) + '">' + esc(c.title) + ' (' + esc(c.id) + ')</option>';
        }).join('') + '</select></div>';
      el('ntChat').value = list[0].id;
      el('ntChatPick').onchange = function(){ el('ntChat').value = this.value };
    })
    .catch(function(e){
      busy(el('ntFind'), false);
      err.textContent = ((e.payload||{}).detail) || L('Не вдалося запитати Telegram');
    });
}

/**
 * Разрешение на пуш.
 *
 * Три отдельных шага, и на каждом браузер может сказать «нет»: спросить
 * разрешение, зарегистрировать служебный сценарий, подписаться. Молча
 * ничего не делать здесь нельзя — человек нажал кнопку и ждёт ответа.
 */
function ntPushSubscribe(){
  var box = el('ntPushErr');
  box.textContent = '';
  if (!('serviceWorker' in navigator) || !('PushManager' in window)){
    box.textContent = L('Браузер не підтримує пуш-сповіщення');
    return;
  }
  var key = (NT.data.push || {}).publicKey;
  if (!key){ box.textContent = L('Пуш не налаштований на сервері'); return }

  busy(el('ntPushOn'), true);
  Notification.requestPermission().then(function(perm){
    if (perm !== 'granted') throw new Error(L('Сповіщення заборонені у налаштуваннях браузера'));
    return navigator.serviceWorker.register('/sw.js');
  }).then(function(reg){
    return reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey: ntKeyBytes(key) });
  }).then(function(sub){
    var j = sub.toJSON();
    return api('/me/push', { method:'POST', body:{ endpoint:j.endpoint, keys:j.keys } });
  }).then(function(){
    toast(L('Пуш увімкнено на цьому пристрої'));
    tabNotify();
  }).catch(function(e){
    busy(el('ntPushOn'), false);
    box.textContent = (e && e.message) || L('Не вдалося увімкнути пуш');
  });
}

/* Ключ приходит в виде base64url, а подписка ждёт байты. */
function ntKeyBytes(key){
  var pad = new Array((4 - key.length % 4) % 4 + 1).join('=');
  var b64 = (key + pad).replace(/-/g, '+').replace(/_/g, '/');
  var raw = atob(b64), out = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function tabReplies(){
  api('/quick-replies').then(function(d){
    QR = d.quickReplies || [];
    pageBox().innerHTML = '<div class="pg">' +
      pageHead(L('Шаблони відповідей'), L('Заготовки, які оператор вставляє в листування командою ') +
        L('<b>/імʼя</b>. До шаблону можна додати до трьох файлів — прайс, схему проїзду, інструкцію.')) +
      L('<div class="card"><h3>Новий шаблон</h3>') +
      L('<div class="row2"><input id="qsc" placeholder="коротке імʼя, наприклад ціна"></div>') +
      '<div class="row2" style="margin-top:9px">' +
      L('<textarea id="qbd" rows="3" placeholder="Текст, який підставиться в поле відповіді"></textarea>') +
      '</div>' +
      // Файл прикладывается сразу при создании. Раньше кнопка «Файл»
      // была только у сохранённого шаблона, и в пустом списке человек
      // её не видел вовсе — выходило, что файлов у шаблонов нет.
      '<div class="row2" style="margin-top:9px;display:flex;gap:8px;align-items:center">' +
      L('<button class="ghost mini" id="qnewFile">Додати файл</button>') +
      L('<span class="dim" id="qnewName">файл не вибрано</span></div>') +
      L('<div class="row2" style="margin-top:9px"><button id="qadd">Зберегти</button></div>') +
      L('<div class="hint">У діалозі наберіть <b>/імʼя</b> і натисніть Enter — текст розгорнеться ') +
      L('у поле відповіді, залишиться натиснути Enter другий раз.</div>') +
      '<div class="err" id="qerr"></div>' +
      '<input type="file" id="qrFile" style="display:none">' +
      '<input type="file" id="qrNewFile" style="display:none"></div>' +

      L('<div class="card"><h3>Шаблони (') + QR.length + ')</h3>' +
      (QR.length ? QR.map(function(q){
        var files = q.attachments || [];
        var chips = files.map(function(a, i){
          return '<span class="fchip" title="' + esc(a.filename || L('файл')) + '">' +
            '<span class="ic">' + (String(a.mime || '').indexOf('image/') === 0 ? '🖼' : '📄') + '</span>' +
            '<a href="#" data-open="' + q.id + '" data-oi="' + i + '">' + esc(a.filename || L('файл')) + '</a>' +
            '<span class="dim">' + Math.round((a.size || 0) / 1024) + L(' КБ</span>') +
            '<span class="x" data-del="' + q.id + '" data-di="' + i + L('" title="Прибрати файл">×</span></span>');
        }).join('');
        return '<div class="item"><div style="min-width:0">' +
          '<div class="t"><code>/' + esc(q.shortcut) + '</code></div>' +
          '<div class="s">' + esc(q.body) + '</div>' +
          (chips ? '<div class="fchips">' + chips + '</div>' : '') +
          '</div>' +
          '<div style="display:flex;gap:6px;flex:none">' +
          (files.length < 3
            ? '<button class="ghost mini" data-file="' + q.id + L('">Файл</button>') : '') +
          '<button class="ghost mini" data-qr="' + q.id + L('">Видалити</button></div></div>');
      }).join('') : L('<div class="hint">Поки порожньо.</div>')) + '</div></div>';

    // Файл к новому шаблону выбирается до сохранения и уезжает сразу
    // после того, как шаблон получил свой номер.
    var newFile = null;
    el('qnewFile').onclick = function(){ el('qrNewFile').value = ''; el('qrNewFile').click() };
    el('qrNewFile').onchange = function(){
      var f = this.files && this.files[0];
      if (!f) return;
      if (f.size > 20 * 1024 * 1024){ alertLine(L('Файл більший за 20 МБ — Telegram не пропустить')); return }
      newFile = f;
      el('qnewName').textContent = f.name;
    };

    el('qadd').onclick = function(){
      el('qerr').textContent = '';
      busy(el('qadd'), true);
      api('/quick-replies', { method:'POST', body:{
        shortcut: el('qsc').value, body: el('qbd').value
      }}).then(function(created){
        var id = created && (created.quickReply ? created.quickReply.id : created.id);
        if (!newFile || !id) return null;
        var f = newFile;
        return readAsBase64(f).then(function(b64){
          return api('/quick-replies/' + id + '/attachment', { method:'POST', body:{
            filename: f.name,
            mime: f.type || 'application/octet-stream',
            type: fileKind(f.type, f.name),
            dataBase64: b64
          }});
        });
      }).then(function(){ tabReplies(); renderComposer(true) })
        .catch(function(e){
          var p = e.payload || {};
          el('qerr').textContent = p.error === 'shortcut_too_long'
            ? L('Коротке імʼя довше за 32 символи') : L('Заповніть імʼя і текст');
          busy(el('qadd'), false);
        });
    };

    armDelete(pageBox().querySelectorAll('[data-qr]'), function(b){
      return api('/quick-replies/' + b.dataset.qr, { method:'DELETE' })
        .then(function(){ tabReplies(); renderComposer(true) });
    });

    // Файл выбирается одним скрытым полем на всю страницу: по одному
    // на каждый шаблон — это десяток невидимых полей в разметке.
    var picker = el('qrFile');
    Array.prototype.forEach.call(pageBox().querySelectorAll('[data-file]'), function(b){
      b.onclick = function(){ picker.dataset.qr = b.dataset.file; picker.value = ''; picker.click() };
    });
    picker.onchange = function(){
      var f = this.files && this.files[0];
      if (!f) return;
      if (f.size > 20 * 1024 * 1024){ alertLine(L('Файл більший за 20 МБ — Telegram не пропустить')); return }
      var id = this.dataset.qr;
      readAsBase64(f).then(function(b64){
        return api('/quick-replies/' + id + '/attachment', { method:'POST', body:{
          filename: f.name,
          mime: f.type || 'application/octet-stream',
          type: fileKind(f.type, f.name),
          dataBase64: b64
        }});
      }).then(function(){ tabReplies(); renderComposer(true) })
        .catch(function(e){
          var p = e.payload || {};
          el('qerr').textContent = p.error === 'too_many_files'
            ? L('До одного шаблону можна додати не більше трьох файлів')
            : p.error === 'file_too_large' ? L('Файл більший за 20 МБ') : L('Не вдалося завантажити файл');
        });
    };

    Array.prototype.forEach.call(pageBox().querySelectorAll('[data-open]'), function(a){
      a.onclick = function(ev){
        ev.preventDefault();
        // Токен нельзя положить в ссылку, поэтому файл забираем запросом
        // и открываем уже локальную копию.
        fetch('/quick-replies/' + a.dataset.open + '/attachment/' + a.dataset.oi,
          { headers:{ Authorization:'Bearer ' + TOKEN } })
          .then(function(r){ return r.blob() })
          .then(function(b){ window.open(URL.createObjectURL(b), '_blank') })
          .catch(function(){ alertLine(L('Файл недоступний')) });
      };
    });

    armDelete(pageBox().querySelectorAll('[data-del]'), function(b){
      return api('/quick-replies/' + b.dataset.del + '/attachment/' + b.dataset.di,
        { method:'DELETE' }).then(function(){ tabReplies(); renderComposer(true) });
    });
  }).catch(sErr);
}


/* ══════════════ Иконки, аватары, оповещения ══════════════ */

/* Иконки нарисованы контуром в одном стиле и наследуют цвет текста.
   Эмодзи, которые стояли раньше, выглядят по-разному в каждой системе
   и сразу выдают, что оформлением никто не занимался. */
var ICONS = {
  chat:'<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-3.9-.9L3 21l1.9-4.6a8.4 8.4 0 0 1-.9-3.9 8.4 8.4 0 0 1 8.4-8.4h.6a8.4 8.4 0 0 1 8 8z"/>',
  bot:'<rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 8V4M8 4h8M9 14h.01M15 14h.01"/>',
  gear:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  bell:'<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/>',
  bellOff:'<path d="M13.7 21a2 2 0 0 1-3.4 0M18.6 13A17 17 0 0 1 18 8a6 6 0 0 0-9.3-5M6.3 6.3A6 6 0 0 0 6 8c0 7-3 9-3 9h14M2 2l20 20"/>',
  exit:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  clip:'<path d="M21 12.8l-8.5 8.5a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 1 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8"/>',
  bolt:'<path d="M13 2L4.1 13.3a.7.7 0 0 0 .5 1.2H11l-1 8.5 8.9-11.3a.7.7 0 0 0-.5-1.2H12z"/>',
  plug:'<path d="M9 3v6M15 3v6M6 9h12v3a6 6 0 0 1-12 0zM12 18v3"/>',
  link:'<path d="M10 13a5 5 0 0 0 7.5.5l3-3A5 5 0 0 0 13.4 3.4l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3A5 5 0 0 0 10.6 20.6l1.7-1.7"/>',
  team:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  smile:'<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon:'<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  auto:'<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none"/>'
};

function icon(name){
  return '<svg viewBox="0 0 24 24">' + (ICONS[name] || '') + '</svg>';
}

/** Проставляет иконки кнопкам, у которых указан data-icon. */
function paintIcons(root){
  Array.prototype.forEach.call((root || document).querySelectorAll('[data-icon]'), function(b){
    if (b.dataset.painted) return;
    b.dataset.painted = '1';
    b.insertAdjacentHTML('afterbegin', icon(b.dataset.icon));
  });
}

/**
 * Аватар контакта.
 *
 * Как и вложения, картинка забирается через fetch: браузер не отправит
 * заголовок с токеном для обычного src. Кэш здесь на всю сессию —
 * список перерисовывается постоянно, и без него каждый цикл опроса
 * означал бы запрос на каждого собеседника.
 */
var avatarCache = {};

/**
 * Аватары.
 *
 * Запрашиваем у сервера для каждого собеседника, не глядя на признак
 * из списка. Признак берётся из поля контакта, а поле могло не
 * заполниться, хотя картинка скачана и лежит в хранилище: файл кладёт
 * одна служба, ссылку проставляет другая. Сервер в этом случае сам
 * находит файл и чинит связь, а мы получаем лицо вместо инициалов.
 *
 * Плата — по одному запросу на контакт без фото, который вернёт 404.
 * Ответ запоминается на время жизни страницы, поэтому повторов нет.
 */
function paintAvatars(){
  Array.prototype.forEach.call(document.querySelectorAll('[data-av]'), function(node){
    var id = node.dataset.av;
    if (!id || node.dataset.done) return;
    node.dataset.done = '1';

    if (avatarCache[id] === false) return;
    if (avatarCache[id]) {
      node.style.backgroundImage = 'url(' + avatarCache[id] + ')';
      node.textContent = '';
      return;
    }

    fetch('/avatars/' + id, { headers:{ Authorization:'Bearer ' + TOKEN } })
      .then(function(r){ return r.ok ? r.blob() : Promise.reject(r.status) })
      .then(function(b){
        // Пустой или не-картиночный ответ — это не лицо. Раньше такой
        // файл всё равно шёл в фон, буква стиралась, и на месте
        // аватарки оставался пустой серый кружок.
        if (!b || !b.size || String(b.type || '').indexOf('image/') !== 0){
          avatarCache[id] = false;
          return;
        }
        var url = URL.createObjectURL(b);
        // Байты могут не быть картинкой, даже если так написано в
        // заголовке: провайдер иногда отдаёт заглушку или обрезанный
        // файл. Проверяем разбором и только потом стираем букву.
        var probe = new Image();
        probe.onload = function(){
          avatarCache[id] = url;
          // Узел мог быть заменён перерисовкой, пока картинка ехала.
          Array.prototype.forEach.call(document.querySelectorAll('[data-av="' + id + '"]'), function(n){
            n.style.backgroundImage = 'url(' + url + ')';
            n.textContent = '';
          });
        };
        probe.onerror = function(){
          avatarCache[id] = false;
          URL.revokeObjectURL(url);
        };
        probe.src = url;
      })
      .catch(function(){ avatarCache[id] = false; });
  });
}

/* ── Звук и уведомления ─────────────────────────────────────────── */

/**
 * Звук синтезируется, а не берётся файлом.
 *
 * Файл пришлось бы положить рядом, отдать отдельным маршрутом и следить,
 * чтобы он не потерялся при сборке образа. Две короткие ноты через
 * WebAudio — двадцать строк, ноль зависимостей и ноль сетевых запросов.
 */
var audioCtx = null;

function beep(){
  if (!PREFS.sound) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    // Браузер запускает звук только после действия человека. Если контекст
    // ещё спит — будим; на первом сообщении звука может не быть, дальше есть.
    if (audioCtx.state === 'suspended') audioCtx.resume();

    var t = audioCtx.currentTime;
    [880, 1174].forEach(function(freq, i){
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      // Плавное затухание: резкий обрыв даёт щелчок.
      gain.gain.setValueAtTime(0.0001, t + i * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.16, t + i * 0.09 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.16);
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(t + i * 0.09);
      osc.stop(t + i * 0.09 + 0.18);
    });
  } catch (e) { /* звук не критичен: молча пропускаем */ }
}

var PREFS = {
  sound: localStorage.getItem('od_sound') !== '0',
  push: localStorage.getItem('od_push') === '1'
};

function savePrefs(){
  localStorage.setItem('od_sound', PREFS.sound ? '1' : '0');
  localStorage.setItem('od_push', PREFS.push ? '1' : '0');
  paintBell();
}

function paintBell(){
  var b = el('bell');
  if (!b) return;
  var on = PREFS.sound || PREFS.push;
  b.dataset.painted = '';
  b.innerHTML = '';
  b.insertAdjacentHTML('afterbegin', icon(on ? 'bell' : 'bellOff'));
  b.insertAdjacentText('beforeend', on ? L('Звук') : L('Тихо'));
  b.classList.toggle('live', on);
  b.title = (PREFS.sound ? L('Звук увімкнено') : L('Звук вимкнено')) + ' · ' +
    (PREFS.push ? L('сповіщення увімкнені') : L('сповіщення вимкнені')) +
    L(' — натисніть, щоб переключити');
}

/**
 * Кнопка темы. Три положения по кругу: как в системе, светлая, тёмная.
 * Отдельного меню нет намеренно — на три пункта оно не нужно, а место
 * в панели разделов дорогое.
 */
function paintThemeBtn(){
  var b = el('themeTitle');
  if (!b) return;
  var v = themeGet();
  b.dataset.painted = '';
  b.innerHTML = '';
  b.insertAdjacentHTML('afterbegin', icon(v === 'light' ? 'sun' : v === 'dark' ? 'moon' : 'auto'));
  b.insertAdjacentText('beforeend', v === 'light' ? L('Світла') : v === 'dark' ? L('Темна') : L('Тема'));
  b.title = v === 'auto'
    ? L('Тема як у системі — натисніть, щоб вибрати світлу')
    : v === 'light' ? L('Світла тема — натисніть, щоб вибрати темну')
      : L('Темна тема — натисніть, щоб повернути системну');
}

/**
 * Уведомление в системе.
 *
 * Показываем только когда вкладка не на виду. Всплывающее окно поверх
 * экрана, на который человек и так смотрит, — это раздражение,
 * а не помощь.
 */
function notify(c){
  if (!PREFS.push || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible' && !document.hidden) return;

  try {
    var n = new Notification(c.display_name || L('Нове повідомлення'), {
      body: c.preview || L('Клієнт написав у ') + (CH[c.channel_type] || c.channel_type),
      // tag по диалогу: три сообщения подряд заменяют друг друга,
      // а не выстраиваются в стопку из трёх окон.
      tag: 'od-' + c.id,
      renotify: true
    });
    n.onclick = function(){ window.focus(); openConv(c.id); n.close() };
  } catch (e) { /* не поддерживается — не беда */ }
}

/**
 * Поиск новых входящих между двумя опросами.
 *
 * Первый проход только запоминает состояние и ничего не показывает:
 * иначе при каждом открытии страницы человек получал бы уведомления
 * обо всех непрочитанных за неделю.
 */
var seenAt = {}, primed = false;

function detectNew(list){
  var fresh = [];
  list.forEach(function(c){
    var prev = seenAt[c.id];
    seenAt[c.id] = c.last_message_at;
    if (primed && c.unread_count > 0 && prev !== undefined && prev !== c.last_message_at) {
      fresh.push(c);
    }
  });
  if (!primed) { primed = true; return [] }
  return fresh;
}

function announce(list){
  if (!list.length) return;
  beep();
  // Больше трёх окон подряд — это уже не уведомление, а помеха.
  list.slice(0, 3).forEach(notify);
}

/* ══════════════ Загрузка и опрос ══════════════ */

function fillChannelFilter(){
  var sel = el('fCh');
  var want = L('<option value="">Всі канали</option>') + CHANNELS.map(function(c){
    return '<option value="' + c.id + '">' + esc(c.display_name) + '</option>';
  }).join('');
  if (sel.innerHTML === want) return;
  var keep = sel.value;
  sel.innerHTML = want;
  sel.value = keep;
}

function refresh(){
  return api(query()).then(function(d){
    convs = d.conversations || [];
    announce(detectNew(convs));
    renderList();
    if (current){
      renderHead();
      loadThread();
    }
    return api('/conversations/counts');
  }).then(function(d){
    COUNTS = (d && d.counts) || {};
    renderCounts();
  }).catch(showErr);
}

function showErr(e){
  if (e && e.status === 401){ logout(); el('gateErr').textContent = L('Токен недійсний або застарів'); }
}

var VIEWS = {
  channels: tabChannels,
  bots: renderBots,
  replies: tabReplies,
  users: tabUsers,
  profile: tabProfile,
  integrations: pageIntegrations,
  notify: tabNotify
};

function setView(view){
  el('app').dataset.view = view;
  if (view === 'chats') { backToList(); }
  Array.prototype.forEach.call(document.querySelectorAll('.rbtn[data-view]'), function(b){
    b.classList.toggle('on', b.dataset.view === view);
  });
  if (view !== 'chats') {
    S.view = view;
    S.channelId = null;
    pageBox().innerHTML = L('<div class="pg"><div class="empty">Завантажую...</div></div>');
    (VIEWS[view] || function(){})();
  }
}

/**
 * Показать интерфейс по роли.
 *
 * Сервер и так откажет оператору в настройках — проверка стоит на
 * каждом запросе. Но кнопка, которая отвечает «вам нельзя», хуже, чем
 * её отсутствие: человек не должен упираться в запертые двери, чтобы
 * понять, где его работа.
 */
function applyRole(){
  var admin = ROLE === 'owner' || ROLE === 'admin';
  Array.prototype.forEach.call(document.querySelectorAll('[data-admin]'), function(b){
    b.style.display = admin ? '' : 'none';
  });
  // Если оператор стоял в закрытом для него разделе — возвращаем в чаты.
  if (!admin && el('app').dataset.view !== 'chats' && el('app').dataset.view !== 'profile'){
    setView('chats');
  }
}

function isAdmin(){ return ROLE === 'owner' || ROLE === 'admin' }

function start(){
  applyLang();
  el('gate').style.display = 'none';
  el('app').style.display = 'grid';
  fitHeight();
  paintIcons();
  paintBell();
  paintThemeBtn();

  // Справочники грузим один раз при входе: без них список нельзя
  // отфильтровать по каналу, а кнопку «взять себе» — показать.
  api('/me').then(function(d){
    ME = d;
    ROLE = (d && d.user && d.user.role) || 'agent';
    applyRole();
  }).catch(function(){});
  api('/channels').then(function(d){ CHANNELS = d.channels || []; fillChannelFilter() }).catch(function(){});
  api('/quick-replies').then(function(d){ QR = d.quickReplies || [] }).catch(function(){});
  api('/settings/ai').then(function(d){
    AI.ready = Boolean(d && d.connected && d.mode !== 'off');
    if (AI.ready && current) renderComposer(true);
  }).catch(function(){});

  refresh();
  readMetaHash();
  readPipedriveHash();
  readNotifyHash();
  // Три секунды — компромисс: живо ощущается и не создаёт заметной
  // нагрузки. Позже сюда встанут вебсокеты, и опрос уйдёт.
  timer = setInterval(refresh, 3000);
}

/**
 * Перерисовать интерфейс целиком.
 *
 * Нужна после смены языка: каркас переводится по месту, а всё
 * остальное собрано строками и меняется только при новой сборке.
 */
function redrawAll(){
  applyLang();
  fillChannelFilter();
  renderList();
  renderCounts();
  if (current){ renderHead(); lastThread = null; loadThread(); renderComposer(true) }
  var view = el('app').dataset.view;
  if (VIEWS[view]) VIEWS[view]();
}

function logout(){
  clearInterval(timer);
  api('/auth/session', { method:'DELETE' }).catch(function(){});
  TOKEN = ''; current = null; convs = [];
  tokenWrite('');
  el('app').style.display = 'none';
  el('gate').style.display = 'flex';
  gateStep('stepEmail');
}

/* ── Обработчики ─────────────────────────────────────────────────── */

Array.prototype.forEach.call(document.querySelectorAll('.rbtn[data-view]'), function(b){
  b.onclick = function(){ setView(b.dataset.view) };
});
el('logo').onclick = function(){ setView('chats') };

Array.prototype.forEach.call(document.querySelectorAll('.tab'), function(b){
  b.onclick = function(){
    F.status = b.dataset.status;
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function(x){
      x.classList.toggle('on', x === b);
    });
    lastList = null;
    refresh();
  };
});

el('fCh').onchange = function(){ F.channelId = this.value; lastList = null; refresh() };
el('fAs').onchange = function(){ F.assignee = this.value; lastList = null; refresh() };

// Поиск с задержкой: без неё каждый набранный символ уходил бы
// отдельным запросом к базе.
var qTimer = null;
el('fQ').oninput = function(){
  var v = this.value;
  clearTimeout(qTimer);
  qTimer = setTimeout(function(){ F.q = v; lastList = null; refresh() }, 350);
};

el('cardBtn').onclick = function(){ el('app').classList.toggle('no-card') };
el('out').onclick = logout;
el('themeTitle').onclick = function(){ themeCycle(); paintThemeBtn() };

/* ── Колокольчик: звук и уведомления ─────────────────────────────
   Одна кнопка на два переключателя. Первое нажатие включает звук,
   второе — запрашивает разрешение на уведомления, третье выключает всё.
   Разрешение спрашивается по нажатию, а не при загрузке: браузеры
   отклоняют запрос без действия человека, а сам вопрос при входе
   выглядит навязчиво. */
el('bell').onclick = function(){
  if (!PREFS.sound && !PREFS.push){
    PREFS.sound = true;
    // Заодно будим звук: разрешение на воспроизведение даётся
    // браузером только внутри обработчика нажатия.
    beep();
    savePrefs();
    return;
  }
  if (PREFS.sound && !PREFS.push){
    if ('Notification' in window && Notification.permission !== 'denied'){
      Notification.requestPermission().then(function(p){
        PREFS.push = p === 'granted';
        savePrefs();
        if (!PREFS.push) alertLine(L('Браузер не дозволив сповіщення'));
      });
      return;
    }
  }
  PREFS.sound = false; PREFS.push = false; savePrefs();
};

/* ── Вход ────────────────────────────────────────────────────────── */

var pendingEmail = '';

function gateStep(name){
  ['stepEmail','stepSignup','stepPass','stepCode','stepWs','stepToken'].forEach(function(id){
    el(id).style.display = id === name ? 'block' : 'none';
  });
}

function enterWith(token){
  TOKEN = token;
  tokenWrite(TOKEN);
  start();
  sessionKeep();
}

/**
 * Попросить сервер запомнить вход в cookie. Без неё новая вкладка
 * видела форму входа у уже вошедшего человека: localStorage мог быть
 * пуст, а вход сделан в соседней вкладке или внутри рамки Zoho.
 */
function sessionKeep(){
  api('/auth/session', { method:'POST' }).catch(function(){});
}

el('ask').onclick = function(){
  var email = el('email').value.trim();
  el('gateErr').textContent = '';
  if (!email || email.indexOf('@') < 1){
    el('gateErr').textContent = L('Введіть пошту');
    return;
  }
  busy(el('ask'), true);
  api('/auth/request', { method:'POST', body:{ email: email } })
    .then(function(){
      pendingEmail = email;
      el('sentTo').textContent = email;
      gateStep('stepCode');
      el('code').focus();
    })
    .catch(function(e){
      var p = e.payload || {};
      el('gateErr').textContent =
        p.error === 'too_many_requests' ? p.detail
        : p.error === 'mail_failed' ? p.detail
        : L('Не вдалося надіслати код');
    })
    .then(function(){ busy(el('ask'), false) });
};

el('toSignup').onclick = function(){
  el('suEmail').value = el('email').value.trim();
  gateStep('stepSignup');
  el('suCompany').focus();
};
el('suBack').onclick = function(){ gateStep('stepEmail') };

/**
 * Регистрация.
 *
 * Отправляет тот же код на почту, но с названием компании: тенант
 * создаётся на сервере только после ввода кода. До этого момента в базе
 * не появляется ничего — иначе перебором адресов её засорили бы пустыми
 * организациями.
 */
el('suGo').onclick = function(){
  var company = el('suCompany').value.trim();
  var email = el('suEmail').value.trim();
  el('suErr').textContent = '';
  if (company.length < 2){ el('suErr').textContent = L('Напишіть назву компанії'); return }
  if (!email || email.indexOf('@') < 1){ el('suErr').textContent = L('Введіть робочу пошту'); return }

  busy(el('suGo'), true);
  api('/auth/request', { method:'POST', body:{ email: email, company: company } })
    .then(function(){
      pendingEmail = email;
      el('sentTo').textContent = email;
      gateStep('stepCode');
      el('code').focus();
    })
    .catch(function(e){
      var p = e.payload || {};
      el('suErr').textContent = p.detail || L('Не вдалося надіслати код');
    })
    .then(function(){ busy(el('suGo'), false) });
};

function submitCode(tenantId){
  var code = el('code').value.trim();
  el('codeErr').textContent = '';
  if (code.length !== 6){ el('codeErr').textContent = L('Код із шести цифр'); return }

  busy(el('verify'), true);
  var body = { email: pendingEmail, code: code };
  if (tenantId) body.tenantId = tenantId;

  api('/auth/verify', { method:'POST', body: body })
    .then(function(r){
      // 300 приходит, когда почта заведена в нескольких организациях:
      // выбрать за человека нельзя, он попадёт не туда и не поймёт почему.
      if (r.needsWorkspace){
        showWorkspaces(r.needsWorkspace, function(id){ gateStep('stepCode'); submitCode(id) });
        return;
      }
      if (r.token) {
        enterWith(r.token);
        // Первый вход в только что созданную компанию: сразу ведём туда,
        // где всё начинается, иначе человек видит пустой список чатов
        // и не понимает, что делать дальше.
        if (r.created) {
          setView('channels');
          toast(L('Компанію створено. Підключіть перший канал — це десять хвилин.'));
        }
      }
    })
    .catch(function(e){
      var p = e.payload || {};
      el('codeErr').textContent =
        p.error === 'wrong_code'
          ? L('Невірний код') + (p.attemptsLeft > 0 ? L(', залишилось спроб: ') + p.attemptsLeft : '')
        : p.error === 'code_expired' ? L('Код застарів, запросіть новий')
        : p.error === 'too_many_attempts' ? L('Занадто багато спроб, запросіть новий код')
        : p.error === 'no_code' ? L('Код не запитували')
        : L('Не вдалося увійти');
    })
    .then(function(){ busy(el('verify'), false) });
}

el('verify').onclick = function(){ submitCode(null) };
/**
 * Выбор организации, когда почта заведена в нескольких.
 *
 * Выбрать за человека нельзя: он попадёт не туда и не поймёт почему.
 * Одна и та же кнопка нужна и коду, и паролю — отсюда общий вид.
 */
function showWorkspaces(list, pick){
  el('wsList').innerHTML = list.map(function(w){
    return '<button class="ghost" style="width:100%;margin-top:8px" data-ws="' +
      w.tenantId + '">' + esc(w.name) + '</button>';
  }).join('');
  gateStep('stepWs');
  Array.prototype.forEach.call(el('wsList').children, function(b){
    b.onclick = function(){ pick(b.dataset.ws) };
  });
}

/**
 * Вход паролем.
 *
 * Ответ на неверную пару один и тот же, что бы ни было не так: иначе
 * форма отвечает на вопрос, работает ли у нас такой человек.
 */
el('toPass').onclick = function(){
  gateStep('stepPass');
  el('pEmail').value = el('email').value;
  (el('pEmail').value ? el('pPass') : el('pEmail')).focus();
};
el('pBack').onclick = function(){ gateStep('stepEmail'); el('email').focus() };

function passLogin(tenantId){
  el('pErr').textContent = '';
  busy(el('pGo'), true);
  api('/auth/password', { method:'POST', body:{
    email: el('pEmail').value.trim(), password: el('pPass').value, tenantId: tenantId || undefined
  }}).then(function(d){
    if (d && d.needsWorkspace){
      busy(el('pGo'), false);
      showWorkspaces(d.needsWorkspace, passLogin);
      return;
    }
    enterWith(d.token);
  }).catch(function(e){
    var p = e.payload || {};
    el('pErr').textContent = p.error === 'too_many_attempts'
      ? L('Забагато спроб. Спробуйте за 15 хвилин або увійдіть кодом.')
      : L('Пошта або пароль не підходять');
    busy(el('pGo'), false);
  });
}

el('pGo').onclick = function(){ passLogin('') };
el('pPass').onkeydown = function(e){ if (e.key === 'Enter') passLogin('') };

el('again').onclick = function(){ gateStep('stepEmail'); el('email').focus() };
el('toToken').onclick = function(){ gateStep('stepToken') };
el('toEmail').onclick = function(){ gateStep('stepEmail') };

el('email').onkeydown = function(e){ if (e.key === 'Enter') el('ask').click() };
el('code').onkeydown = function(e){ if (e.key === 'Enter') el('verify').click() };
// Вставили код из письма целиком — входим сразу, без лишнего нажатия.
el('code').oninput = function(){
  if (this.value.replace(/[^0-9]/g, '').length === 6) el('verify').click();
};

el('enter').onclick = function(){
  var t = el('tok').value.trim();
  if (!t) return;
  el('tokErr').textContent = '';
  TOKEN = t;
  api('/conversations').then(function(){
    enterWith(t);
  }).catch(function(){
    TOKEN = '';
    el('tokErr').textContent = L('Токен не підійшов. Перевірте, що скопіювали цілком.');
  });
};
el('tok').onkeydown = function(e){ if (e.key === 'Enter') el('enter').click() };

/**
 * Запуск. Токен в хранилище страницы — быстрый путь. Если его нет,
 * спрашиваем сеанс у сервера: вход мог случиться в другой вкладке, а
 * хранилище у неё своё (или его почистили). Форму входа показываем
 * только когда и сеанса нет.
 */
applyLang();

if (TOKEN) {
  start();
  sessionKeep();
} else {
  api('/auth/session').then(function(d){
    if (!d || !d.token) return;
    TOKEN = d.token;
    tokenWrite(TOKEN);
    start();
  }).catch(function(){});
}
})();
</script>
</body>
</html>`;
