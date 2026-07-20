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

## Optional hardening

The endpoint is public (protected by origin + submit-key). For more, add
**Cloudflare Turnstile** or a **Rate Limiting rule** on the Worker route in the
Cloudflare dashboard — no code change required.
