import { describe, expect, it } from 'vitest';
import {
  WHATSAPP_USER_CHANNEL,
  chatToPhone,
  gatewayCredsOk,
  normalizeGateway,
  phoneToChat,
  readGreen,
} from '../src/gateway.js';

/*
 * WhatsApp через шлюз.
 *
 * Проверяем разбор чужого формата и границы: что мы берём, что молча
 * пропускаем и что из этого получается в общей ленте. Сеть здесь не
 * нужна — вся хрупкость в разборе, а не в запросах.
 */

const TEXT = {
  typeWebhook: 'incomingMessageReceived',
  instanceData: { idInstance: 7103000000, wid: '380671112233@c.us', typeInstance: 'whatsapp' },
  timestamp: 1758880000,
  idMessage: 'F7AEC1B7086ECDC7E6E45923F5EDB825',
  senderData: {
    chatId: '380509876543@c.us',
    sender: '380509876543@c.us',
    chatName: 'Валентина',
    senderName: 'Валентина',
  },
  messageData: { typeMessage: 'textMessage', textMessageData: { textMessage: 'Скільки коштує?' } },
};

describe('разбор вебхука шлюза', () => {
  it('текстовое сообщение разбирается целиком', () => {
    const m = readGreen(TEXT);
    expect(m).not.toBeNull();
    expect(m?.id).toBe('F7AEC1B7086ECDC7E6E45923F5EDB825');
    expect(m?.chatId).toBe('380509876543@c.us');
    expect(m?.text).toBe('Скільки коштує?');
    expect(m?.name).toBe('Валентина');
    expect(m?.incoming).toBe(true);
  });

  /*
   * Шлюз шлёт в тот же адрес отметки о прочтении, состояния инстанса и
   * звонки. Падать на них — значит заполнить журнал чужой рутиной;
   * класть их в очередь — платить очередью за мусор.
   */
  it('всё, что не сообщение, отбрасывается молча', () => {
    expect(readGreen({ typeWebhook: 'stateInstanceChanged' })).toBeNull();
    expect(readGreen({ typeWebhook: 'outgoingMessageStatus' })).toBeNull();
    expect(readGreen({})).toBeNull();
    expect(readGreen(null)).toBeNull();
  });

  /*
   * Групповые чаты не берём: там переписка многих со многими, и модель
   * «один диалог — один клиент» на них не натягивается. Взять их
   * значило бы показать оператору чат, в котором он не собеседник.
   */
  it('групповой чат не попадает в скриньку', () => {
    const group = { ...TEXT, senderData: { ...TEXT.senderData, chatId: '380@g.us' } };
    expect(readGreen(group)).toBeNull();
  });

  /*
   * Сообщение, отправленное с телефона самим владельцем, — тоже часть
   * переписки. Без него оператор видит вопросы клиента без ответов и
   * пишет второй раз то, что уже сказали голосом.
   */
  it('своё сообщение с телефона тоже забирается, но помечено исходящим', () => {
    const own = { ...TEXT, typeWebhook: 'outgoingMessageReceived' };
    const m = readGreen(own);
    expect(m?.incoming).toBe(false);

    const u = normalizeGateway(m!, { tenantId: 't1', channelId: 'c1' });
    expect(u?.direction).toBe('out');
    expect(u?.senderType).toBe('agent');
  });

  it('файл приходит вложением, а подпись — текстом', () => {
    const file = {
      ...TEXT,
      messageData: {
        typeMessage: 'imageMessage',
        fileMessageData: {
          downloadUrl: 'https://example.invalid/a.jpg',
          fileName: 'фарба.jpg',
          mimeType: 'image/jpeg',
          caption: 'ось стіна',
        },
      },
    };
    const u = normalizeGateway(readGreen(file)!, { tenantId: 't1', channelId: 'c1' });
    expect(u?.content.text).toBe('ось стіна');
    expect(u?.content.attachments?.[0]).toMatchObject({ type: 'image', filename: 'фарба.jpg' });
  });

  it('пустое сообщение не создаёт диалог', () => {
    const empty = {
      ...TEXT,
      messageData: { typeMessage: 'textMessage', textMessageData: { textMessage: '' } },
    };
    expect(readGreen(empty)).toBeNull();
  });
});

describe('сообщение шлюза в общей ленте', () => {
  it('приводится к общему виду и приносит телефон', () => {
    const u = normalizeGateway(readGreen(TEXT)!, { tenantId: 't1', channelId: 'c1' });
    expect(u?.channelType).toBe(WHATSAPP_USER_CHANNEL);
    expect(u?.peerId).toBe('380509876543@c.us');
    // Телефон — примета, по которой клиент находится в CRM и в других
    // каналах. Без него он остался бы отдельным человеком в каждом.
    expect(u?.peerProfile.phone).toBe('+380509876543');
    expect(u?.direction).toBe('in');
  });

  it('номер и идентификатор чата переводятся друг в друга', () => {
    expect(phoneToChat('+38 (050) 987-65-43')).toBe('380509876543@c.us');
    expect(chatToPhone('380509876543@c.us')).toBe('+380509876543');
    // Слишком короткое — не номер, а мусор: лучше ничего, чем «+380».
    expect(chatToPhone('380@c.us')).toBeNull();
    expect(phoneToChat('')).toBe('');
  });
});

describe('ключи инстанса', () => {
  it('проверяются на вид, а не на непустоту', () => {
    expect(gatewayCredsOk({ idInstance: '7103000000', apiToken: 'a'.repeat(40) })).toBe(true);
    expect(gatewayCredsOk({ idInstance: '', apiToken: 'a'.repeat(40) })).toBe(false);
    // Опечатка в номере инстанса не должна уходить в сеть.
    expect(gatewayCredsOk({ idInstance: '710300abc', apiToken: 'a'.repeat(40) })).toBe(false);
    expect(gatewayCredsOk({ idInstance: '7103000000', apiToken: 'short' })).toBe(false);
  });
});
