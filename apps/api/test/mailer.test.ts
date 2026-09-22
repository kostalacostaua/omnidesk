import { describe, expect, it } from 'vitest';
import { createMailer, MailError } from '../src/mailer.js';

const mail = { to: 'a@b.co', subject: '123456 — код', text: 't', html: '<p>h</p>' };

describe('createMailer', () => {
  it('без настроек пишет в лог и ничего не отправляет', async () => {
    const lines: string[] = [];
    const m = createMailer({}, (l) => lines.push(l), () => {
      throw new Error('сеть трогать нельзя');
    });
    expect(m.kind).toBe('log');
    await m.send(mail);
    expect(lines[0]).toContain('a@b.co');
  });

  it('Resend: правильный адрес, ключ и тело', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const m = createMailer(
      { RESEND_API_KEY: 're_test', MAIL_FROM: 'OmniDesk <no-reply@omni.ua>' },
      () => {},
      (async (url: string, init: RequestInit) => {
        seen = { url, init };
        return new Response('{"id":"x"}', { status: 200 });
      }) as typeof fetch,
    );
    expect(m.kind).toBe('resend');
    await m.send(mail);
    expect(seen!.url).toBe('https://api.resend.com/emails');
    expect((seen!.init.headers as Record<string, string>).authorization).toBe('Bearer re_test');
    const body = JSON.parse(String(seen!.init.body));
    expect(body).toMatchObject({ from: 'OmniDesk <no-reply@omni.ua>', to: ['a@b.co'], subject: mail.subject });
  });

  it('Resend: ошибка несёт текст ответа, а не только код', async () => {
    const m = createMailer(
      { RESEND_API_KEY: 'k' },
      () => {},
      (async () => new Response('{"message":"The omni.ua domain is not verified"}', { status: 403 })) as typeof fetch,
    );
    await expect(m.send(mail)).rejects.toThrow(/not verified/);
    await expect(m.send(mail)).rejects.toBeInstanceOf(MailError);
  });

  it('Resend выбирается раньше SMTP: SMTP на Railway закрыт', () => {
    const m = createMailer({ RESEND_API_KEY: 'k', SMTP_URL: 'smtps://u:p@h:465' }, () => {});
    expect(m.kind).toBe('resend');
  });
});
