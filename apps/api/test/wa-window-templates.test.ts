import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { isWindowOpen } from '@omnidesk/core';

/**
 * Первое сообщение в WhatsApp.
 *
 * Диалог, который начинаем мы сами, заводится без срока окна: клиент
 * в нём ещё не писал. Сервер читает это правильно — вне окна он
 * пропускает только шаблон. А кабинет читал пустой срок как «окна нет,
 * пиши что хочешь» и показывал обычное поле ответа. Оператор писал
 * текст, отправка не проходила, и выглядело это поломкой интерфейса.
 *
 * Поле, которое не работает, хуже закрытого поля: закрытое хотя бы
 * объясняет причину и предлагает шаблон.
 */
const UI = readFileSync(new URL('../src/ui.ts', import.meta.url), 'utf8');

const win = (() => {
  const from = UI.indexOf('function windowState(c){');
  expect(from).toBeGreaterThan(0);
  return UI.slice(from, UI.indexOf('\n}', from));
})();

describe('окно ответа без срока', () => {
  /* Ровно то же правило, что в ядре: там оно было верным с самого
     начала, разошёлся только кабинет. */
  it('у канала с окном считается закрытым', () => {
    expect(isWindowOpen({ type: 'standard', expiresAt: null })).toBe(false);
    expect(win).toContain("if (!c.window_expires_at) return { open:false }");
  });

  it('а у канала без окна — открытым', () => {
    expect(isWindowOpen({ type: 'none', expiresAt: null })).toBe(true);
    expect(win).toContain("c.window_type === 'none'");
  });

  /* Неизвестный тип окна считаем отсутствующим: так было раньше, и
     закрывать из-за него каналы, у которых окна нет, нельзя. */
  it('неизвестный тип не закрывает канал', () => {
    expect(win).toContain('!c.window_type');
  });

  /* Закрытое окно у WhatsApp ведёт к выбору шаблона, а не к тексту
     «нельзя». Ради этого всё и чинилось. */
  it('закрытое окно WhatsApp открывает выбор шаблона', () => {
    expect(UI).toContain('waTemplates(box, c)');
  });
});

describe('шаблоны видно до того, как они понадобятся', () => {
  /* Раньше их было видно только изнутри диалога с закрытым окном — то
     есть случайно. Вопрос «какие у меня шаблоны и схвалені ли они»
     задают раньше. */
  it('список есть на странице канала', () => {
    expect(UI).toContain('function waTplList(id){');
    expect(UI).toContain("id=\"waTplList\"");
  });

  it('только у официального WhatsApp', () => {
    const from = UI.indexOf('id="waTplList"');
    expect(from).toBeGreaterThan(0);
    expect(UI.slice(from - 900, from)).toContain("c.type === 'whatsapp'");
  });

  /* Пусто — обычное состояние нового номера, а не поломка. Говорим,
     что делать. */
  it('пустой список объясняет, что делать', () => {
    const fn = UI.slice(UI.indexOf('function waTplList(id){'));
    expect(fn.slice(0, 2000)).toContain('WhatsApp Manager');
  });
});
