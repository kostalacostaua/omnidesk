import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Разбор ответов Zoho — в одном месте.
 *
 * Прямой res.json() на ответе Zoho — это отложенный 500: у неё 204 с
 * пустым телом означает обычное «нечего отдавать», и JSON.parse на
 * нём бросает. Проверки на 204 стояли по месту ровно там, где об это
 * однажды споткнулись; остальные вызовы ждали своей очереди, и один
 * из них дождался — на разметке заказа.
 *
 * Поэтому проверяется не поведение, а отсутствие прямого разбора: он и
 * есть та самая мина.
 */
const files = [
  ['apps/api/src/crm.ts', new URL('../src/crm.ts', import.meta.url)],
  ['apps/workers/src/crm.ts', new URL('../../workers/src/crm.ts', import.meta.url)],
] as const;

describe.each(files)('%s', (_name, url) => {
  const SRC = readFileSync(url, 'utf8');

  it('не разбирает ответ Zoho напрямую', () => {
    /* zohoWhy со своим .catch разбирает тело ошибки и остаётся как есть. */
    const direct = SRC.match(/await \w+\.json\(\)(?!\.catch)/g) ?? [];
    expect(direct).toEqual([]);
  });

  it('пользуется общим разбором', () => {
    expect(SRC).toContain('zohoBody');
  });
});
