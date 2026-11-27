/* popup.js — Pocket Demo Bot (Firefox Extension)
 * يعرض الحالة فقط، ولا يعرض أي قيمة جلسة أبداً.
 * START/STOP يُمرَّران إلى content script في تبويب Pocket Option النشط.
 */
'use strict';

var API = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

function render(status) {
  var el = document.getElementById('status');
  if (!el || !status) return;
  function tick(v) { return v ? '✅' : '❌'; }
  var age = status.lastTickAt ? Math.floor((Date.now() - status.lastTickAt) / 1000) + ' ث' : '—';
  el.innerHTML =
    'كوكي الجلسة: ' + tick(status.cookie) + (status.cookie ? ' (' + status.cookieName + ')' : ' — سجّل دخولك أولاً') + '\n' +
    'المصادقة: ' + tick(status.authed) + (status.authSource ? ' (' + status.authSource + ')' : '') + '\n' +
    'سوكيت الأسعار: ' + status.socket + '\n' +
    'موثّق (successauth): ' + tick(status.authed) + '\n' +
    'الحساب: ' + (status.isDemo === 1 ? 'ديمو ✅' : (status.isDemo === 0 ? 'حقيقي ❌ — التنفيذ مقفول' : 'غير معروف بعد')) + '\n' +
    'آخر سعر: ' + (status.lastPrice !== null ? status.lastPrice : '-') + ' (' + (status.lastAsset || '—') + ', منذ ' + age + ')\n' +
    'آخر حدث: ' + (status.lastEvent || '—') + '\n' +
    'أول رسالة: ' + (status.firstMsgShape ? status.firstMsgShape.event + ' {' + (status.firstMsgShape.keys || []).join(', ') + '}' : '—') + '\n' +
    'عينات الأحداث: ' + (status.samples || []).slice(0, 5).join(', ') + '\n' +
    (status.lastError ? '⚠️ ' + status.lastError : '');
}
function refresh() {
  try {
    var p = API.runtime.sendMessage({ type: 'ext-get-status' });
    if (p && typeof p.then === 'function') {
      p.then(function (res) { if (res && res.status) render(res.status); })
       .catch(function () { document.getElementById('status').textContent = 'الخلفية لا ترد — أعد تحميل الإضافة.'; });
    }
  } catch (e) { /* تجاهل */ }
}
document.getElementById('start').addEventListener('click', function () {
  try { API.runtime.sendMessage({ type: 'ext-ui', action: 'start' }); } catch (e) {}
});
document.getElementById('stop').addEventListener('click', function () {
  try { API.runtime.sendMessage({ type: 'ext-ui', action: 'stop' }); } catch (e) {}
});
refresh();
setInterval(refresh, 2000);
