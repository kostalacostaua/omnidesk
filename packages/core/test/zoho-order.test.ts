import { describe, expect, it } from 'vitest';
import {
  catalogItem,
  catalogPage,
  orderFields,
  orderValues,
  sortCatalog,
} from '../src/zoho-order.js';

/**
 * Проверки на образцах ответа Zoho. Живая CRM отвечает по-разному у
 * каждого клиента, и разбор чужого ответа — ровно то место, где мы уже
 * ошиблись однажды, угадав имена полей конвертации.
 */
describe('каталог товаров', () => {
  it('берёт название, артикул и цену', () => {
    expect(
      catalogItem({
        id: '1024137000035715114',
        Product_Name: 'CHICK-FIL-BQF-10KG',
        Product_Code: 'CF-10',
        Unit_Price: 129.9,
        Product_Active: true,
      }),
    ).toEqual({
      id: '1024137000035715114',
      name: 'CHICK-FIL-BQF-10KG',
      code: 'CF-10',
      price: 129.9,
      active: true,
    });
  });

  it('цена строкой с запятой — это цена', () => {
    expect(catalogItem({ id: '1', Product_Name: 'x', Unit_Price: '12,50' })?.price).toBe(12.5);
  });

  it('без цены товар всё равно виден: цену впишет оператор', () => {
    const item = catalogItem({ id: '1', Product_Name: 'x', Unit_Price: null });
    expect(item?.price).toBe(0);
  });

  it('товар без названия и артикула выбрасывается', () => {
    expect(catalogItem({ id: '1', Product_Name: '   ' })).toBeNull();
  });

  it('чужой идентификатор не пропускаем', () => {
    expect(catalogItem({ id: 'javascript:1', Product_Name: 'x' })).toBeNull();
  });

  it('признак неактивного товара доезжает, а его отсутствие — нет', () => {
    expect(catalogItem({ id: '1', Product_Name: 'x', Product_Active: false })?.active).toBe(false);
    expect(catalogItem({ id: '1', Product_Name: 'x' })?.active).toBe(true);
  });

  it('страница отдаёт признак «есть ещё»', () => {
    const page = catalogPage({
      data: [{ id: '1', Product_Name: 'a' }, { id: 'нет', Product_Name: 'b' }],
      info: { more_records: true },
    });
    expect(page.items).toHaveLength(1);
    expect(page.more).toBe(true);
  });

  it('пустой ответ — это пустой каталог, а не сбой', () => {
    expect(catalogPage({})).toEqual({ items: [], more: false });
  });

  it('порядок по названию и по числам в нём', () => {
    const items = sortCatalog([
      catalogItem({ id: '1', Product_Name: 'Товар 10' })!,
      catalogItem({ id: '2', Product_Name: 'Товар 2' })!,
      catalogItem({ id: '3', Product_Name: 'Абрикос' })!,
    ]);
    expect(items.map((i) => i.name)).toEqual(['Абрикос', 'Товар 2', 'Товар 10']);
  });
});

/** Ответ settings/fields, урезанный до того, что мы читаем. */
const FIELDS = {
  fields: [
    { api_name: 'Subject', field_label: 'Тема', data_type: 'text', system_mandatory: true },
    { api_name: 'Product_Details', field_label: 'Товары', data_type: 'subform' },
    { api_name: 'Grand_Total', field_label: 'Итого', data_type: 'currency', read_only: true },
    { api_name: 'Owner', field_label: 'Владелец', data_type: 'ownerlookup' },
    {
      api_name: 'Status',
      field_label: 'Статус',
      data_type: 'picklist',
      system_mandatory: true,
      pick_list_values: [
        { actual_value: '-None-', display_value: '-None-' },
        { actual_value: 'Created', display_value: 'Создан' },
        { actual_value: 'Delivered', display_value: 'Доставлен' },
      ],
    },
    { api_name: 'Due_Date', field_label: 'Срок', data_type: 'date' },
    { api_name: 'Discount', field_label: 'Скидка', data_type: 'double' },
    { api_name: 'Description', field_label: 'Описание', data_type: 'textarea', length: 32000 },
    { api_name: 'Carrier', field_label: 'Перевозчик', data_type: 'picklist', pick_list_values: [] },
    { api_name: 'Paid', field_label: 'Оплачен', data_type: 'boolean' },
    {
      api_name: 'Hidden',
      field_label: 'Скрытое',
      data_type: 'text',
      view_type: { create: false, edit: true, view: true },
    },
  ],
};

describe('поля заказа', () => {
  const fields = orderFields(FIELDS);
  const names = fields.map((f) => f.api);

  it('наши поля в форму не попадают', () => {
    expect(names).not.toContain('Subject');
    expect(names).not.toContain('Product_Details');
  });

  it('вычисляемое и нередактируемое не показываем', () => {
    expect(names).not.toContain('Grand_Total');
    expect(names).not.toContain('Hidden');
  });

  it('ссылки на чужие записи в форме заказа бессмысленны', () => {
    expect(names).not.toContain('Owner');
  });

  it('список без вариантов — не список', () => {
    expect(names).not.toContain('Carrier');
  });

  it('обязательные идут первыми', () => {
    expect(fields[0].api).toBe('Status');
    expect(fields[0].required).toBe(true);
  });

  it('«-None-» — это отсутствие значения, а не значение', () => {
    expect(fields[0].options).toEqual(['Created', 'Delivered']);
  });

  it('типы приводятся к тому, что умеет форма', () => {
    const by = (api: string) => fields.filter((f) => f.api === api)[0];
    expect(by('Due_Date').kind).toBe('date');
    expect(by('Discount').kind).toBe('num');
    expect(by('Description').kind).toBe('long');
    expect(by('Paid').kind).toBe('bool');
  });
});

describe('значения полей', () => {
  const fields = orderFields(FIELDS);

  it('берём только то, что назвала сама Zoho', () => {
    const got = orderValues(fields, { Status: 'Created', Whatever: 'да' });
    expect(got.values).toEqual({ Status: 'Created' });
  });

  it('вариант не из списка не пропускаем', () => {
    const got = orderValues(fields, { Status: 'Придумал' });
    expect(got.values.Status).toBeUndefined();
    expect(got.missing).toEqual(['Статус']);
  });

  it('пустое обязательное поле названо подписью, а не именем в API', () => {
    expect(orderValues(fields, {}).missing).toEqual(['Статус']);
  });

  it('число с запятой — число', () => {
    expect(orderValues(fields, { Status: 'Created', Discount: '2,5' }).values.Discount).toBe(2.5);
  });

  it('дата принимается только в виде, который понимает Zoho', () => {
    expect(orderValues(fields, { Status: 'Created', Due_Date: '25.09.2026' }).values.Due_Date)
      .toBeUndefined();
    expect(orderValues(fields, { Status: 'Created', Due_Date: '2026-09-25' }).values.Due_Date)
      .toBe('2026-09-25');
  });

  it('галочка доезжает и снятой', () => {
    expect(orderValues(fields, { Status: 'Created', Paid: false }).values.Paid).toBe(false);
    expect(orderValues(fields, { Status: 'Created' }).values.Paid).toBeUndefined();
  });

  it('длинный текст обрезается по объявленной длине', () => {
    const long = 'я'.repeat(5000);
    const got = orderValues(fields, { Status: 'Created', Description: long });
    expect(String(got.values.Description)).toHaveLength(2000);
  });
});
