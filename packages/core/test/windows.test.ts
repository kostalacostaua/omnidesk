import { describe, expect, it } from 'vitest';
import { canSendFreeform, computeResponseWindow, isWindowOpen, needsHumanAgentTag } from '../src/types.js';

const BASE = new Date('2026-08-07T12:00:00.000Z');
const hours = (n: number): Date => new Date(BASE.getTime() + n * 3600_000);

describe('окна ответа по каналам', () => {
  it('WhatsApp: 24 часа', () => {
    const w = computeResponseWindow('whatsapp', BASE);
    expect(w.type).toBe('standard');
    expect(w.expiresAt!.toISOString()).toBe('2026-08-08T12:00:00.000Z');
  });

  it('WhatsApp после Click-to-WhatsApp Ads: 72 часа бесплатно', () => {
    const w = computeResponseWindow('whatsapp', BASE, { freeEntryPoint: true });
    expect(w.type).toBe('free_entry');
    expect(w.expiresAt!.toISOString()).toBe('2026-08-10T12:00:00.000Z');
  });

  it('Messenger с тегом HUMAN_AGENT: 7 дней', () => {
    const w = computeResponseWindow('messenger', BASE, { humanAgentTag: true });
    expect(w.type).toBe('human_agent');
    expect(w.expiresAt!.toISOString()).toBe('2026-08-14T12:00:00.000Z');
  });

  it('Telegram Business: 24 часа — право reply действует только в этом окне', () => {
    const w = computeResponseWindow('telegram_business', BASE);
    expect(w.expiresAt!.toISOString()).toBe('2026-08-08T12:00:00.000Z');
  });

  it('Telegram Bot: окна нет', () => {
    const w = computeResponseWindow('telegram_bot', BASE);
    expect(w.type).toBe('none');
    expect(w.expiresAt).toBeNull();
  });
});

describe('isWindowOpen', () => {
  it('открыто до истечения', () => {
    const w = computeResponseWindow('whatsapp', BASE);
    expect(isWindowOpen(w, hours(23))).toBe(true);
  });

  it('закрыто после истечения', () => {
    const w = computeResponseWindow('whatsapp', BASE);
    expect(isWindowOpen(w, hours(25))).toBe(false);
  });

  it('граничный случай ровно в момент истечения — закрыто', () => {
    const w = computeResponseWindow('whatsapp', BASE);
    expect(isWindowOpen(w, hours(24))).toBe(false);
  });

  it('канал без окна всегда открыт', () => {
    expect(isWindowOpen(computeResponseWindow('telegram_bot', BASE), hours(1000))).toBe(true);
  });
});

describe('canSendFreeform — что показывать оператору', () => {
  it('в открытом окне свободный текст разрешён', () => {
    const w = computeResponseWindow('whatsapp', BASE);
    expect(canSendFreeform('whatsapp', w, hours(10))).toEqual({ allowed: true });
  });

  it('WhatsApp вне окна требует одобренный шаблон', () => {
    const w = computeResponseWindow('whatsapp', BASE);
    const r = canSendFreeform('whatsapp', w, hours(30));
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.requiresTemplate).toBe(true);
      expect(r.reason).toContain('шаблон');
    }
  });

  it('Messenger после 24 часов: ответ разрешён — уйдёт с тегом HUMAN_AGENT', () => {
    const w = computeResponseWindow('messenger', BASE);
    expect(canSendFreeform('messenger', w, hours(30))).toEqual({ allowed: true });
    expect(needsHumanAgentTag(w.expiresAt, hours(30))).toBe(true);
    expect(needsHumanAgentTag(w.expiresAt, hours(10))).toBe(false);
  });

  it('Messenger после 7 дней: ответ запрещён, шаблон не поможет', () => {
    const w = computeResponseWindow('instagram', BASE);
    const r = canSendFreeform('instagram', w, hours(24 * 7 + 1));
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.requiresTemplate).toBe(false);
      expect(r.reason).toContain('7 дней');
    }
  });

  it('Telegram Business вне окна: проактив от лица владельца невозможен', () => {
    const w = computeResponseWindow('telegram_business', BASE);
    const r = canSendFreeform('telegram_business', w, hours(30));
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.requiresTemplate).toBe(false);
  });

  it('Telegram Bot всегда разрешён', () => {
    const w = computeResponseWindow('telegram_bot', BASE);
    expect(canSendFreeform('telegram_bot', w, hours(10_000))).toEqual({ allowed: true });
  });
});
