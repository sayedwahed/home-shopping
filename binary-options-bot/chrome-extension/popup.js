/* popup.js — واجهة إضافة بوت الديمو (عربي، RTL)
 * بتقرا وتكتب الإعدادات في chrome.storage.local، وبتبعت أوامر
 * تشغيل/إيقاف للـ content script اللي في تبويب Pocket Option.
 * مفيش أي بيانات دخول هنا — المستخدم بيسجّل دخوله بنفسه في المتصفح.
 */
(function () {
  'use strict';

  const DEFAULTS = {
    strategy: 'confluence', asset: 'EURUSD', stake: 1.0, expirySec: 60,
    maxTrades: 10, dailyLossLimit: 10.0, maxConsecutiveLosses: 3,
    minPayout: 0.85, cooldownSec: 75, blockedHours: [], martingale: false
  };

  const $ = (id) => document.getElementById(id);

  function readForm() {
    return {
      strategy: $('strategy').value,
      asset: ($('asset').value || 'EURUSD').trim().toUpperCase(),
      stake: Math.max(0.5, parseFloat($('stake').value) || 1),
      expirySec: Math.max(30, parseInt($('expirySec').value, 10) || 60),
      maxTrades: Math.max(1, parseInt($('maxTrades').value, 10) || 10),
      dailyLossLimit: Math.max(1, parseFloat($('dailyLossLimit').value) || 10),
      minPayout: Math.min(0.99, Math.max(0.5, (parseFloat($('minPayout').value) || 85) / 100)),
      cooldownSec: Math.max(60, parseInt($('cooldownSec').value, 10) || 75)
    };
  }

  function fillForm(s) {
    $('strategy').value = s.strategy || DEFAULTS.strategy;
    $('asset').value = s.asset || DEFAULTS.asset;
    $('stake').value = s.stake != null ? s.stake : DEFAULTS.stake;
    $('expirySec').value = s.expirySec || DEFAULTS.expirySec;
    $('maxTrades').value = s.maxTrades || DEFAULTS.maxTrades;
    $('dailyLossLimit').value = s.dailyLossLimit != null ? s.dailyLossLimit : DEFAULTS.dailyLossLimit;
    $('minPayout').value = Math.round(((s.minPayout != null ? s.minPayout : DEFAULTS.minPayout)) * 100);
    $('cooldownSec').value = s.cooldownSec || DEFAULTS.cooldownSec;
  }

  function showMsg(t) { $('msg').textContent = t; }

  function sendToTab(message) {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || !tabs.length) { resolve(null); return; }
        chrome.tabs.sendMessage(tabs[0].id, message, (res) => {
          if (chrome.runtime.lastError) { resolve(null); return; }
          resolve(res);
        });
      });
    });
  }

  async function refreshStatus() {
    const st = await sendToTab({ type: 'getStatus' });
    const box = $('statusBox');
    if (!st) {
      box.textContent = 'الحالة: افتح تبويب Pocket Option الأول (وسجّل دخولك وبدّل للديمو) عشان البوت يظهر.';
      return;
    }
    const cal = st.calibrated || {};
    const calDone = ['price', 'call', 'put'].filter((k) => cal[k]).length;
    box.innerHTML =
      'الحالة: ' + (st.running ? '🟢 شغال' : '⚪ واقف') +
      ' | الحساب: ' + (st.isDemo ? 'ديمو ✅' : 'مش ديمو ❌') + '<br>' +
      'الاستراتيجية: ' + st.strategy + ' | شموع مجمّعة: ' + st.closes + '<br>' +
      'صفقات اليوم: ' + st.tradesToday + ' | مكسب: ' + st.winsToday + ' (' + st.winRate + '%)' +
      ' | صافي: $' + Number(st.dailyProfit).toFixed(2) + '<br>' +
      'المعايرة: ' + calDone + '/3 أساسية' +
      (cal.amount ? ' + مبلغ' : '') + (cal.balance ? ' + رصيد' : '') +
      (st.log && st.log.length ? '<br>آخر صفقة: ' + st.log[0].time + ' ' + st.log[0].dir + ' — ' + st.log[0].result : '');
  }

  $('saveBtn').addEventListener('click', async () => {
    const s = readForm();
    chrome.storage.local.set({ settings: s }, async () => {
      await sendToTab({ type: 'updateSettings', settings: s });
      showMsg('✅ الإعدادات اتحفظت.');
      refreshStatus();
    });
  });

  $('startBtn').addEventListener('click', async () => {
    const s = readForm();
    chrome.storage.local.set({ settings: s });
    const res = await sendToTab({ type: 'start' });
    if (!res) { showMsg('❌ افتح تبويب Pocket Option الأول.'); return; }
    showMsg(res.ok ? '✅ البوت شغال (لو الحساب ديمو والمعايرة جاهزة).' : '❌ البوت رفض يشتغل — شوف لوحة البوت في الصفحة (ديمو؟ معايرة؟).');
    refreshStatus();
  });

  $('stopBtn').addEventListener('click', async () => {
    await sendToTab({ type: 'stop' });
    showMsg('⛔ البوت وقف.');
    refreshStatus();
  });

  $('calBtn').addEventListener('click', async () => {
    const res = await sendToTab({ type: 'calibrate', kind: 'price' });
    if (!res) { showMsg('❌ افتح تبويب Pocket Option الأول.'); return; }
    showMsg('🎯 دوس على عنصر السعر في الصفحة، وبعدين دوس زر المعايرة تاني للعنصر اللي بعده.');
    window.close();
  });

  chrome.storage.local.get(['settings'], (res) => {
    fillForm(res.settings || DEFAULTS);
    refreshStatus();
  });
  setInterval(refreshStatus, 5000);
})();
