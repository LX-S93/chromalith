"""Baut die Beispielprojekte: .chroma + STL + Farbwechsel-Liste + Vorschau.

    python examples/make_motifs.py
    python examples/build_examples.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from chromalith.core.colorplan import ColorPlan, ColorStop
from chromalith.core.export import export_all
from chromalith.core.filaments import builtin_library
from chromalith.core.heightmap import HeightSettings, load_image
from chromalith.core.project import Project

HERE = Path(__file__).resolve().parent
OUT = HERE / "projekte"
LIB = {f.name: f for f in builtin_library()}


def stack(*names):
    return ColorPlan([ColorStop(LIB[n], 1) for n in names])


EXAMPLES = [
    dict(name="01_streifen_gold", image="streifen_gold.png",
         stack=("Schwarz", "Braun", "Gold", "Weiß"),
         settings=dict(width_mm=150, height_mode="bright_high", min_height_mm=0.48,
                       max_height_mm=2.4, smoothing_px=0.5, rim_mm=2.0, raise_mm=0.4)),
    dict(name="02_uhr_berge", image="berge_uhr.png",
         stack=("Dunkelblau", "Rot", "Blau", "Weiß"),
         settings=dict(width_mm=200, pixel_size_mm=0.25, height_mode="color", shape="circle",
                       hole_mm=8, rim_mm=4, clock_numbers=True, numbers_mm=16, raise_mm=1.2,
                       min_height_mm=0.48, max_height_mm=2.4)),
]


def build(ex):
    s = HeightSettings(**ex["settings"])
    proj = Project(image=load_image(HERE / "motive" / ex["image"]), settings=s,
                   plan=stack(*ex["stack"]), name=ex["name"])
    proj.auto_distribute()
    OUT.mkdir(parents=True, exist_ok=True)
    proj.save(OUT / f"{ex['name']}.chroma")
    return export_all(proj, OUT / ex["name"])


if __name__ == "__main__":
    for ex in EXAMPLES:
        for f in build(ex):
            print("geschrieben:", f)
