"""Kleine wiederverwendbare Widgets."""

from __future__ import annotations

import numpy as np
from PySide6.QtCore import QRectF, Qt, Signal
from PySide6.QtGui import QColor, QImage, QPainter, QPen, QPixmap
from PySide6.QtWidgets import QGraphicsPixmapItem, QGraphicsScene, QGraphicsView, QWidget


def array_to_qimage(rgb: np.ndarray) -> QImage:
    a = np.ascontiguousarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8))
    h, w, _ = a.shape
    img = QImage(a.data, w, h, 3 * w, QImage.Format_RGB888)
    return img.copy()


class Swatch(QWidget):
    def __init__(self, color: str = "#808080", size: int = 18, parent=None):
        super().__init__(parent)
        self.color = color
        self.setFixedSize(size, size)

    def set_color(self, color: str):
        self.color = color
        self.update()

    def paintEvent(self, _):
        p = QPainter(self)
        p.setPen(QPen(QColor("#444"), 1))
        p.setBrush(QColor(self.color))
        p.drawRoundedRect(QRectF(0.5, 0.5, self.width() - 1, self.height() - 1), 3, 3)


class ImageView(QGraphicsView):
    """Zoombare Bildansicht (Mausrad = Zoom, Ziehen = Verschieben)."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setScene(QGraphicsScene(self))
        self.item = QGraphicsPixmapItem()
        self.item.setTransformationMode(Qt.SmoothTransformation)
        self.scene().addItem(self.item)
        self.setDragMode(QGraphicsView.ScrollHandDrag)
        self.setBackgroundBrush(QColor("#2b2b2b"))
        self._fit = True

    def set_image(self, img: QImage):
        first = self.item.pixmap().isNull()
        self.item.setPixmap(QPixmap.fromImage(img))
        self.scene().setSceneRect(self.item.boundingRect())
        if first or self._fit:
            self.fitInView(self.item, Qt.KeepAspectRatio)

    def wheelEvent(self, e):
        self._fit = False
        f = 1.2 if e.angleDelta().y() > 0 else 1 / 1.2
        self.scale(f, f)

    def mouseDoubleClickEvent(self, _):
        self._fit = True
        self.fitInView(self.item, Qt.KeepAspectRatio)

    def resizeEvent(self, e):
        super().resizeEvent(e)
        if self._fit and not self.item.pixmap().isNull():
            self.fitInView(self.item, Qt.KeepAspectRatio)


class LayerBar(QWidget):
    """Senkrechte Leiste: zeigt, welches Filament in welcher Schicht liegt."""

    layerClicked = Signal(int)
    changeMoved = Signal(int, int)   # (Nummer des Wechsels ab 1, neue Startschicht)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setMinimumWidth(56)
        self.colors: list[str] = []      # Farbe je Schicht (Index 0 = Schicht 1)
        self.min_layer = 1
        self.changes: list[int] = []
        self._drag = None
        self.setMouseTracking(True)
        self.setToolTip("Schichtfolge (unten = Schicht 1). Die Wechsel-Linien lassen sich mit der Maus verschieben.")

    def set_data(self, colors, min_layer, changes):
        self.colors, self.min_layer, self.changes = list(colors), min_layer, list(changes)
        self.update()

    def _layer_at(self, y):
        n = len(self.colors)
        if n == 0:
            return 0
        return max(1, min(n, int((self.height() - y) / self.height() * n) + 1))

    def _change_near(self, y):
        n = len(self.colors)
        if not n:
            return None
        lh = self.height() / n
        best = None
        for i, layer in enumerate(self.changes):
            ly = self.height() - (layer - 1) * lh
            if abs(ly - y) <= max(6, lh / 2) and (best is None or abs(ly - y) < best[1]):
                best = (i, abs(ly - y))
        return None if best is None else best[0]

    def mousePressEvent(self, e):
        y = e.position().y()
        self._drag = self._change_near(y)
        if self._drag is None:
            layer = self._layer_at(y)
            if layer:
                self.layerClicked.emit(layer)

    def mouseMoveEvent(self, e):
        y = e.position().y()
        if self._drag is not None and e.buttons() & Qt.LeftButton:
            n = len(self.colors)
            layer = max(2, min(n, int(round((self.height() - y) / self.height() * n)) + 1))
            if layer != self.changes[self._drag]:
                self.changeMoved.emit(self._drag + 1, layer)
        else:
            self.setCursor(Qt.SizeVerCursor if self._change_near(y) is not None else Qt.ArrowCursor)

    def mouseReleaseEvent(self, _):
        self._drag = None

    def paintEvent(self, _):
        p = QPainter(self)
        n = len(self.colors)
        if not n:
            return
        w, h = self.width() - 24, self.height()
        lh = h / n
        for i, c in enumerate(self.colors):
            y = h - (i + 1) * lh
            p.fillRect(QRectF(0, y, w, lh + 0.5), QColor(c))
        p.fillRect(QRectF(0, h - (self.min_layer - 1) * lh, w, (self.min_layer - 1) * lh),
                   QColor(0, 0, 0, 60))
        for layer in self.changes:
            y = h - (layer - 1) * lh
            p.setPen(QColor("#888"))
            p.drawLine(0, int(y), self.width(), int(y))
            p.setPen(self.palette().windowText().color())
            p.drawText(QRectF(w + 2, y - 14, 22, 14), Qt.AlignLeft, str(layer))
