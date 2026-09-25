import { describe, expect, it } from 'vitest';
import {
  ORDER_SETTINGS_DEFAULT,
  orderReady,
  parseOrderSettings,
  pipelineFields,
} from '../src/order-settings.js';
import { guessColumns, pipelines, subformColumns, subforms } from '../src/zoho-order.js';

describe('настройки заказа', () => {
  it('пустая настройка — это прежнее поведение', () => {
    expect(parseOrderSettings(null)).toEqual(ORDER_SETTINGS_DEFAULT);
  });

  it('чужой модуль не принимаем', () => {
    expect(parseOrderSettings({ module: 'Invoices' }).module).toBe('Sales_Orders');
  });

  it('имя поля из браузера проверяется: туда приходит что угодно', () => {
    const s = parseOrderSettings({ fields: ['Status', 'ok; drop table', '', 'Status'] });
    expect(s.fields).toEqual(['Status']);
  });

  it('воронка без идентификатора Zoho выбрасывается', () => {
    const s = parseOrderSettings({
      pipelines: [
        { id: '123', name: 'Роздріб', layout: '77', stage: 'Draft', fields: ['Amount'] },
        { id: 'нет', stage: 'Draft' },
      ],
    });
    expect(s.pipelines).toHaveLength(1);
    expect(s.pipelines[0].stage).toBe('Draft');
  });

  it('одна воронка дважды — это одна воронка', () => {
    const s = parseOrderSettings({
      pipelines: [{ id: '1' }, { id: '1' }],
    });
    expect(s.pipelines).toHaveLength(1);
  });

  it('старая настройка без галочки означает «поля одинаковые»', () => {
    expect(parseOrderSettings({ module: 'Deals' }).sameFields).toBe(true);
  });

  it('таблица товаров без имени откатывается к стандартной', () => {
    expect(parseOrderSettings({ subform: { api: '' } }).subform.api).toBe('Ordered_Items');
  });

  /*
   * Во втором поколении API таблица товаров называлась Product_Details
   * и колонки в ней были другие. Записанная тогда настройка означает
   * заказ, который Zoho не примет, — читаем её как «не настроено».
   */
  it('настройка под старое имя таблицы читается как ненастроенная', () => {
    const s = parseOrderSettings({
      subform: { api: 'Product_Details', product: 'product', quantity: 'quantity' },
    });
    expect(s.subform).toEqual({
      api: 'Ordered_Items',
      product: 'Product_Name',
      quantity: 'Quantity',
      price: 'List_Price',
      discount: 'Discount',
    });
  });
});

describe('поля выбранной воронки', () => {
  const base = parseOrderSettings({
    module: 'Deals',
    sameFields: false,
    fields: ['Description'],
    pipelines: [
      { id: '1', stage: 'A', fields: ['Amount'] },
      { id: '2', stage: 'B', fields: ['Closing_Date'] },
    ],
  });

  it('у каждой воронки свои', () => {
    expect(pipelineFields(base, '1')).toEqual(['Amount']);
    expect(pipelineFields(base, '2')).toEqual(['Closing_Date']);
  });

  it('галочка «одинаковые» перекрывает набор каждой', () => {
    expect(pipelineFields({ ...base, sameFields: true }, '1')).toEqual(['Description']);
  });

  it('незнакомая воронка получает общий набор, а не чужой', () => {
    expect(pipelineFields(base, '99')).toEqual(['Description']);
  });

  it('в заказах воронок нет вовсе', () => {
    const s = parseOrderSettings({ module: 'Sales_Orders', fields: ['Status'] });
    expect(pipelineFields(s, null)).toEqual(['Status']);
  });
});

describe('готовность настройки', () => {
  it('заказ готов по умолчанию: стандартная таблица известна', () => {
    expect(orderReady(ORDER_SETTINGS_DEFAULT)).toBe(true);
  });

  it('сделка без воронок не готова', () => {
    expect(orderReady(parseOrderSettings({ module: 'Deals' }))).toBe(false);
  });

  it('воронка без стадии не готова: стадия у сделки обязательна', () => {
    const s = parseOrderSettings({
      module: 'Deals',
      pipelines: [{ id: '1', stage: '' }],
      subform: { api: 'Items', product: 'Tovar', quantity: 'Kilkist', price: 'Cina' },
    });
    expect(orderReady(s)).toBe(false);
  });

  it('подформа без колонки товара не готова', () => {
    const s = parseOrderSettings({
      module: 'Deals',
      pipelines: [{ id: '1', stage: 'A' }],
      subform: { api: 'Items', product: '', quantity: 'Kilkist', price: 'Cina' },
    });
    expect(orderReady(s)).toBe(false);
  });
});

/** Ответы Zoho, урезанные до того, что мы читаем. */
const DEAL_FIELDS = {
  fields: [
    { api_name: 'Deal_Name', field_label: 'Угода', data_type: 'text', system_mandatory: true },
    { api_name: 'Stage', field_label: 'Стадія', data_type: 'picklist', system_mandatory: true,
      pick_list_values: [{ actual_value: 'Draft', display_value: 'Чернетка' }] },
    { api_name: 'Amount', field_label: 'Сума', data_type: 'currency' },
    { api_name: 'Promotion', field_label: 'Позиції', data_type: 'subform',
      subform: { module: 'Deals_X_Promotion', id: '1' } },
  ],
};

describe('разметка сделки', () => {
  it('воронку, стадию и макет у оператора не спрашиваем', () => {
    const names = subforms(DEAL_FIELDS).map((s) => s.api);
    expect(names).toEqual(['Promotion']);
  });

  it('подформа приносит модуль своих колонок', () => {
    expect(subforms(DEAL_FIELDS)[0]).toEqual({
      api: 'Promotion',
      label: 'Позиції',
      module: 'Deals_X_Promotion',
    });
  });

  it('колонки подформы читаются вместе со ссылкой на товары', () => {
    const cols = subformColumns({
      fields: [
        { api_name: 'Tovar', field_label: 'Товар', data_type: 'lookup',
          lookup: { module: { api_name: 'Products' } } },
        { api_name: 'Kilkist', field_label: 'Кількість', data_type: 'double' },
        { api_name: 'Suma', field_label: 'Сума', data_type: 'currency', read_only: true },
      ],
    });
    expect(cols.map((c) => c.api)).toEqual(['Tovar', 'Kilkist']);
    expect(cols[0].lookup).toBe('Products');
  });

  it('товар угадывается по ссылке, а не по названию колонки', () => {
    const guess = guessColumns([
      { api: 'Poz', label: 'Позиція', lookup: 'Products' },
      { api: 'Kilkist', label: 'Кількість', lookup: '' },
      { api: 'Cina', label: 'Ціна за одиницю', lookup: '' },
    ]);
    expect(guess).toEqual({ product: 'Poz', quantity: 'Kilkist', price: 'Cina', discount: '' });
  });

  it('одна колонка не достаётся двум ролям', () => {
    const guess = guessColumns([
      { api: 'Product_Price', label: 'Товар і ціна', lookup: '' },
    ]);
    expect(guess.product).toBe('Product_Price');
    expect(guess.price).toBe('');
  });

  it('двусмысленная колонка достаётся роли, для которой нет однозначной', () => {
    const guess = guessColumns([
      { api: 'Tovar', label: 'Товар', lookup: 'Products' },
      { api: 'Cina_zi_znyzhkoyu', label: 'Ціна зі знижкою', lookup: '' },
      { api: 'Znyzhka', label: 'Знижка', lookup: '' },
    ]);
    expect(guess.discount).toBe('Znyzhka');
    expect(guess.price).toBe('Cina_zi_znyzhkoyu');
  });
});

const PIPES = {
  pipeline: [
    {
      id: '1024137000001324082',
      display_value: 'Orders',
      actual_value: 'Standard (Retail)',
      maps: [
        { actual_value: 'Draft', display_value: 'Чернетка' },
        { actual_value: 'Closed Won', display_value: 'Виграно' },
      ],
    },
    { id: 'нет', maps: [{ actual_value: 'X' }] },
    { id: '9', display_value: 'Пуста', maps: [] },
  ],
};

describe('воронки', () => {
  const list = pipelines(PIPES, '77', 'Retail');

  it('берём только воронки со стадиями и с настоящим идентификатором', () => {
    expect(list).toHaveLength(1);
  });

  it('человеку показываем то имя, которое он видит в Zoho', () => {
    expect(list[0].name).toBe('Orders');
    expect(list[0].layoutName).toBe('Retail');
  });

  it('стадии приходят вместе с воронкой: сами по себе они не существуют', () => {
    expect(list[0].stages).toEqual([
      { value: 'Draft', label: 'Чернетка' },
      { value: 'Closed Won', label: 'Виграно' },
    ]);
  });
});
