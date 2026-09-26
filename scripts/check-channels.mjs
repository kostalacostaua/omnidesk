/**
 * Проверка: типы каналов в коде и в базе — один список.
 *
 * Появилась после аварии. Номерной WhatsApp добавили в код, а в базе
 * тип перечислен отдельно — списком в CHECK. Канал не заводился совсем,
 * уже после успешного входа по QR, и человек видел «не вдалося
 * зберегти канал» без единого намёка на причину.
 *
 * База — последний, кто может не дать записать мусор в поле, по
 * которому потом маршрутизируются сообщения, поэтому список там и
 * останется. Но расходиться эти два списка не должны.
 *
 * Запуск: node scripts/check-channels.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const TYPES = 'packages/core/src/types.ts';
const SQL_DIRS = ['infra/postgres/init', 'infra/postgres/migrations'];

const src = readFileSync(TYPES, 'utf8');
const union = src.match(/export type ChannelType =([\s\S]*?);/);
if (!union) {
  console.error('ОШИБКА: не удалось прочитать ChannelType из ' + TYPES);
  process.exit(1);
}
const inCode = [...union[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

// Берём последнее объявление ограничения: миграции переписывают его
// целиком, и действует то, что применилось последним.
const files = SQL_DIRS.flatMap((d) =>
  readdirSync(d).filter((f) => f.endsWith('.sql')).sort().map((f) => join(d, f)),
);

let inDb = null;
for (const file of files) {
  const sql = readFileSync(file, 'utf8');
  for (const m of sql.matchAll(/channels_type_check[\s\S]{0,80}?CHECK \(type IN \(([\s\S]*?)\)\)/g)) {
    inDb = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  }
}

if (!inDb) {
  console.error('ОШИБКА: не найдено ограничение channels_type_check в схеме');
  process.exit(1);
}

const missing = inCode.filter((t) => !inDb.includes(t));
const extra = inDb.filter((t) => !inCode.includes(t));

if (missing.length || extra.length) {
  console.error('ОШИБКА: списки типов каналов разошлись.');
  if (missing.length) console.error('  нет в базе: ' + missing.join(', '));
  if (extra.length) console.error('  нет в коде: ' + extra.join(', '));
  console.error('Перепишите channels_type_check новой миграцией — целиком.');
  process.exit(1);
}

console.log('Типы каналов: ' + inCode.length + ', код и база совпадают');
