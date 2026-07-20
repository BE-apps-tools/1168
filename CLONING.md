# Cloning the portal for another project / environment

You can run as many independent copies of this portal as you want — each with its
own data, its own trackers, and its own admins — by cloning the repo and standing
up one Cloudflare Worker per copy. This guide is the whole process, and it calls
out the one unavoidable Cloudflare step (and everything that comes *after* it,
which needs no Cloudflare at all).

## What one environment is made of

| Piece | What it is | Isolated per environment? |
|---|---|---|
| **The pages** | 4 self-contained HTML files on GitHub Pages | Yes — a new repo |
| **The "database"** | There is no separate database. The **repo is the store**: delivery trackers are GitHub **Issues**; inventory is JSON under `data/`; **admins** are `data/admins.json` | Yes — comes with the new repo |
| **The writer** | One Cloudflare **Worker** holding `GH_TOKEN` (writes to the repo) + `ADMIN_KEY` (the always-on master key) | Yes — a new Worker |

Cloning gives each project **fully separate data and access** — nothing is shared
between copies.

## The one Cloudflare step (and why it's unavoidable)

Writes (creating trackers, logging deliveries, publishing inventory, managing
admins) go through the Worker because the GitHub token must stay **server-side** —
it can never sit in a public page. The Worker is that server, so **each
environment needs exactly one Worker deploy.** After that deploy, the new owner
**never has to touch Cloudflare again** — admins are managed from the app (see
"Admin access" below). Viewers and requesters never touch Cloudflare or log in at
all.

## Step-by-step

1. **Create the new repo.** Copy this repo's contents into a new GitHub repo
   (public, for free Pages), e.g. `be-apps-tools/<new-project>`.
2. **Enable Pages.** Repo **Settings → Pages → Deploy from a branch → `main` /
   `/(root)`**. After ~1 min the site is at
   `https://<owner>.github.io/<new-project>/`.
3. **Create a GitHub token** (fine-grained PAT), scoped to **only the new repo**,
   with **Issues: Read+write** and **Contents: Read+write** (Contents is needed
   for inventory publishing *and* the admin list).
4. **Deploy the Worker** (`worker/`):
   - Edit `worker/wrangler.toml` → set `GH_REPO = "<owner>/<new-project>"` and
     `ALLOWED_ORIGIN = "https://<owner>.github.io"`.
   - `cd worker && wrangler deploy`
   - Set the secrets (one time):
     ```bash
     wrangler secret put GH_TOKEN     # the fine-grained PAT from step 3
     wrangler secret put SUBMIT_KEY   # any random string (public spam deterrent)
     wrangler secret put ADMIN_KEY    # a SEPARATE strong random string — the master admin key
     ```
   - Copy the Worker URL (`https://<name>.<you>.workers.dev`).
5. **Point the pages at the new Worker.** In `index.html`, `inventory.html`,
   `deliveries.html`, and `admin.html`, set the `WORKER_URL` constant (and
   `SUBMIT_KEY` in `index.html`/`inventory.html`) to the new values. Commit +
   push; Pages redeploys.
6. **Seed the data.** Commit the first `Equipment Master V1.<n>.xlsx` to
   `source/` (the build Action fills `data/`), or use **Admin → Import Equipment
   Master** in the browser. `data/admins.json` already ships as an empty list.
7. **Verify** `https://<name>.<you>.workers.dev/health` → `hasToken`,
   `hasRepo`, `hasAdminKey` all true, and `github.ok` true.

## Admin access — a repo-based user list (no Cloudflare after deploy)

Each environment has **two layers** of admin access:

- **Master key** — the `ADMIN_KEY` secret you set in step 4. It always works and
  is the way the owner first gets in. Rotating it means editing the Cloudflare
  secret (the only reason to return to Cloudflare).
- **Team admins** — additional people, stored in **`data/admins.json`** in the
  repo. Manage them entirely from **Admin → Team access**:
  - **Add admin** → enter a name → the app generates a one-time key, shows it
    once, and commits the person (name + a salted **SHA-256 hash** — never the
    plaintext key) to `data/admins.json`. Hand them the key; they sign in on the
    Admin tab with it.
  - **Remove** → revokes instantly (the entry is dropped from the file).

  Because this list lives in the repo, the new owner adds/revokes their whole team
  **without ever opening Cloudflare** — they can even edit `data/admins.json`
  directly if they prefer. Keys are stored hashed, so a public repo never exposes
  a working key.

## Front-end users never log in

Viewing inventory and deliveries, searching, filtering, and submitting **Reassign
Trade / Report Issue** requests need **no key and no login** — anyone with the
link can do them (requests are gated only by the public `SUBMIT_KEY` spam
deterrent). Only the *write/admin* actions require an admin key. Share the Pages
URL freely for read-only + request access.

## Optional view-only access key

If you'd rather not have the portal open to anyone with the link, an admin can
require a **view key** from **Admin → Site access → Require a view key**. Once
set, opening any viewer page (Dashboard, Assets, Deliveries, Guide) prompts for
the key; admins on their own device are exempt. **Make public** turns it back
off. The key is stored **hashed** in `data/access.json` and applied on the next
Pages rebuild (~1 min).

> **Important — this is a deterrent, not real confidentiality.** The repo and
> Pages are public, so the underlying data (inventory JSON, delivery Issues,
> `data/access.json`) stays readable on GitHub by anyone who goes looking. The
> view key keeps casual link-holders out of the *UI*; it does not encrypt or
> truly protect the data. For genuine access control, use a **private repo +
> private Pages** (paid) or put **Cloudflare Access** in front of the site.

## Reminder: the repo is public

Free GitHub Pages is publicly reachable, and so is the repo's data (trackers,
inventory, `data/admins.json`). That's why admin keys are stored **hashed** and
why **no pricing/costs** ever go into trackers. If a project's data must be
access-controlled, use a private-Pages plan (and lock the Worker's
`ALLOWED_ORIGIN` accordingly).
