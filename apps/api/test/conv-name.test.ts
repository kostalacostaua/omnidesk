import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Как подписан чат в списке.
 *
 * Имени у собеседника может не быть вовсе: номерной WhatsApp заводит
 * контакт исходящим с телефона, и до первого ответа клиента имя
 * неизвестно. Несколько чатов, подписанных «Без імені», в списке
 * выглядят одним и тем же человеком. Телефон говорит мало, но
 * различает — и его мы и так знаем.
 */
const SRC = readFileSync(new URL('../src/ui.ts', import.meta.url), 'utf8');

const fn = (() => {
  const from = SRC.indexOf('function convName(c){');
  expect(from).toBeGreaterThan(0);
  return SRC.slice(from, SRC.indexOf('}', from));
})();

describe('подпись чата в списке', () => {
  it('без имени показывает телефон, а не «Без імені»', () => {
    expect(fn).toContain('c.display_name || c.phone_e164');
    expect(fn).toContain("L('Без імені')");
  });

  it('используется в строке списка', () => {
    expect(SRC).toContain("'<div class=\"r1\"><span class=\"nm\">' + esc(convName(c))");
  });

  /* Телефон приходит тем же запросом, что и имя: выдумывать для этого
     второе обращение было бы незачем. */
  it('телефон для этого уже есть в ответе списка', () => {
    const inbox = readFileSync(new URL('../src/inbox.ts', import.meta.url), 'utf8');
    expect(inbox).toContain('ct.phone_e164');
  });
});
