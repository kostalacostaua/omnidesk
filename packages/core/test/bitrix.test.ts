import { describe, expect, it } from 'vitest';
import {
  BITRIX_PLACEMENTS,
  bitrixApi,
  bitrixBindWidgets,
  bitrixEndpoint,
  bitrixHost,
  bitrixRefresh,
  placementModule,
  placementRecord,
  readHandshake,
} from '../src/bitrix.js';
import { CrmError, bitrixFindOrCreateVia, bitrixPhone } from '../src/crm-simple.js';

/*
 * Локальное приложение Битрикса.
 *
 * Здесь проверяется то, что приходит снаружи и уезжает наружу: чужой
 * адрес портала, чужие токены, чужие коды ошибок. Сеть подменяется,
 * потому что проверяется разбор, а не доступность Битрикса.
 */

function fake(replies: Array<{ ok?: boolean; status?: number; body: unknown }>) {
  const seen: Array<{ url: string; init?: Record<string, unknown> }> = [];
  let i = 0;
  const fetchImpl = async (url: string, init?: Record<string, unknown>) => {
    seen.push({ url, init });
    const r = replies[Math.min(i++, replies.length - 1)]!;
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: async () => r.body,
    };
  };
  return { fetchImpl, seen };
}

describe('адрес портала', () => {
  it('приводится к имени хоста', () => {
    expect(bitrixHost('https://acme.bitrix24.ua/rest/')).toBe('acme.bitrix24.ua');
    expect(bitrixHost('ACME.bitrix24.eu')).toBe('acme.bitrix24.eu');
    // Коробка на своём домене — такой же портал, отличается только адрес.
    expect(bitrixHost('crm.zavod.com.ua')).toBe('crm.zavod.com.ua');
    expect(bitrixEndpoint('acme.bitrix24.ua')).toBe('https://acme.bitrix24.ua/rest/');
  });

  /*
   * Адрес попадает в строку запроса и в заголовок рамки. Подделанный
   * адрес в заголовке означает, что нашу страницу можно показать под
   * чужим именем, поэтому он проверяется как чужой ввод.
   */
  it('подделку не принимает', () => {
    for (const bad of ['', 'not a host', 'localhost', 'javascript:alert(1)', 'a..b.com']) {
      expect(() => bitrixHost(bad)).toThrow(CrmError);
    }
    // Хвост адреса отбрасывается целиком: в заголовке рамки и в строке
    // запроса нужен хост, а всё, что после него, — чужая выдумка.
    expect(bitrixHost('evil.com/../acme.bitrix24.ua')).toBe('evil.com');
  });
});

describe('рукопожатие', () => {
  const body = {
    AUTH_ID: 'a'.repeat(32),
    REFRESH_ID: 'r'.repeat(32),
    AUTH_EXPIRES: '3600',
    member_id: 'm9f4a7f0c1b2d3e4',
    APPLICATION_TOKEN: 't'.repeat(32),
    PLACEMENT: 'CRM_CONTACT_DETAIL_TAB',
    PLACEMENT_OPTIONS: '{"ID":"3473"}',
  };

  it('разбирается и оставляет запас по времени', () => {
    const h = readHandshake({ DOMAIN: 'acme.bitrix24.ua' }, body);
    expect(h.memberId).toBe('m9f4a7f0c1b2d3e4');
    expect(h.domain).toBe('acme.bitrix24.ua');
    expect(h.placement).toBe('CRM_CONTACT_DETAIL_TAB');
    // Час минус минута: токен, истекающий во время запроса, выглядит
    // как случайный сбой и ищется дольше, чем стоит эта минута.
    const left = h.expiresAt - Date.now();
    expect(left).toBeGreaterThan(3400_000);
    expect(left).toBeLessThan(3600_000);
  });

  it('без токенов не проходит', () => {
    expect(() => readHandshake({ DOMAIN: 'acme.bitrix24.ua' }, { ...body, AUTH_ID: '' })).toThrow(
      CrmError,
    );
    expect(() => readHandshake({ DOMAIN: 'acme.bitrix24.ua' }, { ...body, member_id: '' })).toThrow(
      CrmError,
    );
  });

  /*
   * Настройки места приходят строкой JSON, и номер карточки в них —
   * то число, ради которого виджет открылся. Всё остальное оттуда не
   * берём: тип карточки известен точно по тому, какое место открылось.
   */
  it('даёт номер открытой карточки', () => {
    expect(placementRecord('{"ID":"3473"}')).toBe('3473');
    expect(placementRecord('{"entityId":8061}')).toBe('8061');
    expect(placementRecord('не json')).toBe('');
    expect(placementRecord('{"ID":"3473; DROP"}')).toBe('');
  });

  it('знает, какая карточка за каким местом', () => {
    expect(placementModule('CRM_LEAD_DETAIL_TAB')).toBe('lead');
    expect(placementModule('CRM_DEAL_DETAIL_TAB')).toBe('deal');
    expect(placementModule('CRM_WHATEVER')).toBe('');
    expect(BITRIX_PLACEMENTS.length).toBeGreaterThan(3);
  });
});

describe('обновление доступа', () => {
  it('идёт на сервер обмена и берёт новый адрес портала', async () => {
    const net = fake([
      {
        body: {
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expires_in: 3600,
          member_id: 'm1',
          client_endpoint: 'https://acme.bitrix24.ua/rest/',
        },
      },
    ]);

    const next = await bitrixRefresh(
      { clientId: 'local.1', clientSecret: 'secret' },
      { accessToken: 'old', refreshToken: 'old-refresh', expiresAt: 0, memberId: 'm1', domain: 'old.bitrix24.ua' },
      { fetchImpl: net.fetchImpl },
    );

    expect(net.seen[0]!.url).toContain('https://oauth.bitrix.info/oauth/token/');
    expect(net.seen[0]!.url).toContain('grant_type=refresh_token');
    expect(next.accessToken).toBe('new-access');
    // Каждое обновление выдаёт новый обновляющий: сохранить старый
    // значит однажды отправить человека переустанавливать приложение.
    expect(next.refreshToken).toBe('new-refresh');
    expect(next.domain).toBe('acme.bitrix24.ua');
  });

  it('отказ в ключах называет себя отдельно', async () => {
    const net = fake([{ ok: false, status: 400, body: { error: 'invalid_grant' } }]);
    await expect(
      bitrixRefresh(
        { clientId: 'local.1', clientSecret: 'secret' },
        { accessToken: '', refreshToken: 'dead', expiresAt: 0, memberId: 'm1', domain: 'acme.bitrix24.ua' },
        { fetchImpl: net.fetchImpl },
      ),
    ).rejects.toMatchObject({ code: 'bad_app' });
  });
});

describe('запрос к порталу', () => {
  const tokens = { domain: 'acme.bitrix24.ua', accessToken: 'tok' };

  it('кладёт токен в тело, а не в адрес', async () => {
    const net = fake([{ body: { result: { ID: 7 } } }]);
    const out = await bitrixApi(tokens, 'profile', {}, { fetchImpl: net.fetchImpl });

    expect(out).toEqual({ ID: 7 });
    expect(net.seen[0]!.url).toBe('https://acme.bitrix24.ua/rest/profile.json');
    // Адрес целиком попадает в журналы прокси, а ключ в журнале
    // считается утёкшим.
    expect(net.seen[0]!.url).not.toContain('tok');
    expect(String(net.seen[0]!.init?.['body'])).toContain('"auth":"tok"');
  });

  it('разные отказы называет разными кодами', async () => {
    const cases: Array<[string, string]> = [
      ['expired_token', 'expired_token'],
      ['NO_AUTH_FOUND', 'bad_key'],
      ['insufficient_scope', 'scope'],
      ['WRONG_AUTH_TYPE', 'wrong_auth'],
    ];
    for (const [error, code] of cases) {
      const net = fake([{ ok: false, status: 401, body: { error } }]);
      await expect(
        bitrixApi(tokens, 'crm.lead.add', {}, { fetchImpl: net.fetchImpl }),
      ).rejects.toMatchObject({ code });
    }
  });
});

describe('виджеты в карточках', () => {
  /*
   * Одно непоставленное место не повод остановить установку: человек в
   * этот момент стоит внутри Битрикса и считает дело сделанным.
   */
  it('ставятся во все места, а отказ одного не рушит остальные', async () => {
    const asked: string[] = [];
    const call = async (method: string, params: Record<string, unknown>) => {
      asked.push(String(params['PLACEMENT']));
      if (params['PLACEMENT'] === 'CRM_COMPANY_DETAIL_TAB') throw new CrmError('занято', 'refused');
      expect(method).toBe('placement.bind');
      return true;
    };

    const done = await bitrixBindWidgets(call, 'https://app.rozmovio.com/widget/bitrix', 'Rozmovio');
    expect(asked).toContain('CRM_CONTACT_DETAIL_TAB');
    expect(asked).toContain('CRM_DEAL_DETAIL_TAB');
    expect(done).toBe(BITRIX_PLACEMENTS.length - 1);
  });
});

describe('карточка клиента через приложение', () => {
  /*
   * Поиск и заведение лида — один и тот же код для вебхука и для
   * приложения: снаружи это одна и та же CRM, и разойтись поведение
   * этих двух путей не должно.
   */
  it('ищет по телефону и заводит лид тем же способом', async () => {
    const asked: string[] = [];
    const call = async (method: string) => {
      asked.push(method);
      if (method === 'crm.duplicate.findbycomm') return {};
      if (method === 'crm.lead.add') return 394;
      return null;
    };

    const match = await bitrixFindOrCreateVia(call, 'https://acme.bitrix24.ua', {
      name: 'Валентина',
      phone: '+380509876543',
      source: 'WhatsApp',
    });

    expect(asked).toContain('crm.duplicate.findbycomm');
    expect(match).toMatchObject({ module: 'lead', recordId: '394' });
    expect(match.url).toBe('https://acme.bitrix24.ua/crm/lead/details/394/');
  });

  it('телефон сделки берётся у её контакта', async () => {
    const asked: string[] = [];
    const call = async (method: string) => {
      asked.push(method);
      if (method === 'crm.deal.get') return { CONTACT_ID: 12 };
      return { PHONE: [{ VALUE: '+380501112233' }] };
    };

    expect(await bitrixPhone(call, 'deal', '77')).toBe('+380501112233');
    expect(asked).toEqual(['crm.deal.get', 'crm.contact.get']);
    // Номер записи приходит снаружи и уезжает в запрос: буквы в нём
    // означают не карточку, а попытку.
    expect(await bitrixPhone(call, 'contact', 'abc')).toBeNull();
  });
});
