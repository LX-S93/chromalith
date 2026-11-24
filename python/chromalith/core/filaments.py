"""Filamente, Filament-Bibliothek und Import vorhandener Bibliotheken."""

from __future__ import annotations

import json
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Iterable, List

import numpy as np

LIBRARY_FORMAT = "chromalith-filaments"


def hex_to_rgb(color: str) -> np.ndarray:
    c = color.strip().lstrip("#")
    if len(c) == 3:
        c = "".join(ch * 2 for ch in c)
    if len(c) != 6:
        raise ValueError(f"Ungültige Farbe: {color}")
    return np.array([int(c[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32) / 255.0


def rgb_to_hex(rgb) -> str:
    r, g, b = (int(round(max(0.0, min(1.0, float(v))) * 255)) for v in rgb)
    return f"#{r:02x}{g:02x}{b:02x}"


@dataclass
class Filament:
    name: str
    color: str                 # "#rrggbb"
    td: float                  # Transmissions-Distanz in mm (Dicke bis nahezu deckend)
    brand: str = ""
    material: str = "PLA"
    owned: bool = False
    id: str = field(default_factory=lambda: str(uuid.uuid4()))

    @property
    def rgb(self) -> np.ndarray:
        return hex_to_rgb(self.color)

    @property
    def label(self) -> str:
        return f"{self.brand} {self.name}".strip()

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "Filament":
        return cls(name=str(d["name"]), color=str(d["color"]), td=float(d["td"]),
                   brand=str(d.get("brand", "")), material=str(d.get("material", "PLA")),
                   owned=bool(d.get("owned", False)), id=str(d.get("id") or uuid.uuid4()))


class FilamentLibrary:
    def __init__(self, filaments: Iterable[Filament] = ()):
        self.filaments: List[Filament] = list(filaments)

    def __len__(self):
        return len(self.filaments)

    def __iter__(self):
        return iter(self.filaments)

    def get(self, fid: str) -> Filament | None:
        return next((f for f in self.filaments if f.id == fid), None)

    def add(self, f: Filament) -> None:
        if self.get(f.id) is None:
            self.filaments.append(f)

    def merge(self, others: Iterable[Filament]) -> int:
        n = 0
        for f in others:
            if self.get(f.id) is None:
                self.filaments.append(f)
                n += 1
        return n

    def remove(self, fid: str) -> None:
        self.filaments = [f for f in self.filaments if f.id != fid]

    def save(self, path) -> None:
        data = {"format": LIBRARY_FORMAT, "version": 1,
                "filaments": [f.to_dict() for f in self.filaments]}
        Path(path).write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

    @classmethod
    def load(cls, path) -> "FilamentLibrary":
        return cls(load_filaments_any(path))


def _from_foreign(d: dict) -> Filament:
    """Liest einen Eintrag im Schema 'Brand/Name/Type/Color/Transmissivity/Owned/uuid',
    wie es andere Programme für Filament-Bibliotheken und Sets verwenden."""
    fid = str(d.get("uuid") or d.get("id") or uuid.uuid4()).strip("{}")
    return Filament(name=str(d.get("Name", "")), color=str(d.get("Color", "#808080")),
                    td=float(d.get("Transmissivity", 1.0)), brand=str(d.get("Brand", "")),
                    material=str(d.get("Type", "PLA")), owned=bool(d.get("Owned", False)),
                    id=fid)


def parse_filaments(data) -> List[Filament]:
    if isinstance(data, dict) and data.get("format") == LIBRARY_FORMAT:
        return [Filament.from_dict(d) for d in data.get("filaments", [])]
    items = None
    if isinstance(data, dict):
        for key in ("filaments", "Filaments", "filament_set"):
            if key in data:
                items = data[key]
                break
    elif isinstance(data, list):
        items = data
    if items is None:
        raise ValueError("Keine Filamente in der Datei gefunden.")
    result = []
    for d in items:
        if "Transmissivity" in d or "Brand" in d or "Color" in d:
            result.append(_from_foreign(d))
        else:
            result.append(Filament.from_dict(d))
    return result


def load_filaments_any(path) -> List[Filament]:
    text = Path(path).read_text(encoding="utf-8-sig")
    return parse_filaments(json.loads(text))


def builtin_library() -> FilamentLibrary:
    path = Path(__file__).resolve().parent.parent / "data" / "starter_filaments.json"
    return FilamentLibrary.load(path)


def luminance_of(f: Filament) -> float:
    r, g, b = f.rgb
    return float(0.2126 * r + 0.7152 * g + 0.0722 * b)
