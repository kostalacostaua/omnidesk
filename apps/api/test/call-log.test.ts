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

describe('кнопка звонка', () => {
  /* Под постом в инстаграме и в чате на сайте звонить некуда. Серая
     кнопка «нельзя» сообщала бы об этом заново при каждом открытии. */
  it('без номера не показывается', () => {
    const from = UI.indexOf("id=\"aCall\"");
    expect(from).toBeGreaterThan(0);
    expect(UI.slice(from - 300, from)).toContain('c.phone_e164');
  });

  it('открывает набор номера на устройстве', () => {
    expect(UI).toContain("href=\"tel:' + esc(c.phone_e164)");
  });

  /* Время считаем от нажатия: набор идёт мимо браузера, и точного
     взять неоткуда. Но у несостоявшегося разговора нет длительности
     вовсе — число рядом с «не взяв» только сбивало бы с толку. */
  it('секунды пишет лишь у состоявшегося разговора', () => {
    const from = UI.indexOf('function saveCall(result){');
    expect(from).toBeGreaterThan(0);
    const fn = UI.slice(from, UI.indexOf('\n}', from));
    expect(fn).toContain("if (result === 'answered') body.seconds");
  });
});
