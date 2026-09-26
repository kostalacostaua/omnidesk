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
    --bg:#0a0d18;--bg2:#10142a;--solid:#161b30;
    /* Стекло — это доля прозрачности, а не серый цвет. Сорок шесть
       процентов: меньше — текст плывёт на пёстрой подложке, больше —
       подложки не видно и стекла тоже нет. */
    --glass:rgba(24,30,50,.46);--panel:rgba(24,30,50,.46);--panel2:rgba(255,255,255,.07);
    --line:rgba(255,255,255,.09);--line2:rgba(255,255,255,.17);--hover:rgba(255,255,255,.08);
    --t1:#f2f5ff;--t2:#a8b2cd;--t3:#7a849e;
    --accent:#4b8cff;--accent-h:#6ba0ff;--on-accent:#04102a;--link:#7fb0ff;
    --accent-soft:rgba(75,140,255,.18);
    --brand1:#4b8cff;--brand2:#a07bff;--ink:#f2f5ff;--navy:#0a0d18;
    --grad:linear-gradient(120deg,var(--brand1),var(--brand2));
    --ring:rgba(75,140,255,.34);
    --shadow:0 1px 2px rgba(0,0,0,.4);
    --lift:0 18px 46px -16px rgba(0,0,0,.72),0 2px 10px -5px rgba(0,0,0,.5);
    --lift2:0 34px 84px -28px rgba(0,0,0,.86),0 4px 16px -8px rgba(0,0,0,.6);
    --viz1:#3987e5;--viz2:#d95926;--viz3:#199e70;
    --heat0:rgba(255,255,255,.05);--heat1:#16233a;--heat2:#1d3760;
    --heat3:#234f8e;--heat4:#2a6bbf;--heat5:#3987e5;
    --good:#54cf90;--good-bg:rgba(84,207,144,.14);--warn:#e8b13c;--warn-bg:rgba(232,177,60,.14);
    --crit:#ff7a72;--crit-bg:rgba(255,122,114,.14);
    --rail:rgba(18,23,40,.5);--railT:#8b94af;--railOn:#fff;--railOnBg:rgba(255,255,255,.12);
    --glass-line:rgba(255,255,255,.1);
    --glow:rgba(75,140,255,.4);
    /* Кромка. Свет падает сверху: верхняя грань светится, боковые
       чуть слабее, нижняя почти не светится. Три разных значения, а
       не одно на всю рамку, — иначе поверхность выглядит наклейкой. */
    --edge:rgba(255,255,255,.3);--edge2:rgba(255,255,255,.08);
    --sheen:inset 0 1px 0 var(--edge),inset 1px 0 0 var(--edge2),
      inset -1px 0 0 var(--edge2),inset 0 -1px 0 var(--edge2);
    --sheen-soft:inset 0 1px 0 rgba(255,255,255,.14);
    --blur:blur(20px) saturate(170%) brightness(.92);
    /* Подложка. Без неё стекла не существует: над ровной заливкой
       нет ни цвета снизу, ни преломления — только мутный прямоугольник. */
    --mesh:radial-gradient(58vw 56vh at 10% 4%,rgba(24,86,196,.34),transparent 62%),
      radial-gradient(52vw 50vh at 92% 2%,rgba(104,58,180,.28),transparent 60%),
      radial-gradient(56vw 54vh at 76% 96%,rgba(14,110,96,.26),transparent 62%),
      radial-gradient(46vw 46vh at 14% 98%,rgba(120,70,26,.22),transparent 60%);`;

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
    --bg:#e9eefb;--bg2:#e2e9f8;--panel:rgba(255,255,255,.44);--solid:#fff;
    --panel2:rgba(13,20,36,.05);
    --line:rgba(13,20,36,.08);--line2:rgba(13,20,36,.14);--hover:rgba(13,20,36,.05);
    --t1:#0d1424;--t2:#455070;--t3:#7b86a4;
    --accent:#0a64f0;--accent-h:#0a56cf;--on-accent:#fff;--link:#0a64f0;
    --accent-soft:rgba(10,100,240,.12);
    --brand1:#0a64f0;--brand2:#8b5cf6;--ink:#0d1424;--navy:#0d1424;
    --grad:linear-gradient(120deg,var(--brand1),var(--brand2));
    --ring:rgba(10,100,240,.3);
    --shadow:0 1px 2px rgba(13,20,36,.06);
    --lift:0 10px 34px -12px rgba(13,20,36,.32),0 2px 8px -4px rgba(13,20,36,.2);
    --lift2:0 30px 72px -26px rgba(13,20,36,.42),0 4px 14px -8px rgba(13,20,36,.2);
    --viz1:#2a78d6;--viz2:#eb6834;--viz3:#1baf7a;
    --heat0:rgba(11,16,34,.05);--heat1:#e8f0fb;--heat2:#c3d9f4;
    --heat3:#8fb8e9;--heat4:#558fdc;--heat5:#2a78d6;
    --good:#17864f;--good-bg:rgba(23,134,79,.12);--warn:#b4690e;--warn-bg:rgba(180,105,14,.12);
    --crit:#d0343a;--crit-bg:rgba(208,52,58,.1);
    --rail:rgba(255,255,255,.4);--railT:#5d6884;--railOn:#0d1424;--railOnBg:rgba(255,255,255,.7);
    --glass:rgba(255,255,255,.44);--glass-line:rgba(255,255,255,.6);
    --glow:rgba(10,100,240,.3);
    /* Кромка. Свет падает сверху: верхняя грань светится ярче всего,
       боковые слабее, нижняя почти не светится. Три разных значения, а
       не одно на всю рамку, — иначе поверхность выглядит наклейкой, а
       не куском стекла с толщиной. */
    --edge:rgba(255,255,255,.8);--edge2:rgba(255,255,255,.3);
    --sheen:inset 0 1px 0 var(--edge),inset 1px 0 0 var(--edge2),
      inset -1px 0 0 var(--edge2),inset 0 -1px 0 var(--edge2);
    --sheen-soft:inset 0 1px 0 rgba(255,255,255,.7);
    /* Подложка. Без неё стекла не существует: над ровной заливкой нет
       ни цвета снизу, ни преломления — только мутный прямоугольник.
       Поэтому пятна яркие, а не «чтобы было». */
    --mesh:radial-gradient(58vw 56vh at 10% 4%,rgba(122,184,255,.34),transparent 62%),
      radial-gradient(52vw 50vh at 92% 2%,rgba(186,150,255,.26),transparent 60%),
      radial-gradient(56vw 54vh at 76% 96%,rgba(127,232,205,.24),transparent 62%),
      radial-gradient(46vw 46vh at 14% 98%,rgba(255,206,160,.2),transparent 60%);
    /* Насыщение важнее размытия: оно и даёт «подобранный снизу цвет».
       Яркость чуть вверх — стекло светлее того, что под ним. */
    --blur:blur(18px) saturate(190%) brightness(1.06);
    --s1:4px;--s2:8px;--s3:12px;--s4:16px;--s5:24px;--s6:32px;--s7:48px;--s8:64px;
    /* Радиусы вложенные: радиус внутреннего элемента равен радиусу
       внешнего минус расстояние между ними. Шаг в четыре точки как раз
       и есть типичный отступ, поэтому шкала идёт через четыре. Без
       этого углы «плавают»: внутренний квадратнее внешнего. */
    --r1:12px;--r2:16px;--r3:20px;--r4:24px;--r5:30px;--rf:999px;
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
  /* Подложка из двух слоёв: цветные пятна и поверх них зерно. Без
     зерна большие градиенты идут видимыми полосами — на светлой теме
     это особенно заметно, а стекло их ещё и подчёркивает. */
  body::before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;
    background:var(--mesh);background-attachment:fixed}
  body::after{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;opacity:.5;
    background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2'/><feColorMatrix type='saturate' values='0'/></filter><rect width='140' height='140' filter='url(%23n)' opacity='.2'/></svg>")}
  a{color:var(--link);text-decoration:none}
  a:hover{text-decoration:underline}
  code,kbd,pre{font-family:var(--mono)}
  .tnum{font-variant-numeric:tabular-nums}
  .muted{color:var(--t3)}
  .dim{color:var(--t3)}
  .err{color:var(--crit);font-size:12px;margin-top:6px}
  .ok{color:var(--good);font-size:12px;margin-top:6px}

  textarea,input,select{width:100%;background:var(--glass);color:var(--t1);
    border:1px solid var(--glass-line);border-radius:var(--r1);padding:10px 13px;
    font:inherit;font-size:13.5px;resize:none;
    -webkit-backdrop-filter:var(--blur);backdrop-filter:var(--blur);
    box-shadow:var(--sheen);
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
    /* Блик по верхней кромке плюс свечение под кнопкой: цветная
       поверхность над стеклом должна светиться, а не лежать пятном. */
    box-shadow:inset 0 1px 0 rgba(255,255,255,.4),0 8px 22px -8px var(--glow);
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
  button.ghost{background:var(--glass);color:var(--t1);border-color:var(--glass-line);
    font-weight:600;
    -webkit-backdrop-filter:var(--blur);backdrop-filter:var(--blur);
    box-shadow:var(--sheen)}
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
    box-shadow:var(--sheen),var(--lift)}
  .card.pad5{padding:var(--s5)}
  .card.flat{background:transparent;border-color:var(--line)}

  /* Плитка — карточка, на которую нажимают. Отличается только тем,
     что отвечает на наведение: поднимается и подсвечивает рамку. */
  .tile{background:var(--glass);border:1px solid var(--glass-line);border-radius:var(--r4);
    padding:var(--s5);text-align:left;cursor:pointer;color:inherit;
    -webkit-backdrop-filter:var(--blur);backdrop-filter:var(--blur);
    box-shadow:var(--sheen),var(--lift);
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

  /* Предупреждение внутри карточки. Не «мелкий шрифт под договором»:
     это то, что человек обязан прочитать до действия, а не после. */
  .warnbox{background:var(--warn-bg);border-left:3px solid var(--warn);color:var(--t2);
    border-radius:0 var(--r1) var(--r1) 0;padding:9px 12px;font-size:12.5px;line-height:1.5;
    margin:10px 0}

  /* Пустое состояние. Оно всегда отвечает на два вопроса: почему тут
     ничего нет и что сделать, чтобы появилось. */
  .empty{padding:26px 20px;color:var(--t3);font-size:12.5px;text-align:center;line-height:1.6}
  .empty .ttl{color:var(--t2);font-weight:600;font-size:13px;margin-bottom:4px}

  /* Окно поверх страницы. Подложка не чёрная, а размытая: под ней
     остаётся видно, откуда человек пришёл. */
  .veil{position:fixed;inset:0;background:rgba(11,16,34,.4);backdrop-filter:blur(6px);
    -webkit-backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;
    padding:var(--s4);z-index:90;animation:fade var(--calm) ease}
  .sheet{background:var(--glass);border:1px solid var(--glass-line);border-radius:var(--r5);
    -webkit-backdrop-filter:var(--blur);backdrop-filter:var(--blur);
    box-shadow:var(--sheen),var(--lift2);max-width:520px;width:100%;max-height:86vh;
    overflow-y:auto;padding:var(--s5);animation:pop var(--calm) var(--ease)}
  @keyframes fade{from{opacity:0}to{opacity:1}}
  @keyframes pop{from{opacity:0;transform:translateY(12px) scale(.98)}to{opacity:1;transform:none}}
  @media(prefers-reduced-motion:reduce){.veil,.sheet{animation:none}}

  /* Всплывающее уведомление. Внизу по центру: там его видно и оно
     не перекрывает то, с чем человек работает. */
  .toast{position:fixed;left:50%;bottom:22px;transform:translate(-50%,12px);opacity:0;
    pointer-events:none;background:var(--accent);color:var(--on-accent);padding:10px 14px;
    border-radius:var(--rf);font-size:12.5px;font-weight:600;
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
    .card,.tile,.sheet,button.ghost,textarea,input,select,#rail,.emobox,.tplbox{
      background:var(--solid)}
    body::before{opacity:.3}
    body::after{opacity:.25}
  }
  @media(prefers-reduced-transparency:reduce){
    .card,.tile,.sheet,button.ghost,textarea,input,select,#rail{background:var(--solid)}
    body::before{opacity:.2}
    body::after{opacity:0}
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
