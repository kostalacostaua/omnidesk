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
