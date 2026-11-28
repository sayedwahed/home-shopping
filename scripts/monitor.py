#!/usr/bin/env python3
"""Self-monitoring (system 20 of the spec).

GETs BASE_URL/health and BASE_URL/ (BASE_URL env, default
http://127.0.0.1:5000), logs the result, and writes the status to
data/monitor_status.json. Exit code 1 when any check fails.

Usage:
    python scripts/monitor.py
    BASE_URL=https://sayedwahed.pythonanywhere.com python scripts/monitor.py
"""

import json
import os
import sys
from datetime import datetime, timezone

import requests

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATUS_PATH = os.path.join(BASE_DIR, "data", "monitor_status.json")


def check(url, timeout=10):
    try:
        resp = requests.get(url, timeout=timeout)
        return {"ok": resp.status_code == 200,
                "status": resp.status_code,
                "ms": int(resp.elapsed.total_seconds() * 1000)}
    except Exception as exc:  # noqa: BLE001 - a failed check is data
        return {"ok": False, "status": None, "error": str(exc)}


def main():
    base = (os.environ.get("BASE_URL") or "http://127.0.0.1:5000").rstrip("/")
    stamp = datetime.now(timezone.utc).isoformat()
    health = check(base + "/health")
    home = check(base + "/")
    ok = bool(health["ok"] and home["ok"])
    status = {
        "checked_at": stamp,
        "base_url": base,
        "health": health,
        "home": home,
        "ok": ok,
    }
    os.makedirs(os.path.dirname(STATUS_PATH), exist_ok=True)
    with open(STATUS_PATH, "w", encoding="utf-8") as f:
        json.dump(status, f, indent=2)
    print("[%s] monitor %s health=%s home=%s"
          % (stamp, "OK" if ok else "FAIL", health, home))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
