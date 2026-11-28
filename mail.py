"""Email sending + confirmation tokens (system 11 of the spec).

Sending is DISABLED unless all SMTP settings are present in the
environment:

* SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASS,
  SMTP_FROM, SMTP_USE_TLS (default "1")

No mail is ever sent to an unconfirmed address, and every mail the
store sends carries an unsubscribe link. Tokens are random 32-byte
values; only their SHA-256 hash is stored in the database.
"""

import hashlib
import os
import secrets
import smtplib
from email.message import EmailMessage


def smtp_configured():
    return bool(
        os.environ.get("SMTP_HOST")
        and os.environ.get("SMTP_USER")
        and os.environ.get("SMTP_PASS")
        and os.environ.get("SMTP_FROM")
    )


def smtp_status():
    """Which SMTP settings are present (names only — never values)."""
    names = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"]
    return {name: bool(os.environ.get(name)) for name in names}


def make_confirm_token():
    """Return (token, token_hash, expires_at_iso) for a 24h confirmation."""
    from datetime import datetime, timedelta, timezone

    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    expires = (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat()
    return token, token_hash, expires


def hash_token(token):
    return hashlib.sha256((token or "").encode("utf-8")).hexdigest()


def send_mail(to_address, subject, body_text):
    """Send one plain-text mail. Returns a status dict.

    When SMTP is not configured the mail is NOT sent and the caller
    gets {"status": "disabled"} — the subscribe flow must then store
    the pending confirmation and say so honestly instead of pretending
    an email went out.
    """
    if not smtp_configured():
        return {"status": "disabled",
                "detail": "SMTP is not configured; no mail was sent."}
    msg = EmailMessage()
    msg["From"] = os.environ["SMTP_FROM"]
    msg["To"] = to_address
    msg["Subject"] = subject
    msg.set_content(body_text)
    try:
        port = int(os.environ.get("SMTP_PORT", "587") or "587")
        use_tls = os.environ.get("SMTP_USE_TLS", "1") != "0"
        if use_tls:
            server = smtplib.SMTP(os.environ["SMTP_HOST"], port, timeout=20)
            server.starttls()
        else:
            server = smtplib.SMTP(os.environ["SMTP_HOST"], port, timeout=20)
        server.login(os.environ["SMTP_USER"], os.environ["SMTP_PASS"])
        server.send_message(msg)
        server.quit()
        return {"status": "sent"}
    except Exception as exc:  # noqa: BLE001 - report, never crash the flow
        return {"status": "error", "detail": str(exc)}
