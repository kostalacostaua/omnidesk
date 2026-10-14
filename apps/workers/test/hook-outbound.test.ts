import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Событие об исходящем сообщении.
 *
 * Запрос брал текст как m.text, а такой колонки у сообщения нет: текст
 * лежит в content. Postgres отвечал «column m.text does not exist», и
 * ошибка уходила в лог одной строкой — наружу это выглядело как
 * «вебхуки интеграции просто не приходят», без единой зацепки.
 *
 * Проверяется не поведение запроса, а то, из чего берётся текст:
 * именно подмена источника и была ошибкой.
 */
const SRC = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

const sql = (() => {
  const at = SRC.indexOf('async function hookOutboundInner');
  expect(at).toBeGreaterThan(0);
  const open = SRC.indexOf('`SELECT', at);
  const close = SRC.indexOf('`', open + 1);
  return SRC.slice(open + 1, close);
})();

describe('событие об исходящем', () => {
  it('берёт текст из content, а не из несуществующей колонки', () => {
    expect(sql).toContain("m.content->>'text' AS text");
  });

  it('не обращается к m.text', () => {
    expect(sql).not.toMatch(/\bm\.text\b/);
  });

  /* Остальные поля колонками являются и должны остаться как есть. */
  it('прочие поля читаются по-прежнему', () => {
    expect(sql).toContain('m.status');
    expect(sql).toContain('m.external_id');
    expect(sql).toContain('m.conversation_id');
  });
});
