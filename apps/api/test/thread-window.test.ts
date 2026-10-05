import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Окно переписки.
 *
 * Лента отдаётся с лимитом — иначе каждый опрос тянул бы годовую
 * переписку целиком. Но лимит без обратной сортировки оставляет
 * двести САМЫХ СТАРЫХ сообщений и молча выбрасывает всё новое: в
 * списке чатов видно свежую строку (она читается из conversations), а
 * в самом окне разговор навсегда стоит на двухсотом сообщении.
 *
 * Ошибка не падает и не ругается — она просто показывает человеку
 * неправду. Поэтому проверяется не наличие лимита, а направление, в
 * котором он режет.
 */
const SRC = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

/*
 * Берётся сам текст запроса, а не кусок файла: рядом лежит
 * объяснение, в котором прежняя, ошибочная сортировка упомянута
 * дословно — и проверка по куску файла проходила бы на комментарии,
 * даже если починить забыли.
 */
const sql = (() => {
  const route = SRC.indexOf("'/conversations/:id/messages'");
  expect(route).toBeGreaterThan(0);
  const open = SRC.indexOf('`SELECT', route);
  const close = SRC.indexOf('`', open + 1);
  expect(open).toBeGreaterThan(route);
  expect(close).toBeGreaterThan(open);
  return SRC.slice(open + 1, close);
})();

describe('лента диалога', () => {
  it('режет хвостом: берёт последние сообщения, а не первые', () => {
    expect(sql).toMatch(/ORDER BY m\.sent_at DESC[\s\S]*?LIMIT 200/);
  });

  it('не содержит прежней сортировки по возрастанию перед лимитом', () => {
    expect(sql).not.toMatch(/ORDER BY m\.sent_at ASC\s*\n\s*LIMIT/);
  });

  it('разворачивает хвост обратно — рисуется от старых к новым', () => {
    expect(sql).toMatch(/ORDER BY sent_at ASC/);
    expect(sql.indexOf('LIMIT 200')).toBeLessThan(sql.indexOf('ORDER BY sent_at ASC'));
  });

  /*
   * У сообщений одной пачки время совпадает до миллисекунды. Без
   * второго ключа порядок между ними у Postgres каждый раз свой, лента
   * считается изменившейся и перерисовывается на каждом опросе —
   * раз в три секунды, с мерцанием и сорванной прокруткой.
   */
  it('сортировка однозначна: есть второй ключ', () => {
    expect(sql).toMatch(/ORDER BY m\.sent_at DESC, m\.id DESC/);
    expect(sql).toMatch(/ORDER BY sent_at ASC, id ASC/);
  });
});
