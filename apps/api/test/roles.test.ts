import { describe, expect, it } from 'vitest';
import { requiredLevel, roleAllows } from '../src/roles.js';

/**
 * Права — единственное место, где ошибка не видна глазом. Оператор,
 * которому случайно оставили настройки, отключит канал не со зла, а по
 * дороге; наблюдатель, которому дали писать, ответит клиенту от имени
 * компании. Поэтому таблица прав проверяется по каждому разделу.
 */

describe('какой уровень нужен запросу', () => {
  it('чтение открыто всем вошедшим: списки нужны фильтрам и подписям', () => {
    expect(requiredLevel('GET', '/channels')).toBe('any');
    expect(requiredLevel('GET', '/users')).toBe('any');
    expect(requiredLevel('GET', '/settings/ai')).toBe('any');
  });

  it('настройка сервиса — только администратору', () => {
    expect(requiredLevel('POST', '/channels/telegram')).toBe('admin');
    expect(requiredLevel('DELETE', '/channels/abc')).toBe('admin');
    expect(requiredLevel('PUT', '/settings/ai')).toBe('admin');
    expect(requiredLevel('POST', '/settings/ai/check')).toBe('admin');
    expect(requiredLevel('POST', '/scenarios')).toBe('admin');
    expect(requiredLevel('PATCH', '/users/u1')).toBe('admin');
    expect(requiredLevel('POST', '/quick-replies')).toBe('admin');
    expect(requiredLevel('POST', '/statuses')).toBe('admin');
    expect(requiredLevel('PATCH', '/statuses/s1')).toBe('admin');
    // А читать справочник обязан любой: статус стоит в шапке чата.
    expect(requiredLevel('GET', '/statuses')).toBe('any');
    expect(requiredLevel('PATCH', '/tenant')).toBe('admin');
  });

  it('работа с перепиской — уровень письма, а не настройки', () => {
    expect(requiredLevel('POST', '/conversations/c1/messages')).toBe('write');
    expect(requiredLevel('POST', '/conversations/c1/ai-draft')).toBe('write');
    expect(requiredLevel('POST', '/contacts/p1/crm')).toBe('write');
    expect(requiredLevel('POST', '/conversations/c1/read')).toBe('write');
  });

  it('своё имя и свой пароль меняет любой, даже наблюдатель', () => {
    expect(requiredLevel('PATCH', '/me')).toBe('any');
    expect(requiredLevel('PUT', '/me/password')).toBe('any');
    expect(requiredLevel('DELETE', '/me/password')).toBe('any');
  });

  it('вход, заявка с промо и приём обновлений проверяются не ролью', () => {
    expect(requiredLevel('POST', '/auth/request')).toBe('any');
    expect(requiredLevel('DELETE', '/auth/session')).toBe('any');
    expect(requiredLevel('POST', '/leads')).toBe('any');
    expect(requiredLevel('POST', '/webhooks/telegram/ch1')).toBe('any');
  });

  it('похожий адрес не считается разделом настроек', () => {
    // /channels-export — не /channels/…, и попасть под правило не должен.
    expect(requiredLevel('POST', '/channels-export')).toBe('write');
  });
});

describe('хватает ли роли', () => {
  it('владелец и администратор могут всё', () => {
    for (const role of ['owner', 'admin']) {
      expect(roleAllows(role, 'admin')).toBe(true);
      expect(roleAllows(role, 'write')).toBe(true);
    }
  });

  it('оператор отвечает клиентам, но не настраивает сервис', () => {
    expect(roleAllows('agent', 'write')).toBe(true);
    expect(roleAllows('agent', 'admin')).toBe(false);
  });

  it('наблюдатель только смотрит', () => {
    expect(roleAllows('viewer', 'any')).toBe(true);
    expect(roleAllows('viewer', 'write')).toBe(false);
    expect(roleAllows('viewer', 'admin')).toBe(false);
  });

  it('неизвестная роль не получает ничего сверх чтения', () => {
    expect(roleAllows('', 'write')).toBe(false);
    expect(roleAllows('kладовщик', 'admin')).toBe(false);
  });
});
