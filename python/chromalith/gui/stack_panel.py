"""Filament-Stapel: welches Filament ab welcher Schicht gedruckt wird."""

from __future__ import annotations

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (QAbstractItemView, QFileDialog, QGridLayout, QHBoxLayout, QLabel,
                               QMessageBox, QPushButton, QSpinBox, QTableWidget, QTableWidgetItem,
                               QVBoxLayout, QWidget)

from ..core.colorplan import ColorPlan, ColorStop
from ..core.filaments import FilamentLibrary, load_filaments_any, luminance_of
from ..core.heightmap import layer_top_z
from .widgets import Swatch


class StackPanel(QWidget):
    changed = Signal()               # Startschichten geändert
    addRequested = Signal()
    autoRequested = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self.plan = ColorPlan()
        self.color_mode = False
        self.layer_count = 30
        self.min_layer = 1
        self.base = 0.16
        self.step = 0.08
        v = QVBoxLayout(self)
        v.setContentsMargins(0, 0, 0, 0)
        v.addWidget(QLabel("<b>Filament-Stapel</b> (oben = zuletzt gedruckt)"))
        self.table = QTableWidget(0, 4)
        self.table.setHorizontalHeaderLabels(["", "Filament", "ab Schicht", "ab Z"])
        self.table.verticalHeader().hide()
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.SingleSelection)
        self.table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.table.horizontalHeader().setStretchLastSection(False)
        self.table.horizontalHeader().setSectionResizeMode(1, self.table.horizontalHeader().ResizeMode.Stretch)
        v.addWidget(self.table, 1)
        grid = QGridLayout()
        buttons = [("Hinzufügen …", self.addRequested.emit), ("Entfernen", self.remove),
                   ("Nach oben", lambda: self.move(+1)), ("Nach unten", lambda: self.move(-1)),
                   ("Automatisch verteilen", self.autoRequested.emit),
                   ("Nach Helligkeit sortieren", self.sort_by_brightness),
                   ("Set laden …", self.load_set), ("Set speichern …", self.save_set)]
        for i, (text, slot) in enumerate(buttons):
            b = QPushButton(text)
            b.clicked.connect(slot)
            grid.addWidget(b, i // 2, i % 2)
        v.addLayout(grid)
        self.info = QLabel()
        self.info.setWordWrap(True)
        v.addWidget(self.info)

    # ------------------------------------------------------------------ Daten
    def set_plan(self, plan: ColorPlan):
        self.plan = plan
        self.refresh()

    def set_color_mode(self, on: bool):
        if on != self.color_mode:
            self.color_mode = on
            self.refresh()

    def set_layer_info(self, layer_count, min_layer, base, step):
        info = (layer_count, min_layer, base, step)
        changed = info != (self.layer_count, self.min_layer, self.base, self.step)
        self.layer_count, self.min_layer, self.base, self.step = info
        stops = self.plan.ordered()
        before = [s.start_layer for s in stops]
        # Startschichten in den gültigen Bereich bringen
        for i, s in enumerate(stops):
            if i == 0:
                s.start_layer = 1
            else:
                s.start_layer = max(stops[i - 1].start_layer + 1, min(s.start_layer, layer_count))
        self.plan.stops = stops
        if changed or before != [s.start_layer for s in stops] or self.table.rowCount() != len(stops):
            self.refresh()

    def refresh(self):
        stops = self.plan.ordered()
        self.plan.stops = stops
        sel = self.current_index()
        self.table.clearContents()
        self.table.setRowCount(len(stops))
        self._spins = {}
        for row, idx in enumerate(range(len(stops) - 1, -1, -1)):
            s = stops[idx]
            sw = QWidget()
            h = QHBoxLayout(sw)
            h.setContentsMargins(4, 2, 4, 2)
            h.addWidget(Swatch(s.filament.color))
            self.table.setCellWidget(row, 0, sw)
            item = QTableWidgetItem(f"{s.filament.name}  ·  TD {s.filament.td:g}")
            item.setToolTip(f"{s.filament.label}\n{s.filament.material}, {s.filament.color}, TD {s.filament.td:g} mm")
            self.table.setItem(row, 1, item)
            spin = QSpinBox()
            spin.setKeyboardTracking(False)
            lo = 1 if idx == 0 else stops[idx - 1].start_layer + 1
            hi = 1 if idx == 0 else (stops[idx + 1].start_layer - 1 if idx + 1 < len(stops) else self.layer_count)
            spin.setRange(lo, max(lo, hi))
            spin.setValue(s.start_layer)
            self._spins[idx] = (spin, row)
            spin.setEnabled(idx > 0)
            spin.valueChanged.connect(lambda val, i=idx: self._set_layer(i, val))
            self.table.setCellWidget(row, 2, spin)
            z = 0.0 if idx == 0 else layer_top_z(s.start_layer - 1, self.base, self.step)
            self.table.setItem(row, 3, QTableWidgetItem(f"{z:.2f} mm"))
        self.table.setColumnWidth(0, 34)
        self.table.setColumnWidth(2, 80)
        self.table.setColumnWidth(3, 72)
        if sel is not None and 0 <= sel < len(stops):
            self.table.selectRow(len(stops) - 1 - sel)
        unused = [s for s in stops[1:] if s.start_layer > self.layer_count]
        text = f"Modell: {self.layer_count} Schichten, Bild beginnt bei Schicht {self.min_layer}."
        if unused:
            text += " Ein Filament liegt oberhalb des Modells."
        if self.color_mode:
            text += ("<br>Farbtreuer Modus: Die Reihenfolge darf bunt gemischt sein. "
                     "„Automatisch verteilen“ sucht die Wechsel, die die Bildfarben am besten treffen.")
        elif not self.is_monotonic():
            text += ("<br><span style='color:#c0392b'><b>Hinweis:</b> Die Filamente sind nicht nach "
                     "Helligkeit geordnet. Die Höhe folgt der Bildhelligkeit, deshalb sollten die "
                     "Farben von unten nach oben stetig dunkler (oder heller) werden. "
                     "„Nach Helligkeit sortieren“ behebt das.</span>")
        self.info.setText(text)

    def current_index(self):
        rows = {i.row() for i in self.table.selectedIndexes()}
        if not rows:
            return None
        return len(self.plan.stops) - 1 - min(rows)

    def _set_layer(self, idx, val):
        """Startschicht geändert: nur Nachbarbereiche und Z-Anzeige anpassen,
        die Tabelle nicht neu aufbauen (sonst verliert das Eingabefeld den Fokus)."""
        stops = self.plan.stops
        stops[idx].start_layer = val
        for j in (idx - 1, idx + 1):
            if j <= 0 or j >= len(stops):
                continue
            spin, _ = self._spins[j]
            lo = stops[j - 1].start_layer + 1
            hi = stops[j + 1].start_layer - 1 if j + 1 < len(stops) else self.layer_count
            spin.blockSignals(True)
            spin.setRange(lo, max(lo, hi))
            spin.blockSignals(False)
        _, row = self._spins[idx]
        z = layer_top_z(val - 1, self.base, self.step)
        self.table.setItem(row, 3, QTableWidgetItem(f"{z:.2f} mm"))
        self.changed.emit()

    def set_start_layer(self, idx, layer):
        """Startschicht von Filament idx (0 = unterstes) setzen, auf den gültigen Bereich begrenzt."""
        if idx in getattr(self, "_spins", {}):
            spin, _ = self._spins[idx]
            spin.setValue(layer)   # begrenzt selbst und löst _set_layer aus

    # ------------------------------------------------------------------ Aktionen
    def add_filaments(self, filaments):
        stops = self.plan.ordered()
        for f in filaments:
            if not stops:
                stops.append(ColorStop(f, 1))
                continue
            last = stops[-1].start_layer
            layer = min(self.layer_count, max(last + 1, (last + self.layer_count + 1) // 2))
            if layer <= last:
                layer = last + 1
            stops.append(ColorStop(f, layer))
        self.plan.stops = stops
        self.refresh()
        self.changed.emit()

    def remove(self):
        i = self.current_index()
        if i is None:
            return
        del self.plan.stops[i]
        if self.plan.stops:
            self.plan.stops[0].start_layer = 1
        self.refresh()
        self.changed.emit()

    def move(self, direction):
        """Filament im Stapel nach oben (+1) / unten (-1) tauschen, Schichten bleiben."""
        i = self.current_index()
        j = None if i is None else i + direction
        stops = self.plan.stops
        if i is None or not (0 <= j < len(stops)):
            return
        stops[i].filament, stops[j].filament = stops[j].filament, stops[i].filament
        self.refresh()
        self.table.selectRow(len(stops) - 1 - j)
        self.changed.emit()

    def is_monotonic(self) -> bool:
        lum = [luminance_of(s.filament) for s in self.plan.ordered()]
        if len(lum) < 3:
            return True
        diffs = [b - a for a, b in zip(lum, lum[1:])]
        tol = 0.03
        return all(d <= tol for d in diffs) or all(d >= -tol for d in diffs)

    def sort_by_brightness(self):
        """Filamente nach Helligkeit ordnen (Richtung nach dem untersten Filament),
        Startschichten bleiben erhalten."""
        stops = self.plan.ordered()
        if len(stops) < 2:
            return
        fils = [s.filament for s in stops]
        lums = [luminance_of(f) for f in fils]
        dark_on_top = lums[0] >= sum(lums) / len(lums)
        fils.sort(key=luminance_of, reverse=dark_on_top)
        for s, f in zip(stops, fils):
            s.filament = f
        self.refresh()
        self.changed.emit()

    def load_set(self):
        p, _ = QFileDialog.getOpenFileName(self, "Filament-Set laden", "",
                                           "Filament-Sets (*.json *.fss);;Alle Dateien (*)")
        if not p:
            return
        try:
            fils = load_filaments_any(p)
        except Exception as e:  # noqa: BLE001
            QMessageBox.warning(self, "Fehler", str(e))
            return
        self.plan = ColorPlan([ColorStop(f, 1) for f in fils])
        self.refresh()
        self.autoRequested.emit()

    def save_set(self):
        p, _ = QFileDialog.getSaveFileName(self, "Filament-Set speichern", "set.json", "JSON (*.json)")
        if p:
            FilamentLibrary([s.filament for s in self.plan.ordered()]).save(p)
