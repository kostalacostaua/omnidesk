import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Почта как канал — пока нет.
 *
 * Поддомен письма принимает, а взять существующий ящик клиента нечем:
 * площадка, на которой мы стоим, закрывает исходящие почтовые порты.
 * Половина почты — это не почта: человек заводит канал, ждёт писем на
 * свой рабочий адрес и не понимает, почему их нет. Канал вернётся
 * вместе с чтением ящика по IMAP или POP3, а не раньше.
 *
 * Уже заведённые каналы при этом работают: выключить их значило бы
 * потерять переписку, которая в них есть.
 */
const SETTINGS = readFileSync(new URL('../src/settings.ts', import.meta.url), 'utf8');
const MAIN = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const UI = readFileSync(new URL('../src/ui.ts', import.meta.url), 'utf8');

describe('подключение почты', () => {
  /* Проверка на сервере, а не только в интерфейсе: интерфейс
     обходится запросом. */
  it('ручка отказывает, пока канал выключен', () => {
    expect(SETTINGS).toContain(
      "if (!deps.emailChannel) return reply.code(503).send({ error: 'email_channel_off' })",
    );
  });

  it('выключателем служит переменная, а не правка кода', () => {
    expect(MAIN).toContain("emailChannel: process.env['EMAIL_CHANNEL'] === 'on'");
  });

  /* По умолчанию выключено: переменной нет — канала нет. */
  it('по умолчанию выключен', () => {
    const flag = (v: string | undefined) => v === 'on';
    expect(flag(undefined)).toBe(false);
    expect(flag('')).toBe(false);
    expect(flag('on')).toBe(true);
  });

  it('интерфейс спрашивает сервер, а не решает сам', () => {
    expect(SETTINGS).toContain('const can = { emailChannel: deps.emailChannel === true');
    expect(UI).toContain('function canEmailChannel(){ return !!(ME && ME.can && ME.can.emailChannel) }');
    expect(UI).toContain('(canEmailChannel()');
  });
});

describe('что остаётся работать', () => {
  /* Канал остаётся типом: выключено предложение завести новый, а не
     сам канал. Переписка в заведённых каналах никуда не девается. */
  it('тип канала из системы не убран', () => {
    const types = readFileSync(
      new URL('../../../packages/core/src/types.ts', import.meta.url),
      'utf8',
    );
    expect(types).toContain("| 'email'");
  });

  it('чтение и ответ в заведённом канале не трогали', () => {
    const inbox = readFileSync(new URL('../src/inbox.ts', import.meta.url), 'utf8');
    expect(inbox).not.toContain('email_channel_off');
  });
});
