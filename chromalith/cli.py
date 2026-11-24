"""Kommandozeile: Bild oder Projekt -> STL + Farbwechsel-Liste.

Beispiele:
  python -m chromalith.cli bild.png --width 120 --filaments set.json -o modell
  python -m chromalith.cli projekt.chroma -o modell
"""

from __future__ import annotations

import argparse
from pathlib import Path

from .core.colorplan import ColorPlan, ColorStop, plan_report
from .core.export import export_all
from .core.filaments import builtin_library, load_filaments_any
from .core.heightmap import load_image
from .core.project import Project


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="chromalith", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("input", help="Bild (png/jpg/...) oder Projekt (.chroma)")
    p.add_argument("-o", "--output", required=True, help="Ausgabe ohne Endung")
    p.add_argument("--width", type=float, help="Breite in mm")
    p.add_argument("--pixel", type=float, help="Rasterweite in mm")
    p.add_argument("--min", dest="min_h", type=float, help="Minimale Höhe in mm")
    p.add_argument("--max", dest="max_h", type=float, help="Maximale Höhe in mm")
    p.add_argument("--layer", type=float, help="Schichthöhe in mm")
    p.add_argument("--base", type=float, help="Erste Schicht in mm")
    p.add_argument("--border", type=float, help="Rahmenbreite in mm")
    p.add_argument("--mode", choices=["auto", "bright_high", "dark_high"])
    p.add_argument("--filaments", help="Filament-Datei (eigene oder importierte Bibliothek/Set), "
                                       "Reihenfolge = unten nach oben")
    a = p.parse_args(argv)

    if a.input.lower().endswith(".chroma"):
        proj = Project.load(a.input)
    else:
        proj = Project(image=load_image(a.input), name=Path(a.input).stem)
        if a.filaments:
            lib = load_filaments_any(a.filaments)
        else:
            by_name = {f.name: f for f in builtin_library()}
            lib = [by_name[n] for n in ("Schwarz", "Grau dunkel", "Grau hell", "Weiß")]
        proj.plan = ColorPlan([ColorStop(f, 1) for f in lib])
    s = proj.settings
    for attr, val in [("width_mm", a.width), ("pixel_size_mm", a.pixel), ("min_height_mm", a.min_h),
                      ("max_height_mm", a.max_h), ("layer_height_mm", a.layer),
                      ("base_layer_mm", a.base), ("border_mm", a.border), ("height_mode", a.mode)]:
        if val is not None:
            setattr(s, attr, val)
    if not a.input.lower().endswith(".chroma"):
        proj.auto_distribute()
    files = export_all(proj, a.output)
    hm = proj.build()
    print(plan_report(hm, proj.plan, proj.name))
    for f in files:
        print("geschrieben:", f)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
