import { describe, expect, it, vi } from 'vitest';
import {
  AiError,
  askModel,
  buildMessages,
  completionsUrl,
  explainStatus,
  needsHuman,
  readCompletion,
} from '../src/ai.js';

/**
 * Разговор с моделью проверяется без сети: важна не доставка байтов, а
 * то, что уходит в запросе и что из ответа считается ответом. Ошибка
 * здесь — это либо выдуманная моделью цена в переписке с клиентом,
 * либо «ИИ не отвечает» без единой подсказки, почему.
 */

const CFG = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-test',
  model: 'gpt-4o-mini',
  systemPrompt: 'Продаём сумки. Доставка Новой почтой.',
  maxTokens: 300,
};

function answer(text: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: text } }] }),
  };
}

describe('подготовка разговора', () => {
  it('правила идут первыми, а рассказ о компании — внутри них', () => {
    const msgs = buildMessages(CFG, [{ fromClient: true, text: 'Привет' }]);
    expect(msgs[0]?.role).toBe('system');
    expect(msgs[0]?.content).toContain('Не выдумывай цены');
    expect(msgs[0]?.content).toContain('Продаём сумки');
  });

  it('клиент — это user, наша сторона — assistant', () => {
    const msgs = buildMessages(CFG, [
      { fromClient: true, text: 'Є в наявності?' },
      { fromClient: false, text: 'Так, є' },
    ]);
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user', 'assistant']);
  });

  it('пустые сообщения выбрасываются: они стоят денег и ничего не значат', () => {
    const msgs = buildMessages(CFG, [
      { fromClient: true, text: '  ' },
      { fromClient: true, text: 'Привет' },
    ]);
    expect(msgs).toHaveLength(2);
  });

  it('без рассказа о компании правила всё равно на месте', () => {
    const msgs = buildMessages({ systemPrompt: '' }, []);
    expect(msgs[0]?.content).toContain('оператор поддержки');
    expect(msgs[0]?.content).not.toContain('О компании');
  });
});

describe('адрес провайдера', () => {
  it('к корню дописывается путь, слеш на конце не мешает', () => {
    expect(completionsUrl('https://api.openai.com/v1')).toBe('https://api.openai.com/v1/chat/completions');
    expect(completionsUrl('https://api.openai.com/v1/')).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('полный адрес не удваивается', () => {
    expect(completionsUrl('https://x.dev/v1/chat/completions')).toBe('https://x.dev/v1/chat/completions');
  });

  it('адрес без схемы отвергается до запроса', () => {
    expect(() => completionsUrl('api.openai.com')).toThrow(AiError);
  });
});

describe('ответ провайдера', () => {
  it('берётся текст первого варианта', () => {
    expect(readCompletion({ choices: [{ message: { content: ' Готово ' } }] })).toBe('Готово');
  });

  it('пустой ответ — ошибка, а не пустое сообщение клиенту', () => {
    expect(() => readCompletion({ choices: [{ message: { content: '' } }] })).toThrow(AiError);
    expect(() => readCompletion({})).toThrow(AiError);
  });

  it('у отказов человеческая причина', () => {
    expect(explainStatus(401).code).toBe('bad_key');
    expect(explainStatus(404).code).toBe('bad_model');
    expect(explainStatus(429).code).toBe('rate_limit');
    expect(explainStatus(503).code).toBe('provider_down');
  });
});

describe('запрос к модели', () => {
  it('ключ уходит заголовком, а модель и предел — телом', async () => {
    const fetchImpl = vi.fn(async () => answer('Так, є дві'));
    const text = await askModel(CFG, [{ fromClient: true, text: 'Є сумки?' }], { fetchImpl });

    expect(text).toBe('Так, є дві');
    const [url, init] = fetchImpl.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.max_tokens).toBe(300);
  });

  it('отказ провайдера становится понятной ошибкой', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }));
    await expect(askModel(CFG, [{ fromClient: true, text: 'Привет' }], { fetchImpl }))
      .rejects.toMatchObject({ code: 'bad_key' });
  });

  it('обрыв сети не роняет воркер необработанным исключением', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('socket hang up') });
    await expect(askModel(CFG, [{ fromClient: true, text: 'Привет' }], { fetchImpl }))
      .rejects.toMatchObject({ code: 'network' });
  });
});

describe('когда нужен человек', () => {
  it('деньги, возврат и жалоба — всегда к оператору', () => {
    expect(needsHuman('хочу возврат денег')).toBe(true);
    expect(needsHuman('Дайте оператора')).toBe(true);
    expect(needsHuman('це вже скарга')).toBe(true);
  });

  it('обычный вопрос ИИ отвечает сам', () => {
    expect(needsHuman('А доставка есть?')).toBe(false);
    expect(needsHuman('')).toBe(false);
  });
});
