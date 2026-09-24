/**
 * Каталог товаров и поля заказа Zoho.
 *
 * Оба разбора живут здесь, а не в ручке, ровно по одной причине: это
 * разбор чужого ответа, а чужой ответ — то место, где ошибаются. Его
 * надо проверять на образцах, а не на живой CRM в рабочий день.
 */

/** Товар в том виде, в каком его видит оператор. */
export interface CatalogItem {
  id: string;
  name: string;
  code: string;
  price: number;
  active: boolean;
}

/**
 * Сколько товаров тянем.
 *
 * Постраничная выборка Zoho упирается в две тысячи записей: дальше
 * нужен page_token и другой разговор. Двух тысяч хватает на любой
 * прайс, который человек глазами просматривает в окне; если товаров
 * больше — честно говорим, что показали не всё, а не делаем вид.
 */
export const CATALOG_PAGE = 200;
export const CATALOG_MAX = 2000;

/**
 * Одна строка каталога.
 *
 * Товар без названия и без артикула показывать нечем — такую строку
 * выбрасываем: в списке она выглядит как пустая полоса, на которую
 * оператор всё равно нажмёт.
 */
export function catalogItem(raw: unknown): CatalogItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === 'string' || typeof row.id === 'number' ? String(row.id) : '';
  if (!/^[0-9]+$/.test(id)) return null;

  const name = typeof row.Product_Name === 'string' ? row.Product_Name.trim() : '';
  const code = typeof row.Product_Code === 'string' ? row.Product_Code.trim() : '';
  if (!name && !code) return null;

  const rawPrice = row.Unit_Price;
  const price =
    typeof rawPrice === 'number'
      ? rawPrice
      : typeof rawPrice === 'string'
        ? Number(rawPrice.split(',').join('.'))
        : 0;

  return {
    id,
    name,
    code,
    price: Number.isFinite(price) && price > 0 ? Math.round(price * 100) / 100 : 0,
    // Признака может не быть вовсе — тогда товар обычный, рабочий.
    active: row.Product_Active === false ? false : true,
  };
}

/**
 * Страница каталога: сами товары и есть ли следующая.
 *
 * Сортировку делаем у себя. Zoho умеет сортировать по id и по датам, а
 * человеку нужен порядок по названию — тот же, что в его прайсе.
 */
export function catalogPage(raw: unknown): { items: CatalogItem[]; more: boolean } {
  const body = (raw ?? {}) as { data?: unknown; info?: { more_records?: unknown } };
  const list = Array.isArray(body.data) ? body.data : [];
  const items: CatalogItem[] = [];
  for (const row of list) {
    const item = catalogItem(row);
    if (item) items.push(item);
  }
  return { items, more: body.info?.more_records === true };
}

export function sortCatalog(items: CatalogItem[]): CatalogItem[] {
  return items
    .slice()
    .sort((a, b) => (a.name || a.code).localeCompare(b.name || b.code, 'uk', { numeric: true }));
}

/** Тип поля, приведённый к тому, что умеет показать интерфейс. */
export type OrderFieldKind = 'text' | 'long' | 'pick' | 'multi' | 'date' | 'num' | 'bool';

export interface OrderField {
  api: string;
  label: string;
  kind: OrderFieldKind;
  required: boolean;
  options: string[];
  /** Ограничение длины, если Zoho его объявила. */
  max: number | null;
}

/**
 * Поля, которые заказ получает от нас, а не от человека.
 *
 * Показывать их в форме — значит предложить вписать то, что будет
 * переписано при отправке.
 */
const OURS = new Set([
  'Subject',
  'Contact_Name',
  'Account_Name',
  'Deal_Name',
  'Product_Details',
  'Quote_Name',
]);

/** Как типы Zoho ложатся на то, что умеет форма. */
const KINDS: Record<string, OrderFieldKind> = {
  text: 'text',
  email: 'text',
  phone: 'text',
  website: 'text',
  picklist: 'pick',
  multiselectpicklist: 'multi',
  textarea: 'long',
  date: 'date',
  integer: 'num',
  double: 'num',
  currency: 'num',
  percent: 'num',
  bigint: 'num',
  boolean: 'bool',
};

/**
 * Поля заказа из описания модуля.
 *
 * Берём только те, которые человек может заполнить руками. Ссылки на
 * другие записи, файлы, формулы и поля «только для чтения» в форме
 * заказа бессмысленны: первое требует поиска по чужому модулю, второе
 * загрузки, третье считает сама Zoho.
 *
 * Обязательность берём у Zoho и не придумываем свою: в каждой
 * организации разметку правят, и наш список обязательных устарел бы в
 * тот же день.
 */
export function orderFields(raw: unknown): OrderField[] {
  const body = (raw ?? {}) as { fields?: unknown };
  const list = Array.isArray(body.fields) ? body.fields : [];
  const out: OrderField[] = [];

  for (const one of list) {
    if (!one || typeof one !== 'object') continue;
    const f = one as Record<string, unknown>;

    const api = typeof f.api_name === 'string' ? f.api_name : '';
    if (!api || OURS.has(api)) continue;
    if (f.read_only === true || f.field_read_only === true) continue;
    if (f.view_type && typeof f.view_type === 'object') {
      const view = f.view_type as { create?: unknown };
      if (view.create === false) continue;
    }

    const kind = KINDS[String(f.data_type ?? '')];
    if (!kind) continue;

    const label = typeof f.field_label === 'string' && f.field_label ? f.field_label : api;

    const options: string[] = [];
    if (kind === 'pick' || kind === 'multi') {
      const values = Array.isArray(f.pick_list_values) ? f.pick_list_values : [];
      for (const v of values) {
        const opt = (v ?? {}) as Record<string, unknown>;
        const value = typeof opt.actual_value === 'string' && opt.actual_value
          ? opt.actual_value
          : typeof opt.display_value === 'string'
            ? opt.display_value
            : '';
        // «-None-» — это отсутствие значения, а не значение.
        if (value && value !== '-None-' && !options.includes(value)) options.push(value);
      }
      if (!options.length) continue;
    }

    const max = typeof f.length === 'number' && f.length > 0 ? f.length : null;

    out.push({ api, label, kind, required: f.system_mandatory === true, options, max });
  }

  // Обязательные наверх: их заполняют всегда, остальные — когда нужно.
  return out.sort((a, b) => Number(b.required) - Number(a.required));
}

export const ORDER_FIELD_TEXT_MAX = 2000;

/**
 * Значения полей, отобранные по описанию модуля.
 *
 * Принимаем только те имена, которые Zoho назвала сама. Пропускать
 * дальше всё, что прислал браузер, — значит писать в чужую CRM поля,
 * которых оператор не видел, и получать отказ её словами про поле, о
 * котором он не знает.
 */
export function orderValues(
  fields: OrderField[],
  input: unknown,
): { values: Record<string, unknown>; missing: string[] } {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const values: Record<string, unknown> = {};
  const missing: string[] = [];

  for (const f of fields) {
    const raw = src[f.api];
    let value: unknown = null;

    if (f.kind === 'bool') {
      value = raw === true || raw === 'true' ? true : raw === false || raw === 'false' ? false : null;
    } else if (f.kind === 'num') {
      const n = Number(String(raw ?? '').split(',').join('.').trim());
      value = String(raw ?? '').trim() && Number.isFinite(n) ? n : null;
    } else if (f.kind === 'multi') {
      const list = Array.isArray(raw) ? raw : typeof raw === 'string' && raw ? [raw] : [];
      const picked = list
        .map((x) => String(x))
        .filter((x) => f.options.includes(x));
      value = picked.length ? picked : null;
    } else {
      const s = typeof raw === 'string' || typeof raw === 'number' ? String(raw).trim() : '';
      if (!s) value = null;
      else if (f.kind === 'pick') value = f.options.includes(s) ? s : null;
      else if (f.kind === 'date') value = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s) ? s : null;
      else value = s.slice(0, Math.min(f.max ?? ORDER_FIELD_TEXT_MAX, ORDER_FIELD_TEXT_MAX));
    }

    if (value === null) {
      if (f.required) missing.push(f.label);
      continue;
    }
    values[f.api] = value;
  }

  return { values, missing };
}
