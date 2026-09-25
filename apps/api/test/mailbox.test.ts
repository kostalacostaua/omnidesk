import { describe, expect, it } from 'vitest';
import { mailboxWhy } from '../src/mailbox.js';

/**
 * «Command failed» — фраза библиотеки, а не сервера: ответ лежит рядом,
 * и без него человек видит два слова по-английски.
 */
describe('отказ почтового сервера', () => {
  const imap = (responseText: string) =>
    Object.assign(new Error('Command failed'), { responseText });

  it('гугл просит пароль приложения — так и говорим', () => {
    expect(mailboxWhy(imap('[ALERT] Application-specific password required'))).toContain(
      'пароль застосунку',
    );
  });

  it('выключенный IMAP — это не пароль', () => {
    expect(mailboxWhy(imap('[ALERT] IMAP access is disabled for your domain'))).toContain('IMAP');
  });

  it('неверные доступы названы доступами', () => {
    expect(mailboxWhy(imap('[AUTHENTICATIONFAILED] Invalid credentials (Failure)'))).toContain(
      'адресу або пароль',
    );
  });

  it('незнакомый отказ отдаётся словами сервера, а не библиотеки', () => {
    expect(mailboxWhy(imap('Mailbox is locked by another session'))).toBe(
      'Mailbox is locked by another session',
    );
  });

  it('сеть отличается от пароля', () => {
    expect(mailboxWhy(new Error('getaddrinfo ENOTFOUND imap.firma.com'))).toContain('не знайдено');
    expect(mailboxWhy(new Error('connect ETIMEDOUT'))).toContain('не відповідає');
  });
});
