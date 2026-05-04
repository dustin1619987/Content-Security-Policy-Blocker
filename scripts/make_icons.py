"""Generate toolbar icons for the extension.

Creates a stylized shield in two states:
- "on"  : red shield (CSP currently DISABLED by extension)
- "off" : gray shield (CSP currently ENABLED, extension idle)
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "icons"
OUT.mkdir(parents=True, exist_ok=True)

SIZES = (16, 32, 48, 128)

# Colors
ON_FILL = (217, 48, 37, 255)        # red
ON_OUTLINE = (140, 25, 20, 255)
OFF_FILL = (140, 140, 140, 255)     # gray
OFF_OUTLINE = (90, 90, 90, 255)
WHITE = (255, 255, 255, 255)


def shield_polygon(size: int):
    """Return shield-shaped polygon points scaled to ``size``."""
    s = size
    pad = s * 0.10
    w = s - 2 * pad
    cx = s / 2
    top = pad
    shoulder = pad + w * 0.18
    bottom = s - pad
    left = pad
    right = s - pad
    mid_y = top + w * 0.55
    return [
        (cx, top),
        (right, shoulder),
        (right, mid_y),
        (cx, bottom),
        (left, mid_y),
        (left, shoulder),
    ]


def draw_icon(size: int, fill, outline) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pts = shield_polygon(size)
    width = max(1, size // 16)
    d.polygon(pts, fill=fill, outline=outline)
    # Re-stroke the outline so it isn't 1px on small sizes.
    d.line(pts + [pts[0]], fill=outline, width=width)

    # Diagonal slash to convey "blocked / disabled".
    pad = size * 0.22
    d.line(
        [(pad, size - pad), (size - pad, pad)],
        fill=WHITE,
        width=max(2, size // 8),
    )
    return img


def main() -> None:
    for size in SIZES:
        on_img = draw_icon(size, ON_FILL, ON_OUTLINE)
        off_img = draw_icon(size, OFF_FILL, OFF_OUTLINE)
        on_img.save(OUT / f"icon-on-{size}.png")
        off_img.save(OUT / f"icon-off-{size}.png")
    print(f"Wrote {len(SIZES) * 2} icons to {OUT}")


if __name__ == "__main__":
    main()
