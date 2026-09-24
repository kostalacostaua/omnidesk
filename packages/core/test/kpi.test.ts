import { describe, expect, it } from 'vitest';
import { KPI_EMPTY, hasKpi, parseKpi, planFor, progress, workingDays } from '../src/kpi.js';
import { WORK_HOURS_DEFAULT, parseWorkHours } from '../src/workhours.js';

/**
 * Цель — это то, по чему потом разговаривают с человеком. Поэтому здесь
 * проверяется не арифметика, а два места, где легко солгать: цель,
 * которой не ставили, и план, посчитанный по календарным дням вместо
 * рабочих.
 */

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

describe('разбор цели', () => {
  it('пусто означает «цели нет», а не «цель ноль»', () => {
    expect(parseKpi({})).toEqual(KPI_EMPTY);
    expect(hasKpi(parseKpi({}))).toBe(false);
    expect(hasKpi(parseKpi({ repliesPerDay: 20 }))).toBe(true);
  });

  it('мусор и отрицательные не создают цели', () => {
    expect(parseKpi({ repliesPerDay: 'багато' }).repliesPerDay).toBe(0);
    expect(parseKpi({ resolvedPerDay: -5 }).resolvedPerDay).toBe(0);
  });

  it('пределы: сотня в день и сто процентов', () => {
    expect(parseKpi({ repliesPerDay: 5000 }).repliesPerDay).toBe(100);
    expect(parseKpi({ inTimePercent: 900 }).inTimePercent).toBe(100);
  });
});

describe('рабочие дни в периоде', () => {
  it('выходные не считаются: план за неделю — это пять дней, а не семь', () => {
    // Понедельник 21 сентября — воскресенье 27 сентября 2026.
    const days = workingDays(
      new Date('2026-09-21T00:00:00Z'),
      new Date('2026-09-27T23:59:00Z'),
      office,
    );
    expect(days).toBe(5);
  });

  it('круглосуточное расписание считает все дни', () => {
    const days = workingDays(
      new Date('2026-09-21T00:00:00Z'),
      new Date('2026-09-27T23:59:00Z'),
      WORK_HOURS_DEFAULT,
    );
    expect(days).toBe(7);
  });

  it('период из одних выходных даёт ноль рабочих дней', () => {
    const days = workingDays(
      new Date('2026-09-26T00:00:00Z'),
      new Date('2026-09-27T23:59:00Z'),
      office,
    );
    expect(days).toBe(0);
  });
});

describe('план и выполнение', () => {
  it('план — дневная цель на рабочие дни', () => {
    expect(planFor(20, 5)).toBe(100);
  });

  it('ноль рабочих дней не обнуляет план: иначе выполнение станет делением на ноль', () => {
    expect(planFor(20, 0)).toBe(20);
  });

  it('без цели плана нет', () => {
    expect(planFor(0, 5)).toBe(0);
  });

  it('без плана процента не выдумываем', () => {
    expect(progress(10, 0)).toBe(null);
    expect(progress(50, 100)).toBe(50);
    expect(progress(120, 100)).toBe(120);
  });
});
