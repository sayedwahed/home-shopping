"""Telegram notifications — optional. The bot works without it.

Events: trade opened/closed, stop-loss hit, daily circuit breaker,
repeated errors. Kill-switch: send /stop to the bot and it writes
stop.txt, which main.py checks every loop.
Uses aiohttp directly (no python-telegram-bot dependency).
Never logs the token.
"""
import asyncio
import aiohttp


class TelegramBot:
    def __init__(self, token="", chat_id="", logger=None, stop_file="stop.txt"):
        self.token = token
        self.chat_id = chat_id
        self.log = logger
        self.stop_file = stop_file
        self.enabled = bool(token and chat_id)
        self._last_update_id = 0

    async def _post(self, method, payload):
        if not self.enabled:
            return None
        url = f"https://api.telegram.org/bot{self.token}/{method}"
        try:
            async with aiohttp.ClientSession() as s:
                async with s.post(url, json=payload, timeout=10) as r:
                    return await r.json()
        except Exception as e:
            if self.log:
                self.log.warning(f"Telegram send failed: {e}")
            return None

    def send(self, text):
        """Sync wrapper — safe to call from the main loop."""
        if not self.enabled:
            if self.log:
                self.log.info(f"[TG disabled] {text}")
            return
        try:
            asyncio.run(self._post("sendMessage", {"chat_id": self.chat_id, "text": text}))
        except RuntimeError:
            # already inside an event loop — schedule instead
            asyncio.create_task(self._post("sendMessage", {"chat_id": self.chat_id, "text": text}))

    def check_stop_command(self):
        """Poll Telegram for /stop — writes stop.txt (kill-switch)."""
        if not self.enabled:
            return False
        try:
            data = asyncio.run(self._post("getUpdates", {"offset": self._last_update_id + 1, "timeout": 1}))
            for upd in (data or {}).get("result", []):
                self._last_update_id = max(self._last_update_id, upd.get("update_id", 0))
                text = (upd.get("message") or {}).get("text", "").strip().lower()
                if text in ("/stop", "stop", "إيقاف"):
                    with open(self.stop_file, "w") as f:
                        f.write("stopped via telegram")
                    if self.log:
                        self.log.warning("Kill-switch via Telegram /stop")
                    return True
        except Exception as e:
            if self.log:
                self.log.warning(f"Telegram poll failed: {e}")
        return False
