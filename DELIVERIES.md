# Delivery Tracker — Production Guide

Track material deliveries from a Requisition (Req), by line, with team visibility.
Live at the **Deliveries** card on the portal hub → `deliveries.html`.

## Who does what
- **Admins (updaters):** create trackers and log deliveries. Gated by an **admin
  key** — either the always-on **master key** (`ADMIN_KEY`, set on the Cloudflare
  Worker) or a **team key** you hand out from **Admin → Team access** (no
  Cloudflare needed).
- **Everyone else (team):** read-only + can submit change requests. They open the
  page and see trackers and delivery status — no key, no login, nothing to install.

## One-time setup (already done)
- Worker secret **`ADMIN_KEY`** (the *master* key) is set in Cloudflare
  (`asset-portal` → Settings → Variables and Secrets). It always works; rotate it
  there to reset everything.
- **Add teammates without Cloudflare:** sign in on the **Admin** tab, open
  **Team access → Add admin**, enter their name, and copy the one-time key it
  generates (shown once; stored only as a salted hash in `data/admins.json`).
  Give them that key to sign in. **Remove** anyone there to revoke instantly.
  (To stand up a whole separate environment for another project, see
  [`CLONING.md`](CLONING.md).)

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
   **Assign a trade to each order** (or use **Set trade for all orders**).
   - **Exclude** any order you don't want tracked (old/completed ones) with its
     **Exclude** button — excluded orders are dropped from the count and not
     created (click **Include** to bring one back).
   - Orders whose Req # is **already tracked** (open or closed) are auto-detected
     and **hidden from the list** (they're counted as "already tracked (skipped)"
     in the summary line), so you only scroll through the **new** orders to add
     and the same order is never added twice. (Rows sharing one Order Number are
     also merged into a single tracker.)
   Then **Create N trackers** — each remaining order becomes its own tracker in
   **Active**.
   - **Very large orders** (more than 200 lines) are automatically **split into
     multiple trackers** ("Part 1 of N", "Part 2 of N", …) because a single
     GitHub Issue can't hold that many lines. They share the Req #, so re-imports
     still skip them. The preview shows "splits into N trackers" on those orders.
   - **Backfill originator:** if you re-load a file after trackers were already
     created (e.g. to add the Transaction Originator to older trackers), a
     **Backfill originator on N tracked** button appears — click it to write the
     file's originator onto those existing trackers without re-creating them.

## Log deliveries & pickups (updater)
Each line captures two events, which happen at different times:
1. Click a tracker to expand its lines.
2. **Expected qty (admin)** — when the export includes a **Quantity To Receive**,
   it **prefills Expected** on import; when it's blank, enter it manually on the
   *Expected* row and click **Set**. The line then shows
   **Pending = Expected − Delivered** (0 when fully delivered). (Unit cost is
   never read.)
3. **Deliver** — when material arrives on site, enter the **quantity delivered**
   and click **Log** on the *Deliver* row.
4. **Pickup** — when the team takes material, enter the **quantity picked up** and
   the **pickup person's name**, then **Log** on the *Pickup* row.
5. Log as many of each as needed. Line status moves **Not started → On site →
   Partial pickup → Picked up**. When **every line is fully picked up**, the
   tracker **auto-closes** to the **Completed** tab. Date + your name are recorded
   automatically on each event.
6. **Mark complete (admin):** when the Req export doesn't include every already-
   handled line, the order won't auto-close. Click **Mark complete** on the order
   header to close it manually — it moves to **Completed** (shown with a green
   accent and a "Completed" badge). The GitHub Issue is closed as `completed`.

## Team view (everyone)
- Open **Deliveries** (no unlock). Browse **Active** trackers; switch to
  **Completed** for history. **Search** by Req #/trade/originator. Click
  **Filters** (it shows a count when active) to open a compact filter bar —
  filter by **Trade**, **Originator** (the Req's *Transaction Originator*, shown
  as "By NAME"), and **Date** — a one-click **Today** or an exact **From / To**
  required-date range — then **Clear filters** to reset. Expand any tracker to see, per line: Part #,
  description, **Required** date, **Expected**, **Delivered**, **Pending**
  (Expected − Delivered), **Picked up**, **Picked up by**, and status.
- **Change a trade (admin):** each tracker header has a **Trade** dropdown — pick
  a new trade to reassign it after creation (updates instantly).
- **Overdue flags:** a line whose **Required** date has passed with nothing on
  site yet is flagged **Overdue** (orange); within 3 days it shows **Due soon**.
  A tracker with any overdue line gets an **Overdue** badge in its header.
- **Print sheet:** expand a tracker and click **Print sheet** for a clean,
  branded one-order pickup sheet (with a "Picked up by / date" column and a
  sign-off line) to carry into the field.
- **Paging:** the list shows **100 trackers per page**; use the page picker /
  ‹ › arrows above the list ("Records 1–100 of N"). Switching Active/Completed
  is instant after the first load (each tab is cached until you make a change).

## Corrections
- **Fix a mistyped pickup qty (admin):** expand the tracker, click **Edit** next
  to the pickup entry under *Picked up by*, correct the number, and **Save**
  (it asks you to confirm) — the picked-up total updates in place.
- Logged too much/little? Log an **adjusting** delivery or pickup on that line (a
  negative quantity subtracts). To remove a whole tracker, expand it and click
  **Delete order** (admin) — it leaves the app and its GitHub Issue is closed
  (labeled `req-deleted`) as a record.
- **Purge legacy (admin):** old trackers created before the current format show a
  **Purge N legacy** button on the Active toolbar — one click deletes them all
  (each issue closed as a record).

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
