"""Build the app's Pixelify Sans files: the upstream font plus a few glyphs it lacks.

Pixelify Sans (SIL OFL 1.1, no Reserved Font Name) has no rupee sign or arrows, and a
payments app shows "₹" on nearly every screen. Rather than fall back to another font
mid-word, we draw the missing glyphs on the font's own pixel grid and add them.

    yarn add -D @expo-google-fonts/pixelify-sans@0.4.2   # the upstream files
    pip install fonttools
    python scripts/build-fonts.py      # writes assets/fonts/PixelifySans-*.ttf

The output is committed, so the app build doesn't need Python.
"""
from pathlib import Path

from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "node_modules/@expo-google-fonts/pixelify-sans"
OUT = ROOT / "assets/fonts"
WEIGHTS = ["400Regular", "500Medium", "600SemiBold", "700Bold"]

# Each glyph is drawn on a grid of cells, top row first, spanning the font's digit width
# (x=61 to x=536 on a 1000-unit em). The rupee sign fills baseline to cap height like the
# digits; arrows use square cells centred on the lowercase body, like the font's own symbols.
RIGHT_ARROW = ["...#...", "....#..", ".....#.", "#######", ".....#.", "....#..", "...#..."]
UP_ARROW = ["...#...", "..###..", ".#.#.#.", "#..#..#", "...#...", "...#...", "...#..."]
GLYPHS = {
    0x20B9: ("uni20B9", "cap", [  # ₹
        "#####",
        "...#.",
        "#####",
        "###..",
        ".##..",
        "..##.",
        "...##",
    ]),
    0x2192: ("arrowright", "body", RIGHT_ARROW),
    0x2190: ("arrowleft", "body", [r[::-1] for r in RIGHT_ARROW]),
    0x2191: ("arrowup", "body", UP_ARROW),
    0x2193: ("arrowdown", "body", UP_ARROW[::-1]),
}
LEFT, RIGHT, BASE, CAP, BODY_MIDDLE = 61, 536, -11, 636, 300
ADVANCE = 597


def draw(rows: list[str], fit: str):
    cols = len(rows[0])
    cell_w = (RIGHT - LEFT) / cols
    if fit == "cap":
        cell_h, top = (CAP - BASE) / len(rows), CAP
    else:
        cell_h = cell_w
        top = BODY_MIDDLE + cell_h * len(rows) / 2
    pen = TTGlyphPen(None)
    for r, row in enumerate(rows):
        y1 = round(top - r * cell_h)
        y0 = round(top - (r + 1) * cell_h) - 1  # 1 unit of overlap: no hairline seams between rows
        c = 0
        while c < cols:
            if row[c] != "#":
                c += 1
                continue
            start = c
            while c < cols and row[c] == "#":
                c += 1
            x0, x1 = round(LEFT + start * cell_w), round(LEFT + c * cell_w)
            # Clockwise, as TrueType expects for filled contours.
            pen.moveTo((x0, y0))
            pen.lineTo((x0, y1))
            pen.lineTo((x1, y1))
            pen.lineTo((x1, y0))
            pen.closePath()
    return pen.glyph()


def build(weight: str) -> Path:
    name = f"PixelifySans_{weight}"
    font = TTFont(SRC / weight / f"{name}.ttf")
    order = font.getGlyphOrder()
    for code, (glyph_name, fit, rows) in GLYPHS.items():
        if glyph_name not in font["glyf"].glyphs:
            order.append(glyph_name)
        font["glyf"][glyph_name] = draw(rows, fit)
        font["hmtx"][glyph_name] = (ADVANCE, LEFT)
        for table in font["cmap"].tables:
            if table.isUnicode():
                table.cmap[code] = glyph_name
    font.setGlyphOrder(order)
    out = OUT / f"PixelifySans-{weight}.ttf"
    OUT.mkdir(parents=True, exist_ok=True)
    font.save(out)
    return out


if __name__ == "__main__":
    for w in WEIGHTS:
        print("wrote", build(w).relative_to(ROOT))
