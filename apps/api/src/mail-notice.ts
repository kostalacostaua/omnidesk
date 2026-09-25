/**
 * Письмо о принятой оплате.
 *
 * Уходит сразу, а не обходом по расписанию: между «заплатил» и «увидел
 * подтверждение» человек волнуется, и чем дольше молчание, тем больше
 * писем в поддержку с вопросом «деньги ушли, вы получили?».
 *
 * Отдельным файлом, потому что отправляют его из двух разных мест —
 * карта через Paddle и счёт по безналу, — а письмо должно быть одно и
 * то же: два похожих письма о деньгах выглядят как ошибка биллинга.
 */

import { billingAudience, billingLetter, type Pool } from '@omnidesk/core';

export interface NoticeMailer {
  send: (m: { to: string; subject: string; text: string; html: string }) => Promise<unknown>;
}

/** Дата в письме — как её пишут люди, а не как её хранит база. */
function dayText(day: string): string {
  const [y, m, d] = String(day).slice(0, 10).split('-');
  return d && m && y ? `${d}.${m}.${y}` : String(day);
}

export async function mailRenewed(opts: {
  pool: Pool;
  mailer: NoticeMailer;
  appUrl: string;
  tenantId: string;
  paidUntil: string;
  log?: (o: unknown, m: string) => void;
}): Promise<void> {
  const who = await billingAudience(opts.pool, opts.tenantId);
  if (!who || !who.people.length) return;

  for (const person of who.people) {
    const letter = billingLetter('renewed', person.lang, {
      company: who.company,
      day: dayText(opts.paidUntil),
      link: `${opts.appUrl.replace(/[/]+$/, '')}/app`,
    });
    try {
      await opts.mailer.send({
        to: person.email,
        subject: letter.subject,
        text: letter.text,
        html: letter.html,
      });
    } catch (err) {
      // Письмо не ушло — это не повод отменять оплату. Пишем в журнал
      // и живём дальше: деньги приняты, срок продлён.
      opts.log?.({ err, to: person.email }, 'Письмо об оплате не ушло');
    }
  }
}
