import { describe, expect, it } from 'vitest';
import {
  WHATSAPP_USER_CHANNEL,
  chatToPhone,
  normalizeGateway,
  phoneToChat,
  type GatewayMessage,
} from '../src/gateway.js';

/*
 * Номерной WhatsApp в общей ленте.
 *
 * Сообщение приходит из живой сессии — разбирает его служба сессий, а
 * здесь проверяется то, что делает его частью продукта: телефон как
 * примета клиента, направление, вложения и границы.
 */

const IN: GatewayMessage = {
  id: 'F7AEC1B7086ECDC7E6E45923F5EDB825',
  chatId: '380509876543@s.whatsapp.net',
  name: 'Валентина',
  text: 'Скільки коштує?',
  incoming: true,
  at: '2026-09-26T11:20:00.000Z',
};

describe('сообщение номерного WhatsApp', () => {
  it('приводится к общему виду и приносит телефон', () => {
    const u = normalizeGateway(IN, { tenantId: 't1', channelId: 'c1' });
    expect(u?.channelType).toBe(WHATSAPP_USER_CHANNEL);
    expect(u?.externalId).toBe(IN.id);
    expect(u?.peerId).toBe('380509876543@s.whatsapp.net');
    // Телефон — примета, по которой клиент находится в CRM и в других
    // каналах. Без него он был бы отдельным человеком в каждом.
    expect(u?.peerProfile.phone).toBe('+380509876543');
    expect(u?.direction).toBe('in');
    expect(u?.senderType).toBe('customer');
  });

  /*
   * Сообщение, отправленное владельцем с телефона, — тоже часть
   * переписки. Без него оператор видит вопросы клиента без ответов и
   * говорит второй раз то, что уже сказали голосом.
   */
  it('своё сообщение с телефона помечено исходящим', () => {
    const u = normalizeGateway({ ...IN, incoming: false }, { tenantId: 't1', channelId: 'c1' });
    expect(u?.direction).toBe('out');
    expect(u?.senderType).toBe('agent');
  });

  /*
   * Файл у WhatsApp отдаётся зашифрованным и по одноразовому адресу,
   * поэтому его скачивает сессия и кладёт в наше хранилище. Наружу
   * идёт ключ хранилища, а не чужая ссылка, которая протухнет.
   */
  it('файл приходит вложением с ключом хранилища', () => {
    const u = normalizeGateway(
      { ...IN, text: 'ось стіна', fileKey: 'wa/t1/c1/abc', fileName: 'фарба.jpg', mime: 'image/jpeg' },
      { tenantId: 't1', channelId: 'c1' },
    );
    expect(u?.content.text).toBe('ось стіна');
    expect(u?.content.attachments?.[0]).toMatchObject({
      type: 'image',
      storageKey: 'wa/t1/c1/abc',
      filename: 'фарба.jpg',
      ready: true,
    });
  });

  it('тип вложения берётся из MIME, а не из имени файла', () => {
    const kind = (mime: string) =>
      normalizeGateway({ ...IN, text: null, fileKey: 'k', mime }, { tenantId: 't', channelId: 'c' })
        ?.content.attachments?.[0]?.type;
    expect(kind('image/png')).toBe('image');
    expect(kind('video/mp4')).toBe('video');
    expect(kind('audio/ogg')).toBe('audio');
    // В нашей модели вложений «чего угодно» нет: всё прочее — документ.
    expect(kind('application/pdf')).toBe('document');
  });

  it('пустое сообщение не создаёт диалог', () => {
    expect(normalizeGateway({ ...IN, text: null }, { tenantId: 't1', channelId: 'c1' })).toBeNull();
  });
});

describe('номер и чат', () => {
  it('переводятся друг в друга', () => {
    expect(phoneToChat('+38 (050) 987-65-43')).toBe('380509876543@c.us');
    expect(chatToPhone('380509876543@s.whatsapp.net')).toBe('+380509876543');
    // Слишком короткое — не номер, а мусор: лучше ничего, чем «+380».
    expect(chatToPhone('380@c.us')).toBeNull();
    expect(phoneToChat('')).toBe('');
    /*
     * Внутренний номер WhatsApp — не телефон, хотя цифр столько же.
     * Принять его за номер значит завести клиента с несуществующим
     * телефоном, а потом свести по нему двух разных людей.
     */
    expect(chatToPhone('213547778889990@lid')).toBeNull();
  });
});
