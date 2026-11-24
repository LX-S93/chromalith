"""Startpunkt der grafischen Oberfläche."""

import sys

from PySide6.QtGui import QSurfaceFormat
from PySide6.QtWidgets import QApplication


def main() -> int:
    fmt = QSurfaceFormat()
    fmt.setDepthBufferSize(24)
    fmt.setSamples(4)
    QSurfaceFormat.setDefaultFormat(fmt)
    app = QApplication(sys.argv)
    app.setApplicationName("Chromalith")
    app.setOrganizationName("Chromalith")
    app.setStyle("Fusion")
    from .gui.main_window import MainWindow
    w = MainWindow()
    w.show()
    if len(sys.argv) > 1:
        p = sys.argv[1]
        (w._load_project if p.lower().endswith(".chroma") else w._load_image)(p)
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
