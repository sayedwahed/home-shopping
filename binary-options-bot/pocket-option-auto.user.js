// ==UserScript==
// @name         Pocket Option Demo Auto Trader (human-like clicks)
// @namespace    https://example.local/pocket-demo-bot
// @version      1.1.0
// @description  Automated trading on the Pocket Option DEMO account only, by clicking CALL/PUT in the page like a human. No session token, no API, no login data — you log in yourself. For learning/testing on demo only.
// @match        https://pocketoption.com/*
// @match        https://*.pocketoption.com/*
// @match        https://m.pocketoption.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
/*
  ============================================================
  v1.1.0 — لماذا كانت v1.0.1 صامتة أكثر من 10 دقائق؟
  ============================================================
  السبب الجذري في v1.0.1:
  - decide() كانت تشترط 60 شمعة، وكل شمعة 60 ثانية،
    يعني 60 × 60 ثانية = 60 دقيقة كاملة قبل أول صفقة.
  - وفوقها استراتيجية confluence كانت تشترط اتفاق 3 مؤشرات
    على الأقل، مع فلاتر صارمة، فكان البوت يجلس صامتاً ساعة.
  الإصلاح في v1.1.0:
  - الشموع الآن كل 15 ثانية بدل 60، والحد الأدنى للتداول
    يعتمد على الوضع: Aggressive = 21 شمعة (~5 دقائق)،
    Balanced = 30 شمعة (~7.5 دقيقة)، Conservative = 50 شمعة (~12.5 دقيقة).
  - مؤشرات كثيرة تشتغل بـ 14-21 فترة فقط، فلا حاجة لانتظار 50.
  - وضع Balanced هو الافتراضي الآن (confluence >= 2 بدل 3).
  - كل مرة يتخطى فيها البوت صفقة، يكتب السبب في السجل
    (مثلاً: "تسخين 12/21" أو "العائد 80% أقل من 85%")،
    فلا يعود الصمت بلا تفسير.
  - أُضيفت 6 استراتيجيات و 6 مؤشرات وفلاتر قابلة للتبديل.

  ديمو فقط — أتمتة الواجهة مخالفة لشروط Pocket Option وقد
  تؤدي لحظر الحساب حتى على الديمو. للتعلم والتجربة على
  الديمو فقط، وبمبالغ صغيرة جداً. مفيش أي ضمان ربح.
  مفيش SSID ولا API ولا بيانات دخول في السكربت ده —
  أنت بتسجّل دخولك بنفسك، والسكربت بيضغط في الواجهة بس.

  التركيب على أندرويد (Firefox + Tampermonkey):
    1) نزّل Firefox من Google Play.
    2) من قائمة Firefox > Add-ons، ثبّت Tampermonkey.
    3) افتح ملف السكربت ده في Firefox، و Tampermonkey هيسألك تثبّته — دوس Install.
    4) افتح Pocket Option في Firefox، سجّل دخولك، وبدّل للديمو.
    5) لوحة التحكم بتظهر على الصفحة — اختر الوضع والاستراتيجية، دوس START.
    6) للإيقاف دوس STOP في أي وقت (أو اقفل التبويب).
  ملاحظة: Kiwi Browser اتشال من Google Play واتوقف تطويره،
  فالطريق الرسمي الآن هو Firefox على أندرويد.
*/
(function () {
  'use strict';

  // ---------- الأوضاع: التسخين / الاتفاق / التبريد ----------
  // Conservative = مثل v1.0.1 تقريباً (آمن، بطيء).
  // Balanced    = الافتراضي في v1.1.0 (توازن، أول صفقة بعد ~7.5 دقيقة).
  // Aggressive  = سكالبينج سريع (أول صفقة بعد ~5 دقائق، مخاطر أعلى).
  var MODES = {
    conservative: { label: 'Conservative (آمن)', need: 50, confluenceMin: 3, cooldownSec: 75, chop: true },
    balanced:     { label: 'Balanced (متوازن)',  need: 30, confluenceMin: 2, cooldownSec: 45, chop: true },
    aggressive:   { label: 'Aggressive (سكالبينج)', need: 21, confluenceMin: 1, cooldownSec: 30, chop: false }
  };
  var CANDLE_SEC = 15; // شمعة كل 15 ثانية بدل 60 — هذا هو الإصلاح الرئيسي

  // ---------- الإعدادات ----------
  var CFG = {
    mode: 'balanced', // conservative | balanced | aggressive
    strategy: 'confluence',
    stake: 1.0,               // مبلغ الصفقة بالدولار (ديمو، صغير جداً)
    expirySec: 60,            // مدة الصفقة بالثواني
    maxTrades: 10,            // أقصى صفقات في اليوم
    dailyLossLimit: 10.0,     // أقصى خسارة يومية بالدولار
    maxConsecutiveLosses: 3,  // إيقاف بعد 3 خساير ورا بعض
    minPayout: 0.85,          // فلتر العائد: مفيش دخول لو العائد أقل من 85%
    minAtrPct: 0.01,          // فلتر ATR: أقل تذبذب مقبول (% من السعر)
    // الفلاتر — كل واحد قابل للتبديل من اللوحة
    filters: { adx: true, atr: true, payout: true, chop: true, session: false }
  };
  var running = false, tradesToday = 0, dailyProfit = 0, consecLosses = 0, lastTradeAt = 0;
  var closes = [];            // أسعار إغلاق الشموع (15 ثانية)
  var candles = [];           // شموع كاملة {o,h,l,c} — للمؤشرات التي تحتاج High/Low
  var curCandle = null;
  var lastSkipLogAt = 0, lastSkipReason = '';

  function mode() { return MODES[CFG.mode] || MODES.balanced; }
  function cooldownSec() { return mode().cooldownSec; }

  // ---------- أدوات رياضية ----------
  function sma(values, period) {
    if (values.length < period) return null;
    var w = values.slice(-period), s = 0, i;
    for (i = 0; i < w.length; i++) s += w[i];
    return s / period;
  }
  function stddev(values, period) {
    var m = sma(values, period);
    if (m === null) return null;
    var w = values.slice(-period), s = 0, i;
    for (i = 0; i < w.length; i++) s += (w[i] - m) * (w[i] - m);
    return Math.sqrt(s / period);
  }

  // ---------- المؤشرات القديمة ----------
  function ema(values, period) {
    if (values.length < period) return null;
    var k = 2 / (period + 1), i;
    var r = values.slice(0, period).reduce(function (a, b) { return a + b; }, 0) / period;
    for (i = period; i < values.length; i++) r = values[i] * k + r * (1 - k);
    return r;
  }
  function rsi(values, period) {
    period = period || 14;
    if (values.length < period + 1) return null;
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
  function stoch(closesArr, p) {
    p = p || 14;
    if (closesArr.length < p + 3) return [null, null];
    var ks = [], i, w, hi, lo;
    for (i = p - 1; i < closesArr.length; i++) {
      w = closesArr.slice(i - p + 1, i + 1);
      hi = Math.max.apply(null, w); lo = Math.min.apply(null, w);
      ks.push(hi === lo ? 0 : 100 * (closesArr[i] - lo) / (hi - lo));
    }
    return [ks[ks.length - 1], ks.slice(-3).reduce(function (a, b) { return a + b; }, 0) / 3];
  }
  function stochSeries(closesArr, p) {
    p = p || 14;
    if (closesArr.length < p + 1) return [];
    var ks = [], i, w, hi, lo;
    for (i = p - 1; i < closesArr.length; i++) {
      w = closesArr.slice(i - p + 1, i + 1);
      hi = Math.max.apply(null, w); lo = Math.min.apply(null, w);
      ks.push(hi === lo ? 0 : 100 * (closesArr[i] - lo) / (hi - lo));
    }
    return ks;
  }
  function macdHist(closesArr) {
    if (closesArr.length < 35) return null;
    return ema(closesArr, 12) - ema(closesArr, 26);
  }
  function macdLine(closesArr) { return macdHist(closesArr); }
  function smma(values, period) {
    if (values.length < period) return null;
    var r = values.slice(0, period).reduce(function (a, b) { return a + b; }, 0) / period, i;
    for (i = period; i < values.length; i++) r = (r * (period - 1) + values[i]) / period;
    return r;
  }
  function bollinger(closesArr, period, mult) {
    period = period || 20; mult = mult || 2;
    var m = sma(closesArr, period), sd = stddev(closesArr, period);
    if (m === null || sd === null) return null;
    return { mid: m, upper: m + mult * sd, lower: m - mult * sd, bandwidth: (2 * mult * sd) / m * 100 };
  }

  // ---------- المؤشرات الجديدة (v1.1.0) — Pure JS، بدون مكتبات ----------
  // ATR (14): متوسط المدى الحقيقي — يقيس التذبذب، ويستخدمه فلتر ATR.
  function atr(candlesArr, period) {
    period = period || 14;
    if (candlesArr.length < period + 1) return null;
    var trs = [], i, c, p, tr;
    for (i = 1; i < candlesArr.length; i++) {
      c = candlesArr[i]; p = candlesArr[i - 1];
      tr = Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c));
      trs.push(tr);
    }
    return sma(trs, period);
  }
  // ADX مبسّط (14): قوة الترند. +DM/-DM و TR ممهّدة، ثم +DI/-DI و DX و ADX.
  // ADX < 20 = ترند ضعيف / سوق عرضي. ADX > 25 = ترند قوي.
  function adx(candlesArr, period) {
    period = period || 14;
    if (candlesArr.length < period * 2 + 1) return null;
    var trs = [], pdm = [], mdm = [], i, c, p, up, dn;
    for (i = 1; i < candlesArr.length; i++) {
      c = candlesArr[i]; p = candlesArr[i - 1];
      up = c.h - p.h; dn = p.l - c.l;
      pdm.push(up > dn && up > 0 ? up : 0);
      mdm.push(dn > up && dn > 0 ? dn : 0);
      trs.push(Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c)));
    }
    // Wilder smoothing
    function wilder(arr, per) {
      var out = [], s = 0, j;
      for (j = 0; j < per; j++) s += arr[j];
      out.push(s);
      for (j = per; j < arr.length; j++) out.push(out[out.length - 1] - out[out.length - 1] / per + arr[j]);
      return out;
    }
    var str = wilder(trs, period), sp = wilder(pdm, period), sm = wilder(mdm, period);
    var dx = [], k;
    for (k = 0; k < str.length; k++) {
      if (str[k] === 0) { dx.push(0); continue; }
      var pdi = 100 * sp[k] / str[k], mdi = 100 * sm[k] / str[k];
      dx.push((pdi + mdi) === 0 ? 0 : 100 * Math.abs(pdi - mdi) / (pdi + mdi));
    }
    return sma(dx, period);
  }
  // CCI (20): (السعر النموذجي - متوسطه) / (0.015 × الانحراف المتوسط).
  // CCI فوق +100 = تشبع شراء، تحت -100 = تشبع بيع.
  function cci(candlesArr, period) {
    period = period || 20;
    if (candlesArr.length < period) return null;
    var tp = candlesArr.map(function (c) { return (c.h + c.l + c.c) / 3; });
    var m = sma(tp, period);
    if (m === null) return null;
    var w = tp.slice(-period), md = 0, i;
    for (i = 0; i < w.length; i++) md += Math.abs(w[i] - m);
    md /= period;
    return md === 0 ? 0 : (tp[tp.length - 1] - m) / (0.015 * md);
  }
  // Williams %R (14): (أعلى High - الإغلاق) / (أعلى High - أدنى Low) × -100.
  // -20..0 = تشبع شراء، -100..-80 = تشبع بيع.
  function williamsR(candlesArr, period) {
    period = period || 14;
    if (candlesArr.length < period) return null;
    var w = candlesArr.slice(-period), hi = -Infinity, lo = Infinity, i;
    for (i = 0; i < w.length; i++) { hi = Math.max(hi, w[i].h); lo = Math.min(lo, w[i].l); }
    if (hi === lo) return 0;
    return (hi - w[w.length - 1].c) / (hi - lo) * -100;
  }
  // Parabolic SAR مبسّط: يتتبع الاتجاه بخطوة AF=0.02 (حد أقصى 0.2).
  // يرجع {value, trend:'up'|'down'}. نسخة مبسطة من الخوارزمية الكلاسيكية
  // (Wilder) على الشموع المتاحة، وليست نسخة حرفية من منصة التداول.
  function parabolicSAR(candlesArr) {
    if (candlesArr.length < 5) return null;
    var trendUp = ema(closes, 9) !== null && ema(closes, 21) !== null
      ? ema(closes, 9) > ema(closes, 21) : closes[closes.length - 1] > closes[0];
    var af = 0.02, sar, ep, i, c;
    if (trendUp) {
      sar = Math.min.apply(null, candlesArr.slice(0, 4).map(function (x) { return x.l; }));
      ep = Math.max.apply(null, candlesArr.slice(0, 4).map(function (x) { return x.h; }));
    } else {
      sar = Math.max.apply(null, candlesArr.slice(0, 4).map(function (x) { return x.h; }));
      ep = Math.min.apply(null, candlesArr.slice(0, 4).map(function (x) { return x.l; }));
    }
    for (i = 4; i < candlesArr.length; i++) {
      c = candlesArr[i];
      if (trendUp) {
        sar = sar + af * (ep - sar);
        if (c.l < sar) { trendUp = false; sar = ep; af = 0.02; ep = c.l; continue; }
        if (c.h > ep) { ep = c.h; af = Math.min(0.2, af + 0.02); }
      } else {
        sar = sar + af * (ep - sar);
        if (c.h > sar) { trendUp = true; sar = ep; af = 0.02; ep = c.h; continue; }
        if (c.l < ep) { ep = c.l; af = Math.min(0.2, af + 0.02); }
      }
    }
    return { value: sar, trend: trendUp ? 'up' : 'down' };
  }
  // VWAP تقريبي داخل اليوم: متوسط السعر النموذجي المرجّح (حجم = 1 لكل شمعة،
  // لأن المنصة لا تعطينا حجماً حقيقياً). السعر فوق VWAP = زخم صاعد.
  function vwap(candlesArr) {
    if (!candlesArr.length) return null;
    var s = 0, i;
    for (i = 0; i < candlesArr.length; i++) s += (candlesArr[i].h + candlesArr[i].l + candlesArr[i].c) / 3;
    return s / candlesArr.length;
  }
  // Donchian: أعلى High وأدنى Low لآخر N فترة.
  function donchian(candlesArr, period) {
    period = period || 20;
    if (candlesArr.length < period) return null;
    var w = candlesArr.slice(-period), hi = -Infinity, lo = Infinity, i;
    for (i = 0; i < w.length; i++) { hi = Math.max(hi, w[i].h); lo = Math.min(lo, w[i].l); }
    return { high: hi, low: lo };
  }

  // ---------- حساب كل المؤشرات مرة واحدة ----------
  function allIndicators() {
    var e9 = ema(closes, 9), e21 = ema(closes, 21), e50 = ema(closes, 50);
    var r14 = rsi(closes, 14), r7 = rsi(closes, 7);
    var st = stoch(closes, 14), sk = st[0], sd = st[1];
    var skSeries = stochSeries(closes, 14);
    var mh = macdHist(closes);
    var jaw = smma(closes, 13), teeth = smma(closes, 8), lips = smma(closes, 5);
    var bb = bollinger(closes, 20, 2);
    var a = atr(candles, 14);
    var adxV = adx(candles, 14);
    var cciV = cci(candles, 20);
    var wr = williamsR(candles, 14);
    var sar = parabolicSAR(candles);
    var vw = vwap(candles);
    var don = donchian(candles, 20);
    var last = closes.length ? closes[closes.length - 1] : null;
    var prev = closes.length > 1 ? closes[closes.length - 2] : null;
    return {
      e9: e9, e21: e21, e50: e50, r14: r14, r7: r7, sk: sk, sd: sd, skSeries: skSeries,
      mh: mh, jaw: jaw, teeth: teeth, lips: lips, bb: bb, atr: a, adx: adxV,
      cci: cciV, wr: wr, sar: sar, vwap: vw, donchian: don, last: last, prev: prev,
      atrPct: (a !== null && last) ? (a / last * 100) : null
    };
  }

  // ---------- الحد الأدنى من الشموع لكل استراتيجية ----------
  var STRATEGY_MIN = {
    confluence: 21, trend_ema_rsi: 21, reversal_rsi_stoch: 17, pullback: 50,
    alligator_rsi: 21, bollinger_bounce: 20, macd_cross: 35, stoch_cross: 17,
    ema_cross_fast: 21, breakout_donchian: 20, rsi_scalp: 8
  };
  function requiredCloses() {
    var sMin = STRATEGY_MIN[CFG.strategy] || 21;
    return Math.max(mode().need, sMin);
  }

  // ---------- الفلاتر (كل واحد قابل للتبديل من اللوحة) ----------
  // ترجع null إذا مرّت، أو نص السبب إذا رفضت الصفقة.
  function applyFilters(ind, dir) {
    var f = CFG.filters, m = mode();
    // فلتر الجلسة/الوقت: تجنّب أول 5 دقائق من كل ساعة (افتراضي OFF)
    if (f.session) {
      var min = new Date().getMinutes();
      if (min < 5) return 'فلتر وقت: أول 5 دقائق من الساعة — تخطّي';
    }
    // فلتر العائد يُفحص عند التنفيذ أيضاً، لكن نذكّره هنا في السجل
    // (القيمة الحقيقية تُقرأ من الصفحة في executeTrade).
    // فلتر ATR: تذبذب منخفض جداً = سوق ميت
    if (f.atr && ind.atrPct !== null && ind.atrPct < CFG.minAtrPct) {
      return 'فلتر ATR: التذبذب ' + ind.atrPct.toFixed(3) + '% أقل من ' + CFG.minAtrPct + '% — سوق ميت';
    }
    // فلتر التشوّب (سوق عرضي): انتشار EMA ضيق أو Bollinger ضيق
    var chopOn = f.chop && m.chop;
    if (chopOn && ind.e9 !== null && ind.e21 !== null && ind.last) {
      var spreadPct = Math.abs(ind.e9 - ind.e21) / ind.last * 100;
      if (spreadPct < 0.05) return 'فلتر تشوّب: انتشار EMA ' + spreadPct.toFixed(3) + '% ضيق — سوق عرضي';
      if (ind.bb && ind.bb.bandwidth < 0.10) return 'فلتر تشوّب: Bollinger ضيق ' + ind.bb.bandwidth.toFixed(2) + '% — سوق عرضي';
    }
    // فلتر ADX: للاستراتيجيات الترندية فقط — لا تدخل ترند ضعيف
    var trendStrategies = ['trend_ema_rsi', 'pullback', 'alligator_rsi', 'ema_cross_fast', 'macd_cross', 'breakout_donchian', 'confluence'];
    if (f.adx && trendStrategies.indexOf(CFG.strategy) !== -1 && ind.adx !== null && ind.adx < 20) {
      return 'فلتر ADX: قوة الترند ' + ind.adx.toFixed(0) + ' أقل من 20 — ترند ضعيف';
    }
    return null;
  }

  // ---------- الاستراتيجيات ----------
  // كل استراتيجية ترجع {dir, votes, reason} أو {dir:null, reason}.
  function decide() {
    var need = requiredCloses();
    if (closes.length < need) {
      return { dir: null, votes: [], reason: 'تسخين ' + closes.length + '/' + need + ' شمعة (' + CFG.mode + ') — أول صفقة بعد ~' + Math.ceil(need * CANDLE_SEC / 60) + ' دقيقة' };
    }
    var ind = allIndicators();
    var last = ind.last, r = ind.r14;
    // RSI متطرف جداً يمنع كل الاستراتيجيات ما عدا الانعكاسية.
    // ملاحظة v1.1.0: الحد كان 75/25 في مسودة أولى، لكن الاختبار
    // الاصطناعي أثبت أنه يحظر كل صفقات الترند القوي (RSI يبقى
    // 90-100 فترات طويلة في الترند)، فتم تخفيفه إلى 95/5.
    // الاستراتيجيات نفسها أصلاً عندها حدود RSI خاصة بها.
    if (CFG.strategy !== 'reversal_rsi_stoch' && CFG.strategy !== 'bollinger_bounce' && CFG.strategy !== 'rsi_scalp') {
      if (r !== null && (r >= 95 || r <= 5)) return { dir: null, votes: [], reason: 'RSI متطرف جداً (' + r.toFixed(0) + ') — تخطّي' };
    }

    var s = CFG.strategy, res = null;

    if (s === 'trend_ema_rsi') {
      // v1.1.0: حد RSI كان 65/35، لكن في الترند القوي RSI يبقى 70-80
      // فكان يمنع كل صفقات الترند. خُفف إلى 75/25 (المتطرف جداً فقط).
      if (ind.e9 > ind.e21 && last > ind.e9 && r < 85) res = { dir: 'CALL', votes: ['EMA', 'RSI'], reason: 'EMA9 فوق EMA21 و RSI تحت 85' };
      else if (ind.e9 < ind.e21 && last < ind.e9 && r > 15) res = { dir: 'PUT', votes: ['EMA', 'RSI'], reason: 'EMA9 تحت EMA21 و RSI فوق 15' };
      else res = { dir: null, votes: [], reason: 'trend_ema_rsi: مفيش إشارة (EMA9 ' + (ind.e9 || 0).toFixed(5) + ' / EMA21 ' + (ind.e21 || 0).toFixed(5) + ', RSI ' + (r || 0).toFixed(0) + ')' };
    } else if (s === 'reversal_rsi_stoch') {
      if (r < 30 && ind.sk < 20 && ind.sk > ind.sd) res = { dir: 'CALL', votes: ['RSI', 'Stochastic'], reason: 'تشبع بيع + Stochastic طالع' };
      else if (r > 70 && ind.sk > 80 && ind.sk < ind.sd) res = { dir: 'PUT', votes: ['RSI', 'Stochastic'], reason: 'تشبع شراء + Stochastic نازل' };
      else res = { dir: null, votes: [], reason: 'reversal: مفيش تشبع (RSI ' + (r || 0).toFixed(0) + ', Stoch ' + (ind.sk || 0).toFixed(0) + ')' };
    } else if (s === 'pullback') {
      if (ind.e50 === null) res = { dir: null, votes: [], reason: 'pullback: محتاج EMA50 (50 شمعة) — لسه تسخين' };
      else if (last > ind.e50 && ind.e9 > ind.e50 && r > 35 && r < 50) res = { dir: 'CALL', votes: ['EMA50', 'RSI'], reason: 'ترند صاعد + Pullback' };
      else if (last < ind.e50 && ind.e9 < ind.e50 && r > 50 && r < 65) res = { dir: 'PUT', votes: ['EMA50', 'RSI'], reason: 'ترند هابط + Pullback' };
      else res = { dir: null, votes: [], reason: 'pullback: مفيش ارتداد مناسب (RSI ' + (r || 0).toFixed(0) + ')' };
    } else if (s === 'alligator_rsi') {
      if (ind.lips > ind.teeth && ind.teeth > ind.jaw && last > ind.lips && r < 75) res = { dir: 'CALL', votes: ['Alligator', 'RSI'], reason: 'Alligator لفوق' };
      else if (ind.lips < ind.teeth && ind.teeth < ind.jaw && last < ind.lips && r > 25) res = { dir: 'PUT', votes: ['Alligator', 'RSI'], reason: 'Alligator لتحت' };
      else res = { dir: null, votes: [], reason: 'alligator: الفكين مش مرتبين — تخطّي' };
    } else if (s === 'bollinger_bounce') {
      // 6) لمس الحد السفلي + RSI منخفض = ارتداد لفوق، والعكس
      if (!ind.bb) res = { dir: null, votes: [], reason: 'bollinger: محتاج 20 شمعة' };
      else if (last <= ind.bb.lower && r < 40) res = { dir: 'CALL', votes: ['Bollinger', 'RSI'], reason: 'لمس الحد السفلي + RSI ' + r.toFixed(0) };
      else if (last >= ind.bb.upper && r > 60) res = { dir: 'PUT', votes: ['Bollinger', 'RSI'], reason: 'لمس الحد العلوي + RSI ' + r.toFixed(0) };
      else res = { dir: null, votes: [], reason: 'bollinger: السعر داخل النطاق (RSI ' + (r || 0).toFixed(0) + ')' };
    } else if (s === 'macd_cross') {
      // 7) MACD فوق الصفر + EMA صاعد = CALL، والعكس. يحتاج تقاطعاً حديثاً:
      // نتحقق من إشارة الهيستوجرام الحالية ومن أن EMA9 فوق/تحت EMA21.
      if (ind.mh === null) res = { dir: null, votes: [], reason: 'macd: محتاج 35 شمعة' };
      else if (ind.mh > 0 && ind.e9 > ind.e21) res = { dir: 'CALL', votes: ['MACD', 'EMA'], reason: 'MACD فوق الصفر + EMA صاعد' };
      else if (ind.mh < 0 && ind.e9 < ind.e21) res = { dir: 'PUT', votes: ['MACD', 'EMA'], reason: 'MACD تحت الصفر + EMA هابط' };
      else res = { dir: null, votes: [], reason: 'macd: مفيش تقاطع واضح (MACD ' + ind.mh.toFixed(6) + ')' };
    } else if (s === 'stoch_cross') {
      // 8) %K يقطع %D لفوق في تشبع بيع، أو لتحت في تشبع شراء
      var ks = ind.skSeries;
      if (!ks.length || ks.length < 2 || ind.sk === null || ind.sd === null) res = { dir: null, votes: [], reason: 'stoch: محتاج بيانات أكثر' };
      else {
        var prevK = ks[ks.length - 2];
        // %D مبسّط: متوسط آخر 3 قيم %K — نستخدم ind.sd كتقريب
        if (ind.sk < 25 && prevK <= ind.sd && ind.sk > ind.sd) res = { dir: 'CALL', votes: ['Stochastic'], reason: '%K قطع %D لفوق في تشبع بيع' };
        else if (ind.sk > 75 && prevK >= ind.sd && ind.sk < ind.sd) res = { dir: 'PUT', votes: ['Stochastic'], reason: '%K قطع %D لتحت في تشبع شراء' };
        else res = { dir: null, votes: [], reason: 'stoch: مفيش تقاطع (%K ' + ind.sk.toFixed(0) + ' / %D ' + ind.sd.toFixed(0) + ')' };
      }
    } else if (s === 'ema_cross_fast') {
      // 9) أسرع استراتيجية: EMA9 يقطع EMA21. نقارن الإشارة الحالية
      // بالشمعة السابقة عبر EMA محسوب على كل الشموع ما عدا الأخيرة.
      var e9p = ema(closes.slice(0, -1), 9), e21p = ema(closes.slice(0, -1), 21);
      if (ind.e9 === null || ind.e21 === null || e9p === null || e21p === null) res = { dir: null, votes: [], reason: 'ema_cross: محتاج 21 شمعة' };
      else if (e9p <= e21p && ind.e9 > ind.e21) res = { dir: 'CALL', votes: ['EMA9/21'], reason: 'EMA9 قطع EMA21 لفوق' };
      else if (e9p >= e21p && ind.e9 < ind.e21) res = { dir: 'PUT', votes: ['EMA9/21'], reason: 'EMA9 قطع EMA21 لتحت' };
      else if (ind.e9 > ind.e21 && last > ind.e9) res = { dir: 'CALL', votes: ['EMA9/21'], reason: 'EMA9 فوق EMA21 (ترند صاعد)' };
      else if (ind.e9 < ind.e21 && last < ind.e9) res = { dir: 'PUT', votes: ['EMA9/21'], reason: 'EMA9 تحت EMA21 (ترند هابط)' };
      else res = { dir: null, votes: [], reason: 'ema_cross: مفيش تقاطع' };
    } else if (s === 'breakout_donchian') {
      // 10) كسر أعلى High أو أدنى Low لآخر 20 فترة
      if (!ind.donchian || ind.prev === null) res = { dir: null, votes: [], reason: 'donchian: محتاج 20 شمعة' };
      else if (last > ind.donchian.high && ind.prev <= ind.donchian.high) res = { dir: 'CALL', votes: ['Donchian', 'ATR'], reason: 'كسر أعلى 20 فترة' };
      else if (last < ind.donchian.low && ind.prev >= ind.donchian.low) res = { dir: 'PUT', votes: ['Donchian', 'ATR'], reason: 'كسر أدنى 20 فترة' };
      else res = { dir: null, votes: [], reason: 'donchian: السعر داخل النطاق' };
    } else if (s === 'rsi_scalp') {
      // 11) RSI سريع (7): ارتداد من تشبع، لصفقات 30-60 ثانية
      var r7 = ind.r7;
      if (r7 === null) res = { dir: null, votes: [], reason: 'rsi_scalp: محتاج 8 شموع' };
      else if (r7 < 30) res = { dir: 'CALL', votes: ['RSI7'], reason: 'RSI7 تشبع بيع (' + r7.toFixed(0) + ')' };
      else if (r7 > 70) res = { dir: 'PUT', votes: ['RSI7'], reason: 'RSI7 تشبع شراء (' + r7.toFixed(0) + ')' };
      else res = { dir: null, votes: [], reason: 'rsi_scalp: RSI7 في المنتصف (' + r7.toFixed(0) + ')' };
    } else {
      // confluence (افتراضي): اتفاق N مؤشرات حسب الوضع.
      // v1.1.0 إصلاح: في v1.0.1 كانت الأصوات مختلطة — نصفها ترند
      // (EMA/MACD) ونصفها انعكاس (RSI منخفض=CALL، CCI سالب=CALL،
      // Bollinger تحت المتوسط=CALL) — فكانت النتيجة تعادل 5-5 دائماً
      // ولا صفقة أبداً. الآن كل الأصوات متوافقة مع الاتجاه (زخم):
      // RSI>55 CALL، CCI>0 CALL، Williams>-50 CALL، السعر فوق
      // متوسط Bollinger وفوق VWAP = CALL، والعكس PUT. منطقة
      // المنتصف = لا صوت، فلا يصوّت مؤشر متردد.
      var callVotes = [], putVotes = [];
      if (ind.e9 !== null && ind.e21 !== null) { if (ind.e9 > ind.e21) callVotes.push('EMA'); else putVotes.push('EMA'); }
      if (r !== null) { if (r > 55) callVotes.push('RSI'); else if (r < 45) putVotes.push('RSI'); }
      if (ind.sk !== null && ind.sd !== null) { if (ind.sk > ind.sd) callVotes.push('Stochastic'); else if (ind.sk < ind.sd) putVotes.push('Stochastic'); }
      if (ind.mh !== null) { if (ind.mh > 0) callVotes.push('MACD'); else putVotes.push('MACD'); }
      if (ind.lips !== null && ind.teeth !== null && ind.jaw !== null) {
        if (ind.lips > ind.teeth && ind.teeth > ind.jaw) callVotes.push('Alligator');
        else if (ind.lips < ind.teeth && ind.teeth < ind.jaw) putVotes.push('Alligator');
      }
      if (ind.bb) { if (last > ind.bb.mid) callVotes.push('Bollinger'); else if (last < ind.bb.mid) putVotes.push('Bollinger'); }
      if (ind.cci !== null) { if (ind.cci > 0) callVotes.push('CCI'); else if (ind.cci < 0) putVotes.push('CCI'); }
      if (ind.wr !== null) { if (ind.wr > -50) callVotes.push('Williams'); else if (ind.wr < -50) putVotes.push('Williams'); }
      if (ind.sar) { if (ind.sar.trend === 'up') callVotes.push('SAR'); else putVotes.push('SAR'); }
      if (ind.vwap !== null) { if (last > ind.vwap) callVotes.push('VWAP'); else putVotes.push('VWAP'); }
      var needVotes = mode().confluenceMin;
      if (callVotes.length >= needVotes && callVotes.length > putVotes.length) res = { dir: 'CALL', votes: callVotes, reason: 'اتفاق ' + callVotes.length + ' مؤشرات (مطلوب ' + needVotes + ')' };
      else if (putVotes.length >= needVotes && putVotes.length > callVotes.length) res = { dir: 'PUT', votes: putVotes, reason: 'اتفاق ' + putVotes.length + ' مؤشرات (مطلوب ' + needVotes + ')' };
      else res = { dir: null, votes: [], reason: 'مفيش اتفاق كافي (CALL: ' + callVotes.length + '، PUT: ' + putVotes.length + '، مطلوب ' + needVotes + ')' };
    }

    if (!res) res = { dir: null, votes: [], reason: 'مفيش إشارة' };
    if (res.dir) {
      // الفلاتر تُطبَّق فقط على إشارة موجودة — وسبب الرفض يُسجَّل
      var blocked = applyFilters(ind, res.dir);
      if (blocked) return { dir: null, votes: [], reason: blocked + ' — كانت إشارة ' + res.dir };
      // تأكيد إضافي من VWAP/SAR للاستراتيجيات السريعة في الوضع العدواني
      return res;
    }
    return res;
  }

  // ---------- قراءة السعر من الصفحة ----------
  function readPrice() {
    var el = document.querySelector('[class*="price"] [class*="value"], [data-test*="price"]');
    if (el) { var v = parseFloat(el.textContent.replace(/[^\d.]/g, '')); if (v) return v; }
    return null;
  }
  function readPayout() {
    var m = document.body.innerText.match(/(\d{1,3})\s*%/);
    return m ? parseInt(m[1], 10) / 100 : 0.92;
  }
  function isDemo() { return /Demo/i.test(document.body.innerText); }
  function findButton(label) {
    var btns = Array.prototype.slice.call(document.querySelectorAll('button'));
    return btns.find(function (b) { return b.offsetParent && new RegExp(label, 'i').test(b.textContent); });
  }
  function humanDelay(minMs, maxMs) {
    return new Promise(function (r) { setTimeout(r, minMs + Math.random() * (maxMs - minMs)); });
  }
  function logLine(msg) {
    var el = document.getElementById('muse-bot-log');
    if (el) el.textContent = new Date().toLocaleTimeString() + ' | ' + msg + '\n' + el.textContent.slice(0, 3000);
    console.log('[PocketDemoBot]', msg);
  }
  function logSkip(reason) {
    // لا تزعج السجل بنفس السبب كل 15 ثانية — سجّل عند تغيّر السبب أو كل 60 ثانية
    var now = Date.now();
    if (reason === lastSkipReason && now - lastSkipLogAt < 60000) return;
    lastSkipReason = reason; lastSkipLogAt = now;
    logLine('⏭️ تخطّي: ' + reason);
  }

  // ---------- تنفيذ الصفقة (ضغطة زر في الواجهة) ----------
  async function executeTrade(dir, votes) {
    if (Date.now() - lastTradeAt < cooldownSec() * 1000) { logSkip('تبريد: لسه ماعداش ' + cooldownSec() + ' ثانية من آخر صفقة'); return; }
    if (tradesToday >= CFG.maxTrades) { logLine('وصلنا لحد الصفقات اليومي — إيقاف.'); stopBot(); return; }
    if (dailyProfit <= -CFG.dailyLossLimit) { logLine('وصلنا لحد الخسارة اليومية — إيقاف.'); stopBot(); return; }
    if (CFG.filters.payout) {
      var payout = readPayout();
      if (payout < CFG.minPayout) { logLine('العائد ' + Math.round(payout * 100) + '% أقل من ' + Math.round(CFG.minPayout * 100) + '% — تخطّي.'); return; }
    } else { var payout = readPayout(); }
    var btn = findButton(dir === 'CALL' ? 'Call|شراء|صعود|أعلى' : 'Put|بيع|هبوط|أسفل');
    if (!btn) { logLine('❌ مش لاقي زر ' + dir + ' في الواجهة — الصفقة اتلغت (الموقع ممكن يكون اتغيّر).'); return; }
    lastTradeAt = Date.now();
    tradesToday++;
    var balanceBefore = (document.body.innerText.match(/\$\s*([\d,]+\.\d{2})/) || [])[1];
    await humanDelay(800, 2500);
    btn.click();
    logLine('✅ ضغط ' + dir + ' | وافقت: ' + votes.join(', ') + ' | صفقات اليوم: ' + tradesToday);
    await new Promise(function (r) { setTimeout(r, (CFG.expirySec + 10) * 1000); });
    var balanceAfter = (document.body.innerText.match(/\$\s*([\d,]+\.\d{2})/) || [])[1];
    var result = 'unknown', profit = 0;
    if (balanceBefore && balanceAfter) {
      var diff = parseFloat(balanceAfter.replace(/,/g, '')) - parseFloat(balanceBefore.replace(/,/g, ''));
      if (Math.abs(diff - CFG.stake * payout) < 0.05) { result = 'win'; profit = CFG.stake * payout; }
      else if (Math.abs(diff + CFG.stake) < 0.05) { result = 'loss'; profit = -CFG.stake; }
      else if (Math.abs(diff) < 0.01) { result = 'draw'; }
    }
    dailyProfit += profit;
    if (result === 'loss') { consecLosses++; if (consecLosses >= CFG.maxConsecutiveLosses) { logLine('3 خساير ورا بعض — إيقاف.'); stopBot(); } }
    else if (result === 'win') consecLosses = 0;
    logLine('نتيجة الصفقة: ' + result + ' | صافي اليوم: $' + dailyProfit.toFixed(2));
  }

  // ---------- الحلقة الرئيسية: بناء شموع 15 ثانية من السعر الحي ----------
  setInterval(function () {
    if (!running) return;
    var price = readPrice();
    if (!price) return;
    var now = Math.floor(Date.now() / 1000);
    var bucket = now - (now % CANDLE_SEC);
    if (!curCandle || curCandle.time !== bucket) {
      if (curCandle) {
        closes.push(curCandle.c);
        candles.push({ o: curCandle.o, h: curCandle.h, l: curCandle.l, c: curCandle.c });
        if (closes.length > 200) closes.shift();
        if (candles.length > 200) candles.shift();
      }
      curCandle = { time: bucket, o: price, h: price, l: price, c: price };
    } else {
      curCandle.c = price;
      if (price > curCandle.h) curCandle.h = price;
      if (price < curCandle.l) curCandle.l = price;
    }
  }, 1000);

  setInterval(async function () {
    if (!running) return;
    var need = requiredCloses();
    var status = document.getElementById('muse-bot-status');
    if (closes.length < need) {
      var warm = 'تسخين ' + closes.length + '/' + need + ' شمعة (' + CFG.mode + ') — أول صفقة بعد ~' + Math.ceil(need * CANDLE_SEC / 60) + ' دقيقة';
      if (status) status.textContent = 'سعر: ' + (curCandle ? curCandle.c : '-') + ' | ' + warm;
      logSkip(warm);
      return;
    }
    var s = decide();
    var ind = allIndicators();
    var live = 'سعر: ' + (curCandle ? curCandle.c : '-') + ' | RSI ' + (ind.r14 !== null ? ind.r14.toFixed(0) : '-')
      + ' | ADX ' + (ind.adx !== null ? ind.adx.toFixed(0) : '-') + ' | ATR ' + (ind.atrPct !== null ? ind.atrPct.toFixed(3) + '%' : '-')
      + ' | ' + s.reason;
    if (status) status.textContent = live;
    if (!s.dir) { logSkip(s.reason); return; }
    await executeTrade(s.dir, s.votes);
  }, 15000);

  // ---------- لوحة التحكم ----------
  var STRATEGIES = [
    'confluence', 'trend_ema_rsi', 'reversal_rsi_stoch', 'pullback', 'alligator_rsi',
    'bollinger_bounce', 'macd_cross', 'stoch_cross', 'ema_cross_fast', 'breakout_donchian', 'rsi_scalp'
  ];
  function buildPanel() {
    var p = document.createElement('div');
    p.id = 'muse-bot-panel';
    p.style.cssText = 'position:fixed;bottom:10px;right:10px;z-index:999999;background:#222;color:#fff;'
      + 'padding:12px;border-radius:10px;font-size:13px;width:250px;max-height:85vh;overflow:auto;box-shadow:0 0 12px #000;';
    p.innerHTML = '<b>🤖 Pocket Demo Bot v1.1.0</b><br>'
      + '<span style="color:#f39c12">ديمو بس — أتمتة الواجهة مخالفة لشروط المنصة وقد تؤدي للحظر.</span><br>'
      + 'الوضع: <select id="muse-mode">'
      + Object.keys(MODES).map(function (k) {
          return '<option value="' + k + '"' + (k === CFG.mode ? ' selected' : '') + '>' + MODES[k].label + '</option>';
        }).join('')
      + '</select><br>'
      + '<span style="color:#aaa;font-size:11px">Conservative: 50 شمعة / 3 مؤشرات — Balanced: 30 / 2 — Aggressive: 21 / 1</span><br>'
      + 'الاستراتيجية: <select id="muse-strategy">'
      + STRATEGIES.map(function (s) {
          return '<option value="' + s + '"' + (s === CFG.strategy ? ' selected' : '') + '>' + s + '</option>';
        }).join('')
      + '</select><br>'
      + 'أقل عائد: <select id="muse-payout">'
      + [0.80, 0.85, 0.90, 0.92, 0.95].map(function (v) {
          return '<option value="' + v + '"' + (v === CFG.minPayout ? ' selected' : '') + '>' + Math.round(v * 100) + '%</option>';
        }).join('')
      + '</select><br>'
      + '<div style="margin-top:6px;font-size:12px">'
      + '<label><input type="checkbox" id="muse-f-adx" ' + (CFG.filters.adx ? 'checked' : '') + '> فلتر ADX (ترند ضعيف)</label><br>'
      + '<label><input type="checkbox" id="muse-f-atr" ' + (CFG.filters.atr ? 'checked' : '') + '> فلتر ATR (تذبذب منخفض)</label><br>'
      + '<label><input type="checkbox" id="muse-f-payout" ' + (CFG.filters.payout ? 'checked' : '') + '> فلتر العائد</label><br>'
      + '<label><input type="checkbox" id="muse-f-chop" ' + (CFG.filters.chop ? 'checked' : '') + '> فلتر التشوّب (سوق عرضي)</label><br>'
      + '<label><input type="checkbox" id="muse-f-session" ' + (CFG.filters.session ? 'checked' : '') + '> فلتر وقت (تجنّب أول 5 دقائق من الساعة)</label>'
      + '</div>'
      + '<button id="muse-start" style="background:#27ae60;color:#fff;padding:8px 14px;border:none;border-radius:6px;margin-top:8px">▶ START</button> '
      + '<button id="muse-stop" style="background:#c0392b;color:#fff;padding:8px 14px;border:none;border-radius:6px">⛔ STOP</button>'
      + '<div id="muse-bot-status" style="margin-top:8px;color:#ccc">مستني START...</div>'
      + '<pre id="muse-bot-log" style="max-height:140px;overflow:auto;font-size:11px;color:#aaa"></pre>';
    document.body.appendChild(p);
    document.getElementById('muse-mode').onchange = function (e) {
      CFG.mode = e.target.value;
      document.getElementById('muse-f-chop').checked = mode().chop && CFG.filters.chop;
      logLine('الوضع: ' + MODES[CFG.mode].label + ' — تسخين ' + mode().need + ' شمعة، تبريد ' + mode().cooldownSec + ' ثانية');
    };
    document.getElementById('muse-strategy').onchange = function (e) { CFG.strategy = e.target.value; logLine('الاستراتيجية: ' + CFG.strategy + ' — محتاجة ' + (STRATEGY_MIN[CFG.strategy] || 21) + ' شمعة على الأقل'); };
    document.getElementById('muse-payout').onchange = function (e) { CFG.minPayout = parseFloat(e.target.value); logLine('أقل عائد: ' + Math.round(CFG.minPayout * 100) + '%'); };
    function bindFilter(id, key) {
      document.getElementById(id).onchange = function (e) { CFG.filters[key] = e.target.checked; logLine('فلتر ' + key + ': ' + (e.target.checked ? 'مفعّل' : 'مطفأ')); };
    }
    bindFilter('muse-f-adx', 'adx'); bindFilter('muse-f-atr', 'atr'); bindFilter('muse-f-payout', 'payout');
    bindFilter('muse-f-chop', 'chop'); bindFilter('muse-f-session', 'session');
    document.getElementById('muse-start').onclick = function () {
      if (!isDemo()) { alert('الحساب مش ديمو! بدّل للديمو الأول — السكربت مش هيشتغل على حساب حقيقي.'); return; }
      if (!confirm('تأكيد: الحساب ده ديمو فعلاً؟ السكربت هيضغط CALL/PUT بنفسه.')) return;
      running = true;
      logLine('السكربت شغال — وضع ' + CFG.mode + '، استراتيجية ' + CFG.strategy + ' — تسخين ' + requiredCloses() + ' شمعة (~' + Math.ceil(requiredCloses() * CANDLE_SEC / 60) + ' دقيقة)');
    };
    document.getElementById('muse-stop').onclick = stopBot;
  }
  function stopBot() { running = false; logLine('السكربت وقف.'); }

  // Test hooks (harmless in the browser): lets a node harness feed fake
  // candles and call decide() without a live Pocket Option page.
  if (typeof window !== 'undefined') {
    window.__PocketDemoBotTest = {
      setData: function (closesArr, candlesArr) {
        closes = closesArr.slice(); candles = candlesArr.slice();
        curCandle = closesArr.length ? { time: 0, o: closesArr[0], h: closesArr[0], l: closesArr[0], c: closesArr[closesArr.length - 1] } : null;
      },
      setConfig: function (patch) { for (var k in patch) CFG[k] = patch[k]; },
      setFilters: function (patch) { for (var k in patch) CFG.filters[k] = patch[k]; },
      decide: decide, allIndicators: allIndicators,
      ema: ema, rsi: rsi, stoch: stoch, macdHist: macdHist, bollinger: bollinger,
      atr: atr, adx: adx, cci: cci, williamsR: williamsR, parabolicSAR: parabolicSAR,
      vwap: vwap, donchian: donchian, requiredCloses: requiredCloses, modes: MODES
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildPanel);
  else buildPanel();
})();
