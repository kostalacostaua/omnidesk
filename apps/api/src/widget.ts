import type { FastifyInstance, FastifyReply } from 'fastify';
import { withTenant, type Pool } from '@omnidesk/core';
import { BRAND_CSS, EMOJI_CSS, EMOJI_JS, THEME_JS } from './theme.js';

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
<script data-theme-boot>${THEME_JS}${EMOJI_JS}</script>
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
  .mwrap{display:flex;flex-direction:column;max-width:100%}
  .mwrap.in{align-items:flex-start}
  .mwrap.out{align-items:flex-end}
  .quote{border-left:2px solid currentColor;padding:2px 0 2px 8px;margin:0 0 5px;
    font-size:11px;opacity:.72;line-height:1.35;max-height:40px;overflow:hidden}
  .quote b{display:block;font-size:10px;opacity:.9}
  .rx{display:flex;gap:3px;margin-top:3px;flex-wrap:wrap}
  .rx .r{background:var(--panel);border:1px solid var(--line);border-radius:10px;
    padding:0 6px;font-size:12px;line-height:1.6}
  .mtools{display:flex;gap:4px;margin-top:2px;opacity:0;transition:opacity .12s}
  .mwrap:hover .mtools{opacity:1}
  .mtools button{background:transparent;border:1px solid var(--line);color:var(--t3);
    border-radius:5px;padding:1px 7px;font-size:11px;font-weight:600;box-shadow:none}
  .mtools button:hover{color:var(--t1);background:var(--hover)}
  .replybar{display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--t2);
    background:var(--panel2);border-radius:var(--r1);padding:6px 9px;margin-bottom:8px}
  .replybar .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .replybar .c{cursor:pointer;color:var(--t3);font-weight:700;margin-left:auto}
  .picker{position:absolute;background:var(--solid);border:1px solid var(--line2);
    border-radius:9px;padding:5px;display:flex;gap:1px;z-index:60;box-shadow:var(--lift)}
  .picker button{background:transparent;border:0;font-size:18px;padding:3px 5px;
    border-radius:6px;line-height:1;color:inherit;box-shadow:none}
  .picker button:hover{background:var(--hover);transform:scale(1.15)}
  /* На телефоне наведения нет — инструменты видно всегда. */
  @media(hover:none){.mtools{opacity:1}}
  .comp{border-top:1px solid var(--line);padding:9px 12px;background:var(--panel);flex:none}
  .comp .row{display:flex;gap:6px;align-items:flex-end}
  .comp textarea{min-height:34px;max-height:min(120px,28vh);border-radius:7px;min-width:0;
    overflow-y:auto}
  #send{flex:none}
  /* Значок самолётика — запасной вид кнопки для узкой рамки. Прячем
     его здесь, а не встроенным стилем: встроенный побеждает правило
     из медиазапроса, и на телефоне кнопка осталась бы пустой. */
  #send .ic{display:none}
  .icob{width:32px;height:32px;padding:0;display:inline-flex;align-items:center;
    justify-content:center;flex:none;background:var(--panel);border:1px solid var(--line2);
    border-radius:var(--r1);box-shadow:none;font-size:15px;line-height:1;color:var(--t2)}
  .icob:hover{background:var(--hover);border-color:var(--t3);color:var(--t1)}
  ${EMOJI_CSS}
  .tplbox{border:1px solid var(--line);border-radius:7px;margin-bottom:8px;background:var(--panel);
    max-height:min(170px,34vh);overflow-y:auto;overscroll-behavior:contain}
  .tplbox .qr{padding:8px 11px;cursor:pointer;border-bottom:1px solid var(--line);font-size:12px}
  .tplbox .qr:last-child{border-bottom:0}
  .tplbox .qr:hover{background:var(--hover)}
  .tplbox .qr b{color:var(--link);font-family:var(--mono);font-size:11px}
  .tplbox .qr .x{color:var(--t3)}
  .fileprev{display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--t2);
    background:var(--panel2);border-radius:var(--r1);padding:6px 9px;margin-bottom:8px}
  .fileprev .c{cursor:pointer;color:var(--t3);font-weight:700;margin-left:auto}

  /* Узкая рамка и телефон. Виджет в карточке Zoho на мобильном
     занимает всю ширину экрана, а кнопка «Отправить» со словом
     съедает половину строки — оставляем значок. */
  @media(max-width:420px){
    #msgs{padding:10px 8px}
    .m{max-width:88%;font-size:13px}
    .comp{padding:8px}
    .comp textarea{font-size:16px}
    #send .lbl{display:none}
    #send .ic{display:inline}
    #send{width:40px;padding:0;display:inline-flex;align-items:center;justify-content:center;
      font-size:15px}
    .wbar .sub{display:none}
  }
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
    <div class="replybar" id="rbar" style="display:none">
      <span class="t" id="rtext"></span><span class="c" id="rcancel">×</span>
    </div>
    <div class="fileprev" id="fprev" style="display:none">
      <span id="fname"></span><span class="c" id="fcancel">×</span>
    </div>
    <div class="tplbox" id="tplBox" style="display:none"></div>
    <div class="emobox" id="emoBox" style="display:none"></div>
    <div class="row">
      <input type="file" id="file" style="display:none">
      <button class="icob" id="clip" title="Прикрепить файл">📎</button>
      <button class="icob" id="emo" title="Смайлы">🙂</button>
      <button class="icob" id="tpl" title="Шаблоны ответов">⚡</button>
      <textarea id="txt" rows="1" placeholder="Ответ клиенту"></textarea>
      <button id="send"><span class="lbl">Отправить</span><span class="ic">➤</span></button>
    </div>
    <div class="err" id="sendErr"></div>
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

var NL = String.fromCharCode(10);
var MSGS = [];
var replyTo = null;
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
      loadTemplates();
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
    if (!QR.length) loadTemplates();
    clearInterval(timer);
    timer = setInterval(load, 5000);
  }).catch(function(){});
}

function load(){
  if (!CONV) return;
  api('/conversations/' + CONV + '/messages').then(function(d){
    var box = el('msgs');
    var atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 40;
    MSGS = d.messages || [];
    box.innerHTML = MSGS.map(function(m){
      var text = (m.content && m.content.text) || '';
      var att = (m.content && m.content.attachments) || [];
      if (att.length && !text) text = '📎 ' + (att[0].filename || 'вложение');
      else if (att.length) text = text + NL + '📎 ' + (att[0].filename || 'вложение');
      var when = new Date(m.sent_at);
      var hh = String(when.getHours()).padStart(2, '0') + ':' + String(when.getMinutes()).padStart(2, '0');
      var side = m.direction === 'in' ? 'in' : 'out';

      var quote = m.reply_to_text
        ? '<div class="quote"><b>' + (m.reply_to_direction === 'out' ? 'Вы' : 'Клиент') + '</b>' +
          esc(String(m.reply_to_text).slice(0, 120)) + '</div>'
        : '';

      var rx = (m.reactions || []).map(function(r){
        return '<span class="r">' + esc(r.emoji || r) + '</span>';
      }).join('');

      // Реакцию ставим только на сообщение клиента и только когда оно
      // уже дошло до провайдера: без внешнего идентификатора ставить
      // её не на что.
      var tools = '<div class="mtools">' +
        '<button data-reply="' + m.id + '">Ответить</button>' +
        (side === 'in' && m.external_id ? '<button data-rx="' + m.id + '">Реакция</button>' : '') +
        '</div>';

      return '<div class="mwrap ' + side + '">' +
        '<div class="m ' + side + '">' + quote + esc(text) +
        '<div class="meta">' + hh + (m.sender_type === 'bot' ? ' · бот' : '') + '</div></div>' +
        (rx ? '<div class="rx">' + rx + '</div>' : '') +
        tools +
        '</div>';
    }).join('');

    Array.prototype.forEach.call(box.querySelectorAll('[data-reply]'), function(b){
      b.onclick = function(){ setReply(b.dataset.reply) };
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-rx]'), function(b){
      b.onclick = function(ev){ ev.stopPropagation(); showPicker(b, b.dataset.rx) };
    });

    if (atBottom) box.scrollTop = box.scrollHeight;
  }).catch(function(){});
}

/* ── Шаблоны ──────────────────────────────────────────────────────
   Те же, что в рабочем месте: список приходит с сервера. Шаблон с
   файлом подставляет и файл — уходит ссылка на уже загруженный,
   а не новая копия. */
var QR = [];
var pending = null;

function loadTemplates(){
  api('/quick-replies').then(function(d){ QR = d.quickReplies || [] }).catch(function(){});
}

function showFile(){
  if (!pending){ el('fprev').style.display = 'none'; return }
  el('fprev').style.display = 'flex';
  el('fname').textContent = pending.name +
    (pending.size ? ' · ' + Math.round(pending.size / 1024) + ' КБ' : '');
}

el('fcancel').onclick = function(){ pending = null; showFile() };

el('clip').onclick = function(){ el('file').click() };
el('file').onchange = function(){
  var f = this.files && this.files[0];
  if (!f) return;
  if (f.size > 20 * 1024 * 1024){ el('sendErr').textContent = 'Файл больше 20 МБ'; return }
  pending = { file: f, name: f.name, size: f.size, type: f.type };
  el('sendErr').textContent = '';
  showFile();
};

el('emo').onclick = function(){
  var b = el('emoBox');
  if (b.style.display !== 'none'){ b.style.display = 'none'; return }
  el('tplBox').style.display = 'none';
  b.innerHTML = emoPanel();
  b.style.display = 'block';
  Array.prototype.forEach.call(b.querySelectorAll('[data-e]'), function(x){
    x.onclick = function(){ emoInsert(el('txt'), x.dataset.e) };
  });
};

el('tpl').onclick = function(){
  var b = el('tplBox');
  if (b.style.display !== 'none'){ b.style.display = 'none'; return }
  el('emoBox').style.display = 'none';
  if (!QR.length){
    b.innerHTML = '<div class="qr" style="cursor:default"><b>Шаблонов нет.</b> ' +
      '<span class="x">Заведите их в разделе «Шаблоны» в приложении.</span></div>';
    b.style.display = 'block';
    return;
  }
  b.innerHTML = QR.map(function(q, i){
    var n = (q.attachments || []).length;
    return '<div class="qr" data-i="' + i + '"><b>/' + esc(q.shortcut) + '</b> ' +
      (n ? '<span class="x">📎 ' + n + '</span> ' : '') +
      '<span class="x">' + esc(q.body) + '</span></div>';
  }).join('');
  b.style.display = 'block';
  Array.prototype.forEach.call(b.children, function(node){
    node.onclick = function(){
      var q = QR[Number(node.dataset.i)];
      if (!q) return;
      var ta = el('txt');
      ta.value = q.body;
      var f = (q.attachments || [])[0];
      pending = f ? { qr: { id: q.id, index: 0 }, name: f.filename || 'файл', size: f.size || 0 } : null;
      showFile();
      b.style.display = 'none';
      ta.focus();
    };
  });
};

/* ── Ответ на сообщение ──────────────────────────────────────────
   Цитата уходит как ссылка на внешний идентификатор сообщения:
   у провайдера свой номер, наш ему ни о чём не говорит. */
function setReply(id){
  var m = MSGS.filter(function(x){ return x.id === id })[0];
  if (!m || !m.external_id){
    el('sendErr').textContent = 'На это сообщение ответить нельзя: оно ещё не доставлено';
    return;
  }
  replyTo = {
    ext: m.external_id,
    mine: m.direction !== 'in',
    text: (m.content && m.content.text) || 'сообщение'
  };
  el('rbar').style.display = 'flex';
  el('rtext').textContent = (replyTo.mine ? 'Ответ на своё: ' : 'Ответ клиенту: ') +
    String(replyTo.text).slice(0, 80);
  el('txt').focus();
}

el('rcancel').onclick = function(){ replyTo = null; el('rbar').style.display = 'none' };

/**
 * Реакции.
 *
 * Набор не произвольный: Telegram принимает только фиксированный
 * список, всё остальное отклоняет с ошибкой. Здесь самые ходовые
 * из него — те же, что в рабочем месте.
 */
var RX = ['👍','👎','❤','🔥','🎉','😁','😢','🙏','👌','🤔'];

function showPicker(anchor, messageId){
  var old = document.querySelector('.picker');
  if (old) old.remove();

  var box = document.createElement('div');
  box.className = 'picker';
  box.innerHTML = RX.map(function(x){ return '<button data-e="' + x + '">' + x + '</button>' })
    .join('') + '<button data-e="">✖</button>';
  document.body.appendChild(box);

  var r = anchor.getBoundingClientRect();
  box.style.left = Math.max(6, Math.min(r.left, window.innerWidth - box.offsetWidth - 6)) + 'px';
  box.style.top = Math.max(6, r.top - box.offsetHeight - 6) + 'px';

  Array.prototype.forEach.call(box.children, function(btn){
    btn.onclick = function(){
      box.remove();
      api('/messages/' + messageId + '/reactions', {
        method: 'POST', body: { emoji: btn.dataset.e || null }
      }).then(function(){
        // Реакция уходит в очередь: в ленте появится, когда провайдер
        // подтвердит. Обновляем чуть позже, а не мгновенно.
        setTimeout(load, 900);
      }).catch(function(e){
        var p = (e && e.payload) || {};
        el('sendErr').textContent = p.error === 'message_not_delivered_yet'
          ? 'Сообщение ещё не доставлено' : 'Не удалось поставить реакцию';
      });
    };
  });

  setTimeout(function(){
    document.addEventListener('click', function once(){
      box.remove();
      document.removeEventListener('click', once);
    });
  }, 0);
}

/** Чтение файла в base64: тем же способом, что и в рабочем месте. */
function readAsBase64(file){
  return new Promise(function(resolve, reject){
    var r = new FileReader();
    r.onload = function(){
      var s = String(r.result || '');
      var i = s.indexOf('base64,');
      resolve(i >= 0 ? s.slice(i + 7) : '');
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function fileKind(mime, name){
  var m = String(mime || '');
  if (m.indexOf('image/') === 0) return 'image';
  if (m.indexOf('video/') === 0) return 'video';
  if (m.indexOf('audio/') === 0) return 'audio';
  return 'document';
}

el('send').onclick = function(){
  var ta = el('txt');
  var text = ta.value.trim();
  if ((!text && !pending) || !CONV) return;
  el('send').disabled = true;
  el('sendErr').textContent = '';

  var payload = { text: text };
  if (replyTo && replyTo.ext) payload.replyToExternalId = replyTo.ext;
  var prepared = Promise.resolve();

  if (pending && pending.qr) {
    payload.attachment = { fromQuickReply: pending.qr };
  } else if (pending) {
    prepared = readAsBase64(pending.file).then(function(b64){
      payload.attachment = {
        filename: pending.name,
        mime: pending.type || 'application/octet-stream',
        type: fileKind(pending.type, pending.name),
        dataBase64: b64
      };
    });
  }

  prepared
    .then(function(){ return api('/conversations/' + CONV + '/messages', { method:'POST', body: payload }) })
    .then(function(){
      ta.value = '';
      pending = null;
      replyTo = null;
      el('rbar').style.display = 'none';
      showFile();
      load();
    })
    .catch(function(e){
      var p = (e && e.payload) || {};
      el('sendErr').textContent = p.error === 'file_too_large' ? 'Файл больше 20 МБ'
        : p.reason || p.error || 'Не удалось отправить';
    })
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
