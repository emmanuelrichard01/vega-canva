"""
Generate display-sized brand derivatives from the master artwork.

The masters are print-scale: LOGOMARK.png is 3580px wide and ~94KB, and it was
being drawn at 26px in the app header. The favicon is a 762KB SVG. Neither is
wrong as a master; both are wrong as something every page downloads.

Originals are left untouched — they stay the source of truth, and this script
can be re-run against them whenever they change.
"""
import io
import os
from PIL import Image

SRC = 'apps/frontend/public'
OUT = os.path.join(SRC, 'brand')
os.makedirs(OUT, exist_ok=True)

# Height in CSS pixels the piece is actually drawn at, doubled for retina.
# Nothing here is rendered above ~64px in the interface today; the full logo
# gets more headroom because it is the one piece a marketing surface would use.
SIZES = {
    'LOGOMARK.png': ('mark', 128),
    'WORDMARK.png': ('wordmark', 96),
    'FULL-LOGO.png': ('full', 256),
}

report = []
for variant_dir, suffix in (('VEGA LOGO LIGHT', 'light'), ('VEGA LOGO DARK', 'dark')):
    for filename, (stem, target_h) in SIZES.items():
        src_path = os.path.join(SRC, variant_dir, filename)
        im = Image.open(src_path).convert('RGBA')
        before = os.path.getsize(src_path)

        # Crop fully transparent margins. The masters are padded for layout in
        # a design tool, and that padding becomes dead space inside every box
        # the logo is placed in — the mark reads smaller than its container
        # implies and cannot be aligned against anything.
        bbox = im.getbbox()
        if bbox:
            im = im.crop(bbox)

        w, h = im.size
        target_w = max(1, round(w * (target_h / h)))
        im = im.resize((target_w, target_h), Image.LANCZOS)

        out_path = os.path.join(OUT, f'{stem}-{suffix}.png')
        im.save(out_path, 'PNG', optimize=True)
        after = os.path.getsize(out_path)
        report.append(f'{stem}-{suffix}.png  {target_w}x{target_h}  {before/1024:.0f}KB -> {after/1024:.1f}KB')

# A small, honest favicon from the light mark — the one that reads on the
# browser's own chrome, which is light far more often than not.
fav = Image.open(os.path.join(SRC, 'VEGA LOGO LIGHT', 'LOGOMARK.png')).convert('RGBA')
bbox = fav.getbbox()
if bbox:
    fav = fav.crop(bbox)
# Square canvas with the mark centred, so it is not stretched into the tile.
side = max(fav.size)
square = Image.new('RGBA', (side, side), (0, 0, 0, 0))
square.paste(fav, ((side - fav.size[0]) // 2, (side - fav.size[1]) // 2), fav)
square.resize((64, 64), Image.LANCZOS).save(os.path.join(OUT, 'favicon-64.png'), 'PNG', optimize=True)
report.append(f"favicon-64.png  64x64  {os.path.getsize(os.path.join(OUT,'favicon-64.png'))/1024:.1f}KB")

print('\n'.join(report))
