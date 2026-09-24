import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { channelListScope, channelScope, folderScope } from '../src/scope.js';

/**
 * Разграничение доступа к каналам живёт условием в SQL. Проверить его
 * без базы можно двумя способами, и оба здесь: что само условие
 * собрано правильно, и что его не забыли поставить там, где читается
 * чужая переписка. Второе важнее: забытое условие — это оператор,
 * который открывает по ссылке диалог из канала, к которому доступа у
 * него нет.
 */

const ROOT = join(import.meta.dirname, '..', '..', '..');

function source(file: string): string {
  return readFileSync(join(ROOT, file), 'utf8');
}

describe('условие доступа', () => {
  const sql = channelScope('c.channel_id', '$2');

  it('администратор проходит поверх любого списка', () => {
    expect(sql).toContain("su.role IN ('owner','admin')");
  });

  it('пустой список означает «все каналы», а не «ничего»', () => {
    expect(sql).toContain('NOT EXISTS (SELECT 1 FROM user_channels');
  });

  it('иначе — только перечисленные каналы', () => {
    expect(sql).toContain('c.channel_id IN (SELECT sc.channel_id FROM user_channels');
  });

  it('идентификатор подставляется параметром, а не строкой в запросе', () => {
    expect(sql).not.toMatch(/'[0-9a-f-]{36}'/);
    expect(sql.match(/\$2/g)?.length).toBe(3);
  });

  it('для списка каналов правило то же, только поле другое', () => {
    expect(channelListScope('$1')).toContain('c.id IN (SELECT sc.channel_id');
  });
});

describe('условие стоит там, где читается переписка', () => {
  it('список диалогов, счётчики, карточка и правка диалога', () => {
    const inbox = source('apps/api/src/inbox.ts');
    // Четыре места: список, счётчики, карточка контакта, изменение.
    expect(inbox.match(/channelScope\(/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('лента сообщений и отправка ответа', () => {
    const main = source('apps/api/src/main.ts');
    expect(main.match(/channelScope\(/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('список каналов показывает только доступные', () => {
    expect(source('apps/api/src/settings.ts')).toContain('channelListScope(');
  });
});

/**
 * Папки шаблонов раздаются по тому же правилу, что и каналы. Здесь
 * проверяется не сходство ради сходства, а две вещи, в которых легко
 * ошибиться по-разному: пустой список означает «все», и шаблоны вне
 * папок остаются доступными всем.
 */
describe('доступ к папкам шаблонов', () => {
  const sql = folderScope('q.folder', '$1');

  it('администратор проходит поверх любого списка', () => {
    expect(sql).toContain("su.role IN ('owner','admin')");
  });

  it('пустой список означает «все папки», а не «ни одной»', () => {
    expect(sql).toContain('NOT EXISTS (SELECT 1 FROM user_reply_folders');
  });

  it('сравнение имён без регистра: «Доставка» и «доставка» — одна папка', () => {
    expect(sql).toContain('lower(q.folder)');
    expect(sql).toContain('lower(f.name)');
  });

  it('идентификатор подставляется параметром', () => {
    expect(sql).not.toMatch(/'[0-9a-f-]{36}'/);
    expect(sql.match(/\$1/g)?.length).toBe(3);
  });

  it('шаблоны без папки отданы всем, и это видно в самом запросе', () => {
    // Условие «или папки нет» стоит рядом с ограничением, а не где-то
    // ещё: иначе ограничение одного человека молча забрало бы у всех
    // заготовки, которые просто не разложили.
    const settings = readFileSync(join(ROOT, 'apps/api/src/settings.ts'), 'utf8');
    expect(settings).toContain("q.folder = '' OR ");
    expect(settings).toContain("folderScope('q.folder'");
  });

  it('список папок тоже урезан, иначе в настройках видно чужое', () => {
    expect(source('apps/api/src/settings.ts')).toContain("folderScope('f.name'");
  });
});
