/**
 * Asset Portal write-proxy (Cloudflare Worker).
 *
 * Reassignment requests:
 *   POST /requests   -> create a labeled GitHub Issue (public SUBMIT_KEY).
 *   GET  /requests   -> list open request markers for a site (cached ~60s).
 * Requisition delivery trackers:
 *   POST /req        -> ADMIN: create a req-tracker Issue from a parsed Req.
 *   GET  /reqs       -> list trackers (?state=open|closed), cached ~60s.
 *   POST /req/deliver-> ADMIN: log delivered/pickup, set expected qty, or
 *                       correct a pickup qty (kind: delivered|pickup|expected|editpickup).
 *   POST /req/delete -> ADMIN: remove a tracker (close issue, drop req-tracker label).
 *   POST /req/complete -> ADMIN: manually mark a tracker complete (close, keep label).
 *   POST /req/trade  -> ADMIN: change a tracker's trade (title/body/label rewrite);
 *                       also accepts requisitioner to backfill the originator.
 * Equipment Master inventory:
 *   POST /inventory  -> ADMIN: commit browser-parsed inventory JSON to main
 *                       (data/meta.json, data/sites.json, data/sites/<code>.json).
 * Admin team access (repo-based user list — no Cloudflare needed to manage it):
 *   POST /admin/verify -> check a key, return {ok, name} (used by the sign-in UI).
 *   GET  /admins       -> ADMIN: list admins ({name, added}; never hashes).
 *   POST /admins       -> ADMIN: add/remove an admin; commits data/admins.json.
 *
 * Secrets/vars:
 *   GH_TOKEN, GH_REPO, SUBMIT_KEY, ALLOWED_ORIGIN,
 *   ADMIN_KEY  (private "master" key; gates the /req*, /inventory and /admins
 *              write routes — NOT in any page. Set once at deploy; always works.)
 *
 * Admin auth model: the master ADMIN_KEY secret always works (checked first, no
 * GitHub call). ADDITIONAL admins live in data/admins.json in the repo as
 * {name, salt, hash} (hash = SHA-256(salt:key)); their keys are never stored in
 * plaintext and never leave the repo. Add/revoke them from the Admin tab (or by
 * committing the file) — no Cloudflare visit after the one-time deploy.
 *
 * NOTE: /inventory and /admins need GH_TOKEN to have Contents: Read+write (the
 * /req* and /requests routes only need Issues). Add that scope before enabling.
 */

const CANON = ["Civil","Electrical","Foundation","Collection","Install","Mechanical",
  "Commissioning","Substation","BESS","Safety","SM/PCC","Survey","Quality","TLine","Inventory","Decom","Other"];

function cors(env){
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type,x-submit-key,x-admin-key,x-admin-name",
  };
}
function json(obj, status, headers){
  return new Response(JSON.stringify(obj), { status, headers: { ...headers, "Content-Type": "application/json" } });
}
function ghHeaders(env){
  return { "Authorization": `Bearer ${env.GH_TOKEN}`, "Accept": "application/vnd.github+json", "User-Agent": "asset-portal" };
}
/* ---------- admin auth (master secret + repo-based user list) ---------- */
function hex(buf){ return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join(""); }
async function sha256hex(str){
  const data = new TextEncoder().encode(str);
  return hex(await crypto.subtle.digest("SHA-256", data));
}
function randomHex(bytes){ const a = new Uint8Array(bytes); crypto.getRandomValues(a); return hex(a); }
function b64encode(str){
  const bytes = new TextEncoder().encode(str); let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function b64decode(b64){   // base64 -> UTF-8 (atob alone mangles multibyte names)
  const bin = atob(String(b64).replace(/\s/g, ""));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
// Short-lived per-isolate cache so the master-key hot path (and bulk imports)
// never triggers a GitHub read; only non-master keys ever fetch admins.json.
let _adminsCache = { at: 0, admins: null };
async function getAdmins(env){
  const now = Date.now();
  if (_adminsCache.admins && (now - _adminsCache.at) < 60000) return _adminsCache.admins;
  let admins = [];
  try {
    const r = await fetch(`https://api.github.com/repos/${env.GH_REPO}/contents/data/admins.json`,
      { headers: { ...ghHeaders(env), "Accept": "application/vnd.github.raw+json" } });
    if (r.ok){ const j = JSON.parse(await r.text()); if (Array.isArray(j.admins)) admins = j.admins; }
  } catch { /* missing/unparseable -> treat as empty (master key still works) */ }
  _adminsCache = { at: now, admins };
  return admins;
}
// Returns { ok, name, master } — never throws.
async function checkAdmin(req, env){
  const key = req.headers.get("x-admin-key") || "";
  if (!key) return { ok: false };
  if (env.ADMIN_KEY && key === env.ADMIN_KEY){
    return { ok: true, name: (req.headers.get("x-admin-name") || "admin").slice(0, 60), master: true };
  }
  const admins = await getAdmins(env);
  for (const a of admins){
    if (!a || !a.salt || !a.hash) continue;
    if (await sha256hex(a.salt + ":" + key) === a.hash) return { ok: true, name: a.name || "admin", master: false };
  }
  return { ok: false };
}

export default {
  async fetch(req, env, ctx){
    const h = cors(env);
    if (req.method === "OPTIONS") return new Response(null, { headers: h });
    const url = new URL(req.url);
    const path = url.pathname;
    if (path === "/requests"){
      if (req.method === "POST") return postRequest(req, env, h);
      if (req.method === "GET")  return getRequests(url, env, h, ctx);
    } else if (path === "/req" && req.method === "POST"){
      return postReq(req, env, h);
    } else if (path === "/reqs" && req.method === "GET"){
      return getReqs(url, env, h, ctx);
    } else if (path === "/req/deliver" && req.method === "POST"){
      return postDeliver(req, env, h);
    } else if (path === "/req/delete" && req.method === "POST"){
      return postDeleteReq(req, env, h);
    } else if (path === "/req/complete" && req.method === "POST"){
      return postCompleteReq(req, env, h);
    } else if (path === "/req/trade" && req.method === "POST"){
      return postSetTrade(req, env, h);
    } else if (path === "/inventory" && req.method === "POST"){
      return postInventory(req, env, h);
    } else if (path === "/admin/verify" && req.method === "POST"){
      return postAdminVerify(req, env, h);
    } else if (path === "/admins" && req.method === "GET"){
      return listAdmins(req, env, h);
    } else if (path === "/admins" && req.method === "POST"){
      return postAdmins(req, env, h);
    } else if (path === "/access" && req.method === "POST"){
      return postAccess(req, env, h);
    } else if (path === "/health" && req.method === "GET"){
      return health(env, h);
    }
    return new Response("not found", { status: 404, headers: h });
  },
};

/* ============================ reassignment requests ============================ */
function buildTitle(b){
  return b.type === "reassign"
    ? `[Reassign] Unit ${b.unit} (SN ${b.serial}) -> ${b.requestedTrade} @ ${b.site}`
    : `[Issue] Unit ${b.unit} (SN ${b.serial}) @ ${b.site}`;
}
function buildMarker(b){
  return JSON.stringify({ unit: b.unit, serial: b.serial, type: b.type, site: b.site,
    requestedTrade: b.type === "reassign" ? b.requestedTrade : "" });
}
function buildBody(b){
  return [
    `**Unit:** ${b.unit}`, `**Serial:** ${b.serial}`, `**Description:** ${b.description || ""}`,
    `**Site:** ${b.site}`, `**Current trade:** ${b.currentTrade || "(none)"}`,
    b.type === "reassign" ? `**Requested trade:** ${b.requestedTrade}` : `**Report:** issue`,
    `**Detail:** ${b.detail || ""}`, `**Requester:** ${b.requester}`, ``,
    "```json", buildMarker(b), "```",
  ].join("\n");
}
async function postRequest(req, env, h){
  if (req.headers.get("x-submit-key") !== env.SUBMIT_KEY) return json({ error: "bad key" }, 401, h);
  let b; try { b = await req.json(); } catch { return json({ error: "bad json" }, 400, h); }
  const required = ["type", "site", "unit", "serial", "requester"].every(k => String(b[k] || "").trim());
  if (!required || !["reassign", "issue"].includes(b.type)) return json({ error: "missing fields" }, 400, h);
  if (b.type === "reassign" && !CANON.includes(b.requestedTrade)) return json({ error: "bad trade" }, 400, h);
  const labels = [b.type === "reassign" ? "request:reassign" : "request:issue", `site:${b.site}`];
  const r = await fetch(`https://api.github.com/repos/${env.GH_REPO}/issues`, {
    method: "POST", headers: { ...ghHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify({ title: buildTitle(b), body: buildBody(b), labels }),
  });
  if (!r.ok) { const t = await r.text(); return json({ error: "github " + r.status, detail: t.slice(0, 300) }, 502, h); }
  const gi = await r.json();
  return json({ ok: true, issueNumber: gi.number, url: gi.html_url }, 201, h);
}
function parseMarker(body){
  const m = /```json\s*({[\s\S]*?})\s*```/.exec(body || "");
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}
async function getRequests(url, env, h, ctx){
  const site = url.searchParams.get("site") || "";
  const cache = caches.default; const cacheKey = new Request(url.toString(), { method: "GET" });
  const hit = await cache.match(cacheKey); if (hit) return hit;
  const out = [];
  for (let page = 1; page <= 5; page++){
    const gr = await fetch(`https://api.github.com/repos/${env.GH_REPO}/issues?state=open&labels=site:${encodeURIComponent(site)}&per_page=100&page=${page}`, { headers: ghHeaders(env) });
    if (!gr.ok) break;
    const arr = await gr.json(); if (!arr.length) break;
    for (const it of arr){ const d = parseMarker(it.body); if (!d || d.type === "req") continue;
      out.push({ unit: d.unit, serial: d.serial, type: d.type, requestedTrade: d.requestedTrade || "", issue: it.number, url: it.html_url }); }
    if (arr.length < 100) break;
  }
  const resp = json({ requests: out, cachedAt: new Date().toISOString() }, 200, { ...h, "Cache-Control": "max-age=60" });
  ctx.waitUntil(cache.put(cacheKey, resp.clone()));
  return resp;
}

/* ============================ requisition delivery trackers ============================
 * A line captures three events over time: quantity DELIVERED to site, quantity
 * PICKED UP by the team, and the pickup person's name. Stored as two arrays:
 *   deliveries: [{qty,date,loggedBy}]           (to site)
 *   pickups:    [{qty,by,date,loggedBy}]         (by team; `by` = pickup person)
 * No ordered quantity is tracked. `part` = 2nd Item Number (shown as Part #).
 */
function reqTitle(m){ return `[Req ${m.reqNumber}]${m.project?(" "+m.project):""} (${m.trade})`; }
function reqMarker(m){
  return JSON.stringify({
    type: "req", reqNumber: m.reqNumber, trade: m.trade, project: m.project || "", projectCode: m.projectCode || "",
    shipTo: m.shipTo || "", requisitioner: m.requisitioner || "", date: m.date || "", description: m.description || "",
    lines: (m.lines || []).map(l => ({
      line: l.line, part: l.part || "", desc: l.desc, uom: l.uom || "", requiredDate: l.requiredDate || "",
      expected: (l.expected == null || l.expected === "") ? null : Number(l.expected),
      deliveries: (l.deliveries || []).map(d => ({ qty: d.qty, date: d.date, loggedBy: d.loggedBy || "" })),
      pickups: (l.pickups || []).map(p => ({ qty: p.qty, by: p.by || "", date: p.date, loggedBy: p.loggedBy || "" })),
    })),
  });
}
function lineDelivered(l){ return (l.deliveries || []).reduce((s, d) => s + (Number(d.qty) || 0), 0); }
function linePickedUp(l){ return (l.pickups || []).reduce((s, p) => s + (Number(p.qty) || 0), 0); }
function lineStatus(delivered, picked){
  if (delivered <= 0 && picked <= 0) return "Not started";
  if (picked > 0 && picked >= delivered) return "Picked up";
  if (picked > 0) return "Partial pickup";
  return "On site";
}
function lineHandled(l){ const d = lineDelivered(l), p = linePickedUp(l); return p > 0 && p >= d; }
function lineExpected(l){ return (l && l.expected != null && l.expected !== "") ? Number(l.expected) : null; }
function linePending(l){ const e = lineExpected(l); return e == null ? null : Math.max(0, e - lineDelivered(l)); }
function reqBody(m){
  const rows = (m.lines || []).map(l => {
    const d = lineDelivered(l), p = linePickedUp(l), e = lineExpected(l), pend = linePending(l);
    const desc = String(l.desc || "").replace(/\|/g, "/");
    const part = String(l.part || "").replace(/\|/g, "/");
    return `| ${l.line} | ${part} | ${desc} ${l.uom || ""} | ${e == null ? "" : e} | ${d} | ${pend == null ? "" : pend} | ${p} | ${lineStatus(d, p)} |`;
  }).join("\n");
  return [
    `**Requisition:** ${m.reqNumber}`, `**Trade:** ${m.trade}`,
    m.project ? `**Project:** ${m.project}` : null, m.date ? `**Date:** ${m.date}` : null, ``,
    `| Line | Part # | Description | Expected | Delivered | Pending | Picked up | Status |`, `|---|---|---|---|---|---|---|---|`, rows, ``,
    "```json", reqMarker(m), "```",
  ].filter(x => x !== null).join("\n");
}
function computeTracker(it){
  const m = parseMarker(it.body);
  if (!m || m.type !== "req") return null;
  const lines = m.lines || [];
  let complete = 0;
  for (const l of lines){ if (lineHandled(l)) complete++; }
  return { issue: it.number, url: it.html_url, reqNumber: m.reqNumber, trade: m.trade,
    project: m.project || "", description: m.description || "", linesTotal: lines.length, linesComplete: complete, marker: m };
}

async function postReq(req, env, h){
  if (!(await checkAdmin(req, env)).ok) return json({ error: "admin only" }, 401, h);
  let b; try { b = await req.json(); } catch { return json({ error: "bad json" }, 400, h); }
  if (!String(b.reqNumber || "").trim()) return json({ error: "missing reqNumber" }, 400, h);
  if (!CANON.includes(b.trade)) return json({ error: "bad trade" }, 400, h);
  if (!Array.isArray(b.lines) || !b.lines.length) return json({ error: "no lines" }, 400, h);
  const m = { reqNumber: b.reqNumber, trade: b.trade, project: b.project || "", projectCode: b.projectCode || "",
    shipTo: b.shipTo || "", requisitioner: b.requisitioner || "", date: b.date || "", description: b.description || "",
    lines: b.lines.map(l => ({ line: l.line, part: l.part || "", desc: l.desc, uom: l.uom || "", requiredDate: l.requiredDate || "", expected: (l.expected == null || l.expected === "") ? null : Number(l.expected), deliveries: [], pickups: [] })) };
  const labels = ["req-tracker", `trade:${b.trade}`, `site:${b.projectCode || "none"}`];
  const r = await fetch(`https://api.github.com/repos/${env.GH_REPO}/issues`, {
    method: "POST", headers: { ...ghHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify({ title: reqTitle(m), body: reqBody(m), labels }),
  });
  if (!r.ok) { const t = await r.text(); return json({ error: "github " + r.status, detail: t.slice(0, 300) }, 502, h); }
  const gi = await r.json();
  return json({ ok: true, issueNumber: gi.number, url: gi.html_url, tracker: computeTracker(gi) }, 201, h);
}

async function getReqs(url, env, h, ctx){
  const state = url.searchParams.get("state") === "closed" ? "closed" : "open";
  const cache = caches.default; const cacheKey = new Request(url.toString(), { method: "GET" });
  const hit = await cache.match(cacheKey); if (hit) return hit;
  const out = [];
  for (let page = 1; page <= 20; page++){   // up to 2000 trackers (100/page)
    const gr = await fetch(`https://api.github.com/repos/${env.GH_REPO}/issues?state=${state}&labels=req-tracker&per_page=100&page=${page}`, { headers: ghHeaders(env) });
    if (!gr.ok) break;
    const arr = await gr.json(); if (!arr.length) break;
    for (const it of arr){ const t = computeTracker(it); if (t) out.push(t); }
    if (arr.length < 100) break;
  }
  const resp = json({ trackers: out, cachedAt: new Date().toISOString() }, 200, { ...h, "Cache-Control": "max-age=60" });
  ctx.waitUntil(cache.put(cacheKey, resp.clone()));
  return resp;
}

async function postDeliver(req, env, h){
  if (!(await checkAdmin(req, env)).ok) return json({ error: "admin only" }, 401, h);
  let b; try { b = await req.json(); } catch { return json({ error: "bad json" }, 400, h); }
  const issue = parseInt(b.issue, 10);
  const qty = Number(b.qty);
  const kind = b.kind === "pickup" ? "pickup" : (b.kind === "expected" ? "expected" : (b.kind === "editpickup" ? "editpickup" : "delivered"));
  if (!issue || b.line == null || !isFinite(qty)) return json({ error: "missing fields" }, 400, h);
  if (kind !== "expected" && qty === 0) return json({ error: "missing fields" }, 400, h);
  if (kind === "expected" && qty < 0) return json({ error: "bad qty" }, 400, h);
  if (kind === "pickup" && !String(b.by || "").trim()) return json({ error: "pickup needs a person" }, 400, h);
  // read the issue
  const gr = await fetch(`https://api.github.com/repos/${env.GH_REPO}/issues/${issue}`, { headers: ghHeaders(env) });
  if (!gr.ok) return json({ error: "github " + gr.status }, 502, h);
  const it = await gr.json();
  const m = parseMarker(it.body);
  if (!m || m.type !== "req") return json({ error: "not a tracker" }, 400, h);
  const line = (m.lines || []).find(l => String(l.line) === String(b.line));
  if (!line) return json({ error: "no such line" }, 400, h);
  const date = new Date().toISOString().slice(0, 10);
  const loggedBy = String(b.loggedBy || "").trim();
  if (kind === "pickup"){
    line.pickups = line.pickups || [];
    line.pickups.push({ qty, by: String(b.by || "").trim(), date, loggedBy });
  } else if (kind === "editpickup"){
    const idx = parseInt(b.index, 10);
    const pk = (line.pickups || [])[idx];
    if (!pk) return json({ error: "no such pickup" }, 400, h);
    pk.qty = qty;   // correct a mistyped picked-up quantity in place
  } else if (kind === "expected"){
    line.expected = qty;   // manual expected qty (absolute; export often omits it)
  } else {
    line.deliveries = line.deliveries || [];
    line.deliveries.push({ qty, date, loggedBy });
  }
  const complete = (m.lines || []).every(l => lineHandled(l));
  const patch = { body: reqBody(m) };
  if (complete) patch.state = "closed";
  const pr = await fetch(`https://api.github.com/repos/${env.GH_REPO}/issues/${issue}`, {
    method: "PATCH", headers: { ...ghHeaders(env), "Content-Type": "application/json" }, body: JSON.stringify(patch),
  });
  if (!pr.ok) { const t = await pr.text(); return json({ error: "github " + pr.status, detail: t.slice(0, 300) }, 502, h); }
  const updated = await pr.json();
  return json({ ok: true, complete, tracker: computeTracker(updated) }, 200, h);
}

/* ADMIN: delete a tracker — close the issue and drop the req-tracker label so it
 * leaves the app (the closed issue remains on GitHub as a record). */
async function postDeleteReq(req, env, h){
  if (!(await checkAdmin(req, env)).ok) return json({ error: "admin only" }, 401, h);
  let b; try { b = await req.json(); } catch { return json({ error: "bad json" }, 400, h); }
  const issue = parseInt(b.issue, 10);
  if (!issue) return json({ error: "missing issue" }, 400, h);
  const gr = await fetch(`https://api.github.com/repos/${env.GH_REPO}/issues/${issue}`, { headers: ghHeaders(env) });
  if (!gr.ok) return json({ error: "github " + gr.status }, 502, h);
  const it = await gr.json();
  const labels = (it.labels || []).map(l => (typeof l === "string" ? l : l.name)).filter(n => n && n !== "req-tracker");
  if (!labels.includes("req-deleted")) labels.push("req-deleted");
  const pr = await fetch(`https://api.github.com/repos/${env.GH_REPO}/issues/${issue}`, {
    method: "PATCH", headers: { ...ghHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify({ state: "closed", state_reason: "not_planned", labels }),
  });
  if (!pr.ok) { const t = await pr.text(); return json({ error: "github " + pr.status, detail: t.slice(0, 300) }, 502, h); }
  return json({ ok: true, deleted: issue }, 200, h);
}

/* ADMIN: manually mark a tracker complete — close the issue (keeping the
 * req-tracker label so it shows under Completed) even if not every line has
 * been picked up. Used when the Req export omits some already-handled lines. */
async function postCompleteReq(req, env, h){
  if (!(await checkAdmin(req, env)).ok) return json({ error: "admin only" }, 401, h);
  let b; try { b = await req.json(); } catch { return json({ error: "bad json" }, 400, h); }
  const issue = parseInt(b.issue, 10);
  if (!issue) return json({ error: "missing issue" }, 400, h);
  const pr = await fetch(`https://api.github.com/repos/${env.GH_REPO}/issues/${issue}`, {
    method: "PATCH", headers: { ...ghHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify({ state: "closed", state_reason: "completed" }),
  });
  if (!pr.ok) { const t = await pr.text(); return json({ error: "github " + pr.status, detail: t.slice(0, 300) }, 502, h); }
  const updated = await pr.json();
  return json({ ok: true, complete: true, tracker: computeTracker(updated) }, 200, h);
}

/* ADMIN: change a tracker's trade after creation — rewrites the marker/title/body
 * and swaps the trade:* label. */
async function postSetTrade(req, env, h){
  if (!(await checkAdmin(req, env)).ok) return json({ error: "admin only" }, 401, h);
  let b; try { b = await req.json(); } catch { return json({ error: "bad json" }, 400, h); }
  const issue = parseInt(b.issue, 10);
  if (!issue) return json({ error: "missing issue" }, 400, h);
  if (!CANON.includes(b.trade)) return json({ error: "bad trade" }, 400, h);
  const gr = await fetch(`https://api.github.com/repos/${env.GH_REPO}/issues/${issue}`, { headers: ghHeaders(env) });
  if (!gr.ok) return json({ error: "github " + gr.status }, 502, h);
  const it = await gr.json();
  const m = parseMarker(it.body);
  if (!m || m.type !== "req") return json({ error: "not a tracker" }, 400, h);
  m.trade = b.trade;
  if (typeof b.requisitioner === "string") m.requisitioner = b.requisitioner;   // backfill originator from a re-parsed file
  const labels = (it.labels || []).map(l => (typeof l === "string" ? l : l.name)).filter(n => n && !n.startsWith("trade:"));
  labels.push(`trade:${b.trade}`);
  const pr = await fetch(`https://api.github.com/repos/${env.GH_REPO}/issues/${issue}`, {
    method: "PATCH", headers: { ...ghHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify({ title: reqTitle(m), body: reqBody(m), labels }),
  });
  if (!pr.ok) { const t = await pr.text(); return json({ error: "github " + pr.status, detail: t.slice(0, 300) }, 502, h); }
  const updated = await pr.json();
  return json({ ok: true, tracker: computeTracker(updated) }, 200, h);
}

/* ============================ inventory publish (Equipment Master import) ============================ */
/**
 * POST /inventory  (ADMIN only)
 * Body: { meta:{builtAt,sourceVersion,assetCount,siteCount}, index:[{code,name,count}], siteData:{code:[asset,...]} }
 * Commits data/meta.json, data/sites.json and data/sites/<code>.json to `main`
 * in a single atomic commit (GitHub Git Data API), deleting per-site files
 * that are no longer present. Requires GH_TOKEN with Contents: Read+write.
 * The Excel itself is parsed in the browser and never uploaded — only JSON.
 */
const CODE_RE = /^[A-Za-z0-9_-]+$/;
async function postInventory(req, env, h){
  if (!(await checkAdmin(req, env)).ok) return json({ error: "admin only" }, 401, h);
  let b; try { b = await req.json(); } catch { return json({ error: "bad json" }, 400, h); }
  if (!b || typeof b !== "object" || !b.meta || typeof b.meta !== "object"
      || !Array.isArray(b.index) || !b.siteData || typeof b.siteData !== "object"){
    return json({ error: "bad bundle" }, 400, h);
  }
  const codes = Object.keys(b.siteData);
  if (!codes.length) return json({ error: "no sites" }, 400, h);
  for (const c of codes){
    if (!CODE_RE.test(c)) return json({ error: "bad site code: " + c }, 400, h);
    if (!Array.isArray(b.siteData[c])) return json({ error: "site not array: " + c }, 400, h);
  }
  const api = `https://api.github.com/repos/${env.GH_REPO}`;
  const gh = ghHeaders(env);
  const jh = { ...gh, "Content-Type": "application/json" };
  try {
    // 1. current main ref -> base commit -> base tree
    const refR = await fetch(`${api}/git/ref/heads/main`, { headers: gh });
    if (!refR.ok) return json({ error: "ref " + refR.status, detail: (await refR.text()).slice(0, 300) }, 502, h);
    const baseCommitSha = (await refR.json()).object.sha;
    const cR = await fetch(`${api}/git/commits/${baseCommitSha}`, { headers: gh });
    if (!cR.ok) return json({ error: "commit " + cR.status }, 502, h);
    const baseTreeSha = (await cR.json()).tree.sha;
    // 2. existing tree (to delete per-site files no longer present)
    const tR = await fetch(`${api}/git/trees/${baseTreeSha}?recursive=1`, { headers: gh });
    if (!tR.ok) return json({ error: "tree " + tR.status }, 502, h);
    const baseTree = await tR.json();
    const keep = new Set(codes.map(c => `data/sites/${c}.json`));
    const entries = [];
    for (const t of (baseTree.tree || [])){
      if (t.type === "blob" && t.path.startsWith("data/sites/") && t.path.endsWith(".json") && !keep.has(t.path)){
        entries.push({ path: t.path, mode: "100644", type: "blob", sha: null }); // delete stale
      }
    }
    // 3. new/updated files (content inlined; GitHub creates the blobs)
    entries.push({ path: "data/meta.json",  mode: "100644", type: "blob", content: JSON.stringify(b.meta) });
    entries.push({ path: "data/sites.json", mode: "100644", type: "blob", content: JSON.stringify(b.index) });
    for (const c of codes){
      entries.push({ path: `data/sites/${c}.json`, mode: "100644", type: "blob", content: JSON.stringify(b.siteData[c]) });
    }
    // 4. tree -> 5. commit -> 6. move ref
    const ntR = await fetch(`${api}/git/trees`, { method: "POST", headers: jh, body: JSON.stringify({ base_tree: baseTreeSha, tree: entries }) });
    if (!ntR.ok) return json({ error: "newtree " + ntR.status, detail: (await ntR.text()).slice(0, 300) }, 502, h);
    const newTreeSha = (await ntR.json()).sha;
    const msg = `Update inventory data — ${b.meta.sourceVersion || "upload"} (${b.meta.assetCount || 0} assets, ${b.index.length} sites) [portal]`;
    const coR = await fetch(`${api}/git/commits`, { method: "POST", headers: jh, body: JSON.stringify({ message: msg, tree: newTreeSha, parents: [baseCommitSha] }) });
    if (!coR.ok) return json({ error: "mkcommit " + coR.status, detail: (await coR.text()).slice(0, 300) }, 502, h);
    const newCommitSha = (await coR.json()).sha;
    const upR = await fetch(`${api}/git/refs/heads/main`, { method: "PATCH", headers: jh, body: JSON.stringify({ sha: newCommitSha }) });
    if (!upR.ok) return json({ error: "updateref " + upR.status, detail: (await upR.text()).slice(0, 300) }, 502, h);
    return json({ ok: true, commit: newCommitSha, assetCount: b.meta.assetCount || 0, siteCount: b.index.length }, 200, h);
  } catch (e) {
    return json({ error: "exception", detail: String(e).slice(0, 300) }, 502, h);
  }
}

/* ============================ admin team access (repo-based user list) ============================ */
/* POST /admin/verify — used by the sign-in UI to validate a key and get the
 * display name. No GitHub write. Body/headers carry the key (x-admin-key). */
async function postAdminVerify(req, env, h){
  const who = await checkAdmin(req, env);
  return json({ ok: who.ok, name: who.ok ? who.name : "", master: !!who.master }, 200, h);
}

/* GET /admins — ADMIN: list admins as {name, added} (never hashes/salts). The
 * always-on master key isn't in this list; it's shown separately by the UI. */
async function listAdmins(req, env, h){
  if (!(await checkAdmin(req, env)).ok) return json({ error: "admin only" }, 401, h);
  const admins = await getAdmins(env);
  return json({ admins: admins.map(a => ({ name: a.name || "", added: a.added || "" })) }, 200, h);
}

/* POST /admins — ADMIN: add or remove a repo admin, committing data/admins.json.
 * Body: { action:"add", name, key }  |  { action:"remove", name }
 * Keys are hashed (SHA-256 of salt:key) before storage — the plaintext key is
 * generated in the browser, shown to the user once, and never sent back. */
async function postAdmins(req, env, h){
  if (!(await checkAdmin(req, env)).ok) return json({ error: "admin only" }, 401, h);
  let b; try { b = await req.json(); } catch { return json({ error: "bad json" }, 400, h); }
  const action = b.action === "remove" ? "remove" : "add";
  const name = String(b.name || "").trim().slice(0, 60);
  if (!name) return json({ error: "missing name" }, 400, h);

  // Read current file (with its blob sha, needed to update it).
  let admins = [], sha = null;
  const gr = await fetch(`https://api.github.com/repos/${env.GH_REPO}/contents/data/admins.json`, { headers: ghHeaders(env) });
  if (gr.ok){
    const meta = await gr.json(); sha = meta.sha;
    try { const j = JSON.parse(b64decode(meta.content || "")); if (Array.isArray(j.admins)) admins = j.admins; } catch { /* start fresh */ }
  } else if (gr.status !== 404){
    return json({ error: "github " + gr.status }, 502, h);
  }

  if (action === "add"){
    const key = String(b.key || "");
    if (key.length < 12) return json({ error: "key too short" }, 400, h);
    if (admins.some(a => (a.name || "").toLowerCase() === name.toLowerCase())) return json({ error: "name exists" }, 409, h);
    const salt = randomHex(16);
    admins.push({ name, salt, hash: await sha256hex(salt + ":" + key), added: new Date().toISOString().slice(0, 10) });
  } else {
    const before = admins.length;
    admins = admins.filter(a => (a.name || "").toLowerCase() !== name.toLowerCase());
    if (admins.length === before) return json({ error: "not found" }, 404, h);
  }

  const body = JSON.stringify({ admins }, null, 2) + "\n";
  const put = {
    message: `Admin access: ${action === "add" ? "add" : "remove"} ${name} [portal]`,
    content: b64encode(body),
  };
  if (sha) put.sha = sha;
  const pr = await fetch(`https://api.github.com/repos/${env.GH_REPO}/contents/data/admins.json`, {
    method: "PUT", headers: { ...ghHeaders(env), "Content-Type": "application/json" }, body: JSON.stringify(put),
  });
  if (!pr.ok) { const t = await pr.text(); return json({ error: "github " + pr.status, detail: t.slice(0, 300) }, 502, h); }
  _adminsCache = { at: 0, admins: null };   // invalidate so the change is live immediately
  return json({ ok: true, admins: admins.map(a => ({ name: a.name, added: a.added || "" })) }, 200, h);
}

/* ============================ optional view-only access gate ============================
 * POST /access — ADMIN: turn the front-end view gate on/off. Body:
 *   { action:"set", key }   -> require a view key (stored hashed in data/access.json)
 *   { action:"clear" }      -> make the portal public again
 * The pages read data/access.json (public static file) and prompt for the key
 * when present. NOTE: the repo is public, so this is a deterrent for casual
 * link-holders, not true confidentiality — the raw data stays readable on GitHub. */
async function postAccess(req, env, h){
  if (!(await checkAdmin(req, env)).ok) return json({ error: "admin only" }, 401, h);
  let b; try { b = await req.json(); } catch { return json({ error: "bad json" }, 400, h); }
  const action = b.action === "clear" ? "clear" : "set";
  let view = null;
  if (action === "set"){
    const key = String(b.key || "").trim();
    if (key.length < 4) return json({ error: "key too short" }, 400, h);
    const salt = randomHex(16);
    view = { salt, hash: await sha256hex(salt + ":" + key) };
  }
  // read current file for its sha
  let sha = null;
  const gr = await fetch(`https://api.github.com/repos/${env.GH_REPO}/contents/data/access.json`, { headers: ghHeaders(env) });
  if (gr.ok){ sha = (await gr.json()).sha; }
  else if (gr.status !== 404){ return json({ error: "github " + gr.status }, 502, h); }
  const put = { message: `Site access: ${action === "set" ? "require view key" : "make public"} [portal]`,
    content: b64encode(JSON.stringify({ view }, null, 2) + "\n") };
  if (sha) put.sha = sha;
  const pr = await fetch(`https://api.github.com/repos/${env.GH_REPO}/contents/data/access.json`, {
    method: "PUT", headers: { ...ghHeaders(env), "Content-Type": "application/json" }, body: JSON.stringify(put),
  });
  if (!pr.ok) { const t = await pr.text(); return json({ error: "github " + pr.status, detail: t.slice(0, 300) }, 502, h); }
  return json({ ok: true, required: !!view }, 200, h);
}

/* ============================ health (config diagnostics; no secrets exposed) ============================ */
async function health(env, h){
  const out = {
    hasToken: !!env.GH_TOKEN, hasRepo: !!env.GH_REPO, repo: env.GH_REPO || null,
    hasSubmitKey: !!env.SUBMIT_KEY, hasAdminKey: !!env.ADMIN_KEY,
    allowedOrigin: env.ALLOWED_ORIGIN || null, github: null,
  };
  if (env.GH_TOKEN && env.GH_REPO){
    try {
      const r = await fetch(`https://api.github.com/repos/${env.GH_REPO}`, { headers: ghHeaders(env) });
      out.github = { status: r.status, ok: r.ok };
    } catch (e) { out.github = { error: String(e) }; }
    try { out.adminCount = (await getAdmins(env)).length; } catch { out.adminCount = null; }
  }
  return json(out, 200, h);
}

// Exported for the contract test (Python port mirrors these).
export const _internals = { buildTitle, buildMarker, buildBody, parseMarker, reqTitle, reqMarker, reqBody, lineStatus, lineDelivered, linePickedUp, lineHandled, sha256hex, CANON };
