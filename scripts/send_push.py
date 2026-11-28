#!/usr/bin/env python3
"""Send one push notification to all subscribers (system 10).

Disabled unless FCM_SERVER_KEY is set in the environment. Subscriptions
are explicit opt-ins only (see /api/push/subscribe).

Usage:
    python scripts/send_push.py "New deal" "Check today's deals on Home Shopping"
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import push as push_mod  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description="Send a push notification.")
    parser.add_argument("title")
    parser.add_argument("body")
    parser.add_argument("--url", default="/")
    args = parser.parse_args()

    result = push_mod.send_push_to_all(args.title, args.body, url=args.url)
    print("%s: %s" % (result["status"], result.get("detail", result)))
    return 0 if result["status"] == "sent" else 1


if __name__ == "__main__":
    sys.exit(main())
