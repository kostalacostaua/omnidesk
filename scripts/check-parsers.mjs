/**
 * Проверка: один разбор тела на один тип содержимого.
 *
 * Появилась после аварии. Разбор формы был в legal.ts — его туда
 * поставили ради запроса на удаление данных от Meta. Второй такой же
 * появился в main.ts ради Битрикса, который тоже приходит формой.
 * Fastify второй парсер на тот же тип не принимает и падает при
 * запуске — а падает он на живом сервере: тесты приложение не
 * поднимают, и 724 зелёных теста об этом не сказали ничего.
 *
 * Правило: каждый тип содержимого разбирается ровно в одном месте.
 *
 * Запуск: node scripts/check-parsers.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'apps/api/src';

const files = readdirSync(DIR).filter((f) => f.endsWith('.ts'));
if (!files.length) {
  console.error('ОШИБКА: не найдено исходников api — проверять нечего');
  process.exit(1);
}

const seen = new Map();
for (const file of files) {
  const src = readFileSync(join(DIR, file), 'utf8');
  for (const m of src.matchAll(/addContentTypeParser\(\s*'([^']+)'/g)) {
    const type = m[1];
    if (!seen.has(type)) seen.set(type, []);
    seen.get(type).push(file);
  }
}

const doubled = [...seen.entries()].filter(([, where]) => where.length > 1);
if (doubled.length) {
  console.error('ОШИБКА: тип содержимого разбирается дважды — Fastify упадёт при запуске:');
  for (const [type, where] of doubled) console.error('  ' + type + ' → ' + where.join(', '));
  process.exit(1);
}

console.log('Разбор тела: ' + seen.size + ' типов, по одному месту на каждый');
