// ==UserScript==
// @name         Pocket Option Demo Auto Trader (human-like clicks)
// @namespace    https://example.local/pocket-demo-bot
// @version      1.0.1
// @description  Automated trading on the Pocket Option DEMO account only, by clicking CALL/PUT in the page like a human. No session token, no API, no login data — you log in yourself. For learning/testing on demo only.
// @match        https://pocketoption.com/*
// @match        https://*.pocketoption.com/*
// @match        https://m.pocketoption.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
/*
  سكربت أندرويد بديل (Kiwi Browser + Tampermonkey):
  - انت بتسجّل دخولك بنفسك في Kiwi، وبتبدّل للديمو بنفسك.
  - السكربت بيجمع السعر من الصفحة، بيبني شموع 60 ثانية، وبيحسب EMA+RSI+Stochastic
    وباقي المؤشرات بنفس منطق نسخة الكمبيوتر (مبسّط)، وبيضغط CALL/PUT في الواجهة بس.
  - مفيش أي توكن ولا API ولا بيانات دخول في السكربت ده.

  ⚠️ تحذير صريح: أتمتة الواجهة مخالفة لشروط Pocket Option وممكن تؤدي لحظر
  الحساب حتى على الديمو. للتعلم والتجربة على الديمو فقط، وبمبالغ صغيرة جداً.
  مفيش أي ضمان ربح. لو الموقع غيّر تصميمه، الأزرار ممكن متتلاقاش والسكربت هيقف بأمان.

  التركيب على أندرويد:
    1) نزّل Kiwi Browser من Google Play.
    2) نزّل إضافة Tampermonkey من Chrome Web Store جوّه Kiwi.
    3) افتح الملف ده في Kiwi، و Tampermonkey هيسألك تثبّته — دوس Install.
    4) افتح Pocket Option في Kiwi، سجّل دخولك، وبدّل للديمو.
    5) لوحة التحكم بتظهر على الصفحة — دوس START، والسكربت هيشتغل.
    6) للإيقاف دوس STOP في أي وقت (أو اقفل التبويب).
*/
(function () {
  'use strict';

  // ---------- الإعدادات (عدّل من هنا أو من لوحة التحكم) ----------
  const CFG = {
    strategy: 'confluence',   // trend_ema_rsi | reversal_rsi_stoch | pullback | alligator_rsi | confluence
    stake: 1.0,               // مبلغ الصفقة بالدولار (ديمو، صغير جداً)
    expirySec: 60,            // مدة الصفقة بالثواني
    maxTrades: 10,            // أقصى صفقات في اليوم
    dailyLossLimit: 10.0,     // أقصى خسارة يومية بالدولار
    maxConsecutiveLosses: 3,  // إيقاف بعد 3 خساير ورا بعض
    minPayout: 0.85,          // فلتر العائد: مفيش دخول لو العائد أقل من 85%
    cooldownSec: 75,          // انتظار بين الصفقات
  };
  let running = false, tradesToday = 0, dailyProfit = 0, consecLosses = 0, lastTradeAt = 0;
  let closes = [];            // أسعار إغلاق الشموع (60 ثانية)
  let curCandle = null;       // الشمعة الحالية اللي بتتبني من السعر الحي

  // ---------- المؤشرات (نفس منطق indicators.py، مبسّط) ----------
  function ema(values, period) {
    if (values.length < period) return null;
    const k = 2 / (period + 1);
    let r = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < values.length; i++) r = values[i] * k + r * (1 - k);
    return r;
  }
  function rsi(values, period = 14) {
    if (values.length < period + 1) return null;
    let g = 0, l = 0;
    for (let i = 1; i <= period; i++) { const c = values[i] - values[i - 1]; g += Math.max(c, 0); l += Math.max(-c, 0); }
    let ag = g / period, al = l / period;
    for (let i = period + 1; i < values.length; i++) {
      const c = values[i] - values[i - 1];
      ag = (ag * (period - 1) + Math.max(c, 0)) / period;
      al = (al * (period - 1) + Math.max(-c, 0)) / period;
    }
    return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  function stoch(closes, p = 14) {
    if (closes.length < p + 3) return [null, null];
    const ks = [];
    for (let i = p - 1; i < closes.length; i++) {
      const w = closes.slice(i - p + 1, i + 1);
      const hi = Math.max(...w), lo = Math.min(...w);
      ks.push(hi === lo ? 0 : 100 * (closes[i] - lo) / (hi - lo));
    }
    return [ks[ks.length - 1], ks.slice(-3).reduce((a, b) => a + b, 0) / 3];
  }
  function macdHist(closes) {
    if (closes.length < 35) return null;
    const e12 = ema(closes, 12), e26 = ema(closes, 26);
    return e12 - e26; // مبسّط: إشارة الهيستوجرام من فرق EMA12-EMA26
  }
  function smma(values, period) {
    if (values.length < period) return null;
    let r = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < values.length; i++) r = (r * (period - 1) + values[i]) / period;
    return r;
  }

  // ---------- الاستراتيجيات ----------
  function decide() {
    if (closes.length < 60) return { dir: null, votes: [], reason: 'بيانات مش كفاية (محتاج 60 شمعة)' };
    const e9 = ema(closes, 9), e21 = ema(closes, 21), e50 = ema(closes, 50);
    const r = rsi(closes), [sk, sd] = stoch(closes), mh = macdHist(closes);
    const jaw = smma(closes, 13), teeth = smma(closes, 8), lips = smma(closes, 5);
    const last = closes[closes.length - 1];
    if (r >= 70 || r <= 30) return { dir: null, votes: [], reason: 'RSI متطرف (' + r.toFixed(0) + ')' };

    if (CFG.strategy === 'trend_ema_rsi') {
      if (e9 > e21 && last > e9 && r < 65) return { dir: 'CALL', votes: ['EMA', 'RSI'], reason: 'EMA9 فوق EMA21 و RSI تحت 65' };
      if (e9 < e21 && last < e9 && r > 35) return { dir: 'PUT', votes: ['EMA', 'RSI'], reason: 'EMA9 تحت EMA21 و RSI فوق 35' };
    }
    if (CFG.strategy === 'reversal_rsi_stoch') {
      if (r < 30 && sk < 20 && sk > sd) return { dir: 'CALL', votes: ['RSI', 'Stochastic'], reason: 'تشبع بيع + Stochastic طالع' };
      if (r > 70 && sk > 80 && sk < sd) return { dir: 'PUT', votes: ['RSI', 'Stochastic'], reason: 'تشبع شراء + Stochastic نازل' };
    }
    if (CFG.strategy === 'pullback') {
      if (last > e50 && e9 > e50 && r > 35 && r < 50) return { dir: 'CALL', votes: ['EMA50', 'RSI'], reason: 'ترند صاعد + Pullback' };
      if (last < e50 && e9 < e50 && r > 50 && r < 65) return { dir: 'PUT', votes: ['EMA50', 'RSI'], reason: 'ترند هابط + Pullback' };
    }
    if (CFG.strategy === 'alligator_rsi') {
      if (lips > teeth && teeth > jaw && last > lips && r < 65) return { dir: 'CALL', votes: ['Alligator', 'RSI'], reason: 'Alligator لفوق' };
      if (lips < teeth && teeth < jaw && last < lips && r > 35) return { dir: 'PUT', votes: ['Alligator', 'RSI'], reason: 'Alligator لتحت' };
    }
    // confluence (افتراضي): 3 مؤشرات على الأقل
    const callVotes = [], putVotes = [];
    if (e9 > e21) callVotes.push('EMA'); else putVotes.push('EMA');
    if (r < 45) callVotes.push('RSI'); else if (r > 55) putVotes.push('RSI');
    if (sk > sd && sk < 80) callVotes.push('Stochastic'); else if (sk < sd && sk > 20) putVotes.push('Stochastic');
    if (mh > 0) callVotes.push('MACD'); else putVotes.push('MACD');
    if (lips > teeth && teeth > jaw) callVotes.push('Alligator'); else if (lips < teeth && teeth < jaw) putVotes.push('Alligator');
    if (callVotes.length >= 3 && callVotes.length > putVotes.length) return { dir: 'CALL', votes: callVotes, reason: 'اتفاق ' + callVotes.length + ' مؤشرات' };
    if (putVotes.length >= 3 && putVotes.length > callVotes.length) return { dir: 'PUT', votes: putVotes, reason: 'اتفاق ' + putVotes.length + ' مؤشرات' };
    return { dir: null, votes: [], reason: 'مفيش اتفاق كافي (CALL: ' + callVotes.length + '، PUT: ' + putVotes.length + ')' };
  }

  // ---------- قراءة السعر من الصفحة ----------
  function readPrice() {
    // بيجرّب كذا طريقة: عنصر السعر الحالي، أو أي رقم عشري كبير في منطقة التداول
    const el = document.querySelector('[class*="price"] [class*="value"], [data-test*="price"]');
    if (el) { const v = parseFloat(el.textContent.replace(/[^\d.]/g, '')); if (v) return v; }
    return null;
  }
  function readPayout() {
    const m = document.body.innerText.match(/(\d{1,3})\s*%/);
    return m ? parseInt(m[1], 10) / 100 : 0.92;
  }
  function isDemo() { return /Demo/i.test(document.body.innerText); }
  function findButton(label) {
    const btns = [...document.querySelectorAll('button')];
    return btns.find(b => b.offsetParent && new RegExp(label, 'i').test(b.textContent));
  }
  function humanDelay(minMs, maxMs) {
    return new Promise(r => setTimeout(r, minMs + Math.random() * (maxMs - minMs)));
  }
  function logLine(msg) {
    const el = document.getElementById('muse-bot-log');
    if (el) el.textContent = new Date().toLocaleTimeString() + ' | ' + msg + '\n' + el.textContent.slice(0, 2000);
    console.log('[PocketDemoBot]', msg);
  }

  // ---------- تنفيذ الصفقة (ضغطة زر في الواجهة) ----------
  async function executeTrade(dir, votes) {
    if (Date.now() - lastTradeAt < CFG.cooldownSec * 1000) return;
    if (tradesToday >= CFG.maxTrades) { logLine('وصلنا لحد الصفقات اليومي — إيقاف.'); stopBot(); return; }
    if (dailyProfit <= -CFG.dailyLossLimit) { logLine('وصلنا لحد الخسارة اليومية — إيقاف.'); stopBot(); return; }
    const payout = readPayout();
    if (payout < CFG.minPayout) { logLine('العائد ' + Math.round(payout * 100) + '% أقل من 85% — تخطّي.'); return; }
    const btn = findButton(dir === 'CALL' ? 'Call|شراء|صعود|أعلى' : 'Put|بيع|هبوط|أسفل');
    if (!btn) { logLine('❌ مش لاقي زر ' + dir + ' في الواجهة — الصفقة اتلغت (الموقع ممكن يكون اتغيّر).'); return; }
    lastTradeAt = Date.now();
    tradesToday++;
    const balanceBefore = (document.body.innerText.match(/\$\s*([\d,]+\.\d{2})/) || [])[1];
    await humanDelay(800, 2500);
    btn.click();
    logLine('✅ ضغط ' + dir + ' | وافقت: ' + votes.join(', ') + ' | صفقات اليوم: ' + tradesToday);
    await new Promise(r => setTimeout(r, (CFG.expirySec + 10) * 1000));
    const balanceAfter = (document.body.innerText.match(/\$\s*([\d,]+\.\d{2})/) || [])[1];
    let result = 'unknown', profit = 0;
    if (balanceBefore && balanceAfter) {
      const diff = parseFloat(balanceAfter.replace(/,/g, '')) - parseFloat(balanceBefore.replace(/,/g, ''));
      if (Math.abs(diff - CFG.stake * payout) < 0.05) { result = 'win'; profit = CFG.stake * payout; }
      else if (Math.abs(diff + CFG.stake) < 0.05) { result = 'loss'; profit = -CFG.stake; }
      else if (Math.abs(diff) < 0.01) { result = 'draw'; }
    }
    dailyProfit += profit;
    if (result === 'loss') { consecLosses++; if (consecLosses >= CFG.maxConsecutiveLosses) { logLine('3 خساير ورا بعض — إيقاف.'); stopBot(); } }
    else if (result === 'win') consecLosses = 0;
    logLine('نتيجة الصفقة: ' + result + ' | صافي اليوم: $' + dailyProfit.toFixed(2));
  }

  // ---------- الحلقة الرئيسية: بناء الشموع من السعر الحي ----------
  setInterval(() => {
    if (!running) return;
    const price = readPrice();
    if (!price) return;
    const now = Math.floor(Date.now() / 1000);
    const bucket = now - (now % 60);
    if (!curCandle || curCandle.time !== bucket) {
      if (curCandle) { closes.push(curCandle.close); if (closes.length > 200) closes.shift(); }
      curCandle = { time: bucket, close: price };
    } else curCandle.close = price;
  }, 1000);

  setInterval(async () => {
    if (!running || closes.length < 60) return;
    const s = decide();
    const status = document.getElementById('muse-bot-status');
    if (status) status.textContent = 'سعر: ' + (curCandle ? curCandle.close : '-') + ' | ' + s.reason;
    if (!s.dir) return;
    await executeTrade(s.dir, s.votes);
  }, 15000);

  // ---------- لوحة التحكم ----------
  function buildPanel() {
    const p = document.createElement('div');
    p.id = 'muse-bot-panel';
    p.style.cssText = 'position:fixed;bottom:10px;right:10px;z-index:999999;background:#222;color:#fff;'
      + 'padding:12px;border-radius:10px;font-size:13px;width:230px;box-shadow:0 0 12px #000;';
    p.innerHTML = '<b>🤖 Pocket Demo Bot</b><br>'
      + '<span style="color:#f39c12">ديمو بس — أتمتة الواجهة مخالفة لشروط المنصة وقد تؤدي للحظر.</span><br>'
      + 'الاستراتيجية: <select id="muse-strategy">'
      + ['confluence', 'trend_ema_rsi', 'reversal_rsi_stoch', 'pullback', 'alligator_rsi']
        .map(s => '<option value="' + s + '"' + (s === CFG.strategy ? ' selected' : '') + '>' + s + '</option>').join('')
      + '</select><br>'
      + '<button id="muse-start" style="background:#27ae60;color:#fff;padding:8px 14px;border:none;border-radius:6px;margin-top:8px">▶ START</button> '
      + '<button id="muse-stop" style="background:#c0392b;color:#fff;padding:8px 14px;border:none;border-radius:6px">⛔ STOP</button>'
      + '<div id="muse-bot-status" style="margin-top:8px;color:#ccc">مستني START...</div>'
      + '<pre id="muse-bot-log" style="max-height:120px;overflow:auto;font-size:11px;color:#aaa"></pre>';
    document.body.appendChild(p);
    document.getElementById('muse-strategy').onchange = e => { CFG.strategy = e.target.value; logLine('الاستراتيجية: ' + CFG.strategy); };
    document.getElementById('muse-start').onclick = () => {
      if (!isDemo()) { alert('الحساب مش ديمو! بدّل للديمو الأول — السكربت مش هيشتغل على حساب حقيقي.'); return; }
      if (!confirm('تأكيد: الحساب ده ديمو فعلاً؟ السكربت هيضغط CALL/PUT بنفسه.')) return;
      running = true; logLine('السكربت شغال — استراتيجية ' + CFG.strategy);
    };
    document.getElementById('muse-stop').onclick = stopBot;
  }
  function stopBot() { running = false; logLine('السكربت وقف.'); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildPanel);
  else buildPanel();
})();
