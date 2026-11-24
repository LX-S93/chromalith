"""Filament-Bibliothek: anzeigen, suchen, anlegen, bearbeiten, importieren, auswählen."""

from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtGui import QColor
from PySide6.QtWidgets import (QAbstractItemView, QCheckBox, QColorDialog, QComboBox, QDialog,
                               QDialogButtonBox, QFileDialog, QFormLayout, QHBoxLayout, QLineEdit,
                               QMessageBox, QPushButton, QTableWidget, QTableWidgetItem,
                               QVBoxLayout)

from ..core.filaments import Filament, FilamentLibrary, load_filaments_any
from .settings_panel import dspin

MATERIALS = ["PLA", "PLA+", "PETG", "ABS", "ASA", "TPU", "Sonstiges"]


class FilamentEditor(QDialog):
    def __init__(self, filament: Filament | None = None, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Filament bearbeiten" if filament else "Neues Filament")
        f = filament or Filament("", "#808080", 1.0)
        self._id = f.id
        form = QFormLayout(self)
        self.brand = QLineEdit(f.brand)
        self.name = QLineEdit(f.name)
        self.material = QComboBox()
        self.material.setEditable(True)
        self.material.addItems(MATERIALS)
        self.material.setCurrentText(f.material)
        self.color_btn = QPushButton(f.color)
        self.color = f.color
        self._paint_color()
        self.color_btn.clicked.connect(self.pick_color)
        self.td = dspin(0.05, 50, 0.1)
        self.td.setValue(f.td)
        self.td.setToolTip("Transmissions-Distanz: Dicke, ab der das Filament praktisch kein Licht mehr durchlässt.")
        self.owned = QCheckBox("Habe ich")
        self.owned.setChecked(f.owned)
        form.addRow("Marke", self.brand)
        form.addRow("Name", self.name)
        form.addRow("Material", self.material)
        form.addRow("Farbe", self.color_btn)
        form.addRow("TD", self.td)
        form.addRow("", self.owned)
        bb = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        bb.accepted.connect(self._accept)
        bb.rejected.connect(self.reject)
        form.addRow(bb)

    def _paint_color(self):
        c = QColor(self.color)
        fg = "#000" if c.lightness() > 128 else "#fff"
        self.color_btn.setText(self.color)
        self.color_btn.setStyleSheet(f"background:{self.color}; color:{fg};")

    def pick_color(self):
        c = QColorDialog.getColor(QColor(self.color), self, "Farbe wählen")
        if c.isValid():
            self.color = c.name()
            self._paint_color()

    def _accept(self):
        if not self.name.text().strip():
            QMessageBox.warning(self, "Name fehlt", "Bitte einen Namen eingeben.")
            return
        self.accept()

    def filament(self) -> Filament:
        return Filament(self.name.text().strip(), self.color, float(self.td.value()),
                        self.brand.text().strip(), self.material.currentText().strip() or "PLA",
                        self.owned.isChecked(), self._id)


class LibraryDialog(QDialog):
    COLS = ["", "Marke", "Name", "Material", "Farbe", "TD (mm)", "Habe ich"]

    def __init__(self, library: FilamentLibrary, parent=None, select_mode=True):
        super().__init__(parent)
        self.library = library
        self.modified = False
        self.setWindowTitle("Filament-Bibliothek")
        self.resize(760, 520)
        v = QVBoxLayout(self)
        top = QHBoxLayout()
        self.search = QLineEdit()
        self.search.setPlaceholderText("Suchen (Marke, Name, Material) …")
        self.search.textChanged.connect(self.refresh)
        self.only_owned = QCheckBox("Nur vorhandene")
        self.only_owned.toggled.connect(self.refresh)
        top.addWidget(self.search, 1)
        top.addWidget(self.only_owned)
        v.addLayout(top)
        self.table = QTableWidget(0, len(self.COLS))
        self.table.setHorizontalHeaderLabels(self.COLS)
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.table.setSortingEnabled(True)
        self.table.verticalHeader().hide()
        self.table.horizontalHeader().setStretchLastSection(True)
        self.table.doubleClicked.connect(self.accept if select_mode else self.edit)
        v.addWidget(self.table, 1)
        row = QHBoxLayout()
        for text, slot in [("Neu …", self.new), ("Bearbeiten …", self.edit),
                           ("Löschen", self.delete), ("Importieren …", self.import_file),
                           ("Exportieren …", self.export_file)]:
            b = QPushButton(text)
            b.clicked.connect(slot)
            row.addWidget(b)
        row.addStretch(1)
        v.addLayout(row)
        buttons = QDialogButtonBox.Ok | QDialogButtonBox.Cancel if select_mode else QDialogButtonBox.Close
        bb = QDialogButtonBox(buttons)
        if select_mode:
            bb.button(QDialogButtonBox.Ok).setText("Zum Stapel hinzufügen")
        bb.accepted.connect(self.accept)
        bb.rejected.connect(self.reject)
        v.addWidget(bb)
        self.refresh()

    def refresh(self):
        q = self.search.text().lower().strip()
        self.table.setSortingEnabled(False)
        self.table.setRowCount(0)
        for f in self.library:
            if self.only_owned.isChecked() and not f.owned:
                continue
            if q and q not in f"{f.brand} {f.name} {f.material}".lower():
                continue
            r = self.table.rowCount()
            self.table.insertRow(r)
            sw = QTableWidgetItem()
            sw.setBackground(QColor(f.color))
            sw.setData(Qt.UserRole, f.id)
            vals = [sw, QTableWidgetItem(f.brand), QTableWidgetItem(f.name),
                    QTableWidgetItem(f.material), QTableWidgetItem(f.color)]
            td = QTableWidgetItem()
            td.setData(Qt.DisplayRole, f.td)
            vals += [td, QTableWidgetItem("ja" if f.owned else "")]
            for c, it in enumerate(vals):
                self.table.setItem(r, c, it)
        self.table.setSortingEnabled(True)
        self.table.resizeColumnsToContents()

    def selected(self) -> list[Filament]:
        rows = sorted({i.row() for i in self.table.selectedIndexes()})
        out = []
        for r in rows:
            f = self.library.get(self.table.item(r, 0).data(Qt.UserRole))
            if f:
                out.append(f)
        return out

    def new(self):
        d = FilamentEditor(parent=self)
        if d.exec():
            self.library.add(d.filament())
            self.modified = True
            self.refresh()

    def edit(self, *_):
        sel = self.selected()
        if not sel:
            return
        d = FilamentEditor(sel[0], self)
        if d.exec():
            new = d.filament()
            i = self.library.filaments.index(sel[0])
            self.library.filaments[i] = new
            self.modified = True
            self.refresh()

    def delete(self):
        sel = self.selected()
        if sel and QMessageBox.question(self, "Löschen", f"{len(sel)} Filament(e) löschen?") == QMessageBox.Yes:
            for f in sel:
                self.library.remove(f.id)
            self.modified = True
            self.refresh()

    def import_file(self):
        paths, _ = QFileDialog.getOpenFileNames(
            self, "Filamente importieren", "",
            "Filament-Dateien (*.json *.fss);;Alle Dateien (*)")
        total = 0
        for p in paths:
            try:
                total += self.library.merge(load_filaments_any(p))
            except Exception as e:  # noqa: BLE001
                QMessageBox.warning(self, "Import fehlgeschlagen", f"{p}\n\n{e}")
        if paths:
            self.modified = self.modified or total > 0
            self.refresh()
            QMessageBox.information(self, "Import", f"{total} neue Filamente importiert.")

    def export_file(self):
        p, _ = QFileDialog.getSaveFileName(self, "Bibliothek exportieren", "filamente.json",
                                           "JSON (*.json)")
        if p:
            sel = self.selected()
            FilamentLibrary(sel or list(self.library)).save(p)
