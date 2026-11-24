"""Export: STL, Farbwechsel-Liste (Text + JSON) und Vorschaubild."""

from __future__ import annotations

import json
from pathlib import Path
from typing import List

import numpy as np
from PIL import Image

from .colorplan import plan_report, simulate_colors
from .mesh import heightmap_to_mesh, write_stl


def plan_json(hm, plan) -> dict:
    segs = plan.segments(hm.base_layer_mm, hm.layer_height_mm, hm.layer_count)
    return {
        "format": "chromalith-colorplan", "version": 1,
        "base_layer_mm": hm.base_layer_mm, "layer_height_mm": hm.layer_height_mm,
        "layer_count": hm.layer_count, "max_z_mm": round(hm.max_z, 4),
        "changes": [{"start_layer": first, "end_layer": last, "z_from_mm": round(z0, 4),
                     "z_to_mm": round(z1, 4), "filament": f.to_dict()}
                    for f, z0, z1, first, last in segs],
    }


def export_all(project, out_base) -> List[Path]:
    """Schreibt <out>.stl, <out>_farbwechsel.txt/.json und <out>_vorschau.png."""
    out = Path(out_base)
    if out.suffix.lower() == ".stl":
        out = out.with_suffix("")
    out.parent.mkdir(parents=True, exist_ok=True)
    hm = project.build()
    stl = out.with_name(out.name + ".stl")
    write_stl(heightmap_to_mesh(hm), stl, name=f"Chromalith {project.name}")
    txt = out.with_name(out.name + "_farbwechsel.txt")
    txt.write_text(plan_report(hm, project.plan, project.name), encoding="utf-8")
    js = out.with_name(out.name + "_farbwechsel.json")
    js.write_text(json.dumps(plan_json(hm, project.plan), indent=2, ensure_ascii=False), encoding="utf-8")
    png = out.with_name(out.name + "_vorschau.png")
    rgb = simulate_colors(hm, project.plan)
    Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8)).save(png)
    return [stl, txt, js, png]
