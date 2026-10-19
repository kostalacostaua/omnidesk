import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { actionOf } from '../src/audit.js';
import { requiredLevel, roleAllows } from '../src/roles.js';

/**
 * Журнал действий.
 *
 * «Кто из ваших сотрудников может прочитать нашу переписку?» — этот
 * вопрос задают в каждой анкете безопасности, и ответить на него было
 * нечем: таблица стояла в схеме с индексом и изоляцией, а писать в неё
 * было некому. Пустой журнал хуже отсутствующего: он выглядит ответом
 * и не является им.
 */
const AUDIT = readFileSync(new URL('../src/audit.ts', import.meta.url), 'utf8');
const MAIN = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const WORKERS = readFileSync(
  new URL('../../workers/src/main.ts', import.meta.url),
  'utf8',
);

describe('что попадает в журнал', () => {
  /* Тот же довод, по которому права проверяются в одном месте: в
     полусотне ручек запись однажды забудут дописать, и в журнале не
     окажется ровно того действия, ради которого его завели. */
  it('изменения пишутся сами, а не вызовом в обработчике', () => {
    expect(AUDIT).toContain("app.addHook('onResponse'");
    const hook = AUDIT.slice(AUDIT.indexOf("app.addHook('onResponse'"));
    expect(hook).toContain("if (method === 'GET'");
  });

  /* Записывать надо то, что случилось, а не то, что попытались.
     Запрос, отбитый правами или оплатой, — не действие. */
  it('неудавшийся запрос действием не считается', () => {
    expect(AUDIT).toContain('if (reply.statusCode >= 400) return');
  });

  it('имя действия — метод и маршрут без опознавателей', () => {
    expect(actionOf('patch', '/users/:id')).toBe('PATCH /users/:id');
    expect(actionOf('POST', '/conversations/:id/messages')).toBe(
      'POST /conversations/:id/messages',
    );
  });

  /* За вебхуком и за оплатой стоит не человек, а канал и счёт. */
  it('машинные пути не пишутся', () => {
    expect(AUDIT).toContain("route.startsWith('/webhooks/')");
    expect(AUDIT).toContain("route === '/channels/custom/messages'");
  });

  /* Отметка «прочитано» и продление сеанса — следы открытой вкладки,
     а не решения человека. Сотня таких строк в час означает, что
     нужную строку не найдут. */
  it('следы открытой вкладки не пишутся', () => {
    expect(AUDIT).toContain("'/conversations/:id/read'");
    expect(AUDIT).toContain("'/auth/session'");
  });
});

describe('чтение переписки', () => {
  it('отмечается там, где её открывают', () => {
    expect(MAIN).toContain("action: 'conversation.read'");
  });

  /* Лента обновляется сама, и без этого в журнале было бы по строке
     каждые три секунды на каждую открытую вкладку. */
  it('не чаще раза в полчаса на человека и диалог', () => {
    expect(AUDIT).toContain('const SEEN_MS = 30 * 60_000');
    expect(MAIN).toContain('`conv:${req.params.id}`');
  });

  it('карта повторов не растёт вечно', () => {
    expect(AUDIT).toContain('if (seen.size > 20_000)');
  });
});

describe('что в журнал не попадает никогда', () => {
  /* Не из осторожности, а по устройству: в журнал идут метод, маршрут
     и опознаватели из адреса. Коду входа и ключу от CRM туда нечем
     попасть — не потому, что их вычистили, а потому, что их не брали. */
  it('тела запросов не читаются вовсе', () => {
    const hook = AUDIT.slice(AUDIT.indexOf("app.addHook('onResponse'"));
    expect(hook).not.toContain('req.body');
  });
});

describe('кто видит журнал', () => {
  /* Он показывает оператору, чем заняты коллеги и с каких адресов они
     входят. Это сведения о сотрудниках, а не о работе. */
  it('читать может только администратор, хотя это и чтение', () => {
    expect(requiredLevel('GET', '/audit')).toBe('admin');
    expect(roleAllows('agent', 'admin')).toBe(false);
    expect(roleAllows('viewer', 'admin')).toBe(false);
    expect(roleAllows('owner', 'admin')).toBe(true);
  });

  /* А отметить свою выгрузку должен мочь любой, кому дали смотреть
     отчёты: иначе не запишутся ровно те, за кем чаще смотрят. */
  it('отметить свою выгрузку может любой вошедший', () => {
    expect(requiredLevel('POST', '/audit/export')).toBe('any');
  });

  it('прочие списки остались открыты, как и были', () => {
    expect(requiredLevel('GET', '/users')).toBe('any');
    expect(requiredLevel('GET', '/channels')).toBe('any');
  });
});

describe('журнал не растёт вечно', () => {
  it('старое чистится по сроку', () => {
    expect(WORKERS).toContain('async function auditCleanup()');
    expect(WORKERS).toContain("AUDIT_KEEP_DAYS");
  });

  /* Один DELETE на годовой хвост держал бы таблицу под замком
     столько, сколько в ней накопилось, а писать в неё надо всё это
     время. */
  it('чистится пачками, а не одним запросом', () => {
    expect(WORKERS).toContain('LIMIT 10000');
    expect(WORKERS).toContain('if (gone < 10000) return');
  });

  /* Срок, названный человеку на экране, и срок, по которому чистят,
     обязаны совпадать — иначе экран врёт. */
  it('срок на экране берётся из той же переменной', () => {
    expect(MAIN).toContain("keepDays: Number(process.env['AUDIT_KEEP_DAYS'] ?? 365)");
    expect(WORKERS).toContain("process.env['AUDIT_KEEP_DAYS'] ?? 365");
    expect(AUDIT).toContain('return { entries: rows, keepDays }');
  });
});

describe('ошибка журнала', () => {
  /* Человек сменил роль, и строка не записалась — это плохо, но
     откатывать ему смену роли из-за нашей беды ещё хуже. */
  it('не отменяет само действие', () => {
    expect(AUDIT).toContain("'Запись в журнал действий не удалась'");
    expect(AUDIT).toContain('void withTenant(');
  });
});
