/**
 * Что делать с новым человеком в CRM.
 *
 * До сих пор ответ был один: заводить лид. Для отдела продаж это верно —
 * лид проходит квалификацию и превращается в сделку. Но добрая половина
 * компаний работает иначе: пишут те, кто уже покупает, и лид из них —
 * лишний шаг, после которого карточку всё равно конвертируют руками.
 *
 * Поэтому выбор из двух, и он принадлежит компании, а не нам.
 */

export const CRM_CREATE_AS = ['lead', 'contact'] as const;
export type CrmCreateAs = (typeof CRM_CREATE_AS)[number];

export interface CrmSettings {
  /** Кого заводить, если человека в CRM нет. */
  createAs: CrmCreateAs;
  /**
   * Назначать ответственным того, кто взял диалог, — если его почта
   * совпала с почтой сотрудника в CRM.
   *
   * По почте, а не по имени: имена в CRM пишут как придётся, «Оля» и
   * «Ольга Петренко» — один человек, а почта у него одна.
   */
  ownerByEmail: boolean;
}

export const CRM_SETTINGS_DEFAULT: CrmSettings = {
  // Лид по умолчанию: так вело себя приложение до появления выбора, и
  // менять поведение молча у тех, кто уже работает, нельзя.
  createAs: 'lead',
  ownerByEmail: false,
};

export function parseCrmSettings(raw: unknown): CrmSettings {
  const r = (raw ?? {}) as Record<string, unknown>;
  const createAs = (CRM_CREATE_AS as readonly string[]).includes(String(r['createAs']))
    ? (r['createAs'] as CrmCreateAs)
    : CRM_SETTINGS_DEFAULT.createAs;
  return { createAs, ownerByEmail: r['ownerByEmail'] === true };
}

/**
 * Название канала для поля «источник».
 *
 * В CRM это читают люди, а не программы, поэтому «webchat» там не
 * годится: в отчёте по источникам такая строка выглядит как сбой
 * выгрузки. Незнакомый канал отдаётся как есть — это лучше, чем пустое
 * поле, по которому потом не понять, откуда пришёл человек.
 */
export const CRM_SOURCE: Record<string, string> = {
  telegram: 'Telegram',
  telegram_bot: 'Telegram',
  telegram_user: 'Telegram',
  telegram_business: 'Telegram',
  instagram: 'Instagram Direct',
  messenger: 'Facebook Messenger',
  whatsapp: 'WhatsApp',
  viber_business: 'Viber',
  messenger_comments: 'Facebook, коментарі',
  instagram_comments: 'Instagram, коментарі',
  webchat: 'Чат на сайті',
  custom: 'Свій канал',
};

export function crmSource(channelType: string): string {
  return CRM_SOURCE[channelType] ?? channelType;
}
