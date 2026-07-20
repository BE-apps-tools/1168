"""Auto-close satisfied Reassign-Trade requests after a data rebuild.

find_satisfied() is pure and unit-tested: given open reassign issues (with a
parsed marker) and the freshly built data dir, it returns the issue numbers
whose asset now matches the requested trade.

main() (run by the GitHub Action) fetches open request:reassign issues, parses
their markers, computes the satisfied set against data/, and closes each with a
comment citing the export version. Uses the Action's GITHUB_TOKEN.
"""
import os
import re
import json
import urllib.request
import urllib.parse

MARKER_RE = re.compile(r"```json\s*({[\s\S]*?})\s*```")


def _load_site(data_dir, site):
    path = os.path.join(data_dir, "sites", site + ".json")
    if not os.path.isfile(path):
        return []
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


def find_satisfied(issues, data_dir):
    """issues: [{number, marker:{unit,serial,site,type,requestedTrade}}] -> [issue numbers]."""
    out = []
    cache = {}
    for it in issues:
        m = it.get("marker") or {}
        if m.get("type") != "reassign":
            continue
        want = m.get("requestedTrade", "")
        if not want:
            continue
        site = m.get("site", "")
        if site not in cache:
            cache[site] = _load_site(data_dir, site)
        for a in cache[site]:
            if a.get("unit") == m.get("unit") and a.get("serial") == m.get("serial"):
                if a.get("trade") == want:
                    out.append(it["number"])
                break
    return out


def _gh(url, token, method="GET", data=None):
    req = urllib.request.Request(url, method=method, headers={
        "Authorization": "Bearer " + token,
        "Accept": "application/vnd.github+json",
        "User-Agent": "asset-portal",
    })
    if data is not None:
        req.data = json.dumps(data).encode()
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req) as r:
        body = r.read().decode()
        return json.loads(body) if body else None


def main():
    token = os.environ["GITHUB_TOKEN"]
    repo = os.environ["GITHUB_REPOSITORY"]
    try:
        ver = json.load(open("data/meta.json", encoding="utf-8")).get("sourceVersion", "")
    except Exception:
        ver = ""

    issues, page = [], 1
    while True:
        q = urllib.parse.urlencode({"state": "open", "labels": "request:reassign",
                                    "per_page": 100, "page": page})
        arr = _gh("https://api.github.com/repos/%s/issues?%s" % (repo, q), token) or []
        if not arr:
            break
        for it in arr:
            m = MARKER_RE.search(it.get("body") or "")
            if not m:
                continue
            try:
                marker = json.loads(m.group(1))
            except Exception:
                continue
            issues.append({"number": it["number"], "marker": marker})
        if len(arr) < 100:
            break
        page += 1

    satisfied = find_satisfied(issues, "data")
    for num in satisfied:
        _gh("https://api.github.com/repos/%s/issues/%d/comments" % (repo, num), token, "POST",
            {"body": "Resolved by export %s — the asset now matches the requested trade. Auto-closing."
                     % (ver or "(latest)")})
        _gh("https://api.github.com/repos/%s/issues/%d" % (repo, num), token, "PATCH",
            {"state": "closed"})
    print("closed:", satisfied)


if __name__ == "__main__":
    main()
