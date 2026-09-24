/**
 * Рабочие часы.
 *
 * Нужны не для красоты расписания в настройках, а ради трёх вещей, и
 * каждая из них видна человеку.
 *
 * Первая — оповещения. «Клиент ждёт двадцать минут» в три часа ночи
 * будит владельца ради того, на что всё равно никто не ответит, и после
 * второй такой ночи оповещения выключают целиком.
 *
 * Вторая — честность перед клиентом. Чат на сайте, который молча
 * принимает сообщение в воскресенье, обещает ответ, которого не будет
 * до понедельника.
 *
 * Третья — счёт времени ответа. Без рабочих часов «ответили через
 * четырнадцать часов» складывается из ночи, и такой отчёт не говорит
 * ничего ни о ком.
 */

export interface WorkDay {
  /** Работаем ли в этот день вообще. */
  on: boolean;
  /** Круглосуточно: тогда from и to не смотрим. */
  allDay: boolean;
  /** Минуты от полуночи. 9:30 — это 570. */
  from: number;
  to: number;
}

export interface WorkHours {
  /** Часовой пояс организации, в котором и заданы часы. */
  tz: string;
  /** Семь дней, начиная с понедельника. */
  days: WorkDay[];
}

const FULL: WorkDay = { on: true, allDay: true, from: 0, to: 24 * 60 };

/**
 * По умолчанию — круглосуточно.
 *
 * Не потому, что так работают, а потому что таково поведение до
 * настройки: пока человек не сказал иное, мы не имеем права молчать в
 * ответ клиенту и не показывать оповещение.
 */
export const WORK_HOURS_DEFAULT: WorkHours = {
  tz: 'Europe/Kyiv',
  days: Array.from({ length: 7 }, () => ({ ...FULL })),
};

/** Разбор настройки: чужие поля и мусор игнорируются. */
export function parseWorkHours(raw: unknown): WorkHours {
  const r = (raw ?? {}) as Record<string, unknown>;
  const tz = typeof r['tz'] === 'string' && r['tz'] ? r['tz'] : WORK_HOURS_DEFAULT.tz;
  const src = Array.isArray(r['days']) ? (r['days'] as unknown[]) : [];

  const days = Array.from({ length: 7 }, (_unused, i) => {
    const d = (src[i] ?? {}) as Record<string, unknown>;
    if (!Object.keys(d).length) return { ...FULL };

    const on = d['on'] !== false;
    const allDay = d['allDay'] === true;
    const from = minute(d['from'], 0);
    const to = minute(d['to'], 24 * 60);
    // Конец раньше начала — это не ночная смена, а опечатка: ночную
    // смену мы всё равно не умеем, и притворяться, что поняли, нельзя.
    return { on, allDay, from, to: to > from ? to : 24 * 60 };
  });

  return { tz, days };
}

function minute(raw: unknown, def: number): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n < 0 || n > 24 * 60) return def;
  return n;
}

/**
 * Время в часовом поясе организации.
 *
 * Считается через Intl, а не смещением в минутах: смещение меняется
 * дважды в год, и расписание, посчитанное по нему, в конце марта
 * начинает врать на час.
 */
export function localParts(at: Date, tz: string): { day: number; minutes: number } {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  let weekday = 'Mon';
  let hour = 0;
  let minutes = 0;
  for (const part of fmt.formatToParts(at)) {
    if (part.type === 'weekday') weekday = part.value;
    if (part.type === 'hour') hour = Number(part.value);
    if (part.type === 'minute') minutes = Number(part.value);
  }

  const order = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const day = Math.max(0, order.indexOf(weekday));
  return { day, minutes: hour * 60 + minutes };
}

/** Работаем ли сейчас. */
export function isWorkTime(wh: WorkHours, at: Date = new Date()): boolean {
  let parts: { day: number; minutes: number };
  try {
    parts = localParts(at, wh.tz);
  } catch {
    // Неизвестный часовой пояс — считаем, что работаем. Ошибка в
    // настройке не должна выключать оповещения молча.
    return true;
  }

  const d = wh.days[parts.day];
  if (!d || !d.on) return false;
  if (d.allDay) return true;
  return parts.minutes >= d.from && parts.minutes < d.to;
}

/** Круглосуточно всю неделю: тогда о рабочих часах можно не упоминать. */
export function isAlwaysOn(wh: WorkHours): boolean {
  return wh.days.every((d) => d.on && d.allDay);
}

/** Человеческая запись часов дня: «9:00–18:00». */
export function dayLabel(d: WorkDay): string {
  if (!d.on) return '';
  if (d.allDay) return '00:00–24:00';
  return `${hhmm(d.from)}–${hhmm(d.to)}`;
}

export function hhmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function fromHhmm(value: string): number {
  const parts = String(value ?? '').split(':');
  const h = Number(parts[0]);
  const m = Number(parts[1] ?? 0);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return Math.min(24 * 60, Math.max(0, h * 60 + m));
}

/**
 * Начало следующих местных суток.
 *
 * Прибавить двадцать четыре часа нельзя: два раза в год сутки длятся
 * двадцать три или двадцать пять, и подсчёт уехал бы на час — молча и
 * в отчёте. Поэтому граница ищется делением пополам по календарю: он
 * единственный знает, где у этих суток конец.
 */
function nextLocalMidnight(at: Date, tz: string): Date {
  const today = localParts(at, tz).day;
  let lo = at.getTime();
  let hi = lo + 26 * 3600_000;

  // Тридцати шагов деления хватает на точность до миллисекунды.
  for (let i = 0; i < 30 && hi - lo > 1000; i++) {
    const mid = Math.floor((lo + hi) / 2);
    if (localParts(new Date(mid), tz).day === today) lo = mid;
    else hi = mid;
  }
  return new Date(hi);
}

/**
 * Сколько рабочего времени прошло между двумя моментами.
 *
 * Это та величина, ради которой рабочие часы вообще заведены: «ответили
 * через четырнадцать часов» складывается из ночи и выходных и не
 * говорит ни о ком ничего, а «ответили через сорок минут рабочего
 * времени» — говорит.
 *
 * Считается по местным суткам, а не прибавлением двадцати четырёх
 * часов, и потому переход на зимнее время ничего не сдвигает.
 *
 * Круглосуточное расписание — отдельная ветка не ради скорости, а ради
 * точности: обход по суткам дал бы тот же ответ, но через семь тысяч
 * шагов на годовом промежутке.
 */
export function workedSeconds(from: Date, to: Date, wh: WorkHours): number {
  const start = from.getTime();
  const end = to.getTime();
  if (!(end > start)) return 0;
  if (isAlwaysOn(wh)) return Math.round((end - start) / 1000);

  // Неизвестный пояс: считаем всё время рабочим, как и в isWorkTime.
  // Врать нулём хуже, чем посчитать грубо: нулевое время ответа в
  // отчёте выглядит достижением.
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: wh.tz });
  } catch {
    return Math.round((end - start) / 1000);
  }

  let total = 0;
  let cursor = new Date(start);

  // Предел на случай испорченных дат: год рабочего времени в одном
  // ожидании — это уже не ожидание, а сломанная запись.
  for (let guard = 0; guard < 400 && cursor.getTime() < end; guard++) {
    const { day, minutes } = localParts(cursor, wh.tz);
    const midnight = nextLocalMidnight(cursor, wh.tz);
    const segEnd = Math.min(end, midnight.getTime());
    const segMinutes = (segEnd - cursor.getTime()) / 60_000;

    const d = wh.days[day];
    if (d?.on) {
      const openFrom = d.allDay ? 0 : d.from;
      const openTo = d.allDay ? 1440 : d.to;
      const a = Math.max(minutes, openFrom);
      const b = Math.min(minutes + segMinutes, openTo);
      if (b > a) total += (b - a) * 60;
    }

    cursor = new Date(segEnd);
  }

  return Math.round(total);
}
