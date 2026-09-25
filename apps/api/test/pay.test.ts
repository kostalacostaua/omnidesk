import { describe, expect, it } from 'vitest';
import { payPage, payTxn } from '../src/pay.js';

/*
 * Страница оплаты на домене-витрине.
 *
 * Paddle разрешает продавать только с одобренных доменов, и субдомен
 * кабинета одобряется отдельно. Эта страница — единственное место, где
 * оплату можно открыть без входа, поэтому проверяем именно то, что
 * делает её безопасной и работающей: номер сделки, публичный токен и
 * отсутствие чего-либо ещё.
 */
const DEPS = {
  env: 'sandbox' as const,
  clientToken: 'test_token_1',
  appUrl: 'https://app.rozmovio.com',
  contactEmail: 'support@rozmovio.com',
};

describe('номер сделки', () => {
  it('принимается только в том виде, в каком его выдаёт Paddle', () => {
    expect(payTxn('txn_01abcXYZ')).toBe('txn_01abcXYZ');
    expect(payTxn('sub_01abc')).toBeNull();
    expect(payTxn('txn_01abc; drop table')).toBeNull();
    expect(payTxn('')).toBeNull();
    expect(payTxn(null)).toBeNull();
  });
});

describe('страница оплаты', () => {
  const html = payPage(DEPS);

  it('открывает окно Paddle и знает, куда вернуть человека', () => {
    expect(html).toContain('cdn.paddle.com/paddle/v2/paddle.js');
    expect(html).toContain('test_token_1');
    expect(html).toContain('https://app.rozmovio.com');
  });

  // Номер сделки Paddle кладёт в адрес сам, когда ведёт человека по
  // своей ссылке на неоплаченную сделку. Не принять его значит
  // встретить заплатившего формой входа.
  it('принимает номер сделки из ссылки самого Paddle', () => {
    expect(html).toContain('_ptxn');
  });

  it('в песочнице переключает окружение, в бою — нет', () => {
    expect(html).toContain('Environment.set');
    expect(payPage({ ...DEPS, env: 'production' })).toContain('"production"');
  });

  /*
   * Страница открыта всему свету: её адрес приходит письмом от Paddle.
   * Ничего, кроме открытого токена окна оплаты, на ней быть не должно —
   * ключ к API Paddle сюда не передаётся вовсе, и передать его неоткуда.
   */
  it('не содержит ничего, кроме открытого токена', () => {
    expect(html).not.toContain('pdl_');
    expect(html).not.toContain('apikey');
  });

  it('без токена честно говорит, что платить пока нечем', () => {
    const off = payPage({ ...DEPS, clientToken: '' });
    expect(off).toContain('Оплата поки недоступна');
  });
});
