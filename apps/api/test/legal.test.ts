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
