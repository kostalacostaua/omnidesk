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

export const UI_BUILD = '2026-09-22-5';

export const INBOX_HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="omnidesk-build" content="${UI_BUILD}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<title>Rozmovio</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<script data-theme-boot>${THEME_JS}${EMOJI_JS}</script>
<style>
  /* ═══ Оформление ═══
     Токены, теги и готовые блоки живут в theme.ts — одном месте на весь
     продукт: и рабочее место, и промо-страница берут их оттуда. Здесь
     ниже — только то, что есть исключительно в рабочем месте: раскладка
     из четырёх колонок, список диалогов, переписка, панель разделов. */
  ${BRAND_CSS}
  .qrwrap{display:flex;gap:20px;align-items:center;flex-wrap:wrap;margin:14px 0 4px;
    padding:16px;border:1px solid var(--line);border-radius:12px;background:var(--bg)}
  .qr{width:220px;height:220px;background:#fff;border-radius:10px;padding:8px;flex:none}
  .qr svg{width:100%;height:100%;display:block}
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
  #app{display:none;grid-template-columns:66px 316px minmax(0,1fr) 284px;height:100vh}
  #app.no-card{grid-template-columns:66px 316px minmax(0,1fr)}
  #app[data-view="bots"]{grid-template-columns:66px minmax(0,1fr)}
  #app[data-view="bots"] #list,#app[data-view="bots"] #thread,
  #app[data-view="bots"] #card{display:none}
  #app[data-view="chats"] #bots{display:none}
  #app.no-card #card{display:none}
  @media(max-width:1180px){#app{grid-template-columns:66px 306px minmax(0,1fr)}
    #app #card{display:none}}
  @media(max-width:820px){
    #app{grid-template-columns:56px minmax(0,1fr)}
    #app.thread-open #list{display:none}
    #app:not(.thread-open) #thread{display:none}}

  /* ─── Панель разделов ──────────────────────────────────────────── */
  #rail{background:var(--rail);border-right:1px solid var(--line);display:flex;
    flex-direction:column;align-items:center;padding:12px 0;gap:2px}
  #rail .logo{width:30px;height:30px;display:flex;align-items:center;justify-content:center;
    margin-bottom:14px}
  #rail .logo svg{width:28px;height:28px;display:block}
  .rbtn{background:transparent;border:0;color:var(--railT);width:52px;padding:8px 0;
    border-radius:6px;font-size:10px;font-weight:600;display:flex;flex-direction:column;
    align-items:center;gap:5px;cursor:pointer;line-height:1.2;position:relative}
  .rbtn svg{width:19px;height:19px;stroke:currentColor;fill:none;stroke-width:1.6;
    stroke-linecap:round;stroke-linejoin:round}
  .rbtn{box-shadow:none;transition:background-color .13s ease,color .13s ease,transform .06s ease}
  .rbtn:hover{color:var(--t1);background:var(--hover)}
  .rbtn:active{transform:scale(.94)}
  .rbtn.on{color:var(--railOn);background:var(--railOnBg)}
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
  #gate h1{font-size:25px;font-weight:800;letter-spacing:-.03em;margin:0 0 6px}
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
  .lhead b{font-size:17px;font-weight:800;letter-spacing:-.025em}
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
  .thead .nm{font-size:15px;font-weight:800;letter-spacing:-.02em}
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
  .pg{max-width:1080px;margin:0 auto;padding:30px 28px 60px}
  .pg-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;
    margin-bottom:22px;flex-wrap:wrap}
  .pg-head h2{margin:0;font-size:26px;font-weight:800;letter-spacing:-.03em;
    font-family:var(--font-display,var(--font))}
  .pg-head p{margin:6px 0 0;color:var(--t2);font-size:13px;max-width:62ch;line-height:1.55}
  .pg-sec{margin-top:26px}
  .pg-sec h3{margin:0 0 12px;font-size:12px;text-transform:uppercase;letter-spacing:.09em;
    color:var(--t3);font-weight:700}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:14px}
  .tile{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:16px;
    backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur);box-shadow:var(--shadow);
    display:flex;flex-direction:column;gap:10px;
    transition:box-shadow .2s ease,transform .12s cubic-bezier(.2,.8,.3,1),border-color .2s ease}
  .tile.click{cursor:pointer}
  .tile.click:hover{box-shadow:var(--lift);transform:translateY(-2px);border-color:var(--line2)}
  .tile .t1{display:flex;gap:11px;align-items:center;min-width:0}
  .tile .ttl{font-weight:700;font-size:14px;letter-spacing:-.01em;overflow:hidden;
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
</style>
</head>
<body>

<div id="gate">
  <div class="box">
    <div class="mark"><svg viewBox="0 0 100 100" aria-label="Rozmovio"><defs><linearGradient id="gmk" x1="10" y1="8" x2="92" y2="94" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#2F6BFF"/><stop offset="1" stop-color="#7A3CF0"/></linearGradient></defs><path fill-rule="evenodd" fill="url(#gmk)" d="M6 22A16 16 0 0 1 22 6H60A32 32 0 0 1 92 38A28 28 0 0 1 72 64.6L93 90.5A5 5 0 0 1 89 94H67.5A5 5 0 0 1 63.6 92.1L44 67L25.2 91.2A8 8 0 0 1 6 86ZM32 23H62A9 9 0 0 1 71 32V41A9 9 0 0 1 62 50H43L30.5 60.5A1.5 1.5 0 0 1 28 59.4V50.2A9 9 0 0 1 23 42V32A9 9 0 0 1 32 23Z"/></svg></div>

    <div id="stepEmail" class="step">
      <h1>Rozmovio</h1>
      <p>Все переписки с клиентами — в одном окне. Введите рабочую почту, и мы пришлём код из шести цифр.</p>
      <input id="email" type="email" placeholder="you@company.com" autocomplete="email">
      <div class="err" id="gateErr"></div>
      <div style="margin-top:14px"><button id="ask">Получить код</button></div>
      <div class="alt"><a id="toSignup">Создать компанию</a> · <a id="toToken">Вход по токену</a></div>
    </div>

    <div id="stepSignup" class="step" style="display:none">
      <h1>Новая компания</h1>
      <p>Четырнадцать дней бесплатно. Пароль придумывать не нужно — вход по коду на почту.</p>
      <input id="suCompany" placeholder="Название компании" autocomplete="organization">
      <input id="suEmail" type="email" placeholder="you@company.com" autocomplete="email"
             style="margin-top:9px">
      <div class="err" id="suErr"></div>
      <div class="row2" style="margin-top:14px">
        <button id="suGo">Создать</button>
        <button class="ghost" id="suBack">Назад</button>
      </div>
    </div>

    <div id="stepCode" class="step" style="display:none">
      <h1>Код отправлен</h1>
      <p>Проверьте почту <b id="sentTo"></b>. Код действует 10 минут.</p>
      <input id="code" inputmode="numeric" maxlength="6" placeholder="000000" autocomplete="one-time-code">
      <div class="err" id="codeErr"></div>
      <div class="row2" style="margin-top:14px">
        <button id="verify">Войти</button>
        <button class="ghost" id="again">Другая почта</button>
      </div>
    </div>

    <div id="stepWs" class="step" style="display:none">
      <h1>Куда входим?</h1>
      <p>Эта почта заведена в нескольких организациях.</p>
      <div id="wsList"></div>
    </div>

    <div id="stepToken" class="step" style="display:none">
      <h1>Вход по токену</h1>
      <p>Токен выдаёт команда на сервере:
        <code>docker compose exec api node apps/api/dist/seed.js --name "Компания" --email you@example.com</code>
      </p>
      <input id="tok" type="password" placeholder="eyJhbGciOi..." autocomplete="off">
      <div class="err" id="tokErr"></div>
      <div class="row2" style="margin-top:14px">
        <button id="enter">Войти</button>
        <button class="ghost" id="toEmail">Назад к почте</button>
      </div>
    </div>

    <div class="foot">Telegram, Instagram и Messenger в одном окне — и в карточке клиента в Zoho CRM.</div>
  </div>
</div>

<div id="app" data-view="chats">
  <nav id="rail">
    <div class="logo" id="logo" title="К чатам" style="cursor:pointer"><svg viewBox="0 0 100 100" aria-label="Rozmovio"><defs><linearGradient id="rzg" x1="10" y1="8" x2="92" y2="94" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#2F6BFF"/><stop offset="1" stop-color="#7A3CF0"/></linearGradient></defs><path fill-rule="evenodd" fill="url(#rzg)" d="M6 22A16 16 0 0 1 22 6H60A32 32 0 0 1 92 38A28 28 0 0 1 72 64.6L93 90.5A5 5 0 0 1 89 94H67.5A5 5 0 0 1 63.6 92.1L44 67L25.2 91.2A8 8 0 0 1 6 86ZM32 23H62A9 9 0 0 1 71 32V41A9 9 0 0 1 62 50H43L30.5 60.5A1.5 1.5 0 0 1 28 59.4V50.2A9 9 0 0 1 23 42V32A9 9 0 0 1 32 23Z"/></svg></div>
    <button class="rbtn on" data-view="chats" data-icon="chat">Чаты<span class="cnt" id="railCnt" style="display:none"></span></button>
    <button class="rbtn" data-view="channels" data-icon="plug">Каналы</button>
    <button class="rbtn" data-view="bots" data-icon="bot">Сценарии</button>
    <button class="rbtn" data-view="replies" data-icon="bolt">Шаблоны</button>
    <button class="rbtn" data-view="integrations" data-icon="link">Интеграции</button>
    <button class="rbtn" data-view="users" data-icon="team">Команда</button>
    <div class="grow"></div>
    <button class="rbtn" id="themeTitle" data-icon="sun">Тема</button>
    <button class="rbtn" id="bell" data-icon="bell">Звук</button>
    <button class="rbtn" data-view="profile" data-icon="gear">Профиль</button>
    <button class="rbtn" id="out" data-icon="exit">Выйти</button>
  </nav>

  <div id="list">
    <div class="lhead">
      <div class="top"><b>Чаты</b><button class="ghost mini" id="cardBtn">Клиент</button></div>
      <div class="filters">
        <select id="fCh"><option value="">Все каналы</option></select>
        <select id="fAs">
          <option value="all">Все ответственные</option>
          <option value="me">Мои</option>
          <option value="none">Без ответственного</option>
        </select>
      </div>
      <div class="search"><input id="fQ" placeholder="Поиск по имени или телефону" autocomplete="off"></div>
      <div class="tabs">
        <button class="tab on" data-status="open">Открытые<span class="n" id="nOpen"></span></button>
        <button class="tab" data-status="closed">Закрытые<span class="n" id="nClosed"></span></button>
        <button class="tab" data-status="all">Все</button>
      </div>
    </div>
    <div id="convs"></div>
  </div>

  <div id="thread">
    <div class="thead" id="thead"><div class="dim">Выберите диалог слева</div></div>
    <div id="msgs"></div>
    <div class="composer" id="composer" style="display:none"></div>
  </div>

  <aside id="card"><div class="empty">Карточка клиента появится, когда откроете диалог</div></aside>

  <main id="page"></main>
</div>

<div id="toast" role="status" aria-live="polite"></div>


<script>
(function(){
'use strict';

var TOKEN = sessionStorage.getItem('omnidesk_token') || '';
var current = null, convs = [], timer = null;
var QR = [], CHANNELS = [], USERS = [], ME = null, COUNTS = {};
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

function fmtTime(iso){
  if (!iso) return '';
  var d = new Date(iso), now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})
    : d.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'});
}

function fmtDate(iso){
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ru-RU',{day:'2-digit',month:'long',year:'numeric'});
}

var CH = { telegram_bot:'Telegram', telegram_business:'Telegram Business',
  telegram_user:'Telegram номерной', whatsapp_cloud:'WhatsApp', whatsapp:'WhatsApp',
  whatsapp_user:'WhatsApp номерной', instagram:'Instagram',
  messenger:'Messenger', viber_bot:'Viber', viber_user:'Viber номерной' };

var ROLES = { owner:'Владелец', admin:'Администратор', agent:'Оператор', viewer:'Наблюдатель' };

function statusLabel(s){
  return { pending:'отправляется', sent:'отправлено', delivered:'доставлено',
           read:'прочитано', failed:'не доставлено' }[s] || s;
}

/** Окно ответа считаем на клиенте — лишний запрос ради этого не нужен. */
function windowState(c){
  if (!c || !c.window_expires_at || c.window_type === 'none') return { open:true };
  var left = new Date(c.window_expires_at) - new Date();
  if (left <= 0) return { open:false };
  var h = Math.floor(left/3600000), m = Math.floor(left%3600000/60000);
  return { open:true, left: h > 0 ? h + ' ч ' + m + ' мин' : m + ' мин' };
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
      (F.q ? 'Ничего не найдено.' : 'Пока пусто.<br>Напишите своему боту — диалог появится здесь.') +
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
        '<div class="r1"><span class="nm">' + esc(c.display_name || 'Без имени') + '</span>' +
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

function openConv(id){
  current = id;
  lastThread = null;
  replyTo = null;
  pendingFile = null;
  el('app').classList.add('thread-open');
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
  if (!c){ el('thead').innerHTML = '<div class="dim">Выберите диалог слева</div>'; return }

  var w = windowState(c);
  var closed = c.status === 'resolved';
  var mine = ME && ME.user && c.assignee_id === ME.user.id;

  el('thead').innerHTML =
    '<button class="ghost mini back" id="aBack" title="К списку чатов">← Чаты</button>' +
    '<div class="who">' +
      '<div class="av" data-av="' + c.contact_id + '" style="background-color:' +
        avatarColor(c.display_name || c.id) + '">' + esc(initials(c.display_name)) + '</div>' +
      '<div style="min-width:0"><div class="nm">' + esc(c.display_name || 'Без имени') + '</div>' +
      '<div class="sub">' + esc(CH[c.channel_type] || c.channel_type) +
        (w.open && w.left ? ' · окно ответа ещё ' + w.left : (w.open ? '' : ' · окно закрыто')) +
        ' · ' + esc(c.assignee_name || 'без ответственного') +
      '</div></div>' +
    '</div>' +
    '<div class="acts">' +
      (mine ? '' : '<button class="ghost mini" id="aTake">Взять себе</button>') +
      '<button class="ghost mini" id="aBot" title="' + esc(botState(c).why) + '">Бот: ' +
        esc(botState(c).label) + '</button>' +
      '<button class="' + (closed ? '' : 'ghost ') + 'mini" id="aClose">' +
        (closed ? 'Открыть заново' : 'Закрыть чат') + '</button>' +
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
      if (closing) toast('Чат закрыт. Он во вкладке «Закрытые» и вернётся в «Открытые», как только клиент напишет.');
    });
  };
  el('aBack').onclick = backToList;
}

/** Возврат к списку. На узком экране список и переписка не помещаются вместе. */
function backToList(){
  el('app').classList.remove('thread-open');
}

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
  if (!c.bot_enabled) return { label:'выкл', why:'Автоответы выключены для этого диалога' };
  if (c.assignee_id) return { label:'пауза', why:'У диалога есть ответственный — бот не вмешивается' };
  if (c.human_replied_at && (new Date() - new Date(c.human_replied_at)) < 30*60*1000) {
    return { label:'пауза', why:'Оператор отвечал менее 30 минут назад. Бот включится сам' };
  }
  return { label:'вкл', why:'Бот отвечает на подходящие сообщения' };
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
        (m.sender_type === 'bot' ? ' · бот' : '') +
        (isOut ? ' · ' + statusLabel(m.status) : '');

      // Цитата. Текст берём с сервера, если исходное сообщение нашлось,
      // иначе — сохранённый снимок из самого сообщения: клиент мог
      // ответить на то, чего у нас нет.
      var qText = m.reply_to_text || c.replyToText;
      var quote = (qText || c.replyToExternalId)
        ? '<div class="quote"><b>' +
            esc(m.reply_to_direction === 'out' ? 'Вы' : (c.replyToName || 'Клиент')) + '</b>' +
            esc(qText || 'сообщение') + '</div>'
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
          '<button data-reply="' + m.id + '">Ответить</button>' +
          (m.external_id ? '<button data-react="' + m.id + '">Реакция</button>' : '') +
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
        ? 'Файл больше 20 МБ — Telegram не отдаёт его боту'
        : 'Вложение недоступно';
      return '<div class="att"><div class="wait">' + esc(why) + '</div></div>';
    }
    if (!a.storageKey) {
      // Кнопка повтора нужна не для красоты: если задача на скачивание
      // не создалась (воркер лежал, не было сети), файл не подтянется
      // никогда — состояние «загружается» будет вечным.
      return '<div class="att"><div class="wait">' +
        esc(labelFor(a.type)) + ' загружается... ' +
        '<span class="x" data-retry="' + messageId + '" data-i="' + i +
        '" style="cursor:pointer;text-decoration:underline">повторить</span></div></div>';
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
  return { image:'Изображение', video:'Видео', voice:'Голосовое сообщение',
           audio:'Аудио', document:'Документ', sticker:'Стикер' }[t] || 'Вложение';
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
    box.innerHTML = '<div class="blocked"><b>Окно ответа закрыто.</b> ' +
      'Свободный текст отправить нельзя — так устроены правила канала, ' +
      'а не наше приложение. Доступны только одобренные шаблоны.</div>';
    return;
  }

  box.innerHTML =
    (replyTo
      ? '<div class="replybar"><div class="t"><b>Ответ ' +
        (replyTo.mine ? 'на своё сообщение' : 'клиенту') + ':</b> ' +
        esc(replyTo.text || 'сообщение') + '</div><div class="c" id="rCancel">×</div></div>'
      : '') +
    (pendingFile
      ? '<div class="fileprev"><div class="t">' + esc(pendingFile.name) + ' · ' +
        Math.round(pendingFile.size / 1024) + ' КБ</div><div class="c" id="fCancel">×</div></div>'
      : '') +
    '<div class="tplbox" id="tplBox" style="display:none"></div>' +
    '<div class="emobox" id="emoBox" style="display:none"></div>' +
    '<div class="row">' +
    '<input type="file" id="file" style="display:none">' +
    '<button class="icob" id="clip" title="Прикрепить файл">' + icon('clip') + '</button>' +
    '<button class="icob" id="emo" title="Смайлы">' + icon('smile') + '</button>' +
    '<button class="icob" id="tpl" title="Шаблоны ответов">' + icon('bolt') + '</button>' +
    '<textarea id="txt" rows="1" placeholder="Ответ клиенту. Enter — отправить, Shift+Enter — перенос"></textarea>' +
    '<button id="send">Отправить</button></div><div class="err" id="sendErr"></div>';

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
    if (f.size > 20 * 1024 * 1024){ alertLine('Файл больше 20 МБ — Telegram не пропустит'); return }
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
  ta.focus();
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
    ? { qr: { id: q.id, index: 0 }, name: f.filename || 'файл', size: f.size || 0, type: f.mime }
    : null;
  renderComposer(true);
  var t2 = el('txt');
  if (t2) { t2.focus(); t2.setSelectionRange(t2.value.length, t2.value.length) }
}

function toggleTemplates(){
  var b = el('tplBox');
  if (b.style.display !== 'none'){ b.style.display='none'; return }
  if (!QR.length){
    b.innerHTML = '<div class="qr" style="cursor:default"><b>Шаблонов пока нет.</b> ' +
      '<span class="x">Заведите их в разделе «Шаблоны» — потом вставляются командой /имя ' +
      'или отсюда, вместе с файлом.</span></div>';
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
      x.textContent = 'ставлю в очередь...';
      api('/media/' + x.dataset.retry + '/' + x.dataset.i + '/retry', { method:'POST' })
        .then(function(){
          x.textContent = 'скачиваю...';
          setTimeout(function(){ lastThread = null; loadThread() }, 2500);
        })
        .catch(function(e){
          // Показываем причину, а не «не вышло». Разница между
          // «нет ссылки на файл» и «сообщение не найдено» — это разница
          // между двумя совершенно разными поломками.
          var p = e.payload || {};
          x.textContent =
            p.error === 'no_file_reference' ? 'нет ссылки на файл у Telegram'
            : p.error === 'not_found' ? 'сообщение не найдено'
            : p.error === 'unauthorized' ? 'нет доступа'
            : 'ошибка ' + (e.status || '');
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
        if (p.error === 'message_not_delivered_yet') alertLine('Сообщение ещё не доставлено');
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
        p.error === 'file_too_large' ? 'Файл больше 20 МБ'
        : p.error === 'storage_write_failed' ? p.detail
        : p.reason || p.error || 'Не удалось отправить';
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
  if (!d || !d.contact){ el('card').innerHTML = '<div class="empty">Нет данных</div>'; return }
  var ct = d.contact, c = currentConv();

  el('card').innerHTML =
    '<div style="display:flex;gap:11px;align-items:center;margin-bottom:14px">' +
      '<div class="av" data-av="' + ct.id + '" ' +
        'style="width:44px;height:44px;font-size:15px;background-color:' +
        avatarColor(ct.display_name || ct.id) + '">' + esc(initials(ct.display_name)) + '</div>' +
      '<div style="min-width:0"><div style="font-weight:700;font-size:14.5px">' +
        esc(ct.display_name || 'Без имени') + '</div>' +
      '<div class="dim" style="font-size:12px">клиент с ' + esc(fmtDate(ct.created_at)) + '</div></div>' +
    '</div>' +

    '<h4>Контакт</h4>' +
    '<div class="fld"><label>Имя</label><input id="cNm" value="' + esc(ct.display_name || '') + '"></div>' +
    '<div class="fld"><label>Телефон</label><input id="cPh" value="' + esc(ct.phone_e164 || '') + '"></div>' +
    '<div class="fld"><label>Почта</label><input id="cEm" value="' + esc(ct.email || '') + '"></div>' +
    '<button class="ghost mini" id="cSave">Сохранить</button>' +
    '<span class="ok" id="cOk" style="margin-left:8px"></span>' +

    '<h4>Каналы клиента</h4>' +
    '<div class="kv2">' + (d.identities || []).map(function(i){
      var p = i.raw_profile || {};
      return '<div class="k">' + esc(CH[i.channel_type] || i.channel_type) + '</div>' +
        '<div>' + esc(p.username ? '@' + p.username : i.external_id) + '</div>';
    }).join('') + '</div>' +

    '<h4>Метки</h4>' +
    '<div class="tags" id="cTags">' +
      ((c && c.tags) || []).map(function(t){
        return '<span class="tag">' + esc(t) + '<span class="x" data-tag="' + esc(t) + '">×</span></span>';
      }).join('') +
    '</div>' +
    '<div class="row2" style="margin-top:8px">' +
      '<input id="cTag" placeholder="новая метка" style="font-size:12.5px;padding:6px 9px">' +
      '<button class="ghost mini" id="cTagAdd">Добавить</button>' +
    '</div>' +

    '<h4>Заметки</h4>' +
    '<textarea id="cNote" rows="2" placeholder="Видно только вашей команде"></textarea>' +
    '<button class="ghost mini" id="cNoteAdd" style="margin-top:7px">Добавить</button>' +
    '<div style="margin-top:12px">' +
      ((d.notes || []).length ? d.notes.map(function(n){
        return '<div class="note">' + esc(n.body) +
          '<div class="who">' + esc(n.author_name || 'кто-то') + ' · ' + esc(fmtTime(n.created_at)) +
          ' <span class="x" data-note="' + n.id + '" style="cursor:pointer">удалить</span></div></div>';
      }).join('') : '<div class="dim" style="font-size:12.5px">Пока нет.</div>') +
    '</div>' +

    '<h4>CRM</h4>' +
    (d.crmUrl
      ? '<div class="kv2"><div class="k">Карточка</div>' +
        '<div><a href="' + esc(d.crmUrl) + '" target="_blank" rel="noopener">открыть в Zoho</a></div></div>'
      : '<div class="row2"><button class="ghost mini" id="cCrm">Отправить в Zoho</button></div>' +
        '<div class="hint" style="margin-top:6px">Найдём по номеру и привяжем карточку, ' +
        'а если такого клиента ещё нет — заведём лид.</div>' +
        '<div class="err" id="cCrmErr"></div>') +

    '<h4>Диалог</h4>' +
    '<div class="kv2">' +
      '<div class="k">Сообщений</div><div>' + esc((d.stats && d.stats.messages) || 0) + '</div>' +
      '<div class="k">Первое</div><div>' + esc(fmtDate(d.stats && d.stats.first_at)) + '</div>' +
      '<div class="k">Последнее</div><div>' + esc(fmtDate(d.stats && d.stats.last_at)) + '</div>' +
    '</div>';

  paintAvatars();

  el('cSave').onclick = function(){
    busy(el('cSave'), true);
    api('/contacts/' + ct.id, { method:'PATCH', body:{
      displayName: el('cNm').value.trim(),
      phone: el('cPh').value.trim(),
      email: el('cEm').value.trim()
    }}).then(function(){
      el('cOk').textContent = 'сохранено';
      setTimeout(function(){ if (el('cOk')) el('cOk').textContent = '' }, 2000);
      refresh();
    }).catch(showErr).then(function(){ busy(el('cSave'), false) });
  };

  if (el('cCrm')) el('cCrm').onclick = function(){
    busy(el('cCrm'), true);
    el('cCrmErr').textContent = '';
    api('/contacts/' + ct.id + '/crm', { method:'POST' })
      .then(function(){
        toast('Отправляю в Zoho...');
        // Связка идёт задачей: ответ приходит не мгновенно, и карточку
        // имеет смысл перечитать через пару секунд, а не сразу.
        setTimeout(loadCard, 2500);
        setTimeout(loadCard, 6000);
      })
      .catch(function(e){
        var p = e.payload || {};
        el('cCrmErr').textContent = p.error === 'crm_not_connected'
          ? 'Zoho не подключена — сделайте это на странице «Интеграции»'
          : p.error === 'already_linked' ? 'Карточка уже связана' : 'Не удалось отправить';
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
  welcome:{ t:'Приветствие', h:'Первое сообщение в диалоге, один раз' },
  keyword:{ t:'Содержит слово', h:'В сообщении встретилось одно из слов' },
  exact:{ t:'Точное совпадение', h:'Сообщение целиком равно слову' },
  off_hours:{ t:'Вне графика', h:'Сообщение пришло в нерабочее время' },
  fallback:{ t:'Ничего не подошло', h:'Проверяется последним' }
};

var KINDS = {
  message:{ t:'Сообщение', i:'💬' },
  ask:{ t:'Вопрос и ожидание ответа', i:'❓' },
  delay:{ t:'Пауза', i:'⏱' },
  condition:{ t:'Развилка', i:'🔀' },
  tag:{ t:'Метка на диалог', i:'🏷' },
  handoff:{ t:'Передать оператору', i:'🙋' },
  close:{ t:'Закрыть диалог', i:'✅' }
};

var SC = null;
var SCENARIOS = [];

/** Короткая сводка цепочки для карточки в списке. */
function stepsSummary(steps){
  return (steps || []).map(function(st){
    var k = KINDS[st.kind] || { i:'•', t:st.kind };
    var extra = st.kind === 'delay'
      ? ' ' + (st.seconds >= 3600 ? Math.round(st.seconds / 3600) + ' ч'
          : st.seconds >= 60 ? Math.round(st.seconds / 60) + ' мин' : st.seconds + ' с')
      : '';
    return '<span class="chip">' + k.i + ' ' + esc(k.t.split(' ')[0]) + extra + '</span>';
  }).join(' ');
}

function renderBots(){
  if (SC) return renderScEditor();
  api('/scenarios').then(function(d){
    SCENARIOS = d.scenarios || [];
    pageBox().innerHTML = '<div class="pg">' +
      pageHead('Сценарии',
        'Цепочка шагов, которая ведёт разговор за оператора: поздороваться, спросить, ' +
        'подождать, поставить метку и позвать человека, когда дело дошло до дела. ' +
        'Сценарий молчит, если у диалога есть ответственный или оператор писал менее ' +
        '30 минут назад, и выключается кнопкой в самом диалоге.',
        '<button id="scNew">Новый сценарий</button>') +

      (SCENARIOS.length
        ? '<div class="grid">' + SCENARIOS.map(function(sc){
            var tr = TRIG[sc.trigger_type] || { t:sc.trigger_type };
            var kw = (sc.keywords || []).join(', ');
            return '<div class="card sc' + (sc.is_active ? '' : ' off') + '">' +
              '<div class="sc-h">' +
                '<div style="min-width:0">' +
                  '<div class="h4">' + esc(sc.name) + '</div>' +
                  '<div class="s">' + esc(tr.t) + (kw ? ': ' + esc(kw) : '') +
                    ' · ' + esc(sc.channel_name || 'все каналы') + '</div>' +
                '</div>' +
                '<span class="pill ' + (sc.is_active ? 'good' : '') + '">' +
                  (sc.is_active ? 'работает' : 'выключен') + '</span>' +
              '</div>' +
              '<div class="sc-steps">' + stepsSummary(sc.steps) + '</div>' +
              '<div class="sc-f">' +
                '<span class="dim">запусков ' + esc(sc.runs_started) +
                  ' · дошли до конца ' + esc(sc.runs_finished) +
                  (Number(sc.live) ? ' · сейчас идёт ' + esc(sc.live) : '') + '</span>' +
                '<span class="row" style="gap:6px">' +
                  '<button class="ghost mini" data-scedit="' + sc.id + '">Изменить</button>' +
                  '<button class="ghost mini" data-sctog="' + sc.id + '" data-on="' +
                    (sc.is_active ? 'false' : 'true') + '">' +
                    (sc.is_active ? 'Выключить' : 'Включить') + '</button>' +
                  '<button class="ghost mini" data-scdel="' + sc.id + '">Удалить</button>' +
                '</span>' +
              '</div></div>';
          }).join('') + '</div>'
        : '<div class="card"><div class="empty"><div class="ttl">Сценариев пока нет</div>' +
          'Начните с приветствия: клиент пишет впервые — бот здоровается и обещает, ' +
          'что оператор ответит. Это одна минута и сразу видимый эффект.</div></div>') +
      '</div>';

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
      'placeholder="Что отправить клиенту">' + esc(st.text || '') + '</textarea>';
  }
  if (st.kind === 'ask') {
    return '<textarea data-f="text" data-i="' + i + '" rows="2" ' +
      'placeholder="О чём спросить">' + esc(st.text || '') + '</textarea>' +
      '<div class="row2" style="margin-top:8px">' +
      '<input data-f="save" data-i="' + i + '" placeholder="Запомнить ответ как (необязательно)" value="' +
        esc(st.save || '') + '">' +
      '<input data-f="timeoutMinutes" data-i="' + i + '" type="number" min="0" ' +
        'placeholder="Ждать, минут" value="' + esc(st.timeoutMinutes || '') + '">' +
      '</div>';
  }
  if (st.kind === 'delay') {
    return '<div class="row2"><input data-f="minutes" data-i="' + i + '" type="number" min="1" ' +
      'placeholder="Пауза в минутах" value="' + esc(Math.max(1, Math.round((st.seconds || 60) / 60))) +
      '"><div class="hint" style="margin:0;align-self:center">Дольше суток — уже рассылка, а не разговор</div></div>';
  }
  if (st.kind === 'condition') {
    return '<div class="row2">' +
      '<input data-f="contains" data-i="' + i + '" placeholder="Слова через запятую: да, хочу, беру" value="' +
        esc((st.contains || []).join(', ')) + '">' +
      '<input data-f="goto" data-i="' + i + '" type="number" min="1" ' +
        'placeholder="Если да — на шаг" value="' + esc(st.goto !== undefined ? st.goto + 1 : '') + '">' +
      '<input data-f="elseGoto" data-i="' + i + '" type="number" min="1" ' +
        'placeholder="Если нет — на шаг" value="' +
        esc(st.elseGoto !== undefined ? st.elseGoto + 1 : '') + '">' +
      '</div><div class="hint">Смотрит на последний ответ клиента. Пусто в «если нет» — просто идём дальше.</div>';
  }
  if (st.kind === 'tag') {
    return '<input data-f="tag" data-i="' + i + '" placeholder="Название метки, например «опт»" value="' +
      esc(st.tag || '') + '">';
  }
  if (st.kind === 'handoff') {
    return '<input data-f="note" data-i="' + i + '" placeholder="Заметка оператору (необязательно)" value="' +
      esc(st.note || '') + '">' +
      '<div class="hint">Бот замолкает в этом диалоге, дальше отвечает человек.</div>';
  }
  return '<div class="hint">Диалог уходит в «Закрытые». Вернётся сам, когда клиент напишет снова.</div>';
}

function renderScEditor(){
  var chOpts = '<option value="">Все каналы</option>' + CHANNELS.map(function(c){
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
      '<button class="quiet mini" data-up="' + i + '" title="Выше"' + (i ? '' : ' disabled') + '>↑</button>' +
      '<button class="quiet mini" data-down="' + i + '" title="Ниже"' +
        (i === SC.steps.length - 1 ? ' disabled' : '') + '>↓</button>' +
      '<button class="quiet mini" data-drop="' + i + '" title="Убрать">×</button>' +
      '</div><div class="st-b">' + stepFields(st, i) + '</div></div>';
  }).join('<div class="st-link"></div>');

  pageBox().innerHTML = '<div class="pg">' +
    pageHead(SC.id ? 'Сценарий' : 'Новый сценарий',
      'Шаги выполняются сверху вниз. Пауза и вопрос останавливают цепочку до срока ' +
      'или до ответа клиента — всё это переживает перезапуск сервиса.',
      '<button class="ghost" id="scBack">К списку</button>') +

    '<div class="card">' +
      '<div class="row2"><input id="scName" placeholder="Название, например «Приветствие»" value="' +
        esc(SC.name) + '"></div>' +
      '<div class="row2" style="margin-top:9px">' +
        '<select id="scTr">' + trOpts + '</select>' +
        '<select id="scCh">' + chOpts + '</select>' +
      '</div>' +
      '<div class="hint">' + esc((TRIG[SC.trigger_type] || {}).h || '') + '</div>' +
      (needKw
        ? '<div class="row2" style="margin-top:9px"><input id="scKw" ' +
          'placeholder="Слова через запятую: цена, прайс, стоимость" value="' +
          esc((SC.keywords || []).join(', ')) + '"></div>'
        : '') +
      (needSchedule
        ? '<div class="row2" style="margin-top:9px">' +
          '<input id="scFrom" placeholder="с 09:00" value="' + esc(sch.from || '09:00') + '">' +
          '<input id="scTo" placeholder="до 19:00" value="' + esc(sch.to || '19:00') + '">' +
          '<input id="scTz" type="number" placeholder="часовой пояс" value="' +
            esc(sch.tzOffset === undefined ? 3 : sch.tzOffset) + '">' +
          '</div><div class="hint">Часовой пояс сдвигом от UTC: для Киева — 3. ' +
          'Рабочие дни — с понедельника по пятницу.</div>'
        : '') +
    '</div>' +

    '<div class="card"><h3>Шаги</h3><div class="chain">' + steps + '</div>' +
      '<div class="addrow">' + Object.keys(KINDS).map(function(k){
        return '<button class="ghost mini" data-add="' + k + '">' + KINDS[k].i + ' ' +
          esc(KINDS[k].t) + '</button>';
      }).join('') + '</div>' +
    '</div>' +

    '<div class="card"><div class="row" style="gap:8px">' +
      '<button id="scSave">Сохранить</button>' +
      '<button class="ghost" id="scCancel">Отмена</button>' +
      '<span class="grow"></span>' +
      '<label class="row" style="gap:6px;font-size:12.5px;color:var(--t2)">' +
      '<input type="checkbox" id="scOn" style="width:auto"' + (SC.is_active ? ' checked' : '') +
      '> включён</label>' +
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
    req.then(function(){ SC = null; renderBots(); toast('Сценарий сохранён') })
      .catch(function(e){
        var p = e.payload || {};
        el('scErr').textContent = p.detail || 'Не удалось сохранить';
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
        armed = true; b.textContent = 'Точно?';
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
  pageBox().innerHTML = '<div class="pg"><div class="empty">Не удалось загрузить: ' +
    esc((e && e.message) || 'ошибка') + '</div></div>';
}

function tabProfile(){
  api('/me').then(function(d){
    ME = d;
    var t = d.tenant || {}, u = d.user || {}, c = d.counts || {};
    pageBox().innerHTML = '<div class="pg">' +
      pageHead('Профиль и организация', 'Кто вы в системе и что сейчас подключено.') +
      '<div class="grid">' +
      '<div class="card"><h3>Организация</h3><div class="kv">' +
      '<div class="k">Название</div><div>' + esc(t.name) + '</div>' +
      '<div class="k">Идентификатор</div><div><code>' + esc(t.slug) + '</code></div>' +
      '<div class="k">Тариф</div><div>' + esc(t.plan || 'trial') +
        ' · мест: ' + esc(t.seats_limit) + '</div>' +
      '<div class="k">Регион данных</div><div>' + esc((t.region || 'eu').toUpperCase()) + '</div>' +
      '<div class="k">Подключена</div><div>' + esc(fmtDate(t.created_at)) + '</div>' +
      '</div></div>' +

      '<div class="card"><h3>Ваш профиль</h3><div class="kv">' +
      '<div class="k">Имя</div><div>' + esc(u.full_name || '—') + '</div>' +
      '<div class="k">Почта</div><div>' + esc(u.email) + '</div>' +
      '<div class="k">Роль</div><div>' + esc(ROLES[u.role] || u.role) + '</div>' +
      '<div class="k">В системе с</div><div>' + esc(fmtDate(u.created_at)) + '</div>' +
      '</div></div>' +

      '<div class="card"><h3>Сейчас в аккаунте</h3><div class="kv">' +
      '<div class="k">Каналов</div><div>' + esc(c.channels) + '</div>' +
      '<div class="k">Сотрудников</div><div>' + esc(c.users) + '</div>' +
      '<div class="k">Диалогов</div><div>' + esc(c.conversations) + '</div>' +
      '<div class="k">Сообщений</div><div>' + esc(c.messages) + '</div>' +
      '</div></div></div></div>';
  }).catch(sErr);
}

/* ── Каналы ──────────────────────────────────────────────────────
   Отдельная страница: слева плитки подключённых каналов, ниже —
   витрина «подключить». Настройки конкретного канала живут на своей
   странице (openChannel), а не в общем списке: там будут приветствие,
   автоответы и расписание, и в списке им места нет. */

var CH_ICON = { telegram_bot:'TG', telegram_user:'TG', instagram:'IG', messenger:'FB',
  whatsapp:'WA', whatsapp_cloud:'WA', whatsapp_user:'WA', viber_bot:'VB', viber_user:'VB' };

function chPill(c){
  return c.status === 'active' ? '<span class="pill ok">работает</span>'
    : c.status === 'degraded' ? '<span class="pill crit">нужно переподключить</span>'
    : '<span class="pill warn">выключен</span>';
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
        '<div class="stat"><div><b>' + esc(c.conversations) + '</b>диалогов</div></div>' +
        '<div class="acts"><button class="ghost mini" data-open2="' + c.id + '">Настроить</button>' +
        '<button class="ghost mini" data-toggle="' + c.id + '" data-to="' +
          (c.status === 'active' ? 'disconnected' : 'active') + '">' +
          (c.status === 'active' ? 'Выключить' : 'Включить') + '</button></div></div>';
    }).join('');

    var connect =
      '<div class="tile"><div class="t1"><div class="chico telegram_bot">TG</div>' +
      '<div><div class="ttl">Telegram-бот</div><div class="sub">Отдельный бот для поддержки</div></div></div>' +
      '<div class="sub" style="white-space:normal">Токен выдаёт <b>@BotFather</b>: /newbot для нового бота ' +
      'или /token для существующего.</div>' +
      '<div class="row2"><input id="btok" type="password" placeholder="123456789:AAF..." autocomplete="off">' +
      '<button id="badd">Подключить</button></div>' +
      '<div class="err" id="berr"></div><div class="ok" id="bok"></div></div>' +

      '<div class="tile" id="metaCard"><div class="t1"><div class="chico instagram">IG</div>' +
      '<div><div class="ttl">Instagram и Messenger</div><div class="sub">Через страницу Facebook</div></div></div>' +
      '<div id="metaBody"><div class="sub" style="white-space:normal">Войдите под аккаунтом, который управляет ' +
      'страницей. Instagram должен быть профессиональным аккаунтом и привязан к этой странице.</div>' +
      '<div class="acts"><button id="metaGo">Войти через Facebook</button></div>' +
      '<div class="err" id="metaErr"></div></div></div>' +

      '<div class="tile"><div class="t1"><div class="chico telegram_user">TG</div>' +
      '<div><div class="ttl">Telegram по номеру</div><div class="sub">Личный или рабочий аккаунт</div></div></div>' +
      '<div class="sub" style="white-space:normal">Клиенты пишут на ваш номер как обычно, переписка появляется здесь, ' +
      'ответы уходят от вашего имени.</div>' +
      '<div class="row2"><input id="uname" placeholder="Название, например: Продажи" autocomplete="off">' +
      '<button id="uqr">Показать QR-код</button></div><div id="uqrbox"></div></div>' +

      ['whatsapp_cloud','whatsapp_user','viber_bot','viber_user'].map(function(t){
        return '<div class="tile"><div class="t1"><div class="chico soon">' + (CH_ICON[t] || '••') + '</div>' +
          '<div><div class="ttl">' + esc(CH[t]) + '</div>' +
          '<div class="sub">Готовится</div></div></div>' +
          '<div class="acts"><button class="ghost mini" disabled>Скоро</button></div></div>';
      }).join('');

    pageBox().innerHTML = '<div class="pg">' +
      pageHead('Каналы', 'Мессенджеры, из которых приходят сообщения. У каждого канала свои настройки: ' +
        'приветствие, автоответы и рабочие часы.') +
      (CHANNELS.length
        ? '<div class="pg-sec"><h3>Подключено · ' + CHANNELS.length + '</h3><div class="grid">' + tiles + '</div></div>'
        : '') +
      '<div class="pg-sec"><h3>Подключить канал</h3><div class="grid">' + connect + '</div></div>' +
      '</div>';

    el('uqr').onclick = function(){ startTgUser(el('uname').value.trim()) };
    el('metaGo').onclick = startMeta;
    if (S.metaError && !S.metaPick) { el('metaErr').textContent = S.metaError; S.metaError = null; }
    if (S.metaPick) showMetaPick(S.metaPick);

    el('badd').onclick = function(){
      var token = el('btok').value.trim();
      el('berr').textContent = ''; el('bok').textContent = '';
      if (!token) return;
      busy(el('badd'), true);
      api('/settings/channels/telegram', { method:'POST', body:{ botToken: token } })
        .then(function(r){
          el('bok').textContent = 'Готово: @' + (r.username || 'бот') +
            (r.mode === 'polling' ? ' (режим опроса)' : ' (вебхук)');
          el('btok').value = '';
          setTimeout(tabChannels, 900);
        })
        .catch(function(e){
          var p = e.payload || {};
          el('berr').textContent = p.detail ||
            (p.error === 'telegram_rejected_token'
              ? 'Telegram не принял токен — проверьте, что скопирован целиком'
              : p.error === 'invalid_bot_token' ? 'Не похоже на токен бота'
              : 'Не удалось подключить');
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
function openChannel(id){
  var c = null;
  for (var i = 0; i < CHANNELS.length; i++) if (CHANNELS[i].id === id) c = CHANNELS[i];
  if (!c) return tabChannels();
  S.channelId = id;

  var meta = c.meta || {};
  var rows = [
    ['Тип канала', esc(CH[c.type] || c.type)],
    ['Состояние', chPill(c)],
    ['Идентификатор у провайдера', '<code>' + esc(c.external_id) + '</code>'],
    ['Диалогов', esc(c.conversations)],
    ['Подключён', esc(fmtDate(c.created_at))]
  ];
  if (meta.username) rows.splice(2, 0, ['Имя пользователя', '@' + esc(meta.username)]);
  if (meta.phone) rows.splice(2, 0, ['Номер', esc(meta.phone)]);
  if (meta.pageName) rows.splice(2, 0, ['Страница Facebook', esc(meta.pageName)]);
  if (c.last_error) rows.push(['Последняя ошибка', '<span class="pill crit">' + esc(errLabel(c.last_error)) + '</span>']);

  pageBox().innerHTML = '<div class="pg">' +
    '<button class="back-link" id="chBack">← Все каналы</button>' +
    pageHead(c.display_name, esc(chSub(c)),
      '<div class="row2"><button class="ghost mini" id="chToggle">' +
      (c.status === 'active' ? 'Выключить' : 'Включить') + '</button>' +
      '<button class="ghost mini" id="chDel">Удалить</button></div>') +

    '<div class="pg-sec"><h3>Название в интерфейсе</h3>' +
    '<div class="tile"><div class="row2"><input id="chName" value="' + esc(c.display_name) + '">' +
    '<button id="chSave">Сохранить</button></div>' +
    '<div class="sub" style="white-space:normal">Так канал называется в списке чатов и в фильтрах. ' +
    'У клиента название не видно.</div><div class="ok" id="chOk"></div></div></div>' +

    '<div class="pg-sec"><h3>О канале</h3><div class="tile"><div class="kv">' +
    rows.map(function(r){ return '<div class="k">' + r[0] + '</div><div>' + r[1] + '</div>' }).join('') +
    '</div></div></div>' +

    '<div class="pg-sec"><h3>Автоматизация</h3><div class="grid">' +
    '<div class="tile click" id="chFlows"><div class="t1"><div class="chico soon">⚡</div>' +
    '<div><div class="ttl">Сценарии этого канала</div>' +
    '<div class="sub">Приветствие, автоответы, цепочки</div></div></div>' +
    '<div class="sub" style="white-space:normal">Правила и цепочки, которые срабатывают на сообщения ' +
    'именно в этом канале.</div>' +
    '<div class="acts"><button class="ghost mini">Открыть сценарии</button></div></div>' +
    '</div></div></div>';

  el('chBack').onclick = tabChannels;
  el('chFlows').onclick = function(){ setView('bots') };
  el('chSave').onclick = function(){
    busy(el('chSave'), true);
    api('/channels/' + id, { method:'PATCH', body:{ displayName: el('chName').value.trim() } })
      .then(function(){
        el('chOk').textContent = 'Сохранено';
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

function pageIntegrations(){
  api('/settings/zoho').then(function(d){
    var list = d.installations || [];

    var body = !d.configured
      ? '<div class="sub" style="white-space:normal">Подключение ещё не настроено на сервере: ' +
        'не заданы ключи приложения Zoho. Это делается один раз для всего сервиса.</div>'
      : list.length
        ? list.map(function(z){
            return '<div class="item"><div style="min-width:0">' +
              '<div class="t">' + esc(z.org_name || 'Организация Zoho') +
                (z.status === 'active'
                  ? '<span class="pill good">подключена</span>'
                  : '<span class="pill warn">нужно переподключить</span>') + '</div>' +
              '<div class="s">' + esc(z.api_domain || '') + ' · id ' + esc(z.zgid) + '</div>' +
              '</div><div class="row" style="gap:6px;flex:none">' +
              '<button class="ghost mini" data-zcheck="' + z.id + '">Проверить</button>' +
              '<button class="ghost mini" data-zdel="' + z.id + '">Отключить</button>' +
              '</div></div>';
          }).join('')
        : '<div class="sub" style="white-space:normal">Войдите под аккаунтом Zoho той организации, ' +
          'с которой работаете. Мы попросим доступ к контактам и лидам — ровно столько, сколько нужно, ' +
          'чтобы найти клиента по номеру и завести нового.</div>';

    pageBox().innerHTML = '<div class="pg">' +
      pageHead('Интеграции', 'Rozmovio живёт рядом с вашей CRM: переписка видна в карточке клиента, ' +
        'а новые обращения превращаются в лиды.') +
      '<div class="pg-sec"><h3>CRM</h3><div>' +
      '<div class="tile" style="cursor:default"><div class="t1"><div class="chico messenger">Z</div>' +
      '<div><div class="ttl">Zoho CRM</div><div class="sub">Переписка в карточке клиента</div></div></div>' +
      body +
      (d.configured
        ? '<div class="acts"><button id="zGo">' +
          (list.length ? 'Подключить ещё организацию' : 'Войти через Zoho') + '</button></div>'
        : '') +
      '<div class="err" id="zErr"></div><div class="ok" id="zOk"></div>' +
      '</div></div></div>' +

      (list.length
        ? '<div class="pg-sec"><h3>Виджет в карточке клиента</h3><div class="card">' +
          '<div class="s" style="color:var(--t2);line-height:1.7">Zoho заводит виджеты только ' +
          'из своих настроек — программно их создать нельзя. Это делается один раз и занимает минуту.</div>' +
          '<ol class="steps" style="margin-top:10px">' +
          '<li>В Zoho CRM: <b>Настройки</b> (шестерёнка) → <b>Developer Space</b> → <b>Widgets</b> → ' +
          '<b>Create Widget</b>.</li>' +
          '<li>Имя — <b>Rozmovio</b>, тип — <b>Related List</b>, хостинг — <b>External</b>.</li>' +
          '<li>Base URL — вот этот адрес: <code id="wurl">' + esc(WIDGET_URL()) + '</code> ' +
          '<button class="ghost mini" id="wcopy">Скопировать</button></li>' +
          '<li>Сохранить. Затем <b>Настройки → Модули и поля → Контакты → Связанные списки</b> ' +
          'и добавить <b>Rozmovio</b>. То же для модуля <b>Лиды</b>.</li>' +
          '</ol>' +
          '<div class="hint">В карточке появится блок с перепиской. Первый раз он попросит вашу ' +
          'почту и код — один раз на браузер.</div></div></div>'
        : '') +

      '<div class="pg-sec"><h3>Что дальше</h3>' +
      '<div class="card"><div class="s" style="color:var(--t2);line-height:1.7">' +
      'После подключения: входящее сообщение ищет контакт по номеру телефона и создаёт лид, ' +
      'если такого нет; переписка показывается прямо в карточке Zoho виджетом; ответ из виджета ' +
      'уходит в тот канал, откуда написал клиент.</div></div></div>' +
      '</div>';

    if (S.zohoNote){ el('zOk').textContent = S.zohoNote; S.zohoNote = null }
    if (S.zohoError){ el('zErr').textContent = S.zohoError; S.zohoError = null }

    if (el('zGo')) el('zGo').onclick = function(){
      busy(el('zGo'), true);
      api('/settings/zoho/start').then(function(r){ location.href = r.url })
        .catch(function(){
          busy(el('zGo'), false);
          el('zErr').textContent = 'Не удалось начать подключение';
        });
    };

    if (el('wcopy')) el('wcopy').onclick = function(){
      var text = el('wurl').textContent;
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(function(){ toast('Адрес скопирован') });
      else {
        // Старый способ на случай, если буфер обмена недоступен
        // (например, страница открыта не по https).
        var t = document.createElement('textarea');
        t.value = text; document.body.appendChild(t); t.select();
        document.execCommand('copy'); document.body.removeChild(t);
        toast('Адрес скопирован');
      }
    };

    Array.prototype.forEach.call(pageBox().querySelectorAll('[data-zcheck]'), function(b){
      b.onclick = function(){
        busy(b, true);
        el('zErr').textContent = ''; el('zOk').textContent = '';
        api('/settings/zoho/' + b.dataset.zcheck + '/check', { method:'POST' })
          .then(function(r){
            el('zOk').textContent = 'Связь есть' + (r.user ? ', вошли как ' + r.user : '');
            pageIntegrations();
          })
          .catch(function(e){
            var p = e.payload || {};
            el('zErr').textContent = p.error === 'token_rejected'
              ? 'Zoho больше не принимает доступ: ' + (p.detail || '') + '. Подключите заново.'
              : 'Не удалось проверить';
            busy(b, false);
          });
      };
    });

    armDelete(pageBox().querySelectorAll('[data-zdel]'), function(b){
      return api('/settings/zoho/' + b.dataset.zdel, { method:'DELETE' }).then(pageIntegrations);
    });
  }).catch(sErr);
}


/* ── Подключение Facebook: Messenger и Instagram ──────────────────
   Возврат из Facebook приходит на адрес приложения с меткой в хвосте
   ссылки: там либо идентификатор выбора страниц, либо причина отказа.
   Разбирается один раз при запуске, метка из адресной строки убирается,
   чтобы обновление страницы не пыталось подключить то же самое снова. */

var META_ERRORS = {
  cancelled:'Вход через Facebook отменён.',
  state:'Ссылка устарела — нажмите «Войти через Facebook» ещё раз.',
  exchange:'Facebook не подтвердил вход. Попробуйте ещё раз.',
  unavailable:'Подключение Facebook ещё не включено на сервере.'
};

var ZOHO_ERRORS = {
  cancelled:'Подключение Zoho отменено.',
  state:'Ссылка устарела — нажмите «Войти через Zoho» ещё раз.',
  exchange:'Zoho не подтвердила доступ. Попробуйте ещё раз.',
  server:'Zoho вернула неизвестный адрес сервера. Напишите нам.',
  org:'Zoho не отдала сведения об организации. Проверьте права аккаунта.'
};

function readMetaHash(){
  var h = location.hash || '';

  // Возврат из Zoho: отдельная ветка, но разбирается там же — всё,
  // что приходит хвостом ссылки, должно сниматься в одном месте.
  var zok = h.indexOf('zoho=ok') >= 0;
  var zerr = h.match(/zoho-error=([a-z]+)/);
  if (zok || zerr){
    S.zohoNote = zok ? 'Организация Zoho подключена.' : null;
    S.zohoError = zerr ? (ZOHO_ERRORS[zerr[1]] || 'Не удалось подключить Zoho') : null;
    history.replaceState(null, '', location.pathname);
    setView('integrations');
    return true;
  }

  var m = h.match(/meta-pick=([0-9a-f-]+)/);
  var e = h.match(/meta-error=([a-z]+)/);
  if (!m && !e) return false;
  if (m) S.metaPick = m[1];
  if (e) S.metaError = META_ERRORS[e[1]] || 'Не удалось подключить Facebook';
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
        ? META_ERRORS.unavailable : 'Не удалось начать вход';
    });
}

function showMetaPick(id){
  var box = el('metaBody');
  box.innerHTML = '<div class="empty">Загружаю страницы...</div>';
  api('/settings/channels/meta/pick/' + id).then(function(d){
    var pages = d.pages || [];
    if (!pages.length){
      S.metaPick = null;
      box.innerHTML = '<div class="err">У этого аккаунта Facebook нет страниц, или при входе ' +
        'не отмечена ни одна. Нажмите «Войти через Facebook» и на шаге выбора отметьте нужные страницы.</div>' +
        '<div class="row2" style="margin-top:10px"><button id="metaGo">Войти через Facebook</button></div>';
      el('metaGo').onclick = startMeta;
      return;
    }
    box.innerHTML = '<div class="hint">Отметьте, что подключить:</div>' +
      pages.map(function(p){
        return '<div class="item"><div><div class="t">' + esc(p.name) + '</div>' +
          '<div class="s"><label><input type="checkbox" data-mp="' + esc(p.id) + '" data-k="messenger" checked> Messenger</label>' +
          (p.instagram
            ? ' &nbsp; <label><input type="checkbox" data-mp="' + esc(p.id) + '" data-k="instagram" checked> Instagram' +
              (p.instagram.username ? ' @' + esc(p.instagram.username) : '') + '</label>'
            : ' &nbsp; <span class="muted">Instagram к странице не привязан</span>') +
          '</div></div></div>';
      }).join('') +
      '<div class="row2" style="margin-top:10px"><button id="metaSave">Подключить выбранное</button></div>' +
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
          toast(ok ? 'Подключено каналов: ' + ok : 'Ничего не подключено');
          if (bad.length){
            S.metaError = bad.map(function(x){ return x.page + ': ' + x.error }).join('; ');
          }
          tabChannels();
        })
        .catch(function(){ busy(el('metaSave'), false); el('metaErr').textContent = 'Не удалось подключить' });
    };
  }).catch(function(){
    S.metaPick = null;
    box.innerHTML = '<div class="err">Выбор страниц устарел (15 минут). Войдите через Facebook ещё раз.</div>' +
      '<div class="row2" style="margin-top:10px"><button id="metaGo">Войти через Facebook</button></div>';
    el('metaGo').onclick = startMeta;
  });
}

function errLabel(e){
  var r = (e && e.reason) || '';
  if (r === 'session_revoked') return 'сеанс завершён в Telegram — подключите номер заново';
  if (r === 'token_revoked') return 'токен бота отозван — подключите заново';
  return 'ошибка: ' + (typeof e === 'string' ? e : JSON.stringify(e));
}

/* Вход в номерной Telegram. Сервер отдаёт готовую картинку QR,
   страница только опрашивает состояние раз в полторы секунды. */
var TGU = { id:null, timer:null };

function startTgUser(name){
  var box = el('uqrbox');
  if (TGU.timer) clearTimeout(TGU.timer);
  box.innerHTML = '<div class="qrwrap"><div class="empty">Готовлю QR-код...</div></div>';
  busy(el('uqr'), true);
  api('/settings/channels/telegram-user/start', { method:'POST', body:{ displayName: name } })
    .then(function(r){ TGU.id = r.loginId; pollTgUser() })
    .catch(function(e){
      busy(el('uqr'), false);
      var p = (e && e.payload) || {};
      box.innerHTML = '<div class="err">' + (p.error === 'mtproto_unavailable'
        ? 'Номерной Telegram ещё не включён на сервере.' : 'Не удалось начать вход.') + '</div>';
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
        '<li>Откройте Telegram на телефоне</li>' +
        '<li><b>Настройки → Устройства → Подключить устройство</b></li>' +
        '<li>Наведите камеру на этот код</li></ol></div>' +
        '<div class="hint">Код обновляется каждые полминуты — это нормально.</div>';
    } else if (st.state === 'password') {
      if (!el('upw')) {
        box.innerHTML = '<div class="qrwrap"><div>' +
          '<div class="t">На аккаунте включён облачный пароль</div>' +
          '<div class="hint" id="uphint"></div>' +
          '<div class="row2"><input id="upw" type="password" placeholder="Облачный пароль Telegram" autocomplete="off">' +
          '<button id="upwgo">Войти</button></div>' +
          '<div class="err" id="upwerr"></div>' +
          '<div class="hint">Пароль передаётся в Telegram и нигде у нас не сохраняется.</div></div></div>';
        el('upwgo').onclick = function(){
          var pw = el('upw').value;
          if (!pw) return;
          busy(el('upwgo'), true);
          api('/settings/channels/telegram-user/login/' + id + '/password',
              { method:'POST', body:{ password: pw } })
            .catch(function(){ el('upwerr').textContent = 'Не удалось отправить пароль' })
            .then(function(){ el('upw').value = '' });
        };
        el('upw').onkeydown = function(ev){ if (ev.key === 'Enter') el('upwgo').click() };
        el('upw').focus();
      } else {
        busy(el('upwgo'), false);
      }
      el('uphint').textContent = st.passwordHint ? 'Подсказка: ' + st.passwordHint : '';
      el('upwerr').textContent = st.passwordError ? 'Пароль не подошёл, попробуйте ещё раз' : '';
    } else if (st.state === 'done') {
      TGU.id = null;
      box.innerHTML = '<div class="ok">Номер подключён. Сообщения начнут приходить в течение минуты.</div>';
      toast('Telegram по номеру подключён');
      setTimeout(tabChannels, 1500);
      return;
    } else if (st.state === 'error') {
      TGU.id = null;
      busy(el('uqr'), false);
      box.innerHTML = '<div class="err">' + esc(st.error || 'Вход не удался') + '</div>';
      return;
    } else if (el('upwgo')) {
      busy(el('upwgo'), true);
    }
    TGU.timer = setTimeout(pollTgUser, 1500);
  }).catch(function(){
    if (TGU.id === id) TGU.timer = setTimeout(pollTgUser, 3000);
  });
}

function tabUsers(){
  api('/users').then(function(d){
    USERS = d.users || [];
    var opts = Object.keys(ROLES).filter(function(r){ return r !== 'owner' })
      .map(function(r){ return '<option value="' + r + '">' + ROLES[r] + '</option>' }).join('');

    pageBox().innerHTML = '<div class="pg">' +
      pageHead('Команда', 'Операторы отвечают клиентам, наблюдатели только читают, ' +
        'администраторы меняют каналы и состав команды.') +
      '<div class="card"><h3>Пригласить сотрудника</h3>' +
      '<div class="row2"><input id="uem" type="email" placeholder="почта" autocomplete="off">' +
      '<input id="unm" placeholder="имя" autocomplete="off">' +
      '<select id="uro">' + opts + '</select>' +
      '<button id="uadd">Добавить</button></div>' +
      '<div class="hint">Оператор видит диалоги и отвечает. Наблюдатель только читает. ' +
      'Администратор может менять каналы и состав команды.</div>' +
      '<div class="err" id="uerr"></div></div>' +

      '<div class="card"><h3>Команда (' + USERS.length + ')</h3>' +
      USERS.map(function(u){
        var pill = u.is_active ? '' : '<span class="pill warn">отключён</span>';
        var seen = u.last_seen_at ? 'был ' + fmtTime(u.last_seen_at) : 'ещё не заходил';
        return '<div class="item"><div>' +
          '<div class="t">' + esc(u.full_name || u.email) + pill + '</div>' +
          '<div class="s">' + esc(u.email) + ' · ' + esc(ROLES[u.role] || u.role) +
          ' · ' + esc(seen) + '</div></div>' +
          (u.role === 'owner' ? '' :
            '<button class="ghost mini" data-user="' + u.id + '" data-active="' +
            (u.is_active ? 'false' : 'true') + '">' +
            (u.is_active ? 'Отключить' : 'Включить') + '</button>') +
          '</div>';
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
            ? 'Мест по тарифу: ' + p.limit + '. Отключите кого-то или расширьте тариф.'
            : p.error === 'bad_email' ? 'Проверьте адрес почты' : 'Не удалось добавить';
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
  }).catch(sErr);
}

function tabReplies(){
  api('/quick-replies').then(function(d){
    QR = d.quickReplies || [];
    pageBox().innerHTML = '<div class="pg">' +
      pageHead('Шаблоны ответов', 'Заготовки, которые оператор вставляет в переписку командой ' +
        '<b>/имя</b>. К шаблону можно приложить до трёх файлов — прайс, схему проезда, инструкцию.') +
      '<div class="card"><h3>Новый шаблон</h3>' +
      '<div class="row2"><input id="qsc" placeholder="короткое имя, например цена"></div>' +
      '<div class="row2" style="margin-top:9px">' +
      '<textarea id="qbd" rows="3" placeholder="Текст, который подставится в поле ответа"></textarea>' +
      '</div><div class="row2" style="margin-top:9px"><button id="qadd">Сохранить</button></div>' +
      '<div class="hint">В диалоге наберите <b>/имя</b> и нажмите Enter — текст развернётся ' +
      'в поле ответа, останется нажать Enter второй раз.</div>' +
      '<div class="err" id="qerr"></div>' +
      '<input type="file" id="qrFile" style="display:none"></div>' +

      '<div class="card"><h3>Шаблоны (' + QR.length + ')</h3>' +
      (QR.length ? QR.map(function(q){
        var files = q.attachments || [];
        var chips = files.map(function(a, i){
          return '<span class="fchip" title="' + esc(a.filename || 'файл') + '">' +
            '<span class="ic">' + (String(a.mime || '').indexOf('image/') === 0 ? '🖼' : '📄') + '</span>' +
            '<a href="#" data-open="' + q.id + '" data-oi="' + i + '">' + esc(a.filename || 'файл') + '</a>' +
            '<span class="dim">' + Math.round((a.size || 0) / 1024) + ' КБ</span>' +
            '<span class="x" data-del="' + q.id + '" data-di="' + i + '" title="Убрать файл">×</span></span>';
        }).join('');
        return '<div class="item"><div style="min-width:0">' +
          '<div class="t"><code>/' + esc(q.shortcut) + '</code></div>' +
          '<div class="s">' + esc(q.body) + '</div>' +
          (chips ? '<div class="fchips">' + chips + '</div>' : '') +
          '</div>' +
          '<div style="display:flex;gap:6px;flex:none">' +
          (files.length < 3
            ? '<button class="ghost mini" data-file="' + q.id + '">Файл</button>' : '') +
          '<button class="ghost mini" data-qr="' + q.id + '">Удалить</button></div></div>';
      }).join('') : '<div class="hint">Пока пусто.</div>') + '</div></div>';

    el('qadd').onclick = function(){
      el('qerr').textContent = '';
      busy(el('qadd'), true);
      api('/quick-replies', { method:'POST', body:{
        shortcut: el('qsc').value, body: el('qbd').value
      }}).then(function(){ tabReplies(); renderComposer(true) })
        .catch(function(e){
          var p = e.payload || {};
          el('qerr').textContent = p.error === 'shortcut_too_long'
            ? 'Короткое имя длиннее 32 символов' : 'Заполните имя и текст';
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
      if (f.size > 20 * 1024 * 1024){ alertLine('Файл больше 20 МБ — Telegram не пропустит'); return }
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
            ? 'К одному шаблону можно приложить не больше трёх файлов'
            : p.error === 'file_too_large' ? 'Файл больше 20 МБ' : 'Не удалось загрузить файл';
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
          .catch(function(){ alertLine('Файл недоступен') });
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
        var url = URL.createObjectURL(b);
        avatarCache[id] = url;
        // Узел мог быть заменён перерисовкой, пока картинка ехала.
        Array.prototype.forEach.call(document.querySelectorAll('[data-av="' + id + '"]'), function(n){
          n.style.backgroundImage = 'url(' + url + ')';
          n.textContent = '';
        });
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
  b.insertAdjacentText('beforeend', on ? 'Звук' : 'Тихо');
  b.classList.toggle('live', on);
  b.title = (PREFS.sound ? 'Звук включён' : 'Звук выключен') + ' · ' +
    (PREFS.push ? 'уведомления включены' : 'уведомления выключены') +
    ' — нажмите, чтобы переключить';
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
  b.insertAdjacentText('beforeend', v === 'light' ? 'Светлая' : v === 'dark' ? 'Тёмная' : 'Тема');
  b.title = v === 'auto'
    ? 'Тема как в системе — нажмите, чтобы выбрать светлую'
    : v === 'light' ? 'Светлая тема — нажмите, чтобы выбрать тёмную'
      : 'Тёмная тема — нажмите, чтобы вернуть системную';
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
    var n = new Notification(c.display_name || 'Новое сообщение', {
      body: c.preview || 'Клиент написал в ' + (CH[c.channel_type] || c.channel_type),
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
  var want = '<option value="">Все каналы</option>' + CHANNELS.map(function(c){
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
  if (e && e.status === 401){ logout(); el('gateErr').textContent = 'Токен недействителен или истёк'; }
}

var VIEWS = {
  channels: tabChannels,
  bots: renderBots,
  replies: tabReplies,
  users: tabUsers,
  profile: tabProfile,
  integrations: pageIntegrations
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
    pageBox().innerHTML = '<div class="pg"><div class="empty">Загружаю...</div></div>';
    (VIEWS[view] || function(){})();
  }
}

function start(){
  el('gate').style.display = 'none';
  el('app').style.display = 'grid';
  paintIcons();
  paintBell();
  paintThemeBtn();

  // Справочники грузим один раз при входе: без них список нельзя
  // отфильтровать по каналу, а кнопку «взять себе» — показать.
  api('/me').then(function(d){ ME = d }).catch(function(){});
  api('/channels').then(function(d){ CHANNELS = d.channels || []; fillChannelFilter() }).catch(function(){});
  api('/quick-replies').then(function(d){ QR = d.quickReplies || [] }).catch(function(){});

  refresh();
  readMetaHash();
  // Три секунды — компромисс: живо ощущается и не создаёт заметной
  // нагрузки. Позже сюда встанут вебсокеты, и опрос уйдёт.
  timer = setInterval(refresh, 3000);
}

function logout(){
  clearInterval(timer);
  TOKEN = ''; current = null; convs = [];
  sessionStorage.removeItem('omnidesk_token');
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
        if (!PREFS.push) alertLine('Браузер не разрешил уведомления');
      });
      return;
    }
  }
  PREFS.sound = false; PREFS.push = false; savePrefs();
};

/* ── Вход ────────────────────────────────────────────────────────── */

var pendingEmail = '';

function gateStep(name){
  ['stepEmail','stepSignup','stepCode','stepWs','stepToken'].forEach(function(id){
    el(id).style.display = id === name ? 'block' : 'none';
  });
}

function enterWith(token){
  TOKEN = token;
  sessionStorage.setItem('omnidesk_token', TOKEN);
  start();
}

el('ask').onclick = function(){
  var email = el('email').value.trim();
  el('gateErr').textContent = '';
  if (!email || email.indexOf('@') < 1){
    el('gateErr').textContent = 'Введите почту';
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
        : 'Не удалось отправить код';
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
  if (company.length < 2){ el('suErr').textContent = 'Напишите название компании'; return }
  if (!email || email.indexOf('@') < 1){ el('suErr').textContent = 'Введите рабочую почту'; return }

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
      el('suErr').textContent = p.detail || 'Не удалось отправить код';
    })
    .then(function(){ busy(el('suGo'), false) });
};

function submitCode(tenantId){
  var code = el('code').value.trim();
  el('codeErr').textContent = '';
  if (code.length !== 6){ el('codeErr').textContent = 'Код из шести цифр'; return }

  busy(el('verify'), true);
  var body = { email: pendingEmail, code: code };
  if (tenantId) body.tenantId = tenantId;

  api('/auth/verify', { method:'POST', body: body })
    .then(function(r){
      // 300 приходит, когда почта заведена в нескольких организациях:
      // выбрать за человека нельзя, он попадёт не туда и не поймёт почему.
      if (r.needsWorkspace){
        el('wsList').innerHTML = r.needsWorkspace.map(function(w){
          return '<button class="ghost" style="width:100%;margin-top:8px" data-ws="' +
            w.tenantId + '">' + esc(w.name) + '</button>';
        }).join('');
        gateStep('stepWs');
        Array.prototype.forEach.call(el('wsList').children, function(b){
          b.onclick = function(){ gateStep('stepCode'); submitCode(b.dataset.ws) };
        });
        return;
      }
      if (r.token) {
        enterWith(r.token);
        // Первый вход в только что созданную компанию: сразу ведём туда,
        // где всё начинается, иначе человек видит пустой список чатов
        // и не понимает, что делать дальше.
        if (r.created) {
          setView('channels');
          toast('Компания создана. Подключите первый канал — это десять минут.');
        }
      }
    })
    .catch(function(e){
      var p = e.payload || {};
      el('codeErr').textContent =
        p.error === 'wrong_code'
          ? 'Неверный код' + (p.attemptsLeft > 0 ? ', осталось попыток: ' + p.attemptsLeft : '')
        : p.error === 'code_expired' ? 'Код истёк, запросите новый'
        : p.error === 'too_many_attempts' ? 'Слишком много попыток, запросите новый код'
        : p.error === 'no_code' ? 'Код не запрашивали'
        : 'Не удалось войти';
    })
    .then(function(){ busy(el('verify'), false) });
}

el('verify').onclick = function(){ submitCode(null) };
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
    el('tokErr').textContent = 'Токен не подошёл. Проверьте, что скопировали целиком.';
  });
};
el('tok').onkeydown = function(e){ if (e.key === 'Enter') el('enter').click() };

if (TOKEN) start();
})();
</script>
</body>
</html>`;
