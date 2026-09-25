/**
 * Оповещения: что мы считаем событием и как оно звучит.
 *
 * Список событий закрытый и лежит здесь, а не в базе. Причина простая:
 * текст оповещения должен читаться человеком, который в этот момент не
 * смотрит в приложение. «conversation.new» в телеграме бесполезно, а
 * «Новий діалог у Instagram, Олена: є сумки?» — уже ответ на вопрос
 * «надо ли бросать всё и открывать инбокс».
 *
 * Поэтому у каждого события один и тот же набор данных превращается в
 * три вида текста: заголовок, строка и ссылка. Телеграм получает
 * строку, пуш — заголовок и строку, почта — всё вместе.
 *
 * Язык здесь украинский: оповещение уходит наружу, где никакого
 * переключателя языка нет. Перевод адресата — отдельная задача, и до
 * первого клиента с польской сменой её решать незачем.
 */

export const NOTIFY_EVENTS = [
  'conversation.new',
  'message.new',
  'message.waiting',
  'sla.warning',
  'ai.handoff',
  'channel.down',
  'lead.new',
  'invoice.paid',
] as const;

export type NotifyEvent = (typeof NOTIFY_EVENTS)[number];

export type NotifyTargetKind = 'telegram' | 'email' | 'push';

export interface NotifyPayload {
  /** Имя клиента или подпись лида. */
  who?: string | null;
  /** Текст сообщения клиента или причина события. */
  text?: string | null;
  /** Канал, в котором всё произошло: «Instagram», «Telegram-бот». */
  channel?: string | null;
  /** Диалог, чтобы ссылка вела прямо в него. */
  conversationId?: string | null;
  /** Сколько минут человек ждёт ответа. */
  waitingMinutes?: number | null;
  /**
   * Сколько рабочих минут осталось до конца обещанного срока.
   * Отрицательное — обещание уже нарушено.
   */
  slaLeftMinutes?: number | null;
  /** Почта и телефон лида с промо-страницы. */
  email?: string | null;
  phone?: string | null;
}

export interface NotifyMessage {
  title: string;
  body: string;
  /** Адрес внутри приложения. Пустая строка — вести некуда. */
  path: string;
}

/** Человеческие названия событий: ими подписаны переключатели. */
export const NOTIFY_TITLES: Record<NotifyEvent, string> = {
  'conversation.new': 'Новий діалог',
  'message.new': 'Нове повідомлення',
  'message.waiting': 'Клієнт чекає відповіді',
  'sla.warning': 'Ось-ось порушимо обіцянку',
  'ai.handoff': 'ШІ передав людині',
  'channel.down': 'Канал відвалився',
  'lead.new': 'Заявка з сайту',
  'invoice.paid': 'Клієнт сплатив рахунок',
};

/** Пояснение к переключателю: когда именно это придёт. */
export const NOTIFY_HINTS: Record<NotifyEvent, string> = {
  'conversation.new': 'Перше повідомлення від нового клієнта.',
  'message.new':
    'Кожне повідомлення клієнта в уже відкритому діалозі. Приходить одразу, а не через час.',
  'message.waiting': 'Повідомлення клієнта без відповіді довше за визначений час.',
  'sla.warning':
    'Час на першу відповідь добігає кінця. Рахується в робочих годинах — уночі не турбує.',
  'ai.handoff': 'ШІ зупинився і чекає на оператора.',
  'channel.down': 'Канал перестав працювати: відкликаний токен, негодящий ключ.',
  'lead.new': 'Хтось залишив заявку на промо-сторінці.',
  'invoice.paid': 'Клієнт натиснув «оплату здійснено» у своєму кабінеті. Гроші треба звірити з випискою.',
};

export function isNotifyEvent(value: string): value is NotifyEvent {
  return (NOTIFY_EVENTS as readonly string[]).includes(value);
}

/** Обрезать текст клиента до длины, читаемой в уведомлении. */
export function shorten(text: string | null | undefined, limit = 160): string {
  const s = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return s.length > limit ? `${s.slice(0, limit - 1)}…` : s;
}

/**
 * Собрать текст оповещения.
 *
 * Ничего не выдумываем: если имени нет, пишем «клієнт», а не пустое
 * место, и если текста нет (пришла только картинка) — так и говорим.
 */
export function renderNotify(event: NotifyEvent, p: NotifyPayload): NotifyMessage {
  const who = (p.who ?? '').trim() || 'клієнт';
  const channel = (p.channel ?? '').trim();
  const where = channel ? ` · ${channel}` : '';
  const said = shorten(p.text) || 'без тексту (вкладення)';
  const path = p.conversationId ? `/#chat=${p.conversationId}` : '';

  switch (event) {
    case 'conversation.new':
      return {
        title: `Новий діалог${where}`,
        body: `${who}: ${said}`,
        path,
      };

    /*
     * Обычное сообщение в уже открытом диалоге.
     *
     * Заголовок — имя клиента, а не «новое сообщение»: на телефоне
     * видно две строки, и первая должна отвечать на вопрос «кто», а не
     * повторять то, что человек и так понял по значку.
     */
    case 'message.new':
      return {
        title: `${who}${where}`,
        body: said,
        path,
      };

    case 'message.waiting': {
      const mins = p.waitingMinutes ?? 0;
      return {
        title: `Чекає відповіді ${mins} хв${where}`,
        body: `${who}: ${said}`,
        path,
      };
    }

    /*
     * Предупреждение о нарушении. Смысл его в одном: успеть. Поэтому в
     * заголовке не «прошло столько-то», а сколько осталось — это
     * единственное число, по которому человек решает, бросать ли
     * текущее дело.
     */
    case 'sla.warning': {
      const left = p.slaLeftMinutes ?? 0;
      const head =
        left > 0
          ? `Залишилось ${left} хв на відповідь${where}`
          : `Прострочено на ${Math.abs(left)} хв${where}`;
      return { title: head, body: `${who}: ${said}`, path };
    }

    case 'ai.handoff':
      return {
        title: `ШІ передав людині${where}`,
        body: `${who}: ${said}`,
        path,
      };

    case 'channel.down':
      return {
        title: `Канал не працює${channel ? `: ${channel}` : ''}`,
        body: shorten(p.text) || 'Потрібно перепідключити канал у налаштуваннях.',
        path: '/#view=channels',
      };

    case 'invoice.paid':
      return {
        // Заголовок называет не «оплату», а слова клиента: денег мы ещё
        // не видели, и путать одно с другим в оповещении нельзя.
        title: `Клієнт каже, що сплатив${who ? `: ${who}` : ''}`,
        body: shorten(p.text) || 'Перевірте виписку і позначте рахунок оплаченим.',
        path: '/#view=billing',
      };

    case 'lead.new': {
      const contact = [p.email, p.phone].filter(Boolean).join(' · ');
      return {
        title: 'Заявка з сайту',
        body: [who, contact, shorten(p.text, 200)].filter(Boolean).join(' · '),
        path: '',
      };
    }
  }
}

/**
 * Ключ повтора.
 *
 * Обход «кто ждёт ответа» идёт по кругу, и без этого ключа одно и то же
 * ожидание уезжало бы в телеграм каждую минуту. Для событий, которые
 * случаются однажды (новый диалог), ключ всё равно нужен: очередь
 * повторяет задачу после падения воркера.
 */
export function dedupKey(event: NotifyEvent, p: NotifyPayload, extra?: string): string {
  const subject = p.conversationId ?? p.email ?? p.phone ?? 'общее';
  return [event, subject, extra].filter(Boolean).join(':');
}

/** Текст для телеграма: заголовок жирным, дальше строка и ссылка. */
export function telegramText(m: NotifyMessage, appUrl: string): string {
  const link = m.path && appUrl ? `${appUrl.replace(/\/+$/, '')}${m.path}` : '';
  return [`<b>${escapeHtml(m.title)}</b>`, escapeHtml(m.body), link].filter(Boolean).join('\n');
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
