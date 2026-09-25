import { describe, expect, it } from 'vitest';
import {
  ORDER_ITEMS_MAX,
  discountAmount,
  orderItems,
  orderSubject,
  orderSubtotal,
  orderTotal,
} from '../src/orders.js';

/**
 * Проверки здесь про деньги: строка заказа приезжает из браузера, и
 * каждое из этих значений там уже видели.
 */
describe('строки заказа', () => {
  it('без товара строка отбрасывается', () => {
    expect(orderItems([{ quantity: 2, price: 10 }])).toEqual([]);
    expect(orderItems([{ productId: '   ', quantity: 1 }])).toEqual([]);
  });

  it('количество меньше единицы становится единицей', () => {
    expect(orderItems([{ productId: 'p1', quantity: 0 }])[0].quantity).toBe(1);
    expect(orderItems([{ productId: 'p1', quantity: -5 }])[0].quantity).toBe(1);
    expect(orderItems([{ productId: 'p1' }])[0].quantity).toBe(1);
  });

  it('дробное количество округляется', () => {
    expect(orderItems([{ productId: 'p1', quantity: 2.6 }])[0].quantity).toBe(3);
  });

  it('запятая в цене — это разделитель, а не мусор', () => {
    expect(orderItems([{ productId: 'p1', price: '2,50' }])[0].price).toBe(2.5);
  });

  it('минус в цене обнуляется, а не уезжает в Zoho', () => {
    expect(orderItems([{ productId: 'p1', price: -99 }])[0].price).toBe(0);
  });

  it('цена режется до копеек', () => {
    expect(orderItems([{ productId: 'p1', price: 10.005 }])[0].price).toBe(10.01);
    expect(orderItems([{ productId: 'p1', price: 0.1 + 0.2 }])[0].price).toBe(0.3);
  });

  it('мусор вместо цены — ноль, а не NaN', () => {
    expect(orderItems([{ productId: 'p1', price: 'дешево' }])[0].price).toBe(0);
    expect(orderItems([{ productId: 'p1', price: Infinity }])[0].price).toBe(0);
  });

  it('одинаковые товары не склеиваются: две цены — две строки', () => {
    const items = orderItems([
      { productId: 'p1', quantity: 2, price: 100 },
      { productId: 'p1', quantity: 1, price: 80 },
    ]);
    expect(items).toHaveLength(2);
    expect(orderTotal(items)).toBe(280);
  });

  it('длинный список режется', () => {
    const many = Array.from({ length: 300 }, () => ({ productId: 'p1', quantity: 1, price: 1 }));
    expect(orderItems(many)).toHaveLength(ORDER_ITEMS_MAX);
  });

  it('не массив — пустой заказ, а не падение', () => {
    expect(orderItems(undefined)).toEqual([]);
    expect(orderItems('p1')).toEqual([]);
    expect(orderItems({ productId: 'p1' })).toEqual([]);
  });

  it('сумма считается в копейках', () => {
    expect(orderTotal(orderItems([{ productId: 'p1', quantity: 3, price: '0,1' }]))).toBe(0.3);
  });
});

describe('название заказа', () => {
  it('своё название сохраняется', () => {
    expect(orderSubject('  Ремонт даху  ', 'Олена')).toBe('Ремонт даху');
  });

  it('пустое собирается с именем клиента', () => {
    expect(orderSubject('', 'Олена')).toContain('Олена');
    expect(orderSubject(undefined, null)).toContain('клієнт');
  });

  it('длинное режется', () => {
    expect(orderSubject('я'.repeat(500), 'Олена')).toHaveLength(120);
  });
});

/**
 * Скидка — это деньги, о которых договорились вслух. Ошибка здесь
 * видна в счёте, который клиент уже получил.
 */
describe('скидки', () => {
  it('процент превращается в деньги', () => {
    expect(discountAmount('10%', 1000)).toBe(100);
    expect(discountAmount('12,5%', 200)).toBe(25);
  });

  it('число без знака — это деньги, а не проценты', () => {
    expect(discountAmount('150', 1000)).toBe(150);
  });

  it('скидка не больше суммы: отрицательная строка — это возврат', () => {
    expect(discountAmount('5000', 1000)).toBe(1000);
    expect(discountAmount('150%', 1000)).toBe(1000);
  });

  it('пусто, ноль и мусор — это отсутствие скидки', () => {
    expect(discountAmount('', 1000)).toBe(0);
    expect(discountAmount('0', 1000)).toBe(0);
    expect(discountAmount('-50', 1000)).toBe(0);
    expect(discountAmount('десять', 1000)).toBe(0);
  });

  it('скидка строки считается от её собственной суммы', () => {
    const items = orderItems([{ productId: 'p1', quantity: 3, price: 100, discount: '10%' }]);
    expect(items[0].discount).toBe(30);
  });

  it('итог показывает сумму со скидками, а не прайс', () => {
    const items = orderItems([
      { productId: 'p1', quantity: 2, price: 100, discount: '50' },
      { productId: 'p2', quantity: 1, price: 300 },
    ]);
    expect(orderSubtotal(items)).toBe(500);
    expect(orderTotal(items)).toBe(450);
  });
});
