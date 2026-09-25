/**
 * Письма про срок и оплату.
 *
 * Три события, о которых человек должен узнать не из закрытого
 * кабинета: срок скоро кончится, срок кончился, оплата принята и срок
 * продлён. Первые два — чтобы успел заплатить, третье — чтобы перестал
 * волноваться.
 *
 * Язык письма — язык получателя, а не наш. Письмо о деньгах на чужом
 * языке читается как спам и отправляется в корзину не читая, а платить
 * после этого человек не станет.
 *
 * Текст здесь, а не в воркере: письмо — это обещание сервиса, и
 * проверять его надо тестом, а не глазами в почтовом ящике.
 */

import { withSystem, withTenant, type Pool } from './db.js';

export type BillingLetter = 'soon' | 'over' | 'renewed';

/** Языки писем. Незнакомый язык получает украинский. */
export type MailLang = 'uk' | 'en' | 'pl';

export function mailLang(value: unknown): MailLang {
  const s = String(value ?? '').slice(0, 2).toLowerCase();
  return s === 'en' || s === 'pl' ? s : 'uk';
}

export interface BillingLetterInfo {
  /** Название организации: человек может вести не одну. */
  company: string;
  /** Дата окончания или новая дата, до которой оплачено. */
  day: string;
  /** Сколько дней осталось. Нужно только письму «скоро». */
  days?: number;
  /** Ссылка на страницу тарифа. */
  link: string;
}

interface Words {
  soonSubject: (c: string) => string;
  soonBody: (i: BillingLetterInfo) => string[];
  overSubject: (c: string) => string;
  overBody: (i: BillingLetterInfo) => string[];
  renewedSubject: (c: string) => string;
  renewedBody: (i: BillingLetterInfo) => string[];
  button: string;
}

/**
 * Дни словом: «3 дні», «1 день», «5 днів».
 *
 * Без этого письмо пишет «залишилось 1 днів», и дальше человек читает
 * его уже как машинную рассылку, которой оно и является, — но выглядеть
 * так не должно.
 */
function daysUk(n: number): string {
  const last2 = n % 100;
  const last = n % 10;
  if (last2 >= 11 && last2 <= 14) return `${n} днів`;
  if (last === 1) return `${n} день`;
  if (last >= 2 && last <= 4) return `${n} дні`;
  return `${n} днів`;
}

function daysPl(n: number): string {
  const last2 = n % 100;
  const last = n % 10;
  if (last2 >= 12 && last2 <= 14) return `${n} dni`;
  if (last >= 2 && last <= 4) return `${n} dni`;
  return `${n} dni`;
}

const WORDS: Record<MailLang, Words> = {
  uk: {
    soonSubject: (c) => `Rozmovio: доступ для ${c} завершується`,
    soonBody: (i) => [
      `Доступ до Rozmovio для «${i.company}» діє до ${i.day} — це ${daysUk(i.days ?? 0)}.`,
      'Після цієї дати кабінет закриється, але дані залишаться на місці: щойно надійде оплата, все повернеться таким, як було.',
      'Оплатити можна карткою або рахунком на компанію — на сторінці тарифу в кабінеті.',
    ],
    overSubject: (c) => `Rozmovio: доступ для ${c} призупинено`,
    overBody: (i) => [
      `Термін доступу до Rozmovio для «${i.company}» завершився ${i.day}, і кабінет призупинено.`,
      'Листування, контакти й налаштування нікуди не зникли — доступ повернеться одразу після оплати.',
      'Якщо оплата вже в дорозі, надішліть квитанцію у відповідь на цей лист, і ми відкриємо доступ, не чекаючи зарахування.',
    ],
    renewedSubject: (c) => `Rozmovio: оплату отримано, ${c}`,
    renewedBody: (i) => [
      `Дякуємо. Оплату зараховано, доступ для «${i.company}» діє до ${i.day}.`,
      'Рахунок і чек лежать у кабінеті, на сторінці тарифу.',
    ],
    button: 'Відкрити кабінет',
  },
  en: {
    soonSubject: (c) => `Rozmovio: access for ${c} is ending`,
    soonBody: (i) => [
      `Access to Rozmovio for ${i.company} runs until ${i.day} — that is ${i.days ?? 0} day(s) away.`,
      'After that date the workspace is suspended, but nothing is deleted: everything comes back the moment a payment arrives.',
      'You can pay by card or by invoice on the billing page in your workspace.',
    ],
    overSubject: (c) => `Rozmovio: access for ${c} is suspended`,
    overBody: (i) => [
      `Access to Rozmovio for ${i.company} ended on ${i.day}, and the workspace is suspended.`,
      'Conversations, contacts and settings are all still there — access returns as soon as the payment is made.',
      'If the payment is already on its way, reply to this letter with the proof and we will open access without waiting for it to clear.',
    ],
    renewedSubject: (c) => `Rozmovio: payment received, ${c}`,
    renewedBody: (i) => [
      `Thank you. The payment is in, and access for ${i.company} now runs until ${i.day}.`,
      'The invoice and the receipt are on the billing page in your workspace.',
    ],
    button: 'Open the workspace',
  },
  pl: {
    soonSubject: (c) => `Rozmovio: dostep dla ${c} dobiega konca`,
    soonBody: (i) => [
      `Dostep do Rozmovio dla ${i.company} dziala do ${i.day} — to ${daysPl(i.days ?? 0)}.`,
      'Po tej dacie panel zostanie zawieszony, ale dane pozostaja na miejscu: wracaja w chwili zaksiegowania platnosci.',
      'Zaplacic mozna karta albo faktura na firme — na stronie taryfy w panelu.',
    ],
    overSubject: (c) => `Rozmovio: dostep dla ${c} zawieszony`,
    overBody: (i) => [
      `Dostep do Rozmovio dla ${i.company} skonczyl sie ${i.day}, panel zostal zawieszony.`,
      'Rozmowy, kontakty i ustawienia sa na miejscu — dostep wroci zaraz po platnosci.',
      'Jesli platnosc jest juz w drodze, odpisz na ten list z potwierdzeniem, a otworzymy dostep bez czekania.',
    ],
    renewedSubject: (c) => `Rozmovio: platnosc otrzymana, ${c}`,
    renewedBody: (i) => [
      `Dziekujemy. Platnosc zaksiegowana, dostep dla ${i.company} dziala do ${i.day}.`,
      'Faktura i paragon sa na stronie taryfy w panelu.',
    ],
    button: 'Otworz panel',
  },
};

export interface MailText {
  subject: string;
  text: string;
  html: string;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (ch) =>
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&quot;',
  );
}

/**
 * Письмо целиком: тема, текст и разметка.
 *
 * Текстовая часть обязательна: почтовые клиенты в организациях часто
 * показывают её, а не разметку, и письмо без неё выглядит пустым.
 */
export function billingLetter(
  kind: BillingLetter,
  lang: unknown,
  info: BillingLetterInfo,
): MailText {
  const w = WORDS[mailLang(lang)];
  const subject =
    kind === 'soon' ? w.soonSubject(info.company)
      : kind === 'over' ? w.overSubject(info.company)
        : w.renewedSubject(info.company);
  const lines =
    kind === 'soon' ? w.soonBody(info) : kind === 'over' ? w.overBody(info) : w.renewedBody(info);

  const nl = String.fromCharCode(10);
  const text = [...lines, '', info.link].join(nl + nl);
  const html =
    `<div style="font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#16161a">` +
    lines.map((l) => `<p style="margin:0 0 12px">${esc(l)}</p>`).join('') +
    `<p style="margin:18px 0 0"><a href="${esc(info.link)}" ` +
    `style="display:inline-block;padding:10px 18px;border-radius:10px;background:#3b40e8;` +
    `color:#fff;text-decoration:none;font-weight:600">${esc(w.button)}</a></p></div>`;

  return { subject, text, html };
}

/**
 * Кому писать про деньги и на каком языке.
 *
 * Владельцу и администраторам: оператор не решает, чем платит компания,
 * и письмо о сроке для него — тревога без возможности что-то сделать.
 *
 * Язык у каждого свой: один и тот же счёт может касаться украинского
 * владельца и польского администратора, и письмо должно прийти каждому
 * на его языке. Не выбрал — берём язык организации.
 */

export interface BillingTarget {
  email: string;
  lang: MailLang;
}

export interface BillingAudience {
  company: string;
  lang: MailLang;
  people: BillingTarget[];
}

export async function billingAudience(pool: Pool, tenantId: string): Promise<BillingAudience | null> {
  const tenant = await withSystem(pool, 'организация для письма', async (db) => {
    const { rows } = await db.query<{ name: string; lang: string }>(
      `SELECT name, lang FROM tenants WHERE id = $1`,
      [tenantId],
    );
    return rows[0] ?? null;
  });
  if (!tenant) return null;

  const people = await withTenant(pool, tenantId, async (db) => {
    const { rows } = await db.query<{ email: string; lang: string }>(
      `SELECT email, lang FROM users
        WHERE role IN ('owner', 'admin') AND is_active AND email <> ''
        ORDER BY role, created_at`,
    );
    return rows;
  });

  const lang = mailLang(tenant.lang);
  return {
    company: tenant.name,
    lang,
    people: people.map((p) => ({ email: p.email, lang: p.lang ? mailLang(p.lang) : lang })),
  };
}
