import { describe, expect, it } from 'vitest';
import {
  isCustomKey,
  newCustomKey,
  newCustomSecret,
  normalizeCustom,
  signCustom,
} from '../src/custom.js';
import { canSendFreeform, computeResponseWindow } from '../src/types.js';

/**
 * Свой канал впускает в общую ленту чужой код. Значит проверять надо не
 * то, что он работает на хороших данных, а то, что он делает с плохими:
 * именно они сюда и придут, причём не по злому умыслу, а потому что на
 * той стороне тоже кто-то пишет свой первый бот.
 */

const ctx = { tenantId: 't1', channelId: 'ch1', externalId: 'ext1' };

describe('ключ канала', () => {
  it('узнаётся по виду: в чужих записках их три подряд', () => {
    const key = newCustomKey();
    expect(key.startsWith('chan_live_')).toBe(true);
    expect(isCustomKey(key)).toBe(true);
  });

  it('чужая строка ключом не считается', () => {
    expect(isCustomKey('chan_live_короткий')).toBe(false);
    expect(isCustomKey('wc0f68b51ae39d409ab6a3d1')).toBe(false);
    expect(isCustomKey('')).toBe(false);
    // Длина ровно такая, как выдаём: хвост из лишних символов —
    // это уже не наш ключ, а попытка подобрать похожий.
    expect(isCustomKey(newCustomKey() + 'a')).toBe(false);
  });

  it('два ключа подряд не совпадают', () => {
    expect(newCustomKey()).not.toBe(newCustomKey());
  });
});

describe('подпись исходящего', () => {
  it('зависит от тела: иначе её можно переставить на другое сообщение', () => {
    const secret = newCustomSecret();
    const a = signCustom(secret, '{"text":"привіт"}');
    const b = signCustom(secret, '{"text":"прощавай"}');
    expect(a).not.toBe(b);
  });

  it('зависит от секрета: без него подделать нельзя', () => {
    const body = '{"text":"привіт"}';
    expect(signCustom('aaa', body)).not.toBe(signCustom('bbb', body));
  });

  it('одинакова при повторе: клиент проверяет её у себя', () => {
    const secret = newCustomSecret();
    expect(signCustom(secret, 'x')).toBe(signCustom(secret, 'x'));
  });
});

describe('входящее от клиента', () => {
  it('становится обычным сообщением', () => {
    const m = normalizeCustom({ peerId: '380501112233', text: 'Є в наявності?' }, ctx);
    expect(m?.channelType).toBe('custom');
    expect(m?.direction).toBe('in');
    expect(m?.peerId).toBe('380501112233');
    expect(m?.content.text).toBe('Є в наявності?');
  });

  it('без собеседника не принимается: писать было бы некому', () => {
    expect(normalizeCustom({ peerId: '', text: 'привіт' }, ctx)).toBeNull();
    expect(normalizeCustom({ peerId: '   ', text: 'привіт' }, ctx)).toBeNull();
  });

  it('пустое сообщение не создаёт диалог', () => {
    expect(normalizeCustom({ peerId: '380501112233', text: '   ' }, ctx)).toBeNull();
  });

  it('без имени собеседники различимы в списке', () => {
    const a = normalizeCustom({ peerId: '380501112233', text: 'привіт' }, ctx);
    const b = normalizeCustom({ peerId: '380509998877', text: 'привіт' }, ctx);
    expect(a?.peerProfile.name).not.toBe(b?.peerProfile.name);
  });

  it('очень длинное сообщение обрезается, а не уходит целиком', () => {
    const m = normalizeCustom({ peerId: '1', text: 'а'.repeat(9000) }, ctx);
    expect((m?.content.text ?? '').length).toBe(4000);
  });

  it('длинный идентификатор собеседника обрезается по размеру колонки', () => {
    const m = normalizeCustom({ peerId: '9'.repeat(400), text: 'привіт' }, ctx);
    expect((m?.peerId ?? '').length).toBe(190);
  });

  it('файл без текста — нормальное сообщение', () => {
    const m = normalizeCustom(
      { peerId: '1', attachments: [{ type: 'image', url: 'https://x/1.png' }] },
      ctx,
    );
    expect(m?.content.attachments?.length).toBe(1);
    expect(m?.content.text).toBeUndefined();
  });

  it('гора вложений не проходит целиком', () => {
    const many = Array.from({ length: 50 }, () => ({ type: 'image' as const }));
    const m = normalizeCustom({ peerId: '1', text: 'ось', attachments: many }, ctx);
    expect(m?.content.attachments?.length).toBe(10);
  });
});

describe('окно ответа', () => {
  it('его нет: что ограничивает ту сторону, знает клиент, а не мы', () => {
    const w = computeResponseWindow('custom', new Date('2026-01-01T00:00:00.000Z'));
    expect(w.type).toBe('none');
    expect(canSendFreeform('custom', w, new Date('2027-01-01T00:00:00.000Z')).allowed).toBe(true);
  });
});
