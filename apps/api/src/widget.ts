import type { FastifyInstance, FastifyReply } from 'fastify';
import { withTenant, type Pool } from '@omnidesk/core';
import { BRAND_CSS, THEME_JS } from './theme.js';

/**
 * Виджет для карточки Zoho CRM.
 *
 * Это отдельная страница, а не рабочее место целиком: внутри рамки в
 * карточке клиента нет места ни списку диалогов, ни панели разделов, и
 * человек пришёл сюда не выбирать чат — он уже смотрит на конкретного
 * клиента. Поэтому здесь ровно переписка с ним и поле ответа.
 *
 * Как виджет понимает, чья карточка открыта. Zoho даёт внутри рамки
 * свой набор функций: по событию загрузки приходит модуль и номер
 * записи, по ним читаются телефон и почта. Дальше наш сервер ищет
 * диалог по этим приметам — сначала по связи с карточкой, потом по
 * номеру телефона.
 *
 * Про вход. Первый раз оператор вводит свою почту и код — тот же вход,
 * что и в основном приложении. Токен живёт в хранилище вкладки нашего
 * происхождения, поэтому повторно внутри Zoho его вводить не нужно.
 * Делать вход по пользователю Zoho здесь намеренно не стали: для этого
 * нужна функция на стороне Zoho, которая подписывает запрос, а это
 * установка, которую клиент не сможет сделать сам.
 *
 * ⚠️ Внутри шаблонной строки НЕЛЬЗЯ использовать обратные слэши.
 */

export const WIDGET_HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rozmovio</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700&display=swap" rel="stylesheet">
<script data-theme-boot>${THEME_JS}</script>
<script src="https://live.zwidgets.com/js-sdk/1.2/ZohoEmbededAppSDK.min.js"></script>
<style>
  ${BRAND_CSS}
  html,body{height:100%}
  body{display:flex;flex-direction:column;overflow:hidden}
  .wbar{display:flex;align-items:center;gap:9px;padding:9px 12px;border-bottom:1px solid var(--line);
    background:var(--panel);flex:none}
  .wbar .who{min-width:0}
  .wbar .nm{font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .wbar .sub{font-size:11px;color:var(--t3)}
  .wbar .grow{flex:1}
  #msgs{flex:1;overflow-y:auto;padding:14px 12px;display:flex;flex-direction:column;gap:7px;min-height:0}
  .m{max-width:min(460px,80%);padding:8px 11px;border-radius:10px;font-size:12.5px;line-height:1.45;
    white-space:pre-wrap;word-wrap:break-word;width:fit-content}
  .m.in{align-self:flex-start;background:var(--panel);border:1px solid var(--line);
    border-bottom-left-radius:3px}
  .m.out{align-self:flex-end;background:var(--accent);color:var(--on-accent);
    border-bottom-right-radius:3px}
  .m .meta{font-size:10px;opacity:.7;margin-top:3px}
  .comp{border-top:1px solid var(--line);padding:9px 12px;background:var(--panel);flex:none;
    display:flex;gap:8px;align-items:flex-end}
  .comp textarea{min-height:34px;max-height:120px;border-radius:7px}
  .mid{margin:auto;max-width:320px;padding:20px;text-align:center}
  .mid input{margin-top:9px}
  .mid .h3{margin-bottom:6px}
  .mid p{font-size:12.5px;color:var(--t2);line-height:1.55;margin:0}
</style>
</head>
<body>

<div id="gate" class="mid">
  <div class="h3">Rozmovio</div>
  <p id="gateText">Войдите один раз — дальше виджет будет открываться сразу.</p>
  <input id="email" type="email" placeholder="рабочая почта" autocomplete="email">
  <input id="code" inputmode="numeric" maxlength="6" placeholder="код из письма" style="display:none">
  <div class="err" id="gateErr"></div>
  <div style="margin-top:12px"><button id="go">Получить код</button></div>
</div>

<div id="app" style="display:none;flex-direction:column;height:100%">
  <div class="wbar">
    <div class="av" id="av"></div>
    <div class="who"><div class="nm" id="nm">—</div><div class="sub" id="sub"></div></div>
    <div class="grow"></div>
    <a id="openApp" href="/app" target="_blank" rel="noopener" style="font-size:11.5px">открыть инбокс</a>
  </div>
  <div id="msgs"></div>
  <div class="comp" id="comp" style="display:none">
    <textarea id="txt" rows="1" placeholder="Ответ клиенту"></textarea>
    <button id="send">Отправить</button>
  </div>
</div>

<div id="empty" class="mid" style="display:none">
  <div class="h3">Переписки нет</div>
  <p id="emptyText">С этим клиентом пока никто не писал через подключённые каналы.</p>
</div>

<script>
(function(){
'use strict';

var TOKEN = '';
try { TOKEN = sessionStorage.getItem('rz_widget_token') || localStorage.getItem('rz_widget_token') || '' } catch(e){}

var CONV = null;
var timer = null;
var record = null;

function el(id){ return document.getElementById(id) }
function esc(s){
  return String(s == null ? '' : s)
    .split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;')
    .split('"').join('&quot;');
}

function api(path, opts){
  opts = opts || {};
  var h = { 'content-type':'application/json' };
  if (TOKEN) h.Authorization = 'Bearer ' + TOKEN;
  return fetch(path, {
    method: opts.method || 'GET',
    headers: h,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  }).then(function(r){
    if (r.status === 401){ TOKEN = ''; showGate('Сессия истекла, войдите заново'); throw new Error('401') }
    return r.json().then(function(d){
      if (!r.ok){ var e = new Error('http'); e.payload = d; throw e }
      return d;
    });
  });
}

function showGate(msg){
  el('gate').style.display = 'block';
  el('app').style.display = 'none';
  el('empty').style.display = 'none';
  if (msg) el('gateErr').textContent = msg;
}

/* ── Вход ─────────────────────────────────────────────────────────
   Тот же код на почту, что и в основном приложении. Токен кладём
   и в localStorage: рамка внутри Zoho перезагружается при каждом
   открытии карточки, и вход на каждый чих — это не работа. */
var step = 'email';
el('go').onclick = function(){
  el('gateErr').textContent = '';
  var email = el('email').value.trim();
  if (step === 'email'){
    if (email.indexOf('@') < 1){ el('gateErr').textContent = 'Введите почту'; return }
    el('go').disabled = true;
    api('/auth/request', { method:'POST', body:{ email: email } })
      .then(function(){
        step = 'code';
        el('code').style.display = 'block';
        el('gateText').textContent = 'Код отправлен на ' + email;
        el('go').textContent = 'Войти';
        el('code').focus();
      })
      .catch(function(){ el('gateErr').textContent = 'Не удалось отправить код' })
      .then(function(){ el('go').disabled = false });
    return;
  }
  var code = el('code').value.trim();
  if (code.length !== 6){ el('gateErr').textContent = 'Код из шести цифр'; return }
  el('go').disabled = true;
  api('/auth/verify', { method:'POST', body:{ email: email, code: code } })
    .then(function(r){
      if (!r.token){ el('gateErr').textContent = 'Эта почта заведена в нескольких организациях — войдите в основном приложении'; return }
      TOKEN = r.token;
      try { localStorage.setItem('rz_widget_token', TOKEN) } catch(e){}
      el('gate').style.display = 'none';
      lookup();
    })
    .catch(function(){ el('gateErr').textContent = 'Неверный код' })
    .then(function(){ el('go').disabled = false });
};

/* ── Поиск диалога по открытой карточке ──────────────────────────── */
function lookup(){
  if (!TOKEN || !record) return;
  var q = [];
  if (record.id) q.push('recordId=' + encodeURIComponent(record.id));
  if (record.module) q.push('module=' + encodeURIComponent(record.module));
  if (record.phone) q.push('phone=' + encodeURIComponent(record.phone));
  if (record.email) q.push('email=' + encodeURIComponent(record.email));

  api('/crm/lookup?' + q.join('&')).then(function(d){
    if (!d.conversationId){
      el('app').style.display = 'none';
      el('empty').style.display = 'block';
      if (d.hint) el('emptyText').textContent = d.hint;
      return;
    }
    CONV = d.conversationId;
    el('empty').style.display = 'none';
    el('app').style.display = 'flex';
    el('nm').textContent = d.name || 'Клиент';
    el('sub').textContent = d.channel || '';
    el('av').textContent = (d.name || '?').slice(0, 1).toUpperCase();
    el('av').style.background = 'var(--accent)';
    el('comp').style.display = d.canReply ? 'flex' : 'none';
    load();
    clearInterval(timer);
    timer = setInterval(load, 5000);
  }).catch(function(){});
}

function load(){
  if (!CONV) return;
  api('/conversations/' + CONV + '/messages').then(function(d){
    var box = el('msgs');
    var atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 40;
    box.innerHTML = (d.messages || []).map(function(m){
      var text = (m.content && m.content.text) || '';
      var when = new Date(m.sent_at);
      var hh = String(when.getHours()).padStart(2, '0') + ':' + String(when.getMinutes()).padStart(2, '0');
      return '<div class="m ' + (m.direction === 'in' ? 'in' : 'out') + '">' + esc(text) +
        '<div class="meta">' + hh + (m.sender_type === 'bot' ? ' · бот' : '') + '</div></div>';
    }).join('');
    if (atBottom) box.scrollTop = box.scrollHeight;
  }).catch(function(){});
}

el('send').onclick = function(){
  var ta = el('txt');
  var text = ta.value.trim();
  if (!text || !CONV) return;
  el('send').disabled = true;
  api('/conversations/' + CONV + '/messages', { method:'POST', body:{ text: text } })
    .then(function(){ ta.value = ''; load() })
    .catch(function(){})
    .then(function(){ el('send').disabled = false });
};
el('txt').onkeydown = function(e){
  if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); el('send').click() }
};

/* ── Связь с Zoho ─────────────────────────────────────────────────
   Виджет живёт в рамке внутри карточки. Zoho сообщает, какая запись
   открыта; телефон и почту читаем из неё же — по ним ищется диалог. */
function start(){
  if (!window.ZOHO || !ZOHO.embeddedApp){
    // Открыли страницу напрямую, не из CRM: показываем, зачем она, и
    // убираем вход — вводить почту здесь незачем, диалог всё равно
    // ищется по открытой карточке.
    el('gate').style.display = 'none';
    el('empty').style.display = 'block';
    el('emptyText').textContent = 'Эта страница открывается внутри карточки клиента в Zoho CRM.';
    return;
  }
  ZOHO.embeddedApp.on('PageLoad', function(data){
    var id = data && (data.EntityId || data.entityId);
    if (Array.isArray(id)) id = id[0];
    record = { module: data && (data.Entity || data.entity), id: id, phone: null, email: null };

    ZOHO.CRM.API.getRecord({ Entity: record.module, RecordID: record.id }).then(function(res){
      var r = (res && res.data && res.data[0]) || {};
      record.phone = r.Phone || r.Mobile || r.Phone_Number || null;
      record.email = r.Email || null;
      if (TOKEN){ el('gate').style.display = 'none'; lookup() }
    }).catch(function(){ if (TOKEN) lookup() });
  });
  ZOHO.embeddedApp.init();
}

if (!TOKEN) showGate('');
start();
})();
</script>
</body>
</html>`;

export interface WidgetDeps {
  pool: Pool;
  requireAuth: (req: unknown) => { tenantId: string; userId: string } | null;
}

export function registerWidget(app: FastifyInstance, opts: WidgetDeps): void {
  app.get('/widget', async (_req, reply: FastifyReply) =>
    reply
      .type('text/html; charset=utf-8')
      // Виджет открывается внутри рамки Zoho — заголовок, запрещающий
      // показ в рамке, сломал бы его. Разрешаем только домены Zoho.
      .header(
        'content-security-policy',
        "frame-ancestors https://*.zoho.com https://*.zoho.eu https://*.zoho.in " +
          "https://*.zoho.com.au https://*.zoho.jp https://*.zoho.com.cn https://*.zohocloud.ca " +
          'https://*.zoho.sa',
      )
      .header('cache-control', 'no-store, must-revalidate')
      .send(WIDGET_HTML),
  );

  /**
   * Поиск диалога по открытой карточке CRM.
   *
   * Порядок важен. Сначала ищем по связи с карточкой: она проставлена
   * при заведении лида и не зависит от того, как записан номер. Потом
   * по номеру телефона — на случай, когда карточка в CRM была раньше
   * переписки. По почте не ищем: мессенджеры её не отдают, и совпадение
   * означало бы, что мы нашли не того человека.
   */
  app.get<{
    Querystring: { recordId?: string; module?: string; phone?: string; email?: string };
  }>('/crm/lookup', async (req, reply) => {
    const auth = opts.requireAuth(req);
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });

    const recordId = (req.query.recordId ?? '').replace(/[^0-9]/g, '').slice(0, 24);
    // В CRM номер записан как удобно человеку: со скобками, пробелами
    // и дефисами. Сравниваем только цифры и берём последние девять —
    // код страны в CRM часто не пишут.
    const digits = (req.query.phone ?? '').replace(/[^0-9]/g, '');
    const tail = digits.length >= 9 ? digits.slice(-9) : '';

    const found = await withTenant(opts.pool, auth.tenantId, async (db) => {
      if (recordId) {
        const { rows } = await db.query<Row>(
          `${BASE_QUERY} WHERE ct.crm_record_id = $1 ORDER BY cv.last_message_at DESC NULLS LAST LIMIT 1`,
          [recordId],
        );
        if (rows[0]) return rows[0];
      }
      if (tail) {
        const { rows } = await db.query<Row>(
          `${BASE_QUERY} WHERE right(regexp_replace(ct.phone_e164, '[^0-9]', '', 'g'), 9) = $1
            ORDER BY cv.last_message_at DESC NULLS LAST LIMIT 1`,
          [tail],
        );
        if (rows[0]) return rows[0];
      }
      return null;
    });

    if (!found) {
      return {
        conversationId: null,
        hint: recordId
          ? 'С этим клиентом ещё не писали через подключённые каналы.'
          : 'Не удалось понять, чья карточка открыта.',
      };
    }

    return {
      conversationId: found.id,
      name: found.display_name,
      channel: CHANNEL_NAMES[found.channel_type] ?? found.channel_type,
      canReply: found.window_expires_at ? new Date(found.window_expires_at) > new Date() : true,
    };
  });
}

interface Row {
  id: string;
  display_name: string | null;
  channel_type: string;
  window_expires_at: Date | null;
}

const BASE_QUERY = `
  SELECT cv.id, ct.display_name, ch.type AS channel_type, cv.window_expires_at
    FROM conversations cv
    JOIN contacts ct ON ct.id = cv.contact_id
    JOIN channels ch ON ch.id = cv.channel_id`;

const CHANNEL_NAMES: Record<string, string> = {
  telegram: 'Telegram',
  telegram_bot: 'Telegram',
  telegram_user: 'Telegram',
  instagram: 'Instagram Direct',
  messenger: 'Messenger',
};
