/**
 * Свои статусы диалога.
 *
 * Системных статусов четыре, и они не про работу оператора, а про
 * механику: open — идёт, pending — ждём клиента, snoozed — отложен,
 * resolved — закрыт. На них держатся вкладки, счётчики и отчёты.
 *
 * Работа же у каждого своя. «Чекаємо оплату», «Передано на склад»,
 * «Немає товару» — это то, что оператор действительно хочет видеть в
 * списке, и чего в четырёх системных словах нет и не будет: у одного
 * доставка, у другого запись к врачу.
 *
 * Поэтому свой статус не заменяет системный, а надевается сверху. У
 * каждого своего статуса есть обязательный род (kind): открытый он или
 * закрытый. Из рода вычисляется системный статус, и потому счётчик
 * «Відкриті» не может соврать, сколько бы статусов ни придумали: диалог
 * с «Чекаємо оплату» остаётся открытым, с «Немає товару» — закрытым.
 *
 * Без обязательного рода получилось бы третье состояние — «статус есть,
 * а открыт диалог или нет, неизвестно», — и любой будущий отчёт о
 * времени ответа начал бы с попытки угадать.
 */

/** Род статуса: только это и решает, куда диалог попадёт во вкладках. */
export const STATUS_KINDS = ['open', 'closed'] as const;
export type StatusKind = (typeof STATUS_KINDS)[number];

/** Системный статус, который надевается вместе со своим. */
export const SYSTEM_BY_KIND: Record<StatusKind, string> = {
  open: 'open',
  closed: 'resolved',
};

/**
 * Предел на список. Двадцать четыре — это не техническое ограничение,
 * а граница, за которой выпадающий список перестаёт быть выбором и
 * становится поиском. Если упёрлись, нужны не статусы, а метки.
 */
export const STATUS_LIMIT = 24;

/** Длина названия. Оно живёт в строке списка рядом с именем клиента. */
export const STATUS_NAME_MAX = 40;

/**
 * Цвета на выбор. Список, а не свободный ввод: статус читается боковым
 * зрением в плотном списке, и бледно-жёлтый на белом там не читается
 * вообще. Здесь только то, что различимо и не спорит с интерфейсом.
 */
export const STATUS_COLORS = [
  '#2563eb',
  '#0ea5e9',
  '#0d9488',
  '#16a34a',
  '#65a30d',
  '#ca8a04',
  '#ea580c',
  '#dc2626',
  '#db2777',
  '#9333ea',
  '#6366f1',
  '#64748b',
] as const;

export const STATUS_COLOR_DEFAULT = STATUS_COLORS[0];

export interface ConversationStatus {
  id: string;
  name: string;
  color: string;
  kind: StatusKind;
  sort: number;
}

export function isStatusKind(v: unknown): v is StatusKind {
  return typeof v === 'string' && (STATUS_KINDS as readonly string[]).includes(v);
}

/**
 * Название. Переводы строк выбрасываются, а не заменяются пробелом
 * заодно с остальным: вставленное из таблицы название иначе разъезжает
 * строку списка на две.
 */
export function statusName(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .trim()
    .slice(0, STATUS_NAME_MAX);
}

/**
 * Цвет. Чужое значение приводится к нижнему регистру и сверяется со
 * списком; всё, чего в списке нет, становится цветом по умолчанию.
 * Молча, потому что цвет — не то, из-за чего стоит терять сохранение.
 */
export function statusColor(raw: unknown): string {
  const v = String(raw ?? '').trim().toLowerCase();
  return (STATUS_COLORS as readonly string[]).includes(v) ? v : STATUS_COLOR_DEFAULT;
}

/**
 * Разбор того, что пришло из формы.
 *
 * Название и род обязательны, и без них возвращается ошибка, а не
 * значение по умолчанию: статус без названия бесполезен, а статус с
 * угаданным родом опасен — он врёт счётчикам.
 */
export function parseStatusInput(
  raw: { name?: unknown; color?: unknown; kind?: unknown; sort?: unknown } | null | undefined,
): { ok: true; value: Omit<ConversationStatus, 'id'> } | { ok: false; error: string } {
  const name = statusName(raw?.name);
  if (!name) return { ok: false, error: 'name_required' };
  if (!isStatusKind(raw?.kind)) return { ok: false, error: 'bad_kind' };

  const sortRaw = Number(raw?.sort);
  const sort = Number.isFinite(sortRaw) ? Math.min(Math.max(Math.round(sortRaw), 0), 999) : 0;

  return { ok: true, value: { name, color: statusColor(raw?.color), kind: raw.kind, sort } };
}

/**
 * Системный статус для своего.
 *
 * Отдельной функцией, а не обращением к таблице по месту: системный
 * статус ставится и при выборе статуса в чате, и при переносе статуса
 * из открытого в закрытый, и оба места обязаны решать одинаково.
 */
export function systemStatusFor(kind: StatusKind): string {
  return SYSTEM_BY_KIND[kind];
}

/** Порядок в списке: как настроили, а при равенстве — по алфавиту. */
export function sortStatuses<T extends { sort: number; name: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'uk'));
}
