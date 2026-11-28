# Scheduled jobs (system 19)

| Job | Script | Schedule | Where it runs |
| --- | --- | --- | --- |
| Price refresh (6-hourly) | `scripts/refresh_prices.py` | every 6 h | GitHub Actions — see the existing `.github/workflows/update-products.yml` (daily 06:00 UTC, static store) |
| Monitor (30 min) | `scripts/monitor.py` | every 30 min | GitHub Actions — `.github/workflows/scheduled-jobs.yml` |
| SEO review (Saturday) | `scripts/seo_review.py` | Sat 09:00 UTC | GitHub Actions — `.github/workflows/scheduled-jobs.yml` |
| Blogger post (09:00) | `scripts/blogger_post.py` | daily 09:00 | Dry-run only; live needs Blogger creds + a host. Not wired in Actions. |
| Backup (01:00) | `scripts/backup.py` | daily 01:00 | Needs the live database — runs on the host, not in Actions. |
| Weekly report (Sunday) | `scripts/weekly_report.py` | Sun 09:00 UTC | Needs the live database — runs on the host, not in Actions. |

## Honest limits (read this before assuming the jobs run)

1. **PythonAnywhere free has no cron / scheduled tasks** for new
   accounts, so no job runs on the live host today.
2. **GitHub Actions cannot write to the live SQLite database** on
   PythonAnywhere, so any job that needs the live DB (backup, weekly
   report) cannot run in Actions — it must run on the host itself.
3. What CAN run in Actions is read-only against the live site:
   `monitor.py` (GET /health + /) and `seo_review.py` (sitemap, robots,
   meta checks). Those two are wired in
   `.github/workflows/scheduled-jobs.yml`.
4. The price refresh for the **static** store already runs daily in
   `.github/workflows/update-products.yml` (it updates products.json
   in the repo). The Flask store's `refresh_prices.py` updates the
   Flask database and needs a host where the database lives.
5. Moving to a host with cron (Vercel Cron, Render Cron, or a VPS)
   unblocks the remaining jobs without code changes — every script
   reads its settings from environment variables.

## Running a job by hand

```bash
source .venv/bin/activate
python scripts/monitor.py
python scripts/seo_review.py
python scripts/backup.py
python scripts/weekly_report.py
BASE_URL=https://sayedwahed.pythonanywhere.com python scripts/monitor.py
```
