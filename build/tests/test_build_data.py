import json
import os
import shutil

from build.build_data import build, newest_source

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "mini.xlsx")


def test_build_splits_by_site(tmp_path):
    meta = build(FIXTURE, str(tmp_path))
    assert meta["assetCount"] == 3
    assert meta["siteCount"] == 2
    assert meta["sourceVersion"] == ""   # fixture filename has no V1.<n>

    idx = json.load(open(tmp_path / "sites.json", encoding="utf-8"))
    by_code = {s["code"]: s for s in idx}
    assert by_code["SITE1"]["count"] == 2
    assert by_code["SITE2"]["count"] == 1
    assert by_code["SITE1"]["name"] == "Alpha Solar, TX"

    site1 = json.load(open(tmp_path / "sites" / "SITE1.json", encoding="utf-8"))
    u1 = next(a for a in site1 if a["unit"] == "U1")
    assert u1["serial"] == "S1"
    assert u1["trade"] == "Electrical"      # normalized from ELECTRIC
    assert u1["tradeRaw"] == "ELECTRIC"
    assert u1["acquiredDate"] == "2021-01-01"   # serial 44197
    assert u1["fromDate"]                        # non-empty ISO
    assert set(["unit", "serial", "trade", "status", "assetNumber"]).issubset(u1)

    u2 = next(a for a in site1 if a["unit"] == "U2")
    assert u2["trade"] == ""                 # blank trade stays blank


def test_skips_rows_without_unit_and_serial(tmp_path):
    meta = build(FIXTURE, str(tmp_path))
    # fixture has no such rows, so count stays 3 (guards the filter path exists)
    assert meta["assetCount"] == 3


def test_build_clears_stale_site_files(tmp_path):
    sites = tmp_path / "sites"
    sites.mkdir()
    (sites / "OLD-SITE.json").write_text("[]", encoding="utf-8")
    build(FIXTURE, str(tmp_path))
    assert not (sites / "OLD-SITE.json").exists()   # stale site removed
    assert (sites / "SITE1.json").exists()          # new sites written


def test_source_version_from_filename(tmp_path):
    versioned = tmp_path / "Equipment Master V1.314.xlsx"
    shutil.copy(FIXTURE, versioned)
    out = tmp_path / "out"
    meta = build(str(versioned), str(out))
    assert meta["sourceVersion"] == "V1.314"


def test_newest_source_picks_highest_version(tmp_path):
    src = tmp_path / "source"
    src.mkdir()
    for n in ("V1.313", "V1.314", "V1.99"):
        shutil.copy(FIXTURE, src / f"Equipment Master {n}.xlsx")
    picked = newest_source(str(src))
    assert os.path.basename(picked) == "Equipment Master V1.314.xlsx"


def test_newest_source_single_file_any_version(tmp_path):
    src = tmp_path / "source"
    src.mkdir()
    shutil.copy(FIXTURE, src / "Equipment Master V2.0.xlsx")   # different major, single file
    picked = newest_source(str(src))
    assert os.path.basename(picked) == "Equipment Master V2.0.xlsx"


def test_newest_source_ignores_excel_lock_files(tmp_path):
    src = tmp_path / "source"
    src.mkdir()
    shutil.copy(FIXTURE, src / "Equipment Master V1.316.xlsx")
    (src / "~$Equipment Master V1.316.xlsx").write_bytes(b"lock")
    picked = newest_source(str(src))
    assert os.path.basename(picked) == "Equipment Master V1.316.xlsx"
