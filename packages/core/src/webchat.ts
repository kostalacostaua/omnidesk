import type { UnifiedMessage } from './types.js';

/**
 * Чат на сайте.
 *
 * Последний канал, где клиент ещё не мог написать: он стоит на странице
 * и открывать мессенджер не хочет. Отличий от прочих каналов два, и оба
 * упрощают дело.
 *
 * Первое: чужой платформы здесь нет. Никаких окон ответа, лимитов и
 * токенов — сообщение уже у нас в базе в момент отправки, «доставка»
 * оператору сводится к тому, что посетитель его забирает при опросе.
 *
 * Второе: собеседник анонимен. У него нет ни номера, ни аккаунта —
 * только идентификатор, который мы сами выдали и который лежит в его
 * браузере. Поэтому он и есть секрет: по ключу сайта можно начать
 * разговор, но нельзя прочитать чужой.
 */

export const WEBCHAT_CHANNEL = 'webchat' as const;

export interface WebchatSettings {
  /** Заголовок окна: «Підтримка», «Магазин квітів». */
  title: string;
  /**
   * Подпись под заголовком. Обещание, а не украшение: «Відповідаємо
   * протягом 15 хвилин» снимает половину вопросов «а вы тут?».
   */
  subtitle: string;
  /** Первая фраза, которую видит посетитель до своего сообщения. */
  greeting: string;
  /** Цвет кнопки и своих сообщений. */
  color: string;
  /**
   * Логотип компании. Хранится прямо в настройках как data:image —
   * картинка маленькая (интерфейс ужимает её до 128 точек), а отдельное
   * публичное хранилище ради неё означало бы ещё один адрес, который
   * нужно охранять.
   */
  logo: string;
  /** С какой стороны экрана кнопка. */
  position: 'right' | 'left';
  /**
   * Цвет свёрнутой кнопки. Пусто — тот же, что у чата.
   *
   * Отдельно от color потому, что это разные задачи. Цвет чата —
   * оформление, его подбирают под сайт. Цвет кнопки — заметность: на
   * тёмной странице фирменный синий сливается с фоном, и кнопку
   * приходится делать контрастной, а не «правильной».
   */
  launcher: string;
  /**
   * Появление кнопки. Не украшение: кнопка, возникшая из ниоткуда,
   * взгляд не ловит — страница уже прочитана глазами до конца.
   */
  anim: WebchatAnim;
  /** Когда показывать кнопку. */
  showMode: WebchatShow;
  /**
   * Через сколько: секунды при delay, проценты прокрутки при scroll.
   * При now не используется.
   */
  showAfter: number;
  /** Домены, где виджету разрешено работать. Пусто — где угодно. */
  domains: string[];
}

/**
 * Способы появления.
 *
 * Четыре, и намеренно без «настройте свою»: кнопка чата — не место
 * для самовыражения, а всё, что сложнее, начинает мешать читать.
 */
export type WebchatAnim = 'none' | 'fade' | 'slide' | 'pulse';

/**
 * Когда показывать кнопку.
 *
 * Сразу — как было. Через n секунд — человек успевает понять, куда
 * попал. После прокрутки — он уже читает, а не отскочил с первого
 * экрана; такому и написать есть о чём.
 */
export type WebchatShow = 'now' | 'delay' | 'scroll';

export const ANIM_TITLES: Record<WebchatAnim, string> = {
  none: 'Без анімації',
  fade: 'Плавна поява',
  slide: 'Виїзд знизу',
  pulse: 'Поява з пульсацією',
};

export const SHOW_TITLES: Record<WebchatShow, string> = {
  now: 'Одразу',
  delay: 'Через n секунд',
  scroll: 'Після прокручування сторінки',
};

export const WEBCHAT_DEFAULTS: WebchatSettings = {
  title: 'Чат з нами',
  subtitle: '',
  greeting: 'Вітаємо! Напишіть, і ми відповімо.',
  color: '#2F6BFF',
  logo: '',
  position: 'right',
  launcher: '',
  anim: 'fade',
  showMode: 'now',
  showAfter: 0,
  domains: [],
};

/** Сколько ждать или сколько прокрутить: за пределами этого — опечатка. */
const SHOW_LIMITS: Record<WebchatShow, { min: number; max: number; def: number }> = {
  now: { min: 0, max: 0, def: 0 },
  // Больше десяти минут — это «никогда»: столько на странице не сидят.
  delay: { min: 1, max: 600, def: 5 },
  // Сто процентов — это самый низ, докуда доходят единицы.
  scroll: { min: 1, max: 100, def: 30 },
};

/** Цвет свёрнутой кнопки с учётом «как у чата». */
export function launcherColor(s: Pick<WebchatSettings, 'color' | 'launcher'>): string {
  return s.launcher || s.color;
}

/**
 * Логотип попадает в страницу, которую видит посторонний, поэтому
 * принимается только картинка и только встроенная. Ссылка на чужой
 * адрес означала бы запрос со страницы клиента неизвестно куда.
 */
export function safeLogo(value: string): string {
  const s = (value ?? '').trim();
  if (!s) return '';
  if (!/^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(s)) return '';
  // 256 КБ в base64 — это примерно 190 КБ картинки: логотипу хватает
  // с запасом, а страница от этого не тяжелеет заметно.
  return s.length > 256 * 1024 ? '' : s;
}

/** Разбор настроек из meta канала: чужие поля игнорируются. */
export function webchatSettings(meta: unknown): WebchatSettings {
  const m = (meta ?? {}) as Record<string, unknown>;
  const domains = Array.isArray(m['domains'])
    ? (m['domains'] as unknown[]).map((d) => normalizeDomain(String(d))).filter(Boolean)
    : [];
  const showMode = safeShow(m['showMode']);

  return {
    title: String(m['title'] ?? WEBCHAT_DEFAULTS.title).slice(0, 60),
    subtitle: String(m['subtitle'] ?? WEBCHAT_DEFAULTS.subtitle).slice(0, 120),
    greeting: String(m['greeting'] ?? WEBCHAT_DEFAULTS.greeting).slice(0, 300),
    color: safeColor(String(m['color'] ?? WEBCHAT_DEFAULTS.color)),
    logo: safeLogo(String(m['logo'] ?? '')),
    position: m['position'] === 'left' ? 'left' : 'right',
    launcher: optionalColor(String(m['launcher'] ?? '')),
    anim: safeAnim(m['anim']),
    showMode: showMode,
    showAfter: safeShowAfter(showMode, m['showAfter']),
    domains,
  };
}

function safeAnim(raw: unknown): WebchatAnim {
  return raw === 'none' || raw === 'slide' || raw === 'pulse' || raw === 'fade'
    ? raw
    : WEBCHAT_DEFAULTS.anim;
}

function safeShow(raw: unknown): WebchatShow {
  return raw === 'delay' || raw === 'scroll' ? raw : 'now';
}

/**
 * Число берётся только осмысленное, и подставляется разумное вместо
 * пустого. Ноль секунд задержки — это «сразу», но записанное так, что
 * в настройках выбрано «через n секунд»: человек получает не то, что
 * выбрал, и ищет причину в другом месте.
 */
function safeShowAfter(mode: WebchatShow, raw: unknown): number {
  const lim = SHOW_LIMITS[mode];
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n < lim.min) return lim.def;
  return Math.min(n, lim.max);
}

/** Цвет, который разрешено не указывать: пусто означает «как у чата». */
function optionalColor(value: string): string {
  const s = value.trim();
  if (!s) return '';
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s : '';
}

/**
 * Цвет из настроек попадает в стили страницы, а страницу видят
 * посторонние. Поэтому берём только то, что точно является цветом, а не
 * «любую строку, которая обычно цвет».
 */
export function safeColor(value: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value.trim()) ? value.trim() : WEBCHAT_DEFAULTS.color;
}

/** Домен без схемы, порта и пути: сравнивать проще, ошибиться труднее. */
export function normalizeDomain(raw: string): string {
  const s = (raw ?? '').trim().toLowerCase();
  if (!s) return '';
  const noScheme = s.replace(/^[a-z]+:\/\//, '');
  const host = noScheme.split('/')[0]?.split(':')[0] ?? '';
  return /^[a-z0-9.-]+$/.test(host) ? host.replace(/^www\./, '') : '';
}

/**
 * Разрешён ли виджет на этой странице.
 *
 * Пустой список означает «где угодно»: так ведёт себя только что
 * созданный виджет, и требовать заполнить домены до первой проверки —
 * значит не дать человеку попробовать.
 *
 * Проверка эта не про безопасность: адрес страницы сообщает браузер, и
 * подделать его может кто угодно. Она про случайность — виджет,
 * забытый на тестовом поддомене, не будет собирать живые обращения.
 */
export function domainAllowed(allowed: string[], origin: string): boolean {
  if (!allowed.length) return true;
  const host = normalizeDomain(origin);
  if (!host) return false;
  return allowed.some((d) => host === d || host.endsWith('.' + d));
}

export interface WebchatIncoming {
  /** Идентификатор посетителя: он же его секрет. */
  visitorId: string;
  text: string;
  /** Номер сообщения у посетителя — ключ дедупликации при повторе. */
  clientId: string;
  name?: string | null;
  /** Страница, с которой написали: оператору это половина контекста. */
  page?: string | null;
}

/**
 * Привести сообщение посетителя к общему виду.
 *
 * Имя берём то, что он назвал сам; если не назвал — «Відвідувач» и
 * хвост идентификатора, чтобы разные люди в списке различались.
 */
export function normalizeWebchat(
  msg: WebchatIncoming,
  ctx: { tenantId: string; channelId: string },
): UnifiedMessage | null {
  const text = (msg.text ?? '').trim();
  if (!text) return null;

  return {
    tenantId: ctx.tenantId,
    channelId: ctx.channelId,
    channelType: WEBCHAT_CHANNEL,
    externalId: msg.clientId,
    peerId: msg.visitorId,
    peerProfile: {
      name: (msg.name ?? '').trim() || `Відвідувач ${msg.visitorId.slice(-4)}`,
    },
    direction: 'in',
    senderType: 'customer',
    content: { text: text.slice(0, 4000) },
    status: 'delivered',
    sentAt: new Date(),
    raw: { page: msg.page ?? null, visitorId: msg.visitorId },
  };
}

/**
 * Код для вставки на сайт.
 *
 * Одна строка, а не инструкция на страницу: всё, что сложнее, клиент
 * отдаёт своему программисту и возвращается через неделю. Скрипт сам
 * создаёт кнопку и рамку с чатом — сама рамка живёт на нашем домене,
 * поэтому переписка не ходит через чужой сайт и не зависит от его
 * правил безопасности.
 */
export function embedSnippet(appUrl: string, siteKey: string, position: 'right' | 'left' = 'right'): string {
  const base = appUrl.replace(/\/+$/, '');
  const side = position === 'left' ? ' data-side="left"' : '';
  return `<script src="${base}/chat.js" data-key="${siteKey}"${side} async></script>`;
}

/** Вариант для тех, кому нужен чат прямо в странице, а не кнопкой. */
export function iframeSnippet(appUrl: string, siteKey: string): string {
  const base = appUrl.replace(/\/+$/, '');
  return (
    `<iframe src="${base}/chat/${siteKey}?inline=1" ` +
    `style="width:100%;height:560px;border:0;border-radius:14px" ` +
    `title="Чат"></iframe>`
  );
}
