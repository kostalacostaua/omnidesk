import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { INBOX_HTML } from '../src/ui.js';

/**
 * Разговор открывается на последнем сообщении.
 *
 * Прокрутить в конец один раз после отрисовки недостаточно: картинки и
 * голосовые едут отдельными запросами и встают в ленту уже после неё.
 * Высота разом вырастает, и конец оказывается в середине — ровно то,
 * как разговор и открывался «где-то в центре».
 *
 * Ошибка зависит от скорости сети и в разборе скрипта не видна, поэтому
 * проверяется сам порядок: кто решает про конец и что его удерживает.
 */
const SRC = readFileSync(new URL('../src/ui.ts', import.meta.url), 'utf8');

describe('прокрутка ленты', () => {
  it('первая отрисовка уходит в конец независимо от прежней прокрутки', () => {
    expect(SRC).toContain('var wasBottom = threadFirst || isAtBottom();');
  });

  it('подъехавшее вложение возвращает ленту вниз', () => {
    expect(SRC).toMatch(/addEventListener\('load', keepEnd\)/);
    expect(SRC).toMatch(/addEventListener\('loadedmetadata', keepEnd\)/);
  });

  /* Видео и звук до метаданных считают свою высоту нулевой, поэтому
     слушать только картинки недостаточно. */
  it('слушаются все три вида вложений', () => {
    expect(SRC).toContain(".att img, .att video, .att audio");
  });

  /* Человек прокрутил вверх — лента перестаёт уезжать из-под него. */
  it('своя прокрутка отпускает конец', () => {
    expect(SRC).toMatch(/addEventListener\('scroll', function\(\)\{\s*stickEnd = isAtBottom\(\);/);
  });

  /* Поправка прокрутки самим браузером неотличима от прокрутки
     человеком, поэтому на открытии конец держится ещё и по времени. */
  it('на открытии конец удерживается по времени', () => {
    expect(SRC).toContain('if (first) pinEndUntil = Date.now() + 2500;');
    expect(SRC).toContain('if (stickEnd || Date.now() < pinEndUntil) scrollEnd();');
  });

  it('скрипт кабинета по-прежнему собирается целиком', () => {
    expect(INBOX_HTML).toContain('function keepEnd()');
  });
});
