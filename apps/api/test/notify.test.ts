import { describe, expect, it } from 'vitest';
import { checkConfig, cleanChannels, cleanEvents } from '../src/notify.js';

/**
 * Настройка адресата проверяется до сохранения, а не в тот момент,
 * когда оповещение не пришло: это ровно тот момент, когда человек на
 * него рассчитывал.
 */

describe('телеграм-адресат', () => {
  it('без бота и группы не сохраняется', () => {
    expect(checkConfig('telegram', {})).toContain('бота');
    expect(checkConfig('telegram', { channelId: 'ch1' })).toContain('групи');
  });

  it('имя группы вместо номера отклоняется: для групп оно не работает', () => {
    expect(checkConfig('telegram', { channelId: 'ch1', chatId: '@support' })).toContain('число');
  });

  it('без канала, но со своим токеном — сохраняется', () => {
    // У большинства канала-бота нет вовсе: клиенты пишут в Instagram и
    // на номер. Требовать ради оповещений лишний канал — значит не
    // получить оповещений.
    expect(checkConfig('telegram', { chatId: '-4846124329' }, true)).toBeNull();
    expect(checkConfig('telegram', { chatId: '-4846124329' }, false)).toContain('токен');
  });

  it('свой токен не отменяет проверку группы', () => {
    expect(checkConfig('telegram', {}, true)).toContain('групи');
  });

  it('отрицательный номер группы — это норма', () => {
    expect(checkConfig('telegram', { channelId: 'ch1', chatId: '-4846124329' })).toBeNull();
    expect(checkConfig('telegram', { channelId: 'ch1', chatId: '-1001234567890' })).toBeNull();
  });
});

describe('почтовый адресат', () => {
  it('пустой адрес не проходит', () => {
    expect(checkConfig('email', { to: '' })).toContain('адресу');
  });

  it('опечатка называется вслух', () => {
    const problem = checkConfig('email', { to: 'ok@example.com, сломанный' });
    expect(problem).toContain('сломанный');
  });

  it('несколько адресов через запятую — обычный случай', () => {
    expect(checkConfig('email', { to: 'a@example.com, b@example.com' })).toBeNull();
  });
});

describe('подписка на события', () => {
  it('чужое событие не попадает в подписку', () => {
    expect(cleanEvents(['conversation.new', 'drop.table'])).toEqual(['conversation.new']);
  });

  it('повтор не удваивает подписку', () => {
    expect(cleanEvents(['ai.handoff', 'ai.handoff'])).toEqual(['ai.handoff']);
  });

  it('мусор вместо списка — это пустой список, а не падение', () => {
    expect(cleanEvents(null)).toEqual([]);
    expect(cleanEvents('conversation.new')).toEqual([]);
  });
});

/*
 * Каналы читаются наоборот событиям: пусто — значит все. Событие
 * выбирают осознанно, а каналы у большинства компаний не выбирают
 * вовсе, и «жодного каналу» не хочет никто.
 */
describe('канали адресата', () => {
  const one = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
  const two = '110ec58a-a0f2-4ac4-8393-c866d813b8d1';

  it('берём только опознаватели своих каналов', () => {
    expect(cleanChannels([one, 'усі', two])).toEqual([one, two]);
    expect(cleanChannels('усі')).toEqual([]);
    expect(cleanChannels(undefined)).toEqual([]);
  });

  it('повтор в списке — одна подписка', () => {
    expect(cleanChannels([one, one])).toEqual([one]);
  });
});
