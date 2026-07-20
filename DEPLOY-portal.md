# Deploying the Asset Inventory Portal

The portal is a static site (GitHub Pages) whose data is rebuilt by a GitHub
Action from the daily Oracle JDE **Equipment Master** export. This guide is the
one-time setup; after it, your only recurring step is committing the daily
export.

> **Data exposure:** a free GitHub Pages URL is publicly reachable (unguessable,
> but public). The published pages contain the asset list; captured data and the
> GitHub token never live in the page. Use a private-Pages plan or the M365 route
> if the inventory must be access-controlled.

## One-time setup

1. **Create the repository** (public, for free Pages): push everything in
   `inventory-portal/` to a new GitHub repo (`asset-inventory-portal`).
2. **Enable Pages:** repo **Settings → Pages → Build and deployment →
   Deploy from a branch → `main` / `/ (root)` → Save.** After ~1 min the URL is
   `https://<you>.github.io/asset-inventory-portal/`.
3. **First data build:** create a `source/` folder in the repo and commit the
   latest export, named exactly `Equipment Master V1.<n>.xlsx`
   (e.g. `Equipment Master V1.314.xlsx`). The **build-data** Action runs
   automatically, builds `data/`, and commits it back. Watch it under the repo's
   **Actions** tab.
4. **Verify:** open the Pages URL, pick a site, confirm assets load.

## Daily refresh

- Export the Equipment Master from JDE (the filename version auto-increments:
  `V1.314`, `V1.315`, …).
- Commit the new file into `source/`. (You can leave older versions; the Action
  always uses the highest-versioned file.)
- The Action rebuilds `data/` and republishes within a minute or two.

## On the phone

Open the Pages URL in Chrome/Safari → **Add to Home screen**. Storage works
because it's served from a real `https://` origin.

## Notes

- The Action needs no secrets for the build/commit (it uses the built-in
  `GITHUB_TOKEN`). The **Cloudflare Worker** that handles change-request submits
  is set up separately — see `worker/SETUP.md` (Phase 3).
- Large administrative branch/plants (e.g. "Rental Returned") produce multi-MB
  site files; GitHub Pages gzips them and they load only when selected. Typical
  job sites are small.
