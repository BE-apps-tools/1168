# Standing up a new environment (clone) — repeatable runbook

Use this every time you spin up a separate Site Inventory Portal environment (a
new job site / project). Following it end-to-end gives you a **fully isolated,
clean-slate** environment with **no data bleed** from any other environment.

Each environment = **its own GitHub repo + its own GitHub Pages site + its own
Cloudflare Worker (with its own admin key)**. Nothing is shared between
environments except the `be-apps-tools.github.io` domain (which is why the
"no-bleed" step below matters).

---

## 0. Before you start — what makes environments isolated

| Layer | How it's kept separate |
|---|---|
| Trackers / requests | GitHub **Issues** live in each repo; a duplicate does **not** copy issues, so a new repo starts with none |
| Inventory data | `data/` JSON lives in each repo — you **wipe** the copied data (Step 6) |
| Admin access | Each Worker has its **own `ADMIN_KEY`** secret + its own `data/admins.json` |
| Browser state (sign-in, cached inventory, "My Requests") | **Namespaced by site path** in `localStorage` (built into the code — see Step 7). This is what stops `1127` state bleeding into `1168`, etc. |

> **Same-origin caveat:** all these sites are served from `be-apps-tools.github.io/<repo>/`, so they share one browser origin. The path-based `localStorage` namespace (Step 7) is what keeps each environment's sign-in / cache / requests separate. **Do not remove it.**

---

## 1. Duplicate the repo
- On the source repo (`be-apps-tools/1127`) → **Settings → General → Template repository** (check it), then **Use this template → Create a new repository**. Name it (e.g. `be-apps-tools/1200`), **Public** (free Pages needs public).
- Alternative: **New repository → Import a repository** using the source URL.

## 2. Enable GitHub Pages (and force the first build)
- **Settings → Pages → Source = "Deploy from a branch", Branch = `main` / `(root)` → Save.**
- **Gotcha:** enabling alone sometimes doesn't trigger the first build, and the URL 404s. **Fix:** commit a `.nojekyll` file to the repo root (Add file → Create new file → name it `.nojekyll` → commit to `main`). That forces a *pages build and deployment* run and tells Pages to serve the static files as-is. Site goes live at `https://be-apps-tools.github.io/<repo>/` (~1 min; watch the **Actions** tab).

## 3. Create a scoped GitHub token
- GitHub → **Settings → Developer settings → Fine-grained tokens → Generate new token**
- **Repository access:** only the **new** repo.
- **Permissions:** **Issues: Read & write** + **Contents: Read & write**.
- Copy the `github_pat_…` value.

## 4. Create the new Worker — with its OWN admin key
- Cloudflare → **Workers & Pages → Create Worker** (name it, e.g. `1200-<site>`).
- **Edit code** → paste the entire `worker/src/index.js` from the new repo → **Deploy**.
- **Settings → Variables and Secrets** — set:

  | Value | Type | Notes |
  |---|---|---|
  | `GH_TOKEN` | **Secret** (encrypted) | the token from Step 3 |
  | `ADMIN_KEY` | **Secret** (encrypted) | **a brand-new key — different from every other environment** |
  | `SUBMIT_KEY` | Text | spam deterrent; must match the page (Step 5) |
  | `GH_REPO` | Text | `be-apps-tools/<repo>` |
  | `ALLOWED_ORIGIN` | Text | `https://be-apps-tools.github.io` |

- Only **`GH_TOKEN`** and **`ADMIN_KEY`** are real secrets. Copy the Worker's public URL (`https://<name>.<subdomain>.workers.dev`). Confirm with `<url>/health` in an **incognito** window: it must show `"repo":"be-apps-tools/<repo>"` and `"adminCount":0` (the `adminCount` field also proves you deployed the current code — if it's missing, re-paste `worker/src/index.js` and Deploy again).

## 5. Point the pages at the new Worker (find/replace checklist)
In the **new repo**, change these — nothing else references the old environment:

| File(s) | Constant | New value |
|---|---|---|
| `inventory.html`, `deliveries.html`, `admin.html` | `WORKER_URL` | the Step-4 Worker URL |
| `inventory.html` | `SUBMIT_KEY` | must equal the Worker's `SUBMIT_KEY` |
| `index.html`, `admin.html` | `GH_ISSUES` | `https://api.github.com/repos/be-apps-tools/<repo>/issues?state=open&per_page=100` |
| `worker/wrangler.toml` | `name` + `GH_REPO` | `<worker-name>` and `be-apps-tools/<repo>` |

Commit to `main` (Pages rebuilds). Quick check — there should be **no** references to the old repo/worker left (swap in the actual old names):
```bash
grep -rn "asset-portal\|be-apps-tools/1127" *.html worker/     # expect no matches
```

## 6. Clean slate — wipe the copied inventory (keep auth files)
The duplicate carries the source repo's inventory. Clear it so the new site starts empty:
```bash
# in a clone of the new repo, on main:
printf '{"builtAt": "", "sourceVersion": "", "assetCount": 0, "siteCount": 0}\n' > data/meta.json
printf '[]\n' > data/sites.json
git rm -q data/sites/*.json                 # remove copied per-site files
git rm -q "source/Equipment Master"*.xlsx   # remove the copied export
# KEEP data/admins.json ({"admins":[]}) and data/access.json ({"view":null}) — this env's own auth state
git commit -am "Clean slate: clear copied inventory" && git push origin main
```
> Removing `source/*.xlsx` triggers the **build-data** Action, which shows **one failed run** (nothing to build yet) — expected and harmless. It goes green when you add this site's Equipment Master.

## 7. No-bleed check (should already be true)
Every page defines a `localStorage` namespace from its base path:
```js
window.__ns = location.pathname.replace(/[^/]*$/,"");   // e.g. "/1200/"
```
and all sign-in / cache / "My Requests" access goes through `nsGet/nsSet/nsDel`. Because the namespace is the site's path, `1200`'s browser state never mixes with `1127`'s or `1168`'s. **Verify it's present** (it's inherited from the template):
```bash
grep -c "window.__ns=" index.html inventory.html deliveries.html admin.html guide.html   # expect 1 each
```
If any show `0`, that page would share state with other environments — re-copy it from the template. (Note: this namespacing is per browser device; it does not need any server config.)

## 8. Delete the stale `claude/*` branches
A duplicate carries the source repo's feature branches. Delete them (keep `main`):
```bash
git push origin --delete $(git ls-remote --heads origin 'claude/*' | sed 's#.*refs/heads/##')
```
(or delete them in the GitHub UI at `…/branches`).

## 9. Go live
1. Open `https://be-apps-tools.github.io/<repo>/` — inventory is empty.
2. **Admin → sign in with the new `ADMIN_KEY`** → **Import Equipment Master** → upload this site's `.xlsx` → Publish.
3. Add your team under **Team access**; optionally set a view key under **Site access** (viewers are told to contact their SIS).
4. Create delivery trackers from this site's Req exports.

---

## Final isolation checklist
- [ ] New repo, Public, Pages live (`.nojekyll` committed)
- [ ] New Worker with its **own `ADMIN_KEY`**; `/health` shows the new repo + `adminCount`
- [ ] `WORKER_URL` (×3), `SUBMIT_KEY`, `GH_ISSUES` (×2), `wrangler.toml` name+repo all repointed
- [ ] `data/` wiped, `source/*.xlsx` removed, `admins.json`/`access.json` kept
- [ ] `window.__ns=` present on all 5 pages (no browser-state bleed)
- [ ] stale `claude/*` branches deleted

## Data exposure reminder
The repo is public, so its data (inventory, delivery Issues, `data/admins.json`,
`data/access.json`) is readable on GitHub. Keys are stored **hashed**, and **no
pricing/costs** should ever go into trackers. The **Site access** view key is a
deterrent for casual link-holders, not true confidentiality — for that, use a
private repo + private Pages (paid) or Cloudflare Access.
