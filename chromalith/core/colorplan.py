"""Farbwechsel-Plan (welches Filament ab welcher Schicht) und Farbsimulation."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import List, Sequence

import numpy as np

from .filaments import Filament
from .heightmap import HeightMap, layer_bottom_z, layer_index, layer_top_z, linear_to_srgb, srgb_to_linear

# Deckkraft einer Schicht der Dicke t: 1 - exp(-K * t / TD).
# Bei t = TD sind so 95 % des Lichts blockiert (eigene Modellannahme).
OPACITY_K = math.log(20.0)


@dataclass
class ColorStop:
    filament: Filament
    start_layer: int   # 1-basiert: erste Schicht mit diesem Filament


class ColorPlan:
    def __init__(self, stops: Sequence[ColorStop] = ()):
        self.stops: List[ColorStop] = list(stops)

    def __len__(self):
        return len(self.stops)

    def ordered(self) -> List[ColorStop]:
        """Nach Startschicht sortiert (stabil, gleiche Startschicht behält die Reihenfolge)."""
        return sorted(self.stops, key=lambda s: s.start_layer)

    def normalized(self) -> List[ColorStop]:
        """Sortiert, erste Startschicht = 1, doppelte Startschichten entfernt (letzte gewinnt)."""
        stops = sorted(self.stops, key=lambda s: s.start_layer)
        if not stops:
            return []
        out: List[ColorStop] = []
        for s in stops:
            if out and out[-1].start_layer == s.start_layer:
                out[-1] = s
            else:
                out.append(s)
        out[0] = ColorStop(out[0].filament, 1)
        return out

    def segments(self, base: float, step: float, max_layer: int):
        """Liste von (Filament, z_unten, z_oben, erste_schicht, letzte_schicht)."""
        stops = [s for s in self.normalized() if s.start_layer <= max_layer]
        segs = []
        for i, s in enumerate(stops):
            last = stops[i + 1].start_layer - 1 if i + 1 < len(stops) else max_layer
            segs.append((s.filament, layer_bottom_z(s.start_layer, base, step),
                         layer_top_z(last, base, step), s.start_layer, last))
        return segs

    def filament_at_layer(self, layer: int) -> Filament | None:
        cur = None
        for s in self.normalized():
            if s.start_layer <= layer:
                cur = s.filament
        return cur


def auto_plan(filaments: Sequence[Filament], hm: HeightMap) -> ColorPlan:
    """Verteilt die Filamente so, dass jedes etwa gleich viel Bildfläche prägt
    (Wechsel an den Höhen-Quantilen des Bildes)."""
    if not filaments:
        return ColorPlan()
    lo, hi = hm.min_layer, hm.layer_count
    inner = hm.heights[hm.border_px:hm.heights.shape[0] - hm.border_px,
                       hm.border_px:hm.heights.shape[1] - hm.border_px] if hm.border_px else hm.heights
    layers = np.sort(layer_index(inner.ravel(), hm.base_layer_mm, hm.layer_height_mm))
    stops = [ColorStop(filaments[0], 1)]
    n = len(filaments)
    for i in range(1, n):
        q = int(layers[min(len(layers) - 1, int(len(layers) * i / n))])
        layer = max(q + 1, lo + 1, stops[-1].start_layer + 1)
        stops.append(ColorStop(filaments[i], min(layer, hi)))
    return ColorPlan(stops)


def simulate_colors(hm: HeightMap, plan: ColorPlan, heights: np.ndarray | None = None) -> np.ndarray:
    """Simuliert die Draufsicht bei Auflicht. Gibt sRGB (ny, nx, 3) in 0..1 zurück.

    Modell: Die Schichten werden von unten nach oben übereinandergelegt. Jede
    Filament-Lage der Dicke t deckt mit 1 - exp(-K t / TD) ab und mischt ihre Farbe
    (linearer Farbraum) über das, was darunter liegt.
    """
    h = hm.heights if heights is None else heights
    segs = plan.segments(hm.base_layer_mm, hm.layer_height_mm, max(hm.layer_count, 1))
    out = np.zeros(h.shape + (3,), dtype=np.float32)
    if not segs:
        return out + 0.5
    out[:] = srgb_to_linear(segs[0][0].rgb)
    for fil, z0, z1, _, _ in segs:
        t = np.clip(np.minimum(h, z1) - z0, 0.0, None)
        a = 1.0 - np.exp(-OPACITY_K * t / max(fil.td, 1e-3))
        out = out * (1.0 - a[..., None]) + srgb_to_linear(fil.rgb) * a[..., None]
    return linear_to_srgb(out).astype(np.float32)


def plan_report(hm: HeightMap, plan: ColorPlan, title: str = "") -> str:
    """Farbwechsel-Liste als lesbarer Text."""
    segs = plan.segments(hm.base_layer_mm, hm.layer_height_mm, hm.layer_count)
    w, d = hm.size_mm
    lines = ["Chromalith – Farbwechsel-Plan"]
    if title:
        lines.append(f"Projekt: {title}")
    lines += [
        f"Modellgröße: {w:.1f} x {d:.1f} mm, Höhe {hm.max_z:.2f} mm",
        f"Erste Schicht: {hm.base_layer_mm:.2f} mm, weitere Schichten: {hm.layer_height_mm:.2f} mm",
        f"Schichten gesamt: {hm.layer_count}",
        "",
        "Wichtig: Im Slicer genau diese Schichthöhen einstellen.",
        "Den Farbwechsel jeweils VOR der genannten Schicht einfügen (z. B. M600 / Pause).",
        "",
    ]
    for i, (fil, z0, z1, first, last) in enumerate(segs):
        desc = f"{fil.label} ({fil.material}, {fil.color}, TD {fil.td:g} mm)"
        if i == 0:
            lines.append(f"Start mit Schicht 1 (Z 0.00 mm): {desc}")
        else:
            lines.append(f"Wechsel vor Schicht {first} (Oberkante Z {layer_top_z(first, hm.base_layer_mm, hm.layer_height_mm):.2f} mm, "
                         f"ab Z {z0:.2f} mm): {desc}")
        lines.append(f"    Schichten {first}–{last}")
    return "\n".join(lines) + "\n"
