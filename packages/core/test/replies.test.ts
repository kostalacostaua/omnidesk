import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { folderNames, groupByFolder, replyFolder, sameFolder } from '../src/replies.js';

/**
 * Папка здесь — имя, а не запись в таблице. У имени как ключа есть
 * ровно одна опасность: две папки, одинаковые на глаз и разные для
 * машины. «Доставка» и «доставка », набранные в разное время, дадут
 * человеку два места для поиска одного шаблона.
 *
 * Поэтому проверяется в первую очередь схлопывание, а не раскладка.
 */

const tpl = (shortcut: string, folder?: string) => ({ shortcut, folder });

describe('имя папки', () => {
  it('края и двойные пробелы не создают вторую папку', () => {
    expect(replyFolder('  Доставка  ')).toBe('Доставка');
    expect(replyFolder('Повернення  товару')).toBe('Повернення товару');
    expect(replyFolder('Опла\nта')).toBe('Опла та');
  });

  it('пусто и мусор означают «без папки»', () => {
    expect(replyFolder(undefined)).toBe('');
    expect(replyFolder(null)).toBe('');
    expect(replyFolder('   ')).toBe('');
  });

  it('длина обрезается: имя — заголовок группы, а не текст', () => {
    expect(replyFolder('я'.repeat(100))).toHaveLength(40);
  });

  it('регистр не создаёт вторую папку', () => {
    expect(sameFolder('Доставка', 'доставка ')).toBe(true);
    expect(sameFolder('Доставка', 'Оплата')).toBe(false);
    expect(sameFolder('', undefined)).toBe(true);
  });
});

describe('раскладка по папкам', () => {
  const list = [
    tpl('оплата', 'Оплата'),
    tpl('привіт'),
    tpl('графік', 'Доставка'),
    tpl('накладна', 'доставка'),
    tpl('дякую'),
  ];

  it('папки по алфавиту, «без папки» — последней', () => {
    expect(groupByFolder(list).map((g) => g.folder)).toEqual(['Доставка', 'Оплата', '']);
  });

  it('«Доставка» и «доставка» — одна папка, а не две подряд', () => {
    const delivery = groupByFolder(list)[0]!;
    expect(delivery.items.map((t) => t.shortcut)).toEqual(['графік', 'накладна']);
  });

  it('имя папки берётся у первого шаблона, а не приводится к нижнему', () => {
    // Иначе человек, назвавший папку «Доставка», увидел бы «доставка».
    expect(groupByFolder([tpl('a', 'Доставка'), tpl('b', 'доставка')])[0]?.folder).toBe('Доставка');
  });

  it('внутри папки — по алфавиту сокращений', () => {
    const inside = groupByFolder([tpl('б'), tpl('а'), tpl('в')])[0]!;
    expect(inside.items.map((t) => t.shortcut)).toEqual(['а', 'б', 'в']);
  });

  it('плоский список остаётся одной группой без имени', () => {
    const groups = groupByFolder([tpl('а'), tpl('б')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.folder).toBe('');
  });

  it('имена для подсказки — без пустой', () => {
    expect(folderNames(list)).toEqual(['Доставка', 'Оплата']);
    expect(folderNames([tpl('а')])).toEqual([]);
  });
});

/*
 * Раскладку делают дважды: здесь — для ответа сервера, и в браузере,
 * где из того же списка рисуются заголовки папок. Две реализации одного
 * правила расходятся молча: сервер отдаст один порядок, страница
 * покажет другой, и человек решит, что шаблон пропал.
 *
 * Поэтому функция из интерфейса берётся как есть и сверяется с этой.
 */
describe('браузер раскладывает так же, как сервер', () => {
  const ui = readFileSync(
    join(import.meta.dirname, '..', '..', '..', 'apps', 'api', 'src', 'ui.ts'),
    'utf8',
  );

  function uiGroups(list: { shortcut: string; folder?: string }[]): { folder: string; items: { shortcut: string }[] }[] {
    const cut = (name: string) => {
      const from = ui.indexOf('function ' + name + '(');
      expect(from, 'в интерфейсе нет функции ' + name).toBeGreaterThan(0);
      const end = ui.indexOf('\n}', from);
      return ui.slice(from, end + 2);
    };
    const make = new Function(
      'QR',
      cut('qrFolder') + cut('qrGroups') + 'return qrGroups();',
    ) as (qr: unknown[]) => { folder: string; items: { shortcut: string }[] }[];
    return make(list);
  }

  it('порядок папок и шаблонов внутри совпадает', () => {
    const list = [
      tpl('оплата', 'Оплата'),
      tpl('привіт'),
      tpl('графік', 'Доставка'),
      tpl('накладна', ' доставка '),
      tpl('дякую'),
      tpl('інструкція', 'Інструкції'),
    ];

    const flat = (groups: { folder: string; items: { shortcut: string }[] }[]) =>
      groups.map((g) => g.folder + ':' + g.items.map((i) => i.shortcut).join(','));

    const fromUi = flat(uiGroups(list));
    // Сверка двух пустых списков прошла бы молча и ничего не проверила.
    expect(fromUi).toEqual(['Доставка:графік,накладна', 'Інструкції:інструкція', 'Оплата:оплата', ':дякую,привіт']);
    expect(fromUi).toEqual(flat(groupByFolder(list)));
  });
});
