import type { OrderField, OrderFieldKind } from './zoho-order.js';

/**
 * Заказ из разговора в Битрикс.
 *
 * У Битрикса заказ — это сделка в воронке. Воронок много, у каждой свои
 * стадии и свой набор полей, которые в этой компании считают нужными, а
 * товаров у сделки может не быть вовсе: половина продаж — это «сумма и
 * пара полей», а не список позиций.
 *
 * Поэтому здесь описание чужой разметки: в какие воронки разрешено, с
 * какой стадии начинать, что спрашивать у оператора и спрашивать ли
 * сумму. Всё это выбирается из того, что вернул сам портал: имя поля,
 * вписанное руками, ошибается молча и находится на первом заказе.
 */

export interface BitrixPipeline {
  /** Номер воронки. Ноль — общая, она же у Битрикса по умолчанию. */
  id: string;
  /** Имя воронки, чтобы показать оператору. */
  name: string;
  /**
   * Стадия, с которой начинается сделка.
   *
   * Хранится вместе с воронкой: стадия принадлежит воронке, и
   * «Оплачено» из одной воронки в другой не существует. Порознь их
   * держать значит однажды отправить сделку в стадию, которой у неё
   * нет.
   */
  stage: string;
  fields: string[];
}

export interface BitrixOrderSettings {
  /**
   * Поля одинаковые во всех воронках.
   *
   * Включено по умолчанию: у большинства разметка одна на все воронки,
   * и заставлять отмечать одно и то же пять раз — значит получить пять
   * разных наборов по невнимательности.
   */
  sameFields: boolean;
  fields: string[];
  pipelines: BitrixPipeline[];
  /**
   * Спрашивать сумму, когда товаров нет.
   *
   * Сделка без позиций — обычное дело, и тогда сумма единственное, что
   * в ней есть. Когда позиции есть, сумму считает Битрикс: своё
   * умножение здесь было бы вторым мнением о том, сколько клиент
   * должен.
   */
  askAmount: boolean;
}

export const BITRIX_ORDER_DEFAULT: BitrixOrderSettings = {
  sameFields: true,
  fields: [],
  pipelines: [],
  askAmount: true,
};

/** Имена полей у Битрикса: латиница, цифры, подчёркивание. */
const NAME = /^[A-Z][A-Z0-9_]{0,79}$/i;
/** Номер воронки и номер записи — только цифры. */
const NUM = /^[0-9]{1,9}$/;
/** Стадия: «NEW» в общей воронке и «C5:NEW» в остальных. */
const STAGE = /^[A-Z0-9_:.-]{1,60}$/i;

export const BITRIX_PIPELINES_MAX = 20;

function names(raw: unknown, max = 40): string[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  for (const one of list) {
    const s = String(one);
    if (NAME.test(s) && !out.includes(s)) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

export function parseBitrixOrder(raw: unknown): BitrixOrderSettings {
  const r = (raw ?? {}) as Record<string, unknown>;
  const rawPipes = Array.isArray(r['pipelines']) ? r['pipelines'] : [];
  const pipelines: BitrixPipeline[] = [];

  for (const one of rawPipes.slice(0, BITRIX_PIPELINES_MAX)) {
    const p = (one ?? {}) as Record<string, unknown>;
    const id = String(p['id'] ?? '');
    if (!NUM.test(id) || pipelines.some((x) => x.id === id)) continue;
    const stage = String(p['stage'] ?? '');
    pipelines.push({
      id,
      name: String(p['name'] ?? '').trim().slice(0, 120),
      stage: STAGE.test(stage) ? stage : '',
      fields: names(p['fields']),
    });
  }

  return {
    // Отсутствие ключа — это «да»: настройки, записанные до появления
    // выбора, не должны внезапно означать «у каждой воронки свои поля».
    sameFields: r['sameFields'] !== false,
    fields: names(r['fields']),
    pipelines,
    askAmount: r['askAmount'] !== false,
  };
}

/**
 * Поля для выбранной воронки.
 *
 * Одно место на весь код: и окно заказа, и проверка при создании
 * обязаны понимать «одинаковые поля» одинаково, иначе оператор увидит
 * одни поля, а отправятся другие.
 */
export function bitrixPipelineFields(
  s: BitrixOrderSettings,
  pipelineId: string | null | undefined,
): string[] {
  if (s.sameFields) return s.fields;
  const found = s.pipelines.filter((p) => p.id === pipelineId)[0];
  return found ? found.fields : s.fields;
}

/** Готова ли настройка: без воронки со стадией окно обманет оператора. */
export function bitrixOrderReady(s: BitrixOrderSettings): boolean {
  return s.pipelines.length > 0 && s.pipelines.every((p) => p.stage);
}

/* ── Разметка сделки ───────────────────────────────────────────── */

/**
 * Поля, которые сделка получает от нас, а не от человека.
 *
 * Показывать их в окне — значит предложить вписать то, что будет
 * переписано при отправке.
 */
const OURS = new Set([
  'ID',
  'TITLE',
  'CATEGORY_ID',
  'STAGE_ID',
  'CONTACT_ID',
  'CONTACT_IDS',
  'LEAD_ID',
  'COMPANY_ID',
  'QUOTE_ID',
  'OPPORTUNITY',
  'IS_MANUAL_OPPORTUNITY',
  'TAX_VALUE',
  'PRODUCT_ID',
  'STAGE_SEMANTIC_ID',
  'SOURCE_ID',
  'ORIGINATOR_ID',
  'ORIGIN_ID',
  'ADDITIONAL_INFO',
  'LOCATION_ID',
  'MOVED_BY_ID',
  'MOVED_TIME',
  'LAST_ACTIVITY_BY',
  'LAST_ACTIVITY_TIME',
]);

/** Типы Битрикса, которым в окне заказа делать нечего. */
const SKIP = new Set([
  'file',
  'user',
  'location',
  'crm_contact',
  'crm_company',
  'crm_lead',
  'crm_deal',
  'crm_quote',
  'crm_entity',
  'crm_multifield',
  'crm_webform',
  'crm_category',
  'crm_status',
  'crm_currency',
  'product_property',
]);

interface BitrixFieldMeta {
  type?: string;
  title?: string;
  listLabel?: string;
  formLabel?: string;
  isRequired?: boolean;
  isReadOnly?: boolean;
  isImmutable?: boolean;
  isMultiple?: boolean;
  items?: Array<{ ID?: string | number; VALUE?: string }>;
}

function kindOf(type: string, multiple: boolean): OrderFieldKind | null {
  if (type === 'enumeration') return multiple ? 'multi' : 'pick';
  if (multiple) return null; // остальное в нескольких значениях не показываем
  if (type === 'boolean' || type === 'char') return 'bool';
  if (type === 'integer' || type === 'double') return 'num';
  if (type === 'date' || type === 'datetime') return 'date';
  if (type === 'text') return 'long';
  if (type === 'string' || type === 'url') return 'text';
  return null;
}

/**
 * Разметка сделки в наш общий вид.
 *
 * Тот же вид, что у Zoho: окно заказа одно на все CRM, и разбираться,
 * чьё поле оно сейчас показывает, ему незачем.
 *
 * У списков наружу идут номера значений, а человеку показываются
 * подписи: Битрикс принимает в поле номер, а «Готово» в разных списках
 * — разные номера.
 */
export function bitrixOrderFields(raw: unknown): OrderField[] {
  const map = (raw ?? {}) as Record<string, BitrixFieldMeta>;
  const out: OrderField[] = [];

  for (const api of Object.keys(map)) {
    if (OURS.has(api)) continue;
    const f = map[api] ?? {};
    if (f.isReadOnly || f.isImmutable) continue;
    const type = String(f.type ?? '');
    if (SKIP.has(type)) continue;

    const kind = kindOf(type, Boolean(f.isMultiple));
    if (!kind) continue;

    const items = Array.isArray(f.items) ? f.items : [];
    out.push({
      api,
      label: String(f.formLabel || f.title || f.listLabel || api).slice(0, 120),
      kind,
      required: Boolean(f.isRequired),
      options: items.map((i) => String(i?.ID ?? '')),
      titles: items.map((i) => String(i?.VALUE ?? i?.ID ?? '')),
      max: null,
    });
  }

  // Свои поля компании — в конце: их заводили под свой порядок работы,
  // и стандартные «Комментарий» и «Тип» выше них в окне не мешают.
  return out.sort((a, b) => {
    const au = a.api.startsWith('UF_') ? 1 : 0;
    const bu = b.api.startsWith('UF_') ? 1 : 0;
    return au - bu;
  });
}

/* ── Строки товаров ────────────────────────────────────────────── */

export interface BitrixRow {
  productId: number;
  productName: string;
  price: number;
  quantity: number;
  discountTypeId: 1;
  discountSum: number;
}

/**
 * Позиции сделки.
 *
 * Цена идёт та, о которой договорились в разговоре, а скидка строки —
 * деньгами: у Битрикса в строке два вида скидки, и процент там значит
 * процент, а у нас оператор пишет и «минус двести», и «минус десять
 * процентов». Превращаем в деньги здесь, чтобы в сделке лежало ровно
 * то, о чём договорились.
 */
export function bitrixRows(
  items: Array<{ productId: string; quantity: number; price: number; discount: number }>,
  names: Map<string, string>,
): BitrixRow[] {
  return items.map((i) => ({
    productId: Number(i.productId),
    productName: names.get(i.productId) ?? '',
    price: i.price,
    quantity: i.quantity,
    discountTypeId: 1,
    discountSum: i.discount,
  }));
}

/** Сумма сделки без позиций: её называет оператор. */
export function bitrixAmount(raw: unknown): number {
  const s = typeof raw === 'number' ? String(raw) : String(raw ?? '').trim();
  if (!s) return 0;
  const n = Number(s.split(',').join('.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}
