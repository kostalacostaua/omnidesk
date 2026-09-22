/**
 * Сценарии: разбор шагов, выбор подходящего и расписание.
 *
 * Здесь только вычисления — ни базы, ни очередей. Так эту часть можно
 * покрыть тестами целиком, а она того стоит: ошибка в выборе сценария
 * означает, что клиенту уходит не тот текст, и заметит это не программа,
 * а человек на той стороне.
 */

export type ScenarioTrigger = 'welcome' | 'keyword' | 'exact' | 'off_hours' | 'fallback';

/** Шаг сценария. Набор закрыт намеренно: каждый новый вид — это ещё одна
 *  ветка в движке и ещё одна форма в редакторе. */
export type ScenarioStep =
  /** Отправить сообщение. Файлы — ссылки на уже загруженные вложения. */
  | { kind: 'message'; text: string; attachments?: Array<Record<string, unknown>> }
  /** Подождать. Пауза измеряется в секундах, но задаётся минутами в интерфейсе. */
  | { kind: 'delay'; seconds: number }
  /** Задать вопрос и ждать ответа. Ответ запоминается под именем save. */
  | { kind: 'ask'; text: string; save?: string; timeoutMinutes?: number }
  /** Развилка: если в последнем ответе есть одно из слов — прыгнуть на шаг. */
  | { kind: 'condition'; contains: string[]; goto: number; elseGoto?: number }
  /** Повесить метку на диалог. */
  | { kind: 'tag'; tag: string }
  /** Позвать человека: бот замолкает, диалог помечается как требующий ответа. */
  | { kind: 'handoff'; note?: string }
  /** Закрыть диалог. */
  | { kind: 'close' };

export interface ScenarioSchedule {
  /** «09:00» — начало рабочего дня. */
  from?: string;
  /** «19:00» — конец. */
  to?: string;
  /** Рабочие дни, 1 — понедельник, 7 — воскресенье. */
  days?: number[];
  /** Сдвиг от UTC в часах: у нас +3, и сервер живёт по UTC. */
  tzOffset?: number;
}

export interface ScenarioLike {
  id: string;
  channelId: string | null;
  triggerType: ScenarioTrigger;
  keywords: string[];
  schedule: ScenarioSchedule;
  steps: ScenarioStep[];
  priority: number;
}

export interface TriggerContext {
  text: string;
  channelId: string;
  isFirstMessage: boolean;
  /** Бот уже отвечал в этом диалоге — приветствие второй раз не нужно. */
  alreadyGreeted: boolean;
  now: Date;
}

/** Нормализация для сравнения: регистр и лишние пробелы не должны решать. */
function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Рабочее ли сейчас время.
 *
 * Часовой пояс задаётся сдвигом, а не именем зоны: имя требует базы
 * часовых поясов в контейнере и обновлений при переводе стрелок, а
 * сдвиг покрывает ровно то, что нужно небольшой компании в одной стране.
 */
export function isWorkingTime(schedule: ScenarioSchedule, now: Date): boolean {
  const offset = Number(schedule.tzOffset ?? 0);
  const local = new Date(now.getTime() + offset * 3600_000);

  const day = local.getUTCDay() === 0 ? 7 : local.getUTCDay();
  const days = schedule.days && schedule.days.length ? schedule.days : [1, 2, 3, 4, 5];
  if (!days.includes(day)) return false;

  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  const parse = (v: string | undefined, fallback: number): number => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? ''));
    if (!m) return fallback;
    return Number(m[1]) * 60 + Number(m[2]);
  };
  const from = parse(schedule.from, 9 * 60);
  const to = parse(schedule.to, 19 * 60);

  // Смена через полночь (22:00–06:00) — законный случай для поддержки.
  if (to <= from) return minutes >= from || minutes < to;
  return minutes >= from && minutes < to;
}

/** Подходит ли сценарий под сообщение. */
export function triggerMatches(s: ScenarioLike, ctx: TriggerContext): boolean {
  if (s.channelId && s.channelId !== ctx.channelId) return false;
  if (!s.steps.length) return false;

  const text = norm(ctx.text);

  switch (s.triggerType) {
    case 'welcome':
      return ctx.isFirstMessage && !ctx.alreadyGreeted;
    case 'keyword':
      return s.keywords.some((k) => k && text.includes(norm(k)));
    case 'exact':
      return s.keywords.some((k) => k && text === norm(k));
    case 'off_hours':
      return !isWorkingTime(s.schedule, ctx.now);
    case 'fallback':
      return true;
    default:
      return false;
  }
}

/**
 * Выбор сценария.
 *
 * Порядок закреплён и не зависит от того, в каком порядке их завёл
 * человек: сначала приветствие, потом точное совпадение, потом слово,
 * потом «вне графика», и только если ничего не подошло — «на всё
 * остальное». Иначе «на всё остальное» с приоритетом 1 перекрывало бы
 * весь остальной набор, и владелец сервиса полчаса гадал бы, почему.
 *
 * Внутри одного вида решает приоритет: меньше — раньше. Сценарий,
 * привязанный к каналу, всегда важнее общего: частное правило
 * побеждает общее.
 */
const ORDER: Record<ScenarioTrigger, number> = {
  welcome: 0,
  exact: 1,
  keyword: 2,
  off_hours: 3,
  fallback: 4,
};

export function pickScenario<T extends ScenarioLike>(list: T[], ctx: TriggerContext): T | null {
  const fit = list.filter((s) => triggerMatches(s, ctx));
  if (!fit.length) return null;

  fit.sort((a, b) => {
    const byKind = ORDER[a.triggerType] - ORDER[b.triggerType];
    if (byKind !== 0) return byKind;
    const byScope = (a.channelId ? 0 : 1) - (b.channelId ? 0 : 1);
    if (byScope !== 0) return byScope;
    return a.priority - b.priority;
  });

  return fit[0] ?? null;
}

/** Есть ли в ответе клиента одно из слов развилки. */
export function answerMatches(contains: string[], text: string): boolean {
  const t = norm(text);
  return contains.some((c) => c && t.includes(norm(c)));
}

/**
 * Проверка шагов перед сохранением.
 *
 * Редактор не даст собрать неверный шаг, но API принимает и то, что
 * пришло не из редактора. Возвращается либо очищенный набор, либо
 * причина отказа — текстом, который не стыдно показать человеку.
 */
export function validateSteps(input: unknown): { steps: ScenarioStep[] } | { error: string } {
  if (!Array.isArray(input)) return { error: 'Шаги должны быть списком' };
  if (input.length > 30) return { error: 'Больше тридцати шагов в одном сценарии — это уже программа' };

  const steps: ScenarioStep[] = [];
  for (const [i, raw] of input.entries()) {
    const at = `шаг ${i + 1}`;
    if (!raw || typeof raw !== 'object') return { error: `${at}: не объект` };
    const s = raw as Record<string, unknown>;

    switch (s['kind']) {
      case 'message': {
        const text = String(s['text'] ?? '').trim();
        if (!text && !Array.isArray(s['attachments'])) return { error: `${at}: пустое сообщение` };
        if (text.length > 4096) return { error: `${at}: текст длиннее 4096 символов` };
        steps.push({
          kind: 'message',
          text,
          ...(Array.isArray(s['attachments']) && s['attachments'].length
            ? { attachments: s['attachments'] as Array<Record<string, unknown>> }
            : {}),
        });
        break;
      }
      case 'delay': {
        const seconds = Math.round(Number(s['seconds'] ?? 0));
        if (!Number.isFinite(seconds) || seconds < 1) return { error: `${at}: пауза меньше секунды` };
        // Сутки — предел осмысленного: всё, что дольше, это уже рассылка,
        // а не продолжение разговора.
        if (seconds > 86_400) return { error: `${at}: пауза больше суток` };
        steps.push({ kind: 'delay', seconds });
        break;
      }
      case 'ask': {
        const text = String(s['text'] ?? '').trim();
        if (!text) return { error: `${at}: вопрос без текста` };
        const save = String(s['save'] ?? '').trim().slice(0, 32);
        const timeout = Math.round(Number(s['timeoutMinutes'] ?? 0));
        steps.push({
          kind: 'ask',
          text,
          ...(save ? { save } : {}),
          ...(Number.isFinite(timeout) && timeout > 0 ? { timeoutMinutes: Math.min(timeout, 1440) } : {}),
        });
        break;
      }
      case 'condition': {
        const contains = (Array.isArray(s['contains']) ? s['contains'] : [])
          .map((x) => String(x).trim())
          .filter(Boolean);
        if (!contains.length) return { error: `${at}: развилка без слов` };
        const goto = Math.round(Number(s['goto'] ?? -1));
        if (!Number.isFinite(goto) || goto < 0) return { error: `${at}: развилка без перехода` };
        const elseGoto = Math.round(Number(s['elseGoto'] ?? -1));
        steps.push({
          kind: 'condition',
          contains,
          goto,
          ...(Number.isFinite(elseGoto) && elseGoto >= 0 ? { elseGoto } : {}),
        });
        break;
      }
      case 'tag': {
        const tag = String(s['tag'] ?? '').trim().slice(0, 40);
        if (!tag) return { error: `${at}: метка без названия` };
        steps.push({ kind: 'tag', tag });
        break;
      }
      case 'handoff': {
        const note = String(s['note'] ?? '').trim().slice(0, 200);
        steps.push({ kind: 'handoff', ...(note ? { note } : {}) });
        break;
      }
      case 'close':
        steps.push({ kind: 'close' });
        break;
      default:
        return { error: `${at}: неизвестный вид «${String(s['kind'])}»` };
    }
  }

  return { steps };
}
