/**
 * Куда уезжает заказ из разговора.
 *
 * До сих пор ответ был зашит: модуль «Замовлення» (Sales_Orders),
 * стандартная таблица товаров, поля какие есть. Так работает малая
 * часть компаний. У остальных заказ — это сделка, сделок несколько
 * воронок, у каждой воронки свои обязательные поля, а товары лежат в
 * своей подформе с именами колонок, которые придумали на месте.
 *
 * Поэтому здесь не «настройка на всякий случай», а описание чужой
 * разметки: в каком модуле заводить, в какие воронки разрешено, что
 * спрашивать у оператора и куда складывать строки товаров.
 */

export const ORDER_MODULES = ['Sales_Orders', 'Deals'] as const;
export type OrderModule = (typeof ORDER_MODULES)[number];

export function isOrderModule(v: unknown): v is OrderModule {
  return (ORDER_MODULES as readonly string[]).includes(String(v));
}

/**
 * Воронка, в которую разрешено заводить заказ.
 *
 * Стадия хранится вместе с воронкой, а не отдельно: стадия
 * принадлежит воронке, и «Оплачено» из одной воронки в другой не
 * существует. Хранить их порознь значит однажды отправить сделку в
 * стадию, которой у неё нет.
 */
export interface OrderPipeline {
  /** Идентификатор воронки в Zoho. */
  id: string;
  /** Как она называется у клиента — чтобы показать оператору. */
  name: string;
  /** Макет, которому воронка принадлежит. */
  layout: string;
  /** Стадия, с которой начинается заказ. */
  stage: string;
  /** Поля, которые спрашиваем у оператора для этой воронки. */
  fields: string[];
}

/**
 * Где лежат строки товаров.
 *
 * У «Замовлень» это стандартная таблица с известными колонками. У
 * сделок — подформа, которую завели руками, и имена колонок в ней
 * любые: «Товар», «Позиция», «Product». Угадать их нельзя, поэтому
 * они выбираются один раз в настройках.
 */
export interface OrderSubform {
  /** Имя поля-подформы. Пусто — стандартная таблица товаров. */
  api: string;
  /** Колонка с товаром. */
  product: string;
  /** Колонка с количеством. */
  quantity: string;
  /** Колонка с ценой. */
  price: string;
  /**
   * Колонка со скидкой на строку. Может отсутствовать: не в каждой
   * подформе она заведена, и заказ без неё делается по-прежнему.
   */
  discount: string;
}

export interface OrderSettings {
  module: OrderModule;
  /**
   * Поля одинаковые во всех воронках.
   *
   * Включено по умолчанию: у большинства разметка одна на все воронки,
   * и заставлять отмечать одно и то же пять раз — значит получить пять
   * разных наборов по невнимательности.
   */
  sameFields: boolean;
  /** Общий набор полей: он же единственный для «Замовлень». */
  fields: string[];
  pipelines: OrderPipeline[];
  subform: OrderSubform;
  /**
   * Поле скидки на весь заказ.
   *
   * Отдельно от скидок строк: скидка на заказ — это уступка сверх
   * позиций («округлим до тысячи»), и размазывать её по строкам
   * значит менять цены, о которых договорились.
   */
  discountField: string;
}

/**
 * Таблица товаров «Замовлень»: имена колонок зашиты в самой Zoho.
 *
 * Раньше здесь стояло Product_Details с колонками product, quantity и
 * list_price — так это называлось во втором поколении API. С тех пор
 * Zoho дала таблице имя своего модуля: у заказа Ordered_Items, у
 * счёта Invoiced_Items, у предложения Quoted_Items. Старое имя
 * означало заказ, который не создаётся, и три пустых списка в
 * настройках.
 */
export const STOCK_SUBFORM: OrderSubform = {
  api: 'Ordered_Items',
  product: 'Product_Name',
  quantity: 'Quantity',
  price: 'List_Price',
  discount: 'Discount',
};

/** Имя, под которым таблица товаров жила во втором поколении API. */
export const LEGACY_SUBFORM = 'Product_Details';

export const ORDER_SETTINGS_DEFAULT: OrderSettings = {
  // Sales_Orders по умолчанию: так вело себя приложение до появления
  // выбора, и менять поведение молча у тех, кто уже работает, нельзя.
  module: 'Sales_Orders',
  sameFields: true,
  fields: [],
  pipelines: [],
  subform: STOCK_SUBFORM,
  discountField: '',
};

const NAME = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const ID = /^[0-9]{1,24}$/;

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

function text(raw: unknown, max: number): string {
  return typeof raw === 'string' ? raw.trim().slice(0, max) : '';
}

export const ORDER_PIPELINES_MAX = 20;

export function parseOrderSettings(raw: unknown): OrderSettings {
  const r = (raw ?? {}) as Record<string, unknown>;
  const module = isOrderModule(r['module'])
    ? (r['module'] as OrderModule)
    : ORDER_SETTINGS_DEFAULT.module;

  const rawPipes = Array.isArray(r['pipelines']) ? r['pipelines'] : [];
  const pipelines: OrderPipeline[] = [];
  for (const one of rawPipes.slice(0, ORDER_PIPELINES_MAX)) {
    const p = (one ?? {}) as Record<string, unknown>;
    const id = String(p['id'] ?? '');
    if (!ID.test(id) || pipelines.some((x) => x.id === id)) continue;
    pipelines.push({
      id,
      name: text(p['name'], 120),
      layout: ID.test(String(p['layout'] ?? '')) ? String(p['layout']) : '',
      stage: text(p['stage'], 120),
      fields: names(p['fields']),
    });
  }

  const sub = (r['subform'] ?? {}) as Record<string, unknown>;
  const api = String(sub['api'] ?? '');
  const col = (key: string) =>
    NAME.test(String(sub[key] ?? '')) ? String(sub[key]) : '';
  // Настройка, записанная под старое имя таблицы, читается как «не
  // настроено»: её колонки в нынешней Zoho не существуют, и молча
  // отправлять по ним заказ — значит получать отказ на каждом.
  const subform: OrderSubform = NAME.test(api) && api !== LEGACY_SUBFORM
    ? {
        api,
        product: col('product'),
        quantity: col('quantity'),
        price: col('price'),
        discount: col('discount'),
      }
    : { ...STOCK_SUBFORM };

  return {
    module,
    // Отсутствие ключа — это «да»: настройки, записанные до появления
    // воронок, не должны внезапно означать «у каждой свои поля».
    sameFields: r['sameFields'] !== false,
    fields: names(r['fields']),
    pipelines,
    subform,
    discountField: NAME.test(String(r['discountField'] ?? '')) ? String(r['discountField']) : '',
  };
}

/**
 * Поля для выбранной воронки.
 *
 * Одно место на весь код: и окно заказа, и проверка при создании
 * обязаны понимать «одинаковые поля» одинаково, иначе оператор увидит
 * одни поля, а отправятся другие.
 */
export function pipelineFields(s: OrderSettings, pipelineId: string | null | undefined): string[] {
  if (s.module !== 'Deals' || s.sameFields) return s.fields;
  const found = s.pipelines.filter((p) => p.id === pipelineId)[0];
  return found ? found.fields : s.fields;
}

/** Готова ли настройка к работе: без этого окно заказа обманет оператора. */
export function orderReady(s: OrderSettings): boolean {
  if (!s.subform.api || !s.subform.product) return false;
  if (s.module === 'Deals') return s.pipelines.length > 0 && s.pipelines.every((p) => p.stage);
  return true;
}
