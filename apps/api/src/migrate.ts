/**
 * Миграции базы перед каждым деплоем.
 *
 * Локально схему создавал сам образ Postgres: скрипты из initdb.d
 * выполнялись при первом запуске тома. У управляемой базы такого механизма
 * нет — она уже создана, и никто не запустит наши скрипты за нас. Поэтому
 * здесь то же самое, но явно и повторяемо:
 *
 *   1. роль app_user — от её имени работает приложение, и RLS действует
 *      только на неё: владелец таблиц политики обходит;
 *   2. init/*.sql и migrations/*.sql по порядку, каждый файл ровно один раз;
 *   3. первый владелец, если база пустая.
 *
 * Запускается под ВЛАДЕЛЬЦЕМ базы (MIGRATION_DATABASE_URL), а не под
 * app_user: менять схему приложению нельзя, и это правило не ослабляется
 * ради удобства деплоя.
 *
 * На платформе это preDeployCommand: упала миграция — новая версия
 * не выкатывается, старая продолжает работать. Лучше, чем приложение,
 * которое поднялось на схеме, которой не ждёт.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';

const SQL_ROOT = process.env['SQL_ROOT'] ?? join(process.cwd(), 'infra/postgres');

function log(msg: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level: 'info', msg, ts: new Date().toISOString(), ...extra }));
}

/** Кавычки для литерала в DDL: пароль роли нельзя передать параметром. */
function literal(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

async function ensureAppRole(db: pg.Client, password: string): Promise<void> {
  const { rows } = await db.query<{ owner: string; dbname: string }>(
    `SELECT current_user AS owner, current_database() AS dbname`,
  );
  const owner = rows[0]!.owner;
  const dbname = rows[0]!.dbname;

  await db.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user LOGIN;
      END IF;
    END $$;`);

  // Пароль выставляется при каждом запуске: так его смена в переменных
  // платформы применяется сама, без ручного ALTER ROLE.
  await db.query(`ALTER ROLE app_user PASSWORD ${literal(password)}`);

  // Ни суперпользователь, ни обход RLS. Именно это делает изоляцию
  // настоящей, а не декоративной.
  await db.query(`ALTER ROLE app_user NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
  await db.query(`GRANT CONNECT ON DATABASE "${dbname}" TO app_user`);
  await db.query(`GRANT USAGE ON SCHEMA public TO app_user`);
  await db.query(`REVOKE CREATE ON SCHEMA public FROM app_user`);
  await db.query(`ALTER DEFAULT PRIVILEGES FOR ROLE "${owner}" IN SCHEMA public
                    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user`);
  await db.query(`ALTER DEFAULT PRIVILEGES FOR ROLE "${owner}" IN SCHEMA public
                    GRANT USAGE, SELECT ON SEQUENCES TO app_user`);

  log('Роль app_user готова', { owner });
}

async function sqlFiles(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  } catch {
    return [];
  }
}

async function applyMigrations(db: pg.Client): Promise<number> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);

  const { rows } = await db.query<{ name: string }>(`SELECT name FROM _migrations`);
  const done = new Set(rows.map((r) => r.name));

  // init идёт первым и в своём порядке: 01 создаёт функцию RLS,
  // 02 — таблицы, которые её вызывают.
  const plan = [
    ...(await sqlFiles(join(SQL_ROOT, 'init'))).map((f) => ({ name: `init/${f}`, dir: 'init', f })),
    ...(await sqlFiles(join(SQL_ROOT, 'migrations'))).map((f) => ({
      name: `migrations/${f}`,
      dir: 'migrations',
      f,
    })),
  ];

  if (!plan.length) {
    // Пустой план при пустой базе означает, что SQL не попал в образ.
    // Молча пройти здесь — значит поднять приложение без таблиц.
    throw new Error(`Не найдено ни одного SQL-файла в ${SQL_ROOT}`);
  }

  let applied = 0;
  for (const step of plan) {
    if (done.has(step.name)) continue;
    const raw = await readFile(join(SQL_ROOT, step.dir, step.f), 'utf8');
    // Строки вида «\set ON_ERROR_STOP on» — команды psql, а не SQL.
    // Файлы писались под psql, и драйвер на такой строке падает с
    // синтаксической ошибкой. Остановка на первой ошибке у драйвера
    // и так поведение по умолчанию, так что строки просто убираются.
    const sql = raw
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('\\'))
      .join('\n');
    log('Применяю миграцию', { name: step.name });
    // Файлы сами управляют транзакциями (BEGIN/COMMIT внутри) и написаны
    // идемпотентно, поэтому повторный прогон после сбоя безопасен.
    await db.query(sql);
    await db.query(`INSERT INTO _migrations (name) VALUES ($1)`, [step.name]);
    applied++;
  }
  return applied;
}

/**
 * Первый владелец.
 *
 * Только если в базе нет ни одной организации: на рабочей системе этот
 * шаг ничего не делает, сколько бы раз ни запускался. Отдельной ручки
 * в API для этого нет намеренно — её нельзя вызвать из интернета.
 */
async function bootstrapOwner(db: pg.Client): Promise<void> {
  const email = (process.env['BOOTSTRAP_OWNER_EMAIL'] ?? '').trim().toLowerCase();
  const company = (process.env['BOOTSTRAP_COMPANY'] ?? '').trim();
  if (!email || !company) return;

  const { rows } = await db.query<{ n: string }>(`SELECT count(*) AS n FROM tenants`);
  if (Number(rows[0]!.n) > 0) return;

  const slug =
    company
      .toLowerCase()
      .replace(/[^a-z0-9а-яёіїєґ]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'company';

  await db.query('BEGIN');
  try {
    const { rows: t } = await db.query<{ id: string }>(
      `INSERT INTO tenants (slug, name, plan) VALUES ($1, $2, 'trial') RETURNING id`,
      [slug, company],
    );
    const tenantId = t[0]!.id;
    // Вставка под владельцем, но с явным tenant_id: политика WITH CHECK
    // проверяет app.tenant_id, поэтому выставляем контекст и здесь.
    await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    await db.query(
      `INSERT INTO users (tenant_id, email, full_name, role, is_active)
       VALUES ($1, $2, $3, 'owner', true)`,
      [tenantId, email, company],
    );
    await db.query('COMMIT');
    log('Создан первый владелец', { email, company });
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }
}

async function main(): Promise<void> {
  const url = process.env['MIGRATION_DATABASE_URL'];
  const appPassword = process.env['APP_DB_PASSWORD'];
  if (!url) throw new Error('MIGRATION_DATABASE_URL не задан');
  if (!appPassword) throw new Error('APP_DB_PASSWORD не задан');

  const db = new pg.Client({ connectionString: url });
  await db.connect();
  try {
    // Роль до миграций: в схеме есть GRANT ... TO app_user,
    // и без роли они упадут.
    await ensureAppRole(db, appPassword);
    const applied = await applyMigrations(db);
    await bootstrapOwner(db);
    log('Миграции завершены', { applied });
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ level: 'error', msg: 'Миграция упала', error: String(err?.message ?? err) }));
  process.exit(1);
});
