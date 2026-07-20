# Asset Inventory Portal

A shared, GitHub-backed inventory portal for reviewing the Blattner Equipment
Master (scoped by job site) and submitting **Reassign Trade** / **Report Issue**
change requests — which become auto-reconciling GitHub Issues.

## How it works

- **Data source:** the daily Oracle JDE export `Equipment Master V1.<n>.xlsx` is
  committed to `source/`. A GitHub Action (`.github/workflows/build-data.yml`)
  builds slim, per-site JSON into `data/` (normalizing trades, converting dates)
  and commits it back.
- **Portal (`index.html`):** a static, Blattner-branded single-page app served by
  GitHub Pages. Pick a site, search by Unit # or Serial #, review assets, and
  submit change requests.
- **Requests:** a small Cloudflare Worker (`worker/`) turns UI submissions into
  GitHub Issues (no GitHub account needed for submitters). Satisfied
  reassignments auto-close on the next build.

## Layout

| Path | Purpose |
|------|---------|
| `index.html` | The portal SPA |
| `guide.html` | Interactive in-app guide (Admin + End-user tracks) |
| `data/` | Generated per-site JSON + `sites.json` index + `meta.json` |
| `build/` | Python xlsx→JSON build + tests (stdlib only) |
| `.github/workflows/build-data.yml` | Daily build + reconcile Action |
| `worker/` | Cloudflare Worker (request submit + open-requests read) |
| `scripts/brandcheck.py` | Blattner brand gate for `index.html` |

## Setup

- Portal + data pipeline: see [`DEPLOY-portal.md`](DEPLOY-portal.md).
- Change-request Worker: see [`worker/SETUP.md`](worker/SETUP.md).

Design and implementation notes live under `docs/superpowers/` in the source
project.
