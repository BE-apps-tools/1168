"""Normalization helpers for the Equipment Master build.

- canonical_trade: map JDE's inconsistent trade codes to a clean canonical set.
- excel_serial_to_iso: convert Excel date serials to ISO YYYY-MM-DD.
- split_branch: split a "<code> - <name>" Branch/Plant value into (code, name).
"""
from datetime import date, timedelta

CANONICAL = ["Civil", "Electrical", "Foundation", "Collection", "Install",
             "Mechanical", "Commissioning", "Substation", "BESS", "Safety",
             "SM/PCC", "Survey", "Quality", "TLine", "Inventory", "Decom"]

_VARIANTS = {
    "CIVIL": "Civil",
    "ELECTRIC": "Electrical", "ELEC": "Electrical", "ELECTRI": "Electrical",
    "ELETRIC": "Electrical", "ELECT": "Electrical", "ELECTRICAL": "Electrical",
    "FOUNDAT": "Foundation", "FOUNDATION": "Foundation",
    "COLLECT": "Collection", "COLLECTI": "Collection", "COLLECTION": "Collection",
    "INSTALL": "Install",
    "MECHANIC": "Mechanical", "MECHANICAL": "Mechanical",
    "COMMISSG": "Commissioning", "COMMISSI": "Commissioning", "COMMISSIONING": "Commissioning",
    "SUBSTATN": "Substation", "SUBSTATI": "Substation", "SUBSTATION": "Substation",
    "BESS": "BESS", "SAFETY": "Safety", "SM/PCC": "SM/PCC", "SURVEY": "Survey",
    "QUALITY": "Quality", "TLINE": "TLine", "INVENTRY": "Inventory", "INVENTORY": "Inventory",
    "DECOM": "Decom", "LOWER YD": "Other",
}


def canonical_trade(raw):
    """Return a canonical trade name, '' for blank, or 'Other' for unknown codes."""
    s = (raw or "").strip()
    if not s:
        return ""
    return _VARIANTS.get(s.upper(), "Other")


def excel_serial_to_iso(v):
    """Excel 1900-system serial -> ISO date. Blank/invalid -> ''."""
    s = str(v if v is not None else "").strip()
    if not s:
        return ""
    try:
        n = int(float(s))
    except ValueError:
        return ""
    if n <= 0:
        return ""
    base = date(1899, 12, 30)  # standard offset that also absorbs Excel's 1900 leap-year bug
    try:
        return (base + timedelta(days=n)).isoformat()
    except (OverflowError, ValueError):
        return ""


def split_branch(bp):
    """'36620001013 - NEER Grant County Slr, WI' -> ('36620001013', 'NEER Grant County Slr, WI')."""
    s = (bp or "").strip()
    if " - " in s:
        code, name = s.split(" - ", 1)
        return code.strip(), name.strip()
    return (s, "") if s else ("", "")
