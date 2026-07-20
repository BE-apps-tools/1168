/**
 * Asset Portal write-proxy (Cloudflare Worker).
 *
 * Reassignment requests:
 *   POST /requests   -> create a labeled GitHub Issue (public SUBMIT_KEY).
 *   GET  /requests   -> list open request markers for a site (cached ~60s).
 * Requisition delivery trackers:
 *   POST /req        -> ADMIN: create a req-tracker Issue from a parsed Req.
 *   GET  /reqs       -> list trackers (?state=open|closed), cached ~60s.
 *   POST /req/deliver-> ADMIN: log a delivered/pickup event on a line.
 *   POST /req/delete -> ADMIN: remove a tracker (close issue, drop req-tracker label).
 * Equipment Master inventory:
 *   POST /inventory  -> ADMIN: commit browser-parsed inventory JSON to main
 *                       (data/meta.json, data/sites.json, data/sites/<code>.json).
 *
 * Secrets/vars:
 *   GH_TOKEN, GH_REPO, SUBMIT_KEY, ALLOWED_ORIGIN,
 *   ADMIN_KEY  (private; gates the /req* and /inventory write routes — NOT in any page)
 *
 * NOTE: /inventory needs GH_TOKEN to have Contents: Read+write (the /req* and
 * /requests routes only need Issues). Add that scope before enabling imports.
 */

const CANON = ["Civil","Electrical","Foundation","Collection","Install","Mechanical",
  "Commissioning","Substation","BESS","Safety","SM/PCC","Survey","Quality","TLine","Inventory","Decom","Other"];

function cors(env){
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type,x-submit-key,x-admin-key",
  };
}
function json(obj, status, headers){
  return new Response(JSON.stringify(obj), { status, headers: { ...headers, "Content-Type": "application/json" } });
}
function ghHeaders(env){
  return { "Authorization": `Bearer ${env.GH_TOKEN}`, "Accept": "application/vnd.github+json", "User-Agent": "asset-portal" };
}
function requireAdmin(req, env){ return req.headers.get("x-admin-key") === env.ADMIN_KEY; }

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
    } else if (path === "/inventory" && req.method === "POST"){
      return postInventory(req, env, h);
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
function reqBody(m){
  const rows = (m.lines || []).map(l => {
    const d = lineDelivered(l), p = linePickedUp(l);
    const desc = String(l.desc || "").replace(/\|/g, "/");
    const part = String(l.part || "").replace(/\|/g, "/");
    return `| ${l.line} | ${part} | ${desc} ${l.uom || ""} | ${d} | ${p} | ${lineStatus(d, p)} |`;
  }).join("\n");
  return [
    `**Requisition:** ${m.reqNumber}`, `**Trade:** ${m.trade}`,
    m.project ? `**Project:** ${m.project}` : null, m.date ? `**Date:** ${m.date}` : null, ``,
    `| Line | Part # | Description | Delivered | Picked up | Status |`, `|---|---|---|---|---|---|`, rows, ``,
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
  if (!requireAdmin(req, env)) return json({ error: "admin only" }, 401, h);
  let b; try { b = await req.json(); } catch { return json({ error: "bad json" }, 400, h); }
  if (!String(b.reqNumber || "").trim()) return json({ error: "missing reqNumber" }, 400, h);
  if (!CANON.includes(b.trade)) return json({ error: "bad trade" }, 400, h);
  if (!Array.isArray(b.lines) || !b.lines.length) return json({ error: "no lines" }, 400, h);
  const m = { reqNumber: b.reqNumber, trade: b.trade, project: b.project || "", projectCode: b.projectCode || "",
    shipTo: b.shipTo || "", requisitioner: b.requisitioner || "", date: b.date || "", description: b.description || "",
    lines: b.lines.map(l => ({ line: l.line, part: l.part || "", desc: l.desc, uom: l.uom || "", requiredDate: l.requiredDate || "", deliveries: [], pickups: [] })) };
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
  for (let page = 1; page <= 5; page++){
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
  if (!requireAdmin(req, env)) return json({ error: "admin only" }, 401, h);
  let b; try { b = await req.json(); } catch { return json({ error: "bad json" }, 400, h); }
  const issue = parseInt(b.issue, 10);
  const qty = Number(b.qty);
  const kind = b.kind === "pickup" ? "pickup" : "delivered";
  if (!issue || b.line == null || !isFinite(qty) || qty === 0) return json({ error: "missing fields" }, 400, h);
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
  if (!requireAdmin(req, env)) return json({ error: "admin only" }, 401, h);
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
  if (!requireAdmin(req, env)) return json({ error: "admin only" }, 401, h);
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
  }
  return json(out, 200, h);
}

// Exported for the contract test (Python port mirrors these).
export const _internals = { buildTitle, buildMarker, buildBody, parseMarker, reqTitle, reqMarker, reqBody, lineStatus, lineDelivered, linePickedUp, lineHandled, CANON };
