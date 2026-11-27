/* auth-hook.js — Pocket Demo Bot, Firefox Extension (Manifest V2)
 * يعمل عند document_start، قبل أي سكربت في الصفحة، ليعترض رسالة
 * المصادقة التي ترسلها الصفحة نفسها — نفس فكرة الـ SSID Fetcher
 * الرسمي في BinaryOptionsToolsV2: اعتراض رسائل WebSocket الصادرة،
 * وعند رؤية 42["auth", {...}] تُؤخذ منها session و uid و isDemo.
 *
 * كيف يعمل: يغلّف WebSocket.prototype.send و XMLHttpRequest.send
 * و fetch في سياق الصفحة، ويفحص النصوص الصادرة بحثاً عن 42["auth".
 * عند العثور عليها: يحفظها في window.__poAuthLast (في الذاكرة فقط،
 * داخل الصفحة نفسها) ويرسلها postMessage إلى content script، الذي
 * يمررها للخلفية — القيمة لا تُسجَّل ولا تُحفظ ولا تُرسَل لأي جهة
 * خارج المتصفح إطلاقاً. اللوحة تعرض "مصادقة: نعم/لا" فقط.
 * كما يسجّل عناوين السوكيتات التي تفتحها الصفحة (المضيف والمسار فقط،
 * بلا أي query أو قيمة) لأغراض التشخيص.
 *
 * ملاحظة: إن كانت الصفحة قد أرسلت auth قبل تثبيت الخطاف (تبويب مفتوح
 * قبل تثبيت الإضافة)، فلن يرى الاعتراض شيئاً — حينها تقرأ الخلفية
 * الجلسة من الكوكيز عبر cookies API كبديل، أو يعيد المستخدم تحميل
 * الصفحة فيرسل المتصفح auth من جديد ويلتقطها الخطاف.
 */
(function () {
  'use strict';

  // استخراج مصفوفة JSON كاملة من نص يبدأ عند index معيّن ('[').
  function extractJsonArray(text, startIdx) {
    var depth = 0, inStr = false, esc = false, i;
    for (i = startIdx; i < text.length; i++) {
      var ch = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
      } else {
        if (ch === '"') inStr = true;
        else if (ch === '[') depth++;
        else if (ch === ']') { depth--; if (depth === 0) return text.slice(startIdx, i + 1); }
      }
    }
    return null;
  }
  function handleAuthArray(arr) {
    try {
      if (!arr || arr[0] !== 'auth') return;
      var p = arr[1] || {};
      if (!p.session) return;
      var auth = { session: p.session, uid: p.uid, isDemo: p.isDemo, platform: p.platform };
      window.__poAuthLast = auth;
      try { window.postMessage({ __poAuth: auth }, window.location.origin); } catch (e) {}
    } catch (e) {}
  }
  function scanForAuth(text) {
    try {
      if (typeof text !== 'string' || text.indexOf('auth') === -1) return;
      var idx = text.indexOf('42["auth"');
      if (idx === -1) return;
      var bracket = text.indexOf('[', idx + 2);
      if (bracket === -1) return;
      var json = extractJsonArray(text, bracket);
      if (!json) return;
      var arr = JSON.parse(json);
      handleAuthArray(arr);
    } catch (e) {}
  }
  function postWsUrl(url) {
    try {
      var u = String(url || '');
      // المضيف والمسار فقط — بلا query (قد يحمل بيانات).
      var hostPath = u.split('?')[0];
      window.postMessage({ __poWsUrl: hostPath }, window.location.origin);
    } catch (e) {}
  }

  try {
    // 1) اعتراض WebSocket.send (المسار الرئيسي — socket.io يستخدمه).
    var OrigSend = window.WebSocket.prototype.send;
    window.WebSocket.prototype.send = function (data) {
      try { scanForAuth(data); } catch (e) {}
      return OrigSend.call(this, data);
    };
    // 2) تسجيل عناوين السوكيتات التي تفتحها الصفحة (تشخيص فقط).
    var OrigWS = window.WebSocket;
    var WrappedWS = function (url, protocols) {
      try { postWsUrl(url); } catch (e) {}
      return protocols ? new OrigWS(url, protocols) : new OrigWS(url);
    };
    WrappedWS.prototype = OrigWS.prototype;
    ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (k) {
      try { WrappedWS[k] = OrigWS[k]; } catch (e) {}
    });
    window.WebSocket = WrappedWS;
    // 3) Engine.IO قد يبدأ بـ long-polling عبر XHR/fetch — افحص أجسادها أيضاً.
    var OrigXhrSend = window.XMLHttpRequest.prototype.send;
    window.XMLHttpRequest.prototype.send = function (body) {
      try { if (typeof body === 'string') scanForAuth(body); } catch (e) {}
      return OrigXhrSend.call(this, body);
    };
    if (window.fetch) {
      var OrigFetch = window.fetch;
      window.fetch = function (input, init) {
        try {
          var b = init && init.body;
          if (typeof b === 'string') scanForAuth(b);
        } catch (e) {}
        return OrigFetch.apply(this, arguments);
      };
    }
  } catch (e) {
    // إن فشل التغليف (CSP أو غيره)، الكوكيز تبقى البديل — لا نوقف الصفحة.
  }
})();
