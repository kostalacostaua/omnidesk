import { describe, expect, it } from 'vitest';
import { INBOX_HTML } from '../src/ui.js';

/**
 * Кабинет на телефоне.
 *
 * Стили кабинета лежат одной строкой в несколько тысяч правил, и
 * телефонные среди них — не последние. Отсюда ловушка, на которую тут
 * и стоят проверки: при равной силе побеждает то правило, что ниже по
 * файлу. Написанное в медиазапросе выше своего умолчания не
 * применяется вовсе — и не падает, не ругается, а просто молча не
 * работает. Ни компилятор, ни разбор скрипта такого не видят.
 *
 * Проверяется поэтому не «есть ли правило», а порядок и сила: то
 * единственное, из-за чего оно перестаёт действовать.
 */

const css = /<style>([\s\S]*?)<\/style>/.exec(INBOX_HTML)?.[1] ?? '';

/** Где в стилях впервые встречается строка. -1, если её нет вовсе. */
const at = (s: string) => css.indexOf(s);

describe('что видно на телефоне', () => {
  it('стили кабинета вообще нашлись', () => {
    expect(css.length).toBeGreaterThan(10000);
  });

  /*
   * Кнопка разделов и затемнение под выехавшим рейлом прячутся по
   * умолчанию и показываются в медиазапросе. Поставь умолчание после
   * него — и кнопки не будет ни на телефоне, ни на десктопе: рейл
   * открыть нечем, а из «Каналів» некуда уйти.
   */
  it('умолчание стоит до медиазапроса, а не после', () => {
    for (const [def, phone] of [
      ['.burg{display:none', '.burg{display:inline-flex}'],
      ['#railVeil{display:none}', '#app.rail-open #railVeil{display:block'],
    ]) {
      expect(at(def), def).toBeGreaterThan(-1);
      expect(at(phone), phone).toBeGreaterThan(-1);
      expect(at(def), def + ' раньше ' + phone).toBeLessThan(at(phone));
    }
  });

  /*
   * Описание рейла стоит в файле ниже телефонного блока, и простой
   * селектор там побеждал: рейл оставался колонкой по центру, а
   * подписи жались к середине выехавшего меню.
   */
  it('правила выезда сильнее описания рейла', () => {
    expect(css).toContain('#app #rail{position:fixed');
    expect(at('#app #rail{position:fixed')).toBeLessThan(at('#rail{background:var(--rail)'));
  });

  /*
   * Высота поля ответа задана тремя селекторами сразу, и среди них
   * есть :hover — он сильнее простого. Телефонное правило без такой
   * же пары действовало ровно до первого касания поля, после чего
   * поле вырастало обратно.
   */
  it('телефонная высота поля переживает касание', () => {
    const phone = css.slice(at('@media(max-width:820px){'));
    expect(phone).toContain('.composer textarea:hover');
    expect(phone).toContain('.composer textarea:focus');
  });

  /*
   * Щипок и двойное касание ломают закреплённую страницу: обратно
   * масштаб не сходится, и человек остаётся с куском интерфейса.
   */
  it('увеличение страницы запрещено', () => {
    const tag = /<meta name="viewport"[^>]*>/.exec(INBOX_HTML)?.[0] ?? '';
    expect(tag).toContain('maximum-scale=1');
    expect(tag).toContain('user-scalable=no');
  });

  /*
   * Поле мельче шестнадцати точек Safari на iOS приближает при
   * фокусе — и обратно не отдаляет. Правило общее, а не только для
   * поля ответа: поиск по чатам и настройки те же шестнадцать.
   */
  it('поля ввода не мельче шестнадцати точек', () => {
    expect(css.slice(at('@media(max-width:820px){'))).toContain('input,textarea,select{font-size:16px}');
  });
});

describe('что не уезжает за край', () => {
  /*
   * Обёртка аватарки была на четыре точки меньше самой аватарки, и
   * значок канала, который считает свой угол от обёртки, ложился на
   * вторую букву инициалов: «ВК» читалось как «В». Размер задаётся в
   * одном месте — там же, где аватарка.
   */
  it('обёртка аватарки не задаёт свой размер второй раз', () => {
    const rules = css.match(/\.avwrap\{[^}]*\}/g) ?? [];
    expect(rules.length).toBeGreaterThan(0);
    const sized = rules.filter((r) => /width:/.test(r));
    expect(sized).toHaveLength(1);
  });

  /*
   * Кнопки под сообщением стояли сбоку от пузыря и выходили за край
   * экрана на девятнадцать точек — от этого лента и ходила вправо-
   * влево. На телефоне они встают под пузырём и открываются касанием.
   */
  it('кнопки сообщения на телефоне не висят сбоку', () => {
    const phone = css.slice(at('@media(max-width:820px){'));
    expect(phone).toContain('.mtools{position:static');
    expect(phone).toContain('.mwrap.act .mtools{display:flex');
  });

  it('лента не прокручивается вбок', () => {
    const phone = css.slice(at('@media(max-width:820px){'));
    expect(phone).toContain('#msgs{overflow-x:hidden');
    expect(phone).toContain('overscroll-behavior-x:none');
  });
});

describe('шапка переписки: что снаружи, что под «Ще»', () => {
  /*
   * Пять действий в строку на 390 точках не встают. Снаружи остались
   * «Взяти собі» и статус, остальное — под «…». На широком экране
   * обёртка прозрачна, и порядок задан числами: разметка сгруппирована
   * ради телефона, а шапка должна была остаться прежней.
   */
  it('на широком экране порядок задан числами, а не разметкой', () => {
    expect(css).toContain('.thead .amore{display:contents}');
    for (const [id, n] of [['aWho', 1], ['aSt', 2], ['aBot', 3], ['aClose', 4], ['aTake', 5]]) {
      expect(css, id).toContain('.thead .acts #' + id + '{order:' + n + '}');
    }
  });

  /*
   * Кнопка «…» носит и класс mini, а `.thead .acts button.mini`
   * объявлен с тем же весом: правило полегче она перебивала, и «…»
   * висела на широком экране, где прятать нечего. Прячется тем же
   * весом и строкой ниже.
   */
  it('«…» спрятана весом не меньше, чем у соседей по строке', () => {
    const hide = at('.thead .acts button.amorebtn{display:none');
    const mini = at('.thead .acts button.mini{display:inline-flex');
    expect(hide).toBeGreaterThan(-1);
    expect(mini).toBeGreaterThan(-1);
    expect(hide).toBeGreaterThan(mini);
    const phone = css.slice(at('@media(max-width:820px){'));
    expect(phone).toContain('.thead .acts button.amorebtn{display:inline-flex');
  });

  /*
   * В строке галочка «закрити чат» узнаётся по соседям и обходится без
   * слова. В столбце из трёх строк безымянный квадрат не читается
   * ничем, поэтому подпись есть в разметке всегда, а прячется стилем.
   */
  it('у галочки есть имя, которое видно только в списке', () => {
    expect(css).toContain('.thead .acts .iq span{display:none}');
    expect(css.slice(at('@media(max-width:820px){'))).toContain('.thead .amore .iq span{display:inline}');
  });
});

describe('подбородок под полем ответа', () => {
  /*
   * Под карточкой поля набегало под семьдесят точек серого: отступ
   * поля, безопасная зона под чертой жеста и скруглённый край — всё
   * ниже последней кнопки. Поле стало полосой во всю ширину, а
   * безопасная зона ушла внутрь, под нижний ряд.
   */
  it('поле ответа — полоса во всю ширину, зона внутри неё', () => {
    const phone = css.slice(at('@media(max-width:820px){'));
    expect(phone).toContain('.composer{padding:0}');
    expect(phone).toContain('.composer .cbox{border-radius:0');
    expect(phone).toContain('.composer .crow{padding:0 10px calc(6px + env(safe-area-inset-bottom))');
  });

  /*
   * Полоса для ошибки отправки держала под кнопками десять точек
   * пустоты всё время, пока ошибки нет, — то есть всегда.
   */
  it('пустая строка ошибки места не занимает', () => {
    expect(css).toContain('#sendErr:empty{display:none}');
  });
});
