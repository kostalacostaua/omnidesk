/**
 * Проверка страницы инбокса после сборки.
 *
 * Зачем отдельный скрипт. Интерфейс живёт внутри шаблонной строки
 * TypeScript. Это удобно — нет отдельного сборщика — но у такого приёма
 * есть ловушка: строка проходит через обработку escape-последовательностей.
 * Написанное в исходнике `\w` доезжает до браузера как `w`, а регулярное
 * выражение превращается в синтаксический мусор.
 *
 * Компилятор этого не видит: для него всё внутри строки — просто текст.
 * Тесты тоже не видят, если проверяют исходник, а не результат.
 * Ошибка вылезает у клиента в консоли пустой страницей.
 *
 * Поэтому здесь берётся УЖЕ СОБРАННЫЙ html и его скрипт разбирается
 * настоящим парсером JavaScript.
 *
 * Запуск: node scripts/check-ui.mjs
 */
import { Script } from 'node:vm';

const { INBOX_HTML } = await import('../apps/api/dist/ui.js');

const match = INBOX_HTML.match(/<script>([\s\S]*?)<\/script>/);
if (!match) {
  console.error('ОШИБКА: в собранной странице нет блока <script>');
  process.exit(1);
}

const code = match[1];

try {
  new Script(code, { filename: 'inbox-ui.js' });
} catch (err) {
  const line = Number(String(err.stack ?? '').match(/inbox-ui\.js:(\d+)/)?.[1] ?? 0);
  console.error('ОШИБКА: скрипт страницы не разбирается браузером.');
  console.error(err.message);
  if (line) {
    const lines = code.split('\n');
    for (let i = Math.max(0, line - 3); i < Math.min(lines.length, line + 2); i++) {
      console.error(String(i + 1).padStart(5) + (i + 1 === line ? ' >' : '  ') + ' ' + lines[i]);
    }
  }
  process.exit(1);
}

// Обратные слэши почти всегда означают потерянный escape: то, что автор
// писал как `\w`, до браузера доехало как `w`. Одиночный слэш в тексте
// страницы легален, но встречается настолько редко, что дешевле
// предупредить и проверить глазами, чем пропустить сломанную регулярку.
const suspicious = code
  .split('\n')
  .map((text, i) => ({ n: i + 1, text }))
  .filter((l) => /\\[wsdbSWDn]|\\u[0-9a-fA-F]{4}|\\\//.test(l.text));

if (suspicious.length) {
  console.error('ОШИБКА: в собранном скрипте остались escape-последовательности.');
  console.error('Скорее всего исходник ушёл в браузер не в том виде, в каком написан:');
  for (const l of suspicious) console.error('  строка ' + l.n + ': ' + l.text.trim());
  process.exit(1);
}

const bytes = Buffer.byteLength(INBOX_HTML, 'utf8');
console.log('страница инбокса: скрипт разбирается, ' + Math.round(bytes / 1024) + ' КБ');
