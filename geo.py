"""Geo / locale / currency framework (system 3 of the spec).

Design decision (owner's explicit choice, 2026-11-28): the store is
ENGLISH-ONLY with USD-ONLY prices, targeting USA, Europe, Canada, Mexico,
Latin America and Asia. No Arabic UI, no EGP display, no currency
conversion on the site.

Other locales are defined below as DISABLED stubs so they can be switched
on later if a market justifies it — they are never active today. RTL
support stays in the code (the `dir` field) but is not used while only
English is active.

Privacy: the visitor's country is detected via ip-api.com
(http://ip-api.com/json/ — free, no key). Only the country code is kept
(in the session). The full IP is NEVER stored anywhere; only a SHA-256
hash of it is recorded in the clicks table, and only when the visitor
explicitly presses "Continue to AliExpress".
"""

import hashlib
import ipaddress
import os

import requests

# --- Locale registry -------------------------------------------------------
# "active" is the only switch that matters. Only en-US is active.
LOCALES = {
    "en-US": {"lang": "en", "currency": "USD", "dir": "ltr", "active": True},
    # Disabled stubs — kept for a future decision, never served today.
    "ar-EG": {"lang": "ar", "currency": "EGP", "dir": "rtl", "active": False},
    "fr-FR": {"lang": "fr", "currency": "EUR", "dir": "ltr", "active": False},
    "es-ES": {"lang": "es", "currency": "EUR", "dir": "ltr", "active": False},
    "pt-BR": {"lang": "pt", "currency": "BRL", "dir": "ltr", "active": False},
}

ACTIVE_LOCALE = "en-US"
DEFAULT_COUNTRY = "US"  # fallback when detection is unavailable (e.g. localhost)


def active_locale():
    """Return the one active locale dict (always en-US today)."""
    return dict(LOCALES[ACTIVE_LOCALE])


def is_private_ip(ip):
    """True for localhost / LAN / reserved addresses (no lookup needed)."""
    try:
        return ipaddress.ip_address(ip).is_private or ipaddress.ip_address(ip).is_loopback
    except ValueError:
        return True


def ip_hash(ip, salt=""):
    """One-way hash of a visitor IP. The raw IP is never stored."""
    salt = salt or os.environ.get("SECRET_KEY", "home-shopping")
    return hashlib.sha256((salt + "|" + (ip or "")).encode("utf-8")).hexdigest()


def detect_country(ip):
    """Detect the visitor's country code via ip-api.com.

    Returns a 2-letter country code (e.g. 'US') or DEFAULT_COUNTRY when
    detection is unavailable, the IP is private, or the lookup fails.
    Only the country code is returned — nothing else from the response
    is kept.
    """
    if not ip or is_private_ip(ip):
        return DEFAULT_COUNTRY
    try:
        resp = requests.get(
            "http://ip-api.com/json/%s?fields=status,countryCode" % ip,
            timeout=2,
        )
        data = resp.json()
        if data.get("status") == "success" and data.get("countryCode"):
            return str(data["countryCode"]).upper()
    except Exception:
        pass
    return DEFAULT_COUNTRY


def client_ip(request):
    """Best-effort client IP, honouring X-Forwarded-For behind a proxy."""
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.remote_addr or ""
