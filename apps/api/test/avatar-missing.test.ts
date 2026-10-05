import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Контакт без аватарки.
 *
 * У половины контактов лица нет вовсе, и запрос за ним делается на
 * каждой загрузке кабинета. Отвечать на это 404 — значит заполнять
 * консоль красными строками, среди которых настоящую ошибку уже никто
 * не разглядит. 204 говорит то же самое и не врёт: запрос удался,
 * отдавать нечего.
 */
const SRC = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

const route = (() => {
  const from = SRC.indexOf("'/avatars/:contactId'");
  expect(from).toBeGreaterThan(0);
  return SRC.slice(from, SRC.indexOf('\n});', from));
})();

describe('аватарка, которой нет', () => {
  it('отдаётся как «нечего отдавать», а не как ошибка', () => {
    expect(route).toContain('reply.code(204)');
    expect(route).not.toContain("reply.code(404).send({ error: 'no_avatar' })");
  });

  /* Перебор хранилища делается ради восстановления потерянной связи и
     стоит нескольких обращений к диску. Без кэша он повторялся бы на
     каждой загрузке кабинета для каждого контакта без лица. */
  it('отрицательный ответ недолго кэшируется', () => {
    expect(route).toMatch(/code\(204\)[\s\S]{0,120}cache-control/);
  });

  /* Найденная картинка по-прежнему отдаётся с длинным кэшем. */
  it('найденная аватарка отдаётся как раньше', () => {
    expect(route).toContain("'private, max-age=86400'");
  });
});
