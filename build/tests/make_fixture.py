"""Generate a tiny sharedStrings-based .xlsx fixture mirroring the Equipment
Master schema (20 columns, 2 sites, 3 data rows). Run once to (re)create
build/tests/fixtures/mini.xlsx.

Usage: py build/tests/make_fixture.py
"""
import os
import zipfile

HEADERS = ["Unit\nNumber", "Description", "Description 2", "Serial Number", "Mfg",
           "Mdl Yr", "Additional Information", "Equipment \nStatus", "Branch/Plant",
           "From Date", "Transfer Number", "Additional Remarks", "Assigned Employee",
           "Acquired Date", "Company", "Location", "Trade", "Location Code",
           "Finance Method", "Asset\nNumber"]

# Each data row: 20 cells. ("s", text) string, ("n", number) numeric, or "" empty.
ROWS = [
    [("s", "U1"), ("s", "Excavator, tracked"), ("s", "CAT 330"), ("s", "S1"), ("s", "CAT"),
     ("s", "21"), "", ("s", "WK - Working"), ("s", "SITE1 - Alpha Solar, TX"),
     ("n", "45658"), ("s", "515545"), "", ("s", "0"), ("n", "44197"),
     ("s", "00366 - Blattner Energy LLC"), "", ("s", "ELECTRIC"),
     ("s", "C - Current Location"), ("s", "O - Owned Outright"), ("s", "346128")],
    [("s", "U2"), ("s", "Generator 20kW"), "", ("s", "S2"), ("s", "MMD"),
     ("s", "23"), "", ("s", "AV - Available"), ("s", "SITE1 - Alpha Solar, TX"),
     "", ("s", "515546"), "", ("s", "0"), "",
     ("s", "00366 - Blattner Energy LLC"), "", "",
     ("s", "C - Current Location"), ("s", "O - Owned Outright"), ("s", "346129")],
    [("s", "U3"), ("s", "Total station"), "", ("s", "S3"), ("s", "TOP"),
     ("s", "22"), "", ("s", "NR - Not Ready"), ("s", "SITE2 - Beta Wind, IA"),
     "", ("s", "515547"), "", ("s", "0"), "",
     ("s", "00366 - Blattner Energy LLC"), "", ("s", "COMMISSG"),
     ("s", "C - Current Location"), ("s", "O - Owned Outright"), ("s", "346130")],
]


def col_letter(i):
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def build_shared(all_rows):
    strings, index = [], {}
    for row in all_rows:
        for cell in row:
            if isinstance(cell, tuple) and cell[0] == "s":
                if cell[1] not in index:
                    index[cell[1]] = len(strings)
                    strings.append(cell[1])
    return strings, index


def xml_escape(s):
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def main():
    here = os.path.dirname(__file__)
    out = os.path.join(here, "fixtures", "mini.xlsx")
    os.makedirs(os.path.dirname(out), exist_ok=True)

    header_row = [("s", h) for h in HEADERS]
    all_rows = [header_row] + ROWS
    strings, sidx = build_shared(all_rows)

    shared_xml = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                  '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="%d" uniqueCount="%d">'
                  % (len(strings), len(strings))
                  + "".join("<si><t xml:space=\"preserve\">%s</t></si>" % xml_escape(s) for s in strings)
                  + "</sst>")

    rows_xml = []
    for r, row in enumerate(all_rows, start=1):
        cells = []
        for c, cell in enumerate(row):
            ref = col_letter(c) + str(r)
            if cell == "" or cell is None:
                continue
            kind, val = cell
            if kind == "s":
                cells.append('<c r="%s" t="s"><v>%d</v></c>' % (ref, sidx[val]))
            else:
                cells.append('<c r="%s"><v>%s</v></c>' % (ref, val))
        rows_xml.append('<row r="%d">%s</row>' % (r, "".join(cells)))
    sheet_xml = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                 '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                 '<sheetData>' + "".join(rows_xml) + '</sheetData></worksheet>')

    content_types = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
        '</Types>')
    root_rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        '</Relationships>')
    workbook = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheets><sheet name="Equipment Master V1.3" sheetId="1" r:id="rId1"/></sheets></workbook>')
    wb_rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>'
        '</Relationships>')

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", content_types)
        z.writestr("_rels/.rels", root_rels)
        z.writestr("xl/workbook.xml", workbook)
        z.writestr("xl/_rels/workbook.xml.rels", wb_rels)
        z.writestr("xl/sharedStrings.xml", shared_xml)
        z.writestr("xl/worksheets/sheet1.xml", sheet_xml)
    print("wrote", out)


if __name__ == "__main__":
    main()
