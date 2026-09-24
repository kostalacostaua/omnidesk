import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildOpenApi } from '../src/openapi.js';

/**
 * Описание API написано руками, и главная опасность у такого описания
 * одна: оно отстаёт от кода. Тогда разработчик на той стороне пишет
 * интеграцию по документу, а получает 404 — и виноваты в этом мы.
 *
 * Поэтому здесь сверяется каждый описанный адрес с тем, что реально
 * зарегистрировано в исходниках. Совпадение ищется по строке маршрута
 * в коде: путь из описания переводится в вид Fastify (:id вместо {id}).
 */

const ROOT = join(import.meta.dirname, '..', '..', '..');

const SOURCES = [
  'apps/api/src/main.ts',
  'apps/api/src/inbox.ts',
  'apps/api/src/settings.ts',
  'apps/api/src/auth-email.ts',
  'apps/api/src/landing.ts',
  'apps/api/src/zoho.ts',
  'apps/api/src/widget.ts',
  'apps/api/src/ai.ts',
  'apps/api/src/custom.ts',
  // Адрес приёма обновлений живёт в отдельном сервисе.
  'apps/ingress/src/main.ts',
].map((f) => readFileSync(join(ROOT, f), 'utf8'));

const CODE = SOURCES.join('\n');

/** «/conversations/{id}/card» → «/conversations/:id/card» */
function toFastify(path: string): string {
  return path.replace(/\{([a-zA-Z]+)\}/g, ':$1');
}

describe('описание API', () => {
  const spec = buildOpenApi('https://app.rozmovio.com') as {
    paths: Record<string, Record<string, unknown>>;
  };

  it('описаны те разделы, ради которых к нам приходят снаружи', () => {
    const paths = Object.keys(spec.paths);
    expect(paths).toContain('/auth/request');
    expect(paths).toContain('/conversations');
    expect(paths).toContain('/conversations/{id}/messages');
    expect(paths).toContain('/webhooks/telegram/{channelId}');
  });

  it('каждый описанный адрес существует в коде', () => {
    const missing: string[] = [];
    for (const path of Object.keys(spec.paths)) {
      const fastify = toFastify(path);
      if (!CODE.includes(`'${fastify}'`)) missing.push(path);
    }
    expect(missing).toEqual([]);
  });

  it('у каждой ручки есть краткое описание: без него список бесполезен', () => {
    const noSummary: string[] = [];
    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(methods)) {
        if (!(op as { summary?: string }).summary) noSummary.push(`${method} ${path}`);
      }
    }
    expect(noSummary).toEqual([]);
  });

  it('защищённые ручки помечены авторизацией, публичные — нет', () => {
    const conversations = spec.paths['/conversations']?.['get'] as { security?: unknown[] };
    expect(conversations.security).toBeTruthy();

    const leads = spec.paths['/leads']?.['post'] as { security?: unknown[] };
    expect(leads.security).toBeUndefined();
  });
});
