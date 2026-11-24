"""Höhenkarte -> geschlossenes (wasserdichtes) Dreiecksnetz und STL-Export."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .heightmap import HeightMap


@dataclass
class Mesh:
    vertices: np.ndarray   # (n, 3) float32
    faces: np.ndarray      # (m, 3) int64, gegen den Uhrzeigersinn von außen gesehen

    def triangles(self) -> np.ndarray:
        return self.vertices[self.faces]

    def normals(self) -> np.ndarray:
        t = self.triangles()
        n = np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0])
        length = np.linalg.norm(n, axis=1, keepdims=True)
        return n / np.where(length == 0, 1, length)

    def volume(self) -> float:
        t = self.triangles().astype(np.float64)
        return float(np.einsum("ij,ij->i", t[:, 0], np.cross(t[:, 1], t[:, 2])).sum() / 6.0)


def _perimeter(ny: int, nx: int) -> np.ndarray:
    """Randindizes (j, i) gegen den Uhrzeigersinn in der x/y-Ebene."""
    # Zeile j=ny-1 liegt bei y=0 (unten). Start unten links, nach rechts, dann hoch ...
    bottom = [(ny - 1, i) for i in range(nx)]
    right = [(j, nx - 1) for j in range(ny - 2, -1, -1)]
    top = [(0, i) for i in range(nx - 2, -1, -1)]
    left = [(j, 0) for j in range(1, ny - 1)]
    return np.array(bottom + right + top + left, dtype=np.int64)


def heightmap_to_mesh(hm: HeightMap) -> Mesh:
    h = hm.heights
    ny, nx = h.shape
    ps = hm.pixel_size_mm
    jj, ii = np.mgrid[0:ny, 0:nx]
    x = ii * ps
    y = (ny - 1 - jj) * ps           # Bildzeile 0 = oben
    top = np.stack([x, y, h], axis=-1).reshape(-1, 3)

    idx = np.arange(ny * nx).reshape(ny, nx)
    a = idx[1:, :-1]   # unten links (kleineres y)
    b = idx[1:, 1:]    # unten rechts
    c = idx[:-1, 1:]   # oben rechts
    d = idx[:-1, :-1]  # oben links
    top_faces = np.concatenate([
        np.stack([a, b, c], -1).reshape(-1, 3),
        np.stack([a, c, d], -1).reshape(-1, 3),
    ])

    per = _perimeter(ny, nx)
    per_top = idx[per[:, 0], per[:, 1]]
    n_top = ny * nx
    per_bottom_v = top[per_top].copy()
    per_bottom_v[:, 2] = 0.0
    bottom_idx = n_top + np.arange(len(per))
    center_idx = n_top + len(per)
    center = np.array([[(nx - 1) * ps / 2, (ny - 1) * ps / 2, 0.0]])

    nxt = np.roll(np.arange(len(per)), -1)
    # Wände: Rand läuft gegen den Uhrzeigersinn, Außenseite zeigt nach außen.
    t0, t1 = per_top, per_top[nxt]
    b0, b1 = bottom_idx, bottom_idx[nxt]
    walls = np.concatenate([np.stack([b0, b1, t1], -1), np.stack([b0, t1, t0], -1)])
    # Boden: Fächer, Normale nach unten -> im Uhrzeigersinn von oben gesehen.
    bottom_faces = np.stack([np.full(len(per), center_idx), b1, b0], -1)

    vertices = np.concatenate([top, per_bottom_v, center]).astype(np.float32)
    faces = np.concatenate([top_faces, walls, bottom_faces]).astype(np.int64)
    return Mesh(vertices, faces)


def write_stl(mesh: Mesh, path, name: str = "Chromalith") -> None:
    """Schreibt eine binäre STL-Datei."""
    tris = mesh.triangles().astype(np.float32)
    normals = mesh.normals().astype(np.float32)
    record = np.dtype([("n", "<f4", 3), ("v", "<f4", (3, 3)), ("attr", "<u2")])
    data = np.zeros(len(tris), dtype=record)
    data["n"] = normals
    data["v"] = tris
    header = name.encode("ascii", "replace")[:80].ljust(80, b" ")
    with open(path, "wb") as f:
        f.write(header)
        f.write(np.uint32(len(tris)).tobytes())
        f.write(data.tobytes())


def read_stl(path) -> np.ndarray:
    """Liest eine binäre STL (für Tests). Gibt (m, 3, 3) zurück."""
    with open(path, "rb") as f:
        f.read(80)
        n = int(np.frombuffer(f.read(4), "<u4")[0])
        record = np.dtype([("n", "<f4", 3), ("v", "<f4", (3, 3)), ("attr", "<u2")])
        return np.frombuffer(f.read(n * record.itemsize), dtype=record)["v"]
