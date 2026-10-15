import { describe, expect, it } from 'vitest';
import { eventMillis, splitCommentPayload } from '../src/comments.js';

/**
 * Время комментария.
 *
 * Единицы у Meta разные и нигде рядом не написаны: Instagram шлёт
 * entry.time в секундах, лента Facebook — created_time тоже в секундах.
 * Прочитанные как миллисекунды, секунды дают 1970 год. Сообщение при
 * этом сохраняется и ошибки не вызывает — оно просто оказывается в
 * списке ниже всего, что было за тридцать лет. Снаружи это выглядит
 * как «комментарий не пришёл», и именно так и выглядело.
 */
describe('единицы времени', () => {
  it('десятизначное число читается как секунды', () => {
    expect(eventMillis(1792067750)).toBe(1792067750000);
  });

  it('тринадцатизначное остаётся миллисекундами', () => {
    expect(eventMillis(1792067750381)).toBe(1792067750381);
  });

  it('мусор не превращается в 1970 год', () => {
    expect(eventMillis(undefined)).toBeUndefined();
    expect(eventMillis('1792067750')).toBeUndefined();
    expect(eventMillis(0)).toBeUndefined();
    expect(eventMillis(-5)).toBeUndefined();
    expect(eventMillis(Number.NaN)).toBeUndefined();
  });
});

describe('комментарий Instagram', () => {
  const payload = (time: number) => ({
    object: 'instagram',
    entry: [
      {
        id: '17841445306704587',
        time,
        changes: [
          {
            field: 'comments',
            value: {
              id: '18114538097023058',
              text: 'привіт',
              from: { id: '5809723192460234', username: 'kostya_slastin' },
              media: { id: '18277161355137756' },
            },
          },
        ],
      },
    ],
  });

  /* Секунды в вебхуке Instagram — не редкий случай, а единственный. */
  it('время из секунд даёт нынешний год, а не 1970', () => {
    const out = splitCommentPayload(payload(1792067750));
    const at = out[0]?.events[0]?.at;
    expect(at?.getUTCFullYear()).toBe(2026);
  });

  it('миллисекунды тоже понимаются', () => {
    const out = splitCommentPayload(payload(1792067750381));
    expect(out[0]?.events[0]?.at.getUTCFullYear()).toBe(2026);
  });
});

describe('комментарий Facebook', () => {
  it('created_time в секундах читается верно', () => {
    const out = splitCommentPayload({
      object: 'page',
      entry: [
        {
          id: '102388345168942',
          time: 1792067750,
          changes: [
            {
              field: 'feed',
              value: {
                item: 'comment',
                verb: 'add',
                comment_id: '1_2',
                created_time: 1792067700,
                message: 'привіт',
                from: { id: '9', name: 'Клієнт' },
              },
            },
          ],
        },
      ],
    });
    const at = out[0]?.events[0]?.at;
    expect(at?.getUTCFullYear()).toBe(2026);
    // Время самого комментария важнее времени пачки: пачка приходит позже.
    expect(at?.getTime()).toBe(1792067700000);
  });
});
