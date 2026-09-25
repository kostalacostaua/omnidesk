import { describe, expect, it } from 'vitest';
import {
  guessMailbox,
  isMicrosoftMail,
  mailDomain,
  mailboxReceived,
  parseMailbox,
} from '../src/mailbox.js';
import { normalizeEmail } from '../src/email.js';

describe('настройки ящика', () => {
  it('известной службе подставляем её адреса', () => {
    const g = guessMailbox('info@gmail.com');
    expect(g.imap.host).toBe('imap.gmail.com');
    expect(g.smtp.port).toBe(465);
    expect(g.note).toContain('пароль застосунку');
  });

  it('незнакомому домену — правило imap.домен: так настроено почти везде', () => {
    const g = guessMailbox('info@klsystems.com.ua');
    expect(g.imap.host).toBe('imap.klsystems.com.ua');
    expect(g.smtp.host).toBe('smtp.klsystems.com.ua');
  });

  it('Microsoft отказываем сразу: вход по паролю там закрыт', () => {
    expect(isMicrosoftMail('outlook.com')).toBe(true);
    expect(isMicrosoftMail('mail.office365.com')).toBe(true);
    expect(isMicrosoftMail('klsystems.com.ua')).toBe(false);
    expect(parseMailbox({ address: 'a@outlook.com', pass: 'x' })).toEqual({
      error: 'microsoft_mail',
    });
  });

  it('адрес и пароль обязательны, остальное можно не вписывать', () => {
    expect(parseMailbox({ address: 'не адрес', pass: 'x' })).toEqual({ error: 'bad_address' });
    expect(parseMailbox({ address: 'a@b.com', pass: '' })).toEqual({ error: 'no_password' });

    const ok = parseMailbox({ address: 'Info@Firma.COM', pass: 'secret' });
    expect('creds' in ok && ok.creds.address).toBe('info@firma.com');
    expect('creds' in ok && ok.creds.user).toBe('info@firma.com');
    expect('creds' in ok && ok.creds.imap.host).toBe('imap.firma.com');
  });

  it('порт решает, шифруется ли соединение с первого байта', () => {
    const tls = parseMailbox({ address: 'a@b.com', pass: 'x', smtp: { host: 'smtp.b.com', port: 465 } });
    const start = parseMailbox({ address: 'a@b.com', pass: 'x', smtp: { host: 'smtp.b.com', port: 587 } });
    expect('creds' in tls && tls.creds.smtp.secure).toBe(true);
    expect('creds' in start && start.creds.smtp.secure).toBe(false);
  });

  it('сервер с мусором вместо имени не принимаем', () => {
    expect(parseMailbox({ address: 'a@b.com', pass: 'x', imap: { host: 'ftp://ой', port: 993 } }))
      .toEqual({ error: 'bad_imap' });
    expect(parseMailbox({ address: 'a@b.com', pass: 'x', smtp: { host: 'smtp.b.com', port: 0 } }))
      .toEqual({ error: 'bad_smtp' });
  });

  it('логин отдельно от адреса: у части хостингов он другой', () => {
    const ok = parseMailbox({ address: 'a@b.com', pass: 'x', user: 'b.com_a' });
    expect('creds' in ok && ok.creds.user).toBe('b.com_a');
  });

  it('домен адреса берём после последней собачки', () => {
    expect(mailDomain('a+b@c@firma.com')).toBe('firma.com');
    expect(mailDomain('нет')).toBe('');
  });
});

/** Письмо в том виде, в каком его отдаёт разборщик MIME. */
const MAIL = {
  messageId: '<abc@mail.firma.com>',
  subject: 'Рахунок',
  text: 'Доброго дня, надішліть рахунок.',
  html: '<p>Доброго дня</p>',
  date: new Date('2026-09-25T08:30:00.000Z'),
  from: { text: 'Оля <olya@client.com>', value: [{ address: 'olya@client.com', name: 'Оля' }] },
  to: { value: [{ address: 'info@firma.com' }] },
  cc: { value: [{ address: 'boss@firma.com' }] },
  references: ['<x@1>', '<y@2>'],
  attachments: [
    { filename: 'invoice.pdf', contentType: 'application/pdf', size: 1024 },
    { filename: '', contentType: 'image/png', size: 10, contentDisposition: 'inline' },
  ],
};

describe('письмо из ящика', () => {
  const got = mailboxReceived(MAIL, 42);

  it('приводится к тому же виду, что и письмо с поддомена', () => {
    expect(got.id).toBe('<abc@mail.firma.com>');
    expect(got.subject).toBe('Рахунок');
    expect(got.to).toEqual(['info@firma.com']);
    expect(got.cc).toEqual(['boss@firma.com']);
    expect(got.headers?.references).toBe('<x@1> <y@2>');
  });

  it('картинки из тела письма вложениями не считаются', () => {
    expect(got.attachments).toHaveLength(1);
    expect(got.attachments?.[0]?.filename).toBe('invoice.pdf');
  });

  it('без Message-ID опираемся на номер письма, иначе полезут дубли', () => {
    const anon = mailboxReceived({ ...MAIL, messageId: null }, 77);
    expect(anon.id).toBe('uid-77');
  });

  it('дальше по дороге это обычное сообщение ленты', () => {
    const m = normalizeEmail({ tenantId: 't', channelId: 'c' }, got);
    expect(m?.content.text).toBe('Доброго дня, надішліть рахунок.');
    expect(m?.peerProfile?.email).toBe('olya@client.com');
    expect(m?.content.email?.subject).toBe('Рахунок');
  });
});

describe('адрес почтового сервера', () => {
  it('имя превращается в IPv4, а само уходит в servername', async () => {
    const { mailAddress } = await import('../src/mailbox.js');
    const got = await mailAddress('imap.gmail.com');
    // Сертификат выписан на имя, поэтому имя обязано уехать отдельно.
    expect(got.servername).toBe('imap.gmail.com');
    expect(got.host).toMatch(/^[0-9]+[.][0-9]+[.][0-9]+[.][0-9]+$/);
  });

  it('без A-записи возвращаем имя как было: пусть решает система', async () => {
    const { mailAddress } = await import('../src/mailbox.js');
    expect(await mailAddress('imap.firma.invalid')).toEqual({ host: 'imap.firma.invalid' });
  });
});
