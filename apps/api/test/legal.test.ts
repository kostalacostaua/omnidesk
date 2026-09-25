import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { parseSignedRequest } from '../src/legal.js';

const SECRET = 'app-secret-123';

function sign(payload: unknown, secret = SECRET): string {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(data).digest('base64url');
  return `${sig}.${data}`;
}

describe('signed_request от Meta', () => {
  it('принимает запрос, подписанный нашим секретом', () => {
    const r = parseSignedRequest(sign({ algorithm: 'HMAC-SHA256', user_id: '1234' }), SECRET);
    expect(r?.user_id).toBe('1234');
  });

  it('отклоняет чужую подпись', () => {
    expect(parseSignedRequest(sign({ user_id: '1234' }, 'другой секрет'), SECRET)).toBeNull();
  });

  it('отклоняет подделку данных при прежней подписи', () => {
    const [sig] = sign({ user_id: '1234' }).split('.');
    const fake = Buffer.from(JSON.stringify({ user_id: '9999' })).toString('base64url');
    expect(parseSignedRequest(`${sig}.${fake}`, SECRET)).toBeNull();
  });

  it('отклоняет мусор и неизвестный алгоритм', () => {
    expect(parseSignedRequest('не подпись', SECRET)).toBeNull();
    expect(parseSignedRequest(sign({ algorithm: 'RSA', user_id: '1' }), SECRET)).toBeNull();
  });
});

/*
 * Страницы условий и возвратов. Их спрашивает Paddle при подключении
 * оплаты, и проверяем мы не текст, а то, что они вообще отдаются и
 * что внутри есть то, за чем на них приходят: срок возврата, кто
 * продавец записи и как продлевается подписка.
 */
describe('условия и возвраты', () => {
  const build = async () => {
    const Fastify = (await import('fastify')).default;
    const { registerLegal } = await import('../src/legal.js');
    const app = Fastify();
    registerLegal(app, {
      contactEmail: 'support@rozmovio.com',
      operator: 'KL Systems',
      pool: { query: async () => ({ rows: [] }) } as never,
      appUrl: 'https://app.rozmovio.com',
      metaAppSecret: 'x',
    });
    return app;
  };

  it('условия отдаются и называют Paddle продавцом записи', async () => {
    const app = await build();
    const r = await app.inject({ method: 'GET', url: '/terms' });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('merchant of record');
    expect(r.body).toContain('renew automatically');
    await app.close();
  });

  it('возвраты называют срок и способ обращения', async () => {
    const app = await build();
    const r = await app.inject({ method: 'GET', url: '/refunds' });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('14 days');
    expect(r.body).toContain('support@rozmovio.com');
    await app.close();
  });

  it('привычные адреса ведут туда же, а не в никуда', async () => {
    const app = await build();
    for (const url of ['/terms-of-service', '/refund-policy']) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(200);
    }
    await app.close();
  });
});
