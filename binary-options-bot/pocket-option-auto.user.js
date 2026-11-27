// ==UserScript==
// @name         Pocket Option Demo Auto Trader (human-like clicks)
// @namespace    https://example.local/pocket-demo-bot
// @version      1.2.1
// @description  Automated trading on the Pocket Option DEMO account only, by clicking CALL/PUT in the page like a human. No session token, no API, no login data — you log in yourself. For learning/testing on demo only.
// @match        https://pocketoption.com/*
// @match        https://*.pocketoption.com/*
// @match        https://m.pocketoption.com/*
// @grant        none
// @run-at       document-start
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

  ============================================================
  v1.1.1 — إصلاح قراءة السعر على موبايل Pocket Option
  ============================================================
  المشكلة في v1.1.0: readPrice() كان يجرب محدداً واحداً فقط
  ('[class*="price"] [class*="value"]')، وفي نسخة الموبايل
  (m.pocketoption.com) السعر ظاهر في الصفحة (مثلاً 1.00166
  في المربع الأزرق على اليمين) لكن لا يطابق هذا المحدد،
  فكان يرجع null دائماً، واللوحة تظهر "سعر: -" والتسخين
  عالق على 0/30 شمعة، فلا صفقة أبداً.
  الإصلاح في v1.1.1:
  - قراءة السعر بعدة طرق بالترتيب: محددات صريحة كثيرة،
    ثم خصائص data-price، ثم منطقة الشارت، ثم مسح عام
    لأرقام عشرية (4-5 خانات) مع تفضيل الأقرب لآخر سعر
    معروف والأقرب لصندوق السعر أعلى اليمين.
  - اللوحة تعرض الآن آخر سعر مقروء ووقت آخر قراءة ناجحة،
    فالمستخدم يرى خلال ثوانٍ هل القراءة تعمل أم لا.
  - إذا لم يُقرأ السعر 60 ثانية، تظهر رسالة عربية واضحة
    في السجل: "مش لاقي السعر في الصفحة - جرّب وضع سطح
    المكتب أو أعد تحميل الصفحة"، ويستمر في المحاولة
    دون أن يتعطل السكربت.
  - كل شيء آخر في v1.1.0 بلا تغيير (11 استراتيجية،
    الأوضاع، الفلاتر، حدود المخاطر، ديمو فقط).

  ============================================================
  v1.1.2 — قراءة السعر لسه فاشلة على الموبايل، تشخيص عدواني
  ============================================================
  المشكلة في v1.1.1: السكربت مثبّت صح (اللوحة تقول v1.1.1)
  لكن اللوحة لسه حمراء "السعر: - | آخر قراءة: لم تُقرأ بعد"
  والتسخين عالق على 0/30، مع أن السعر ظاهر في الصفحة
  (1.00264 / 1.00400 في محور الشارت). إذن السعر ليس في
  عنصر ورقي عادي بنص "1.00264" بالضبط، بل غالباً في
  <svg><text>، أو Shadow DOM، أو iframe، أو داخل نص أكبر.
  الإصلاح في v1.1.2:
  - قراءة السعر الآن بعدة طرق إضافية بالترتيب: عناصر SVG
    (svg text / tspan)، ثم اجتياز Shadow DOM بشكل متكرر،
    ثم iframes من نفس النطاق (try/catch)، ثم مسح كامل
    لـ innerText للصفحة كلها ببحث regex عن كل الأرقام
    العشرية \d+\.\d{3,5} مع تسجيلها — حتى لو الرقم داخل
    نص أكبر مثل "1.00264 1.00400" — ثم عنوان الصفحة و meta
    كملاذ أخير.
  - قسم تشخيص جديد في اللوحة (muse-bot-diag) يحدَّث كل
    15 ثانية ويعرض أفضل 5 مرشحات للسعر مع نقاطها، وعدد
    الأرقام العشرية الموجودة، وعدد نصوص SVG و Shadow roots
    و iframes — حتى يرسل المستخدم لقطة ونرى ما الذي يراه
    البوت فعلاً على صفحة الموبايل الحية.
  - المرشحات تُسجَّل في سجل اللوحة أيضاً عند أول فحص.
  - كل شيء آخر بلا تغيير (11 استراتيجية، الأوضاع، الفلاتر،
    حدود المخاطر، ديمو فقط، بلا SSID/API).


  ============================================================
  v1.1.3 — السعر على الموبايل مرسوم على Canvas فقط، مصدر خارجي
  (ملاحظة: هذا المصدر الخارجي أُلغي بالكامل في v1.1.4 بناءً على
  طلب المستخدم — السعر الآن من الصفحة فقط)
  ============================================================
  الدليل من لقطة المستخدم (v1.1.2، الساعة 10:31):
  "تشخيص السعر: 1.92 (2)، 0.92 (2) | أرقام عشرية: 1 |
  SVG: 0 | Shadow: 0 | iframes: 0/1" — الأرقام العشرية
  الوحيدة التي يراها السكربت هي 1.92 (دولار العائد) و 0.92
  (نسبة العائد 92%)، ولا يوجد أي سعر مثل 1.00xxx في DOM
  إطلاقاً، ولا SVG ولا Shadow DOM، والـ iframe الوحيد
  كروس-أوريجن ولا يمكن قراءته. إذن سعر الشارت مرسوم
  على <canvas> فقط، ولا قارئ DOM يستطيع رؤيته.
  في v1.1.3 جُرّب مصدر سعر خارجي عام كحل مؤقت، لكنه فشل
  على هاتف المستخدم (حظر CORS)، ثم أُلغي نهائياً في v1.1.4
  بناءً على طلب المستخدم — لا كود له ولا أثر وظيفي له هنا.
  - كل شيء آخر بلا تغيير (11 استراتيجية، الأوضاع،
    الفلاتر، حدود المخاطر، ديمو فقط، بلا SSID/API/كوكيز).

  ============================================================
  v1.1.4 — السعر من الصفحة فقط: DOM + خطاف WebSocket
  (المصادر العامة الخارجية أُلغيت بناءً على طلب المستخدم)
  ============================================================
  الدليل من لقطة المستخدم (v1.1.3، الساعة 10:41):
  اللوحة v1.1.3 مثبّتة صح لكن السعر لسه "-" والتسخين 0/30،
  والتشخيص نفسه (1.92 / 0.92 فقط)، والسجل يقول "⚠️ مش لاقي
  السعر في الصفحة ولا من Yahoo". إذن جلب Yahoo فشل على
  هاتف المستخدم — غالباً حظر CORS في Firefox موبايل.
  قرار المستخدم: لا مصادر خارجية/عامة إطلاقاً للسعر.
  لذلك في v1.1.4 أُزيلت كل المصادر العامة (Yahoo وكل
  بدائله) من الكود نهائياً — لا جلب خارجي، لا fetch
  لأسعار من أي موقع، والسعر يأتي فقط مما هو موجود أصلاً
  في صفحة المتصفح نفسها:
  1) قراءة DOM (طرق v1.1.2 كلها) — المصدر الأول.
  2) خطاف WebSocket (المصدر الجديد — سعر المنصة نفسه،
     بلا اختلاف OTC): السكربت يحقن <script> في سياق
     الصفحة يغلّف WebSocket (المنشئ + addEventListener +
     onmessage) ويفحص كل رسالة واردة من سوكيت المنصة
     نفسها، ويستخرج سعر الزوج الحالي (مثلاً AUDCAD) من
     حقول price/close/last أو من مفتاح يحمل اسم الزوج،
     وينشره في عنصر DOM مخفي #muse-po-price (data-price)
     يقرأه السكربت. لا يُرسل شيئاً للخارج، ولا يقرأ أي
     كوكيز، ولا يستخرج أي بيانات دخول — البيانات أصلاً
     تتدفق في متصفح المستخدم نفسه، والسكربت يستمع لها
     فقط. هذا قراءة من الصفحة، وليس مصدراً خارجياً.
     ملاحظة صادقة: الخطاف يمسك السوكيتات التي تُنشأ بعد
     الحقن وأي إعادة اتصال؛ سوكيت كان مفتوحاً قبل الحقن
     قد لا يُمسك حتى يعيد الاتصال. لهذا @run-at أصبح
     document-start حتى يكون الخطاف موجوداً قبل أن تنشئ
     الصفحة سوكيتها.
  3) تشخيص ما يراه الخطاف: سطر التشخيص يعرض عدد رسائل
     السوكيت التي فحصها الخطاف، وآخر مرة رأى فيها سعراً،
     ومصدر السعر النشط (الصفحة / WebSocket). وإذا مرت
     60 ثانية بلا أي رسالة سعر من السوكيت، يسجّل السجل
     بالعربي أن الخطاف لم يرَ رسائل سعر، ويستمر في المحاولة.
  ترتيب مصادر السعر الآن: الصفحة (DOM) -> WebSocket المنصة.
  لا شيء غيرهما. وبما أن السعر من المنصة نفسها، فلا يوجد
  تحذير عدم تطابق OTC في هذه النسخة.
  - كل شيء آخر بلا تغيير (11 استراتيجية، الأوضاع،
    الفلاتر، حدود المخاطر، ديمو فقط، بلا SSID/API/كوكيز).


  ============================================================
  v1.2.0 — لوحة تحكم جديدة: حدود يكتبها المستخدم بنفسه
  واختيار استراتيجيات متعددة (تصحيحات المستخدم)
  ============================================================
  تصحيح مهم من المستخدم: هو لم يحدد أبداً "10 صفقات في اليوم"
  كحد أقصى — كان ذلك افتراضاً منا، فأُلغي. الآن كل الحدود
  حقول قابلة للتعديل في اللوحة، يكتبها المستخدم بنفسه:
  - مبلغ الصفقة (stake): افتراضي 1 دولار.
  - الربح اليومي المستهدف: افتراضي 10 دولار، 0 = بلا هدف.
    عند وصول صافي اليوم للهدف يتوقف البوت ويسجّل ذلك.
  - الخسارة اليومية القصوى: افتراضي 10 دولار.
  - أقصى عدد صفقات في اليوم: افتراضي 0 = بلا حد (بدون حد).
    البوت يتوقف فقط إذا كانت القيمة > 0 ووصل لها.
  - إيقاف بعد خسائر متتالية: حقل قابل للتعديل، افتراضي 3.
  - اللوحة تعرض لحظياً: صفقات اليوم | صافي اليوم |
    الهدف | المتبقي للهدف.
  اختيار استراتيجيات متعددة: لم يعد المستخدم مضطراً لاختيار
  استراتيجية واحدة. اللوحة الآن فيها خانات اختيار لكل
  الاستراتيجيات الـ 11، مع زرّي "اختر الكل" / "إلغاء الكل".
  الافتراضي: confluence + ema_cross_fast.
  منطق الدخول: في كل فحص تُقيَّم كل استراتيجية مختارة،
  وتُجمع إشارات CALL وإشارات PUT. دخول CALL إذا كانت
  إشارات CALL >= 1 ولا إشارات PUT، والعكس لـ PUT. إذا
  كان هناك إشارات من الجهتين، تدخل جهة الأكثر، وتُتخطى
  الصفقة عند التعادل (وتُسجَّل "إشارات متعارضة").
  confluence نفسها تحتفظ بقاعدتها الداخلية (>=2 في
  Balanced / >=3 في Conservative) عندما تكون مختارة.
  كل شيء آخر بلا تغيير: السعر من الصفحة فقط (DOM +
  خطاف WebSocket)، بلا مصادر خارجية، بلا fetch خارجي،
  الأوضاع، الفلاتر القابلة للتبديل، ديمو فقط، بلا SSID/API/كوكيز.

  ============================================================
  v1.2.1 — خطاف WebSocket كان يسمع الرسائل لكنه لا يعرف الزوج
  ============================================================
  الدليل من لقطة المستخدم (v1.2.0، الساعة 10:55):
  اللوحة تعمل، وإعدادات المستخدم محفوظة (مبلغ $11، هدف $1020،
  خسارة قصوى $105، إيقاف بعد 35 خسارة متتالية، استراتيجيات
  confluence + ema_cross_fast + rsi_scalp، صفقات بلا حد)،
  والتشخيص يقول "WebSocket: مثبّت، رسائل: 36، بلا سعر بعد"،
  والسجل يقول "فحص 28 رسالة لكن مفيش فيها سعر الزوج الحالي (؟)".
  إذن الخطاف مثبّت والرسائل تتدفق، لكن readAssetName() كان يقرأ
  اسم الزوج من body.innerText فقط — والتشخيص نفسه قال "أرقام
  عشرية: 0"، أي أن innerText كان بلا نص في تلك اللحظة — فعاد
  اسم الزوج فارغاً، ولم يستطع الخطاف مطابقة أي سعر.
  الإصلاح في v1.2.1:
  - readAssetName() يجرّب الآن مصادر كثيرة بالترتيب: عنوان
    الصفحة، زر اختيار الزوج، عناصر asset/symbol/pair، meta،
    نص الصفحة، ثم الرابط. وإن لم يجد شيئاً يعيد المحاولة بعد
    5 ثوانٍ فقط (بدل 60)، ويسجّل اسم الزوج عند تغيّره.
  - استخراج السعر من رسائل WebSocket لم يعد يشترط معرفة الزوج:
    إن كان الزوج مجهولاً، يُقبل أول رقم سعر محتمل (3-5 خانات
    عشرية، 0.1-200) — فيرفض الرصيد والمبلغ والعائد — سواء كان
    في حقل سعر، أو تحت مفتاح يحمل اسم زوج (مثل {"AUDCAD":...})،
    أو نصاً رقمياً عارياً. كما تُزال أغلفة Socket.IO "42[...]"
    و SockJS "a[...]" قبل فك JSON، وتُقرأ الإطارات الثنائية
    (ArrayBuffer/Blob) بعد فك ترميزها.
  - عينة تشخيص جديدة: الخطاف يسجّل أول 3 أشكال رسائل مختلفة
    (قائمة مفاتيح فقط، بلا قيم) وأول سعر محتمل في كل منها،
    وتظهر في اللوحة تحت التشخيص، حتى نرى من اللقطة شكل رسائل
    المنصة الحقيقي. الرسائل التي تحوي مفاتيح حساسة (token /
    ssid / session / auth...) لا تُسجَّل مفاتيحها ولا قيمها أبداً.
  - تحذير الـ 60 ثانية يعرض الآن اسم الزوج الذي جرّبه (أو
    "غير معروف") وعدد الرسائل المفحوصة وعينة المفاتيح.
  إصلاحات إضافية في نفس النسخة (بطلب المستخدم):
  - حقول الإدخال كانت بيضاء والنص أبيض فلا يظهر: الآن كل
    حقول الإدخال والقوائم والأزرار في اللوحة لها قاعدة CSS
    صريحة (خلفية بيضاء، نص أسود، حد 1px #888، خط 14px،
    حشوة 4px)، واللوحة نفسها تبقى داكنة (#222) بنص أبيض.
  - حفظ الإعدادات: كل إعدادات اللوحة (المبالغ والحدود والوضع
    والاستراتيجيات والفلاتر) تُحفظ في localStorage تحت مفتاح
    'muse-pocket-bot-settings-v1' عند كل تغيير، وتُستعاد عند
    إعادة فتح الصفحة/المتصفح، مع سجل "تم تحميل الإعدادات
    المحفوظة". التداول لا يبدأ تلقائياً أبداً بعد إعادة
    التحميل — يجب الضغط على START في كل مرة، للأمان.
  كل شيء آخر بلا تغيير (لوحة v1.2.0، استراتيجيات متعددة،
  حدود يكتبها المستخدم، السعر من الصفحة فقط، بلا مصادر
  خارجية، بلا fetch، ديمو فقط، بلا SSID/API/كوكيز).

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
    // v1.2.0: استراتيجيات متعددة قابلة للاختيار (خانات اختيار في اللوحة)
    // الافتراضي: confluence + ema_cross_fast. لم يعد هناك استراتيجية واحدة.
    strategies: ['confluence', 'ema_cross_fast'],
    strategy: 'confluence', // محفوظ للتوافق الخلفي فقط — لا يُستخدم في decide() بعد الآن
    stake: 1.0,               // مبلغ الصفقة بالدولار — حقل قابل للتعديل في اللوحة
    expirySec: 60,            // مدة الصفقة بالثواني
    // v1.2.0: المستخدم لم يحدد أبداً حد 10 صفقات — كان افتراضاً منا.
    // maxTrades = 0 يعني بلا حد. البوت يتوقف فقط إذا كانت القيمة > 0.
    maxTrades: 0,             // أقصى عدد صفقات في اليوم (0 = بلا حد)
    dailyProfitTarget: 10.0,  // الربح اليومي المستهدف بالدولار (0 = بلا هدف)
    dailyLossLimit: 10.0,     // أقصى خسارة يومية بالدولار
    maxConsecutiveLosses: 3,  // إيقاف بعد N خساير ورا بعض — حقل قابل للتعديل
    minPayout: 0.85,          // فلتر العائد: مفيش دخول لو العائد أقل من 85%
    minAtrPct: 0.01,          // فلتر ATR: أقل تذبذب مقبول (% من السعر)
    // الفلاتر — كل واحد قابل للتبديل من اللوحة
    filters: { adx: true, atr: true, payout: true, chop: true, session: false }
  };
  var running = false, tradesToday = 0, dailyProfit = 0, consecLosses = 0, lastTradeAt = 0;
  // حالة قراءة السعر (v1.1.1): آخر سعر ناجح وطريقته ووقته،
  // حتى تظهر اللوحة ما إذا كانت القراءة تعمل أم عالقة.
  var lastPrice = null, lastPriceAt = 0, lastPriceMethod = '', priceFailSince = 0, priceWarnLoggedAt = 0;
  // تشخيص قراءة السعر (v1.1.2): أفضل مرشحات السعر مع نقاطها،
  // وعدد الأرقام العشرية ونصوص SVG و Shadow roots و iframes،
  // حتى نرى من لقطة المستخدم ما الذي يراه البوت فعلاً.
  var diagState = { candidates: {}, totalDecimals: 0, svgTexts: 0, shadowRoots: 0, iframes: 0, iframesOk: 0, method: '', lastScanAt: 0 };
  var diagLoggedAt = 0, diagDisplayAt = 0;
  // v1.1.4: مصدر السعر النشط ('dom' | 'ws' | null) — الصفحة فقط.
  // لا مصادر خارجية إطلاقاً: أُزيلت كل بدائل السعر العامة من الكود.
  var priceSource = null; // 'dom' أو 'ws' أو null (لا سعر بعد)
  var currentAsset = '', currentAssetAt = 0;
  // v1.1.4: حالة خطاف WebSocket (تشخيص ما يراه الخطاف على الصفحة).
  // wsHookAt: وقت تثبيت الخطاف. wsMessagesSeen: عدد رسائل السوكيت
  // التي فحصها الخطاف. wsLastMsgAt: وقت آخر رسالة فحصها. wsPriceSeenAt:
  // وقت آخر سعر استخرجه الخطاف. wsNoPriceWarnAt: وقت آخر تحذير سُجّل.
  var wsHooked = false, wsHookAt = 0, wsMessagesSeen = 0, wsLastMsgAt = 0;
  var wsPriceSeenAt = 0, wsNoPriceWarnAt = 0;
  // v1.2.1: عينات أشكال رسائل WebSocket (مفاتيح فقط، بلا قيم) واسم
  // الزوج كما رآه الخطاف داخل الصفحة — للتشخيص في اللوحة.
  var wsDiagSamples = [], wsHookAsset = '';
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
    // v1.2.0: التسخين العام = حاجة الوضع فقط (21/30/50).
    // الحد الأدنى لكل استراتيجية يُفحص داخل decideOne() على حدة،
    // فالاستراتيجية السريعة (مثلاً ema_cross_fast: 21) تستطيع
    // التداول قبل أن تكتمل شروط استراتيجية أبطأ مختارة معها.
    return mode().need;
  }
  // v1.2.0: هل وصل البوت لأي حد يومي؟ ترجع نص السبب أو null.
  // تُفحص قبل كل صفقة وبعد كل نتيجة: حد الصفقات (فقط إذا > 0)،
  // حد الخسارة، هدف الربح، والخسائر المتتالية.
  function checkDailyLimits() {
    if (CFG.maxTrades > 0 && tradesToday >= CFG.maxTrades) {
      return 'وصلنا لحد الصفقات اليومي (' + CFG.maxTrades + ') — إيقاف.';
    }
    if (CFG.dailyLossLimit > 0 && dailyProfit <= -CFG.dailyLossLimit) {
      return 'وصلنا لحد الخسارة اليومية ($' + CFG.dailyLossLimit + ') — إيقاف.';
    }
    if (CFG.dailyProfitTarget > 0 && dailyProfit >= CFG.dailyProfitTarget) {
      return 'وصلنا لهدف الربح اليومي ($' + CFG.dailyProfitTarget + ') — إيقاف.';
    }
    if (consecLosses >= CFG.maxConsecutiveLosses) {
      return CFG.maxConsecutiveLosses + ' خساير ورا بعض — إيقاف.';
    }
    return null;
  }

  // ---------- الفلاتر (كل واحد قابل للتبديل من اللوحة) ----------
  // ترجع null إذا مرّت، أو نص السبب إذا رفضت الصفقة.
  function applyFilters(ind, dir, strat) {
    // v1.2.0: strat = الاستراتيجية التي أعطت الإشارة (لفلتر ADX الترندي).
    var f = CFG.filters, m = mode();
    strat = strat || (CFG.strategies && CFG.strategies[0]) || 'confluence';
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
    if (f.adx && trendStrategies.indexOf(strat) !== -1 && ind.adx !== null && ind.adx < 20) {
      return 'فلتر ADX: قوة الترند ' + ind.adx.toFixed(0) + ' أقل من 20 — ترند ضعيف';
    }
    return null;
  }

  // ---------- الاستراتيجيات ----------
  // decideOne(s): تقيّم استراتيجية واحدة بالاسم، ترجع
  // {dir, votes, reason} أو {dir:null, reason}. الحد الأدنى من
  // الشموع يُفحص هنا لكل استراتيجية على حدة (v1.2.0).
  function decideOne(s) {
    var sMin = STRATEGY_MIN[s] || 21;
    if (closes.length < sMin) {
      return { dir: null, votes: [], reason: s + ': تسخين ' + closes.length + '/' + sMin + ' شمعة' };
    }
    var ind = allIndicators();
    var last = ind.last, r = ind.r14;
    // RSI متطرف جداً يمنع كل الاستراتيجيات ما عدا الانعكاسية.
    // ملاحظة v1.1.0: الحد كان 75/25 في مسودة أولى، لكن الاختبار
    // الاصطناعي أثبت أنه يحظر كل صفقات الترند القوي (RSI يبقى
    // 90-100 فترات طويلة في الترند)، فتم تخفيفه إلى 95/5.
    // الاستراتيجيات نفسها أصلاً عندها حدود RSI خاصة بها.
    if (s !== 'reversal_rsi_stoch' && s !== 'bollinger_bounce' && s !== 'rsi_scalp') {
      if (r !== null && (r >= 95 || r <= 5)) return { dir: null, votes: [], reason: 'RSI متطرف جداً (' + r.toFixed(0) + ') — تخطّي' };
    }

    var res = null;

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
      var blocked = applyFilters(ind, res.dir, s);
      if (blocked) return { dir: null, votes: [], reason: blocked + ' — كانت إشارة ' + res.dir };
      // تأكيد إضافي من VWAP/SAR للاستراتيجيات السريعة في الوضع العدواني
      return res;
    }
    return res;
  }

  // ---------- v1.2.0: decide() متعدد الاستراتيجيات ----------
  // يقيّم كل استراتيجية مختارة في CFG.strategies، ويجمع إشارات
  // CALL وإشارات PUT. دخول CALL إذا كانت إشارات CALL >= 1 ولا
  // إشارات PUT، والعكس لـ PUT. إذا كانت هناك إشارات من الجهتين،
  // تدخل جهة الأكثر، وتُتخطى الصفقة عند التعادل.
  function decide() {
    var need = requiredCloses();
    if (closes.length < need) {
      return { dir: null, votes: [], reason: 'تسخين ' + closes.length + '/' + need + ' شمعة (' + CFG.mode + ') — أول صفقة بعد ~' + Math.ceil(need * CANDLE_SEC / 60) + ' دقيقة' };
    }
    // v1.2.0: قائمة فارغة صراحة = المستخدم ألغى الكل = لا صفقات.
    // نعود لـ confluence فقط إذا لم توجد قائمة أصلاً (توافق خلفي).
    if (!CFG.strategies) return { dir: null, votes: [], reason: 'مفيش استراتيجية مختارة — اختر واحدة على الأقل من اللوحة' };
    var selected = CFG.strategies.slice();
    if (!selected.length) return { dir: null, votes: [], reason: 'مفيش استراتيجية مختارة — اختر واحدة على الأقل من اللوحة' };
    var callSigs = [], putSigs = [], reasons = [];
    for (var i = 0; i < selected.length; i++) {
      var one = decideOne(selected[i]);
      if (one.dir === 'CALL') callSigs.push({ strategy: selected[i], votes: one.votes, reason: one.reason });
      else if (one.dir === 'PUT') putSigs.push({ strategy: selected[i], votes: one.votes, reason: one.reason });
      else if (one.reason) reasons.push(one.reason);
    }
    if (!callSigs.length && !putSigs.length) {
      return { dir: null, votes: [], reason: reasons.length ? reasons.join(' | ') : 'مفيش إشارة من الاستراتيجيات المختارة' };
    }
    if (callSigs.length > 0 && putSigs.length === 0) {
      var cv = [];
      callSigs.forEach(function (x) { cv = cv.concat(x.votes); });
      return { dir: 'CALL', votes: cv, strategies: callSigs.map(function (x) { return x.strategy; }), reason: 'اتفقت: ' + callSigs.map(function (x) { return x.strategy; }).join('، ') };
    }
    if (putSigs.length > 0 && callSigs.length === 0) {
      var pv = [];
      putSigs.forEach(function (x) { pv = pv.concat(x.votes); });
      return { dir: 'PUT', votes: pv, strategies: putSigs.map(function (x) { return x.strategy; }), reason: 'اتفقت: ' + putSigs.map(function (x) { return x.strategy; }).join('، ') };
    }
    // إشارات متعارضة من الجهتين: جهة الأكثر تدخل، والتعادل يُتخطى
    if (callSigs.length > putSigs.length) {
      var cv2 = [];
      callSigs.forEach(function (x) { cv2 = cv2.concat(x.votes); });
      return { dir: 'CALL', votes: cv2, strategies: callSigs.map(function (x) { return x.strategy; }), reason: 'أغلبية CALL (' + callSigs.length + ' ضد ' + putSigs.length + ' PUT) — اتفقت: ' + callSigs.map(function (x) { return x.strategy; }).join('، ') };
    }
    if (putSigs.length > callSigs.length) {
      var pv2 = [];
      putSigs.forEach(function (x) { pv2 = pv2.concat(x.votes); });
      return { dir: 'PUT', votes: pv2, strategies: putSigs.map(function (x) { return x.strategy; }), reason: 'أغلبية PUT (' + putSigs.length + ' ضد ' + callSigs.length + ' CALL) — اتفقت: ' + putSigs.map(function (x) { return x.strategy; }).join('، ') };
    }
    return { dir: null, votes: [], reason: 'إشارات متعارضة CALL ' + callSigs.length + ' PUT ' + putSigs.length + ' — تخطّي' };
  }

  // ---------- قراءة السعر من الصفحة (v1.1.1: متعددة الطرق، لموبايل Pocket Option) ----------
  // في نسخة الموبايل (m.pocketoption.com) السعر ظاهر في الصفحة
  // (مثلاً 1.00166 في المربع الأزرق أعلى اليمين) لكن كلاساته
  // لا تطابق محدد v1.0.1 الوحيد، فكان readPrice يرجع null
  // دائماً. لذلك نجرب الآن بالترتيب: محددات صريحة، ثم خصائص
  // data-*، ثم منطقة الشارت، ثم مسح عام لأرقام عشرية مع
  // تفضيل الأقرب لآخر سعر معروف ولصندوق السعر أعلى اليمين.
  // الرقم المقبول يجب أن يكون عشرياً (خانتان-5 خانات بعد
  // الفاصلة) وفي نطاق 0.01-200000، حتى لا نلتقط الرصيد
  // (152,280 بلا كسور) أو المبلغ (1) أو نسبة العائد (92%).
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
  function notePrice(v, method, source) {
    // source: 'dom' (قراءة من عناصر الصفحة) أو 'ws' (سعر المنصة
    // نفسه عبر خطاف WebSocket). لا مصادر أخرى في v1.1.4.
    // سجّل طريقة النجاح مرة واحدة عند تغيّرها فقط، حتى لا يمتلئ السجل.
    source = source || 'dom';
    if (method !== lastPriceMethod) {
      lastPriceMethod = method;
      logLine('السعر من ' + method + ': ' + v);
    }
    priceSource = source;
    lastPrice = v; lastPriceAt = Date.now(); priceFailSince = 0;
    if (source === 'ws') { wsPriceSeenAt = Date.now(); }
    diagState.method = method;
    return v;
  }
  // ---------- تشخيص قراءة السعر (v1.1.2) ----------
  // نقاط مرشح السعر: 5 خانات عشرية +10، 4 خانات +8، 3 خانات +5،
  // القرب من آخر سعر معروف +12 (ضمن 1%) أو +6 (ضمن 5%).
  function diagScore(val, extra) {
    var score = extra || 0, dec = priceDecimals(val);
    if (dec === 5) score += 10; else if (dec === 4) score += 8; else if (dec === 3) score += 5; else score += 2;
    if (lastPrice && Math.abs(val - lastPrice) / lastPrice < 0.01) score += 12;
    else if (lastPrice && Math.abs(val - lastPrice) / lastPrice < 0.05) score += 6;
    return score;
  }
  function recordCandidate(val, extra, source) {
    if (val === null || val === undefined) return;
    var v = typeof val === 'number' ? val : parseFloat(val);
    if (!isFinite(v) || v < 0.01 || v > 200000) return;
    var dec = priceDecimals(v);
    if (dec < 2 || dec > 5) return;
    var score = diagScore(v, extra || 0);
    var key = String(v);
    var prev = diagState.candidates[key];
    if (!prev || score > prev.score) diagState.candidates[key] = { value: v, score: score, source: source || '' };
  }
  function bestDiagCandidate() {
    var best = null, k;
    for (k in diagState.candidates) {
      var c = diagState.candidates[k];
      if (!best || c.score > best.score) best = c;
    }
    return best;
  }
  function diagTopList(n) {
    var arr = [], k;
    for (k in diagState.candidates) arr.push(diagState.candidates[k]);
    arr.sort(function (a, b) { return b.score - a.score; });
    return arr.slice(0, n || 5);
  }
  // اجمع كل الأرقام العشرية من نص حر (مثل innerText أو نص SVG)،
  // حتى لو الرقم داخل نص أكبر مثل "1.00264 1.00400".
  function collectPriceNumbers(text, source, extra) {
    if (!text) return 0;
    var m = String(text).match(/\d+\.\d{2,5}/g);
    if (!m) return 0;
    for (var i = 0; i < m.length; i++) recordCandidate(parseFloat(m[i]), extra || 0, source || '');
    return m.length;
  }
  function updateDiagDisplay() {
    var el = document.getElementById('muse-bot-diag');
    if (!el) return;
    var top = diagTopList(5);
    var list = top.length
      ? top.map(function (c) { return c.value + ' (' + c.score + ')'; }).join('، ')
      : 'لا مرشحات';
    el.textContent = '🔍 تشخيص السعر: ' + list
      + ' | أرقام عشرية: ' + diagState.totalDecimals
      + ' | SVG: ' + diagState.svgTexts
      + ' | Shadow: ' + diagState.shadowRoots
      + ' | iframes: ' + diagState.iframesOk + '/' + diagState.iframes
      + (diagState.method ? ' | من: ' + diagState.method : '')
      + (priceSource === 'ws' ? ' | المصدر: WebSocket المنصة' : priceSource === 'dom' ? ' | المصدر: الصفحة' : '')
      + ' | WebSocket: ' + (wsHooked ? ('مثبّت، رسائل: ' + wsMessagesSeen + (wsPriceSeenAt ? '، آخر سعر: منذ ' + Math.floor((Date.now() - wsPriceSeenAt) / 1000) + ' ث' : '، بلا سعر بعد')) : 'غير مثبّت');
    diagDisplayAt = Date.now();
    updateWsDiagDisplay();
  }
  // v1.2.1: عرض عينات أشكال رسائل WebSocket (مفاتيح فقط، بلا قيم)
  // في سطرين كحد أقصى تحت التشخيص، حتى يرسل المستخدم لقطة ونرى
  // شكل رسائل المنصة الحقيقي. الرسائل الحساسة تُعرض كعلامة فقط.
  function updateWsDiagDisplay() {
    var el = document.getElementById('muse-bot-wsdiag');
    if (!el) return;
    if (!wsHooked) { el.textContent = '📡 WebSocket: غير مثبّت'; return; }
    var lines = '📡 WebSocket: مثبّت، رسائل: ' + wsMessagesSeen;
    if (wsHookAsset) lines += '، الزوج: ' + wsHookAsset;
    if (wsDiagSamples && wsDiagSamples.length) {
      lines += ' | عينات رسائل (مفاتيح فقط):';
      for (var i = 0; i < Math.min(2, wsDiagSamples.length); i++) {
        var s = wsDiagSamples[i];
        lines += '\n' + (i + 1) + ') ' + (s.sensitive ? '(رسالة حساسة — مفاتيحها مخفية)' : (s.keys && s.keys.length ? s.keys.join('، ') : 'بلا مفاتيح'))
          + (s.price !== null && s.price !== undefined ? ' — سعر: ' + s.price : ' — بلا سعر');
      }
    } else {
      lines += ' — بلا عينة بعد';
    }
    el.textContent = lines;
  }
  function logDiagCandidates(force) {
    // سجّل المرشحات في سجل اللوحة مرة عند أول فحص، ثم كل 60 ثانية كحد أقصى
    var now = Date.now();
    if (!force && now - diagLoggedAt < 60000) return;
    diagLoggedAt = now;
    var top = diagTopList(5);
    if (!top.length) { logLine('🔍 تشخيص: لا مرشحات سعر في الصفحة (أرقام عشرية: ' + diagState.totalDecimals + '، SVG: ' + diagState.svgTexts + ')'); return; }
    logLine('🔍 تشخيص: مرشحات السعر ' + top.map(function (c) { return c.value + ' (' + c.score + ')'; }).join('، ')
      + ' | أرقام: ' + diagState.totalDecimals + ' | SVG: ' + diagState.svgTexts + ' | Shadow: ' + diagState.shadowRoots + ' | iframes: ' + diagState.iframesOk + '/' + diagState.iframes);
  }
  function readPrice() {
    if (typeof document === 'undefined') return null;
    // v1.1.2: كل قراءة تبدأ بتشخيص نظيف، حتى لا يتسرب مرشح قديم
    // (من زوج سابق مثلاً) إلى قراءة جديدة.
    diagState.candidates = {}; diagState.totalDecimals = 0;
    diagState.svgTexts = 0; diagState.shadowRoots = 0;
    diagState.iframes = 0; diagState.iframesOk = 0;
    var i, els, el, v;
    // 1) محددات صريحة كثيرة (سطح المكتب + الموبايل)
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
      for (var j = 0; j < els.length; j++) {
        el = els[j];
        if (!el.textContent || el.textContent.length > 30) continue;
        v = parsePriceText(el.textContent);
        if (v) return notePrice(v, 'محدد ' + selectors[i]);
      }
    }
    // 2) خصائص data-price / data-value في أي عنصر
    try {
      els = document.querySelectorAll('[data-price], [data-current-price], [data-last-price], [data-value]');
      for (i = 0; i < els.length; i++) {
        var attr = els[i].getAttribute('data-price') || els[i].getAttribute('data-current-price')
          || els[i].getAttribute('data-last-price') || els[i].getAttribute('data-value');
        v = parsePriceText(attr);
        if (v) return notePrice(v, 'خاصية data-price');
      }
    } catch (e) { /* تجاهل */ }
    // 3) منطقة الشارت / التلميح (tooltip) إن وجدت
    var chartRoots = [];
    try {
      var chartEls = document.querySelectorAll('[class*="chart"], [id*="chart"], [class*="graph"], [class*="tooltip"], [class*="crosshair"]');
      for (i = 0; i < chartEls.length; i++) chartRoots.push(chartEls[i]);
    } catch (e) { /* تجاهل */ }
    // 4) مسح عام: عناصر ورقية نصها رقم عشري فقط (4-5 خانات مفضلة)،
    // مع تفضيل الأقرب لآخر سعر، وفي النصف الأيمن/الأعلى من الشاشة
    // (صندوق السعر في لقطة المستخدم أعلى اليمين: 1.00166).
    var best = null, bestScore = -1;
    function scoreCandidate(el2, val, inChart) {
      var score = 0;
      var dec = priceDecimals(val);
      if (dec === 5) score += 10; else if (dec === 4) score += 8; else if (dec === 3) score += 5; else score += 2;
      if (inChart) score += 4;
      var cls = ((el2.className && el2.className.baseVal !== undefined) ? el2.className.baseVal : el2.className) || '';
      var id = el2.id || '';
      if (/price|chart|quote|current|ticker|rate/i.test(cls + ' ' + id)) score += 5;
      if (lastPrice && Math.abs(val - lastPrice) / lastPrice < 0.01) score += 12;
      else if (lastPrice && Math.abs(val - lastPrice) / lastPrice < 0.05) score += 6;
      try {
        if (typeof el2.getBoundingClientRect === 'function') {
          var r = el2.getBoundingClientRect();
          var vw = (typeof window !== 'undefined' && window.innerWidth) || 1000;
          var vh = (typeof window !== 'undefined' && window.innerHeight) || 1000;
          if (r.left > vw * 0.5) score += 5;          // النصف الأيمن (صندوق السعر)
          if (r.top < vh * 0.4) score += 3;           // النصف الأعلى
          if (r.width === 0 || r.height === 0) score -= 20; // عنصر مخفي
        }
      } catch (e) { /* تجاهل */ }
      return score;
    }
    function scanRoot(root, inChart) {
      var nodes;
      try { nodes = root.querySelectorAll('*'); } catch (e) { return; }
      for (var k = 0; k < nodes.length; k++) {
        var n = nodes[k];
        // عنصر ورقي فقط (بلا عناصر أولاد) ونص قصير، حتى لا نلتقط نص الصفحة كله
        if (n.children && n.children.length > 0) continue;
        var txt = (n.textContent || '').trim();
        if (!txt || txt.length > 20 || /[$%€£]/.test(txt) || /USD|Demo|ديمو/.test(txt)) continue;
        if (!/^\d+\.\d{3,5}$/.test(txt)) continue;
        var val = parseFloat(txt);
        if (!isFinite(val) || val < 0.01 || val > 200000) continue;
        var sc = scoreCandidate(n, val, inChart);
        recordCandidate(val, sc - diagScore(val, 0), inChart ? 'منطقة الشارت' : 'عنصر ورقي');
        if (sc > bestScore) { bestScore = sc; best = val; }
      }
    }
    for (i = 0; i < chartRoots.length; i++) scanRoot(chartRoots[i], true);
    if (best !== null && bestScore >= 8) return notePrice(best, 'منطقة الشارت');
    scanRoot(document.body || document.documentElement, false);
    if (best !== null && bestScore >= 8) return notePrice(best, 'مسح الصفحة (أقرب سعر)');
    // ---- v1.1.2: طرق عدوانية إضافية (السعر قد يكون في SVG أو Shadow DOM
    // أو iframe أو داخل نص أكبر، فلا يطابقه مسح العناصر الورقية) ----
    // 5) عناصر SVG: <text> و <tspan> في الشارت (محور الأسعار غالباً SVG)
    try {
      var svgEls = document.querySelectorAll('svg text, svg tspan');
      diagState.svgTexts = svgEls.length;
      for (i = 0; i < svgEls.length; i++) {
        var st = (svgEls[i].textContent || '').trim();
        if (st) collectPriceNumbers(st, 'SVG', 3);
      }
    } catch (e) { /* تجاهل */ }
    // 6) Shadow DOM: اجتياز متكرر لكل shadowRoot في الصفحة
    try {
      var queue = [document.body || document.documentElement];
      var seenRoots = 0;
      while (queue.length && seenRoots < 2000) {
        var node = queue.shift();
        if (!node) continue;
        if (node.shadowRoot) {
          diagState.shadowRoots++;
          queue.push(node.shadowRoot);
        }
        var kids = node.children;
        if (kids) for (var ci = 0; ci < kids.length; ci++) queue.push(kids[ci]);
        // نص العنصر الورقي داخل الـ shadow (أو خارجه) — سجّله كمرشح
        if (node !== document.body && node !== document.documentElement && node.children && node.children.length === 0) {
          var ntxt = (node.textContent || '').trim();
          if (ntxt && ntxt.length <= 20 && /^\d+\.\d{3,5}$/.test(ntxt)) recordCandidate(parseFloat(ntxt), 4, 'Shadow DOM');
        }
        seenRoots++;
      }
    } catch (e) { /* تجاهل */ }
    // 7) iframes من نفس النطاق (try/catch — الكروس-أوريجن يرفض)
    try {
      var frames = document.querySelectorAll('iframe');
      diagState.iframes = frames.length;
      for (i = 0; i < frames.length; i++) {
        try {
          var fdoc = frames[i].contentDocument || (frames[i].contentWindow && frames[i].contentWindow.document);
          if (!fdoc || !fdoc.body) continue;
          diagState.iframesOk++;
          var ftxt = fdoc.body.innerText || fdoc.body.textContent || '';
          collectPriceNumbers(ftxt, 'iframe', 3);
        } catch (e2) { /* كروس-أوريجن: لا نستطيع القراءة */ }
      }
    } catch (e) { /* تجاهل */ }
    // 8) مسح كامل لـ innerText: كل الأرقام العشرية في الصفحة، حتى لو
    // الرقم داخل نص أكبر مثل "1.00264 1.00400" — هذه الطريقة لا تعتمد
    // على بنية DOM إطلاقاً، فتنجح حتى لو السعر في canvas/tooltip.
    try {
      var bodyText = (document.body && (document.body.innerText || document.body.textContent)) || '';
      var allNums = bodyText.match(/\d+\.\d{3,5}/g) || [];
      diagState.totalDecimals = allNums.length;
      collectPriceNumbers(bodyText, 'innerText', 0);
    } catch (e) { /* تجاهل */ }
    // 9) عنوان الصفحة و meta كملاذ أخير
    try {
      v = parsePriceText(document.title || '');
      if (v) recordCandidate(v, 0, 'عنوان الصفحة');
      var metas = document.querySelectorAll('meta[name*="price" i], meta[property*="price" i]');
      for (i = 0; i < metas.length; i++) {
        v = parsePriceText(metas[i].getAttribute('content') || '');
        if (v) recordCandidate(v, 0, 'meta');
      }
    } catch (e) { /* تجاهل */ }
    // أفضل مرشح من كل الطرق (بما فيها التشخيص) — اقبله لو نقاطه >= 8
    diagState.lastScanAt = Date.now();
    var diagBest = bestDiagCandidate();
    if (diagBest && diagBest.score >= 8) return notePrice(diagBest.value, diagBest.source || 'مسح innerText');
    updateDiagDisplay();
    logDiagCandidates(false);
    // لم نجد شيئاً: سجّل بداية الفشل حتى يحذّر السجل بعد 60 ثانية
    if (!priceFailSince) priceFailSince = Date.now();
    return null;
  }
  // v1.2.0: سطر إحصائيات اللوحة — يُحدَّث مع كل حالة/صفقة.
  // يعرض: صفقات اليوم | صافي اليوم | الهدف | المتبقي للهدف.
  // الهدف 0 = بلا هدف، فيُعرض "بلا هدف"، والمتبقي "—".
  function updateStatsDisplay() {
    var el = document.getElementById('muse-bot-stats');
    if (!el) return;
    var target = CFG.dailyProfitTarget || 0;
    var remaining = target > 0 ? (target - dailyProfit) : null;
    el.textContent = 'صفقات اليوم: ' + tradesToday
      + (CFG.maxTrades > 0 ? ' / ' + CFG.maxTrades : '')
      + ' | صافي اليوم: $' + dailyProfit.toFixed(2)
      + ' | الهدف: ' + (target > 0 ? '$' + target.toFixed(2) : 'بلا هدف')
      + ' | المتبقي للهدف: ' + (remaining === null ? '—' : '$' + remaining.toFixed(2))
      + ' | خسائر متتالية: ' + consecLosses + '/' + CFG.maxConsecutiveLosses;
  }
  // تحديث عرض السعر في اللوحة: آخر سعر + وقت آخر قراءة ناجحة (v1.1.1)
  function updatePriceDisplay() {
    var el = document.getElementById('muse-bot-price');
    if (!el) return;
    if (lastPrice !== null) {
      var secs = Math.floor((Date.now() - lastPriceAt) / 1000);
      var srcLabel = priceSource === 'ws' ? 'السعر من: WebSocket المنصة' : 'السعر من: الصفحة';
      el.textContent = 'السعر: ' + lastPrice + ' | ' + srcLabel + ' | آخر قراءة: منذ ' + secs + ' ث (' + lastPriceMethod + ')';
      // أخضر لكلا مصدري الصفحة (DOM و WebSocket — كلاهما سعر المنصة نفسه)
      el.style.color = secs > 10 ? '#f39c12' : '#2ecc71';
    } else {
      el.textContent = 'السعر: - | آخر قراءة: لم تُقرأ بعد';
      el.style.color = '#e74c3c';
    }
  }
  function warnPriceMissing() {
    // تحذير واضح بعد 60 ثانية بلا سعر، ويتكرر كل 60 ثانية كحد أقصى
    if (!priceFailSince) return;
    var now = Date.now();
    if (now - priceFailSince >= 60000 && now - priceWarnLoggedAt >= 60000) {
      priceWarnLoggedAt = now;
      logLine('⚠️ مش لاقي السعر في الصفحة ولا من WebSocket منذ 60 ثانية - جرّب إعادة تحميل الصفحة');
    }
  }
  // v1.1.4: إذا مرت 60 ثانية على تثبيت خطاف WebSocket ولم يرَ أي
  // رسالة سعر، سجّل ذلك بالعربي (مرة كل 60 ثانية كحد أقصى) واستمر
  // في المحاولة — لا تتوقف، فقد يعيد السوكيت الاتصال لاحقاً.
  function warnWsNoPrice() {
    if (!wsHooked || !wsHookAt) return;
    var now = Date.now();
    if (now - wsHookAt < 60000) return;
    if (wsPriceSeenAt) return;
    if (now - wsNoPriceWarnAt < 60000) return;
    wsNoPriceWarnAt = now;
    if (wsMessagesSeen === 0) {
      logLine('⚠️ خطاف WebSocket مثبّت لكن مفيش أي رسائل وصلت من سوكيت الصفحة منذ 60 ثانية — السوكيت ممكن يكون اتفتح قبل الحقن، جرّب إعادة تحميل الصفحة');
    } else {
      // v1.2.1: اعرض اسم الزوج الذي جُرّب (أو "غير معروف") وعدد
      // الرسائل وعينة مفاتيح آخر رسالة، حتى نعرف من اللقطة لماذا
      // لم يُستخرج سعر رغم تدفق الرسائل.
      var triedAsset = readAssetName() || wsHookAsset || 'غير معروف';
      var sampleTxt = '';
      if (wsDiagSamples && wsDiagSamples.length) {
        var s0 = wsDiagSamples[0];
        sampleTxt = ' — عينة مفاتيح: ' + (s0.sensitive ? '(رسالة حساسة — مخفية)' : (s0.keys && s0.keys.length ? s0.keys.join('، ') : 'بلا مفاتيح'));
      }
      logLine('⚠️ خطاف WebSocket فحص ' + wsMessagesSeen + ' رسالة من سوكيت الصفحة لكن مفيش فيها سعر الزوج الحالي (' + triedAsset + ') منذ 60 ثانية' + sampleTxt + ' — مستمر في المحاولة');
    }
  }
  // ---------- قراءة اسم الزوج الحالي من الصفحة (لخطاف WebSocket) ----------
  // مثلاً "AUD/CAD OTC" -> "AUD/CAD".
  // v1.2.1: في v1.2.0 كان يقرأ فقط من body.innerText بصيغة XXX/YYY.
  // لكن في لقطة المستخدم (10:55) التشخيص قال "أرقام عشرية: 0" —
  // أي أن innerText كان بلا نص في تلك اللحظة — فعاد اسم الزوج
  // فارغاً ("؟")، ولم يستطع الخطاف مطابقة أي سعر، رغم أن 36-40
  // رسالة كانت تتدفق. الآن يجرّب مصادر كثيرة بالترتيب، ويُعيد
  // المحاولة بعد 5 ثوانٍ فقط إن لم يجد شيئاً (بدل 60 ثانية)،
  // ويسجّل اسم الزوج مرة واحدة عند تغيّره.
  var KNOWN_PAIRS = ['AUDCAD', 'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'EURJPY', 'GBPJPY', 'USDCAD', 'NZDUSD', 'USDCHF', 'EURGBP', 'AUDJPY', 'EURAUD', 'GBPAUD', 'NZDJPY', 'AUDNZD', 'EURCAD', 'GBPCAD', 'EURCHF', 'GBPCHF', 'USDMXN', 'USDZAR', 'USDTRY', 'EURNZD', 'GBPNZD', 'CADJPY', 'CHFJPY', 'BTCUSD', 'ETHUSD', 'LTCUSD', 'XRPUSD', 'SOLUSD', 'DOGEUSD', 'XAUUSD', 'XAGUSD'];
  var assetLogged = '';
  function pairFromText(txt) {
    if (!txt) return '';
    var m = String(txt).match(/\b([A-Z]{3})\/([A-Z]{3})\b/);
    if (m) return m[1] + '/' + m[2];
    var m2 = String(txt).match(/\b([A-Z]{3})-([A-Z]{3})\b/);
    if (m2) return m2[1] + '/' + m2[2];
    return '';
  }
  function readAssetName() {
    var now = Date.now();
    // وُجد من قبل: احتفظ به 60 ثانية. لم يُوجد: أعد المحاولة بعد 5 ثوانٍ فقط.
    if (currentAsset && now - currentAssetAt < 60000) return currentAsset;
    if (!currentAsset && currentAssetAt && now - currentAssetAt < 5000) return '';
    var found = '';
    try {
      // 1) عنوان الصفحة (مثلاً "AUD/CAD OTC | Pocket Option")
      found = pairFromText(document.title || '');
      // 2) زر اختيار الزوج / عناصر تحمل كلاس asset/symbol/pair
      if (!found) {
        var btns = document.querySelectorAll('button, [role="button"], a, [class*="asset"], [class*="symbol"], [class*="pair"]');
        for (var i = 0; i < btns.length && i < 300; i++) {
          var t = (btns[i].textContent || '').trim();
          if (t && t.length < 40) { found = pairFromText(t); if (found) break; }
        }
      }
      // 3) meta (og:title / description / title)
      if (!found) {
        var metas = document.querySelectorAll('meta[property="og:title"], meta[name="description"], meta[name="title"]');
        for (var mi = 0; mi < metas.length; mi++) {
          found = pairFromText(metas[mi].getAttribute('content') || '');
          if (found) break;
        }
      }
      // 4) نص الصفحة كاملاً (الطريقة القديمة)
      if (!found) {
        var txt = (document.body && (document.body.innerText || document.body.textContent)) || '';
        found = pairFromText(txt);
      }
      // 5) الرابط: ?asset=AUDCAD أو /AUDCAD أو /aud-cad
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
    currentAsset = found || '';
    currentAssetAt = now;
    if (found && found !== assetLogged) { assetLogged = found; logLine('الزوج الحالي: ' + found); }
    return currentAsset;
  }
  function assetNorm6() {
    var a = readAssetName();
    return a ? a.replace('/', '') : '';
  }

  // ---------- استخراج السعر من رسالة WebSocket (دالة نقية، قابلة للاختبار) ----------
  // data: نص الرسالة أو كائن JSON مفكوك (أو مصفوفة). asset6: رمز الزوج
  // موحّداً (6 حروف، مثلاً "AUDCAD") أو '' إذا كان غير معروف.
  // ترجع {price, asset} أو null. تتعامل مع أشكال الرسائل الشائعة:
  // {"symbol":"AUDCAD","price":1.00264}، {"data":{"AUDCAD":1.00264}}،
  // {"quotes":[{"symbol":"AUDCAD","close":1.00264}]}، ["quote", {...}].
  var WS_PRICE_KEYS = ['price', 'close', 'last', 'lastprice', 'last_price', 'bid', 'ask', 'rate', 'quote', 'value', 'currentprice', 'current_price', 'open', 'current', 'spot', 'mid'];
  // v1.2.1: مفاتيح حساسة — لا تُسجَّل قيمها أبداً في التشخيص أو السجل.
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
  // v1.2.1: هل الرقم سعر محتمل؟ (3-5 خانات عشرية، 0.1-200)
  // يرفض الرصيد (152280 بلا كسور) والمبلغ (1) والعائد (0.92 بخانتين).
  function wsPlausiblePrice(v) {
    var n = wsNum(v);
    if (n === null || n < 0.1 || n > 200) return null;
    var dec = priceDecimals(n);
    if (dec < 3 || dec > 5) return null;
    return n;
  }
  // v1.2.1: أزل أغلفة بروتوكولات النقل قبل فك JSON:
  // Socket.IO "42[...]" و SockJS "a[...]" و Engine.IO "2"/"3".
  // رقم عادي مثل "1.00264" لا يبدأ بـ [ أو { فلا يُمس.
  function normalizeWsText(t) {
    var s = String(t).trim();
    var m = s.match(/^(\d+|a)([\[{][\s\S]*)$/);
    if (m) return m[2];
    return s;
  }
  // v1.2.1: قائمة مفاتيح رسالة (مفاتيح فقط، بلا قيم) — للتشخيص.
  // ترجع {keys, sensitive}: إن وُجد مفتاح حساس، لا تُسجَّل المفاتيح
  // إطلاقاً، ويُعاد sensitive=true فقط.
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
  // v1.2.1: عينة رسالة للتشخيص — {keys, sensitive, price} أو null.
  // السعر هنا أول رقم سعر محتمل فيها (أو null)، والمفاتيح فقط.
  function wsSampleOf(data) {
    var k = wsKeysOf(data, 0);
    var p = null;
    try { var r = extractWsPrice(data, ''); if (r) p = r.price; } catch (e) {}
    return { keys: k.keys, sensitive: k.sensitive, price: p };
  }
  function extractWsPrice(data, asset6) {
    var target = normWsSymbol(asset6 || '');
    var found = null;
    function priceFromObj(obj, sym) {
      for (var i = 0; i < WS_PRICE_KEYS.length; i++) {
        var k = WS_PRICE_KEYS[i];
        if (obj[k] !== undefined) {
          // الزوج معروف: أي رقم سعر مقبول. الزوج غير معروف: فقط
          // سعر محتمل (3-5 خانات عشرية) حتى لا نلتقط عائداً أو مبلغاً.
          var p = target ? wsNum(obj[k]) : wsPlausiblePrice(obj[k]);
          if (p !== null) return { price: p, asset: sym || target };
        }
      }
      return null;
    }
    function walk(node, ctxSym, depth) {
      if (found || depth > 6) return;
      if (typeof node === 'string') {
        var t = normalizeWsText(node);
        // نص رقمي عارٍ: "1.00264" — سعر محتمل إذا كان الزوج مجهولاً
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
      // مفتاح يحمل اسم الزوج مباشرة: {"AUDCAD": 1.00264} أو
      // {"quotes": {"AUDCAD": 1.00264}} — إن كان الزوج مجهولاً،
      // اقبل أي مفتاح من 6 حروف لاتينية مع سعر محتمل (3-5 خانات).
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
      // كائن له رمز (أو الزوج مجهول أصلاً): ابحث عن حقل سعر فيه.
      // v1.2.1: عندما يكون الزوج مجهولاً، لا نشترط وجود رمز إطلاقاً —
      // أي كائن فيه حقل سعر محتمل يُقبل (مثل {"data":{"price":1.00264}}).
      if (!target || sym === target) {
        var r = priceFromObj(node, sym);
        if (r) { found = r; return; }
      }
      for (var j = 0; j < keys.length; j++) walk(node[keys[j]], sym, depth + 1);
    }
    try { walk(data, '', 0); } catch (e) { /* تجاهل */ }
    return found;
  }

  // ---------- خطاف WebSocket (v1.1.4) — قراءة من الصفحة فقط ----------
  // السكربت يحقن هذه الدالة كـ <script> في سياق الصفحة نفسه، فتعمل
  // داخل عالم الصفحة (وليس عالم السكربت المعزول)، وتغلّف WebSocket:
  // (1) منشئ WebSocket — أي سوكيت جديد يُنشأ بعد الحقن يُعلَّق عليه
  // مستمع رسائل داخلي؛ (2) WebSocket.prototype.addEventListener —
  // أي مستمع 'message' يضيفه كود الصفحة يُغلَّف ليفحص الرسالة أولاً؛
  // (3) خاصية onmessage — أي تعيين ws.onmessage = fn يُغلَّف كذلك.
  // كل رسالة واردة تُفحص بـ extract (نسخة مستقلة داخل الدالة)، وإن
  // وُجد سعر الزوج الحالي يُنشر في عنصر DOM مخفي #muse-po-price
  // (data-price / data-asset / data-time / data-msgs) وفي
  // window.__poPrice، فيقرأه السكربت من هناك. لا يُرسل الخطاف أي
  // شيء إلى أي خادم، ولا يقرأ أي كوكيز، ولا يمس أي بيانات دخول —
  // الرسائل أصلاً تتدفق في متصفح المستخدم، والخطاف يستمع لها فقط.
  // قيد معروف: سوكيت كان مفتوحاً قبل الحقن، ومستمعوه أُضيفوا قبل
  // الحقن، لن يُمسك حتى يعيد الاتصال — لهذا @run-at هو
  // document-start، حتى يكون الخطاف موجوداً قبل أن تنشئ الصفحة
  // سوكيتها. عدد الرسائل في التشخيص تقريبي (قد يُفحص نفس الرسالة
  // أكثر من مرة إن مرت بأكثر من مسار تغليف).
  function wsHookPageFn() {
    try {
      var BRIDGE_ID = 'muse-po-price';
      var PRICE_KEYS = ['price', 'close', 'last', 'lastprice', 'last_price', 'bid', 'ask', 'rate', 'quote', 'value', 'currentprice', 'current_price', 'open', 'current', 'spot', 'mid'];
      function normSym(s) { try { return String(s).toUpperCase().replace(/[^A-Z]/g, '').replace(/OTC$/, ''); } catch (e) { return ''; } }
      function numVal(v) {
        if (typeof v === 'number' && isFinite(v) && v > 0 && v < 200000) return v;
        if (typeof v === 'string') { var n = parseFloat(v.replace(/,/g, '')); if (isFinite(n) && n > 0 && n < 200000) return n; }
        return null;
      }
      // v1.2.1: اسم الزوج من مصادر كثيرة (عنوان الصفحة، زر الزوج،
      // نص الصفحة، الرابط)، مع تخزين مؤقت 5 ثوانٍ فقط إن لم يُوجد.
      var KNOWN6 = ['AUDCAD', 'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'EURJPY', 'GBPJPY', 'USDCAD', 'NZDUSD', 'USDCHF', 'EURGBP', 'AUDJPY', 'EURAUD', 'GBPAUD', 'NZDJPY', 'AUDNZD', 'EURCAD', 'GBPCAD', 'EURCHF', 'GBPCHF', 'BTCUSD', 'ETHUSD', 'XAUUSD', 'XAGUSD'];
      var assetCache = '', assetCacheAt = 0;
      function pairFromText(t) {
        if (!t) return '';
        var m = String(t).match(/\b([A-Z]{3})\/([A-Z]{3})\b/);
        if (m) return m[1] + m[2];
        var m2 = String(t).match(/\b([A-Z]{3})-([A-Z]{3})\b/);
        if (m2) return m2[1] + m2[2];
        return '';
      }
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
          if (!found) {
            var txt = (document.body && (document.body.innerText || document.body.textContent)) || '';
            found = pairFromText(txt);
          }
          if (!found && typeof location !== 'undefined' && location) {
            var href = location.href || '';
            var um = href.match(/(?:asset|pair|symbol)[=\/]([A-Za-z]{3})[-_\/]?([A-Za-z]{3})/);
            if (um) found = um[1].toUpperCase() + um[2].toUpperCase();
            if (!found) {
              var p6 = href.match(/([A-Za-z]{6})(?:[?&#\/]|$)/);
              if (p6 && KNOWN6.indexOf(p6[1].toUpperCase()) !== -1) found = p6[1].toUpperCase();
            }
          }
          assetCache = found || '';
          assetCacheAt = now;
          return assetCache;
        } catch (e) { return ''; }
      }
      // v1.2.1: نسخة مستقلة من منطق الاستخراج داخل سياق الصفحة.
      // مثل extractWsPrice في السكربت: تُزال أغلفة Socket.IO/SockJS،
      // وإن كان الزوج مجهولاً يُقبل أول رقم سعر محتمل (3-5 خانات
      // عشرية، 0.1-200) — فيرفض الرصيد والمبلغ والعائد — سواء كان
      // في حقل سعر، أو تحت مفتاح زوج، أو نصاً رقمياً عارياً.
      var SENS_KEYS = ['token', 'ssid', 'session', 'auth', 'password', 'passwd', 'cookie', 'secret', 'apikey', 'api_key', 'access_token', 'refresh_token', 'authorization'];
      function isSens(k) {
        var lk = String(k).toLowerCase().replace(/[^a-z0-9_]/g, '');
        for (var i = 0; i < SENS_KEYS.length; i++) { if (lk === SENS_KEYS[i] || lk.indexOf(SENS_KEYS[i]) !== -1) return true; }
        return false;
      }
      function decOf(v) { var s = String(v); return s.indexOf('.') === -1 ? 0 : s.split('.')[1].length; }
      function plausible(v) {
        var n = numVal(v);
        if (n === null || n < 0.1 || n > 200) return null;
        var d = decOf(n);
        if (d < 3 || d > 5) return null;
        return n;
      }
      function stripPrefix(t) {
        var s = String(t).trim();
        var m = s.match(/^(\d+|a)([\[{][\s\S]*)$/);
        if (m) return m[2];
        return s;
      }
      function keysOf(data, depth) {
        depth = depth || 0;
        var out = { keys: [], sensitive: false };
        if (typeof data === 'string') {
          var t = stripPrefix(data);
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
              for (var q = 0; q < c.keys.length; q++) if (out.keys.indexOf(c.keys[q]) === -1) out.keys.push(c.keys[q]);
            }
          }
        }
        if (out.sensitive) out.keys = [];
        return out;
      }
      function extract(data, target, depth, ctxSym) {
        if (depth > 6) return null;
        if (typeof data === 'string') {
          var t = stripPrefix(data);
          if (!target) {
            var bare = plausible(t);
            if (bare !== null) return { price: bare, asset: '' };
          }
          if (t && (t.charAt(0) === '{' || t.charAt(0) === '[')) {
            try { return extract(JSON.parse(t), target, depth + 1, ctxSym); } catch (e) { return null; }
          }
          return null;
        }
        if (Array.isArray(data)) {
          for (var i = 0; i < data.length; i++) { var r = extract(data[i], target, depth + 1, ctxSym); if (r) return r; }
          return null;
        }
        if (!data || typeof data !== 'object') return null;
        var sym = ctxSym || '';
        var sk = ['symbol', 'asset', 'pair', 'instrument', 'code', 'name', 'ticker'];
        for (var s = 0; s < sk.length; s++) { if (typeof data[sk[s]] === 'string') { sym = normSym(data[sk[s]]) || sym; break; } }
        var keys = Object.keys(data), k, j;
        for (k = 0; k < keys.length; k++) {
          var nk = normSym(keys[k]);
          if (target && nk === target) {
            var pv = numVal(data[keys[k]]);
            if (pv !== null) return { price: pv, asset: target };
          } else if (!target && nk.length === 6) {
            var pv2 = plausible(data[keys[k]]);
            if (pv2 !== null) return { price: pv2, asset: nk };
          }
        }
        if (!target || sym === target) {
          for (var p = 0; p < PRICE_KEYS.length; p++) {
            if (data[PRICE_KEYS[p]] !== undefined) {
              var q = target ? numVal(data[PRICE_KEYS[p]]) : plausible(data[PRICE_KEYS[p]]);
              if (q !== null) return { price: q, asset: sym };
            }
          }
        }
        for (j = 0; j < keys.length; j++) {
          var child = data[keys[j]];
          if (child && typeof child === 'object') { var rr = extract(child, target, depth + 1, sym); if (rr) return rr; }
        }
        return null;
      }
      var seen = 0;
      // v1.2.1: عينات أشكال الرسائل (مفاتيح فقط، بلا قيم) — أول 3
      // أشكال مختلفة — تُنشر في الجسر data-sample ليقرأها السكربت
      // ويعرضها في اللوحة. الرسائل الحساسة تُسجَّل كعلامة فقط.
      var samples = [];
      function recordSample(raw) {
        try {
          if (samples.length >= 3) return;
          var k = keysOf(raw, 0);
          var keyStr = k.sensitive ? 'SENSITIVE' : k.keys.join(',');
          for (var i = 0; i < samples.length; i++) {
            if ((samples[i].sensitive ? 'SENSITIVE' : samples[i].keys.join(',')) === keyStr) return;
          }
          var pr = null;
          try { var rr = extract(raw, '', 0, ''); if (rr) pr = rr.price; } catch (e) {}
          samples.push({ keys: k.keys, sensitive: k.sensitive, price: pr });
          var b = document.getElementById(BRIDGE_ID);
          if (b) {
            try { b.setAttribute('data-sample', JSON.stringify(samples)); } catch (e) {}
            try { b.setAttribute('data-ws-asset', assetNow()); } catch (e) {}
          }
        } catch (e) {}
      }
      function publish(price, asset) {
        try {
          window.__poPrice = { price: price, asset: asset || '', time: Date.now(), source: 'websocket' };
          var b = document.getElementById(BRIDGE_ID);
          if (b) {
            b.setAttribute('data-price', String(price));
            b.setAttribute('data-asset', asset || '');
            b.setAttribute('data-time', String(Date.now()));
            b.setAttribute('data-msgs', String(seen));
            try { b.setAttribute('data-ws-asset', assetNow()); } catch (e) {}
          }
        } catch (e) {}
      }
      // v1.2.1: handleText هو الفحص الفعلي (يُعدّ الرسالة مرة واحدة).
      // inspect يفك ترميز الإطارات الثنائية أولاً (ArrayBuffer/Blob)
      // ثم يمرر النص لـ handleText — فلا تُحسب الرسالة مرتين.
      function handleText(raw) {
        try {
          seen++;
          var b = document.getElementById(BRIDGE_ID);
          if (b) b.setAttribute('data-msgs', String(seen));
          recordSample(raw);
          var r = extract(raw, assetNow(), 0, '');
          if (r) publish(r.price, r.asset);
        } catch (e) {}
      }
      function inspect(raw) {
        try {
          if (typeof ArrayBuffer !== 'undefined' && raw instanceof ArrayBuffer) {
            try { handleText(new TextDecoder('utf-8').decode(raw)); } catch (e) {}
            return;
          }
          if (typeof Blob !== 'undefined' && raw instanceof Blob) {
            try {
              var fr = new FileReader();
              fr.onload = function () { try { handleText(fr.result); } catch (e) {} };
              fr.readAsText(raw);
            } catch (e) {}
            return;
          }
          handleText(raw);
        } catch (e) {}
      }
      // (2) غلّف addEventListener: مستمعو 'message' الجدد يُغلَّفون.
      // المستمع الداخلي للخطاف نفسه (الموسوم __poInternal) لا يُغلَّف
      // حتى لا يُفحص نفس الرسالة مرتين.
      try {
        var origAdd = WebSocket.prototype.addEventListener;
        WebSocket.prototype.addEventListener = function (type, listener, opts) {
          if (type === 'message' && typeof listener === 'function' && !listener.__poInternal) {
            var self = this;
            var wrapped = function (ev) { try { inspect(ev.data); } catch (e) {} try { return listener.call(self, ev); } catch (e) {} };
            return origAdd.call(this, type, wrapped, opts);
          }
          return origAdd.call(this, type, listener, opts);
        };
      } catch (e) {}
      // (3) غلّف خاصية onmessage: تعيين ws.onmessage = fn يُغلَّف.
      try {
        Object.defineProperty(WebSocket.prototype, 'onmessage', {
          configurable: true,
          get: function () { return this.__poOnMsg; },
          set: function (fn) {
            var self = this;
            if (typeof fn === 'function') {
              this.__poOnMsg = function (ev) { try { inspect(ev.data); } catch (e) {} try { return fn.call(self, ev); } catch (e) {} };
            } else { this.__poOnMsg = fn; }
          }
        });
      } catch (e) {}
      // (1) غلّف منشئ WebSocket: أي سوكيت جديد يُعلَّق عليه مستمع داخلي.
      try {
        var OrigWS = window.WebSocket;
        function WSProxy(url, protocols) {
          var ws = protocols ? new OrigWS(url, protocols) : new OrigWS(url);
          try {
            var internal = function (ev) { try { inspect(ev.data); } catch (e) {} };
            internal.__poInternal = true;
            ws.addEventListener('message', internal);
          } catch (e) {}
          return ws;
        }
        WSProxy.prototype = OrigWS.prototype;
        WSProxy.CONNECTING = OrigWS.CONNECTING; WSProxy.OPEN = OrigWS.OPEN;
        WSProxy.CLOSING = OrigWS.CLOSING; WSProxy.CLOSED = OrigWS.CLOSED;
        window.WebSocket = WSProxy;
      } catch (e) {}
    } catch (e) {}
  }
  // ثبّت الخطاف فوراً (يُستدعى مرة واحدة عند بدء السكربت، قبل أن
  // تنشئ الصفحة سوكيتها — لهذا @run-at هو document-start).
  // ينشئ عنصر الجسر المخفي #muse-po-price أولاً، ثم يحقن دالة
  // الخطاف كـ <script> في سياق الصفحة ويحذف عنصر السكربت بعدها.
  function injectWsHook() {
    try {
      if (wsHooked) return;
      var doc = document;
      var root = doc.documentElement;
      if (!root) return;
      if (!doc.getElementById('muse-po-price')) {
        var bridge = doc.createElement('div');
        bridge.id = 'muse-po-price';
        bridge.style.display = 'none';
        bridge.setAttribute('data-price', '');
        bridge.setAttribute('data-asset', '');
        bridge.setAttribute('data-time', '0');
        bridge.setAttribute('data-msgs', '0');
        root.appendChild(bridge);
      }
      var s = doc.createElement('script');
      s.textContent = '(' + wsHookPageFn.toString() + ')();';
      (doc.head || root).appendChild(s);
      if (s.parentNode) s.parentNode.removeChild(s);
      wsHooked = true; wsHookAt = Date.now();
      logLine('🔌 خطاف WebSocket مثبّت — بيستمع لرسائل سوكيت المنصة نفسها');
    } catch (e) { /* الحقن فشل: نكمل بقراءة DOM فقط */ }
  }
  // مزامنة عدّاد رسائل الخطاف وعينات أشكال الرسائل إلى متغيرات
  // التشخيص (كل ثانية). v1.2.1: تقرأ أيضاً data-sample (قائمة
  // مفاتيح فقط، بلا قيم) و data-ws-asset من الجسر.
  function syncWsDiag() {
    try {
      var b = document.getElementById('muse-po-price');
      if (!b) return;
      var msgs = parseInt(b.getAttribute('data-msgs') || '0', 10);
      if (!isNaN(msgs) && msgs > wsMessagesSeen) { wsMessagesSeen = msgs; wsLastMsgAt = Date.now(); }
      var wa = b.getAttribute('data-ws-asset') || '';
      if (wa) wsHookAsset = wa;
      var smp = b.getAttribute('data-sample') || '';
      if (smp) {
        try {
          var parsed = JSON.parse(smp);
          if (Array.isArray(parsed)) wsDiagSamples = parsed;
        } catch (e) { /* تجاهل */ }
      }
    } catch (e) { /* تجاهل */ }
  }
  // اقرأ سعر WebSocket من الجسر (أو window.__poPrice إن كان في نفس
  // السياق). السعر صالح فقط إن كان حديثاً (أقل من 15 ثانية).
  function readWsPrice() {
    try {
      syncWsDiag();
      var b = document.getElementById('muse-po-price');
      if (b) {
        var t = parseInt(b.getAttribute('data-time') || '0', 10);
        var pv = parsePriceText(b.getAttribute('data-price') || '');
        if (pv !== null && t && Date.now() - t < 15000) {
          return notePrice(pv, 'WebSocket المنصة', 'ws');
        }
      }
      if (typeof window !== 'undefined' && window.__poPrice && window.__poPrice.price) {
        var wp = window.__poPrice;
        if (wp.time && Date.now() - wp.time < 15000) {
          return notePrice(wp.price, 'WebSocket المنصة', 'ws');
        }
      }
    } catch (e) { /* تجاهل */ }
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
    // v1.2.0: كل الحدود اليومية تُفحص هنا (صفقات فقط إذا > 0،
    // خسارة، هدف ربح، خسائر متتالية) — القيم كلها من اللوحة.
    var limitReason = checkDailyLimits();
    if (limitReason) { logLine(limitReason); stopBot(); return; }
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
    if (result === 'loss') { consecLosses++; }
    else if (result === 'win') consecLosses = 0;
    logLine('نتيجة الصفقة: ' + result + ' | صافي اليوم: $' + dailyProfit.toFixed(2));
    updateStatsDisplay();
    // v1.2.0: بعد كل نتيجة، افحص الحدود اليومية (هدف الربح
    // والخسارة والخسائر المتتالية) وتوقف فوراً إذا تحقق أي منها.
    var afterReason = checkDailyLimits();
    if (afterReason) { logLine(afterReason); stopBot(); }
  }

  // ---------- الحلقة الرئيسية: بناء شموع 15 ثانية من السعر الحي ----------
  // v1.1.4 — الصفحة فقط: سعر DOM أولاً، فإن غاب فخطاف WebSocket
  // (سعر المنصة نفسه). لا مصادر خارجية إطلاقاً.
  setInterval(async function () {
    if (!running) return;
    syncWsDiag();
    var price = readPrice();
    if (!price) price = readWsPrice();
    updatePriceDisplay();
    if (!price) { warnPriceMissing(); warnWsNoPrice(); return; }
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
    updatePriceDisplay();
    updateDiagDisplay();
    updateStatsDisplay();
    var need = requiredCloses();
    var status = document.getElementById('muse-bot-status');
    if (closes.length < need) {
      var warm = 'تسخين ' + closes.length + '/' + need + ' شمعة (' + CFG.mode + ') — أول صفقة بعد ~' + Math.ceil(need * CANDLE_SEC / 60) + ' دقيقة';
      if (status) status.textContent = 'سعر: ' + (lastPrice !== null ? lastPrice : (curCandle ? curCandle.c : '-')) + ' | ' + warm;
      logSkip(warm);
      return;
    }
    var s = decide();
    var ind = allIndicators();
    var live = 'سعر: ' + (lastPrice !== null ? lastPrice : (curCandle ? curCandle.c : '-')) + ' | RSI ' + (ind.r14 !== null ? ind.r14.toFixed(0) : '-')
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
  // ---------- حفظ الإعدادات في localStorage (v1.2.1) ----------
  // تُحفظ إعدادات اللوحة (المبالغ والحدود والوضع والاستراتيجيات
  // والفلاتر) تحت مفتاح 'muse-pocket-bot-settings-v1'، وتُستعاد
  // عند إعادة فتح الصفحة/المتصفح. لا يبدأ التداول تلقائياً أبداً
  // بعد إعادة التحميل — يجب أن يضغط المستخدم START بنفسه كل مرة.
  // ملاحظة: السكربت نفسه لا يعمل إلا والتبويب مفتوح — هذا طبيعي
  // لأي userscript — لكن الإعدادات لم تعد تضيع عند إغلاق Firefox.
  var SETTINGS_KEY = 'muse-pocket-bot-settings-v1';
  function saveSettings() {
    try {
      if (typeof localStorage === 'undefined' || !localStorage) return;
      var data = {
        stake: CFG.stake, dailyProfitTarget: CFG.dailyProfitTarget,
        dailyLossLimit: CFG.dailyLossLimit, maxTrades: CFG.maxTrades,
        maxConsecutiveLosses: CFG.maxConsecutiveLosses, minPayout: CFG.minPayout,
        mode: CFG.mode, strategies: CFG.strategies.slice(), filters: {
          adx: !!CFG.filters.adx, atr: !!CFG.filters.atr, payout: !!CFG.filters.payout,
          chop: !!CFG.filters.chop, session: !!CFG.filters.session
        }
      };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
    } catch (e) { /* التخزين غير متاح: تجاهل بصمت */ }
  }
  function loadSettings() {
    try {
      if (typeof localStorage === 'undefined' || !localStorage) return false;
      var raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return false;
      var d = JSON.parse(raw);
      if (!d || typeof d !== 'object') return false;
      function num(v, def, min) {
        var n = parseFloat(v);
        return (isFinite(n) && n >= min) ? n : def;
      }
      CFG.stake = num(d.stake, CFG.stake, 0.1);
      CFG.dailyProfitTarget = num(d.dailyProfitTarget, CFG.dailyProfitTarget, 0);
      CFG.dailyLossLimit = num(d.dailyLossLimit, CFG.dailyLossLimit, 0);
      CFG.maxTrades = num(d.maxTrades, CFG.maxTrades, 0);
      CFG.maxConsecutiveLosses = num(d.maxConsecutiveLosses, CFG.maxConsecutiveLosses, 1);
      CFG.minPayout = num(d.minPayout, CFG.minPayout, 0.5);
      if (d.mode && MODES[d.mode]) CFG.mode = d.mode;
      if (Array.isArray(d.strategies)) {
        var sel = d.strategies.filter(function (s) { return STRATEGIES.indexOf(s) !== -1; });
        if (sel.length) { CFG.strategies = sel; CFG.strategy = sel[0]; }
      }
      if (d.filters && typeof d.filters === 'object') {
        for (var k in CFG.filters) if (typeof d.filters[k] === 'boolean') CFG.filters[k] = d.filters[k];
      }
      return true;
    } catch (e) { return false; }
  }
  function buildPanel() {
    // v1.2.1: استعد الإعدادات المحفوظة أولاً، حتى تُبنى اللوحة بقيمها.
    var settingsRestored = loadSettings();
    var p = document.createElement('div');
    p.id = 'muse-bot-panel';
    p.style.cssText = 'position:fixed;bottom:10px;right:10px;z-index:999999;background:#222;color:#fff;'
      + 'padding:12px;border-radius:10px;font-size:13px;width:250px;max-height:85vh;overflow:auto;box-shadow:0 0 12px #000;';
    p.innerHTML = '<style>#muse-bot-panel input, #muse-bot-panel select, #muse-bot-panel button { background:#ffffff !important; color:#000000 !important; border:1px solid #888 !important; font-size:14px !important; padding:4px !important; } #muse-bot-panel label { color:#ffffff !important; }</style>'
      + '<b>🤖 Pocket Demo Bot v1.2.1</b><br>'
      + '<span style="color:#f39c12">ديمو بس — أتمتة الواجهة مخالفة لشروط المنصة وقد تؤدي للحظر.</span><br>'
      + 'الوضع: <select id="muse-mode">'
      + Object.keys(MODES).map(function (k) {
          return '<option value="' + k + '"' + (k === CFG.mode ? ' selected' : '') + '>' + MODES[k].label + '</option>';
        }).join('')
      + '</select><br>'
      + '<span style="color:#aaa;font-size:11px">Conservative: 50 شمعة / 3 مؤشرات — Balanced: 30 / 2 — Aggressive: 21 / 1</span><br>'
      + '<div style="margin-top:6px">الاستراتيجيات (اختار واحدة أو أكثر):<br>'
      + STRATEGIES.map(function (s) {
          var checked = (CFG.strategies || []).indexOf(s) !== -1 ? ' checked' : '';
          return '<label style="display:inline-block;margin-right:8px"><input type="checkbox" class="muse-strat" value="' + s + '"' + checked + '> ' + s + '</label>';
        }).join('<br>')
      + '<br><button id="muse-strat-all" style="padding:4px 10px;margin:4px 4px 0 0">اختر الكل</button>'
      + '<button id="muse-strat-none" style="padding:4px 10px;margin-top:4px">إلغاء الكل</button></div>'
      + '<div style="margin-top:8px;font-size:12px">'
      + 'مبلغ الصفقة ($): <input id="muse-stake" type="number" min="0.1" step="0.1" value="' + CFG.stake + '" style="width:60px"><br>'
      + 'الربح اليومي المستهدف ($): <input id="muse-target" type="number" min="0" step="1" value="' + CFG.dailyProfitTarget + '" style="width:60px"> <span style="color:#aaa">(0 = بلا هدف)</span><br>'
      + 'الخسارة اليومية القصوى ($): <input id="muse-loss" type="number" min="0" step="1" value="' + CFG.dailyLossLimit + '" style="width:60px"><br>'
      + 'أقصى عدد صفقات في اليوم: <input id="muse-maxtrades" type="number" min="0" step="1" value="' + CFG.maxTrades + '" style="width:60px"> <span style="color:#aaa">(0 = بلا حد)</span><br>'
      + 'إيقاف بعد خسائر متتالية: <input id="muse-consec" type="number" min="1" step="1" value="' + CFG.maxConsecutiveLosses + '" style="width:60px"><br>'
      + '</div>'
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
      + '<div id="muse-bot-stats" style="margin-top:4px;font-size:12px;color:#2ecc71">صفقات اليوم: 0 | صافي اليوم: $0.00 | الهدف: $10.00 | المتبقي للهدف: $10.00 | خسائر متتالية: 0/3</div>'
      + '<div id="muse-bot-price" style="margin-top:4px;font-size:12px;color:#e74c3c">السعر: - | آخر قراءة: لم تُقرأ بعد</div>'
      + '<div id="muse-bot-diag" style="margin-top:4px;font-size:11px;color:#aaa;word-wrap:break-word">🔍 تشخيص السعر: جارٍ الفحص...</div>'
      + '<div id="muse-bot-wsdiag" style="margin-top:4px;font-size:11px;color:#aaa;white-space:pre-wrap;word-wrap:break-word">📡 WebSocket: جارٍ الفحص...</div>'
      + '<pre id="muse-bot-log" style="max-height:140px;overflow:auto;font-size:11px;color:#aaa"></pre>';
    document.body.appendChild(p);
    updateStatsDisplay();
    if (settingsRestored) logLine('تم تحميل الإعدادات المحفوظة');
    document.getElementById('muse-mode').onchange = function (e) {
      CFG.mode = e.target.value;
      document.getElementById('muse-f-chop').checked = mode().chop && CFG.filters.chop;
      saveSettings();
      logLine('الوضع: ' + MODES[CFG.mode].label + ' — تسخين ' + mode().need + ' شمعة، تبريد ' + mode().cooldownSec + ' ثانية');
    };
    // v1.2.0: خانات اختيار الاستراتيجيات — تُحدَّث CFG.strategies فوراً
    function syncStrategiesFromPanel() {
      var boxes = document.querySelectorAll('.muse-strat');
      var sel = [];
      for (var i = 0; i < boxes.length; i++) if (boxes[i].checked) sel.push(boxes[i].value);
      CFG.strategies = sel;
      CFG.strategy = sel.length ? sel[0] : 'confluence';
      saveSettings();
      updateStatsDisplay();
      return sel;
    }
    var stratBoxes = document.querySelectorAll('.muse-strat');
    for (var si = 0; si < stratBoxes.length; si++) {
      stratBoxes[si].onchange = function () {
        var sel = syncStrategiesFromPanel();
        logLine(sel.length ? ('الاستراتيجيات المختارة (' + sel.length + '): ' + sel.join('، ')) : 'مفيش استراتيجية مختارة — البوت مش هيدخل صفقات');
      };
    }
    document.getElementById('muse-strat-all').onclick = function () {
      var boxes = document.querySelectorAll('.muse-strat');
      for (var i = 0; i < boxes.length; i++) boxes[i].checked = true;
      var sel = syncStrategiesFromPanel();
      logLine('اختر الكل: ' + sel.length + ' استراتيجية');
    };
    document.getElementById('muse-strat-none').onclick = function () {
      var boxes = document.querySelectorAll('.muse-strat');
      for (var i = 0; i < boxes.length; i++) boxes[i].checked = false;
      syncStrategiesFromPanel();
      logLine('إلغاء الكل: مفيش استراتيجية مختارة');
    };
    // v1.2.0: حقول الحدود القابلة للتعديل — أي تغيير يُحفظ فوراً في CFG
    function bindNum(id, key, label, minVal) {
      document.getElementById(id).onchange = function (e) {
        var v = parseFloat(e.target.value);
        if (isNaN(v) || v < minVal) { v = minVal; e.target.value = v; }
        CFG[key] = v;
        saveSettings();
        updateStatsDisplay();
        logLine(label + ': ' + v);
      };
    }
    bindNum('muse-stake', 'stake', 'مبلغ الصفقة', 0.1);
    bindNum('muse-target', 'dailyProfitTarget', 'الربح اليومي المستهدف', 0);
    bindNum('muse-loss', 'dailyLossLimit', 'الخسارة اليومية القصوى', 0);
    bindNum('muse-maxtrades', 'maxTrades', 'أقصى عدد صفقات في اليوم', 0);
    bindNum('muse-consec', 'maxConsecutiveLosses', 'إيقاف بعد خسائر متتالية', 1);
    document.getElementById('muse-payout').onchange = function (e) { CFG.minPayout = parseFloat(e.target.value); saveSettings(); logLine('أقل عائد: ' + Math.round(CFG.minPayout * 100) + '%'); };
    function bindFilter(id, key) {
      document.getElementById(id).onchange = function (e) { CFG.filters[key] = e.target.checked; saveSettings(); logLine('فلتر ' + key + ': ' + (e.target.checked ? 'مفعّل' : 'مطفأ')); };
    }
    bindFilter('muse-f-adx', 'adx'); bindFilter('muse-f-atr', 'atr'); bindFilter('muse-f-payout', 'payout');
    bindFilter('muse-f-chop', 'chop'); bindFilter('muse-f-session', 'session');
    document.getElementById('muse-start').onclick = function () {
      if (!isDemo()) { alert('الحساب مش ديمو! بدّل للديمو الأول — السكربت مش هيشتغل على حساب حقيقي.'); return; }
      if (!confirm('تأكيد: الحساب ده ديمو فعلاً؟ السكربت هيضغط CALL/PUT بنفسه.')) return;
      running = true;
      updateStatsDisplay();
      var selStr = (CFG.strategies && CFG.strategies.length) ? CFG.strategies.join('، ') : 'مفيش';
      logLine('السكربت شغال — وضع ' + CFG.mode + '، استراتيجيات: ' + selStr + ' — تسخين ' + requiredCloses() + ' شمعة (~' + Math.ceil(requiredCloses() * CANDLE_SEC / 60) + ' دقيقة)'
        + ' — مبلغ $' + CFG.stake + '، هدف $' + CFG.dailyProfitTarget + '، خسارة قصوى $' + CFG.dailyLossLimit
        + '، صفقات ' + (CFG.maxTrades > 0 ? CFG.maxTrades : 'بلا حد'));
    };
    document.getElementById('muse-stop').onclick = stopBot;
  }
  function stopBot() { running = false; logLine('السكربت وقف.'); }

  // Test hooks (harmless in the browser): lets a node harness feed fake
  // candles and call decide() without a live Pocket Option page.
  if (typeof window !== 'undefined') {
    window.__PocketDemoBotTest = {
      decideOne: decideOne,
      checkDailyLimits: checkDailyLimits,
      setStrategies: function (arr) { CFG.strategies = arr.slice(); },
      getStrategies: function () { return CFG.strategies.slice(); },
      getConfig: function () { return { stake: CFG.stake, dailyProfitTarget: CFG.dailyProfitTarget, dailyLossLimit: CFG.dailyLossLimit, maxTrades: CFG.maxTrades, maxConsecutiveLosses: CFG.maxConsecutiveLosses, strategies: CFG.strategies.slice() }; },
      setState: function (st) { if (st.tradesToday !== undefined) tradesToday = st.tradesToday; if (st.dailyProfit !== undefined) dailyProfit = st.dailyProfit; if (st.consecLosses !== undefined) consecLosses = st.consecLosses; },
      getState: function () { return { tradesToday: tradesToday, dailyProfit: dailyProfit, consecLosses: consecLosses }; },
      setData: function (closesArr, candlesArr) {
        closes = closesArr.slice(); candles = candlesArr.slice();
        curCandle = closesArr.length ? { time: 0, o: closesArr[0], h: closesArr[0], l: closesArr[0], c: closesArr[closesArr.length - 1] } : null;
      },
      setConfig: function (patch) { for (var k in patch) CFG[k] = patch[k]; },
      setFilters: function (patch) { for (var k in patch) CFG.filters[k] = patch[k]; },
      decide: decide, allIndicators: allIndicators, readPrice: readPrice,
      parsePriceText: parsePriceText, getDiag: function () { return diagState; },
      diagTopList: diagTopList, collectPriceNumbers: collectPriceNumbers,
      recordCandidate: recordCandidate, updateDiagDisplay: updateDiagDisplay,
      getLastPrice: function () { return lastPrice; },
      getPriceSource: function () { return priceSource; },
      extractWsPrice: extractWsPrice, readWsPrice: readWsPrice, readAssetName: readAssetName,
      clearAssetCache: function () { currentAsset = ''; currentAssetAt = 0; assetLogged = ''; },
      normalizeWsText: normalizeWsText, wsKeysOf: wsKeysOf, wsSampleOf: wsSampleOf,
      getWsDiag: function () { return { hooked: wsHooked, messagesSeen: wsMessagesSeen, asset: wsHookAsset, samples: wsDiagSamples.slice() }; },
      saveSettings: saveSettings, loadSettings: loadSettings, buildPanel: buildPanel,
      getSettingsKey: function () { return SETTINGS_KEY; },
      normWsSymbol: normWsSymbol, wsNum: wsNum, injectWsHook: injectWsHook,
      getWsState: function () { return { hooked: wsHooked, hookAt: wsHookAt, messagesSeen: wsMessagesSeen, lastMsgAt: wsLastMsgAt, priceSeenAt: wsPriceSeenAt }; },
      setLastPrice: function (v) { lastPrice = v; lastPriceAt = Date.now(); },
      ema: ema, rsi: rsi, stoch: stoch, macdHist: macdHist, bollinger: bollinger,
      atr: atr, adx: adx, cci: cci, williamsR: williamsR, parabolicSAR: parabolicSAR,
      vwap: vwap, donchian: donchian, requiredCloses: requiredCloses, modes: MODES
    };
  }

  // ثبّت خطاف WebSocket فور بدء السكربت (document-start)، قبل أن
  // تنشئ الصفحة سوكيتها، ثم ابنِ لوحة التحكم.
  injectWsHook();

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildPanel);
  else buildPanel();
})();
