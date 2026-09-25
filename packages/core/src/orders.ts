/**
 * Строки заказа.
 *
 * Здесь считаются деньги, поэтому проверка не в ручке, а отдельно и с
 * тестами: ноль в количестве, минус в цене и «2,5» вместо «2.5»
 * приезжают из браузера регулярно, а ошибка в этом месте видна не сразу
 * — она видна в счёте, который клиент уже получил.
 *
 * Одинаковые товары не склеиваются. Оператор мог поставить две строки с
 * разными ценами намеренно — так продают «две по прайсу и одну со
 * скидкой», и склейка молча превратила бы это в другую сумму.
 */

export type OrderItemInput = {
  productId?: unknown;
  quantity?: unknown;
  price?: unknown;
  discount?: unknown;
};

export type OrderItem = {
  productId: string;
  quantity: number;
  price: number;
  /** Скидка на строку, в деньгах. Проценты превращены в деньги здесь. */
  discount: number;
};

/** Больше ста строк — это не разговор, а выгрузка прайса. */
export const ORDER_ITEMS_MAX = 100;

/** Длина названия: в Zoho поле не резиновое. */
export const ORDER_SUBJECT_MAX = 120;

/** Число из браузера: запятая как разделитель — норма для наших стран. */
function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v !== 'string') return 0;
  const n = Number(v.trim().split(',').join('.'));
  return Number.isFinite(n) ? n : 0;
}

/** Копейки. Округление здесь, а не в Zoho: туда должна уехать цена, а не 0.30000000000000004. */
function money(v: unknown): number {
  const n = num(v);
  return n > 0 ? Math.round(n * 100) / 100 : 0;
}

/**
 * Скидка: деньгами или процентом.
 *
 * Оператор договаривается и так, и так: «минус двести» и «минус
 * десять процентов» — одна и та же фраза в разговоре. Процент
 * превращается в деньги здесь, а не в Zoho: у неё в строке заказа
 * скидка хранится числом, и «10» в этом поле означает десять гривен, а
 * не десять процентов.
 *
 * Больше суммы скидка быть не может: отрицательная строка в заказе —
 * это не скидка, а возврат, и делается он не здесь.
 */
export function discountAmount(raw: unknown, base: number): number {
  const s = typeof raw === 'number' ? String(raw) : String(raw ?? '').trim();
  if (!s) return 0;
  const percent = s.endsWith('%');
  const n = num(percent ? s.slice(0, -1) : s);
  if (n <= 0) return 0;
  const amount = percent ? (base * n) / 100 : n;
  const top = Math.round(base * 100) / 100;
  return Math.min(Math.round(amount * 100) / 100, top > 0 ? top : 0);
}

export function orderItems(raw: unknown): OrderItem[] {
  if (!Array.isArray(raw)) return [];
  const out: OrderItem[] = [];
  for (const r of raw as OrderItemInput[]) {
    const id = typeof r?.productId === 'string' ? r.productId.trim() : '';
    if (!id) continue;
    const q = Math.round(num(r.quantity));
    const quantity = q > 0 ? q : 1;
    const price = money(r.price);
    out.push({
      productId: id,
      quantity,
      price,
      discount: discountAmount(r.discount, quantity * price),
    });
    if (out.length === ORDER_ITEMS_MAX) break;
  }
  return out;
}

/** Сумма строк до скидок. */
export function orderSubtotal(items: OrderItem[]): number {
  return Math.round(items.reduce((s, i) => s + i.quantity * i.price, 0) * 100) / 100;
}

/**
 * Сумма — для показа человеку. Настоящую считает Zoho по тем же строкам.
 *
 * Скидки строк вычтены: показывать «разом» без них значит называть
 * клиенту сумму, которой не будет в счёте.
 */
export function orderTotal(items: OrderItem[]): number {
  return Math.round(items.reduce((s, i) => s + i.quantity * i.price - i.discount, 0) * 100) / 100;
}

/**
 * Название заказа.
 *
 * Пустое поле — обычное дело: оператор торопится. Тогда название
 * собирается само, и в нём есть имя клиента: в списке заказов Zoho
 * десяток «Замовлення з чату» без имени неотличимы друг от друга.
 */
export function orderSubject(input: unknown, who: string | null | undefined): string {
  const given = typeof input === 'string' ? input.trim().slice(0, ORDER_SUBJECT_MAX) : '';
  if (given) return given;
  const name = (who ?? '').trim() || 'клієнт';
  return `Замовлення з чату — ${name}`.slice(0, ORDER_SUBJECT_MAX);
}
