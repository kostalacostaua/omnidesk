/**
 * Вебхуки: события наружу, к коду клиента.
 *
 * Обратная сторона своего канала. Там клиент присылает нам сообщения
 * своей системы; здесь мы рассказываем его системе о том, что
 * произошло у нас, — и дальше он делает с этим что хочет: пишет в свою
 * базу, считает отчёты, дёргает склад.
 *
 * Три правила, которые определяют всё остальное.
 *
 * Список событий закрытый и лежит в коде. Событие — это обещание
 * формата: у кого-то на той стороне написан разбор, и «добавим поле по
 * ходу» означает чужой сломанный разбор. Новое поле добавить можно,
 * старое переименовать — нет.
 *
 * Только https и только наружу. Адрес задаёт клиент, а запрос уходит из
 * нашей сети: этим полем можно попросить нас постучаться во внутренний
 * адрес, которого снаружи не видно.
 *
 * Подпись обязательна. Адрес вебхука рано или поздно узнают — он живёт
 * в логах, в прокси, в браузере разработчика. Без подписи любой, кто
 * его узнал, слал бы клиенту события от нашего имени.
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { withTenant, type Pool } from './db.js';
import type { WebhookJob } from './queues.js';

export const HOOK_EVENTS = [
  'message.in',
  'message.out',
  'message.read',
  'conversation.created',
  'conversation.status',
  'conversation.assigned',
  'conversation.closed',
  'contact.created',
  'contact.updated',
  'order.created',
] as const;

export type HookEvent = (typeof HOOK_EVENTS)[number];

/** Названия событий: ими подписаны переключатели в кабинете. */
export const HOOK_TITLES: Record<HookEvent, string> = {
  'message.in': 'Вхідне повідомлення',
  'message.out': 'Вихідне повідомлення',
  'message.read': 'Повідомлення прочитано',
  'conversation.created': 'Новий діалог',
  'conversation.status': 'Зміна статусу діалогу',
  'conversation.assigned': 'Діалог призначено',
  'conversation.closed': 'Діалог закрито',
  'contact.created': 'Новий контакт',
  'contact.updated': 'Контакт змінено',
  'order.created': 'Замовлення створено',
};

/** Когда именно это придёт: пояснение под переключателем. */
export const HOOK_HINTS: Record<HookEvent, string> = {
  'message.in': 'Клієнт написав. Найгучніша подія: по ній приходить майже все інше.',
  'message.out': 'Відповідь оператора або бота пішла в канал і прийнята ним.',
  'message.read': 'Клієнт прочитав відповідь. Є не в кожному каналі.',
  'conversation.created': 'Перше повідомлення в новому діалозі.',
  'conversation.status': 'Діалог переїхав на інший статус воронки.',
  'conversation.assigned': 'У діалогу зʼявився або змінився відповідальний.',
  'conversation.closed': 'Діалог закрито.',
  'contact.created': 'Зʼявився контакт, якого раніше не було.',
  'contact.updated': 'У контакта змінилися імʼя, телефон або пошта.',
  'order.created': 'Оператор оформив замовлення з діалогу.',
};

export function isHookEvent(value: string): value is HookEvent {
  return (HOOK_EVENTS as readonly string[]).includes(value);
}

/** Только известные события: чужая строка в подписке — молчащий вебхук. */
export function cleanHookEvents(raw: unknown): HookEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: HookEvent[] = [];
  for (const item of raw) {
    const s = String(item);
    if (isHookEvent(s) && !out.includes(s)) out.push(s);
  }
  return out;
}

/**
 * Адрес, на который мы будем стучаться.
 *
 * Проверка не про опечатки, а про то, куда именно уйдёт запрос.
 * Внутренние адреса запрещены: снаружи их не видно, а из нашей сети
 * видно — и полем ввода это превращается в чужие глаза внутри.
 */
export function badOutUrl(raw: string): string | null {
  if (!raw) return 'Вкажіть адресу для вихідних повідомлень';
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return 'Адреса має бути повною, разом з https://';
  }
  if (u.protocol !== 'https:') return 'Адреса має починатися з https://';

  const host = u.hostname.toLowerCase();
  const local =
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^(127|10)\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    host === '0.0.0.0' ||
    host === '[::1]';
  if (local) return 'Адреса має бути доступною ззовні, а не внутрішньою';

  return null;
}

/**
 * Свой заголовок клиента.
 *
 * Нужен тем, у кого перед приложением стоит шлюз: он смотрит на
 * Authorization и до кода клиента запрос не доводит вовсе. Подпись это
 * не заменяет — она про то, что тело не подменили, — но без заголовка
 * событие до такого клиента просто не доедет.
 */
export function badHookHeader(name: string, value: string): string | null {
  if (!name && !value) return null;
  if (!name) return 'Вкажіть назву заголовка';
  if (!value) return 'Вкажіть значення заголовка';
  if (!/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(name)) {
    return 'Назва заголовка — латиниця, цифри і дефіс';
  }
  // Наши собственные заголовки перебивать нельзя: клиент проверяет
  // подпись именно по ним, и подменённый x-rozmovio-signature — это
  // тихо выключенная проверка.
  if (/^x-rozmovio-/i.test(name)) return 'Заголовки x-rozmovio-* зайняті нашими';
  if (/[\r\n]/.test(value)) return 'Значення заголовка в один рядок';
  if (value.length > 500) return 'Значення заголовка задовге';
  return null;
}

/**
 * Подпись события.
 *
 * Подписывается не одно тело, а время вместе с телом. Тело без времени
 * подписать достаточно, чтобы его нельзя было изменить, но недостаточно,
 * чтобы нельзя было прислать второй раз: перехваченный запрос с
 * настоящей подписью остаётся настоящим навсегда. Со временем внутри
 * подписи клиент отбрасывает всё старше пяти минут.
 */
export function signHook(secret: string, stamp: number, body: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(`${stamp}.${body}`).digest('hex');
}

/** Сверка подписи для той стороны и для наших тестов. */
export function hookSignatureOk(
  secret: string,
  stamp: number,
  body: string,
  given: string,
): boolean {
  const want = Buffer.from(signHook(secret, stamp, body));
  const got = Buffer.from(given);
  return want.length === got.length && timingSafeEqual(want, got);
}

export interface HookAuth {
  secret: string;
  headerName?: string;
  headerValue?: string;
}

/**
 * Заголовки запроса.
 *
 * Событие и его номер вынесены наружу тела: по ним чужой код
 * маршрутизирует запрос, не разбирая JSON, а номер доставки — это то,
 * что человек назовёт нам, когда придёт с вопросом «а вы точно
 * присылали».
 */
export function hookHeaders(
  auth: HookAuth,
  event: string,
  deliveryId: string,
  body: string,
  stamp = Math.floor(Date.now() / 1000),
): Record<string, string> {
  const head: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': 'Rozmovio-Webhook/1',
    'x-rozmovio-event': event,
    'x-rozmovio-delivery': deliveryId,
    'x-rozmovio-timestamp': String(stamp),
    'x-rozmovio-signature': signHook(auth.secret, stamp, body),
  };
  if (auth.headerName && auth.headerValue) head[auth.headerName] = auth.headerValue;
  return head;
}

/**
 * Тело события.
 *
 * Плоский и одинаковый для всех событий верх — event, время, компания —
 * и разное содержимое в data. Клиент пишет один разбор конверта и
 * дальше смотрит по имени события.
 */
export interface HookBody {
  event: HookEvent | 'ping';
  /** Время события, а не отправки: повтор через час не меняет его. */
  at: string;
  tenantId: string;
  data: Record<string, unknown>;
}

export function hookBody(
  tenantId: string,
  event: HookEvent | 'ping',
  data: Record<string, unknown>,
): HookBody {
  return { event, at: new Date().toISOString(), tenantId, data };
}

/**
 * Кому это событие интересно.
 *
 * Выборка на каждое событие, а не кэш: вебхуков у компании единицы,
 * запрос идёт по индексу, а кэш означал бы, что снятая галочка
 * действует не сразу — и человек, который её снял, продолжает получать
 * то, от чего отписался.
 */
export async function hookTargets(
  pool: Pool,
  tenantId: string,
  event: HookEvent,
): Promise<string[]> {
  return withTenant(pool, tenantId, async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM webhooks WHERE is_active AND $1 = ANY(events)`,
      [event],
    );
    return rows.map((r) => r.id);
  });
}

/**
 * Запись попытки в журнал.
 *
 * Общая для кабинета и воркера: проверка «перевірити» и живое событие
 * должны быть видны в одном списке и выглядеть одинаково, иначе journal
 * читается как два разных.
 *
 * Тут же чистка: полсотни последних попыток на вебхук. Это не архив, а
 * то, что смотрят при отладке приёма; хранить чужие тела событий
 * дольше значило бы хранить чужую переписку второй раз.
 */
export interface HookDelivery {
  id: string;
  webhookId: string;
  event: string;
  status: number | null;
  error: string | null;
  body: unknown;
}

export async function writeHookDelivery(
  pool: Pool,
  tenantId: string,
  d: HookDelivery,
): Promise<void> {
  await withTenant(pool, tenantId, async (db) => {
    /*
     * Повтор той же доставки — это та же строка со счётчиком попыток, а
     * не пятая строка в журнале: пять записей об одном событии читаются
     * как пять событий.
     */
    await db.query(
      `INSERT INTO webhook_deliveries (id, tenant_id, webhook_id, event, status, error, body)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE
         SET status = EXCLUDED.status,
             error = EXCLUDED.error,
             tries = webhook_deliveries.tries + 1`,
      [
        d.id,
        tenantId,
        d.webhookId,
        d.event,
        d.status,
        d.error ? d.error.slice(0, 500) : null,
        JSON.stringify(d.body),
      ],
    );
    await db.query(
      `DELETE FROM webhook_deliveries
        WHERE webhook_id = $1 AND id NOT IN (
          SELECT id FROM webhook_deliveries WHERE webhook_id = $1
           ORDER BY created_at DESC LIMIT 50)`,
      [d.webhookId],
    );
  });
}

/**
 * Рассказать подписчикам о том, что случилось.
 *
 * Одна функция на три службы: событие рождается то в воркере, то в
 * кабинете, то в службе сессий, а выглядеть снаружи обязано одинаково.
 *
 * Тело собирается здесь и уезжает в задачу целиком. Это осознанная
 * плата памятью: событие описывает то, что было в момент события, и
 * досборка при повторе через час прислала бы клиенту другую правду.
 */
export async function emitHook(
  pool: Pool,
  add: (job: WebhookJob) => Promise<unknown>,
  tenantId: string,
  event: HookEvent,
  data: Record<string, unknown>,
): Promise<void> {
  const targets = await hookTargets(pool, tenantId, event);
  if (!targets.length) return;
  const body = hookBody(tenantId, event, data);
  for (const webhookId of targets) {
    await add({ tenantId, webhookId, deliveryId: randomUUID(), event, body });
  }
}
