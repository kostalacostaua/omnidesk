import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Отметка о звонке.
 *
 * Голоса в кабинете нет и не будет скоро: ни сессия WhatsApp, ни
 * сессия Telegram не дают звонить ничем, что можно поставить людям в
 * рабочий сервис. Кнопка открывает набор на устройстве оператора — а
 * сюда попадает то, чего без неё не было бы нигде: что звонок был,
 * когда и чем кончился.
 *
 * Проверяется то, что делает отметку безопасной и полезной: она не
 * может уехать клиенту, не считается перепиской и не притворяется
 * репликой в списке чатов.
 */
const SRC = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const UI = readFileSync(new URL('../src/ui.ts', import.meta.url), 'utf8');

const route = (() => {
  const from = SRC.indexOf("'/conversations/:id/calls'");
  expect(from).toBeGreaterThan(0);
  return SRC.slice(from, SRC.indexOf('\n});', from));
})();

describe('запись звонка', () => {
  it('кладётся в ленту отдельным видом, а не сообщением', () => {
    expect(route).toContain("'call'");
    expect(route).toContain('INSERT INTO messages');
  });

  /* Очередь отправки — единственный путь наружу. Отметки в ней нет, и
     «случайно уйти клиенту» ей физически нечем: ровно та же защита,
     что у заметки для команды. */
  it('никуда не отправляется', () => {
    expect(route).not.toContain('outboundQueue');
    expect(route).not.toContain('.add(');
  });

  it('видна только своим каналам', () => {
    expect(route).toContain('channelScope');
  });

  it('берёт лишь известные исходы', () => {
    expect(route).toContain('CALL_RESULTS.includes');
    expect(SRC).toContain("['answered', 'no_answer', 'declined']");
  });

  /* Открытая вкладка — не разговор. Без границы в отчёте однажды
     появился бы оператор, говоривший одиннадцать часов. */
  it('длительность ограничена сверху', () => {
    expect(route).toContain('4 * 60 * 60');
  });
});

describe('звонок в списке и в счёте', () => {
  it('не становится строкой превью', () => {
    const inbox = readFileSync(new URL('../src/inbox.ts', import.meta.url), 'utf8');
    expect(inbox).toContain("m.kind = 'message'");
    expect(inbox).not.toContain("m.kind <> 'note'");
  });

  it('не считается перепиской в объёме аккаунта', () => {
    const admin = readFileSync(new URL('../src/admin.ts', import.meta.url), 'utf8');
    expect(admin).toContain("AND kind = 'message'");
    expect(admin).not.toContain("AND kind <> 'note'");
  });
});

describe('как звонок попадает в ленту', () => {
  /* Кнопки в шапке больше нет: она открывала набор номера на
     устройстве оператора — честно описывала то, что мы умеем, но не
     то, чего от кабинета ждут. Звонок из кабинета — это голос в
     кабинете, а до него нужен VoIP, которого пока нет. */
  it('кнопки в шапке нет, пока нет голоса', () => {
    expect(UI).not.toContain('id="aCall"');
    expect(UI).not.toContain("href=\"tel:");
  });

  /* А запись осталась: ручка, вид сообщения и отрисовка в ленте на
     месте, и уже сделанные отметки видны. Убран только способ начать —
     он и менялся бы первым. */
  it('запись о звонке осталась на месте', () => {
    expect(SRC).toContain("'/conversations/:id/calls'");
    expect(UI).toContain("if (m.kind === 'call') {");
  });
});
