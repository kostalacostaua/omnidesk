import { describe, expect, it } from 'vitest';
import { parseRouting, pickAssignee, ROUTING_DEFAULT } from '../src/routing.js';

/**
 * Распределение ошибается тихо: диалог просто достаётся не тому или не
 * достаётся никому, и замечают это через день по недовольному клиенту.
 * Поэтому проверяется именно то, что ломается: круг, выбывший человек и
 * настройка из базы, которой может не быть вовсе.
 */

const team = ['u1', 'u2', 'u3'];

describe('разбор настройки', () => {
  it('пустая настройка — это «никому», а не падение', () => {
    expect(parseRouting(null)).toEqual(ROUTING_DEFAULT);
    expect(parseRouting({ mode: 'что-то своё' }).mode).toBe('none');
  });

  it('чужие поля не протаскиваются', () => {
    const r = parseRouting({ mode: 'user', userId: 'u1', drop: 'table' });
    expect(Object.keys(r).sort()).toEqual(['lastUserId', 'mode', 'userId']);
  });
});

describe('по очереди', () => {
  it('круг идёт по порядку и замыкается', () => {
    let last: string | null = null;
    const got: string[] = [];
    for (let i = 0; i < 4; i++) {
      const next = pickAssignee({ mode: 'round_robin', userId: null, lastUserId: last }, team);
      got.push(next!);
      last = next;
    }
    expect(got).toEqual(['u1', 'u2', 'u3', 'u1']);
  });

  it('ушедший из списка не сбивает круг', () => {
    const next = pickAssignee({ mode: 'round_robin', userId: null, lastUserId: 'ушёл' }, team);
    expect(next).toBe('u1');
  });

  it('некому назначать — диалог остаётся общим', () => {
    expect(pickAssignee({ mode: 'round_robin', userId: null, lastUserId: null }, [])).toBeNull();
  });
});

describe('всегда одному', () => {
  it('назначается он', () => {
    expect(pickAssignee({ mode: 'user', userId: 'u2', lastUserId: null }, team)).toBe('u2');
  });

  it('если он потерял доступ к каналу — никому, а не ему', () => {
    // Иначе диалоги копятся у того, кто их не видит, и выглядит это как
    // «клиент не написал».
    expect(pickAssignee({ mode: 'user', userId: 'уволен', lastUserId: null }, team)).toBeNull();
  });
});

describe('никому', () => {
  it('ничего не назначает даже при полной команде', () => {
    expect(pickAssignee(ROUTING_DEFAULT, team)).toBeNull();
  });
});
