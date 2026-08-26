"""Contract test for the Req-tracker Worker builders/parsers (Python mirror of
worker/src/index.js: reqTitle, reqMarker, lineStatus, lineDelivered,
linePickedUp, lineHandled, parseMarker). If the JS format drifts, the expected
strings here must change too.

Model: each line captures delivered-to-site and picked-up events separately
(no ordered quantity); `part` = 2nd Item Number shown as Part #.
"""
import json
import re

MARKER_RE = re.compile(r"```json\s*({[\s\S]*?})\s*```")


def req_title(m):
    proj = (" " + m["project"]) if m.get("project") else ""
    return f'[Req {m["reqNumber"]}]{proj} ({m["trade"]})'


def req_marker(m):
    return json.dumps({
        "type": "req", "reqNumber": m["reqNumber"], "trade": m["trade"],
        "project": m.get("project", ""), "projectCode": m.get("projectCode", ""),
        "shipTo": m.get("shipTo", ""), "requisitioner": m.get("requisitioner", ""),
        "date": m.get("date", ""), "description": m.get("description", ""),
        "lines": [{
            "line": l["line"], "part": l.get("part", ""), "desc": l["desc"],
            "uom": l.get("uom", ""), "requiredDate": l.get("requiredDate", ""),
            "expected": (None if l.get("expected") in (None, "") else float(l["expected"])),
            "deliveries": [{"qty": d["qty"], "date": d["date"], "loggedBy": d.get("loggedBy", "")}
                           for d in l.get("deliveries", [])],
            "pickups": [{"qty": p["qty"], "by": p.get("by", ""), "date": p["date"], "loggedBy": p.get("loggedBy", "")}
                        for p in l.get("pickups", [])],
        } for l in m.get("lines", [])],
    })


def line_delivered(l):
    return sum((d.get("qty") or 0) for d in l.get("deliveries", []))


def line_picked_up(l):
    return sum((p.get("qty") or 0) for p in l.get("pickups", []))


def line_expected(l):
    e = l.get("expected")
    return None if e in (None, "") else float(e)


def line_pending(l):
    e = line_expected(l)
    return None if e is None else max(0, e - line_delivered(l))


def line_status(delivered, picked):
    if delivered <= 0 and picked <= 0:
        return "Not started"
    if picked > 0 and picked >= delivered:
        return "Picked up"
    if picked > 0:
        return "Partial pickup"
    return "On site"


def line_handled(l):
    d, p = line_delivered(l), line_picked_up(l)
    return p > 0 and p >= d


def parse_marker(body):
    m = MARKER_RE.search(body or "")
    return json.loads(m.group(1)) if m else None


def delete_line(m, line):
    """Mirror of Worker postDeleteLine: drop one line by its `line` id, refusing
    to remove the last remaining line. Returns (new_marker, complete)."""
    lines = m.get("lines", [])
    if not any(str(l["line"]) == str(line) for l in lines):
        raise ValueError("no such line")
    if len(lines) <= 1:
        raise ValueError("cannot delete the only line")
    kept = [l for l in lines if str(l["line"]) != str(line)]
    new_m = {**m, "lines": kept}
    return new_m, all(line_handled(l) for l in kept)


SAMPLE = {
    "reqNumber": "244213", "trade": "Install", "project": "",
    "projectCode": "36620001127", "date": "",
    "lines": [
        {"line": 1, "part": "", "desc": "Radio Antenna For vehicle", "uom": "EA",
         "requiredDate": "2026-05-22", "deliveries": [], "pickups": []},
        {"line": 2, "part": "756102", "desc": "Hougen hole punch 7500GPR", "uom": "EA",
         "requiredDate": "2026-05-19", "expected": 12,
         "deliveries": [{"qty": 10, "date": "2026-07-20", "loggedBy": "R. Ruiz"}],
         "pickups": [{"qty": 4, "by": "J. Smith", "date": "2026-07-21", "loggedBy": "R. Ruiz"}]},
    ],
}


def test_title():
    assert req_title(SAMPLE) == "[Req 244213] (Install)"
    assert req_title({**SAMPLE, "project": "High Spring"}) == "[Req 244213] High Spring (Install)"


def test_marker_roundtrip():
    body = "head\n\n```json\n" + req_marker(SAMPLE) + "\n```"
    d = parse_marker(body)
    assert d["type"] == "req" and d["trade"] == "Install"
    assert len(d["lines"]) == 2
    assert d["lines"][1]["part"] == "756102"
    assert d["lines"][1]["deliveries"][0]["loggedBy"] == "R. Ruiz"
    assert d["lines"][1]["pickups"][0]["by"] == "J. Smith"
    assert "cost" not in json.dumps(d).lower()
    assert all("qty" not in l for l in d["lines"])   # no ordered quantity field on lines
    assert d["lines"][0]["expected"] is None         # unset when the export omits it
    assert d["lines"][1]["expected"] == 12


def test_expected_and_pending():
    assert line_expected(SAMPLE["lines"][0]) is None
    assert line_pending(SAMPLE["lines"][0]) is None            # no expected -> no pending
    assert line_expected(SAMPLE["lines"][1]) == 12
    assert line_pending(SAMPLE["lines"][1]) == 2               # expected 12 - delivered 10
    assert line_pending({"expected": 5, "deliveries": [{"qty": 8, "date": "d"}]}) == 0   # over-delivered clamps to 0


def test_delivered_and_picked_up():
    assert line_delivered(SAMPLE["lines"][0]) == 0
    assert line_delivered(SAMPLE["lines"][1]) == 10
    assert line_picked_up(SAMPLE["lines"][0]) == 0
    assert line_picked_up(SAMPLE["lines"][1]) == 4


def test_line_status():
    assert line_status(0, 0) == "Not started"
    assert line_status(10, 0) == "On site"
    assert line_status(10, 4) == "Partial pickup"
    assert line_status(10, 10) == "Picked up"
    assert line_status(10, 12) == "Picked up"     # over-pickup still complete
    assert line_status(0, 3) == "Picked up"       # picked up with no logged delivery


def test_line_handled():
    assert line_handled(SAMPLE["lines"][0]) is False
    assert line_handled(SAMPLE["lines"][1]) is False   # delivered 10, picked 4
    assert line_handled({"deliveries": [{"qty": 10, "date": "d"}], "pickups": [{"qty": 10, "date": "d"}]}) is True


def test_delete_line():
    import pytest
    # Drop the duplicate line (line 2), keeping the original — the case in the ask.
    new_m, complete = delete_line(SAMPLE, 2)
    assert [l["line"] for l in new_m["lines"]] == [1]
    assert complete is False                              # line 1 not yet handled
    # Removing the only remaining unhandled line completes the tracker.
    handled = {"line": 1, "desc": "x", "deliveries": [{"qty": 5, "date": "d"}],
               "pickups": [{"qty": 5, "date": "d"}]}
    unhandled = {"line": 2, "desc": "y", "deliveries": [], "pickups": []}
    _, complete2 = delete_line({"lines": [handled, unhandled]}, 2)
    assert complete2 is True
    # Guards: unknown line and last-line deletion both raise.
    with pytest.raises(ValueError):
        delete_line(SAMPLE, 99)
    with pytest.raises(ValueError):
        delete_line({"lines": [unhandled]}, 2)
