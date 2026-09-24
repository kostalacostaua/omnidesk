import { describe, expect, it } from 'vitest';
import { SLA_EMPTY, hasSla, inTime, parseSla } from '../src/sla.js';

/**
 * Обещание — это то, чем компания меряет себя перед клиентом, и
 * ошибиться здесь можно двумя одинаково скверными способами: назвать
 * нарушением то, чего не обещали, и не заметить настоящего нарушения.
 */

describe('разбор обещания', () => {
  it('пусто означает «не обещаем», а не «обещаем ноль минут»', () => {
    expect(parseSla({})).toEqual(SLA_EMPTY);
    expect(hasSla(parseSla({}))).toBe(false);
    expect(hasSla(parseSla({ firstReplyMinutes: 20 }))).toBe(true);
  });

  it('мусор и отрицательные числа не создают обещания', () => {
    expect(parseSla({ firstReplyMinutes: 'швидко' }).firstReplyMinutes).toBe(0);
    expect(parseSla({ firstReplyMinutes: -30 }).firstReplyMinutes).toBe(0);
    expect(parseSla({ resolveMinutes: 1e9 }).resolveMinutes).toBe(60 * 48);
  });

  it('дробные минуты округляются: полминуты в обещании никто не имеет в виду', () => {
    expect(parseSla({ firstReplyMinutes: 20.4 }).firstReplyMinutes).toBe(20);
  });
});

describe('уложились ли', () => {
  it('ровно в срок — это «да», а не придирка по границе', () => {
    expect(inTime(1200, 20)).toBe(true);
    expect(inTime(1201, 20)).toBe(false);
  });

  it('без обещания нарушений не бывает', () => {
    // Иначе отчёт назвал бы просрочкой каждый ответ у того, кто ничего
    // не обещал, — то есть у всех до первой настройки.
    expect(inTime(99999, 0)).toBe(true);
  });
});
