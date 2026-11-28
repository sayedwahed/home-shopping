"""Official-API publishers (system 12 of the spec).

One module per platform behind a common interface:

    publish_draft(title, body, image_url=None, dry_run=True) -> dict

* Every publisher is DISABLED unless its credential env vars are set.
* dry_run=True (the default) only logs what WOULD be published — it
  never calls any platform API. Nothing in this store auto-publishes.
* A live call (dry_run=False) requires credentials AND is still refused
  by this build: live publishing is a manual, reviewed action and the
  owner has not enabled it. The status "live_not_enabled" says so.

Dry-run records are appended to logs/publish_dry_run.jsonl.
"""

import json
import os
from datetime import datetime, timezone

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOG_PATH = os.path.join(BASE_DIR, "logs", "publish_dry_run.jsonl")


class Publisher:
    """Base class: configuration check + dry-run logging."""

    name = "base"
    label = "Base"
    required_env = []  # env var names; all must be set to be "configured"

    def configured(self):
        return all(os.environ.get(name) for name in self.required_env)

    def missing_env(self):
        return [name for name in self.required_env
                if not os.environ.get(name)]

    def status(self):
        if not self.required_env:
            return "disabled"
        return "configured" if self.configured() else "disabled"

    def _log_dry_run(self, title, body, image_url):
        os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
        record = {
            "at": datetime.now(timezone.utc).isoformat(),
            "platform": self.name,
            "title": title,
            "body_preview": (body or "")[:300],
            "image_url": image_url,
            "dry_run": True,
        }
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")

    def publish_draft(self, title, body, image_url=None, dry_run=True):
        """Publish (or dry-run) one draft. Never publishes silently."""
        if not self.configured():
            return {
                "platform": self.name,
                "status": "disabled",
                "detail": "Missing credentials: %s"
                % ", ".join(self.missing_env()),
            }
        if dry_run:
            self._log_dry_run(title, body, image_url)
            return {
                "platform": self.name,
                "status": "dry_run",
                "detail": "Dry run only — nothing was published. "
                          "Recorded in logs/publish_dry_run.jsonl.",
            }
        return {
            "platform": self.name,
            "status": "live_not_enabled",
            "detail": "Live publishing is not enabled in this build; "
                      "use dry-run and publish manually from the "
                      "platform's own dashboard.",
        }
