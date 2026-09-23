/**
 * Сеанс в cookie.
 *
 * Токен страницы живёт в localStorage, и этого хватало ровно до первой
 * новой вкладки: если хранилище пусто или недоступно (инкогнито,
 * чистка сайта, вход был сделан внутри рамки Zoho — там хранилище
 * отдельное), человек снова видел форму входа, хотя вошёл минуту назад.
 *
 * Cookie одна на все вкладки происхождения и переживает закрытие
 * браузера. Помечена HttpOnly — чужой скрипт её не прочитает; Secure на
 * https; SameSite=Lax — это и есть защита от подделки запросов: браузер
 * не приложит её к запросу, начатому с чужого сайта. Внутри рамки Zoho
 * она тоже не отправится, и это правильно: виджет входит заголовком.
 */

export const SESSION_COOKIE = 'rz_session';

/** Семь дней — столько же, сколько живёт сам токен. */
export const SESSION_TTL = 7 * 24 * 3600;

/** Достать одну cookie из заголовка. Пусто, если её там нет. */
export function readCookie(header: unknown, name: string): string {
  if (typeof header !== 'string') return '';
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
}

/** https ли запрос: за прокси об этом знает только заголовок. */
export function isHttps(proto: unknown): boolean {
  return typeof proto === 'string' && proto.split(',')[0]?.trim() === 'https';
}

/** Значение заголовка set-cookie. maxAge = 0 гасит cookie. */
export function sessionCookie(value: string, secure: boolean, maxAge: number): string {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : '',
    `Max-Age=${maxAge}`,
  ]
    .filter(Boolean)
    .join('; ');
}
