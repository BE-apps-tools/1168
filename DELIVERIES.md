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

## Create trackers (updater)
1. Sign in once on the **Admin** tab (name + **`ADMIN_KEY`**, stored per device),
   then open **Deliveries** → **New tracker** (or use the Admin tab's shortcut).
2. Drop the Req **`.xlsx`** export. The parser reads it in your browser by
   **exact column header** (column order can vary) and **groups rows into one
   tracker per Order Number**. Columns used: Order Number → **Req #**,
   Line Number, Line Description (+ Description Line 2), **2nd Item Number →
   Part #**, UM, Request Date. All other columns (Ship To, Account Number,
   Quantity, Unit Cost, etc.) are ignored — **no costs, no quantities**.
3. The preview lists every order with its line count and a **Trade** selector.
   **Assign a trade to each order** (or use **Set trade for all orders**), then
   **Create N trackers**. Each order becomes its own tracker in **Active**.

## Log deliveries & pickups (updater)
Each line captures two events, which happen at different times:
1. Click a tracker to expand its lines.
2. **Deliver** — when material arrives on site, enter the **quantity delivered**
   and click **Log** on the *Deliver* row.
3. **Pickup** — when the team takes material, enter the **quantity picked up** and
   the **pickup person's name**, then **Log** on the *Pickup* row.
4. Log as many of each as needed. Line status moves **Not started → On site →
   Partial pickup → Picked up**. When **every line is fully picked up**, the
   tracker **auto-closes** to the **Completed** tab. Date + your name are recorded
   automatically on each event.

## Team view (everyone)
- Open **Deliveries** (no unlock). Browse **Active** trackers; switch to
  **Completed** for history. **Search** by Req #/trade and filter by **Trade**.
  Expand any tracker to see, per line: Part #, description, **Delivered**,
  **Picked up**, **Picked up by**, and status.

## Corrections
- Logged too much/little? Log an **adjusting** delivery or pickup on that line (a
  negative quantity subtracts). To remove a whole tracker, expand it and click
  **Delete order** (admin) — it leaves the app and its GitHub Issue is closed
  (labeled `req-deleted`) as a record.

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
