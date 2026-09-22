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
export const UI_BUILD = '2026-09-22-3';

export const INBOX_HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="omnidesk-build" content="${UI_BUILD}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<title>Rozmovio</title>
<style>
  /* ═══ Оформление «Рабочий стол» ═══
     Плотно, без украшений, цвет только там, где несёт смысл: статус
     диалога, непрочитанное, ошибка. Главная кнопка почти чёрная —
     синяя на экране, заполненном данными, спорит с самими данными.

     Гарнитура задана одной переменной --font: чтобы поменять её
     во всём интерфейсе, достаточно этой строки. */
  :root{color-scheme:light;
    --font:"Manrope",ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;
    --bg:#f7f7f8;--panel:#fff;--panel2:#f0f0f2;--line:#e5e5e8;--line2:#dcdce1;
    --hover:#f2f2f4;
    --t1:#16161a;--t2:#4a4a52;--t3:#8b8b95;
    --accent:#16161a;--accent-h:#2f2f38;--on-accent:#fff;--link:#3538cd;
    --ring:rgba(53,56,205,.35);--shadow:0 1px 2px rgba(16,16,20,.07);
    --good:#067647;--good-bg:#ecfdf3;--warn:#b54708;--warn-bg:#fffaeb;
    --crit:#d92d20;--crit-bg:#fef3f2;
    --rail:#fbfbfc;--railT:#8b8b95;--railOn:#16161a;--railOnBg:#eeeef1;}
  @media(prefers-color-scheme:dark){:root{
    --bg:#0f0f12;--panel:#16161a;--panel2:#1e1e24;--line:#26262d;--line2:#31313a;
    --hover:#1c1c22;
    --t1:#f0f0f3;--t2:#a8a8b4;--t3:#74747f;
    --accent:#f0f0f3;--accent-h:#d8d8df;--on-accent:#16161a;--link:#a5a7ff;
    --ring:rgba(165,167,255,.4);--shadow:0 1px 2px rgba(0,0,0,.4);
    --good:#3ccf7e;--good-bg:#0f2a1d;--warn:#f5b544;--warn-bg:#2a1f0b;
    --crit:#f97066;--crit-bg:#2c1414;
    --rail:#0b0b0e;--railT:#74747f;--railOn:#fff;--railOnBg:#1f1f27;}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--t1);height:100vh;overflow:hidden;
    font:13px/1.5 var(--font);-webkit-font-smoothing:antialiased;
    text-rendering:optimizeLegibility}
  .tnum{font-variant-numeric:tabular-nums}

  textarea,input,select{width:100%;background:var(--panel);color:var(--t1);
    border:1px solid var(--line2);border-radius:6px;padding:8px 10px;
    font:inherit;font-size:13px;resize:none}
  textarea,input,select{transition:border-color .13s ease,box-shadow .13s ease}
  textarea:hover,input:hover,select:hover{border-color:var(--t3)}
  /* Кольцо вместо жирной обводки: контур толщиной в два пикселя
     визуально увеличивает поле и дёргает соседние элементы. */
  textarea:focus,input:focus,select:focus{outline:none;border-color:var(--link);
    box-shadow:0 0 0 3px var(--ring)}
  /* Ни одна кнопка не переносится: подпись в две строки ломает высоту
     строки и читается как поломка вёрстки. */
  /* Кнопка должна отвечать на прикосновение. Без наведения, нажатия
     и признака ожидания интерфейс воспринимается как картинка: человек
     жмёт и не понимает, случилось что-то или нет.

     Длительности маленькие намеренно. 130 мс на цвет читается как
     отклик; всё, что дольше 200 мс, ощущается как задержка. Нажатие
     ещё короче — 60 мс, оно должно совпадать с движением пальца. */
  button{background:var(--accent);color:var(--on-accent);border:1px solid var(--accent);
    border-radius:6px;padding:8px 13px;font:inherit;font-size:12.5px;font-weight:600;
    cursor:pointer;white-space:nowrap;box-shadow:var(--shadow);position:relative;
    transition:background-color .13s ease,border-color .13s ease,color .13s ease,
      box-shadow .13s ease,transform .06s ease,opacity .13s ease}
  button:hover{background:var(--accent-h);border-color:var(--accent-h)}
  /* Смещение на пиксель вниз — самый дешёвый способ передать нажатие:
     кнопка буквально уходит под палец. */
  button:active{transform:translateY(1px);box-shadow:none}
  button:focus-visible{outline:2px solid var(--link);outline-offset:2px}
  button:disabled{opacity:.5;cursor:default;transform:none;box-shadow:none}
  button:disabled:hover{background:var(--accent);border-color:var(--accent)}

  button.ghost{background:var(--panel);color:var(--t2);border-color:var(--line2);font-weight:600}
  button.ghost:hover{background:var(--hover);color:var(--t1);border-color:var(--t3)}
  button.ghost:disabled:hover{background:var(--panel);border-color:var(--line2)}

  /* Ожидание. Кнопка не просто гаснет — она показывает, что запрос идёт.
     Подпись прячется, а не заменяется словом «Подождите»: так не прыгает
     ширина и не дёргается вся строка кнопок. */
  button.busy{color:transparent;pointer-events:none}
  button.busy::after{content:"";position:absolute;inset:0;margin:auto;width:14px;height:14px;
    border:2px solid currentColor;border-top-color:transparent;border-radius:50%;
    color:var(--on-accent);animation:spin .6s linear infinite}
  button.ghost.busy::after{color:var(--t2)}
  @keyframes spin{to{transform:rotate(360deg)}}
  @media(prefers-reduced-motion:reduce){
    button,.conv,.tab,.rbtn,.icob{transition:none}
    button.busy::after{animation-duration:1.8s}
  }
  .mini{padding:6px 10px;font-size:12px}
  .err{color:var(--crit);font-size:12px;margin-top:6px}
  .ok{color:var(--good);font-size:12px;margin-top:6px}
  .qrwrap{display:flex;gap:20px;align-items:center;flex-wrap:wrap;margin:14px 0 4px;
    padding:16px;border:1px solid var(--line);border-radius:12px;background:var(--bg)}
  .qr{width:220px;height:220px;background:#fff;border-radius:10px;padding:8px;flex:none}
  .qr svg{width:100%;height:100%;display:block}
  .muted{color:var(--t3)}
  .steps{margin:0;padding-left:18px;line-height:1.9;font-size:13px}
  .dim{color:var(--t3)}
  .empty{padding:26px 20px;color:var(--t3);font-size:12.5px;text-align:center;line-height:1.6}

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
  #rail .logo{width:30px;height:30px;border-radius:7px;background:var(--accent);
    color:var(--on-accent);display:flex;align-items:center;justify-content:center;
    font-weight:700;font-size:11.5px;letter-spacing:-.03em;margin-bottom:14px}
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
  .tabs{display:flex;gap:16px;margin-top:11px}
  .tab{background:transparent;border:0;color:var(--t3);font-weight:600;font-size:12.5px;
    padding:0 0 9px;border-bottom:2px solid transparent;margin-bottom:-1px;border-radius:0;
    box-shadow:none;transition:color .13s ease,border-color .13s ease}
  .tab:hover{background:transparent;border-color:var(--line2)}
  .tab:active{transform:none}
  .tab:hover{color:var(--t2)}
  .tab.on{color:var(--t1);border-color:var(--accent)}
  .tab .n{color:var(--t3);font-weight:600;margin-left:5px;font-size:11px;
    font-variant-numeric:tabular-nums}
  #convs{overflow-y:auto;flex:1;min-height:0}
  .conv{padding:10px 14px;border-bottom:1px solid var(--line);cursor:pointer;
    display:flex;gap:10px;transition:background-color .1s ease}
  .conv:active{background:var(--panel2)}
  .conv:hover{background:var(--hover)}
  .conv.on{background:var(--hover);box-shadow:inset 2px 0 0 var(--accent)}
  .av{width:34px;height:34px;border-radius:6px;flex:none;display:flex;align-items:center;
    justify-content:center;font-weight:600;font-size:12px;color:#fff;overflow:hidden;
    background-size:cover;background-position:center}
  .conv .body{min-width:0;flex:1}
  .conv .r1{display:flex;justify-content:space-between;gap:8px;align-items:baseline}
  .conv .nm{font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;
    white-space:nowrap}
  .conv.unread .nm{font-weight:700}
  .conv .tm{font-size:10.5px;color:var(--t3);white-space:nowrap;font-variant-numeric:tabular-nums}
  .conv .pv{font-size:12px;color:var(--t3);overflow:hidden;text-overflow:ellipsis;
    white-space:nowrap;margin-top:2px}
  .conv .r3{display:flex;gap:5px;align-items:center;margin-top:6px;flex-wrap:wrap}
  .chip{font-size:10px;padding:2px 6px;border-radius:4px;background:var(--panel2);
    color:var(--t2);font-weight:600}
  .chip.who{background:var(--panel2);color:var(--t2)}
  .badge{background:var(--crit);color:#fff;border-radius:9px;padding:1px 6px;
    font-size:10px;font-weight:700;font-variant-numeric:tabular-nums;margin-left:auto}
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
</style>
</head>
<body>

<div id="gate">
  <div class="box">
    <div class="mark">OD</div>

    <div id="stepEmail">
      <h1>Вход в Rozmovio</h1>
      <p>Введите рабочую почту — пришлём код из шести цифр.</p>
      <input id="email" type="email" placeholder="you@company.com" autocomplete="email">
      <div class="err" id="gateErr"></div>
      <div style="margin-top:12px"><button id="ask">Получить код</button></div>
      <div class="alt"><a id="toToken">Войти по токену доступа</a></div>
    </div>

    <div id="stepCode" style="display:none">
      <h1>Код отправлен</h1>
      <p>Проверьте почту <b id="sentTo"></b>. Код действует 10 минут.</p>
      <input id="code" inputmode="numeric" maxlength="6" placeholder="000000" autocomplete="one-time-code">
      <div class="err" id="codeErr"></div>
      <div style="margin-top:12px;display:flex;gap:8px">
        <button id="verify">Войти</button>
        <button class="ghost" id="again">Другая почта</button>
      </div>
    </div>

    <div id="stepWs" style="display:none">
      <h1>Куда входим?</h1>
      <p>Эта почта заведена в нескольких организациях.</p>
      <div id="wsList"></div>
    </div>

    <div id="stepToken" style="display:none">
      <h1>Вход по токену</h1>
      <p>Токен выдаёт команда на сервере:
        <code>docker compose exec api node apps/api/dist/seed.js --name "Компания" --email you@example.com</code>
      </p>
      <input id="tok" type="password" placeholder="eyJhbGciOi..." autocomplete="off">
      <div class="err" id="tokErr"></div>
      <div style="margin-top:12px;display:flex;gap:8px">
        <button id="enter">Войти</button>
        <button class="ghost" id="toEmail">Назад к почте</button>
      </div>
    </div>
  </div>
</div>

<div id="app" data-view="chats">
  <nav id="rail">
    <div class="logo" id="logo" title="К чатам" style="cursor:pointer">R</div>
    <button class="rbtn on" data-view="chats" data-icon="chat">Чаты<span class="cnt" id="railCnt" style="display:none"></span></button>
    <button class="rbtn" data-view="bots" data-icon="bot">Боты</button>
    <div class="grow"></div>
    <button class="rbtn" id="bell" data-icon="bell">Звук</button>
    <button class="rbtn" id="cog" data-icon="gear">Настройки</button>
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

  <div id="bots"></div>
</div>

<div id="toast" role="status" aria-live="polite"></div>

<div id="settings">
  <div class="sheet">
    <div class="shead"><b>Настройки</b><button class="ghost mini" id="sclose">Закрыть</button></div>
    <div class="stabs">
      <button class="stab on" data-tab="profile">Профиль</button>
      <button class="stab" data-tab="channels">Каналы</button>
      <button class="stab" data-tab="users">Команда</button>
      <button class="stab" data-tab="replies">Шаблоны</button>
    </div>
    <div class="sbody" id="sbody"></div>
  </div>
</div>

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
      '<div class="av" data-av="' + (c.has_avatar ? c.contact_id : '') + '" style="background:' +
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
      '<div class="av" data-av="' + (c.has_avatar ? c.contact_id : '') + '" style="background:' +
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
    ':' + (replyTo ? replyTo.id : '') + ':' + (pendingFile ? pendingFile.name : '');
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
    '<div class="row">' +
    '<input type="file" id="file" style="display:none">' +
    '<button class="icob" id="clip" title="Прикрепить файл">' + icon('clip') + '</button>' +
    (QR.length ? '<button class="icob" id="tpl" title="Шаблон">' + icon('bolt') + '</button>' : '') +
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
  if (el('tpl')) el('tpl').onclick = toggleTemplates;
  ta.focus();
}

function expand(ta){
  var t = ta.value.trim();
  if (t.charAt(0) !== '/') return false;
  var hit = QR.filter(function(q){ return q.shortcut === t.slice(1) })[0];
  if (!hit) return false;
  ta.value = hit.body;
  ta.style.height='auto'; ta.style.height=Math.min(ta.scrollHeight,150)+'px';
  return true;
}

function toggleTemplates(){
  var b = el('tplBox');
  if (b.style.display !== 'none'){ b.style.display='none'; return }
  b.innerHTML = QR.map(function(q, i){
    return '<div class="qr" data-i="' + i + '"><b>/' + esc(q.shortcut) + '</b>' +
      '<span class="x">' + esc(q.body) + '</span></div>';
  }).join('');
  b.style.display = 'block';
  Array.prototype.forEach.call(b.children, function(node){
    node.onclick = function(){
      var ta = el('txt');
      ta.value = QR[Number(node.dataset.i)].body;
      ta.style.height='auto'; ta.style.height=Math.min(ta.scrollHeight,150)+'px';
      b.style.display = 'none';
      ta.focus();
    };
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

  var prepared = pendingFile
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
      '<div class="av" data-av="' + (ct.avatar_url ? ct.id : '') + '" ' +
        'style="width:44px;height:44px;font-size:15px;background:' +
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

/* ══════════════ Чат-боты ══════════════ */

var TRIGGERS = {
  welcome:'Приветствие',
  contains:'Содержит слово',
  equals:'Точное совпадение',
  fallback:'Ничего не подошло'
};

function renderBots(){
  api('/bot-rules').then(function(d){
    var rules = d.rules || [];
    var chOpts = '<option value="">Все каналы</option>' + CHANNELS.map(function(c){
      return '<option value="' + c.id + '">' + esc(c.display_name) + '</option>';
    }).join('');
    var trOpts = Object.keys(TRIGGERS).map(function(k){
      return '<option value="' + k + '"' + (k === 'contains' ? ' selected' : '') + '>' +
        TRIGGERS[k] + '</option>';
    }).join('');

    el('bots').innerHTML =
      '<h2>Чат-боты</h2>' +
      '<p class="lead">Правило — это «условие на входящее сообщение → ответ». ' +
      'Сработавшее правило отвечает клиенту мгновенно, в любое время суток.</p>' +
      '<p class="lead"><b>Когда бот молчит.</b> Если у диалога есть ответственный — ' +
      'его ведёт человек, бот не вмешивается. Если оператор отвечал менее 30 минут назад — ' +
      'бот берёт паузу, чтобы не перебивать живую беседу, и включается сам. ' +
      'И есть жёсткий выключатель «Бот: выкл» в самом диалоге. ' +
      'Текущее состояние видно на этой кнопке над перепиской.</p>' +

      '<div class="card"><h3>Новое правило</h3>' +
      '<div class="row2"><input id="bName" placeholder="Название, например «Прайс»"></div>' +
      '<div class="row2" style="margin-top:9px">' +
        '<select id="bTr">' + trOpts + '</select>' +
        '<select id="bCh">' + chOpts + '</select>' +
      '</div>' +
      '<div class="row2" style="margin-top:9px">' +
        '<input id="bKw" placeholder="Ключевые слова через запятую: цена, прайс, стоимость">' +
      '</div>' +
      '<div class="row2" style="margin-top:9px">' +
        '<textarea id="bTx" rows="3" placeholder="Что ответить клиенту"></textarea>' +
      '</div>' +
      '<div class="row2" style="margin-top:9px"><button id="bAdd">Создать</button></div>' +
      '<div class="hint">«Приветствие» срабатывает на первое сообщение в диалоге и только один раз. ' +
      '«Ничего не подошло» — последний рубеж, оно проверяется после всех остальных.</div>' +
      '<div class="err" id="bErr"></div></div>' +

      '<div class="card"><h3>Правила (' + rules.length + ')</h3>' +
      (rules.length ? rules.map(function(r){
        var kw = (r.keywords || []).join(', ');
        return '<div class="item"><div style="min-width:0">' +
          '<div class="t">' + esc(r.name) +
            (r.is_active ? '<span class="pill">включено</span>'
                         : '<span class="pill warn">выключено</span>') + '</div>' +
          '<div class="s">' + esc(TRIGGERS[r.trigger_type] || r.trigger_type) +
            (kw ? ': ' + esc(kw) : '') +
            ' · ' + esc(r.channel_name || 'все каналы') +
            ' · приоритет ' + esc(r.priority) +
            ' · сработало ' + esc(r.hits) + '</div>' +
          '<div class="s" style="color:var(--t2);margin-top:5px">' + esc(r.reply_text) + '</div>' +
        '</div><div class="row2" style="flex:none">' +
          '<button class="ghost mini" data-rule="' + r.id + '" data-active="' +
            (r.is_active ? 'false' : 'true') + '">' +
            (r.is_active ? 'Выключить' : 'Включить') + '</button>' +
          '<button class="ghost mini" data-rdel="' + r.id + '">Удалить</button>' +
        '</div></div>';
      }).join('') : '<div class="hint">Пока ни одного правила.</div>') + '</div>';

    el('bAdd').onclick = function(){
      el('bErr').textContent = '';
      busy(el('bAdd'), true);
      api('/bot-rules', { method:'POST', body:{
        name: el('bName').value,
        triggerType: el('bTr').value,
        channelId: el('bCh').value || null,
        keywords: el('bKw').value.split(',').map(function(s){ return s.trim() }).filter(Boolean),
        replyText: el('bTx').value,
        priority: el('bTr').value === 'fallback' ? 900 : 100
      }}).then(renderBots)
        .catch(function(e){
          var p = e.payload || {};
          el('bErr').textContent =
            p.error === 'keywords_required' ? 'Для этого условия нужны ключевые слова'
            : p.error === 'name_required' ? 'Укажите название'
            : p.error === 'reply_required' ? 'Напишите текст ответа'
            : 'Не удалось создать правило';
          busy(el('bAdd'), false);
        });
    };

    Array.prototype.forEach.call(el('bots').querySelectorAll('[data-rule]'), function(b){
      b.onclick = function(){
        api('/bot-rules/' + b.dataset.rule, { method:'PATCH',
          body:{ isActive: b.dataset.active === 'true' } }).then(renderBots).catch(showErr);
      };
    });
    armDelete(el('bots').querySelectorAll('[data-rdel]'), function(b){
      return api('/bot-rules/' + b.dataset.rdel, { method:'DELETE' }).then(renderBots);
    });
  }).catch(showErr);
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

function openSettings(){ el('settings').classList.add('on'); paintSettings() }
function closeSettings(){ el('settings').classList.remove('on') }

function paintSettings(){
  Array.prototype.forEach.call(document.querySelectorAll('.stab'), function(b){
    b.classList.toggle('on', b.dataset.tab === S.tab);
  });
  el('sbody').innerHTML = '<div class="empty">Загружаю...</div>';
  ({ profile:tabProfile, channels:tabChannels, users:tabUsers, replies:tabReplies })[S.tab]();
}

function sErr(e){
  el('sbody').innerHTML = '<div class="empty">Не удалось загрузить: ' +
    esc((e && e.message) || 'ошибка') + '</div>';
}

function tabProfile(){
  api('/me').then(function(d){
    ME = d;
    var t = d.tenant || {}, u = d.user || {}, c = d.counts || {};
    el('sbody').innerHTML =
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
      '</div></div>';
  }).catch(sErr);
}

function tabChannels(){
  api('/channels').then(function(d){
    CHANNELS = d.channels || [];
    fillChannelFilter();

    var html =
      '<div class="card"><h3>Подключить Telegram-бота</h3>' +
      '<div class="row2"><input id="btok" type="password" placeholder="123456789:AAF..." autocomplete="off">' +
      '<button id="badd">Подключить</button></div>' +
      '<div class="hint">Токен выдаёт <b>@BotFather</b>: команда /newbot для нового бота ' +
      'или /token для существующего. Токен шифруется и обратно не показывается — ' +
      'сохраните копию у себя.</div>' +
      '<div class="err" id="berr"></div><div class="ok" id="bok"></div></div>';

    html +=
      '<div class="card" id="metaCard"><h3>Facebook Messenger и Instagram</h3>' +
      '<div id="metaBody"><div class="hint">Войдите через Facebook под аккаунтом, который управляет страницей. ' +
      'Instagram подключается через страницу Facebook, к которой он привязан, и должен быть ' +
      'профессиональным аккаунтом (бизнес или автор).</div>' +
      '<div class="row2" style="margin-top:10px"><button id="metaGo">Войти через Facebook</button></div>' +
      '<div class="err" id="metaErr"></div></div></div>';

    html +=
      '<div class="card"><h3>Подключить Telegram по номеру</h3>' +
      '<div class="hint">Личный или рабочий аккаунт Telegram — клиенты пишут на ваш номер, ' +
      'как обычно, а переписка появляется здесь. Ответы уходят от вашего имени.</div>' +
      '<div class="row2" style="margin-top:10px"><input id="uname" placeholder="Название, например: Продажи" autocomplete="off">' +
      '<button id="uqr">Показать QR-код</button></div>' +
      '<div id="uqrbox"></div>' +
      '<div class="hint">Telegram не любит массовые рассылки с личных аккаунтов: ' +
      'отвечайте клиентам, но не пишите сотням незнакомых людей — за это блокируют номер.</div></div>';

    html += '<div class="card"><h3>Подключено (' + CHANNELS.length + ')</h3>' +
      (CHANNELS.length ? CHANNELS.map(function(c){
        var pill = c.status === 'active' ? '<span class="pill">работает</span>'
          : c.status === 'degraded' ? '<span class="pill crit">нужно переподключить</span>'
          : '<span class="pill warn">выключен</span>';
        var bits = [];
        if (c.meta && c.meta.username) bits.push('@' + c.meta.username);
        bits.push('диалогов: ' + c.conversations);
        if (c.meta && c.meta.phone) bits.push(c.meta.phone);
        if (c.last_error) bits.push(errLabel(c.last_error));
        return '<div class="item"><div>' +
          '<div class="t">' + esc(c.display_name) + pill + '</div>' +
          '<div class="s">' + esc(CH[c.type] || c.type) + ' · ' + esc(bits.join(' · ')) + '</div>' +
          '</div><div class="row2" style="flex:none">' +
          '<button class="ghost mini" data-toggle="' + c.id + '" data-to="' +
            (c.status === 'active' ? 'disconnected' : 'active') + '">' +
            (c.status === 'active' ? 'Выключить' : 'Включить') + '</button>' +
          '<button class="ghost mini" data-del="' + c.id + '">Удалить</button>' +
          '</div></div>';
      }).join('') : '<div class="hint">Пока ни одного канала.</div>') + '</div>';

    // Честный список того, чего ещё нет. Пустой экран без объяснений хуже:
    // непонятно, это не сделано или сломалось.
    html += '<div class="card"><h3>Готовятся</h3>' +
      ['whatsapp_cloud','whatsapp_user','viber_bot','viber_user'].map(function(t){
        return '<div class="item"><div><div class="t">' + esc(CH[t]) +
          '<span class="pill soon">скоро</span></div></div></div>';
      }).join('') + '</div>';

    el('sbody').innerHTML = html;

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

    Array.prototype.forEach.call(el('sbody').querySelectorAll('[data-toggle]'), function(b){
      b.onclick = function(){
        busy(b, true);
        api('/channels/' + b.dataset.toggle, { method:'PATCH', body:{ status: b.dataset.to } })
          .then(tabChannels).catch(function(){ busy(b, false) });
      };
    });
    armDelete(el('sbody').querySelectorAll('[data-del]'), function(b){
      return api('/channels/' + b.dataset.del, { method:'DELETE' }).then(tabChannels);
    });
  }).catch(sErr);
}

/* Вход через Facebook уводит со страницы и возвращает на /app#meta-pick=...
   Токен входа в Rozmovio живёт в sessionStorage вкладки и переход переживает. */
var META_ERRORS = {
  cancelled:'Вход через Facebook отменён.',
  state:'Ссылка устарела — нажмите «Войти через Facebook» ещё раз.',
  exchange:'Facebook не подтвердил вход. Попробуйте ещё раз.',
  unavailable:'Подключение Facebook ещё не включено на сервере.'
};

function readMetaHash(){
  var h = location.hash || '';
  var m = h.match(/meta-pick=([0-9a-f-]+)/);
  var e = h.match(/meta-error=([a-z]+)/);
  if (!m && !e) return false;
  if (m) S.metaPick = m[1];
  if (e) S.metaError = META_ERRORS[e[1]] || 'Не удалось подключить Facebook';
  history.replaceState(null, '', location.pathname);
  S.tab = 'channels';
  openSettings();
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

    el('sbody').innerHTML =
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

    Array.prototype.forEach.call(el('sbody').querySelectorAll('[data-user]'), function(b){
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
    el('sbody').innerHTML =
      '<div class="card"><h3>Новый шаблон</h3>' +
      '<div class="row2"><input id="qsc" placeholder="короткое имя, например цена"></div>' +
      '<div class="row2" style="margin-top:9px">' +
      '<textarea id="qbd" rows="3" placeholder="Текст, который подставится в поле ответа"></textarea>' +
      '</div><div class="row2" style="margin-top:9px"><button id="qadd">Сохранить</button></div>' +
      '<div class="hint">В диалоге наберите <b>/имя</b> и нажмите Enter — текст развернётся ' +
      'в поле ответа, останется нажать Enter второй раз.</div>' +
      '<div class="err" id="qerr"></div></div>' +

      '<div class="card"><h3>Шаблоны (' + QR.length + ')</h3>' +
      (QR.length ? QR.map(function(q){
        return '<div class="item"><div>' +
          '<div class="t"><code>/' + esc(q.shortcut) + '</code></div>' +
          '<div class="s">' + esc(q.body) + '</div></div>' +
          '<button class="ghost mini" data-qr="' + q.id + '">Удалить</button></div>';
      }).join('') : '<div class="hint">Пока пусто.</div>') + '</div>';

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

    armDelete(el('sbody').querySelectorAll('[data-qr]'), function(b){
      return api('/quick-replies/' + b.dataset.qr, { method:'DELETE' })
        .then(function(){ tabReplies(); renderComposer(true) });
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
  bolt:'<path d="M13 2L4.1 13.3a.7.7 0 0 0 .5 1.2H11l-1 8.5 8.9-11.3a.7.7 0 0 0-.5-1.2H12z"/>'
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

function paintAvatars(){
  Array.prototype.forEach.call(document.querySelectorAll('[data-av]'), function(node){
    var id = node.dataset.av;
    if (!id || node.dataset.done) return;
    node.dataset.done = '1';

    if (avatarCache[id] === false) return;
    if (avatarCache[id]) { node.style.backgroundImage = 'url(' + avatarCache[id] + ')'; return }

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

function setView(view){
  el('app').dataset.view = view;
  if (view === 'chats') backToList();
  Array.prototype.forEach.call(document.querySelectorAll('.rbtn[data-view]'), function(b){
    b.classList.toggle('on', b.dataset.view === view);
  });
  if (view === 'bots') renderBots();
}

function start(){
  el('gate').style.display = 'none';
  el('app').style.display = 'grid';
  paintIcons();
  paintBell();

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
el('cog').onclick = openSettings;
el('out').onclick = logout;
el('sclose').onclick = closeSettings;
el('settings').onclick = function(e){ if (e.target === el('settings')) closeSettings() };
document.addEventListener('keydown', function(e){
  if (e.key === 'Escape' && el('settings').classList.contains('on')) closeSettings();
});
Array.prototype.forEach.call(document.querySelectorAll('.stab'), function(b){
  b.onclick = function(){ S.tab = b.dataset.tab; paintSettings() };
});

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
  ['stepEmail','stepCode','stepWs','stepToken'].forEach(function(id){
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
      if (r.token) enterWith(r.token);
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
