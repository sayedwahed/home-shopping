"""Web-push sending (system 10 of the spec).

Explicit opt-in only: the browser asks the visitor before subscribing,
and /api/push/subscribe stores the subscription (endpoint + keys, no
personal data). Sending uses the Firebase Cloud Messaging legacy HTTP
API and is DISABLED unless FCM_SERVER_KEY is set in the environment —
no notification is ever sent without it.
"""

import json
import os
import urllib.request

import db as store_db

FCM_URL = "https://fcm.googleapis.com/fcm/send"


def fcm_configured():
    return bool(os.environ.get("FCM_SERVER_KEY"))


def send_push_to_all(title, body, url=None):
    """Send a notification to every stored push subscription.

    Returns {"status": "disabled"} when no FCM key is configured,
    otherwise {"status": "sent", "sent": n, "failed": m}.
    """
    if not fcm_configured():
        return {"status": "disabled",
                "detail": "FCM_SERVER_KEY is not set; nothing was sent."}
    conn = store_db.connect()
    try:
        subs = store_db.get_push_subscriptions(conn)
    finally:
        conn.close()
    sent = failed = 0
    payload = {
        "registration_ids": [s["endpoint"] for s in subs],
        "notification": {"title": title, "body": body},
        "data": {"url": url or "/"},
    }
    if not payload["registration_ids"]:
        return {"status": "sent", "sent": 0, "failed": 0,
                "detail": "No push subscriptions stored."}
    req = urllib.request.Request(
        FCM_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": "key=%s" % os.environ["FCM_SERVER_KEY"],
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            result = json.loads(resp.read().decode("utf-8"))
        sent = int(result.get("success", 0))
        failed = int(result.get("failure", 0))
        return {"status": "sent", "sent": sent, "failed": failed}
    except Exception as exc:  # noqa: BLE001 - report, never crash
        return {"status": "error", "detail": str(exc)}
