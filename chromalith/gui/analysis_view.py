"""Ansicht „Farbanalyse“: Bildfarben und Flächenanteil je Filament."""

from __future__ import annotations

from PySide6.QtWidgets import (QHBoxLayout, QHeaderView, QLabel, QProgressBar, QTableWidget,
                               QTableWidgetItem, QVBoxLayout, QWidget)

from ..core.analysis import filament_usage, image_palette, nearest_filament
from .widgets import Swatch


def _bar(share: float, color: str) -> QProgressBar:
    b = QProgressBar()
    b.setRange(0, 1000)
    b.setValue(int(round(share * 1000)))
    b.setFormat(f"{share * 100:.1f} %")
    b.setStyleSheet(f"QProgressBar::chunk {{ background: {color}; }} QProgressBar {{ text-align: center; }}")
    return b


def _swatch_cell(color):
    w = QWidget()
    h = QHBoxLayout(w)
    h.setContentsMargins(6, 2, 6, 2)
    h.addWidget(Swatch(color, 20))
    return w


class AnalysisView(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        v = QVBoxLayout(self)
        v.addWidget(QLabel("<b>Farben im Bild</b> (Hauptfarben und Flächenanteil, "
                           "dazu das ähnlichste Filament aus deiner Bibliothek)"))
        self.img_table = self._table(["", "Farbe", "Anteil", "Ähnlichstes Filament", "Abstand"])
        v.addWidget(self.img_table, 1)
        v.addWidget(QLabel("<b>Filamente im Ergebnis</b> (Anteil der Bildfläche, auf der das "
                           "Filament ganz oben liegt)"))
        self.use_table = self._table(["", "Filament", "Fläche oben", "Schichten"])
        v.addWidget(self.use_table, 1)
        self.hint = QLabel()
        self.hint.setWordWrap(True)
        v.addWidget(self.hint)

    def _table(self, headers):
        t = QTableWidget(0, len(headers))
        t.setHorizontalHeaderLabels(headers)
        t.verticalHeader().hide()
        t.setEditTriggers(QTableWidget.NoEditTriggers)
        t.setSelectionMode(QTableWidget.NoSelection)
        t.horizontalHeader().setSectionResizeMode(2, QHeaderView.Stretch)
        t.setColumnWidth(0, 40)
        return t

    def update_image(self, image, library):
        fils = list(library)
        pal = image_palette(image, 10) if image is not None else []
        self.img_table.clearContents()
        self.img_table.setRowCount(len(pal))
        for r, (color, share) in enumerate(pal):
            f, d = nearest_filament(color, fils)
            self.img_table.setCellWidget(r, 0, _swatch_cell(color))
            self.img_table.setItem(r, 1, QTableWidgetItem(color))
            self.img_table.setCellWidget(r, 2, _bar(share, color))
            if f:
                self.img_table.setCellWidget(r, 3, self._fil_cell(f))
                quality = "sehr gut" if d < 10 else "gut" if d < 20 else "mäßig" if d < 35 else "schlecht"
                self.img_table.setItem(r, 4, QTableWidgetItem(f"{d:.0f} ({quality})"))
        self.img_table.resizeColumnToContents(1)
        self.img_table.resizeColumnToContents(3)

    def _fil_cell(self, f):
        w = QWidget()
        h = QHBoxLayout(w)
        h.setContentsMargins(6, 2, 6, 2)
        h.addWidget(Swatch(f.color, 16))
        h.addWidget(QLabel(f.label))
        h.addStretch(1)
        return w

    def update_result(self, hm, plan):
        use = filament_usage(hm, plan)
        self.use_table.clearContents()
        self.use_table.setRowCount(len(use))
        unused = []
        for r, (f, share, first, last) in enumerate(reversed(use)):
            self.use_table.setCellWidget(r, 0, _swatch_cell(f.color))
            self.use_table.setItem(r, 1, QTableWidgetItem(f.label))
            self.use_table.setCellWidget(r, 2, _bar(share, f.color))
            self.use_table.setItem(r, 3, QTableWidgetItem(f"{first}–{last} ({last - first + 1})"))
            if share < 0.01:
                unused.append(f.name)
        self.use_table.resizeColumnToContents(1)
        self.hint.setText(
            f"Kaum sichtbar (unter 1 %): {', '.join(unused)}. Diese Filamente kann man meist weglassen "
            "und spart einen Farbwechsel." if unused else "")
