"""Content agency (system 13 of the spec): Qwen 7B article drafts.

Generates a 1000-1500 word English article draft from a product or a
topic via a local Ollama server running a Qwen 7B model. Configuration
is env-only:

* OLLAMA_HOST   — e.g. http://127.0.0.1:11434 (unset = disabled)
* OLLAMA_MODEL  — default "qwen2.5:7b"

Drafts are saved as Markdown files under content/drafts/ for HUMAN
REVIEW and are NEVER auto-published. A draft file carries front-matter
(title, topic, model, generated date, status: draft) so the review
step is explicit.
"""

import os
import re
from datetime import datetime, timezone

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DRAFTS_DIR = os.path.join(BASE_DIR, "content", "drafts")


def ollama_configured():
    return bool(os.environ.get("OLLAMA_HOST"))


def ollama_model():
    return os.environ.get("OLLAMA_MODEL", "qwen2.5:7b")


def _slug(text):
    slug = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return slug or "article"


def generate_article(topic, product_title=None):
    """Generate one draft article. Returns a status dict.

    Disabled (no Ollama host) -> {"status": "disabled", ...}.
    Otherwise calls Ollama /api/generate and saves the draft file.
    """
    if not ollama_configured():
        return {
            "status": "disabled",
            "detail": "OLLAMA_HOST is not set; the agency is disabled.",
        }
    import requests

    host = os.environ["OLLAMA_HOST"].rstrip("/")
    model = ollama_model()
    subject = product_title or topic
    prompt = (
        "Write a helpful, honest 1000-1500 word English article for an "
        "online shopping blog about: %s.\n\n"
        "Rules: plain, practical language; no fake claims, no invented "
        "prices, no invented discounts, no countdowns or fake urgency. "
        "End with a short paragraph noting that prices and availability "
        "change on AliExpress and that links on our store are affiliate "
        "links. Do not invent product specifications you do not know."
        % subject
    )
    try:
        resp = requests.post(
            host + "/api/generate",
            json={"model": model, "prompt": prompt, "stream": False},
            timeout=300,
        )
        resp.raise_for_status()
        text = (resp.json().get("response") or "").strip()
    except Exception as exc:  # noqa: BLE001 - report, never crash
        return {"status": "error", "detail": "Ollama call failed: %s" % exc}
    if not text:
        return {"status": "error", "detail": "Ollama returned an empty draft."}

    os.makedirs(DRAFTS_DIR, exist_ok=True)
    date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    filename = "%s-%s.md" % (date, _slug(topic))
    path = os.path.join(DRAFTS_DIR, filename)
    front_matter = (
        "---\n"
        "title: \"%s\"\n"
        "topic: \"%s\"\n"
        "model: \"%s\"\n"
        "generated: \"%s\"\n"
        "status: draft — human review required, never auto-published\n"
        "---\n\n" % (subject.replace('"', "'"), topic.replace('"', "'"),
                     model, date)
    )
    with open(path, "w", encoding="utf-8") as f:
        f.write(front_matter + text + "\n")
    words = len(text.split())
    return {
        "status": "draft",
        "path": path,
        "words": words,
        "detail": "Draft saved (%d words). Review it before publishing." % words,
    }
