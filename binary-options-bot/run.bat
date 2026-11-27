@echo off
REM run.bat — تشغيل البوت الرئيسي على ويندوز (دوس دبل كليك على الملف ده)
REM Run the main bot on Windows (double-click this file)
chcp 65001 >nul
cd /d "%~dp0"

echo ===============================================
echo  بوت Pocket Option — أتمتة متصفح (ديمو فقط)
echo  الوضع الافتراضي: ورقي DRY_RUN=True (مفيش ضغط أزرار)
echo  مفيش SSID ومفيش API — انت بتسجّل دخولك بنفسك في المتصفح
echo ===============================================
echo.

python --version >nul 2>&1
if errorlevel 1 (
    echo [خطأ] بايثون مش متسطّب. نزّل Python 3.10 أو أحدث من python.org
    echo وعند التثبيت علّم على "Add Python to PATH"، وبعدين شغّل الملف ده تاني.
    pause
    exit /b 1
)

echo جاري تثبيت المكتبات...
python -m pip install -r requirements.txt
if errorlevel 1 (
    echo [خطأ] فشل تثبيت المكتبات. جرّب يدوياً:  pip install -r requirements.txt
    pause
    exit /b 1
)

echo جاري تجهيز متصفح Playwright (أول مرة بس)...
python -m playwright install chromium

echo.
echo البوت شغال... دوس Ctrl+C للإيقاف.
echo للتنفيذ الحقيقي على الديمو (بعد اختبار أسابيع):  python bot_browser.py --live
python bot_browser.py
pause
