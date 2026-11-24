"""Farbanalyse: welche Farben das Bild enthält und wie viel Fläche jedes Filament prägt."""

from __future__ import annotations

from typing import List, Sequence, Tuple

import numpy as np
from PIL import Image

from .colormatch import srgb_to_lab
from .colorplan import ColorPlan
from .filaments import Filament, hex_to_rgb, rgb_to_hex
from .heightmap import HeightMap


def image_palette(img: Image.Image, n: int = 8, max_side: int = 300) -> List[Tuple[str, float]]:
    """Hauptfarben des Bildes mit Flächenanteil (absteigend)."""
    small = img.convert("RGB")
    small.thumbnail((max_side, max_side))
    q = small.quantize(colors=n, method=Image.Quantize.MEDIANCUT)
    pal = q.getpalette()[: 3 * n]
    counts = np.bincount(np.asarray(q).ravel(), minlength=n)[:n]
    total = counts.sum() or 1
    out = []
    for i in np.argsort(-counts):
        if counts[i] == 0:
            continue
        rgb = np.array(pal[3 * i:3 * i + 3], np.float32) / 255
        out.append((rgb_to_hex(rgb), float(counts[i] / total)))
    return out


def nearest_filament(color: str, filaments: Sequence[Filament]) -> Tuple[Filament | None, float]:
    if not filaments:
        return None, 0.0
    lab = srgb_to_lab(hex_to_rgb(color)[None])[0]
    labs = srgb_to_lab(np.array([f.rgb for f in filaments]))
    d = np.sqrt(((labs - lab) ** 2).sum(1))
    i = int(d.argmin())
    return filaments[i], float(d[i])


def filament_usage(hm: HeightMap, plan: ColorPlan):
    """Je Filament: Anteil der Bildfläche, deren oberste Schicht aus diesem Filament ist,
    sowie Anzahl Schichten. Liste von (Filament, Anteil, erste, letzte Schicht)."""
    h = hm.heights
    if hm.border_px:
        b = hm.border_px
        h = h[b:-b, b:-b]
    segs = plan.segments(hm.base_layer_mm, hm.layer_height_mm, max(hm.layer_count, 1))
    total = h.size or 1
    out = []
    eps = 1e-4
    for fil, z0, z1, first, last in segs:
        share = float(((h > z0 + eps) & (h <= z1 + eps)).sum() / total)
        out.append((fil, share, first, last))
    return out


def is_chromatic(f: Filament, threshold: float = 15.0) -> bool:
    """Bunt (nicht Weiß/Grau/Schwarz)? Chroma im Lab-Farbraum."""
    lab = srgb_to_lab(f.rgb[None])[0]
    return float(np.hypot(lab[1], lab[2])) > threshold
