from build.normalize import canonical_trade, excel_serial_to_iso, split_branch


def test_trade_variants():
    for raw in ["ELECTRIC", "ELEC", "ELECTRI", "ELETRIC", "ELECT", "electrical"]:
        assert canonical_trade(raw) == "Electrical"
    assert canonical_trade("CIVIL") == "Civil"
    assert canonical_trade("COMMISSG") == "Commissioning"
    assert canonical_trade("SM/PCC") == "SM/PCC"
    assert canonical_trade("") == ""
    assert canonical_trade("  ") == ""
    assert canonical_trade("ZZZ-unknown") == "Other"


def test_dates():
    # Excel serial 44197 == 2021-01-01 (widely documented reference point)
    assert excel_serial_to_iso("44197") == "2021-01-01"
    assert excel_serial_to_iso(44197) == "2021-01-01"
    assert excel_serial_to_iso("") == ""
    assert excel_serial_to_iso("not a number") == ""
    assert excel_serial_to_iso("0") == ""


def test_split_branch():
    assert split_branch("36620001013 - NEER Grant County Slr, WI") == \
        ("36620001013", "NEER Grant County Slr, WI")
    assert split_branch("36990139 - CORP-Overhead G&A") == ("36990139", "CORP-Overhead G&A")
    assert split_branch("") == ("", "")
    assert split_branch("NODASH") == ("NODASH", "")
