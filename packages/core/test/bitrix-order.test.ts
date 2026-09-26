import { describe, expect, it } from 'vitest';
import {
  BITRIX_PIPELINES_MAX,
  bitrixAmount,
  bitrixOrderFields,
  bitrixOrderReady,
  bitrixPipelineFields,
  bitrixRows,
  parseBitrixOrder,
} from '../src/bitrix-order.js';
import { orderValues } from '../src/zoho-order.js';

/*
 * Заказ в Битриксе — это сделка в воронке.
 *
 * Настройка описывает чужую разметку, и приходит она из браузера:
 * номер воронки, имя стадии и имена полей проверяются как чужой ввод.
 */

describe('настройка заказа', () => {
  it('берёт воронки с номерами и стадиями, остальное отбрасывает', () => {
    const s = parseBitrixOrder({
      pipelines: [
        { id: '0', name: 'Загальна', stage: 'NEW', fields: ['COMMENTS', 'UF_CRM_1'] },
        { id: '5', name: 'Опт', stage: 'C5:NEW', fields: [] },
        // Номер воронки — число. Всё прочее приехало не из портала.
        { id: 'C5', stage: 'NEW' },
        { id: '7', stage: 'прогалина в стадії' },
        // Та же воронка второй раз: заказ поедет в неё один раз, а не два.
        { id: '5', stage: 'C5:WON' },
      ],
    });

    expect(s.pipelines.map((p) => p.id)).toEqual(['0', '5', '7']);
    expect(s.pipelines[0]!.stage).toBe('NEW');
    expect(s.pipelines[1]!.stage).toBe('C5:NEW');
    // Стадия с пробелом — не стадия: с ней сделка уедет в никуда.
    expect(s.pipelines[2]!.stage).toBe('');
    expect(s.pipelines[0]!.fields).toEqual(['COMMENTS', 'UF_CRM_1']);
  });

  it('без воронки со стадией окно заказа не готово', () => {
    expect(bitrixOrderReady(parseBitrixOrder({}))).toBe(false);
    expect(
      bitrixOrderReady(parseBitrixOrder({ pipelines: [{ id: '3', stage: '' }] })),
    ).toBe(false);
    expect(
      bitrixOrderReady(parseBitrixOrder({ pipelines: [{ id: '3', stage: 'C3:NEW' }] })),
    ).toBe(true);
  });

  /*
   * «Одинаковые поля» обязаны пониматься одинаково окном и проверкой
   * при создании: иначе оператор видит одни поля, а отправляются другие.
   */
  it('поля воронки зависят от того, общие они или свои', () => {
    const raw = {
      sameFields: true,
      fields: ['COMMENTS'],
      pipelines: [{ id: '5', stage: 'C5:NEW', fields: ['UF_CRM_X'] }],
    };
    expect(bitrixPipelineFields(parseBitrixOrder(raw), '5')).toEqual(['COMMENTS']);
    expect(bitrixPipelineFields(parseBitrixOrder({ ...raw, sameFields: false }), '5')).toEqual([
      'UF_CRM_X',
    ]);
    // Настройка, записанная до появления выбора, означает «общие».
    expect(parseBitrixOrder({ fields: [] }).sameFields).toBe(true);
    expect(parseBitrixOrder({ fields: [] }).askAmount).toBe(true);
  });

  it('воронок берём столько, сколько влезает в настройку', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: String(i + 1), stage: 'NEW' }));
    expect(parseBitrixOrder({ pipelines: many }).pipelines.length).toBe(BITRIX_PIPELINES_MAX);
  });
});

describe('разметка сделки', () => {
  const fields = {
    ID: { type: 'integer', title: 'ID', isReadOnly: true },
    TITLE: { type: 'string', title: 'Назва' },
    STAGE_ID: { type: 'crm_status', title: 'Стадія' },
    OPPORTUNITY: { type: 'double', title: 'Сума' },
    COMMENTS: { type: 'text', title: 'Коментар' },
    DATE_CREATE: { type: 'datetime', title: 'Створено', isReadOnly: true },
    ASSIGNED_BY_ID: { type: 'user', title: 'Відповідальний' },
    UF_CRM_TYPE: {
      type: 'enumeration',
      formLabel: 'Тип замовлення',
      isRequired: true,
      items: [
        { ID: '41', VALUE: 'Роздріб' },
        { ID: '43', VALUE: 'Опт' },
      ],
    },
  };

  it('оставляет то, что человек может заполнить', () => {
    const out = bitrixOrderFields(fields);
    const names = out.map((f) => f.api);

    // Наше — название, воронка, стадия, сумма: показать их значит
    // предложить вписать то, что мы перезапишем при отправке.
    expect(names).not.toContain('TITLE');
    expect(names).not.toContain('STAGE_ID');
    expect(names).not.toContain('OPPORTUNITY');
    // Только для чтения и типы, которых в окне не нарисовать.
    expect(names).not.toContain('DATE_CREATE');
    expect(names).not.toContain('ASSIGNED_BY_ID');

    expect(names).toContain('COMMENTS');
    expect(out.filter((f) => f.api === 'COMMENTS')[0]!.kind).toBe('long');
  });

  /*
   * В поле Битрикса уезжает номер значения, а человеку показывается
   * подпись: «Готово» в разных списках — разные номера.
   */
  it('у списка значения номерами, а подписи рядом', () => {
    const f = bitrixOrderFields(fields).filter((x) => x.api === 'UF_CRM_TYPE')[0]!;
    expect(f.kind).toBe('pick');
    expect(f.required).toBe(true);
    expect(f.label).toBe('Тип замовлення');
    expect(f.options).toEqual(['41', '43']);
    expect(f.titles).toEqual(['Роздріб', 'Опт']);
  });

  it('свои поля компании идут после стандартных', () => {
    const out = bitrixOrderFields(fields).map((f) => f.api);
    expect(out.indexOf('COMMENTS')).toBeLessThan(out.indexOf('UF_CRM_TYPE'));
  });

  /*
   * Проверка значений общая с Zoho: окно заказа одно на все CRM, и
   * разбираться, чьё поле оно сейчас показывает, ему незачем.
   */
  it('значение списка принимается только из своего списка', () => {
    const shown = bitrixOrderFields(fields);
    const ok = orderValues(shown, { UF_CRM_TYPE: '43', COMMENTS: 'передзвонити' });
    expect(ok.values['UF_CRM_TYPE']).toBe('43');
    expect(ok.missing).toEqual([]);

    const bad = orderValues(shown, { UF_CRM_TYPE: '999' });
    expect(bad.values['UF_CRM_TYPE']).toBeUndefined();
    expect(bad.missing).toEqual(['Тип замовлення']);
  });
});

describe('сумма и позиции', () => {
  it('сумму читаем и с запятой, и с точкой', () => {
    expect(bitrixAmount('1200,50')).toBe(1200.5);
    expect(bitrixAmount('1200.5')).toBe(1200.5);
    expect(bitrixAmount(' ')).toBe(0);
    // Минус в сумме — это не сделка, а возврат, и делается он не здесь.
    expect(bitrixAmount('-100')).toBe(0);
  });

  /*
   * Скидка строки уезжает деньгами: у Битрикса в строке два вида
   * скидки, и процент там значит процент, а оператор пишет и «минус
   * двести», и «минус десять процентов».
   */
  it('строка уходит с именем товара и скидкой деньгами', () => {
    const rows = bitrixRows(
      [{ productId: '9621', quantity: 2, price: 450, discount: 50 }],
      new Map([['9621', 'Фарба біла']]),
    );
    expect(rows[0]).toMatchObject({
      productId: 9621,
      productName: 'Фарба біла',
      price: 450,
      quantity: 2,
      discountTypeId: 1,
      discountSum: 50,
    });
  });
});
