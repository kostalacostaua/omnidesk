import { describe, expect, it } from 'vitest';
import { apiDomainFor, safeAccountsServer, zoneOf } from '../src/zoho.js';

/**
 * Эти проверки не про удобство, а про безопасность: адрес сервера
 * приходит из браузера, то есть им управляет кто угодно. Если пропустить
 * чужой домен, обмен кода уйдёт туда вместе с нашим client_secret.
 */
describe('сервер аккаунтов Zoho из callback', () => {
  it('принимает известные дата-центры', () => {
    expect(safeAccountsServer('https://accounts.zoho.eu')).toBe('https://accounts.zoho.eu');
    expect(safeAccountsServer('https://accounts.zoho.com')).toBe('https://accounts.zoho.com');
    expect(safeAccountsServer('https://accounts.zoho.com.au')).toBe('https://accounts.zoho.com.au');
  });

  /*
   * Без параметра Zoho никуда не переносила — значит зона та же, в
   * которой начался вход. Подставить сюда «нашу» европейскую значило
   * бы отправить обмен кода не на тот сервер; раньше так и было, и
   * клиент с организацией в зоне .com подключиться не мог.
   */
  it('без параметра остаётся там, где начинался вход', () => {
    expect(safeAccountsServer(undefined)).toBe('https://accounts.zoho.com');
    expect(safeAccountsServer(undefined, 'https://accounts.zoho.eu')).toBe(
      'https://accounts.zoho.eu',
    );
  });

  it('отклоняет чужой домен', () => {
    expect(safeAccountsServer('https://accounts.zoho.evil.com')).toBeNull();
    expect(safeAccountsServer('https://evil.com')).toBeNull();
  });

  it('отклоняет http и мусор', () => {
    expect(safeAccountsServer('http://accounts.zoho.eu')).toBeNull();
    expect(safeAccountsServer('accounts.zoho.eu')).toBeNull();
    expect(safeAccountsServer('javascript:alert(1)')).toBeNull();
  });

  it('отбрасывает путь и параметры, оставляя только имя сервера', () => {
    expect(safeAccountsServer('https://accounts.zoho.in/oauth/v2/auth?x=1')).toBe(
      'https://accounts.zoho.in',
    );
  });
});

describe('домен API той же зоны', () => {
  it('берёт из ответа Zoho, если он корректен', () => {
    expect(apiDomainFor('https://accounts.zoho.eu', 'https://www.zohoapis.eu')).toBe(
      'https://www.zohoapis.eu',
    );
  });

  it('канадское облако тоже допустимо', () => {
    expect(apiDomainFor('https://accounts.zohocloud.ca', 'https://www.zohoapis.ca')).toBe(
      'https://www.zohoapis.ca',
    );
  });

  it('подменённый домен в ответе игнорируется, зона берётся из адреса аккаунтов', () => {
    expect(apiDomainFor('https://accounts.zoho.eu', 'https://evil.com')).toBe(
      'https://www.zohoapis.eu',
    );
  });

  it('когда ответ пуст, собирается из зоны', () => {
    expect(apiDomainFor('https://accounts.zoho.in', undefined)).toBe('https://www.zohoapis.in');
  });
});

describe('зона из адреса сервера аккаунтов', () => {
  it('читает обычные зоны', () => {
    expect(zoneOf('https://accounts.zoho.com')).toBe('com');
    expect(zoneOf('https://accounts.zoho.eu')).toBe('eu');
    expect(zoneOf('https://accounts.zoho.com.au')).toBe('com.au');
  });

  /* Канадская зона входит через zohocloud.ca — правилом «отрезать
     accounts.zoho.» из неё получилась бы чепуха. */
  it('знает про канадское облако', () => {
    expect(zoneOf('https://accounts.zohocloud.ca')).toBe('ca');
  });
});
