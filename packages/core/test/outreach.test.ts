import { describe, expect, it } from 'vitest';
import {
  OUTREACH_CHANNELS,
  canSendFreeform,
  canStartChat,
  outreachPeerId,
  outreachWindow,
  peerNeedsLookup,
  startsWithTemplate,
} from '../src/index.js';

describe('кто умеет написать первым', () => {
  it('три канала, и это не наш выбор, а их правила', () => {
    expect([...OUTREACH_CHANNELS].sort()).toEqual(['telegram_user', 'whatsapp', 'whatsapp_user']);
  });

  // Первое сообщение в Instagram и Messenger может быть только ответом,
  // а бот Telegram не знает чата того, кто ему не писал.
  it('остальным — нет', () => {
    for (const t of ['instagram', 'messenger', 'telegram_bot', 'telegram_business', 'viber_business', 'webchat']) {
      expect(canStartChat(t), t).toBe(false);
    }
  });

  it('шаблон нужен только WhatsApp Business', () => {
    expect(startsWithTemplate('whatsapp')).toBe(true);
    expect(startsWithTemplate('whatsapp_user')).toBe(false);
    expect(startsWithTemplate('telegram_user')).toBe(false);
  });
});

describe('адрес собеседника', () => {
  it('у WhatsApp адрес — сам номер, цифрами', () => {
    expect(outreachPeerId('whatsapp', '+380671112233')).toBe('380671112233');
    expect(outreachPeerId('whatsapp_user', '+380671112233')).toBe('380671112233');
  });

  // У Telegram адрес — внутренний идентификатор, которого про
  // незнакомого человека мы ещё не знаем. Плюс и есть признак
  // «адрес не раскрыт».
  it('у Telegram — номер с плюсом, и его предстоит раскрыть', () => {
    const peer = outreachPeerId('telegram_user', '+380671112233');
    expect(peer).toBe('+380671112233');
    expect(peerNeedsLookup(peer)).toBe(true);
  });

  it('раскрытый адрес второй раз не раскрывают', () => {
    expect(peerNeedsLookup('284119483')).toBe(false);
    expect(peerNeedsLookup('380671112233')).toBe(false);
  });
});

describe('окно у диалога, который завели мы', () => {
  /*
   * Главное свойство всей затеи: отдельного пути отправки нет, и
   * запрещать свободный текст в WhatsApp отдельно не приходится.
   * Обычная проверка окна сама скажет «только шаблон» — потому что
   * пустое окно типа standard и значит «закрыто».
   */
  it('WhatsApp Business: обычная проверка сама требует шаблон', () => {
    const w = outreachWindow('whatsapp');
    const verdict = canSendFreeform('whatsapp', { type: w.type as never, expiresAt: w.expiresAt });
    expect(verdict.allowed).toBe(false);
    expect(verdict.allowed === false && verdict.requiresTemplate).toBe(true);
  });

  it('номерные каналы: окна нет как понятия, пишем текстом', () => {
    for (const t of ['telegram_user', 'whatsapp_user'] as const) {
      const w = outreachWindow(t);
      expect(w.type).toBe('none');
      expect(canSendFreeform(t, { type: w.type as never, expiresAt: w.expiresAt }).allowed).toBe(true);
    }
  });
});
