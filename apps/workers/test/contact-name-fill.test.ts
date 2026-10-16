import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Имя контакта, которое стало известно позже.
 *
 * Имя ставится при создании контакта, и до номерного WhatsApp другого
 * случая не было: в первом же сообщении оно есть. А здесь контакт
 * заводит исходящее с телефона владельца, в котором имени собеседника
 * нет вовсе, — и чат оставался безымянным навсегда, потому что имя
 * второй раз никто не записывал.
 *
 * Пустое поле заполняем, заполненное не трогаем: там может стоять то,
 * что вписал оператор.
 */
const SRC = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

const block = (() => {
  const from = SRC.indexOf('SET display_name = $2');
  expect(from).toBeGreaterThan(0);
  return SRC.slice(from - 200, from + 200);
})();

describe('имя известного контакта', () => {
  it('заполняется, когда его не было', () => {
    expect(block).toContain('msg.peerProfile.name');
    expect(block).toContain("display_name IS NULL OR display_name = ''");
  });
});
