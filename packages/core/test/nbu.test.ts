import { describe, expect, it, vi } from 'vitest';
import {
  INVOICE_CURRENCIES,
  invoiceNumber,
  isInvoiceCurrency,
  isoDay,
  nbuDay,
  nbuRate,
  parseNbuRate,
  toUah,
} from '../src/nbu.js';

describe('дата для НБУ', () => {
  it('складывается в 20260924', () => {
    expect(nbuDay('2026-09-24')).toBe('20260924');
    expect(nbuDay(new Date('2026-01-05T23:00:00Z'))).toBe('20260105');
  });

  it('мусор не превращается в дату', () => {
    expect(nbuDay('позавчера')).toBe('');
    expect(isoDay('позавчера')).toBe('');
  });

  it('обратно читается как обычная дата', () => {
    expect(isoDay('2026-09-24')).toBe('2026-09-24');
  });
});

describe('разбор ответа НБУ', () => {
  it('курс берётся по нужной валюте', () => {
    const body = [{ cc: 'USD', rate: 41.2345, exchangedate: '24.09.2026' }];
    expect(parseNbuRate(body, 'USD')).toBe(41.2345);
  });

  it('чужая валюта в ответе не подставляется', () => {
    expect(parseNbuRate([{ cc: 'EUR', rate: 45 }], 'USD')).toBeNull();
  });

  it('пустой ответ — это «курса на этот день нет»', () => {
    expect(parseNbuRate([], 'USD')).toBeNull();
    expect(parseNbuRate({}, 'USD')).toBeNull();
    expect(parseNbuRate(undefined, 'USD')).toBeNull();
  });

  it('курс строкой и с запятой тоже читается', () => {
    expect(parseNbuRate([{ cc: 'USD', rate: '41,25' }], 'USD')).toBe(41.25);
  });

  it('ноль и отрицательный курс — не курс', () => {
    expect(parseNbuRate([{ cc: 'USD', rate: 0 }], 'USD')).toBeNull();
    expect(parseNbuRate([{ cc: 'USD', rate: -41 }], 'USD')).toBeNull();
    expect(parseNbuRate([{ cc: 'USD', rate: 'дорого' }], 'USD')).toBeNull();
  });

  it('курс режется до четырёх знаков', () => {
    expect(parseNbuRate([{ cc: 'USD', rate: 41.23456789 }], 'USD')).toBe(41.2346);
  });
});

describe('курс на дату', () => {
  function stub(byDay: Record<string, unknown>) {
    return vi.fn(async (url: string | URL) => {
      const day = String(url).match(/date=([0-9]{8})/)?.[1] ?? '';
      const body = byDay[day];
      if (body === undefined) return new Response('[]', { status: 200 });
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
  }

  it('гривна к гривне — единица, и в НБУ за этим не ходим', async () => {
    const f = vi.fn() as unknown as typeof fetch;
    expect(await nbuRate('UAH', '2026-09-24', { fetchImpl: f })).toEqual({
      rate: 1,
      day: '2026-09-24',
    });
    expect(f).not.toHaveBeenCalled();
  });

  it('обычный день — курс этого дня', async () => {
    const f = stub({ '20260924': [{ cc: 'USD', rate: 41.25 }] });
    expect(await nbuRate('USD', '2026-09-24', { fetchImpl: f })).toEqual({
      rate: 41.25,
      day: '2026-09-24',
    });
  });

  it('воскресенье — действует курс пятницы', async () => {
    // 27.09.2026 — воскресенье, курса нет; 25.09 — пятница.
    const f = stub({ '20260925': [{ cc: 'USD', rate: 41.1 }] });
    expect(await nbuRate('USD', '2026-09-27', { fetchImpl: f })).toEqual({
      rate: 41.1,
      day: '2026-09-25',
    });
  });

  it('когда НБУ молчит совсем — честный отказ, а не выдуманный курс', async () => {
    const f = vi.fn(async () => new Response('', { status: 500 })) as unknown as typeof fetch;
    expect(await nbuRate('USD', '2026-09-24', { fetchImpl: f, back: 2 })).toBeNull();
  });

  it('сеть упала — тоже отказ, а не падение', async () => {
    const f = vi.fn(async () => {
      throw new Error('сеть');
    }) as unknown as typeof fetch;
    expect(await nbuRate('USD', '2026-09-24', { fetchImpl: f, back: 1 })).toBeNull();
  });

  it('назад отходим не бесконечно', async () => {
    const f = vi.fn(async () => new Response('[]', { status: 200 })) as unknown as typeof fetch;
    await nbuRate('USD', '2026-09-24', { fetchImpl: f, back: 3 });
    expect((f as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(4);
  });
});

describe('сумма в гривнах', () => {
  it('считается по курсу и режется до копеек', () => {
    expect(toUah(100, 41.2345)).toBe(4123.45);
    expect(toUah(1200, 41.25)).toBe(49500);
  });

  it('гривна остаётся собой', () => {
    expect(toUah(1200, 1)).toBe(1200);
  });

  it('мусор превращается в ноль, а не в NaN', () => {
    expect(toUah(Number.NaN, 41)).toBe(0);
    expect(toUah(-100, 41)).toBe(0);
  });
});

describe('номер счёта', () => {
  it('год и сквозной номер', () => {
    expect(invoiceNumber(1, 2026)).toBe('2026-0001');
    expect(invoiceNumber(42, 2026)).toBe('2026-0042');
    expect(invoiceNumber(12345, 2026)).toBe('2026-12345');
  });

  it('префикс подставляется впереди', () => {
    expect(invoiceNumber(7, 2026, 'RZ-')).toBe('RZ-2026-0007');
  });
});

describe('список валют', () => {
  it('гривна, доллар и евро', () => {
    expect(INVOICE_CURRENCIES).toEqual(['UAH', 'USD', 'EUR']);
    expect(isInvoiceCurrency('USD')).toBe(true);
    expect(isInvoiceCurrency('BTC')).toBe(false);
    expect(isInvoiceCurrency(undefined)).toBe(false);
  });
});
