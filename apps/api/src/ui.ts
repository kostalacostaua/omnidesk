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
  /* Карточка клиента на узком экране.
     Места для третьей колонки нет, но карточка нужна не меньше: в ней
     телефон, метки, заметки, CRM и заказ. Поэтому она не пропадает, а
     выезжает поверх переписки по нажатию на имя клиента — там же, где
     на широком экране она и стоит, справа. */
  #cardVeil,#cardX{display:none}
  @media(max-width:1180px){#app{grid-template-columns:66px 306px minmax(0,1fr)}
    #app #card{display:none}
    /* Кнопка «Клієнт» прячет третью колонку, а третьей колонки здесь
       уже нет: карточка выезжает поверх переписки по нажатию на имя.
       Кнопка, которая ничего не делает, хуже отсутствующей — и место
       в шапке списка тут дороже всего. */
    #cardBtn{display:none}
    #app.card-open #card{display:block;position:fixed;top:0;right:0;bottom:0;
      width:min(390px,100%);z-index:88;background:var(--solid);
      border-left:1px solid var(--line);box-shadow:var(--lift2);
      animation:cardIn var(--calm) var(--ease)}
    #app.card-open #cardVeil{display:block;position:fixed;inset:0;z-index:87;
      background:rgba(11,16,34,.4);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}
    #app.card-open #cardX{display:flex;position:fixed;top:10px;right:10px;z-index:89;
      width:32px;height:32px;align-items:center;justify-content:center;font-size:20px;
      line-height:1;padding:0;border-radius:var(--rf);background:var(--panel2);
      border:1px solid var(--line);color:var(--t2)}
    /* Имя в шапке — это и есть кнопка. Отдельная иконка рядом заняла бы
       место, которого на телефоне нет, а по имени попадают пальцем. */
    .thead .who{cursor:pointer}}
  @keyframes cardIn{from{transform:translateX(16px);opacity:0}to{transform:none;opacity:1}}
  @media(prefers-reduced-motion:reduce){#app.card-open #card{animation:none}}
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
  /* Фильтров стало четыре, и в одну строку они помещаются только
     обрезанными до «Усі к...». Две строки по два — единственное, что
     оставляет названия читаемыми в узкой колонке списка. */
  .filters{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}
  .filters select{padding:6px 8px;font-size:12px;border-radius:6px;background:var(--panel);
    flex:1 1 calc(50% - 3px);min-width:0}
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
  .mwrap{display:flex;flex-direction:column;max-width:min(540px,76%)}
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
  .picker{position:fixed;background:var(--panel);border:1px solid var(--line2);
    border-radius:9px;padding:5px;display:flex;gap:1px;z-index:60;
    box-shadow:0 10px 30px rgba(0,0,0,.18)}
  .picker.emo button{background:transparent;border:0;font-size:18px;padding:3px 5px;
    border-radius:6px;line-height:1;color:inherit}
  .picker.emo button{box-shadow:none;transition:transform .08s ease,background-color .12s ease}
  .picker.emo button:hover{background:var(--hover);transform:scale(1.18)}
  .picker.emo button:active{transform:scale(.95)}
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

  /* Кнопки действий внутри карточки настроек. Без этого правила они
     слипались в углу: у .acts стиль был только в шапке чата и в плитке
     канала, а в карточке — никакого. */
  .card .acts{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-top:14px}
  .card .acts button{margin:0}

  /* Выбор цвета. Квадрат самого цвета вместо списка «Колір 1…12»:
     номер цвета не значит ничего, а цвет виден сразу. */
  .swatch{width:34px;height:34px;padding:0;border-radius:9px;border:2px solid transparent;
    box-shadow:var(--shadow);flex:none}
  .pal{display:grid;grid-template-columns:repeat(6,1fr);gap:6px;padding:8px}
  .pal button{width:30px;height:30px;padding:0;border-radius:8px;border:2px solid transparent;
    box-shadow:none}
  .pal button.on{border-color:var(--t1);transform:scale(1.06)}

  /* Фильтр с галочками: несколько значений сразу, а не одно. */
  .fbtn{background:var(--panel);border:1px solid var(--line);color:var(--t1);
    padding:6px 8px;font-size:12px;border-radius:6px;flex:1 1 calc(50% - 3px);min-width:0;
    box-shadow:none;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .fbtn.on{border-color:var(--brand1);color:var(--brand1);font-weight:600}
  /* Окошко непрозрачное: сквозь список с галочками не должно
     просвечивать то, что под ним, — иначе подписи нечитаемы. */
  .picker.fpick,.picker.pal{background:var(--solid);backdrop-filter:none;
    -webkit-backdrop-filter:none}
  .fpick{display:block;padding:6px;max-height:320px;overflow-y:auto;min-width:210px}
  .fopt{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:7px;
    font-size:13px;cursor:pointer}
  .fopt:hover{background:var(--hover)}
  /* Поля ввода в этом интерфейсе растянуты на всю ширину, и галочка
     без этой строки съедала строку целиком, выталкивая подпись за край
     окошка. */
  .fopt input[type=checkbox]{width:16px;height:16px;flex:none;margin:0;padding:0}
  .fopt span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .fpick .fact{border-top:1px solid var(--line);margin-top:4px;padding-top:6px;text-align:right}
  .fpick .fact button{font-size:12px;padding:5px 10px}

  /* Папка в списке шаблонов — заголовок группы, а не строка списка:
     её нельзя открыть или выбрать, в неё можно только положить. */
  .qfd{display:flex;align-items:center;gap:9px;padding:12px 0 6px;flex-wrap:wrap}
  .qfd .nm{font-weight:600;font-size:13.5px}
  .qfd .dim{font-size:12px}
  .mvsel{padding:4px 7px;font-size:12px;border-radius:7px;max-width:150px;
    background:var(--panel);border:1px solid var(--line);color:var(--t1)}
  .tplbox .qfdl{padding:6px 11px 3px;font-size:11px;font-weight:600;
    color:var(--t3);text-transform:uppercase;letter-spacing:.04em}
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
  /* Полоска «показан один диалог»: состояние списка, в которое можно
     попасть из отчёта, обязано быть видно и сниматься одним щелчком. */
  .drill{display:flex;align-items:center;gap:8px;margin-top:9px;padding:7px 10px;
    border-radius:9px;background:var(--panel2);font-size:12px;color:var(--t2)}
  .drill button{padding:3px 9px;font-size:11.5px;box-shadow:none}

  /* Отчёты. Полоса отбора и столбики по дням — всё, что здесь своего;
     таблицы берут вид у матрицы доступов. */
  .rpbar{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-bottom:14px}
  .rpbar .grow{flex:1}
  .rpbar button.on{border-color:var(--brand1);color:var(--brand1);font-weight:600}
  .rptabs{margin-bottom:14px}
  /* Полоска в строке таблицы: она отвечает на «кто больше» быстрее,
     чем колонка чисел, и не занимает отдельного графика. */
  .sbar{display:block;height:7px;border-radius:4px;background:var(--panel2);overflow:hidden}
  .sbar i{display:block;height:100%;background:var(--brand1);border-radius:4px;min-width:2px}
  /* Выполнение плана: цвет отвечает на «успеваем или нет» раньше, чем
     человек прочитает числа. */
  .plan{height:4px;border-radius:3px;background:var(--panel2);margin-top:4px;overflow:hidden}
  .plan i{display:block;height:100%;border-radius:3px;min-width:2px}
  .plan i.ok{background:var(--ok, #16a34a)}
  .plan i.mid{background:#ca8a04}
  .plan i.bad{background:#dc2626}
  .bars{display:flex;gap:8px;align-items:flex-end;overflow-x:auto;padding-bottom:4px}
  /* Не .col: это имя уже занято общим правилом с колонкой по
     вертикали, и столбики от него вставали друг под друга. */
  .bar{display:flex;flex-direction:column;align-items:center;gap:5px;flex:0 0 38px}
  .bar .bcol{display:flex;flex-direction:row;gap:3px;align-items:flex-end;height:110px;
    width:100%;justify-content:center}
  .bar i{width:13px;border-radius:3px 3px 0 0;min-height:2px;display:block}
  /* Два цвета и никакой легенды внутри столбика: подпись под графиком
     объясняет их один раз, а не двадцать. */
  .bar i.in,b.in{background:var(--brand1);color:var(--brand1)}
  .bar i.out,b.out{background:var(--ok, #16a34a);color:var(--ok, #16a34a)}
  .bar span{font-size:10px;color:var(--t3);white-space:nowrap}

  /* Матрица доступов: люди по строкам, каналы и папки по столбцам.
     Первый столбец не уезжает при прокрутке вбок — без имени строка
     галочек не значит ничего. */
  .mtxwrap{overflow-x:auto;margin-top:6px}
  .mtx{border-collapse:separate;border-spacing:0;font-size:12.5px;min-width:100%}
  .mtx th,.mtx td{padding:8px 10px;text-align:center;white-space:nowrap;
    border-bottom:1px solid var(--line)}
  .mtx th{font-weight:600;color:var(--t2);font-size:11.5px;vertical-align:bottom}
  .mtx th:first-child,.mtx td:first-child{text-align:left;position:sticky;left:0;
    background:var(--solid);z-index:2;min-width:190px}
  .mtx tbody tr:hover td{background:var(--hover)}
  .mtx tbody tr:hover td:first-child{background:var(--hover)}
  .mtx input{width:17px;height:17px;margin:0;padding:0}
  /* Галочка «по умолчанию всё» отличается от поставленной руками:
     иначе строка «видит всё» и строка «выбрано всё» выглядят одинаково,
     а ведут себя по-разному, когда появится новый канал. */
  .mtx input.all{opacity:.45}
  .mtx .who{display:flex;align-items:center;gap:7px}
  .mtx .who b{font-weight:600}
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
  .prow .pacts{display:flex;gap:6px;flex:none;flex-wrap:wrap}
  /* На телефоне строка раскладывается в три этажа: подпись, значение с
     пояснением, кнопки. Значение занимает всю ширину нарочно — рядом с
     кнопкой ему остаётся полсотни пикселей, и пояснение под ним
     переносится по одному слову в строку. */
  @media(max-width:620px){
    .prow{flex-wrap:wrap;gap:4px 10px}
    .prow .pk{width:100%}
    .prow .pv{flex:1 1 100%}
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
    border:0;font-size:13px;letter-spacing:-.02em;
    /* Фото приезжает своего размера — у Telegram это 640 на 640, у
       Instagram бывает больше. Без этих трёх строк браузер кладёт его
       в кружок как есть, и в 38 пикселях видно случайный кусок щеки.
       Размер задаётся после сокращения background: сокращение сбрасывает
       его в auto, и порядок здесь не косметический. */
    background-size:cover;background-position:center;background-repeat:no-repeat}
  .conv .nm{font-size:13.5px}
  .chip{border-radius:7px;padding:2px 7px;background:var(--panel2);color:var(--t2)}
  /* Свой статус — единственная цветная метка в строке, и цвет у неё
     заданный человеком. Белый текст поэтому жёстко: палитра подобрана
     тёмной, и на светлой теме он остаётся читаемым. */
  .chip.st{color:#fff;font-weight:600}
  .sdot{display:inline-block;width:9px;height:9px;border-radius:3px;flex:none}

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
  /* ─── Движение ─────────────────────────────────────────────────── */
  /* Правило одно: движется то, что изменилось, и ровно настолько,
     чтобы глаз успел проследить. Отсюда признак fresh: лента и список
     перерисовываются целиком на каждом опросе, и анимация, висящая
     прямо на классе элемента, означала бы, что раз в три секунды
     вспыхивает всё подряд. Признак ставит разметке только те узлы,
     которых в прошлый раз не было. */
  .mwrap.fresh{animation:rise .26s cubic-bezier(.2,.8,.3,1)}
  .mwrap.in.fresh{animation-name:riseIn}
  .mwrap.out.fresh{animation-name:riseOut}
  @keyframes rise{from{opacity:0;transform:translateY(8px) scale(.985)}to{opacity:1;transform:none}}
  /* Своё сообщение приезжает справа, чужое слева — с той стороны, где
     оно и живёт. Это дешевле подписи: сторону видно раньше, чем текст. */
  @keyframes riseIn{from{opacity:0;transform:translate(-10px,8px) scale(.985)}to{opacity:1;transform:none}}
  @keyframes riseOut{from{opacity:0;transform:translate(10px,8px) scale(.985)}to{opacity:1;transform:none}}

  /* Смена диалога — одно движение на всю ленту, а не сорок отдельных:
     человек переключил разговор, а не получил сорок писем разом. */
  #msgs.swap{animation:swapIn .22s cubic-bezier(.2,.8,.3,1)}
  #page .pg{animation:swapIn .24s cubic-bezier(.2,.8,.3,1)}
  @keyframes swapIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}

  /* Список чатов переставляется, а не возникает заново. Строка,
     уехавшая наверх из-за нового сообщения, доезжает туда на глазах:
     иначе непонятно, что именно изменилось и почему всё съехало. */
  .conv.flip{transition:transform .34s cubic-bezier(.2,.8,.3,1)}
  .conv.enter{animation:convIn .28s cubic-bezier(.2,.8,.3,1)}
  @keyframes convIn{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:none}}
  .badge.pop{animation:pop .34s cubic-bezier(.2,.8,.3,1)}
  @keyframes pop{0%{transform:scale(.4);opacity:0}60%{transform:scale(1.18)}
    100%{transform:none;opacity:1}}

  /* Нажатие. Кнопка обязана ответить пальцу раньше, чем ответит сервер;
     шестьдесят миллисекунд здесь делают интерфейс не быстрее, а живым. */
  button:active:not(:disabled){transform:scale(.97)}
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
  /* ─── Окно заказа ──────────────────────────────────────────────── */
  /* Каталог и собранный заказ рядом: выбирают глядя на то, что уже
     набрано. Узкая колонка карточки для этого мала, поэтому окно
     шире обычного, а на телефоне колонки просто встают друг под
     друга. */
  .sheet.wide{max-width:900px}
  .orow{display:flex;justify-content:space-between;align-items:center;gap:10px}
  .ocols{display:flex;gap:16px;flex-wrap:wrap;margin-top:12px}
  .ocol{flex:1 1 320px;min-width:0}
  .olist{margin-top:8px;max-height:44vh;overflow-y:auto;
    border:1px solid var(--line);border-radius:12px}
  .oitem{display:flex;gap:10px;align-items:center;padding:7px 10px;cursor:pointer;
    font-size:12.5px;border-bottom:1px solid var(--line)}
  .oitem:last-child{border-bottom:0}
  .oitem:hover{background:var(--hover)}
  .oitem .on,.oline .on{flex:1;min-width:0;overflow:hidden;
    text-overflow:ellipsis;white-space:nowrap}
  .oline{display:flex;gap:6px;align-items:center;margin-top:5px;font-size:12.5px}
  .ochk{display:flex;gap:7px;align-items:center;margin-top:7px;font-size:12.5px}
  .ochk input[type=checkbox]{width:16px;height:16px;flex:none;margin:0;padding:0}
  .req{color:var(--crit)}

  /* Настройка заказа: отметки полей идут в две колонки — их бывает
     тридцать, и один столбец превращает карточку в простыню. */
  .osf{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:0 14px;
    margin-top:6px;max-height:280px;overflow-y:auto}
  .osp{padding:8px 0;border-bottom:1px solid var(--line)}
  .osp:last-child{border-bottom:0}
  .osc{display:flex;gap:12px;flex-wrap:wrap}
  .osc .fld{flex:1 1 180px;min-width:0}

  .stab{border-radius:10px 10px 0 0;padding:10px 12px}
  .stab.on{color:var(--accent);border-color:var(--accent);background:var(--accent-soft)}
  .item{border-radius:12px}
  #toast{border-radius:14px;box-shadow:var(--lift);backdrop-filter:var(--blur);
    -webkit-backdrop-filter:var(--blur)}
  .qrwrap{border-radius:18px;background:var(--panel);border-color:var(--line)}
  .pill,.badge{border-radius:999px}

  /* Человек, попросивший систему не двигаться, просил об этом всерьёз:
     у части людей движение на экране вызывает тошноту и головокружение.
     Поэтому не список исключений, а одно правило на всё — иначе каждая
     новая анимация проезжает мимо него незамеченной. */
  @media(prefers-reduced-motion:reduce){
    *,*::before,*::after{animation-duration:.01ms !important;
      animation-iteration-count:1 !important;transition-duration:.01ms !important;
      scroll-behavior:auto !important}
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
  .chico.telegram_bot,.chico.telegram_user,
  .chico.telegram_business{background:linear-gradient(140deg,#37aee2,#1e96c8)}
  .chico.instagram{background:linear-gradient(140deg,#f9a03f,#d92e7f 55%,#8a3ab9)}
  .chico.messenger{background:linear-gradient(140deg,#00b2ff,#006aff)}
  .chico.whatsapp,.chico.whatsapp_cloud,
  .chico.whatsapp_user{background:linear-gradient(140deg,#5bd066,#1faa53)}
  .chico.viber_business,.chico.viber_user{background:linear-gradient(140deg,#8f5db7,#665cac)}
  .chico.webchat{background:linear-gradient(140deg,#2F6BFF,#7A3CF0);font-size:9px}
  .chico.custom{background:linear-gradient(140deg,#4b5563,#111827);font-size:10px}
  .chico.messenger_comments{background:linear-gradient(140deg,#00b2ff,#006aff)}
  .chico.instagram_comments{background:linear-gradient(140deg,#f9a03f,#d92e7f 55%,#8a3ab9)}
  .chico.email{background:linear-gradient(140deg,#64748b,#0f172a);font-size:15px}
  .chico svg{width:21px;height:21px;display:block}

  /* Тот же значок на аватарке в списке и в шапке диалога. Классы те же,
     что у плитки канала: цвет сети задан один раз и не разъедется. */
  /* Обёртке нужны собственные размеры и свой край: в строке списка она
     флекс-ребёнок и без этого растянулась бы на всю высоту строки —
     значок уехал бы вниз, к меткам, вместо угла аватарки. */
  .avwrap{position:relative;flex:none;align-self:flex-start;
    width:38px;height:38px;line-height:0}
  .chico.sm{position:absolute;right:-3px;bottom:-3px;width:17px;height:17px;
    border-radius:50%;border:2px solid var(--panel);box-sizing:content-box}
  .chico.sm svg{width:11px;height:11px}
  .thead .avwrap .chico.sm{border-color:var(--panel)}
  /* Записи DNS: четыре колонки, значение переносится. На узком экране
     строка становится в столбик — копировать всё равно придётся руками. */
  .mlrec{display:flex;flex-direction:column;gap:6px}
  .mlrow{display:grid;grid-template-columns:70px 130px minmax(0,1fr) 80px;gap:8px;
    align-items:start;font-size:12px;padding:7px 9px;border:1px solid var(--line);
    border-radius:10px;background:var(--panel2)}
  .mlrow .t{font-weight:700}
  /* Цены тарифа: название и три валюты. Класс у строки свой, а не общий
     prow: тот же prow уже занят строками профиля, и одинаковое имя на
     две разные сетки означало, что профиль на телефоне складывался в
     колонку шириной в одно слово, а кнопки выезжали за экран. */
  .pricerow{display:grid;grid-template-columns:110px repeat(3,minmax(0,1fr));gap:8px;
    align-items:center;padding:6px 9px;border:1px solid var(--line);border-radius:10px;
    background:var(--panel2)}
  /* Строка тарифа кликабельна целиком: выбирают тариф, а не галочку.
     Имя не .plan: так уже называется полоска заполнения, и общее имя
     задавало строке её высоту в четыре пикселя. */
  .prow.tariff{cursor:pointer;border-radius:10px;padding-left:8px;padding-right:8px}
  .prow.tariff:hover{background:var(--hover)}
  .prow.tariff.on{background:var(--railOnBg)}
  .prow.tariff .pick{flex:none;width:22px;text-align:center;color:var(--accent);font-weight:700}
  .prow.tariff .pk .s{font-size:11px;color:var(--t3);font-weight:400;margin-top:2px}
  /* Стена оплаты. Поверх всего и со своей прокруткой: под ней живой
     кабинет, но работать в нём нельзя, и подглядывать в него незачем. */
  #wall{position:fixed;inset:0;z-index:90;background:var(--bg);overflow:auto;padding:40px 16px}
  .wallbox{max-width:640px;margin:0 auto}
  .wallbox h2{font-size:22px;margin:0 0 6px}
  .wallbox p{margin:0 0 16px;font-size:13.5px}
  .pricerow .t{font-weight:700;font-size:12.5px}
  .pricerow .t .s{font-weight:400;font-size:11px;color:var(--t3);margin-top:2px}
  .pricerow input{font-size:12.5px;padding:6px 8px}
  @media(max-width:700px){ .pricerow{grid-template-columns:1fr 1fr} }
  .mlrow code{font-size:11.5px;word-break:break-all;white-space:normal}
  @media (max-width:700px){ .mlrow{grid-template-columns:1fr} }
  /* Комментарий в ленте: под каким постом он написан и ушёл ли ответ
     в личные. Мелко и рядом с текстом — это пометка, а не сообщение. */
  .cmt{font-size:11px;opacity:.72;margin-bottom:4px}
  .cmt a{color:inherit;text-decoration:underline}

  /* ── Графики ──────────────────────────────────────────────────
     Тонкие метки, скруглённый верх столбца, зазор в два пиксела между
     соседними, приглушённая сетка. Подпись значений — не на каждом
     столбце, а в подсказке: числа на каждом пикселе читать невозможно. */
  .viz{position:relative;padding-top:6px}
  .vbars{display:flex;align-items:flex-end;gap:5px;height:172px;position:relative;z-index:1}
  .vday{flex:1;display:flex;flex-direction:column;align-items:center;gap:5px;min-width:0;cursor:default}
  .vcol{display:flex;align-items:flex-end;gap:2px;height:150px;width:100%;justify-content:center}
  .vcol i{width:9px;max-width:42%;border-radius:4px 4px 0 0;display:block;min-height:2px;
    transition:opacity .12s ease}
  .vcol i.a{background:var(--viz1)}
  .vcol i.b{background:var(--viz2)}
  .vday:hover .vcol i{opacity:.7}
  .vday span{font-size:10px;color:var(--t3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
    max-width:100%}
  .vgrid{position:absolute;left:0;right:0;top:6px;bottom:22px;z-index:0}
  .vgrid u{position:absolute;left:0;right:0;border-top:1px solid var(--line);opacity:.7}
  .vgrid u b{position:absolute;left:0;top:-8px;font-size:10px;color:var(--t3);font-weight:400;
    background:transparent}
  .vlegend{display:flex;flex-wrap:wrap;gap:16px;font-size:12px;color:var(--t2);margin-top:10px}
  .vlegend i{width:10px;height:10px;border-radius:3px;display:inline-block;margin-right:6px;
    vertical-align:-1px}
  /* Распределение: ряд подписан словами, а число стоит рядом со
     столбцом — без него длину пришлось бы измерять глазом. */
  .vrow{display:grid;grid-template-columns:132px minmax(0,1fr) 52px;gap:10px;align-items:center;
    font-size:12.5px;margin-top:7px;color:var(--t2)}
  .vrow .f{height:10px;border-radius:5px;background:var(--panel2);overflow:hidden}
  .vrow .f i{display:block;height:100%;border-radius:5px;background:var(--viz1);min-width:2px}
  .vrow .n{text-align:right;color:var(--t1);font-weight:600;font-variant-numeric:tabular-nums}
  /* Тепловая карта: один тон, от светлого к тёмному. Радуги здесь быть
     не может — величина одна, и цвет обязан читаться как «больше». */
  .vheat{display:grid;grid-template-columns:36px repeat(24,minmax(0,1fr));gap:2px;align-items:center}
  .vheat .h{font-size:10px;color:var(--t3)}
  .vheat .c{height:15px;border-radius:3px;background:var(--heat0)}
  .vheat .c.s1{background:var(--heat1)} .vheat .c.s2{background:var(--heat2)}
  .vheat .c.s3{background:var(--heat3)} .vheat .c.s4{background:var(--heat4)}
  .vheat .c.s5{background:var(--heat5)}
  .vscale{display:flex;align-items:center;gap:4px;font-size:11px;color:var(--t3);margin-top:10px}
  .vscale i{width:22px;height:10px;border-radius:3px;display:inline-block}
  .vtip{position:fixed;z-index:400;pointer-events:none;background:var(--solid);
    border:1px solid var(--line2);border-radius:9px;padding:7px 10px;font-size:12px;color:var(--t1);
    box-shadow:var(--lift);white-space:pre-line;max-width:260px}
  /* Полоса «вы под клиентом». Висит поверх всего и не двигает вёрстку:
     забыть, от чьего имени пишешь, — самая дорогая ошибка в этой панели. */
  #impbar{position:fixed;left:50%;transform:translateX(-50%);bottom:14px;z-index:300;
    display:flex;align-items:center;gap:10px;padding:8px 14px;border-radius:999px;
    background:var(--crit);color:#fff;font-size:12.5px;font-weight:600;
    box-shadow:0 8px 24px rgba(0,0,0,.25)}
  #impbar button{background:rgba(255,255,255,.18);color:#fff;border:0}
  /* Выбор страниц Facebook: галочки рядом с подписью, а не во всю
     ширину. Общее правило input{width:100%} растягивает их и уносит
     текст на строку ниже — здесь оно не к месту. */
  #metaBody label{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
  #metaBody input[type=checkbox]{width:16px;height:16px;flex:none;margin:0}
  /* Выбор ответственного стоит среди кнопок шапки чата и не должен
     выглядеть чужеродно: тот же рост, та же сдержанность. */
  /* Расписание: семь одинаковых строк, и главное в них — чтобы день,
     выключенный или круглосуточный, было видно сразу, без вчитывания. */
  .whdays{display:flex;flex-direction:column;gap:6px;margin:10px 0}
  .whrow{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .whrow .ntev{min-width:130px}
  .whrow input[type=time]{max-width:120px}
  .whrow input[type=time]:disabled{opacity:.45}
  .asel{max-width:170px;padding:5px 8px;font-size:12.5px;border-radius:8px;
    background:var(--panel);border:1px solid var(--line);color:var(--t1)}
  /* Окно с ключами своего канала. Отдельное, а не общая модалка: здесь
     три длинные строки, которые человек будет выделять и копировать, и
     им нужна ширина, а не аккуратность. */
  .cuwrap{position:fixed;inset:0;z-index:70;display:flex;align-items:center;
    justify-content:center;padding:20px;background:rgba(11,16,34,.5)}
  .cubox{background:var(--panel);border:1px solid var(--line);border-radius:18px;
    box-shadow:var(--lift);padding:20px;max-width:620px;width:100%;
    max-height:86vh;overflow-y:auto}
  .cubox h3{margin:0 0 4px}
  .cubox .lbl{margin-top:12px;width:auto}
  /* Настройки виджета и его превью стоят рядом: подобрать цвет, глядя
     только на поле выбора цвета, нельзя. На узком экране превью уходит
     вниз — иначе не останется места ни тому, ни другому. */
  .tmlist{display:flex;flex-direction:column;gap:2px;margin-top:10px}
  .tmrow{display:flex;align-items:center;gap:10px;padding:7px 8px;border-radius:8px;
    cursor:pointer;font-size:13.5px}
  .tmrow:hover{background:var(--hover)}
  .tmrow input{width:auto;margin:0}
  .tmrole{color:var(--t3);font-size:12px}
  .tmnote{color:var(--t3);font-size:12px;margin-left:auto}
  .wcedit{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:14px;align-items:start}
  @media(max-width:900px){.wcedit{grid-template-columns:minmax(0,1fr)}}
  .wcprev{display:flex;flex-direction:column;gap:8px}
  .wcphone{border:1px solid var(--line);border-radius:18px;overflow:hidden;background:var(--panel);
    height:420px;box-shadow:var(--shadow)}
  .wcphone iframe{width:100%;height:100%;border:0;display:block}
  /* Показ самой кнопки: цвет и способ появления иначе подбираются
     вслепую — на чужом сайте, куда ещё надо доехать. */
  .wcdemo{border:1px solid var(--line);border-radius:14px;background:var(--panel2);
    height:110px;display:flex;align-items:center;justify-content:center;position:relative}
  .wcbtn{width:56px;height:56px;border:0;border-radius:50%;cursor:pointer;padding:0;
    display:flex;align-items:center;justify-content:center;color:#fff;
    box-shadow:0 10px 30px rgba(11,16,34,.28)}
  .wcbtn.left{margin-right:auto;margin-left:16px}
  .wcbtn.right{margin-left:auto;margin-right:16px}
  .wcbtn.fade{animation:wcfade .35s ease}
  .wcbtn.slide{animation:wcslide .35s ease}
  .wcbtn.pulse{animation:wcpulse 1.8s ease-out 3}
  @keyframes wcfade{from{opacity:0}to{opacity:1}}
  @keyframes wcslide{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}
  @keyframes wcpulse{0%{box-shadow:0 0 0 0 rgba(47,107,255,.5)}
    70%{box-shadow:0 0 0 18px rgba(47,107,255,0)}100%{box-shadow:0 0 0 0 rgba(47,107,255,0)}}
  .wclogo{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .wclogo img{width:40px;height:40px;border-radius:10px;object-fit:contain;
    background:var(--panel2);border:1px solid var(--line);padding:3px}
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
    /* Списки в этой строке ужимались до одной стрелки, и «відповідальний»
       с «статусом» становились двумя одинаковыми уголками. Раз строка
       всё равно прокручивается, пусть лучше она будет длиннее. */
    .thead .acts .asel{flex:none;min-width:128px}
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

<div id="impbar" style="display:none"></div>
<div id="app" data-view="chats">
  <nav id="rail">
    <div class="logo" id="logo" title="До чатів" data-tt style="cursor:pointer"><svg viewBox="0 0 100 100" aria-label="Rozmovio"><defs><linearGradient id="rzg" x1="10" y1="8" x2="92" y2="94" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#2F6BFF"/><stop offset="1" stop-color="#7A3CF0"/></linearGradient></defs><path fill-rule="evenodd" fill="url(#rzg)" d="M6 22A16 16 0 0 1 22 6H60A32 32 0 0 1 92 38A28 28 0 0 1 72 64.6L93 90.5A5 5 0 0 1 89 94H67.5A5 5 0 0 1 63.6 92.1L44 67L25.2 91.2A8 8 0 0 1 6 86ZM32 23H62A9 9 0 0 1 71 32V41A9 9 0 0 1 62 50H43L30.5 60.5A1.5 1.5 0 0 1 28 59.4V50.2A9 9 0 0 1 23 42V32A9 9 0 0 1 32 23Z"/></svg></div>
    <button class="rbtn on" data-view="chats" data-icon="chat" data-t>Чати<span class="cnt" id="railCnt" style="display:none"></span></button>
    <button class="rbtn" data-view="channels" data-icon="plug" data-admin="1" data-t>Канали</button>
    <button class="rbtn" data-view="bots" data-icon="bot" data-admin="1" data-t>Сценарії</button>
    <button class="rbtn" data-view="replies" data-icon="bolt" data-t>Шаблони</button>
    <button class="rbtn" data-view="statuses" data-icon="tag" data-admin="1" data-t>Статуси</button>
    <button class="rbtn" data-view="reports" data-icon="chart" data-admin="1" data-t>Звіти</button>
    <button class="rbtn" data-view="integrations" data-icon="link" data-admin="1" data-t>Інтеграції</button>
    <button class="rbtn" data-view="users" data-icon="team" data-admin="1" data-t>Команда</button>
    <button class="rbtn" data-view="notify" data-icon="bell" data-admin="1" data-t>Сповіщення</button>
    <button class="rbtn" data-view="owner" data-icon="chart" data-owner="1" style="display:none" data-t>Власник</button>
    <button class="rbtn" data-view="billing" data-icon="card" data-owner="1" style="display:none" data-t>Гроші</button>
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
        <button class="fbtn" id="fCh"></button>
        <button class="fbtn" id="fAs"></button>
        <button class="fbtn" id="fTag"></button>
        <button class="fbtn" id="fSt"></button>
      </div>
      <div class="search"><input id="fQ" placeholder="Пошук за імʼям або телефоном" data-tp autocomplete="off"></div>
      <div class="tabs">
        <button class="tab on" data-status="open" data-t>Відкриті<span class="n" id="nOpen"></span></button>
        <button class="tab" data-status="closed" data-t>Закриті<span class="n" id="nClosed"></span></button>
        <button class="tab" data-status="all" data-t>Усі</button>
      </div>
      <div class="drill" id="drill" style="display:none"></div>
    </div>
    <div id="convs"></div>
  </div>

  <div id="thread">
    <div class="thead" id="thead"><div class="dim" data-t>Оберіть діалог зліва</div></div>
    <div id="msgs"></div>
    <div class="composer" id="composer" style="display:none"></div>
  </div>

  <aside id="card"><div class="empty" data-t>Картка клієнта зʼявиться, коли відкриєте діалог</div></aside>
  <!-- Подложка и крестик живут рядом с карточкой, а не внутри: карточка
       перерисовывается целиком при каждом обновлении, и всё, что лежит
       в ней, исчезло бы вместе с обработчиками. -->
  <div id="cardVeil"></div>
  <button id="cardX" title="Закрити">×</button>

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
/* Коллеги для передачи чата. Отдельно от USERS: тот список админский и
   оператору недоступен, а передавать чат должен уметь каждый. */
var MATES = [];
// Подключён ли ИИ: от этого зависит, показывать ли кнопку черновика.
var AI = { ready:false };
// Роль вошедшего. До ответа сервера считаем оператором: показать
// лишнее и убрать — хуже, чем показать нужное чуть позже.
var ROLE = 'agent';
/* В каждом фильтре — список значений, а не одно. «Что у меня в
   Telegram и в WhatsApp» — такой же обычный вопрос, как про один
   канал, и смотреть его в два захода значит держать первый ответ в
   голове. Пустой список означает «все». */
var F = { status:'open', statusId:[], assignee:[], channelId:[], tag:[], q:'' };
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
      /* Срок оплаты вышел. Ответ один на все ручки, и разбирать его в
         каждой было бы двадцатью способами показать одно и то же. */
      if (r.status === 402) payWall(j);
      if (!r.ok) throw Object.assign(new Error(j.error || r.status), { payload: j, status: r.status });
      return j;
    });
  });
}


/**
 * Страница оплаты вместо кабинета.
 *
 * Пробный период кончился — работать нельзя, но заплатить можно, и
 * поэтому здесь не сообщение об ошибке, а тот же блок подписки, что в
 * профиле: тарифы, число лицензий, карта и счёт. Человеку, у которого
 * кончился срок, нужно одно действие, и оно должно быть на экране, а не
 * за тремя переходами.
 *
 * Ставится один раз: ответ 402 приходит на каждый опрос списка, и
 * перерисовывать стену каждые три секунды значило бы отбирать у
 * человека и поле ввода, и выбор тарифа.
 */
function payWall(info){
  if (el('wall')) return;
  var w = document.createElement('div');
  w.id = 'wall';
  w.innerHTML = '<div class="wallbox">' +
    L('<h2>Термін доступу вичерпано</h2>') +
    L('<p class="dim">Пробний період завершився') +
    ((info && info.paidUntil) ? ' ' + esc(fmtDate(info.paidUntil)) : '') +
    L(' Дані на місці й нікуди не дінуться — щоб продовжити роботу, оберіть тариф.</p>') +
    '<div id="bill" class="card">' + L('<div class="hint">Завантажую...</div>') + '</div>' +
    L('<div class="row2" style="margin-top:10px"><button class="ghost mini" id="wallOut">Вийти</button></div>') +
    '</div>';
  document.body.appendChild(w);
  el('wallOut').onclick = logout;
  billLoad();
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
  viber_user:L('Viber номерний'), custom:L('Власний канал'),
  messenger_comments:L('Facebook, коментарі'), instagram_comments:L('Instagram, коментарі'),
  email:L('Пошта') };

/* Комментарии — отдельный канал у той же страницы, и отличаются они не
   значком, а правилами: под постом отвечают всем сразу. */
function isComments(t){ return t === 'messenger_comments' || t === 'instagram_comments' }

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
  var p = ['status=' + encodeURIComponent(F.status)];
  if (F.assignee.length) p.push('assignee=' + encodeURIComponent(F.assignee.join(',')));
  if (F.channelId.length) p.push('channelId=' + encodeURIComponent(F.channelId.join(',')));
  if (F.tag.length) p.push('tag=' + encodeURIComponent(F.tag.join(',')));
  if (F.statusId.length) p.push('statusId=' + encodeURIComponent(F.statusId.join(',')));
  if (DRILL) p.push('id=' + encodeURIComponent(DRILL));
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
      '<div class="avwrap">' +
        '<div class="av" data-av="' + c.contact_id + '" style="background-color:' +
          avatarColor(c.display_name || c.id) + '">' + esc(initials(c.display_name)) + '</div>' +
        chBadge(c.channel_type) +
      '</div>' +
      '<div class="body">' +
        '<div class="r1"><span class="nm">' + esc(c.display_name || L('Без імені')) + '</span>' +
        '<span class="tm">' + esc(fmtTime(c.last_message_at)) + '</span></div>' +
        '<div class="pv">' + esc(c.preview || '') + '</div>' +
        '<div class="r3">' +
          '<span class="dot ' + (c.status === 'resolved' ? 'closed' : 'open') + '"></span>' +
          statusChip(c) +
          /* Название сети ушло в значок на аватарке. Остаётся то, чего
             значком не сказать: комментарии под постом — это не личная
             переписка, и оператор должен видеть это до того, как
             ответит всем сразу. */
          (isComments(c.channel_type) ? L('<span class="chip">коментарі</span>') : '') +
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

  var box = el('convs');

  // Где каждая строка стоит сейчас — снимаем до перерисовки: после неё
  // старых узлов уже нет, и сравнивать будет не с чем. Заодно
  // запоминаем счётчик непрочитанных: он меняется чаще всего, и
  // именно его изменение человек должен заметить.
  var was = {};
  var cnt = {};
  Array.prototype.forEach.call(box.querySelectorAll('.conv'), function(n){
    was[n.dataset.id] = n.getBoundingClientRect().top;
    var b = n.querySelector('.badge');
    cnt[n.dataset.id] = b ? b.textContent : '';
  });
  // Замена содержимого сбрасывает прокрутку, если список стал короче.
  var keep = box.scrollTop;

  box.innerHTML = html;
  box.scrollTop = keep;
  paintAvatars();

  Array.prototype.forEach.call(box.children, function(node){
    var id = node.dataset.id;
    if (!id) return;
    node.onclick = function(){ openConv(id) };

    var b = node.querySelector('.badge');
    if (b && b.textContent !== cnt[id]) b.classList.add('pop');

    // Строки не было — значит диалог новый, и он приезжает сверху,
    // а не возникает из ничего посреди списка.
    if (was[id] === undefined){ node.classList.add('enter'); return }

    var d = was[id] - node.getBoundingClientRect().top;
    if (Math.abs(d) < 1) return;
    // Ставим строку обратно на старое место без перехода и отпускаем
    // только следующим кадром: переход должен начаться оттуда, где
    // строка была, а не оттуда, где она уже оказалась.
    node.style.transform = 'translateY(' + d + 'px)';
    requestAnimationFrame(function(){
      node.classList.add('flip');
      node.style.transform = '';
      // Класс снимается после приезда: постоянный переход на transform
      // мешал бы следующей перестановке начаться с чистого места.
      setTimeout(function(){ node.classList.remove('flip') }, 400);
    });
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

/*
 * Что из ленты человек уже видел.
 *
 * Лента перерисовывается целиком, как только изменилось хоть одно
 * сообщение, — так дешевле и надёжнее. Но «перерисовалось» и
 * «появилось» для глаза не одно и то же: анимировать надо только
 * второе. Здесь и лежит разница между ними.
 */
var msgSeen = {};
var threadFirst = true;

function openConv(id, fromHistory){
  current = id;
  lastThread = null;
  msgSeen = {};
  threadFirst = true;
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

/**
 * Карточка клиента на узком экране.
 *
 * Выдвигается поверх переписки и закрывается тремя способами: крестиком,
 * нажатием мимо и клавишей Escape. Три, потому что это окно поверх
 * содержимого: человек закрывает его тем движением, которое привык
 * делать, а не тем, которое мы придумали.
 *
 * Обработчик Escape вешается и снимается вместе с самой панелью:
 * висящий всё время слушатель перехватывал бы Escape у остальных окон.
 */
function cardDrawer(on){
  var app = el('app');
  if (!app) return;
  app.classList.toggle('card-open', !!on);
  if (on) document.addEventListener('keydown', cardEsc);
  else document.removeEventListener('keydown', cardEsc);
}

function cardEsc(ev){ if (ev.key === 'Escape') cardDrawer(false) }

function renderHead(){
  var c = currentConv();
  if (!c){ el('thead').innerHTML = L('<div class="dim">Виберіть діалог ліворуч</div>'); return }

  var w = windowState(c);
  var closed = c.status === 'resolved';
  var mine = ME && ME.user && c.assignee_id === ME.user.id;

  el('thead').innerHTML =
    L('<button class="ghost mini back" id="aBack" title="До списку чатів">← Чати</button>') +
    '<div class="who" id="aCard">' +
      '<div class="avwrap">' +
        '<div class="av" data-av="' + c.contact_id + '" style="background-color:' +
          avatarColor(c.display_name || c.id) + '">' + esc(initials(c.display_name)) + '</div>' +
        chBadge(c.channel_type) +
      '</div>' +
      '<div style="min-width:0"><div class="nm">' + esc(c.display_name || L('Без імені')) + '</div>' +
      '<div class="sub">' + esc(CH[c.channel_type] || c.channel_type) +
        (w.open && w.left ? L(' · вікно відповіді ще ') + w.left : (w.open ? '' : L(' · вікно закрито'))) +
        ' · ' + esc(c.assignee_name || L('без відповідального')) +
      '</div></div>' +
    '</div>' +
    '<div class="acts">' +
      (mine ? '' : L('<button class="ghost mini" id="aTake">Взяти собі</button>')) +
      /* Передача конкретному человеку. Списком, а не поиском: операторов
         в смене единицы, и выпадающий список честнее показывает, что
         выбор невелик. «Взяти собі» рядом остаётся: это самое частое
         действие, и прятать его в список из десяти имён — значит делать
         из одного щелчка три. */
      '<select class="asel" id="aWho" title="' + L('Відповідальний') + '">' +
        L('<option value="">Без відповідального</option>') +
        MATES.map(function(u){
          return '<option value="' + u.id + '"' + (c.assignee_id === u.id ? ' selected' : '') +
            '>' + esc(u.name) + '</option>';
        }).join('') +
      '</select>' +
      /* Свой статус. Списком рядом с ответственным, а не в меню: это
         то, что оператор меняет чаще всего остального в шапке, и прятать
         его за вторым щелчком значит, что статусы не будут ставить.
         Когда статусов не завели — списка нет вовсе. */
      (STATUSES.length
        ? '<select class="asel" id="aSt" title="' + L('Статус діалогу') + '">' +
            L('<option value="">Без статусу</option>') +
            STATUSES.map(function(t){
              return '<option value="' + esc(t.id) + '"' +
                (c.status_id === t.id ? ' selected' : '') + '>' + esc(t.name) + '</option>';
            }).join('') +
          '</select>'
        : '') +
      /* Под постом бот молчит всегда: автоответ на глазах у всей ленты —
         не та неожиданность, которую включают переключателем. Кнопки нет
         вовсе: выключатель, который ничего не выключает, хуже её отсутствия. */
      (isComments(c.channel_type)
        ? ''
        : '<button class="ghost mini" id="aBot" title="' + esc(botState(c).why) + L('">Бот: ') +
          esc(botState(c).label) + '</button>') +
      '<button class="' + (closed ? '' : 'ghost ') + 'mini" id="aClose">' +
        (closed ? L('Відкрити заново') : L('Закрити чат')) + '</button>' +
    '</div>';

  if (el('aTake')) el('aTake').onclick = function(){
    if (ME && ME.user) patchConv({ assigneeId: ME.user.id });
  };
  if (el('aWho')) el('aWho').onchange = function(){
    var to = this.value || null;
    patchConv({ assigneeId: to }).then(function(){
      var who = MATES.filter(function(u){ return u.id === to })[0];
      toast(to ? L('Передано: ') + (who ? who.name : '') : L('Знято відповідального'));
    });
  };
  if (el('aSt')) el('aSt').onchange = function(){
    var to = this.value || null;
    var st = to ? statusById(to) : null;
    patchConv({ statusId: to }).then(function(){
      /* Говорим не «статус змінено», а что с диалогом стало: закрытый
         статус уносит его из «Відкритих», и без подсказки это выглядит
         как потеря переписки. */
      toast(!st ? L('Статус знято')
        : st.kind === 'closed' ? L('Статус: ') + st.name + L(' · чат закрито')
        : L('Статус: ') + st.name);
    });
  };
  paintAvatars();
  if (el('aBot')) el('aBot').onclick = function(){ patchConv({ botEnabled: !c.bot_enabled }) };
  el('aClose').onclick = function(){
    var closing = !closed;
    patchConv({ status: closing ? 'resolved' : 'open' }).then(function(){
      // Закрытый чат исчезает из «Открытых» — это правильно, но без
      // подсказки выглядит как потеря переписки. Говорим, где он теперь.
      if (closing) toast(L('Чат закрито. Він у вкладці «Закриті» і повернеться у «Відкриті», як тільки клієнт напише.'));
    });
  };
  el('aBack').onclick = backToList;
  if (el('aCard')) el('aCard').onclick = function(){ cardDrawer(true) };
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
  // Ушли из переписки — панель клиента закрывается вместе с ней:
  // висеть поверх списка чатов ей незачем.
  cardDrawer(false);
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

      // Пометка комментария. Оператор обязан видеть, что отвечает
      // публично, ещё до того, как начнёт печатать.
      // Тема письма. Показывается у каждого письма, а не один раз
      // сверху: в одной переписке тема меняется, и по ней человек
      // понимает, о чём именно это письмо.
      var subj = c.email && c.email.subject
        ? '<div class="cmt">' + esc(c.email.subject) + '</div>'
        : '';

      // История и рилс. Пометка стоит над текстом: на что отвечает
      // человек, важнее того, что именно он написал.
      var IGK = {
        story_reply: L('відповідь на вашу історію'),
        story_mention: L('згадав вас в історії'),
        reel: L('надіслав рілс'),
        share: L('поділився публікацією')
      };
      var ig = c.ig && IGK[c.ig.kind]
        ? '<div class="cmt">' +
            (c.ig.url
              ? '<a href="' + esc(c.ig.url) + '" target="_blank" rel="noopener">' + IGK[c.ig.kind] + '</a>'
              : IGK[c.ig.kind]) +
          '</div>'
        : '';

      var cm = c.comment
        ? '<div class="cmt">' +
            (c.comment.private
              ? L('в особисті')
              : (c.comment.url
                  ? '<a href="' + esc(c.comment.url) + L('" target="_blank" rel="noopener">під постом</a>')
                  : L('під постом'))) +
          '</div>'
        : '';

      var body = subj + ig + cm + quote + renderAttachments(m.id, c.attachments) + (c.text ? esc(c.text) : '');

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

    // Первая отрисовка диалога — это смена разговора, а не сорок новых
    // сообщений: движется лента целиком. Дальше движется только то,
    // что действительно пришло.
    var first = threadFirst;
    threadFirst = false;
    Array.prototype.forEach.call(el('msgs').querySelectorAll('[data-mid]'), function(n){
      var mid = n.dataset.mid;
      if (!first && !msgSeen[mid]) n.classList.add('fresh');
      msgSeen[mid] = 1;
    });
    if (first){
      var box = el('msgs');
      box.classList.remove('swap');
      // Чтение размера заставляет браузер применить снятый класс до
      // того, как мы вернём его обратно. Иначе анимация не начнётся
      // заново — для браузера ничего не менялось.
      void box.offsetWidth;
      box.classList.add('swap');
    }

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
  var cmt = isComments(c && c.channel_type);
  var mode = (w.open ? 'open' : 'blocked') + ':' + current + ':' + QR.length +
    ':' + (replyTo ? replyTo.id : '') + ':' + (pendingFile ? (pendingFile.name || '') : '') +
    ':' + (cmt ? 'c' : '');
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
    /* Куда уйдёт ответ. Выбор стоит над полем, а не под кнопкой:
       решение принимается до того, как текст набран. */
    (cmt
      ? '<div class="fopt" style="padding:0 2px 6px">' +
        L('<label><input type="checkbox" id="priv"> Відповісти в особисті</label>') +
        L('<span class="dim" style="margin-left:8px;font-size:11.5px">одне повідомлення, ') +
        L('сім днів від коментаря</span></div>')
      : '') +
    '<div class="row">' +
    '<input type="file" id="file" style="display:none">' +
    (cmt ? '' : L('<button class="icob" id="clip" title="Прикріпити файл">') + icon('clip') + '</button>') +
    L('<button class="icob" id="emo" title="Смайли">') + icon('smile') + '</button>' +
    L('<button class="icob" id="tpl" title="Шаблони відповідей">') + icon('bolt') + '</button>' +
    // Кнопка черновика появляется, только когда ИИ подключён: пустая
    // кнопка, которая на нажатие отвечает «не настроено», — это
    // обещание, которого интерфейс не держит.
    (AI.ready ? L('<button class="icob" id="ai" title="Чернетка відповіді від ШІ">✨</button>') : '') +
    (cmt
      ? L('<textarea id="txt" rows="1" placeholder="Відповідь під постом — її побачать усі"></textarea>')
      : narrow()
      ? L('<textarea id="txt" rows="1" placeholder="Відповідь клієнту"></textarea>')
      : L('<textarea id="txt" rows="1" placeholder="Відповідь клієнту. Enter — надіслати, Shift+Enter — перенос"></textarea>')) +
    L('<button id="send">Надіслати</button></div><div class="err" id="sendErr"></div>');

  var ta = el('txt');
  if (keep) ta.value = keep;

  if (el('rCancel')) el('rCancel').onclick = function(){ replyTo = null; renderComposer(true) };
  if (el('fCancel')) el('fCancel').onclick = function(){ pendingFile = null; renderComposer(true) };

  if (el('clip')) el('clip').onclick = function(){ el('file').click() };
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
        : p.detail ? p.detail
        /* Отказ без причины бывает один: до нашей ручки запрос не
           дошёл. Тогда полезен хотя бы код — по нему видно, это
           устаревшая страница (404) или упавший сервер. */
        : e.status ? L('ШІ не відповів (') + e.status + ')'
        : L('Не вдалося звернутися до сервера'));
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
  /* Папки и здесь: список в поле ответа — тот же список, что в
     настройках, и порядок в них обязан совпадать. Заголовок папки
     показывается только тогда, когда папка есть: в плоском списке
     лишняя строка сверху была бы просто шумом. */
  b.innerHTML = qrGroups().map(function(g){
    return (g.folder ? '<div class="qfdl">' + esc(g.folder) + '</div>' : '') +
      g.items.map(function(q){
        var n = (q.attachments || []).length;
        return '<div class="qr" data-i="' + QR.indexOf(q) + '"><b>/' + esc(q.shortcut) + '</b>' +
          (n ? '<span class="chip">📎 ' + n + '</span> ' : '') +
          '<span class="x">' + esc(q.body) + '</span></div>';
      }).join('');
  }).join('');
  b.style.display = 'block';
  Array.prototype.forEach.call(b.querySelectorAll('[data-i]'), function(node){
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

/**
 * Всплывающее окошко у элемента.
 *
 * Одно на страницу: второе открытое окошко — это всегда вопрос «какое
 * из них слушает мои щелчки». Закрывается щелчком мимо, но не внутри:
 * в списке с галочками внутрь щёлкают много раз подряд.
 */
function popBox(anchor, cls){
  var old = document.querySelector('.picker');
  if (old) old.remove();

  var box = document.createElement('div');
  box.className = 'picker' + (cls ? ' ' + cls : '');
  document.body.appendChild(box);
  box.onclick = function(ev){ ev.stopPropagation() };

  setTimeout(function(){
    document.addEventListener('click', function once(){
      box.remove();
      document.removeEventListener('click', once);
    });
  }, 0);
  return box;
}

/** Поставить окошко под элементом, а если внизу не помещается — над. */
function popAt(box, anchor){
  var r = anchor.getBoundingClientRect();
  box.style.left = Math.max(8, Math.min(r.left, window.innerWidth - box.offsetWidth - 8)) + 'px';
  var below = r.bottom + 6;
  box.style.top = (below + box.offsetHeight < window.innerHeight - 8
    ? below : Math.max(8, r.top - box.offsetHeight - 6)) + 'px';
}

/**
 * Выбор цвета.
 *
 * Квадратами, а не списком: в выпадающем списке браузер рисует строки
 * своим цветом, и выбор превращался в «Колір 7» — число, которое не
 * значит ничего, пока не выберешь и не посмотришь.
 */
function openPalette(anchor, current, onPick){
  var box = popBox(anchor, 'pal');
  box.innerHTML = SCOLORS.map(function(c){
    return '<button data-c="' + c + '"' + (c === current ? ' class="on"' : '') +
      ' style="background-color:' + c + '"></button>';
  }).join('');
  popAt(box, anchor);

  Array.prototype.forEach.call(box.children, function(btn){
    btn.onclick = function(){
      box.remove();
      onPick(btn.dataset.c);
    };
  });
}

/** Квадрат текущего цвета: он же кнопка выбора. */
function swatch(id, color){
  return '<button class="swatch" id="' + id + '" data-c="' + esc(color) + '" title="' +
    L('Колір') + '" style="background-color:' + esc(color) + '"></button>';
}

function wireSwatch(id, onPick){
  var b = el(id);
  if (!b) return;
  b.onclick = function(ev){
    ev.stopPropagation();
    openPalette(b, b.dataset.c, function(c){
      b.dataset.c = c;
      b.style.backgroundColor = c;
      if (onPick) onPick(c);
    });
  };
}

function showPicker(anchor, messageId){
  var box = popBox(anchor, 'emo');
  box.innerHTML = EMOJI.map(function(x){
    return '<button data-e="' + x + '">' + x + '</button>';
  }).join('') + '<button data-e="">✖</button>';
  popAt(box, anchor);

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
  if (el('priv') && el('priv').checked) payload.privateReply = true;

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
        : p.error === 'comment_text_only' ? L('У коментарі йде тільки текст')
        : p.error === 'not_a_comment' ? L('В особисті відповідають лише на коментар')
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
        '<div><a href="' + esc(d.crmUrl) + L('" target="_blank" rel="noopener">відкрити в Zoho</a></div></div>') +
        /* Компания. Стоит здесь, а не в «Контакті»: это поле не наше,
           оно живёт в CRM, и меняется там же. Показываем последнее, что
           отправляли, — переименование в CRM сюда не приедет. */
        L('<div class="fld" style="margin-top:8px"><label>Компанія</label>') +
        '<input id="cCo" value="' + esc((ct.attributes && ct.attributes.company) || '') + '"' +
        L(' placeholder="назва компанії"></div>') +
        L('<button class="ghost mini" id="cCoSave">Привʼязати компанію</button>') +
        '<span class="ok" id="cCoOk" style="margin-left:8px"></span>' +
        '<div class="err" id="cCoErr"></div>' +

        /* Заказ. Стоит под CRM, а не отдельной страницей: заказ
           собирается в разговоре, глядя на то, что человек пишет. */
        L('<h4>Замовлення</h4>') +
        (ct.crm_module === 'Contacts'
          ? L('<button class="ghost mini" id="oOpen">Зібрати замовлення</button>') +
            '<span class="dim" id="oCnt" style="margin-left:8px;font-size:12.5px"></span>' +
            '<span class="ok" id="oDone"></span>' +
            '<div class="err" id="oErr"></div>'
          : L('<div class="hint">Клієнт у Zoho — лід, а замовлення робиться на контакт.</div>') +
            '<div class="row2" style="margin-top:7px">' +
            L('<button class="ghost mini" id="cConv">Зробити контактом</button>') +
            L('<button class="ghost mini" id="cReSync">Оновити звʼязок</button>') +
            '</div>' +
            L('<div class="hint" style="margin-top:6px">Перша кнопка конвертує ліда в Zoho ') +
            L('звідси. Друга — якщо його вже сконвертували там.</div>') +
            '<div class="err" id="oErr"></div>')
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
  wireOrder();

  if (el('cReSync')) el('cReSync').onclick = function(){
    var b = el('cReSync');
    busy(b, true);
    el('oErr').textContent = '';
    api('/contacts/' + ct.id + '/crm/refresh', { method:'POST' })
      .then(function(){ toast(L('Звʼязок оновлено')); loadCard() })
      .catch(function(e){
        var p = (e && e.payload) || {};
        el('oErr').textContent = p.error === 'still_lead'
          ? L('У Zoho це досі лід — сконвертуйте його там')
          : ordWhy(e);
        busy(b, false);
      });
  };

  /*
   * Конвертация лида. Одна кнопка вместо похода в Zoho: найти
   * карточку, нажать Convert, вернуться и обновить связь — пять
   * действий в разгар разговора с клиентом.
   */
  if (el('cConv')) el('cConv').onclick = function(){
    var b = el('cConv');
    busy(b, true);
    el('oErr').textContent = '';
    api('/contacts/' + ct.id + '/crm/convert', { method:'POST' })
      .then(function(r){
        toast(r && r.already ? L('Уже сконвертований — звʼязок оновлено') : L('Тепер це контакт'));
        loadCard();
      })
      .catch(function(e){
        el('oErr').textContent = ordWhy(e);
        busy(b, false);
      });
  };

  if (el('cCoSave')) el('cCoSave').onclick = function(){
    var name = el('cCo').value.trim();
    el('cCoErr').textContent = '';
    el('cCoOk').textContent = '';
    if (!name){ el('cCoErr').textContent = L('Впишіть назву компанії'); return }
    busy(el('cCoSave'), true);
    api('/contacts/' + ct.id + '/company', { method:'POST', body:{ name: name } })
      .then(function(){
        el('cCoOk').textContent = L('готово');
        busy(el('cCoSave'), false);
        loadCard();
      })
      .catch(function(e){
        var p = e.payload || {};
        el('cCoErr').textContent =
          p.error === 'not_linked' ? L('Спершу надішліть клієнта в Zoho')
          : p.error === 'zoho_not_connected' ? L('Zoho не підключена')
          : p.error === 'token_rejected' ? L('Zoho відкликала доступ — перепідключіть на сторінці інтеграцій')
          : L('Zoho не прийняла компанію');
        busy(el('cCoSave'), false);
      });
  };

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

/* ══════════════ Заказ из разговора ══════════════ */

/**
 * Окно заказа: слева каталог, справа собранный заказ.
 *
 * Раньше в карточке была строка поиска: впиши две буквы — спросим у
 * Zoho, что на них начинается. Это работает, только если человек
 * помнит, как товар записан в CRM. В разговоре он помнит «та сама
 * сироватка», а в прайсе это HYDRAFUSION-50, и поиск по началу
 * названия не находит ничего.
 *
 * Поэтому каталог тянется целиком и лежит в окне: искать можно по
 * любому куску строки, а можно просто листать глазами. Узкая колонка
 * карточки для этого мала — отсюда окно во весь экран.
 *
 * Поля заказа спрашиваются у самой Zoho: в каждой организации разметка
 * своя, и обязательное «Кому доставити» мы бы не угадали. Свой список
 * обязательных полей устарел бы в день, когда клиент добавил своё.
 *
 * Корзина живёт в браузере, пока оператор её собирает, и привязана к
 * разговору: переключился на другого клиента — начинаем заново. Иначе
 * товары из чужого разговора уедут не тому человеку. Нигде не
 * сохраняется намеренно: недособранный заказ не нужен ни отчётам, ни
 * второму оператору.
 */
var ORD = { conv:null, lines:[], subject:'', vals:{}, off:'',
  cat:[], truncated:false, form:null, pipe:'', ready:false, q:'', all:false, err:'' };

function ordFresh(){
  ORD = { conv:current, lines:[], subject:'', vals:{}, off:'',
    cat:[], truncated:false, form:null, pipe:'', ready:false, q:'', all:false, err:'' };
}

/**
 * Поля выбранной воронки.
 *
 * Одно место на весь код окна: заголовок, форма и отправка обязаны
 * понимать «какие сейчас поля» одинаково.
 */
function ordFields(){
  var f = ORD.form;
  if (!f) return [];
  if (f.module !== 'Deals') return f.fields || [];
  var p = (f.pipelines || []).filter(function(x){ return x.id === ORD.pipe })[0];
  return p ? p.fields : (f.fields || []);
}

/**
 * Скидка: деньгами или процентом.
 *
 * «Минус двести» и «минус десять процентов» — одна и та же фраза в
 * разговоре, и переводить проценты в уме оператор не должен. Больше
 * суммы скидка не бывает: отрицательная строка — это возврат, а не
 * скидка.
 */
function ordOff(raw, base){
  var v = String(raw == null ? '' : raw).trim();
  if (!v) return 0;
  var pc = v.charAt(v.length - 1) === '%';
  var n = Number((pc ? v.slice(0, -1) : v).split(',').join('.'));
  if (!isFinite(n) || n <= 0) return 0;
  var off = pc ? base * n / 100 : n;
  return Math.min(Math.round(off * 100) / 100, Math.round(base * 100) / 100);
}

/** Сумма строк до скидок. */
function ordSum(){
  return ORD.lines.reduce(function(s, l){ return s + l.qty * l.price }, 0);
}

/** Скидки строк вместе. */
function ordOffLines(){
  return ORD.lines.reduce(function(s, l){ return s + ordOff(l.off, l.qty * l.price) }, 0);
}

/** Сумма — только для глаз оператора. Настоящую считает Zoho. */
function ordTotal(){
  var afterLines = ordSum() - ordOffLines();
  return afterLines - ordOff(ORD.off, afterLines);
}

function ordMoney(n){
  return (Math.round(n * 100) / 100).toFixed(2);
}

function ordEsc(ev){ if (ev.key === 'Escape') ordClose() }

function ordOpen(){
  if (ORD.conv !== current) ordFresh();
  if (el('oVeil')) return;
  var v = document.createElement('div');
  v.className = 'veil';
  v.id = 'oVeil';
  v.innerHTML = '<div class="sheet wide" id="oSheet"></div>';
  document.body.appendChild(v);
  // Нажатие мимо окна закрывает его, нажатие внутри — нет.
  v.onclick = function(ev){ if (ev.target === v) ordClose() };
  document.addEventListener('keydown', ordEsc);
  ordPaint();
  if (!ORD.ready) ordLoad();
}

function ordClose(){
  var v = el('oVeil');
  if (v) v.parentNode.removeChild(v);
  document.removeEventListener('keydown', ordEsc);
  ordCount();
}

/** Сколько собрано — видно и после закрытия окна. */
function ordCount(){
  var s = el('oCnt');
  if (s) s.textContent = ORD.lines.length ? L('у замовленні: ') + ORD.lines.length : '';
}

/**
 * Каталог и поля тянутся один раз на разговор.
 *
 * Поля — необязательная часть: если Zoho не дала их описание, заказ
 * всё равно собирается, просто без своих полей. Каталог — обязательная:
 * без него собирать нечего, и отказ показывается прямо в окне.
 */
function ordLoad(){
  api('/crm/products').then(function(r){
    ORD.cat = r.products || [];
    ORD.truncated = !!r.truncated;
    for (var i = 0; i < ORD.cat.length; i++) ORD.cat[i].i = i;
    return api('/crm/order-form')
      .then(function(f){
        ORD.form = f;
        var ps = f.pipelines || [];
        ORD.pipe = ps.length ? ps[0].id : '';
      })
      .catch(function(){ ORD.form = null });
  }).then(function(){
    ORD.ready = true;
    ordPaint();
  }).catch(function(e){
    ORD.ready = true;
    ORD.err = ordWhy(e);
    ordPaint();
  });
}

function ordPaint(){
  var sh = el('oSheet');
  if (!sh) return;

  sh.innerHTML =
    '<div class="orow">' +
      L('<b>Замовлення</b>') +
      '<span class="x" id="oX" style="cursor:pointer;font-size:18px">×</span>' +
    '</div>' +
    (ORD.err
      ? '<div class="err" style="margin-top:10px">' + esc(ORD.err) + '</div>'
      : !ORD.ready
        ? L('<div class="empty">Тягнемо каталог із Zoho...</div>')
        : '<div class="ocols">' +
            '<div class="ocol">' +
              L('<input id="oQ" placeholder="пошук: назва або артикул">') +
              '<div class="hint" id="oNum" style="margin-top:6px"></div>' +
              '<div id="oList" class="olist"></div>' +
            '</div>' +
            '<div class="ocol">' +
              '<div id="oCart"></div>' +
              '<div id="oFlds"></div>' +
              '<span class="ok" id="oDone2"></span>' +
              '<div class="err" id="oErr2"></div>' +
            '</div>' +
          '</div>');

  el('oX').onclick = ordClose;
  if (ORD.err || !ORD.ready) return;

  el('oQ').value = ORD.q;
  el('oQ').oninput = function(){ ORD.q = el('oQ').value; ordList() };
  ordList();
  ordCart();
  ordFlds();
  el('oQ').focus();
}

/** Сколько строк каталога показываем разом. */
var ORD_SHOW = 200;

function ordList(){
  var box = el('oList');
  if (!box) return;

  var q = ORD.q.trim().toLowerCase();
  var hit = ORD.cat.filter(function(p){
    if (!q) return true;
    return (p.name + ' ' + p.code).toLowerCase().indexOf(q) >= 0;
  });
  var shown = hit.slice(0, ORD_SHOW);

  // Сколько всего товаров — ответ на немой вопрос «а всё ли подтянулось».
  el('oNum').textContent = ORD.cat.length
    ? (q ? hit.length + L(' з ') + ORD.cat.length : L('товарів у каталозі: ') + ORD.cat.length)
    : '';

  box.innerHTML = (!ORD.cat.length
    ? L('<div class="empty">У Zoho немає жодного товару.</div>')
    : !hit.length
      ? L('<div class="empty">Нічого не знайшли.</div>')
      : shown.map(function(p){
          return '<div class="oitem" data-oadd="' + p.i + '">' +
            '<span class="on">' + esc(p.name || p.code) +
              (p.name && p.code ? ' <span class="dim">' + esc(p.code) + '</span>' : '') +
              (p.active ? '' : L(' <span class="dim">· неактивний</span>')) +
            '</span>' +
            '<span class="dim">' + esc(ordMoney(p.price)) + '</span>' +
          '</div>';
        }).join('') +
        (hit.length > shown.length
          ? L('<div class="hint" style="padding:8px 10px">Показані перші 200 — уточніть пошук.</div>')
          : '') +
        (ORD.truncated
          ? L('<div class="hint" style="padding:8px 10px">Каталог великий: взяли перші 2000 товарів.</div>')
          : ''));

  Array.prototype.forEach.call(box.querySelectorAll('[data-oadd]'), function(x){
    x.onclick = function(){ ordAdd(ORD.cat[Number(x.dataset.oadd)]) };
  });
}

/**
 * Один товар — одна строка. Повтор увеличивает количество, а не
 * заводит вторую строку того же товара: вторая строка в заказе
 * означает другую цену, а не нажатие дважды.
 */
function ordAdd(p){
  if (!p) return;
  var same = ORD.lines.filter(function(l){ return l.id === p.id })[0];
  if (same) same.qty += 1;
  else ORD.lines.push({ id:p.id, name:p.name || p.code, qty:1, price:p.price || 0, off:'' });
  ordCart();
}

function ordCart(){
  var cart = el('oCart');
  if (!cart) return;

  cart.innerHTML = (!ORD.lines.length
    ? L('<div class="hint">Натисніть товар зліва — він стане рядком замовлення.</div>')
    : ORD.lines.map(function(l, i){
        return '<div class="oline">' +
          '<span class="on">' + esc(l.name) + '</span>' +
          '<input data-oqty="' + i + '" value="' + esc(String(l.qty)) + '" ' +
            'style="width:44px;text-align:center">' +
          '<input data-oprc="' + i + '" value="' + esc(ordMoney(l.price)) + '" ' +
            'style="width:70px;text-align:right">' +
          (ORD.form && ORD.form.lineOff
            ? '<input data-ooff="' + i + '" value="' + esc(l.off || '') + '"' +
              L(' placeholder="знижка" style="width:66px;text-align:right">')
            : '') +
          '<span class="x" data-odel="' + i + '" style="cursor:pointer">×</span>' +
        '</div>';
      }).join('') +
      L('<div class="kv2" style="margin-top:9px"><div class="k">Сума</div><div>') +
        esc(ordMoney(ordSum())) + '</div>' +
      (ordOffLines() > 0
        ? L('<div class="k">Знижки рядків</div><div>−') + esc(ordMoney(ordOffLines())) + '</div>'
        : '') +
      '</div>' +
      (ORD.form && ORD.form.wholeOff
        ? L('<div class="oline" style="margin-top:7px"><span class="on">Знижка на замовлення</span>') +
        '<input id="oOff" value="' + esc(ORD.off || '') + '"' +
        L(' placeholder="грн або %" style="width:96px;text-align:right"></div>')
        : '') +
      L('<div class="kv2" style="margin-top:7px"><div class="k"><b>Разом</b></div><div><b>') +
        esc(ordMoney(ordTotal())) + '</b></div></div>') +
    L('<div class="fld" style="margin-top:9px"><label>Назва замовлення</label>') +
      '<input id="oSub" value="' + esc(ORD.subject || '') + '"' +
      L(' placeholder="залишіть пустим — назвемо самі"></div>');

  Array.prototype.forEach.call(cart.querySelectorAll('[data-oqty]'), function(x){
    x.onchange = function(){
      var n = Math.round(Number(x.value) || 0);
      ORD.lines[x.dataset.oqty].qty = n > 0 ? n : 1;
      ordCart();
    };
  });
  Array.prototype.forEach.call(cart.querySelectorAll('[data-oprc]'), function(x){
    x.onchange = function(){
      var n = Number(String(x.value).split(',').join('.'));
      ORD.lines[x.dataset.oprc].price = n > 0 ? n : 0;
      ordCart();
    };
  });
  Array.prototype.forEach.call(cart.querySelectorAll('[data-ooff]'), function(x){
    x.onchange = function(){ ORD.lines[x.dataset.ooff].off = x.value; ordCart() };
  });
  Array.prototype.forEach.call(cart.querySelectorAll('[data-odel]'), function(x){
    x.onclick = function(){ ORD.lines.splice(Number(x.dataset.odel), 1); ordCart() };
  });
  if (el('oOff')) el('oOff').onchange = function(){ ORD.off = el('oOff').value; ordCart() };
  el('oSub').oninput = function(){ ORD.subject = el('oSub').value };

  /*
   * Сумма сделки. У заказа её считает Zoho по строкам товаров, а у
   * сделки такого правила нет: поле Amount обычное, и сделка без него
   * не попадает ни в воронку по деньгам, ни в отчёт. Подставляем итог
   * корзины, пока человек не вписал своё — после этого не трогаем.
   */
  var amount = ordFields().filter(function(f){ return f.api === 'Amount' })[0];
  if (amount && ORD.autoAmount !== false){
    var was = ORD.vals.Amount;
    ORD.vals.Amount = ordMoney(ordTotal());
    if (was !== ORD.vals.Amount) ordFlds();
  }
}

/**
 * Поля заказа и воронка.
 *
 * Какие поля показывать, решено в настройках: там отмечены нужные под
 * каждую воронку. Обязательные Zoho добавляются к ним сама — их не
 * отметить забыли бы ровно один раз, и заказ перестал бы создаваться.
 *
 * Воронка спрашивается, только если их открыто больше одной: выбор из
 * одного варианта — не выбор, а лишнее поле на экране.
 */
function ordFlds(){
  var box = el('oFlds');
  if (!box) return;

  var f = ORD.form;
  var flds = ordFields();
  var ps = (f && f.pipelines) || [];

  box.innerHTML =
    (f && !f.ready
      ? L('<div class="hint">Замовлення ще не налаштоване: у «Інтеграціях» вкажіть, ') +
        L('куди його створювати.</div>')
      : '') +
    (ps.length > 1
      ? L('<div class="fld"><label>Воронка</label><select id="oPipe">') +
        ps.map(function(p){
          return '<option value="' + esc(p.id) + '"' + (p.id === ORD.pipe ? ' selected' : '') +
            '>' + esc(p.name) + '</option>';
        }).join('') + '</select></div>'
      : '') +
    flds.map(ordFld).join('') +
    L('<div style="margin-top:10px"><button class="primary" id="oMake">Створити замовлення</button></div>');

  if (el('oPipe')) el('oPipe').onchange = function(){
    ORD.pipe = el('oPipe').value;
    ordFlds();
  };

  Array.prototype.forEach.call(box.querySelectorAll('[data-off]'), function(x){
    x.onchange = function(){
      ORD.vals[x.dataset.off] = x.value;
      if (x.dataset.off === 'Amount') ORD.autoAmount = false;
    };
  });
  Array.prototype.forEach.call(box.querySelectorAll('[data-ofb]'), function(x){
    x.onchange = function(){ ORD.vals[x.dataset.ofb] = x.checked };
  });
  Array.prototype.forEach.call(box.querySelectorAll('[data-ofm]'), function(x){
    x.onchange = function(){
      ORD.vals[x.dataset.ofm] = Array.prototype.filter
        .call(x.options, function(o){ return o.selected })
        .map(function(o){ return o.value });
    };
  });
  el('oMake').onclick = ordCreate;
}

function ordFld(f){
  var v = ORD.vals[f.api];
  var lab = esc(f.label) + (f.required ? ' <span class="req">*</span>' : '');

  if (f.kind === 'bool')
    return '<label class="ochk"><input type="checkbox" data-ofb="' + esc(f.api) + '"' +
      (v === true ? ' checked' : '') + '> ' + lab + '</label>';

  var body =
    f.kind === 'pick'
      ? '<select data-off="' + esc(f.api) + '"><option value=""></option>' +
        f.options.map(function(o){
          return '<option value="' + esc(o) + '"' + (v === o ? ' selected' : '') + '>' +
            esc(o) + '</option>';
        }).join('') + '</select>'
      : f.kind === 'multi'
        ? '<select multiple size="3" data-ofm="' + esc(f.api) + '">' +
          f.options.map(function(o){
            var on = Array.isArray(v) && v.indexOf(o) >= 0;
            return '<option value="' + esc(o) + '"' + (on ? ' selected' : '') + '>' +
              esc(o) + '</option>';
          }).join('') + '</select>'
        : f.kind === 'long'
          ? '<textarea rows="2" data-off="' + esc(f.api) + '">' +
            esc(v == null ? '' : String(v)) + '</textarea>'
          : '<input data-off="' + esc(f.api) + '"' +
            (f.kind === 'date' ? ' type="date"' : '') +
            (f.kind === 'num' ? ' inputmode="decimal"' : '') +
            ' value="' + esc(v == null ? '' : String(v)) + '">';

  return '<div class="fld"><label>' + lab + '</label>' + body + '</div>';
}

/**
 * Отказы разбираются по одному.
 *
 * «Не получилось» отправляет оператора спрашивать, а каждая из этих
 * причин лечится по-разному, и лечит её сам оператор.
 */
function ordWhy(e){
  var p = (e && e.payload) || {};
  return p.error === 'not_linked' ? L('Спершу надішліть клієнта в Zoho')
    : p.error === 'lead_not_converted' ? L('У Zoho це лід — сконвертуйте його в контакт')
    : p.error === 'lead_has_no_company' ? L('У ліда немає компанії — сконвертуйте його в контакт')
    : p.error === 'no_company' ? L('У картці клієнта в Zoho не вказана компанія')
    : p.error === 'zoho_not_connected' ? L('Zoho не підключена')
    : p.error === 'zoho_not_configured' ? L('Zoho не налаштована')
    : p.error === 'zoho_scope' ? L('Zoho видала менше прав, ніж потрібно для товарів і замовлень — перепідключіть Zoho на сторінці інтеграцій')
    : p.error === 'zoho_no_permission' ? L('У вашого користувача Zoho немає доступу до товарів або замовлень — увімкніть модуль у правах профілю Zoho')
    : p.error === 'fields_required' ? L('Заповніть обовʼязкові поля: ') + (p.detail || '')
    : p.error === 'order_not_set_up' ? L('Замовлення не налаштоване: у «Інтеграціях» вкажіть модуль, воронку і таблицю товарів')
    : p.error === 'pipeline_not_allowed' ? L('Ця воронка закрита для замовлень')
    : p.error === 'product_unknown' ? L('Не вдалося дізнатися назву товару в Zoho')
    : p.error === 'token_rejected' ? L('Zoho відкликала доступ — перепідключіть на сторінці інтеграцій')
    : p.detail ? L('Zoho відмовила: ') + p.detail
    : L('Zoho не прийняла запит');
}

function ordCreate(){
  if (!ORD.lines.length){ el('oErr2').textContent = L('Замовлення порожнє'); return }
  el('oErr2').textContent = '';
  el('oDone2').textContent = '';
  busy(el('oMake'), true);

  api('/conversations/' + current + '/order', { method:'POST', body:{
    subject: ORD.subject || '',
    pipeline: ORD.pipe || '',
    fields: ORD.vals,
    discount: ORD.off || '',
    items: ORD.lines.map(function(l){
      return { productId: l.id, quantity: l.qty, price: l.price, discount: l.off || '' };
    })
  }}).then(function(r){
    // Каталог и поля оставляем: следующий заказ тому же клиенту
    // собирается сразу, без похода в Zoho.
    ORD.lines = [];
    ORD.subject = '';
    ORD.vals = {};
    ORD.off = '';
    ORD.q = '';
    ORD.autoAmount = true;
    ordClose();
    if (el('oDone')) el('oDone').innerHTML = r.url
      ? '<a href="' + esc(r.url) + L('" target="_blank" rel="noopener">замовлення створено</a>')
      : L('замовлення створено');
  }).catch(function(e){
    if (el('oErr2')) el('oErr2').textContent = ordWhy(e);
  }).then(function(){ if (el('oMake')) busy(el('oMake'), false) });
}

function wireOrder(){
  if (!el('oOpen')) return;
  if (ORD.conv !== current) ordFresh();
  el('oOpen').onclick = ordOpen;
  ordCount();
}

/* ══════════════ Настройка заказа ══════════════ */

/**
 * Куда уезжает заказ.
 *
 * Эта страница описывает чужую разметку, а не нашу: модуль, воронки,
 * поля и таблицу товаров придумали в CRM клиента. Поэтому всё, что
 * здесь выбирается, приходит из самой Zoho — списки, а не поля ввода.
 * Вписанное руками имя поля ошибается молча и обнаруживается на
 * первом заказе.
 */
var OS = { set:null, meta:null, metaFor:'', busy:false, err:'', open:'' };

function osLoad(){
  return api('/settings/orders').then(function(r){
    OS.set = r.settings;
    return osMeta(OS.set.module);
  });
}

function osMeta(module){
  OS.meta = null;
  OS.metaFor = module;
  OS.err = '';
  osPaint();
  return api('/crm/order-meta?module=' + encodeURIComponent(module))
    .then(function(m){ OS.meta = m })
    .catch(function(e){ OS.err = ordWhy(e) })
    .then(osPaint);
}

/** Колонки выбранной таблицы товаров. */
function osSub(){
  var m = OS.meta, s = OS.set;
  if (!m || !s) return null;
  return (m.subforms || []).filter(function(x){ return x.api === s.subform.api })[0] || null;
}

function osPaint(){
  var box = el('osBox');
  if (!box || !OS.set) return;
  var s = OS.set, m = OS.meta;

  box.innerHTML =
    L('<div class="fld"><label>Куди створювати замовлення</label><select id="osMod">') +
    '<option value="Sales_Orders"' + (s.module === 'Sales_Orders' ? ' selected' : '') + '>' +
      L('Замовлення (Sales Orders)') + '</option>' +
    '<option value="Deals"' + (s.module === 'Deals' ? ' selected' : '') + '>' +
      L('Угоди (Deals)') + '</option></select></div>' +

    (OS.err
      ? '<div class="err">' + esc(OS.err) + '</div>'
      : !m
        ? L('<div class="hint">Питаємо Zoho, як влаштований цей модуль...</div>')
        : osFieldsBox(s, m) + (s.module === 'Deals' ? osPipes(s, m) : '') + osSubBox(s, m)) +

    L('<div class="acts"><button id="osSave">Зберегти</button></div>') +
    '<span class="ok" id="osOk"></span><div class="err" id="osErr"></div>';

  el('osMod').onchange = function(){
    s.module = el('osMod').value;
    // Воронки и поля принадлежат модулю: переносить отмеченное в
    // сделках на заказы значит сохранить имена полей, которых там нет.
    s.pipelines = [];
    s.fields = [];
    s.discountField = '';
    // Таблицу товаров и её колонки выбирают заново: имена принадлежат
    // модулю, и перенос их в другой — это имена полей, которых там нет.
    s.subform = { api:'', product:'', quantity:'', price:'', discount:'' };
    osMeta(s.module);
  };

  Array.prototype.forEach.call(box.querySelectorAll('[data-ospipe]'), function(x){
    x.onchange = function(){
      var id = x.dataset.ospipe;
      var live = (m.pipelines || []).filter(function(p){ return p.id === id })[0];
      if (x.checked && live)
        s.pipelines.push({ id:id, name:live.name, layout:live.layout,
          stage:live.stages[0].value, fields:[] });
      else s.pipelines = s.pipelines.filter(function(p){ return p.id !== id });
      osPaint();
    };
  });
  Array.prototype.forEach.call(box.querySelectorAll('[data-osstage]'), function(x){
    x.onchange = function(){
      var p = s.pipelines.filter(function(o){ return o.id === x.dataset.osstage })[0];
      if (p) p.stage = x.value;
    };
  });
  Array.prototype.forEach.call(box.querySelectorAll('[data-osfld]'), function(x){
    x.onchange = function(){
      var api = x.dataset.osfld, into = x.dataset.osfor;
      var list = into ? (s.pipelines.filter(function(p){ return p.id === into })[0] || {}).fields : s.fields;
      if (!list) return;
      var at = list.indexOf(api);
      if (x.checked && at < 0) list.push(api);
      if (!x.checked && at >= 0) list.splice(at, 1);
    };
  });
  if (el('osSame')) el('osSame').onchange = function(){
    s.sameFields = el('osSame').checked;
    osPaint();
  };
  if (el('osTab')) el('osTab').onchange = function(){
    s.subform.api = el('osTab').value;
    var sub = osSub();
    // Догадку Zoho подставляем сразу: три пустых списка там, где два
    // очевидны, — это работа, которую человек делает за нас.
    s.subform.product = sub ? sub.guess.product : '';
    s.subform.quantity = sub ? sub.guess.quantity : '';
    s.subform.price = sub ? sub.guess.price : '';
    s.subform.discount = sub ? sub.guess.discount : '';
    osPaint();
  };
  Array.prototype.forEach.call(box.querySelectorAll('[data-oscol]'), function(x){
    x.onchange = function(){ s.subform[x.dataset.oscol] = x.value };
  });
  if (el('osWhole')) el('osWhole').onchange = function(){ s.discountField = el('osWhole').value };

  el('osSave').onclick = function(){
    el('osErr').textContent = '';
    busy(el('osSave'), true);
    api('/settings/orders', { method:'PATCH', body:s })
      .then(function(r){
        // Берём то, что вернул сервер: он мог поправить настройку, и
        // показывать человеку своё значение вместо сохранённого —
        // значит врать ему о том, что записано.
        OS.set = r.settings || s;
        toast(L('Збережено'));
        if (OS.metaFor !== OS.set.module) osMeta(OS.set.module); else osPaint();
      })
      .catch(function(e){ el('osErr').textContent = ordWhy(e) })
      .then(function(){ if (el('osSave')) busy(el('osSave'), false) });
  };
}

function osPipes(s, m){
  var live = m.pipelines || [];
  if (!live.length) return L('<div class="hint">У цієї Zoho немає воронок — угода створиться у стандартній.</div>');

  return L('<h4>Воронки, куди можна створювати</h4>') +
    live.map(function(p){
      var on = s.pipelines.filter(function(x){ return x.id === p.id })[0];
      return '<div class="osp">' +
        '<label class="ochk"><input type="checkbox" data-ospipe="' + esc(p.id) + '"' +
          (on ? ' checked' : '') + '> ' + esc(p.name) +
          (p.layoutName ? ' <span class="dim">' + esc(p.layoutName) + '</span>' : '') +
        '</label>' +
        (on
          ? L('<div class="fld" style="margin:6px 0 0 23px"><label>Стадія нового замовлення</label>') +
            '<select data-osstage="' + esc(p.id) + '">' +
            p.stages.map(function(st){
              return '<option value="' + esc(st.value) + '"' +
                (st.value === on.stage ? ' selected' : '') + '>' + esc(st.label) + '</option>';
            }).join('') + '</select></div>' +
            (s.sameFields
              ? ''
              : L('<div class="k" style="margin:8px 0 0 23px">Поля цієї воронки</div>') +
                osFieldList(s, m, p.id, on.fields))
          : '') +
      '</div>';
    }).join('');
}

function osFieldsBox(s, m){
  return L('<h4>Поля, які питати в оператора</h4>') +
    (s.module === 'Deals'
      ? '<label class="ochk"><input type="checkbox" id="osSame"' +
        (s.sameFields ? ' checked' : '') + '> ' + L('Поля однакові для всіх воронок') + '</label>'
      : '') +
    (s.module !== 'Deals' || s.sameFields ? osFieldList(s, m, '', s.fields) : '') +
    L('<div class="hint">Обовʼязкові поля Zoho додаються самі — відмічати їх не треба.</div>');
}

function osFieldList(s, m, into, chosen){
  var list = m.fields || [];
  if (!list.length) return L('<div class="hint">У цьому модулі немає полів, які можна заповнити.</div>');
  return '<div class="osf">' + list.map(function(f){
    return '<label class="ochk" style="margin-top:4px">' +
      '<input type="checkbox" data-osfld="' + esc(f.api) + '" data-osfor="' + esc(into) + '"' +
      (f.required ? ' checked disabled' : (chosen.indexOf(f.api) >= 0 ? ' checked' : '')) + '> ' +
      esc(f.label) + (f.required ? L(' <span class="dim">обовʼязкове</span>') : '') + '</label>';
  }).join('') + '</div>';
}

function osSubBox(s, m){
  var subs = m.subforms || [];
  var sub = osSub();
  return L('<h4>Де лежать товари</h4>') +
    (!subs.length
      ? L('<div class="hint">У цьому модулі немає таблиці товарів. Створіть у Zoho підформу з ') +
        L('товаром, кількістю і ціною — вона зʼявиться тут.</div>')
      : L('<div class="fld"><label>Таблиця товарів</label><select id="osTab"><option value=""></option>') +
        subs.map(function(x){
          return '<option value="' + esc(x.api) + '"' + (x.api === s.subform.api ? ' selected' : '') +
            '>' + esc(x.label) + '</option>';
        }).join('') + '</select></div>' +
        (sub
          ? '<div class="osc">' +
            L('<div class="fld"><label>Товар</label>') + osCol(sub, 'product', s.subform.product) + '</div>' +
            L('<div class="fld"><label>Кількість</label>') + osCol(sub, 'quantity', s.subform.quantity) + '</div>' +
            L('<div class="fld"><label>Ціна</label>') + osCol(sub, 'price', s.subform.price) + '</div>' +
            L('<div class="fld"><label>Знижка на товар</label>') +
              osCol(sub, 'discount', s.subform.discount) + '</div>' +
            '</div>' +
            L('<div class="hint">Знижку на рядок можна не вказувати — тоді її не питають ') +
            L('в оператора.</div>') +
            osWhole(s, m)
          : ''));
}

/**
 * Скидка на весь заказ.
 *
 * Отдельным полем, а не галочкой в списке полей: это не «ещё одно
 * поле Zoho», а уступка сверх позиций, и оператор вписывает её под
 * суммой, а не среди перевозчиков и сроков.
 */
function osWhole(s, m){
  var nums = (m.fields || []).filter(function(f){ return f.kind === 'num' });
  if (!nums.length) return '';
  return L('<div class="fld" style="margin-top:10px"><label>Поле знижки на все замовлення</label>') +
    '<select id="osWhole"><option value="">' + L('не питати') + '</option>' +
    nums.map(function(f){
      return '<option value="' + esc(f.api) + '"' +
        (f.api === s.discountField ? ' selected' : '') + '>' + esc(f.label) + '</option>';
    }).join('') + '</select></div>';
}

function osCol(sub, role, value){
  return '<select data-oscol="' + role + '"><option value=""></option>' +
    sub.columns.map(function(c){
      return '<option value="' + esc(c.api) + '"' + (c.api === value ? ' selected' : '') + '>' +
        esc(c.label) + '</option>';
    }).join('') + '</select>';
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
      /* Конец смены. Кнопка живёт здесь, а не в списке чатов: это
         действие раз в день, и рядом с ежедневными оно только
         напрашивалось бы на случайное нажатие. Показываем её лишь
         тогда, когда снимать есть что. */
      '<div class="prow"><div class="pk">' + L('Чати на вас') + '</div>' +
      '<div class="pv">' + (Number(COUNTS.mine || 0) || L('немає')) +
      L('<div class="hint" style="margin-top:2px">Наприкінці зміни зніміться з усіх: ') +
      L('інакше вони виглядають зайнятими, і наступна зміна їх не бере.</div></div>') +
      (Number(COUNTS.mine || 0)
        ? L('<button class="ghost mini" id="pfFree">Знятись з усіх</button>')
        : '<span></span>') +
      '</div>' +
      '<div class="err" id="pfErr"></div>' +
      '</div></div>' +

      L('<div class="pg-sec"><h3>Організація</h3><div class="card">') +
      row(L('Назва'), esc(t.name || '—'), 'org', admin) +
      row(L('Ідентифікатор'), '<code>' + esc(t.slug || '') + '</code>', 'sl', false,
        L('За ним адреса вашої компанії в сервісі. Вона не змінюється.')) +
      row(L('Тариф'), esc(t.plan || 'trial') + L(' · місць: ') + esc(t.seats_limit), 'pl', false) +
      row(L('Регіон даних'), esc((t.region || 'eu').toUpperCase()), 'rg', false,
        L('Де фізично лежать листування і файли.')) +
      /* Пояс — свойство компании, а не расписания: по нему считаются и
         рабочие часы, и время ответа в отчётах. Поэтому он стоит здесь,
         рядом с регионом данных, а в расписании только упоминается. */
      (admin
        ? '<div class="row2"><div class="lbl">' + L('Часовий пояс') + '</div>' +
          '<select id="orgTz" style="max-width:240px">' + tzOptions(whOf(t).tz) + '</select></div>' +
          L('<div class="hint">За ним рахуються робочі години та час відповіді у звітах.</div>')
        : row(L('Часовий пояс'), esc(whOf(t).tz), 'tz', false)) +
      row(L('Підключена'), esc(fmtDate(t.created_at)), 'cr', false) +
      '<div class="err" id="orgErr"></div>' +
      '</div></div>' +

      (admin ? whPanel(t) : '') +

      /* Реквизиты для счетов. Только администратору и только рядом с
         подпиской: их вписывают один раз, в тот день, когда впервые
         понадобился счёт, — и больше не вспоминают. */
      (admin
        ? L('<div class="pg-sec"><h3>Реквізити для рахунків</h3><div class="card">') +
          L('<div class="hint">Їх бачить ваша бухгалтерія у рахунку. Без коду та адреси ') +
          L('рахунок не проведуть.</div>') +
          '<div class="row2" style="margin-top:8px">' +
            L('<input id="rqName" placeholder="повна назва, напр. ТОВ «Ромашка»" value="') +
              esc(t.legal_name || t.name || '') + '">' +
            L('<input id="rqTax" placeholder="ЄДРПОУ або РНОКПП" value="') +
              esc(t.tax_id || '') + '">' +
          '</div>' +
          '<div class="row2" style="margin-top:8px">' +
            L('<input id="rqVat" placeholder="ІПН (якщо платник ПДВ)" value="') +
              esc(t.vat_id || '') + '">' +
            L('<input id="rqAddr" placeholder="юридична адреса" value="') +
              esc(t.legal_address || '') + '">' +
          '</div>' +
          '<div class="row2" style="margin-top:8px">' +
            L('<input id="rqIban" placeholder="IBAN" value="') + esc(t.iban || '') + '">' +
            L('<input id="rqBank" placeholder="банк" value="') + esc(t.bank_name || '') + '">' +
            L('<input id="rqMfo" placeholder="МФО" style="max-width:120px" value="') +
              esc(t.bank_code || '') + '">' +
          '</div>' +
          '<div class="row2" style="margin-top:8px">' +
            L('<input id="rqSign" placeholder="хто підписує, напр. директор Іваненко І. І." value="') +
              esc(t.signer || '') + '">' +
            '<label class="ochk" style="align-self:center"><input type="checkbox" id="rqVatp"' +
              (t.vat_payer ? ' checked' : '') + '> ' + L('платник ПДВ') + '</label>' +
          '</div>' +
          L('<div class="row2" style="margin-top:8px"><button class="ghost mini" id="rqSave">Зберегти</button></div>') +
          '<span class="ok" id="rqOk"></span><div class="err" id="rqErr"></div>' +
          '</div></div>'
        : '') +

      /* Подписка. Только администратору: оператор не решает, чем платит
         компания, и кнопка оплаты у него была бы тупиком. */
      (admin
        ? L('<div class="pg-sec"><h3>Підписка</h3><div class="card" id="bill">') +
          L('<div class="hint">Завантажую...</div></div></div>')
        : '') +

      L('<div class="pg-sec"><h3>Зараз в акаунті</h3>') +
      '<div class="nums">' +
      num(c.channels, L('каналів')) + num(c.users, L('співробітників')) +
      num(c.conversations, L('діалогів')) + num(c.messages, L('повідомлень')) +
      '</div></div>' +
      '</div>';

    wirePass();
    wireWh();
    if (el('bill')) billLoad();

    /* Реквизиты сохраняются целиком, одной кнопкой: это один документ,
       а не девять настроек, и вписывают их за один подход. */
    if (el('rqSave')) el('rqSave').onclick = function(){
      var b = el('rqSave');
      el('rqErr').textContent = '';
      el('rqOk').textContent = '';
      busy(b, true);
      api('/tenant/requisites', { method:'PATCH', body:{
        legalName: el('rqName').value,
        taxId: el('rqTax').value,
        vatId: el('rqVat').value,
        legalAddress: el('rqAddr').value,
        bankName: el('rqBank').value,
        iban: el('rqIban').value,
        bankCode: el('rqMfo').value,
        vatPayer: el('rqVatp').checked,
        signer: el('rqSign').value
      }}).then(function(){
        el('rqOk').textContent = L('збережено');
        // Счета читают реквизиты при печати, поэтому список перечитываем:
        // иначе только что исправленный код уедет в старом виде.
        INV = null;
        if (el('invs')) invLoad();
      }).catch(function(e){
        el('rqErr').textContent = ((e && e.payload) || {}).error || L('Не вдалося зберегти');
      }).then(function(){ busy(b, false) });
    };

    if (el('pfFree')) el('pfFree').onclick = function(){
      var b = el('pfFree');
      busy(b, true);
      api('/me/unassign', { method:'POST' }).then(function(r){
        var n = (r && r.freed) || 0;
        // Закрытые не трогаем, и об этом говорим сразу: иначе человек
        // увидит, что число не сошлось с тем, что он помнил.
        toast(n ? L('Знято з чатів: ') + n + L(' · закриті залишилися за вами')
                : L('Активних чатів на вас немає'));
        refresh();
        tabProfile();
      }).catch(function(e){ busy(b, false); sErr(e) });
    };

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

/* ══════════════ Робочі години ══════════════ */

var WH_DAYS = ['Понеділок','Вівторок','Середа','Четвер','Пʼятниця','Субота','Неділя'];

/* Список поясов короткий и намеренно: это не географический справочник,
   а выбор из тех, где на самом деле сидят команды наших клиентов.
   Нужного нет — впишут руками, поле принимает любой известный браузеру. */
var WH_ZONES = ['Europe/Kyiv','Europe/Warsaw','Europe/Berlin','Europe/London',
  'Europe/Lisbon','Europe/Bucharest','Asia/Dubai','Asia/Tbilisi','UTC'];

function tzOptions(current){
  var zones = WH_ZONES.slice();
  if (zones.indexOf(current) < 0) zones.unshift(current);
  return zones.map(function(z){
    return '<option value="' + esc(z) + '"' + (z === current ? ' selected' : '') + '>' + esc(z) + '</option>';
  }).join('');
}

function whOf(t){
  var raw = (t && t.work_hours) || {};
  var days = Array.isArray(raw.days) ? raw.days : [];
  return {
    tz: raw.tz || 'Europe/Kyiv',
    days: WH_DAYS.map(function(_unused, i){
      var d = days[i];
      /* Дня в настройке нет — значит её ещё не трогали, и это
         круглосуточно: ровно то же, что решает сервер. В полях времени
         при этом показываем 9–18, чтобы при снятии галочки «цілодобово»
         человек получил осмысленное начало, а не полночь. */
      if (!d || typeof d !== 'object') return { on: true, allDay: true, from: 540, to: 1080 };
      return {
        on: d.on !== false,
        allDay: d.allDay === true,
        from: typeof d.from === 'number' && d.from < 1440 ? d.from : 540,
        to: typeof d.to === 'number' && d.to <= 1440 && d.to > 0 && d.to < 1440 ? d.to : 1080
      };
    })
  };
}

function hhmmOf(m){
  var h = Math.floor(m / 60), mm = m % 60;
  return (h < 10 ? '0' : '') + h + ':' + (mm < 10 ? '0' : '') + mm;
}

/**
 * Рабочие часы компании.
 *
 * Стоят в профиле рядом с организацией, а не в каналах: клиент пишет в
 * компанию, а не в Telegram, и «по будням до шести» — свойство
 * компании. Здесь же объясняется, на что это влияет, иначе расписание
 * выглядит украшением, которое никто не заполнит.
 */
function whPanel(t){
  var wh = whOf(t);
  return L('<div class="pg-sec"><h3>Робочі години</h3><div class="card">') +
    L('<div class="hint" style="margin-bottom:10px">Поза цими годинами ми не турбуємо сповіщенням ') +
    L('«клієнт чекає»: воно все одно нікого не підніме, а вимикають після нього всі сповіщення разом. ') +
    L('Час відповіді в майбутніх звітах теж рахуватиметься за цими годинами.</div>') +
    L('<div class="hint" style="margin-bottom:10px">Години вказані за поясом компанії: ') +
    '<b>' + esc(wh.tz) + '</b>' + L('. Змінити його можна вище, у профілі організації.</div>') +
    '<div class="whdays">' +
    wh.days.map(function(d, i){
      return '<div class="whrow">' +
        '<label class="ntev"><input type="checkbox" data-wh-on="' + i + '"' + (d.on ? ' checked' : '') +
          '> ' + L(WH_DAYS[i]) + '</label>' +
        '<label class="ntev"><input type="checkbox" data-wh-all="' + i + '"' + (d.allDay ? ' checked' : '') +
          '> ' + L('цілодобово') + '</label>' +
        '<input type="time" data-wh-from="' + i + '" value="' + hhmmOf(d.from) + '">' +
        '<input type="time" data-wh-to="' + i + '" value="' + hhmmOf(d.to) + '">' +
      '</div>';
    }).join('') +
    '</div>' +
    L('<div class="acts"><button id="whSave">Зберегти</button>') +
    L('<button class="ghost" id="whCopy">Скопіювати понеділок на всі дні</button></div>') +
    '<div class="ok" id="whOk"></div></div></div>';
}

function whRead(){
  return {
    days: WH_DAYS.map(function(_unused, i){
      var on = document.querySelector('[data-wh-on="' + i + '"]').checked;
      var all = document.querySelector('[data-wh-all="' + i + '"]').checked;
      var from = document.querySelector('[data-wh-from="' + i + '"]').value;
      var to = document.querySelector('[data-wh-to="' + i + '"]').value;
      return { on: on, allDay: all, from: whMin(from), to: whMin(to) };
    })
  };
}

function whMin(v){
  var p = String(v || '').split(':');
  var h = Number(p[0]), m = Number(p[1] || 0);
  if (!isFinite(h) || !isFinite(m)) return 0;
  return h * 60 + m;
}

function wireWh(){
  if (el('orgTz')) el('orgTz').onchange = function(){
    var tz = this.value;
    api('/settings/work-hours', { method:'PATCH', body:{ tz: tz } })
      .then(function(r){
        if (ME && ME.tenant) ME.tenant.work_hours = r.workHours;
        toast(L('Часовий пояс збережено'));
        // Перерисовываем: подпись в расписании называет пояс, и она
        // должна называть новый, а не тот, что был при открытии.
        tabProfile();
      })
      .catch(function(e){ el('orgErr').textContent = ((e.payload||{}).detail) || L('Не вдалося зберегти') });
  };

  if (!el('whSave')) return;

  /* Поля времени гаснут, когда день выключен или круглосуточный: иначе
     человек правит числа, которые ни на что не влияют, и считает, что
     настройка не работает. */
  function paint(){
    for (var i = 0; i < 7; i++){
      var on = document.querySelector('[data-wh-on="' + i + '"]').checked;
      var all = document.querySelector('[data-wh-all="' + i + '"]').checked;
      var f = document.querySelector('[data-wh-from="' + i + '"]');
      var t = document.querySelector('[data-wh-to="' + i + '"]');
      f.disabled = t.disabled = !on || all;
      document.querySelector('[data-wh-all="' + i + '"]').disabled = !on;
    }
  }
  for (var i = 0; i < 7; i++){
    document.querySelector('[data-wh-on="' + i + '"]').onchange = paint;
    document.querySelector('[data-wh-all="' + i + '"]').onchange = paint;
  }
  paint();

  el('whCopy').onclick = function(){
    var on = document.querySelector('[data-wh-on="0"]').checked;
    var all = document.querySelector('[data-wh-all="0"]').checked;
    var from = document.querySelector('[data-wh-from="0"]').value;
    var to = document.querySelector('[data-wh-to="0"]').value;
    for (var i = 1; i < 7; i++){
      document.querySelector('[data-wh-on="' + i + '"]').checked = on;
      document.querySelector('[data-wh-all="' + i + '"]').checked = all;
      document.querySelector('[data-wh-from="' + i + '"]').value = from;
      document.querySelector('[data-wh-to="' + i + '"]').value = to;
    }
    paint();
  };

  el('whSave').onclick = function(){
    var body = whRead();
    busy(el('whSave'), true);
    api('/settings/work-hours', { method:'PATCH', body: body })
      .then(function(r){
        if (ME && ME.tenant) ME.tenant.work_hours = r.workHours;
        el('whOk').textContent = L('Збережено');
      })
      .catch(function(e){ el('whOk').textContent = ((e.payload||{}).detail) || L('Не вдалося зберегти') })
      .then(function(){ busy(el('whSave'), false) });
  };
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
    '<div class="pacts">' +
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
/* ── Подписка ───────────────────────────────────────────────────────
   Оплата идёт через Paddle: он выступает продавцом перед покупателем,
   сам считает налог его страны и сам выдаёт чек. Нам остаётся открыть
   его окно и дождаться события.

   Окно открывается по номеру сделки, заведённой на сервере. Соблазн
   передать сюда цену и признак организации был — так короче, — но
   тогда их задаёт тот, кто сидит в браузере. */

var PADDLE_ON = false;
var BILL = null;
/* Год стоит первым и выбран по умолчанию: он дешевле, и человек должен
   увидеть сначала лучшую цену, а не худшую. */
var BILL_PERIOD = 'year';
/* Что выбрано к покупке: тариф и, для тарифа за пользователя, сколько
   лицензий. Выбор живёт здесь, а не в разметке: перерисовка списка не
   должна сбрасывать то, что человек уже выбрал. */
var BILL_PLAN = '';
var BILL_SEATS = 0;

/*
 * Отказ подписки словами.
 *
 * Отдельно от sErr нарочно: sErr — это не форматтер текста, а
 * перерисовка страницы сообщением об отказе. Подставленный в строку, он
 * стирал профиль целиком и оставлял на его месте «paddle_failed» — по
 * одной неудачной оплате исчезала вся страница.
 *
 * Здесь же важно другое: показать то, что ответил Paddle. Его слова
 * называют причину («price not found», «forbidden»), а наш код —
 * только то, что не получилось.
 */
function billWhy(e){
  var p = (e && e.payload) || {};
  if (p.error === 'paddle_not_configured') return L('Paddle не налаштований на сервері');
  if (p.error === 'no_price') return L('Тариф ще не заведений у Paddle');
  if (p.error === 'no_plan_price') return L('Ціну тарифу ще не задано — напишіть нам, виставимо рахунок вручну');
  if (p.error === 'no_rate') return L('Курс НБУ на сьогодні ще невідомий — спробуйте пізніше');
  if (p.error === 'individual_plan') return L('У вас індивідуальна ціна: оплата за рахунком');
  if (p.error === 'no_customer') return L('У Paddle ще немає вашого клієнта — спочатку оплата');
  if (p.why) return L('Paddle: ') + p.why;
  return (e && e.message) || L('помилка');
}

function billLoad(){
  api('/billing').then(function(d){ BILL = d; billPaint() })
    .catch(function(e){
      var b = el('bill');
      if (b) b.innerHTML = '<div class="err">' + esc(billWhy(e)) + '</div>';
    });
}

function billCur(prices){
  var cur = Object.keys(prices || {});
  if (!cur.length) return null;
  return prices.USD !== undefined ? 'USD' : cur[0];
}

function billMoney(prices){
  var one = billCur(prices);
  return one ? prices[one] + ' ' + one + L(' / місяць') : '';
}

/* Годовую цену показываем в месяцах. Сравнивать 600 с 60 человек не
   станет, а 50 с 60 сравнит сразу — и увидит, зачем платить за год. */
function billMonthOfYear(prices){
  var one = billCur(prices);
  if (!one) return '';
  return Math.round((prices[one] / 12) * 100) / 100 + ' ' + one + L(' / місяць');
}

/* Название тарифа для клиента. «custom» — слово из базы, а не имя
   тарифа: человек, которому его показали, идёт спрашивать, что это. */
function planName(p){
  return p === 'custom' ? L('Корпоративний') : p;
}

/*
 * Цена по головам словами.
 *
 * Сумма без разложения не проверяется: «90 доларів» человек сверить
 * не может, а «6 × 15» сверит сразу — и спорить будет о цене человека,
 * а не о том, откуда взялась цифра.
 */
function billSeatMath(p, seats){
  var side = BILL_PERIOD === 'year' ? p.year : p.month;
  var prices = (side && side.price) || {};
  var one = billCur(prices);
  if (!one || !seats) return '';
  // Цена приходит за одного человека, а не итогом: сколько их будет,
  // решают здесь, на этой странице.
  var each = BILL_PERIOD === 'year' ? Math.round((prices[one] / 12) * 100) / 100 : prices[one];
  return L('за користувача ') + each + ' ' + one + ' × ' + seats + L(' користувачів');
}

/* Цена одного места в месяц: для тарифа за пользователя до выбора. */
function billOne(p){
  var side = BILL_PERIOD === 'year' ? p.year : p.month;
  var prices = (side && side.price) || {};
  var one = billCur(prices);
  if (!one) return '';
  var each = BILL_PERIOD === 'year' ? prices[one] / 12 : prices[one];
  return (Math.round(each * 100) / 100) + ' ' + one + L(' / місяць за користувача');
}

/* Итог по выбранному тарифу в месяц: у обычного это его цена, у тарифа
   за пользователя — цена одного, умноженная на число лицензий. */
function billTotal(p, seats){
  var side = BILL_PERIOD === 'year' ? p.year : p.month;
  var prices = (side && side.price) || {};
  var one = billCur(prices);
  if (!one) return '';
  var each = BILL_PERIOD === 'year' ? prices[one] / 12 : prices[one];
  var total = p.perSeat ? each * Math.max(1, seats) : each;
  return (Math.round(total * 100) / 100) + ' ' + one + L(' / місяць');
}

/* Оплаты берём у Paddle: своя копия однажды разойдётся с настоящей —
   после возврата или спора с банком, — и человек увидит у нас одно, а
   в выписке другое. */
var PAYS = null;

function billPays(){
  api('/billing/payments')
    .then(function(d){ PAYS = d.payments || []; billPaysPaint() })
    .catch(function(){ PAYS = []; billPaysPaint() });
}

function billPaysPaint(){
  var box = el('pays');
  if (!box) return;
  if (!PAYS || !PAYS.length){
    box.innerHTML = L('<div class="hint">Оплат ще не було.</div>');
    return;
  }
  box.innerHTML = PAYS.map(function(p){
    return '<div class="prow"><div class="pk">' + esc(fmtDate(p.at)) + '</div>' +
      '<div class="pv"><b>' + esc(p.amount) + ' ' + esc(p.currency) + '</b>' +
      (p.card ? ' · ' + esc(p.card) : '') +
      (p.invoice ? L('<div class="hint" style="margin-top:2px">Рахунок ') + esc(p.invoice) + '</div>' : '') +
      '</div>' +
      '<button class="ghost mini" data-inv="' + esc(p.id) + L('">Чек</button>') +
      '</div>';
  }).join('');

  Array.prototype.forEach.call(box.querySelectorAll('[data-inv]'), function(btn){
    btn.onclick = function(){
      busy(btn, true);
      api('/billing/payments/' + btn.dataset.inv + '/invoice')
        .then(function(d){
          busy(btn, false);
          // Ссылка подписана и живёт недолго — открываем сразу.
          if (d && d.url) window.open(d.url, '_blank', 'noopener');
        })
        .catch(function(e){ busy(btn, false); el('bErr').textContent = billWhy(e) });
    };
  });
}

/* ── Рахунок по безналу ──────────────────────────────────────────── */

/*
 * Счета организации: список, печать и «оплату здійснено».
 *
 * Держатся рядом с картой намеренно. Способа заплатить два, и выбор
 * между ними — это выбор клиента, а не двух разных разделов в разных
 * концах кабинета.
 */
var INV = null;

function invLoad(){
  api('/billing/invoices')
    .then(function(d){ INV = d; invPaint() })
    .catch(function(){ INV = { invoices: [] }; invPaint() });
}

function invState(v){
  return v.status === 'paid' ? L('оплачено')
    : v.claimed_at ? L('очікує підтвердження')
    : L('не сплачено');
}

function invPaint(){
  var box = el('invs');
  if (!box) return;
  var list = (INV && INV.invoices) || [];
  if (!list.length){
    box.innerHTML = L('<div class="dim" style="font-size:12.5px">Рахунків ще не було.</div>');
    return;
  }
  box.innerHTML = list.map(function(v){
    var cur = v.currency || 'UAH';
    var sum = cur === 'UAH' ? money2(v.amount) + L(' грн')
      : money2(v.amount) + ' ' + cur + ' (' + money2(v.amount_uah) + L(' грн)');
    return '<div class="item"><div><div class="t">' + L('Рахунок ') + esc(v.number) + ' · ' +
      esc(sum) + '</div><div class="s">' + esc(fmtDate(v.issued_on)) + ' · ' + esc(invState(v)) +
      (v.due_on && v.status !== 'paid' ? L(' · сплатити до ') + esc(fmtDate(v.due_on)) : '') +
      '</div></div><div style="flex:none;display:flex;gap:6px">' +
      '<button class="ghost mini" data-inv="' + esc(v.id) + L('">Друк</button>') +
      (v.status === 'paid' || v.claimed_at
        ? ''
        : '<button class="ghost mini" data-paid="' + esc(v.id) + L('">Оплату здійснено</button>')) +
      '</div></div>';
  }).join('');

  Array.prototype.forEach.call(box.querySelectorAll('[data-inv]'), function(btn){
    btn.onclick = function(){
      var v = list.filter(function(x){ return x.id === btn.dataset.inv })[0];
      if (!v) return;
      invoicePrint(invoiceHtml(v, INV.seller, INV.buyer, INV.dueDays), function(){
        el('bErr').textContent = L('Браузер заблокував вікно друку');
      });
    };
  });

  Array.prototype.forEach.call(box.querySelectorAll('[data-paid]'), function(btn){
    btn.onclick = function(){
      busy(btn, true);
      api('/billing/invoices/' + btn.dataset.paid + '/paid', { method:'POST' })
        .then(function(){
          toast(L('Дякуємо. Перевіримо надходження і підтвердимо.'));
          invLoad();
        })
        .catch(function(e){ busy(btn, false); el('bErr').textContent = billWhy(e) });
    };
  });
}

/* Счёт выставляется на тот же период, что выбран переключателем: иначе
   человек смотрит на годовую цену, а получает счёт на месяц. */
function invMake(btn){
  el('bErr').textContent = '';
  busy(btn, true);
  api('/billing/invoice', { method:'POST',
    body:{ plan: BILL_PLAN, period: BILL_PERIOD, seats: BILL_SEATS } })
    .then(function(){ busy(btn, false); invLoad() })
    .catch(function(e){ busy(btn, false); el('bErr').textContent = billWhy(e) });
}

function billPaint(){
  var box = el('bill');
  if (!box || !BILL) return;

  // Состояние подписки словами, а не кодом Paddle: past_due человек не
  // прочитает, а «оплата не пройшла» прочитает и поймёт, что делать.
  var st = BILL.status === 'active' ? L('активна')
    : BILL.status === 'trialing' ? L('пробний період')
    : BILL.status === 'past_due' ? L('оплата не пройшла — Paddle спробує ще раз')
    : BILL.status === 'paused' ? L('призупинена')
    : BILL.status === 'canceled' ? L('скасована')
    : '';

  var head = '<div class="prow"><div class="pk">' + L('Зараз') + '</div>' +
    '<div class="pv"><b>' + esc(planName(BILL.plan || 'trial')) + '</b>' +
    (BILL.paidUntil ? L(' · оплачено до ') + esc(fmtDate(BILL.paidUntil)) : '') +
    (st ? ' · ' + esc(st) : '') +
    (BILL.perSeat
      ? L('<div class="hint" style="margin-top:2px">Користувачів: ') + esc(BILL.seatsLimit) +
        L(' — оплата за кожного</div>')
      : L('<div class="hint" style="margin-top:2px">Місць у тарифі: ') + esc(BILL.seatsLimit) + '</div>') +
    '</div>' +
    (BILL.portal ? L('<button class="ghost mini" id="bPortal">Керувати підпискою</button>') : '<span></span>') +
    '</div>';

  // Переключатель периода. Годовая цена показывается в месяцах, а не
  // одной суммой за год: сравнивать 600 с 60 человек не станет, а 50 с
  // 60 сравнит сразу.
  var seg = '<div class="seg" style="margin:10px 0">' +
    '<button data-per="year"' + (BILL_PERIOD === 'year' ? ' class="on"' : '') + '>' +
      L('За рік') + '</button>' +
    '<button data-per="month"' + (BILL_PERIOD === 'month' ? ' class="on"' : '') + '>' +
      L('Щомісяця') + '</button>' +
    '</div>';

  /*
   * Список тарифов с выбором.
   *
   * Раньше здесь был один тариф — тот, на котором клиент уже сидит, — и
   * вырасти из кабинета было нельзя: чтобы перейти на корпоративный,
   * приходилось писать в поддержку. Теперь тарифы стоят рядом, выбор
   * отмечается, а у тарифа за пользователя рядом с ценой стоит поле,
   * где называют число лицензий.
   */
  if (!BILL_PLAN) BILL_PLAN = BILL.current || 'pro';
  if (!BILL_SEATS) BILL_SEATS = Math.max(1, Number(BILL.seats) || 1);

  var cards = (BILL.plans || []).map(function(p){
    var side = BILL_PERIOD === 'year' ? p.year : p.month;
    side = side || {};
    var on = p.plan === BILL_PLAN;
    /* У невыбранного тарифа за пользователя показываем цену одного
       места: итог зависит от числа лицензий, а его называют после
       выбора — до него любая сумма была бы выдуманной. */
    var total = p.perSeat && !on ? billOne(p) : billTotal(p, BILL_SEATS);
    return '<div class="prow tariff' + (on ? ' on' : '') + '" data-plan="' + esc(p.plan) + '">' +
      '<div class="pk">' + esc(planName(p.plan)) +
        (p.plan === BILL.plan ? L('<div class="s">ваш тариф</div>') : '') + '</div>' +
      '<div class="pv">' + (total ? esc(total) : L('ціну ще не задано')) +
      (p.perSeat && on
        ? '<div class="hint" style="margin-top:2px">' + esc(billSeatMath(p, BILL_SEATS)) + '</div>' +
          L('<div class="row2" style="margin-top:6px"><input id="bSeats" type="number" min="1" max="1000" ') +
          'value="' + esc(BILL_SEATS) + L('" style="max-width:110px"><div class="hint" style="align-self:center">ліцензій</div></div>')
        : p.perSeat
          ? L('<div class="hint" style="margin-top:2px">Ціна за одного користувача. Кількість — при виборі тарифу.</div>')
          : '') +
      (BILL_PERIOD === 'year' && on
        ? L('<div class="hint" style="margin-top:2px">Списання раз на рік. Два місяці у подарунок.</div>')
        : '') +
      (on && p.individual
        ? L('<div class="hint" style="margin-top:2px">Індивідуальна ціна: оплата за рахунком. Напишіть нам.</div>')
        : on && !side.priceId
          ? L('<div class="hint" style="margin-top:2px">Карткою цей тариф поки не заведений у Paddle — платіть рахунком.</div>')
          : '') +
      '</div>' +
      '<span class="pick">' + (on ? '✓' : '') + '</span>' +
      '</div>';
  }).join('');

  /* Кнопки одни на выбранный тариф, а не по кнопке в каждой строке:
     покупают один тариф, и способов оплаты у него два. */
  var chosen = (BILL.plans || []).filter(function(p){ return p.plan === BILL_PLAN })[0] || {};
  var chosenSide = (BILL_PERIOD === 'year' ? chosen.year : chosen.month) || {};
  var buttons = '<div class="row2" style="margin-top:10px">' +
    (chosenSide.priceId && !chosen.individual
      ? '<button class="mini" data-pay="' + esc(BILL_PLAN) + '">' +
        (BILL.subscribed && BILL_PLAN === BILL.plan ? L('Продовжити') : L('Оплатити карткою')) + '</button>'
      : '') +
    L('<button class="ghost mini" id="bInv">Виставити рахунок</button>') +
    '</div>';

  box.innerHTML = head + seg + cards + buttons +
    L('<div class="hint" style="margin-top:8px">Карткою оплату проводить Paddle: він приймає платіж, ') +
    L('нараховує податок вашої країни і надсилає чек. Рахунок — для оплати з рахунку компанії, ') +
    L('реквізити беремо з профілю організації. Скасувати можна будь-коли — ') +
    L('доступ триває до кінця оплаченого періоду.</div>') +
    '<div class="err" id="bErr"></div>' +
    L('<div class="lbl" style="margin-top:14px">Рахунки</div>') +
    '<div id="invs" style="margin-top:8px"></div>' +
    L('<div class="lbl" style="margin-top:14px">Оплати карткою</div>') +
    '<div id="pays"></div>' +
    L('<div class="row2" style="margin-top:8px"><button class="ghost mini" id="bSync">Оновити з Paddle</button></div>');

  if (el('bPortal')) el('bPortal').onclick = function(){
    var b = el('bPortal');
    busy(b, true);
    api('/billing/portal', { method:'POST' }).then(function(d){
      busy(b, false);
      // Ссылка одноразовая и живёт недолго, поэтому открываем сразу.
      if (d && d.url) window.open(d.url, '_blank', 'noopener');
    }).catch(function(e){ busy(b, false); el('bErr').textContent = billWhy(e) });
  };

  billPaysPaint();
  if (PAYS === null) billPays();

  el('bInv').onclick = function(){ invMake(el('bInv')) };
  invPaint();
  if (INV === null) invLoad();

  /* Кнопка на случай, когда вебхук не дошёл. Она не должна была бы
     понадобиться — но оплата это то место, где «не должно было» стоит
     дорого, а лишняя кнопка не стоит ничего. */
  el('bSync').onclick = function(){
    var b = el('bSync');
    el('bErr').textContent = '';
    busy(b, true);
    api('/billing/refresh', { method:'POST' })
      .then(function(){ busy(b, false); billLoad(); billPays() })
      .catch(function(e){ busy(b, false); el('bErr').textContent = billWhy(e) });
  };

  Array.prototype.forEach.call(box.querySelectorAll('[data-per]'), function(btn){
    btn.onclick = function(){ BILL_PERIOD = btn.dataset.per; billPaint() };
  });

  /* Выбор тарифа. Перерисовываем целиком: цена, поле лицензий и кнопки
     зависят от выбора, и чинить их по частям — верный способ показать
     цену одного тарифа рядом с кнопкой другого. */
  Array.prototype.forEach.call(box.querySelectorAll('[data-plan]'), function(rowEl){
    rowEl.onclick = function(e){
      if (e.target && e.target.id === 'bSeats') return;
      BILL_PLAN = rowEl.dataset.plan;
      billPaint();
    };
  });

  if (el('bSeats')) {
    el('bSeats').oninput = function(){
      var n = Math.max(1, Math.min(1000, Math.round(Number(el('bSeats').value) || 1)));
      BILL_SEATS = n;
      // Перерисовываем только цифры вокруг: полная перерисовка забрала
      // бы курсор из поля на каждой набранной цифре.
      var p = (BILL.plans || []).filter(function(x){ return x.plan === BILL_PLAN })[0];
      if (!p) return;
      var pv = el('bSeats').closest('.pv');
      if (pv && pv.firstChild) pv.firstChild.nodeValue = billTotal(p, n);
      var hint = pv && pv.querySelector('.hint');
      if (hint) hint.textContent = billSeatMath(p, n);
    };
  }

  Array.prototype.forEach.call(box.querySelectorAll('[data-pay]'), function(btn){
    btn.onclick = function(){ billPay(btn.dataset.pay, btn) };
  });
}

/**
 * Скрипт Paddle подгружается в момент нажатия, а не на каждой странице.
 *
 * Оплата случается раз в месяц, а страница открыта весь день: тянуть
 * чужой скрипт всем и всегда ради этого незачем. Второй раз не грузим —
 * окно оплаты можно открыть и закрыть сколько угодно.
 */
function paddleReady(d){
  if (PADDLE_ON && window.Paddle) return Promise.resolve();
  return new Promise(function(done, fail){
    var s = document.createElement('script');
    s.src = 'https://cdn.paddle.com/paddle/v2/paddle.js';
    s.onload = function(){
      try {
        if (d.env !== 'production') window.Paddle.Environment.set('sandbox');
        window.Paddle.Initialize({ token: d.clientToken, eventCallback: billEvent });
        PADDLE_ON = true;
        done();
      } catch (e){ fail(e) }
    };
    s.onerror = function(){ fail(new Error('paddle_script')) };
    document.head.appendChild(s);
  });
}

function billEvent(ev){
  if (!ev || ev.name !== 'checkout.completed') return;
  /* Состояние не ждём от вебхука, а спрашиваем сами. Вебхук быстрее,
     но настраивается отдельно и теряется; человек, только что
     заплативший, не должен смотреть на старый тариф и гадать. Пауза
     перед первым запросом — Paddle заводит подписку не мгновенно. */
  toast(L('Оплата пройшла. Оновлюю тариф.'));
  setTimeout(billRefresh, 2500);
  setTimeout(billRefresh, 9000);
}

function billRefresh(){
  api('/billing/refresh', { method:'POST' })
    .then(function(){ billLoad(); billPays() })
    .catch(function(){ billLoad() });
}

function billPay(plan, btn){
  var err = el('bErr');
  if (err) err.textContent = '';
  busy(btn, true);
  api('/billing/checkout', { method:'POST',
    body:{ plan: plan, period: BILL_PERIOD, seats: BILL_SEATS } })
    .then(function(d){
      /* Окно оплаты открывается там, где Paddle разрешил продавать.
         Домен кабинета он одобряет отдельно от витрины и может не
         одобрить вовсе, поэтому адрес называет сервер, а не мы здесь.
         Пусто — открываем на месте, как раньше. */
      if (d.payUrl) { window.location.href = d.payUrl; return null }
      return paddleReady(d).then(function(){
        busy(btn, false);
        window.Paddle.Checkout.open({ transactionId: d.transactionId });
      });
    })
    .catch(function(e){
      busy(btn, false);
      if (err) err.textContent = String(e && e.message) === 'paddle_script'
        ? L('Не вдалося завантажити вікно оплати. Перевірте блокувальник реклами.')
        : billWhy(e);
    });
}

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
  webchat:'WEB', custom:'API', messenger_comments:'FB', instagram_comments:'IG', email:'@' };

/*
 * Значки сетей.
 *
 * Рисуем сами, а не подключаем шрифт значков: вся страница — один файл,
 * и полтора десятка контуров дешевле любого стороннего набора, который
 * к тому же пришлось бы тянуть с чужого домена.
 *
 * Фигуры одноцветные: цвет даёт подложка, а белый силуэт на ней
 * узнаётся с десяти пикселей — именно столько занимает значок на
 * аватарке в списке. Две буквы на том же месте не читаются вовсе.
 */
var ICON_SVG = {
  telegram: '<path d="M22.1 3.6 2 11.4c-1.1.4-1.1 1.1 0 1.4l5.1 1.6 2 6.1c.2.7.5.9 1 .9.4 0 .6-.2.9-.5l2.5-2.4 5.1 3.8c.9.5 1.6.2 1.9-.9l3.4-16c.3-1.3-.5-1.9-1.6-1.4zM7.5 14.4 18.6 7.4c.5-.3.9-.1.5.2l-9.1 8.3-.4 4.1-2.1-5.6z"/>',
  whatsapp: '<path d="M12 2a9.9 9.9 0 0 0-8.4 15.2L2 22.4l5.4-1.6A9.9 9.9 0 1 0 12 2zm5.8 14.1c-.2.7-1.4 1.3-1.9 1.3-.5.1-1.1.1-1.8-.1a16 16 0 0 1-1.6-.6c-2.9-1.2-4.8-4.1-4.9-4.3-.2-.2-1.2-1.6-1.2-3s.8-2.1 1-2.4c.3-.3.6-.4.8-.4h.6c.2 0 .4-.1.7.5.2.6.8 2 .9 2.1.1.2.1.3 0 .5l-.3.5-.4.5c-.2.1-.3.3-.2.6.2.3.8 1.2 1.6 2 1.1.9 2 1.2 2.3 1.4.3.1.5.1.6-.1l.9-1c.2-.3.4-.2.6-.1.3.1 1.6.8 1.9.9.3.1.5.2.5.3.1.2.1.7-.1 1.4z"/>',
  instagram: '<rect x="3" y="3" width="18" height="18" rx="5.2" fill="none" stroke="currentColor" stroke-width="2"/>' +
    '<circle cx="12" cy="12" r="4.1" fill="none" stroke="currentColor" stroke-width="2"/>' +
    '<circle cx="17.3" cy="6.8" r="1.35"/>',
  messenger: '<path d="M12 2C6.3 2 2 6.2 2 11.7c0 3.1 1.4 5.9 3.6 7.7v3.4l3.4-1.9c.9.3 1.9.4 3 .4 5.7 0 10-4.2 10-9.6S17.7 2 12 2zm1 12.4-2.6-2.7-4.9 2.7 5.4-5.7 2.6 2.7 4.9-2.7-5.4 5.7z"/>',
  viber: '<path d="M12 2.6c-5 0-9 3.3-9 7.5 0 2.3 1.2 4.4 3.1 5.7v3.6l3.2-2.1c.9.2 1.8.3 2.7.3 5 0 9-3.3 9-7.5s-4-7.5-9-7.5z" fill="none" stroke="currentColor" stroke-width="1.9"/>' +
    '<path d="M9.8 7.4c.3-.2.6-.1.8.1l.8 1.1c.2.3.1.6-.2.8l-.5.3c.3.8.9 1.4 1.7 1.7l.3-.5c.2-.3.5-.4.8-.2l1.1.8c.3.2.3.5.1.8-.4.5-1 .9-1.6.9-2.3 0-4.2-1.9-4.2-4.2 0-.6.3-1.2.9-1.6z"/>',
  email: '<rect x="2.6" y="4.6" width="18.8" height="14.8" rx="3.2" fill="none" stroke="currentColor" stroke-width="1.9"/>' +
    '<path d="M4.2 8 12 13.1 19.8 8" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  webchat: '<path d="M4.6 3.4h14.8c1.4 0 2.6 1.2 2.6 2.6v8.4c0 1.4-1.2 2.6-2.6 2.6H10l-5 3.6V17h-.4C3.2 17 2 15.8 2 14.4V6c0-1.4 1.2-2.6 2.6-2.6z"/>',
  custom: '<path d="M9.2 6.6 3.8 12l5.4 5.4M14.8 6.6 20.2 12l-5.4 5.4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'
};

/* Комментарии рисуются значком той же сети: это та же страница, и
   человек ищет глазами Facebook, а не отдельный знак для комментариев.
   Чем они отличаются, сказано словами в строке — значком такое не
   передать. */
var ICON_OF = { telegram_bot:'telegram', telegram_user:'telegram', telegram_business:'telegram',
  whatsapp:'whatsapp', whatsapp_cloud:'whatsapp', whatsapp_user:'whatsapp',
  instagram:'instagram', instagram_comments:'instagram',
  messenger:'messenger', messenger_comments:'messenger',
  viber_business:'viber', viber_user:'viber',
  email:'email', webchat:'webchat', custom:'custom' };

function chIcon(type){
  var g = ICON_SVG[ICON_OF[type] || ''] || ICON_SVG.custom;
  return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' + g + '</svg>';
}

/* Значок сети поверх аватарки. Подложка красится теми же правилами,
   что и плитка канала: одна сеть — один цвет во всём продукте. */
function chBadge(type){
  return '<span class="chico sm ' + esc(type || 'custom') + '" title="' +
    esc(CH[type] || type || '') + '">' + chIcon(type) + '</span>';
}

/* Ключи своего канала. Показываются при подключении и потом на странице
   канала: это наши собственные секреты, а не чужой платформы, и прятать
   их от владельца значит заставлять пересоздавать канал при потере. */
function cuKeys(d){
  var box = document.createElement('div');
  box.className = 'cuwrap';
  box.innerHTML =
    '<div class="cubox">' +
    L('<h3>Власний канал підключено</h3>') +
    L('<div class="sub" style="white-space:normal">Ці три рядки потрібні вашому боту. ') +
    L('Ключ і секрет можна подивитися пізніше на сторінці каналу.</div>') +
    L('<div class="lbl" style="margin-top:12px">Куди бот надсилає вхідні</div>') +
    '<pre class="snip">' + esc(d.inUrl || (location.origin + '/channels/custom/messages')) + '</pre>' +
    L('<div class="lbl">Ключ каналу (заголовок Authorization: Bearer)</div>') +
    '<pre class="snip">' + esc(d.key) + '</pre>' +
    L('<div class="lbl">Секрет підпису наших вихідних (заголовок x-rozmovio-signature)</div>') +
    '<pre class="snip">' + esc(d.secret) + '</pre>' +
    L('<div class="acts"><button id="cuClose">Готово</button>') +
    L('<a class="ghost mini" href="/docs" target="_blank" rel="noopener">Документація</a></div>') +
    '</div>';
  document.body.appendChild(box);
  el('cuClose').onclick = function(){ box.remove() };
}

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
        '<div class="t1"><div class="chico ' + esc(c.type) + '">' + chIcon(c.type) + '</div>' +
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
      '<div class="tile"><div class="t1"><div class="chico telegram_bot">' + chIcon('telegram_bot') + '</div>' +
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

      '<div class="tile"><div class="t1"><div class="chico email">' + chIcon('email') + '</div>' +
      L('<div><div class="ttl">Пошта</div><div class="sub">Наявна скринька або свій піддомен</div></div></div>') +
      '<div class="seg" style="margin-top:8px">' +
      L('<button data-mlmode="box" class="on">Наявна скринька</button>') +
      L('<button data-mlmode="dom">Свій піддомен</button>') + '</div>' +

      /* Ящик, который уже есть. Стоит первым: у компании давно есть
         info@, и просить клиентов писать на новый адрес — значит
         просить их переучиться. */
      '<div id="mbBox">' +
      L('<div class="sub" style="white-space:normal;margin-top:8px">Листи читаються з вашої ') +
      L('скриньки, відповіді йдуть з неї ж. DNS чіпати не треба.</div>') +
      '<div class="row2" style="margin-top:8px">' +
      L('<input id="mbAddr" placeholder="info@firma.com" autocomplete="off">') +
      L('<input id="mbPass" type="password" placeholder="пароль скриньки" autocomplete="off">') +
      '</div>' +
      '<div class="hint" id="mbNote" style="margin-top:6px"></div>' +
      L('<button class="ghost mini" id="mbMore" style="margin-top:7px">Сервери вручну</button>') +
      '<div id="mbHosts" style="display:none;margin-top:7px">' +
      '<div class="row2">' +
      L('<input id="mbIH" placeholder="imap.firma.com">') +
      L('<input id="mbIP" placeholder="993" style="max-width:90px">') + '</div>' +
      '<div class="row2" style="margin-top:6px">' +
      L('<input id="mbSH" placeholder="smtp.firma.com">') +
      L('<input id="mbSP" placeholder="465" style="max-width:90px">') + '</div>' +
      L('<input id="mbUser" placeholder="логін, якщо не збігається з адресою" style="margin-top:6px">') +
      '</div>' +
      L('<div class="acts"><button id="mbAdd">Підключити скриньку</button></div>') +
      '<div class="err" id="mbErr"></div></div>' +

      '<div id="mlDomBox" style="display:none">' +
      L('<div class="sub" style="white-space:normal;margin-top:8px">Заведіть піддомен для звернень — help.firma.com. ') +
      L('Основний домен не підійде: у нього один запис MX, і переказавши його нам, ') +
      L('ви залишите без пошти співробітників.</div>') +
      '<div class="row2" style="margin-top:8px">' +
      L('<input id="mlLoc" placeholder="support" style="max-width:120px">') +
      L('<input id="mlDom" placeholder="help.firma.com">') +
      L('<button id="mlAdd">Підключити</button></div>') +
      '<div class="err" id="mlcErr"></div></div>' +
      '</div>' +

      '<div class="tile" id="metaCard"><div class="t1"><div class="chico instagram">' + chIcon('instagram') + '</div>' +
      L('<div><div class="ttl">Instagram і Messenger</div><div class="sub">Через сторінку Facebook</div></div></div>') +
      L('<div id="metaBody"><div class="sub" style="white-space:normal">Увійдіть під акаунтом, який керує ') +
      L('сторінкою. Instagram має бути професійним акаунтом і привʼязаний до цієї сторінки.</div>') +
      L('<div class="acts"><button id="metaGo">Увійти через Facebook</button></div>') +
      '<div class="err" id="metaErr"></div></div></div>' +

      '<div class="tile"><div class="t1"><div class="chico telegram_user">' + chIcon('telegram_user') + '</div>' +
      L('<div><div class="ttl">Telegram за номером</div><div class="sub">Особистий або робочий акаунт</div></div></div>') +
      L('<div class="sub" style="white-space:normal">Клієнти пишуть на ваш номер як завжди, листування зʼявляється тут, ') +
      L('відповіді йдуть від вашого імені.</div>') +
      L('<div class="row2"><input id="uname" placeholder="Назва, наприклад: Продажі" autocomplete="off">') +
      L('<button id="uqr">Показати QR-код</button></div><div id="uqrbox"></div></div>') +

      '<div class="tile"><div class="t1"><div class="chico viber_business">' + chIcon('viber_business') + '</div>' +
      L('<div><div class="ttl">Viber для бізнесу</div><div class="sub">Імʼя відправника замість номера</div></div></div>') +
      L('<div class="sub" style="white-space:normal">Клієнти пишуть у Viber на назву вашої компанії, ') +
      L('листування зʼявляється тут. Підключення — через офіційного партнера <b>TurboSMS</b>.</div>') +
      L('<div class="hint">Ключ API і погоджене імʼя відправника — у кабінеті партнера, розділ Viber. ') +
      L('Відповідати можна добу після повідомлення клієнта: далі Viber закриває сесію.</div>') +
      '<div class="row2"><input id="vbToken" type="password" placeholder="API key" autocomplete="off">' +
      L('<input id="vbSender" placeholder="Імʼя відправника"></div>') +
      L('<div class="acts"><button id="vbGo">Підключити</button></div>') +
      '<div class="err" id="vbErr"></div></div>' +

      '<div class="tile"><div class="t1"><div class="chico webchat">' + chIcon('webchat') + '</div>' +
      L('<div><div class="ttl">Чат на сайті</div><div class="sub">Кнопка на ваших сторінках</div></div></div>') +
      L('<div class="sub" style="white-space:normal">Створюється за секунду: ми даємо один рядок коду, ') +
      L('ви вставляєте його на сайт. Переписка живе на нашому домені, тож чужі скрипти її не бачать.</div>') +
      L('<div class="acts"><button id="wcGo">Створити віджет</button></div>') +
      '<div class="err" id="wcErr"></div></div>' +

      '<div class="tile"><div class="t1"><div class="chico whatsapp">' + chIcon('whatsapp') + '</div>' +
      L('<div><div class="ttl">WhatsApp Business</div><div class="sub">Номер компанії через Cloud API</div></div></div>') +
      L('<div class="sub" style="white-space:normal">Потрібні токен і <b>Phone number ID</b> з кабінету ') +
      L('Meta for Developers: розділ WhatsApp → API Setup. Там же вкажіть адресу вебхука ') +
      L('(вона у розділі «Інтеграції»).</div>') +
      '<div class="row2"><input id="waTok" type="password" placeholder="EAAG..." autocomplete="off">' +
      '<input id="waNum" placeholder="Phone number ID" autocomplete="off"></div>' +
      '<div class="row2"><input id="waWaba" placeholder="' +
        L('ID акаунта WhatsApp: asset_id з адреси WhatsApp Manager') + '" autocomplete="off"></div>' +
      L('<div class="acts"><button id="waGo">Підключити</button></div>') +
      L('<div class="hint">Поза вікном 24 годин WhatsApp дозволяє лише погоджені шаблони — ') +
      L('вони підтягнуться з вашого акаунта самі.</div>') +
      '<div class="err" id="waErr"></div></div>' +

      '<div class="tile"><div class="t1"><div class="chico custom">' + chIcon('custom') + '</div>' +
      L('<div><div class="ttl">Власний канал</div><div class="sub">Ваш бот або будь-який інший код</div></div></div>') +
      L('<div class="sub" style="white-space:normal">Якщо у вас уже є свій бот Telegram чи Viber ') +
      L('зі сценаріями — не віддавайте нам його вебхук, він у бота один. Замість цього бот надсилає ') +
      L('нам вхідні, а ми надсилаємо йому відповіді оператора. Сценарії працюють як працювали.</div>') +
      '<div class="row2"><input id="cuName" placeholder="' + L('Назва каналу') + '" maxlength="80">' +
      '<input id="cuUrl" placeholder="https://..." autocomplete="off"></div>' +
      L('<div class="hint">Адреса, на яку ми надсилатимемо відповіді оператора.</div>') +
      L('<div class="acts"><button id="cuGo">Підключити</button></div>') +
      '<div class="err" id="cuErr"></div></div>' +

      ['whatsapp_user','viber_user'].map(function(t){
        return '<div class="tile"><div class="t1"><div class="chico soon">' + chIcon(t) + '</div>' +
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
        token: el('waTok').value.trim(), phoneNumberId: el('waNum').value.trim(),
        wabaId: el('waWaba').value.trim()
      }})
        .then(function(d){
          /* Номер подключён, но аккаунт не подписан на приложение —
             отправка будет работать, а входящие не придут никогда.
             Молчать об этом нельзя: снаружи это выглядит как «канал
             работает», и причину потом ищут неделю. */
          if (d && d.subscribeError){
            /* Отдельный текст для случая, когда аккаунт просто не
               нашёлся: человеку нужно не «проверьте доступ», а ровно
               одно действие — вписать идентификатор в третье поле. */
            el('waErr').textContent = d.subscribeError === 'no_waba'
              ? L('Не вдалося визначити акаунт WhatsApp Business автоматично. Відкрийте WhatsApp Manager → Огляд акаунта, скопіюйте «Ідентифікатор акаунта WhatsApp Business» у третє поле і натисніть «Підключити» ще раз. Без цього вхідні не надходитимуть.')
              : L('Номер підключено, але акаунт WhatsApp не підписався на застосунок: вхідні не надходитимуть. Перевірте, що системному користувачу видано доступ до акаунта WhatsApp Business, і натисніть «Підключити» ще раз.') +
                ' [' + d.subscribeError + ']';
            busy(el('waGo'), false);
            return;
          }
          toast(L('WhatsApp підключено'));
          tabChannels();
        })
        .catch(function(e){
          el('waErr').textContent = ((e.payload||{}).detail) || L('Не вдалося підключити');
          busy(el('waGo'), false);
        });
    };

    if (el('cuGo')) el('cuGo').onclick = function(){
      el('cuErr').textContent = '';
      busy(el('cuGo'), true);
      api('/settings/channels/custom', { method:'POST', body:{
        displayName: el('cuName').value.trim(), outUrl: el('cuUrl').value.trim()
      }})
        .then(function(d){
          /* Ключ и секрет показываем сразу и целиком: без них канал
             бесполезен, а идти за ними второй раз человеку некуда —
             он ещё не знает, что они где-то есть. */
          toast(L('Власний канал підключено'));
          cuKeys(d);
          tabChannels();
        })
        .catch(function(e){
          el('cuErr').textContent = ((e.payload||{}).detail) || L('Не вдалося підключити');
          busy(el('cuGo'), false);
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
    if (el('mlAdd')) el('mlAdd').onclick = mlConnect;
    wireMailbox();
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

/* ── Кто работает с каналом ───────────────────────────────────────
   Две настройки рядом намеренно: «кто видит» и «кому достаётся». По
   отдельности они выглядят как разные разделы, а на деле это один
   вопрос — кто ведёт этот канал. */

var TEAM = { id:null, data:null };

function chTeamPanel(id){
  api('/channels/' + id + '/team').then(function(d){
    TEAM.id = id;
    TEAM.data = d;
    var r = d.routing || {};
    var people = d.users || [];

    var rows = people.map(function(u){
      return '<label class="tmrow">' +
        '<input type="checkbox" data-usr="' + u.id + '"' +
          (u.sees ? ' checked' : '') + (u.unrestricted ? ' disabled' : '') + '>' +
        '<span>' + esc(u.name) + '</span>' +
        '<span class="tmrole">' + esc(ROLES[u.role] || u.role) + '</span>' +
        (u.unrestricted ? L('<span class="tmnote">бачить усі канали за роллю</span>') : '') +
        '</label>';
    }).join('');

    var pick = people.filter(function(u){ return u.role !== 'viewer' }).map(function(u){
      return '<option value="' + u.id + '"' + (r.userId === u.id ? ' selected' : '') + '>' +
        esc(u.name) + '</option>';
    }).join('');

    el('chTeam').innerHTML =
      L('<div class="pg-sec"><h3>Хто працює з каналом</h3><div class="tile">') +
      L('<div class="sub" style="white-space:normal">Знята позначка ховає канал від людини: ') +
      L('вона не бачить ні діалогів, ні повідомлень із нього.</div>') +
      '<div class="tmlist">' + rows + '</div>' +

      L('<div class="row2" style="margin-top:12px"><div class="lbl" style="width:180px">Нові діалоги</div>') +
      '<select id="chRoute" style="max-width:280px">' +
      '<option value="none"' + (r.mode === 'none' ? ' selected' : '') + '>' +
        L('нікому: беруть вручну') + '</option>' +
      '<option value="round_robin"' + (r.mode === 'round_robin' ? ' selected' : '') + '>' +
        L('по черзі між операторами') + '</option>' +
      '<option value="user"' + (r.mode === 'user' ? ' selected' : '') + '>' +
        L('завжди одній людині') + '</option>' +
      '</select></div>' +

      '<div class="row2" id="chWhoRow" style="display:' + (r.mode === 'user' ? '' : 'none') + '">' +
      L('<div class="lbl" style="width:180px">Кому саме</div>') +
      '<select id="chWho" style="max-width:280px">' + pick + '</select></div>' +

      L('<div class="hint">По черзі — між тими, кому канал видно, у порядку імен. ') +
      L('Уже взятий діалог не перепризначається.</div>') +
      L('<div class="acts"><button id="chTeamSave">Зберегти</button></div>') +
      '<div class="ok" id="chTeamOk"></div></div></div>';

    el('chRoute').onchange = function(){
      el('chWhoRow').style.display = this.value === 'user' ? '' : 'none';
    };

    el('chTeamSave').onclick = function(){
      busy(el('chTeamSave'), true);
      var ids = [];
      Array.prototype.forEach.call(document.querySelectorAll('[data-usr]'), function(x){
        if (x.checked && !x.disabled) ids.push(x.dataset.usr);
      });
      api('/channels/' + id + '/team', { method:'PUT', body:{
        userIds: ids,
        routing: { mode: el('chRoute').value, userId: el('chWho') ? el('chWho').value : null }
      }})
        .then(function(){ el('chTeamOk').textContent = L('Збережено') })
        .catch(function(){ el('chTeamOk').textContent = L('Не вдалося зберегти') })
        .then(function(){ busy(el('chTeamSave'), false) });
    };
  }).catch(function(){});
}


function wcPanel(id){
  api('/channels/' + id + '/webchat').then(function(d){
    WC.id = id;
    WC.key = d.siteKey;
    WC.st = d.settings || {};

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

      L('<div class="pg-sec"><h3>Вигляд</h3><div class="wcedit">') +

      '<div class="tile">' +
      L('<div class="row2"><div class="lbl" style="width:140px">Логотип</div>') +
      '<div class="wclogo"><img id="wcLogoImg" alt="" style="display:' +
        (WC.st.logo ? 'block' : 'none') + '" src="' + esc(WC.st.logo || '') + '">' +
      L('<button class="ghost mini" id="wcLogoPick">Завантажити</button>') +
      L('<button class="ghost mini" id="wcLogoDel">Прибрати</button>') +
      '<input type="file" id="wcLogoFile" accept="image/*" style="display:none"></div></div>' +
      L('<div class="hint">Квадратна картинка, ми самі зменшимо її до 128 точок.</div>') +

      L('<div class="row2"><div class="lbl" style="width:140px">Заголовок</div>') +
      '<input id="wcTitle" maxlength="60" value="' + esc(WC.st.title || '') + '"></div>' +
      L('<div class="row2"><div class="lbl" style="width:140px">Підпис</div>') +
      '<input id="wcSub" maxlength="120" placeholder="' + L('Відповідаємо протягом 15 хвилин') +
        '" value="' + esc(WC.st.subtitle || '') + '"></div>' +
      L('<div class="row2"><div class="lbl" style="width:140px">Привітання</div>') +
      '<input id="wcGreet" maxlength="300" value="' + esc(WC.st.greeting || '') + '"></div>' +
      L('<div class="row2"><div class="lbl" style="width:140px">Колір</div>') +
      '<input id="wcColor" type="color" value="' + esc(WC.st.color || '#2F6BFF') +
        '" style="max-width:70px">' +
      '<select id="wcPos" style="max-width:190px">' +
      '<option value="right"' + (WC.st.position !== 'left' ? ' selected' : '') + '>' +
        L('кнопка праворуч') + '</option>' +
      '<option value="left"' + (WC.st.position === 'left' ? ' selected' : '') + '>' +
        L('кнопка ліворуч') + '</option></select></div>' +

      L('<div class="row2"><div class="lbl" style="width:140px">Колір кнопки</div>') +
      '<input id="wcLnc" type="color" value="' +
        esc(WC.st.launcher || WC.st.color || '#2F6BFF') + '" style="max-width:70px">' +
      '<label class="ntev"><input type="checkbox" id="wcLncSame"' +
        (WC.st.launcher ? '' : ' checked') + '> ' + L('такий самий, як у чата') + '</label></div>' +
      L('<div class="hint">На темній сторінці фірмовий колір зливається з фоном, і кнопку ') +
      L('доводиться робити помітною, а не «правильною».</div>') +

      L('<div class="row2"><div class="lbl" style="width:140px">Поява</div>') +
      '<select id="wcAnim" style="max-width:220px">' + wcOpts(ANIMS, WC.st.anim || 'fade') +
      '</select></div>' +

      L('<div class="row2"><div class="lbl" style="width:140px">Показувати</div>') +
      '<select id="wcShow" style="max-width:240px">' +
        wcOpts(SHOWS, WC.st.showMode || 'now') + '</select>' +
      '<input id="wcAfter" type="number" min="1" max="600" style="max-width:90px" value="' +
        esc(String(WC.st.showAfter || '')) + '">' +
      '<span class="lbl" id="wcAfterU"></span></div>' +
      L('<div class="hint">Кнопка одразу — це звично. Через кілька секунд або після прокручування ') +
      L('вона потрапляє на очі тому, хто вже читає, а не тому, хто зараз піде.</div>') +

      L('<div class="acts"><button id="wcSave">Зберегти</button></div>') +
      '<div class="ok" id="wcOk2"></div></div>' +

      /* Превью — не украшение: подобрать цвет и длину подписи иначе
         можно только так — сохранить, открыть сайт, вернуться. */
      '<div class="wcprev"><div class="wcphone"><iframe id="wcFrameView" title="preview"></iframe></div>' +
      L('<div class="hint" style="text-align:center">Так чат побачить відвідувач</div>') +
      '<div class="wcdemo"><button class="wcbtn" id="wcBtnDemo">' + ICON_WCBTN + '</button></div>' +
      L('<div class="hint" style="text-align:center">Згорнута кнопка. Натисніть, щоб побачити появу ') +
      L('ще раз</div></div>') +

      '</div></div>' +

      L('<div class="pg-sec"><h3>Де працює</h3><div class="tile">') +
      L('<div class="row2"><div class="lbl" style="width:140px">Дозволені домени</div>') +
      '<input id="wcDom" placeholder="example.com, shop.example.com" value="' +
        esc((WC.st.domains || []).join(', ')) + '"></div>' +
      L('<div class="hint">Порожньо — віджет працює будь-де. Список доменів рятує від забутого ') +
      L('віджета на тестовому сайті, але це не захист: адресу сторінки повідомляє браузер.</div>') +
      L('<div class="acts"><button id="wcSaveDom">Зберегти</button></div>') +
      '<div class="ok" id="wcOk3"></div></div></div>';

    el('wcCopy').onclick = function(){ wcCopy(d.snippet, 'wcOk') };
    el('wcCopy2').onclick = function(){ wcCopy(d.iframe, 'wcOk') };
    el('wcOpen').onclick = function(){ window.open('/chat/' + d.siteKey, '_blank', 'noopener') };

    el('wcLogoPick').onclick = function(){ el('wcLogoFile').click() };
    el('wcLogoFile').onchange = function(){ wcLogoLoad(this.files && this.files[0]) };
    el('wcLogoDel').onclick = function(){
      WC.st.logo = '';
      el('wcLogoImg').style.display = 'none';
      wcPreview();
    };

    ['wcTitle','wcSub','wcGreet'].forEach(function(f){ el(f).oninput = wcPreview });
    el('wcColor').oninput = function(){ wcPreview(); wcDemo() };
    el('wcPos').onchange = wcPreview;

    el('wcLnc').oninput = function(){ el('wcLncSame').checked = false; wcDemo() };
    el('wcLncSame').onchange = wcDemo;
    el('wcAnim').onchange = wcDemo;
    el('wcBtnDemo').onclick = wcDemo;
    el('wcShow').onchange = wcAfterUnits;
    wcAfterUnits();
    wcDemo();

    el('wcSave').onclick = function(){ wcSave('wcOk2') };
    el('wcSaveDom').onclick = function(){ wcSave('wcOk3') };

    wcPreview();
  }).catch(function(){
    el('wcBox').innerHTML = L('<div class="pg-sec"><div class="empty">Не вдалося завантажити код віджета.</div></div>');
  });
}

var WC = { id:null, key:null, st:{}, timer:null };

var ICON_WCBTN = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" ' +
  'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-3.9-.9L3 21l1.9-4.6a8.4 8.4 0 0 1-.9-3.9 ' +
  '8.4 8.4 0 0 1 8.4-8.4h.6a8.4 8.4 0 0 1 8 8z"/></svg>';

var ANIMS = [
  ['none', 'Без анімації'],
  ['fade', 'Плавна поява'],
  ['slide', 'Виїзд знизу'],
  ['pulse', 'Поява з пульсацією']
];
var SHOWS = [
  ['now', 'Одразу'],
  ['delay', 'Через n секунд'],
  ['scroll', 'Після прокручування сторінки']
];

function wcOpts(list, cur){
  var out = '';
  for (var i = 0; i < list.length; i++){
    out += '<option value="' + list[i][0] + '"' + (list[i][0] === cur ? ' selected' : '') + '>' +
      L(list[i][1]) + '</option>';
  }
  return out;
}

/* Поле «через сколько» меняет смысл вместе с выбором рядом: секунды или
   проценты прокрутки. Без подписи это просто число неизвестно чего. */
function wcAfterUnits(){
  var mode = el('wcShow').value;
  var box = el('wcAfter');
  var unit = el('wcAfterU');
  box.style.display = mode === 'now' ? 'none' : '';
  unit.textContent = mode === 'delay' ? L('секунд') : (mode === 'scroll' ? L('% сторінки') : '');
  if (mode === 'delay'){ box.max = 600; if (!box.value) box.value = 5 }
  if (mode === 'scroll'){ box.max = 100; if (!box.value || box.value > 100) box.value = 30 }
}

/* Кнопку показываем настоящую: тот же круг, тот же значок, та же
   анимация. Подобрать появление, глядя на название в списке, нельзя. */
function wcDemo(){
  var b = el('wcBtnDemo');
  if (!b) return;
  b.style.background = wcLauncher();
  b.className = 'wcbtn';
  // Перезапуск анимации: без чтения offsetWidth браузер не замечает,
  // что класс сняли и вернули в том же кадре.
  void b.offsetWidth;
  var a = el('wcAnim').value;
  if (a !== 'none') b.className = 'wcbtn ' + a;
}

function wcLauncher(){
  return el('wcLncSame').checked ? el('wcColor').value : el('wcLnc').value;
}

/* Картинку ужимаем в браузере, а не на сервере. Причина простая: логотип
   лежит прямо в настройках, и лишние сотни килобайт поедут потом в
   каждую страницу с виджетом. */
function wcLogoLoad(file){
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(){
    var img = new Image();
    img.onload = function(){
      var size = 128;
      var c = document.createElement('canvas');
      c.width = size; c.height = size;
      var g = c.getContext('2d');
      // Вписываем целиком, не обрезая: логотип с отрезанным краем —
      // это претензия от клиента, а не мелочь.
      var k = Math.min(size / img.width, size / img.height);
      var w = img.width * k, h = img.height * k;
      g.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      WC.st.logo = c.toDataURL('image/png');
      el('wcLogoImg').src = WC.st.logo;
      el('wcLogoImg').style.display = 'block';
      wcPreview();
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

/* Черновик настроек уходит в адрес превью. Логотип туда не помещается —
   он приезжает сообщением уже после загрузки страницы. */
function wcPreview(){
  clearTimeout(WC.timer);
  WC.timer = setTimeout(function(){
    var f = el('wcFrameView');
    if (!f) return;
    var q = '?preview=1&inline=1' +
      '&title=' + encodeURIComponent(el('wcTitle').value) +
      '&subtitle=' + encodeURIComponent(el('wcSub').value) +
      '&greeting=' + encodeURIComponent(el('wcGreet').value) +
      '&color=' + encodeURIComponent(el('wcColor').value) +
      '&logo=' + encodeURIComponent(WC.st.logo || '') +
      '&v=' + Date.now();
    f.src = '/chat/' + WC.key + q;
  }, 250);
}

function wcSave(okId){
  var btn = okId === 'wcOk3' ? el('wcSaveDom') : el('wcSave');
  busy(btn, true);
  api('/channels/' + WC.id + '/webchat', { method:'PATCH', body:{
    title: el('wcTitle').value.trim(),
    subtitle: el('wcSub').value.trim(),
    greeting: el('wcGreet').value.trim(),
    color: el('wcColor').value,
    logo: WC.st.logo || '',
    position: el('wcPos').value,
    launcher: el('wcLncSame').checked ? '' : el('wcLnc').value,
    anim: el('wcAnim').value,
    showMode: el('wcShow').value,
    showAfter: Number(el('wcAfter').value) || 0,
    domains: el('wcDom').value
  }})
    .then(function(){
      el(okId).textContent = L('Збережено');
      return api('/channels').then(function(r){ CHANNELS = r.channels || [] });
    })
    .then(function(){ return api('/channels/' + WC.id + '/webchat') })
    .then(function(d){ el('wcSnip').textContent = d.snippet })
    .catch(function(e){ el(okId).textContent = ((e.payload||{}).detail) || L('Не вдалося зберегти') })
    .then(function(){ busy(btn, false) });
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
    (c.type === 'email' ? '<div id="mlBox"></div>' : '') +
    '<div id="chTeam"></div>' +

    L('<div class="pg-sec"><h3>Автоматизація</h3><div class="grid">') +
    '<div class="tile click" id="chFlows"><div class="t1"><div class="chico soon">⚡</div>' +
    L('<div><div class="ttl">Сценарії цього каналу</div>') +
    L('<div class="sub">Привітання, автовідповіді, ланцюжки</div></div></div>') +
    L('<div class="sub" style="white-space:normal">Правила і ланцюжки, які спрацьовують на повідомлення ') +
    L('саме в цьому каналі.</div>') +
    L('<div class="acts"><button class="ghost mini">Відкрити сценарії</button></div></div>') +
    '</div></div></div>';

  if (c.type === 'webchat') wcPanel(id);
  if (c.type === 'email') mlPanel(id, c);
  if (isAdmin()) chTeamPanel(id);

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
    var cset = (res[2] && res[2].settings) || {};
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
              '<div class="int-s">' + esc(z.api_domain || '') + ' · id ' + esc(z.zgid) + '</div>' +
              /* Прав не хватает. Подключение при этом рабочее, и «активно»
                 напротив него — правда, из-за которой человек ищет причину
                 где угодно, кроме этого места. */
              (z.stale
                ? L('<div class="int-s" style="white-space:normal;color:var(--warn)">Ця організація ') +
                  L('підключена до появи товарів і замовлень: Zoho видала менше прав, ніж треба. ') +
                  L('Натисніть «Увійти через Zoho» тим самим акаунтом — права оновляться.</div>')
                : '') +
              '</div>' +
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

      /* Поведение связки. Стоит под самими подключениями, а не в
         настройках: решение принимают, когда видят, куда именно
         поедут карточки. */
      L('<div class="pg-sec"><h3>Що робити з новим клієнтом</h3><div class="card">') +
      '<div class="acts" style="margin-top:0">' +
      '<select id="crmAs" style="max-width:260px">' +
      '<option value="lead"' + (cset.createAs === 'contact' ? '' : ' selected') + '>' +
        L('Заводити лід') + '</option>' +
      '<option value="contact"' + (cset.createAs === 'contact' ? ' selected' : '') + '>' +
        L('Заводити одразу контакт') + '</option></select>' +
      '<label class="ntev"><input type="checkbox" id="crmOwn"' +
        (cset.ownerByEmail ? ' checked' : '') + '> ' +
        L('Ставити відповідальним того, хто взяв чат') + '</label>' +
      L('<button id="crmSave">Зберегти</button></div>') +
      L('<div class="hint">Лід проходить кваліфікацію і стає угодою — так працює відділ продажів. ') +
      L('Там, де пишуть ті, хто вже купує, лід зайвий: картку все одно конвертують руками.<br>') +
      L('Відповідальний шукається за поштою: у CRM імена пишуть як заманеться, а пошта одна. ') +
      L('Немає співробітника з такою поштою — нічого не змінюємо і нікого не заводимо.</div>') +
      '<div class="err" id="crmSetErr"></div></div></div>' +

      /* Куда уезжает заказ. Стоит рядом с «что делать с новым
         клиентом»: это второе решение про ту же связку, и принимают
         их в один заход. */
      (list.length
        ? L('<div class="pg-sec"><h3>Замовлення з розмови</h3><div class="card">') +
          '<div id="osBox"></div></div></div>'
        : '') +

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

    el('crmSave').onclick = function(){
      el('crmSetErr').textContent = '';
      busy(el('crmSave'), true);
      api('/settings/crm-behaviour', { method:'PATCH', body:{
        createAs: el('crmAs').value, ownerByEmail: el('crmOwn').checked
      }}).then(function(){ toast(L('Збережено')); pageIntegrations() })
        .catch(function(e){
          var p = e.payload || {};
          el('crmSetErr').textContent = p.detail || L('Не вдалося зберегти');
          busy(el('crmSave'), false);
        });
    };

    wireAi(ai);

    if (list.length) osLoad().catch(function(e){
      if (el('osBox')) el('osBox').innerHTML = '<div class="err">' + esc(ordWhy(e)) + '</div>';
    });

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
          /* Комментарии по умолчанию не отмечены: это отдельная лента и
             отдельная работа, и включать её молча за человека незачем. */
          '<div style="margin-top:4px">' +
          L('<label><input type="checkbox" data-mp="') + esc(p.id) +
            L('" data-k="messengerComments"> Коментарі під постами</label>') +
          (p.instagram
            ? L(' &nbsp; <label><input type="checkbox" data-mp="') + esc(p.id) +
              L('" data-k="instagramComments"> Коментарі в Instagram</label>')
            : '') +
          '</div>' +
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
          (u.role === 'owner' ? '' :
            '<button class="ghost mini" data-user="' + u.id + '" data-active="' +
            (u.is_active ? 'false' : 'true') + '">' +
            (u.is_active ? L('Відключити') : L('Увімкнути')) + '</button>') +
          '</div></div>';
      }).join('') + '</div>' +
      '<div id="mtx"></div>';

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

    Array.prototype.forEach.call(pageBox().querySelectorAll('[data-user]'), function(b){
      b.onclick = function(){
        busy(b, true);
        api('/users/' + b.dataset.user, { method:'PATCH',
          body:{ isActive: b.dataset.active === 'true' } })
          .then(tabUsers).catch(function(){ busy(b, false) });
      };
    });
    loadAccess();
  }).catch(sErr);
}

/* ══════════════ Доступи ══════════════

   Кто какой канал видит и какими папками шаблонов пользуется — это
   пересечение людей и вещей, а не свойство человека. Раздавать его по
   одной карточке значит открывать десять карточек, чтобы ответить на
   вопрос «кто вообще видит Instagram».

   Пустой список у человека означает «всё», и это главная ловушка
   таблицы: пустая строка читается как «ничего не видит». Поэтому у
   такого человека галочки стоят все, но бледные, а в первом столбце
   написано «усі». Снять одну из бледных — значит сказать «все, кроме
   этой», и строка становится обычной.

   Обратно: отметили всё до единой — снова отправляем пустой список, а
   не полный. Разница видна не сегодня, а в тот день, когда подключат
   новый канал: «усі» получит его сам, а перечисленный поимённо — нет. */

var ACC = null;

function loadAccess(){
  return api('/access').then(function(d){ ACC = d; renderAccess() }).catch(function(){});
}

function accSet(kind, userId){
  return (kind === 'channel' ? ACC.channelIds : ACC.folderIds)[userId] || [];
}

function accItems(kind){
  return kind === 'channel' ? ACC.channels : ACC.folders;
}

function accTable(kind, title, hint, empty){
  var items = accItems(kind);
  if (!items.length) return L('<div class="pg-sec"><h3>') + esc(title) + '</h3>' +
    '<div class="card"><div class="hint">' + esc(empty) + '</div></div></div>';

  var rows = ACC.users.map(function(u){
    var picked = accSet(kind, u.id), all = u.unrestricted || !picked.length;
    return '<tr data-u="' + u.id + '">' +
      '<td><div class="who"><b>' + esc(u.name) + '</b>' +
      '<span class="pill">' + esc(u.unrestricted ? L('за роллю') : all ? L('усі') :
        picked.length + L(' з ') + items.length) + '</span></div></td>' +
      items.map(function(it){
        return '<td><input type="checkbox" data-k="' + kind + '" data-i="' + it.id + '"' +
          (all ? ' checked class="all"' : (picked.indexOf(it.id) >= 0 ? ' checked' : '')) +
          (u.unrestricted ? ' disabled' : '') + '></td>';
      }).join('') + '</tr>';
  }).join('');

  return L('<div class="pg-sec"><h3>') + esc(title) + '</h3><div class="card">' +
    '<div class="hint">' + esc(hint) + '</div>' +
    '<div class="mtxwrap"><table class="mtx"><thead><tr><th></th>' +
    items.map(function(it){ return '<th>' + esc(it.name) + '</th>' }).join('') +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
    '<div class="err" id="mtxerr-' + kind + '"></div></div></div>';
}

function renderAccess(){
  var box = el('mtx');
  if (!box || !ACC) return;

  box.innerHTML =
    accTable('channel', L('Доступ до каналів'),
      L('Порожній рядок неможливий: хто не обмежений — бачить усі канали, і галочки в нього бліді. Зніміть одну — і людина бачитиме решту.'),
      L('Каналів поки немає — спершу підключіть хоча б один.')) +
    accTable('folder', L('Доступ до папок шаблонів'),
      L('Шаблони поза папками доступні всім: «без папки» — це не папка, давати чи забирати там нічого.'),
      L('Папок поки немає — створіть їх у розділі «Шаблони».'));

  Array.prototype.forEach.call(box.querySelectorAll('input[data-i]'), function(inp){
    inp.onchange = function(){
      var tr = inp.parentNode.parentNode, kind = inp.dataset.k;
      var items = accItems(kind), userId = tr.dataset.u;
      var picked = [];
      Array.prototype.forEach.call(tr.querySelectorAll('input[data-i]'), function(x){
        if (x.checked) picked.push(x.dataset.i);
      });
      // Отмечено всё — значит «усі», а не перечисление: иначе новый
      // канал этому человеку не достанется, и никто не поймёт почему.
      if (picked.length === items.length) picked = [];
      saveAccess(kind, userId, picked);
    };
  });
}

function saveAccess(kind, userId, ids){
  var path = kind === 'channel' ? '/channels' : '/folders';
  var body = kind === 'channel' ? { channelIds: ids } : { folderIds: ids };
  return api('/users/' + userId + path, { method:'PUT', body: body })
    .then(function(){
      (kind === 'channel' ? ACC.channelIds : ACC.folderIds)[userId] = ids;
      renderAccess();
    })
    .catch(function(e){
      var p = e.payload || {};
      el('mtxerr-' + kind).textContent = p.detail || L('Не вдалося зберегти доступ');
      loadAccess();
    });
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
  var sla = NT.data.sla || {};
  var opts = [0, 5, 10, 15, 30, 60];
  if (opts.indexOf(minutes) < 0) opts.push(minutes);
  return '<div class="card" style="margin-bottom:14px"><div class="row2">' +
    '<div class="lbl" style="width:auto">' + L('Вважати, що клієнт чекає, через') + '</div>' +
    '<select id="ntWait" style="max-width:200px">' +
    opts.sort(function(a,b){ return a-b }).map(function(m){
      return '<option value="' + m + '"' + (m === minutes ? ' selected' : '') + '>' +
        (m === 0 ? L('не перевіряти') : m + ' ' + L('хв')) + '</option>';
    }).join('') + '</select></div>' +
    (sla && sla.firstReplyMinutes
      ? L('<div class="hint">Зараз цей поріг не діє: у розділі «Звіти → SLA» задана обіцянка ') +
        L('відповісти за ') + sla.firstReplyMinutes + L(' хв, і попередження приходить за нею — ') +
        L('коли лишається п’ята частина строку. Два числа про одне й те саме дали б два ') +
        L('сповіщення про один діалог з різницею в хвилину.</div></div>')
      : L('<div class="hint">Стосується події «Клієнт чекає відповіді». Нагадування приходить один раз ') +
        L('на повідомлення, а не щохвилини.</div></div>'));
}

function ntAdd(){
  var bots = NT.data.bots || [];
  var push = NT.data.push || {};

  /* Бот для оповещений — отдельная история от бота-канала. Канал-бот
     есть далеко не у всех: клиенты пишут в Instagram и на номер, а
     дежурной группе нужен свой бот, которого клиентам не показывают.
     Поэтому либо выбрать уже подключённого, либо вписать свой токен. */
  var tg = '<div class="tile"><div class="t1"><div class="chico telegram_bot">' + chIcon('telegram_bot') + '</div>' +
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
  }).then(function(){
    // register() возвращается, как только браузер принял файл, — но
    // подписываться в этот момент не на что: сценарий ещё не активен, и
    // PushManager отвечает «no active Service Worker». Ждём готовности.
    return navigator.serviceWorker.ready;
  }).then(function(reg){
    // Старая подписка могла остаться от прежней пары ключей VAPID.
    // Подписаться поверх неё браузер не даст, а прежняя всё равно уже
    // не работает — снимаем её и подписываемся заново.
    return reg.pushManager.getSubscription().then(function(old){
      return old ? old.unsubscribe().then(function(){ return reg }) : reg;
    });
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

/* ══════════════ Статусы диалога ══════════════ */

/**
 * Статусы — короткий справочник, и страница у него соответствующая:
 * строка на статус, всё правится на месте, ничего не открывается в
 * отдельной форме. Единственное, что здесь объясняется словами, — род
 * статуса, потому что это единственное решение, которое человек может
 * принять неправильно и не заметить.
 */
function kindSelect(id, value){
  return '<select id="' + id + '" style="max-width:150px">' +
    '<option value="open"' + (value === 'closed' ? '' : ' selected') + '>' +
      L('У роботі') + '</option>' +
    '<option value="closed"' + (value === 'closed' ? ' selected' : '') + '>' +
      L('Закритий') + '</option></select>';
}

/* ══════════════ Звіти ══════════════

   Считаются по ленте событий, а не по нынешнему состоянию диалогов:
   состояние знает только последнее значение, а спрашивают всегда про
   прошлое. Диалог переназначили — и весь июнь задним числом стал бы
   заслугой того, кто взял его вчера.

   Среднее показано рядом с медианой и девятым децилем не для полноты.
   Среднее время ответа сдвигает вдвое один забытый на ночь диалог, и
   человек делает вывод о смене, которая работала нормально. Медиана
   говорит про обычный день, девятый дециль — про худшее, что
   случается регулярно. */

var RP = { days: 7, channelId: [], userId: [], tab: 'overview', data: null, breaches: null };

/* Проваливание из отчёта в переписку. Держится отдельно от фильтров и
   видно на экране полоской: скрытое состояние списка — это когда
   человек не понимает, почему в нём один диалог. */
var DRILL = null;

function rpFrom(){
  var d = new Date();
  d.setDate(d.getDate() - RP.days);
  return d;
}

/** Секунды человеческими словами: «12 хв», «2 год 5 хв», «—». */
function dur(sec){
  if (sec == null) return '—';
  var s = Math.max(0, Math.round(sec));
  if (s < 60) return s + L(' с');
  var m = Math.round(s / 60);
  if (m < 60) return m + L(' хв');
  var h = Math.floor(m / 60);
  return h + L(' год ') + (m % 60) + L(' хв');
}

/**
 * Отчёты разложены по страницам, а не свалены в одну простыню.
 *
 * Причина простая: вопросы разные. «Как мы вообще работаем» смотрят раз
 * в неделю, «какой канал тонет» — когда что-то пошло не так, «кто
 * сколько сделал» — в конце месяца, «где мы нарушили обещание» — сразу
 * после жалобы. Одна страница со всем этим заставляет каждый раз
 * искать глазами свой кусок среди четырёх чужих.
 *
 * Полоса отбора общая для всех страниц: период и каналы человек
 * выбирает один раз, а не заново на каждой вкладке.
 */
var RP_TABS = [
  ['overview', 'Огляд'],
  ['when', 'Коли пишуть'],
  ['channels', 'Канали'],
  ['team', 'Команда'],
  ['sla', 'SLA'],
];

function rpQuery(){
  var p = ['from=' + encodeURIComponent(rpFrom().toISOString())];
  if (RP.channelId.length) p.push('channelId=' + encodeURIComponent(RP.channelId.join(',')));
  if (RP.userId.length) p.push('userId=' + encodeURIComponent(RP.userId.join(',')));
  return p.join('&');
}

/** Выгрузка таблицы. Разделитель — точка с запятой: так Excel в наших
    краях открывает файл сразу, а не одной колонкой. */
function csvDump(name, head, rows){
  var nl = String.fromCharCode(10);
  var cell = function(v){
    var t = String(v == null ? '' : v);
    return t.indexOf(';') >= 0 || t.indexOf('"') >= 0 || t.indexOf(nl) >= 0
      ? '"' + t.split('"').join('""') + '"' : t;
  };
  var body = [head].concat(rows).map(function(r){ return r.map(cell).join(';') }).join(nl);
  // Метка порядка байтов: без неё Excel читает кириллицу как кракозябры.
  var blob = new Blob([String.fromCharCode(65279) + body], { type:'text/csv;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name + '-' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href) }, 1000);
}

/** Доля в процентах, без деления на ноль. */
function pct(part, whole){
  if (!whole) return '—';
  return Math.round(part / whole * 100) + '%';
}

function tabReports(){
  var calls = [api('/analytics?' + rpQuery())];
  if (RP.tab === 'sla') calls.push(api('/analytics/breaches?' + rpQuery()).catch(function(){
    return { breaches: [] };
  }));

  Promise.all(calls).then(function(res){
    RP.data = res[0];
    RP.breaches = res[1] || null;
    var d = RP.data, t = d.totals || {};

    pageBox().innerHTML = '<div class="pg">' +
      pageHead(L('Звіти'), L('Рахуються за стрічкою подій: те, що сталося, а не те, як воно виглядає зараз. ') +
        L('Час відповіді — у робочих годинах компанії.')) +

      '<div class="rpbar">' +
      [[7, L('7 днів')], [30, L('30 днів')], [90, L('90 днів')]].map(function(x){
        return '<button class="ghost mini' + (RP.days === x[0] ? ' on' : '') +
          '" data-days="' + x[0] + '">' + esc(x[1]) + '</button>';
      }).join('') +
      '<span class="grow"></span>' +
      '<button class="fbtn" id="rpCh" style="flex:0 0 170px"></button>' +
      '<button class="fbtn" id="rpUs" style="flex:0 0 170px"></button>' +
      L('<button class="ghost mini" id="rpCsv">Вивантажити CSV</button>') +
      '</div>' +

      '<div class="tabs rptabs">' +
      RP_TABS.map(function(x){
        return '<button class="tab' + (RP.tab === x[0] ? ' on' : '') +
          '" data-rtab="' + x[0] + '">' + esc(L(x[1])) + '</button>';
      }).join('') + '</div>' +

      (RP.tab === 'overview' ? rpOverview(d, t)
        : RP.tab === 'when' ? rpWhen(d)
        : RP.tab === 'channels' ? rpChannels(d)
        : RP.tab === 'team' ? rpTeam(d)
        : rpSla(d, t)) +
      '</div>';

    Array.prototype.forEach.call(pageBox().querySelectorAll('[data-days]'), function(b){
      b.onclick = function(){ RP.days = Number(b.dataset.days); tabReports() };
    });
    Array.prototype.forEach.call(pageBox().querySelectorAll('[data-rtab]'), function(b){
      b.onclick = function(){ RP.tab = b.dataset.rtab; tabReports() };
    });

    function paintRp(){
      el('rpCh').textContent = RP.channelId.length
        ? L('Каналів: ') + RP.channelId.length : L('Усі канали');
      el('rpUs').textContent = RP.userId.length
        ? L('Співробітників: ') + RP.userId.length : L('Усі співробітники');
      el('rpCh').classList.toggle('on', RP.channelId.length > 0);
      el('rpUs').classList.toggle('on', RP.userId.length > 0);
    }
    paintRp();

    el('rpCh').onclick = function(ev){
      ev.stopPropagation();
      pickMany(el('rpCh'), CHANNELS.map(function(c){
        return { v:c.id, t:c.display_name || CH[c.type] || c.type };
      }), RP.channelId, L('Усі канали'), function(out){ RP.channelId = out; tabReports() });
    };
    el('rpUs').onclick = function(ev){
      ev.stopPropagation();
      pickMany(el('rpUs'), (USERS.length ? USERS : MATES).map(function(u){
        return { v:u.id, t:u.full_name || u.name || u.email };
      }), RP.userId, L('Усі співробітники'), function(out){ RP.userId = out; tabReports() });
    };
    el('rpCsv').onclick = rpExport;

    /* Проваливание: строка таблицы — это не итог, а вопрос «а что там».
       Щелчок по каналу или человеку переносит в список чатов уже с этим
       отбором, щелчок по просрочке открывает саму переписку. */
    Array.prototype.forEach.call(pageBox().querySelectorAll('[data-drill-ch]'), function(r){
      r.onclick = function(){ drillTo({ channelId: [r.dataset.drillCh] }) };
    });
    Array.prototype.forEach.call(pageBox().querySelectorAll('[data-drill-us]'), function(r){
      r.onclick = function(){ drillTo({ assignee: [r.dataset.drillUs] }) };
    });
    Array.prototype.forEach.call(pageBox().querySelectorAll('[data-drill-conv]'), function(r){
      r.onclick = function(){ drillConv(r.dataset.drillConv) };
    });

    if (RP.tab === 'sla') wireSla(d.sla || {});
    if (RP.tab === 'team') wireKpi();
  }).catch(sErr);
}

/* ══════════════ Графики ══════════════ */

/**
 * Подсказка под курсором.
 *
 * Одна на всю страницу и вешается один раз: столбцов в отчёте сотни, и
 * свой обработчик на каждом — это сотни обработчиков, которые надо
 * снимать при каждой перерисовке.
 *
 * Подписывать каждое значение прямо на графике нельзя: числа на каждом
 * пикселе не читаются. Поэтому значения живут в подсказке, а рядом с
 * графиком всегда есть таблица с теми же числами — для тех, кому мышь
 * не помощник.
 */
var TIP = null;

function tipShow(text, x, y){
  if (!TIP){
    TIP = document.createElement('div');
    TIP.className = 'vtip';
    document.body.appendChild(TIP);
  }
  TIP.textContent = text;
  TIP.style.display = 'block';
  var w = TIP.offsetWidth, h = TIP.offsetHeight;
  TIP.style.left = Math.max(8, Math.min(x + 14, window.innerWidth - w - 8)) + 'px';
  TIP.style.top = Math.max(8, y - h - 12) + 'px';
}

function tipHide(){ if (TIP) TIP.style.display = 'none' }

function wireTips(){
  document.addEventListener('mouseover', function(e){
    var n = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
    if (n) tipShow(n.dataset.tip, e.clientX, e.clientY);
  });
  document.addEventListener('mousemove', function(e){
    if (!TIP || TIP.style.display === 'none') return;
    var n = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
    if (n) tipShow(n.dataset.tip, e.clientX, e.clientY);
    else tipHide();
  });
  document.addEventListener('mouseout', function(e){
    var n = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
    if (n) tipHide();
  });
  window.addEventListener('scroll', tipHide, true);
}

/** Круглое число для верхней линии сетки: 7 превращается в 10, 43 — в 50. */
function niceTop(v){
  if (v <= 5) return 5;
  var p = Math.pow(10, String(Math.round(v)).length - 1);
  return Math.ceil(v / (p / 2)) * (p / 2);
}

/**
 * Два ряда по дням.
 *
 * Именно столбцы, а не линия: дни дискретны, и линия между вторником и
 * средой рисует значения, которых не существует. Ряда два — входящие и
 * исходящие; третьим тут была бы уже каша.
 *
 * Подписи дней прореживаются: на месяце тридцать подписей налезают
 * друг на друга и не читаются ни одна.
 */
function vizDays(days, a, b, labelA, labelB){
  if (!days.length) return '';
  var top = niceTop(Math.max.apply(null, [1].concat(days.map(function(x){
    return Math.max(x[a] || 0, x[b] || 0);
  }))));
  var every = days.length > 24 ? 7 : days.length > 12 ? 2 : 1;

  return '<div class="viz">' +
    '<div class="vgrid">' +
      [0, 0.5, 1].map(function(k){
        return '<u style="top:' + Math.round((1 - k) * 100) + '%"><b>' +
          esc(Math.round(top * k)) + '</b></u>';
      }).join('') +
    '</div>' +
    '<div class="vbars">' +
      days.map(function(x, i){
        var t = fmtDate(x.day) + NL + labelA + ': ' + (x[a] || 0) + NL + labelB + ': ' + (x[b] || 0);
        return '<div class="vday" data-tip="' + esc(t) + '">' +
          '<div class="vcol">' +
            '<i class="a" style="height:' + Math.round((x[a] || 0) / top * 100) + '%"></i>' +
            '<i class="b" style="height:' + Math.round((x[b] || 0) / top * 100) + '%"></i>' +
          '</div>' +
          '<span>' + (i % every === 0 || i === days.length - 1 ? esc(x.day.slice(5)) : '') + '</span>' +
        '</div>';
      }).join('') +
    '</div>' +
    '<div class="vlegend">' +
      '<span><i style="background:var(--viz1)"></i>' + esc(labelA) + '</span>' +
      '<span><i style="background:var(--viz2)"></i>' + esc(labelB) + '</span>' +
    '</div>' +
  '</div>';
}

/**
 * Распределение времени первой ответа.
 *
 * Медиана говорит про обычный случай, девятый дециль — про худшее, но
 * форму не показывает ни то ни другое: бывает, что половина ответов
 * уходит за минуту, а вторая — за час, и «медиана двадцать минут»
 * описывает случай, которого не было ни разу.
 */
var WAIT_LABELS = [
  L('до 5 хвилин'), L('5–15 хвилин'), L('15–30 хвилин'),
  L('30–60 хвилин'), L('1–4 години'), L('довше 4 годин')
];

function vizWait(buckets){
  var list = buckets || [];
  var total = list.reduce(function(s, x){ return s + (x.count || 0) }, 0);
  if (!total) return L('<div class="hint">Відповідей за цей період не було.</div>');
  var top = Math.max.apply(null, [1].concat(list.map(function(x){ return x.count || 0 })));

  return '<div class="viz">' + list.map(function(x){
    var share = Math.round((x.count || 0) / total * 100);
    return '<div class="vrow" data-tip="' + esc(WAIT_LABELS[x.bucket] + ': ' + x.count + ' (' + share + '%)') + '">' +
      '<span>' + esc(WAIT_LABELS[x.bucket] || '') + '</span>' +
      '<span class="f"><i style="width:' + Math.round((x.count || 0) / top * 100) + '%"></i></span>' +
      '<span class="n">' + esc(x.count || 0) + '</span>' +
    '</div>';
  }).join('') + '</div>';
}

/**
 * Когда пишут клиенты: часы против дней недели.
 *
 * Единственная картинка в отчёте, по которой составляют расписание
 * смен. Один тон от светлого к тёмному: величина одна, и цвет обязан
 * читаться как «больше», а не как «другое». Радуга здесь была бы
 * красивой и нечитаемой.
 */
var DOW = [L('Пн'), L('Вт'), L('Ср'), L('Чт'), L('Пт'), L('Сб'), L('Нд')];

function vizHeat(cells){
  var list = cells || [];
  if (!list.length) return L('<div class="hint">Вхідних за цей період не було.</div>');

  var byKey = {}, top = 0;
  list.forEach(function(c){
    byKey[c.dow + ':' + c.hour] = c.count;
    if (c.count > top) top = c.count;
  });

  var head = '<div class="vheat"><span class="h"></span>' +
    Array.from({ length: 24 }, function(_, h){
      return '<span class="h" style="text-align:center">' + (h % 3 === 0 ? h : '') + '</span>';
    }).join('') +
    [1, 2, 3, 4, 5, 6, 7].map(function(d){
      return '<span class="h">' + DOW[d - 1] + '</span>' +
        Array.from({ length: 24 }, function(_, h){
          var n = byKey[d + ':' + h] || 0;
          // Пять ступеней: больше глаз всё равно не различает, а
          // меньше — и вечерний пик сливается с обеденным.
          var step = !n ? 0 : Math.min(5, Math.ceil(n / top * 5));
          var t = DOW[d - 1] + ', ' + h + ':00 — ' + n;
          return '<span class="c' + (step ? ' s' + step : '') + '" data-tip="' + esc(t) + '"></span>';
        }).join('');
    }).join('') +
    '</div>';

  return head +
    '<div class="vscale">' + L('менше') +
      [1, 2, 3, 4, 5].map(function(s){ return '<i style="background:var(--heat' + s + ')"></i>' }).join('') +
      L('більше · до ') + esc(top) + L(' за годину') +
    '</div>';
}

/** Доли по величине: один ряд, поэтому один тон и подпись у каждого. */
function vizShare(rows, label, value, total){
  var top = Math.max.apply(null, [1].concat(rows.map(function(r){ return r[value] || 0 })));
  return '<div class="viz">' + rows.map(function(r){
    var share = total ? Math.round((r[value] || 0) / total * 100) : 0;
    return '<div class="vrow" data-tip="' + esc(r[label] + ': ' + (r[value] || 0) + ' (' + share + '%)') + '">' +
      '<span>' + esc(r[label]) + '</span>' +
      '<span class="f"><i style="width:' + Math.round((r[value] || 0) / top * 100) + '%"></i></span>' +
      '<span class="n">' + esc(r[value] || 0) + '</span>' +
    '</div>';
  }).join('') + '</div>';
}

function rpOverview(d, t){
  var days = d.byDay || [];
  var msgs = (t.messagesIn || 0) + (t.messagesOut || 0);

  return '<div class="nums">' +
    num(t.conversations, L('нових діалогів')) +
    num(t.messagesIn, L('вхідних')) +
    num(t.messagesOut, L('вихідних')) +
    num(t.conversations ? (msgs / t.conversations).toFixed(1) : '—', L('повідомлень на діалог')) +
    '</div>' +

    L('<div class="pg-sec"><h3>Час першої відповіді</h3><div class="card">') +
    '<div class="nums">' +
    num(dur(t.medianWait), L('медіана')) +
    num(dur(t.avgWait), L('середнє')) +
    num(dur(t.p90Wait), L('9 з 10 швидше ніж')) +
    num(pct(t.repliedConversations, t.conversations), L('діалогів з відповіддю')) +
    '</div>' +
    L('<div class="hint">Медіана — про звичайний день: половина клієнтів дочекалась швидше. ') +
    L('Середнє один забутий на ніч діалог зсуває вдвічі, тому дивіться на обидва числа.</div>') +
    '</div></div>' +

    L('<div class="pg-sec"><h3>Закриття</h3><div class="card">') +
    '<div class="nums">' +
    num(t.resolved, L('закрито')) +
    num(dur((d.resolve || {}).median), L('медіана до закриття')) +
    num(dur((d.resolve || {}).avg), L('середнє до закриття')) +
    num(pct(t.resolved, t.conversations), L('від нових')) +
    '</div>' +
    L('<div class="hint">Час до закриття рахується за календарем, а не в робочих годинах: ') +
    L('діалог живе і вночі, і у вихідні, і саме стільки клієнт чекає розвʼязки.</div>') +
    '</div></div>' +

    L('<div class="pg-sec"><h3>Розподіл часу першої відповіді</h3><div class="card">') +
    vizWait(d.waitBuckets) +
    L('<div class="hint">Медіана ховає форму: буває, що половина відповідей іде за хвилину, ') +
    L('а друга половина — за годину, і «медіана 20 хвилин» описує випадок, якого не було жодного разу.</div>') +
    '</div></div>' +

    (days.length
      ? L('<div class="pg-sec"><h3>Повідомлення по днях</h3><div class="card">') +
        vizDays(days, 'messagesIn', 'messagesOut', L('вхідні'), L('вихідні')) +
        '</div></div>' +
        L('<div class="pg-sec"><h3>Діалоги по днях</h3><div class="card">') +
        vizDays(days, 'conversations', 'resolved', L('нові'), L('закриті')) +
        L('<div class="hint">Нові і закриті поруч: якщо закритих постійно менше, черга росте, ') +
        L('і це видно раніше, ніж за скаргами.</div>') +
        '</div></div>'
      : '');
}

function rpChannels(d){
  var list = d.byChannel || [];
  if (!list.length) return L('<div class="card"><div class="hint">За цей період подій не було.</div></div>');
  var top = Math.max.apply(null, [1].concat(list.map(function(c){ return c.messagesIn })));

  return '<div class="card">' +
    '<div class="mtxwrap"><table class="mtx"><thead><tr>' +
    L('<th>Канал</th><th>Діалогів</th><th>Вхідних</th><th>Вихідних</th><th>Медіана</th><th></th>') +
    '</tr></thead><tbody>' +
    list.map(function(c){
      return '<tr data-drill-ch="' + esc(c.id) + '" style="cursor:pointer" title="' +
        L('Показати ці чати') + '"><td>' + esc(c.name || CH[c.type] || c.type) + '</td><td>' +
        c.conversations + '</td><td>' + c.messagesIn + '</td><td>' + c.messagesOut +
        '</td><td>' + esc(dur(c.medianWait)) + '</td>' +
        '<td style="width:120px"><span class="sbar"><i style="width:' +
        Math.round(c.messagesIn / top * 100) + '%"></i></span></td></tr>';
    }).join('') + '</tbody></table></div>' +
    L('<div class="hint">Рядок клікається: відкриється список чатів цього каналу.</div></div>') +

    L('<div class="pg-sec"><h3>Частки каналів</h3><div class="card">') +
    vizShare(list.map(function(c){
      return { name: c.name || CH[c.type] || c.type, messagesIn: c.messagesIn };
    }), 'name', 'messagesIn', list.reduce(function(s2, c){ return s2 + (c.messagesIn || 0) }, 0)) +
    L('<div class="hint">Рахуємо по вхідних: саме вони показують, звідки насправді йдуть клієнти, ') +
    L('а не де ми більше написали.</div>') +
    '</div></div>';
}

/**
 * Когда пишут клиенты.
 *
 * Отдельная вкладка, а не картинка в обзоре: по ней составляют
 * расписание смен, и смотреть её приходят отдельно.
 */
function rpWhen(d){
  return L('<div class="pg-sec"><h3>Коли пишуть клієнти</h3><div class="card">') +
    vizHeat(d.heat) +
    L('<div class="hint">Години у вашому часовому поясі. Темніше — більше вхідних. ') +
    L('За цією картинкою складають графік змін: порожні ранки і завалений вечір видно одразу.</div>') +
    '</div></div>';
}

/**
 * План рядом с фактом.
 *
 * Голое «18 відповідей» не значит ничего: восемнадцать за неделю на
 * одном канале — хорошо, на четырёх — беда. План считается из дневной
 * цели и числа рабочих дней в периоде, и это число тут же написано,
 * чтобы не гадать, откуда взялось.
 */
function planCell(fact, perDay, days){
  if (!perDay) return String(fact);
  var plan = perDay * Math.max(days, 1);
  var p = Math.round(fact / plan * 100);
  return fact + '<span class="dim"> / ' + plan + '</span>' +
    '<div class="plan"><i class="' + (p >= 100 ? 'ok' : p >= 70 ? 'mid' : 'bad') +
    '" style="width:' + Math.min(p, 100) + '%"></i></div>';
}

function rpTeam(d){
  var list = d.byUser || [];
  if (!list.length) return L('<div class="card"><div class="hint">За цей період ніхто не відповідав.</div></div>');
  var days = d.workingDays || 1;
  var base = d.goalDefault || {};

  return '<div class="card">' +
    '<div class="mtxwrap"><table class="mtx"><thead><tr>' +
    L('<th>Співробітник</th><th>Відповідей</th><th>Закрито</th><th>У строк</th><th>Медіана</th><th></th>') +
    '</tr></thead><tbody>' +
    list.map(function(u){
      var g = u.goal || {};
      return '<tr><td><span data-drill-us="' + esc(u.id) + '" style="cursor:pointer" title="' +
        L('Показати ці чати') + '">' + esc(u.name) + '</span>' +
        (u.goalOwn ? L(' <span class="pill">своя ціль</span>') : '') + '</td>' +
        '<td>' + planCell(u.replies, g.repliesPerDay, days) + '</td>' +
        '<td>' + planCell(u.resolved, g.resolvedPerDay, days) + '</td>' +
        '<td>' + (u.inTimePercent == null ? '—'
          : u.inTimePercent + '%' + (g.inTimePercent
              ? '<span class="dim"> / ' + g.inTimePercent + '%</span>' : '')) + '</td>' +
        '<td>' + esc(dur(u.medianWait)) + '</td>' +
        '<td><button class="ghost mini" data-goal="' + esc(u.id) + '" data-name="' +
          esc(u.name) + L('">Ціль</button></td></tr>');
    }).join('') + '</tbody></table></div>' +
    L('<div class="hint">План — це денна ціль, помножена на робочі дні періоду: їх тут ') + days +
    L('. Імʼя клікається — відкриється список чатів цієї людини. ') +
    L('Числа — про роботу, а не про людину: у того, кому дістаються складні звернення, медіана буде гіршою.</div>') +
    '</div>' +

    L('<div class="pg-sec"><h3>Спільна ціль</h3><div class="card">') +
    '<div class="acts" style="margin-top:0">' +
    L('<label class="ntev">Відповідей на день <input id="kpiRep" type="number" min="0" max="100" style="max-width:90px"></label>') +
    L('<label class="ntev">Закриттів на день <input id="kpiRes" type="number" min="0" max="100" style="max-width:90px"></label>') +
    L('<label class="ntev">У строк, % <input id="kpiPct" type="number" min="0" max="100" style="max-width:90px"></label>') +
    L('<button id="kpiSave">Зберегти</button></div>') +
    L('<div class="hint">Нуль — цілі немає, і тоді в таблиці просто факт без плану: ') +
    L('вигадана ціль гірша за її відсутність, бо за нею потім розмовляють з людьми. ') +
    L('Ціль однієї людини задається кнопкою «Ціль» у її рядку.</div>') +
    '<div class="err" id="kpiErr"></div></div></div>' +
    '<span id="kpiBase" data-r="' + (base.repliesPerDay || 0) + '" data-c="' +
      (base.resolvedPerDay || 0) + '" data-p="' + (base.inTimePercent || 0) + '"></span>';
}

function rpSla(d, t){
  var sla = d.sla || {};
  var br = (RP.breaches || {}).breaches || [];
  var total = (t.replyInTime || 0) + (t.replyLate || 0);

  return L('<div class="card"><h3>Обіцянка</h3>') +
    '<div class="acts" style="margin-top:0">' +
    L('<label class="ntev">Перша відповідь, хвилин <input id="slaFirst" type="number" min="0" max="2880" style="max-width:110px"></label>') +
    L('<label class="ntev">Закриття, хвилин <input id="slaResolve" type="number" min="0" max="2880" style="max-width:110px"></label>') +
    L('<button id="slaSave">Зберегти</button></div>') +
    L('<div class="hint">Нуль — не обіцяємо нічого, і тоді жодне число не називається простроченням: ') +
    L('вигадати обіцянку за компанію гірше, ніж не мати її. Рахується в робочих годинах.</div>') +
    '<div class="err" id="slaErr"></div></div>' +

    (sla.firstReplyMinutes
      ? L('<div class="pg-sec"><h3>Як тримаємо</h3><div class="card">') +
        '<div class="nums">' +
        num(t.replyInTime, L('у строк')) +
        num(t.replyLate, L('прострочено')) +
        num(pct(t.replyInTime, total), L('вкладаємось')) +
        num(dur(sla.firstReplyMinutes * 60), L('обіцяно')) +
        '</div></div></div>' +

        L('<div class="pg-sec"><h3>Прострочення</h3><div class="card">') +
        (br.length
          ? '<div class="mtxwrap"><table class="mtx"><thead><tr>' +
            L('<th>Клієнт</th><th>Канал</th><th>Хто відповів</th><th>Чекав</th><th>За годинником</th>') +
            '</tr></thead><tbody>' +
            br.map(function(x){
              return '<tr data-drill-conv="' + esc(x.conversationId) + '" style="cursor:pointer" title="' +
                L('Відкрити переписку') + '"><td>' + esc(x.contact || L('Без імені')) + '</td><td>' +
                esc(x.channel || CH[x.channelType] || '') + '</td><td>' + esc(x.user || '—') +
                '</td><td>' + esc(dur(x.waitSeconds)) + '</td><td>' + esc(dur(x.clockSeconds)) +
                '</td></tr>';
            }).join('') + '</tbody></table></div>' +
            L('<div class="hint">Рядок клікається: відкриється сама переписка. ') +
            L('«Чекав» — у робочих годинах, «за годинником» — як це відчув клієнт.</div>')
          : L('<div class="hint">Жодного прострочення за цей період.</div>')) +
        '</div></div>'
      : L('<div class="hint">Поки обіцянки немає, рахувати прострочення нема від чого.</div>'));
}

/**
 * Настройка целей.
 *
 * Общая цель — полем на странице, личная — окошком в строке человека.
 * Личных целей обычно одна-две: раздавать их всем через таблицу из
 * трёх полей на каждого значит показывать двадцать пустых полей ради
 * двух заполненных.
 */
function wireKpi(){
  var base = el('kpiBase');
  if (!base) return;
  el('kpiRep').value = base.dataset.r;
  el('kpiRes').value = base.dataset.c;
  el('kpiPct').value = base.dataset.p;

  el('kpiSave').onclick = function(){
    el('kpiErr').textContent = '';
    busy(el('kpiSave'), true);
    saveKpi(null, {
      repliesPerDay: Number(el('kpiRep').value),
      resolvedPerDay: Number(el('kpiRes').value),
      inTimePercent: Number(el('kpiPct').value)
    }).catch(function(){ busy(el('kpiSave'), false) });
  };

  Array.prototype.forEach.call(pageBox().querySelectorAll('[data-goal]'), function(b){
    b.onclick = function(ev){
      ev.stopPropagation();
      var u = (RP.data.byUser || []).filter(function(x){ return x.id === b.dataset.goal })[0] || {};
      var g = u.goalOwn ? (u.goal || {}) : {};
      var box = popBox(b, 'fpick');
      box.innerHTML = '<div style="padding:4px 6px;font-weight:600">' + esc(b.dataset.name) + '</div>' +
        L('<label class="fopt">Відповідей на день <input id="gRep" type="number" min="0" max="100" style="max-width:80px"></label>') +
        L('<label class="fopt">Закриттів на день <input id="gRes" type="number" min="0" max="100" style="max-width:80px"></label>') +
        L('<label class="fopt">У строк, % <input id="gPct" type="number" min="0" max="100" style="max-width:80px"></label>') +
        '<div class="fact">' +
        L('<button class="ghost mini" id="gClr">Як у всіх</button> ') +
        L('<button class="mini" id="gOk">Зберегти</button></div>');
      popAt(box, b);
      el('gRep').value = g.repliesPerDay || 0;
      el('gRes').value = g.resolvedPerDay || 0;
      el('gPct').value = g.inTimePercent || 0;

      // «Как у всех» — это убрать личную цель, а не обнулить её: тогда
      // человек снова попадает под общую, а не остаётся без цели вовсе.
      el('gClr').onclick = function(){
        box.remove();
        saveKpi(b.dataset.goal, { repliesPerDay:0, resolvedPerDay:0, inTimePercent:0 });
      };
      el('gOk').onclick = function(){
        var body = {
          repliesPerDay: Number(el('gRep').value),
          resolvedPerDay: Number(el('gRes').value),
          inTimePercent: Number(el('gPct').value)
        };
        box.remove();
        saveKpi(b.dataset.goal, body);
      };
    };
  });
}

function saveKpi(userId, goal){
  goal.userId = userId;
  return api('/kpi', { method:'PUT', body: goal })
    .then(function(){ tabReports(); toast(L('Ціль збережено')) })
    .catch(function(e){
      var p = e.payload || {};
      if (el('kpiErr')) el('kpiErr').textContent = p.detail || L('Не вдалося зберегти');
      throw e;
    });
}

function wireSla(sla){
  el('slaFirst').value = sla.firstReplyMinutes || 0;
  el('slaResolve').value = sla.resolveMinutes || 0;
  el('slaSave').onclick = function(){
    el('slaErr').textContent = '';
    busy(el('slaSave'), true);
    api('/settings/sla', { method:'PATCH', body:{
      firstReplyMinutes: Number(el('slaFirst').value),
      resolveMinutes: Number(el('slaResolve').value)
    }}).then(function(){ tabReports(); toast(L('Обіцянку збережено')) })
      .catch(function(e){
        var p = e.payload || {};
        el('slaErr').textContent = p.detail || L('Не вдалося зберегти');
        busy(el('slaSave'), false);
      });
  };
}

/** Выгрузка той таблицы, которая сейчас на экране. */
function rpExport(){
  var d = RP.data || {}, t = d.totals || {};
  if (RP.tab === 'channels'){
    csvDump('kanaly', [L('Канал'), L('Діалогів'), L('Вхідних'), L('Вихідних'), L('Медіана, с')],
      (d.byChannel || []).map(function(c){
        return [c.name, c.conversations, c.messagesIn, c.messagesOut, c.medianWait];
      }));
  } else if (RP.tab === 'team'){
    var days = d.workingDays || 1;
    csvDump('komanda', [L('Співробітник'), L('Відповідей'), L('План відповідей'), L('Закрито'),
      L('План закриттів'), L('У строк, %'), L('Медіана, с')],
      (d.byUser || []).map(function(u){
        var g = u.goal || {};
        return [u.name, u.replies, g.repliesPerDay ? g.repliesPerDay * days : '',
          u.resolved, g.resolvedPerDay ? g.resolvedPerDay * days : '',
          u.inTimePercent == null ? '' : u.inTimePercent, u.medianWait];
      }));
  } else if (RP.tab === 'sla'){
    csvDump('sla', [L('Клієнт'), L('Канал'), L('Хто відповів'), L('Чекав, с'), L('За годинником, с')],
      (((RP.breaches || {}).breaches) || []).map(function(x){
        return [x.contact, x.channel, x.user, x.waitSeconds, x.clockSeconds];
      }));
  } else {
    csvDump('po-dnyah', [L('День'), L('Вхідних'), L('Вихідних'), L('Нових діалогів')],
      (d.byDay || []).map(function(x){
        return [x.day, x.messagesIn, x.messagesOut, x.conversations];
      }).concat([[]], [[L('Разом'), t.messagesIn, t.messagesOut, t.conversations]]));
  }
}

/** Из отчёта — в список чатов с этим отбором. */
function drillTo(filters){
  DRILL = null;
  F.status = 'all';
  F.channelId = filters.channelId || [];
  F.assignee = filters.assignee || [];
  F.tag = [];
  F.statusId = [];
  F.q = '';
  if (el('fQ')) el('fQ').value = '';
  Array.prototype.forEach.call(document.querySelectorAll('.tab[data-status]'), function(x){
    x.classList.toggle('on', x.dataset.status === 'all');
  });
  setView('chats');
  paintFilters();
  paintDrill();
  lastList = null;
  refresh();
}

/** Из отчёта — прямо в переписку. */
function drillConv(id){
  DRILL = id;
  F.status = 'all';
  F.channelId = []; F.assignee = []; F.tag = []; F.statusId = []; F.q = '';
  setView('chats');
  paintFilters();
  paintDrill();
  lastList = null;
  refresh().then(function(){ openConv(id) });
}

function paintDrill(){
  var box = el('drill');
  if (!box) return;
  box.style.display = DRILL ? 'flex' : 'none';
  if (!DRILL) return;
  box.innerHTML = L('<span>Показаний один діалог зі звіту.</span>') +
    L('<button class="ghost mini" id="drillOff">Показати всі</button>');
  el('drillOff').onclick = function(){
    DRILL = null;
    paintDrill();
    lastList = null;
    refresh();
  };
}

function tabStatuses(){
  api('/statuses').then(function(d){
    STATUSES = d.statuses || [];
    fillStatusFilter();
    lastList = null;

    pageBox().innerHTML = '<div class="pg">' +
      pageHead(L('Статуси діалогів'),
        L('Системних станів чотири, і вони про механіку: чат відкритий або закритий. ') +
        L('Статуси — про вашу роботу: <b>«Чекаємо оплату»</b>, <b>«Передано на склад»</b>, ') +
        L('<b>«Немає товару»</b>. Оператор бачить їх у списку чатів і фільтрує за ними.')) +

      L('<div class="card"><h3>Новий статус</h3>') +
      '<div class="row2" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
      L('<input id="stName" placeholder="назва, наприклад Чекаємо оплату" style="flex:1;min-width:200px">') +
      kindSelect('stKind', 'open') + swatch('stColor', SCOLORS[0]) +
      L('<button id="stAdd">Додати</button></div>') +
      /* Род объясняется здесь один раз и подробно: это единственное
         место, где человек решает судьбу счётчиков, и «у роботі» против
         «закритий» без объяснения читается как оттенок смысла. */
      L('<div class="hint"><b>У роботі</b> — чат залишається у вкладці «Відкриті» ') +
      L('і потрапляє в лічильники. <b>Закритий</b> — чат їде у «Закриті», ') +
      L('як і кнопка «Закрити чат». Клієнт написав — чат повернеться у роботу сам.</div>') +
      '<div class="err" id="stErr"></div></div>' +

      L('<div class="card"><h3>Статуси (') + STATUSES.length + ')</h3>' +
      (STATUSES.length ? STATUSES.map(function(t, i){
        return '<div class="item"><div style="min-width:0;flex:1;display:flex;gap:9px;' +
          'align-items:center;flex-wrap:wrap">' +
          '<input value="' + esc(t.name) + '" data-nm="' + t.id +
            '" style="flex:0 1 220px;min-width:130px">' +
          kindSelect('k-' + t.id, t.kind) + swatch('c-' + t.id, t.color) +
          '</div>' +
          '<div style="display:flex;gap:6px;flex:none">' +
          '<button class="ghost mini" data-up="' + t.id + '"' + (i ? '' : ' disabled') +
            L(' title="Вище">↑</button>') +
          '<button class="ghost mini" data-down="' + t.id + '"' +
            (i === STATUSES.length - 1 ? ' disabled' : '') + L(' title="Нижче">↓</button>') +
          '<button class="ghost mini" data-del="' + t.id + L('">Видалити</button></div></div>');
      }).join('')
        : L('<div class="hint">Поки порожньо. Додайте перший — він зʼявиться в кожному чаті.</div>')) +
      '</div></div>';

    el('stAdd').onclick = function(){
      el('stErr').textContent = '';
      busy(el('stAdd'), true);
      api('/statuses', { method:'POST', body:{
        name: el('stName').value, kind: el('stKind').value, color: el('stColor').dataset.c
      }}).then(function(){ tabStatuses(); toast(L('Статус додано')) })
        .catch(function(e){
          var p = e.payload || {};
          el('stErr').textContent = p.error === 'duplicate' ? L('Такий статус вже є')
            : p.error === 'too_many' ? L('Більше статусів не буває сенсу: для дрібніших відтінків є мітки')
            : L('Впишіть назву статусу');
          busy(el('stAdd'), false);
        });
    };

    wireSwatch('stColor');

    /* Название сохраняется по уходу из поля, а не кнопкой: иначе на
       каждой строке была бы своя кнопка «Зберегти», и их было бы
       столько же, сколько статусов. */
    Array.prototype.forEach.call(pageBox().querySelectorAll('[data-nm]'), function(inp){
      var was = inp.value;
      inp.onchange = function(){
        if (inp.value.trim() === was.trim()) return;
        saveStatus(inp.dataset.nm, { name: inp.value });
      };
    });

    STATUSES.forEach(function(t){
      var k = el('k-' + t.id);
      k.onchange = function(){
        /* Смена рода двигает все диалоги под этим статусом — об этом
           говорим прямо, потому что человек менял слово, а получит
           переехавшие чаты. */
        saveStatus(t.id, { kind: k.value }, k.value === 'closed'
          ? L('Чати з цим статусом тепер у «Закритих»')
          : L('Чати з цим статусом повернулися в роботу'));
      };
      wireSwatch('c-' + t.id, function(c){ saveStatus(t.id, { color: c }) });
    });

    Array.prototype.forEach.call(pageBox().querySelectorAll('[data-up],[data-down]'), function(b){
      b.onclick = function(){
        if (b.disabled) return;
        moveStatus(b.dataset.up || b.dataset.down, b.dataset.up ? -1 : 1);
      };
    });

    /* Удаление снимает статус с диалогов, но не переоткрывает их: чат,
       закрытый вместе со статусом, остаётся закрытым. Об этом сказано
       на кнопке подтверждения, а не в сноске под списком. */
    armDelete(pageBox().querySelectorAll('[data-del]'), function(b){
      return api('/statuses/' + b.dataset.del, { method:'DELETE' })
        .then(function(){ tabStatuses(); toast(L('Статус видалено — чати залишилися як були')) });
    });
  }).catch(sErr);
}

function saveStatus(id, body, note){
  return api('/statuses/' + id, { method:'PATCH', body: body })
    .then(function(){ tabStatuses(); toast(note || L('Збережено')) })
    .catch(function(e){
      var p = e.payload || {};
      el('stErr').textContent = p.error === 'duplicate' ? L('Такий статус вже є')
        : p.error === 'name_required' ? L('Назва не може бути порожньою') : L('Не вдалося зберегти');
    });
}

/**
 * Перестановка. Порядок хранится числом, и двум соседям достаточно
 * обменяться своими числами — переписывать весь список ради одного шага
 * значит ставить десяток запросов там, где хватает двух.
 */
function moveStatus(id, dir){
  var i = -1;
  for (var k = 0; k < STATUSES.length; k++) if (STATUSES[k].id === id) i = k;
  var j = i + dir;
  if (i < 0 || j < 0 || j >= STATUSES.length) return;

  var a = STATUSES[i], b = STATUSES[j];
  /* Числа могут совпадать — тогда обмен ничего не изменит. Раздаём
     заново по месту в списке: это дешевле, чем объяснять человеку,
     почему стрелка не сработала. */
  var sa = a.sort, sb = b.sort;
  if (sa === sb){ sa = (i + 1) * 10; sb = (j + 1) * 10 }

  api('/statuses/' + a.id, { method:'PATCH', body:{ sort: sb } })
    .then(function(){ return api('/statuses/' + b.id, { method:'PATCH', body:{ sort: sa } }) })
    .then(function(){ tabStatuses() })
    .catch(sErr);
}

/* ── Папки шаблонов ───────────────────────────────────────────────
   Папка — это имя в поле шаблона, а не сущность со своей жизнью.
   Поэтому здесь нет ни создания, ни удаления: папка появляется с
   первым шаблоном и исчезает с последним. Раскладка повторяет ту, что
   делает сервер (packages/core/src/replies.ts): порядок в настройках и
   в поле ответа обязан быть одним, иначе человек ищет шаблон дважды
   по-разному. */
function qrFolder(v){
  // Без регулярных выражений: в этом файле обратный слэш запрещён — он
  // ломается при сборке интерфейса в одну строку.
  var s = String(v == null ? '' : v);
  [13, 10, 9].forEach(function(code){ s = s.split(String.fromCharCode(code)).join(' ') });
  while (s.indexOf('  ') >= 0) s = s.split('  ').join(' ');
  return s.trim();
}

function qrGroups(withEmpty){
  var map = {}, order = [];
  /* Пустые папки существуют: человек заводит их заранее, чтобы было
     куда класть. В настройках они обязаны быть видны — иначе созданная
     папка исчезает сразу после создания. В списке же шаблонов в поле
     ответа их нет: там выбирают текст, а не разглядывают пустые ящики. */
  if (withEmpty) QRF.forEach(function(f){
    var key = qrFolder(f).toLowerCase();
    if (key && !map[key]){ map[key] = { folder:qrFolder(f), items:[] }; order.push(key) }
  });
  QR.forEach(function(q){
    var name = qrFolder(q.folder), key = name.toLowerCase();
    if (!map[key]){ map[key] = { folder:name, items:[] }; order.push(key) }
    map[key].items.push(q);
  });
  var out = order.map(function(k){ return map[k] });
  out.forEach(function(g){
    g.items.sort(function(a, b){ return a.shortcut.localeCompare(b.shortcut, 'uk') });
  });
  // «Без папки» — в конец: это обычно остатки, и держать их наверху
  // значит показывать беспорядок раньше порядка.
  return out.sort(function(a, b){
    if (!a.folder) return 1;
    if (!b.folder) return -1;
    return a.folder.localeCompare(b.folder, 'uk');
  });
}

/* Список папок приходит с сервера вместе с шаблонами: он нужен для
   подсказки и для выбора, и считать его второй раз здесь — значит
   завести второе мнение о том, какие папки существуют. */
var QRF = [];

function qrFolders(){ return QRF }

/** Строка шаблона. Вынесена, потому что рисуется внутри каждой папки. */
function qrItem(q){
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
    '<select class="mvsel" data-mv="' + q.id + '" title="' + L('Папка') + '">' +
      '<option value=""' + (qrFolder(q.folder) ? '' : ' selected') + '>' + L('Без папки') + '</option>' +
      qrFolders().map(function(f){
        return '<option value="' + esc(f) + '"' +
          (qrFolder(q.folder).toLowerCase() === f.toLowerCase() ? ' selected' : '') +
          '>' + esc(f) + '</option>';
      }).join('') +
      '<option value="__new">' + L('Нова папка...') + '</option>' +
    '</select>' +
    (files.length < 3
      ? '<button class="ghost mini" data-file="' + q.id + L('">Файл</button>') : '') +
    '<button class="ghost mini" data-qr="' + q.id + L('">Видалити</button></div></div>');
}

function moveReply(id, folder){
  return api('/quick-replies/' + id, { method:'PATCH', body:{ folder: folder } })
    .then(function(){
      tabReplies();
      renderComposer(true);
      toast(folder ? L('Перекладено: ') + folder : L('Прибрано з папки'));
    })
    .catch(sErr);
}

function tabReplies(){
  api('/quick-replies').then(function(d){
    QR = d.quickReplies || [];
    QRF = d.folders || [];
    pageBox().innerHTML = '<div class="pg">' +
      pageHead(L('Шаблони відповідей'), L('Заготовки, які оператор вставляє в листування командою ') +
        L('<b>/імʼя</b>. До шаблону можна додати до трьох файлів — прайс, схему проїзду, інструкцію.')) +
      L('<div class="card"><h3>Новий шаблон</h3>') +
      '<div class="row2" style="display:flex;gap:8px;flex-wrap:wrap">' +
      L('<input id="qsc" placeholder="коротке імʼя, наприклад ціна" style="flex:1;min-width:180px">') +
      /* Папка задаётся при создании, а не после: шаблон создают пачками,
         и переносить потом по одному — та же работа второй раз. Список
         существующих папок подсказкой, но вписать можно и новую. */
      L('<input id="qfd" list="qfdl" placeholder="папка (необовʼязково)" style="flex:1;min-width:150px">') +
      '<datalist id="qfdl">' + qrFolders().map(function(f){
        return '<option value="' + esc(f) + '">';
      }).join('') + '</datalist></div>' +
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

      L('<div class="card"><h3>Папки</h3>') +
      '<div class="acts" style="margin-top:0">' +
      L('<input id="qfdNew" placeholder="назва папки" style="max-width:220px">') +
      L('<button class="ghost" id="qfdAdd">Створити папку</button></div>') +
      L('<div class="hint">Папку можна створити порожньою і скласти в неї шаблони потім. ') +
      L('Видалення папки шаблони не чіпає: вони просто виходять з неї.</div>') +
      '<div class="err" id="qfdErr"></div></div>' +

      L('<div class="card"><h3>Шаблони (') + QR.length + ')</h3>' +
      ((QR.length || QRF.length)
        ? qrGroups(true).map(function(g){
            return '<div class="qfd">' +
              '<span class="nm">' + (g.folder ? esc(g.folder) : L('Без папки')) + '</span>' +
              '<span class="dim">' + g.items.length + '</span>' +
              (g.folder
                ? '<button class="ghost mini" data-ren="' + esc(g.folder) + L('">Перейменувати</button>') +
                  '<button class="ghost mini" data-fdel="' + esc(g.folder) + L('">Видалити папку</button>')
                : '') +
              '</div>' +
              (g.items.length ? g.items.map(qrItem).join('')
                : L('<div class="hint" style="padding:6px 0 10px">Порожня папка. Перекладіть сюди шаблон кнопкою «Папка».</div>'));
          }).join('')
        : L('<div class="hint">Поки порожньо.</div>')) + '</div></div>';

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
        shortcut: el('qsc').value, body: el('qbd').value, folder: el('qfd').value
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

    el('qfdAdd').onclick = function(){
      el('qfdErr').textContent = '';
      var name = el('qfdNew').value.trim();
      if (!name){ el('qfdErr').textContent = L('Впишіть назву папки'); return }
      busy(el('qfdAdd'), true);
      api('/quick-replies/folders', { method:'POST', body:{ name: name } })
        .then(function(){ tabReplies(); toast(L('Папку створено')) })
        .catch(function(e){
          var p = e.payload || {};
          el('qfdErr').textContent = p.error === 'duplicate'
            ? L('Така папка вже є') : L('Не вдалося створити папку');
          busy(el('qfdAdd'), false);
        });
    };

    /* Удаление папки шаблоны не трогает — они выходят из неё. Пишем это
       и в сообщении после удаления: иначе человек будет гадать, куда
       делись заготовки, которые в ней лежали. */
    armDelete(pageBox().querySelectorAll('[data-fdel]'), function(b){
      return api('/quick-replies/folders', { method:'DELETE', body:{ name: b.dataset.fdel } })
        .then(function(r){
          tabReplies();
          renderComposer(true);
          var n = (r && r.moved) || 0;
          toast(n ? L('Папку видалено · шаблонів вийшло з неї: ') + n : L('Папку видалено'));
        });
    });

    /* Перекладывание шаблона. Новая папка заводится прямо отсюда: иначе
       первый шаблон в новую папку положить нечем — она ведь и появляется
       только вместе с ним. */
    Array.prototype.forEach.call(pageBox().querySelectorAll('[data-mv]'), function(sel){
      sel.onchange = function(){
        var id = sel.dataset.mv;
        if (sel.value !== '__new'){ moveReply(id, sel.value); return }
        var inp = document.createElement('input');
        inp.placeholder = L('назва папки');
        inp.style.maxWidth = '150px';
        sel.parentNode.replaceChild(inp, sel);
        inp.focus();
        inp.onkeydown = function(ev){ if (ev.key === 'Enter') inp.blur() };
        inp.onblur = function(){
          var v = inp.value.trim();
          if (v) moveReply(id, v); else tabReplies();
        };
      };
    });

    /* Переименование папки. Одним запросом на всю папку, а не по
       шаблону: на двадцати шаблонах обрыв посередине оставил бы
       половину в старой папке. */
    Array.prototype.forEach.call(pageBox().querySelectorAll('[data-ren]'), function(b){
      b.onclick = function(){
        var head = b.parentNode, from = b.dataset.ren;
        head.innerHTML = '';
        var inp = document.createElement('input');
        inp.value = from;
        inp.style.maxWidth = '220px';
        var ok = document.createElement('button');
        ok.className = 'mini';
        ok.textContent = L('Зберегти');
        var no = document.createElement('button');
        no.className = 'ghost mini';
        no.textContent = L('Скасувати');
        head.appendChild(inp); head.appendChild(ok); head.appendChild(no);
        inp.focus(); inp.select();
        no.onclick = function(){ tabReplies() };
        ok.onclick = function(){
          busy(ok, true);
          var to = inp.value.trim();
          api('/quick-replies/folders', { method:'PATCH', body:{ from: from, to: to } })
            .then(function(){
              tabReplies();
              renderComposer(true);
              // Пустое имя — это не ошибка, а «вынести из папки». Так и
              // говорим, иначе человек решит, что шаблоны пропали.
              toast(to ? L('Папку перейменовано') : L('Шаблони прибрано з папки'));
            })
            .catch(function(e){ busy(ok, false); sErr(e) });
        };
      };
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
  chart:'<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/>',
  tag:'<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0l-7.2-7.2a2 2 0 0 1-.6-1.4V4.8A1.8 1.8 0 0 1 4.6 3h7.2a2 2 0 0 1 1.4.6l7.4 7.4a2 2 0 0 1 0 2.4"/><path d="M7.5 7.5h.01"/>',
  smile:'<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon:'<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  auto:'<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none"/>',
  card:'<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>'
};

function icon(name){
  return '<svg viewBox="0 0 24 24">' + (ICONS[name] || '') + '</svg>';
}

/**
 * Проставляет иконки кнопкам, у которых указан data-icon.
 *
 * Признаком «уже нарисовано» служит сама иконка, а не отметка в
 * данных кнопки. Отметка держалась даже тогда, когда иконку успевали
 * стереть перерисовкой подписей, — и вернуть её было нечем до
 * обновления страницы.
 */
function paintIcons(root){
  Array.prototype.forEach.call((root || document).querySelectorAll('[data-icon]'), function(b){
    if (b.querySelector('svg')) return;
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

/**
 * Фильтры с галочками.
 *
 * Значений в фильтре может быть несколько, и это главное отличие от
 * выпадающего списка: там выбор одного отменял предыдущий, а вопросы у
 * оператора складываются — «мои и ничьи», «в этих двух каналах».
 *
 * Подпись кнопки показывает не количество, а первое имя и сколько ещё:
 * «Telegram +2» человек читает, не открывая, а «вибрано 3» — нет.
 */
function filterOptions(key){
  if (key === 'channelId') {
    return CHANNELS.map(function(c){ return { v:c.id, t:c.display_name || CH[c.type] || c.type } });
  }
  if (key === 'assignee') {
    // Поимённо, а не «мои и ничьи»: чат передают конкретному человеку,
    // и посмотреть, что у него, — первое, что делает старший смены.
    return [{ v:'me', t:L('Мої') }, { v:'none', t:L('Без відповідального') }]
      .concat(MATES.map(function(u){ return { v:u.id, t:u.name } })
        .filter(function(o){ return !(ME && ME.user && o.v === ME.user.id) }));
  }
  if (key === 'tag') {
    return TAGS.map(function(t){ return { v:t.tag, t:t.tag + ' (' + t.count + ')' } });
  }
  return [{ v:'none', t:L('Без статусу') }].concat(STATUSES.map(function(t){
    return { v:t.id, t:t.name };
  }));
}

function filterLabel(key, all){
  var opts = filterOptions(key), sel = F[key];
  if (!sel.length) return all;
  var names = sel.map(function(v){
    for (var i = 0; i < opts.length; i++) if (opts[i].v === v) return opts[i].t;
    return v;
  });
  var first = String(names[0]).split(' (')[0];
  return names.length > 1 ? first + ' +' + (names.length - 1) : first;
}

function paintFilters(){
  [['fCh', 'channelId', L('Усі канали')],
   ['fAs', 'assignee', L('Усі відповідальні')],
   ['fTag', 'tag', L('Усі мітки')],
   ['fSt', 'statusId', L('Усі статуси')]].forEach(function(x){
    var b = el(x[0]);
    if (!b) return;
    // Фильтр, за которым нечего выбирать, не показываем вовсе: пустое
    // окошко обещает срез, которого не существует.
    var has = filterOptions(x[1]).length > 0;
    b.style.display = has ? '' : 'none';
    b.textContent = filterLabel(x[1], x[2]);
    b.classList.toggle('on', F[x[1]].length > 0);
    b.title = b.textContent;
    b.onclick = function(ev){
      ev.stopPropagation();
      openFilter(b, x[1], x[2]);
    };
  });
}

/**
 * Выбор нескольких значений из списка.
 *
 * Вынесено из фильтров чатов, потому что тот же выбор нужен отчётам, а
 * две копии одного окошка разъезжаются в мелочах — и человек привыкает
 * к одному поведению, чтобы наткнуться на другое через экран.
 */
function pickMany(anchor, opts, selected, all, onChange){
  var box = popBox(anchor, 'fpick');
  box.innerHTML = opts.map(function(o){
    return '<label class="fopt"><input type="checkbox" value="' + esc(o.v) + '"' +
      (selected.indexOf(o.v) >= 0 ? ' checked' : '') + '><span>' + esc(o.t) + '</span></label>';
  }).join('') +
    '<div class="fact"><button class="ghost mini" id="fClr">' + esc(all) + '</button></div>';
  popAt(box, anchor);

  function apply(){
    var out = [];
    Array.prototype.forEach.call(box.querySelectorAll('input'), function(i){
      if (i.checked) out.push(i.value);
    });
    onChange(out);
  }

  Array.prototype.forEach.call(box.querySelectorAll('input'), function(i){
    i.onchange = apply;
  });
  // «Усі» — это снять все галочки, а не ещё одно значение в списке.
  el('fClr').onclick = function(){
    Array.prototype.forEach.call(box.querySelectorAll('input'), function(i){ i.checked = false });
    apply();
    box.remove();
  };
}

function openFilter(anchor, key, all){
  pickMany(anchor, filterOptions(key), F[key], all, function(out){
    F[key] = out;
    paintFilters();
    lastList = null;
    refresh();
  });
}

function fillChannelFilter(){ paintFilters() }

/* Метки в фильтре подтягиваются отдельно от списка: список — это
   страница, а фильтр обязан знать про все метки, иначе нужной в нём не
   окажется ровно тогда, когда она понадобится. */
var TAGS = [];

function fillTagFilter(){ paintFilters() }

function loadTags(){
  return api('/tags').then(function(d){ TAGS = d.tags || []; fillTagFilter() }).catch(function(){});
}

/* ══════════════ Свои статусы диалога ══════════════ */

/* Системных статусов четыре, и они про механику. Свои — про работу:
   «Чекаємо оплату», «Передано на склад». Каждый свой статус знает свой
   род — открытый он или закрытый, — и именно род ставит системный
   статус. Поэтому счётчик «Відкриті» остаётся правдой, сколько бы
   статусов ни придумали.

   Палитра повторяет список в packages/core/src/statuses.ts: сервер
   чужой цвет не примет, и показывать выбор, который не сохранится,
   нельзя. Совпадение проверяется тестом, а не доверием. */
var SCOLORS = ['#2563eb','#0ea5e9','#0d9488','#16a34a','#65a30d','#ca8a04',
  '#ea580c','#dc2626','#db2777','#9333ea','#6366f1','#64748b'];

var STATUSES = [];

function statusById(id){
  for (var i = 0; i < STATUSES.length; i++) if (STATUSES[i].id === id) return STATUSES[i];
  return null;
}

function loadStatuses(){
  return api('/statuses').then(function(d){
    STATUSES = d.statuses || [];
    fillStatusFilter();
    lastList = null;
  }).catch(function(){});
}

function fillStatusFilter(){ paintFilters() }

/** Цветная плашка статуса — то, за чем в список и приходят. */
function statusChip(c){
  if (!c.status_id || !c.status_name) return '';
  return '<span class="chip st" style="background-color:' + esc(c.status_color || SCOLORS[0]) +
    '">' + esc(c.status_name) + '</span>';
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


/* ══════════════ Почта ══════════════ */

/**
 * Записи DNS для почтового домена.
 *
 * Показываются целиком и всегда: приём без MX не работает, а отправка
 * без DKIM уезжает в спам. Решать за клиента, что из этого ему «не
 * нужно», мы не вправе — это его домен.
 *
 * Состояние домена не угадывается по времени: есть кнопка, и она
 * спрашивает Resend. DNS расходится десятки минут, и «проверили один
 * раз при подключении» означало бы вечное «ожидаем».
 */
function mlRecords(records){
  if (!records || !records.length) return L('<div class="dim" style="font-size:12.5px">Записів немає.</div>');
  return '<div class="mlrec">' + records.map(function(r){
    return '<div class="mlrow">' +
      '<div class="t">' + esc(r.type || '') + '</div>' +
      '<div class="n">' + esc(r.name || '@') + '</div>' +
      '<div class="v"><code>' + esc(r.value || '') + '</code>' +
        (r.priority != null ? L(' <span class="dim">пріоритет ') + esc(r.priority) + '</span>' : '') +
      '</div>' +
      '<div class="s">' + (String(r.status || '').toLowerCase() === 'verified'
        ? L('<span class="pill ok">є</span>')
        : L('<span class="pill warn">чекаємо</span>')) + '</div>' +
    '</div>';
  }).join('') + '</div>';
}

function mlPanel(id, c){
  var meta = (c && c.meta) || {};
  var box = el('mlBox');
  if (!box) return;

  /*
   * Ящик клиента. Здесь нет ни домена, ни записей DNS — есть адрес,
   * сервера и то, пустила ли почта в последний обход. Показывать ему
   * «очікує записів» значило бы просить добавить то, чего не нужно.
   */
  if (meta.mode === 'mailbox'){
    box.innerHTML =
      L('<div class="pg-sec"><h3>Поштова скринька</h3><div class="tile">') +
      '<div class="kv">' +
        L('<div class="k">Адреса</div><div><code>') + esc(meta.address || '') + '</code></div>' +
        L('<div class="k">IMAP</div><div><code>') + esc(meta.imap || '') + '</code></div>' +
        L('<div class="k">SMTP</div><div><code>') + esc(meta.smtp || '') + '</code></div>' +
        L('<div class="k">Стан</div><div>') +
          (c.lastError ? L('<span class="pill warn">не пускає</span>')
                       : L('<span class="pill ok">читаємо</span>')) + '</div>' +
      '</div>' +
      (c.lastError ? '<div class="err" style="margin-top:8px">' + esc(c.lastError) + '</div>' : '') +
      L('<div class="sub" style="white-space:normal;margin-top:10px">Нові листи забираємо раз на хвилину. ') +
      L('Стару переписку не завантажуємо: у стрічці зʼявляться листи, що прийшли після підключення.</div>') +
      '</div></div>';
    return;
  }

  box.innerHTML =
    L('<div class="pg-sec"><h3>Домен і записи DNS</h3><div class="tile">') +
    '<div class="kv">' +
      L('<div class="k">Адреса</div><div><code>') + esc(meta.address || '') + '</code></div>' +
      L('<div class="k">Стан домену</div><div>') +
        (String(meta.status || '').toLowerCase() === 'verified'
          ? L('<span class="pill ok">підтверджено</span>')
          : L('<span class="pill warn">очікує записів</span>')) + '</div>' +
    '</div>' +
    '<div style="margin-top:10px">' + mlRecords(meta.records) + '</div>' +
    L('<div class="sub" style="white-space:normal;margin-top:10px">Додайте ці записи у свого реєстратора. ') +
    L('MX приймає листи, решта — щоб ваші відповіді не потрапляли в спам. ') +
    L('DNS розходиться до години.</div>') +
    L('<div class="acts"><button class="ghost mini" id="mlCheck">Перевірити</button></div>') +
    '<div class="ok" id="mlOk"></div><div class="err" id="mlErr"></div>' +
    '</div></div>';

  el('mlCheck').onclick = function(){
    busy(el('mlCheck'), true);
    el('mlErr').textContent = '';
    el('mlOk').textContent = '';
    api('/channels/' + id + '/email/verify', { method:'POST' })
      .then(function(r){
        el('mlOk').textContent = r.ready ? L('домен підтверджено') : L('записи ще не бачимо');
        // Канал мог стать рабочим — перечитываем список, чтобы плитка
        // и фильтры показывали новое состояние.
        api('/channels').then(function(d){
          CHANNELS = d.channels || [];
          var upd = null;
          for (var i = 0; i < CHANNELS.length; i++) if (CHANNELS[i].id === id) upd = CHANNELS[i];
          if (upd) mlPanel(id, upd);
        }).catch(function(){});
      })
      .catch(function(e){
        var p = (e && e.payload) || {};
        el('mlErr').textContent = p.error === 'email_unavailable'
          ? L('Пошта не налаштована на сервері')
          : (p.detail || L('Не вдалося перевірити'));
      })
      .then(function(){ if (el('mlCheck')) busy(el('mlCheck'), false) });
  };
}

/** Подключение почтового домена из витрины каналов. */
/* ── Наявна поштова скринька ───────────────────────────────────── */

/**
 * Подключение ящика, который у компании уже есть.
 *
 * Адреса серверов не спрашиваем до последнего: по домену они известны
 * у известных служб, а у своей почты на хостинге почти всегда
 * imap.домен и smtp.домен. Поля рядом, под кнопкой «сервери вручну» —
 * для тех, у кого иначе.
 */
function wireMailbox(){
  if (!el('mbAdd')) return;

  Array.prototype.forEach.call(document.querySelectorAll('[data-mlmode]'), function(b){
    b.onclick = function(){
      var box = b.dataset.mlmode === 'box';
      Array.prototype.forEach.call(document.querySelectorAll('[data-mlmode]'), function(x){
        x.classList.toggle('on', x === b);
      });
      el('mbBox').style.display = box ? '' : 'none';
      el('mlDomBox').style.display = box ? 'none' : '';
    };
  });

  el('mbMore').onclick = function(){
    var open = el('mbHosts').style.display === 'none';
    el('mbHosts').style.display = open ? '' : 'none';
    if (open) mbGuess();
  };

  el('mbAddr').onchange = mbGuess;
  el('mbAdd').onclick = mbConnect;
}

/** Известные службы и правило «imap.домен» — чтобы не спрашивать лишнего. */
var MB_KNOWN = {
  'gmail.com': ['imap.gmail.com', 993, 'smtp.gmail.com', 465,
    L('Для Gmail потрібен пароль застосунку, звичайний пароль не підійде.')],
  'ukr.net': ['imap.ukr.net', 993, 'smtp.ukr.net', 465,
    L('Для ukr.net потрібен пароль для зовнішніх програм з налаштувань скриньки.')],
  'i.ua': ['imap.i.ua', 993, 'smtp.i.ua', 465, ''],
  'meta.ua': ['imap.meta.ua', 993, 'smtp.meta.ua', 465, ''],
  'icloud.com': ['imap.mail.me.com', 993, 'smtp.mail.me.com', 587,
    L('Для iCloud потрібен пароль застосунку Apple.')],
  'zoho.eu': ['imap.zoho.eu', 993, 'smtp.zoho.eu', 465, ''],
  'zoho.com': ['imap.zoho.com', 993, 'smtp.zoho.com', 465, ''],
};

var MB_MICROSOFT = ['outlook.com','hotmail.com','live.com','msn.com','office365.com'];

function mbGuess(){
  var addr = el('mbAddr').value.trim().toLowerCase();
  var at = addr.lastIndexOf('@');
  var dom = at < 0 ? '' : addr.slice(at + 1);
  var note = el('mbNote');

  if (dom && MB_MICROSOFT.filter(function(m){ return dom === m || dom.endsWith('.' + m) }).length){
    note.textContent = L('Microsoft закрила вхід за паролем для пошти — Outlook і 365 сюди не підключаються.');
  } else {
    note.textContent = (MB_KNOWN[dom] && MB_KNOWN[dom][4]) || '';
  }

  var k = MB_KNOWN[dom];
  var ih = k ? k[0] : (dom ? 'imap.' + dom : '');
  var ip = k ? k[1] : 993;
  var sh = k ? k[2] : (dom ? 'smtp.' + dom : '');
  var sp = k ? k[3] : 465;
  // Вписанное руками не затираем: человек мог поправить хост под себя.
  if (!el('mbIH').value) el('mbIH').value = ih;
  if (!el('mbIP').value) el('mbIP').value = String(ip);
  if (!el('mbSH').value) el('mbSH').value = sh;
  if (!el('mbSP').value) el('mbSP').value = String(sp);
}

function mbWhy(p){
  return p.error === 'bad_address' ? L('Схоже на неправильну адресу')
    : p.error === 'no_password' ? L('Впишіть пароль скриньки')
    : p.error === 'microsoft_mail' ? L('Microsoft закрила вхід за паролем — Outlook і 365 сюди не підключаються')
    : p.error === 'bad_imap' ? L('Перевірте сервер IMAP і порт')
    : p.error === 'bad_smtp' ? L('Перевірте сервер SMTP і порт')
    : p.error === 'mailbox_refused' ? (p.detail || L('Пошта не пустила'))
    : p.error === 'address_taken' ? L('Цю скриньку вже підключила інша організація')
    : (p.detail || L('Не вдалося підключити'));
}

function mbConnect(){
  mbGuess();
  el('mbErr').textContent = '';
  var body = {
    address: el('mbAddr').value.trim(),
    pass: el('mbPass').value,
    user: el('mbUser').value.trim(),
    imap: { host: el('mbIH').value.trim(), port: Number(el('mbIP').value) },
    smtp: { host: el('mbSH').value.trim(), port: Number(el('mbSP').value) }
  };
  busy(el('mbAdd'), true);
  api('/settings/channels/mailbox', { method:'POST', body: body })
    .then(function(r){
      toast(L('Скриньку підключено'));
      el('mbPass').value = '';
      return api('/channels').then(function(d){
        CHANNELS = d.channels || [];
        openChannel(r.channelId);
      });
    })
    .catch(function(e){ el('mbErr').textContent = mbWhy((e && e.payload) || {}) })
    .then(function(){ busy(el('mbAdd'), false) });
}

function mlConnect(){
  var domain = el('mlDom').value.trim().toLowerCase();
  var local = el('mlLoc').value.trim().toLowerCase();
  el('mlcErr').textContent = '';
  if (!domain){ el('mlcErr').textContent = L('Впишіть піддомен'); return }
  busy(el('mlAdd'), true);
  api('/settings/channels/email', { method:'POST', body:{ domain: domain, localPart: local } })
    .then(function(r){
      toast(L('Домен заведено — додайте записи DNS'));
      return api('/channels').then(function(d){
        CHANNELS = d.channels || [];
        openChannel(r.channelId);
      });
    })
    .catch(function(e){
      var p = (e && e.payload) || {};
      el('mlcErr').textContent =
        p.error === 'bad_domain' ? L('Схоже на неправильний домен')
        : p.error === 'domain_taken' ? L('Цей домен уже підключила інша організація')
        : p.error === 'public_domain' ? L('Це домен чужої поштової служби — записи DNS там не ваші. Потрібен власний домен або його піддомен')
        : p.error === 'email_unavailable' ? L('Пошта не налаштована на сервері')
        : (p.detail || L('Не вдалося підключити'));
      busy(el('mlAdd'), false);
    });
}

/* ══════════════ Панель владельца платформы ══════════════ */

/**
 * Панель видна только владельцу сервиса — тому, чья почта стоит в
 * PLATFORM_OWNERS. Это не роль внутри организации: администратор
 * клиента здесь не имеет никаких прав, и сервер отвечает ему «нет
 * такой страницы», а не «нельзя».
 *
 * Список сознательно короткий: организация, тариф, оплата, сколько
 * сообщений прошло за месяц. Всё, что нужно, чтобы понять, кому писать
 * счёт и кто перестал пользоваться.
 */
var OWN = { summary:null, list:[], total:0, q:'', open:null };

function ownPill(state){
  if (state === 'partner') return L('<span class="pill ok">партнер</span>');
  if (state === 'paid') return L('<span class="pill ok">оплачено</span>');
  if (state === 'due') return L('<span class="pill warn">спливає</span>');
  return L('<span class="pill crit">не оплачено</span>');
}

function ownMoney(v){
  return v == null ? '—' : String(v);
}

/* ══════════════ Деньги платформы ══════════════ */

/**
 * Свод по деньгам.
 *
 * Отдельной страницей, а не строкой в списке организаций: деньги
 * смотрят не тогда, когда ищут клиента, а тогда, когда считают месяц.
 * Вопросы здесь другие — сколько выставлено, сколько пришло, сколько
 * висит долгом и кто вот-вот отвалится.
 */
var BILLREP = null;

function billMoneyMap(mrr){
  var keys = Object.keys(mrr || {});
  if (!keys.length) return '0';
  return keys.map(function(c){ return mrr[c] + ' ' + c }).join(' + ');
}

function billState(r){
  /* «Прострочено» в продукте уже занято нарушением обещания ответить.
     Для денег своё слово: иначе в отчёте о выручке появляется SLA. */
  return r.state === 'unpaid' ? L('не сплачено')
    : r.state === 'due' ? L('ось-ось')
    : L('оплачено');
}

function billSource(r){
  return r.source === 'paddle' ? L('картка')
    : r.source === 'invoice' ? L('рахунок')
    : L('—');
}

function tabBilling(){
  api('/admin/billing').then(function(d){
    BILLREP = d;
    var t = d.totals || {};

    /* Месяцы рисуем тем же графиком, что и отчёты: выставлено и
       оплачено рядом. Разрыв между столбиками — это и есть долг, и
       увидеть его глазом полезнее, чем прочитать число. */
    var months = (d.months || []).map(function(m){
      return { day: m.month + '-01', inv: m.invoicedUah, paid: m.paidUah };
    });

    pageBox().innerHTML = '<div class="pg">' +
      pageHead(L('Гроші'), L('Виставлено, отримано, борг і хто платить карткою.'),
        L('<button class="ghost mini" id="billCsv">Вивантажити в Excel</button>')) +

      '<div class="nums">' +
        num(t.paying == null ? '—' : t.paying, L('платять')) +
        num(t.overdue == null ? '—' : t.overdue, L('не сплатили')) +
        num(t.paddleActive == null ? '—' : t.paddleActive, L('карткою')) +
        num(t.partners == null ? '—' : t.partners, L('партнери')) +
      '</div>' +

      L('<div class="pg-sec"><h3>На місяць</h3><div class="card">') +
        '<div class="prow"><div class="pk">' + L('План на місяць') + '</div>' +
        '<div class="pv"><b>' + esc(billMoneyMap(t.mrr)) + '</b>' +
        L('<div class="hint" style="margin-top:2px">Сума місячних цін тих, у кого оплата не прострочена. ') +
        L('Валюти не зводимо: курс на сьогодні зробив би вчорашній звіт іншим.</div></div>') +
        '<span></span></div>' +
        '<div class="prow"><div class="pk">' + L('З них тарифи') + '</div>' +
        '<div class="pv">' + esc(billMoneyMap(t.mrrBase)) + '</div><span></span></div>' +
        '<div class="prow"><div class="pk">' + L('З них місця') + '</div>' +
        '<div class="pv">' + esc(billMoneyMap(t.mrrSeats)) +
        L('<div class="hint" style="margin-top:2px">Продано місць понад тариф: ') +
        esc(t.seatsExtra == null ? 0 : t.seatsExtra) + '</div></div><span></span></div>' +
        '<div class="prow"><div class="pk">' + L('Борг') + '</div>' +
        '<div class="pv"><b>' + esc(t.debtUah == null ? '—' : t.debtUah) + L(' грн</b>') +
        L('<div class="hint" style="margin-top:2px">Виставлено рахунками і не оплачено.</div></div>') +
        '<span></span></div>' +
        '<div class="prow"><div class="pk">' + L('Отримано') + '</div>' +
        '<div class="pv"><b>' + esc(t.paidUah == null ? '—' : t.paidUah) + L(' грн</b>') +
        L('<div class="hint" style="margin-top:2px">За весь час, за курсом кожного рахунку.</div></div>') +
        '<span></span></div>' +
      '</div></div>' +

      L('<div class="pg-sec"><h3>По місяцях</h3><div class="card">') +
        vizDays(months, 'inv', 'paid', L('виставлено'), L('оплачено')) +
      '</div></div>' +

      L('<div class="pg-sec"><h3>За тарифами</h3><div class="card">') +
        '<div class="mlrec">' + (d.byPlan || []).map(function(p){
          return '<div class="prow"><div class="pk">' + esc(p.plan) + '</div>' +
            '<div class="pv">' + esc(p.tenants) + L(' організацій · ') +
            esc(billMoneyMap(p.mrr)) + L(' на місяць</div>') +
            '<span></span></div>';
        }).join('') + '</div>' +
      '</div></div>' +

      L('<div class="pg-sec"><h3>Організації</h3><div class="card">') +
        '<div class="mlrec">' + (d.rows || []).map(function(r){
          return '<div class="prow"><div class="pk">' + esc(r.name || r.slug) + '</div>' +
            '<div class="pv">' + esc(r.plan) + ' · ' + esc(billSource(r)) +
            (r.monthTotal ? ' · ' + esc(r.monthTotal) + ' ' + esc(r.currency) : '') +
            (r.perSeat
              ? L('<div class="hint" style="margin-top:2px">Користувачів: ') + esc(r.seats) +
                ' × ' + esc(r.seatPrice) + ' = ' + esc(r.seatsMonth) + ' ' + esc(r.currency) +
                '</div>'
              : r.seatsExtra
              ? L('<div class="hint" style="margin-top:2px">Місць: ') + esc(r.seats) +
                L(', понад тариф ') + esc(r.seatsExtra) + ' × ' + esc(r.seatPrice) +
                ' = ' + esc(r.seatsMonth) + ' ' + esc(r.currency) + '</div>'
              : '') +
            L('<div class="hint" style="margin-top:2px">') + esc(billState(r)) +
            (r.paidUntil ? L(' до ') + esc(fmtDate(r.paidUntil)) : '') +
            (r.debtUah ? L(' · борг ') + esc(r.debtUah) + L(' грн') : '') +
            '</div></div>' +
            '<span class="pill' + (r.state === 'unpaid' ? ' crit' : r.state === 'due' ? ' warn' : ' ok') +
            '">' + esc(billState(r)) + '</span></div>';
        }).join('') + '</div>' +
      '</div></div>' +
    '</div>';

    wireTips();
    el('billCsv').onclick = billExport;
  }).catch(sErr);
}

/**
 * Выгрузка.
 *
 * Одна таблица со всеми полями, а не красивый отчёт: человек открывает
 * её в Excel, чтобы посчитать своё — то, чего мы не предусмотрели.
 * Красивое он сделает сам, а недостающую колонку не выдумает.
 */
function billExport(){
  if (!BILLREP) return;
  csvDump('rozmovio-groshi',
    [L('Організація'), L('Ідентифікатор'), L('Тариф'), L('Вид'), L('Місць'),
     L('Місць у тарифі'), L('Понад тариф'), L('Ціна місця'), L('Місця на місяць'),
     L('Чим платить'), L('Ціна тарифу'), L('Разом на місяць'), L('Валюта'),
     L('Стан'), L('Оплачено до'),
     L('Рахунків'), L('Отримано, грн'), L('Борг, грн'), L('Остання оплата'),
     L('Підписка Paddle'), L('Створено')],
    (BILLREP.rows || []).map(function(r){
      return [r.name, r.slug, r.plan, r.kind, r.seats,
        r.seatsFree, r.seatsExtra, r.seatPrice, r.seatsMonth,
        billSource(r), r.priceMonth, r.monthTotal, r.currency,
        billState(r), r.paidUntil || '', r.invoices, r.paidUah, r.debtUah,
        r.lastPaidAt ? String(r.lastPaidAt).slice(0, 10) : '',
        r.paddleStatus || '', String(r.createdAt).slice(0, 10)];
    }));
}

function tabOwner(){
  OWN.open = null;
  Promise.all([
    api('/admin/summary'),
    api('/admin/tenants?limit=50&q=' + encodeURIComponent(OWN.q)),
    api('/admin/settings').catch(function(){ return { settings:null } })
  ]).then(function(r){
    OWN.summary = r[0];
    OWN.list = r[1].tenants || [];
    OWN.total = r[1].total || 0;
    OWNSET = (r[2] && r[2].settings) || {};
    paintOwner();
  }).catch(sErr);
}

function paintOwner(){
  var s = OWN.summary || {}, st = OWNSET || {};
  pageBox().innerHTML = '<div class="pg">' +
    pageHead(L('Власник'), L('Організації, тарифи й оплати. Видно тільки вам.')) +
    '<div class="nums">' +
      num(s.tenants, L('організацій')) +
      num(s.fresh, L('нових цього місяця')) +
      num(s.active, L('писали цього місяця')) +
      num(s.paying, L('платять')) +
      num(s.mrr, L('на місяць')) +
      num(s.messages, L('повідомлень за місяць')) +
    '</div>' +

    L('<div class="pg-sec"><h3>Організації</h3>') +
    '<div class="row2" style="margin-bottom:10px">' +
      L('<input id="oq" placeholder="назва або адреса" value="') + esc(OWN.q) + '">' +
      L('<button class="ghost mini" id="ofind">Знайти</button></div>') +
    (OWN.list.length
      ? OWN.list.map(ownRow).join('')
      : L('<div class="empty">Нічого не знайшли</div>')) +
    (OWN.total > OWN.list.length
      ? L('<div class="hint">Показано ') + OWN.list.length + L(' з ') + OWN.total +
        L('. Звузьте пошук.</div>')
      : '') +
    '</div>' +

    /* Прайс. Тариф в трёх валютах: цена подставляется в карточке
       клиента сама, и одинаковые клиенты перестают стоить по-разному. */
    L('<div class="pg-sec"><h3>Ціни за тарифами</h3><div class="card">') +
      '<div class="mlrec">' + PLANS.map(function(pl){
        var row = (st.plan_prices || {})[pl] || {};
        /* Что именно за цена — подписано у самого поля. «6» в строке
           corporate означает шесть за человека, а не шесть за кабинет,
           и перепутать это стоит дороже всего остального на экране. */
        return '<div class="pricerow"><div class="t">' + esc(pl) +
          (PER_SEAT_PLANS.indexOf(pl) >= 0 ? L('<div class="s">за користувача</div>') : '') +
          '</div>' +
          INV_CUR.map(function(c){
            return '<input data-price="' + pl + '" data-cur="' + c + '" placeholder="' + c +
              '" value="' + esc(row[c] == null ? '' : row[c]) + '">';
          }).join('') + '</div>';
      }).join('') + '</div>' +
      L('<div class="hint">Порожньо — ціни в цій валюті немає, і підставлятися вона не буде. ') +
      L('Ціна тут — це щомісячна оплата; за рік беремо десять таких, тобто два місяці у подарунок. ') +
      L('У тарифі за користувача ціна множиться на кількість людей сама.</div>') +
      L('<div class="row2" style="margin-top:8px"><button class="ghost mini" id="pSave">Зберегти ціни</button>') +
      L('<button class="ghost mini" id="pPaddle">Завести тарифи в Paddle</button></div>') +
      '<span class="ok" id="pOk"></span>' +
      L('<div class="hint">Створює товар і дві ціни — місячну і річну — з тих цін, що вище. ') +
      L('Уже заведене не чіпає, тому натискати можна скільки завгодно.</div>') +
      '<div class="err" id="pPadErr"></div>' +
    '</div></div>' +

    /* Реквизиты. Лежат здесь, а не в карточке клиента: они одни на все
       счета, и повторять их у каждого клиента незачем. */
    L('<div class="pg-sec"><h3>Реквізити для рахунків</h3><div class="card">') +
      '<div class="row2">' +
        L('<input id="sName" placeholder="ФОП або ТОВ" value="') + esc(st.seller_name || '') + '">' +
        L('<input id="sTax" placeholder="ЄДРПОУ / ІПН" value="') + esc(st.seller_tax_id || '') + '">' +
      '</div>' +
      '<div class="row2" style="margin-top:8px">' +
        L('<input id="sIban" placeholder="IBAN" value="') + esc(st.seller_iban || '') + '">' +
        L('<input id="sBank" placeholder="банк" value="') + esc(st.seller_bank || '') + '">' +
      '</div>' +
      '<div class="row2" style="margin-top:8px">' +
        L('<input id="sMfo" placeholder="МФО банку" style="max-width:150px" value="') +
          esc(st.seller_bank_code || '') + '">' +
        L('<input id="sPhone" placeholder="телефон" value="') + esc(st.seller_phone || '') + '">' +
      '</div>' +
      '<div class="row2" style="margin-top:8px">' +
        L('<input id="sAddr" placeholder="адреса" value="') + esc(st.seller_address || '') + '">' +
        L('<input id="sSign" placeholder="хто підписує, напр. К. В. Сластін" value="') +
          esc(st.seller_signer || '') + '">' +
      '</div>' +
      '<div class="row2" style="margin-top:8px">' +
        L('<input id="sPref" placeholder="префікс номера" style="max-width:150px" value="') +
          esc(st.invoice_prefix || '') + '">' +
      '</div>' +
      L('<input id="sNote" placeholder="примітка в рахунку, напр. «Без ПДВ»" style="margin-top:8px" value="') +
        esc(st.seller_note || '') + '">' +
      L('<div class="row2" style="margin-top:8px"><button class="ghost mini" id="sSave">Зберегти</button></div>') +
      '<span class="ok" id="sOk"></span>' +
      L('<div class="hint">Це видно клієнту в друкованому рахунку. Номер виглядає як ') +
        esc((st.invoice_prefix || '') + new Date().getFullYear() + '-0001') + '.</div>' +
    '</div></div>' +
    '</div>';

  el('ofind').onclick = function(){ OWN.q = el('oq').value.trim(); tabOwner() };
  el('pSave').onclick = function(){
    var prices = {};
    Array.prototype.forEach.call(document.querySelectorAll('[data-price]'), function(x){
      var v = x.value.trim();
      if (!v) return;
      prices[x.dataset.price] = prices[x.dataset.price] || {};
      prices[x.dataset.price][x.dataset.cur] = v;
    });
    busy(el('pSave'), true);
    api('/admin/settings', { method:'PATCH', body:{ planPrices: prices } })
      .then(function(){
        el('pOk').textContent = L('збережено');
        OWNSET = Object.assign({}, OWNSET, { plan_prices: prices });
      })
      .catch(showErr).then(function(){ busy(el('pSave'), false) });
  };

  /* Товары в Paddle. Кнопка, а не действие при сохранении цен: завести
     товар — шаг необратимый, и делать его молча за человека нельзя. */
  el('pPaddle').onclick = function(){
    el('pPadErr').textContent = '';
    el('pOk').textContent = '';
    busy(el('pPaddle'), true);
    api('/owner/paddle/sync', { method:'POST' })
      .then(function(d){
        var done = (d.done || []).length;
        var bad = d.failed || [];
        el('pOk').textContent = done
          ? L('заведено цін: ') + done
          : (bad.length ? '' : L('усе вже заведено'));
        if (bad.length){
          el('pPadErr').textContent = bad.map(function(f){
            return f.plan + (f.period ? ' (' + f.period + ')' : '') + ': ' +
              (f.why === 'no_price' ? L('ціну не задано') : f.why);
          }).join('; ');
        }
      })
      .catch(function(e){
        el('pPadErr').textContent = billWhy(e);
      })
      .then(function(){ busy(el('pPaddle'), false) });
  };

  el('sSave').onclick = function(){
    busy(el('sSave'), true);
    api('/admin/settings', { method:'PATCH', body:{
      sellerName: el('sName').value, sellerTaxId: el('sTax').value,
      sellerIban: el('sIban').value, sellerBank: el('sBank').value,
      sellerBankCode: el('sMfo').value, sellerPhone: el('sPhone').value,
      sellerSigner: el('sSign').value,
      sellerAddress: el('sAddr').value, sellerNote: el('sNote').value,
      invoicePrefix: el('sPref').value
    }}).then(function(){
      el('sOk').textContent = L('збережено');
      // Прайс не трогаем: он в этом же объекте, и собрать OWNSET заново
      // из полей формы значило бы стереть его до следующей загрузки.
      OWNSET = Object.assign({}, OWNSET, {
        seller_name: el('sName').value, seller_tax_id: el('sTax').value,
        seller_iban: el('sIban').value, seller_bank: el('sBank').value,
        seller_bank_code: el('sMfo').value, seller_phone: el('sPhone').value,
        seller_signer: el('sSign').value,
        seller_address: el('sAddr').value, seller_note: el('sNote').value,
        invoice_prefix: el('sPref').value
      });
    }).catch(showErr).then(function(){ busy(el('sSave'), false) });
  };
  el('oq').onkeydown = function(e){ if (e.key === 'Enter') el('ofind').click() };
  Array.prototype.forEach.call(document.querySelectorAll('[data-org]'), function(b){
    b.onclick = function(){ ownOpen(b.dataset.org) };
  });
}

function ownRow(t){
  var last = t.lastAt ? L('останнє ') + fmtDate(t.lastAt) : L('без повідомлень');
  return '<div class="item" data-org="' + esc(t.id) + '" style="cursor:pointer">' +
    '<div><div class="t">' + esc(t.name) + ' ' + ownPill(t.pay) +
      (t.status === 'suspended' ? L('<span class="pill crit">призупинено</span>') : '') + '</div>' +
    '<div class="s">' + esc(t.plan) + ' · ' +
      L('людей: ') + t.users + ' · ' + L('каналів: ') + t.channels + ' · ' +
      L('повідомлень за місяць: ') + t.messagesMonth + ' · ' + esc(last) + '</div></div>' +
    '<div style="flex:none;text-align:right">' +
      '<div style="font-weight:700">' +
        (t.priceMonth == null ? '—' : esc(t.priceMonth) + ' ' + esc(t.currency)) + '</div>' +
      '<div class="s">' + (t.paidUntil ? L('до ') + esc(fmtDate(t.paidUntil)) : L('без оплати')) + '</div>' +
    '</div></div>';
}

var PLANS = ['trial','start','pro','custom'];

function ownOpen(id){
  api('/admin/tenants/' + id).then(function(d){
    OWN.open = d;
    paintOrg();
  }).catch(sErr);
}

function paintOrg(){
  var d = OWN.open, t = d.tenant, c = d.counts || {};
  var months = d.months || [];
  var top = Math.max.apply(null, [1].concat(months.map(function(m){
    return Number(m.msg_in) + Number(m.msg_out);
  })));

  pageBox().innerHTML = '<div class="pg">' +
    pageHead(t.name, esc(t.slug) + ' · ' + L('з ') + esc(fmtDate(t.createdAt)) + ' · ' +
      esc(t.source) + ' ' + ownPill(t.pay)) +
    L('<button class="ghost mini" id="oback">← До списку</button>') +

    '<div class="nums" style="margin-top:12px">' +
      num(c.users, L('людей')) +
      num(c.channels, L('каналів')) +
      num(c.conversations, L('діалогів')) +
      num(c.messagesMonth, L('повідомлень за місяць')) +
    '</div>' +

    L('<div class="pg-sec"><h3>Тариф</h3><div class="card">') +
      '<div class="row2">' +
        '<select id="oplan">' + PLANS.map(function(p){
          return '<option value="' + p + '"' + (t.plan === p ? ' selected' : '') + '>' + p + '</option>';
        }).join('') + '</select>' +
        /* Вид кабинета. Партнёрский не платит по определению, и «оплачено
           до» у него не спрашивают: это не оплаченный период. */
        '<select id="okind">' +
          L('<option value="client">клієнт</option>') +
          '<option value="partner"' + (t.kind === 'partner' ? ' selected' : '') + '>' +
            L('партнер') + '</option>' +
        '</select>' +
        '<select id="ostatus">' +
          L('<option value="active">працює</option>') +
          '<option value="suspended"' + (t.status === 'suspended' ? ' selected' : '') + '>' +
            L('призупинено') + '</option>' +
        '</select>' +
      '</div>' +
      '<div class="row2" style="margin-top:8px">' +
        L('<input id="oseats" type="number" min="1" placeholder="місць" value="') + esc(t.seatsLimit) + '">' +
        L('<input id="oprice" placeholder="ціна на місяць" value="') + esc(t.priceMonth == null ? '' : t.priceMonth) + '">' +
        '<select id="ocur" style="max-width:100px">' + INV_CUR.map(function(c){
          return '<option value="' + c + '"' + (t.currency === c ? ' selected' : '') + '>' + c + '</option>';
        }).join('') + '</select>' +
        '<input id="opaid" type="date" value="' + esc(t.paidUntil || '') + '"' +
          (t.kind === 'partner' ? ' disabled' : '') + '>' +
      '</div>' +
      /* Пробный период продлевают чаще всего на неделю-две, и считать
         дату в уме ради этого незачем. Кнопки двигают поле, а не
         сохраняют: решение остаётся за человеком. */
      (t.kind === 'partner'
        ? ''
        : L('<div class="row2" style="margin-top:6px"><button class="ghost mini" data-days="7">+7 днів</button>') +
          L('<button class="ghost mini" data-days="14">+14 днів</button>') +
          L('<button class="ghost mini" data-days="30">+30 днів</button>') +
          L('<button class="ghost mini" data-days="0">Завершити сьогодні</button>') +
          '<div class="hint" id="oleft" style="align-self:center"></div></div>') +
      /* Места сверх тарифа. Отдельной строкой, потому что это отдельные
         деньги: пятнадцать операторов на тарифе с десятью — не тот же
         счёт, что десять. На тарифе по головам эта пара полей не нужна
         вовсе: там платят за каждого по цене из прайса, и поля гаснут
         сами — заполненными они означали бы вторую цену на то же. */
      '<div class="row2" style="margin-top:8px">' +
        L('<input id="ofree" type="number" min="0" placeholder="місць у тарифі" value="') +
          esc(t.seatsFree == null ? '' : t.seatsFree) + '">' +
        L('<input id="oseatp" placeholder="ціна за користувача" value="') +
          esc(t.seatPrice ? t.seatPrice : '') + '">' +
        '<div class="hint" id="oseatSum" style="align-self:center"></div>' +
      '</div>' +
      (t.kind === 'partner'
        ? L('<div class="hint">Партнерський кабінет: оплата не потрібна, у списку він завжди «партнер».</div>')
        : '') +
      /* Реквизиты клиента. Их вписывает и сам клиент у себя, но чаще
         они приезжают письмом в поддержку — и тогда вписывать их
         должно быть где-то здесь, а не «попросите клиента зайти». */
      L('<div class="lbl" style="margin-top:12px">Реквізити для рахунків</div>') +
      '<div class="row2" style="margin-top:6px">' +
        L('<input id="tqName" placeholder="повна назва" value="') + esc(t.legalName || '') + '">' +
        L('<input id="tqTax" placeholder="ЄДРПОУ / РНОКПП" value="') + esc(t.taxId || '') + '">' +
        L('<input id="tqVat" placeholder="ІПН" value="') + esc(t.vatId || '') + '">' +
      '</div>' +
      '<div class="row2" style="margin-top:8px">' +
        L('<input id="tqAddr" placeholder="юридична адреса" value="') + esc(t.legalAddress || '') + '">' +
        L('<input id="tqSign" placeholder="хто підписує" value="') + esc(t.signer || '') + '">' +
      '</div>' +
      '<div class="row2" style="margin-top:8px">' +
        L('<input id="tqIban" placeholder="IBAN" value="') + esc(t.iban || '') + '">' +
        L('<input id="tqBank" placeholder="банк" value="') + esc(t.bankName || '') + '">' +
        L('<input id="tqMfo" placeholder="МФО" style="max-width:120px" value="') +
          esc(t.bankCode || '') + '">' +
      '</div>' +
      '<label class="ochk"><input type="checkbox" id="tqVatp"' + (t.vatPayer ? ' checked' : '') +
        '> ' + L('платник ПДВ') + '</label>' +
      L('<textarea id="onote" rows="2" placeholder="Нотатка про клієнта" style="margin-top:8px">') +
        esc(t.note || '') + '</textarea>' +
      L('<div class="row2" style="margin-top:8px"><button class="ghost mini" id="osave">Зберегти</button>') +
      L('<button class="ghost mini" id="ologin">Увійти як клієнт</button></div>') +
      '<span class="ok" id="ook"></span><div class="err" id="oerr"></div>' +
    '</div></div>' +

    /* Счета. Стоят выше оплат: сначала выставляют, потом платят, и
       порядок на экране повторяет порядок в жизни. */
    L('<div class="pg-sec"><h3>Рахунки</h3><div class="card">') +
      '<div class="row2">' +
        L('<input id="iamt" placeholder="сума">') +
        '<select id="icur">' + INV_CUR.map(function(c){
          return '<option value="' + c + '">' + c + '</option>';
        }).join('') + '</select>' +
        '<input id="iday" type="date" value="' + esc(today()) + '">' +
        L('<button class="ghost mini" id="iadd">Виставити</button>') +
      '</div>' +
      '<div class="row2" style="margin-top:8px">' +
        L('<input id="ips" type="date" title="період з">') +
        L('<input id="ipe" type="date" title="період до">') +
        L('<input id="isub" placeholder="призначення платежу">') +
      '</div>' +
      '<div class="hint" id="irate"></div>' +
      '<div style="margin-top:10px">' +
        ((d.invoices || []).length
          ? d.invoices.map(invRow).join('')
          : L('<div class="dim" style="font-size:12.5px">Рахунків ще не було.</div>')) +
      '</div>' +
      '<div class="err" id="ierr"></div>' +
    '</div></div>' +

    L('<div class="pg-sec"><h3>Оплати</h3><div class="card">') +
      '<div class="row2">' +
        L('<input id="pamt" placeholder="сума">') +
        '<input id="pend" type="date">' +
        L('<input id="pmet" placeholder="спосіб">') +
        L('<button class="ghost mini" id="padd">Внести</button>') +
      '</div>' +
      L('<div class="hint">Дата — кінець оплаченого періоду. «Оплачено до» посунеться сама, ') +
      L('але тільки вперед.</div>') +
      '<div style="margin-top:10px">' +
        ((d.payments || []).length
          ? d.payments.map(function(p){
              return '<div class="item"><div><div class="t">' + esc(p.amount) + ' ' + esc(p.currency) +
                (p.period_end ? L(' — до ') + esc(fmtDate(p.period_end)) : '') + '</div>' +
                '<div class="s">' + esc(fmtDate(p.created_at)) +
                (p.method ? ' · ' + esc(p.method) : '') +
                (p.created_by ? ' · ' + esc(p.created_by) : '') + '</div></div>' +
                '<span class="x" data-pay="' + esc(p.id) + '" style="cursor:pointer">×</span></div>';
            }).join('')
          : L('<div class="dim" style="font-size:12.5px">Оплат ще не було.</div>')) +
      '</div>' +
    '</div></div>' +

    L('<div class="pg-sec"><h3>Повідомлення по місяцях</h3><div class="card">') +
      (months.length
        ? '<div class="kv2">' + months.map(function(m){
            var total = Number(m.msg_in) + Number(m.msg_out);
            return '<div class="k">' + esc(m.month) + '</div><div>' +
              '<span style="display:inline-block;height:8px;border-radius:4px;background:var(--accent);' +
              'width:' + Math.round(total / top * 160) + 'px;vertical-align:middle"></span> ' +
              esc(total) + L(' (вх. ') + esc(m.msg_in) + L(', вих. ') + esc(m.msg_out) + ')</div>';
          }).join('') + '</div>'
        : L('<div class="dim" style="font-size:12.5px">Повідомлень ще не було.</div>')) +
    '</div></div>' +

    L('<div class="pg-sec"><h3>Хто всередині</h3><div class="card">') +
      (d.users || []).map(function(u){
        return '<div class="item"><div><div class="t">' + esc(u.full_name || u.email) +
          (u.is_active ? '' : L('<span class="pill warn">відключений</span>')) + '</div>' +
          '<div class="s">' + esc(u.email) + ' · ' + esc(u.role) +
          (u.last_seen_at ? ' · ' + L('був ') + esc(fmtDate(u.last_seen_at)) : L(' · ще не заходив')) +
          '</div></div></div>';
      }).join('') +
      L('<h4 style="margin-top:12px">Канали</h4>') +
      ((d.channels || []).length
        ? '<div class="kv2">' + d.channels.map(function(ch){
            return '<div class="k">' + esc(CH[ch.type] || ch.type) + '</div><div>' +
              esc(ch.display_name || '') + ' · ' + esc(ch.status) + '</div>';
          }).join('') + '</div>'
        : L('<div class="dim" style="font-size:12.5px">Каналів немає.</div>')) +
    '</div></div>' +

    /* Журнал: сюда попадают входы под клиентом и правки тарифа. Он и
       есть плата за право войти в чужую переписку. */
    L('<div class="pg-sec"><h3>Журнал</h3><div class="card">') +
      ((d.audit || []).length
        ? d.audit.map(function(a){
            return '<div class="note">' + esc(a.action) +
              '<div class="who">' + esc(a.actor_email) + ' · ' + esc(fmtTime(a.created_at)) +
              ' · ' + esc(JSON.stringify(a.detail || {})) + '</div></div>';
          }).join('')
        : L('<div class="dim" style="font-size:12.5px">Записів немає.</div>')) +
    '</div></div>' +
    '</div>';

  el('oback').onclick = tabOwner;
  el('osave').onclick = ownSave;

  /* Итог считаем прямо под полями. Человек, который ставит цену места,
     должен видеть, во что она превращается, не открывая калькулятор.

     На тарифе по головам считать нечего вручную вовсе: цена человека
     берётся из прайса, умножается на число людей — и поля базы и
     включённых мест гаснут, чтобы оставшаяся в них цифра от прошлого
     тарифа не давала суммы, которой нет в счёте. */
  function seatSum(){
    var cur = el('ocur').value;
    var all = Number(el('oseats').value) || 0;
    var per = ownPerSeat();
    if (per) {
      var one = ownSeatPrice();
      el('oseatSum').textContent = one
        ? all + ' × ' + one + ' = ' + (Math.round(all * one * 100) / 100) + ' ' + cur +
          L(' / місяць')
        : L('ціни за користувача немає в прайсі');
      return;
    }
    var free = Number(el('ofree').value) || 0;
    var price = Number(String(el('oseatp').value).replace(',', '.')) || 0;
    var extra = Math.max(0, all - free);
    el('oseatSum').textContent = extra
      ? L('понад тариф: ') + extra + ' × ' + price + ' = ' +
        (Math.round(extra * price * 100) / 100) + ' ' + el('ocur').value
      : L('усі місця входять у тариф');
  }

  /* Поля, которых на этом тарифе нет: гасим, а не прячем. Исчезнувшее
     поле человек ищет, погасшее — понимает. */
  function seatMode(){
    var per = ownPerSeat();
    el('oprice').disabled = per;
    el('ofree').disabled = per;
    // Погасшее поле с цифрой читается как цифра, которая считается.
    // Она не считается — значит, её там быть не должно.
    if (per) { el('oprice').value = ''; el('ofree').value = '' }
    el('oprice').placeholder = per ? L('не застосовується') : L('ціна на місяць');
    el('ofree').placeholder = per ? L('не застосовується') : L('місць у тарифі');
    el('oseatp').placeholder = per ? L('своя ціна за користувача') : L('ціна місця понад тариф');
    seatSum();
  }

  ['oseats', 'ofree', 'oseatp', 'ocur'].forEach(function(id){
    if (el(id)) el(id).oninput = seatSum;
    if (el(id)) el(id).onchange = seatSum;
  });
  seatMode();
  /* Сколько осталось — словами, рядом с полем: дата сама по себе
     требует счёта в уме, а «минув 3 дні тому» не требует. */
  function daysLeft(){
    var box = el('oleft');
    if (!box) return;
    var v = el('opaid').value;
    if (!v){ box.textContent = L('строк не задано — доступ не обмежений'); return }
    var days = Math.round((new Date(v + 'T00:00:00Z') - new Date(today() + 'T00:00:00Z')) / 86400000);
    box.textContent = days > 0 ? L('залишилось днів: ') + days
      : days === 0 ? L('останній день')
      : L('минув днів тому: ') + (-days);
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-days]'), function(btn){
    btn.onclick = function(){
      var add = Number(btn.dataset.days);
      var base = add > 0 && el('opaid').value && el('opaid').value > today()
        ? el('opaid').value
        : today();
      var d = new Date(base + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + add);
      el('opaid').value = d.toISOString().slice(0, 10);
      daysLeft();
    };
  });
  if (el('opaid')) el('opaid').onchange = daysLeft;
  daysLeft();
  el('oplan').onchange = function(){ ownPrice(); seatMode() };
  el('ocur').onchange = function(){ ownPrice(); seatMode() };
  el('okind').onchange = function(){
    // Партнёру дата оплаты не нужна: он не платит.
    el('opaid').disabled = el('okind').value === 'partner';
  };
  // Счёт по умолчанию — на месячную цену организации в её валюте:
  // базу плюс места или цену людей, смотря какой тариф. Девять раз из
  // десяти выставляют именно её, а десятый правится одним полем.
  if (!el('iamt').value && ownMonth()) el('iamt').value = ownMonth();
  if (t.currency) el('icur').value = t.currency;

  el('iadd').onclick = invIssue;
  el('icur').onchange = invRate;
  el('iday').onchange = invRate;
  el('iamt').onblur = invRate;
  invRate();
  Array.prototype.forEach.call(document.querySelectorAll('[data-iprint]'), function(x){
    x.onclick = function(){
      var v = (OWN.open.invoices || []).filter(function(i){ return i.id === x.dataset.iprint })[0];
      if (v) invPrint(v);
    };
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-ipaid]'), function(x){
    x.onclick = function(){
      busy(x, true);
      api('/admin/tenants/' + OWN.open.tenant.id + '/invoices/' + x.dataset.ipaid + '/paid',
        { method:'POST' }).then(function(){ ownOpen(OWN.open.tenant.id) }).catch(showErr);
    };
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-ivoid]'), function(x){
    x.onclick = function(){
      busy(x, true);
      api('/admin/tenants/' + OWN.open.tenant.id + '/invoices/' + x.dataset.ivoid + '/void',
        { method:'POST' }).then(function(){ ownOpen(OWN.open.tenant.id) }).catch(showErr);
    };
  });
  el('ologin').onclick = ownLogin;
  el('padd').onclick = ownPay2;
  Array.prototype.forEach.call(document.querySelectorAll('[data-pay]'), function(x){
    x.onclick = function(){
      api('/admin/tenants/' + OWN.open.tenant.id + '/payments/' + x.dataset.pay, { method:'DELETE' })
        .then(function(){ ownOpen(OWN.open.tenant.id) }).catch(showErr);
    };
  });
}

/* ── Счета ────────────────────────────────────────────────────────── */

var INV_CUR = ['UAH','USD','EUR'];
var OWNSET = null;

function today(){
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function money2(v){
  var n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : String(v == null ? '' : v);
}

/** Курс — четыре знака: две копейки здесь означают другую сумму в счёте. */
function rate4(v){
  var n = Number(v);
  return Number.isFinite(n) ? n.toFixed(4) : String(v == null ? '' : v);
}

/**
 * Строка счёта.
 *
 * Курс показан вместе с днём, за который он объявлен: на выходные курса
 * нет, и «курс НБУ на п’ятницю» — не придирка, а то, что человек будет
 * объяснять клиенту.
 */
function invRow(v){
  var paid = v.status === 'paid', dead = v.status === 'void';
  var cur = v.currency || 'UAH';
  return '<div class="item"' + (dead ? ' style="opacity:.55"' : '') + '>' +
    '<div><div class="t">' + esc(v.number) + ' · ' + esc(money2(v.amount)) + ' ' + esc(cur) +
      (paid ? L('<span class="pill ok">оплачено</span>')
        : dead ? L('<span class="pill crit">скасовано</span>')
        : L('<span class="pill warn">виставлено</span>')) + '</div>' +
    '<div class="s">' + esc(fmtDate(v.issued_on)) +
      (cur !== 'UAH'
        ? ' · ' + esc(money2(v.amount_uah)) + L(' грн за курсом ') + esc(rate4(v.rate)) +
          (v.rate_day ? L(' на ') + esc(fmtDate(v.rate_day)) : '') +
          (v.rate_source === 'manual' ? L(' (вписаний руками)') : '')
        : '') +
      (v.period_end ? L(' · період до ') + esc(fmtDate(v.period_end)) : '') +
      (v.subject ? ' · ' + esc(v.subject) : '') +
    '</div></div>' +
    '<div style="display:flex;gap:6px;flex:none">' +
      L('<button class="ghost mini" data-iprint="') + esc(v.id) + L('">Друк</button>') +
      (paid || dead ? '' :
        L('<button class="ghost mini" data-ipaid="') + esc(v.id) + L('">Оплачено</button>') +
        L('<button class="ghost mini" data-ivoid="') + esc(v.id) + L('">Скасувати</button>')) +
    '</div></div>';
}

/** Курс подставляется до выставления: сумма в гривнах не должна быть сюрпризом. */
function invRate(){
  var cur = el('icur').value, day = el('iday').value || today();
  var box = el('irate');
  if (!box) return;
  if (cur === 'UAH'){ box.textContent = L('Гривня — без перерахунку.'); return }
  box.textContent = L('Питаємо курс НБУ...');
  api('/admin/rate?code=' + encodeURIComponent(cur) + '&day=' + encodeURIComponent(day))
    .then(function(r){
      var amt = Number(String(el('iamt').value).replace(',', '.')) || 0;
      box.textContent = L('Курс НБУ ') + rate4(r.rate) + L(' на ') + fmtDate(r.day) +
        (amt ? ' · ' + money2(amt * r.rate) + L(' грн') : '');
    })
    .catch(function(){
      box.textContent = L('Курс НБУ не отримали — сума піде за курсом 1, впишіть його руками пізніше');
    });
}

function invIssue(){
  var t = OWN.open.tenant;
  el('ierr').textContent = '';
  busy(el('iadd'), true);
  api('/admin/tenants/' + t.id + '/invoices', { method:'POST', body:{
    amount: el('iamt').value,
    currency: el('icur').value,
    issuedOn: el('iday').value || today(),
    periodStart: el('ips').value || null,
    periodEnd: el('ipe').value || null,
    subject: el('isub').value
  }}).then(function(){ ownOpen(t.id) })
    .catch(function(e){
      var p = (e && e.payload) || {};
      el('ierr').textContent =
        p.error === 'bad_amount' ? L('Впишіть суму')
        : p.error === 'no_rate' ? L('НБУ не дав курсу на цей день — спробуйте іншу дату')
        : L('Не вдалося виставити рахунок');
      busy(el('iadd'), false);
    });
}

/**
 * Печатная форма счёта.
 *
 * Собирается в браузере и открывается отдельным окном: серверная
 * страница потребовала бы токена в адресе, а адрес с токеном уходит в
 * историю браузера и в чужие руки. Печать в PDF — средствами самого
 * браузера, ничего своего изобретать не нужно.
 */
/*
 * Счёт на оплату в том виде, в каком его принимает чужая бухгалтерия.
 *
 * Сверху — образец заполнения платёжного поручения: его вырезают и
 * несут в банк те, кто платит бумагой, а остальные списывают оттуда
 * реквизиты. Дальше сам счёт: кто продавец, кто покупатель, что именно
 * куплено, сумма цифрами и прописью, подписи сторон.
 *
 * Пропись обязательна: это защита от дописанной цифры и первое, что
 * сверяет бухгалтер. Счёт без неё возвращают.
 *
 * Одна разметка на кабинет и на панель владельца: два счёта за одну
 * услугу не должны выглядеть по-разному оттого, что их печатали из
 * разных мест.
 */
function invoiceHtml(v, seller, buyer, due){
  var s = seller || {}, b = buyer || {};
  var cur = v.currency || 'UAH';
  var uah = cur !== 'UAH';
  // Платят в гривне: валюта тарифа — это то, в чём считали, а платёжка
  // всегда в гривне, по курсу дня выставления.
  var total = uah ? Number(v.amount_uah) : Number(v.amount);
  var words = v.words || '';
  // Отметка о НДС в назначении платежа и под суммой — про продавца:
  // платит покупатель, но налог начисляет тот, кто выставил счёт. Мы
  // не плательщики НДС, и в счёте это должно стоять прямо.
  var vatSum = L('без ПДВ');
  // А вот эта строка — про покупателя: её ищет его же бухгалтерия.
  var vatBuyer = b.vat_payer ? L('Включений до реєстру платників ПДВ') : L('Не платник ПДВ');

  function line(label, value){
    return value ? '<div><span class="k">' + esc(label) + '</span> ' + esc(value) + '</div>' : '';
  }

  var sellerBlock =
    line(L('Адреса: '), s.seller_address) +
    line('IBAN: ', s.seller_iban) +
    line(L('Банк: '), s.seller_bank) +
    line(L('МФО: '), s.seller_bank_code) +
    line(L('Код: '), s.seller_tax_id) +
    line(L('Телефон: '), s.seller_phone);

  var buyerBlock =
    line(L('Код ЄДРПОУ / РНОКПП: '), b.tax_id) +
    line(L('ІПН: '), b.vat_id) +
    line(L('Адреса: '), b.legal_address) +
    line('IBAN: ', b.iban) +
    line(L('Банк: '), b.bank_name) +
    line(L('МФО: '), b.bank_code);

  return '<!DOCTYPE html><html lang="uk"><head><meta charset="utf-8"><title>' +
    esc(L('Рахунок ') + v.number) + '</title><style>' +
    'body{font:13px/1.45 "Times New Roman",Georgia,serif;color:#000;margin:28px;max-width:760px}' +
    '.pay{border:1px solid #000;padding:10px 12px;margin-bottom:26px}' +
    '.pay h2{font-size:12px;text-align:center;margin:0 0 10px;font-weight:700}' +
    '.pay .r{display:flex;gap:10px;margin:4px 0}.pay .r b{min-width:150px}' +
    'h1{font-size:16px;margin:0 0 14px;text-decoration:underline}' +
    '.side{display:flex;gap:10px;margin-bottom:8px}' +
    '.side .t{min-width:96px;color:#000}.side .n{font-weight:700}' +
    '.side .k{display:inline-block;min-width:0}' +
    'table{width:100%;border-collapse:collapse;margin:16px 0 10px}' +
    'th,td{border:1px solid #000;padding:5px 7px;font-size:12.5px}' +
    'th{background:#faf7e8;text-align:center;font-weight:700}' +
    'td.n{text-align:right}td.c{text-align:center}' +
    '.tot{text-align:right;font-weight:700}' +
    '.words{margin:10px 0 18px}' +
    '.sign{display:flex;border:1px solid #000;margin-top:10px}' +
    '.sign>div{flex:1;padding:10px 12px;font-size:12.5px}' +
    '.sign>div:first-child{border-right:1px solid #000}' +
    '.sign .h{font-weight:700;margin-bottom:6px}' +
    '.sign .l{margin-top:26px;border-top:1px solid #000;width:200px;text-align:center;font-size:11px}' +
    '.note{margin-top:18px;font-size:11.5px;color:#333}' +
    '@media print{body{margin:10mm}}</style></head><body>' +

    '<div class="pay"><h2>' + L('Зразок заповнення платіжного доручення') + '</h2>' +
    '<div class="r"><b>' + L('Одержувач') + '</b><span>' + esc(s.seller_name || '—') + '</span></div>' +
    '<div class="r"><b>' + L('Код') + '</b><span>' + esc(s.seller_tax_id || '—') + '</span></div>' +
    '<div class="r"><b>' + L('Рахунок') + '</b><span>' + esc(s.seller_iban || '—') + '</span></div>' +
    '<div class="r"><b>' + L('Банк одержувача') + '</b><span>' + esc(s.seller_bank || '—') +
      (s.seller_bank_code ? L(', МФО ') + esc(s.seller_bank_code) : '') + '</span></div>' +
    '<div class="r" style="margin-top:10px"><span>' + L('Оплата згідно рахунку № ') +
      esc(v.number) + L(' від ') + esc(fmtDate(v.issued_on)) + ' ' + esc(vatSum) +
      '</span></div></div>' +

    '<h1>' + L('Рахунок на оплату № ') + esc(v.number) + L(' від ') + esc(fmtDate(v.issued_on)) + '</h1>' +

    '<div class="side"><div class="t">' + L('Постачальник:') + '</div><div>' +
      '<div class="n">' + esc(s.seller_name || '—') + '</div>' + sellerBlock + '</div></div>' +

    '<div class="side"><div class="t">' + L('Покупець:') + '</div><div>' +
      '<div class="n">' + esc(b.legal_name || b.name || '—') + '</div>' + buyerBlock +
      '<div>' + esc(vatBuyer) + '</div></div></div>' +

    '<table><tr><th style="width:36px">№</th><th>' + L('Найменування послуги') + '</th>' +
    '<th style="width:60px">' + L('Кіл-сть') + '</th><th style="width:52px">' + L('Од.') + '</th>' +
    '<th style="width:96px">' + L('Ціна, грн') + '</th><th style="width:110px">' +
    L('Вартість, грн') + '</th></tr>' +
    '<tr><td class="c">1</td><td>' + esc(v.subject || L('Послуги Rozmovio')) +
      (v.period_start || v.period_end
        ? '<br><span style="font-size:11.5px">' + L('період ') + esc(fmtDate(v.period_start)) +
          ' — ' + esc(fmtDate(v.period_end)) + '</span>'
        : '') +
      '</td><td class="c">1,00</td><td class="c">' + L('посл.') + '</td>' +
      '<td class="n">' + esc(money2(total)) + '</td><td class="n">' + esc(money2(total)) + '</td></tr>' +
    '<tr><td colspan="5" class="tot">' + L('Всього до сплати:') + '</td>' +
      '<td class="n"><b>' + esc(money2(total)) + '</b></td></tr></table>' +

    '<div class="words">' + L('Всього найменувань 1, на суму ') + esc(money2(total)) +
      L(' грн (') + esc(words) + '), ' + esc(vatSum) + '.' +
      (uah
        ? '<div style="font-size:11.5px;margin-top:4px">' + L('Тариф ') + esc(money2(v.amount)) +
          ' ' + esc(cur) + L(' за курсом НБУ ') + esc(rate4(v.rate)) + L(' на ') +
          esc(fmtDate(v.rate_day || v.issued_on)) + '</div>'
        : '') +
    '</div>' +

    '<div class="sign"><div><div class="h">' + L('Виконавець') + '</div>' +
      '<div>' + esc(s.seller_name || '—') + '</div>' + sellerBlock +
      '<div class="l">' + esc(s.seller_signer || '') + L('<br>(підпис)</div></div>') +
    '<div><div class="h">' + L('Замовник') + '</div>' +
      '<div>' + esc(b.legal_name || b.name || '—') + '</div>' + buyerBlock +
      '<div class="l">' + esc(b.signer || '') + L('<br>(підпис)</div></div></div>') +

    '<div class="note">' + L('Рахунок дійсний до ') +
      esc(fmtDate(v.due_on || v.issued_on)) + L(' Якщо протягом ') + esc(due || 3) +
      L(' днів кошти не надійдуть, ми попросимо квитанцію про оплату; без неї доступ до кабінету призупиняється до підтвердження платежу.') +
      (s.seller_note ? '<br>' + esc(s.seller_note) : '') +
    '</div></body></html>';
}

/* Печать: окно открывается ради неё одной, поэтому сразу и печатаем. */
function invoicePrint(html, onBlocked){
  var w = window.open('', '_blank');
  if (!w){ if (onBlocked) onBlocked(); return }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(function(){ try { w.print() } catch(e){} }, 250);
}

function invPrint(v){
  var t = OWN.open.tenant;
  // Карточка организации отдаёт реквизиты в своём написании — приводим
  // к тому, в каком их ждёт бланк. Второго бланка ради этого заводить
  // не станем: счёт один, откуда бы его ни печатали.
  var buyer = {
    name: t.name,
    legal_name: t.legalName,
    tax_id: t.taxId,
    vat_id: t.vatId,
    legal_address: t.legalAddress,
    bank_name: t.bankName,
    iban: t.iban,
    bank_code: t.bankCode,
    vat_payer: t.vatPayer,
    signer: t.signer
  };
  invoicePrint(invoiceHtml(v, OWNSET || {}, buyer, 3), function(){
    el('ierr').textContent = L('Браузер заблокував вікно друку');
  });
}

/**
 * Цена по прайсу.
 *
 * Тариф и валюта выбраны — цену незачем вспоминать и вписывать руками:
 * так у трёх клиентов на одном тарифе оказываются три разные цены,
 * про которые через месяц никто не помнит, откуда они взялись.
 *
 * Своя цена при этом остаётся возможной: поле обычное, и вписанное в
 * него не затирается, пока человек сам не сменит тариф или валюту.
 */
function ownPrice(){
  var prices = (OWNSET && OWNSET.plan_prices) || {};
  var byCur = prices[el('oplan').value] || {};
  var v = byCur[el('ocur').value];
  /* На тарифе по головам цена из прайса — цена одного человека, а не
     кабинета: подставить её в «ціна на місяць» значило бы приписать
     сверху ещё одного оператора. Там базы нет вовсе. */
  if (ownPerSeat()) el('oprice').value = '';
  else if (v != null) el('oprice').value = v;
  // Валюта счёта идёт за валютой тарифа: счёт выставляют в той же.
  if (el('icur')) { el('icur').value = el('ocur').value; invRate() }
  if (el('iamt')) el('iamt').value = ownMonth() || el('iamt').value;
}

/** Тариф считается за каждого пользователя. То же правило, что в ядре. */
var PER_SEAT_PLANS = ['custom'];

function ownPerSeat(){
  return PER_SEAT_PLANS.indexOf(el('oplan').value) >= 0;
}

/* Цена за человека: своя, если владелец договорился отдельно, иначе из
   прайса. Ровно то же правило, что на сервере. */
function ownSeatPrice(){
  var own = Number(String(el('oseatp').value).replace(',', '.')) || 0;
  if (own > 0) return own;
  var byCur = ((OWNSET && OWNSET.plan_prices) || {})[el('oplan').value] || {};
  return Number(String(byCur[el('ocur').value] || '').replace(',', '.')) || 0;
}

/**
 * Сколько организация платит в месяц — по тем же правилам, что на сервере.
 *
 * Нужно для счёта: сумма в нём должна совпадать с той, что видит
 * клиент, иначе спор начинается с вопроса «а откуда цифра».
 */
function ownMonth(){
  var seats = Number(el('oseats').value) || 0;
  if (ownPerSeat()) return Math.round(seats * ownSeatPrice() * 100) / 100;
  var base = Number(String(el('oprice').value).replace(',', '.')) || 0;
  var free = Number(el('ofree').value) || 0;
  var seat = Number(String(el('oseatp').value).replace(',', '.')) || 0;
  return Math.round((base + Math.max(0, seats - free) * seat) * 100) / 100;
}

function ownSave(){
  var t = OWN.open.tenant;
  el('oerr').textContent = '';
  busy(el('osave'), true);
  api('/admin/tenants/' + t.id, { method:'PATCH', body:{
    plan: el('oplan').value,
    kind: el('okind').value,
    status: el('ostatus').value,
    seatsLimit: Number(el('oseats').value) || 1,
    /* На тарифе по головам включённых мест нет и базы нет: пишем нули,
       а не оставляем цифры от прошлого тарифа. Оставленные, они не
       видны на экране, но попадают в свод по деньгам. */
    seatsFree: ownPerSeat() ? 0 : Number(el('ofree').value) || 0,
    seatPrice: el('oseatp').value,
    priceMonth: ownPerSeat() ? 0 : el('oprice').value,
    legalName: el('tqName').value,
    taxId: el('tqTax').value,
    vatId: el('tqVat').value,
    legalAddress: el('tqAddr').value,
    bankName: el('tqBank').value,
    iban: el('tqIban').value,
    bankCode: el('tqMfo').value,
    vatPayer: el('tqVatp').checked,
    signer: el('tqSign').value,
    currency: el('ocur').value,
    paidUntil: el('opaid').value || null,
    note: el('onote').value
  }}).then(function(){
    el('ook').textContent = L('збережено');
    ownOpen(t.id);
  }).catch(function(e){
    el('oerr').textContent = ((e && e.payload) || {}).error || L('Не вдалося зберегти');
  }).then(function(){ busy(el('osave'), false) });
}

function ownPay2(){
  var t = OWN.open.tenant;
  el('oerr').textContent = '';
  busy(el('padd'), true);
  api('/admin/tenants/' + t.id + '/payments', { method:'POST', body:{
    amount: el('pamt').value,
    currency: el('ocur') ? el('ocur').value : 'UAH',
    periodEnd: el('pend').value || null,
    method: el('pmet').value
  }}).then(function(){ ownOpen(t.id) })
    .catch(function(e){
      el('oerr').textContent = ((e && e.payload) || {}).error === 'bad_amount'
        ? L('Впишіть суму') : L('Не вдалося внести оплату');
    })
    .then(function(){ busy(el('padd'), false) });
}

/**
 * Вход под клиентом.
 *
 * Свой токен сохраняем рядом, а не выбрасываем: выход обратно должен
 * быть одним нажатием, иначе владелец каждый раз входит заново.
 * Токен клиента живёт час и помечен отметкой входа — в организации
 * остаётся запись, кто именно приходил.
 */
function ownLogin(){
  var t = OWN.open.tenant;
  // Подтверждение в самой кнопке, а не отдельным окном: вход в чужую
  // переписку не должен случаться с одного промаха мышью, но и
  // выпрыгивающее окно ради этого заводить незачем.
  var b = el('ologin');
  if (b.dataset.sure !== '1'){
    b.dataset.sure = '1';
    b.textContent = L('Точно увійти?');
    setTimeout(function(){
      if (el('ologin') && el('ologin').dataset.sure === '1'){
        el('ologin').dataset.sure = '';
        el('ologin').textContent = L('Увійти як клієнт');
      }
    }, 4000);
    return;
  }
  busy(el('ologin'), true);
  api('/admin/tenants/' + t.id + '/login', { method:'POST' })
    .then(function(r){
      try { localStorage.setItem('omnidesk_owner_token', TOKEN) } catch(e){}
      TOKEN = r.token;
      tokenWrite(r.token);
      location.reload();
    })
    .catch(function(e){
      el('oerr').textContent = ((e && e.payload) || {}).error === 'no_users'
        ? L('В організації немає жодного активного користувача')
        : L('Не вдалося увійти');
      busy(el('ologin'), false);
    });
}

/** Полоса «вы под клиентом»: без неё легко забыть, от чьего имени пишешь. */
function ownBar(){
  var by = ME && ME.platform && ME.platform.impersonatedBy;
  var box = el('impbar');
  if (!box) return;
  if (!by){ box.style.display = 'none'; return }
  box.style.display = 'flex';
  box.innerHTML = L('<span>Ви працюєте як «') + esc((ME.tenant && ME.tenant.name) || '') +
    L('» — це видно в журналі організації</span>') +
    L('<button class="ghost mini" id="impout">Повернутись</button>');
  el('impout').onclick = function(){
    var mine = '';
    try { mine = localStorage.getItem('omnidesk_owner_token') || '' } catch(e){}
    try { localStorage.removeItem('omnidesk_owner_token') } catch(e){}
    if (mine){ TOKEN = mine; tokenWrite(mine); location.reload() }
    else logout();
  };
}

var VIEWS = {
  owner: tabOwner,
  billing: tabBilling,
  channels: tabChannels,
  bots: renderBots,
  replies: tabReplies,
  statuses: tabStatuses,
  reports: tabReports,
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
  // Панель владельца платформы. Признак приходит с сервера и роли в
  // организации не касается: администратор клиента её не увидит.
  var plat = ME && ME.platform;
  Array.prototype.forEach.call(document.querySelectorAll('[data-owner]'), function(b){
    b.style.display = plat && plat.owner ? '' : 'none';
  });
  ownBar();
  if (!(plat && plat.owner) && el('app').dataset.view === 'owner') setView('chats');
  // Если оператор стоял в закрытом для него разделе — возвращаем в чаты.
  if (!admin && el('app').dataset.view !== 'chats' && el('app').dataset.view !== 'profile'){
    setView('chats');
  }
}

function isAdmin(){ return ROLE === 'owner' || ROLE === 'admin' }

function start(){
  applyLang();
  wireTips();
  el('cardVeil').onclick = function(){ cardDrawer(false) };
  el('cardX').onclick = function(){ cardDrawer(false) };
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
  loadTags();
  loadStatuses();
  api('/teammates').then(function(d){ MATES = d.users || []; paintFilters() }).catch(function(){});
  api('/quick-replies').then(function(d){
    QR = d.quickReplies || [];
    QRF = d.folders || [];
  }).catch(function(){});
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

paintFilters();

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
