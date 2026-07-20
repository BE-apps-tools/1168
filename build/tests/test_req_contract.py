"""Contract test for the Req-tracker Worker builders/parsers (Python mirror of
worker/src/index.js: reqTitle, reqMarker, reqBody, lineStatus, lineReceived,
parseMarker). If the JS format drifts, the expected strings here must change too.
"""
import json
import re

MARKER_RE = re.compile(r"```json\s*({[\s\S]*?})\s*```")


def req_title(m):
    return f'[Req {m["reqNumber"]}] {m["project"]} — {m["description"]} ({m["trade"]})'


def req_marker(m):
    return json.dumps({
        "type": "req", "reqNumber": m["reqNumber"], "trade": m["trade"],
        "project": m["project"], "projectCode": m["projectCode"],
        "shipTo": m.get("shipTo", ""), "requisitioner": m.get("requisitioner", ""),
        "date": m.get("date", ""), "description": m.get("description", ""),
        "lines": [{
            "line": l["line"], "desc": l["desc"], "qty": l["qty"], "uom": l.get("uom", ""),
            "requiredDate": l.get("requiredDate", ""),
            "deliveries": [{"qty": d["qty"], "date": d["date"], "by": d.get("by", ""), "loggedBy": d.get("loggedBy", "")}
                           for d in l.get("deliveries", [])],
        } for l in m.get("lines", [])],
    })


def line_received(l):
    return sum((d.get("qty") or 0) for d in l.get("deliveries", []))


def line_status(qty, received):
    try:
        q = float(qty)
        finite = True
    except (TypeError, ValueError):
        finite = False
    if received <= 0:
        return "Not started"
    if not finite:
        return "Complete"
    return "Complete" if received >= q else "Partial"


def parse_marker(body):
    m = MARKER_RE.search(body or "")
    return json.loads(m.group(1)) if m else None


SAMPLE = {
    "reqNumber": "R-0001", "trade": "Civil", "project": "High Spring",
    "projectCode": "36620001127", "shipTo": "addr", "requisitioner": "EE # 1",
    "date": "2026-07-16", "description": "Hydrovac",
    "lines": [
        {"line": 1, "desc": "spray foam gun", "qty": 5, "uom": "EA", "requiredDate": "2026-07-23", "deliveries": []},
        {"line": 2, "desc": "18in zip ties heavy duty", "qty": 5000, "uom": "BX", "requiredDate": "2026-07-23",
         "deliveries": [{"qty": 2000, "date": "2026-07-20", "by": "J. Smith", "loggedBy": "R. Ruiz"}]},
    ],
}


def test_title():
    assert req_title(SAMPLE) == "[Req R-0001] High Spring — Hydrovac (Civil)"


def test_marker_roundtrip():
    body = "head\n\n```json\n" + req_marker(SAMPLE) + "\n```"
    d = parse_marker(body)
    assert d["type"] == "req" and d["trade"] == "Civil"
    assert len(d["lines"]) == 2
    assert d["lines"][1]["deliveries"][0]["loggedBy"] == "R. Ruiz"
    assert "cost" not in json.dumps(d).lower()


def test_line_status_and_received():
    assert line_received(SAMPLE["lines"][0]) == 0
    assert line_received(SAMPLE["lines"][1]) == 2000
    assert line_status(5, 0) == "Not started"
    assert line_status(5000, 2000) == "Partial"
    assert line_status(5, 5) == "Complete"
    assert line_status(5, 7) == "Complete"     # over-delivery still complete
    assert line_status("", 3) == "Complete"    # non-numeric qty → any receipt completes
