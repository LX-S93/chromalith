"""Einstellungen für Größe, Höhen und Bildaufbereitung."""

from __future__ import annotations

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (QCheckBox, QComboBox, QDoubleSpinBox, QFormLayout, QGroupBox,
                               QHBoxLayout, QPushButton, QSlider, QVBoxLayout, QWidget)

from ..core.heightmap import HEIGHT_MODES, LUMA_METHODS, HeightSettings


def dspin(lo, hi, step, decimals=2, suffix=" mm"):
    s = QDoubleSpinBox()
    s.setRange(lo, hi)
    s.setSingleStep(step)
    s.setDecimals(decimals)
    s.setSuffix(suffix)
    s.setKeyboardTracking(False)
    return s


class SliderSpin(QWidget):
    """Schieberegler mit Eingabefeld für genaue Werte (beide synchron)."""

    valueChanged = Signal(float)

    def __init__(self, lo, hi, step, decimals=2, suffix=" mm", parent=None):
        super().__init__(parent)
        self.lo, self.step = lo, step
        self.slider = QSlider(Qt.Horizontal)
        self.slider.setRange(0, int(round((hi - lo) / step)))
        self.slider.setPageStep(max(1, self.slider.maximum() // 10))
        self.spin = dspin(lo, hi, step, decimals, suffix)
        self.spin.setFixedWidth(88)
        h = QHBoxLayout(self)
        h.setContentsMargins(0, 0, 0, 0)
        h.addWidget(self.slider, 1)
        h.addWidget(self.spin)
        self.slider.valueChanged.connect(self._from_slider)
        self.spin.valueChanged.connect(self._from_spin)

    def _from_slider(self, i):
        v = self.lo + i * self.step
        self.spin.blockSignals(True)
        self.spin.setValue(v)
        self.spin.blockSignals(False)
        self.valueChanged.emit(self.spin.value())

    def _from_spin(self, v):
        self.slider.blockSignals(True)
        self.slider.setValue(int(round((v - self.lo) / self.step)))
        self.slider.blockSignals(False)
        self.valueChanged.emit(v)

    def value(self) -> float:
        return float(self.spin.value())

    def setValue(self, v: float):
        self.blockSignals(True)
        self.spin.setValue(v)
        self.blockSignals(False)

    def setToolTip(self, text):
        super().setToolTip(text)
        self.slider.setToolTip(text)
        self.spin.setToolTip(text)


def slider(lo, hi, step, decimals=2, suffix=" mm"):
    return lambda: SliderSpin(lo, hi, step, decimals, suffix)


class SettingsPanel(QWidget):
    changed = Signal()
    invertRequested = Signal()

    FIELDS = [
        # name, gruppe, label, widget-factory
        ("width_mm", "Größe", "Breite", slider(10, 400, 1, 1)),
        ("pixel_size_mm", "Größe", "Rasterweite", slider(0.05, 1.0, 0.05)),
        ("border_mm", "Größe", "Rahmenbreite", slider(0, 20, 0.5, 1)),
        ("border_height_mm", "Größe", "Rahmenhöhe (0 = max.)", slider(0, 10, 0.08)),
        ("base_layer_mm", "Schichten", "Erste Schicht", slider(0.04, 0.4, 0.02)),
        ("layer_height_mm", "Schichten", "Schichthöhe", slider(0.04, 0.32, 0.02)),
        ("min_height_mm", "Schichten", "Minimale Höhe", slider(0.08, 5, 0.04)),
        ("max_height_mm", "Schichten", "Maximale Höhe", slider(0.4, 10, 0.04)),
        ("height_mode", "Bild", "Höhe aus", None),
        ("luma_method", "Bild", "Helligkeit", None),
        ("linearize", "Bild", "sRGB linearisieren", None),
        ("detail_mm", "Bild", "Mindestdetail", slider(0, 2, 0.1, 1)),
        ("smoothing_px", "Bild", "Glätten", slider(0, 10, 0.25, 2, " px")),
        ("brightness", "Bild", "Helligkeit +/-", slider(-1, 1, 0.02, 2, "")),
        ("contrast", "Bild", "Kontrast", slider(0, 4, 0.05, 2, "")),
        ("gamma", "Bild", "Gamma", slider(0.2, 5, 0.05, 2, "")),
    ]

    def __init__(self, parent=None):
        super().__init__(parent)
        self.widgets = {}
        layout = QVBoxLayout(self)
        self.invert_btn = QPushButton()
        self.invert_btn.setMinimumHeight(36)
        self.invert_btn.setStyleSheet("font-weight: bold;")
        self.invert_btn.setToolTip("Kehrt die Höhe um: helle Bildstellen hoch oder dunkle Bildstellen hoch.")
        self.invert_btn.clicked.connect(self.invertRequested)
        layout.addWidget(self.invert_btn)
        self.set_mode_label("bright_high")
        groups = {}
        for name, group, label, factory in self.FIELDS:
            if group not in groups:
                box = QGroupBox(group)
                groups[group] = QFormLayout(box)
                layout.addWidget(box)
            if name == "height_mode":
                w = QComboBox()
                for k, v in HEIGHT_MODES.items():
                    w.addItem(v, k)
                w.currentIndexChanged.connect(self.changed)
            elif name == "luma_method":
                w = QComboBox()
                for k, v in LUMA_METHODS.items():
                    w.addItem(v, k)
                w.currentIndexChanged.connect(self.changed)
            elif name == "linearize":
                w = QCheckBox()
                w.toggled.connect(self.changed)
            else:
                w = factory()
                w.valueChanged.connect(self.changed)
            groups[group].addRow(label, w)
            self.widgets[name] = w
        self.widgets["pixel_size_mm"].setToolTip(
            "Abstand der Modellpunkte. Kleiner = feiner, aber größere STL. 0.2 mm passt zu 0.4-mm-Düsen.")
        self.widgets["height_mode"].setToolTip(
            "Automatisch: Ist das oberste Filament dunkler als das unterste, werden dunkle Bildstellen hoch.")
        self.widgets["detail_mm"].setToolTip(
            "Bildpunkte, die kleiner sind als dieser Wert, werden entfernt (Median-Filter). "
            "Verhindert einzelne Zacken im Relief. 0 = aus. 0.4 mm passt zu 0.4-mm-Düsen.")
        self.widgets["smoothing_px"].setToolTip("Weichzeichnen des Bildes vor der Höhenberechnung.")
        layout.addStretch(1)

    def set_mode_label(self, effective_mode: str):
        text = {"bright_high": "⇅  Höhe: hell = hoch  (klicken zum Umkehren)",
                "dark_high": "⇅  Höhe: dunkel = hoch  (klicken zum Umkehren)",
                "color": "⇅  Höhe: farbtreu  (klicken für hell/dunkel)"}[effective_mode]
        self.invert_btn.setText(text)

    def set_settings(self, s: HeightSettings):
        for name, w in self.widgets.items():
            w.blockSignals(True)
            v = getattr(s, name)
            if isinstance(w, QComboBox):
                w.setCurrentIndex(max(0, w.findData(v)))
            elif isinstance(w, QCheckBox):
                w.setChecked(bool(v))
            else:
                w.setValue(float(v))
            w.blockSignals(False)

    def apply_to(self, s: HeightSettings):
        for name, w in self.widgets.items():
            if isinstance(w, QComboBox):
                setattr(s, name, w.currentData())
            elif isinstance(w, QCheckBox):
                setattr(s, name, w.isChecked())
            else:
                setattr(s, name, float(w.value()))
