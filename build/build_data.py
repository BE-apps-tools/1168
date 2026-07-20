"""Build slim per-site JSON from the Equipment Master xlsx (stdlib only).

Outputs into out_dir:
  meta.json          {builtAt, sourceVersion, assetCount, siteCount}
  sites.json         [{code, name, count}]  (sorted by name)
  sites/<code>.json  [asset, ...] for that Branch/Plant
"""
import os
import re
import glob
import json
import zipfile
from xml.etree import ElementTree as ET

from .normalize import canonical_trade, excel_serial_to_iso, split_branch

M = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

# normalized header text -> asset field
HEADER_TO_FIELD = {
    "Unit Number": "unit", "Description": "description", "Description 2": "description2",
    "Serial Number": "serial", "Mfg": "mfg", "Mdl Yr": "modelYear",
    "Additional Information": "additionalInfo", "Equipment Status": "status",
    "Branch/Plant": "branchPlant", "From Date": "fromDate", "Transfer Number": "transferNumber",
    "Additional Remarks": "remarks", "Assigned Employee": "assignedEmployee",
    "Acquired Date": "acquiredDate", "Company": "company", "Location": "location",
    "Trade": "trade", "Location Code": "locationCode", "Finance Method": "financeMethod",
    "Asset Number": "assetNumber",
}
NCOLS = 20


def _norm_header(s):
    return re.sub(r"\s+", " ", (s or "").strip())


def _col_index(ref):
    letters = re.match(r"[A-Z]+", ref).group(0)
    n = 0
    for c in letters:
        n = n * 26 + (ord(c) - 64)
    return n - 1


def _read_shared(z):
    out = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).iter(M + "si"):
            out.append("".join(t.text or "" for t in si.iter(M + "t")))
    return out


def _sheet_target(z):
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rid = wb.find(M + "sheets").find(M + "sheet").get(R + "id")
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    tgt = {r.get("Id"): r.get("Target") for r in rels}[rid]
    return tgt if tgt.startswith("xl/") else "xl/" + tgt


def _rows(z, shared):
    tgt = _sheet_target(z)
    header = None
    with z.open(tgt) as f:
        for _, row in ET.iterparse(f, events=("end",)):
            if row.tag != M + "row":
                continue
            cells = {}
            for c in row.findall(M + "c"):
                ci = _col_index(c.get("r"))
                ty = c.get("t")
                val = ""
                if ty == "inlineStr":
                    isel = c.find(M + "is")
                    if isel is not None:
                        val = "".join(t.text or "" for t in isel.iter(M + "t"))
                else:
                    v = c.find(M + "v")
                    if v is not None:
                        val = v.text or ""
                        if ty == "s":
                            val = shared[int(val)]
                cells[ci] = val
            arr = [cells.get(i, "") for i in range(NCOLS)]
            if header is None:
                header = [_norm_header(x) for x in arr]
            else:
                yield header, arr
            row.clear()


def _sanitize_code(code):
    return re.sub(r"[^A-Za-z0-9_-]+", "_", code) or "UNASSIGNED"


def build(xlsx_path, out_dir):
    z = zipfile.ZipFile(xlsx_path)
    shared = _read_shared(z)
    sites = {}
    count = 0
    for header, arr in _rows(z, shared):
        rec = {}
        for i, h in enumerate(header):
            fld = HEADER_TO_FIELD.get(h)
            if fld and i < len(arr):
                rec[fld] = arr[i]
        unit = (rec.get("unit") or "").strip()
        serial = (rec.get("serial") or "").strip()
        if not unit and not serial:
            continue
        raw_trade = (rec.get("trade") or "").strip()
        code_raw, name = split_branch(rec.get("branchPlant", ""))
        code = _sanitize_code(code_raw)
        if not name and code == "UNASSIGNED":
            name = "Unassigned / No Branch"
        asset = {
            "unit": unit, "serial": serial,
            "description": (rec.get("description") or "").strip(),
            "description2": (rec.get("description2") or "").strip(),
            "mfg": (rec.get("mfg") or "").strip(),
            "modelYear": (rec.get("modelYear") or "").strip(),
            "status": (rec.get("status") or "").strip(),
            "trade": canonical_trade(raw_trade), "tradeRaw": raw_trade,
            "assignedEmployee": (rec.get("assignedEmployee") or "").strip(),
            "location": (rec.get("location") or "").strip(),
            "locationCode": (rec.get("locationCode") or "").strip(),
            "additionalInfo": (rec.get("additionalInfo") or "").strip(),
            "remarks": (rec.get("remarks") or "").strip(),
            "company": (rec.get("company") or "").strip(),
            "transferNumber": (rec.get("transferNumber") or "").strip(),
            "financeMethod": (rec.get("financeMethod") or "").strip(),
            "assetNumber": (rec.get("assetNumber") or "").strip(),
            "fromDate": excel_serial_to_iso(rec.get("fromDate", "")),
            "acquiredDate": excel_serial_to_iso(rec.get("acquiredDate", "")),
        }
        site = sites.setdefault(code, {"name": name, "assets": []})
        if name and not site["name"]:
            site["name"] = name
        site["assets"].append(asset)
        count += 1

    sites_dir = os.path.join(out_dir, "sites")
    os.makedirs(sites_dir, exist_ok=True)
    # Clear stale per-site files so sites no longer present in the source drop out
    # (e.g. when switching to a trimmed, per-site export).
    for old in glob.glob(os.path.join(sites_dir, "*.json")):
        os.remove(old)
    index = []
    for code, d in sites.items():
        with open(os.path.join(out_dir, "sites", code + ".json"), "w", encoding="utf-8") as f:
            json.dump(d["assets"], f)
        index.append({"code": code, "name": d["name"] or code, "count": len(d["assets"])})
    index.sort(key=lambda s: (s["name"] or s["code"]).lower())
    with open(os.path.join(out_dir, "sites.json"), "w", encoding="utf-8") as f:
        json.dump(index, f)

    m = re.search(r"V\d+\.\d+", os.path.basename(xlsx_path))
    meta = {
        "builtAt": os.environ.get("BUILD_TS", ""),
        "sourceVersion": m.group(0) if m else "",
        "assetCount": count,
        "siteCount": len(index),
    }
    with open(os.path.join(out_dir, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f)
    return meta


def newest_source(source_dir):
    files = glob.glob(os.path.join(source_dir, "Equipment Master*.xlsx"))
    files = [f for f in files if not os.path.basename(f).startswith("~$")]  # skip Excel lock files
    if not files:
        raise FileNotFoundError("no 'Equipment Master*.xlsx' found in " + source_dir)
    if len(files) == 1:
        return files[0]  # single file: use it regardless of version numbering

    def ver(p):
        m = re.search(r"V(\d+)\.(\d+)", os.path.basename(p))
        return (int(m.group(1)), int(m.group(2))) if m else (-1, -1)

    return max(files, key=ver)


if __name__ == "__main__":
    import sys
    src = newest_source(sys.argv[1]) if len(sys.argv) > 1 else newest_source("source")
    print(json.dumps(build(src, sys.argv[2] if len(sys.argv) > 2 else "data")))
