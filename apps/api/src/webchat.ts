import type { FastifyInstance } from 'fastify';
import type { Queue } from 'bullmq';
import { randomBytes } from 'node:crypto';
import {
  WEBCHAT_CHANNEL,
  domainAllowed,
  jobKey,
  normalizeWebchat,
  safeColor,
  safeLogo,
  webchatSettings,
  withSystem,
  withTenant,
  type InboundJob,
  type Pool,
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
  const { pool, inboundQueue, appUrl, log } = deps;

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
   * Всё, что он делает, — рисует кнопку и открывает рамку. Ни одного
   * запроса к нашему API отсюда не уходит: сама переписка живёт внутри
   * рамки, на нашем домене.
   */
  app.get('/chat.js', async (_req, reply) =>
    reply
      .type('application/javascript; charset=utf-8')
      .header('cache-control', 'public, max-age=300')
      .header('access-control-allow-origin', '*')
      .send(loaderScript(appUrl)),
  );

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
        }>(
          `SELECT m.id, m.direction, m.content->>'text' AS body, m.sent_at
             FROM messages m
             JOIN conversations c ON c.id = m.conversation_id
             JOIN contact_identities ci ON ci.contact_id = c.contact_id
            WHERE ci.channel_type = $1 AND ci.external_id = $2
              AND c.channel_id = $3
              AND ($4::timestamptz IS NULL OR m.sent_at > $4::timestamptz)
              AND m.content->>'text' IS NOT NULL
            ORDER BY m.sent_at
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
        })),
      };
    },
  );

  /** Сообщение от посетителя. */
  app.post<{
    Params: { key: string };
    Body: { visitorId?: string; text?: string; name?: string; page?: string };
  }>('/chat/:key/messages', async (req, reply) => {
    const row = await channelByKey(req.params.key);
    if (!row || row.status !== 'active') return reply.code(404).send({ error: 'not_found' });

    const visitorId = String(req.body?.visitorId ?? '');
    if (!/^[a-f0-9]{32}$/.test(visitorId)) return reply.code(400).send({ error: 'bad_visitor' });

    const text = String(req.body?.text ?? '').trim();
    if (!text) return reply.code(400).send({ error: 'empty' });
    if (text.length > 4000) return reply.code(413).send({ error: 'too_long' });

    if (!rateOk(visitorId)) return reply.code(429).send({ error: 'too_fast' });

    // Идентификатор сообщения выдаём мы: клиентскому коду доверять
    // нельзя, а дедупликация на нём и держится.
    const clientId = `wc_${visitorId.slice(0, 8)}_${Date.now()}_${randomBytes(3).toString('hex')}`;

    const message = normalizeWebchat(
      {
        visitorId,
        text,
        clientId,
        name: String(req.body?.name ?? '').slice(0, 80) || null,
        page: String(req.body?.page ?? '').slice(0, 300) || null,
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
  btn.style.cssText = 'position:fixed;' + side + ':20px;bottom:20px;width:56px;height:56px;border:0;' +
    'border-radius:50%;background:#2F6BFF;color:#fff;cursor:pointer;z-index:2147483000;' +
    'box-shadow:0 10px 30px rgba(11,16,34,.28);display:flex;align-items:center;' +
    'justify-content:center;padding:0;transition:transform .15s ease';
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

  function mount(){
    document.body.appendChild(frame);
    document.body.appendChild(btn);
    place();
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
    font:16px/1.4 inherit;max-height:120px;min-height:44px;outline:none}
  textarea:focus{border-color:var(--brand)}
  button.send{border:0;background:var(--brand);color:#fff;border-radius:12px;padding:0 16px;
    font-weight:600;cursor:pointer;font-size:14px}
  .hint{padding:10px 16px;font-size:12px;color:#7a8299;background:#f5f7fb}
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
  <form id="f">
    <textarea id="t" rows="1" placeholder="Напишіть повідомлення" maxlength="4000"></textarea>
    <button class="send" type="submit">&#10148;</button>
  </form>
</div>
<script>
(function(){
  var KEY = ${JSON.stringify(key)};
  var PREVIEW = ${preview ? 'true' : 'false'};
  var STORE = 'rz_chat_' + KEY;
  var log = document.getElementById('log');
  var form = document.getElementById('f');
  var input = document.getElementById('t');
  var visitorId = null, after = null, unread = 0, timer = null;
  /* Свои сообщения показываем сразу, не дожидаясь сервера, — а потом они
     возвращаются при опросе. Чтобы не нарисовать их дважды, держим
     список только что отправленных и гасим совпадение при возврате. */
  var pending = [];

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

  function bubble(text, mine, at){
    var d = document.createElement('div');
    d.className = 'm ' + (mine ? 'mine' : 'them');
    d.textContent = text;
    if (at){
      var t = document.createElement('div');
      t.className = 't';
      t.textContent = new Date(at).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
      d.appendChild(t);
    }
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
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
        after = m.at;

        if (m.mine){
          var seen = pending.indexOf(m.text);
          if (seen >= 0){ pending.splice(seen, 1); continue }
        }

        bubble(m.text, m.mine, m.at);
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

  form.onsubmit = function(e){
    e.preventDefault();
    var text = input.value.trim();
    if (!text || !visitorId) return;
    input.value = '';
    input.style.height = 'auto';
    bubble(text, true, new Date().toISOString());
    pending.push(text);

    fetch('/chat/' + encodeURIComponent(KEY) + '/messages', {
      method:'POST',
      headers:{ 'content-type':'application/json' },
      body: JSON.stringify({ visitorId: visitorId, text: text, page: document.referrer || '' })
    }).then(function(r){
      if (!r.ok) bubble('Повідомлення не надіслалося. Спробуйте ще раз.', false, null);
      setTimeout(poll, 700);
    }).catch(function(){
      bubble('Немає звязку. Спробуйте ще раз.', false, null);
    });
  };

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
