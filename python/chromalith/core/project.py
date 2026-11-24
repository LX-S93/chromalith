"""Projektdatei (.chroma): Bild, Einstellungen und Farbwechsel-Plan in einer JSON-Datei."""

from __future__ import annotations

import base64
import io
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from PIL import Image

from .colorplan import ColorPlan, ColorStop, auto_plan
from .filaments import Filament, luminance_of
from .analysis import is_chromatic
from .colormatch import layer_palette, nearest_heights, optimize_plan
from .heightmap import (HeightMap, HeightSettings, build_heightmap, prepare_image,
                        resolve_height_mode)

PROJECT_FORMAT = "chromalith-project"


@dataclass
class Project:
    image: Optional[Image.Image] = None
    settings: HeightSettings = field(default_factory=HeightSettings)
    plan: ColorPlan = field(default_factory=ColorPlan)
    name: str = "Unbenannt"

    def effective_height_mode(self) -> str:
        if self.settings.height_mode == "color":
            return "color"
        if self.settings.height_mode == "auto" and any(is_chromatic(s.filament) for s in self.plan.stops):
            return "color"
        stops = self.plan.ordered()
        if len(stops) < 2:
            return resolve_height_mode(self.settings.height_mode, None, None)
        return resolve_height_mode(self.settings.height_mode,
                                   luminance_of(stops[0].filament), luminance_of(stops[-1].filament))

    def build(self) -> HeightMap:
        if self.image is None:
            raise ValueError("Kein Bild geladen.")
        mode = self.effective_height_mode()
        color_fn = None
        if mode == "color":
            s = self.settings
            heights, colors = layer_palette(self.plan, s.base_layer_mm, s.layer_height_mm,
                                            s.min_height_mm, s.max_height_mm)
            color_fn = lambda rgb: nearest_heights(rgb, heights, colors)  # noqa: E731
        return build_heightmap(self.image, self.settings, mode, color_fn)

    def auto_distribute(self, filaments=None) -> None:
        fils = filaments if filaments is not None else [s.filament for s in self.plan.ordered()]
        if self.effective_height_mode() == "color":
            s = self.settings
            rgb, _ = prepare_image(self.image, s)
            self.plan = optimize_plan(rgb, fils, s.base_layer_mm, s.layer_height_mm,
                                      s.min_height_mm, s.max_height_mm)
        else:
            self.plan = ColorPlan([ColorStop(f, 1) for f in fils])
            self.plan = auto_plan(fils, self.build())

    # ------------------------------------------------------------------ Speichern
    def to_dict(self) -> dict:
        img_b64 = None
        if self.image is not None:
            buf = io.BytesIO()
            self.image.save(buf, format="PNG")
            img_b64 = base64.b64encode(buf.getvalue()).decode("ascii")
        return {
            "format": PROJECT_FORMAT, "version": 1, "name": self.name,
            "settings": self.settings.to_dict(),
            "plan": [{"start_layer": s.start_layer, "filament": s.filament.to_dict()}
                     for s in self.plan.stops],
            "image_png": img_b64,
        }

    def save(self, path) -> None:
        Path(path).write_text(json.dumps(self.to_dict(), ensure_ascii=False), encoding="utf-8")

    @classmethod
    def from_dict(cls, d: dict) -> "Project":
        if d.get("format") != PROJECT_FORMAT:
            raise ValueError("Keine Chromalith-Projektdatei.")
        img = None
        if d.get("image_png"):
            img = Image.open(io.BytesIO(base64.b64decode(d["image_png"])))
            img.load()
            img = img.convert("RGBA")
        plan = ColorPlan([ColorStop(Filament.from_dict(s["filament"]), int(s["start_layer"]))
                          for s in d.get("plan", [])])
        return cls(img, HeightSettings.from_dict(d.get("settings", {})), plan, d.get("name", "Unbenannt"))

    @classmethod
    def load(cls, path) -> "Project":
        return cls.from_dict(json.loads(Path(path).read_text(encoding="utf-8")))
