import { describe, expect, it } from 'vitest';
import {
  answerMatches,
  isWorkingTime,
  pickScenario,
  triggerMatches,
  validateSteps,
  type ScenarioLike,
} from '../src/scenario.js';

/** Заготовка сценария: в каждом тесте меняется одно-два поля. */
function make(over: Partial<ScenarioLike> = {}): ScenarioLike {
  return {
    id: 's1',
    channelId: null,
    triggerType: 'keyword',
    keywords: ['цена'],
    schedule: {},
    steps: [{ kind: 'message', text: 'привет' }],
    priority: 100,
    ...over,
  };
}

const ctx = (over: Partial<Parameters<typeof triggerMatches>[1]> = {}) => ({
  text: 'а какая цена?',
  channelId: 'ch1',
  isFirstMessage: false,
  alreadyGreeted: false,
  now: new Date('2026-09-22T12:00:00Z'),
  ...over,
});

describe('выбор сценария', () => {
  it('слово находится независимо от регистра и лишних пробелов', () => {
    expect(triggerMatches(make(), ctx({ text: '  А КАКАЯ   Цена ?' }))).toBe(true);
  });

  it('точное совпадение не срабатывает на части фразы', () => {
    const s = make({ triggerType: 'exact', keywords: ['цена'] });
    expect(triggerMatches(s, ctx({ text: 'цена' }))).toBe(true);
    expect(triggerMatches(s, ctx({ text: 'а какая цена?' }))).toBe(false);
  });

  it('приветствие только на первое сообщение и только один раз', () => {
    const s = make({ triggerType: 'welcome', keywords: [] });
    expect(triggerMatches(s, ctx({ isFirstMessage: true }))).toBe(true);
    expect(triggerMatches(s, ctx({ isFirstMessage: false }))).toBe(false);
    expect(triggerMatches(s, ctx({ isFirstMessage: true, alreadyGreeted: true }))).toBe(false);
  });

  it('сценарий чужого канала не срабатывает', () => {
    expect(triggerMatches(make({ channelId: 'ch2' }), ctx())).toBe(false);
  });

  it('сценарий без шагов не срабатывает: отправлять нечего', () => {
    expect(triggerMatches(make({ steps: [] }), ctx())).toBe(false);
  });

  it('приветствие важнее «на всё остальное», даже с худшим приоритетом', () => {
    const fallback = make({ id: 'f', triggerType: 'fallback', keywords: [], priority: 1 });
    const welcome = make({ id: 'w', triggerType: 'welcome', keywords: [], priority: 900 });
    const picked = pickScenario([fallback, welcome], ctx({ isFirstMessage: true }));
    expect(picked?.id).toBe('w');
  });

  it('сценарий канала побеждает общий при равном виде', () => {
    const common = make({ id: 'common', channelId: null, priority: 1 });
    const own = make({ id: 'own', channelId: 'ch1', priority: 500 });
    expect(pickScenario([common, own], ctx())?.id).toBe('own');
  });

  it('когда ничего не подошло — null, а не первый попавшийся', () => {
    expect(pickScenario([make({ keywords: ['доставка'] })], ctx())).toBeNull();
  });
});

describe('рабочее время', () => {
  const schedule = { from: '09:00', to: '19:00', days: [1, 2, 3, 4, 5], tzOffset: 3 };

  it('вторник 12:00 по Киеву — рабочее', () => {
    expect(isWorkingTime(schedule, new Date('2026-09-22T09:00:00Z'))).toBe(true);
  });

  it('вторник 21:00 по Киеву — нерабочее', () => {
    expect(isWorkingTime(schedule, new Date('2026-09-22T18:00:00Z'))).toBe(false);
  });

  it('воскресенье — нерабочее, даже в полдень', () => {
    expect(isWorkingTime(schedule, new Date('2026-09-20T09:00:00Z'))).toBe(false);
  });

  it('ночная смена через полночь считается правильно', () => {
    const night = { from: '22:00', to: '06:00', days: [1, 2, 3, 4, 5, 6, 7], tzOffset: 0 };
    expect(isWorkingTime(night, new Date('2026-09-22T23:30:00Z'))).toBe(true);
    expect(isWorkingTime(night, new Date('2026-09-22T03:00:00Z'))).toBe(true);
    expect(isWorkingTime(night, new Date('2026-09-22T12:00:00Z'))).toBe(false);
  });

  it('сценарий «вне графика» срабатывает ровно тогда, когда время нерабочее', () => {
    const s = make({ triggerType: 'off_hours', keywords: [], schedule });
    expect(triggerMatches(s, ctx({ now: new Date('2026-09-22T18:00:00Z') }))).toBe(true);
    expect(triggerMatches(s, ctx({ now: new Date('2026-09-22T09:00:00Z') }))).toBe(false);
  });
});

describe('проверка шагов', () => {
  it('принимает нормальный набор', () => {
    const r = validateSteps([
      { kind: 'message', text: 'Привет' },
      { kind: 'delay', seconds: 60 },
      { kind: 'ask', text: 'Какой город?', save: 'city' },
      { kind: 'handoff' },
    ]);
    expect('steps' in r && r.steps.length).toBe(4);
  });

  it('отказывает по-человечески и указывает номер шага', () => {
    const r = validateSteps([{ kind: 'message', text: 'ок' }, { kind: 'delay', seconds: 0 }]);
    expect('error' in r && r.error).toContain('шаг 2');
  });

  it('не пропускает неизвестный вид шага', () => {
    const r = validateSteps([{ kind: 'вырви-глаз' }]);
    expect('error' in r).toBe(true);
  });

  it('обрезает паузу больше суток, а не молча выполняет', () => {
    expect('error' in validateSteps([{ kind: 'delay', seconds: 90_000 }])).toBe(true);
  });

  it('развилка без перехода — отказ', () => {
    expect('error' in validateSteps([{ kind: 'condition', contains: ['да'] }])).toBe(true);
  });
});

describe('ответ клиента в развилке', () => {
  it('находит слово в любом регистре', () => {
    expect(answerMatches(['Да'], 'ну да, давайте')).toBe(true);
    expect(answerMatches(['да'], 'нет, спасибо')).toBe(false);
  });
});
