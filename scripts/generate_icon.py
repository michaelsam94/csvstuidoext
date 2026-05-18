"""Generate CSV Studio marketplace icon (vector SVG + raster PNG).

Run from extension root:
  python3 scripts/generate_icon.py
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

# Brand palette — emerald / teal (data / spreadsheet)
BG_A = "#0f766e"
BG_B = "#2dd4bf"
CARD = "#f8fffe"
CARD_SHADOW = "#99f6e4"
HEADER = "#047857"
GRID = "#a7f3d0"
CELL_A = "#10b981"
CELL_B = "#34d399"
ACCENT = "#065f46"
FOLD = "#ccfbf1"


def make_svg() -> str:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128" role="img" aria-label="CSV Studio">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="{BG_A}"/>
      <stop offset="100%" stop-color="{BG_B}"/>
    </linearGradient>
    <linearGradient id="headerGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="{HEADER}"/>
      <stop offset="100%" stop-color="{ACCENT}"/>
    </linearGradient>
    <filter id="shadow" x="-8%" y="-8%" width="116%" height="116%">
      <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="{ACCENT}" flood-opacity="0.25"/>
    </filter>
  </defs>

  <!-- Background -->
  <rect width="128" height="128" rx="24" fill="url(#bg)"/>

  <!-- Document card -->
  <g filter="url(#shadow)">
    <rect x="22" y="18" width="76" height="88" rx="8" fill="{CARD}"/>
    <path d="M 86 18 L 98 30 L 98 18 Z" fill="{FOLD}"/>
    <path d="M 86 18 L 98 30 L 86 30 Z" fill="{CARD_SHADOW}" opacity="0.6"/>
  </g>

  <!-- Spreadsheet grid (vector) -->
  <g transform="translate(30, 34)">
    <!-- Header row -->
    <rect x="0" y="0" width="60" height="14" rx="2" fill="url(#headerGrad)"/>
    <line x1="20" y1="0" x2="20" y2="56" stroke="{GRID}" stroke-width="1.5"/>
    <line x1="40" y1="0" x2="40" y2="56" stroke="{GRID}" stroke-width="1.5"/>
    <line x1="0" y1="14" x2="60" y2="14" stroke="{GRID}" stroke-width="1.5"/>

    <!-- Row dividers -->
    <line x1="0" y1="28" x2="60" y2="28" stroke="{GRID}" stroke-width="1.2"/>
    <line x1="0" y1="42" x2="60" y2="42" stroke="{GRID}" stroke-width="1.2"/>

    <!-- Data cells -->
    <rect x="2" y="16" width="16" height="10" rx="1.5" fill="{CELL_A}" opacity="0.9"/>
    <rect x="22" y="16" width="16" height="10" rx="1.5" fill="{CELL_B}" opacity="0.85"/>
    <rect x="42" y="16" width="16" height="10" rx="1.5" fill="{CELL_A}" opacity="0.75"/>

    <rect x="2" y="30" width="16" height="10" rx="1.5" fill="{CELL_B}" opacity="0.8"/>
    <rect x="22" y="30" width="16" height="10" rx="1.5" fill="{CELL_A}" opacity="0.7"/>
    <rect x="42" y="30" width="16" height="10" rx="1.5" fill="{CELL_B}" opacity="0.75"/>

    <rect x="2" y="44" width="16" height="10" rx="1.5" fill="{CELL_A}" opacity="0.65"/>
    <rect x="22" y="44" width="36" height="10" rx="1.5" fill="{CELL_B}" opacity="0.6"/>

    <!-- Row index column hint -->
    <rect x="-8" y="16" width="6" height="38" rx="1" fill="{GRID}" opacity="0.55"/>
    <circle cx="-5" cy="21" r="1.2" fill="{ACCENT}" opacity="0.5"/>
    <circle cx="-5" cy="35" r="1.2" fill="{ACCENT}" opacity="0.5"/>
    <circle cx="-5" cy="49" r="1.2" fill="{ACCENT}" opacity="0.5"/>
  </g>

  <!-- Comma accent (CSV) -->
  <text x="94" y="108" font-family="ui-sans-serif, system-ui, sans-serif" font-size="22" font-weight="700"
        fill="{CARD}" opacity="0.95">,</text>
</svg>
"""


def chunk(tag: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(tag + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)


def to_png(width: int, height: int, rgba_bytes: bytes) -> bytes:
    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)
        row_start = y * stride
        raw.extend(rgba_bytes[row_start : row_start + stride])

    header = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw), level=9)
    return header + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def blend(a: int, b: int, t: float) -> int:
    return int(a + (b - a) * t)


def hex_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def make_icon_png(size: int = 128) -> bytes:
    """Rasterize the icon design to PNG (stdlib only, matches SVG layout)."""
    pixels = bytearray(size * size * 4)
    bg0 = hex_rgb(BG_A)
    bg1 = hex_rgb(BG_B)

    for y in range(size):
        for x in range(size):
            i = (y * size + x) * 4
            t = (x + y) / (2 * (size - 1))
            r = blend(bg0[0], bg1[0], t)
            g = blend(bg0[1], bg1[1], t)
            b = blend(bg0[2], bg1[2], t)
            pixels[i : i + 4] = bytes((r, g, b, 255))

    card = hex_rgb(CARD)
    px0, py0, px1, py1 = 22, 18, 98, 106
    for y in range(py0, py1):
        for x in range(px0, px1):
            i = (y * size + x) * 4
            pixels[i : i + 4] = bytes((*card, 255))

    # Folded corner
    fold = hex_rgb(FOLD)
    for y in range(18, 32):
        for x in range(86, 98):
            if x - 86 >= y - 18:
                i = (y * size + x) * 4
                pixels[i : i + 4] = bytes((*fold, 255))

    def put_rect(x0: int, y0: int, w: int, h: int, color: tuple[int, int, int, int]) -> None:
        for yy in range(y0, y0 + h):
            for xx in range(x0, x0 + w):
                if 0 <= xx < size and 0 <= yy < size:
                    i2 = (yy * size + xx) * 4
                    pixels[i2 : i2 + 4] = bytes(color)

    header_c = (*hex_rgb(HEADER), 255)
    cell_a = (*hex_rgb(CELL_A), 255)
    cell_b = (*hex_rgb(CELL_B), 255)
    grid_c = (*hex_rgb(GRID), 255)

    # Header row
    put_rect(30, 34, 60, 14, header_c)
    # Vertical grid lines
    put_rect(49, 34, 2, 56, grid_c)
    put_rect(69, 34, 2, 56, grid_c)
    put_rect(30, 47, 60, 2, grid_c)
    put_rect(30, 61, 60, 2, grid_c)

    # Cells
    put_rect(32, 50, 16, 10, cell_a)
    put_rect(52, 50, 16, 10, cell_b)
    put_rect(72, 50, 16, 10, cell_a)
    put_rect(32, 64, 16, 10, cell_b)
    put_rect(52, 64, 16, 10, cell_a)
    put_rect(72, 64, 16, 10, cell_b)
    put_rect(32, 78, 16, 10, cell_a)
    put_rect(52, 78, 36, 10, cell_b)

    # Row index strip
    put_rect(22, 50, 6, 38, grid_c)

    # Comma accent
    accent = hex_rgb(CARD)
    for y in range(96, 112):
        for x in range(90, 102):
            if (x - 94) ** 2 + (y - 104) ** 2 < 36:
                i = (y * size + x) * 4
                pixels[i : i + 4] = bytes((*accent, 255))

    return to_png(size, size, bytes(pixels))


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    svg_path = root / "icon.svg"
    png_path = root / "icon.png"

    svg_path.write_text(make_svg(), encoding="utf-8")
    png_path.write_bytes(make_icon_png(128))

    print(f"generated {svg_path.resolve()}")
    print(f"generated {png_path.resolve()}")


if __name__ == "__main__":
    main()
