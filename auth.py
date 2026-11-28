"""Admin authentication (systems 7 and 8 of the spec).

Credentials come ONLY from environment variables — there is no default
that allows a login:

* ADMIN_USER        — admin username (required)
* ADMIN_PASS_HASH   — werkzeug password hash (preferred). Generate one:
      python -c "from werkzeug.security import generate_password_hash; \\
                 print(generate_password_hash('YOUR-PASSWORD'))"
* ADMIN_PASS        — plain password (fallback only when no hash is set;
                      compared with hmac.compare_digest)

When neither a hash nor a password is set, /admin refuses every login
with a clear message. Sessions are Flask signed sessions (SECRET_KEY);
"Remember me" makes the session permanent for 14 days (the app's
PERMANENT_SESSION_LIFETIME). Failed logins are written to the errors
table and the login is locked for 15 minutes after 5 failures
(tracked in the settings table, so it survives restarts).
"""

import hmac
import os
from datetime import datetime, timedelta, timezone
from functools import wraps

from flask import abort, redirect, session, url_for

import db as store_db

LOCK_AFTER_FAILURES = 5
LOCK_MINUTES = 15


def admin_configured():
    """True only when a username AND (a password hash or a password)
    are set in the environment."""
    return bool(os.environ.get("ADMIN_USER")) and bool(
        os.environ.get("ADMIN_PASS_HASH") or os.environ.get("ADMIN_PASS")
    )


def auth_mode():
    """'hash' when ADMIN_PASS_HASH is set, 'plain' when only ADMIN_PASS
    is set, 'unset' when no credentials exist."""
    if not os.environ.get("ADMIN_USER"):
        return "unset"
    if os.environ.get("ADMIN_PASS_HASH"):
        return "hash"
    if os.environ.get("ADMIN_PASS"):
        return "plain"
    return "unset"


def verify_admin_password(password):
    """Check `password` against the configured credential (hash first)."""
    password_hash = os.environ.get("ADMIN_PASS_HASH")
    if password_hash:
        from werkzeug.security import check_password_hash

        try:
            return check_password_hash(password_hash, password or "")
        except (ValueError, TypeError):
            return False
    plain = os.environ.get("ADMIN_PASS")
    return bool(plain) and hmac.compare_digest(plain, password or "")


def _now():
    return datetime.now(timezone.utc)


def _stamp():
    return _now().isoformat()


def failed_count(conn):
    try:
        return int(store_db.get_setting(conn, "admin_failed_count", "0") or "0")
    except ValueError:
        return 0


def is_locked(conn):
    """True while the 15-minute lockout (after 5 failures) is active."""
    until = store_db.get_setting(conn, "admin_lock_until")
    if not until:
        return False
    try:
        return _now() < datetime.fromisoformat(until)
    except ValueError:
        return False


def lock_remaining_seconds(conn):
    until = store_db.get_setting(conn, "admin_lock_until")
    if not until:
        return 0
    try:
        delta = datetime.fromisoformat(until) - _now()
        return max(0, int(delta.total_seconds()))
    except ValueError:
        return 0


def record_failed_login(conn, ip_hash):
    """Log the failure, bump the counter, and lock after 5 failures."""
    stamp = _stamp()
    count = failed_count(conn) + 1
    store_db.set_setting(conn, "admin_failed_count", str(count), stamp)
    store_db.log_error(
        conn, "security",
        "Failed admin login attempt #%d" % count,
        context="ip_hash=%s" % (ip_hash or "?"),
        stamp=stamp,
    )
    if count >= LOCK_AFTER_FAILURES:
        until = (_now() + timedelta(minutes=LOCK_MINUTES)).isoformat()
        store_db.set_setting(conn, "admin_lock_until", until, stamp)
    return count


def clear_failed_logins(conn):
    store_db.set_setting(conn, "admin_failed_count", "0", _stamp())
    store_db.set_setting(conn, "admin_lock_until", "", _stamp())


def is_admin_logged_in():
    return bool(session.get("admin_user"))


def login_required(view):
    """Decorator: only a signed-in admin may use the route."""
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not is_admin_logged_in():
            return redirect(url_for("admin_login"))
        return view(*args, **kwargs)

    return wrapped


def admin_abort_unconfigured():
    """403 with a plain explanation when no admin credentials exist."""
    abort(403, description=(
        "Admin login is not configured: set ADMIN_USER and "
        "ADMIN_PASS_HASH (or ADMIN_PASS) in the environment first."
    ))
