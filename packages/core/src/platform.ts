/**
 * Владелец платформы.
 *
 * Это не роль в организации, а человек, которому принадлежит сервис:
 * он видит список всех организаций, их оплаты и может войти под
 * клиентом, чтобы разобраться в проблеме своими глазами.
 *
 * Список почт живёт в переменной окружения, а не в базе, и это главное
 * решение здесь. Флаг в таблице пользователей означал бы, что право
 * видеть всех клиентов можно получить через любую дыру, дающую запись в
 * эту таблицу, — а таких дыр всегда больше, чем кажется. Переменную
 * окружения меняет тот, у кого есть доступ к панели хостинга, то есть
 * ровно тот, кто и так может всё.
 *
 * Пустой список — нормальное состояние: панели просто нет.
 */

/** Почта в сравнимый вид: регистр и пробелы значения не имеют. */
function norm(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Разбор списка почт из переменной окружения.
 *
 * Разделители — запятая, точка с запятой, пробел и перевод строки:
 * человек вписывает список руками в поле на чужом сайте, и угадывать,
 * какой разделитель он выберет, мы не станем.
 */
export function parsePlatformOwners(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(/[,;\s]+/)) {
    const e = norm(part);
    // Минимальная проверка на почту: строка без собаки — это опечатка
    // или мусор, и пускать её в список тех, кто видит всех клиентов,
    // нельзя даже безобидно.
    if (e.includes('@') && e.length >= 5) seen.add(e);
  }
  return [...seen];
}

/** Владелец ли платформы. Сравнение точное, без масок и доменов целиком. */
export function isPlatformOwner(email: string | null | undefined, owners: string[]): boolean {
  if (!email || !owners.length) return false;
  return owners.includes(norm(email));
}

/**
 * Границы месяца в UTC.
 *
 * Учёт сообщений считается по календарным месяцам, и делить их надо
 * одинаково в отчёте и в счёте. Местный часовой пояс здесь не помогает:
 * организации в разных поясах, а счёт один.
 */
export function monthRange(when: Date, back = 0): { from: Date; to: Date; label: string } {
  const y = when.getUTCFullYear();
  const m = when.getUTCMonth() - back;
  const from = new Date(Date.UTC(y, m, 1));
  const to = new Date(Date.UTC(y, m + 1, 1));
  const label = `${from.getUTCFullYear()}-${String(from.getUTCMonth() + 1).padStart(2, '0')}`;
  return { from, to, label };
}

/**
 * Состояние оплаты организации.
 *
 * Три состояния, а не «оплачено или нет»: неделя до конца — это ещё не
 * долг, но уже повод написать. Без неё владелец узнаёт о неоплате в
 * день, когда клиент уже перестал платить.
 */
export type PayState = 'unpaid' | 'due' | 'paid';

/**
 * Вид кабинета: клиент или партнёр.
 *
 * Партнёрский кабинет денег не приносит и не должен: его держат те, кто
 * приводит клиентов. «Не оплачено» напротив такого кабинета — шум, от
 * которого перестают замечать настоящие долги.
 */
export type TenantKind = 'client' | 'partner';
export const TENANT_KINDS: TenantKind[] = ['client', 'partner'];

export function isTenantKind(v: unknown): v is TenantKind {
  return v === 'client' || v === 'partner';
}

/** Состояние кабинета: у партнёра оно одно и от дат не зависит. */
export type AccountState = PayState | 'partner';

export function accountState(
  kind: string | null | undefined,
  paidUntil: string | Date | null | undefined,
  now: Date = new Date(),
): AccountState {
  if (kind === 'partner') return 'partner';
  return payState(paidUntil, now);
}

export function payState(paidUntil: string | Date | null | undefined, now: Date = new Date()): PayState {
  if (!paidUntil) return 'unpaid';
  const end = paidUntil instanceof Date ? paidUntil : new Date(paidUntil);
  if (Number.isNaN(end.getTime())) return 'unpaid';
  const left = end.getTime() - now.getTime();
  if (left < 0) return 'unpaid';
  if (left < 7 * 86_400_000) return 'due';
  return 'paid';
}
