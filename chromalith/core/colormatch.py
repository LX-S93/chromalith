"""Farbtreuer Modus: Höhe je Bildpunkt so wählen, dass die simulierte Mischfarbe
der echten Bildfarbe am nächsten kommt (statt nur nach Helligkeit).

Bei einem festen Filament-Stapel ergibt jede mögliche Höhe (Schicht) genau eine
Mischfarbe. Diese Farben bilden eine Palette; jeder Bildpunkt bekommt die Höhe mit
der ähnlichsten Palettenfarbe (Abstand im CIE-Lab-Farbraum).
"""

from __future__ import annotations

import numpy as np

from .colorplan import ColorPlan, ColorStop, simulate_colors
from .heightmap import HeightMap, layer_top_z, srgb_to_linear

_M = np.array([[0.4124564, 0.3575761, 0.1804375],
               [0.2126729, 0.7151522, 0.0721750],
               [0.0193339, 0.1191920, 0.9503041]], dtype=np.float32)
_WHITE = np.array([0.95047, 1.0, 1.08883], dtype=np.float32)


def srgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    xyz = srgb_to_linear(rgb) @ _M.T / _WHITE
    eps = 216 / 24389
    f = np.where(xyz > eps, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    L = 116 * f[..., 1] - 16
    a = 500 * (f[..., 0] - f[..., 1])
    b = 200 * (f[..., 1] - f[..., 2])
    return np.stack([L, a, b], -1).astype(np.float32)


def layer_palette(plan: ColorPlan, base: float, step: float, min_h: float, max_h: float):
    """Mögliche Höhen (quantisiert) und die zugehörigen simulierten Farben."""
    k0 = int(np.rint((min_h - base) / step)) + 1
    k1 = int(np.rint((max_h - base) / step)) + 1
    k0 = max(1, k0)
    heights = np.array([layer_top_z(k, base, step) for k in range(k0, max(k0, k1) + 1)], np.float32)
    hm = HeightMap(heights[None, :], 1.0, base, step, np.zeros((1, len(heights), 3), np.float32))
    colors = simulate_colors(hm, plan)[0]
    return heights, colors


def nearest_heights(rgb: np.ndarray, heights: np.ndarray, colors: np.ndarray,
                    chunk: int = 200_000) -> np.ndarray:
    lab = srgb_to_lab(rgb).reshape(-1, 3)
    pal = srgb_to_lab(colors)
    out = np.empty(len(lab), np.int32)
    for i in range(0, len(lab), chunk):
        d = ((lab[i:i + chunk, None, :] - pal[None, :, :]) ** 2).sum(-1)
        out[i:i + chunk] = d.argmin(1)
    return heights[out].reshape(rgb.shape[:2])


def color_error(rgb: np.ndarray, plan: ColorPlan, base, step, min_h, max_h) -> float:
    heights, colors = layer_palette(plan, base, step, min_h, max_h)
    lab = srgb_to_lab(rgb).reshape(-1, 3)
    pal = srgb_to_lab(colors)
    d = ((lab[:, None, :] - pal[None, :, :]) ** 2).sum(-1).min(1)
    return float(np.sqrt(d).mean())


def optimize_plan(rgb: np.ndarray, filaments, base, step, min_h, max_h,
                  passes: int = 3, max_side: int = 90) -> ColorPlan:
    """Sucht für die gegebene Filament-Reihenfolge die Wechsel-Schichten, bei denen
    die Bildfarben am besten getroffen werden (Koordinatenabstieg)."""
    f = max(1, int(np.ceil(max(rgb.shape[:2]) / max_side)))
    small = rgb[::f, ::f]
    k_min = max(1, int(np.rint((min_h - base) / step)) + 1)
    k_max = max(k_min + 1, int(np.rint((max_h - base) / step)) + 1)
    n = len(filaments)
    if n == 0:
        return ColorPlan()
    # Start: gleichmäßig verteilt über den Höhenbereich
    starts = [1] + [k_min + int(round(i * (k_max - k_min) / n)) for i in range(1, n)]
    for i in range(1, n):
        starts[i] = max(starts[i], starts[i - 1] + 1)

    def err(st):
        plan = ColorPlan([ColorStop(fl, s) for fl, s in zip(filaments, st)])
        return color_error(small, plan, base, step, min_h, max_h)

    best = err(starts)
    for _ in range(passes):
        improved = False
        for i in range(1, n):
            lo = starts[i - 1] + 1
            hi = starts[i + 1] - 1 if i + 1 < n else k_max + 1
            for cand in range(lo, hi + 1):
                if cand == starts[i]:
                    continue
                trial = starts.copy()
                trial[i] = cand
                e = err(trial)
                if e < best - 1e-6:
                    best, starts, improved = e, trial, True
        if not improved:
            break
    return ColorPlan([ColorStop(fl, s) for fl, s in zip(filaments, starts)])

