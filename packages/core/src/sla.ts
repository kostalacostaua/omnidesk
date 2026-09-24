/**
 * Обещание по времени: за сколько отвечаем и за сколько закрываем.
 *
 * Два числа, а не дерево правил. Правила «в будни двадцать минут, в
 * выходные час, для опта десять» выглядят точнее, но настроить их
 * человек не может: своих чисел он не знает, пока не увидит первый
 * отчёт. Два числа задаются за минуту, и дальше отчёт сам показывает,
 * реалистичны ли они.
 *
 * Обе величины — в рабочих часах компании, как и время ответа в
 * отчётах. Обещание «двадцать минут», нарушенное ночью, когда никто не
 * работает, — это не нарушение, а неправильно заданный вопрос.
 */

export interface Sla {
  /** Первый ответ клиенту. 0 — обещания нет. */
  firstReplyMinutes: number;
  /** Закрытие диалога. 0 — обещания нет. */
  resolveMinutes: number;
}

export const SLA_EMPTY: Sla = { firstReplyMinutes: 0, resolveMinutes: 0 };

/** Верхняя граница — двое суток рабочего времени. Дальше это не обещание. */
const MAX_MINUTES = 60 * 48;

function minutes(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.round(n), MAX_MINUTES);
}

export function parseSla(raw: unknown): Sla {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    firstReplyMinutes: minutes(r['firstReplyMinutes']),
    resolveMinutes: minutes(r['resolveMinutes']),
  };
}

/** Обещано ли хоть что-то. Пока нет — отчёт не называет ничего просрочкой. */
export function hasSla(s: Sla): boolean {
  return s.firstReplyMinutes > 0 || s.resolveMinutes > 0;
}

/**
 * Уложились ли. Ровно в срок — это «да»: обещание «за двадцать минут»
 * человек понимает как «не дольше двадцати», и проиграть по границе
 * было бы придиркой, которую пришлось бы объяснять клиенту.
 */
export function inTime(seconds: number, targetMinutes: number): boolean {
  if (targetMinutes <= 0) return true;
  return seconds <= targetMinutes * 60;
}
