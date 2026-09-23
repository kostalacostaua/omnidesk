/**
 * Дизайн-система Rozmovio.
 *
 * Один источник правды на весь продукт: и рабочее место оператора
 * (ui.ts), и промо-страница (landing.ts), и любая новая страница берут
 * оформление отсюда. Смысл простой: когда цвет кнопки задан в двух
 * местах, через месяц он в двух местах разный.
 *
 * Строение файла повторяет то, как оформление применяют:
 *
 *   TOKENS  — величины: цвет, отступ, радиус, тень, скорость, шрифт.
 *             Ничего не рисуют, только называют. Светлая и тёмная тема.
 *   BASE    — сброс и оформление обычных тегов: body, кнопка, поле.
 *             Работает без классов — разметка остаётся читаемой.
 *   KIT     — готовые блоки: карточки, статусы, таблицы, вкладки,
 *             пустые состояния, окна, уведомления.
 *
 * ⚠️ ВНУТРИ ЭТИХ СТРОК НЕЛЬЗЯ ИСПОЛЬЗОВАТЬ ОБРАТНЫЕ СЛЭШИ — они
 * попадают в шаблонную строку ui.ts и там съедаются компилятором.
 * За этим следит scripts/check-ui.mjs.
 *
 * Тема переключается атрибутом на корне документа:
 *
 *   нет атрибута или data-theme="auto" — как в системе
 *   data-theme="light"                 — светлая всегда
 *   data-theme="dark"                  — тёмная всегда
 *
 * Поэтому тёмный набор значений подставляется дважды: под системное
 * предпочтение (но только если человек не выбрал светлую руками)
 * и под явный выбор. Дублирование намеренное и собрано из одной
 * константы DARK, чтобы не разъехалось.
 */

/** Набор значений тёмной темы. Подставляется в два селектора. */
const DARK = `color-scheme:dark;
    --bg:#070a16;--bg2:#0d1226;--panel:rgba(22,29,54,.55);--solid:#141b33;--panel2:rgba(255,255,255,.06);
    --line:rgba(255,255,255,.09);--line2:rgba(255,255,255,.16);--hover:rgba(255,255,255,.07);
    --t1:#eef0f8;--t2:#a3a9bf;--t3:#7e86a3;
    --accent:#6d97ff;--accent-h:#8aadff;--on-accent:#0b1022;--link:#8aadff;
    --accent-soft:rgba(109,151,255,.16);
    --ring:rgba(109,151,255,.3);
    --shadow:0 1px 2px rgba(0,0,0,.4);
    --lift:0 18px 40px -18px rgba(0,0,0,.7),0 2px 10px -6px rgba(0,0,0,.6);
    --lift2:0 30px 80px -30px rgba(0,0,0,.85),0 4px 16px -8px rgba(0,0,0,.6);
    --good:#47cd89;--good-bg:rgba(71,205,137,.12);--warn:#fdb022;--warn-bg:rgba(253,176,34,.12);
    --crit:#f97066;--crit-bg:rgba(249,112,102,.12);
    --rail:rgba(18,24,46,.55);--railT:#7e86a3;--railOn:#eef0f8;--railOnBg:rgba(255,255,255,.1);
    --glass:rgba(22,29,54,.55);--glass-line:rgba(255,255,255,.1);
    --glow:rgba(122,60,240,.34);
    /* Блик по верхней кромке и мягкая внутренняя тень снизу — то, из
       чего и состоит ощущение стекла: свет падает сверху. */
    --sheen:inset 0 1px 0 rgba(255,255,255,.14),inset 0 -1px 0 rgba(0,0,0,.25);
    --sheen-soft:inset 0 1px 0 rgba(255,255,255,.1);
    --mesh:radial-gradient(60vw 48vh at 8% -6%,rgba(47,107,255,.22),transparent 60%),
      radial-gradient(52vw 46vh at 102% 4%,rgba(122,60,240,.2),transparent 62%),
      radial-gradient(46vw 44vh at 50% 108%,rgba(47,107,255,.12),transparent 60%);`;

/**
 * Величины. Шкала отступов — шаг 4 пикселя: этого достаточно,
 * чтобы всё выстраивалось по одной сетке, и мало, чтобы спорить
 * о «на два пикселя ниже».
 */
export const TOKENS_CSS = `
  :root{color-scheme:light;
    /* Шрифт. На технике Apple -apple-system отдаёт системный SF — тот
       самый, за который любят их интерфейсы. Лицензия SF не позволяет
       раздавать его веб-шрифтом, поэтому везде остальном берётся Inter:
       он построен на тех же принципах и рядом с SF не спорит. */
    --font:-apple-system,BlinkMacSystemFont,"SF Pro Text","Inter",ui-sans-serif,
      "Segoe UI",Roboto,sans-serif;
    --font-display:-apple-system,BlinkMacSystemFont,"SF Pro Display","Inter",
      ui-sans-serif,"Segoe UI",sans-serif;
    --mono:ui-monospace,SFMono-Regular,Menlo,monospace;
    --bg:#eef1f8;--bg2:#e6ebf7;--panel:rgba(255,255,255,.62);--solid:#fff;
    --panel2:rgba(11,16,34,.045);
    --line:rgba(11,16,34,.07);--line2:rgba(11,16,34,.13);--hover:rgba(11,16,34,.045);
    --t1:#0b1022;--t2:#5a6178;--t3:#8a90a6;
    --accent:#2657e0;--accent-h:#1c46c0;--on-accent:#fff;--link:#2657e0;
    --accent-soft:rgba(38,87,224,.1);
    --brand1:#2f6bff;--brand2:#7a3cf0;--ink:#0b1022;--navy:#0e1530;
    --grad:linear-gradient(120deg,var(--brand1),var(--brand2));
    --ring:rgba(38,87,224,.26);
    --shadow:0 1px 2px rgba(11,16,34,.05);
    --lift:0 18px 44px -20px rgba(11,16,34,.3),0 2px 8px -4px rgba(11,16,34,.1);
    --lift2:0 30px 70px -28px rgba(11,16,34,.3),0 4px 14px -8px rgba(11,16,34,.14);
    --good:#067647;--good-bg:#e9faf1;--warn:#b54708;--warn-bg:#fff6e6;
    --crit:#d92d20;--crit-bg:#fdeeed;
    --rail:rgba(255,255,255,.5);--railT:#6b7288;--railOn:#0b1022;--railOnBg:rgba(255,255,255,.75);
    --glass:rgba(255,255,255,.62);--glass-line:rgba(255,255,255,.75);
    --glow:rgba(47,107,255,.26);
    /* Стекло — это не прозрачность, а свет на кромке: блик сверху и
       тонкая внутренняя тень снизу. Без них поверхность выглядит
       просто выцветшей. */
    --sheen:inset 0 1px 0 rgba(255,255,255,.9),inset 0 -1px 0 rgba(11,16,34,.05);
    --sheen-soft:inset 0 1px 0 rgba(255,255,255,.75);
    --mesh:radial-gradient(56vw 46vh at 6% -8%,rgba(47,107,255,.2),transparent 60%),
      radial-gradient(50vw 44vh at 104% 2%,rgba(122,60,240,.16),transparent 62%),
      radial-gradient(44vw 40vh at 52% 106%,rgba(47,107,255,.1),transparent 60%);
    --blur:saturate(1.8) blur(22px);
    --s1:4px;--s2:8px;--s3:12px;--s4:16px;--s5:24px;--s6:32px;--s7:48px;--s8:64px;
    /* Радиусы крупнее прежних: у стекла край видно, и острый угол на
       полупрозрачной поверхности выглядит сколом. */
    --r1:10px;--r2:14px;--r3:18px;--r4:22px;--r5:28px;--rf:999px;
    --fast:.06s;--quick:.13s;--calm:.24s;--slow:.42s;
    --ease:cubic-bezier(.32,.72,0,1);}
  @media(prefers-color-scheme:dark){:root:not([data-theme="light"]){${DARK}}}
  :root[data-theme="dark"]{${DARK}}
`;

/**
 * Обычные теги. Всё, что должно выглядеть правильно без единого класса:
 * так разметка остаётся читаемой, а новая страница получает оформление
 * бесплатно.
 */
export const BASE_CSS = `
  *{box-sizing:border-box}
  /* Под стеклом должно что-то быть: на ровной заливке размытие не
     видно вовсе. Пятна неяркие и неподвижные — это подложка, а не
     украшение, и читаемость текста она не трогает. */
  /* Кегль и трекинг подогнаны под системный шрифт Apple: у SF в
     мелких кеглях буквы шире, а в крупных — плотнее, и Inter повторяет
     это своими оптическими размерами. Отсюда отрицательный трекинг на
     заголовках и почти нулевой в тексте. */
  body{margin:0;background:var(--bg);color:var(--t1);
    font:13.5px/1.55 var(--font);-webkit-font-smoothing:antialiased;
    -moz-osx-font-smoothing:grayscale;
    letter-spacing:-.006em;font-feature-settings:'cv05' 1,'ss03' 1;
    text-rendering:optimizeLegibility}
  body::before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;
    background:var(--mesh);background-attachment:fixed}
  a{color:var(--link);text-decoration:none}
  a:hover{text-decoration:underline}
  code,kbd,pre{font-family:var(--mono)}
  .tnum{font-variant-numeric:tabular-nums}
  .muted{color:var(--t3)}
  .dim{color:var(--t3)}
  .err{color:var(--crit);font-size:12px;margin-top:6px}
  .ok{color:var(--good);font-size:12px;margin-top:6px}

  textarea,input,select{width:100%;background:var(--glass);color:var(--t1);
    border:1px solid var(--line2);border-radius:var(--r1);padding:10px 13px;
    font:inherit;font-size:13.5px;resize:none;
    -webkit-backdrop-filter:var(--blur);backdrop-filter:var(--blur);
    box-shadow:var(--sheen-soft);
    transition:border-color var(--quick) ease,box-shadow var(--quick) ease,
      background-color var(--quick) ease}
  textarea:hover,input:hover,select:hover{border-color:var(--line2);background:var(--solid)}
  /* Кольцо вместо жирной обводки: контур толщиной в два пикселя
     визуально увеличивает поле и дёргает соседние элементы. */
  textarea:focus,input:focus,select:focus{outline:none;border-color:var(--link);
    box-shadow:0 0 0 3px var(--ring)}
  input::placeholder,textarea::placeholder{color:var(--t3)}

  /* Полосы прокрутки.

     Windows рисует их со стрелками по краям, и в поле ответа это
     выглядит как счётчик у числового поля: человек видит две
     стрелочки и не понимает, что это вообще. Поэтому полоса везде
     тонкая, без кнопок и без подложки.

     Правила идут дважды: сначала старый набор для тех сборок, где
     свойства scrollbar-* ещё не работают, потом сами свойства. Где
     работают оба — берётся второй, он и убирает стрелки. */
  ::-webkit-scrollbar{width:9px;height:9px}
  ::-webkit-scrollbar-track{background:transparent}
  ::-webkit-scrollbar-button{display:none;width:0;height:0}
  ::-webkit-scrollbar-corner{background:transparent}
  ::-webkit-scrollbar-thumb{background:var(--line2);border-radius:9px;
    border:2px solid transparent;background-clip:content-box}
  ::-webkit-scrollbar-thumb:hover{background:var(--t3);background-clip:content-box}
  *{scrollbar-width:thin;scrollbar-color:var(--line2) transparent}

  /* Кнопка должна отвечать на прикосновение. Без наведения, нажатия
     и признака ожидания интерфейс воспринимается как картинка: человек
     жмёт и не понимает, случилось что-то или нет.

     Длительности маленькие намеренно. 130 мс на цвет читается как
     отклик; всё, что дольше 200 мс, ощущается как задержка. Нажатие
     ещё короче — 60 мс, оно должно совпадать с движением пальца.

     Ни одна кнопка не переносится: подпись в две строки ломает высоту
     строки и читается как поломка вёрстки. */
  button{background:var(--accent);color:var(--on-accent);border:1px solid transparent;
    border-radius:var(--rf);padding:9px 16px;font:inherit;font-size:13px;font-weight:600;
    letter-spacing:-.008em;
    cursor:pointer;white-space:nowrap;position:relative;
    box-shadow:var(--sheen),0 6px 18px -8px var(--glow);
    transition:background-color var(--quick) ease,border-color var(--quick) ease,
      color var(--quick) ease,box-shadow var(--quick) ease,transform var(--fast) ease,
      opacity var(--quick) ease}
  button:hover{background:var(--accent-h);border-color:var(--accent-h)}
  /* Смещение на пиксель вниз — самый дешёвый способ передать нажатие:
     кнопка буквально уходит под палец. */
  button:active{transform:translateY(1px);box-shadow:none}
  button:focus-visible{outline:2px solid var(--link);outline-offset:2px}
  button:disabled{opacity:.5;cursor:default;transform:none;box-shadow:none}
  button:disabled:hover{background:var(--accent);border-color:var(--accent)}

  /* Второстепенная кнопка — то же стекло, что и поверхность под ней:
     она не спорит с основной, но и не выглядит выключенной. */
  button.ghost{background:var(--glass);color:var(--t2);border-color:var(--line2);font-weight:600;
    -webkit-backdrop-filter:var(--blur);backdrop-filter:var(--blur);
    box-shadow:var(--sheen-soft)}
  button.ghost:hover{background:var(--solid);color:var(--t1);border-color:var(--line2)}
  button.ghost:disabled:hover{background:var(--glass);border-color:var(--line2)}
  button.quiet{background:transparent;color:var(--t2);border-color:transparent;box-shadow:none}
  button.quiet:hover{background:var(--hover);color:var(--t1);border-color:transparent}
  button.danger{background:var(--crit);border-color:var(--crit);color:#fff}
  button.danger:hover{filter:brightness(1.08)}
  button.grad{background:var(--grad);border-color:transparent;color:#fff;
    box-shadow:0 8px 24px -10px var(--glow)}
  button.grad:hover{background:var(--grad);filter:brightness(1.07)}
  button.big{padding:14px 26px;font-size:14.5px}
  .mini{padding:7px 13px;font-size:12px}

  /* Ожидание. Кнопка не просто гаснет — она показывает, что запрос идёт.
     Подпись прячется, а не заменяется словом «Подождите»: так не прыгает
     ширина и не дёргается вся строка кнопок. */
  button.busy{color:transparent;pointer-events:none}
  button.busy::after{content:"";position:absolute;inset:0;margin:auto;width:14px;height:14px;
    border:2px solid currentColor;border-top-color:transparent;border-radius:50%;
    color:var(--on-accent);animation:spin .6s linear infinite}
  button.ghost.busy::after,button.quiet.busy::after{color:var(--t2)}
  @keyframes spin{to{transform:rotate(360deg)}}
  @media(prefers-reduced-motion:reduce){
    button,.conv,.tab,.rbtn,.icob,.tile,.card{transition:none}
    button.busy::after{animation-duration:1.8s}
  }
`;

/**
 * Готовые блоки. Их задача — чтобы новая страница собиралась из
 * существующего, а не из свежего CSS: каждый новый слой оформления
 * это ещё один способ разъехаться с остальным продуктом.
 */
export const KIT_CSS = `
  /* Стекло. Полупрозрачная подложка с размытием — основной приём
     оформления. Размытие дорогое, поэтому только на панелях, которые
     не перерисовываются каждый кадр. */
  .glass{background:var(--glass);border:1px solid var(--glass-line);
    backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur)}

  /* Заголовки. Размеры не «на глаз», а шкала: каждая следующая
     ступень примерно в 1.25 раза больше предыдущей. */
  .h1{font-family:var(--font-display);font-size:clamp(30px,4.6vw,54px);line-height:1.06;
    letter-spacing:-.03em;font-weight:800;margin:0}
  .h2{font-family:var(--font-display);font-size:clamp(22px,2.6vw,32px);line-height:1.15;
    letter-spacing:-.025em;font-weight:700;margin:0}
  .h3{font-size:17px;line-height:1.3;letter-spacing:-.021em;font-weight:600;margin:0}
  .h4{font-size:14px;line-height:1.35;letter-spacing:-.014em;font-weight:600;margin:0}
  .lead{font-size:clamp(14px,1.5vw,17px);line-height:1.6;color:var(--t2);margin:0}
  .grad-text{background:var(--grad);-webkit-background-clip:text;background-clip:text;
    color:transparent}

  /* Карточка — единица содержимого. Всё остальное складывается из неё. */
  /* Карточка — единица содержимого и главная стеклянная поверхность:
     полупрозрачный слой, размытие под ним, блик по верхней кромке.
     Где размытия нет (старый браузер), внизу файла лежит запасной
     непрозрачный вид — иначе текст читался бы поверх пятен. */
  .card{background:var(--glass);border:1px solid var(--glass-line);border-radius:var(--r4);
    padding:var(--s5);
    -webkit-backdrop-filter:var(--blur);backdrop-filter:var(--blur);
    box-shadow:var(--sheen),0 10px 30px -18px rgba(11,16,34,.3)}
  .card.pad5{padding:var(--s5)}
  .card.flat{background:transparent;border-color:var(--line)}

  /* Плитка — карточка, на которую нажимают. Отличается только тем,
     что отвечает на наведение: поднимается и подсвечивает рамку. */
  .tile{background:var(--glass);border:1px solid var(--glass-line);border-radius:var(--r4);
    padding:var(--s5);text-align:left;cursor:pointer;color:inherit;
    -webkit-backdrop-filter:var(--blur);backdrop-filter:var(--blur);
    box-shadow:var(--sheen),0 10px 30px -18px rgba(11,16,34,.3);
    font-weight:400;white-space:normal;
    transition:transform var(--quick) var(--ease),box-shadow var(--quick) ease,
      border-color var(--quick) ease,background-color var(--quick) ease}
  .tile:hover{border-color:var(--line2);transform:translateY(-2px);
    box-shadow:var(--sheen),var(--lift)}
  .tile:active{transform:translateY(0)}

  /* Статус. Цвет здесь несёт смысл, поэтому набор закрыт: четыре
     состояния и ничего больше. Иначе через месяц статусов девять
     и человек перестаёт их различать. */
  .pill{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;
    padding:3px 9px;border-radius:var(--rf);background:var(--panel2);color:var(--t2);
    white-space:nowrap}
  .pill::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor;
    flex:none}
  .pill.good{background:var(--good-bg);color:var(--good)}
  .pill.warn{background:var(--warn-bg);color:var(--warn)}
  .pill.crit{background:var(--crit-bg);color:var(--crit)}
  .pill.flat::before{display:none}
  .chip{font-size:10px;padding:2px 6px;border-radius:var(--r1);background:var(--panel2);
    color:var(--t2);font-weight:600}
  .badge{background:var(--crit);color:#fff;border-radius:var(--rf);padding:1px 6px;
    font-size:10px;font-weight:700;font-variant-numeric:tabular-nums}

  /* Таблица. Тонкие линии только между строками: сетка из рамок
     превращает данные в шахматную доску и мешает их читать. */
  .tbl{width:100%;border-collapse:collapse;font-size:12.5px}
  .tbl th{text-align:left;font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;
    color:var(--t3);font-weight:700;padding:0 10px 8px;border-bottom:1px solid var(--line)}
  .tbl td{padding:10px;border-bottom:1px solid var(--line);vertical-align:middle}
  .tbl tr:last-child td{border-bottom:0}
  .tbl tbody tr{transition:background-color var(--quick) ease}
  .tbl tbody tr:hover{background:var(--hover)}

  /* Вкладки. Подчёркивание, а не кнопки: выбранный раздел должен быть
     заметен, но не соревноваться с главным действием на странице. */
  .tabs{display:flex;gap:var(--s4)}
  .tab{background:transparent;border:0;color:var(--t3);font-weight:600;font-size:12.5px;
    padding:0 0 9px;border-bottom:2px solid transparent;margin-bottom:-1px;border-radius:0;
    box-shadow:none;transition:color var(--quick) ease,border-color var(--quick) ease}
  .tab:hover{background:transparent;border-color:var(--line2);color:var(--t2)}
  .tab:active{transform:none}
  .tab.on{color:var(--t1);border-color:var(--accent)}
  .tab .n{color:var(--t3);font-weight:600;margin-left:5px;font-size:11px;
    font-variant-numeric:tabular-nums}

  /* Переключатель из двух-трёх положений: тема, язык, режим списка. */
  .seg{display:inline-flex;background:var(--panel2);border:1px solid var(--line);
    border-radius:var(--r1);padding:2px;gap:2px}
  .seg button{background:transparent;border:0;color:var(--t2);box-shadow:none;
    padding:4px 9px;font-size:11.5px;border-radius:4px}
  .seg button:hover{background:var(--hover);color:var(--t1)}
  .seg button.on{background:var(--solid);color:var(--t1);box-shadow:var(--shadow)}

  /* Пустое состояние. Оно всегда отвечает на два вопроса: почему тут
     ничего нет и что сделать, чтобы появилось. */
  .empty{padding:26px 20px;color:var(--t3);font-size:12.5px;text-align:center;line-height:1.6}
  .empty .ttl{color:var(--t2);font-weight:600;font-size:13px;margin-bottom:4px}

  /* Окно поверх страницы. Подложка не чёрная, а размытая: под ней
     остаётся видно, откуда человек пришёл. */
  .veil{position:fixed;inset:0;background:rgba(11,16,34,.4);backdrop-filter:blur(6px);
    -webkit-backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;
    padding:var(--s4);z-index:90;animation:fade var(--calm) ease}
  .sheet{background:var(--solid);border:1px solid var(--line);border-radius:var(--r4);
    box-shadow:var(--lift2);max-width:520px;width:100%;max-height:86vh;overflow-y:auto;
    padding:var(--s5);animation:pop var(--calm) var(--ease)}
  @keyframes fade{from{opacity:0}to{opacity:1}}
  @keyframes pop{from{opacity:0;transform:translateY(12px) scale(.98)}to{opacity:1;transform:none}}
  @media(prefers-reduced-motion:reduce){.veil,.sheet{animation:none}}

  /* Всплывающее уведомление. Внизу по центру: там его видно и оно
     не перекрывает то, с чем человек работает. */
  .toast{position:fixed;left:50%;bottom:22px;transform:translate(-50%,12px);opacity:0;
    pointer-events:none;background:var(--accent);color:var(--on-accent);padding:10px 14px;
    border-radius:var(--r2);font-size:12.5px;font-weight:600;
    max-width:min(520px,calc(100% - 32px));box-shadow:0 10px 30px rgba(0,0,0,.2);z-index:95;
    transition:opacity .18s ease,transform .18s ease}
  .toast.on{opacity:1;transform:translate(-50%,0)}

  /* Заготовка на время загрузки. Лучше серой полосы ничего не
     придумали: она занимает то же место, что и будущий текст,
     и страница не прыгает. */
  .skel{background:linear-gradient(90deg,var(--panel2),var(--hover),var(--panel2));
    background-size:200% 100%;border-radius:var(--r1);animation:slide 1.4s ease infinite}
  @keyframes slide{to{background-position:-200% 0}}
  @media(prefers-reduced-motion:reduce){.skel{animation:none}}

  /* Аватар. Квадрат со скруглением, а не круг: в плотном списке
     круги съедают полезную ширину и хуже держат строку. */
  .av{width:34px;height:34px;border-radius:var(--r1);flex:none;display:flex;
    align-items:center;justify-content:center;font-weight:600;font-size:12px;color:#fff;
    overflow:hidden;background-size:cover;background-position:center}

  /* Мелочи раскладки. Их ровно столько, чтобы не писать в каждой
     странице свой flex. */
  .row{display:flex;gap:var(--s2);align-items:center}
  .row.wrap{flex-wrap:wrap}
  .col{display:flex;flex-direction:column;gap:var(--s2)}
  .grow{flex:1;min-width:0}
  .sep{height:1px;background:var(--line);border:0;margin:var(--s4) 0}
`;

/** Всё оформление подряд: токены, теги, блоки. */
/**
 * Запасной вид там, где размытия нет.
 *
 * Стекло держится на backdrop-filter. Если браузер его не умеет,
 * полупрозрачная поверхность превращается в мутное пятно поверх
 * цветной подложки — текст на таком читать нельзя. Поэтому без
 * размытия поверхности становятся обычными непрозрачными.
 */
export const GLASS_FALLBACK_CSS = `
  @supports not ((backdrop-filter:blur(2px)) or (-webkit-backdrop-filter:blur(2px))){
    .card,.tile,button.ghost,textarea,input,select,#rail,.emobox,.tplbox{
      background:var(--solid)}
    body::before{opacity:.35}
  }
  @media(prefers-reduced-transparency:reduce){
    .card,.tile,button.ghost,textarea,input,select,#rail{background:var(--solid)}
    body::before{opacity:.25}
  }
`;

export const BRAND_CSS = TOKENS_CSS + BASE_CSS + KIT_CSS + GLASS_FALLBACK_CSS;

/**
 * Переключатель темы.
 *
 * Выбор хранится в localStorage, а не на сервере: это предпочтение
 * устройства, а не человека — на рабочем мониторе светлая, на ноутбуке
 * вечером тёмная. Функция вызывается до отрисовки, иначе страница
 * мигнёт светлой темой перед тем, как станет тёмной.
 *
 * По умолчанию светлая, а не системная. Системная выглядит вежливо,
 * но означает, что половина людей видит продукт впервые тёмным,
 * а оформление разрабатывалось и проверялось на светлом. Тёмная и
 * системная остаются в переключателе — третьим и вторым нажатием.
 */
export const THEME_JS = `
function themeGet(){try{return localStorage.getItem('rz.theme')||'light'}catch(e){return 'light'}}
function themeSet(v){try{localStorage.setItem('rz.theme',v)}catch(e){}themeApply(v);paintTheme()}
function themeApply(v){document.documentElement.setAttribute('data-theme',v||'auto')}
function themeCycle(){var v=themeGet();themeSet(v==='light'?'dark':v==='dark'?'auto':'light')}
function paintTheme(){
  var v=themeGet();
  var nodes=document.querySelectorAll('[data-theme-btn]');
  for(var i=0;i<nodes.length;i++){
    var n=nodes[i];
    n.classList.toggle('on',n.getAttribute('data-theme-btn')===v);
  }
  var t=document.getElementById('themeTitle');
  if(t)t.setAttribute('title',v==='auto'?'Тема: как в системе':v==='light'?'Тема: светлая':'Тема: тёмная');
}
themeApply(themeGet());
`;

/**
 * Смайлы для поля ответа.
 *
 * Один набор на рабочее место и на виджет в карточке Zoho: разные
 * наборы в двух местах одного продукта — это не выбор, а недосмотр.
 *
 * Не весь Unicode, а то, чем реально пользуются в переписке с клиентом:
 * лица и жесты, рабочие символы, товары. Полный список — девять экранов,
 * по которым никто не листает, и лишние сотни килобайт на странице.
 *
 * Частые собираются сами и живут на устройстве, как и выбор темы.
 */
export const EMOJI_JS = `
var EMO = {
  'Лица':['🙂','😊','😉','😁','😄','😅','🤗','🤝','👋','🙏','👍','👌','💪','🔥','✨','❤️','💛','🎉','😍','🥰','😂','🤔','😐','😔','😢','😮','🙈','😎'],
  'Работа':['✅','❌','⚠️','❗','❓','📌','📎','📄','📝','🗓','⏰','⏳','💬','📞','📧','🔗','🔒','⚙️','📦','🚚','🏷','💳','💰','🧾','📊','📈','🎁','🛒'],
  'Товар':['👕','👗','👟','👜','🎒','⌚','💍','📱','💻','🎧','📷','🪑','🛏','🍽','☕','🌿','🌸','🎂','🧸','🖼','🧴','🧼','🧹','🔧','🔨','🧰','🪞','🕯']
};

function emoRecent(){
  try { return JSON.parse(localStorage.getItem('rz.emo') || '[]') } catch(e){ return [] }
}
function emoUse(ch){
  var list = emoRecent().filter(function(x){ return x !== ch });
  list.unshift(ch);
  try { localStorage.setItem('rz.emo', JSON.stringify(list.slice(0, 8))) } catch(e){}
}

/** Разметка панели: часто используемые первым рядом, дальше наборы. */
function emoPanel(){
  var recent = emoRecent();
  var row = function(list){
    return list.map(function(c){
      return '<button type="button" data-e="' + c + '">' + c + '</button>';
    }).join('');
  };
  var html = recent.length
    ? '<div class="grp"><div class="gt">Часто</div><div class="gr">' + row(recent) + '</div></div>'
    : '';
  return html + Object.keys(EMO).map(function(name){
    return '<div class="grp"><div class="gt">' + name + '</div><div class="gr">' + row(EMO[name]) + '</div></div>';
  }).join('');
}

/** Вставка в позицию курсора, а не в конец: смайл ставят по месту. */
function emoInsert(ta, ch){
  if (!ta) return;
  var a = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
  var b = ta.selectionEnd == null ? a : ta.selectionEnd;
  ta.value = ta.value.slice(0, a) + ch + ta.value.slice(b);
  ta.focus();
  ta.setSelectionRange(a + ch.length, a + ch.length);
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 150) + 'px';
  emoUse(ch);
}
`;

/** Оформление панели смайлов: тоже одно на оба места. */
export const EMOJI_CSS = `
  /* Высота панели считается и от окна тоже: внутри карточки Zoho
     рамка бывает ниже самой панели, и та вылезала за верхний край
     вместе с началом переписки. Теперь прокручивается внутри. */
  .emobox{border:1px solid var(--line);border-radius:7px;margin-bottom:8px;background:var(--panel);
    max-height:min(212px,40vh);overflow-y:auto;overscroll-behavior:contain;padding:4px 8px 8px}
  .emobox .gt{font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;color:var(--t3);
    font-weight:700;margin:8px 0 4px}
  .emobox .gr{display:grid;grid-template-columns:repeat(auto-fill,minmax(30px,1fr));gap:2px}
  .emobox button{background:transparent;border:0;box-shadow:none;font-size:19px;line-height:1;
    padding:4px;border-radius:6px;color:inherit;
    transition:transform .08s ease,background-color .12s ease}
  .emobox button:hover{background:var(--hover);transform:scale(1.15)}
  .emobox button:active{transform:scale(.94)}
`;
