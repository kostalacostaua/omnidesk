import { describe, expect, it } from 'vitest';
import {
  WORK_HOURS_DEFAULT,
  workedSeconds,
  dayLabel,
  fromHhmm,
  hhmm,
  isAlwaysOn,
  isWorkTime,
  localParts,
  parseWorkHours,
} from '../src/workhours.js';

/**
 * Расписание — вещь, ошибка в которой обнаруживается ночью и не тем
 * человеком. Поэтому проверяется не «работает в понедельник днём», а
 * края: полночь, конец рабочего дня, воскресенье, перевод часов и
 * настройка, введённая наоборот.
 */

/** Будни 9:00–18:00, выходные закрыты. */
const office = parseWorkHours({
  tz: 'Europe/Kyiv',
  days: [
    { on: true, allDay: false, from: 540, to: 1080 },
    { on: true, allDay: false, from: 540, to: 1080 },
    { on: true, allDay: false, from: 540, to: 1080 },
    { on: true, allDay: false, from: 540, to: 1080 },
    { on: true, allDay: false, from: 540, to: 1080 },
    { on: false, allDay: false, from: 540, to: 1080 },
    { on: false, allDay: false, from: 540, to: 1080 },
  ],
});

describe('разбор настройки', () => {
  it('пусто означает круглосуточно: до настройки молчать нельзя', () => {
    const wh = parseWorkHours({});
    expect(isAlwaysOn(wh)).toBe(true);
    expect(isWorkTime(wh, new Date('2026-09-27T02:00:00.000Z'))).toBe(true);
  });

  it('по умолчанию у нас тоже круглосуточно', () => {
    expect(isAlwaysOn(WORK_HOURS_DEFAULT)).toBe(true);
  });

  it('дней всегда семь, сколько бы ни прислали', () => {
    expect(parseWorkHours({ days: [] }).days).toHaveLength(7);
    expect(parseWorkHours({ days: [{ on: false }] }).days).toHaveLength(7);
    expect(parseWorkHours({ days: new Array(40).fill({ on: false }) }).days).toHaveLength(7);
  });

  it('конец раньше начала — это опечатка, а не ночная смена', () => {
    // Ночную смену мы не умеем, и притворяться, что поняли, нельзя:
    // иначе день молча станет нерабочим целиком.
    const wh = parseWorkHours({ days: [{ on: true, allDay: false, from: 1200, to: 300 }] });
    expect(wh.days[0]?.to).toBe(1440);
  });

  it('мусор во времени заменяется разумным, а не ломает день', () => {
    const wh = parseWorkHours({ days: [{ on: true, allDay: false, from: 'девять', to: 9999 }] });
    expect(wh.days[0]?.from).toBe(0);
    expect(wh.days[0]?.to).toBe(1440);
  });
});

describe('работаем ли сейчас', () => {
  it('в рабочий час буднего дня — да', () => {
    // Среда, 12:00 по Киеву.
    expect(isWorkTime(office, new Date('2026-09-23T09:00:00.000Z'))).toBe(true);
  });

  it('до открытия и после закрытия — нет', () => {
    expect(isWorkTime(office, new Date('2026-09-23T05:59:00.000Z'))).toBe(false);
    expect(isWorkTime(office, new Date('2026-09-23T15:30:00.000Z'))).toBe(false);
  });

  it('ровно в момент открытия уже работаем, в момент закрытия — уже нет', () => {
    // 9:00 и 18:00 по Киеву летом это 06:00 и 15:00 UTC.
    expect(isWorkTime(office, new Date('2026-09-23T06:00:00.000Z'))).toBe(true);
    expect(isWorkTime(office, new Date('2026-09-23T15:00:00.000Z'))).toBe(false);
  });

  it('в выходной — нет, даже среди дня', () => {
    // Воскресенье.
    expect(isWorkTime(office, new Date('2026-09-27T12:00:00.000Z'))).toBe(false);
  });

  it('часовой пояс считается по календарю, а не смещением', () => {
    // Одно и то же мгновение: 7:30 в Киеве — уже не рабочее время,
    // а в Лондоне то же мгновение это 5:30, и тем более нет.
    const at = new Date('2026-09-23T04:30:00.000Z');
    expect(isWorkTime(office, at)).toBe(false);

    // Зимой смещение Киева другое, и час открытия обязан остаться
    // девятью утра по местному времени, а не уехать вместе с ним.
    expect(isWorkTime(office, new Date('2026-01-14T07:30:00.000Z'))).toBe(true);
    expect(isWorkTime(office, new Date('2026-01-14T06:30:00.000Z'))).toBe(false);
  });

  it('неизвестный пояс не выключает оповещения молча', () => {
    const wh = parseWorkHours({ tz: 'Europe/Атлантида', days: office.days });
    expect(isWorkTime(wh, new Date('2026-09-23T02:00:00.000Z'))).toBe(true);
  });

  it('неделя начинается с понедельника', () => {
    // 21 сентября 2026 — понедельник.
    expect(localParts(new Date('2026-09-21T09:00:00.000Z'), 'Europe/Kyiv').day).toBe(0);
    expect(localParts(new Date('2026-09-27T09:00:00.000Z'), 'Europe/Kyiv').day).toBe(6);
  });
});

describe('запись времени', () => {
  it('минуты и часы переводятся туда и обратно', () => {
    expect(hhmm(570)).toBe('09:30');
    expect(hhmm(0)).toBe('00:00');
    expect(fromHhmm('09:30')).toBe(570);
    expect(fromHhmm('')).toBe(0);
  });

  it('подпись дня читается человеком', () => {
    expect(dayLabel({ on: true, allDay: false, from: 540, to: 1080 })).toBe('09:00–18:00');
    expect(dayLabel({ on: true, allDay: true, from: 0, to: 1440 })).toBe('00:00–24:00');
    expect(dayLabel({ on: false, allDay: false, from: 540, to: 1080 })).toBe('');
  });
});

/**
 * Рабочее время между двумя моментами — та самая величина, ради
 * которой расписание и заведено. Ошибка здесь не видна глазами: она
 * просто делает отчёт о времени ответа неправдой, и заметить это
 * можно только сверив с часами вручную.
 */
describe('рабочее время между двумя моментами', () => {
  const h = (n: number) => n * 3600;

  it('внутри одного рабочего дня — просто разница', () => {
    // Среда, 10:00 → 12:30 по Киеву (07:00 → 09:30 UTC летом).
    const out = workedSeconds(
      new Date('2026-09-23T07:00:00Z'),
      new Date('2026-09-23T09:30:00Z'),
      office,
    );
    expect(out).toBe(h(2) + 1800);
  });

  it('ночь между двумя днями не считается', () => {
    // Среда 17:00 → четверг 10:00 по Киеву: час до закрытия и час
    // после открытия, а не семнадцать часов.
    const out = workedSeconds(
      new Date('2026-09-23T14:00:00Z'),
      new Date('2026-09-24T07:00:00Z'),
      office,
    );
    expect(out).toBe(h(2));
  });

  it('выходные выпадают целиком', () => {
    // Пятница 17:00 → понедельник 10:00: час в пятницу и час в
    // понедельник.
    const out = workedSeconds(
      new Date('2026-09-25T14:00:00Z'),
      new Date('2026-09-28T07:00:00Z'),
      office,
    );
    expect(out).toBe(h(2));
  });

  it('написали ночью, ответили утром — считается только утро', () => {
    // Ночь со среды на четверг, 02:00 → 09:30 по Киеву.
    const out = workedSeconds(
      new Date('2026-09-22T23:00:00Z'),
      new Date('2026-09-23T06:30:00Z'),
      office,
    );
    expect(out).toBe(1800);
  });

  it('целиком нерабочий промежуток — ноль, а не длительность', () => {
    const out = workedSeconds(
      new Date('2026-09-26T09:00:00Z'),
      new Date('2026-09-27T09:00:00Z'),
      office,
    );
    expect(out).toBe(0);
  });

  it('круглосуточно — вся разница до секунды', () => {
    const out = workedSeconds(
      new Date('2026-09-23T07:00:00Z'),
      new Date('2026-09-24T07:00:30Z'),
      WORK_HOURS_DEFAULT,
    );
    expect(out).toBe(h(24) + 30);
  });

  it('переход на зимнее время не добавляет и не крадёт час', () => {
    // В Европе часы переводят в ночь на 25 октября 2026. Промежуток
    // с пятницы 23-го 17:00 до понедельника 26-го 10:00 по местному
    // времени: час в пятницу и час в понедельник, сколько бы часов ни
    // было в ночи между ними.
    const out = workedSeconds(
      new Date('2026-10-23T14:00:00Z'),
      new Date('2026-10-26T08:00:00Z'),
      office,
    );
    expect(out).toBe(h(2));
  });

  it('обратный порядок и совпадение — ноль, а не отрицательное число', () => {
    const at = new Date('2026-09-23T07:00:00Z');
    expect(workedSeconds(at, at, office)).toBe(0);
    expect(workedSeconds(new Date('2026-09-23T09:00:00Z'), at, office)).toBe(0);
  });

  it('неизвестный пояс считает всё время, а не ноль', () => {
    const wh = parseWorkHours({ tz: 'Europe/Атлантида', days: office.days });
    const out = workedSeconds(
      new Date('2026-09-23T07:00:00Z'),
      new Date('2026-09-23T08:00:00Z'),
      wh,
    );
    expect(out).toBe(h(1));
  });
});
