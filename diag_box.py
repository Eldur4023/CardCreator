"""Is art still visible through the rules textbox, or has it gone flat?

A normal card's textbox is semi-transparent, so the art underneath shows
through and the region has texture (high pixel variance). Stacking the frame
to bury old text makes it opaque, which flattens that variance to ~0.
"""
import statistics
import sys
from PIL import Image


def stats(path, x0=0.10, x1=0.85, y0=0.68, y1=0.90):
    im = Image.open(path).convert("L")
    W, H = im.size
    px = im.load()
    vals = [px[x, y]
            for y in range(int(H * y0), int(H * y1), 4)
            for x in range(int(W * x0), int(W * x1), 4)]
    # Darkest 60% only: skips the white glyphs so we measure the background.
    vals.sort()
    bg = vals[: int(len(vals) * 0.6)]
    return statistics.mean(bg), statistics.pstdev(bg)


for p in sys.argv[1:]:
    m, sd = stats(p)
    print(f"{p.split(chr(92))[-1][:36]:<38} fondo medio={m:6.1f}  textura(sd)={sd:5.1f}")
