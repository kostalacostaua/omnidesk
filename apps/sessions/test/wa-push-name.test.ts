import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Чьё имя стоит в чате номерного WhatsApp.
 *
 * WhatsApp кладёт в каждое сообщение pushName того, КТО его отправил.
 * В исходящем это владелец номера, а не собеседник. Имя контакта
 * ставится один раз, при создании, и чат, который начался ответом с
 * телефона, получал в списке имя владельца: несколько разных клиентов
 * показывались одним человеком, и нужный открывался наугад.
 *
 * Проверяется источник: служба сессий не должна передавать дальше
 * pushName своего же сообщения. Ту же защиту несёт normalizeGateway —
 * двух мест здесь не слишком много: одно чинит форму сообщения, другое
 * не пускает чужое имя в контакт, даже если оно пришло из старой
 * очереди.
 */
const SRC = readFileSync(new URL('../src/wa.ts', import.meta.url), 'utf8');

describe('имя отправителя в сообщении номерного WhatsApp', () => {
  it('читается только у входящего', () => {
    const line = SRC.split('\n').find((l) => l.includes("raw['pushName']"));
    expect(line).toBeDefined();
    expect(line).toContain("key['fromMe']");
  });

  it('безусловного чтения pushName не осталось', () => {
    expect(SRC).not.toContain("name: (raw['pushName'] as string) || null");
  });
});
