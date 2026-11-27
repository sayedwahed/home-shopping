/* background.js — Service Worker (Manifest V3)
 * دوره بسيط جداً: ترحيل رسائل بين الـ popup والـ content script عند الحاجة.
 * مفيش أي اتصال خارجي، مفيش جمع بيانات، مفيش SSID ولا API ولا بيانات دخول.
 * الـ popup بيبعت رسائله للتبويب النشط مباشرة في العادة؛ الـ background ده
 * موجود كوسيط احتياطي ولتسجيل بسيط في الـ console فقط.
 */
'use strict';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;

  // رسالة موجّهة لتبويب معين (عن طريق tabId): مرّرها للـ content script فيه.
  if (message.tabId) {
    chrome.tabs.sendMessage(message.tabId, message, (res) => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      sendResponse(res);
    });
    return true; // رد غير متزامن
  }

  // رسائل التشخيص البسيطة فقط.
  if (message.type === 'ping') {
    sendResponse({ ok: true, from: 'background' });
    return false;
  }
  return false;
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('[PocketDemoBot] الإضافة اتثبّتت — ديمو بس، بدون SSID وبدون API.');
});
