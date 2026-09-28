/**
 * Написать первым.
 *
 * Обычно диалог заводит клиент: он пишет, мы отвечаем. Но три канала
 * из тринадцати разрешают обратное, и это ровно те случаи, ради
 * которых компании держат номер: перезвонить по заявке с сайта,
 * прислать накладную, ответить на пропущенный звонок в мессенджер.
 *
 * Канал решает не только «можно ли», но и «чем»:
 *
 *   telegram_user   — обычный текст. Пишет живой аккаунт по номеру,
 *                     ограничений на первое сообщение у Telegram нет.
 *   whatsapp_user   — обычный текст. Шлюз держит сессию обычного
 *                     номера, и для него это такая же переписка.
 *   whatsapp (Business) — только утверждённый шаблон. Окно 24 часов
 *                     ещё не открывалось, а вне окна Meta принимает
 *                     от нас ровно шаблоны и ничего больше.
 *
 * Остальные — нет, и это не наше ограничение: у Instagram и Messenger
 * первое сообщение может быть только ответом, Viber для бизнеса шлёт
 * первым только через рассылку с отдельной оплатой, а у бота Telegram
 * нет способа узнать чат человека, который ему не писал.
 */

/** Каналы, которые умеют написать первыми. */
export const OUTREACH_CHANNELS = ['telegram_user', 'whatsapp_user', 'whatsapp'] as const;

export type OutreachChannel = (typeof OUTREACH_CHANNELS)[number];

export function canStartChat(type: string): type is OutreachChannel {
  return (OUTREACH_CHANNELS as readonly string[]).includes(type);
}

/** Уйдёт ли первым свободный текст — или только утверждённый шаблон. */
export function startsWithTemplate(type: string): boolean {
  return type === 'whatsapp';
}

/**
 * Адрес собеседника в этом канале.
 *
 * У WhatsApp — и у официального, и у шлюза — адрес и есть номер:
 * цифрами, без плюса, как его понимают обе стороны. У номерного
 * Telegram адресом служит внутренний идентификатор аккаунта, которого
 * мы про незнакомого человека ещё не знаем: пишем номер с плюсом и
 * оставляем службе сессий выяснить остальное. Плюс здесь и есть
 * признак «этот адрес ещё не раскрыт».
 */
export function outreachPeerId(type: OutreachChannel, phoneE164: string): string {
  const digits = phoneE164.replace(/[^0-9]/g, '');
  return type === 'telegram_user' ? `+${digits}` : digits;
}

/** Ждёт ли этот адрес раскрытия службой сессий. */
export function peerNeedsLookup(peerId: string): boolean {
  return peerId.startsWith('+');
}

/**
 * Окно ответа у диалога, который завели мы.
 *
 * У WhatsApp Business окна нет и не было: клиент нам не писал. Тип
 * standard с пустым сроком — это и значит «закрыто», и интерфейс сам
 * предложит шаблон вместо поля ввода. У остальных двух окна нет как
 * понятия, и «none» говорит ровно это, а не «закрыто навсегда».
 */
export function outreachWindow(type: OutreachChannel): { type: string; expiresAt: null } {
  return { type: type === 'whatsapp' ? 'standard' : 'none', expiresAt: null };
}
