import { describe, expect, it } from 'vitest';
import { billingLetter, mailLang } from '../src/mail-billing.js';

/*
 * Письмо про деньги читают один раз и решают за секунду: платить или в
 * корзину. Поэтому проверяем не «что-то отрендерилось», а то, от чего
 * зависит это решение: язык получателя, название его компании, дата и
 * ссылка, по которой платят.
 */
const INFO = {
  company: 'Ромашка',
  day: '25.09.2026',
  days: 3,
  link: 'https://app.rozmovio.com/app',
};

describe('язык письма', () => {
  it('незнакомый язык получает украинский', () => {
    expect(mailLang('uk')).toBe('uk');
    expect(mailLang('en-US')).toBe('en');
    expect(mailLang('pl')).toBe('pl');
    expect(mailLang('de')).toBe('uk');
    expect(mailLang(null)).toBe('uk');
  });
});

describe('письмо про срок', () => {
  it('говорит на языке получателя', () => {
    expect(billingLetter('soon', 'uk', INFO).subject).toContain('завершується');
    expect(billingLetter('soon', 'en', INFO).subject).toContain('is ending');
    expect(billingLetter('soon', 'pl', INFO).subject).toContain('dobiega konca');
  });

  it('называет компанию, дату и ссылку', () => {
    const m = billingLetter('soon', 'uk', INFO);
    expect(m.text).toContain('Ромашка');
    expect(m.text).toContain('25.09.2026');
    expect(m.text).toContain(INFO.link);
    expect(m.html).toContain(INFO.link);
  });

  // «Залишилось 1 днів» читается как машинная рассылка, которой письмо
  // и является, — но выглядеть так не должно.
  it('дни склоняются', () => {
    expect(billingLetter('soon', 'uk', { ...INFO, days: 1 }).text).toContain('1 день');
    expect(billingLetter('soon', 'uk', { ...INFO, days: 3 }).text).toContain('3 дні');
    expect(billingLetter('soon', 'uk', { ...INFO, days: 5 }).text).toContain('5 днів');
    expect(billingLetter('soon', 'uk', { ...INFO, days: 11 }).text).toContain('11 днів');
  });

  /*
   * Письмо об окончании обязано сказать две вещи: данные целы и доступ
   * вернётся после оплаты. Без них человек читает его как «нас
   * отключили» и идёт искать, куда переехать.
   */
  it('письмо об окончании обещает сохранность данных', () => {
    const m = billingLetter('over', 'uk', INFO);
    expect(m.text).toContain('нікуди не зникли');
    expect(billingLetter('over', 'en', INFO).text).toContain('still there');
  });

  it('письмо о продлении называет новую дату', () => {
    const m = billingLetter('renewed', 'uk', { ...INFO, day: '25.10.2027' });
    expect(m.subject).toContain('оплату отримано');
    expect(m.text).toContain('25.10.2027');
  });

  it('текстовая часть есть всегда: её показывают почтовые клиенты компаний', () => {
    for (const kind of ['soon', 'over', 'renewed'] as const) {
      for (const lang of ['uk', 'en', 'pl']) {
        const m = billingLetter(kind, lang, INFO);
        expect(m.text.length).toBeGreaterThan(40);
        expect(m.subject.length).toBeGreaterThan(10);
      }
    }
  });

  it('разметка не ломается на кавычках в названии', () => {
    const m = billingLetter('soon', 'uk', { ...INFO, company: 'ТОВ "Ромашка" <b>' });
    expect(m.html).not.toContain('<b>');
    expect(m.html).toContain('&lt;b&gt;');
  });
});
