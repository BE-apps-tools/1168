import json
import os

from build.reconcile import find_satisfied


def _site(tmp_path, code, rows):
    os.makedirs(tmp_path / "sites", exist_ok=True)
    with open(tmp_path / "sites" / (code + ".json"), "w", encoding="utf-8") as f:
        json.dump(rows, f)


def test_satisfied_when_trade_matches(tmp_path):
    _site(tmp_path, "SITEX", [{"unit": "U1", "serial": "S1", "trade": "Electrical"}])
    issues = [{"number": 7, "marker": {"unit": "U1", "serial": "S1", "site": "SITEX",
                                       "type": "reassign", "requestedTrade": "Electrical"}}]
    assert find_satisfied(issues, str(tmp_path)) == [7]


def test_not_satisfied_when_trade_differs(tmp_path):
    _site(tmp_path, "SITEX", [{"unit": "U1", "serial": "S1", "trade": "Civil"}])
    issues = [{"number": 7, "marker": {"unit": "U1", "serial": "S1", "site": "SITEX",
                                       "type": "reassign", "requestedTrade": "Electrical"}}]
    assert find_satisfied(issues, str(tmp_path)) == []


def test_ignores_report_issue_type(tmp_path):
    _site(tmp_path, "SITEX", [{"unit": "U1", "serial": "S1", "trade": "Electrical"}])
    issues = [{"number": 8, "marker": {"unit": "U1", "serial": "S1", "site": "SITEX",
                                       "type": "issue", "requestedTrade": ""}}]
    assert find_satisfied(issues, str(tmp_path)) == []


def test_asset_missing_is_not_satisfied(tmp_path):
    _site(tmp_path, "SITEX", [{"unit": "OTHER", "serial": "X", "trade": "Electrical"}])
    issues = [{"number": 9, "marker": {"unit": "U1", "serial": "S1", "site": "SITEX",
                                       "type": "reassign", "requestedTrade": "Electrical"}}]
    assert find_satisfied(issues, str(tmp_path)) == []
