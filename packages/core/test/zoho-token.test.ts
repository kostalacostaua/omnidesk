import { describe, expect, it } from 'vitest';
import {
  ZOHO_TOKEN_TTL_SEC,
  dropZohoToken,
  zohoAccessToken,
  zohoTokenKey,
  type TokenCache,
} from '../src/zoho-token.js';

/**
 * Маркер доступа к Zoho.
 *
 * Главное здесь — на что именно он выдан. Маркер действителен в одной
 * организации, а организаций у компании может быть несколько: вторая
 * фирма, другой дата-центр. Пока кэш был один на компанию, вторая
 * установка затирала маркер первой, и обе получали от Zoho 401 — молча:
 * маркер брался из кэша, значит ошибки обмена не было, установка
 * числилась активной, а карточки просто не создавались.
 */

/** Кэш в памяти с подсчётом обращений: по нему видно, сходили ли в сеть. */
function fakeCache(): TokenCache & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(key) {
      return store.get(key) ?? null;
    },
    async set(key, value) {
      store.set(key, value);
      return 'OK';
    },
    async del(key) {
      store.delete(key);
      return 1;
    },
  };
}

describe('ключ кэша маркера', () => {
  it('различает установки одной компании', () => {
    expect(zohoTokenKey('t1', 'inst-a')).not.toBe(zohoTokenKey('t1', 'inst-b'));
  });

  it('различает компании', () => {
    expect(zohoTokenKey('t1', 'inst-a')).not.toBe(zohoTokenKey('t2', 'inst-a'));
  });

  it('для одной и той же установки один и тот же', () => {
    expect(zohoTokenKey('t1', 'inst-a')).toBe(zohoTokenKey('t1', 'inst-a'));
  });
});

describe('выдача маркера', () => {
  const base = {
    accountsServer: 'https://accounts.zoho.eu',
    refreshToken: 'r',
    clientId: 'c',
    clientSecret: 's',
  };

  /*
   * Сердце той самой ошибки: два обмена по разным установкам не должны
   * видеть чужой маркер. Если этот тест падает, значит ключ снова
   * общий, и обе организации опять получают 401.
   */
  it('маркер одной установки не достаётся другой', async () => {
    const cache = fakeCache();
    let issued = 0;
    const fetchMock = async () => {
      issued += 1;
      return new Response(JSON.stringify({ access_token: 'at-' + issued }), { status: 200 });
    };
    const real = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
    try {
      const a = await zohoAccessToken({ ...base, cache, tenantId: 't1', installationId: 'A' });
      const b = await zohoAccessToken({ ...base, cache, tenantId: 't1', installationId: 'B' });
      expect(a).toEqual({ ok: true, token: 'at-1' });
      expect(b).toEqual({ ok: true, token: 'at-2' });
      expect(issued).toBe(2);
    } finally {
      globalThis.fetch = real;
    }
  });

  it('повторный запрос той же установки берётся из кэша', async () => {
    const cache = fakeCache();
    let issued = 0;
    const real = globalThis.fetch;
    globalThis.fetch = (async () => {
      issued += 1;
      return new Response(JSON.stringify({ access_token: 'at' }), { status: 200 });
    }) as typeof globalThis.fetch;
    try {
      await zohoAccessToken({ ...base, cache, tenantId: 't1', installationId: 'A' });
      await zohoAccessToken({ ...base, cache, tenantId: 't1', installationId: 'A' });
      expect(issued).toBe(1);
    } finally {
      globalThis.fetch = real;
    }
  });

  it('отказ возвращается значением, а не исключением', async () => {
    const cache = fakeCache();
    const real = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: 'invalid_client' }), {
        status: 400,
      })) as typeof globalThis.fetch;
    try {
      const out = await zohoAccessToken({ ...base, cache, tenantId: 't1', installationId: 'A' });
      expect(out).toEqual({ ok: false, error: 'invalid_client' });
      expect(cache.store.size).toBe(0);
    } finally {
      globalThis.fetch = real;
    }
  });
});

describe('сброс маркера', () => {
  /*
   * Нужен на 401 от самой CRM. Без него негодный маркер лежит все
   * пятьдесят минут, и всё это время карточки не заводятся.
   */
  it('убирает маркер только своей установки', async () => {
    const cache = fakeCache();
    cache.store.set(zohoTokenKey('t1', 'A'), 'at-a');
    cache.store.set(zohoTokenKey('t1', 'B'), 'at-b');

    await dropZohoToken(cache, 't1', 'A');

    expect(cache.store.get(zohoTokenKey('t1', 'A'))).toBeUndefined();
    expect(cache.store.get(zohoTokenKey('t1', 'B'))).toBe('at-b');
  });

  /* Хранилище без del не должно ронять вызывающего. */
  it('переживает кэш без удаления', async () => {
    const half: TokenCache = {
      async get() {
        return null;
      },
      async set() {
        return 'OK';
      },
    };
    await expect(dropZohoToken(half, 't1', 'A')).resolves.toBeUndefined();
  });

  it('срок жизни короче часа, который даёт Zoho', () => {
    expect(ZOHO_TOKEN_TTL_SEC).toBeLessThan(3600);
  });
});
