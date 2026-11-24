"""Rauchtest der Oberfläche (läuft nur, wenn PySide6 und eine Anzeige verfügbar sind)."""
import os

import numpy as np
import pytest
from PIL import Image

pytest.importorskip("PySide6")
if os.name != "nt" and not os.environ.get("DISPLAY") and os.environ.get("QT_QPA_PLATFORM") != "offscreen":
    pytest.skip("keine Anzeige", allow_module_level=True)


def test_main_window(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path))
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    from PySide6.QtWidgets import QApplication
    app = QApplication.instance() or QApplication([])
    from chromalith.gui.main_window import MainWindow
    img = tmp_path / "bild.png"
    x = np.tile(np.linspace(0, 255, 120, dtype=np.uint8), (80, 1))
    Image.fromarray(x).save(img)
    w = MainWindow()
    w._load_image(str(img))
    app.processEvents()
    assert w.hm is not None and w.hm.layer_count > 5
    stops = w.stack.plan.ordered()
    assert len(stops) == 4 and stops[0].start_layer == 1
    assert [s.start_layer for s in stops] == sorted({s.start_layer for s in stops})
    w.project_path = tmp_path / "p.chroma"
    assert w.save_project()
    w.dirty = False
    w.close()


def test_sort_by_brightness(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path))
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    from PySide6.QtWidgets import QApplication
    app = QApplication.instance() or QApplication([])  # noqa: F841
    from chromalith.core.colorplan import ColorPlan, ColorStop
    from chromalith.core.filaments import Filament
    from chromalith.gui.stack_panel import StackPanel
    w, k, y = (Filament("W", "#ffffff", 4), Filament("K", "#000000", 0.5), Filament("Y", "#ffee00", 5))
    sp = StackPanel()
    sp.set_plan(ColorPlan([ColorStop(w, 1), ColorStop(k, 5), ColorStop(y, 9)]))
    assert not sp.is_monotonic()
    sp.sort_by_brightness()
    assert [s.filament.name for s in sp.plan.ordered()] == ["W", "Y", "K"]
    assert [s.start_layer for s in sp.plan.ordered()] == [1, 5, 9]
    assert sp.is_monotonic()


def test_slider_and_layerbar(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path))
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    from PySide6.QtWidgets import QApplication
    app = QApplication.instance() or QApplication([])
    from chromalith.gui.main_window import MainWindow
    img = tmp_path / "bild.png"
    Image.fromarray(np.tile(np.linspace(0, 255, 120, dtype=np.uint8), (80, 1))).save(img)
    w = MainWindow()
    w._load_image(str(img))
    sw = w.settings_panel.widgets["max_height_mm"]
    sw.slider.setValue(sw.slider.value() + 10)        # Schieberegler bewegt
    assert w.project.settings.max_height_mm == pytest.approx(sw.spin.value())
    w.rebuild()
    stops = w.stack.plan.ordered()
    target = stops[1].start_layer + 1
    w.layer_bar.changeMoved.emit(1, target)           # Linie in der Schichtleiste gezogen
    app.processEvents()
    assert w.stack.plan.ordered()[1].start_layer == target
    w.dirty = False
    w.close()


def test_invert_button_and_analysis(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path))
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    from PySide6.QtWidgets import QApplication
    app = QApplication.instance() or QApplication([])  # noqa: F841
    from chromalith.gui.main_window import MainWindow
    img = tmp_path / "bild.png"
    Image.fromarray(np.tile(np.linspace(0, 255, 120, dtype=np.uint8), (80, 1))).save(img)
    w = MainWindow()
    w._load_image(str(img))
    before = w.project.effective_height_mode()
    w.settings_panel.invert_btn.click()
    after = w.project.effective_height_mode()
    assert {before, after} == {"bright_high", "dark_high"}
    assert "dunkel = hoch" in w.settings_panel.invert_btn.text() or "hell = hoch" in w.settings_panel.invert_btn.text()
    assert w.analysis.use_table.rowCount() == 4
    assert w.analysis.img_table.rowCount() > 0
    w.dirty = False
    w.close()
