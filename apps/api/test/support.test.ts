import { describe, expect, it } from 'vitest';
import { supportKeyOk, supportName, supportVisitor } from '../src/support.js';

/*
 * Окно поддержки в кабинете.
 *
 * Проверяем ровно то, на чём оно держится: переписка у клиента одна и
 * та же всегда, чужую не открыть, и в нашей скриньке обращение подписано
 * человеком, а не «відвідувач 4f21».
 */
describe('переписка клиента с поддержкой', () => {
  it('идентификатор постоянный: тот же человек — та же нитка', () => {
    const a = supportVisitor('secret', 'u1');
    const b = supportVisitor('secret', 'u1');
    expect(a).toBe(b);
  });

  /*
   * Тридцать два знака — не круглое число, а требование: публичный чат
   * принимает идентификатор посетителя ровно такой формы и отказывает
   * любому другому. Ошибиться здесь значит получить пустое окно без
   * объяснений.
   */
  it('по форме — то, что публичный чат считает посетителем', () => {
    expect(supportVisitor('secret', 'u1')).toMatch(/^[a-f0-9]{32}$/);
  });

  it('разные люди — разные нитки, и подобрать чужую нечем', () => {
    expect(supportVisitor('secret', 'u1')).not.toBe(supportVisitor('secret', 'u2'));
    // Тот же человек в другой установке сервиса — другая переписка:
    // идентификатор держится на секрете, а не на номере пользователя.
    expect(supportVisitor('one', 'u1')).not.toBe(supportVisitor('two', 'u1'));
  });

  it('ключ канала проверяется на вид, а не на непустоту', () => {
    expect(supportKeyOk('wcabc123def456')).toBe(true);
    expect(supportKeyOk('  wcabc123def456  ')).toBe(true);
    expect(supportKeyOk('')).toBe(false);
    expect(supportKeyOk('нет')).toBe(false);
    // Забытая переменная окружения выглядит именно так.
    expect(supportKeyOk('undefined')).toBe(false);
  });

  it('обращение подписано человеком и компанией', () => {
    expect(supportName('Костя', 'Ромашка')).toBe('Костя, Ромашка');
    expect(supportName('Костя', null)).toBe('Костя');
    expect(supportName(null, 'Ромашка')).toBe('Ромашка');
    // Пустого имени в списке диалогов быть не должно.
    expect(supportName(null, null)).toBe('Клієнт');
  });

  it('длинное имя обрезается: чат на сайте берёт восемьдесят знаков', () => {
    const long = supportName('и'.repeat(70), 'к'.repeat(70));
    expect(long.length).toBe(80);
  });
});
