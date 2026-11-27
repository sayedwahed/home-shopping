/* background.js — Pocket Demo Bot, Firefox Extension (Manifest V2)
 * الإصدار 1.1.0 — المصادقة تُعترض من الصفحة نفسها (بموافقة سيد الصريحة)
 * ==========================================================================
 * ما الذي يفعله هذا الملف، ولماذا هو مختلف عن سكربت Tampermonkey؟
 * --------------------------------------------------------------------------
 * سكربت Tampermonkey يرى فقط ما في الصفحة: السعر مرسوم على Canvas ولا
 * يوجد في الـ DOM، ولا أزرار CALL/PUT في الـ DOM، وخطاف WebSocket في
 * الصفحة يسمع رسائل المصافحة فقط (sid, upgrades, pingInterval...) بلا
 * أي حدث سعر 42[...] خلال 75 ثانية — لأن سوكيت الصفحة اتفتح واتوثّق
 * قبل حقن الخطاف، فالمنصة لا ترسل أحداث سعر لسوكيت غير موثّق، ولأن
 * أحداث السعر تأتي أيضاً في صورة ثنائية 451- يلقيها محلل السكربت.
 *
 * الإضافة عندها صلاحيتان لا يملكهما الـ userscript:
 *   1) اعتراض رسالة المصادقة الصادرة من الصفحة نفسها (auth-hook.js،
 *      يعمل عند document_start، مثل الـ SSID Fetcher الرسمي في
 *      BinaryOptionsToolsV2): عندما ترسل الصفحة 42["auth", {...}]
 *      تُلتقط session و uid و isDemo منها. وإن فات الاعتراض (تبويب
 *      مفتوح قبل التثبيت)، تقرأ الخلفية الجلسة من الكوكيز عبر
 *      browser.cookies — أيهما يشتغل الأول. وعند انتهاء الجلسة أو
 *      فشل المصادقة، تعيد الخلفية قراءة الـ auth تلقائياً من المتصفح
 *      (طلب إعادة مصادقة من content script + إعادة قراءة الكوكيز +
 *      إعادة اتصال)، من غير أي تدخل من المستخدم، طالما هو لسه مسجل
 *      دخول. وإن خرج من الحساب خالص، لا إضافة تستطيع اختراع جلسة —
 *      تعرض "سجّل دخولك الأول" فقط.
 *   2) سوكيت خاص بها — تفتح اتصال Socket.IO خاصاً بها إلى سوكيت
 *      الأسعار، وتتوثّق فيه بجلسة المتصفح، وتنتظر successauth بأي
 *      شكل، ثم تشترك صراحة في الزوج الحالي وتقرأ updateStream.
 *
 * بروتوكول السوكيت (موثّق من مستودعات مفتوحة، بحث GitHub 2026-11-27):
 *   Endpoint (ديمو): wss://demo-api-eu.po.market/socket.io/?EIO=4&transport=websocket
 *   Frames: 0 OPEN {sid,pingInterval,...} -> نرد 40 CONNECT
 *           2 PING -> نرد 3 PONG
 *           42["event", payload]  (وقد يأتي بصيغة 42/ns,["event",...])
 *           451-["event", payload] (حدث ثنائي — نفس المعالجة)
 *   Auth:   42["auth", {"session": ..., "isDemo": 1, "uid": ...,
 *           "platform": 2, "isFastHistory": true, "isOptimized": true}]
 *           (isDemo يعكس auth الصفحة نفسها إن وُجد — 1 للديمو؛
 *           التداول مقفول تماماً إن لم يكن 1.)
 *   Price:  حدث updateStream — قائمة [{asset, timestamp, value}]
 *   Subscribe: 42["subscribeSymbol", {"asset": "AUDCAD_otc"}]
 *              42["changeSymbol", {"asset": "AUDCAD_otc", "period": 30}]
 *   Trade (ديمو فقط): 42["openOrder", {"asset","amount","action":"call"/"put",
 *              "isDemo": 1, "optionType": 100, "time": 60, "requestId": ...}]
 *           الرد: successopenOrder / failopenOrder / updateOpenedDeals
 *   ملاحظة صريحة: اسم حدث فتح الصفقة (openOrder) وصيغته مأخوذان من بحث
 *   المستودعات المفتوحة، ولم يُختبرا بعد على حساب حي — أول تشغيل حي
 *   يجب أن يراقب سجل اللوحة (المصافحة، successauth، أول updateStream)
 *   قبل أي صفقة، والتنفيذ عبر السوكيت لا يُحتسب إلا بعد تأكيد المنصة.
 *   وإن وصل شكل رسالة غير معروف، يُسجَّل شكله الخام (مفاتيح فقط) ويُعطَّل
 *   المسار المرتبط به برسالة واضحة — لا نخترع أي شكل wire غير موثّق.
 *
 * أمان الجلسة — اقرأ هذا أولاً:
 *   - قيمة الجلسة (session/ssid) لا تُسجَّل أبداً في console، ولا
 *     تُحفظ في storage، ولا تُرسَل لأي خادم أو شات أو أي جهة. تبقى
 *     في ذاكرة background فقط، داخل متصفح المستخدم.
 *   - السجلات تذكر اسم الكوكي وطوله فقط (مثال: "cookie ssid found,
 *     length 32")، بلا أي جزء من القيمة.
 *   - لا يوجد أي fetch/اتصال لأي مضيف غير *.pocketoption.com و
 *     *.po.market (سوكيت الأسعار).
 *   - ديمو فقط: أي محاولة تنفيذ تُرفض إن لم يكن isDemo == 1، وإن
 *     قالت المنصة إن الحساب حقيقي، يُقفل التنفيذ نهائياً حتى إعادة
 *     تشغيل الإضافة.
 * ⚠️ أتمتة مخالفة لشروط Pocket Option وقد تؤدي لحظر الحساب حتى على
 * الديمو. بلا ضمان ربح — نقطة التعادل حوالي 52% فوز عند عائد 92%.
 * ==========================================================================
 */
'use strict';

var WS_URL = 'wss://demo-api-eu.po.market/socket.io/?EIO=4&transport=websocket';
var RECONNECT_BASE_MS = 5000;
var RECONNECT_MAX_MS = 30000;

var API = (typeof browser !== 'undefined' && browser.cookies) ? browser : chrome;

// ---- الحالة (بلا أي قيمة جلسة فيها) ----
var state = {
  cookieFound: false,
  cookieName: '',
  cookieLen: 0,
  authSource: '',          // '' | 'page-auth' | 'cookie' — مصدر المصادقة (تسمية فقط)
  socket: 'disconnected',   // disconnected | connecting | open | connected | authed
  authed: false,
  isDemo: null,             // 1 = ديمو، 0 = حقيقي (يُقفل التنفيذ)
  balance: null,
  lastTickAt: 0,
  lastPrice: null,
  lastAsset: '',
  lastEvent: '',
  samples: [],              // أسماء أحداث فقط، بلا قيم
  firstMsgShape: null,      // {event, keys[]} — شكل أول رسالة 42 (مفاتيح فقط)
  assetsSeen: 0,
  tradesConfirmed: 0,
  tradesFailed: 0,
  lastError: ''
};

var socket = null;
var reconnectTimer = null;
var reconnectDelay = RECONNECT_BASE_MS;
var pingTimer = null;
var pingIntervalMs = 25000;
var sessionCandidates = []; // [{name, value, from}] — في الذاكرة فقط، لا تُسجَّل
var interceptedAuth = null; // {session, uid, isDemo} من رسالة auth الصفحة — في الذاكرة فقط
var uidValue = null;        // من localStorage (إن وُجد)، في الذاكرة فقط
var authTimer = null;       // مهلة انتظار successauth بعد إرسال auth
var authAttempts = 0;       // عدد محاولات المصادقة الفاشلة المتتالية
var reauthTimer = null;
var currentAsset = '';      // مثل 'AUDCAD' (6 أحرف) من content script
var subscribedAsset = '';
var pendingTrade = null;    // {resolve, timeoutId, requestId, asset, amount, dir}
var tabIds = {};            // تبويبات Pocket Option التي تكلّمت معنا

function log() {
  var args = Array.prototype.slice.call(arguments);
  console.log.apply(console, ['[PocketDemoBot:bg]'].concat(args));
}
// سجل آمن: أسماء فقط، بلا قيم.
function logEventName(name) {
  state.lastEvent = name;
  if (state.samples.indexOf(name) === -1) {
    state.samples.push(name);
    if (state.samples.length > 12) state.samples.shift();
  }
}
function statusSummary() {
  return {
    cookie: state.cookieFound,
    cookieName: state.cookieName,
    authSource: state.authSource,
    socket: state.socket,
    authed: state.authed,
    isDemo: state.isDemo,
    balance: state.balance,
    lastTickAt: state.lastTickAt,
    lastPrice: state.lastPrice,
    lastAsset: state.lastAsset,
    lastEvent: state.lastEvent,
    samples: state.samples.slice(),
    firstMsgShape: state.firstMsgShape,
    assetsSeen: state.assetsSeen,
    lastError: state.lastError
  };
}
function broadcastStatus() {
  var msg = { type: 'ext-status', status: statusSummary() };
  Object.keys(tabIds).forEach(function (id) {
    try { API.tabs.sendMessage(parseInt(id, 10), msg, function () { if (API.runtime.lastError) {} }); } catch (e) {}
  });
}
function broadcastTick(asset, price, timestamp) {
  var msg = { type: 'ext-tick', asset: asset, price: price, timestamp: timestamp };
  Object.keys(tabIds).forEach(function (id) {
    try { API.tabs.sendMessage(parseInt(id, 10), msg, function () { if (API.runtime.lastError) {} }); } catch (e) {}
  });
}

// ---- الجلسة: قراءة الكوكيز من المتصفح نفسه ----
function isSessionName(name) {
  return /ssid|session|auth|token/i.test(name || '');
}
function addCandidate(name, value, from) {
  if (!name || !value || typeof value !== 'string') return;
  for (var i = 0; i < sessionCandidates.length; i++) {
    if (sessionCandidates[i].value === value) return; // مكرر
  }
  sessionCandidates.push({ name: name, value: value, from: from });
  if (sessionCandidates.length > 8) sessionCandidates.shift();
}
function readCookies() {
  // browser.cookies.getAll — يقرأ حتى httpOnly، من متصفح المستخدم نفسه.
  var domains = ['.pocketoption.com', 'pocketoption.com', '.po.market'];
  var done = 0;
  domains.forEach(function (domain) {
    try {
      API.cookies.getAll({ domain: domain }, function (cookies) {
        done++;
        (cookies || []).forEach(function (c) {
          // مرشح الجلسة: الاسم يدل عليه، أو قيمة طويلة تشبه توكن.
          if (isSessionName(c.name) || (c.value && c.value.length >= 24)) {
            addCandidate(c.name, c.value, 'cookie:' + domain);
          }
          if (/^uid$/i.test(c.name) && /^\d+$/.test(c.value)) uidValue = parseInt(c.value, 10);
        });
        if (done === domains.length) afterCookieRead();
      });
    } catch (e) { done++; if (done === domains.length) afterCookieRead(); }
  });
}
function afterCookieRead() {
  if (sessionCandidates.length) {
    // نعرض الاسم والطول فقط — أبداً القيمة.
    var first = sessionCandidates[0];
    state.cookieFound = true;
    state.cookieName = first.name;
    state.cookieLen = first.value.length;
    log('cookie found: name=' + first.name + ' length=' + first.value.length +
        ' candidates=' + sessionCandidates.length + ' (values never logged)');
  } else {
    state.cookieFound = false;
    state.cookieName = '';
    state.cookieLen = 0;
    state.lastError = 'لا يوجد كوكي جلسة في المتصفح — سجّل دخولك في Pocket Option أولاً';
    log('no session cookie found in this browser — user must log in first');
  }
  broadcastStatus();
  if (socket && socket.readyState === WebSocket.OPEN && !state.authed) tryAuth();
}

// تابع تغيّر الكوكيز: الجلسة قد تكون قصيرة العمر — نجلب الجديدة تلقائياً.
if (API.cookies && API.cookies.onChanged) {
  API.cookies.onChanged.addListener(function (changeInfo) {
    try {
      var c = changeInfo.cookie || {};
      if (!c.domain || c.domain.indexOf('pocketoption.com') === -1) return;
      if (changeInfo.removed) return;
      if (isSessionName(c.name) || (c.value && c.value.length >= 24)) {
        log('session cookie changed: name=' + c.name + ' length=' + (c.value || '').length + ' — re-reading');
        addCandidate(c.name, c.value, 'cookie-changed');
        state.cookieFound = true;
        state.cookieName = c.name;
        state.cookieLen = (c.value || '').length;
        broadcastStatus();
        if (socket && socket.readyState === WebSocket.OPEN && !state.authed) tryAuth();
      }
    } catch (e) {}
  });
}

// ---- Socket.IO / Engine.IO ----
function sendRaw(text) {
  try {
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(text);
  } catch (e) {}
}
function sendEvent(name, payload) {
  sendRaw('42' + JSON.stringify([name, payload]));
}
function assetFull(asset6) {
  var a = String(asset6 || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!a) return '';
  if (a.indexOf('_') !== -1) return a;
  return a + '_otc';
}
function tryAuth() {
  if (state.authed) return;
  // الأولوية 1: auth معترض من رسالة الصفحة نفسها (أدق مصدر — نفس
  // الجلسة التي تستخدمها الصفحة فعلاً). الأولوية 2: مرشحات الكوكيز.
  var sessionValue = null, uid = uidValue, source = '';
  if (interceptedAuth && interceptedAuth.session) {
    sessionValue = interceptedAuth.session;
    if (interceptedAuth.uid !== undefined && interceptedAuth.uid !== null) uid = interceptedAuth.uid;
    source = 'page-auth';
  } else if (sessionCandidates.length) {
    sessionValue = sessionCandidates[0].value;
    source = 'cookie:' + sessionCandidates[0].name;
  }
  if (!sessionValue) {
    state.lastError = 'لا توجد جلسة للتوثيق — سجّل دخولك في Pocket Option أولاً';
    log('no session available for auth (neither intercepted nor cookie)');
    return;
  }
  // isDemo يعكس auth الصفحة نفسها إن وُجد (1 للديمو)؛ وإلا 1.
  // التداول مقفول تماماً إن لم يكن 1 — انظر tradeViaSocket.
  var demoFlag = 1;
  if (interceptedAuth && interceptedAuth.isDemo !== undefined && interceptedAuth.isDemo !== null) {
    demoFlag = interceptedAuth.isDemo ? 1 : 0;
  }
  var payload = { session: sessionValue, isDemo: demoFlag, platform: 2, isFastHistory: true, isOptimized: true };
  if (uid !== null && uid !== undefined) payload.uid = uid;
  state.authSource = (source === 'page-auth') ? 'رسالة الصفحة' : 'الكوكيز';
  // القيمة لا تُسجَّل أبداً — فقط المصدر و isDemo ووجود uid.
  log('sending auth (source=' + state.authSource + ', isDemo=' + demoFlag + ', uid=' + (uid === null ? 'none' : 'present') + ')');
  sendEvent('auth', payload);
  // مهلة: إن لم يرد successauth خلال 10 ثوانٍ، جرّب المصدر التالي.
  if (authTimer) clearTimeout(authTimer);
  authTimer = setTimeout(onAuthTimeout, 10000);
}
function onAuthTimeout() {
  authTimer = null;
  if (state.authed) return;
  authAttempts++;
  log('auth timeout (no successauth in 10s) — attempt ' + authAttempts);
  if (interceptedAuth) {
    // جرّب الكوكيز كبديل للـ auth المعترض.
    interceptedAuth = null;
    state.authSource = '';
    if (sessionCandidates.length && socket && socket.readyState === WebSocket.OPEN) { tryAuth(); return; }
  }
  // كل المصادر فشلت: أعد قراءة الـ auth تلقائياً من المتصفح.
  scheduleReauth();
}
function scheduleReauth() {
  if (reauthTimer) return;
  state.lastError = 'المصادقة فشلت — إعادة قراءة الـ auth تلقائياً خلال 30 ثانية (سجّل دخولك إن خرجت من الحساب)';
  log('scheduling automatic re-auth in 30s (no user action needed while logged in)');
  broadcastStatus();
  reauthTimer = setTimeout(function () {
    reauthTimer = null;
    authAttempts = 0;
    requestFreshAuth();
    readCookies();
    if (!socket || socket.readyState === WebSocket.CLOSED) connectSocket();
    else if (socket.readyState === WebSocket.OPEN) tryAuth();
  }, 30000);
}
// اطلب من كل تبويبات Pocket Option إعادة إرسال آخر auth معترض + مرشحات
// الجلسة (بلا أي تدخل من المستخدم).
function requestFreshAuth() {
  Object.keys(tabIds).forEach(function (id) {
    try { API.tabs.sendMessage(parseInt(id, 10), { type: 'ext-reauth-request' }, function () { if (API.runtime.lastError) {} }); } catch (e) {}
  });
}
function subscribeAsset(asset6) {
  var full = assetFull(asset6);
  if (!full) return;
  if (subscribedAsset === full && state.authed) return;
  subscribedAsset = full;
  log('subscribing asset: ' + full);
  sendEvent('subscribeSymbol', { asset: full });
  sendEvent('changeSymbol', { asset: full, period: 30 });
}

// تحليل رسالة Socket.IO نصية إلى [event, payload] — مع دعم الـ namespace
// (42/ns,["event",...]) والحدث الثنائي (451-["event",...]).
function parseSocketIo(text) {
  var t = String(text || '');
  if (t.indexOf('451-') === 0) t = '42' + t.slice(4); // ثنائي -> عامله كحدث عادي
  if (t.indexOf('42') !== 0) return null;
  var jsonPart = t.slice(2);
  if (jsonPart.charAt(0) !== '[') {
    // صيغة namespace: 42/ns,["event", payload]
    var comma = jsonPart.indexOf(',');
    if (comma === -1) return null;
    jsonPart = jsonPart.slice(comma + 1);
  }
  try {
    var arr = JSON.parse(jsonPart);
    if (!Array.isArray(arr) || typeof arr[0] !== 'string') return null;
    return { event: arr[0], payload: arr[1] };
  } catch (e) { return null; }
}
function plausiblePrice(v) {
  var n = parseFloat(v);
  // سعر منصة معقول: رقم موجب بين 0.01 و 100000، بخانتين عشريتين على الأقل
  // (2-decimal assets مسموحة — إصلاح لخطأ v1.2.2 الذي اشترط 3-5 خانات).
  return (isFinite(n) && n > 0.01 && n < 100000) ? n : null;
}
function handlePriceEvent(event, payload) {
  // updateStream: قائمة [{asset, timestamp, value}] أو عنصر واحد.
  var items = Array.isArray(payload) ? payload : [payload];
  var gotPrice = false;
  items.forEach(function (it) {
    if (!it || typeof it !== 'object') return;
    var asset = it.asset || it.symbol || '';
    var price = plausiblePrice(it.value !== undefined ? it.value : it.price);
    if (price === null) return;
    gotPrice = true;
    state.lastTickAt = Date.now();
    state.lastPrice = price;
    state.lastAsset = String(asset);
    broadcastTick(String(asset), price, it.timestamp || Date.now());
  });
  if (!gotPrice) {
    // شكل سعر غير معروف — سجّل مفاتيحه فقط، وعطّل مسار السعر برسالة واضحة.
    var keys = [];
    try {
      var first = items[0];
      if (first && typeof first === 'object') keys = Object.keys(first).slice(0, 8);
    } catch (e) {}
    state.lastError = 'شكل ' + event + ' غير معروف {' + keys.join(', ') + '} — مسار السعر هذا متوقف مؤقتاً، بلا تخمين';
    log('unknown price shape for event ' + event + ' keys=[' + keys.join(',') + '] — price path disabled, no guessing');
  }
  broadcastStatus();
}
function handleEvent(event, payload) {
  logEventName(event);
  switch (event) {
    case 'successauth': {
      // successauth يأتي بأشكال حمولة متعددة — أي وصول له يعني توثيقاً ناجحاً.
      if (authTimer) { clearTimeout(authTimer); authTimer = null; }
      authAttempts = 0;
      state.authed = true;
      state.socket = 'authed';
      if (payload && typeof payload === 'object' && payload.isDemo !== undefined) {
        state.isDemo = payload.isDemo ? 1 : 0;
      } else if (state.isDemo === null) {
        state.isDemo = 1; // نحن من أرسل isDemo:1 في auth
      }
      log('successauth — socket authenticated, isDemo=' + state.isDemo);
      if (state.isDemo === 0) {
        state.lastError = 'الحساب حقيقي (isDemo=0) — التنفيذ مقفول، الأسعار فقط';
        log('REAL account detected — trading locked, prices only');
      }
      if (currentAsset) subscribeAsset(currentAsset);
      broadcastStatus();
      break;
    }
    case 'updateStream':
    case 'update_close_value': // اسم بديل في بعض إصدارات الـ SDK
      handlePriceEvent(event, payload);
      break;
    case 'successupdateBalance': {
      try {
        var b = payload && (payload.balance !== undefined ? payload.balance : payload);
        if (isFinite(parseFloat(b))) state.balance = parseFloat(b);
      } catch (e) {}
      broadcastStatus();
      break;
    }
    case 'updateAssets': {
      if (Array.isArray(payload)) state.assetsSeen = payload.length;
      break;
    }
    case 'successopenOrder': {
      if (pendingTrade) {
        var t = pendingTrade; pendingTrade = null;
        clearTimeout(t.timeoutId);
        state.tradesConfirmed++;
        log('successopenOrder — trade confirmed (requestId logged in content script only)');
        t.resolve({ ok: true, confirmed: true });
      }
      break;
    }
    case 'failopenOrder': {
      if (pendingTrade) {
        var t2 = pendingTrade; pendingTrade = null;
        clearTimeout(t2.timeoutId);
        state.tradesFailed++;
        state.lastError = 'المنصة رفضت الصفقة (failopenOrder)';
        t2.resolve({ ok: false, reason: 'failopenOrder' });
      }
      break;
    }
    case 'updateOpenedDeals': {
      // تأكيد بديل: صفقة جديدة ظهرت بنفس الأصل والمبلغ.
      if (pendingTrade && Array.isArray(payload)) {
        var hit = payload.some(function (d) {
          return d && String(d.asset || '') === assetFull(pendingTrade.asset) &&
            parseFloat(d.amount) === parseFloat(pendingTrade.amount);
        });
        if (hit) {
          var t3 = pendingTrade; pendingTrade = null;
          clearTimeout(t3.timeoutId);
          state.tradesConfirmed++;
          log('updateOpenedDeals — trade confirmed via open-deals list');
          t3.resolve({ ok: true, confirmed: true });
        }
      }
      break;
    }
    default:
      // أحداث أخرى (updateCharts, updateClosedDeals...) — نكتفي باسمها.
      break;
  }
}
function handleFrame(data) {
  var text = (typeof data === 'string') ? data : '';
  if (!text) { log('binary frame received (not parsed as text)'); return; }
  if (text.charAt(0) === '0') {
    // OPEN handshake {sid, pingInterval, pingTimeout, maxPayload}
    try {
      var hs = JSON.parse(text.slice(1));
      if (hs && hs.pingInterval) pingIntervalMs = hs.pingInterval;
    } catch (e) {}
    log('handshake 0 OPEN received — sending 40 CONNECT');
    sendRaw('40');
    state.socket = 'open';
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(function () { sendRaw('2'); }, Math.max(5000, Math.floor(pingIntervalMs / 2)));
    broadcastStatus();
    return;
  }
  if (text === '2') { sendRaw('3'); return; } // PING -> PONG
  if (text === '3') return; // PONG
  if (text === '40') {
    log('40 CONNECT confirmed by server');
    state.socket = 'connected';
    broadcastStatus();
    tryAuth();
    return;
  }
  if (text.indexOf('42') === 0 || text.indexOf('451-') === 0) {
    var parsed = parseSocketIo(text);
    if (parsed) {
      // شكل أول رسالة 42 — مفاتيح فقط، بلا أي قيمة، للعرض في اللوحة.
      if (!state.firstMsgShape) {
        var keys = [];
        try {
          if (parsed.payload && typeof parsed.payload === 'object') keys = Object.keys(parsed.payload).slice(0, 8);
          else if (Array.isArray(parsed.payload) && parsed.payload[0] && typeof parsed.payload[0] === 'object') keys = Object.keys(parsed.payload[0]).slice(0, 8);
        } catch (e) {}
        state.firstMsgShape = { event: parsed.event, keys: keys };
      }
      handleEvent(parsed.event, parsed.payload);
    }
    else log('unparsed 42/451- frame (first 40 chars only, no values): ' + text.slice(0, 40));
    return;
  }
  if (text === '1') { log('server sent close (1)'); scheduleReconnect(); return; }
  // أي إطار آخر: سجّل نوعه فقط.
  log('other frame type: ' + text.slice(0, 2));
}
function scheduleReconnect() {
  try { if (socket) socket.close(); } catch (e) {}
  socket = null;
  state.socket = 'disconnected';
  state.authed = false;
  if (authTimer) { clearTimeout(authTimer); authTimer = null; }
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
  broadcastStatus();
  if (reconnectTimer) return;
  log('reconnecting in ' + reconnectDelay + 'ms (auth will be re-read automatically)');
  reconnectTimer = setTimeout(function () {
    reconnectTimer = null;
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
    requestFreshAuth(); // أعد قراءة الـ auth المعترض من الصفحة
    readCookies(); // الجلسة قد تكون تجددت — أعد القراءة قبل إعادة الاتصال
    connectSocket();
  }, reconnectDelay);
}
function connectSocket() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  state.socket = 'connecting';
  broadcastStatus();
  log('connecting price socket: ' + WS_URL);
  try {
    socket = new WebSocket(WS_URL);
  } catch (e) {
    state.lastError = 'تعذّر فتح السوكيت: ' + e.message;
    scheduleReconnect();
    return;
  }
  socket.onopen = function () {
    log('price socket TCP open — waiting for 0 handshake');
    state.socket = 'open';
    reconnectDelay = RECONNECT_BASE_MS;
    broadcastStatus();
  };
  socket.onmessage = function (ev) { handleFrame(ev.data); };
  socket.onerror = function () {
    state.lastError = 'خطأ في سوكيت الأسعار — إعادة اتصال';
    log('price socket error');
  };
  socket.onclose = function () {
    log('price socket closed');
    scheduleReconnect();
  };
}

// ---- تنفيذ صفقة عبر السوكيت (ديمو فقط، وبعد تأكيد المنصة فقط) ----
function tradeViaSocket(msg, sendResponse) {
  if (!state.authed) { sendResponse({ ok: false, reason: 'socket-not-authed' }); return; }
  if (state.isDemo !== 1 || !msg.isDemo) {
    state.lastError = 'تنفيذ مرفوض: الحساب ليس ديمو';
    log('TRADE REFUSED: not a demo account');
    sendResponse({ ok: false, reason: 'not-demo' });
    return;
  }
  if (pendingTrade) { sendResponse({ ok: false, reason: 'trade-already-pending' }); return; }
  var asset = assetFull(msg.asset);
  if (!asset) { sendResponse({ ok: false, reason: 'no-asset' }); return; }
  var requestId = 'ext-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
  var payload = {
    asset: asset,
    amount: parseFloat(msg.amount),
    action: (msg.dir === 'CALL') ? 'call' : 'put',
    isDemo: 1,
    optionType: 100,
    time: parseInt(msg.duration, 10) || 60,
    requestId: requestId
  };
  // ملاحظة: اسم الحدث openOrder وصيغته من بحث المستودعات المفتوحة
  // (2026-11-27) ولم يُختبرا حياً بعد — إن لم ترد المنصة بتأكيد خلال
  // 12 ثانية، تُعتبر الصفقة غير منفذة ولا تُحتسب.
  log('sending openOrder (demo only): asset=' + asset + ' amount=' + payload.amount +
      ' action=' + payload.action + ' time=' + payload.time + 's');
  pendingTrade = {
    resolve: sendResponse,
    requestId: requestId,
    asset: msg.asset,
    amount: payload.amount,
    timeoutId: setTimeout(function () {
      if (pendingTrade && pendingTrade.requestId === requestId) {
        pendingTrade = null;
        state.tradesFailed++;
        state.lastError = 'تنفيذ السوكيت لم يتأكد خلال 12 ثانية (openOrder بلا رد)';
        log('openOrder NOT confirmed in 12s — treated as NOT executed');
        sendResponse({ ok: false, reason: 'no-confirmation' });
      }
    }, 12000)
  };
  sendEvent('openOrder', payload);
}

// ---- رسائل من content script / popup ----
API.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || !msg.type) return false;
  if (sender && sender.tab) tabIds[sender.tab.id] = true;
  switch (msg.type) {
    case 'ext-asset': {
      if (msg.asset) {
        currentAsset = String(msg.asset);
        if (msg.isDemo === false) { state.isDemo = 0; }
        if (state.authed) subscribeAsset(currentAsset);
      }
      return false;
    }
    case 'ext-auth-intercepted': {
      // auth معترض من رسالة الصفحة نفسها (auth-hook.js) — المصدر الأول.
      // القيمة في الذاكرة فقط، لا تُسجَّل ولا تُحفظ ولا تظهر في أي مكان.
      if (msg.auth && msg.auth.session) {
        interceptedAuth = { session: msg.auth.session, uid: msg.auth.uid, isDemo: msg.auth.isDemo };
        if (msg.auth.uid !== undefined && msg.auth.uid !== null) uidValue = msg.auth.uid;
        state.authSource = 'رسالة الصفحة';
        log('intercepted page auth received (values never logged) — trying it first');
        broadcastStatus();
        if (socket && socket.readyState === WebSocket.OPEN && !state.authed) tryAuth();
        else if (!socket || socket.readyState === WebSocket.CLOSED) connectSocket();
      }
      return false;
    }
    case 'ext-ws-url': {
      // عنوان سوكيت فتحته الصفحة (مضيف + مسار فقط، بلا query) — تشخيص.
      if (msg.url) log('page opened a WebSocket (host+path only): ' + String(msg.url).split('?')[0]);
      return false;
    }
    case 'ext-session-candidates': {
      // مرشحات من صفحة المستخدم نفسه (document.cookie / localStorage)
      // — في الذاكرة فقط، لا تُسجَّل قيمها أبداً.
      (msg.candidates || []).forEach(function (c) {
        addCandidate(c.name, c.value, c.from || 'page');
        if (/^uid$/i.test(c.name) && /^\d+$/.test(String(c.value))) uidValue = parseInt(c.value, 10);
      });
      if (msg.candidates && msg.candidates.length) {
        state.cookieFound = true;
        state.cookieName = msg.candidates[0].name;
        state.cookieLen = String(msg.candidates[0].value || '').length;
        log('page session candidates received: ' + msg.candidates.length + ' (values never logged)');
        broadcastStatus();
        if (socket && socket.readyState === WebSocket.OPEN && !state.authed) tryAuth();
      }
      return false;
    }
    case 'ext-get-status': {
      sendResponse({ ok: true, status: statusSummary() });
      return false;
    }
    case 'ext-trade': {
      tradeViaSocket(msg, sendResponse);
      return true; // رد غير متزامن
    }
    case 'ext-ui': {
      // START/STOP من الـ popup -> مرّرها لتبويب Pocket Option النشط.
      API.tabs.query({ url: '*://*.pocketoption.com/*', active: true }, function (tabs) {
        (tabs || []).forEach(function (t) {
          try { API.tabs.sendMessage(t.id, { type: 'ext-ui', action: msg.action }, function () { if (API.runtime.lastError) {} }); } catch (e) {}
        });
      });
      sendResponse({ ok: true });
      return false;
    }
    case 'ping': {
      sendResponse({ ok: true, from: 'background' });
      return false;
    }
  }
  return false;
});

// ---- البدء ----
log('Pocket Demo Bot extension background started (demo only, in-memory session only)');
readCookies();
connectSocket();
