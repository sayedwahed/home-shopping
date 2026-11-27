/* content.js — Pocket Option Demo Bot (Chrome Extension, Manifest V3)
 *
 * بيعمل إيه:
 * - بيشتغل جوه صفحة Pocket Option بس، بعد ما انت تسجّل دخولك بنفسك وتبدّل للديمو بنفسك.
 * - مفيش SSID ولا API ولا أي بيانات دخول في الإضافة دي إطلاقاً.
 * - بيجمع السعر من الصفحة، يبني شموع 60 ثانية، يحسب المؤشرات (EMA/RSI/
 *   Stochastic/MACD/Bollinger/Alligator)، يطبّق استراتيجية + فلاتر، وبعدين
 *   يضغط زر CALL/PUT في الواجهة مثل الإنسان (تأخير عشوائي قبل الضغطة).
 * - المعايرة البصرية: انت بتضغط بنفسك مرة واحدة على عناصر السعر و CALL و PUT
 *   والمبلغ والرصيد، والإضافة بتحفظ محدداتها (selectors) في chrome.storage.
 *   لو الموقع غيّر تصميمه، المحددات ممكن متلاقيش العناصر — البوت بيقف بأمان.
 *
 * ⚠️ تحذير صريح: أتمتة الواجهة مخالفة لشروط استخدام Pocket Option وممكن تؤدي
 * لحظر الحساب حتى على الديمو. للتعلم والتجربة على الديمو فقط، وبمبالغ صغيرة
 * جداً. مفيش أي ضمان ربح. نقطة التعادل حوالي 52% فوز عند عائد 92%.
 */
(function () {
  'use strict';

  // ---------- الإعدادات الافتراضية (نفس config.py) ----------
  const DEFAULTS = {
    strategy: 'confluence', // trend_ema_rsi | reversal_rsi_stoch | pullback | alligator_rsi | confluence
    asset: 'EURUSD',
    stake: 1.0,
    expirySec: 60,
    maxTrades: 10,
    dailyLossLimit: 10.0,
    maxConsecutiveLosses: 3,
    minPayout: 0.85, // فلتر العائد: مفيش دخول لو أقل من 85%
    cooldownSec: 75,
    blockedHours: [], // ساعات ممنوعة، مثلاً [0, 1, 2, 3]
    martingale: false // مقفول خالص — مضاعفة المبلغ بعد الخسارة أسرع طريق لتصفير الحساب
  };

  let CFG = { ...DEFAULTS };
  let SEL = {}; // محددات المعايرة: { price, call, put, amount, balance }
  let running = false;
  let closes = []; // أسعار إغلاق الشموع (60 ثانية)
  let curCandle = null;
  let tradesToday = 0, winsToday = 0, dailyProfit = 0, consecLosses = 0;
  let lastTradeAt = 0, lastDecisionAt = 0;
  let todayKey = new Date().toDateString();
  let calibrating = null; // 'price' | 'call' | 'put' | 'amount' | 'balance' | null
  let tradeLog = [];

  // ---------- تخزين ----------
  function loadStored() {
    return new Promise((resolve) => {
      chrome.storage.local.get(
        ['settings', 'selectors', 'stats', 'tradeLog'],
        (res) => {
          if (res.settings) CFG = { ...DEFAULTS, ...res.settings };
          if (res.selectors) SEL = res.selectors || {};
          if (res.stats && res.stats.date === todayKey) {
            tradesToday = res.stats.tradesToday || 0;
            winsToday = res.stats.winsToday || 0;
            dailyProfit = res.stats.dailyProfit || 0;
            consecLosses = res.stats.consecLosses || 0;
          }
          if (Array.isArray(res.tradeLog)) tradeLog = res.tradeLog.slice(-50);
          resolve();
        }
      );
    });
  }
  function saveStats() {
    chrome.storage.local.set({
      stats: { date: todayKey, tradesToday, winsToday, dailyProfit, consecLosses },
      tradeLog
    });
  }
  function saveSettings() { chrome.storage.local.set({ settings: CFG }); }
  function saveSelectors() { chrome.storage.local.set({ selectors: SEL }); }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.settings && changes.settings.newValue) {
      CFG = { ...DEFAULTS, ...changes.settings.newValue };
      logLine('الإعدادات اتحدّثت: استراتيجية ' + CFG.strategy);
      renderPanel();
    }
    if (changes.selectors && changes.selectors.newValue) SEL = changes.selectors.newValue || {};
  });

  // ---------- المؤشرات (نفس منطق indicators.py) ----------
  function ema(values, period) {
    if (values.length < period) return null;
    const k = 2 / (period + 1);
    let r = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < values.length; i++) r = values[i] * k + r * (1 - k);
    return r;
  }
  function rsi(values, period) {
    if (values.length < period + 1) return null;
    let g = 0, l = 0;
    for (let i = 1; i <= period; i++) {
      const c = values[i] - values[i - 1];
      g += Math.max(c, 0); l += Math.max(-c, 0);
    }
    let ag = g / period, al = l / period;
    for (let i = period + 1; i < values.length; i++) {
      const c = values[i] - values[i - 1];
      ag = (ag * (period - 1) + Math.max(c, 0)) / period;
      al = (al * (period - 1) + Math.max(-c, 0)) / period;
    }
    return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  function stoch(closes, p) {
    p = p || 14;
    if (closes.length < p + 3) return [null, null];
    const ks = [];
    for (let i = p - 1; i < closes.length; i++) {
      const w = closes.slice(i - p + 1, i + 1);
      const hi = Math.max.apply(null, w), lo = Math.min.apply(null, w);
      ks.push(hi === lo ? 0 : 100 * (closes[i] - lo) / (hi - lo));
    }
    return [ks[ks.length - 1], ks.slice(-3).reduce((a, b) => a + b, 0) / 3];
  }
  function macd(closes) {
    if (closes.length < 35) return null;
    const e12 = ema(closes, 12), e26 = ema(closes, 26);
    if (e12 === null || e26 === null) return null;
    // خط MACD = EMA12 - EMA26، والإشارة = EMA9 لسلسلة خط MACD
    const line = [];
    for (let i = 26; i < closes.length; i++) {
      const a = ema(closes.slice(0, i + 1), 12), b = ema(closes.slice(0, i + 1), 26);
      if (a !== null && b !== null) line.push(a - b);
    }
    if (line.length < 9) return { macd: e12 - e26, signal: null, hist: null };
    const signal = ema(line, 9);
    const last = line[line.length - 1];
    return { macd: last, signal, hist: signal === null ? null : last - signal };
  }
  function bollinger(values, period, mult) {
    period = period || 20; mult = mult || 2;
    if (values.length < period) return null;
    const w = values.slice(-period);
    const mean = w.reduce((a, b) => a + b, 0) / period;
    const sd = Math.sqrt(w.reduce((a, b) => a + (b - mean) * (b - mean), 0) / period);
    return {
      upper: mean + mult * sd, middle: mean, lower: mean - mult * sd,
      bandwidth: mean === 0 ? 0 : ((mean + mult * sd) - (mean - mult * sd)) / mean * 100
    };
  }
  function smma(values, period) {
    if (values.length < period) return null;
    let r = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < values.length; i++) r = (r * (period - 1) + values[i]) / period;
    return r;
  }
  function computeAll() {
    const r = rsi(closes, 14), stk = stoch(closes, 14), m = macd(closes), bb = bollinger(closes);
    return {
      close: closes.length ? closes[closes.length - 1] : null,
      ema9: ema(closes, 9), ema21: ema(closes, 21), ema50: ema(closes, 50),
      rsi: r, stochK: stk[0], stochD: stk[1],
      macd: m ? m.macd : null, macdHist: m ? m.hist : null,
      bbUpper: bb ? bb.upper : null, bbMiddle: bb ? bb.middle : null,
      bbLower: bb ? bb.lower : null, bbBandwidth: bb ? bb.bandwidth : null,
      gatorJaw: smma(closes, 13), gatorTeeth: smma(closes, 8), gatorLips: smma(closes, 5)
    };
  }

  // ---------- الاستراتيجيات (نفس منطق strategies.py) ----------
  function decide() {
    if (closes.length < 60) return { dir: null, votes: [], reason: 'بيانات مش كفاية (محتاج 60 شمعة)' };
    const ind = computeAll();
    const last = ind.close;
    if (ind.rsi !== null && (ind.rsi >= 70 || ind.rsi <= 30)) {
      return { dir: null, votes: [], reason: 'RSI متطرف (' + ind.rsi.toFixed(0) + ')', ind };
    }
    if (CFG.strategy === 'trend_ema_rsi') {
      if (ind.ema9 > ind.ema21 && last > ind.ema9 && ind.rsi < 65)
        return { dir: 'CALL', votes: ['EMA', 'RSI'], reason: 'EMA9 فوق EMA21 و RSI تحت 65', ind };
      if (ind.ema9 < ind.ema21 && last < ind.ema9 && ind.rsi > 35)
        return { dir: 'PUT', votes: ['EMA', 'RSI'], reason: 'EMA9 تحت EMA21 و RSI فوق 35', ind };
      return { dir: null, votes: [], reason: 'مفيش ترند واضح', ind };
    }
    if (CFG.strategy === 'reversal_rsi_stoch') {
      if (ind.rsi < 30 && ind.stochK < 20 && ind.stochK > ind.stochD)
        return { dir: 'CALL', votes: ['RSI', 'Stochastic'], reason: 'تشبع بيع + Stochastic طالع', ind };
      if (ind.rsi > 70 && ind.stochK > 80 && ind.stochK < ind.stochD)
        return { dir: 'PUT', votes: ['RSI', 'Stochastic'], reason: 'تشبع شراء + Stochastic نازل', ind };
      return { dir: null, votes: [], reason: 'مفيش منطقة انعكاس', ind };
    }
    if (CFG.strategy === 'pullback') {
      if (last > ind.ema50 && ind.ema9 > ind.ema50 && ind.rsi > 35 && ind.rsi < 50)
        return { dir: 'CALL', votes: ['EMA50', 'RSI'], reason: 'ترند صاعد + Pullback', ind };
      if (last < ind.ema50 && ind.ema9 < ind.ema50 && ind.rsi > 50 && ind.rsi < 65)
        return { dir: 'PUT', votes: ['EMA50', 'RSI'], reason: 'ترند هابط + Pullback', ind };
      return { dir: null, votes: [], reason: 'مفيش Pullback واضح', ind };
    }
    if (CFG.strategy === 'alligator_rsi') {
      if (ind.gatorLips > ind.gatorTeeth && ind.gatorTeeth > ind.gatorJaw && last > ind.gatorLips && ind.rsi < 65)
        return { dir: 'CALL', votes: ['Alligator', 'RSI'], reason: 'Alligator لفوق', ind };
      if (ind.gatorLips < ind.gatorTeeth && ind.gatorTeeth < ind.gatorJaw && last < ind.gatorLips && ind.rsi > 35)
        return { dir: 'PUT', votes: ['Alligator', 'RSI'], reason: 'Alligator لتحت', ind };
      return { dir: null, votes: [], reason: 'التمساح نايم (الخطوط متشابكة)', ind };
    }
    // confluence (افتراضي): 3 مؤشرات على الأقل
    const callVotes = [], putVotes = [];
    if (ind.ema9 > ind.ema21) callVotes.push('EMA'); else putVotes.push('EMA');
    if (ind.rsi < 45) callVotes.push('RSI'); else if (ind.rsi > 55) putVotes.push('RSI');
    if (ind.stochK > ind.stochD && ind.stochK < 80) callVotes.push('Stochastic');
    else if (ind.stochK < ind.stochD && ind.stochK > 20) putVotes.push('Stochastic');
    if (ind.macdHist !== null && ind.macdHist > 0) callVotes.push('MACD');
    else if (ind.macdHist !== null) putVotes.push('MACD');
    if (ind.bbMiddle !== null && last < ind.bbMiddle) callVotes.push('Bollinger');
    else if (ind.bbMiddle !== null) putVotes.push('Bollinger');
    if (ind.gatorLips > ind.gatorTeeth && ind.gatorTeeth > ind.gatorJaw) callVotes.push('Alligator');
    else if (ind.gatorLips < ind.gatorTeeth && ind.gatorTeeth < ind.gatorJaw) putVotes.push('Alligator');
    if (callVotes.length >= 3 && callVotes.length > putVotes.length)
      return { dir: 'CALL', votes: callVotes, reason: 'اتفاق ' + callVotes.length + ' مؤشرات', ind };
    if (putVotes.length >= 3 && putVotes.length > callVotes.length)
      return { dir: 'PUT', votes: putVotes, reason: 'اتفاق ' + putVotes.length + ' مؤشرات', ind };
    return { dir: null, votes: [], reason: 'مفيش اتفاق كافي (CALL: ' + callVotes.length + '، PUT: ' + putVotes.length + ')', ind };
  }

  // ---------- الفلاتر (نفس منطق filters.py) ----------
  function applyFilters(ind, dir, payout) {
    const failed = [], details = {};
    // 1) فلتر الترند: الدخول مع الترند بس
    if (dir === 'CALL') {
      if (ind.ema9 > ind.ema21 && ind.ema21 > ind.ema50) details.trend = 'ترند صاعد واضح';
      else { failed.push('trend'); details.trend = 'CALL عكس الترند — الفلتر رفض'; }
    } else if (dir === 'PUT') {
      if (ind.ema9 < ind.ema21 && ind.ema21 < ind.ema50) details.trend = 'ترند هابط واضح';
      else { failed.push('trend'); details.trend = 'PUT عكس الترند — الفلتر رفض'; }
    }
    // ملحوظة: استراتيجية الانعكاس (reversal) بطبيعتها عكس الترند، ففلتر الترند
    // بيتخطّى ليها — القرار بتاعها مبني على التشبع مش على الترند.
    if (CFG.strategy === 'reversal_rsi_stoch') {
      const i = failed.indexOf('trend');
      if (i !== -1) { failed.splice(i, 1); details.trend = 'متخطّى (استراتيجية انعكاس)'; }
    }
    // 2) فلتر العائد
    if (payout === null || payout === undefined) {
      failed.push('payout'); details.payout = 'العائد مش معروف — الفلتر رفض';
    } else if (payout >= CFG.minPayout) {
      details.payout = 'العائد ' + Math.round(payout * 100) + '%';
    } else {
      failed.push('payout'); details.payout = 'العائد ' + Math.round(payout * 100) + '% أقل من ' + Math.round(CFG.minPayout * 100) + '%';
    }
    // 3) فلتر السوق العرضي / التذبذب المنخفض
    const price = ind.close || 1;
    const spread = (Math.max(ind.ema9, ind.ema21, ind.ema50) - Math.min(ind.ema9, ind.ema21, ind.ema50)) / price * 100;
    if (spread < 0.05) { failed.push('sideways'); details.sideways = 'سوق عرضي: EMA متقاربة (' + spread.toFixed(3) + '%)'; }
    else if (ind.bbBandwidth !== null && ind.bbBandwidth < 0.10) {
      failed.push('sideways'); details.sideways = 'تذبذب منخفض: Bollinger bandwidth ' + ind.bbBandwidth.toFixed(3) + '%';
    } else details.sideways = 'السوق متحرك (فرق EMA ' + spread.toFixed(3) + '%)';
    // 4) فلتر الوقت
    const hour = new Date().getHours();
    if ((CFG.blockedHours || []).indexOf(hour) !== -1) {
      failed.push('time'); details.time = 'الساعة ' + hour + ':00 ممنوعة حسب فلتر الوقت';
    } else details.time = 'الساعة ' + hour + ':00 مسموحة';
    return { allowed: failed.length === 0, failed, details };
  }

  // ---------- قراءة الصفحة ----------
  function isDemo() { return /Demo/i.test(document.body.innerText || ''); }
  function querySel(sel) {
    if (!sel) return null;
    try { return document.querySelector(sel); } catch (e) { return null; }
  }
  function parseNum(text) {
    if (!text) return null;
    const v = parseFloat(String(text).replace(/[^\d.]/g, ''));
    return isNaN(v) ? null : v;
  }
  function readPrice() {
    const el = querySel(SEL.price);
    if (el) { const v = parseNum(el.textContent); if (v) return v; }
    const cand = document.querySelector('[class*="price"] [class*="value"], [data-test*="price"]');
    if (cand) { const v = parseNum(cand.textContent); if (v) return v; }
    return null;
  }
  function readPayout() {
    const m = (document.body.innerText || '').match(/(\d{1,3})\s*%/);
    return m ? parseInt(m[1], 10) / 100 : 0.92;
  }
  function readBalance() {
    const el = querySel(SEL.balance);
    if (el) { const v = parseNum(el.textContent); if (v) return v; }
    const amounts = ((document.body.innerText || '').match(/\$\s*([\d,]+\.\d{2})/g) || [])
      .map((s) => parseFloat(s.replace(/[^\d.]/g, ''))).filter((n) => !isNaN(n));
    return amounts.length ? Math.max.apply(null, amounts) : null;
  }
  function findButton(label) {
    const el = querySel(label === 'CALL' ? SEL.call : SEL.put);
    if (el && el.offsetParent) return el;
    const btns = Array.prototype.slice.call(document.querySelectorAll('button'));
    return btns.find((b) => b.offsetParent && new RegExp(label === 'CALL' ? 'Call' : 'Put', 'i').test(b.textContent));
  }
  function humanDelay(minMs, maxMs) {
    return new Promise((r) => setTimeout(r, minMs + Math.random() * (maxMs - minMs)));
  }

  // ---------- المعايرة البصرية ----------
  function buildSelector(el) {
    if (!el || el === document.body || el === document.documentElement) return null;
    if (el.id) return '#' + el.id;
    const path = [];
    let node = el;
    while (node && node !== document.body && path.length < 5) {
      let part = node.tagName.toLowerCase();
      const cls = (node.className && typeof node.className === 'string')
        ? node.className.trim().split(/\s+/).filter((c) => c && !/^(active|selected|hover)/.test(c)).slice(0, 2).join('.')
        : '';
      if (cls) part += '.' + cls;
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.prototype.filter.call(parent.children, (c) => c.tagName === node.tagName);
        if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
      }
      path.unshift(part);
      node = parent;
    }
    return path.join(' > ');
  }
  function startCalibration(kind) {
    calibrating = kind;
    const labels = {
      price: 'سعر الأصل الحالي', call: 'زر CALL (الشراء / فوق)',
      put: 'زر PUT (البيع / تحت)', amount: 'خانة مبلغ الصفقة', balance: 'الرصيد الظاهر في الصفحة'
    };
    logLine('🎯 المعايرة: دوس على عنصر «' + labels[kind] + '» في الصفحة — أو دوس Esc للإلغاء.');
    document.body.style.cursor = 'crosshair';
  }
  function finishCalibration(el) {
    const sel = buildSelector(el);
    if (!sel) { logLine('❌ مش قادر أبني محدد للعنصر ده — جرّب عنصر تاني.'); return; }
    SEL[calibrating] = sel;
    saveSelectors();
    logLine('✅ اتحفظ: ' + calibrating + ' ← ' + sel);
    calibrating = null;
    document.body.style.cursor = '';
    renderPanel();
  }
  document.addEventListener('click', (e) => {
    if (!calibrating) return;
    const panel = document.getElementById('pocket-demo-bot-panel');
    if (panel && panel.contains(e.target)) return; // ضغطة جوه لوحة البوت مش معايرة
    e.preventDefault(); e.stopPropagation();
    finishCalibration(e.target);
  }, true);
  document.addEventListener('keydown', (e) => {
    if (calibrating && e.key === 'Escape') {
      calibrating = null; document.body.style.cursor = '';
      logLine('المعايرة اتلغت.');
    }
  }, true);

  // ---------- تنفيذ الصفقة ----------
  async function executeTrade(dir, votes) {
    if (Date.now() - lastTradeAt < CFG.cooldownSec * 1000) return;
    if (tradesToday >= CFG.maxTrades) { logLine('وصلنا لحد الصفقات اليومي — إيقاف.'); stopBot(); return; }
    if (dailyProfit <= -CFG.dailyLossLimit) { logLine('وصلنا لحد الخسارة اليومية — إيقاف.'); stopBot(); return; }
    const payout = readPayout();
    if (payout < CFG.minPayout) { logLine('العائد ' + Math.round(payout * 100) + '% أقل من ' + Math.round(CFG.minPayout * 100) + '% — تخطّي.'); return; }
    const btn = findButton(dir);
    if (!btn) {
      logLine('❌ مش لاقي زر ' + dir + ' في الواجهة — الصفقة اتلغت (الموقع ممكن يكون اتغيّر، عاير تاني).');
      return;
    }
    lastTradeAt = Date.now();
    const balanceBefore = readBalance();
    // حط مبلغ الصفقة في الخانة المعايَرة (لو موجودة)
    const amtEl = querySel(SEL.amount);
    if (amtEl && (amtEl.tagName === 'INPUT' || amtEl.tagName === 'TEXTAREA')) {
      try {
        amtEl.focus();
        amtEl.value = String(CFG.stake);
        amtEl.dispatchEvent(new Event('input', { bubbles: true }));
        amtEl.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (e) { /* كمّل بالمبلغ الافتراضي في الواجهة */ }
    }
    await humanDelay(800, 2500);
    btn.click();
    tradesToday++;
    logLine('✅ ضغط ' + dir + ' | وافقت: ' + votes.join(', ') + ' | صفقات اليوم: ' + tradesToday);
    saveStats(); renderPanel();
    await new Promise((r) => setTimeout(r, (CFG.expirySec + 10) * 1000));
    const balanceAfter = readBalance();
    let result = 'unknown', profit = 0;
    if (balanceBefore !== null && balanceAfter !== null) {
      const diff = balanceAfter - balanceBefore;
      if (Math.abs(diff - CFG.stake * payout) < 0.05) { result = 'win'; profit = CFG.stake * payout; }
      else if (Math.abs(diff + CFG.stake) < 0.05) { result = 'loss'; profit = -CFG.stake; }
      else if (Math.abs(diff) < 0.01) { result = 'draw'; }
    }
    dailyProfit += profit;
    if (result === 'win') { winsToday++; consecLosses = 0; }
    else if (result === 'loss') {
      consecLosses++;
      if (consecLosses >= CFG.maxConsecutiveLosses) { logLine('3 خساير ورا بعض — إيقاف.'); }
    }
    tradeLog.unshift({
      time: new Date().toLocaleTimeString(), dir, result,
      profit: +profit.toFixed(2), votes: votes.join(','), strategy: CFG.strategy
    });
    tradeLog = tradeLog.slice(0, 50);
    logLine('نتيجة الصفقة: ' + result + ' | صافي اليوم: $' + dailyProfit.toFixed(2));
    saveStats(); renderPanel();
    if (consecLosses >= CFG.maxConsecutiveLosses) stopBot();
  }

  // ---------- الحلقات الرئيسية ----------
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
    if (Date.now() - lastDecisionAt < 15000) return;
    lastDecisionAt = Date.now();
    const s = decide();
    const status = document.getElementById('pdb-status');
    if (status) {
      status.textContent = 'سعر: ' + (curCandle ? curCandle.close : '-') +
        ' | RSI: ' + (s.ind && s.ind.rsi !== null ? s.ind.rsi.toFixed(1) : '-') + ' | ' + s.reason;
    }
    renderIndicators(s.ind);
    if (!s.dir) return;
    const f = applyFilters(s.ind, s.dir, readPayout());
    if (!f.allowed) { logLine('الفلاتر رفضت (' + f.failed.join(', ') + ') — تخطّي.'); return; }
    await executeTrade(s.dir, s.votes);
  }, 5000);

  // ---------- لوحة التحكم العائمة ----------
  function logLine(msg) {
    const el = document.getElementById('pdb-log');
    if (el) el.textContent = new Date().toLocaleTimeString() + ' | ' + msg + '\n' + el.textContent.slice(0, 2000);
    console.log('[PocketDemoBot]', msg);
  }
  function renderIndicators(ind) {
    const el = document.getElementById('pdb-indicators');
    if (!el || !ind) return;
    const f = (v, d) => (v === null || v === undefined ? '—' : v.toFixed(d === undefined ? 2 : d));
    el.textContent = 'EMA9 ' + f(ind.ema9) + ' | EMA21 ' + f(ind.ema21) + ' | EMA50 ' + f(ind.ema50) +
      ' | RSI ' + f(ind.rsi, 1) + ' | Stoch ' + f(ind.stochK, 0) + '/' + f(ind.stochD, 0) +
      ' | MACD ' + f(ind.macdHist, 4) + ' | BB ' + f(ind.bbBandwidth, 2) + '%';
  }
  function renderPanel() {
    const p = document.getElementById('pocket-demo-bot-panel');
    if (!p) return;
    const winRate = tradesToday ? Math.round((winsToday / tradesToday) * 100) : 0;
    const setText = (id, t) => { const e = document.getElementById(id); if (e) e.textContent = t; };
    setText('pdb-stats', 'صفقات اليوم: ' + tradesToday + ' | مكسب: ' + winsToday + ' (' + winRate + '%) | صافي: $' + dailyProfit.toFixed(2));
    setText('pdb-running', running ? '🟢 شغال' : '⚪ واقف');
    const cal = document.getElementById('pdb-cal-status');
    if (cal) {
      const done = ['price', 'call', 'put'].filter((k) => SEL[k]).length;
      cal.textContent = 'المعايرة: ' + done + '/3 أساسية' + (SEL.amount ? ' + مبلغ' : '') + (SEL.balance ? ' + رصيد' : '');
    }
  }
  function buildPanel() {
    if (document.getElementById('pocket-demo-bot-panel')) return;
    const p = document.createElement('div');
    p.id = 'pocket-demo-bot-panel';
    p.dir = 'rtl';
    p.style.cssText = 'position:fixed;bottom:10px;right:10px;z-index:999999;background:#1e1e2e;color:#fff;'
      + 'padding:12px;border-radius:10px;font-size:13px;width:250px;box-shadow:0 0 12px #000;'
      + 'font-family:system-ui,sans-serif;line-height:1.6;';
    p.innerHTML =
      '<b>🤖 بوت الديمو — Pocket Option</b><br>' +
      '<span style="color:#f39c12">ديمو بس — الأتمتة مخالفة لشروط المنصة وقد تؤدي للحظر.</span><br>' +
      '<span id="pdb-running">⚪ واقف</span> | <span id="pdb-cal-status">المعايرة: 0/3</span><br>' +
      '<span id="pdb-stats">صفقات اليوم: 0 | مكسب: 0 (0%) | صافي: $0.00</span><br>' +
      '<div id="pdb-indicators" style="color:#9ecbff;font-size:11px"></div>' +
      '<div id="pdb-status" style="color:#ccc;font-size:12px"></div>' +
      '<button id="pdb-start" style="background:#27ae60;color:#fff;padding:8px 14px;border:none;border-radius:6px;margin-top:8px;cursor:pointer">▶ تشغيل</button> ' +
      '<button id="pdb-stop" style="background:#c0392b;color:#fff;padding:8px 14px;border:none;border-radius:6px;cursor:pointer">⛔ إيقاف</button><br>' +
      '<button id="pdb-cal" style="background:#2980b9;color:#fff;padding:6px 10px;border:none;border-radius:6px;margin-top:8px;cursor:pointer">🎯 معايرة العناصر</button> ' +
      '<button id="pdb-cal-reset" style="background:#555;color:#fff;padding:6px 10px;border:none;border-radius:6px;cursor:pointer">مسح المعايرة</button>' +
      '<pre id="pdb-log" style="max-height:120px;overflow:auto;font-size:11px;color:#aaa;margin:8px 0 0"></pre>';
    document.body.appendChild(p);
    document.getElementById('pdb-start').onclick = () => startBot();
    document.getElementById('pdb-stop').onclick = () => stopBot();
    document.getElementById('pdb-cal-reset').onclick = () => {
      SEL = {}; saveSelectors(); logLine('المعايرة اتمسحت — عاير تاني.'); renderPanel();
    };
    document.getElementById('pdb-cal').onclick = () => {
      const kinds = ['price', 'call', 'put', 'amount', 'balance'];
      const next = kinds.find((k) => !SEL[k]) || 'price';
      startCalibration(next);
    };
    renderPanel();
  }
  function startBot() {
    if (!isDemo()) {
      alert('الحساب مش ديمو! بدّل للديمو الأول — البوت مش هيشتغل على حساب حقيقي.');
      logLine('❌ رفض التشغيل: الحساب مش ديمو.');
      return;
    }
    if (!SEL.call || !SEL.put) {
      alert('لسه معايرتش زرار CALL و PUT. دوس «معايرة العناصر» الأول وعاير السعر و CALL و PUT.');
      logLine('❌ رفض التشغيل: مفيش معايرة لأزرار CALL/PUT.');
      return;
    }
    if (!confirm('تأكيد: الحساب ده ديمو فعلاً؟ البوت هيضغط CALL/PUT بنفسه.')) return;
    running = true;
    logLine('البوت شغال — استراتيجية ' + CFG.strategy + ' | مبلغ $' + CFG.stake);
    renderPanel();
  }
  function stopBot() {
    running = false;
    logLine('البوت وقف.');
    renderPanel();
  }

  // ---------- الرسائل من الـ popup / background ----------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;
    if (msg.type === 'getStatus') {
      sendResponse({
        running, strategy: CFG.strategy, stake: CFG.stake, expirySec: CFG.expirySec,
        tradesToday, winsToday, dailyProfit, consecLosses,
        winRate: tradesToday ? Math.round((winsToday / tradesToday) * 100) : 0,
        calibrated: { price: !!SEL.price, call: !!SEL.call, put: !!SEL.put, amount: !!SEL.amount, balance: !!SEL.balance },
        isDemo: isDemo(), closes: closes.length, log: tradeLog.slice(0, 10)
      });
    } else if (msg.type === 'start') { startBot(); sendResponse({ ok: running }); }
    else if (msg.type === 'stop') { stopBot(); sendResponse({ ok: true }); }
    else if (msg.type === 'updateSettings' && msg.settings) {
      CFG = { ...DEFAULTS, ...msg.settings }; saveSettings(); renderPanel();
      sendResponse({ ok: true });
    } else if (msg.type === 'calibrate' && msg.kind) {
      startCalibration(msg.kind); sendResponse({ ok: true });
    }
    return true;
  });

  // ---------- تشغيل ----------
  loadStored().then(() => {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildPanel);
    else buildPanel();
    renderPanel();
  });
})();
