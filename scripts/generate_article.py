#!/usr/bin/env python3
"""Generate one article draft with the Qwen 7B content agency (system 13).

The draft is saved under content/drafts/ for human review and is NEVER
auto-published. Requires OLLAMA_HOST (and optionally OLLAMA_MODEL) in
the environment; without them the command reports "disabled" and does
nothing.

Usage:
    python scripts/generate_article.py "Why touch sensors are great for beginners"
    python scripts/generate_article.py "Gold skeleton watches" --product "Men's Gold Skeleton Watch"
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from agency import generate_article  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description="Generate an article draft.")
    parser.add_argument("topic", help="Article topic")
    parser.add_argument("--product", default=None,
                        help="Product title the article is about")
    args = parser.parse_args()

    result = generate_article(args.topic, product_title=args.product)
    print(result.get("status", "error") + ": " + result.get("detail", ""))
    if result.get("path"):
        print("Draft: " + result["path"])
    return 0 if result.get("status") in ("draft", "disabled") else 1


if __name__ == "__main__":
    sys.exit(main())
