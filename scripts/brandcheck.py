#!/usr/bin/env python3
"""Blattner brand gate for HTML artifacts (blattner-data-vis plugin self-check).

Verifies: no rgba()/rgb(), no gradients, no external font imports, Arial-only
font stacks, every hex on-palette (after stripping the inlined logo <svg>),
exactly one inlined logo <svg> that hash-matches the official Blattner Burst-B
white logo asset, and that any additional inlined <svg> is a chart element
(carries class="chart") whose colors are still palette-checked.

Usage: py scripts/brandcheck.py index.html /path/to/Blattner_B_Burst_B_-_White.svg
"""
import re, sys, hashlib

ALLOWED = {"#000000","#02568A","#2DA2DB","#B9E5FB","#F2F2F2","#BCBCBC",
           "#76777B","#333333","#FFFFFF","#EC9522","#C9DB30"}
FONT_OK = re.compile(r"^(?:'Arial Black', Arial, sans-serif|Arial, Helvetica, sans-serif)$")

def fail(msg):
    print("BRAND FAIL:", msg); sys.exit(1)

def sig(svg_text):
    return hashlib.sha256(re.sub(r"\s+", "", svg_text).encode()).hexdigest()

def main():
    html_path, logo_path = sys.argv[1], sys.argv[2]
    src = open(html_path, encoding="utf-8").read()

    if re.search(r"rgba?\(", src): fail("rgba()/rgb() present")
    if re.search(r"gradient\(", src): fail("gradient present")
    if re.search(r"fonts\.googleapis|@import url", src): fail("external font import")

    fonts = sorted(set(m.strip() for m in re.findall(r"font-family:\s*([^;}]+)", src)))
    for f in fonts:
        if not FONT_OK.match(f.strip()):
            fail(f"non-Arial font-family: {f!r}")
    print("fonts:", fonts)

    # Load the official logo signature.
    logo_src = open(logo_path, encoding="utf-8").read()
    logo_svg = re.search(r"<svg.*?</svg>", logo_src, flags=re.DOTALL).group(0)
    logo_sig = sig(logo_svg)

    # Classify every inlined svg: exactly one must be the logo; the rest must be
    # explicitly-tagged chart elements (class="chart").
    svgs = re.findall(r"<svg.*?</svg>", src, flags=re.DOTALL)
    logo_svgs = [s for s in svgs if sig(s) == logo_sig]
    other_svgs = [s for s in svgs if sig(s) != logo_sig]
    if len(logo_svgs) != 1:
        fail(f"expected exactly 1 logo <svg> (hash-matched), found {len(logo_svgs)}")
    for s in other_svgs:
        if not re.search(r'class="[^"]*\bchart\b[^"]*"', s):
            fail('non-logo <svg> must carry class="chart" (chart/meter elements only)')
    print(f"logo hash-match: OK ({len(other_svgs)} chart svg(s) allowed)")

    # Strip only the logo svg for the palette check, so chart-svg colors are
    # still validated against the palette.
    stripped = src.replace(logo_svgs[0], "", 1)
    hexes = sorted({h.upper() for h in re.findall(r"#[0-9A-Fa-f]{3,8}", stripped)})
    bad = [h for h in hexes if h not in ALLOWED]
    print("hex (post-strip):", hexes)
    if bad: fail(f"off-palette hex: {bad}")

    print("BRAND OK")

if __name__ == "__main__":
    main()
