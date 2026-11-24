"""Bild -> Höhenkarte (in mm), auf Druckschichten quantisiert."""

from __future__ import annotations

from dataclasses import asdict, dataclass, fields
from typing import Optional

import numpy as np
from PIL import Image

LUMA_METHODS = {
    "rec709": "Wahrnehmung (Rec. 709)",
    "rec601": "Wahrnehmung (Rec. 601)",
    "average": "Mittelwert RGB",
    "lightness": "CIE L* (Helligkeit)",
    "max": "Maximum RGB",
}

HEIGHT_MODES = {
    "auto": "Automatisch (bunt = farbtreu, sonst Helligkeit)",
    "bright_high": "Hell = hoch",
    "dark_high": "Dunkel = hoch",
    "color": "Farbtreu (nach Filamentfarben)",
}


@dataclass
class HeightSettings:
    width_mm: float = 100.0          # Breite des Bildbereichs (ohne Rand)
    pixel_size_mm: float = 0.2       # Rasterweite des Modells
    min_height_mm: float = 0.48      # dünnste Stelle
    max_height_mm: float = 2.24      # dickste Stelle
    base_layer_mm: float = 0.16      # Höhe der ersten Schicht
    layer_height_mm: float = 0.08    # Höhe aller weiteren Schichten
    luma_method: str = "rec709"
    linearize: bool = False          # sRGB vor der Luminanz linearisieren
    height_mode: str = "auto"
    brightness: float = 0.0          # -1 .. 1
    contrast: float = 1.0            # 0 .. 3
    gamma: float = 1.0               # 0.2 .. 5
    smoothing_px: float = 0.0        # Gauß-Sigma in Modell-Pixeln
    detail_mm: float = 0.0           # Mindestdetail: kleinere Einzelpunkte werden entfernt
    border_mm: float = 0.0           # Rahmenbreite (0 = kein Rahmen)
    border_height_mm: float = 0.0    # 0 = maximale Höhe

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "HeightSettings":
        names = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in data.items() if k in names})

    def validate(self) -> None:
        if self.width_mm <= 0 or self.pixel_size_mm <= 0:
            raise ValueError("Breite und Rasterweite müssen größer als 0 sein.")
        if self.layer_height_mm <= 0 or self.base_layer_mm <= 0:
            raise ValueError("Schichthöhen müssen größer als 0 sein.")
        if self.max_height_mm <= self.min_height_mm:
            raise ValueError("Maximale Höhe muss größer als die minimale Höhe sein.")
        if self.min_height_mm < self.base_layer_mm:
            raise ValueError("Minimale Höhe darf nicht kleiner als die erste Schicht sein.")
        if self.luma_method not in LUMA_METHODS:
            raise ValueError(f"Unbekannte Luminanz-Methode: {self.luma_method}")
        if self.height_mode not in HEIGHT_MODES:
            raise ValueError(f"Unbekannter Höhenmodus: {self.height_mode}")


# --------------------------------------------------------------------------- Schichten

def layer_top_z(layer: int, base: float, step: float) -> float:
    """Oberkante von Schicht `layer` (1-basiert)."""
    if layer < 1:
        return 0.0
    return base + (layer - 1) * step


def layer_bottom_z(layer: int, base: float, step: float) -> float:
    return layer_top_z(layer - 1, base, step)


def layer_index(z, base: float, step: float):
    """Schichtnummer (1-basiert), deren Oberkante bei z liegt (für quantisierte z)."""
    return np.rint((np.asarray(z) - base) / step).astype(int) + 1


# --------------------------------------------------------------------------- Bild

def load_image(path_or_image) -> Image.Image:
    img = path_or_image if isinstance(path_or_image, Image.Image) else Image.open(path_or_image)
    img.load()
    return img.convert("RGBA")


def prepare_image(img: Image.Image, settings: HeightSettings):
    """Skaliert das Bild auf das Modellraster. Gibt (rgb float, alpha float) zurück."""
    nx = max(2, int(round(settings.width_mm / settings.pixel_size_mm)) + 1)
    ny = max(2, int(round(nx * img.height / img.width)))
    resized = img.resize((nx, ny), Image.LANCZOS)
    arr = np.asarray(resized, dtype=np.float32) / 255.0
    return arr[..., :3], arr[..., 3]


def srgb_to_linear(c):
    c = np.asarray(c, dtype=np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(np.asarray(c, dtype=np.float32), 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def luminance(rgb: np.ndarray, method: str = "rec709", linearize: bool = False) -> np.ndarray:
    rgb = srgb_to_linear(rgb) if linearize or method == "lightness" else rgb
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    if method == "rec709":
        y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    elif method == "rec601":
        y = 0.299 * r + 0.587 * g + 0.114 * b
    elif method == "average":
        y = (r + g + b) / 3.0
    elif method == "max":
        y = np.maximum(np.maximum(r, g), b)
    elif method == "lightness":
        y = 0.2126 * r + 0.7152 * g + 0.0722 * b
        eps = 216 / 24389
        y = np.where(y > eps, np.cbrt(y) * 116 - 16, y * 24389 / 27) / 100.0
    else:
        raise ValueError(method)
    return np.clip(y, 0.0, 1.0).astype(np.float32)


def gaussian_blur(a: np.ndarray, sigma: float) -> np.ndarray:
    if sigma <= 0:
        return a
    radius = max(1, int(3 * sigma))
    x = np.arange(-radius, radius + 1, dtype=np.float32)
    k = np.exp(-(x ** 2) / (2 * sigma ** 2))
    k /= k.sum()
    padded = np.pad(a, ((0, 0), (radius, radius)), mode="edge")
    a = np.apply_along_axis(lambda m: np.convolve(m, k, mode="valid"), 1, padded)
    padded = np.pad(a, ((radius, radius), (0, 0)), mode="edge")
    a = np.apply_along_axis(lambda m: np.convolve(m, k, mode="valid"), 0, padded)
    return a.astype(np.float32)


def median_filter(a: np.ndarray, size: int) -> np.ndarray:
    """Median über ein size x size-Fenster (entfernt einzelne Ausreißer-Pixel, Kanten bleiben)."""
    if size < 2:
        return a
    size |= 1
    r = size // 2
    padded = np.pad(a, r, mode="edge")
    win = np.lib.stride_tricks.sliding_window_view(padded, (size, size))
    return np.median(win.reshape(a.shape[0], a.shape[1], -1), axis=-1).astype(np.float32)


def detail_kernel(s: HeightSettings) -> int:
    k = int(round(s.detail_mm / s.pixel_size_mm)) if s.detail_mm > 0 else 0
    return (k | 1) if k >= 2 else 0


def adjust_color_tone(rgb: np.ndarray, s: HeightSettings) -> np.ndarray:
    v = np.clip((rgb - 0.5) * s.contrast + 0.5 + s.brightness, 0.0, 1.0)
    if s.gamma != 1.0:
        v = np.power(v, 1.0 / max(s.gamma, 1e-3))
    return v.astype(np.float32)


def adjust_tone(lum: np.ndarray, s: HeightSettings) -> np.ndarray:
    v = (lum - 0.5) * s.contrast + 0.5 + s.brightness
    v = np.clip(v, 0.0, 1.0)
    if s.gamma != 1.0:
        v = np.power(v, 1.0 / max(s.gamma, 1e-3))
    return v.astype(np.float32)


# --------------------------------------------------------------------------- Höhenkarte

@dataclass
class HeightMap:
    heights: np.ndarray      # (ny, nx) in mm, quantisiert, inkl. Rahmen
    pixel_size_mm: float
    base_layer_mm: float
    layer_height_mm: float
    image_rgb: np.ndarray    # (ny, nx, 3) Originalfarben (Rahmen = 0)
    border_px: int = 0

    @property
    def shape(self):
        return self.heights.shape

    @property
    def size_mm(self):
        ny, nx = self.heights.shape
        return (nx - 1) * self.pixel_size_mm, (ny - 1) * self.pixel_size_mm

    @property
    def max_z(self) -> float:
        return float(self.heights.max())

    @property
    def layer_count(self) -> int:
        return int(layer_index(self.max_z, self.base_layer_mm, self.layer_height_mm))

    @property
    def min_layer(self) -> int:
        return int(layer_index(self.heights.min(), self.base_layer_mm, self.layer_height_mm))

    def layer_top(self, layer: int) -> float:
        return layer_top_z(layer, self.base_layer_mm, self.layer_height_mm)

    def downsampled(self, max_side: int) -> "HeightMap":
        """Verkleinert durch Mittelung ganzer Blöcke (keine Treppen-/Zackenbildung
        wie beim bloßen Auslassen von Pixeln) und quantisiert wieder auf Schichten."""
        ny, nx = self.heights.shape
        f = int(np.ceil(max(nx, ny) / max_side))
        if f <= 1:
            return self
        my, mx = (ny // f) * f, (nx // f) * f

        def block(a):
            a = a[:my, :mx]
            return a.reshape(my // f, f, mx // f, f, *a.shape[2:]).mean(axis=(1, 3))

        h = quantize(block(self.heights), self.base_layer_mm, self.layer_height_mm)
        return HeightMap(h, self.pixel_size_mm * f, self.base_layer_mm, self.layer_height_mm,
                         block(self.image_rgb).astype(np.float32), self.border_px // f)


def quantize(h: np.ndarray, base: float, step: float) -> np.ndarray:
    k = np.maximum(np.rint((h - base) / step), 0)
    return (base + k * step).astype(np.float32)


def resolve_height_mode(mode: str, bottom_lum: Optional[float], top_lum: Optional[float]) -> str:
    """'auto': ist das oberste Filament dunkler als das unterste, wird Dunkel = hoch."""
    if mode != "auto":
        return mode
    if bottom_lum is None or top_lum is None:
        return "bright_high"
    return "dark_high" if top_lum < bottom_lum else "bright_high"


def build_heightmap(img, settings: HeightSettings, height_mode: Optional[str] = None,
                    color_fn=None) -> HeightMap:
    """Erzeugt die Höhenkarte. `height_mode` überschreibt settings.height_mode
    (wird für 'auto' vom Aufrufer mit resolve_height_mode bestimmt)."""
    settings.validate()
    mode = height_mode or settings.height_mode
    if mode == "auto":
        mode = "bright_high"
    rgb, alpha = prepare_image(load_image(img), settings)
    if mode == "color":
        if color_fn is None:
            raise ValueError("Farbtreuer Modus braucht einen Filament-Stapel.")
        src = np.stack([gaussian_blur(rgb[..., c], settings.smoothing_px) for c in range(3)], -1)
        src = adjust_color_tone(src, settings)
        h = color_fn(src)
        h = median_filter(h, detail_kernel(settings))
    else:
        lum = luminance(rgb, settings.luma_method, settings.linearize)
        lum = median_filter(lum, detail_kernel(settings))
        lum = adjust_tone(gaussian_blur(lum, settings.smoothing_px), settings)
        relief = lum if mode == "bright_high" else 1.0 - lum
        h = settings.min_height_mm + relief * (settings.max_height_mm - settings.min_height_mm)
    h = np.where(alpha < 0.5, settings.min_height_mm, h)
    h = quantize(h, settings.base_layer_mm, settings.layer_height_mm)

    border_px = 0
    if settings.border_mm > 0:
        border_px = max(1, int(round(settings.border_mm / settings.pixel_size_mm)))
        bh = settings.border_height_mm or settings.max_height_mm
        bh = float(quantize(np.array(bh), settings.base_layer_mm, settings.layer_height_mm))
        h = np.pad(h, border_px, mode="constant", constant_values=bh)
        rgb = np.pad(rgb, ((border_px, border_px), (border_px, border_px), (0, 0)))
    return HeightMap(h.astype(np.float32), settings.pixel_size_mm, settings.base_layer_mm,
                     settings.layer_height_mm, rgb.astype(np.float32), border_px)
