import { describe, expect, it, vi } from 'vitest';
import {
  VIBER_CHANNEL,
  ViberError,
  normalizePhone,
  normalizeViber,
  readMessage,
  viberFetch,
  viberSend,
  viberSenders,
} from '../src/viber.js';
import { computeResponseWindow, isWindowOpen } from '../src/types.js';

/**
 * Viber ходит через партнёра, и проверять тут нужно ровно то, что
 * ломается в таких интеграциях: ключ в адресе вместо заголовка,
 * исходящие, принятые за входящие, и молчание вместо понятной ошибки.
 */

function ok(result: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ response_code: 0, response_status: 'OK', response_result: result }),
  };
}

const CREDS = { token: 'tok-1', sender: 'KL Systems' };

describe('разговор с партнёром', () => {
  it('ключ идёт заголовком: в адресе он попал бы в журналы', async () => {
    const fetchImpl = vi.fn(async () => ok([]));
    await viberSenders('tok-1', { fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('https://api.turbosms.ua/chat/senders.json');
    expect(url).not.toContain('tok-1');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok-1');
  });

  it('чужой ключ объясняется словами, а не кодом', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }));
    await expect(viberSenders('bad', { fetchImpl })).rejects.toMatchObject({ code: 'bad_key' });
  });

  it('отказ партнёра в теле ответа — тоже отказ, а не пустой список', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ response_code: 103, response_status: 'Сообщений нет доступа' }),
    }));
    await expect(viberFetch(CREDS, { fetchImpl })).rejects.toBeInstanceOf(ViberError);
  });
});

describe('разбор сообщения', () => {
  it('исходящее не превращается во входящее', () => {
    const out = readMessage({ id: '1', chat_id: 'c1', direction: 'out', message: 'привет' });
    expect(out?.incoming).toBe(false);

    const incoming = readMessage({ id: '2', chat_id: 'c1', direction: 'in', message: 'а є?' });
    expect(incoming?.incoming).toBe(true);
  });

  it('без номера сообщения и чата запись пропускается', () => {
    expect(readMessage({ message: 'текст' })).toBeNull();
    expect(readMessage({ id: '3' })).toBeNull();
  });

  it('входящие приходят отфильтрованными', async () => {
    const fetchImpl = vi.fn(async () => ok([
      { id: '1', chat_id: 'c1', direction: 'in', message: 'є сумки?', phone: '380671112233' },
      { id: '2', chat_id: 'c1', direction: 'out', message: 'так' },
    ]));
    const list = await viberFetch(CREDS, { fetchImpl });
    expect(list).toHaveLength(2);
    expect(list.filter((m) => m.incoming)).toHaveLength(1);
  });
});

describe('приведение к общему виду', () => {
  const base = {
    id: '10', chatId: 'c7', phone: '+380 67 111-22-33', name: 'Олена',
    text: 'Доброго дня', incoming: true, at: '2026-09-23T07:00:00.000Z',
  };

  it('входящее становится обычным сообщением с номером клиента', () => {
    const m = normalizeViber(base, { tenantId: 't1', channelId: 'ch1' });
    expect(m?.channelType).toBe(VIBER_CHANNEL);
    expect(m?.direction).toBe('in');
    expect(m?.externalId).toBe('10');
    expect(m?.peerId).toBe('c7');
    expect(m?.peerProfile.phone).toBe('+380671112233');
    expect(m?.content.text).toBe('Доброго дня');
  });

  it('исходящее и пустое не попадают в ленту', () => {
    expect(normalizeViber({ ...base, incoming: false }, { tenantId: 't1', channelId: 'ch1' })).toBeNull();
    expect(normalizeViber({ ...base, text: null }, { tenantId: 't1', channelId: 'ch1' })).toBeNull();
  });

  it('короткий номер не выдаётся за телефон', () => {
    expect(normalizePhone('123')).toBeNull();
    expect(normalizePhone('+380671112233')).toBe('+380671112233');
  });
});

describe('отправка', () => {
  it('ответ идёт в тот же чат, а имя отправителя не дублируется', async () => {
    const fetchImpl = vi.fn(async () => ok({ message_id: 'm-99' }));
    const id = await viberSend(CREDS, { chatId: 'c7' }, { text: 'Так, є' }, { fetchImpl });

    expect(id).toBe('m-99');
    const body = (fetchImpl.mock.calls[0]![1] as Record<string, string>).body;
    expect(body).toContain('chat_id=c7');
    expect(body).not.toContain('sender=');
  });

  it('пустое сообщение не уходит вовсе', async () => {
    await expect(viberSend(CREDS, { chatId: 'c7' }, {})).rejects.toMatchObject({ code: 'empty' });
  });

  it('без чата и номера отправлять некуда', async () => {
    await expect(viberSend(CREDS, {}, { text: 'х' })).rejects.toMatchObject({ code: 'no_recipient' });
  });
});

describe('окно ответа', () => {
  it('сутки после сообщения клиента — как в Instagram и Messenger', () => {
    const at = new Date('2026-09-23T07:00:00.000Z');
    const w = computeResponseWindow(VIBER_CHANNEL, at);
    expect(w.type).toBe('standard');
    expect(isWindowOpen(w, new Date('2026-09-24T06:00:00.000Z'))).toBe(true);
    expect(isWindowOpen(w, new Date('2026-09-24T08:00:00.000Z'))).toBe(false);
  });
});
