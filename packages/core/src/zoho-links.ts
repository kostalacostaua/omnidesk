/**
 * Ссылки на записи Zoho CRM.
 *
 * Адрес интерфейса не совпадает с адресом API: данные лежат на
 * zohoapis.eu, а человек открывает crm.zoho.eu. Правило «заменить
 * www.zohoapis на crm.zoho» работает для всех зон, кроме канадской,
 * где интерфейс живёт на crm.zohocloud.ca.
 */
const UI_BY_API: Record<string, string> = {
  'https://www.zohoapis.com': 'https://crm.zoho.com',
  'https://www.zohoapis.eu': 'https://crm.zoho.eu',
  'https://www.zohoapis.in': 'https://crm.zoho.in',
  'https://www.zohoapis.com.au': 'https://crm.zoho.com.au',
  'https://www.zohoapis.jp': 'https://crm.zoho.jp',
  'https://www.zohoapis.com.cn': 'https://crm.zoho.com.cn',
  'https://www.zohoapis.ca': 'https://crm.zohocloud.ca',
  'https://www.zohoapis.sa': 'https://crm.zoho.sa',
};

/**
 * Адрес карточки в интерфейсе Zoho.
 *
 * Возвращает null, а не «примерную» ссылку: неверная ссылка в карточке
 * клиента хуже её отсутствия — оператор жмёт и попадает на страницу
 * ошибки чужой организации.
 */
export function zohoRecordUrl(
  apiDomain: string | null | undefined,
  module: string | null | undefined,
  recordId: string | null | undefined,
): string | null {
  if (!apiDomain || !module || !recordId) return null;
  const ui = UI_BY_API[apiDomain.replace(/[/]+$/, '')];
  if (!ui) return null;
  if (!/^[A-Za-z_]+$/.test(module)) return null;
  if (!/^[0-9]+$/.test(recordId)) return null;
  return `${ui}/crm/tab/${module}/${recordId}`;
}

/**
 * Контакт, в который превратился лид.
 *
 * Лида конвертируют в самой Zoho, и после этого запись лида закрыта, а
 * связь у нас всё ещё указывает на неё. Zoho отдаёт в самом лиде, во
 * что он превратился, — и отдаёт двумя способами: полем
 * Converted_Contact в новых версиях API и служебным $converted_detail
 * в старых. Понимаем оба: угадывать версию чужого API по номеру в
 * адресе — худший способ узнать правду.
 *
 * Пустой ответ здесь значит «ещё не сконвертирован», а не «ошибка»:
 * это законное состояние, и показывать его надо словами, а не отказом.
 */
export function convertedContactId(row: Record<string, unknown> | null | undefined): string | null {
  if (!row) return null;
  const converted = row['Converted__s'] === true || row['$converted'] === true;
  if (!converted) return null;

  const lookup = row['Converted_Contact'] as { id?: unknown } | undefined;
  const detail = row['$converted_detail'] as { contact?: unknown; contact_id?: unknown } | undefined;
  const raw = lookup?.id ?? detail?.contact ?? detail?.contact_id;
  const id = typeof raw === 'string' || typeof raw === 'number' ? String(raw) : '';
  return /^[0-9]+$/.test(id) ? id : null;
}
