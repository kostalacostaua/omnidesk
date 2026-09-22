/**
 * Проверка изоляции: у каждой таблицы с tenant_id должна быть RLS.
 *
 * Появилась после аварии: миграция 004 добавила user_routes — таблицу
 * с tenant_id и намеренно без RLS. Стартовая проверка приложения честно
 * отказалась поднимать api, но узналось это на живом сервере.
 * Здесь то же проверяется по исходникам, до сборки образа.
 *
 * Правило: таблица с tenant_id обязана получить apply_tenant_rls()
 * либо стоять в ROUTING_TABLES — быть осознанным исключением.
 *
 * Запуск: node scripts/check-rls.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SQL_DIRS = ['infra/postgres/init', 'infra/postgres/migrations'];

// Исключения читаются из кода, а не дублируются: иначе разъедутся.
const dbSource = readFileSync('packages/core/src/db.ts', 'utf8');
const routing = [...dbSource.matchAll(/ROUTING_TABLES = \[([^\]]+)\]/g)]
  .flatMap((m) => [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]));

if (!routing.length) {
  console.error('ОШИБКА: не удалось прочитать ROUTING_TABLES из packages/core/src/db.ts');
  process.exit(1);
}

const files = SQL_DIRS.filter((d) => existsSync(d)).flatMap((d) =>
  readdirSync(d).filter((f) => f.endsWith('.sql')).map((f) => join(d, f)),
);

// Проверка, молча прошедшая на пустом месте, опаснее отсутствующей.
if (!files.length) {
  console.error('ОШИБКА: не найдено ни одного SQL-файла со схемой: ' + SQL_DIRS.join(', '));
  process.exit(1);
}

const problems = [];
for (const file of files) {
  const sql = readFileSync(file, 'utf8');
  const tables = [...sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?([a-z_]+)\s*\(([\s\S]*?)\n\);/g)];
  for (const [, name, body] of tables) {
    if (!/\btenant_id\b/.test(body)) continue;
    if (routing.includes(name)) continue;
    if (sql.includes(`apply_tenant_rls('${name}')`)) continue;
    problems.push({ file, name });
  }
  for (const [, name] of sql.matchAll(/ALTER TABLE ([a-z_]+) ADD COLUMN (?:IF NOT EXISTS )?tenant_id\b/g)) {
    if (routing.includes(name) || sql.includes(`apply_tenant_rls('${name}')`)) continue;
    problems.push({ file, name });
  }
}

if (problems.length) {
  console.error('ОШИБКА: таблицы с tenant_id без защиты. Добавьте apply_tenant_rls()');
  console.error('или внесите в ROUTING_TABLES, если таблица нужна до определения тенанта:');
  for (const p of problems) console.error('  ' + p.file + ' → ' + p.name);
  process.exit(1);
}

console.log('RLS: ' + files.length + ' файлов, исключения: ' + routing.join(', '));
