import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { MetaApiError } from '../src/meta.js';

/**
 * «Не доставлено» без объяснения.
 *
 * Meta отвечает на отправку кодом 200 — «нет разрешения отправлять от
 * имени этого аккаунта». Право на отправку выдаётся на аккаунт
 * целиком, и без него не уйдёт ни одно сообщение. А входящие при этом
 * продолжают приходить: для них хватает права на управление, и
 * отмечают эти два права галочками в одном окне.
 *
 * Раньше это падало в общую ветку: каждое сообщение краснело, канал
 * считался исправным, и связать одно с другим было невозможно —
 * забытая галочка живёт в чужом кабинете.
 */
const WORKERS = readFileSync(
  new URL('../../../apps/workers/src/main.ts', import.meta.url),
  'utf8',
);
const UI = readFileSync(new URL('../../../apps/api/src/ui.ts', import.meta.url), 'utf8');

const err = (code: number) => new MetaApiError(403, { code, message: 'нет прав' } as never);

describe('нет права отправлять', () => {
  it('узнаётся по коду 200', () => {
    expect(err(200).noPermission).toBe(true);
    expect(err(190).noPermission).toBe(false);
    expect(err(4).noPermission).toBe(false);
  });

  /* Отозванный токен и отсутствующее право — разные поломки с разным
     лечением: первый подключают заново, второму не хватает галочки. */
  it('это не отозванный токен', () => {
    expect(err(200).tokenInvalid).toBe(false);
    expect(err(190).tokenInvalid).toBe(true);
  });

  /* В permanent лежат отказы по одному сообщению, после которых канал
     продолжает работать. Этот — не такой. */
  it('разбирается раньше общих постоянных отказов', () => {
    const send = (() => {
      const from = WORKERS.indexOf('if (err.rateLimited) {');
      expect(from).toBeGreaterThan(0);
      return WORKERS.slice(from, from + 2200);
    })();
    const special = send.indexOf('err.noPermission');
    const general = send.indexOf("reason: 'whatsapp_refused'");
    expect(special).toBeGreaterThan(0);
    expect(special).toBeLessThan(general);
  });
});

describe('что видит человек', () => {
  it('канал гаснет, а не молча краснеет сообщениями', () => {
    expect(WORKERS).toContain("last_error = '{\"reason\":\"wa_no_send_permission\"}'::jsonb");
    expect(WORKERS).toContain("status = 'degraded'");
  });

  it('и о поломке сообщают', () => {
    const send = WORKERS.slice(WORKERS.indexOf('if (err.noPermission) {'));
    expect(send.slice(0, 1200)).toContain('announceChannelDown');
  });

  /* Права отмечают галочками, и человеку надо знать, какую он не
     отметил, — а не что «нет прав». */
  it('в кабинете названо, чего не хватает', () => {
    expect(UI).toContain("r === 'wa_no_send_permission'");
    expect(UI).toContain('whatsapp_business_messaging');
  });
});
