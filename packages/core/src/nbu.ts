/**
 * Курс гривни по Национальному банку.
 *
 * Счёт клиенту в долларах — это всё равно гривна на счёте: платит он по
 * курсу, и в отчётности сумма стоит в гривнах. Курс берётся на день
 * выставления счёта и сохраняется в самом счёте: завтра он будет другим,
 * а сумма в выставленном счёте меняться не должна.
 *
 * Обменного курса нет на выходные и праздники — НБУ его не объявляет.
 * Поэтому запрос отходит назад по дням, как это и делает бухгалтерия:
 * действует последний объявленный курс.
 */

export const NBU_ROOT = 'https://bank.gov.ua/NBUStatService/v1/statdirectory';

/** Валюты, в которых выставляются счета. Гривна первая: она же основная. */
export const INVOICE_CURRENCIES = ['UAH', 'USD', 'EUR'] as const;
export type InvoiceCurrency = (typeof INVOICE_CURRENCIES)[number];

export function isInvoiceCurrency(code: unknown): code is InvoiceCurrency {
  return typeof code === 'string' && (INVOICE_CURRENCIES as readonly string[]).includes(code);
}

/** Дата в виде, который понимает НБУ: 20260924. */
export function nbuDay(day: Date | string): string {
  const d = day instanceof Date ? day : new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${dd}`;
}

/** Обратно в обычный вид: 2026-09-24. */
export function isoDay(day: Date | string): string {
  const s = nbuDay(day);
  return s ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : '';
}

/**
 * Курс из ответа НБУ.
 *
 * Ответ — массив, и пустой массив здесь нормальное дело: на этот день
 * курса нет. Валюту всё равно сверяем: попросили доллар, а в ответе
 * могло прийти что угодно, и подставить чужой курс в счёт хуже, чем не
 * подставить никакого.
 */
export function parseNbuRate(body: unknown, code: string): number | null {
  const list = Array.isArray(body) ? body : [];
  for (const row of list) {
    const r = row as { cc?: unknown; rate?: unknown };
    if (String(r?.cc ?? '').toUpperCase() !== code.toUpperCase()) continue;
    const rate = typeof r.rate === 'number' ? r.rate : Number(String(r.rate ?? '').replace(',', '.'));
    if (Number.isFinite(rate) && rate > 0) return Math.round(rate * 10000) / 10000;
  }
  return null;
}

export interface NbuOptions {
  root?: string;
  fetchImpl?: typeof fetch;
  /** Сколько дней отходить назад, если на дату курса нет. */
  back?: number;
}

/**
 * Курс валюты на дату.
 *
 * Возвращает и сам курс, и день, за который он объявлен: в счёте потом
 * написано «курс НБУ на 26.09.2026», и если это пятница вместо
 * воскресенья, человек должен видеть именно пятницу.
 *
 * Гривна к гривне — единица, и в НБУ за этим не ходим.
 */
export async function nbuRate(
  code: string,
  day: Date | string,
  opts: NbuOptions = {},
): Promise<{ rate: number; day: string } | null> {
  const want = String(code).toUpperCase();
  const startIso = isoDay(day);
  if (!startIso) return null;
  if (want === 'UAH') return { rate: 1, day: startIso };

  const f = opts.fetchImpl ?? fetch;
  const root = opts.root ?? NBU_ROOT;
  const back = Math.max(0, opts.back ?? 7);

  for (let i = 0; i <= back; i++) {
    const at = new Date(`${startIso}T00:00:00Z`);
    at.setUTCDate(at.getUTCDate() - i);
    const url = `${root}/exchange?valcode=${encodeURIComponent(want)}&date=${nbuDay(at)}&json`;

    let body: unknown;
    try {
      const res = await f(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) continue;
      body = await res.json();
    } catch {
      // Сеть или разбор ответа. Молча идём дальше: у вызывающего есть
      // запасной путь — вписать курс руками.
      continue;
    }

    const rate = parseNbuRate(body, want);
    if (rate !== null) return { rate, day: isoDay(at) };
  }
  return null;
}

/** Сумма в гривнах. Округление до копеек — здесь, а не в базе. */
export function toUah(amount: number, rate: number): number {
  const n = Number(amount) * Number(rate);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * Номер счёта.
 *
 * Год в номере и сквозная нумерация внутри года: так счета сортируются
 * сами и не путаются между годами. Префикс — на случай, если счета
 * выставляются от нескольких лиц.
 */
export function invoiceNumber(seq: number, year: number, prefix = ''): string {
  const n = Math.max(1, Math.round(seq));
  return `${prefix}${year}-${String(n).padStart(4, '0')}`;
}
