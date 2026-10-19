import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { isAuthPath, requiredLevel, roleAllows } from '../src/roles.js';

/**
 * Два способа остаться в кабинете, из которого тебя убрали.
 *
 * Первый: уволенный сотрудник. Роль спрашивалась только на запись —
 * на чтение правило «можно всем вошедшим» не спрашивало ничего, а
 * отключённый остаётся вошедшим: токен подписан и живёт неделю.
 * Компания видела его вне списка и считала дело сделанным, а он ещё
 * семь дней читал всю переписку и все телефоны.
 *
 * Второй: администратор. Проверка уровня пускала его к /users — и
 * этого хватало, чтобы выдать себе роль владельца, разжаловать
 * настоящего владельца или отключить ему доступ. Администратора
 * нанимают вести каналы и команду, а не забирать компанию.
 */
const MAIN = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const SETTINGS = readFileSync(new URL('../src/settings.ts', import.meta.url), 'utf8');

describe('чтение тоже требует живой учётной записи', () => {
  /* Проверка стоит в общем preHandler, а не в ручках: в полусотне
     обработчиков её однажды забудут дописать. */
  const guard = (() => {
    const from = MAIN.indexOf("'Запрос от закрытого доступа'");
    expect(from).toBeGreaterThan(0);
    return MAIN.slice(from - 600, from + 200);
  })();

  it('пустая роль закрывает доступ, а не только запись', () => {
    expect(guard).toContain("reply.code(401).send({ error: 'session_revoked' })");
  });

  /* Отключённый и удалённый выпадают одинаково: whoIs ищет строку с
     is_active и не находит ни ту, ни другую. */
  it('отключённого база не отдаёт вовсе', () => {
    expect(MAIN).toContain('WHERE id = $1 AND is_active LIMIT 1');
  });

  /* Человеку, которому закрыли доступ, нужно мочь выйти и войти под
     другой учётной записью. Иначе 401 запирает его на странице входа. */
  it('вход из проверки исключён', () => {
    expect(guard).toContain('!isAuthPath(path)');
    expect(isAuthPath('/auth/code')).toBe(true);
    expect(isAuthPath('/conversations')).toBe(false);
  });

  /* Роль держится минуту ради того, чтобы не ходить в базу на каждый
     запрос. У увольнения эта минута не бесплатна. */
  it('увольнение действует сразу, а не через минуту памяти', () => {
    expect(MAIN).toContain('function forgetUser(userId: string): void');
    expect(SETTINGS).toContain('deps.forgetUser?.(req.params.id)');
  });

  /* Та самая дыра, ради которой всё: уровень чтения пускает любую
     роль, в том числе пустую. Поэтому её нельзя ловить уровнями. */
  it('уровнями эту дыру было не закрыть', () => {
    expect(requiredLevel('GET', '/conversations')).toBe('any');
    expect(roleAllows('', 'any')).toBe(true);
  });
});

describe('владение не забирается запросом', () => {
  it('роль владельца не выдаётся', () => {
    expect(SETTINGS).toContain("if (role === 'owner') return reply.code(409).send({ error: 'cannot_grant_owner' })");
  });

  it('и не приглашается письмом', () => {
    expect(SETTINGS).toContain("if (r === 'owner') return reply.code(409).send({ error: 'cannot_grant_owner' })");
  });

  /* Разжаловать и отключить — то же самое, что забрать: компания
     остаётся без того, кто один может всё. */
  it('строку владельца не меняет никто', () => {
    const patch = (() => {
      const from = SETTINGS.indexOf("'/users/:id'");
      expect(from).toBeGreaterThan(0);
      return SETTINGS.slice(from, from + 2600);
    })();
    expect(patch).toContain("if (target[0].role === 'owner') return 'owner' as const");
    expect(patch).toContain("error: 'cannot_change_owner'");
  });

  /* Между отдельным SELECT и UPDATE роль успевает стать другой, и
     проверка защищала бы строку, которой уже нет. */
  it('роль цели читается под замком в той же транзакции', () => {
    expect(SETTINGS).toContain('SELECT role FROM users WHERE id = $1 FOR UPDATE');
  });
});
