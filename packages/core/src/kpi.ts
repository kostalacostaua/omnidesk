import { isWorkTime, type WorkHours } from './workhours.js';

/**
 * Цели сотрудников.
 *
 * Отчёт говорит, сколько человек сделал. Цель отвечает на другой
 * вопрос — много это или мало. «Оля: 18 ответов» само по себе не значит
 * ничего: восемнадцать за неделю на одном канале — хорошо, на
 * четырёх — беда.
 *
 * Цели дневные, и это главное решение здесь. Недельная цель ломается о
 * первый же отпуск: у того, кто работал три дня из семи, «сорок за
 * неделю» — не невыполнение, а неправильно заданный вопрос. Дневная
 * умножается на число рабочих дней в периоде, и в отчёте видно, на
 * сколько именно дней её умножили.
 *
 * Ноль означает «не ставим цель», а не «цель ноль». Пустая цель честнее
 * выдуманной: по ней потом разговаривают с людьми.
 */

export interface KpiGoal {
  repliesPerDay: number;
  resolvedPerDay: number;
  /** Доля ответов в срок, проценты. 0 — не требуем. */
  inTimePercent: number;
}

export const KPI_EMPTY: KpiGoal = {
  repliesPerDay: 0,
  resolvedPerDay: 0,
  inTimePercent: 0,
};

/** Верхний предел — сотня в день: выше это уже не цель, а опечатка. */
const MAX_PER_DAY = 100;

function count(raw: unknown, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.round(n), max);
}

export function parseKpi(raw: unknown): KpiGoal {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    repliesPerDay: count(r['repliesPerDay'], MAX_PER_DAY),
    resolvedPerDay: count(r['resolvedPerDay'], MAX_PER_DAY),
    inTimePercent: count(r['inTimePercent'], 100),
  };
}

export function hasKpi(g: KpiGoal): boolean {
  return g.repliesPerDay > 0 || g.resolvedPerDay > 0 || g.inTimePercent > 0;
}

/**
 * Сколько рабочих дней в промежутке.
 *
 * День считается рабочим, если в нём есть хоть минута рабочего
 * времени. Доли дня не считаем: цель «двадцать ответов в день» на
 * половину субботы не делится пополам в голове ни у кого, и попытка
 * поделить сделала бы план числом с запятой, которому не верят.
 *
 * Проверяется полдень каждого дня, а не полночь: полночь у половины
 * расписаний нерабочая всегда, и субботняя смена с десяти до двух
 * исчезла бы из счёта.
 */
export function workingDays(from: Date, to: Date, wh: WorkHours): number {
  const day = 24 * 3600_000;
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const end = to.getTime();

  let days = 0;
  for (let t = start; t <= end && days < 400; t += day) {
    // Полдень по UTC — не полдень по местному, но и не полночь: для
    // расписаний в пределах обычных поясов этого достаточно, чтобы
    // попасть в рабочие часы дня, если они есть.
    const noon = new Date(t + 12 * 3600_000);
    if (noon.getTime() > end) break;
    if (isWorkTime(wh, noon)) days++;
  }
  return days;
}

/** План на период: дневная цель на число рабочих дней. */
export function planFor(perDay: number, days: number): number {
  if (perDay <= 0) return 0;
  return perDay * Math.max(days, 1);
}

/** Выполнение в процентах. Без цели процента нет — и не выдумываем. */
export function progress(fact: number, plan: number): number | null {
  if (plan <= 0) return null;
  return Math.round((fact / plan) * 100);
}
