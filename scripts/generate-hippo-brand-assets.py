#!/usr/bin/env python3
# pyright: reportMissingImports=false
"""Generate Hippo Wallet branding assets.

Requires Pillow and fontTools. The 16×16 indexed mark is the source of truth;
all browser icons are nearest-neighbour exports so the silhouette remains crisp.
"""
from __future__ import annotations

import base64
from pathlib import Path
import re
from typing import Iterable

from PIL import Image, ImageDraw, ImageFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
MIDNIGHT = "#111629"
SURFACE = "#262C40"
BLUE = "#0372FF"
MINT = "#26E99A"
WHITE = "#FFFFFF"
MUTED = "#9EA7B8"

# 0 background/details, 1 body, 2 tusks, 3 inner-ear accent.
PIXELS = [[0 for _ in range(16)] for _ in range(16)]
SHAPE: set[tuple[int, int]] = set()


def fill(y: int, x0: int, x1: int) -> None:
    for x in range(x0, x1 + 1):
        PIXELS[y][x] = 1
        SHAPE.add((x, y))


# Small lateral ears and a narrower brow.
fill(1, 3, 4)
fill(1, 11, 12)
fill(2, 2, 5)
fill(2, 10, 13)
fill(3, 3, 12)
fill(4, 2, 13)
fill(5, 2, 13)
fill(6, 2, 13)

# A broad, low muzzle is the defining hippo silhouette.
fill(7, 1, 14)
fill(8, 0, 15)
fill(9, 0, 15)
fill(10, 0, 15)
fill(11, 1, 14)
fill(12, 2, 13)
fill(13, 4, 11)

# Eyes, nostrils, mouth, tusks, and mint inner ears.
for xy in ((5, 5), (10, 5), (4, 9), (11, 9)):
    PIXELS[xy[1]][xy[0]] = 0
for x in range(5, 11):
    PIXELS[11][x] = 0
for xy in ((3, 11), (12, 11)):
    PIXELS[xy[1]][xy[0]] = 2
for xy in ((3, 2), (12, 2)):
    PIXELS[xy[1]][xy[0]] = 3


def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def rect_runs(cells: Iterable[tuple[int, int]]) -> str:
    by_row: dict[int, list[int]] = {}
    for x, y in cells:
        by_row.setdefault(y, []).append(x)
    rects: list[str] = []
    for y, xs in sorted(by_row.items()):
        xs = sorted(xs)
        start = end = xs[0]
        for x in xs[1:] + [999]:
            if x == end + 1:
                end = x
                continue
            rects.append(f'<rect x="{start}" y="{y}" width="{end-start+1}" height="1"/>')
            start = end = x
    return "".join(rects)


def mark_groups(body: str = BLUE, detail: str = MIDNIGHT) -> str:
    body_cells = {(x, y) for x, y in SHAPE if PIXELS[y][x] == 1}
    detail_cells = {(x, y) for x, y in SHAPE if PIXELS[y][x] == 0}
    white_cells = {(x, y) for x, y in SHAPE if PIXELS[y][x] == 2}
    mint_cells = {(x, y) for x, y in SHAPE if PIXELS[y][x] == 3}
    return (
        f'<g fill="{body}">{rect_runs(body_cells)}</g>'
        f'<g fill="{detail}">{rect_runs(detail_cells)}</g>'
        f'<g fill="{WHITE}">{rect_runs(white_cells)}</g>'
        f'<g fill="{MINT}">{rect_runs(mint_cells)}</g>'
    )


def mark_svg(width: int, height: int, *, background: bool = False,
             body: str = BLUE, detail: str = MIDNIGHT) -> str:
    bg = f'<rect width="16" height="16" fill="{MIDNIGHT}"/>' if background else ""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 16 16" shape-rendering="crispEdges">{bg}'
        f'{mark_groups(body, detail)}</svg>\n'
    )


def text_paths(text: str, *, x: float, baseline: float, size: float,
               fill_color: str) -> tuple[str, float]:
    font = TTFont(ROOT / "_raw/fonts/PixelOperator-Bold.ttf")
    glyph_set = font.getGlyphSet()
    cmap = font.getBestCmap()
    hmtx = font["hmtx"]
    scale = size / font["head"].unitsPerEm
    cursor = x
    paths: list[str] = []
    for char in text:
        glyph_name = cmap.get(ord(char), ".notdef")
        pen = SVGPathPen(glyph_set)
        glyph_set[glyph_name].draw(pen)
        command = pen.getCommands()
        if command:
            paths.append(
                f'<path d="{command}" fill="{fill_color}" '
                f'transform="translate({cursor:.3f} {baseline:.3f}) scale({scale:.6f} {-scale:.6f})"/>'
            )
        cursor += hmtx[glyph_name][0] * scale
    return "".join(paths), cursor


def wordmark_svg(width: int, height: int, *, white: bool = False,
                 background: str | None = None) -> str:
    body = WHITE if white else BLUE
    text_color = WHITE if white else MIDNIGHT
    mark_size = height - 6
    mark_x = 2
    mark_y = 3
    text_x = mark_x + mark_size + 8
    text_size = min(22.0, height * 0.48)
    baseline = height * 0.68
    paths, end = text_paths(
        "HIPPO WALLET", x=text_x, baseline=baseline,
        size=text_size, fill_color=text_color
    )
    if end > width - 2:
        factor = (width - text_x - 2) / (end - text_x)
        text_size *= factor
        paths, _ = text_paths(
            "HIPPO WALLET", x=text_x, baseline=height * 0.66,
            size=text_size, fill_color=text_color
        )
    bg = f'<rect width="{width}" height="{height}" fill="{background}"/>' if background else ""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" shape-rendering="crispEdges">{bg}'
        f'<g transform="translate({mark_x} {mark_y}) scale({mark_size/16:.6f})">'
        f'{mark_groups(body, MIDNIGHT)}</g>{paths}</svg>\n'
    )


def rgba_icon(background: bool = True) -> Image.Image:
    image = Image.new("RGBA", (16, 16), (17, 22, 41, 255) if background else (0, 0, 0, 0))
    pix = image.load()
    assert pix is not None
    colors = {
        0: (17, 22, 41, 255),
        1: (3, 114, 255, 255),
        2: (255, 255, 255, 255),
        3: (38, 233, 154, 255),
    }
    for x, y in SHAPE:
        pix[x, y] = colors[PIXELS[y][x]]
    return image


def save_png(path: Path, size: tuple[int, int], *, background: bool = True) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    rgba_icon(background).resize(size, Image.Resampling.NEAREST).save(path, optimize=True)


def themed_points_background(path: Path) -> None:
    image = Image.new("RGBA", (800, 486), (17, 22, 41, 255))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((24, 24, 776, 462), radius=28, fill=(38, 44, 64, 255), outline=(3, 114, 255, 255), width=4)
    for y in range(52, 450, 32):
        for x in range(52, 770, 32):
            if (x // 32 + y // 32) % 3 == 0:
                draw.rectangle((x, y, x + 4, y + 4), fill=(38, 233, 154, 75))
    mark = rgba_icon(False).resize((352, 352), Image.Resampling.NEAREST)
    mark.putalpha(mark.getchannel("A").point(lambda a: int(a * 0.18)))
    image.alpha_composite(mark, (424, 78))
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, optimize=True)


def welcome_start(path: Path) -> None:
    size = 1013
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    for y in range(20, size, 90):
        for x in range(10, size, 90):
            opacity = 225 if (x // 90 + y // 90) % 3 else 90
            draw.rectangle((x, y, x + 14, y + 14), fill=(255, 255, 255, opacity))
    mark = rgba_icon(False).resize((416, 416), Image.Resampling.NEAREST)
    image.alpha_composite(mark, ((size - 416) // 2, 150))
    title_font = ImageFont.truetype(ROOT / "_raw/fonts/PixelOperator-Bold.ttf", 104)
    body_font = ImageFont.truetype(ROOT / "_raw/fonts/IBMPlexMono-Bold.ttf", 39)
    draw.text((size // 2, 650), "HIPPO WALLET", font=title_font, fill=(255, 255, 255, 255), anchor="mm")
    draw.text(
        (size // 2, 805), "A PRIVATE WALLET FOR DEFI USERS",
        font=body_font, fill=(255, 255, 255, 255), anchor="mm"
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, optimize=True)


def welcome_header(path: Path) -> None:
    paths, _ = text_paths("HIPPO WALLET", x=148, baseline=65, size=27, fill_color=WHITE)
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="105" viewBox="0 0 400 105" shape-rendering="crispEdges">'
        f'<rect width="400" height="105" fill="{MIDNIGHT}"/>'
        f'<rect x="12" y="12" width="376" height="81" rx="12" fill="{SURFACE}" stroke="{BLUE}" stroke-width="2"/>'
        + ''.join(
            f'<rect x="{x}" y="{y}" width="4" height="4" fill="{MINT}" opacity=".45"/>'
            for x in range(24, 385, 30) for y in (25, 78) if (x // 30 + y) % 2
        )
        + f'<g transform="translate(73 20) scale(4)">{mark_groups(WHITE, MIDNIGHT)}</g>{paths}</svg>\n'
    )
    write(path, svg)


def guide_background(path: Path) -> None:
    pixels = ''.join(
        f'<rect x="{x}" y="{y}" width="4" height="4" fill="{BLUE}" opacity=".18"/>'
        for x in range(24, 1440, 48)
        for y in range(24, 944, 48)
        if (x // 48 + y // 48) % 3 == 0
    )
    mint_pixels = ''.join(
        f'<rect x="{x}" y="{y}" width="6" height="6" fill="{MINT}" opacity=".12"/>'
        for x, y in ((80, 96), (1310, 130), (120, 790), (1270, 820))
    )
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="944" '
        'viewBox="0 0 1440 944" shape-rendering="crispEdges">'
        f'<rect width="1440" height="944" fill="{MIDNIGHT}"/>'
        f'<path d="M0 0h300v32H32v260H0V0zm1440 0v300h-32V32h-260V0h292zM0 944V644h32v268h268v32H0zm1440 0h-300v-32h268V644h32v300z" fill="{SURFACE}"/>'
        f'{pixels}{mint_pixels}</svg>\n'
    )
    write(path, svg)


def overlay_hippo_mark(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    text = re.sub(
        r'<rect x="207" y="22" width="40" height="40" rx="20"[^>]*/>.*?<defs>',
        '<defs>',
        text,
        count=1,
        flags=re.DOTALL,
    )
    text = re.sub(
        r'<svg id="hippo-wallet-mark".*?</svg>',
        '',
        text,
        flags=re.DOTALL,
    )
    text = re.sub(
        r'<!-- HIPPO_WALLET_MARK_START -->.*?<!-- HIPPO_WALLET_MARK_END -->',
        '',
        text,
        flags=re.DOTALL,
    )
    overlay = (
        '<!-- HIPPO_WALLET_MARK_START -->'
        '<g id="hippo-wallet-mark" transform="translate(207 22) scale(2.5)">'
        f'<rect width="16" height="16" fill="{MIDNIGHT}"/>'
        f'{mark_groups(BLUE, MIDNIGHT)}</g>'
        '<!-- HIPPO_WALLET_MARK_END -->'
    )
    write(path, text.replace('</svg>', f'{overlay}</svg>'))


def main() -> None:
    sizes = (16, 19, 32, 38, 48, 64, 128, 512)
    for size in sizes:
        save_png(ROOT / f"_raw/images/icon-{size}.png", (size, size))
        if size != 512:
            save_png(ROOT / f"_raw/images/icon-lock-{size}.png", (size, size))

    save_png(ROOT / "_raw/images/rabby-site-logo.png", (320, 320))
    save_png(ROOT / "src/ui/assets/rabby-chain-logo.png", (400, 400))
    save_png(ROOT / "src/ui/assets/swap/rabby-wallet.png", (40, 40))
    themed_points_background(ROOT / "src/ui/assets/rabby-points/rabby-points-bg.png")
    welcome_start(ROOT / "src/ui/assets/welcome-start.png")
    guide_background(ROOT / "src/ui/assets/new-user-import/guide-bg.svg")

    write(ROOT / "src/ui/assets/hippo-wallet-mark.svg", mark_svg(160, 160))
    write(ROOT / "src/ui/assets/hippo-wallet-logo.svg", wordmark_svg(180, 48))
    write(ROOT / "src/ui/assets/hippo-wallet-logo-white.svg", wordmark_svg(180, 48, white=True))
    write(ROOT / "_raw/images/hippo-wallet-mark.svg", mark_svg(128, 128, background=True))
    write(ROOT / "_raw/images/welcome-image.svg", mark_svg(337, 337, background=True))
    client_icon = base64.b64encode(
        mark_svg(128, 128, background=True).encode("utf-8")
    ).decode("ascii")
    write(
        ROOT / "src/constant/hippo-brand.ts",
        "export const HIPPO_WALLET_NAME = 'Hippo Wallet';\n"
        "export const HIPPO_WALLET_RDNS = 'finance.resupply.hippo-wallet';\n"
        "export const HIPPO_WALLET_REPOSITORY =\n"
        "  'https://github.com/CWinthorpe/hippo-wallet';\n"
        "export const HIPPO_WALLET_ICON_DATA_URI =\n"
        f"  'data:image/svg+xml;base64,{client_icon}';\n",
    )

    wordmarks = {
        "src/ui/assets/logo.svg": (180, 48, False),
        "src/ui/assets/logo-rabby-large.svg": (180, 48, False),
        "src/ui/assets/slogon.svg": (180, 48, False),
        "_raw/images/logo-rabby.svg": (180, 48, False),
        "_raw/images/logo-white.svg": (180, 48, True),
    }
    for rel, (width, height, white) in wordmarks.items():
        write(ROOT / rel, wordmark_svg(width, height, white=white))

    mark_assets = {
        "src/ui/assets/new-user-import/logo.svg": (100, 100, True),
        "src/ui/assets/unlock-logo.svg": (100, 100, True),
        "src/ui/assets/unlock/rabby.svg": (160, 160, True),
        "src/ui/assets/rabby.svg": (56, 48, False),
        "src/ui/assets/rabby-logo-circle.svg": (32, 32, True),
        "src/ui/assets/icon-rabby-circle.svg": (14, 14, True),
        "src/ui/assets/sync-to-mobile/rabby-circle.svg": (48, 48, True),
        "src/ui/assets/swap/rabby.svg": (36, 30, False),
        "src/ui/assets/sign/tx/rabby.svg": (40, 40, True),
        "src/ui/assets/dashboard/rabby.svg": (20, 20, True),
        "src/ui/assets/dashboard/rabby-points-claim.svg": (148, 148, True),
        "src/ui/assets/gas-account/empty-no-rabby-fee.svg": (28, 28, False),
        "src/ui/assets/ledger/rabby.svg": (14, 14, False),
        "src/ui/assets/ledger/rabby-gray.svg": (14, 14, False),
        "src/ui/assets/badge/rabby-badge-m.svg": (120, 120, True),
        "src/ui/assets/badge/rabby-badge-l.svg": (160, 160, True),
        "src/ui/component/RateModal/icons/rabby-logo.svg": (80, 80, True),
        "src/ui/component/RateModal/icons/rabby-silhouette.svg": (60, 90, False),
    }
    for rel, (width, height, background) in mark_assets.items():
        body = MUTED if rel.endswith("rabby-gray.svg") else BLUE
        write(ROOT / rel, mark_svg(width, height, background=background, body=body))

    for relative in [
        "src/ui/assets/metamask-mode-dapps/icon-metamask-mode.svg",
        "src/ui/assets/metamask-mode-dapps/icon-metamask-mode-dark.svg",
    ]:
        overlay_hippo_mark(ROOT / relative)

    welcome_header(ROOT / "src/ui/assets/welcome-header.svg")
    print(f"Generated Hippo Wallet assets under {ROOT}")


if __name__ == "__main__":
    main()
