import { describe, expect, it } from 'vitest';
import {
  fillTemplate,
  parseTemplates,
  waKind,
  waMediaBody,
  waNumber,
  waTemplateBody,
  waTextBody,
} from '../src/whatsapp.js';
import { canSendFreeform, computeResponseWindow } from '../src/types.js';

/**
 * У WhatsApp почти все ошибки молчаливые: Meta отвечает «OK» на то, что
 * потом не доходит, или отказывает кодом без объяснения. Поэтому здесь
 * проверяется ровно то, на чём эти интеграции ломаются: номер, окно,
 * шаблон и подпись к вложению.
 */

describe('номер получателя', () => {
  it('плюс убирается: с ним Meta молча не доставляет', () => {
    expect(waNumber('+380 67 111-22-33')).toBe('380671112233');
  });

  it('в теле сообщения номер уже без плюса', () => {
    const body = waTextBody({ to: waNumber('+380671112233'), text: 'привіт' });
    expect(body['to']).toBe('380671112233');
  });
});

describe('текст', () => {
  it('уходит как text с разрешённым превью ссылки', () => {
    const body = waTextBody({ to: '380671112233', text: 'дивіться https://example.com' });
    expect(body['type']).toBe('text');
    expect((body['text'] as Record<string, unknown>)['preview_url']).toBe(true);
    expect(body['messaging_product']).toBe('whatsapp');
  });

  it('ответ на сообщение цитирует его через context', () => {
    const body = waTextBody({ to: '380671112233', text: 'так', replyTo: 'wamid.X' });
    expect((body['context'] as Record<string, unknown>)['message_id']).toBe('wamid.X');
  });
});

describe('вложения', () => {
  it('подпись есть у картинки', () => {
    const body = waMediaBody({ to: '3806', mediaId: 'm1', kind: 'image', caption: 'ось' });
    expect((body['image'] as Record<string, unknown>)['caption']).toBe('ось');
  });

  it('у голосового подписи нет: Meta отвечает на неё ошибкой', () => {
    const body = waMediaBody({ to: '3806', mediaId: 'm1', kind: 'audio', caption: 'ось' });
    expect((body['audio'] as Record<string, unknown>)['caption']).toBeUndefined();
  });

  it('имя файла только у документа', () => {
    const doc = waMediaBody({ to: '3806', mediaId: 'm1', kind: 'document', filename: 'act.pdf' });
    expect((doc['document'] as Record<string, unknown>)['filename']).toBe('act.pdf');

    const img = waMediaBody({ to: '3806', mediaId: 'm1', kind: 'image', filename: 'act.pdf' });
    expect((img['image'] as Record<string, unknown>)['filename']).toBeUndefined();
  });

  it('голосовое не превращается в документ', () => {
    expect(waKind('voice')).toBe('audio');
    expect(waKind('document', 'image/png')).toBe('image');
    expect(waKind('document', 'application/pdf')).toBe('document');
  });
});

describe('шаблоны', () => {
  const raw = {
    data: [
      {
        name: 'order_ready',
        language: 'uk',
        status: 'APPROVED',
        category: 'UTILITY',
        components: [{ type: 'BODY', text: 'Вітаємо, {{1}}! Замовлення {{2}} готове.' }],
      },
      {
        name: 'promo_draft',
        language: 'uk',
        status: 'PENDING',
        category: 'MARKETING',
        components: [{ type: 'BODY', text: 'Знижки!' }],
      },
    ],
  };

  it('считаются переменные, а не их повторы', () => {
    const [first] = parseTemplates(raw);
    expect(first?.variables).toBe(2);
    expect(first?.body).toContain('Замовлення');
  });

  it('неодобренные видно по статусу: отправлять их нельзя', () => {
    const list = parseTemplates(raw);
    expect(list.filter((t) => t.status === 'APPROVED')).toHaveLength(1);
  });

  it('значения подставляются по порядку', () => {
    expect(fillTemplate('Вітаємо, {{1}}! Замовлення {{2}} готове.', ['Олено', '№7'])).toBe(
      'Вітаємо, Олено! Замовлення №7 готове.',
    );
  });

  it('в теле для Meta язык и параметры лежат там, где она их ждёт', () => {
    const body = waTemplateBody({
      to: '380671112233',
      name: 'order_ready',
      language: 'uk',
      params: ['Олено', '№7'],
    });
    expect(body['type']).toBe('template');
    const t = body['template'] as Record<string, unknown>;
    expect((t['language'] as Record<string, unknown>)['code']).toBe('uk');
    const components = t['components'] as Array<Record<string, unknown>>;
    expect(components[0]?.['type']).toBe('body');
    expect((components[0]?.['parameters'] as unknown[]).length).toBe(2);
  });

  it('шаблон без переменных едет без components: пустой массив Meta отклоняет', () => {
    const body = waTemplateBody({ to: '3806', name: 'hello', language: 'uk' });
    expect((body['template'] as Record<string, unknown>)['components']).toBeUndefined();
  });
});

describe('окно ответа', () => {
  it('сутки от сообщения клиента, дальше только шаблон', () => {
    const at = new Date('2026-09-23T07:00:00.000Z');
    const w = computeResponseWindow('whatsapp', at);

    const inside = canSendFreeform('whatsapp', w, new Date('2026-09-23T20:00:00.000Z'));
    expect(inside.allowed).toBe(true);

    const outside = canSendFreeform('whatsapp', w, new Date('2026-09-25T07:00:00.000Z'));
    expect(outside.allowed).toBe(false);
    if (!outside.allowed) expect(outside.requiresTemplate).toBe(true);
  });
});
