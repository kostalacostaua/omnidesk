import { describe, expect, it } from 'vitest';
import {
  normalizeMessaging,
  normalizeMessagingReactions,
  splitMessagingPayload,
  type MetaWebhookPayload,
} from '../src/normalize.js';

const ctx = { tenantId: 't1', channelId: 'c1' };

const page: MetaWebhookPayload = {
  object: 'page',
  entry: [
    {
      id: 'PAGE1',
      messaging: [
        {
          sender: { id: 'PSID1' },
          recipient: { id: 'PAGE1' },
          timestamp: 1790000000000,
          message: {
            mid: 'm_1',
            text: 'Привет',
            attachments: [{ type: 'image', payload: { url: 'https://cdn.fb/x.jpg' } }],
          },
        },
        {
          sender: { id: 'PAGE1' },
          recipient: { id: 'PSID1' },
          timestamp: 1790000001000,
          message: { mid: 'm_2', text: 'наш ответ', is_echo: true, app_id: 777 },
        },
        {
          sender: { id: 'PAGE1' },
          recipient: { id: 'PSID1' },
          timestamp: 1790000002000,
          message: { mid: 'm_3', text: 'ответ из Business Suite', is_echo: true, app_id: 263902037430900 },
        },
      ],
    },
  ],
};

describe('Messenger / Instagram', () => {
  it('раскладывает вебхук по каналам и типу', () => {
    const parts = splitMessagingPayload(page);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ channelExternalId: 'PAGE1', channelType: 'messenger' });
    const ig = splitMessagingPayload({ ...page, object: 'instagram' });
    expect(ig[0]!.channelType).toBe('instagram');
    expect(splitMessagingPayload({ object: 'whatsapp_business_account', entry: [] })).toEqual([]);
  });

  it('входящее, своё эхо отброшено, чужое эхо — исходящее', () => {
    const [entry] = splitMessagingPayload(page);
    const msgs = normalizeMessaging(ctx, entry!, '777');
    expect(msgs.map((m) => m.externalId)).toEqual(['m_1', 'm_3']);
    expect(msgs[0]).toMatchObject({
      peerId: 'PSID1',
      direction: 'in',
      channelType: 'messenger',
      content: { text: 'Привет', attachments: [{ type: 'image', externalId: 'https://cdn.fb/x.jpg' }] },
    });
    expect(msgs[1]).toMatchObject({ peerId: 'PSID1', direction: 'out', senderType: 'agent' });
  });

  it('реакция и снятие реакции', () => {
    const r = normalizeMessagingReactions({
      channelExternalId: 'P',
      channelType: 'instagram',
      events: [
        { sender: { id: 'U' }, reaction: { mid: 'm_1', action: 'react', emoji: '👍' } },
        { sender: { id: 'U' }, reaction: { mid: 'm_1', action: 'unreact' } },
      ],
    });
    expect(r.map((x) => x.emojis)).toEqual([['👍'], []]);
  });
});

/**
 * История и рилс.
 *
 * До этой пометки ответ на историю выглядел в ленте как присланная
 * картинка: оператор видел фото и не понимал, на что ему отвечают.
 */
describe('истории и рилсы Instagram', () => {
  const ctx = { tenantId: 't1', channelId: 'ch1' };
  const entry = (message: Record<string, unknown>) => ({
    channelType: 'instagram' as const,
    channelExternalId: 'IG1',
    events: [{ sender: { id: 'u1' }, recipient: { id: 'IG1' }, timestamp: 1, message }],
  });

  it('ответ на историю помечается ответом на историю', () => {
    const [m] = normalizeMessaging(ctx, entry({
      mid: 'm1',
      text: 'Круто!',
      reply_to: { story: { url: 'https://cdn/story.jpg', id: 's1' } },
    }), '');
    expect(m?.content.ig).toEqual({ kind: 'story_reply', url: 'https://cdn/story.jpg', id: 's1' });
    expect(m?.content.text).toBe('Круто!');
  });

  it('упоминание в истории — не просто картинка', () => {
    const [m] = normalizeMessaging(ctx, entry({
      mid: 'm2',
      attachments: [{ type: 'story_mention', payload: { url: 'https://cdn/mention.jpg' } }],
    }), '');
    expect(m?.content.ig?.kind).toBe('story_mention');
    expect(m?.content.attachments?.[0]?.type).toBe('image');
  });

  it('рилс — не просто видео', () => {
    const [m] = normalizeMessaging(ctx, entry({
      mid: 'm3',
      attachments: [{ type: 'ig_reel', payload: { url: 'https://cdn/reel.mp4' } }],
    }), '');
    expect(m?.content.ig?.kind).toBe('reel');
    expect(m?.content.attachments?.[0]?.type).toBe('video');
  });

  it('репост без текста и файла не пропадает', () => {
    const [m] = normalizeMessaging(ctx, entry({
      mid: 'm4',
      attachments: [{ type: 'share', payload: {} }],
    }), '');
    expect(m?.content.ig?.kind).toBe('share');
    expect(m?.content.text).toBeTruthy();
  });

  it('обычное сообщение пометки не получает', () => {
    const [m] = normalizeMessaging(ctx, entry({ mid: 'm5', text: 'привіт' }), '');
    expect(m?.content.ig).toBeUndefined();
  });
});
