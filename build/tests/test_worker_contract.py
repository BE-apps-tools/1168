"""Contract test for the Worker <-> SPA <-> reconciler interface.

Mirrors worker/src/index.js buildTitle/buildMarker/buildBody + the marker
regex in Python and asserts the exact strings. If the JS format drifts, the
expected strings here must change too — which surfaces the contract break.
The marker parsed here is the same one Task 10 (overlay) and Task 11
(reconcile) rely on.
"""
import json
import re

CANON = ["Civil", "Electrical", "Foundation", "Collection", "Install", "Mechanical",
         "Commissioning", "Substation", "BESS", "Safety", "SM/PCC", "Survey",
         "Quality", "TLine", "Inventory", "Decom", "Other"]

MARKER_RE = re.compile(r"```json\s*({[\s\S]*?})\s*```")


def build_title(b):
    if b["type"] == "reassign":
        return f'[Reassign] Unit {b["unit"]} (SN {b["serial"]}) -> {b["requestedTrade"]} @ {b["site"]}'
    return f'[Issue] Unit {b["unit"]} (SN {b["serial"]}) @ {b["site"]}'


def build_marker(b):
    return json.dumps({
        "unit": b["unit"], "serial": b["serial"], "type": b["type"], "site": b["site"],
        "requestedTrade": b.get("requestedTrade", "") if b["type"] == "reassign" else "",
    })


def build_body(b):
    return "\n".join([
        f'**Unit:** {b["unit"]}', f'**Serial:** {b["serial"]}',
        f'**Description:** {b.get("description","")}', f'**Site:** {b["site"]}',
        f'**Current trade:** {b.get("currentTrade") or "(none)"}',
        (f'**Requested trade:** {b["requestedTrade"]}' if b["type"] == "reassign" else "**Report:** issue"),
        f'**Detail:** {b.get("detail","")}', f'**Requester:** {b["requester"]}', "",
        "```json", build_marker(b), "```",
    ])


def parse_marker(body):
    m = MARKER_RE.search(body or "")
    return json.loads(m.group(1)) if m else None


def test_titles():
    assert build_title({"type": "reassign", "unit": "U1", "serial": "S1", "site": "SITE1",
                        "requestedTrade": "Electrical"}) == \
        "[Reassign] Unit U1 (SN S1) -> Electrical @ SITE1"
    assert build_title({"type": "issue", "unit": "U2", "serial": "S2", "site": "SITE2"}) == \
        "[Issue] Unit U2 (SN S2) @ SITE2"


def test_reassign_marker_roundtrip():
    b = {"type": "reassign", "unit": "U1", "serial": "S1", "site": "SITE1",
         "requestedTrade": "Electrical", "description": "Gen", "currentTrade": "Civil",
         "detail": "wrong", "requester": "R. Ruiz"}
    d = parse_marker(build_body(b))
    assert d == {"unit": "U1", "serial": "S1", "type": "reassign", "site": "SITE1",
                 "requestedTrade": "Electrical"}


def test_issue_marker_has_blank_trade():
    b = {"type": "issue", "unit": "U2", "serial": "S2", "site": "SITE2",
         "detail": "no longer onsite", "requester": "R"}
    d = parse_marker(build_body(b))
    assert d["type"] == "issue" and d["requestedTrade"] == ""


def test_parse_marker_none_when_absent():
    assert parse_marker("no marker here") is None
