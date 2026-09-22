import { describe, expect, it } from 'vitest';
import {
  dedupeKey,
  extractWhatsAppStatuses,
  normalizeTelegram,
  normalizeWhatsApp,
  type MetaWebhookPayload,
  type TelegramUpdate,
} from '../src/normalize.js';

const CTX = { tenantId: 'tenant-1', channelId: 'channel-1' };

describe('normalizeTelegram', () => {
  it('нормализует текстовое сообщение', () => {
    const update: TelegramUpdate = {
      update_id: 100,
      message: {
        message_id: 42,
        from: { id: 555, first_name: 'Иван', last_name: 'Петров', username: 'ivan' },
        chat: { id: 555, type: 'private' },
        date: 1_754_000_000,
        text: 'Здравствуйте, когда будет счёт?',
      },
    };

    const [msg] = normalizeTelegram(CTX, update);
    expect(msg).toBeDefined();
    expect(msg!.channelType).toBe('telegram_bot');
    expect(msg!.direction).toBe('in');
    expect(msg!.senderType).toBe('customer');
    expect(msg!.content.text).toBe('Здравствуйте, когда будет счёт?');
    expect(msg!.peerId).toBe('555');
    expect(msg!.peerProfile.name).toBe('Иван Петров');
    expect(msg!.peerProfile.username).toBe('ivan');
    expect(msg!.sentAt.toISOString()).toBe('2025-07-31T22:13:20.000Z');
  });

  it('КЛЮЧЕВОЕ: externalId включает chat_id — message_id уникален только внутри чата', () => {
    const mk = (chatId: number): TelegramUpdate => ({
      update_id: 1,
      message: { message_id: 7, chat: { id: chatId, type: 'private' }, date: 1, text: 'привет' },
    });

    const a = normalizeTelegram(CTX, mk(111))[0]!;
    const b = normalizeTelegram(CTX, mk(222))[0]!;

    // Если бы externalId был просто message_id, второе сообщение
    // считалось бы дубликатом первого и потерялось бы.
    expect(a.externalId).not.toBe(b.externalId);
    expect(a.externalId).toBe('111:7');
    expect(b.externalId).toBe('222:7');
  });

  it('берёт самое крупное изображение из массива размеров', () => {
    const update: TelegramUpdate = {
      update_id: 1,
      message: {
        message_id: 1,
        chat: { id: 1, type: 'private' },
        date: 1,
        caption: 'вот документ',
        photo: [
          { file_id: 'small', width: 90, height: 90, file_size: 1000 },
          { file_id: 'medium', width: 320, height: 320, file_size: 8000 },
          { file_id: 'large', width: 1280, height: 1280, file_size: 90000 },
        ],
      },
    };

    const [msg] = normalizeTelegram(CTX, update);
    expect(msg!.content.attachments).toHaveLength(1);
    expect(msg!.content.attachments![0]!.externalId).toBe('large');
    expect(msg!.content.attachments![0]!.type).toBe('image');
    expect(msg!.content.text).toBe('вот документ');
  });

  it('распознаёт голосовое сообщение с длительностью', () => {
    const update: TelegramUpdate = {
      update_id: 1,
      message: {
        message_id: 1,
        chat: { id: 1, type: 'private' },
        date: 1,
        voice: { file_id: 'voice-1', duration: 17, mime_type: 'audio/ogg', file_size: 4200 },
      },
    };
    const [msg] = normalizeTelegram(CTX, update);
    expect(msg!.content.attachments![0]).toMatchObject({
      type: 'voice',
      externalId: 'voice-1',
      durationSec: 17,
    });
  });

  it('помечает сообщения Business-аккаунта отдельным типом канала', () => {
    const update: TelegramUpdate = {
      update_id: 1,
      business_message: {
        message_id: 5,
        business_connection_id: 'conn-1',
        chat: { id: 777, type: 'private' },
        from: { id: 777, first_name: 'Клиент' },
        date: 1_754_000_000,
        text: 'пишу в личку',
      },
    };
    const [msg] = normalizeTelegram(CTX, update);
    // Важно: у telegram_business своё окно 24 часа, у telegram_bot его нет.
    expect(msg!.channelType).toBe('telegram_business');
  });

  it('игнорирует служебные апдейты без содержимого', () => {
    expect(normalizeTelegram(CTX, { update_id: 1 })).toHaveLength(0);
    expect(
      normalizeTelegram(CTX, {
        update_id: 2,
        message: { message_id: 1, chat: { id: 1, type: 'private' }, date: 1 },
      }),
    ).toHaveLength(0);
  });

  /**
   * Ссылка на цитату хранится в том же виде, что и external_id самого
   * сообщения: «чат:сообщение». Раньше здесь был голый message_id,
   * и это выглядело безобиднее — пока не понадобилось найти по нему
   * исходное сообщение. Номер сообщения уникален только внутри чата,
   * поэтому поиск по «9» нашёл бы чужую цитату из другого диалога.
   */
  it('ссылка на цитату совпадает по формату с external_id', () => {
    const [msg] = normalizeTelegram(CTX, {
      update_id: 1,
      message: {
        message_id: 10,
        chat: { id: 1, type: 'private' },
        date: 1,
        text: 'да',
        reply_to_message: { message_id: 9, text: 'вопрос' },
      },
    });
    expect(msg!.content.replyToExternalId).toBe('1:9');
    expect(msg!.content.replyToText).toBe('вопрос');
    // Формат совпадает с тем, как собирается external_id самого сообщения.
    expect(msg!.externalId).toBe('1:10');
  });

  it('сохраняет сырой payload целиком', () => {
    const update: TelegramUpdate = {
      update_id: 42,
      message: { message_id: 1, chat: { id: 1, type: 'private' }, date: 1, text: 'x' },
    };
    const [msg] = normalizeTelegram(CTX, update);
    expect(msg!.raw).toBe(update);
  });
});

describe('normalizeWhatsApp', () => {
  const textPayload: MetaWebhookPayload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_ID',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '380671234567', phone_number_id: 'PNID1' },
              contacts: [{ profile: { name: 'Мария' }, wa_id: '380509876543' }],
              messages: [
                {
                  id: 'wamid.HBgMMzgwNTA5ODc2NTQzFQIAEhgg',
                  from: '380509876543',
                  timestamp: '1754000000',
                  type: 'text',
                  text: { body: 'Добрый день!' },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  it('нормализует текстовое сообщение и подставляет имя из contacts', () => {
    const [msg] = normalizeWhatsApp(CTX, textPayload);
    expect(msg!.channelType).toBe('whatsapp');
    expect(msg!.content.text).toBe('Добрый день!');
    expect(msg!.externalId).toBe('wamid.HBgMMzgwNTA5ODc2NTQzFQIAEhgg');
    expect(msg!.peerId).toBe('380509876543');
    expect(msg!.peerProfile.name).toBe('Мария');
    expect(msg!.peerProfile.phone).toBe('+380509876543');
  });

  it('распознаёт вложения', () => {
    const payload: MetaWebhookPayload = {
      entry: [
        {
          id: 'W',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'PNID1' },
                messages: [
                  {
                    id: 'wamid.2',
                    from: '380509876543',
                    timestamp: '1754000001',
                    type: 'document',
                    document: { id: 'media-1', mime_type: 'application/pdf', filename: 'счёт.pdf' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const [msg] = normalizeWhatsApp(CTX, payload);
    expect(msg!.content.attachments![0]).toMatchObject({
      type: 'document',
      externalId: 'media-1',
      filename: 'счёт.pdf',
    });
  });

  it('отличает голосовое от обычного аудио по флагу voice', () => {
    const payload: MetaWebhookPayload = {
      entry: [
        {
          id: 'W',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'P' },
                messages: [
                  {
                    id: 'wamid.3',
                    from: '1',
                    timestamp: '1',
                    type: 'audio',
                    audio: { id: 'a1', voice: true, mime_type: 'audio/ogg' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(normalizeWhatsApp(CTX, payload)[0]!.content.attachments![0]!.type).toBe('voice');
  });

  it('не создаёт сообщений из вебхука, содержащего только статусы', () => {
    const payload: MetaWebhookPayload = {
      entry: [
        {
          id: 'W',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'P' },
                statuses: [
                  { id: 'wamid.1', status: 'delivered', timestamp: '1754000100', recipient_id: '380' },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(normalizeWhatsApp(CTX, payload)).toHaveLength(0);
  });

  it('извлекает статусы доставки отдельно', () => {
    const payload: MetaWebhookPayload = {
      entry: [
        {
          id: 'W',
          changes: [
            {
              field: 'messages',
              value: {
                statuses: [
                  { id: 'wamid.1', status: 'sent', timestamp: '1754000100', recipient_id: '380' },
                  { id: 'wamid.1', status: 'read', timestamp: '1754000200', recipient_id: '380' },
                  { id: 'wamid.2', status: 'deleted', timestamp: '1754000300', recipient_id: '380' },
                ],
              },
            },
          ],
        },
      ],
    };
    const statuses = extractWhatsAppStatuses(payload);
    // Неизвестный статус 'deleted' отбрасывается, а не ломает обработку.
    expect(statuses).toHaveLength(2);
    expect(statuses[0]).toMatchObject({ externalId: 'wamid.1', status: 'sent' });
    expect(statuses[1]!.status).toBe('read');
  });

  it('не падает на пустом или неожиданном payload', () => {
    expect(normalizeWhatsApp(CTX, {})).toEqual([]);
    expect(normalizeWhatsApp(CTX, { entry: [] })).toEqual([]);
    expect(normalizeWhatsApp(CTX, { entry: [{ id: 'x' }] })).toEqual([]);
  });

  it('игнорирует изменения в полях, отличных от messages', () => {
    const payload: MetaWebhookPayload = {
      entry: [
        {
          id: 'W',
          changes: [
            {
              field: 'message_template_status_update',
              value: { metadata: { phone_number_id: 'P' } },
            },
          ],
        },
      ],
    };
    expect(normalizeWhatsApp(CTX, payload)).toHaveLength(0);
  });
});

describe('dedupeKey', () => {
  it('различает одинаковые externalId в разных каналах', () => {
    expect(dedupeKey('ch-1', 'wamid.X')).not.toBe(dedupeKey('ch-2', 'wamid.X'));
  });

  it('стабилен для одной пары', () => {
    expect(dedupeKey('ch-1', 'wamid.X')).toBe(dedupeKey('ch-1', 'wamid.X'));
  });
});
