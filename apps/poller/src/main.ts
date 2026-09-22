import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import {
  QUEUE_INBOUND,
  createPool,
  decryptJson,
  defaultJobOptions,
  parseMasterKey,
  withSystem,
  withTenant,
  type InboundJob,
} from '@omnidesk/core';

/**
 * Long polling для Telegram — альтернатива вебхукам.
 *
 * Зачем он нужен. Вебхук требует публичный HTTPS-адрес: Telegram должен
 * достучаться до вас снаружи. На машине разработчика этого нет, а туннель
 * не везде поднимается — его режут корпоративные сети, антивирусы
 * и некоторые провайдеры.
 *
 * Polling переворачивает направление: не Telegram стучится к вам, а вы
 * сами спрашиваете «есть новое?». Работает из-за любого NAT и файрвола,
 * потому что это обычное исходящее соединение.
 *
 * Что важно: дальше по цепочке разницы нет никакой. Апдейты попадают
 * в ту же очередь `inbound`, что и от `ingress`, и воркеры не знают,
 * каким путём они пришли. Переключение режима не меняет ни строки
 * в обработке сообщений.
 *
 * Чего polling НЕ заменяет: Meta (WhatsApp, Instagram, Messenger)
 * работает только через вебхуки. Для них публичный адрес обязателен.
 */

const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379';
const DATABASE_URL = process.env['DATABASE_URL'] ?? '';
const TELEGRAM_API_ROOT = process.env['TELEGRAM_API_ROOT'] ?? 'https://api.telegram.org';

/** Сколько Telegram держит соединение, если новых сообщений нет. */
const LONG_POLL_SECONDS = 25;
/** Как часто перечитывать список каналов из базы. */
const REFRESH_CHANNELS_MS = 30_000;

// family: 0 — поиск и IPv4, и IPv6. Внутренняя сеть Railway отдаёт
// адреса *.railway.internal по IPv6, а ioredis по умолчанию ищет
// только IPv4: без этой опции соединение с Redis просто не устанавливается.
const connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null, family: 0 });
const pool = createPool(DATABASE_URL);
const masterKey = parseMasterKey(process.env['ENCRYPTION_MASTER_KEY']);
const inbound = new Queue<InboundJob>(QUEUE_INBOUND, { connection, defaultJobOptions });

const log = (level: string, msg: string, extra: Record<string, unknown> = {}): void => {
  console.log(JSON.stringify({ level, msg, ts: new Date().toISOString(), ...extra }));
};

const ALLOWED_UPDATES = [
  'message',
  'edited_message',
  // Реакции Telegram не присылает по умолчанию: подписка на них заметно
  // увеличивает поток обновлений, поэтому её включают явно.
  'message_reaction',
  'business_connection',
  'business_message',
  'edited_business_message',
  'deleted_business_messages',
];

interface Channel {
  channelId: string;
  tenantId: string;
  botToken: string;
}

/** Активные Telegram-каналы вместе с расшифрованными токенами. */
async function loadChannels(): Promise<Channel[]> {
  const routes = await withSystem(pool, 'список Telegram-каналов', async (db) => {
    const { rows } = await db.query<{ channel_id: string; tenant_id: string }>(
      `SELECT channel_id, tenant_id
         FROM channel_routes
        WHERE channel_type IN ('telegram_bot', 'telegram_business')
          AND status = 'active'`,
    );
    return rows;
  });

  const out: Channel[] = [];
  for (const r of routes) {
    // Токен зашифрован ключом тенанта — читаем его в контексте тенанта.
    const creds = await withTenant(pool, r.tenant_id, async (db) => {
      const { rows } = await db.query<{ credentials_enc: Buffer }>(
        `SELECT credentials_enc FROM channels WHERE id = $1 LIMIT 1`,
        [r.channel_id],
      );
      return rows[0]?.credentials_enc ?? null;
    });
    if (!creds) continue;

    try {
      const { botToken } = decryptJson<{ botToken: string }>(masterKey, r.tenant_id, creds);
      out.push({ channelId: r.channel_id, tenantId: r.tenant_id, botToken });
    } catch (err) {
      log('error', 'Не удалось расшифровать токен канала', {
        channelId: r.channel_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}

async function tg(token: string, method: string, body?: unknown): Promise<any> {
  const res = await fetch(`${TELEGRAM_API_ROOT}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    // Таймаут чуть больше long-poll, иначе оборвём собственный запрос.
    signal: AbortSignal.timeout((LONG_POLL_SECONDS + 10) * 1000),
  });
  return res.json();
}

/**
 * Цикл опроса одного канала.
 *
 * offset хранится в Redis, а не в памяти: перезапуск процесса не должен
 * приводить к повторной обработке уже полученных апдейтов. Дедупликация
 * в базе их всё равно отсечёт, но лишняя работа ни к чему.
 */
async function pollChannel(ch: Channel, stop: { value: boolean }): Promise<void> {
  const offsetKey = `tg:offset:${ch.channelId}`;

  // Вебхук и polling взаимоисключающи: при активном вебхуке Telegram
  // вернёт 409 Conflict на getUpdates. Снимаем его молча.
  const del = await tg(ch.botToken, 'deleteWebhook', { drop_pending_updates: false });
  if (del?.ok) log('info', 'Вебхук снят, канал переведён на polling', { channelId: ch.channelId });

  while (!stop.value) {
    try {
      const stored = await connection.get(offsetKey);
      const offset = stored ? Number(stored) : undefined;

      const res = await tg(ch.botToken, 'getUpdates', {
        ...(offset !== undefined ? { offset } : {}),
        timeout: LONG_POLL_SECONDS,
        allowed_updates: ALLOWED_UPDATES,
      });

      if (!res?.ok) {
        log('warn', 'Telegram вернул ошибку', {
          channelId: ch.channelId,
          description: res?.description,
        });
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }

      const updates = (res.result ?? []) as Array<{ update_id: number }>;
      if (updates.length === 0) continue;

      for (const update of updates) {
        await inbound.add('telegram', {
          provider: 'telegram',
          channelId: ch.channelId,
          tenantId: ch.tenantId,
          payload: update,
          receivedAt: new Date().toISOString(),
        });
      }

      // Подтверждаем ТОЛЬКО после того, как всё поставлено в очередь.
      // Сдвинуть offset раньше — значит потерять апдейты при падении.
      const maxId = Math.max(...updates.map((u) => u.update_id));
      await connection.set(offsetKey, String(maxId + 1));

      log('info', 'Получены апдейты', { channelId: ch.channelId, count: updates.length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Таймаут long-poll — это норма, а не ошибка: Telegram просто
      // не дождался новых сообщений.
      if (!msg.includes('timeout') && !msg.includes('aborted')) {
        log('error', 'Сбой опроса', { channelId: ch.channelId, error: msg });
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function main(): Promise<void> {
  // ЗАЩИТА ОТ САМОГО ОПАСНОГО СЦЕНАРИЯ.
  //
  // Poller при старте вызывает deleteWebhook. Если он случайно окажется
  // запущен там, где каналы работают через вебхуки, он их молча снесёт —
  // и сообщения перестанут приходить у всех клиентов сразу. Диагностировать
  // такое тяжело: в логах ничего не падает, просто тишина.
  //
  // Поэтому: задан PUBLIC_URL — значит контур вебхучный, и poller
  // обязан отказаться стартовать.
  if (process.env['PUBLIC_URL']) {
    log('error', 'PUBLIC_URL задан — значит используются вебхуки. Poller не запускается, ' +
      'иначе он снимет вебхуки и остановит приём сообщений. Уберите PUBLIC_URL ' +
      'или не поднимайте профиль polling.');
    process.exit(1);
  }

  log('info', 'Poller запущен: Telegram работает без вебхуков и туннеля');

  const running = new Map<string, { value: boolean }>();

  const refresh = async (): Promise<void> => {
    let channels: Channel[] = [];
    try {
      channels = await loadChannels();
    } catch (err) {
      log('error', 'Не удалось получить список каналов', {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const active = new Set(channels.map((c) => c.channelId));

    // Останавливаем циклы каналов, которые отключили или удалили.
    for (const [id, stop] of running) {
      if (!active.has(id)) {
        stop.value = true;
        running.delete(id);
        log('info', 'Канал отключён, опрос остановлен', { channelId: id });
      }
    }

    // Запускаем циклы для новых каналов.
    for (const ch of channels) {
      if (running.has(ch.channelId)) continue;
      const stop = { value: false };
      running.set(ch.channelId, stop);
      void pollChannel(ch, stop).catch((err) =>
        log('error', 'Цикл опроса завершился аварийно', {
          channelId: ch.channelId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      log('info', 'Начат опрос канала', { channelId: ch.channelId });
    }

    if (channels.length === 0) {
      log('info', 'Активных Telegram-каналов нет — жду, пока подключите');
    }
  };

  await refresh();
  const timer = setInterval(() => void refresh(), REFRESH_CHANNELS_MS);

  const shutdown = async (signal: string): Promise<void> => {
    log('info', `${signal}: останавливаюсь`);
    clearInterval(timer);
    for (const stop of running.values()) stop.value = true;
    await inbound.close();
    await pool.end();
    connection.disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  log('error', 'Poller не запустился', {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
