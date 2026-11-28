"""Security helpers for Home Shopping (systems 8 and 22 of the spec).

Two small, dependency-free pieces:

* CSRF tokens — one random token per session, stored server-side in the
  session itself, compared with hmac.compare_digest. No Flask-WTF: the
  store only has three POST forms (admin login, subscribe, /go continue)
  and a tiny signed token is enough.
* In-memory rate limiting — a sliding-window bucket per key (an IP hash,
  never a raw IP). Exceeding the limit returns HTTP 429. Buckets live
  only in the running process, so they reset on restart; that is fine
  for a 3-product affiliate store (the admin-login lockout in auth.py
  is the durable protection and lives in the database).
"""

import hmac
import secrets
import time
from functools import wraps

from flask import abort, jsonify, request, session


# --- CSRF -------------------------------------------------------------------

def get_csrf_token():
    """Return the session's CSRF token, creating it on first use."""
    token = session.get("csrf_token")
    if not token:
        token = secrets.token_urlsafe(32)
        session["csrf_token"] = token
    return token


def validate_csrf_token(token):
    """True only when `token` matches the session token (constant time)."""
    expected = session.get("csrf_token") or ""
    return bool(token) and hmac.compare_digest(expected, token)


def csrf_protect(view):
    """Decorator: reject POSTs whose csrf_token field/header is missing
    or wrong (HTTP 403). Apply to every state-changing POST route."""
    @wraps(view)
    def wrapped(*args, **kwargs):
        token = request.form.get("csrf_token") or request.headers.get(
            "X-CSRF-Token", ""
        )
        if not validate_csrf_token(token):
            abort(403, description="Invalid or missing CSRF token.")
        return view(*args, **kwargs)

    return wrapped


# --- Rate limiting (system 22) ----------------------------------------------

class RateLimiter:
    """Sliding-window limiter: `limit` requests per `window` seconds
    per key. Pure in-memory; safe for one-process deployments."""

    def __init__(self, limit=30, window=60):
        self.limit = limit
        self.window = window
        self._buckets = {}

    def allow(self, key):
        now = time.time()
        bucket = self._buckets.get(key, [])
        bucket = [t for t in bucket if now - t < self.window]
        if len(bucket) >= self.limit:
            self._buckets[key] = bucket
            return False
        bucket.append(now)
        self._buckets[key] = bucket
        return True

    def reset(self):
        self._buckets.clear()


# Shared limiters (spec system 22: 30 requests/minute per IP-hash bucket).
go_continue_limiter = RateLimiter(limit=30, window=60)
admin_login_limiter = RateLimiter(limit=30, window=60)


def rate_limit(limiter, key_func):
    """Decorator: 429 when the caller's bucket is exhausted."""
    def decorator(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            if not limiter.allow(key_func()):
                return (
                    jsonify(
                        {"error": "Too many requests. "
                         "Please wait a moment and try again."}
                    ),
                    429,
                )
            return view(*args, **kwargs)

        return wrapped

    return decorator
