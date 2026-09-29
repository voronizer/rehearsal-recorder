"""
Turns the app's icon drawings into the files each system reads:

    python packaging/make_icons.py

  packaging/icon.ico     Windows: the .exe, the taskbar, Explorer
  packaging/icon.icns    macOS: the .app in Finder and the Dock
  ui/public/favicon.svg  the browser tab, and the logo in the setup header
  ui/public/logo.svg     the logo on the screen shown while the app starts

There are two drawings. icon.svg is the icon; icon-small.svg is the same
thing for 32 px and under, where the full one's waveform is thinner than a
pixel and a title bar showed a red smudge: no tile, three bars on whole
pixels of a 16 px grid.

Run it after changing either, and commit what it writes: the build reads the
files, not the drawings, so building needs nothing this does.

The drawing is rasterised by the Chromium that Playwright brings for the
interface tests, not by an image library: none is otherwise needed, and a
browser draws an SVG the way a browser shows it. Both .ico and .icns can hold
PNG images as they are, so writing them takes no more than their headers.
"""

import re
import shutil
import struct
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
FULL = HERE / "icon.svg"
SMALL = HERE / "icon-small.svg"

# Up to here the small drawing is used; above it, the full one.
SMALL_UP_TO = 32

# Every size Windows asks an .ico for: the taskbar and title bar at each
# display scale, Explorer's views up to its largest.
ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]

# macOS keeps each size under a four-letter kind; the @2x ones are the same
# picture at twice the pixels, for a Retina screen.
ICNS_KINDS = [
    (b"icp4", 16), (b"icp5", 32), (b"icp6", 64), (b"ic07", 128),
    (b"ic08", 256), (b"ic09", 512), (b"ic10", 1024),
    (b"ic11", 32), (b"ic12", 64), (b"ic13", 256), (b"ic14", 512),
]


def drawing_for(size):
    """Which drawing a picture this many pixels across is made from."""
    return SMALL if size <= SMALL_UP_TO else FULL


def render(sizes):
    """The icon as a PNG at each size, from the drawing for that size, with
    the corners left transparent."""
    # Only needed to draw, so the rest of this file can be imported without
    # a browser — the suites read drawing_for.
    from playwright.sync_api import sync_playwright

    out = {}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for size in sorted(set(sizes)):
            page = browser.new_page(viewport={"width": size, "height": size},
                                    device_scale_factor=1)
            svg = drawing_for(size).read_text(encoding="utf-8")
            # The drawing's own width and height, whatever they are, become
            # this size; its viewBox keeps the proportions.
            sized = re.sub(r'width="\d+" height="\d+"',
                           f'width="{size}" height="{size}"', svg, count=1)
            page.set_content(
                "<html><body style='margin:0;background:transparent'>"
                f"{sized}</body></html>")
            out[size] = page.screenshot(omit_background=True,
                                        clip={"x": 0, "y": 0,
                                              "width": size, "height": size})
            page.close()
        browser.close()
    return out


def write_ico(path, pngs):
    """An .ico of PNG images: a header, one entry per size, then the images."""
    sizes = sorted(pngs)
    header = struct.pack("<HHH", 0, 1, len(sizes))
    offset = len(header) + 16 * len(sizes)
    entries, images = b"", b""
    for size in sizes:
        data = pngs[size]
        # One byte each for width and height, where 0 means 256.
        side = 0 if size >= 256 else size
        entries += struct.pack("<BBBBHHII", side, side, 0, 0, 1, 32,
                               len(data), offset + len(images))
        images += data
    path.write_bytes(header + entries + images)


def write_icns(path, pngs):
    """An .icns of PNG images: 'icns', the file's length, then each kind."""
    body = b"".join(kind + struct.pack(">I", 8 + len(pngs[size])) + pngs[size]
                    for kind, size in ICNS_KINDS)
    path.write_bytes(b"icns" + struct.pack(">I", 8 + len(body)) + body)


def main():
    pngs = render(ICO_SIZES + [size for _, size in ICNS_KINDS])
    write_ico(HERE / "icon.ico", {s: pngs[s] for s in ICO_SIZES})
    write_icns(HERE / "icon.icns", pngs)
    # A browser tab shows the favicon at 16 px, and the setup screen's header
    # the same at 24; the loading screen shows the logo large.
    public = HERE.parent / "ui" / "public"
    shutil.copyfile(SMALL, public / "favicon.svg")
    shutil.copyfile(FULL, public / "logo.svg")
    for name in ("icon.ico", "icon.icns"):
        print(f"  {name}: {(HERE / name).stat().st_size} bytes")
    print("  ui/public/favicon.svg, ui/public/logo.svg")
    return 0


if __name__ == "__main__":
    sys.exit(main())
