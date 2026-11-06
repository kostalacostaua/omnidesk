import { describe, expect, it } from 'vitest';
import { buildTemplate } from '../src/whatsapp.js';

/**
 * Проверка заявки на шаблон WhatsApp.
 *
 * Всё, что здесь проверяется, Meta отклоняет одной и той же фразой
 * «Invalid parameter» — и на дефис в имени, и на переменную в конце
 * текста, и на недостающий пример. Поэтому каждое правило проверяется
 * у себя и зовётся своим именем: иначе человек пробует наугад и
 * бросает.
 */

const ok = {
  name: 'order_status_update',
  language: 'uk',
  category: 'UTILITY',
  body: 'Вітаємо, {{1}}! Ваше замовлення {{2}} вже в дорозі.',
  examples: ['Анна', 'A-1043'],
};

describe('заявка на шаблон WhatsApp', () => {
  it('собирает то, что ждёт Meta', () => {
    const p = buildTemplate(ok);

    expect(p.name).toBe('order_status_update');
    expect(p.category).toBe('UTILITY');
    expect(p.components).toHaveLength(1);

    const body = p.components[0] as { type: string; text: string; example?: unknown };
    expect(body.type).toBe('BODY');
    expect(body.text).toBe(ok.body);
    // Примеры — список наборов значений, а не один набор: у Meta так.
    expect(body.example).toEqual({ body_text: [['Анна', 'A-1043']] });
  });

  it('имя приводится к нижнему регистру', () => {
    expect(buildTemplate({ ...ok, name: 'Order_Status' }).name).toBe('order_status');
  });

  it('дефис и пробел в имени отклоняются', () => {
    expect(() => buildTemplate({ ...ok, name: 'order-status' })).toThrow('template_name_bad');
    expect(() => buildTemplate({ ...ok, name: 'order status' })).toThrow('template_name_bad');
  });

  it('чужая категория отклоняется', () => {
    expect(() => buildTemplate({ ...ok, category: 'PROMO' })).toThrow('template_category_bad');
  });

  it('дырка в нумерации переменных отклоняется', () => {
    // {{1}} и {{3}} без {{2}}: подстановка идёт по порядку, и
    // пропущенный номер сдвинул бы все значения.
    expect(() =>
      buildTemplate({
        ...ok,
        body: 'Вітаємо, {{1}}! Замовлення {{3}} в дорозі.',
        examples: ['Анна', 'A-1043'],
      }),
    ).toThrow('template_vars_gap');
  });

  it('переменная в начале и в конце текста отклоняется', () => {
    expect(() =>
      buildTemplate({ ...ok, body: '{{1}}, ваше замовлення готове.', examples: ['Анна'] }),
    ).toThrow('template_var_first');
    expect(() =>
      buildTemplate({ ...ok, body: 'Ваше замовлення {{1}}', examples: ['A-1043'] }),
    ).toThrow('template_var_last');
  });

  it('без примеров заявка не уходит', () => {
    expect(() => buildTemplate({ ...ok, examples: ['Анна'] })).toThrow(
      'template_examples_required',
    );
    expect(() => buildTemplate({ ...ok, examples: ['Анна', '  '] })).toThrow(
      'template_examples_required',
    );
  });

  it('текст без переменных примеров не требует', () => {
    const p = buildTemplate({
      ...ok,
      body: 'Дякуємо за замовлення! Ми вже збираємо його.',
      examples: [],
    });
    const body = p.components[0] as { example?: unknown };
    // Поля example нет вовсе: пустое Meta не принимает.
    expect(body.example).toBeUndefined();
  });

  it('пустой текст и слишком длинный отклоняются', () => {
    expect(() => buildTemplate({ ...ok, body: '   ', examples: [] })).toThrow(
      'template_body_required',
    );
    expect(() =>
      buildTemplate({ ...ok, body: 'а'.repeat(1025), examples: [] }),
    ).toThrow('template_body_long');
  });

  it('одна переменная дважды — это одна переменная', () => {
    const p = buildTemplate({
      ...ok,
      body: 'Вітаємо, {{1}}! Ще раз вітаємо, {{1}}, ваше замовлення готове.',
      examples: ['Анна'],
    });
    const body = p.components[0] as { example?: { body_text: string[][] } };
    expect(body.example?.body_text[0]).toEqual(['Анна']);
  });
});
