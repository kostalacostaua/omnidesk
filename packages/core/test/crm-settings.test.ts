import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CRM_SETTINGS_DEFAULT, crmSource, parseCrmSettings } from '../src/crm-settings.js';

/**
 * Настройка связки меняет то, что видит отдел продаж в своей CRM.
 * Ошибка здесь стоит дороже обычной: карточки заводятся не в тот
 * модуль, и заметить это можно через неделю, когда их уже сотня.
 */

describe('разбор настроек связки', () => {
  it('пусто означает прежнее поведение: лид и без назначения', () => {
    expect(parseCrmSettings({})).toEqual(CRM_SETTINGS_DEFAULT);
    expect(parseCrmSettings(null).createAs).toBe('lead');
  });

  it('чужое значение не заводит карточку в несуществующий модуль', () => {
    expect(parseCrmSettings({ createAs: 'Deals' }).createAs).toBe('lead');
    expect(parseCrmSettings({ createAs: 'contact' }).createAs).toBe('contact');
  });

  it('назначение включается только явным «да»', () => {
    // Строка «false» из формы не должна включать назначение, а именно
    // так приходит непроверенная галочка.
    expect(parseCrmSettings({ ownerByEmail: 'false' }).ownerByEmail).toBe(false);
    expect(parseCrmSettings({ ownerByEmail: 1 }).ownerByEmail).toBe(false);
    expect(parseCrmSettings({ ownerByEmail: true }).ownerByEmail).toBe(true);
  });
});

describe('источник для CRM', () => {
  it('у каждого канала есть человеческое имя', () => {
    /*
     * Список каналов существует только как тип, поэтому берётся из
     * исходника. Смысл проверки в будущем: кто-то добавит канал и не
     * вспомнит про источник, а узнает об этом отдел продаж, увидев в
     * своём отчёте строку «carrier_pigeon».
     */
    const src = readFileSync(
      join(import.meta.dirname, '..', 'src', 'types.ts'),
      'utf8',
    );
    const block = src.slice(src.indexOf('export type ChannelType ='));
    const union = block.slice(0, block.indexOf(';'));
    const types = [...union.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);

    expect(types.length).toBeGreaterThan(5);
    expect(types.filter((t) => crmSource(t) === t)).toEqual([]);
  });

  it('незнакомый канал отдаётся как есть, а не пустотой', () => {
    // Пустой источник хуже некрасивого: по нему потом не понять,
    // откуда пришёл человек.
    expect(crmSource('карбюратор')).toBe('карбюратор');
  });

  it('все виды Telegram сходятся в один источник', () => {
    expect(crmSource('telegram_bot')).toBe('Telegram');
    expect(crmSource('telegram_user')).toBe('Telegram');
    expect(crmSource('telegram_business')).toBe('Telegram');
  });
});
