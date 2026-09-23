import { describe, expect, it, vi } from 'vitest';
import {
  CrmError,
  bitrixFindOrCreate,
  bitrixPortal,
  bitrixRoot,
  crmPing,
  digits,
  pipedriveAuthorizeUrl,
  pipedriveExchange,
  pipedriveFindOrCreate,
  pipedrivePhone,
  pipedriveRoot,
} from '../src/crm-simple.js';

/**
 * Проверяется то, что ломается в чужих CRM чаще всего: адрес, ключ и
 * дубликаты. Ошибка здесь не падает исключением, а тихо плодит вторую
 * карточку на того же клиента — менеджер звонит по старой, клиент ждёт
 * ответа во второй.
 */

function ok(data: unknown) {
  return { ok: true, status: 200, json: async () => data };
}

describe('Битрикс24: адрес вебхука', () => {
  const WH = 'https://kl.bitrix24.ua/rest/1/abc123xyz/';

  it('корень берётся из адреса, метод дописывается сам', () => {
    expect(bitrixRoot(WH)).toBe('https://kl.bitrix24.ua/rest/1/abc123xyz');
    expect(bitrixRoot(WH + 'crm.lead.add.json')).toBe('https://kl.bitrix24.ua/rest/1/abc123xyz');
  });

  it('коробка на своём домене подключается так же, как облако', () => {
    expect(bitrixPortal('https://crm.zavod.local/rest/12/key123/')).toBe('https://crm.zavod.local');
  });

  it('чужой адрес отвергается с понятной причиной, а не ошибкой сети', () => {
    expect(() => bitrixRoot('https://kl.bitrix24.ua/')).toThrow(CrmError);
    expect(() => bitrixRoot('')).toThrow(CrmError);
  });
});

describe('Битрикс24: поиск и создание', () => {
  const WH = 'https://kl.bitrix24.ua/rest/1/abc123xyz/';

  it('найденный контакт не превращается в новый лид', async () => {
    const fetchImpl = vi.fn(async () => ok({ result: { CONTACT: [77] } }));
    const match = await bitrixFindOrCreate(WH, { name: 'Олена', phone: '+380671112233' }, { fetchImpl });

    expect(match).toEqual({
      module: 'contact',
      recordId: '77',
      url: 'https://kl.bitrix24.ua/crm/contact/details/77/',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('когда никого нет — заводится лид с номером и источником', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('crm.duplicate.findbycomm')) return ok({ result: {} });
      return ok({ result: 512 });
    });

    const match = await bitrixFindOrCreate(
      WH, { name: 'Андрій', phone: '+380502223344', source: 'Instagram Direct' }, { fetchImpl },
    );

    expect(match.module).toBe('lead');
    expect(match.recordId).toBe('512');
    const body = JSON.parse(fetchImpl.mock.calls.at(-1)![1]!.body as string);
    expect(body.fields.PHONE[0].VALUE).toBe('+380502223344');
    expect(body.fields.SOURCE_DESCRIPTION).toContain('Instagram');
  });

  it('отказ по ключу объясняется словами', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }));
    await expect(bitrixFindOrCreate(WH, { name: 'Х' }, { fetchImpl }))
      .rejects.toMatchObject({ code: 'bad_key' });
  });
});

describe('Pipedrive', () => {
  it('домен принимается и со схемой, и без неё', () => {
    expect(pipedriveRoot('kl.pipedrive.com')).toBe('https://kl.pipedrive.com/api/v1');
    expect(pipedriveRoot('https://kl.pipedrive.com/')).toBe('https://kl.pipedrive.com/api/v1');
    expect(() => pipedriveRoot('kl')).toThrow(CrmError);
  });

  it('токен идёт заголовком: в адресе он попал бы в журналы', async () => {
    const fetchImpl = vi.fn(async () => ok({ data: { items: [{ item: { id: 9 } }] } }));
    const match = await pipedriveFindOrCreate('kl.pipedrive.com', 'tok-1',
      { name: 'Ірина', phone: '+380631234567' }, { fetchImpl });

    expect(match).toEqual({ module: 'person', recordId: '9', url: 'https://kl.pipedrive.com/person/9' });
    const [url, init] = fetchImpl.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).not.toContain('tok-1');
    expect((init.headers as Record<string, string>)['x-api-token']).toBe('tok-1');
  });

  it('поиск идёт по цифрам номера: форматы записи у всех разные', async () => {
    const fetchImpl = vi.fn(async () => ok({ data: { items: [] } }));
    await pipedriveFindOrCreate('kl.pipedrive.com', 't', { name: 'Х', phone: '+380 67 111-22-33' },
      { fetchImpl }).catch(() => undefined);

    expect(fetchImpl.mock.calls[0]![0]).toContain('380671112233');
  });

  it('нет человека — создаётся карточка, и к ней лид', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes('/persons/search')) return ok({ data: { items: [] } });
      if (url.endsWith('/persons')) return ok({ data: { id: 31 } });
      return ok({ data: { id: 5 } });
    });

    const match = await pipedriveFindOrCreate('kl.pipedrive.com', 't',
      { name: 'Тарас', phone: '+380931112233', source: 'Telegram' }, { fetchImpl });

    expect(match.recordId).toBe('31');
    expect(calls.some((u) => u.endsWith('/leads'))).toBe(true);
  });
});

describe('проверка связи', () => {
  it('Битрикс отвечает именем пользователя вебхука', async () => {
    const fetchImpl = vi.fn(async () => ok({ result: { NAME: 'Костянтин', LAST_NAME: 'Сластін' } }));
    await expect(crmPing('bitrix24', { webhook: 'https://kl.bitrix24.ua/rest/1/k/' }, { fetchImpl }))
      .resolves.toBe('Костянтин Сластін');
  });

  it('Pipedrive — именем и компанией', async () => {
    const fetchImpl = vi.fn(async () => ok({ data: { name: 'Костя', company_name: 'KL Systems' } }));
    await expect(crmPing('pipedrive', { domain: 'kl.pipedrive.com', token: 't' }, { fetchImpl }))
      .resolves.toBe('Костя · KL Systems');
  });
});

describe('номер телефона', () => {
  it('приводится к цифрам', () => {
    expect(digits('+380 (67) 111-22-33')).toBe('380671112233');
    expect(digits(null)).toBe('');
  });
});

/**
 * Приложение Pipedrive: панель в карточке появляется только у
 * установленного приложения, а установка — это обмен кода на токены.
 * Ошибка здесь означает, что панель не открывается вовсе, поэтому проверяется
 * и заголовок, и срок, и обновление.
 */
describe('приложение Pipedrive', () => {
  const APP = { clientId: 'cid', clientSecret: 'secret' };

  function tokens(extra: Record<string, unknown> = {}) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600,
        api_domain: 'https://kl.pipedrive.com', ...extra,
      }),
    };
  }

  it('ключи приложения идут заголовком Basic, а не в теле', async () => {
    const fetchImpl = vi.fn(async () => tokens());
    await pipedriveExchange({ code: 'code-1', redirectUri: 'https://app.rozmovio.com/pipedrive/callback' },
      APP, { fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('https://oauth.pipedrive.com/oauth/token');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Basic ' + Buffer.from('cid:secret').toString('base64'));
    expect(init.body as string).toContain('grant_type=authorization_code');
    expect(init.body as string).not.toContain('client_secret');
  });

  it('срок жизни берётся с запасом: токен, истёкший в полёте, ищут дольше', async () => {
    const fetchImpl = vi.fn(async () => tokens({ expires_in: 3600 }));
    const t = await pipedriveExchange({ code: 'c' }, APP, { fetchImpl });
    const hour = Date.now() + 3600 * 1000;
    expect(t.expiresAt).toBeLessThan(hour);
    expect(t.expiresAt).toBeGreaterThan(hour - 120 * 1000);
  });

  it('обновление идёт тем же адресом и сохраняет прежний refresh', async () => {
    const fetchImpl = vi.fn(async () => tokens({ refresh_token: undefined }));
    const t = await pipedriveExchange({ refreshToken: 'rt-old' }, APP, { fetchImpl });
    expect((fetchImpl.mock.calls[0]![1]!.body as string)).toContain('grant_type=refresh_token');
    expect(t.refreshToken).toBe('rt-old');
  });

  it('ответ без токена — ошибка, а не «подключено»', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    await expect(pipedriveExchange({ code: 'c' }, APP, { fetchImpl }))
      .rejects.toMatchObject({ code: 'no_token' });
  });

  it('чужие ключи приложения объясняются словами', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }));
    await expect(pipedriveExchange({ code: 'c' }, APP, { fetchImpl }))
      .rejects.toMatchObject({ code: 'bad_app' });
  });

  it('адрес разрешения содержит ключ и адрес возврата', () => {
    const url = pipedriveAuthorizeUrl('cid', 'https://app.rozmovio.com/pipedrive/callback', 'st');
    expect(url.startsWith('https://oauth.pipedrive.com/oauth/authorize?')).toBe(true);
    expect(url).toContain('client_id=cid');
    expect(url).toContain('redirect_uri=https%3A%2F%2Fapp.rozmovio.com%2Fpipedrive%2Fcallback');
  });

  it('токен приложения представляется как Bearer, а не как x-api-token', async () => {
    const fetchImpl = vi.fn(async () => ok({ data: { phone: [{ value: '+380671112233', primary: true }] } }));
    const phone = await pipedrivePhone('kl.pipedrive.com', 'Bearer at-1', '31', { fetchImpl });

    expect(phone).toBe('+380671112233');
    const headers = (fetchImpl.mock.calls[0]![1] as Record<string, unknown>).headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer at-1');
    expect(headers['x-api-token']).toBeUndefined();
  });
});
