import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Проверка подписей входящих вебхуков.
 *
 * Это первый рубеж обороны: URL вебхуков публичны, и без проверки подписи
 * кто угодно может прислать вам «сообщение от клиента» или подделать статусы.
 *
 * Два правила, которые нарушают чаще всего:
 *
 *   1. Считать HMAC надо от СЫРОГО тела запроса, до JSON.parse. Любая
 *      пересериализация меняет байты — подпись не сойдётся, и вы полдня
 *      будете думать, что у вас неправильный секрет.
 *
 *   2. Сравнивать надо constant-time. Обычный === выходит из цикла на первом
 *      несовпавшем байте, и по времени ответа подпись можно подобрать.
 */

/** Constant-time сравнение строк. Длина утекает — это допустимо и неизбежно. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Meta (WhatsApp, Instagram, Messenger).
 * Заголовок: X-Hub-Signature-256: sha256=<hex>
 */
export function verifyMetaSignature(
  rawBody: Buffer,
  headerValue: string | undefined,
  appSecret: string,
): boolean {
  if (!headerValue || !appSecret) return false;
  const expected =
    'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex');
  return safeEqual(expected, headerValue);
}

/**
 * Telegram.
 * Секрет задаётся в setWebhook и возвращается в заголовке
 * X-Telegram-Bot-Api-Secret-Token. Это единственная встроенная
 * аутентификация вебхука Telegram — не пропускайте её.
 */
export function verifyTelegramSecret(
  headerValue: string | undefined,
  expectedSecret: string,
  channelId?: string,
): boolean {
  if (!headerValue || !expectedSecret) return false;
  if (safeEqual(expectedSecret, headerValue)) return true;
  // Свой бот клиента шлёт копию обновлений сам и знает не общий секрет,
  // а производный от него и от канала: так секрет одного клиента не
  // подходит к каналу другого.
  if (channelId && safeEqual(telegramForwardSecret(expectedSecret, channelId), headerValue)) {
    return true;
  }
  return false;
}

/**
 * Секрет для пересылки обновлений своим ботом.
 *
 * Выводится из общего секрета и идентификатора канала, а не хранится
 * в базе: ingress проверяет его без единого запроса к базе на горячем
 * пути, а подобрать его, зная чужой, нельзя.
 */
export function telegramForwardSecret(masterSecret: string, channelId: string): string {
  return createHmac('sha256', masterSecret).update(`tg-forward:${channelId}`).digest('hex').slice(0, 48);
}

/**
 * Zoho Notification API.
 * Токен (≤50 символов) задаётся при подписке и приходит в теле колбэка.
 */
export function verifyZohoToken(
  received: string | undefined,
  expected: string,
): boolean {
  if (!received || !expected) return false;
  return safeEqual(expected, received);
}

/**
 * Подпись запроса от Deluge-функции расширения Zoho.
 *
 * Контекст: единственный способ доверенно узнать, КАКОЙ пользователь Zoho
 * открыл виджет, — прогнать запрос через Deluge-функцию и прочитать
 * crmAPIRequest.user_info (его проставляет Zoho, клиент повлиять не может).
 * Deluge подписывает payload общим секретом, мы проверяем здесь.
 *
 * ZOHO.CRM.CONFIG.getCurrentUser() на бэкенде НЕ доверенный источник:
 * это JavaScript в iframe, подделывается из DevTools за пять секунд.
 */
export function verifyZohoWidgetSignature(
  payload: string,
  signature: string | undefined,
  sharedSecret: string,
  opts: { maxSkewSeconds?: number; timestamp?: number; now?: number } = {},
): { ok: true } | { ok: false; reason: string } {
  if (!signature) return { ok: false, reason: 'missing_signature' };
  if (!sharedSecret) return { ok: false, reason: 'missing_secret' };

  const expected = createHmac('sha256', sharedSecret).update(payload).digest('hex');
  if (!safeEqual(expected, signature)) {
    return { ok: false, reason: 'bad_signature' };
  }

  // Защита от replay: без окна свежести подписанный payload можно
  // переиспользовать бесконечно.
  const { timestamp, maxSkewSeconds = 300, now = Math.floor(Date.now() / 1000) } = opts;
  if (timestamp !== undefined) {
    if (!Number.isFinite(timestamp)) return { ok: false, reason: 'bad_timestamp' };
    if (Math.abs(now - timestamp) > maxSkewSeconds) {
      return { ok: false, reason: 'stale_timestamp' };
    }
  }

  return { ok: true };
}

/**
 * Верификация подписки на вебхук Meta (GET-запрос при настройке).
 * Возвращает hub.challenge, который надо отдать в теле ответа.
 */
export function verifyMetaSubscription(
  query: Record<string, unknown>,
  verifyToken: string,
): string | null {
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];
  if (mode !== 'subscribe') return null;
  if (typeof token !== 'string' || !safeEqual(verifyToken, token)) return null;
  return typeof challenge === 'string' ? challenge : null;
}
