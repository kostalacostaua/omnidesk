import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  addressDomain,
  fromHeader,
  header,
  htmlToText,
  normalizeEmail,
  parseAddress,
  replySubject,
  threadHeaders,
  verifyResendSignature,
} from '../src/email.js';

const ctx = { tenantId: 't1', channelId: 'ch1' };

describe('адрес отправителя', () => {
  it('имя и адрес из углового вида', () => {
    expect(parseAddress('Оля Петренко <Olya@Firma.com>')).toEqual({
      email: 'olya@firma.com',
      name: 'Оля Петренко',
    });
  });

  it('имя в кавычках кавычек не сохраняет', () => {
    expect(parseAddress('"Петренко, Оля" <olya@firma.com>').name).toBe('Петренко, Оля');
  });

  it('голый адрес тоже понимаем', () => {
    expect(parseAddress('olya@firma.com')).toEqual({ email: 'olya@firma.com' });
    expect(parseAddress('<olya@firma.com>')).toEqual({ email: 'olya@firma.com' });
  });

  it('пусто — пусто, а не падение', () => {
    expect(parseAddress(undefined).email).toBe('');
    expect(parseAddress('').email).toBe('');
  });

  it('домен берётся после последней собаки', () => {
    expect(addressDomain('olya@firma.com')).toBe('firma.com');
    expect(addressDomain('Olya@Help.Firma.com')).toBe('help.firma.com');
    expect(addressDomain('без собаки')).toBe('');
  });
});

describe('текст из html', () => {
  it('разметка убирается, текст остаётся', () => {
    expect(htmlToText('<p>Привіт, <b>Олю</b>!</p>')).toBe('Привіт, Олю !');
  });

  it('стили и скрипты в ленту не попадают', () => {
    const html = '<style>.a{color:red}</style><script>alert(1)</script><p>Текст</p>';
    expect(htmlToText(html)).toBe('Текст');
  });

  it('переводы строк из абзацев и переносов', () => {
    expect(htmlToText('<div>Перший</div><div>Другий</div>')).toBe('Перший\nДругий');
    expect(htmlToText('Рядок<br>Інший')).toBe('Рядок\nІнший');
  });

  it('подстановки превращаются обратно в символы', () => {
    expect(htmlToText('<p>Ціна &lt; 100 &amp; більше</p>')).toBe('Ціна < 100 & більше');
  });

  it('пусто — пустая строка', () => {
    expect(htmlToText(null)).toBe('');
    expect(htmlToText('')).toBe('');
  });
});

describe('тема ответа', () => {
  it('Re: ставится один раз', () => {
    expect(replySubject('Ціна')).toBe('Re: Ціна');
    expect(replySubject('Re: Ціна')).toBe('Re: Ціна');
    expect(replySubject('RE:Ціна')).toBe('RE:Ціна');
  });

  it('пустая тема остаётся пустой по смыслу', () => {
    expect(replySubject('')).toBe('Re:');
    expect(replySubject(undefined)).toBe('Re:');
  });
});

describe('заголовки цепочки', () => {
  it('первый ответ ссылается на письмо клиента', () => {
    expect(threadHeaders('<a@mail>', undefined)).toEqual({
      'In-Reply-To': '<a@mail>',
      References: '<a@mail>',
    });
  });

  it('цепочка накапливается', () => {
    expect(threadHeaders('<b@mail>', '<a@mail>').References).toBe('<a@mail> <b@mail>');
  });

  it('без письма-родителя заголовков нет', () => {
    expect(threadHeaders(null, '<a@mail>')).toEqual({});
  });
});

describe('подпись вебхука Resend', () => {
  const secret = 'whsec_' + Buffer.from('очень секретный ключ').toString('base64');
  const body = Buffer.from(JSON.stringify({ type: 'email.received' }));
  const id = 'msg_123';
  const now = new Date('2026-05-01T12:00:00Z');
  const ts = String(Math.floor(now.getTime() / 1000));

  function sign(secretValue: string, when: string, msgId = id, payload = body): string {
    const key = Buffer.from(secretValue.slice(6), 'base64');
    return (
      'v1,' +
      createHmac('sha256', key).update(`${msgId}.${when}.${payload.toString('utf8')}`).digest('base64')
    );
  }

  it('своя подпись проходит', () => {
    const sig = sign(secret, ts);
    expect(verifyResendSignature(body, { id, timestamp: ts, signature: sig }, secret, now)).toBe(true);
  });

  it('несколько подписей в заголовке — достаточно одной верной', () => {
    const sig = 'v1,ЧУЖАЯ ' + sign(secret, ts);
    expect(verifyResendSignature(body, { id, timestamp: ts, signature: sig }, secret, now)).toBe(true);
  });

  it('чужой секрет не проходит', () => {
    const other = 'whsec_' + Buffer.from('другой ключ').toString('base64');
    const sig = sign(other, ts);
    expect(verifyResendSignature(body, { id, timestamp: ts, signature: sig }, secret, now)).toBe(false);
  });

  it('подменённое тело не проходит', () => {
    const sig = sign(secret, ts);
    const evil = Buffer.from(JSON.stringify({ type: 'email.received', evil: true }));
    expect(verifyResendSignature(evil, { id, timestamp: ts, signature: sig }, secret, now)).toBe(false);
  });

  it('старый запрос не принимается второй раз спустя час', () => {
    const sig = sign(secret, ts);
    const later = new Date(now.getTime() + 3600_000);
    expect(verifyResendSignature(body, { id, timestamp: ts, signature: sig }, secret, later)).toBe(false);
  });

  it('без заголовков и без секрета — отказ', () => {
    expect(verifyResendSignature(body, {}, secret, now)).toBe(false);
    expect(verifyResendSignature(body, { id, timestamp: ts, signature: 'v1,x' }, '', now)).toBe(false);
  });
});

describe('письмо в сообщение', () => {
  const mail = {
    id: 'em_1',
    from: 'Оля Петренко <olya@firma.com>',
    to: ['support@help.romashka.com'],
    subject: 'Ціна на фарбу',
    text: 'Скільки коштує 10 л?',
    message_id: '<abc@firma.com>',
    created_at: '2026-05-01T10:00:00.000Z',
    headers: { References: '<old@firma.com>', 'Return-Path': 'olya@firma.com' },
  };

  it('входящее письмо становится сообщением', () => {
    const m = normalizeEmail(ctx, mail)!;
    expect(m).toMatchObject({
      channelType: 'email',
      externalId: 'em_1',
      peerId: 'olya@firma.com',
      direction: 'in',
      senderType: 'customer',
    });
    expect(m.content.text).toBe('Скільки коштує 10 л?');
    expect(m.peerProfile.name).toBe('Оля Петренко');
    expect(m.sentAt.toISOString()).toBe('2026-05-01T10:00:00.000Z');
  });

  it('тема и цепочка сохраняются рядом с текстом', () => {
    const m = normalizeEmail(ctx, mail)!;
    expect(m.content.email).toMatchObject({
      subject: 'Ціна на фарбу',
      messageId: '<abc@firma.com>',
      references: '<old@firma.com>',
      to: ['support@help.romashka.com'],
    });
  });

  it('без текста берётся html', () => {
    const m = normalizeEmail(ctx, { ...mail, text: null, html: '<p>Привіт</p>' })!;
    expect(m.content.text).toBe('Привіт');
  });

  it('пустое письмо всё равно видно', () => {
    const m = normalizeEmail(ctx, { ...mail, text: '  ', html: null })!;
    expect(m.content.text).toBeTruthy();
  });

  it('вложения приходят описанием, а не содержимым', () => {
    const m = normalizeEmail(ctx, {
      ...mail,
      attachments: [
        { id: 'a1', filename: 'прайс.pdf', content_type: 'application/pdf', size: 1024 },
        { id: 'a2', filename: 'фото.png', content_type: 'image/png', size: 2048 },
      ],
    })!;
    expect(m.content.attachments).toEqual([
      { type: 'document', externalId: 'a1', filename: 'прайс.pdf', mime: 'application/pdf', size: 1024 },
      { type: 'image', externalId: 'a2', filename: 'фото.png', mime: 'image/png', size: 2048 },
    ]);
  });

  it('письмо без отправителя или без идентификатора отбрасывается', () => {
    expect(normalizeEmail(ctx, { ...mail, from: '' })).toBeNull();
    expect(normalizeEmail(ctx, { ...mail, id: undefined })).toBeNull();
  });

  it('заголовок читается без оглядки на регистр', () => {
    expect(header(mail, 'references')).toBe('<old@firma.com>');
    expect(header(mail, 'RETURN-PATH')).toBe('olya@firma.com');
    expect(header(mail, 'нет такого')).toBeUndefined();
  });
});

describe('отправитель ответа', () => {
  it('имя компании перед адресом', () => {
    expect(fromHeader('Ромашка', 'support@help.romashka.com')).toBe(
      'Ромашка <support@help.romashka.com>',
    );
  });

  it('без имени — голый адрес', () => {
    expect(fromHeader('', 'a@b.com')).toBe('a@b.com');
    expect(fromHeader(null, 'a@b.com')).toBe('a@b.com');
  });

  it('кавычки и переводы строк в имени не проходят: это подделка заголовка', () => {
    expect(fromHeader('Зло"\r\nBcc: all@list', 'a@b.com')).toBe('ЗлоBcc: all@list <a@b.com>');
  });
});
