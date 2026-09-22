import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  safeEqual,
  verifyMetaSignature,
  verifyMetaSubscription,
  verifyTelegramSecret,
  verifyZohoWidgetSignature,
} from '../src/signatures.js';

const APP_SECRET = 'test-app-secret-do-not-use-in-prod';

function signMeta(body: Buffer, secret = APP_SECRET): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

describe('verifyMetaSignature', () => {
  const body = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [] }));

  it('принимает корректную подпись', () => {
    expect(verifyMetaSignature(body, signMeta(body), APP_SECRET)).toBe(true);
  });

  it('отклоняет подпись, посчитанную другим секретом', () => {
    expect(verifyMetaSignature(body, signMeta(body, 'wrong-secret'), APP_SECRET)).toBe(false);
  });

  it('отклоняет подпись при изменении хотя бы одного байта тела', () => {
    const sig = signMeta(body);
    const tampered = Buffer.from(body.toString().replace('entry', 'entrY'));
    expect(verifyMetaSignature(tampered, sig, APP_SECRET)).toBe(false);
  });

  it('отклоняет отсутствующий заголовок', () => {
    expect(verifyMetaSignature(body, undefined, APP_SECRET)).toBe(false);
  });

  it('отклоняет пустой секрет приложения', () => {
    expect(verifyMetaSignature(body, signMeta(body), '')).toBe(false);
  });

  it('отклоняет подпись без префикса sha256=', () => {
    const hex = createHmac('sha256', APP_SECRET).update(body).digest('hex');
    expect(verifyMetaSignature(body, hex, APP_SECRET)).toBe(false);
  });

  it('ключевое: пересериализация JSON ломает подпись — считать надо от сырого тела', () => {
    const sig = signMeta(body);
    const reserialized = Buffer.from(JSON.stringify(JSON.parse(body.toString()), null, 2));
    expect(verifyMetaSignature(reserialized, sig, APP_SECRET)).toBe(false);
  });
});

describe('verifyTelegramSecret', () => {
  it('принимает совпадающий secret_token', () => {
    expect(verifyTelegramSecret('abc123', 'abc123')).toBe(true);
  });

  it('отклоняет несовпадающий', () => {
    expect(verifyTelegramSecret('abc124', 'abc123')).toBe(false);
  });

  it('отклоняет отсутствующий заголовок', () => {
    expect(verifyTelegramSecret(undefined, 'abc123')).toBe(false);
  });

  it('отклоняет пустой ожидаемый секрет — иначе вебхук открыт всем', () => {
    expect(verifyTelegramSecret('', '')).toBe(false);
    expect(verifyTelegramSecret('anything', '')).toBe(false);
  });
});

describe('safeEqual', () => {
  it('строки разной длины не равны и не бросают исключение', () => {
    expect(safeEqual('a', 'aa')).toBe(false);
    expect(safeEqual('', 'x')).toBe(false);
  });

  it('одинаковые строки равны', () => {
    expect(safeEqual('одинаково', 'одинаково')).toBe(true);
  });
});

describe('verifyMetaSubscription', () => {
  const TOKEN = 'my-verify-token';

  it('возвращает challenge при корректном токене', () => {
    expect(
      verifyMetaSubscription(
        { 'hub.mode': 'subscribe', 'hub.verify_token': TOKEN, 'hub.challenge': '12345' },
        TOKEN,
      ),
    ).toBe('12345');
  });

  it('отклоняет неверный токен', () => {
    expect(
      verifyMetaSubscription(
        { 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': '12345' },
        TOKEN,
      ),
    ).toBeNull();
  });

  it('отклоняет неверный режим', () => {
    expect(
      verifyMetaSubscription(
        { 'hub.mode': 'unsubscribe', 'hub.verify_token': TOKEN, 'hub.challenge': '1' },
        TOKEN,
      ),
    ).toBeNull();
  });
});

describe('verifyZohoWidgetSignature — контур идентичности виджета', () => {
  const SECRET = 'shared-secret-between-deluge-and-api';
  const NOW = 1_754_000_000;

  function make(payloadObj: Record<string, unknown>, secret = SECRET) {
    const payload = JSON.stringify(payloadObj);
    const sig = createHmac('sha256', secret).update(payload).digest('hex');
    return { payload, sig };
  }

  it('принимает корректно подписанный свежий payload', () => {
    const { payload, sig } = make({ zuid: '123', org: '456', ts: NOW });
    expect(verifyZohoWidgetSignature(payload, sig, SECRET, { timestamp: NOW, now: NOW }).ok).toBe(true);
  });

  it('отклоняет подпись чужим секретом', () => {
    const { payload, sig } = make({ zuid: '123', org: '456', ts: NOW }, 'attacker-secret');
    const r = verifyZohoWidgetSignature(payload, sig, SECRET, { timestamp: NOW, now: NOW });
    expect(r).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('отклоняет подмену zuid при сохранённой старой подписи — защита от эскалации', () => {
    const { sig } = make({ zuid: '123', org: '456', ts: NOW });
    const tamperedPayload = JSON.stringify({ zuid: '999', org: '456', ts: NOW });
    const r = verifyZohoWidgetSignature(tamperedPayload, sig, SECRET, { timestamp: NOW, now: NOW });
    expect(r).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('отклоняет устаревший payload — защита от replay', () => {
    const stale = NOW - 3600;
    const { payload, sig } = make({ zuid: '123', org: '456', ts: stale });
    const r = verifyZohoWidgetSignature(payload, sig, SECRET, { timestamp: stale, now: NOW });
    expect(r).toEqual({ ok: false, reason: 'stale_timestamp' });
  });

  it('отклоняет payload из будущего', () => {
    const future = NOW + 3600;
    const { payload, sig } = make({ zuid: '123', org: '456', ts: future });
    const r = verifyZohoWidgetSignature(payload, sig, SECRET, { timestamp: future, now: NOW });
    expect(r).toEqual({ ok: false, reason: 'stale_timestamp' });
  });

  it('отклоняет отсутствующую подпись', () => {
    const { payload } = make({ zuid: '123' });
    expect(verifyZohoWidgetSignature(payload, undefined, SECRET)).toEqual({
      ok: false,
      reason: 'missing_signature',
    });
  });

  it('отклоняет незаданный общий секрет', () => {
    const { payload, sig } = make({ zuid: '123' });
    expect(verifyZohoWidgetSignature(payload, sig, '')).toEqual({
      ok: false,
      reason: 'missing_secret',
    });
  });
});
