"""Erzeugt die Beispielmotive (prozedural, frei verwendbar).

    python examples/make_motifs.py
"""

from pathlib import Path

import numpy as np
from PIL import Image

OUT = Path(__file__).resolve().parent / "motive"


def smooth_noise(shape, cells, seed):
    rng = np.random.default_rng(seed)
    small = rng.random((cells, cells)).astype(np.float32)
    img = Image.fromarray((small * 255).astype(np.uint8)).resize(shape[::-1], Image.BICUBIC)
    return np.asarray(img, np.float32) / 255.0


def gradient_map(v, stops):
    """v in 0..1 -> Farbe entlang der Stützstellen [(pos, (r,g,b)), ...]."""
    pos = np.array([p for p, _ in stops])
    cols = np.array([c for _, c in stops], np.float32) / 255
    return np.stack([np.interp(v, pos, cols[:, k]) for k in range(3)], -1)


def flowing_stripes(n=1500):
    """Symmetrische, fließende Streifen in Schwarz/Braun/Gold/Creme."""
    y, x = np.mgrid[0:n, 0:n].astype(np.float32) / n
    xs = np.abs(x - 0.5)                       # spiegelsymmetrisch
    warp = smooth_noise((n, n), 6, 3) * 0.25 + smooth_noise((n, n), 14, 4) * 0.05
    phase = 9 * (xs * 1.6 + 0.35 * np.sin(y * 7 + xs * 4) + warp) + 5 * y
    stripe = 0.5 + 0.5 * np.sin(phase * 2 * np.pi / 2.2)
    # weiche Kanten, aber klare Streifen
    stripe = np.clip((stripe - 0.35) / 0.3, 0, 1)
    stripe = stripe * stripe * (3 - 2 * stripe)
    # Licht von oben links: Verlauf über jeden Streifen
    shade = 0.5 + 0.5 * np.cos(phase * 2 * np.pi / 2.2 + 0.9)
    v = np.clip(stripe * (0.55 + 0.6 * shade), 0, 1) ** 0.8
    vignette = 1 - 0.25 * np.clip(np.hypot(x - 0.5, y - 0.5) * 1.6, 0, 1)
    v = v * vignette
    rgb = gradient_map(v, [(0.0, (12, 9, 6)), (0.25, (70, 38, 16)), (0.5, (176, 110, 36)),
                           (0.72, (226, 172, 70)), (1.0, (246, 238, 220))])
    return Image.fromarray((rgb * 255).astype(np.uint8))


def mountain_clock(n=1500):
    """Bergpanorama mit Sonne in Blau/Rot/Weiß (für die runde Uhr)."""
    y, x = np.mgrid[0:n, 0:n].astype(np.float32) / n
    sky = gradient_map(y, [(0.0, (14, 30, 72)), (0.45, (52, 98, 170)), (0.62, (190, 205, 230))])
    img = sky.copy()
    # Sonne mit Ringen
    r = np.hypot(x - 0.5, y - 0.42)
    sun_col = np.array([200, 40, 45], np.float32) / 255
    rings = (r < 0.13) | ((r > 0.16) & (r < 0.175)) | ((r > 0.20) & (r < 0.21))
    img[rings] = sun_col
    # drei Bergketten mit spitzen Gipfeln, vorne dunkler
    xx = x[0]
    for k, (base, amp, col, snow) in enumerate([(0.60, 0.22, (70, 100, 150), True),
                                                (0.70, 0.17, (34, 58, 105), True),
                                                (0.82, 0.08, (14, 24, 52), False)]):
        freq = 2.2 + 1.3 * k
        tri = 1 - np.abs(((xx * freq + 0.37 * k) % 1.0) * 2 - 1)      # Dreieckswelle = Gipfel
        rough = smooth_noise((1, n), 40, 20 + k)[0] - 0.5
        height = np.clip(tri ** 1.4 + 0.25 * rough, 0, None)
        ridge = base - amp * height
        below = y >= ridge[None, :]
        img[below] = np.array(col, np.float32) / 255
        if snow:
            snowline = base - amp * 0.62
            cap = below & (y < snowline + 0.02 * smooth_noise((n, n), 30, 30 + k))
            img[cap] = np.array([240, 242, 246], np.float32) / 255
    return Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8))


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    flowing_stripes().save(OUT / "streifen_gold.png")
    mountain_clock().save(OUT / "berge_uhr.png")
    print("Motive gespeichert in", OUT)
