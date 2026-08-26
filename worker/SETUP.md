# Change-request Worker — setup (~15 min, one time)

This Cloudflare Worker is the only piece that lets the portal *write* — it turns
UI submissions into GitHub Issues and serves the list of open requests for the
pending badges. It holds a GitHub token **server-side** so no token is ever in
the public page.

## 1. Create a fine-grained GitHub token

GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained
tokens → Generate new token**:
- **Repository access:** Only select repositories → `NapsterX27/AsSet-Capture-BEI`.
- **Permissions → Repository → Issues: Read and write.** (Nothing else.)
- Generate and copy the token (starts `github_pat_…`). Treat it like a password.

## 2. Deploy the Worker

Install Wrangler once (`npm i -g wrangler`) or use the Cloudflare dashboard editor.

CLI:
```bash
cd worker
wrangler login
wrangler deploy
wrangler secret put GH_TOKEN        # paste the fine-grained token
wrangler secret put GH_REPO         # NapsterX27/AsSet-Capture-BEI
wrangler secret put SUBMIT_KEY      # any random string (e.g. from a password gen)
wrangler secret put ALLOWED_ORIGIN  # https://napsterx27.github.io
wrangler secret put ADMIN_KEY       # SEPARATE strong random string — gates delivery-tracker writes (/req, /req/deliver); share only with your one collaborator, rotate to revoke
```
Dashboard alternative: **Workers & Pages → Create Worker**, paste `src/index.js`,
then **Settings → Variables** add the four values (mark `GH_TOKEN`/`SUBMIT_KEY`
as *encrypted*).

After deploy, copy the Worker URL (e.g. `https://asset-portal.<you>.workers.dev`).

## 3. Wire the portal to the Worker

In `index.html`, set the two clearly-marked config constants near the top of the
script:
```js
const WORKER_URL = "https://asset-portal.<you>.workers.dev";
const SUBMIT_KEY = "the same random string you used above";
```
Commit + push; Pages redeploys. (`SUBMIT_KEY` in the page is a spam *deterrent*,
not a secret — the real secret is the GitHub token, which stays in the Worker.)

## 4. Test end to end

Open the portal, submit a Reassign request, and confirm a new Issue appears in
`AsSet-Capture-BEI` labeled `request:reassign`. The pending badge should show on
that asset within ~60s (the Worker caches `GET /requests`).

## 5. Enable browser inventory import (Equipment Master → `/inventory`)

The portal can publish a fresh Equipment Master straight from the browser (admin
uploads the `.xlsx`, it's parsed client-side, and the built JSON is committed by the
Worker). This adds the **`POST /inventory`** route, which **writes files to the repo**
— so the token needs one more permission than the request routes:

1. **Add Contents: Read+write to `GH_TOKEN`.** Edit the fine-grained token (§1) and add
   **Permissions → Repository → Contents: Read and write** (keep Issues: Read+write).
   Re-copy the token and update the secret: `wrangler secret put GH_TOKEN` (or update it
   in the dashboard). No new secret is needed — `/inventory` is gated by the existing
   `ADMIN_KEY`.
2. **Deploy the Worker code** that includes the `/inventory` route (`wrangler deploy`, or
   reconnect Cloudflare Build to the org repo). Until it's deployed, the portal's
   **Publish inventory** button returns an error.
3. **Test:** in Asset Inventory → **Admin** → **Import Equipment Master**, upload the
   xlsx, confirm the preview counts, **Publish**. `main` gets a
   `Update inventory data … [portal]` commit and the site refreshes in ~1–2 min.

`/inventory` commits `data/meta.json`, `data/sites.json`, and `data/sites/<code>.json`
in a single atomic commit (GitHub Git Data API), deleting per-site files no longer
present — the same result as the `build-data` Action.

## 7. Teams alerts on submitted requests (optional)

Set one secret and every request submitted from **Assets → Request Change** also
posts a card to a Teams channel — unit, serial, description, site, current trade,
requested trade, the detail the requester typed, who submitted it, and a **Review in
portal** button that opens `admin.html?view=requests&issue=<n>` with that request
expanded, ready to action.

The portal URL is derived from `ALLOWED_ORIGIN` + the repo name, which is right for
GitHub Pages. Serving the portal from somewhere else (custom domain, subpath)? Set
**`PORTAL_URL`** to its base — e.g. `https://portal.example.com/bei/` — and that wins.
If neither yields a URL the button falls back to the GitHub Issue, so the card always
has a way through rather than a broken link.

1. In Teams, open the target channel → **⋯ → Workflows** → template **"Send webhook
   alerts to a channel"** ("Get updates in Teams from tools like GitHub, Zapier, or
   any apps compatible with…"). Pick the team + channel, finish, and copy the URL it
   shows. Lost it? Reopen the flow from **Workflows Home** and read it off the
   trigger. Older tenants name the same template "Post to a channel when a webhook
   request is received".
2. Give it to the Worker:
   ```bash
   cd worker
   wrangler secret put TEAMS_WEBHOOK_URL     # paste the workflow URL
   ```
   (Dashboard: **Settings → Variables → Add**, mark it *encrypted*.)
3. Open `<worker-url>/health` — it must show **`"hasTeamsWebhook": true`**. If the
   field is missing entirely, the Worker is still running older code: redeploy it.
   (The URL itself is never reported.)
4. Submit a test request from the portal — the card should land in the channel
   within a few seconds.

Notes:
- **Treat the URL as a secret.** Anyone holding it can post to that channel. To
  revoke, delete the workflow in Teams (or turn it off) and remove the secret.
- Leave `TEAMS_WEBHOOK_URL` unset and nothing is sent — the route behaves exactly
  as before.
- `WorkflowTriggerIsNotEnabled … state 'Deleted'` in the logs means the secret holds
  the URL of a flow that no longer exists — recreate the flow (a replaced flow gets a
  new URL) and update the secret. The flow's run history shows **no runs at all** in
  this case, because there is no flow left to run.
- The alert is fire-and-forget (`ctx.waitUntil`): the submitter never waits on
  Teams, and a webhook that is down, throttled, or misconfigured **cannot fail a
  request submit** — the Issue is already created. Failures are logged only, so
  `wrangler tail` is where to look if cards stop arriving.
- Requests submitted while a phone is offline are queued in the browser and sent
  when it reconnects, so the card arrives then, not at submit time.
- Both webhook flavours are supported and detected from the URL's host: Power
  Automate **Workflows** URLs get an Adaptive Card; the retired Office 365
  connector URLs (`*.office.com/webhook…`) get a MessageCard. Microsoft is
  retiring the connector kind, so prefer Workflows for anything new.
- Covered by `worker/tests/teams.test.mjs` (`node worker/tests/teams.test.mjs`),
  which runs the real route with `fetch` stubbed. Also runs in CI.

## Optional hardening

The endpoint is public (protected by origin + submit-key). For more, add
**Cloudflare Turnstile** or a **Rate Limiting rule** on the Worker route in the
Cloudflare dashboard — no code change required.

## Admin team access (repo-based user list)

Beyond the master `ADMIN_KEY` secret, additional admins live in
**`data/admins.json`** in the repo and are managed from **Admin → Team access** —
no Cloudflare visit needed after this one-time setup.

- **Master key** (`ADMIN_KEY` secret): always works, checked first (no GitHub
  call). Rotate it by editing the secret in Cloudflare.
- **Team admins**: `Admin → Team access → Add admin` generates a one-time key,
  shows it once, and commits `{name, salt, hash}` (hash = `SHA-256(salt:key)`;
  **never the plaintext key**) to `data/admins.json`. **Remove** revokes
  instantly. Requires `GH_TOKEN` to have **Contents: Read+write** (same scope as
  `/inventory`).

Routes: `POST /admin/verify` (sign-in check → `{ok,name}`), `GET /admins`
(admin: list `{name,added}`), `POST /admins` (admin: `{action:"add"|"remove"}`).
`GET /health` reports `adminCount`. To clone the portal for a separate project,
see [`../CLONING.md`](../CLONING.md).
