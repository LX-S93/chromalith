"""Hauptfenster von Chromalith."""

from __future__ import annotations

import copy
from pathlib import Path

from PySide6.QtCore import QSettings, Qt, QTimer
from PySide6.QtGui import QAction, QKeySequence
from PySide6.QtWidgets import (QApplication, QFileDialog, QHBoxLayout, QLabel, QMainWindow,
                               QMessageBox, QScrollArea, QSlider, QSplitter, QTabWidget,
                               QVBoxLayout, QWidget)

from .. import __version__
from ..core.colorplan import ColorPlan, ColorStop, auto_plan, simulate_colors
from ..core.export import export_all
from ..core.heightmap import load_image
from ..core.project import Project
from .analysis_view import AnalysisView
from .library_dialog import LibraryDialog
from .preview3d import Preview3D
from .settings_panel import SettingsPanel
from .stack_panel import StackPanel
from .storage import load_user_library, save_user_library
from .widgets import ImageView, LayerBar, array_to_qimage

IMAGE_FILTER = "Bilder (*.png *.jpg *.jpeg *.webp *.bmp *.tif *.tiff *.gif);;Alle Dateien (*)"
PREVIEW_MAX_SIDE = 1600


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.prefs = QSettings("Chromalith", "Chromalith")
        self.library = load_user_library()
        self.project = Project()
        self.project_path: Path | None = None
        self.dirty = False
        self.hm = None

        self.settings_panel = SettingsPanel()
        self.settings_panel.set_settings(self.project.settings)
        self.settings_panel.changed.connect(self._settings_changed)
        self.settings_panel.invertRequested.connect(self.invert_height)
        scroll = QScrollArea()
        scroll.setWidget(self.settings_panel)
        scroll.setWidgetResizable(True)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        scroll.setMinimumWidth(400)

        self.view_result = ImageView()
        self.view_original = ImageView()
        self.view_3d = Preview3D()
        tab3d = QWidget()
        v3 = QVBoxLayout(tab3d)
        v3.setContentsMargins(0, 0, 0, 0)
        v3.addWidget(self.view_3d, 1)
        zrow = QHBoxLayout()
        zrow.addWidget(QLabel("Höhe überhöhen:"))
        self.z_slider = QSlider(Qt.Horizontal)
        self.z_slider.setRange(1, 20)
        self.z_slider.setValue(2)
        self.z_label = QLabel("2x")
        self.z_slider.valueChanged.connect(self._z_changed)
        zrow.addWidget(self.z_slider, 1)
        zrow.addWidget(self.z_label)
        v3.addLayout(zrow)
        self.tabs = QTabWidget()
        self.tabs.addTab(self.view_result, "Vorschau (Farben)")
        self.tabs.addTab(self.view_original, "Original")
        self.tabs.addTab(tab3d, "3D")
        self.analysis = AnalysisView()
        self.tabs.addTab(self.analysis, "Farbanalyse")

        self.layer_bar = LayerBar()
        self.layer_bar.changeMoved.connect(self.stack_move_change)
        self.stack = StackPanel()
        self.stack.changed.connect(self._plan_changed)
        self.stack.addRequested.connect(self.add_filaments)
        self.stack.autoRequested.connect(self.auto_distribute)
        right = QWidget()
        rh = QHBoxLayout(right)
        rh.addWidget(self.layer_bar)
        rh.addWidget(self.stack, 1)
        right.setMinimumWidth(430)

        split = QSplitter()
        split.addWidget(scroll)
        split.addWidget(self.tabs)
        split.addWidget(right)
        split.setStretchFactor(1, 1)
        split.setSizes([400, 680, 430])
        self.setCentralWidget(split)

        self.status = QLabel()
        self.statusBar().addWidget(self.status, 1)
        self._timer = QTimer(self, singleShot=True, interval=200)
        self._timer.timeout.connect(self.rebuild)
        self._build_menu()

        by_name = {f.name: f for f in self.library if f.brand == "Generisch"}
        start = [by_name.get(n) for n in ("Schwarz", "Grau dunkel", "Grau hell", "Weiß")]
        self.project.plan = ColorPlan([ColorStop(f, 1) for f in start if f])
        self.stack.set_plan(self.project.plan)
        self._update_title()
        self.resize(1500, 900)
        self.status.setText("Bild öffnen (Strg+O) oder Bild ins Fenster ziehen, um zu beginnen.")
        self.setAcceptDrops(True)

    # ------------------------------------------------------------------ Menü
    def _build_menu(self):
        m = self.menuBar().addMenu("&Datei")
        self._act(m, "Bild öffnen …", self.open_image, QKeySequence.Open)
        m.addSeparator()
        self._act(m, "Neues Projekt", self.new_project, QKeySequence.New)
        self._act(m, "Projekt öffnen …", self.open_project, "Ctrl+Shift+O")
        self._act(m, "Projekt speichern", self.save_project, QKeySequence.Save)
        self._act(m, "Projekt speichern unter …", lambda: self.save_project(True), QKeySequence.SaveAs)
        m.addSeparator()
        self._act(m, "Exportieren (STL + Farbwechsel-Liste) …", self.export, "Ctrl+E")
        m.addSeparator()
        self._act(m, "Beenden", self.close, QKeySequence.Quit)
        f = self.menuBar().addMenu("&Filamente")
        self._act(f, "Bibliothek verwalten …", self.manage_library, "Ctrl+L")
        self._act(f, "Filament zum Stapel hinzufügen …", self.add_filaments, "Ctrl+Shift+A")
        self._act(f, "Automatisch verteilen", self.auto_distribute, "Ctrl+Shift+D")
        h = self.menuBar().addMenu("&Hilfe")
        self._act(h, "Über Chromalith", self.about)

    def _act(self, menu, text, slot, shortcut=None):
        a = QAction(text, self)
        if shortcut:
            a.setShortcut(QKeySequence(shortcut))
        a.triggered.connect(slot)
        menu.addAction(a)
        return a

    # ------------------------------------------------------------------ Zustand
    def _update_title(self):
        name = self.project_path.name if self.project_path else self.project.name
        self.setWindowTitle(f"{'*' if self.dirty else ''}{name} – Chromalith {__version__}")

    def _mark_dirty(self):
        self.dirty = True
        self._update_title()

    def _settings_changed(self):
        self.settings_panel.apply_to(self.project.settings)
        self._mark_dirty()
        self._timer.start()

    def _plan_changed(self):
        self.project.plan = self.stack.plan
        self._mark_dirty()
        self._timer.start()

    def _z_changed(self, v):
        self.z_label.setText(f"{v}x")
        self.view_3d.set_z_scale(float(v))

    def _preview_project(self) -> Project:
        p = copy.copy(self.project)
        s = copy.copy(self.project.settings)
        s.pixel_size_mm = max(s.pixel_size_mm, s.width_mm / PREVIEW_MAX_SIDE)
        p.settings = s
        return p

    def rebuild(self):
        self.project.plan = self.stack.plan
        if self.project.image is None:
            return
        try:
            hm = self._preview_project().build()
        except ValueError as e:
            self.status.setText(f"⚠ {e}")
            return
        self.hm = hm
        self.stack.set_layer_info(hm.layer_count, hm.min_layer, hm.base_layer_mm, hm.layer_height_mm)
        plan = self.project.plan
        self.view_result.set_image(array_to_qimage(simulate_colors(hm, plan)))
        colors = []
        for layer in range(1, hm.layer_count + 1):
            f = plan.filament_at_layer(layer)
            colors.append(f.color if f else "#000000")
        changes = [s.start_layer for s in plan.normalized()[1:] if s.start_layer <= hm.layer_count]
        self.layer_bar.set_data(colors, hm.min_layer, changes)
        self.view_3d.set_model(hm, plan)
        self.analysis.update_result(hm, plan)
        eff = self.project.effective_height_mode()
        self.settings_panel.set_mode_label(eff)
        self.stack.set_color_mode(eff == "color")
        w, d = hm.size_mm
        mode = {"bright_high": "hell = hoch", "dark_high": "dunkel = hoch", "color": "farbtreu"}[eff]
        full_px = (self.project.settings.width_mm / self.project.settings.pixel_size_mm) ** 2 * d / max(w, 1e-6)
        self.status.setText(
            f"{w:.1f} x {d:.1f} mm · Höhe {hm.max_z:.2f} mm · {hm.layer_count} Schichten · {mode} · "
            f"Export ca. {full_px * 2 / 1e6:.1f} Mio. Dreiecke")

    # ------------------------------------------------------------------ Aktionen
    def _dir(self):
        return self.prefs.value("last_dir", str(Path.home()))

    def _remember_dir(self, path):
        self.prefs.setValue("last_dir", str(Path(path).parent))

    def dragEnterEvent(self, e):
        if e.mimeData().hasUrls():
            e.acceptProposedAction()

    def dropEvent(self, e):
        for url in e.mimeData().urls():
            p = url.toLocalFile()
            if p.lower().endswith(".chroma"):
                self._load_project(p)
            else:
                self._load_image(p)
            break

    def open_image(self):
        p, _ = QFileDialog.getOpenFileName(self, "Bild öffnen", self._dir(), IMAGE_FILTER)
        if p:
            self._load_image(p)

    def _load_image(self, p):
        try:
            img = load_image(p)
        except Exception as e:  # noqa: BLE001
            QMessageBox.warning(self, "Bild konnte nicht geladen werden", str(e))
            return
        self._remember_dir(p)
        self.project.image = img
        if self.project_path is None:
            self.project.name = Path(p).stem
        rgb = img.convert("RGB")
        from numpy import asarray
        self.view_original.set_image(array_to_qimage(asarray(rgb) / 255.0))
        self.analysis.update_image(img, self.library)
        first = not any(s.start_layer > 1 for s in self.stack.plan.stops)
        self.rebuild()
        if first:
            self.auto_distribute()
        self._mark_dirty()

    def new_project(self):
        if not self._confirm_discard():
            return
        plan = self.stack.plan
        self.project = Project(plan=ColorPlan([ColorStop(s.filament, 1) for s in plan.ordered()]))
        self.project_path = None
        self.settings_panel.set_settings(self.project.settings)
        self.stack.set_plan(self.project.plan)
        self.view_result.set_image(array_to_qimage(__import__("numpy").full((2, 2, 3), 0.17)))
        self.view_original.set_image(array_to_qimage(__import__("numpy").full((2, 2, 3), 0.17)))
        self.dirty = False
        self._update_title()

    def open_project(self):
        if not self._confirm_discard():
            return
        p, _ = QFileDialog.getOpenFileName(self, "Projekt öffnen", self._dir(), "Chromalith-Projekt (*.chroma)")
        if p:
            self._load_project(p)

    def _load_project(self, p):
        try:
            proj = Project.load(p)
        except Exception as e:  # noqa: BLE001
            QMessageBox.warning(self, "Projekt konnte nicht geladen werden", str(e))
            return
        self._remember_dir(p)
        self.project = proj
        self.project_path = Path(p)
        self.settings_panel.set_settings(proj.settings)
        self.stack.set_plan(proj.plan)
        if proj.image is not None:
            from numpy import asarray
            self.view_original.set_image(array_to_qimage(asarray(proj.image.convert("RGB")) / 255.0))
            self.analysis.update_image(proj.image, self.library)
        self.rebuild()
        self.dirty = False
        self._update_title()

    def save_project(self, save_as=False):
        if self.project_path is None or save_as:
            default = str(Path(self._dir()) / f"{self.project.name}.chroma")
            p, _ = QFileDialog.getSaveFileName(self, "Projekt speichern", default, "Chromalith-Projekt (*.chroma)")
            if not p:
                return False
            self.project_path = Path(p)
            self._remember_dir(p)
        self.project.plan = self.stack.plan
        self.project.name = self.project_path.stem
        self.project.save(self.project_path)
        self.dirty = False
        self._update_title()
        self.status.setText(f"Gespeichert: {self.project_path}")
        return True

    def export(self):
        if self.project.image is None:
            QMessageBox.information(self, "Kein Bild", "Bitte zuerst ein Bild öffnen.")
            return
        self.project.plan = self.stack.plan
        default = str(Path(self._dir()) / f"{self.project.name}.stl")
        p, _ = QFileDialog.getSaveFileName(self, "Exportieren", default, "STL (*.stl)")
        if not p:
            return
        self._remember_dir(p)
        QApplication.setOverrideCursor(Qt.WaitCursor)
        try:
            files = export_all(self.project, p)
        except Exception as e:  # noqa: BLE001
            QApplication.restoreOverrideCursor()
            QMessageBox.critical(self, "Export fehlgeschlagen", str(e))
            return
        QApplication.restoreOverrideCursor()
        QMessageBox.information(self, "Export fertig", "Geschrieben:\n\n" + "\n".join(str(f) for f in files)
                                + "\n\nDie Farbwechsel stehen in der _farbwechsel.txt.")

    def manage_library(self):
        d = LibraryDialog(self.library, self, select_mode=False)
        d.exec()
        if d.modified:
            save_user_library(self.library)

    def add_filaments(self):
        d = LibraryDialog(self.library, self, select_mode=True)
        ok = d.exec()
        if d.modified:
            save_user_library(self.library)
        if ok and d.selected():
            self.stack.add_filaments(d.selected())

    def stack_move_change(self, idx, layer):
        self.stack.set_start_layer(idx, layer)

    def auto_distribute(self):
        self.project.plan = self.stack.plan
        if self.project.image is None or not self.project.plan.stops:
            self.stack.refresh()
            return
        QApplication.setOverrideCursor(Qt.WaitCursor)
        try:
            prev = self.project.settings
            self.project.settings = self._preview_project().settings
            self.project.auto_distribute()
            self.project.settings = prev
        finally:
            QApplication.restoreOverrideCursor()
        self.stack.set_plan(self.project.plan)
        self._plan_changed()
        self.rebuild()

    def invert_height(self):
        cur = self.project.effective_height_mode()
        new = "dark_high" if cur == "bright_high" else "bright_high"
        self.project.settings.height_mode = new
        self.settings_panel.set_settings(self.project.settings)
        self._mark_dirty()
        self.rebuild()

    def about(self):
        QMessageBox.about(self, "Über Chromalith",
                          f"<b>Chromalith {__version__}</b><br>Farbige Reliefbilder aus Filament-Schichten "
                          "für den 3D-Druck.<br><br>Eigenständige Entwicklung.")

    def _confirm_discard(self) -> bool:
        if not self.dirty:
            return True
        r = QMessageBox.question(self, "Ungespeicherte Änderungen",
                                 "Das Projekt hat ungespeicherte Änderungen. Speichern?",
                                 QMessageBox.Save | QMessageBox.Discard | QMessageBox.Cancel)
        if r == QMessageBox.Save:
            return self.save_project()
        return r == QMessageBox.Discard

    def closeEvent(self, e):
        if self._confirm_discard():
            e.accept()
        else:
            e.ignore()
