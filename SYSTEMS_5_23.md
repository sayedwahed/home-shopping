# Home Shopping — Systems 5–23 Status

Built locally 2026-11-28. **Nothing here has been pushed to GitHub or
deployed** — the parent reviews first, then pushes + redeploys to
PythonAnywhere. Live site for reference only (do not touch):
https://sayedwahed.pythonanywhere.com/

Store rules that hold for every system below: English-only, USD-only,
only the owner's 3 products with his own `s.click.aliexpress.com`
affiliate links, no secrets in any file (env vars only), no full IPs
stored (SHA-256 hash only), no fake FOMO/countdowns, no auto-redirect
on `/go`, no hidden JS.

## Per-system status

| # | System | Status | Notes |
|---|--------|--------|-------|
| 1 | Flask store + security headers | done | live |
| 2 | SQLite/Postgres DB | done | 6 tables live (see below) |
| 3 | Geo / locale (EN + USD only) | done | other locales stay disabled stubs |
| 4 | Catalog via AliExpress Affiliate API | done | price refresh wired, see caveat |
| 5 | `/go/<id>` disclosure | done | verified — see note on `rel` |
| 6 | Click tracking (ip_hash only) | done | verified, 1 click recorded in test |
| 7 | Admin panel | done | verified (see §Admin) |
| 8 | Auth hardening | done | bcrypt hash path, CSRF, 15-min lockout |
| 9 | PWA manifest + service worker | done | verified live over curl |
| 10 | FCM push (opt-in) | **stub-disabled** | needs `FCM_SERVER_KEY` (+ `VAPID_PUBLIC_KEY` for the browser opt-in button) |
| 11 | Email double opt-in | **stub-disabled** | needs SMTP settings |
| 12 | Official-API publishing | **stub-disabled** | dry-run only, all 5 platforms |
| 13 | Qwen 7B content agency | **stub-disabled** | needs `OLLAMA_HOST` |
| 14 | White-hat SEO + weekly review | done | `scripts/seo_review.py` 8/8 checks |
| 15 | Legal videos only | done | policy only — see §Video policy |
| 16 | Image optimization | done | 6 optimized files written + served |
| 17 | Dynamic pricing matrix | done | no fake discounts, unit-checked |
| 18 | Analytics + CSV export | done | verified via admin session |
| 19 | Scheduled jobs | **blocked** | needs a host with cron — see §Jobs |
| 20 | Self-monitoring | done | `scripts/monitor.py` OK |
| 21 | Daily backups (keep 30) | done | pruning verified |
| 22 | Defensive security | done | rate limits + pip-audit workflow |
| 23 | Admin commands | done | `scripts/admin.py` all 5 subcommands |

Done: 18/23. The 5 not-done systems are all waiting on the owner's
accounts/credentials or on a host with cron — nothing is blocked on
code.

## What was built, system by system

### 5. `/go/<id>` disclosure — done
Verified: notice + product + "Continue to AliExpress" button, no
auto-redirect, click recorded only on the POST. One honest finding:
there is **no direct `<a href="https://s.click...">` link anywhere on
the store** — the only way out is the disclosed POST + 302. The
destination URL is shown on the page as plain text for transparency.
So there is no rendered affiliate link to put
`rel="nofollow sponsored noopener"` on; the spec's intent (no followed
affiliate links) is met by construction.

### 6. Click tracking — done
`clicks` table stores product id, ref, `ip_hash` (SHA-256, salt =
SECRET_KEY), country code, timestamp. The per-product counter in
`products.clicks` is bumped on the same POST. Nothing public shows
click counts.

### 7. Admin panel — done
`/admin` login, `/admin/dashboard` (product count, total clicks,
clicks per product, last 20 errors, subscriber + push counts,
publisher status), `/logout` (POST). Signed session; "Remember me"
makes it permanent for 14 days. **When `ADMIN_USER` /
`ADMIN_PASS_HASH` (or `ADMIN_PASS`) are unset, `/admin` refuses login
with a clear message** — verified: the page says "Admin login is not
configured" and the POST returns 403.

### 8. Auth hardening — done
* Password check: `werkzeug.security.check_password_hash` against
  `ADMIN_PASS_HASH` (preferred). Generate one with:
  `python -c "from werkzeug.security import generate_password_hash; print(generate_password_hash('YOUR-PASSWORD'))"`.
  Fallback: `ADMIN_PASS` compared with `hmac.compare_digest`.
* CSRF: a signed per-session token (stdlib only, no Flask-WTF) on
  admin login, subscribe, and `/go` continue forms, plus the
  `X-CSRF-Token` header for the push JSON endpoints. Verified: POSTs
  without a token return 403.
* Failed logins go to the `errors` table; **after 5 failures the
  admin login locks for 15 minutes** (tracked in `settings`, so it
  survives restarts). Verified by test client (5 wrong passwords →
  lock message; correct password then works after the lock is cleared).

### 9. PWA — done
`static/manifest.json` (served at `/manifest.json`), `static/js/sw.js`
(served at `/sw.js` with `Service-Worker-Allowed: /`), icons
`static/icons/icon-192.png` (generated from the 512 logo with Pillow)
and `static/app-logo-512.png`. The worker caches `/static/` only
(cache-first) and **never caches HTML or API responses**. Manifest
link + theme color + CSRF/VAPID meta tags added to `base.html`; the
service worker is registered from `store.js` (CSP forbids inline
scripts). Verified over curl: manifest 200, sw.js 200.

### 10. FCM push — stub-disabled
`/api/push/subscribe` + `/api/push/unsubscribe` store subscriptions
(endpoint + keys, no personal data) in `push_subscriptions`.
`push.py:send_push_to_all()` sends via FCM only when `FCM_SERVER_KEY`
is set; otherwise it returns `{"status": "disabled"}` and sends
nothing. The browser opt-in button appears in the footer only when
`VAPID_PUBLIC_KEY` is set (it is a public key, safe to expose).
`scripts/send_push.py` exists for manual sends. **Needs from the
owner: Firebase project + `FCM_SERVER_KEY` + VAPID key pair.**

### 11. Email double opt-in — stub-disabled
`/subscribe` (form), `/confirm/<token>`, `/unsubscribe/<token>`.
`subscribers` table: email, confirmed flag, **token hash only**
(never the raw token), expiry (24 h). No mail is sent to unconfirmed
addresses; every mail carries an unsubscribe link. **Sending is
disabled unless SMTP env vars are set** — verified: subscribing
without SMTP stores the address as pending and says so honestly
("Email sending is not configured…"). One design decision: the token
is kept after confirmation so it doubles as the one-click
unsubscribe token (it is cleared on unsubscribe or re-subscribe).
**Needs from the owner: SMTP host/user/password/from address.**

### 12. Official-API publishing — stub-disabled (no auto-posting)
`publishers/` package: one module per platform (blogger, pinterest,
tiktok, youtube, x) behind `publish_draft(title, body, image_url,
dry_run=True)`. Every publisher is **disabled** unless its credential
env vars are set; dry-run only logs what WOULD be published to
`logs/publish_dry_run.jsonl` and never calls any API; live publishing
is refused by this build (`live_not_enabled`). `/admin/publish` lists
all five with their status and a dry-run form. **Nothing is published
and no schedule is wired.** The owner will send the platform
credentials later, step by step; the store comes first.
Needs (one set per platform): Blogger API key + blog id; Pinterest
token + board; TikTok token; YouTube API key + channel id; X API
key/secret + access token/secret.

### 13. Qwen 7B content agency — stub-disabled
`agency/generate_article()` calls a local Ollama server
(`OLLAMA_HOST`, model `OLLAMA_MODEL`, default `qwen2.5:7b`) and saves
a 1000–1500 word English draft to `content/drafts/` with front-matter
(status: draft — human review required). Drafts are **never
auto-published**. CLI: `scripts/generate_article.py "topic"`. Verified:
without `OLLAMA_HOST` it reports `disabled` and does nothing.
**Needs from the owner: an Ollama host running a Qwen 7B model.**

### 14. White-hat SEO — done
Dynamic sitemap + JSON-LD (already existed) verified. New:
`scripts/seo_review.py` checks sitemap/robots reachability, product
count, and title + meta description + JSON-LD on every product page,
and writes `reports/seo-review-YYYY-MM-DD.md`. Verified: **8/8 checks
passed**. No rank scraping from Google. (One check initially failed
on the watch page because Jinja escapes the apostrophe in "Men's" —
the check now unescapes HTML before comparing.)

### 15. Legal videos only — done (policy)
No code: the store uses no video at all today. Policy, recorded here
so it is not forgotten: **any future video on the store or its
channels uses only Pexels / Pixabay / Storyblocks / the owner's own
footage** — never ripped or unlicensed clips.

### 16. Image optimization — done
`scripts/optimize_images.py` (Pillow) downloads each product image
and writes `static/optimized/<id>-400.jpg` and `-800.jpg`.
`image_utils.optimized_url()` serves the local copy when it exists and
falls back to the remote URL otherwise; `app.py` exposes it as the
`optimized_image` template helper and the three templates use it
(cards 400 px, product/go pages 800 px). Verified: 6 files written,
all three pages serve the `/static/optimized/…` URLs. Note: re-run the
optimizer after a price refresh changes an image URL, or the old
optimized copy keeps being served. ImgBB upload exists but is
disabled unless `IMGBB_API_KEY` is set.

### 17. Dynamic pricing matrix — done
`pricing.py`: the displayed price is always the live API price; a
"was" price is shown **only when the API reported a real original
price higher than the sale price**; the discount is always recomputed
from those two numbers. Policy knobs live in `settings`
(`pricing_show_was_only_when_real`, `pricing_margin_percent`) — a
non-zero margin is **ignored** for affiliate display prices (marking
an AliExpress price up or down would mislead visitors) and logged as
a warning. Unit-checked by the smoke test and by `admin.py scan`.

### 18. Analytics + CSV export — done
`/admin/analytics`: totals, clicks per product per day, clicks per
day (30 days), top countries (country codes only, no IPs).
`/admin/export/csv`: all clicks as CSV (created_at, product_id, ref,
ip_hash, country) — admin-only. Verified via an admin session.

### 19. Scheduled jobs — blocked (host limitation)
Scripts exist for every job (`scripts/refresh_prices.py` 6-hourly,
`scripts/backup.py` 01:00, `scripts/blogger_post.py` 09:00 dry-run,
`scripts/seo_review.py` Sat, `scripts/weekly_report.py` Sun,
`scripts/monitor.py` 30-min). `jobs/README.md` documents them.
**Blocked:** PythonAnywhere free has no cron, and GitHub Actions
cannot write to its SQLite database — so jobs needing the live DB
(backup, weekly report) cannot run anywhere today. What CAN run in
Actions (read-only against the live site) is wired in the local-only
`.github/workflows/scheduled-jobs.yml` (monitor every 30 min, SEO
review Saturdays). The price refresh for the static store already
runs daily in the existing `update-products.yml`. Moving to a host
with cron (Vercel Cron, Render Cron, VPS) unblocks the rest without
code changes.

### 20. Self-monitoring — done
`scripts/monitor.py` GETs `BASE_URL/health` and `BASE_URL/`, logs the
result, writes `data/monitor_status.json`, exits 1 on failure.
Verified: `monitor OK health=200 home=200`, exit 0.

### 21. Daily backups — done
`scripts/backup.py` copies the SQLite file to `backups/` with a date
stamp, keeps the newest 30, prunes older ones. On Postgres it uses
`pg_dump` when available and says so when it is not. Never backs up
secrets. Verified: backup written, and with `--keep 2` two older
planted files were pruned while the newest 2 were kept.

### 22. Defensive security — done
Security headers verified on every response (CSP, HSTS,
X-Frame-Options, nosniff, Referrer-Policy). In-memory rate limiting:
30 requests/minute per IP-hash bucket on `/go` continue and on the
admin login (429 beyond) — verified by test client (35 rapid POSTs →
429s appear). Local-only `.github/workflows/security.yml` runs
pip-audit on push + weekly.

### 23. Admin commands — done
`scripts/admin.py`:
`fix` (re-run seed + DB integrity check), `analyze` (clicks/products
summary), `scan` (env-var presence by name only, security headers via
test client, pricing self-check, outdated pip count), `backup` (runs
the backup), `evolve` (status of all 23 systems + suggested next
step). Verified: `analyze` reports 3 products / 1 click; `fix`
reports `integrity_check: ok`; `evolve` reports 18/23 done and
suggests system 10 next.

## Automatic product finder — scripts/find_products.py

Added alongside systems 5–23 (owner's instruction, 2026-11-28).

**Honest scope — read this first.** The AliExpress Affiliate API has
**NO "scan the whole catalogue" endpoint**. The real method is:
query `aliexpress.affiliate.hotproduct.query` (global hot products)
plus `aliexpress.affiliate.product.query` across 10 popular keywords
(2 pages each), then rank the candidates by
`commission rate × discount × rating × log10(sales)` and take the top
N (default cap 30 per run). Filters (constants at the top of the
file): rating ≥ 4.5, orders ≥ 100, commission ≥ 5%, discount ≥ 20%.

* Every added product gets its affiliate link from
  `aliexpress.affiliate.link.generate` **with the owner's tracking
  ID**. A candidate without a generated `s.click.aliexpress.com`
  link is skipped — never added, never linked from someone else.
* Prices are the API's native USD prices (`target_currency=USD`).
  Nothing is invented.
* `--dry-run` writes `data/product_candidates.json` + a Markdown
  report and adds nothing. `--add` merges the top N into
  `data/products.json` (deduped by item id, never touching the
  existing 3 products' links); run `python seed.py` afterwards to
  load them into the database.
* If API calls fail, the script logs the **exact** error, exits
  non-zero and adds nothing. Auth failures abort the run after the
  first call instead of burning 20+ useless requests. Small sleeps
  between calls respect rate limits.

**First live proof depends on the API app leaving "Test" status.**
The developer profile is approved but the app itself still shows
"Test / Under Review". Tested 2026-11-28 with dummy keys: the VM
reaches `api-sg.aliexpress.com` and the API answered
`InvalidAppKey: The specified App Key is invalid` — the failure path
works (exact error logged, exit 2, nothing added). With the real
keys, the first daily workflow run (06:00 UTC) will show whether
live calls work. A local-only workflow,
`.github/workflows/find-products.yml`, runs the finder in `--dry-run`
daily at 07:00 UTC and uploads the candidate list as an artifact —
nothing is added to the store by that workflow; the owner reviews the
candidates first.

## What the owner still needs to supply

| Need | For | Env vars / notes |
|---|---|---|
| Firebase project | System 10 push | `FCM_SERVER_KEY`, `VAPID_PUBLIC_KEY` (+ private key kept in Firebase) |
| SMTP account | System 11 email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` |
| Blogger | System 12 | `BLOGGER_API_KEY`, `BLOGGER_BLOG_ID` |
| Pinterest | System 12 | `PINTEREST_ACCESS_TOKEN`, `PINTEREST_BOARD_ID` |
| TikTok | System 12 | `TIKTOK_ACCESS_TOKEN` |
| YouTube | System 12 | `YOUTUBE_API_KEY`, `YOUTUBE_CHANNEL_ID` |
| X | System 12 | `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET` |
| Ollama + Qwen 7B | System 13 | `OLLAMA_HOST`, `OLLAMA_MODEL` (default `qwen2.5:7b`) |
| Admin login | System 7 | `ADMIN_USER`, `ADMIN_PASS_HASH` (generate with werkzeug, see §8) |
| Host with cron | System 19 | Vercel Cron / Render Cron / VPS — PythonAnywhere free has none |
| AliExpress app out of Test | Finder + price refresh proof | nothing to supply — wait for AliExpress approval, then the 06:00 UTC run proves it |

Social media is deliberately **not** wired to any schedule and
nothing auto-posts. The owner sends each platform's credentials step
by step, after the store itself is solid.

## Quality bar

The store is being built to compete in quality with the strongest
Shopify stores: fast pages (optimized local images, static-only
service-worker caching), trustworthy design (disclosure on every
outbound link, no fake discounts, no fake urgency), white-hat SEO
(sitemap, JSON-LD, weekly review), and a working admin/ops layer
(backups, monitoring, analytics). No outcome is guaranteed — no
sales, traffic or ranking promises are made anywhere in this build.

## Local verification (2026-11-28, all from this machine)

* `python seed.py` twice: idempotent (0 inserted, 3 updated, twice).
* Smoke test (`/tmp/smoke_test.py`, Flask test client, throwaway DB):
  **56 passed, 0 failed** — storefront, pricing rules, `/go` + CSRF +
  rate limit (429s), admin refusal without creds, admin login +
  5-failure lockout + dashboard/analytics/CSV/publish, logout,
  subscribe/confirm/unsubscribe, push subscribe/unsubscribe,
  publishers + agency disabled states.
* Finder unit checks (`/tmp/test_find_products.py`): **21 passed,
  0 failed** — rating/commission normalisation, filters, scoring,
  link extraction, store-product conversion.
* curl against the live local server (`python app.py`):
  `/` 200 (3 products, $3.01/$21.16/$7.08),
  `/product/gold-skeleton-watch` 200,
  `/go/ttp223-touch-sensor` 200 (disclosure),
  POST `/go/…/continue` with CSRF → **302 to
  `https://s.click.aliexpress.com/e/_c3Ojkieh`**; without CSRF → 403,
  `/health` `{"status":"ok"}`, `/sitemap.xml` (3 product URLs),
  `/robots.txt`, `/manifest.json` 200, `/sw.js` 200,
  `/static/optimized/…` images served 200,
  `/admin` shows "Admin login is not configured" (no env creds).
* `scripts/admin.py analyze|scan|evolve|fix|backup`: all pass
  (`integrity_check: ok`; evolve: 18/23 done).
* `scripts/monitor.py`: OK, exit 0. `scripts/backup.py`: written +
  pruning verified. `scripts/seo_review.py`: 8/8, exit 0.
  `scripts/optimize_images.py`: 6 files. `scripts/generate_article.py`:
  disabled. `scripts/blogger_post.py`: disabled (no creds).
  `scripts/send_push.py`: disabled (exit 1 = nothing sent).
  `scripts/refresh_prices.py`: graceful no-op without secrets.
* `scripts/find_products.py --dry-run` without secrets: exit 2,
  nothing added. With dummy keys: real API error `InvalidAppKey`
  logged, exit 2, nothing added.
* Postgres path: **not live-tested** (no Postgres server on this
  machine) — first live test must happen after a deploy with
  `DATABASE_URL` set. All new SQL goes through `db.py`'s adapter
  and uses the same dialect translation as the existing tables.
