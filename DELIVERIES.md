# Delivery Tracker — Production Guide

Track material deliveries from a Requisition (Req), by line, with team visibility.
Live at the **Deliveries** card on the portal hub → `deliveries.html`.

## Who does what
- **You + one collaborator (updaters):** create trackers and log deliveries. Gated
  by the private **`ADMIN_KEY`** (set on the Cloudflare Worker; not in any page).
- **Everyone else (team):** read-only. They open the page and see trackers and
  delivery status — no key, no login, nothing to install.

## One-time setup (already done)
- Worker secret **`ADMIN_KEY`** is set in Cloudflare (`asset-portal` → Settings →
  Variables and Secrets). **Share this value only with your one collaborator.**
  To revoke access, edit the secret to a new value; both of you then re-unlock.

## Create a tracker (updater)
1. Open **Deliveries** → click **Admin unlock** → enter your **name** + the
   **`ADMIN_KEY`** (stored on your device; do this once per browser).
2. Click **New tracker** → enter the **Req #** (assign your JDE Req/PO number) →
   pick the **Trade** → drop the Req **`.xlsx`**.
3. Review the parsed lines (Line #, Description, Qty, UoM, Required date — **no
   costs**) → **Create tracker**. It appears immediately in **Active**.

## Log deliveries (updater)
1. Click a tracker to expand its lines.
2. On a line, enter the **quantity received** (defaults to the remaining amount)
   and **picked-up-by**, then **Log**. The date is recorded automatically along
   with your name.
3. Deliver in as many partials as needed — status shows **Not started → Partial →
   Complete** as received quantities add up.
4. When **every line is Complete**, the tracker **auto-closes** and moves to the
   **Completed** tab.

## Team view (everyone)
- Open **Deliveries** (no unlock). Browse **Active** trackers; switch to
  **Completed** for history. **Search** by Req #/project/description and filter by
  **Trade**. Expand any tracker to see per-line ordered/received/status and the
  delivery history (qty · date · picked-up-by · logged-by).

## Corrections
- Logged too much/little? Log an **adjusting delivery** on that line (a negative
  quantity subtracts). To remove a whole tracker, delete its **Issue** on GitHub.

## Good to know
- **Data is public** (the repo is public): trackers contain material descriptions,
  quantities, Req #, project, ship-to — **no pricing/costs**. Don't put anything
  confidential in the Req lines.
- **List freshness:** a new/closed tracker may take a few seconds to appear for
  *other* viewers (GitHub's index) — you see your own changes instantly.
- **Browser:** reading the `.xlsx` needs a modern browser (Chrome/Edge or recent
  Safari). Nothing is uploaded — the file is parsed on your device; only the line
  data goes into the tracker.
- **Under the hood:** each tracker is a GitHub Issue labeled `req-tracker`;
  updates go through the Cloudflare Worker (`/req`, `/req/deliver`). `GET /health`
  on the Worker reports config status if something seems off.

## Troubleshooting
| Symptom | Fix |
|---|---|
| "admin only" / can't create or log | Your `ADMIN_KEY` is wrong or was rotated — re-unlock with the current value. |
| "This browser can't read .xlsx" | Use Chrome/Edge or recent Safari (needs DecompressionStream). |
| New tracker not visible to teammates yet | GitHub index lag — refresh in a few seconds. |
| Nothing loads / errors | Check `https://asset-portal.site-asset-manager.workers.dev/health`. |
