# config.py — إعدادات البوت (كلها هنا في الملف، مفيش أي بيانات دخول)
# Settings — everything is in this file. No login data, no session token,
# no API key anywhere in this project. The user logs in himself in the browser.
#
# عدّل القيم دي من هنا بس، قبل ما تشغّل البوت.

# --- الاستراتيجية ---
# اختار واحدة من: trend_ema_rsi | reversal_rsi_stoch | pullback | alligator_rsi | confluence
STRATEGY = "confluence"

# --- الأصل والصفقة ---
# SYMBOL: مصدر الأسعار العام اللي القرار بيتاخد منه (Yahoo Finance — من غير حساب ولا مفتاح)
# EURUSD=X و GBPUSD=X و USDJPY=X و BTC-USD ... — أزواج حقيقية، مش OTC
SYMBOL = "EURUSD=X"
# ASSET_ON_POCKET: اسم نفس الأصل جوّه Pocket Option (اللي البوت هيضغط عليه في الواجهة)
# استخدم الزوج الحقيقي (EURUSD) في ساعات السوق، مش الـ OTC — لأن الإشارة مبنية على السوق الحقيقي
ASSET_ON_POCKET = "EURUSD"
EXPIRY = 60            # مدة الصفقة بالثواني
STAKE = 1.0            # مبلغ الصفقة بالدولار — على الديمو، وبمبلغ صغير جداً
PAYOUT = 0.92          # نسبة العائد الاحتياطية (92%) — البوت بيحاول يقراها من الواجهة، ودي قيمة احتياطية
MIN_PAYOUT = 0.85      # فلتر العائد: مفيش دخول لو العائد أقل من 85%

# --- حدود المخاطر (ممنوع المارتينجال — مفيش أي إعداد بيشغّله) ---
MAX_TRADES = 10              # أقصى عدد صفقات في اليوم
DAILY_LOSS_LIMIT = 10.0     # أقصى خسارة يومية بالدولار — البوت بيوقف لما يوصلها
MAX_CONSECUTIVE_LOSSES = 3  # يوقف بعد 3 خساير ورا بعض
COOLDOWN_SECONDS = 75       # انتظار بين الصفقات (لازم >= مدة الصفقة)
MARTINGALE = False          # مقفول خالص — مضاعفة المبلغ بعد الخسارة أسرع طريق لتصفير الحساب

# --- ساعات التداول (فلتر الوقت) ---
# ALLOWED_HOURS = None يعني كل الساعات مسموحة. لو عايز تحدّد، حط مثلاً: list(range(9, 22))
ALLOWED_HOURS = None
BLOCKED_HOURS = []          # ساعات ممنوعة، مثلاً [0, 1, 2, 3]

# --- وضع التشغيل ---
# DRY_RUN=True (الافتراضي والآمن): البوت بيحلل وبيقولك كان هيضغط إيه، من غير ما يضغط أي زر.
# DRY_RUN=False: تنفيذ حقيقي بالضغط في المتصفح — على حساب الديمو بس، وبعد اختبار أسابيع.
DRY_RUN = True
DEMO_ONLY = True            # البوت بيشتغل على حساب ديمو بس، وبيوقف نفسه لو الحساب مش ديمو

# --- المتصفح ---
POCKET_URL = "https://pocketoption.com/en/cabinet/demo-quick-high-low/"
HEADLESS = False            # لازم False — انت لازم تشوف المتصفح وتسجّل دخولك بنفسك
USER_DATA_DIR = "chrome-profile"  # بروفايل كروم المحلي — الدخول بيتحفظ هنا على جهازك بس
POLL_SECONDS = 20           # كل كام ثانية البوت يفحص السوق
