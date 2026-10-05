import { describe, expect, it } from 'vitest';
import { zohoBody } from '../src/zoho-http.js';
import { catalogPage, orderFields, pipelines, subforms } from '../src/zoho-order.js';

/**
 * Пустой ответ Zoho.
 *
 * 204 у неё значит «нечего отдавать»: полей нет, воронок у макета нет,
 * товаров с такими номерами больше нет. Тела у такого ответа нет, и
 * JSON.parse на нём бросает «Unexpected end of JSON input» — ошибка
 * вылетала из обработчика, и вместо пустого списка человек получал
 * 500 на разметке заказа.
 */
describe('тело ответа Zoho', () => {
  it('204 читается как пустой объект', async () => {
    expect(await zohoBody(new Response(null, { status: 204 }))).toEqual({});
  });

  /* 200 с пустым телом Zoho тоже присылает — ведёт себя как 204. */
  it('пустое тело при 200 не роняет разбор', async () => {
    expect(await zohoBody(new Response('', { status: 200 }))).toEqual({});
    expect(await zohoBody(new Response('   \n', { status: 200 }))).toEqual({});
  });

  it('обычный ответ разбирается как раньше', async () => {
    const res = new Response(JSON.stringify({ fields: [{ api_name: 'Subject' }] }), {
      status: 200,
    });
    expect(await zohoBody(res)).toEqual({ fields: [{ api_name: 'Subject' }] });
  });

  /* Непонятное тело — тоже пусто: ни полей, ни воронок вызывающий из
     него всё равно не достанет, а 500 на этом месте бесполезен. */
  it('мусор вместо JSON не бросает', async () => {
    expect(await zohoBody(new Response('<html>oops</html>', { status: 200 }))).toEqual({});
  });

  it('ответ об ошибке читается, а не теряется', async () => {
    const res = new Response(JSON.stringify({ code: 'OAUTH_SCOPE_MISMATCH' }), { status: 401 });
    expect(await zohoBody(res)).toEqual({ code: 'OAUTH_SCOPE_MISMATCH' });
  });
});

/*
 * Пустое тело должно доезжать до разборщиков без сюрпризов: если
 * какой-то из них на нём бросит, 500 просто переедет на строку ниже.
 */
describe('разборщики переживают пустое тело', () => {
  it('поля, подформы, воронки и каталог дают пустые списки', async () => {
    const empty = await zohoBody(new Response(null, { status: 204 }));
    expect(orderFields(empty)).toEqual([]);
    expect(subforms(empty)).toEqual([]);
    expect(pipelines(empty, '1', 'Макет')).toEqual([]);
    expect(catalogPage(empty)).toEqual({ items: [], more: false });
  });
});
