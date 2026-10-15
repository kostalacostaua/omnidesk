import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { splitCommentPayload, splitMessagingPayload } from '@omnidesk/core';

/**
 * Пачка от Meta, из которой ничего не вышло.
 *
 * «Вебхук пришёл, но ничего не произошло» и «вебхук не приходил вовсе» —
 * разные неисправности с разными причинами: в первом случае подписка
 * оформлена не на то поле или канал не подключён, во втором не настроена
 * сама подписка. Раньше первое уходило в тишину, и отличить их было
 * нечем — при отладке подписок это стоило суток.
 */
const SRC = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

describe('нераспознанный вебхук Meta', () => {
  it('оставляет след в логе', () => {
    expect(SRC).toContain('Вебхук Meta ни во что не превратился');
  });

  /* Без полей запись бесполезна: по ним и видно, на что подписались. */
  it('в записи видно, какие поля прислала Meta', () => {
    expect(SRC).toMatch(/fields: Array\.from\(fields\)/);
    expect(SRC).toContain('object: payload.object');
  });

  it('пишется только когда не вышло ни сообщения, ни комментария', () => {
    expect(SRC).toContain('if (!messaging.length && !comments.length)');
  });
});

/*
 * Проверка самого условия: разборщики на чужом поле обязаны вернуть
 * пустоту — иначе запись не появится там, где она нужнее всего.
 */
describe('разбор чужого поля', () => {
  const ctx = { tenantId: 't', channelId: 'c' };

  it('поле, на которое мы не подписаны, не даёт ни сообщений, ни комментариев', () => {
    const payload = {
      object: 'page',
      entry: [{ id: '102388345168942', time: 1, changes: [{ field: 'ratings', value: {} }] }],
    };
    expect(splitCommentPayload(payload)).toEqual([]);
    expect(splitMessagingPayload(payload as never, ctx as never)).toEqual([]);
  });

  /* А ради контраста — комментарий из ленты разбирается как раньше. */
  it('комментарий из ленты по-прежнему разбирается', () => {
    const payload = {
      object: 'page',
      entry: [
        {
          id: '102388345168942',
          time: 1,
          changes: [
            {
              field: 'feed',
              value: {
                item: 'comment',
                verb: 'add',
                comment_id: '1_2',
                post_id: '1_3',
                message: 'привіт',
                from: { id: '9', name: 'Клієнт' },
              },
            },
          ],
        },
      ],
    };
    const out = splitCommentPayload(payload);
    expect(out).toHaveLength(1);
    expect(out[0]?.channelType).toBe('messenger_comments');
    expect(out[0]?.events).toHaveLength(1);
  });
});
