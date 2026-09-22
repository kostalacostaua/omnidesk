/**
 * Поиск обращений к JSON по индексу без приведения типа.
 *
 * Ошибка, ради которой написан этот скрипт, стоила нескольких часов.
 * В запросе было `content->'attachments'->$2->>'storageKey'`, где $2 —
 * номер вложения. Выглядит правильно и не вызывает ни ошибки компиляции,
 * ни ошибки Postgres.
 *
 * Но node-pg передаёт параметры без указания типа, а у оператора `->`
 * два варианта: `jsonb -> text` (взять поле по имени) и `jsonb -> int`
 * (взять элемент по номеру). Для параметра неизвестного типа Postgres
 * выбирает текстовый. Обращение к МАССИВУ по ключу «0» законно и просто
 * возвращает NULL. В итоге запрос молча отдаёт пустоту, а в интерфейсе
 * вложения выглядят потерянными.
 *
 * Молчаливый неверный результат хуже падения: падение видно сразу.
 * Поэтому здесь запрещено обращение вида `->$N`, если сразу за ним
 * не стоит `::int`.
 *
 * Запуск: node scripts/check-sql.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['apps', 'packages'];
// Скобки вокруг параметра необязательны, но если они есть — приведение
// стоит ПОСЛЕ них. Поэтому два варианта разбираются отдельно, иначе
// проверка ругалась бы на уже исправленный код.
const BAD = /->\s*(?:\(\s*\$\d+\s*\)|\$\d+)\s*(?!::\s*(?:int|integer|bigint))/g;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

const problems = [];

for (const root of ROOTS) {
  for (const file of walk(root)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((text, i) => {
      // Интересует только обращение к JSON: у обычных сравнений
      // вида `id = $1` этой двусмысленности нет.
      if (!text.includes('->')) return;
      BAD.lastIndex = 0;
      if (BAD.test(text)) problems.push({ file, line: i + 1, text: text.trim() });
    });
  }
}

if (problems.length) {
  console.error('ОШИБКА: обращение к JSON по параметру без ::int.');
  console.error('Postgres примет параметр за текст и вернёт NULL вместо элемента массива.');
  for (const p of problems) console.error('  ' + p.file + ':' + p.line + '  ' + p.text);
  process.exit(1);
}

console.log('SQL: обращения к JSON по индексу приведены к int');
