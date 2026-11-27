# بوت Binance الهجين — Spot أولاً، Futures لاحقاً

بوت تداول على Binance بالـ **API الرسمي** (مش سحب كوكيز ولا أتمتة واجهة).
**Testnet فقط افتراضياً — لا تداول حقيقي ولا مفاتيح حقيقية في الكود.**

## الفكرة باختصار
- **Spot أولاً**، والكود جاهز للترقية لـ Futures برافعة 2x–3x و Isolated فقط.
- **قائمة عملات**: BTC/USDT, ETH/USDT, SOL/USDT, BNB/USDT, LINK/USDT — مع إعدادات خاصة بكل عملة (ATR و ADX والتبريد).
- **فلاتر**: ADX (اتجاهي > 25 / عرضي < 20)، حجم > SMA20، ATR%، سبريد < 0.05%، تبريد بعد الخسارة، وفلتر هبوط BTC في آخر ساعة قبل LONG على العملات (يتعطل تلقائياً لـ BTC نفسه ولكل SHORT).
- **استراتيجية هجينة**: سوق اتجاهي → Trend Following (تقاطع EMA + فلتر EMA200 + دخول Pullback مع RSI + خروج بـ ATR). سوق عرضي → Mean Reversion (Bollinger + RSI).
- **إدارة مخاطر صارمة**: مخاطرة 1.5% للصفقة، خسارة يومية قصوى 3% (قاطع دائرة)، حجم صفقة ديناميكي من مسافة وقف الخسارة، `clientOrderId` فريد لكل أمر (لا تكرار عند انقطاع الاتصال)، ضبط الكميات حسب فلاتر المنصة (minQty / stepSize / tickSize / minNotional)، مصالحة الحالة مع المنصة دورياً، و STOP_MARKET إجباري على السيرفر في Futures.
- **مراقبة**: سجلات في `logs/bot.log`، تنبيهات Telegram اختيارية، ومفتاح إيقاف طوارئ (ملف `stop.txt` أو أمر `/stop` في Telegram).

## التثبيت (Linux / PC / VPS)
```bash
cd binance_hybrid_bot
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# املأ .env بمفاتيح Testnet فقط:
# Spot Testnet: https://testnet.binance.vision
# Futures Testnet: https://testnet.binancefuture.com
# لا تضع أبداً مفاتيح حساب حقيقي هنا، ولا ترسل الـ Secret في الشات.
```

## التشغيل
```bash
# 1) محاكاة — لا يرسل أي أمر (الافتراضي، الآمن)
python main.py --mode spot --env testnet

# 2) أوامر حقيقية على Testnet (يحتاج مفاتيح Testnet في .env)
python main.py --mode spot --env testnet --live

# 3) Futures Testnet بعد نجاح Spot (رافعة 2x)
python main.py --mode futures --env testnet --leverage 2 --live

# 4) حساب حقيقي — مرفوض بدون --live-confirm، ولا تستخدمه إلا بعد أسابيع على Testnet
python main.py --mode spot --env live --live-confirm

# المتابعة
tail -f logs/bot.log
# الإيقاف الفوري: touch stop.txt
```

## ملاحظات تقنية
- المكتبة المستخدمة للمؤشرات هي **`ta`**، وليست `pandas-ta` (متوقفة وغير maintained).
- الاختبارات: `python tests/test_bot.py` — بدون مفاتيح وبدون تداول حي، وفيها اختبار دخان لبيانات السوق العامة من Binance.
- قاعدة البيانات SQLite في `data/trades.db` — تحفظ كل صفقة وحالتها.

## التشغيل من الهاتف
هذا مشروع Python، وليس تطبيقاً جاهزاً للهاتف. الطرق المتاحة:
- **Termux على Android**: ثبّت Termux، ثم `pkg install python`، وانسخ المشروع، و`pip install -r requirements.txt`، وشغّل `python main.py --mode spot --env testnet`. الهاتف لازم يفضل شغال والـ Termux مفتوح — إغلاقه يوقف البوت.
- **VPS رخيص (الأفضل)**: شغّل البوت على سيرفر، وتابع من الهاتف عبر Telegram (التنبيهات + `/stop`).
- **لوحة ويب للهاتف**: مهمة لاحقة، مش في هذا البناء — البوت الحالي يُدار من الطرفية + Telegram.

## تحذيرات صريحة
- لا يوجد ضمان ربح. أفضل نتيجة اختبار سابقة لبوت آخر كانت 47.8%، أقل من نقطة التعادل.
- لا ترفع الرافعة إلا بعد إثبات الثبات على Spot، والتزم بـ Isolated ووقف خسارة على السيرفر.
- غيّر متغيراً واحداً في كل مرة عند التحسين، وقِس أثره.
- `.env` فيه مفاتيحك — لا تشاركه ولا ترفعه على Git أبداً.
