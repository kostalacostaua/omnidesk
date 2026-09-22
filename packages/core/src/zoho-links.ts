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
