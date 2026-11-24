"""Update-Prüfung in der Oberfläche (im Hintergrund, ohne das Fenster zu blockieren)."""

from __future__ import annotations

from PySide6.QtCore import QObject, QSettings, QThread, Signal
from PySide6.QtWidgets import QApplication, QMessageBox, QProgressDialog

from .. import __version__, updater


class _Worker(QObject):
    found = Signal(object)        # UpdateInfo oder None
    failed = Signal(str)
    progress = Signal(int, int)
    downloaded = Signal(str)

    def __init__(self, url, info=None):
        super().__init__()
        self.url, self.info = url, info

    def check(self):
        try:
            self.found.emit(updater.check_for_update(self.url))
        except Exception as e:  # noqa: BLE001
            self.failed.emit(str(e))

    def fetch(self):
        try:
            z = updater.download(self.info, lambda d, t: self.progress.emit(d, t))
            self.downloaded.emit(str(updater.extract(z)))
        except Exception as e:  # noqa: BLE001
            self.failed.emit(str(e))


class UpdateController(QObject):
    def __init__(self, window):
        super().__init__(window)
        self.window = window
        self.prefs = QSettings("Chromalith", "Chromalith")
        self._threads = []

    @property
    def manifest_url(self) -> str:
        return self.prefs.value("update_url", updater.DEFAULT_MANIFEST_URL)

    def _run(self, worker, method):
        t = QThread(self)
        worker.moveToThread(t)
        t.started.connect(getattr(worker, method))
        for sig in (worker.found, worker.failed, worker.downloaded):
            sig.connect(t.quit)
        t.finished.connect(lambda: self._threads.remove((t, worker)) if (t, worker) in self._threads else None)
        self._threads.append((t, worker))
        t.start()

    def check(self, silent: bool):
        """silent=True: beim Start, meldet sich nur, wenn es etwas Neues gibt."""
        if silent and self.prefs.value("auto_update_check", "true") != "true":
            return
        w = _Worker(self.manifest_url)
        w.found.connect(lambda info: self._on_found(info, silent))
        w.failed.connect(lambda msg: None if silent else QMessageBox.warning(
            self.window, "Update-Prüfung", f"Konnte nicht nach Updates suchen:\n{msg}"))
        self._run(w, "check")

    def _on_found(self, info, silent):
        if info is None:
            if not silent:
                QMessageBox.information(self.window, "Updates",
                                        f"Chromalith {__version__} ist aktuell.")
            return
        if silent and self.prefs.value("skip_version", "") == info.version:
            return
        box = QMessageBox(self.window)
        box.setWindowTitle("Update verfügbar")
        box.setText(f"<b>Chromalith {info.version}</b> ist verfügbar (installiert: {__version__}).")
        box.setInformativeText(info.notes or "")
        now = box.addButton("Jetzt aktualisieren", QMessageBox.AcceptRole)
        later = box.addButton("Später", QMessageBox.RejectRole)
        skip = box.addButton("Diese Version überspringen", QMessageBox.DestructiveRole)
        box.exec()
        if box.clickedButton() is skip:
            self.prefs.setValue("skip_version", info.version)
        elif box.clickedButton() is now:
            self._download(info)
        del later

    def _download(self, info):
        if not updater.can_self_update():
            QMessageBox.information(self.window, "Update",
                                    "Automatisches Aktualisieren geht nur in der Windows-Exe.\n"
                                    f"Neue Version herunterladen: {info.url}")
            return
        dlg = QProgressDialog("Update wird heruntergeladen …", "Abbrechen", 0, 100, self.window)
        dlg.setWindowTitle("Update")
        dlg.setMinimumDuration(0)
        w = _Worker(self.manifest_url, info)
        w.progress.connect(lambda d, t: dlg.setValue(int(d * 100 / t)) if t else None)
        w.failed.connect(lambda msg: (dlg.close(), QMessageBox.warning(
            self.window, "Update fehlgeschlagen", msg)))
        w.downloaded.connect(lambda path: (dlg.close(), self._install(path)))
        self._run(w, "fetch")

    def _install(self, new_dir):
        if not self.window._confirm_discard():
            return
        r = QMessageBox.question(self.window, "Update installieren",
                                 "Chromalith wird jetzt beendet, aktualisiert und neu gestartet.")
        if r != QMessageBox.Yes:
            return
        from pathlib import Path
        updater.apply_and_restart(Path(new_dir))
        self.window.dirty = False
        QApplication.quit()

    def toggle_auto(self, on: bool):
        self.prefs.setValue("auto_update_check", "true" if on else "false")
