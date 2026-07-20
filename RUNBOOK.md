# Daily Refresh Runbook — Asset Inventory Portal

Keeping the portal current is a ~2-minute task: **export → trim → commit**. Everything
after the commit is automatic.

---

## Daily (≈2 minutes)

### 1. Export from Oracle JDE
Export the **Equipment Master** from JD Edwards the same way you do today. The file
downloads with a name like `Equipment Master V1.315.xlsx`. Keep a name that starts
with **`Equipment Master`** and ends in **`.xlsx`**. The build uses the **single**
`Equipment Master*.xlsx` file in `source/`, so **the version number does not need to
increase** (and a future `V2.x` is fine). If you ever leave several files, it picks the
highest `V<major>.<minor>`.

### 2. Trim to your site(s)
Open the file in Excel and keep only the rows for your project:
1. Turn on **AutoFilter** (Data → Filter).
2. Filter the **Branch/Plant** column to your site(s) only.
3. Delete the other rows (or copy your rows to a new sheet), then **Save** — keep the
   same `Equipment Master V1.<n>.xlsx` filename.

*Why:* the portal groups assets by Branch/Plant. Trimming keeps the file small and
limits what gets published to just your site. (Reminder: the repo is **public**, so
whatever you commit — including any employee names in the file — is publicly readable.)

### 3. Commit it to the repo
**GitHub web (simplest):**
1. Open the repo → the **`source/`** folder.
2. **Add file → Upload files** → drag in `Equipment Master V1.<n>.xlsx`.
3. **Delete the previous file** in the same commit so only the new one remains in
   `source/` — the build expects a single file, and this avoids piling up daily
   snapshots (with any PII) in the public repo.
4. **Commit changes.**

**Or via git** (if you have a local clone):
```bash
cp "Equipment Master V1.315.xlsx" source/
git add source/ && git commit -m "data: V1.315" && git push
```

That's it. You're done.

---

## What happens automatically (no action needed)
On that commit, the **build-data** GitHub Action:
1. Picks the highest-versioned file in `source/`.
2. Rebuilds the per-site data (normalizes trades, converts dates), **clearing any sites
   no longer in the file**.
3. Commits the refreshed `data/` and republishes the portal (live within ~1–2 min).
4. **Auto-closes** any open *Reassign Trade* request whose asset now matches the
   requested trade (i.e. the reassignment you made in JDE has landed).

---

## Verify (optional, 20 seconds)
- Repo → **Actions** tab: the latest **build-data** run is green.
- Open the portal → the header shows **"Data as of V1.\<n\>"** with today's date.
- Pick your site → confirm the asset count looks right.

---

## Handling change requests (as they come in)
Requests submitted from the portal appear as **GitHub Issues** in the repo:
- **`request:reassign`** — the crew says an asset's trade is wrong. Make the correction
  **in JDE**; the next daily export + build **auto-closes** the issue. No manual close.
- **`request:issue`** — free-text (unit not onsite, wrong description, called off
  inventory, etc.). Act on it, then **close the issue manually** when handled.

GitHub notifies you of new issues (watch the repo / check the **Issues** tab).

---

## Occasional maintenance
- **Rotate the GitHub token before it expires.** When the fine-grained token lapses,
  submits fail with `github 404`. Regenerate it (Issues: Read and write on this repo)
  and update the **`GH_TOKEN`** secret on the Cloudflare Worker (`asset-portal`).
- **If you change the trade list**, edit the `TRADES` array near the top of the script in
  `index.html` and the `CANONICAL`/`_VARIANTS` maps in `build/normalize.py`, then commit.

---

## Troubleshooting
| Symptom | Likely cause / fix |
|---------|--------------------|
| Portal data didn't update | Actions tab — did **build-data** run and pass? If it didn't trigger, the uploaded file wasn't named `Equipment Master V1.<n>.xlsx` or wasn't in `source/`. |
| Action failed: "no Equipment Master…found" | The file isn't in `source/` or the name doesn't match the pattern. |
| Submit says "saved offline" repeatedly | The Worker can't create issues — usually the `GH_TOKEN` expired or lost Issues:write. Regenerate + update the secret. |
| A site you removed still shows | Hard-refresh; the build clears stale sites on each run, so it should drop after the next build. |
