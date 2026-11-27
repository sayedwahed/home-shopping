#!/bin/bash
# run.sh — تشغيل البوت الرئيسي على Linux / Mac
# Run the main bot on Linux / macOS:  chmod +x run.sh && ./run.sh
set -e
cd "$(dirname "$0")"

echo "==============================================="
echo " بوت Pocket Option — أتمتة متصفح (ديمو فقط)"
echo " الوضع الافتراضي: ورقي DRY_RUN=True (مفيش ضغط أزرار)"
echo " مفيش SSID ومفيش API — انت بتسجّل دخولك بنفسك في المتصفح"
echo "==============================================="
echo ""

if ! command -v python3 >/dev/null 2>&1; then
    echo "[خطأ] python3 مش متسطّب."
    exit 1
fi

echo "جاري تثبيت المكتبات..."
python3 -m pip install -r requirements.txt
echo "جاري تجهيز متصفح Playwright (أول مرة بس)..."
python3 -m playwright install chromium

echo ""
echo "البوت شغال... دوس Ctrl+C للإيقاف."
echo "للتنفيذ الحقيقي على الديمو (بعد اختبار أسابيع):  python3 bot_browser.py --live"
python3 bot_browser.py
