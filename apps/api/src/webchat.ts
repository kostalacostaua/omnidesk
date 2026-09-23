import type { FastifyInstance } from 'fastify';
import type { Queue } from 'bullmq';
import { randomBytes } from 'node:crypto';
import {
  WEBCHAT_CHANNEL,
  WEBCHAT_FILE_LIMIT,
  domainAllowed,
  jobKey,
  launcherColor,
  normalizeWebchat,
  safeFileName,
  webchatFileKind,
  safeColor,
  safeLogo,
  webchatSettings,
  withSystem,
  withTenant,
  type Attachment,
  type InboundJob,
  type Pool,
  type Storage,
} from '@omnidesk/core';

/**
 * Чат на сайте: публичная часть.
 *
 * Всё, что здесь, работает без входа — это страница, которую открывает
 * посторонний человек. Отсюда три правила.
 *
 * Первое: посетитель опознаётся выданным нами идентификатором, и он же
 * его секрет. По ключу сайта можно начать разговор, но нельзя прочитать
 * чужой: чтобы увидеть переписку, нужно знать идентификатор посетителя,
 * а он лежит только в его браузере.
 *
 * Второе: чат живёт в рамке на НАШЕМ домене. Поэтому переписка не
 * проходит через чужой сайт, не зависит от его политики безопасности и
 * не может быть прочитана его скриптами. Чужому сайту достаётся только
 * кнопка.
 *
 * Третье: сюда стучатся без приглашения. Длина сообщения ограничена,
 * частота — тоже, и ограничение живёт в памяти процесса: база для
 * защиты от потока запросов не годится, она первой и ляжет.
 */

interface WebchatDeps {
  pool: Pool;
  inboundQueue: Queue<InboundJob>;
  storage: Storage;
  appUrl: string;
  log: (level: string, msg: string, extra?: Record<string, unknown>) => void;
}

interface ChannelRow {
  channel_id: string;
  tenant_id: string;
  status: string;
}

/** Не больше сообщения в секунду с посетителя и 30 в минуту. */
const RATE = new Map<string, { last: number; minute: number; count: number }>();

function rateOk(visitorId: string): boolean {
  const now = Date.now();
  const minute = Math.floor(now / 60_000);
  const seen = RATE.get(visitorId);

  if (!seen || seen.minute !== minute) {
    RATE.set(visitorId, { last: now, minute, count: 1 });
    // Карта не должна расти вечно: раз в минуту выбрасываем всё старое.
    if (RATE.size > 5000) {
      for (const [key, value] of RATE) if (value.minute < minute) RATE.delete(key);
    }
    return true;
  }
  if (now - seen.last < 700) return false;
  if (seen.count >= 30) return false;

  seen.last = now;
  seen.count += 1;
  return true;
}

export function registerWebchat(app: FastifyInstance, deps: WebchatDeps): void {
  const { pool, inboundQueue, storage, appUrl, log } = deps;

  /** Канал по публичному ключу сайта. Читается без контекста тенанта. */
  async function channelByKey(key: string): Promise<ChannelRow | null> {
    if (!/^[a-z0-9_-]{8,64}$/i.test(key)) return null;
    return withSystem(pool, 'канал чата на сайте', async (db) => {
      const { rows } = await db.query<ChannelRow>(
        `SELECT channel_id, tenant_id, status FROM channel_routes
          WHERE channel_type = $1 AND external_id = $2 LIMIT 1`,
        [WEBCHAT_CHANNEL, key],
      );
      return rows[0] ?? null;
    });
  }

  async function settingsOf(row: ChannelRow) {
    const meta = await withTenant(pool, row.tenant_id, async (db) => {
      const { rows } = await db.query<{ meta: unknown }>(
        `SELECT meta FROM channels WHERE id = $1`,
        [row.channel_id],
      );
      return rows[0]?.meta ?? {};
    });
    return webchatSettings(meta);
  }

  /**
   * Загрузчик для чужого сайта.
   *
   * Всё, что он делает, — рисует кнопку и открывает рамку. Сама
   * переписка живёт внутри рамки, на нашем домене; наружу уходит один
   * запрос — за видом кнопки.
   */
  app.get('/chat.js', async (_req, reply) =>
    reply
      .type('application/javascript; charset=utf-8')
      .header('cache-control', 'public, max-age=300')
      .header('access-control-allow-origin', '*')
      .send(loaderScript(appUrl)),
  );

  /**
   * Вид свёрнутой кнопки.
   *
   * Отдельный ответ, а не атрибуты в строке подключения: строку клиент
   * один раз вставил к себе на сайт и больше не трогает. Если бы цвет и
   * задержка жили в ней, каждая правка настроек требовала бы от него
   * лезть в вёрстку — то есть не делалась бы никогда.
   *
   * Здесь нет ничего личного: цвет, способ появления и задержка. Всё
   * это и так видно любому, кто откроет сайт.
   */
  app.get<{ Params: { key: string } }>('/chat/:key/style', async (req, reply) => {
    const row = await channelByKey(req.params.key);
    if (!row || row.status !== 'active') return reply.code(404).send({ error: 'not_found' });

    const s = await settingsOf(row);
    return reply
      .header('access-control-allow-origin', '*')
      // Минута: правка настроек должна доезжать до сайта за время
      // разговора с клиентом, а не за время обеда.
      .header('cache-control', 'public, max-age=60')
      .send({
        launcher: launcherColor(s),
        anim: s.anim,
        showMode: s.showMode,
        showAfter: s.showAfter,
        side: s.position,
      });
  });

  /**
   * Страница чата: она же содержимое рамки.
   *
   * В режиме превью она же показывает ещё не сохранённые настройки: их
   * присылает страница настроек в адресе. Иначе подбор цвета выглядел бы
   * так — сохранить, открыть сайт, посмотреть, вернуться.
   */
  app.get<{
    Params: { key: string };
    Querystring: {
      inline?: string;
      preview?: string;
      title?: string;
      subtitle?: string;
      greeting?: string;
      color?: string;
      logo?: string;
    };
  }>(
    '/chat/:key',
    async (req, reply) => {
      const row = await channelByKey(req.params.key);
      if (!row || row.status !== 'active') {
        return reply.code(404).type('text/html; charset=utf-8').send(missingPage());
      }

      const saved = await settingsOf(row);
      const preview = req.query?.preview === '1';
      const s = preview
        ? webchatSettings({
            ...saved,
            ...(req.query?.title !== undefined ? { title: req.query.title } : {}),
            ...(req.query?.subtitle !== undefined ? { subtitle: req.query.subtitle } : {}),
            ...(req.query?.greeting !== undefined ? { greeting: req.query.greeting } : {}),
            ...(req.query?.color !== undefined ? { color: req.query.color } : {}),
            ...(req.query?.logo !== undefined ? { logo: req.query.logo } : {}),
            domains: saved.domains,
          })
        : saved;

      const origin = String(req.headers['referer'] ?? '');
      if (!preview && origin && !domainAllowed(s.domains, origin)) {
        log('warn', 'Виджет открыт на неразрешённом домене', { key: req.params.key, origin });
        return reply.code(403).type('text/html; charset=utf-8').send(blockedPage());
      }

      return reply
        .type('text/html; charset=utf-8')
        .header('cache-control', 'no-store')
        // Рамку встраивают в чужие страницы — это и есть её работа.
        .header('content-security-policy', 'frame-ancestors *')
        .send(chatPage(req.params.key, s, req.query?.inline === '1', preview));
    },
  );

  /**
   * Начало разговора.
   *
   * Посетитель, пришедший впервые, получает идентификатор; вернувшийся
   * присылает свой. Проверять его нечем и незачем: он случайный и
   * достаточно длинный, чтобы его нельзя было подобрать, а прав он даёт
   * ровно на одну переписку — свою.
   */
  app.post<{ Params: { key: string }; Body: { visitorId?: string } }>(
    '/chat/:key/session',
    async (req, reply) => {
      const row = await channelByKey(req.params.key);
      if (!row || row.status !== 'active') return reply.code(404).send({ error: 'not_found' });

      const given = String(req.body?.visitorId ?? '');
      const visitorId = /^[a-f0-9]{32}$/.test(given) ? given : randomBytes(16).toString('hex');
      const s = await settingsOf(row);

      return { visitorId, title: s.title, greeting: s.greeting, color: safeColor(s.color) };
    },
  );

  /**
   * Переписка посетителя.
   *
   * Отдаём только его собственную: диалог ищется по идентификатору
   * посетителя, а не по номеру, который можно было бы подставить.
   */
  app.get<{ Params: { key: string }; Querystring: { visitorId?: string; after?: string } }>(
    '/chat/:key/messages',
    async (req, reply) => {
      const row = await channelByKey(req.params.key);
      if (!row) return reply.code(404).send({ error: 'not_found' });

      const visitorId = String(req.query?.visitorId ?? '');
      if (!/^[a-f0-9]{32}$/.test(visitorId)) return { messages: [] };

      const after = req.query?.after ? new Date(String(req.query.after)) : null;
      const messages = await withTenant(pool, row.tenant_id, async (db) => {
        const { rows } = await db.query<{
          id: string;
          direction: string;
          body: string | null;
          sent_at: Date;
          at_us: string;
          files: Attachment[] | null;
        }>(
          // Метка времени возвращается ещё и строкой с микросекундами.
          // Драйвер отдаёт timestamptz как Date, а у Date точность —
          // миллисекунда, и «19:22:00.123456» превращается в
          // «19:22:00.123». Отправленное обратно как after, это значение
          // снова меньше исходного, условие sent_at > after опять
          // истинно, и последнее сообщение возвращается при каждом
          // опросе — раз в три секунды, бесконечно.
          `SELECT m.id, m.direction, m.content->>'text' AS body, m.sent_at,
                  to_char(m.sent_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at_us,
                  m.content->'attachments' AS files
             FROM messages m
             JOIN conversations c ON c.id = m.conversation_id
             JOIN contact_identities ci ON ci.contact_id = c.contact_id
            WHERE ci.channel_type = $1 AND ci.external_id = $2
              AND c.channel_id = $3
              AND ($4::timestamptz IS NULL OR m.sent_at > $4::timestamptz)
              -- Сообщение с одним лишь файлом — обычное дело: человек
              -- присылает фотографию и ждёт ответа. Требование текста
              -- прятало бы такие сообщения от того, кто их и прислал.
              AND (m.content->>'text' IS NOT NULL
                   OR jsonb_array_length(coalesce(m.content->'attachments', '[]'::jsonb)) > 0)
            ORDER BY m.sent_at, m.id
            LIMIT 200`,
          [WEBCHAT_CHANNEL, visitorId, row.channel_id, after && !isNaN(after.getTime()) ? after : null],
        );
        return rows;
      });

      return {
        messages: messages.map((m) => ({
          id: m.id,
          mine: m.direction === 'in',
          text: m.body ?? '',
          at: m.sent_at,
          /** Метка для следующего опроса: та же, но без потери точности. */
          cursor: m.at_us,
          /**
           * Наружу идёт только описание файла, но не ключ хранилища:
           * по ключу можно было бы дотянуться до чужого вложения, а имя
           * и размер нужны, чтобы нарисовать сообщение.
           */
          files: (m.files ?? [])
            .map((f, i) => ({
              i,
              name: safeFileName(String(f.filename ?? '')),
              mime: String(f.mime ?? ''),
              kind: webchatFileKind(String(f.mime ?? '')),
              size: Number(f.size ?? 0),
              ready: f.storageKey ? true : false,
            }))
            .filter((f) => f.ready),
        })),
      };
    },
  );

  /**
   * Вложение из переписки посетителя.
   *
   * Отдельный путь от операторского /media: тот требует входа, а здесь
   * входа нет и быть не может. Пропуском служит тот же идентификатор
   * посетителя, что и для чтения переписки, и проверяется он так же —
   * файл отдаётся, только если сообщение лежит в разговоре именно
   * этого посетителя и именно этого канала.
   */
  app.get<{
    Params: { key: string; messageId: string; index: string };
    Querystring: { visitorId?: string; download?: string };
  }>('/chat/:key/media/:messageId/:index', async (req, reply) => {
    const row = await channelByKey(req.params.key);
    if (!row) return reply.code(404).send({ error: 'not_found' });

    const visitorId = String(req.query?.visitorId ?? '');
    if (!/^[a-f0-9]{32}$/.test(visitorId)) return reply.code(400).send({ error: 'bad_visitor' });

    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0) return reply.code(400).send({ error: 'bad_index' });

    const att = await withTenant(pool, row.tenant_id, async (db) => {
      const { rows } = await db.query<{
        storage_key: string | null;
        mime: string | null;
        filename: string | null;
      }>(
        // ::int обязателен: без приведения параметр считается текстом,
        // и обращение к массиву по ключу «0» возвращает NULL.
        `SELECT m.content->'attachments'->($4)::int->>'storageKey' AS storage_key,
                m.content->'attachments'->($4)::int->>'mime'       AS mime,
                m.content->'attachments'->($4)::int->>'filename'   AS filename
           FROM messages m
           JOIN conversations c ON c.id = m.conversation_id
           JOIN contact_identities ci ON ci.contact_id = c.contact_id
          WHERE m.id = $1
            AND ci.channel_type = $2 AND ci.external_id = $3
            AND c.channel_id = $5
          LIMIT 1`,
        [req.params.messageId, WEBCHAT_CHANNEL, visitorId, index, row.channel_id],
      );
      return rows[0] ?? null;
    });

    if (!att?.storage_key) return reply.code(404).send({ error: 'not_found' });

    const obj = await storage.get(att.storage_key);
    if (!obj) return reply.code(404).send({ error: 'not_stored' });

    const name = safeFileName(att.filename ?? 'file');
    return reply
      .type(att.mime ?? obj.contentType)
      .header('cache-control', 'private, max-age=86400, immutable')
      .header('content-length', String(obj.size))
      /* Картинку показываем в окне, остальное отдаём на скачивание.
         Без attachment браузер попытается открыть чужой html прямо на
         нашем домене — а это уже не файл, а страница от нашего имени. */
      .header(
        'content-disposition',
        (webchatFileKind(att.mime ?? '') === 'image' && req.query?.download !== '1'
          ? 'inline'
          : 'attachment') + `; filename*=UTF-8''${encodeURIComponent(name)}`,
      )
      .header('x-content-type-options', 'nosniff')
      .send(obj.body);
  });

  /** Сообщение от посетителя. */
  app.post<{
    Params: { key: string };
    Body: {
      visitorId?: string;
      text?: string;
      name?: string;
      page?: string;
      file?: { name?: string; mime?: string; dataBase64?: string };
    };
    // Файл едет внутри JSON как base64, поэтому тело крупнее обычного.
    // Полтора предела: base64 прибавляет к весу файла треть.
  }>('/chat/:key/messages', { bodyLimit: Math.ceil(WEBCHAT_FILE_LIMIT * 1.5) }, async (req, reply) => {
    const row = await channelByKey(req.params.key);
    if (!row || row.status !== 'active') return reply.code(404).send({ error: 'not_found' });

    const visitorId = String(req.body?.visitorId ?? '');
    if (!/^[a-f0-9]{32}$/.test(visitorId)) return reply.code(400).send({ error: 'bad_visitor' });

    const text = String(req.body?.text ?? '').trim();
    const file = req.body?.file;
    if (!text && !file?.dataBase64) return reply.code(400).send({ error: 'empty' });
    if (text.length > 4000) return reply.code(413).send({ error: 'too_long' });

    if (!rateOk(visitorId)) return reply.code(429).send({ error: 'too_fast' });

    // Идентификатор сообщения выдаём мы: клиентскому коду доверять
    // нельзя, а дедупликация на нём и держится.
    const clientId = `wc_${visitorId.slice(0, 8)}_${Date.now()}_${randomBytes(3).toString('hex')}`;

    const attachments: Attachment[] = [];
    if (file?.dataBase64) {
      const body = Buffer.from(String(file.dataBase64), 'base64');
      if (!body.length) return reply.code(400).send({ error: 'bad_file' });
      if (body.length > WEBCHAT_FILE_LIMIT) return reply.code(413).send({ error: 'file_too_big' });

      const mime = String(file.mime ?? '').slice(0, 120) || 'application/octet-stream';
      const kind = webchatFileKind(mime);
      const key = `webchat/${row.tenant_id}/${clientId}/0`;
      try {
        await storage.put(key, body, mime);
      } catch (err) {
        log('warn', 'Не удалось сохранить файл из чата на сайте', { error: String(err) });
        return reply.code(503).send({ error: 'storage_failed' });
      }

      attachments.push({
        // В нашей модели вложений нет «чего угодно»: всё, что не
        // картинка, звук или видео, для остальных каналов документ.
        type: kind === 'file' ? 'document' : kind,
        mime,
        size: body.length,
        filename: safeFileName(String(file.name ?? '')),
        storageKey: key,
        ready: true,
      });
    }

    const message = normalizeWebchat(
      {
        visitorId,
        text,
        clientId,
        name: String(req.body?.name ?? '').slice(0, 80) || null,
        page: String(req.body?.page ?? '').slice(0, 300) || null,
        ...(attachments.length ? { attachments } : {}),
      },
      { tenantId: row.tenant_id, channelId: row.channel_id },
    );
    if (!message) return reply.code(400).send({ error: 'empty' });

    await inboundQueue.add(
      'webchat',
      {
        provider: 'webchat',
        channelId: row.channel_id,
        tenantId: row.tenant_id,
        payload: { ...message, sentAt: message.sentAt.toISOString() },
        receivedAt: new Date().toISOString(),
      },
      { jobId: jobKey('wc', clientId) },
    );

    return reply.code(202).send({ ok: true });
  });
}

/* ═══════════════ Разметка и скрипты ═══════════════ */

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Загрузчик.
 *
 * Пишется на языке десятилетней давности намеренно: он попадает на
 * чужие сайты, где может стоять что угодно, вплоть до старых сборщиков,
 * которые споткнутся о современный синтаксис.
 */
export function loaderScript(appUrl: string): string {
  const base = appUrl.replace(/\/+$/, '');
  return `(function(){
  var me = document.currentScript;
  var key = me && me.getAttribute('data-key');
  if (!key) return;
  var base = '${base}';

  // Сторона экрана приходит атрибутом: скрипт общий на всех клиентов,
  // и запрашивать ради одной настройки ещё один ответ сервера незачем.
  var side = me.getAttribute('data-side') === 'left' ? 'left' : 'right';

  var btn = document.createElement('button');
  btn.setAttribute('aria-label', 'Chat');
  /* Кнопка создаётся невидимой и ждёт своего момента: показать её сразу,
     а потом спрятать — значит мигнуть на глазах у человека. */
  btn.style.cssText = 'position:fixed;' + side + ':20px;bottom:20px;width:56px;height:56px;border:0;' +
    'border-radius:50%;background:#2F6BFF;color:#fff;cursor:pointer;z-index:2147483000;' +
    'box-shadow:0 10px 30px rgba(11,16,34,.28);display:flex;align-items:center;' +
    'justify-content:center;padding:0;opacity:0;pointer-events:none;' +
    'transition:transform .15s ease, opacity .35s ease';
  btn.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" ' +
    'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-3.9-.9L3 21l1.9-4.6a8.4 8.4 0 0 1-.9-3.9 ' +
    '8.4 8.4 0 0 1 8.4-8.4h.6a8.4 8.4 0 0 1 8 8z"/></svg>';

  var frame = document.createElement('iframe');
  frame.src = base + '/chat/' + encodeURIComponent(key);
  frame.title = 'Chat';
  frame.style.display = 'none';

  var dot = document.createElement('span');
  dot.style.cssText = 'position:absolute;top:2px;right:2px;min-width:18px;height:18px;' +
    'border-radius:9px;background:#e5484d;color:#fff;font:600 11px/18px system-ui,sans-serif;' +
    'display:none;text-align:center;padding:0 4px';
  btn.appendChild(dot);

  function phone(){ return window.innerWidth < 520 }

  var DESK = 'position:fixed;' + side + ':20px;bottom:88px;width:380px;height:min(560px,70vh);' +
    'border:0;border-radius:16px;z-index:2147483000;' +
    'box-shadow:0 24px 60px -20px rgba(11,16,34,.45);background:#fff';
  var FULL = 'position:fixed;inset:0;width:100%;height:100%;border:0;border-radius:0;' +
    'z-index:2147483000;background:#fff';

  /* На телефоне рамка занимает экран целиком, и кнопка на ней только
     мешает: она накрывает поле ввода, а закрыть чат можно крестиком
     в его же шапке. */
  function place(){
    frame.style.cssText = (phone() ? FULL : DESK) + ';display:' + (open ? 'block' : 'none');
    btn.style.display = (open && phone()) ? 'none' : 'flex';
  }

  var open = false;
  function toggle(next){
    open = next === undefined ? !open : next;
    place();
    btn.style.transform = open ? 'scale(.92)' : 'none';
    if (open){
      dot.style.display = 'none';
      try { frame.contentWindow.postMessage({ rz:'opened' }, base) } catch(e){}
    }
  }

  window.addEventListener('resize', place);

  btn.onclick = function(){ toggle() };

  window.addEventListener('message', function(e){
    if (e.origin !== base || !e.data || !e.data.rz) return;
    if (e.data.rz === 'close') toggle(false);
    if (e.data.rz === 'unread'){
      var n = Number(e.data.n) || 0;
      if (!open && n > 0){ dot.textContent = n > 9 ? '9+' : String(n); dot.style.display = 'block' }
    }
  });

  /* Вид кнопки приходит с сервера: строку подключения клиент вставил на
     сайт один раз, и настройки, зашитые в неё, менять было бы некому. */
  var shown = false;

  function rgba(hex, a){
    if (!hex || hex.length !== 7) return 'rgba(47,107,255,' + a + ')';
    var r = parseInt(hex.substr(1, 2), 16);
    var g = parseInt(hex.substr(3, 2), 16);
    var b = parseInt(hex.substr(5, 2), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  function reveal(anim, color){
    if (shown) return;
    shown = true;
    btn.style.pointerEvents = 'auto';

    if (anim === 'slide'){
      btn.style.transform = 'translateY(24px)';
      setTimeout(function(){
        btn.style.opacity = '1';
        btn.style.transform = 'none';
      }, 20);
      return;
    }

    btn.style.opacity = '1';

    if (anim === 'pulse'){
      var css = document.createElement('style');
      /* Пульсация идёт три круга и останавливается. Бесконечная —
         это мигающий баннер: его перестают видеть через минуту, а
         раздражать он не перестаёт. */
      css.textContent = '@keyframes rzpulse{0%{box-shadow:0 0 0 0 ' + rgba(color, 0.5) +
        '}70%{box-shadow:0 0 0 18px ' + rgba(color, 0) +
        '}100%{box-shadow:0 0 0 0 ' + rgba(color, 0) + '}}';
      document.head.appendChild(css);
      btn.style.animation = 'rzpulse 1.8s ease-out 3';
    }
  }

  /* Сторона экрана тоже приходит с сервера. В строке подключения она
     есть, но строка вставлена на сайт однажды: если человек потом
     передвинул кнопку в настройках, менять вёрстку он не побежит. */
  function relayout(){
    btn.style.left = side === 'left' ? '20px' : 'auto';
    btn.style.right = side === 'left' ? 'auto' : '20px';
    DESK = 'position:fixed;' + side + ':20px;bottom:88px;width:380px;height:min(560px,70vh);' +
      'border:0;border-radius:16px;z-index:2147483000;' +
      'box-shadow:0 24px 60px -20px rgba(11,16,34,.45);background:#fff';
    place();
  }

  function arm(st){
    var anim = st.anim || 'fade';
    var color = st.launcher || '#2F6BFF';
    btn.style.background = color;
    if ((st.side === 'left' || st.side === 'right') && st.side !== side){
      side = st.side;
      relayout();
    }
    if (anim === 'none'){ btn.style.transition = 'transform .15s ease' }

    if (st.showMode === 'delay'){
      setTimeout(function(){ reveal(anim, color) }, (Number(st.showAfter) || 0) * 1000);
      return;
    }

    if (st.showMode === 'scroll'){
      var need = Number(st.showAfter) || 0;
      var check = function(){
        var doc = document.documentElement;
        var full = (doc.scrollHeight || 0) - (window.innerHeight || 0);
        /* Короткая страница прокрутиться не может, и ждать от неё
           прокрутки — значит не показать кнопку никогда. */
        var pct = full > 0 ? ((window.pageYOffset || doc.scrollTop || 0) / full) * 100 : 100;
        if (pct >= need){
          window.removeEventListener('scroll', check);
          reveal(anim, color);
        }
      };
      window.addEventListener('scroll', check, { passive: true });
      check();
      return;
    }

    reveal(anim, color);
  }

  function style(){
    try {
      var x = new XMLHttpRequest();
      x.open('GET', base + '/chat/' + encodeURIComponent(key) + '/style', true);
      x.onreadystatechange = function(){
        if (x.readyState !== 4) return;
        var st = {};
        try { if (x.status === 200) st = JSON.parse(x.responseText) } catch(e){}
        /* Ответа нет — кнопку всё равно показываем. Молчащий чат из-за
           одного неудачного запроса хуже, чем чат не того цвета. */
        arm(st.showMode ? st : { anim: 'fade', showMode: 'now' });
      };
      x.send();
    } catch(e){ arm({ anim: 'fade', showMode: 'now' }) }
  }

  function mount(){
    document.body.appendChild(frame);
    document.body.appendChild(btn);
    place();
    style();
  }
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();`;
}

function missingPage(): string {
  return `<!DOCTYPE html><html lang="uk"><head><meta charset="utf-8">
<title>Чат</title></head><body style="font:15px system-ui,sans-serif;padding:24px;color:#4a5568">
Цей чат вимкнено або видалено.</body></html>`;
}

function blockedPage(): string {
  return `<!DOCTYPE html><html lang="uk"><head><meta charset="utf-8">
<title>Чат</title></head><body style="font:15px system-ui,sans-serif;padding:24px;color:#4a5568">
Чат не налаштовано для цього сайту.</body></html>`;
}

/**
 * Страница чата.
 *
 * Отдельная от инбокса намеренно: её видит посторонний человек с
 * телефона и на чужом сайте, и ей нужны собственные размеры, свой цвет
 * и ничего лишнего. Ни одной внешней загрузки — шрифт системный,
 * скрипт внутри.
 */
export function chatPage(
  key: string,
  s: { title: string; subtitle: string; greeting: string; color: string; logo: string },
  inline: boolean,
  preview = false,
): string {
  const color = safeColor(s.color);
  const logo = safeLogo(s.logo);
  return `<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(s.title)}</title>
<style>
  *{box-sizing:border-box}
  :root{--brand:${color}}
  html,body{margin:0;height:100%;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    background:#fff;color:#0b1022}
  #wrap{display:flex;flex-direction:column;height:100%}
  header{display:flex;align-items:center;justify-content:space-between;gap:10px;
    padding:14px 16px;background:var(--brand);color:#fff;flex:none}
  header .who{display:flex;align-items:center;gap:10px;min-width:0}
  /* Логотип на цветной шапке: белая подложка, иначе тёмный знак на
     тёмном фоне превращается в пятно. */
  header img{width:32px;height:32px;border-radius:9px;object-fit:contain;flex:none;
    background:#fff;padding:3px}
  header b{font-size:15px;font-weight:600;display:block;overflow:hidden;
    text-overflow:ellipsis;white-space:nowrap}
  header .sub{font-size:12px;opacity:.85;margin-top:1px;overflow:hidden;
    text-overflow:ellipsis;white-space:nowrap}
  header button{background:transparent;border:0;color:#fff;font-size:22px;line-height:1;
    cursor:pointer;padding:0 2px;opacity:.85}
  #log{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:8px;background:#f5f7fb}
  .m{max-width:82%;padding:9px 12px;border-radius:14px;white-space:pre-wrap;word-wrap:break-word;
    font-size:14.5px;box-shadow:0 1px 2px rgba(11,16,34,.06)}
  .m.them{align-self:flex-start;background:#fff;border-bottom-left-radius:5px}
  .m.mine{align-self:flex-end;background:var(--brand);color:#fff;border-bottom-right-radius:5px}
  .t{font-size:11px;opacity:.55;margin-top:3px}
  form{display:flex;gap:8px;padding:12px;border-top:1px solid #e6e9f2;flex:none;background:#fff;
    padding-bottom:calc(12px + env(safe-area-inset-bottom))}
  textarea{flex:1;resize:none;border:1px solid #d7dce9;border-radius:12px;padding:10px 12px;
    /* Ровно 16 пикселей и по отдельным свойствам. Сокращённая запись
       font со словом inherit недопустима, браузер выбрасывал её целиком,
       и поле оставалось с 13,3 пикселя по умолчанию. Всё, что меньше
       шестнадцати, Safari на айфоне считает мелким и при касании
       приближает страницу — а обратно уже не отдаляет. */
    font-size:16px;line-height:1.4;font-family:inherit;
    max-height:120px;min-height:44px;outline:none}
  textarea:focus{border-color:var(--brand)}
  button.send{border:0;background:var(--brand);color:#fff;border-radius:12px;padding:0 16px;
    font-weight:600;cursor:pointer;font-size:14px}
  .hint{padding:10px 16px;font-size:12px;color:#7a8299;background:#f5f7fb}
  /* Скрепка и смайлик: обе кнопки — иконки без рамки, чтобы поле ввода
     оставалось главным, а не тонуло между тремя кнопками. */
  button.tool{border:0;background:transparent;color:#7a8299;cursor:pointer;font-size:19px;
    line-height:1;padding:0 6px;align-self:flex-end;height:44px;flex:none}
  button.tool:hover{color:var(--brand)}
  /* Картинку показываем целиком: фотография товара, обрезанная до
     квадрата, отвечает не на тот вопрос, который задавали. */
  .m img.pic{display:block;max-width:100%;border-radius:10px;margin:2px 0}
  .m a.file{display:flex;align-items:center;gap:8px;color:inherit;text-decoration:none;
    padding:7px 9px;border-radius:10px;background:rgba(11,16,34,.06);margin:2px 0}
  .m.mine a.file{background:rgba(255,255,255,.18)}
  .m a.file b{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
  .m a.file span{opacity:.7;font-size:12px;flex:none}
  #emo{display:none;position:absolute;bottom:64px;left:8px;right:8px;background:#fff;
    border:1px solid #e6e9f2;border-radius:14px;padding:8px;box-shadow:0 12px 30px rgba(11,16,34,.18);
    max-height:190px;overflow-y:auto;z-index:5}
  #emo button{border:0;background:transparent;font-size:21px;line-height:1.6;cursor:pointer;
    width:12.5%;padding:0}
  #emo button:hover{background:#f0f3fa;border-radius:8px}
  #bottom{position:relative;flex:none}
  .warn{padding:8px 16px;font-size:12.5px;color:#b42318;background:#fff4f3}
</style>
</head>
<body>
<div id="wrap">
  <header>
    <div class="who">
      ${logo ? `<img src="${logo}" alt="">` : ''}
      <div style="min-width:0">
        <b>${esc(s.title)}</b>
        ${s.subtitle ? `<div class="sub">${esc(s.subtitle)}</div>` : ''}
      </div>
    </div>
    ${inline || preview ? '' : '<button id="x" aria-label="Закрити">&times;</button>'}
  </header>
  <div id="log"></div>
  <div id="bottom">
    <div id="emo"></div>
    <div class="warn" id="warn" style="display:none"></div>
    <form id="f">
      <button class="tool" type="button" id="clip" aria-label="Файл">&#128206;</button>
      <button class="tool" type="button" id="smile" aria-label="Емодзі">&#128578;</button>
      <input type="file" id="fileIn" style="display:none">
      <textarea id="t" rows="1" placeholder="Напишіть повідомлення" maxlength="4000"></textarea>
      <button class="send" type="submit">&#10148;</button>
    </form>
  </div>
</div>
<script>
(function(){
  var KEY = ${JSON.stringify(key)};
  var PREVIEW = ${preview ? 'true' : 'false'};
  var STORE = 'rz_chat_' + KEY;
  var log = document.getElementById('log');
  var form = document.getElementById('f');
  var input = document.getElementById('t');
  var fileIn = document.getElementById('fileIn');
  var MAX = ${WEBCHAT_FILE_LIMIT};
  var MAXMB = Math.round(MAX / 1024 / 1024);
  /* Разделитель для отметки «своё, уже показано»: у сообщения с файлом
     текста нет, и сравнивать по тексту стало нечего. */
  var SEP = '|#|';
  /* Заглушки своих файлов: ждут, пока сервер вернёт сообщение с номером. */
  var holders = {};
  var visitorId = null, after = null, unread = 0, timer = null;
  /* Свои сообщения показываем сразу, не дожидаясь сервера, — а потом они
     возвращаются при опросе. Чтобы не нарисовать их дважды, держим
     список только что отправленных и гасим совпадение при возврате. */
  var pending = [];
  /* Показанные сообщения по их номеру. Метка времени как курсор —
     вещь хрупкая: хватает одной потерянной доли секунды, чтобы одно и
     то же сообщение возвращалось при каждом опросе. Номер не врёт. */
  var shown = {};

  function parentSay(data){
    try { if (window.parent !== window) window.parent.postMessage(data, '*') } catch(e){}
  }

  if (document.getElementById('x')) {
    document.getElementById('x').onclick = function(){ parentSay({ rz:'close' }) };
  }

  window.addEventListener('message', function(e){
    if (e.data && e.data.rz === 'opened'){ unread = 0; parentSay({ rz:'unread', n:0 }) }
  });

  function saved(){
    try { return localStorage.getItem(STORE) } catch(e){ return null }
  }
  function save(v){
    try { localStorage.setItem(STORE, v) } catch(e){}
  }

  function human(n){
    if (!n) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  function mediaUrl(msgId, i, download){
    return '/chat/' + encodeURIComponent(KEY) + '/media/' + encodeURIComponent(msgId) +
      '/' + i + '?visitorId=' + visitorId + (download ? '&download=1' : '');
  }

  /* Файлы рисуются узлами, а не разметкой строкой: имя файла придумал
     посторонний, и единственный способ не разбирать потом, что он туда
     вписал, — не собирать из него HTML вообще. */
  function fileNode(f, msgId){
    if (f.kind === 'image' && msgId){
      var a = document.createElement('a');
      a.href = mediaUrl(msgId, f.i, false);
      a.target = '_blank';
      a.rel = 'noopener';
      var img = document.createElement('img');
      img.className = 'pic';
      img.src = a.href;
      img.alt = f.name || '';
      a.appendChild(img);
      return a;
    }
    var link = document.createElement(msgId ? 'a' : 'div');
    link.className = 'file';
    if (msgId){
      link.href = mediaUrl(msgId, f.i, true);
      link.target = '_blank';
      link.rel = 'noopener';
    }
    var name = document.createElement('b');
    name.textContent = f.name || 'file';
    var size = document.createElement('span');
    size.textContent = human(f.size);
    /* Именно fromCodePoint: у скрепки номер больше 65535, и fromCharCode
       отдаёт половину пары — в окне это пустой квадрат. */
    link.appendChild(document.createTextNode(String.fromCodePoint(128206) + ' '));
    link.appendChild(name);
    link.appendChild(size);
    return link;
  }

  function bubble(text, mine, at, files, msgId){
    var d = document.createElement('div');
    d.className = 'm ' + (mine ? 'mine' : 'them');
    if (text) d.textContent = text;
    var list = files || [];
    for (var i = 0; i < list.length; i++) d.appendChild(fileNode(list[i], msgId));
    if (at){
      var t = document.createElement('div');
      t.className = 't';
      t.textContent = new Date(at).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
      d.appendChild(t);
    }
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    return d;
  }

  function greet(){
    var g = ${JSON.stringify(s.greeting)};
    if (g) bubble(g, false, null);
  }

  function poll(){
    if (!visitorId) return;
    var url = '/chat/' + encodeURIComponent(KEY) + '/messages?visitorId=' + visitorId +
      (after ? '&after=' + encodeURIComponent(after) : '');
    fetch(url).then(function(r){ return r.json() }).then(function(d){
      var list = d.messages || [];
      for (var i = 0; i < list.length; i++){
        var m = list[i];
        after = m.cursor || m.at;

        if (m.id && shown[m.id]) continue;
        if (m.id) shown[m.id] = 1;

        if (m.mine){
          var files = m.files || [];
          if (files.length){
            /* Свой файл показан заглушкой без ссылки: номера сообщения
               тогда ещё не было, а без него картинку не загрузить.
               Теперь номер есть — заглушку убираем и рисуем настоящее,
               уже с картинкой. */
            var h = holders[SEP + files[0].name];
            if (h){
              if (h.parentNode) h.parentNode.removeChild(h);
              delete holders[SEP + files[0].name];
            }
          } else {
            var seen = pending.indexOf(m.text);
            if (seen >= 0){ pending.splice(seen, 1); continue }
          }
        }

        bubble(m.text, m.mine, m.at, m.files, m.id);
        if (!m.mine){ unread++; parentSay({ rz:'unread', n:unread }) }
      }
    }).catch(function(){});
  }

  function start(){
    fetch('/chat/' + encodeURIComponent(KEY) + '/session', {
      method:'POST',
      headers:{ 'content-type':'application/json' },
      body: JSON.stringify({ visitorId: saved() })
    }).then(function(r){ return r.json() }).then(function(d){
      visitorId = d.visitorId;
      save(visitorId);
      greet();
      poll();
      timer = setInterval(poll, 3000);
    }).catch(function(){
      bubble('Не вдалося підключитися. Спробуйте оновити сторінку.', false, null);
    });
  }

  function warn(msg){
    var w = document.getElementById('warn');
    w.textContent = msg;
    w.style.display = msg ? 'block' : 'none';
    if (msg) setTimeout(function(){ w.style.display = 'none' }, 6000);
  }

  function send(text, file){
    var body = { visitorId: visitorId, text: text, page: document.referrer || '' };
    if (file) body.file = file;

    fetch('/chat/' + encodeURIComponent(KEY) + '/messages', {
      method:'POST',
      headers:{ 'content-type':'application/json' },
      body: JSON.stringify(body)
    }).then(function(r){
      if (r.status === 413) return warn('Файл завеликий: до ' + MAXMB + ' МБ');
      if (!r.ok) return warn('Повідомлення не надіслалося. Спробуйте ще раз.');
      setTimeout(poll, 700);
    }).catch(function(){
      warn('Немає звязку. Спробуйте ще раз.');
    });
  }

  form.onsubmit = function(e){
    e.preventDefault();
    var text = input.value.trim();
    if (!text || !visitorId) return;
    input.value = '';
    input.style.height = 'auto';
    bubble(text, true, new Date().toISOString());
    pending.push(text);
    send(text, null);
  };

  /* Файл уходит отдельным сообщением, без подписи. Так проще и честнее:
     поле ввода остаётся полем ввода, а не превращается в форму с
     прикреплением, где половина людей забывает нажать «отправить». */
  document.getElementById('clip').onclick = function(){ fileIn.click() };

  fileIn.onchange = function(){
    var f = this.files && this.files[0];
    this.value = '';
    if (!f || !visitorId) return;
    if (f.size > MAX){ warn('Файл завеликий: до ' + MAXMB + ' МБ'); return }

    var reader = new FileReader();
    reader.onload = function(){
      var raw = String(reader.result);
      var comma = raw.indexOf(',');
      if (comma < 0){ warn('Не вдалося прочитати файл'); return }

      var mine = { i:0, name:f.name, size:f.size, kind:kindOf(f.type) };
      holders[SEP + f.name] = bubble('', true, new Date().toISOString(), [mine], null);

      send('', { name: f.name, mime: f.type || '', dataBase64: raw.slice(comma + 1) });
    };
    reader.onerror = function(){ warn('Не вдалося прочитати файл') };
    reader.readAsDataURL(f);
  };

  function kindOf(mime){
    var m = (mime || '').toLowerCase();
    if (m.indexOf('image/') === 0) return 'image';
    if (m.indexOf('audio/') === 0) return 'audio';
    if (m.indexOf('video/') === 0) return 'video';
    return 'file';
  }

  /* Смайлики набором, а не библиотекой: чужой набор — это ещё сотня
     килобайт на каждой странице клиента ради того, чем пользуются
     полторы минуты в день. */
  var EMOJI = ('128512 128513 128514 129315 128516 128521 128522 128525 128536 128539 ' +
    '128578 128579 129300 129303 128530 128527 128526 128533 128543 128546 ' +
    '128557 128561 128563 128565 128548 128545 128544 128169 128064 128075 ' +
    '128077 128078 128079 128588 128591 128170 128147 10084 128142 10024 ' +
    '128293 127881 127880 127942 128176 128666 9989 10060 9888 128272 ' +
    '128241 128231 128197 128340 128204 128200 128717 127873 128230 128737').split(' ');

  var emo = document.getElementById('emo');
  for (var ei = 0; ei < EMOJI.length; ei++){
    (function(code){
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = String.fromCodePoint(Number(code));
      b.onclick = function(){
        var at = input.selectionStart;
        var v = input.value;
        input.value = v.slice(0, at) + b.textContent + v.slice(input.selectionEnd);
        input.focus();
        input.selectionStart = input.selectionEnd = at + b.textContent.length;
      };
      emo.appendChild(b);
    })(EMOJI[ei]);
  }

  document.getElementById('smile').onclick = function(){
    emo.style.display = emo.style.display === 'block' ? 'none' : 'block';
  };
  /* Панель закрывается по щелчку мимо: на телефоне она занимает треть
     окна, и искать вторую кнопку, чтобы её убрать, никто не станет. */
  document.addEventListener('click', function(e){
    if (e.target.closest && !e.target.closest('#emo') && e.target.id !== 'smile'){
      emo.style.display = 'none';
    }
  });

  input.addEventListener('input', function(){
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });

  input.addEventListener('keydown', function(e){
    if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); form.requestSubmit() }
  });

  /*
   * Превью. Здесь нет ни посетителя, ни переписки: страница открыта в
   * настройках, чтобы посмотреть на вид. Показываем приветствие и пару
   * реплик, чтобы было видно и свой пузырь, и чужой, — по пустому окну
   * цвет не подберёшь.
   */
  if (PREVIEW){
    greet();
    bubble('Доброго дня! Скільки коштує доставка?', true, new Date().toISOString());
    bubble('По місту — безкоштовно від 500 грн.', false, new Date().toISOString());
    input.disabled = true;
    form.onsubmit = function(e){ e.preventDefault() };
  } else {
    start();
  }
})();
</script>
</body>
</html>`;
}
