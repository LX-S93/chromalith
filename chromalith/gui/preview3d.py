"""3D-Vorschau des Modells mit simulierten Filamentfarben (OpenGL)."""

from __future__ import annotations

import numpy as np
from PySide6.QtCore import QPointF, Qt
from PySide6.QtOpenGLWidgets import QOpenGLWidget

try:
    from OpenGL import GL
except Exception:  # noqa: BLE001
    GL = None

from ..core.colorplan import simulate_colors
from ..core.mesh import heightmap_to_mesh


def vertex_normals(v, f):
    fn = np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]])
    vn = np.zeros_like(v)
    for k in range(3):
        np.add.at(vn, f[:, k], fn)
    n = np.linalg.norm(vn, axis=1, keepdims=True)
    return (vn / np.where(n == 0, 1, n)).astype(np.float32)


class Preview3D(QOpenGLWidget):
    MAX_SIDE = 450

    def __init__(self, parent=None):
        super().__init__(parent)
        self.yaw, self.pitch, self.dist = 0.0, -30.0, 2.3
        self.pan = np.zeros(2, dtype=np.float32)
        self.z_scale = 2.0
        self._last = QPointF()
        self._arrays = None
        self.setMinimumSize(300, 300)
        self.setToolTip("Linke Maustaste: drehen · Rechte Maustaste: verschieben · Mausrad: zoomen · Doppelklick: zurücksetzen")

    def set_z_scale(self, s: float):
        self.z_scale = s
        self.update()

    def set_model(self, hm, plan):
        small = hm.downsampled(self.MAX_SIDE)
        mesh = heightmap_to_mesh(small)
        v = mesh.vertices.copy()
        w, d = small.size_mm
        self._size = max(w, d)
        v[:, 0] -= w / 2
        v[:, 1] -= d / 2
        cols = np.full((len(v), 3), 0.55, dtype=np.float32)
        sim = simulate_colors(small, plan).reshape(-1, 3)
        ti = mesh.top_index
        cols[ti >= 0] = sim[ti[ti >= 0]]
        self._raw = (v, mesh.faces.astype(np.uint32), cols)
        self._arrays = None
        self.update()

    def _prepare(self):
        v, f, c = self._raw
        v = v.copy()
        v[:, 2] *= self.z_scale
        v /= self._size
        self._arrays = (np.ascontiguousarray(v, np.float32), np.ascontiguousarray(f.ravel()),
                        np.ascontiguousarray(c, np.float32),
                        vertex_normals(v, f.astype(np.int64)), self.z_scale)

    # ------------------------------------------------------------------ OpenGL
    def initializeGL(self):
        if GL is None:
            return
        GL.glClearColor(0.17, 0.17, 0.19, 1)
        GL.glEnable(GL.GL_DEPTH_TEST)
        GL.glEnable(GL.GL_LIGHTING)
        GL.glEnable(GL.GL_LIGHT0)
        GL.glEnable(GL.GL_COLOR_MATERIAL)
        GL.glColorMaterial(GL.GL_FRONT_AND_BACK, GL.GL_AMBIENT_AND_DIFFUSE)
        GL.glLightfv(GL.GL_LIGHT0, GL.GL_AMBIENT, (0.35, 0.35, 0.35, 1))
        GL.glLightfv(GL.GL_LIGHT0, GL.GL_DIFFUSE, (0.75, 0.75, 0.75, 1))
        GL.glEnable(GL.GL_NORMALIZE)

    def resizeGL(self, w, h):
        if GL is None:
            return
        GL.glViewport(0, 0, w, h)

    def paintGL(self):
        if GL is None:
            return
        GL.glClear(GL.GL_COLOR_BUFFER_BIT | GL.GL_DEPTH_BUFFER_BIT)
        GL.glMatrixMode(GL.GL_PROJECTION)
        GL.glLoadIdentity()
        aspect = self.width() / max(1, self.height())
        near = 0.05
        top = near * np.tan(np.radians(22.5))
        GL.glFrustum(-top * aspect, top * aspect, -top, top, near, 50)
        GL.glMatrixMode(GL.GL_MODELVIEW)
        GL.glLoadIdentity()
        GL.glLightfv(GL.GL_LIGHT0, GL.GL_POSITION, (0.3, 0.6, 1.0, 0.0))
        GL.glTranslatef(self.pan[0], self.pan[1], -self.dist)
        GL.glRotatef(self.pitch, 1, 0, 0)
        GL.glRotatef(self.yaw, 0, 0, 1)
        if getattr(self, "_raw", None) is None:
            return
        if self._arrays is None or self._arrays[4] != self.z_scale:
            self._prepare()
        v, f, c, n, _ = self._arrays
        GL.glEnableClientState(GL.GL_VERTEX_ARRAY)
        GL.glEnableClientState(GL.GL_COLOR_ARRAY)
        GL.glEnableClientState(GL.GL_NORMAL_ARRAY)
        GL.glVertexPointer(3, GL.GL_FLOAT, 0, v)
        GL.glColorPointer(3, GL.GL_FLOAT, 0, c)
        GL.glNormalPointer(GL.GL_FLOAT, 0, n)
        GL.glDrawElements(GL.GL_TRIANGLES, len(f), GL.GL_UNSIGNED_INT, f)
        GL.glDisableClientState(GL.GL_VERTEX_ARRAY)
        GL.glDisableClientState(GL.GL_COLOR_ARRAY)
        GL.glDisableClientState(GL.GL_NORMAL_ARRAY)

    # ------------------------------------------------------------------ Maus
    def mousePressEvent(self, e):
        self._last = e.position()

    def mouseMoveEvent(self, e):
        d = e.position() - self._last
        self._last = e.position()
        if e.buttons() & Qt.LeftButton:
            self.yaw += d.x() * 0.4
            self.pitch = max(-90.0, min(0.0, self.pitch + d.y() * 0.4))
        elif e.buttons() & (Qt.RightButton | Qt.MiddleButton):
            self.pan += np.array([d.x(), -d.y()], np.float32) * 0.002 * self.dist
        self.update()

    def wheelEvent(self, e):
        self.dist *= 0.9 if e.angleDelta().y() > 0 else 1.1
        self.dist = max(0.2, min(10.0, self.dist))
        self.update()

    def mouseDoubleClickEvent(self, _):
        self.yaw, self.pitch, self.dist = 0.0, -30.0, 2.3
        self.pan[:] = 0
        self.update()
