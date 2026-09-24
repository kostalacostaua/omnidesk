import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  STATUS_COLORS,
  STATUS_COLOR_DEFAULT,
  STATUS_NAME_MAX,
  isStatusKind,
  parseStatusInput,
  sortStatuses,
  statusColor,
  statusName,
  systemStatusFor,
} from '../src/statuses.js';

/**
 * Статус — слово, которое человек придумал сам, и потому здесь
 * проверяется не «создаётся и сохраняется», а две опасные вещи:
 *
 *   род не угадывается — иначе счётчик открытых диалогов начнёт врать
 *   ровно тогда, когда статусов станет много;
 *
 *   название не ломает строку списка — вставленное из таблицы название
 *   с переводом строки разъезжает список на две строки у всех.
 */

describe('род статуса', () => {
  it('признаются только два рода', () => {
    expect(isStatusKind('open')).toBe(true);
    expect(isStatusKind('closed')).toBe(true);
    expect(isStatusKind('pending')).toBe(false);
    expect(isStatusKind('')).toBe(false);
    expect(isStatusKind(undefined)).toBe(false);
  });

  it('род определяет системный статус, и только он', () => {
    expect(systemStatusFor('open')).toBe('open');
    expect(systemStatusFor('closed')).toBe('resolved');
  });

  it('без рода статус не создаётся: угаданный род врёт счётчикам', () => {
    const out = parseStatusInput({ name: 'Чекаємо оплату' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toBe('bad_kind');

    const bad = parseStatusInput({ name: 'Оплата', kind: 'resolved' });
    expect(bad.ok).toBe(false);
  });
});

describe('название', () => {
  it('без названия статуса нет', () => {
    const out = parseStatusInput({ name: '   ', kind: 'open' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toBe('name_required');
  });

  it('перевод строки и табуляция не попадают в строку списка', () => {
    expect(statusName('Чекаємо\nоплату')).toBe('Чекаємо оплату');
    expect(statusName('Передано\tна\tсклад')).toBe('Передано на склад');
    expect(statusName('  подвійні   пробіли  ')).toBe('подвійні пробіли');
  });

  it('длина обрезается, а не отклоняется: не та ошибка, чтобы терять ввод', () => {
    const long = 'я'.repeat(200);
    expect(statusName(long)).toHaveLength(STATUS_NAME_MAX);
  });
});

describe('цвет', () => {
  it('чужой цвет молча заменяется своим', () => {
    expect(statusColor('#ff00ff')).toBe(STATUS_COLOR_DEFAULT);
    expect(statusColor('red')).toBe(STATUS_COLOR_DEFAULT);
    expect(statusColor(undefined)).toBe(STATUS_COLOR_DEFAULT);
  });

  it('свой цвет принимается в любом регистре', () => {
    expect(statusColor('#DC2626')).toBe('#dc2626');
    expect(statusColor('  #16a34a ')).toBe('#16a34a');
  });

  /*
   * Палитра выбирается в браузере, а проверяется на сервере. Это два
   * разных файла, и разъехаться они могут молча: человек выберет цвет,
   * сохранит, и получит синий вместо выбранного, не поняв, почему.
   */
  it('палитра в интерфейсе совпадает с той, что примет сервер', () => {
    const root = join(import.meta.dirname, '..', '..', '..');
    const ui = readFileSync(join(root, 'apps', 'api', 'src', 'ui.ts'), 'utf8');
    const line = ui.split('\n').find((l) => l.includes('var SCOLORS = ['));
    expect(line, 'в интерфейсе не найден список цветов SCOLORS').toBeTruthy();

    const block = ui.slice(ui.indexOf('var SCOLORS = ['));
    const list = block.slice(0, block.indexOf(']'));
    for (const color of STATUS_COLORS) expect(list).toContain(color);
    // И наоборот: лишних цветов в интерфейсе быть не должно.
    expect((list.match(/#[0-9a-f]{6}/g) ?? []).length).toBe(STATUS_COLORS.length);
  });
});

describe('порядок', () => {
  it('как настроили, а при равенстве — по алфавиту', () => {
    const list = [
      { sort: 20, name: 'Оплачено' },
      { sort: 10, name: 'Чекаємо оплату' },
      { sort: 20, name: 'Відправлено' },
    ];
    expect(sortStatuses(list).map((s) => s.name)).toEqual([
      'Чекаємо оплату',
      'Відправлено',
      'Оплачено',
    ]);
  });

  it('исходный список не переставляется: его показывают ещё где-то', () => {
    const list = [
      { sort: 20, name: 'б' },
      { sort: 10, name: 'а' },
    ];
    sortStatuses(list);
    expect(list[0]?.name).toBe('б');
  });
});

describe('разбор целиком', () => {
  it('порядок по умолчанию нулевой: место в списке решает сервер', () => {
    const out = parseStatusInput({ name: 'Оплата', kind: 'open' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value).toEqual({ name: 'Оплата', color: STATUS_COLOR_DEFAULT, kind: 'open', sort: 0 });
  });

  it('мусор в порядке не ломает создание', () => {
    const out = parseStatusInput({ name: 'Оплата', kind: 'closed', sort: 'третій' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value.sort).toBe(0);

    const big = parseStatusInput({ name: 'Оплата', kind: 'closed', sort: 1e9 });
    if (big.ok) expect(big.value.sort).toBe(999);
  });
});
