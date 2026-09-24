/**
 * Кто что может.
 *
 * До этого проверялся только вход: любой, кто вошёл, мог отключить
 * канал, стереть сценарий, сменить ключ от модели и выдать себе роль
 * владельца. Оператор нанимается отвечать клиентам, и такие права у
 * него — не удобство, а способ потерять компанию за один вечер.
 *
 * Правило одно и живёт в одном месте, а не в полусотне обработчиков:
 * там его однажды забудут дописать, и дыра появится в той ручке, о
 * которой никто не вспомнит.
 *
 * Уровни:
 *   any   — чтение и вход: доступно всем, кто вошёл;
 *   write — работа с перепиской: оператору можно, наблюдателю нет;
 *   admin — настройка сервиса и люди: владелец и администратор.
 *
 * Чтение намеренно открыто всем ролям: список каналов нужен фильтру,
 * список людей — подписям «ответственный», настройки ИИ — кнопке
 * черновика. Секретов в этих ответах нет: ключи и токены не покидают
 * сервер ни в каком виде.
 */

export type Role = 'owner' | 'admin' | 'agent' | 'viewer';

export type Level = 'any' | 'write' | 'admin';

/** Разделы, менять которые может только администратор. */
const ADMIN_PREFIXES = [
  '/settings',
  '/channels',
  '/scenarios',
  '/users',
  '/quick-replies',
  // Статусы — справочник компании, а не заметка оператора: одно
  // переименование меняет список у всей смены.
  '/statuses',
  '/zoho',
  '/data-deletion',
  '/tenant',
];

/** Всё, что относится ко входу: проверку прав здесь делать нечем. */
function isAuthPath(path: string): boolean {
  return path === '/auth' || path.startsWith('/auth/');
}

/** Какой уровень нужен для этого запроса. */
export function requiredLevel(method: string, path: string): Level {
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return 'any';

  // Публичные ручки: заявка с промо-страницы и вход по коду.
  if (isAuthPath(path) || path === '/leads') return 'any';

  // Своё имя и свой пароль человек меняет сам — в том числе
  // наблюдатель, которому писать клиентам нельзя. Это про него, а не
  // про данные компании.
  if (path === '/me' || path.startsWith('/me/')) return 'any';

  // Приём сообщений от каналов идёт по секрету в заголовке, а не по
  // пользователю: роли там нет и быть не может.
  if (path.startsWith('/webhooks/')) return 'any';

  // Свой канал присылает входящие с ключом канала в заголовке. Это тот
  // же случай, что и вебхук: пользователя за запросом нет.
  if (path === '/channels/custom/messages') return 'any';

  const clean = path.split('?')[0] ?? path;
  for (const prefix of ADMIN_PREFIXES) {
    if (clean === prefix || clean.startsWith(prefix + '/')) return 'admin';
  }

  return 'write';
}

/** Хватает ли роли. */
export function roleAllows(role: Role | string, level: Level): boolean {
  if (level === 'any') return true;
  if (level === 'admin') return role === 'owner' || role === 'admin';
  return role === 'owner' || role === 'admin' || role === 'agent';
}

/** Название роли для человека: оно попадает в текст отказа. */
export const ROLE_TITLES: Record<string, string> = {
  owner: 'владелец',
  admin: 'администратор',
  agent: 'оператор',
  viewer: 'наблюдатель',
};

/** Почему отказали — словами, которые можно показать в интерфейсе. */
export function denial(role: Role | string, level: Level): string {
  const who = ROLE_TITLES[role] ?? role;
  return level === 'admin'
    ? `Это может делать только владелец или администратор, а вы — ${who}`
    : `У роли «${who}» доступ только на чтение`;
}
