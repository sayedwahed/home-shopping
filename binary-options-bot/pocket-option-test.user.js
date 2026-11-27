// ==UserScript==
// @name         Pocket Demo Bot - Test / فحص شامل
// @namespace    https://example.local/pocket-demo-bot-test
// @version      1.1.0
// @description  فحص شامل لصفحة Pocket Option (ديمو) — يقرأ فقط ويبلّغ عن المشاكل، ولا يتداول أبداً: لا يضغط CALL/PUT، ولا يغيّر المبلغ، ولا يدخل أي صفقة. للتشخيص فقط.
// @match        https://pocketoption.com/*
// @match        https://*.pocketoption.com/*
// @match        https://m.pocketoption.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
/*
  ============================================================
  سكربت فحص شامل — يقرأ فقط، ولا يتداول أبداً
  ============================================================
  - لا يضغط أي زر CALL/PUT، ولا يغيّر المبلغ أو الزمن.
  - لا يقرأ أي كوكيز ولا أي بيانات دخول (لا SSID ولا توكن
    ولا كلمة سر)، ولا يرسل أي شيء إلى أي خادم.
  - يفحص 12 نقطة: الديمو، اسم الزوج، قراءة السعر من DOM،
    WebSocket (رسائل المنصة نفسها)، أزرار CALL/PUT (وجودها
    فقط، بلا ضغط)، حقل المبلغ، حقل الزمن، العائد، الرصيد،
    بناء شموع تجريبية، المؤشرات، ثم ملخص بكل الأخطاء.
  - كل فحص له ✅ / ❌ / ⚠️ وشرح عربي قصير.
  - الاستخدام: ثبّته في Tampermonkey، افتح صفحة التداول في
    Pocket Option، اضغط "▶ ابدأ الفحص" في اللوحة، وانتظر
    حوالي 3 دقائق (60 ثانية WebSocket + 75 ثانية شموع)،
    ثم صوّر اللوحة وأرسلها — الملخص في الأسفل يقول كل
    المشاكل في مكان واحد.
  - قيد معروف: خطاف WebSocket يُحقن عند document-idle،
    فإذا كان سوكيت الصفحة قد فُتح قبل الحقن فقد لا يرى
    رسائله حتى يعيد الاتصال — الفحص ينبّهك إلى ذلك.

  ============================================================
  v1.1.0 — تحليل Socket.IO + بنية الصفحة (نفس اكتشاف v1.2.2)
  ============================================================
  نتيجة الفحص على هاتف المستخدم (11:22): رسائل WebSocket
  كلها مصافحة Socket.IO (sid, upgrades, pingInterval,
  pingTimeout, maxPayload) — لا سعر فيها. لذلك:
  - فحص WebSocket أصبح 60 ثانية (بدل 30)، ويحلّل كل رسالة
    كـ Socket.IO: مصافحة "0{...}"، ping "2"، أحداث "42[...]"
    (وأسماء الأحداث مع عدّادها — أسماء فقط، بلا قيم).
  - فحص جديد: بنية الصفحة — طول النص والـ HTML، قائمة
    iframes (النطاق فقط) ومقروء/محظور، إطار أعلى أم iframe،
    وعدد Shadow roots — حتى نعرف إن كانت الواجهة كلها
    داخل iframe كروس-أوريجن.
  - بحث الأزرار موسّع: بالنص، ثم aria-label/title/role،
    ثم بلون الخلفية (أخضر = CALL، أحمر = PUT).
  - الفحص يأخذ الآن ~3 دقائق (60 ث WebSocket + 75 ث شموع).
*/

(function () {
  'use strict';

  // ---------- الحالة ----------
  var results = {};            // id -> {status: 'ok'|'bad'|'warn'|'run', text}
  var closes = [];             // إغلاقات الشموع التجريبية (15 ثانية)
  var curCandle = null;
  var wsMessagesSeen = 0, wsPriceSeen = null, wsPriceAt = 0, wsHooked = false;
  var wsSamples = [];          // عينات رسائل (مفاتيح فقط، بلا قيم)
  var testRunning = false, candleTimer = null, candleDone = false;
  var lastDomPrice = null;

  // ---------- دوال نقية (قابلة للاختبار) ----------
  function parsePriceText(text) {
    if (!text) return null;
    var t = String(text).replace(/,/g, '').replace(/[^\d.]/g, ' ').trim();
    var m = t.match(/\d+\.\d{2,5}/);
    if (!m) return null;
    var v = parseFloat(m[0]);
    if (!isFinite(v) || v < 0.01 || v > 200000) return null;
    return v;
  }
  function priceDecimals(v) {
    var s = String(v);
    return s.indexOf('.') === -1 ? 0 : s.split('.')[1].length;
  }
  var KNOWN_PAIRS = ['AUDCAD', 'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'EURJPY', 'GBPJPY', 'USDCAD', 'NZDUSD', 'USDCHF', 'EURGBP', 'AUDJPY', 'EURAUD', 'GBPAUD', 'NZDJPY', 'AUDNZD', 'EURCAD', 'GBPCAD', 'EURCHF', 'GBPCHF', 'BTCUSD', 'ETHUSD', 'XAUUSD', 'XAGUSD'];
  function pairFromText(t) {
    if (!t) return '';
    var m = String(t).match(/\b([A-Z]{3})\/([A-Z]{3})\b/);
    if (m) return m[1] + '/' + m[2];
    var m2 = String(t).match(/\b([A-Z]{3})-([A-Z]{3})\b/);
    if (m2) return m2[1] + '/' + m2[2];
    return '';
  }
  function ema(values, period) {
    if (!values || values.length < period) return null;
    var k = 2 / (period + 1), i;
    var r = values.slice(0, period).reduce(function (a, b) { return a + b; }, 0) / period;
    for (i = period; i < values.length; i++) r = values[i] * k + r * (1 - k);
    return r;
  }
  function rsi(values, period) {
    period = period || 14;
    if (!values || values.length < period + 1) return null;
    var g = 0, l = 0, i, c;
    for (i = 1; i <= period; i++) { c = values[i] - values[i - 1]; g += Math.max(c, 0); l += Math.max(-c, 0); }
    var ag = g / period, al = l / period;
    for (i = period + 1; i < values.length; i++) {
      c = values[i] - values[i - 1];
      ag = (ag * (period - 1) + Math.max(c, 0)) / period;
      al = (al * (period - 1) + Math.max(-c, 0)) / period;
    }
    return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  // بيانات اصطناعية حتمية للاختبار (تُستخدم فقط إن لم توجد شموع حية
  // كافية لحساب المؤشرات) — مشي عشوائي حول 1.0 ببذرة ثابتة.
  function syntheticCloses(n, start) {
    var out = [], x = start || 1.0, seed = 12345, i;
    for (i = 0; i < n; i++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      var r = (seed / 2147483648) - 0.5;
      x = x * (1 + r * 0.002);
      out.push(parseFloat(x.toFixed(5)));
    }
    return out;
  }

  // ---------- WebSocket: مفاتيح حساسة واستخراج السعر (مفاتيح فقط للتشخيص) ----------
  var WS_PRICE_KEYS = ['price', 'close', 'last', 'lastprice', 'last_price', 'bid', 'ask', 'rate', 'quote', 'value', 'currentprice', 'current_price', 'open', 'current', 'spot', 'mid'];
  var WS_SENSITIVE_KEYS = ['token', 'ssid', 'session', 'auth', 'password', 'passwd', 'cookie', 'secret', 'apikey', 'api_key', 'access_token', 'refresh_token', 'authorization'];
  function isSensitiveKey(k) {
    var lk = String(k).toLowerCase().replace(/[^a-z0-9_]/g, '');
    for (var i = 0; i < WS_SENSITIVE_KEYS.length; i++) {
      if (lk === WS_SENSITIVE_KEYS[i] || lk.indexOf(WS_SENSITIVE_KEYS[i]) !== -1) return true;
    }
    return false;
  }
  function normWsSymbol(s) {
    if (!s) return '';
    return String(s).toUpperCase().replace(/[^A-Z]/g, '').replace(/OTC$/, '');
  }
  function wsNum(v) {
    if (typeof v === 'number' && isFinite(v) && v > 0 && v < 200000) return v;
    if (typeof v === 'string') {
      var n = parseFloat(v.replace(/,/g, ''));
      if (isFinite(n) && n > 0 && n < 200000) return n;
    }
    return null;
  }
  function wsPlausiblePrice(v) {
    var n = wsNum(v);
    if (n === null || n < 0.1 || n > 200) return null;
    var dec = priceDecimals(n);
    if (dec < 3 || dec > 5) return null;
    return n;
  }
  function normalizeWsText(t) {
    var s = String(t).trim();
    var m = s.match(/^(\d+|a)([\[{][\s\S]*)$/);
    if (m) return m[2];
    return s;
  }
  // v1.1.0: أسماء أحداث Socket.IO التي تحمل سعراً.
  var PRICE_EVENT_NAMES = ['price', 'quote', 'quotes', 'tick', 'ticks', 'candle', 'candles', 'update', 'price_update', 'priceupdate', 'asset', 'assets', 'asset_update', 'chart', 'rate', 'rates', 'lastprice', 'liveprice', 'stream'];
  // v1.1.0: تحليل رسالة Socket.IO/Engine.IO — نفس منطق البوت v1.2.2.
  function parseSocketIoMessage(raw) {
    if (raw === null || raw === undefined) return { kind: 'unknown', event: '', payload: null };
    if (typeof raw !== 'string') return { kind: 'data', event: '', payload: raw };
    var s = String(raw).trim();
    if (s === '2') return { kind: 'ping', event: '', payload: null };
    if (s === '3') return { kind: 'pong', event: '', payload: null };
    if (s === '40') return { kind: 'connect', event: '', payload: null };
    if (s === '41') return { kind: 'disconnect', event: '', payload: null };
    if (s.charAt(0) === 'a' && s.charAt(1) === '[') {
      try {
        var arr0 = JSON.parse(s.slice(1));
        for (var i0 = 0; i0 < arr0.length; i0++) {
          if (typeof arr0[i0] === 'string') {
            var inner0 = parseSocketIoMessage(arr0[i0]);
            if (inner0.kind !== 'text' && inner0.kind !== 'unknown') return inner0;
          }
        }
      } catch (e) {}
      return { kind: 'data', event: '', payload: null };
    }
    var m = s.match(/^(\d+)([\[{][\s\S]*)$/);
    if (m) {
      var code = m[1], body = m[2], parsed = null;
      try { parsed = JSON.parse(body); } catch (e) { parsed = null; }
      if (code === '0') return { kind: 'handshake', event: '', payload: parsed };
      if (code === '40') return { kind: 'connect', event: '', payload: parsed };
      if (code === '41') return { kind: 'disconnect', event: '', payload: null };
      if (code === '42' || code === '2') {
        if (Array.isArray(parsed)) return { kind: 'event', event: (typeof parsed[0] === 'string' ? parsed[0] : ''), payload: parsed.length > 1 ? parsed[1] : null, data: parsed };
        return { kind: 'event', event: '', payload: parsed };
      }
      if (code === '43' || code === '3') return { kind: 'ack', event: '', payload: parsed };
      return { kind: 'data', event: '', payload: parsed };
    }
    if (s.charAt(0) === '{' || s.charAt(0) === '[') {
      try { return { kind: 'data', event: '', payload: JSON.parse(s) }; } catch (e) { return { kind: 'text', event: '', payload: null }; }
    }
    return { kind: 'text', event: '', payload: null };
  }
  function wsKeysOf(data, depth) {
    depth = depth || 0;
    var out = { keys: [], sensitive: false };
    if (typeof data === 'string') {
      var t = normalizeWsText(data);
      if (t && (t.charAt(0) === '{' || t.charAt(0) === '[')) {
        try { return wsKeysOf(JSON.parse(t), depth + 1); } catch (e) { return out; }
      }
      return out;
    }
    if (Array.isArray(data)) {
      for (var i = 0; i < data.length && i < 5; i++) {
        var sub = wsKeysOf(data[i], depth + 1);
        if (sub.sensitive) out.sensitive = true;
        for (var j = 0; j < sub.keys.length; j++) if (out.keys.indexOf(sub.keys[j]) === -1) out.keys.push(sub.keys[j]);
      }
      return out;
    }
    if (!data || typeof data !== 'object') return out;
    var keys = Object.keys(data);
    for (var k = 0; k < keys.length; k++) {
      if (isSensitiveKey(keys[k])) { out.sensitive = true; continue; }
      if (out.keys.indexOf(keys[k]) === -1) out.keys.push(keys[k]);
    }
    if (depth < 1) {
      for (var n = 0; n < keys.length; n++) {
        var child = data[keys[n]];
        if (child && typeof child === 'object') {
          var c = wsKeysOf(child, depth + 1);
          if (c.sensitive) out.sensitive = true;
          for (var m = 0; m < c.keys.length; m++) if (out.keys.indexOf(c.keys[m]) === -1) out.keys.push(c.keys[m]);
        }
      }
    }
    if (out.sensitive) out.keys = [];
    return out;
  }
  function extractWsPrice(data, asset6) {
    var target = normWsSymbol(asset6 || '');
    var found = null;
    function priceFromObj(obj, sym) {
      for (var i = 0; i < WS_PRICE_KEYS.length; i++) {
        var k = WS_PRICE_KEYS[i];
        if (obj[k] !== undefined) {
          var p = target ? wsNum(obj[k]) : wsPlausiblePrice(obj[k]);
          if (p !== null) return { price: p, asset: sym || target };
        }
      }
      return null;
    }
    function walk(node, ctxSym, depth) {
      if (found || depth > 6) return;
      if (typeof node === 'string') {
        // v1.1.0: Socket.IO أولاً — المصافحة و ping بلا سعر.
        var sio = parseSocketIoMessage(node);
        if (sio.kind === 'handshake' || sio.kind === 'ping' || sio.kind === 'pong' || sio.kind === 'connect' || sio.kind === 'disconnect') return;
        if (sio.kind === 'event') {
          var evName = String(sio.event || '').toLowerCase();
          if (PRICE_EVENT_NAMES.indexOf(evName) !== -1) {
            var psym = '';
            if (sio.payload && typeof sio.payload === 'object' && !Array.isArray(sio.payload)) {
              var sk2 = ['symbol', 'asset', 'pair', 'instrument', 'code', 'name', 'ticker'];
              for (var q2 = 0; q2 < sk2.length; q2++) {
                if (typeof sio.payload[sk2[q2]] === 'string') { psym = normWsSymbol(sio.payload[sk2[q2]]); break; }
              }
            }
            if (target && psym && psym !== target) return;
            if (target && psym === target) { walk(sio.payload, ctxSym, depth + 1); return; }
            var r2 = extractWsPrice(sio.payload, '');
            if (r2) { found = r2; return; }
            return;
          }
          if (sio.payload !== null && sio.payload !== undefined) { walk(sio.payload, ctxSym, depth + 1); return; }
          return;
        }
        if (sio.kind === 'data' && sio.payload !== null && typeof sio.payload === 'object') { walk(sio.payload, ctxSym, depth + 1); return; }
        var t = normalizeWsText(node);
        if (!target) {
          var bare = wsPlausiblePrice(t);
          if (bare !== null) { found = { price: bare, asset: '' }; return; }
        }
        if (t && (t.charAt(0) === '{' || t.charAt(0) === '[')) {
          try { walk(JSON.parse(t), ctxSym, depth + 1); } catch (e) { /* ليست JSON */ }
        }
        return;
      }
      if (Array.isArray(node)) {
        for (var i = 0; i < node.length; i++) walk(node[i], ctxSym, depth + 1);
        return;
      }
      if (!node || typeof node !== 'object') return;
      var sym = ctxSym || '';
      var sk = ['symbol', 'asset', 'pair', 'instrument', 'code', 'name', 'ticker'];
      for (var s = 0; s < sk.length; s++) {
        if (typeof node[sk[s]] === 'string') { sym = normWsSymbol(node[sk[s]]) || sym; break; }
      }
      var keys = Object.keys(node), k, pv;
      for (k = 0; k < keys.length; k++) {
        var nk = normWsSymbol(keys[k]);
        if (target && nk === target) {
          pv = wsNum(node[keys[k]]);
          if (pv !== null) { found = { price: pv, asset: target }; return; }
        } else if (!target && nk.length === 6) {
          pv = wsPlausiblePrice(node[keys[k]]);
          if (pv !== null) { found = { price: pv, asset: nk }; return; }
        }
      }
      if (!target || sym === target) {
        var r = priceFromObj(node, sym);
        if (r) { found = r; return; }
      }
      for (var j = 0; j < keys.length; j++) walk(node[keys[j]], sym, depth + 1);
    }
    try { walk(data, '', 0); } catch (e) { /* تجاهل */ }
    return found;
  }

  // ---------- قراءة من DOM (فحص فقط — بلا أي ضغط أو تغيير) ----------
  function bodyText() {
    try { return (document.body && (document.body.innerText || document.body.textContent)) || ''; } catch (e) { return ''; }
  }
  function isDemo() {
    var t = bodyText();
    return /Demo/i.test(t) || /ديمو|تجريبي/.test(t);
  }
  function readAssetName() {
    var found = '';
    try {
      found = pairFromText(document.title || '');
      if (!found) {
        var btns = document.querySelectorAll('button, [role="button"], a, [class*="asset"], [class*="symbol"], [class*="pair"]');
        for (var i = 0; i < btns.length && i < 300; i++) {
          var t = (btns[i].textContent || '').trim();
          if (t && t.length < 40) { found = pairFromText(t); if (found) break; }
        }
      }
      if (!found) {
        var metas = document.querySelectorAll('meta[property="og:title"], meta[name="description"], meta[name="title"]');
        for (var mi = 0; mi < metas.length; mi++) {
          found = pairFromText(metas[mi].getAttribute('content') || '');
          if (found) break;
        }
      }
      if (!found) found = pairFromText(bodyText());
      if (!found && typeof location !== 'undefined' && location) {
        var href = location.href || '';
        var um = href.match(/(?:asset|pair|symbol)[=\/]([A-Za-z]{3})[-_\/]?([A-Za-z]{3})/);
        if (um) found = um[1].toUpperCase() + '/' + um[2].toUpperCase();
        if (!found) {
          var p6 = href.match(/([A-Za-z]{6})(?:[?&#\/]|$)/);
          if (p6 && KNOWN_PAIRS.indexOf(p6[1].toUpperCase()) !== -1) {
            var p = p6[1].toUpperCase();
            found = p.slice(0, 3) + '/' + p.slice(3);
          }
        }
      }
    } catch (e) { /* تجاهل */ }
    return found || '';
  }
  // قراءة السعر من DOM بكل طرق البوت الرئيسي، مع التشخيص.
  // ترجع {price, method, top:[{value,score}], totalDecimals, svgTexts, shadowRoots, iframes, iframesOk}
  function readPriceDiag() {
    var diag = { price: null, method: '', top: [], totalDecimals: 0, svgTexts: 0, shadowRoots: 0, iframes: 0, iframesOk: 0 };
    var cand = {};
    function rec(val, score, src) {
      if (val === null || val === undefined) return;
      var v = typeof val === 'number' ? val : parseFloat(val);
      if (!isFinite(v) || v < 0.01 || v > 200000) return;
      var dec = priceDecimals(v);
      if (dec < 2 || dec > 5) return;
      var s = score || 0;
      if (dec === 5) s += 10; else if (dec === 4) s += 8; else if (dec === 3) s += 5; else s += 2;
      if (lastDomPrice && Math.abs(v - lastDomPrice) / lastDomPrice < 0.01) s += 12;
      var key = String(v);
      if (!cand[key] || s > cand[key].score) cand[key] = { value: v, score: s, source: src || '' };
    }
    function collect(text, src, extra) {
      if (!text) return 0;
      var m = String(text).match(/\d+\.\d{2,5}/g);
      if (!m) return 0;
      for (var i = 0; i < m.length; i++) rec(parseFloat(m[i]), extra || 0, src);
      return m.length;
    }
    var i, j, els, el, v;
    // عدّادات التشخيص تُحسب أولاً، حتى لو رجع السعر من مسار سريع
    // (محدد/مسح ورقي) قبل خطوات SVG و iframe و innerText.
    try { diag.svgTexts = document.querySelectorAll('svg text, svg tspan').length; } catch (e) { /* تجاهل */ }
    try { diag.iframes = document.querySelectorAll('iframe').length; } catch (e) { /* تجاهل */ }
    try { diag.totalDecimals = (bodyText().match(/\d+\.\d{3,5}/g) || []).length; } catch (e) { /* تجاهل */ }
    var selectors = [
      '[class*="price"] [class*="value"]', '[data-test*="price"]', '[data-testid*="price"]',
      '[class*="current-price"]', '[class*="currentPrice"]', '[class*="asset-price"]',
      '[class*="assetPrice"]', '[class*="chart-price"]', '[class*="chartPrice"]',
      '[class*="quote"]', '[class*="Quote"]', '[class*="last-price"]', '[class*="lastPrice"]',
      '[class*="price-value"]', '[class*="priceValue"]', '[class*="ticker-price"]',
      '[class*="Price"] [class*="value"]', '[class*="price"]'
    ];
    for (i = 0; i < selectors.length; i++) {
      try { els = document.querySelectorAll(selectors[i]); } catch (e) { continue; }
      for (j = 0; j < els.length; j++) {
        el = els[j];
        if (!el.textContent || el.textContent.length > 30) continue;
        v = parsePriceText(el.textContent);
        if (v) { diag.price = v; diag.method = 'محدد ' + selectors[i]; lastDomPrice = v; return finish(); }
      }
    }
    try {
      els = document.querySelectorAll('[data-price], [data-current-price], [data-last-price], [data-value]');
      for (i = 0; i < els.length; i++) {
        var attr = els[i].getAttribute('data-price') || els[i].getAttribute('data-current-price')
          || els[i].getAttribute('data-last-price') || els[i].getAttribute('data-value');
        v = parsePriceText(attr);
        if (v) { diag.price = v; diag.method = 'خاصية data-price'; lastDomPrice = v; return finish(); }
      }
    } catch (e) { /* تجاهل */ }
    // مسح العناصر الورقية (نص رقم عشري فقط)
    var best = null, bestScore = -1;
    function scanRoot(root) {
      var nodes;
      try { nodes = root.querySelectorAll('*'); } catch (e) { return; }
      for (var k = 0; k < nodes.length; k++) {
        var n = nodes[k];
        if (n.children && n.children.length > 0) continue;
        var txt = (n.textContent || '').trim();
        if (!txt || txt.length > 20 || /[$%€£]/.test(txt) || /USD|Demo|ديمو/.test(txt)) continue;
        if (!/^\d+\.\d{3,5}$/.test(txt)) continue;
        var val = parseFloat(txt);
        if (!isFinite(val) || val < 0.01 || val > 200000) continue;
        var sc = 0, dec = priceDecimals(val);
        if (dec === 5) sc += 10; else if (dec === 4) sc += 8; else sc += 5;
        if (lastDomPrice && Math.abs(val - lastDomPrice) / lastDomPrice < 0.01) sc += 12;
        rec(val, sc, 'عنصر ورقي');
        if (sc > bestScore) { bestScore = sc; best = val; }
      }
    }
    scanRoot(document.body || document.documentElement);
    if (best !== null && bestScore >= 8) { diag.price = best; diag.method = 'مسح الصفحة'; lastDomPrice = best; return finish(); }
    try {
      var svgEls = document.querySelectorAll('svg text, svg tspan');
      diag.svgTexts = svgEls.length;
      for (i = 0; i < svgEls.length; i++) collect((svgEls[i].textContent || '').trim(), 'SVG', 3);
    } catch (e) { /* تجاهل */ }
    try {
      var queue = [document.body || document.documentElement], seen = 0;
      while (queue.length && seen < 2000) {
        var node = queue.shift();
        if (!node) continue;
        if (node.shadowRoot) { diag.shadowRoots++; queue.push(node.shadowRoot); }
        var kids = node.children;
        if (kids) for (var ci = 0; ci < kids.length; ci++) queue.push(kids[ci]);
        seen++;
      }
    } catch (e) { /* تجاهل */ }
    try {
      var frames = document.querySelectorAll('iframe');
      diag.iframes = frames.length;
      for (i = 0; i < frames.length; i++) {
        try {
          var fdoc = frames[i].contentDocument || (frames[i].contentWindow && frames[i].contentWindow.document);
          if (!fdoc || !fdoc.body) continue;
          diag.iframesOk++;
          collect(fdoc.body.innerText || fdoc.body.textContent || '', 'iframe', 3);
        } catch (e2) { /* كروس-أوريجن */ }
      }
    } catch (e) { /* تجاهل */ }
    try {
      var allNums = (bodyText().match(/\d+\.\d{3,5}/g) || []);
      diag.totalDecimals = allNums.length;
      collect(bodyText(), 'innerText', 0);
    } catch (e) { /* تجاهل */ }
    function finish() {
      var arr = [], k;
      for (k in cand) arr.push(cand[k]);
      arr.sort(function (a, b) { return b.score - a.score; });
      diag.top = arr.slice(0, 3);
      if (!diag.price && diag.top.length && diag.top[0].score >= 8) {
        diag.price = diag.top[0].value;
        diag.method = diag.top[0].source || 'مسح innerText';
        lastDomPrice = diag.price;
      }
      return diag;
    }
    return finish();
  }
  // زر موجود؟ (قراءة فقط — بلا أي ضغط). ترجع نص الزر أو ''.
  function findButtonText(label) {
    try {
      var btns = document.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        if (!b.offsetParent) continue;
        if (new RegExp(label, 'i').test(b.textContent || '')) return (b.textContent || '').trim().slice(0, 30);
      }
    } catch (e) { /* تجاهل */ }
    return '';
  }
  function readAmount() {
    // 1) حقول إدخال رقمية في الصفحة
    try {
      var inputs = document.querySelectorAll('input');
      var cands = [];
      for (var i = 0; i < inputs.length; i++) {
        var inp = inputs[i];
        var val = (inp.value || '').trim();
        if (!val || !/^\d+(\.\d{1,2})?$/.test(val)) continue;
        var n = parseFloat(val);
        if (!isFinite(n) || n <= 0 || n > 1000000) continue;
        cands.push({ value: val, method: 'حقل إدخال' });
      }
      if (cands.length) return cands[0];
    } catch (e) { /* تجاهل */ }
    // 2) نص قريب من كلمة المبلغ/Amount في الصفحة
    try {
      var t = bodyText();
      var m = t.match(/(?:المبلغ|Amount|مبلغ)[^\d$]{0,20}\$?\s*([\d,]+\.?\d*)/i);
      if (m) return { value: m[1], method: 'نص قريب من "المبلغ"' };
    } catch (e) { /* تجاهل */ }
    return null;
  }
  function readTime() {
    try {
      var inputs = document.querySelectorAll('input');
      for (var i = 0; i < inputs.length; i++) {
        var val = (inputs[i].value || '').trim();
        if (/^\d{2}:\d{2}(:\d{2})?$/.test(val)) return { value: val, method: 'حقل إدخال' };
      }
      var t = bodyText();
      var m = t.match(/\b(\d{2}:\d{2}:\d{2})\b/);
      if (m) return { value: m[1], method: 'نص في الصفحة' };
      var m2 = t.match(/(?:الزمن|الوقت|Time|المدة)[^\d]{0,20}(\d{1,2}:\d{2})/i);
      if (m2) return { value: m2[1], method: 'نص قريب من "الزمن"' };
    } catch (e) { /* تجاهل */ }
    return null;
  }
  function readPayoutAll() {
    try {
      var t = bodyText();
      var m = t.match(/(\d{1,3})\s*%/g) || [];
      var out = [];
      for (var i = 0; i < m.length && out.length < 3; i++) {
        var v = m[i].replace(/\s/g, '');
        if (out.indexOf(v) === -1) out.push(v);
      }
      return out;
    } catch (e) { return []; }
  }
  function readBalance() {
    try {
      var t = bodyText();
      var m = t.match(/\$\s*([\d,]+\.\d{2})/);
      if (m) return { value: '$' + m[1], method: 'علامة $ في الصفحة' };
      var m2 = t.match(/([\d,]{4,}\.\d{2})/);
      if (m2) return { value: m2[1], method: 'رقم كبير في الصفحة' };
    } catch (e) { /* تجاهل */ }
    return null;
  }

  // ---------- خطاف WebSocket للفحص (يستمع فقط — لا يرسل شيئاً) ----------
  // يحقن دالة في سياق الصفحة تغلّف WebSocket (المنشئ + addEventListener
  // + onmessage)، وتفحص كل رسالة واردة من سوكيت المنصة نفسها.
  // تنشر السعر (إن وُجد) في عنصر DOM مخفي #muse-test-po-price
  // وعينات الرسائل (مفاتيح فقط، بلا قيم، والمفاتيح الحساسة مخفية
  // تماماً) في #muse-test-ws-samples. لا كوكيز، لا بيانات دخول،
  // لا إرسال لأي خادم — استماع فقط لرسائل تتدفق أصلاً في المتصفح.
  function wsTestHookPageFn() {
    try {
      var BRIDGE_ID = 'muse-test-po-price';
      var SAMPLES_ID = 'muse-test-ws-samples';
      var PRICE_KEYS = ['price', 'close', 'last', 'lastprice', 'last_price', 'bid', 'ask', 'rate', 'quote', 'value', 'currentprice', 'current_price', 'open', 'current', 'spot', 'mid'];
      var SENS = ['token', 'ssid', 'session', 'auth', 'password', 'passwd', 'cookie', 'secret', 'apikey', 'api_key', 'access_token', 'refresh_token', 'authorization'];
      function isSens(k) {
        var lk = String(k).toLowerCase().replace(/[^a-z0-9_]/g, '');
        for (var i = 0; i < SENS.length; i++) if (lk === SENS[i] || lk.indexOf(SENS[i]) !== -1) return true;
        return false;
      }
      function normSym(s) { try { return String(s).toUpperCase().replace(/[^A-Z]/g, '').replace(/OTC$/, ''); } catch (e) { return ''; } }
      function numVal(v) {
        if (typeof v === 'number' && isFinite(v) && v > 0 && v < 200000) return v;
        if (typeof v === 'string') { var n = parseFloat(v.replace(/,/g, '')); if (isFinite(n) && n > 0 && n < 200000) return n; }
        return null;
      }
      function plausible(v) {
        var n = numVal(v);
        if (n === null || n < 0.1 || n > 200) return null;
        var d = String(n).split('.')[1];
        var dec = d ? d.length : 0;
        if (dec < 3 || dec > 5) return null;
        return n;
      }
      function normText(t) {
        var s = String(t).trim();
        var m = s.match(/^(\d+|a)([\[{][\s\S]*)$/);
        return m ? m[2] : s;
      }
      // v1.1.0: نسخة مستقلة من parseSocketIoMessage داخل سياق الصفحة.
      var PRICE_EVENTS = ['price', 'quote', 'quotes', 'tick', 'ticks', 'candle', 'candles', 'update', 'price_update', 'priceupdate', 'asset', 'assets', 'asset_update', 'chart', 'rate', 'rates', 'lastprice', 'liveprice', 'stream'];
      function parseSio(raw) {
        if (raw === null || raw === undefined) return { kind: 'unknown', event: '', payload: null };
        if (typeof raw !== 'string') return { kind: 'data', event: '', payload: raw };
        var s = String(raw).trim();
        if (s === '2') return { kind: 'ping', event: '', payload: null };
        if (s === '3') return { kind: 'pong', event: '', payload: null };
        if (s === '40') return { kind: 'connect', event: '', payload: null };
        if (s === '41') return { kind: 'disconnect', event: '', payload: null };
        if (s.charAt(0) === 'a' && s.charAt(1) === '[') {
          try {
            var arr0 = JSON.parse(s.slice(1));
            for (var i0 = 0; i0 < arr0.length; i0++) {
              if (typeof arr0[i0] === 'string') { var inner0 = parseSio(arr0[i0]); if (inner0.kind !== 'text' && inner0.kind !== 'unknown') return inner0; }
            }
          } catch (e) {}
          return { kind: 'data', event: '', payload: null };
        }
        var m = s.match(/^(\d+)([\[{][\s\S]*)$/);
        if (m) {
          var code = m[1], body = m[2], parsed = null;
          try { parsed = JSON.parse(body); } catch (e) { parsed = null; }
          if (code === '0') return { kind: 'handshake', event: '', payload: parsed };
          if (code === '40') return { kind: 'connect', event: '', payload: parsed };
          if (code === '41') return { kind: 'disconnect', event: '', payload: null };
          if (code === '42' || code === '2') {
            if (Array.isArray(parsed)) return { kind: 'event', event: (typeof parsed[0] === 'string' ? parsed[0] : ''), payload: parsed.length > 1 ? parsed[1] : null, data: parsed };
            return { kind: 'event', event: '', payload: parsed };
          }
          if (code === '43' || code === '3') return { kind: 'ack', event: '', payload: parsed };
          return { kind: 'data', event: '', payload: parsed };
        }
        if (s.charAt(0) === '{' || s.charAt(0) === '[') { try { return { kind: 'data', event: '', payload: JSON.parse(s) }; } catch (e) { return { kind: 'text', event: '', payload: null }; } }
        return { kind: 'text', event: '', payload: null };
      }
      var ioEvents = { handshake: 0, ping: 0, pong: 0, connect: 0, total42: 0, events: {} };
      function keysOf(data, depth) {
        depth = depth || 0;
        var out = { keys: [], sensitive: false };
        if (typeof data === 'string') {
          var t = normText(data);
          if (t && (t.charAt(0) === '{' || t.charAt(0) === '[')) {
            try { return keysOf(JSON.parse(t), depth + 1); } catch (e) { return out; }
          }
          return out;
        }
        if (Array.isArray(data)) {
          for (var i = 0; i < data.length && i < 5; i++) {
            var sub = keysOf(data[i], depth + 1);
            if (sub.sensitive) out.sensitive = true;
            for (var j = 0; j < sub.keys.length; j++) if (out.keys.indexOf(sub.keys[j]) === -1) out.keys.push(sub.keys[j]);
          }
          return out;
        }
        if (!data || typeof data !== 'object') return out;
        var keys = Object.keys(data);
        for (var k = 0; k < keys.length; k++) {
          if (isSens(keys[k])) { out.sensitive = true; continue; }
          if (out.keys.indexOf(keys[k]) === -1) out.keys.push(keys[k]);
        }
        if (depth < 1) {
          for (var n = 0; n < keys.length; n++) {
            var child = data[keys[n]];
            if (child && typeof child === 'object') {
              var c = keysOf(child, depth + 1);
              if (c.sensitive) out.sensitive = true;
              for (var m = 0; m < c.keys.length; m++) if (out.keys.indexOf(c.keys[m]) === -1) out.keys.push(c.keys[m]);
            }
          }
        }
        if (out.sensitive) out.keys = [];
        return out;
      }
      function pairFromText(t) {
        if (!t) return '';
        var m = String(t).match(/\b([A-Z]{3})\/([A-Z]{3})\b/);
        if (m) return m[1] + m[2];
        var m2 = String(t).match(/\b([A-Z]{3})-([A-Z]{3})\b/);
        return m2 ? m2[1] + m2[2] : '';
      }
      var assetCache = '', assetCacheAt = 0;
      function assetNow() {
        try {
          var now = Date.now();
          if (assetCache && now - assetCacheAt < 60000) return assetCache;
          if (!assetCache && assetCacheAt && now - assetCacheAt < 5000) return '';
          var found = pairFromText(document.title || '');
          if (!found) {
            var btns = document.querySelectorAll('button, [role="button"], a, [class*="asset"], [class*="symbol"], [class*="pair"]');
            for (var i = 0; i < btns.length && i < 300; i++) {
              var bt = (btns[i].textContent || '').trim();
              if (bt && bt.length < 40) { found = pairFromText(bt); if (found) break; }
            }
          }
          if (!found) found = pairFromText((document.body && (document.body.innerText || document.body.textContent)) || '');
          assetCache = found || ''; assetCacheAt = now;
          return assetCache;
        } catch (e) { return ''; }
      }
      function extractPrice(data, asset6) {
        var target = normSym(asset6 || ''), found = null;
        function fromObj(obj, sym) {
          for (var i = 0; i < PRICE_KEYS.length; i++) {
            var k = PRICE_KEYS[i];
            if (obj[k] !== undefined) {
              var p = target ? numVal(obj[k]) : plausible(obj[k]);
              if (p !== null) return { price: p, asset: sym || target };
            }
          }
          return null;
        }
        function walk(node, ctxSym, depth) {
          if (found || depth > 6) return;
          if (typeof node === 'string') {
            var t = normText(node);
            if (!target) { var bare = plausible(t); if (bare !== null) { found = { price: bare, asset: '' }; return; } }
            if (t && (t.charAt(0) === '{' || t.charAt(0) === '[')) {
              try { walk(JSON.parse(t), ctxSym, depth + 1); } catch (e) { /* ليست JSON */ }
            }
            return;
          }
          if (Array.isArray(node)) { for (var i = 0; i < node.length; i++) walk(node[i], ctxSym, depth + 1); return; }
          if (!node || typeof node !== 'object') return;
          var sym = ctxSym || '';
          var sk = ['symbol', 'asset', 'pair', 'instrument', 'code', 'name', 'ticker'];
          for (var s = 0; s < sk.length; s++) {
            if (typeof node[sk[s]] === 'string') { sym = normSym(node[sk[s]]) || sym; break; }
          }
          var keys = Object.keys(node), k, pv;
          for (k = 0; k < keys.length; k++) {
            var nk = normSym(keys[k]);
            if (target && nk === target) {
              pv = numVal(node[keys[k]]);
              if (pv !== null) { found = { price: pv, asset: target }; return; }
            } else if (!target && nk.length === 6) {
              pv = plausible(node[keys[k]]);
              if (pv !== null) { found = { price: pv, asset: nk }; return; }
            }
          }
          if (!target || sym === target) { var r = fromObj(node, sym); if (r) { found = r; return; } }
          for (var j = 0; j < keys.length; j++) walk(node[keys[j]], sym, depth + 1);
        }
        try { walk(data, '', 0); } catch (e) { /* تجاهل */ }
        return found;
      }
      var msgs = 0;
      function publish(data) {
        try {
          msgs++;
          // v1.1.0: عدّاد أحداث Socket.IO (أسماء فقط، بلا قيم).
          try {
            var sio = parseSio(data);
            if (sio.kind === 'handshake') ioEvents.handshake++;
            else if (sio.kind === 'ping') ioEvents.ping++;
            else if (sio.kind === 'pong') ioEvents.pong++;
            else if (sio.kind === 'connect') ioEvents.connect++;
            else if (sio.kind === 'event') {
              ioEvents.total42++;
              var evn = String(sio.event || '(بلا اسم)');
              ioEvents.events[evn] = (ioEvents.events[evn] || 0) + 1;
            }
            var bb = document.getElementById(BRIDGE_ID);
            if (bb) { try { bb.setAttribute('data-io-events', JSON.stringify(ioEvents)); } catch (e2) {} }
          } catch (e3) {}
          var asset = assetNow();
          var r = extractPrice(data, asset);
          var b = document.getElementById(BRIDGE_ID);
          if (!b) {
            b = document.createElement('div');
            b.id = BRIDGE_ID; b.style.display = 'none';
            document.documentElement.appendChild(b);
          }
          b.setAttribute('data-msgs', String(msgs));
          if (r) {
            b.setAttribute('data-price', String(r.price));
            b.setAttribute('data-asset', r.asset || asset || '');
            b.setAttribute('data-time', String(Date.now()));
          }
          var sEl = document.getElementById(SAMPLES_ID);
          if (!sEl) {
            sEl = document.createElement('div');
            sEl.id = SAMPLES_ID; sEl.style.display = 'none';
            document.documentElement.appendChild(sEl);
          }
          var cur = [];
          try { cur = JSON.parse(sEl.getAttribute('data-samples') || '[]'); } catch (e) { cur = []; }
          if (cur.length < 3) {
            var k = keysOf(data, 0);
            cur.push({ keys: k.keys, sensitive: k.sensitive, price: r ? r.price : null });
            sEl.setAttribute('data-samples', JSON.stringify(cur));
          }
        } catch (e) { /* تجاهل */ }
      }
      function wrapListener(fn) {
        if (!fn || fn.__poTestWrapped) return fn;
        function wrapped(ev) {
          try { publish(ev && ev.data !== undefined ? ev.data : ev); } catch (e) { /* تجاهل */ }
          return fn.apply(this, arguments);
        }
        wrapped.__poTestWrapped = true;
        return wrapped;
      }
      try {
        var OrigWS = window.WebSocket;
        if (OrigWS && !OrigWS.__poTestWrapped) {
          var WrappedWS = function (url, protocols) {
            var ws = protocols ? new OrigWS(url, protocols) : new OrigWS(url);
            try {
              ws.addEventListener('message', function (ev) { try { publish(ev.data); } catch (e) { /* تجاهل */ } });
            } catch (e) { /* تجاهل */ }
            return ws;
          };
          WrappedWS.prototype = OrigWS.prototype;
          WrappedWS.__poTestWrapped = true;
          window.WebSocket = WrappedWS;
        }
        var proto = (OrigWS && OrigWS.prototype) || window.WebSocket.prototype;
        if (proto && proto.addEventListener && !proto.addEventListener.__poTestWrapped) {
          var origAdd = proto.addEventListener;
          proto.addEventListener = function (type, fn) {
            if (type === 'message') fn = wrapListener(fn);
            return origAdd.apply(this, arguments);
          };
          proto.addEventListener.__poTestWrapped = true;
        }
        try {
          var desc = Object.getOwnPropertyDescriptor(proto, 'onmessage');
          if (desc && desc.set && !desc.set.__poTestWrapped) {
            var origSet = desc.set;
            var newSet = function (fn) { return origSet.call(this, fn ? wrapListener(fn) : fn); };
            newSet.__poTestWrapped = true;
            Object.defineProperty(proto, 'onmessage', { set: newSet, get: desc.get, configurable: true });
          }
        } catch (e) { /* تجاهل */ }
        window.__poTestHookInstalled = true;
      } catch (e) { /* تجاهل */ }
    } catch (e) { /* تجاهل */ }
  }
  function injectWsHook() {
    if (wsHooked) return true;
    try {
      var doc = document;
      if (!doc.getElementById('muse-test-po-price')) {
        var bridge = doc.createElement('div');
        bridge.id = 'muse-test-po-price';
        bridge.style.display = 'none';
        (doc.documentElement || doc.body).appendChild(bridge);
      }
      var s = doc.createElement('script');
      s.textContent = '(' + wsTestHookPageFn.toString() + ')();';
      (doc.head || doc.documentElement).appendChild(s);
      if (s.parentNode) s.parentNode.removeChild(s);
      wsHooked = true;
      return true;
    } catch (e) { return false; }
  }
  function readWsBridge() {
    var out = { msgs: 0, price: null, asset: '', time: 0, samples: [], ioEvents: { handshake: 0, ping: 0, pong: 0, connect: 0, total42: 0, events: {} } };
    try {
      var b = document.getElementById('muse-test-po-price');
      if (b) {
        out.msgs = parseInt(b.getAttribute('data-msgs') || '0', 10) || 0;
        var pv = parsePriceText(b.getAttribute('data-price') || '');
        var t = parseInt(b.getAttribute('data-time') || '0', 10) || 0;
        if (pv !== null && t && Date.now() - t < 15000) { out.price = pv; out.time = t; }
        out.asset = b.getAttribute('data-asset') || '';
      }
      var sEl = document.getElementById('muse-test-ws-samples');
      if (sEl) {
        try { out.samples = JSON.parse(sEl.getAttribute('data-samples') || '[]'); } catch (e) { out.samples = []; }
      }
      if (b) {
        var ioEv = b.getAttribute('data-io-events') || '';
        if (ioEv) {
          try { var parsedIo = JSON.parse(ioEv); if (parsedIo && typeof parsedIo === 'object') out.ioEvents = parsedIo; } catch (e) {}
        }
      }
      if (typeof window !== 'undefined' && window.__poPrice && window.__poPrice.price) {
        var wp = window.__poPrice;
        if (wp.time && Date.now() - wp.time < 15000 && out.price === null) { out.price = wp.price; out.time = wp.time; }
      }
    } catch (e) { /* تجاهل */ }
    wsMessagesSeen = out.msgs;
    if (out.price !== null) { wsPriceSeen = out.price; wsPriceAt = out.time; }
    if (out.samples && out.samples.length) wsSamples = out.samples;
    return out;
  }

  // v1.1.0: بنية الصفحة — طول النص والـ HTML، قائمة iframes
  // (النطاق فقط، بلا أي جزء من الرابط قد يحمل توكن)، وهل كل
  // iframe مقروء (نفس النطاق) أم كروس-أوريجن (محظور)، وهل نحن
  // في الإطار الأعلى، وعدد Shadow roots.
  function docStructureDiag() {
    var out = { innerTextLen: 0, htmlLen: 0, iframes: [], isTop: true, shadowRoots: 0 };
    try { out.innerTextLen = ((document.body && (document.body.innerText || '')) || '').length; } catch (e) {}
    try { out.htmlLen = (document.documentElement && document.documentElement.outerHTML || '').length; } catch (e) {}
    try { out.isTop = (window.top === window.self); } catch (e) { out.isTop = false; }
    try {
      var fr = document.querySelectorAll('iframe');
      for (var i = 0; i < fr.length; i++) {
        var host = '';
        try { host = new URL(fr[i].src || '', location.href).host || ''; } catch (e2) { host = (fr[i].src || '').slice(0, 40); }
        var readable = false;
        try { var d = fr[i].contentDocument; if (d && d.body) readable = true; } catch (e3) { readable = false; }
        out.iframes.push({ host: host, readable: readable });
      }
    } catch (e) {}
    try {
      var q = [document.body || document.documentElement], seen = 0;
      while (q.length && seen < 2000) {
        var n = q.shift();
        if (!n) continue;
        if (n.shadowRoot) out.shadowRoots++;
        var k = n.children;
        if (k) for (var c = 0; c < k.length; c++) q.push(k[c]);
        seen++;
      }
    } catch (e) {}
    return out;
  }
  // v1.1.0: بحث موسّع عن زر — بالنص، ثم aria-label/title/role،
  // ثم بلون الخلفية (أخضر = CALL، أحمر = PUT). ترجع {text, method}.
  function findButtonInfo(label) {
    var re = new RegExp(label, 'i');
    try {
      var btns = document.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        if (!b.offsetParent) continue;
        if (re.test(b.textContent || '')) return { text: (b.textContent || '').trim().slice(0, 30), method: 'نص الزر' };
      }
      var els = document.querySelectorAll('[aria-label], [title], [role="button"]');
      for (var j = 0; j < els.length; j++) {
        var el = els[j];
        var txt = (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '') + ' ' + (el.textContent || '');
        if (el.offsetParent && re.test(txt)) return { text: txt.trim().slice(0, 30), method: 'aria-label/title' };
      }
      var wantGreen = /Call/i.test(label);
      for (var k = 0; k < btns.length; k++) {
        var bb = btns[k];
        if (!bb.offsetParent) continue;
        try {
          var cs = getComputedStyle(bb);
          var bg = (cs && cs.backgroundColor) || '';
          var m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          if (m) {
            var r = +m[1], g = +m[2], bl = +m[3];
            if (wantGreen && g > 120 && r < 120 && g > r + 40) return { text: (bb.textContent || '').trim().slice(0, 30) || 'زر أخضر', method: 'لون أخضر' };
            if (!wantGreen && r > 150 && g < 120 && r > g + 40) return { text: (bb.textContent || '').trim().slice(0, 30) || 'زر أحمر', method: 'لون أحمر' };
          }
        } catch (e) {}
      }
    } catch (e) { /* تجاهل */ }
    return { text: '', method: '' };
  }

  // ---------- اللوحة والفحوصات ----------
  var CHECKS = [
    { id: 'demo', name: '1. الحساب ديمو؟' },
    { id: 'asset', name: '2. اسم الزوج الحالي' },
    { id: 'domprice', name: '3. قراءة السعر من DOM' },
    { id: 'ws', name: '4. WebSocket (رسائل المنصة)' },
    { id: 'buttons', name: '5. أزرار CALL / PUT (وجودها فقط)' },
    { id: 'amount', name: '6. حقل المبلغ' },
    { id: 'time', name: '7. حقل الزمن' },
    { id: 'payout', name: '8. العائد %' },
    { id: 'balance', name: '9. الرصيد' },
    { id: 'candles', name: '10. بناء شموع تجريبية' },
    { id: 'indicators', name: '11. المؤشرات (EMA / RSI)' },
    { id: 'docstruct', name: '13. بنية الصفحة / iframes' },
    { id: 'sio', name: '14. أحداث Socket.IO' },
    { id: 'summary', name: '15. ملخص المشاكل' }
  ];
  function iconFor(status) {
    if (status === 'ok') return '✅';
    if (status === 'bad') return '❌';
    if (status === 'warn') return '⚠️';
    return '⏳';
  }
  function setRow(id, status, text) {
    results[id] = { status: status, text: text };
    var el = document.getElementById('muse-test-row-' + id);
    if (el) {
      el.style.color = status === 'bad' ? '#ff8a80' : status === 'warn' ? '#ffd54f' : status === 'ok' ? '#a5d6a7' : '#ccc';
      el.textContent = iconFor(status) + ' ' + text;
    }
  }
  function logTest(msg) {
    var el = document.getElementById('muse-test-log');
    if (el) el.textContent = new Date().toLocaleTimeString() + ' | ' + msg + '\n' + el.textContent.slice(0, 3000);
    console.log('[PocketTest]', msg);
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // مصدر سعر حي خفيف للشموع: WebSocket أولاً، ثم DOM كامل كل 5 ثوانٍ.
  var tickCount = 0;
  function getLivePrice() {
    tickCount++;
    var ws = readWsBridge();
    if (ws.price !== null) return { price: ws.price, source: 'WebSocket المنصة' };
    if (tickCount % 5 === 1) {
      var d = readPriceDiag();
      if (d.price !== null) return { price: d.price, source: 'DOM (' + d.method + ')' };
    }
    return null;
  }

  async function runTests() {
    if (testRunning) return;
    testRunning = true;
    var btn = document.getElementById('muse-test-start');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ جاري الفحص...'; }
    closes = []; curCandle = null; candleDone = false; wsSamples = []; wsPriceSeen = null;
    CHECKS.forEach(function (c) { setRow(c.id, 'run', c.name + ' — جاري...'); });
    logTest('بدأ الفحص الشامل — قراءة فقط، بلا أي تداول أو ضغط أزرار.');

    // 1) الديمو
    try {
      if (isDemo()) setRow('demo', 'ok', 'الحساب ديمو ✅ — كلمة Demo موجودة في الصفحة.');
      else setRow('demo', 'bad', 'مش ديمو! — كلمة Demo مش موجودة في الصفحة. بدّل للديمو قبل أي تجربة.');
    } catch (e) { setRow('demo', 'bad', 'تعذّر فحص الديمو: ' + e.message); }

    // 2) اسم الزوج
    var asset = '';
    try {
      asset = readAssetName();
      if (asset) setRow('asset', 'ok', 'الزوج الحالي: ' + asset);
      else setRow('asset', 'bad', 'اسم الزوج غير معروف — السكربت مش لاقي AUD/CAD ولا أي زوج في العنوان أو الأزرار أو نص الصفحة.');
    } catch (e) { setRow('asset', 'bad', 'تعذّر قراءة اسم الزوج: ' + e.message); }

    // 3) السعر من DOM
    var dom = null;
    try {
      dom = readPriceDiag();
      if (dom.price !== null) {
        setRow('domprice', 'ok', 'السعر من DOM: ' + dom.price + ' (' + dom.method + ') — المرشحات: ' + (dom.top.map(function (c) { return c.value + ' (' + c.score + ')'; }).join('، ') || 'لا مرشحات'));
      } else {
        setRow('domprice', 'bad', 'لا يوجد سعر في DOM — المرشحات: ' + (dom.top.map(function (c) { return c.value + ' (' + c.score + ')'; }).join('، ') || 'لا مرشحات') + ' | أرقام عشرية: ' + dom.totalDecimals + ' | SVG: ' + dom.svgTexts + ' | Shadow: ' + dom.shadowRoots + ' | iframes: ' + dom.iframesOk + '/' + dom.iframes + ' — السعر غالباً مرسوم على Canvas فقط.');
      }
    } catch (e) { setRow('domprice', 'bad', 'تعذّرت قراءة السعر من DOM: ' + e.message); }

    // 4) WebSocket — 30 ثانية استماع
    try {
      var hooked = injectWsHook();
      if (!hooked) {
        setRow('ws', 'bad', 'تعذّر تثبيت خطاف WebSocket — لم يُحقن في الصفحة.');
      } else {
        setRow('ws', 'run', 'WebSocket مثبّت — بستمع لرسائل المنصة 60 ثانية...');
        for (var w = 0; w < 30; w++) {
          await sleep(2000);
          var br = readWsBridge();
          var evTxt = '';
          if (br.ioEvents && br.ioEvents.events) {
            var evNames = [];
            for (var ek in br.ioEvents.events) evNames.push(ek + '×' + br.ioEvents.events[ek]);
            if (evNames.length) evTxt = ' | أحداث: ' + evNames.join('، ');
          }
          setRow('ws', 'run', 'WebSocket مثبّت — رسائل: ' + br.msgs + (br.price !== null ? ' | سعر: ' + br.price + (br.asset ? ' (' + br.asset + ')' : '') : ' | بلا سعر بعد') + evTxt + ' — ' + (60 - (w + 1) * 2) + ' ث متبقية');
        }
        var fin = readWsBridge();
        var ioTxt = '';
        if (fin.ioEvents) {
          var evL = [];
          if (fin.ioEvents.events) for (var fk in fin.ioEvents.events) evL.push(fk + '×' + fin.ioEvents.events[fk]);
          ioTxt = ' | handshake: ' + (fin.ioEvents.handshake || 0) + ' | ping: ' + (fin.ioEvents.ping || 0) + ' | أحداث 42: ' + (fin.ioEvents.total42 || 0) + (evL.length ? ' (' + evL.join('، ') + ')' : ' (بلا أسماء أحداث)');
        }
        var sampleTxt = '';
        if (fin.samples && fin.samples.length) {
          sampleTxt = ' | عينات رسائل (مفاتيح فقط): ' + fin.samples.map(function (s, i) {
            return (i + 1) + ') ' + (s.sensitive ? '(رسالة حساسة — مفاتيحها مخفية)' : (s.keys && s.keys.length ? s.keys.join('، ') : 'بلا مفاتيح')) + (s.price !== null && s.price !== undefined ? ' — سعر: ' + s.price : '');
          }).join(' ؛ ');
        }
        if (fin.price !== null) {
          setRow('ws', 'ok', 'WebSocket شغال ✅ — رسائل: ' + fin.msgs + ' | سعر: ' + fin.price + (fin.asset ? ' (' + fin.asset + ')' : '') + sampleTxt);
        } else if (fin.msgs > 0) {
          setRow('ws', 'warn', 'WebSocket بيستقبل رسائل (' + fin.msgs + ') لكن مفيش فيها سعر الزوج الحالي' + (asset ? ' (' + asset + ')' : ' (اسم الزوج غير معروف)') + ' — صيغة الرسائل مختلفة عن المتوقع.' + ioTxt + sampleTxt);
        } else {
          setRow('ws', 'warn', 'WebSocket مثبّت لكن وصلت 0 رسالة في 60 ثانية — السوكيت غالباً اتفتح قبل حقن الخطاف. أعد تحميل الصفحة بعد التثبيت ثم أعد الفحص.' + ioTxt);
        }
      }
    } catch (e) { setRow('ws', 'bad', 'تعذّر فحص WebSocket: ' + e.message); }

    // 4b) بنية الصفحة / iframes — هل الواجهة داخل iframe كروس-أوريجن؟
    try {
      var ds = docStructureDiag();
      var frTxt = ds.iframes.length ? ds.iframes.map(function (f, i) { return 'إطار ' + (i + 1) + ': ' + (f.host || '(بلا src)') + ' — ' + (f.readable ? 'مقروء' : 'كروس-أوريجن (محظور)'); }).join(' | ') : 'لا iframes';
      var st = (ds.innerTextLen < 100 || ds.iframes.some(function (f) { return !f.readable; })) ? 'warn' : 'ok';
      setRow('docstruct', st, 'نص الصفحة: ' + ds.innerTextLen + ' حرف | HTML: ' + ds.htmlLen + ' حرف | ' + (ds.isTop ? 'إطار أعلى' : 'داخل iframe') + ' | Shadow roots: ' + ds.shadowRoots + ' | ' + frTxt + (ds.innerTextLen < 100 ? ' — ⚠️ نص الصفحة شبه فارغ: الواجهة غالباً داخل iframe كروس-أوريجن أو Canvas.' : ''));
    } catch (e) { setRow('docstruct', 'bad', 'تعذّر فحص بنية الصفحة: ' + e.message); }

    // 4c) أحداث Socket.IO — أسماء الأحداث التي وصلت فعلاً
    try {
      var br2 = readWsBridge();
      var io = br2.ioEvents || { handshake: 0, ping: 0, pong: 0, connect: 0, total42: 0, events: {} };
      var evList = [];
      if (io.events) for (var k2 in io.events) evList.push(k2 + '×' + io.events[k2]);
      if (io.total42 > 0) setRow('sio', 'ok', 'وصلت أحداث Socket.IO ✅ — أحداث 42: ' + io.total42 + ' (' + (evList.join('، ') || 'بلا أسماء') + ') | handshake: ' + (io.handshake || 0) + ' | ping: ' + (io.ping || 0));
      else if ((io.handshake || 0) > 0) setRow('sio', 'warn', 'وصلت مصافحة Socket.IO فقط (handshake×' + io.handshake + ') — بلا أي حدث 42. رسائل السعر (إن وجدت) على سوكيت/namespace آخر فُتح قبل الخطاف، أو لم تُرسل بعد.');
      else setRow('sio', 'warn', 'لم تصل أي رسالة Socket.IO مصنّفة — راجع فحص WebSocket رقم 4.');
    } catch (e) { setRow('sio', 'bad', 'تعذّر فحص أحداث Socket.IO: ' + e.message); }

    // 5) أزرار CALL/PUT — وجود فقط، بلا ضغط أبداً
    try {
      var callB = findButtonInfo('Call|شراء|صعود|أعلى');
      var putB = findButtonInfo('Put|بيع|هبوط|أسفل');
      if (callB.text && putB.text) setRow('buttons', 'ok', 'زر CALL موجود (' + callB.method + ': "' + callB.text + '") | زر PUT موجود (' + putB.method + ': "' + putB.text + '") — لم يُضغط أي زر.');
      else if (callB.text || putB.text) setRow('buttons', 'warn', 'زر واحد فقط موجود — CALL: ' + (callB.text ? '"' + callB.text + '" (' + callB.method + ')' : 'مش موجود') + ' | PUT: ' + (putB.text ? '"' + putB.text + '" (' + putB.method + ')' : 'مش موجود') + ' — البوت الرئيسي لن يستطيع تنفيذ الاتجاه الناقص.');
      else setRow('buttons', 'bad', 'مش لاقي زر CALL ولا زر PUT في الصفحة — لا بالنص ولا بـ aria-label ولا باللون. البوت الرئيسي لن يستطيع تنفيذ أي صفقة (الواجهة ممكن تكون اتغيّرت أو داخل iframe).');
    } catch (e) { setRow('buttons', 'bad', 'تعذّر فحص الأزرار: ' + e.message); }

    // 6) حقل المبلغ
    try {
      var amt = readAmount();
      if (amt) setRow('amount', 'ok', 'المبلغ الحالي: ' + amt.value + ' (' + amt.method + ') — لم يُغيَّر.');
      else setRow('amount', 'warn', 'مش لاقي حقل مبلغ رقمي في الصفحة — تأكد أن مبلغ الصفقة مظبوط يدوياً قبل START في البوت الرئيسي.');
    } catch (e) { setRow('amount', 'bad', 'تعذّر فحص المبلغ: ' + e.message); }

    // 7) حقل الزمن
    try {
      var tm = readTime();
      if (tm) setRow('time', 'ok', 'الزمن الحالي: ' + tm.value + ' (' + tm.method + ') — لم يُغيَّر.');
      else setRow('time', 'warn', 'مش لاقي حقل زمن (مثل 00:01:00) في الصفحة — تأكد أن مدة الصفقة دقيقة واحدة يدوياً قبل START في البوت الرئيسي.');
    } catch (e) { setRow('time', 'bad', 'تعذّر فحص الزمن: ' + e.message); }

    // 8) العائد
    try {
      var pays = readPayoutAll();
      if (pays.length) setRow('payout', 'ok', 'نسب مئوية في الصفحة: ' + pays.join('، ') + ' — أول نسبة غالباً هي العائد.');
      else setRow('payout', 'warn', 'مش لاقي أي نسبة % في الصفحة — فلتر العائد في البوت الرئيسي قد لا يعمل صح.');
    } catch (e) { setRow('payout', 'bad', 'تعذّر فحص العائد: ' + e.message); }

    // 9) الرصيد
    try {
      var bal = readBalance();
      if (bal) setRow('balance', 'ok', 'الرصيد: ' + bal.value + ' (' + bal.method + ').');
      else setRow('balance', 'warn', 'مش لاقي الرصيد في الصفحة — تتبّع الربح/الخسارة في البوت الرئيسي قد لا يعمل صح.');
    } catch (e) { setRow('balance', 'bad', 'تعذّر فحص الرصيد: ' + e.message); }

    // 10) شموع تجريبية — 5 شموع × 15 ثانية = 75 ثانية
    try {
      setRow('candles', 'run', 'ببني 5 شموع تجريبية (15 ثانية لكل شمعة — 75 ثانية)...');
      var startCloses = closes.length;
      for (var c = 0; c < 75; c++) {
        await sleep(1000);
        var lp = getLivePrice();
        if (lp) {
          var now = Math.floor(Date.now() / 1000);
          var bucket = now - (now % 15);
          if (!curCandle || curCandle.time !== bucket) {
            if (curCandle) { closes.push(curCandle.close); if (closes.length > 200) closes.shift(); }
            curCandle = { time: bucket, close: lp.price };
          } else curCandle.close = lp.price;
          setRow('candles', 'run', 'سعر حي: ' + lp.price + ' (' + lp.source + ') | شموع مكتملة: ' + closes.length + ' / 5 — ' + (75 - c - 1) + ' ث متبقية');
        } else {
          setRow('candles', 'run', 'مفيش سعر حي بعد — شموع مكتملة: ' + closes.length + ' / 5 — ' + (75 - c - 1) + ' ث متبقية');
        }
      }
      if (curCandle) { closes.push(curCandle.close); }
      candleDone = true;
      var made = closes.length - startCloses;
      if (made >= 5) setRow('candles', 'ok', 'تم بناء ' + made + ' شموع تجريبية ✅ — الإغلاقات: ' + closes.slice(-5).join('، '));
      else if (made > 0) setRow('candles', 'warn', 'تم بناء ' + made + ' شمعة فقط من 5 — السعر كان يظهر ويختفي أثناء الفحص.');
      else setRow('candles', 'bad', 'مفيش سعر فمفيش شموع — لم يصل أي سعر حي (لا DOM ولا WebSocket) خلال 75 ثانية، فلا يمكن بناء شموع ولا دخول صفقات.');
    } catch (e) { setRow('candles', 'bad', 'تعذّر بناء الشموع: ' + e.message); }

    // 11) المؤشرات
    try {
      var useCloses = closes, synthetic = false;
      if (!useCloses || useCloses.length < 21) {
        synthetic = true;
        var base = (closes.length ? closes[closes.length - 1] : (wsPriceSeen || (dom && dom.price) || 1.0));
        useCloses = syntheticCloses(30, base);
      }
      var e9 = ema(useCloses, 9), e21 = ema(useCloses, 21), r = rsi(useCloses, 14);
      if (e9 === null || e21 === null || r === null) {
        setRow('indicators', 'bad', 'بيانات مش كفاية لحساب المؤشرات — حتى البيانات الاصطناعية لم تكفِ.');
      } else {
        var trend = e9 > e21 ? 'صاعد' : e9 < e21 ? 'هابط' : 'عرضي';
        setRow('indicators', 'ok', 'EMA9: ' + e9.toFixed(5) + ' | EMA21: ' + e21.toFixed(5) + ' | RSI14: ' + r.toFixed(1) + ' | الترند: ' + trend + (synthetic ? ' — ⚠️ هذه القيم من بيانات اصطناعية للاختبار، لأن الشموع الحية أقل من 21.' : ' — من شموع حية.'));
      }
    } catch (e) { setRow('indicators', 'bad', 'تعذّر حساب المؤشرات: ' + e.message); }

    // 12) ملخص المشاكل
    try {
      var fails = [], warns = [];
      CHECKS.forEach(function (c) {
        if (c.id === 'summary') return;
        var r = results[c.id];
        if (!r) return;
        if (r.status === 'bad') fails.push(c.name + ': ' + r.text);
        else if (r.status === 'warn') warns.push(c.name + ': ' + r.text);
      });
      if (fails.length === 0 && warns.length === 0) {
        setRow('summary', 'ok', 'مفيش فشل — كل الفحوصات عدّت ✅. لو البوت الرئيسي لسه مش بيدخل صفقات، المشكلة في شروط الدخول (اتفاق المؤشرات / الفلاتر)، مش في قراءة البيانات.');
      } else {
        var txt = '';
        if (fails.length) txt += 'مشاكل (❌ ' + fails.length + '):\n' + fails.map(function (f, i) { return (i + 1) + '. ' + f; }).join('\n');
        if (warns.length) txt += (txt ? '\n' : '') + 'ملاحظات (⚠️ ' + warns.length + '):\n' + warns.map(function (f, i) { return (i + 1) + '. ' + f; }).join('\n');
        setRow('summary', fails.length ? 'bad' : 'warn', txt);
      }
    } catch (e) { setRow('summary', 'bad', 'تعذّر بناء الملخص: ' + e.message); }

    logTest('انتهى الفحص الشامل — صوّر اللوحة وأرسلها.');
    if (btn) { btn.disabled = false; btn.textContent = '▶ ابدأ الفحص'; }
    testRunning = false;
  }

  // ---------- بناء اللوحة ----------
  function buildPanel() {
    try {
      var p = document.createElement('div');
      p.id = 'muse-test-panel';
      p.style.cssText = 'position:fixed;bottom:10px;right:10px;z-index:999999;background:#222;color:#fff;'
        + 'padding:12px;border-radius:10px;font-size:13px;width:300px;max-width:92vw;max-height:85vh;overflow:auto;'
        + 'box-shadow:0 0 12px #000;text-align:right;direction:rtl;font-family:sans-serif;';
      var rowsHtml = CHECKS.map(function (c) {
        return '<div id="muse-test-row-' + c.id + '" style="margin:6px 0;padding:6px;border:1px solid #444;border-radius:6px;color:#ccc;white-space:pre-wrap;word-break:break-word;">⏳ ' + c.name + ' — لم يبدأ بعد</div>';
      }).join('');
      p.innerHTML = '<b>🔍 فحص شامل — لا يتداول</b><br>'
        + '<span style="color:#f39c12">فحص قراءة فقط: لا يضغط CALL/PUT، ولا يغيّر المبلغ أو الزمن، ولا يدخل أي صفقة.</span><br>'
        + '<button id="muse-test-start" style="background:#ffffff;color:#000000;padding:10px 16px;border:1px solid #888;border-radius:6px;margin-top:8px;font-size:15px;font-weight:bold;cursor:pointer;">▶ ابدأ الفحص</button>'
        + '<div style="margin-top:8px;color:#aaa;font-size:12px;">الفحص ياخد حوالي 3 دقائق (60 ث WebSocket + 75 ث شموع). سيب الصفحة مفتوحة.</div>'
        + '<div id="muse-test-results" style="margin-top:8px;">' + rowsHtml + '</div>'
        + '<pre id="muse-test-log" style="max-height:120px;overflow:auto;font-size:11px;color:#aaa;background:#111;padding:6px;border-radius:6px;white-space:pre-wrap;"></pre>';
      document.body.appendChild(p);
      document.getElementById('muse-test-start').onclick = runTests;
    } catch (e) { console.log('[PocketTest] buildPanel failed', e); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildPanel);
  else buildPanel();

  // خطاف اختبار (لاختبارات Node فقط — لا يؤثر على الصفحة)
  try {
    if (typeof window !== 'undefined') {
      window.__PocketTest = {
        parsePriceText: parsePriceText, pairFromText: pairFromText, ema: ema, rsi: rsi,
        syntheticCloses: syntheticCloses, extractWsPrice: extractWsPrice, wsKeysOf: wsKeysOf,
        parseSocketIoMessage: parseSocketIoMessage, docStructureDiag: docStructureDiag,
        findButtonInfo: findButtonInfo,
        isSensitiveKey: isSensitiveKey, readAssetName: readAssetName, readPriceDiag: readPriceDiag,
        findButtonText: findButtonText, readAmount: readAmount, readTime: readTime,
        readPayoutAll: readPayoutAll, readBalance: readBalance, isDemo: isDemo
      };
    }
  } catch (e) { /* تجاهل */ }
})();
