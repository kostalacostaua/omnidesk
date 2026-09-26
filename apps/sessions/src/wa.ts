import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import makeWASocket, {
  BufferJSON,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  initAuthCreds,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import type { Redis as RedisType } from 'ioredis';
import {
  QUEUE_WA_LOGIN,
  QUEUE_WA_OUT,
  WHATSAPP_USER_CHANNEL,
  decryptJson,
  encryptJson,
  jobKey,
  phoneToChat,
  chatToPhone,
  waLoginKey,
  withSystem,
  withTenant,
  type GatewayMessage,
  type InboundJob,
  type OutboundJob,
  type Pool,
  type Storage,
  type WaLoginJob,
  type WaLoginState,
} from '@omnidesk/core';

/**
 * Номерной WhatsApp: свои сессии, без посредника.
 *
 * Устроено так же, как номерной Telegram этажом выше: у WhatsApp нет
 * вебхука для обычного аккаунта, поэтому нужно держать живое
 * соединение — такое же, какое держит вкладка WhatsApp Web. Здесь
 * долгоживущий процесс, в котором на каждый подключённый номер открыт
 * свой сокет.
 *
 * Почему не через шлюз-посредник. Посредник берёт деньги за каждый
 * номер ежемесячно — это наш самый быстрорастущий расход, растущий
 * ровно с числом клиентов. И он же становится третьей стороной, через
 * которую идёт чужая переписка. Своя служба убирает и то, и другое.
 *
 * Отсюда главное ограничение, общее с Telegram: ОДНА реплика. Две
 * копии открыли бы по два соединения на номер, и каждое сообщение
 * пришло бы дважды.
 *
 * Сессия хранится в базе зашифрованной на ключе арендатора. Потеряли —
 * человек сканирует QR заново; переписка лежит отдельно и не страдает.
 */

interface WaDeps {
  pool: Pool;
  connection: RedisType;
  redis: Redis;
  masterKey: Buffer;
  storage: Storage;
  inboundQueue: Queue<InboundJob>;
  log: (level: string, msg: string, extra?: Record<string, unknown>) => void;
}

/** Сколько ждём сканирования QR. Дальше человек нажимает заново. */
const LOGIN_TIMEOUT_MS = 3 * 60_000;
const RECONCILE_MS = 30_000;
/** Больше двадцати мегабайт WhatsApp и сам не пришлёт. */
const MAX_MEDIA_BYTES = 20 * 1024 * 1024;

type Sock = ReturnType<typeof makeWASocket>;

interface Live {
  sock: Sock;
  tenantId: string;
  /** Закрываем намеренно — тогда переподключаться не надо. */
  closing?: boolean;
}

export function startWa(deps: WaDeps): { stop: () => Promise<void> } {
  const { pool, connection, redis, masterKey, storage, inboundQueue, log } = deps;
  const live = new Map<string, Live>();

  // ── Хранение сессии ────────────────────────────────────────────────

  /**
   * Состояние аутентификации поверх нашей таблицы.
   *
   * Библиотека умеет писать его файлами, но файлы в контейнере живут до
   * первой выкладки: после неё все клиенты одновременно увидели бы QR
   * заново. Поэтому своё хранилище: учётные данные и ключи — двумя
   * полями, зашифрованными на ключе арендатора.
   *
   * Ключи пишутся пачками на каждом сообщении, поэтому запись отложена:
   * иначе оживлённый чат означал бы запрос к базе на каждую строчку.
   *
   * Во время входа канала ещё нет — и хранилище это допускает: пишем
   * никуда, держим в памяти. Иначе первая же запись била бы в ссылку на
   * несуществующий канал, а таких записей за вход десятки.
   */
  async function authStore(channelId: string | null, tenantId: string) {
    let target = channelId;

    const load = async (id: string) =>
      withTenant(pool, tenantId, async (db) => {
        const { rows } = await db.query<{ creds_enc: Buffer; keys_enc: Buffer | null }>(
          `SELECT creds_enc, keys_enc FROM wa_sessions WHERE channel_id = $1`,
          [id],
        );
        return rows[0] ?? null;
      });

    const row = target === null ? null : await load(target);

    const creds = row
      ? (JSON.parse(
          JSON.stringify(decryptJson<unknown>(masterKey, tenantId, row.creds_enc)),
          BufferJSON.reviver,
        ) as ReturnType<typeof initAuthCreds>)
      : initAuthCreds();

    const keys: Record<string, unknown> = row?.keys_enc
      ? (JSON.parse(
          JSON.stringify(decryptJson<unknown>(masterKey, tenantId, row.keys_enc)),
          BufferJSON.reviver,
        ) as Record<string, unknown>)
      : {};

    let dirty = false;
    let saving: NodeJS.Timeout | null = null;

    const flush = async (): Promise<void> => {
      // Канала ещё нет — сессия живёт в памяти до конца входа.
      if (target === null) return;
      const channelId = target;
      dirty = false;
      const credsBlob = JSON.parse(JSON.stringify(creds, BufferJSON.replacer)) as unknown;
      const keysBlob = JSON.parse(JSON.stringify(keys, BufferJSON.replacer)) as unknown;
      await withTenant(pool, tenantId, async (db) => {
        await db.query(
          `INSERT INTO wa_sessions (channel_id, tenant_id, creds_enc, keys_enc, updated_at)
           VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (channel_id) DO UPDATE
             SET creds_enc = EXCLUDED.creds_enc, keys_enc = EXCLUDED.keys_enc,
                 updated_at = now()`,
          [
            channelId,
            tenantId,
            encryptJson(masterKey, tenantId, credsBlob),
            encryptJson(masterKey, tenantId, keysBlob),
          ],
        );
      });
    };

    const schedule = (): void => {
      dirty = true;
      if (saving) return;
      saving = setTimeout(() => {
        saving = null;
        if (dirty) void flush().catch((err) => log('warn', 'Сессия WhatsApp не сохранилась', { channelId, error: String(err) }));
      }, 1500);
    };

    return {
      state: {
        creds,
        keys: {
          get: (type: string, ids: string[]) => {
            const out: Record<string, unknown> = {};
            for (const id of ids) {
              const value = keys[`${type}-${id}`];
              if (value !== undefined) out[id] = value;
            }
            return out;
          },
          set: (data: Record<string, Record<string, unknown>>) => {
            for (const type of Object.keys(data)) {
              for (const id of Object.keys(data[type] ?? {})) {
                const value = data[type]?.[id];
                if (value === null || value === undefined) delete keys[`${type}-${id}`];
                else keys[`${type}-${id}`] = value;
              }
            }
            schedule();
          },
        },
      },
      saveCreds: schedule,
      flush,
      /** Вход закончился, канал известен — с этого места пишем в базу. */
      bind: async (id: string): Promise<void> => {
        target = id;
        await flush();
      },
    };
  }

  async function dropStore(channelId: string, tenantId: string): Promise<void> {
    await withTenant(pool, tenantId, async (db) => {
      await db.query(`DELETE FROM wa_sessions WHERE channel_id = $1`, [channelId]);
    });
  }

  // ── Входящие ───────────────────────────────────────────────────────

  /**
   * Сообщение библиотеки в наш общий вид.
   *
   * Берём текст и файлы; опросы, местоположение и системные события
   * пропускаем — показать их нечем, а притворяться, что они текст,
   * значит врать оператору.
   */
  async function toMessage(
    channelId: string,
    tenantId: string,
    sock: Sock,
    raw: Record<string, unknown>,
  ): Promise<GatewayMessage | null> {
    const key = (raw['key'] ?? {}) as Record<string, unknown>;
    const id = String(key['id'] ?? '');
    const chatId = String(key['remoteJid'] ?? '');
    if (!id || !chatId) return null;
    // Группы и рассылки в скриньку не берём: модель «один диалог —
    // один клиент» на них не натягивается.
    if (!chatId.endsWith('@s.whatsapp.net')) return null;

    const content = (raw['message'] ?? {}) as Record<string, unknown>;
    const text =
      (content['conversation'] as string) ??
      ((content['extendedTextMessage'] as { text?: string } | undefined)?.text ?? null);

    const media =
      (content['imageMessage'] as Record<string, unknown> | undefined) ??
      (content['videoMessage'] as Record<string, unknown> | undefined) ??
      (content['audioMessage'] as Record<string, unknown> | undefined) ??
      (content['documentMessage'] as Record<string, unknown> | undefined) ??
      null;

    let fileKey: string | undefined;
    let fileName: string | undefined;
    let mime: string | undefined;

    if (media) {
      const size = Number(media['fileLength'] ?? 0);
      if (size > MAX_MEDIA_BYTES) {
        log('warn', 'Файл WhatsApp слишком велик', { channelId, size });
      } else {
        try {
          const body = (await downloadMediaMessage(
            raw as never,
            'buffer',
            {},
            { logger: quietLogger, reuploadRequest: sock.updateMediaMessage },
          )) as Buffer;
          mime = String(media['mimetype'] ?? 'application/octet-stream');
          fileName = String(media['fileName'] ?? '') || undefined;
          const storeKey = `wa/${tenantId}/${channelId}/${id}`;
          await storage.put(storeKey, body, mime);
          fileKey = storeKey;
        } catch (err) {
          // Файл не забрался — сообщение всё равно показываем: текст
          // подписи важнее, чем ничего.
          log('warn', 'Файл WhatsApp не скачался', { channelId, error: String(err) });
        }
      }
    }

    const caption = (media?.['caption'] as string) ?? null;
    const body = text ?? caption;
    if (!body && !fileKey) return null;

    const stamp = Number(raw['messageTimestamp'] ?? 0);
    return {
      id,
      chatId,
      name: (raw['pushName'] as string) || null,
      text: body,
      ...(fileKey ? { fileKey } : {}),
      ...(fileName ? { fileName } : {}),
      ...(mime ? { mime } : {}),
      incoming: !key['fromMe'],
      at: new Date(stamp > 0 ? stamp * 1000 : Date.now()).toISOString(),
    };
  }

  // ── Соединение ─────────────────────────────────────────────────────

  /** Библиотека многословна; в наш журнал её отладка не нужна. */
  const quietLogger = {
    level: 'silent',
    child: () => quietLogger,
    trace: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    fatal: () => undefined,
  } as never;

  async function openSession(channelId: string, tenantId: string): Promise<void> {
    if (live.has(channelId)) return;

    const store = await authStore(channelId, tenantId);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      logger: quietLogger,
      printQRInTerminal: false,
      // Имя видно человеку в списке подключённых устройств на телефоне.
      // Пусть там будет понятно, что это мы, а не «Chrome».
      browser: ['Rozmovio', 'Chrome', '1.0.0'],
      auth: {
        creds: store.state.creds,
        keys: makeCacheableSignalKeyStore(store.state.keys as never, quietLogger),
      },
      // Историю за год скачивать незачем: переписка начинается с
      // подключения, и это честнее, чем показать половину старой.
      syncFullHistory: false,
      markOnlineOnConnect: false,
    } as never);

    live.set(channelId, { sock, tenantId });

    sock.ev.on('creds.update', () => store.saveCreds());

    sock.ev.on('connection.update', (u: Record<string, unknown>) => {
      const state = String(u['connection'] ?? '');
      if (state === 'open') {
        log('info', 'Сессия WhatsApp открыта', { channelId });
        return;
      }
      if (state !== 'close') return;

      const entry = live.get(channelId);
      live.delete(channelId);
      if (entry?.closing) return;

      const err = u['lastDisconnect'] as { error?: { output?: { statusCode?: number } } } | undefined;
      const code = err?.error?.output?.statusCode;

      /*
       * Выход с телефона — это не сбой связи. Переподключаться нечем:
       * ключи отозваны, и единственный способ вернуться — новый QR.
       * Поэтому канал отключаем и сессию стираем, а не ломимся заново.
       */
      if (code === DisconnectReason.loggedOut) {
        log('warn', 'Номер отключили с телефона', { channelId });
        void disable(channelId, tenantId, 'Номер відключили на телефоні').catch(() => undefined);
        return;
      }
      log('warn', 'Сессия WhatsApp закрылась, переподключаюсь', { channelId, code });
      // Сверка поднимет заново: отдельный таймер здесь означал бы два
      // места, которые открывают соединение, и однажды они сделали бы
      // это одновременно.
    });

    sock.ev.on('messages.upsert', (ev) => {
      // notify — это новое сообщение. append и прочее — догрузка
      // истории при подключении: её мы не берём намеренно.
      if (ev.type !== 'notify') return;
      for (const raw of ev.messages) {
        void handleInbound(channelId, tenantId, sock, raw as unknown as Record<string, unknown>);
      }
    });
  }

  async function handleInbound(
    channelId: string,
    tenantId: string,
    sock: Sock,
    raw: Record<string, unknown>,
  ): Promise<void> {
    try {
      const msg = await toMessage(channelId, tenantId, sock, raw);
      if (!msg) return;
      await inboundQueue.add(
        'wa',
        {
          channelId,
          tenantId,
          provider: 'gateway',
          payload: msg,
          receivedAt: new Date().toISOString(),
        },
        // Номер сообщения у WhatsApp уникален и не меняется при
        // повторной доставке: второй раз то же не запишется.
        { jobId: jobKey('wa', msg.id) },
      );
    } catch (err) {
      log('error', 'Входящее WhatsApp не обработалось', { channelId, error: String(err) });
    }
  }

  async function stopSession(channelId: string): Promise<void> {
    const entry = live.get(channelId);
    if (!entry) return;
    entry.closing = true;
    live.delete(channelId);
    try {
      entry.sock.end(undefined);
    } catch {
      // Сокет уже мёртв — это и требовалось.
    }
  }

  /** Канал выключаем с причиной: человек должен увидеть, почему. */
  async function disable(channelId: string, tenantId: string, why: string): Promise<void> {
    await stopSession(channelId);
    await dropStore(channelId, tenantId);
    await withTenant(pool, tenantId, async (db) => {
      await db.query(
        `UPDATE channels SET status = 'error', last_error = $2 WHERE id = $1`,
        [channelId, JSON.stringify({ reason: why, at: new Date().toISOString() })],
      );
    });
  }

  // ── Сверка ─────────────────────────────────────────────────────────

  /**
   * Приводим живые соединения в соответствие с базой.
   *
   * Одно место, которое открывает и закрывает сессии. Разбросать это
   * по обработчикам событий значит однажды открыть два соединения на
   * один номер и получать каждое сообщение дважды.
   */
  async function reconcile(): Promise<void> {
    const rows = await withSystem(pool, 'сессии WhatsApp', async (db) => {
      const { rows } = await db.query<{ id: string; tenant_id: string }>(
        `SELECT c.id, c.tenant_id
           FROM channels c JOIN wa_sessions s ON s.channel_id = c.id
          WHERE c.type = $1 AND c.status = 'active'`,
        [WHATSAPP_USER_CHANNEL],
      );
      return rows;
    });

    const want = new Set(rows.map((r) => r.id));
    for (const id of [...live.keys()]) if (!want.has(id)) await stopSession(id);
    for (const row of rows) {
      if (live.has(row.id)) continue;
      try {
        await openSession(row.id, row.tenant_id);
      } catch (err) {
        log('error', 'Не удалось открыть сессию WhatsApp', { channelId: row.id, error: String(err) });
      }
    }
  }

  // ── Вход по QR ─────────────────────────────────────────────────────

  async function setState(loginId: string, patch: Partial<WaLoginState>): Promise<void> {
    const raw = await redis.get(waLoginKey(loginId));
    const prev = raw ? (JSON.parse(raw) as WaLoginState) : null;
    if (!prev) return;
    await redis.set(waLoginKey(loginId), JSON.stringify({ ...prev, ...patch }), 'EX', 600);
  }

  /**
   * Вход.
   *
   * Сокет поднимается с пустыми учётными данными, библиотека отдаёт QR,
   * мы кладём его в состояние входа — страница показывает. После
   * сканирования узнаём номер, заводим канал и сохраняем сессию под
   * его номером.
   *
   * Сканирование — не конец входа, а его середина. Приняв код, WhatsApp
   * выдаёт ключи и сразу рвёт соединение: дальше полагается прийти уже
   * своим, с этими ключами. Телефон в это время показывает «Виконується
   * вхід» и ждёт — поэтому обрыв здесь не ошибка, а шаг, и мы поднимаем
   * сокет заново теми же учётными данными.
   *
   * Канал заводится после входа, а не до: канал без сессии — это
   * строка в списке, которая ничего не умеет, и человек смотрит на неё,
   * не понимая, почему нет сообщений.
   */
  async function handleLogin(job: WaLoginJob): Promise<void> {
    const { loginId, tenantId } = job;
    // Канала ещё нет: сессия собирается в памяти и ляжет в базу под
    // номером канала, который появится в конце.
    const store = await authStore(null, tenantId);
    const { version } = await fetchLatestBaileysVersion();

    let done = false;
    let sock: Sock | null = null;

    const shut = (): void => {
      try {
        sock?.end(undefined);
      } catch {
        // Уже мёртв — это и требовалось.
      }
    };

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        void setState(loginId, { state: 'error', error: 'Час вийшов. Натисніть «Підключити» ще раз.' });
        shut();
        resolve();
      }, LOGIN_TIMEOUT_MS);

      const fail = async (why: string, extra?: Record<string, unknown>): Promise<void> => {
        done = true;
        clearTimeout(timer);
        await setState(loginId, { state: 'error', error: why });
        log('warn', 'Вход в WhatsApp не удался', { ...extra });
        shut();
        resolve();
      };

      const open = (): void => {
        const s = makeWASocket({
          version,
          logger: quietLogger,
          printQRInTerminal: false,
          browser: ['Rozmovio', 'Chrome', '1.0.0'],
          auth: {
            creds: store.state.creds,
            keys: makeCacheableSignalKeyStore(store.state.keys as never, quietLogger),
          },
          syncFullHistory: false,
          markOnlineOnConnect: false,
        } as never);
        sock = s;

        s.ev.on('creds.update', () => store.saveCreds());

        s.ev.on('connection.update', (u: Record<string, unknown>) => {
          void (async () => {
            if (done) return;

            const qr = u['qr'];
            if (typeof qr === 'string' && qr) {
              // Код живёт секунд двадцать, потом библиотека выдаёт новый.
              await setState(loginId, { state: 'qr', qrUrl: qr, qrExpires: Date.now() + 20_000 });
              return;
            }

            const state = String(u['connection'] ?? '');

            if (state === 'close') {
              const err = u['lastDisconnect'] as
                | { error?: { output?: { statusCode?: number } } }
                | undefined;
              const code = err?.error?.output?.statusCode;

              // Код принят, ключи выданы — WhatsApp просит прийти заново.
              if (code === DisconnectReason.restartRequired) {
                await setState(loginId, { state: 'linking' });
                try {
                  s.ev.removeAllListeners('connection.update');
                } catch {
                  // Библиотека уже свернула шину событий.
                }
                open();
                return;
              }

              if (code === DisconnectReason.loggedOut) {
                await fail('Вхід відхилено на телефоні. Спробуйте ще раз.', { code });
                return;
              }
              await fail('Зв’язок із WhatsApp обірвався. Спробуйте ще раз.', { code });
              return;
            }

            if (state !== 'open') return;

            done = true;
            clearTimeout(timer);
            try {
              const me = String((s.user as { id?: string } | undefined)?.id ?? '');
              const phone = chatToPhone(me.split(':')[0] + '@s.whatsapp.net') ?? '';
              const digits = phone.replace(/[^0-9]/g, '');
              if (!digits) throw new Error('WhatsApp не назвав номер');

              const channelId = await saveChannel(tenantId, digits, job.displayName);
              await store.bind(channelId);
              await setState(loginId, { state: 'done', channelId });
              log('info', 'Номерной WhatsApp подключён', { channelId, tenantId });
            } catch (err) {
              await setState(loginId, { state: 'error', error: 'Не вдалося зберегти канал' });
              log('error', 'Канал WhatsApp не сохранился', { error: String(err) });
            }
            // Соединение закрываем: постоянную сессию поднимет сверка,
            // и она будет одна, а не две.
            shut();
            resolve();
          })();
        });
      };

      open();
    });

    await reconcile().catch(() => undefined);
  }

  async function saveChannel(
    tenantId: string,
    digits: string,
    name?: string,
  ): Promise<string> {
    /*
     * Тот же номер, подключённый заново, — это тот же канал: переписка
     * должна остаться на месте, а не начаться с чистого листа.
     */
    const owner = await withSystem(pool, 'владелец номера WhatsApp', async (db) => {
      const { rows } = await db.query<{ channel_id: string; tenant_id: string }>(
        `SELECT channel_id, tenant_id FROM channel_routes
          WHERE channel_type = $1 AND external_id = $2 LIMIT 1`,
        [WHATSAPP_USER_CHANNEL, digits],
      );
      return rows[0] ?? null;
    });

    if (owner && owner.tenant_id !== tenantId) {
      throw new Error('Номер уже подключён в другом аккаунте');
    }

    return withTenant(pool, tenantId, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO channels (id, tenant_id, type, display_name, external_id,
                               credentials_enc, meta, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
         ON CONFLICT (type, external_id) DO UPDATE
           SET display_name = EXCLUDED.display_name, meta = EXCLUDED.meta,
               status = 'active', last_error = NULL
         RETURNING id`,
        [
          owner?.channel_id ?? randomUUID(),
          tenantId,
          WHATSAPP_USER_CHANNEL,
          (name ?? '').trim() || `WhatsApp +${digits}`,
          digits,
          /*
           * Поле обязательное у всех каналов, а у этого секрета в нём
           * нет: ключи живут в своей таблице, потому что меняются на
           * каждом сообщении. Кладём пустое, а не выдумываем, что
           * положить: канал без сессии всё равно ничего не умеет.
           */
          encryptJson(masterKey, tenantId, {}),
          JSON.stringify({ phone: `+${digits}` }),
        ],
      );
      // Номер канала берём из ответа базы, а не из того, что послали:
      // при повторном подключении строка уже есть, и номер у неё свой.
      const id = rows[0]?.id;
      if (!id) throw new Error('Канал не создался');
      return id;
    });
  }

  // ── Исходящие ──────────────────────────────────────────────────────

  async function handleSend(job: OutboundJob): Promise<void> {
    const entry = live.get(job.channelId);
    if (!entry) throw new Error('Сессия WhatsApp не открыта');

    const row = await withTenant(pool, job.tenantId, async (db) => {
      const { rows } = await db.query<{
        status: string;
        content: { text?: string } | null;
        peer_id: string;
      }>(
        `SELECT m.status, m.content, ct.external_id AS peer_id
           FROM messages m
           JOIN conversations cv ON cv.id = m.conversation_id
           JOIN contact_identities ct ON ct.contact_id = cv.contact_id
                AND ct.channel_type = $2
          WHERE m.id = $1 LIMIT 1`,
        [job.messageId, WHATSAPP_USER_CHANNEL],
      );
      return rows[0] ?? null;
    });
    if (!row || row.status !== 'pending') return;

    const text = row.content?.text ?? '';
    if (!text) throw new Error('Пустое сообщение');

    const jid = row.peer_id.includes('@') ? row.peer_id : phoneToChat(row.peer_id);
    const sent = (await entry.sock.sendMessage(jid, { text })) as { key?: { id?: string } };
    const externalId = String(sent?.key?.id ?? '');

    await withTenant(pool, job.tenantId, async (db) => {
      await db.query(
        `UPDATE messages SET status = 'sent', external_id = $2, sent_at = now()
          WHERE id = $1 AND status = 'pending'`,
        [job.messageId, externalId],
      );
    });
    log('info', 'Отправлено в WhatsApp', { messageId: job.messageId, externalId });
  }

  // ── Запуск ─────────────────────────────────────────────────────────

  const sendWorker = new Worker<OutboundJob>(QUEUE_WA_OUT, async (job) => handleSend(job.data), {
    connection,
    concurrency: 2,
    // Личный номер — не бот: темп сознательно низкий, за всплеск
    // WhatsApp блокирует номер, а не замедляет его.
    limiter: { max: 3, duration: 1000 },
  });

  sendWorker.on('failed', async (job, err) => {
    log('error', 'Отправка в WhatsApp не удалась', {
      messageId: job?.data?.messageId, error: err.message,
    });
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      await withTenant(pool, job.data.tenantId, async (db) => {
        await db.query(
          `UPDATE messages SET status = 'failed', failure = $2 WHERE id = $1 AND status = 'pending'`,
          [job.data.messageId, JSON.stringify({ reason: err.message })],
        );
      }).catch(() => undefined);
    }
  });

  const loginWorker = new Worker<WaLoginJob>(QUEUE_WA_LOGIN, async (job) => handleLogin(job.data), {
    connection,
    concurrency: 5,
    lockDuration: LOGIN_TIMEOUT_MS + 60_000,
  });

  let timer: NodeJS.Timeout | null = null;
  const loop = async (): Promise<void> => {
    try {
      await reconcile();
    } catch (err) {
      log('error', 'Сверка сессий WhatsApp упала', { error: String(err) });
    }
    timer = setTimeout(() => void loop(), RECONCILE_MS);
  };
  void loop();

  return {
    stop: async () => {
      if (timer) clearTimeout(timer);
      await Promise.allSettled([sendWorker.close(), loginWorker.close()]);
      for (const id of [...live.keys()]) await stopSession(id);
    },
  };
}
