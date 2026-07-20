"""Generate a tiny DEFLATE-compressed .xlsx Req fixture with two sheets
("Contact & Delivery Information" + "JDE Import") to exercise the in-browser
xlsx parser (which inflates via DecompressionStream). Includes a Unit Cost
column to verify the parser excludes it.

Usage: py build/tests/make_req_fixture.py
"""
import os
import zipfile

# Sheet 1: label in col B, value in col C (matches the real Req layout).
CONTACT = [
    ["", "Project Name:", "High Spring"],
    ["", "Project #", "36620001127"],
    ["", "Ship To:", "18572 W. 133rd St. S Council Hill, OK 74428"],
    ["", "Requisitioner:", "EE # 36536483"],
    ["", "Phone:", "320-459-1122"],
    ["", "Description:", "Hydrovac"],
    ["", "Date:", ("n", "46156")],
]
# Sheet 2: JDE Import (header + 2 data rows). Unit Cost present to be ignored.
JDE = [
    ["Line #", "Account Number", "Description 1", "Description 2", "Report Code",
     "Item Number", "Quantity Ordered", "Tr. UoM", "Unit Cost", "Required Date", "Call-off Date"],
    [("n", "1"), "36620001127.591100.02015241", "spray foam gun", "", "MRO",
     "", ("n", "5"), "EA", ("n", "12.5"), ("n", "46226"), ("n", "46584")],
    [("n", "2"), "36620001127.591100.02015241", "18in zip ties", "heavy duty", "MRO",
     "", ("n", "5000"), "BX", ("n", "0.1"), ("n", "46226"), ("n", "46584")],
]
SHEETS = [("Contact & Delivery Information", CONTACT), ("JDE Import", JDE)]


def col_letter(i):
    s = ""; i += 1
    while i:
        i, r = divmod(i - 1, 26); s = chr(65 + r) + s
    return s


def xml_escape(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def cell_kind(c):
    if isinstance(c, tuple):
        return c[0], c[1]
    return ("s", c) if str(c) != "" else ("", "")


def main():
    here = os.path.dirname(__file__)
    out = os.path.join(here, "fixtures", "req_mini.xlsx")
    os.makedirs(os.path.dirname(out), exist_ok=True)

    strings, sidx = [], {}
    for _, rows in SHEETS:
        for row in rows:
            for c in row:
                k, v = cell_kind(c)
                if k == "s" and v not in sidx:
                    sidx[v] = len(strings); strings.append(v)

    shared_xml = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="%d" uniqueCount="%d">'
        % (len(strings), len(strings))
        + "".join('<si><t xml:space="preserve">%s</t></si>' % xml_escape(s) for s in strings)
        + "</sst>")

    def sheet_xml(rows):
        rx = []
        for r, row in enumerate(rows, start=1):
            cx = []
            for cidx, c in enumerate(row):
                k, v = cell_kind(c)
                if k == "": continue
                ref = col_letter(cidx) + str(r)
                if k == "s":
                    cx.append('<c r="%s" t="s"><v>%d</v></c>' % (ref, sidx[v]))
                else:
                    cx.append('<c r="%s"><v>%s</v></c>' % (ref, v))
            rx.append('<row r="%d">%s</row>' % (r, "".join(cx)))
        return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                '<sheetData>' + "".join(rx) + '</sheetData></worksheet>')

    content_types = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
        '</Types>')
    root_rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        '</Relationships>')
    workbook = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
        '<sheet name="Contact &amp; Delivery Information" sheetId="1" r:id="rId1"/>'
        '<sheet name="JDE Import" sheetId="2" r:id="rId2"/>'
        '</sheets></workbook>')
    wb_rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>'
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>'
        '</Relationships>')

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", content_types)
        z.writestr("_rels/.rels", root_rels)
        z.writestr("xl/workbook.xml", workbook)
        z.writestr("xl/_rels/workbook.xml.rels", wb_rels)
        z.writestr("xl/sharedStrings.xml", shared_xml)
        z.writestr("xl/worksheets/sheet1.xml", sheet_xml(CONTACT))
        z.writestr("xl/worksheets/sheet2.xml", sheet_xml(JDE))
    print("wrote", out)


if __name__ == "__main__":
    main()
