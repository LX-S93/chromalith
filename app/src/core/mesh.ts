/** Höhenkarte -> geschlossenes (wasserdichtes) Dreiecksnetz und binäre STL. */
import type { HeightMap } from "./heightmap";

export interface Mesh {
  vertices: Float32Array; // 3 pro Vertex
  faces: Uint32Array; // 3 pro Dreieck, gegen den Uhrzeigersinn von außen
  topIndex: Int32Array; // je Vertex: Index im Höhenraster (-1 = Boden/Wand)
}

/** Funktioniert für beliebige Umrisse (Maske): Oberseite und Boden aus allen gültigen Zellen,
 *  Wände an jeder Zellkante ohne Nachbarn. */
export function heightmapToMesh(hm: HeightMap): Mesh {
  const { width: w, height: h, heights, pixel_size_mm: ps } = hm;
  const n = w * h;
  const valid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && (!hm.mask || hm.mask[y * w + x] === 1);
  const cellOk = (cx: number, cy: number) =>
    cx >= 0 && cy >= 0 && cx < w - 1 && cy < h - 1 && valid(cx, cy) && valid(cx + 1, cy) && valid(cx, cy + 1) && valid(cx + 1, cy + 1);
  const faces: number[] = [];
  const used = new Uint8Array(2 * n);
  const tri = (a: number, b: number, c: number) => { faces.push(a, b, c); used[a] = used[b] = used[c] = 1; };
  for (let cy = 0; cy < h - 1; cy++)
    for (let cx = 0; cx < w - 1; cx++) {
      if (!cellOk(cx, cy)) continue;
      // Bildzeile 0 = oben (größtes y). a: unten links, b: unten rechts, c: oben rechts, d: oben links
      const a = (cy + 1) * w + cx, b = (cy + 1) * w + cx + 1, c = cy * w + cx + 1, d = cy * w + cx;
      tri(a, b, c); tri(a, c, d);
      tri(a + n, c + n, b + n); tri(a + n, d + n, c + n);
      const edges: [number, number, number, number][] = [[a, b, 0, 1], [b, c, 1, 0], [c, d, 0, -1], [d, a, -1, 0]];
      for (const [p, q, dx, dy] of edges)
        if (!cellOk(cx + dx, cy + dy)) { tri(p + n, q + n, q); tri(p + n, q, p); }
    }
  const remap = new Int32Array(2 * n).fill(-1);
  let k = 0;
  for (let i = 0; i < 2 * n; i++) if (used[i]) remap[i] = k++;
  const vertices = new Float32Array(k * 3), topIndex = new Int32Array(k);
  for (let i = 0; i < 2 * n; i++) {
    const r = remap[i];
    if (r < 0) continue;
    const g = i % n, x = g % w, y = Math.floor(g / w);
    vertices[r * 3] = x * ps; vertices[r * 3 + 1] = (h - 1 - y) * ps; vertices[r * 3 + 2] = i < n ? heights[g] : hm.bottom ? hm.bottom[g] : 0;
    topIndex[r] = i < n ? g : -1;
  }
  return { vertices, faces: Uint32Array.from(faces, (v) => remap[v]), topIndex };
}

export function meshVolume(m: Mesh): number {
  let v = 0;
  const V = m.vertices;
  for (let i = 0; i < m.faces.length; i += 3) {
    const a = m.faces[i] * 3, b = m.faces[i + 1] * 3, c = m.faces[i + 2] * 3;
    v += V[a] * (V[b + 1] * V[c + 2] - V[b + 2] * V[c + 1]) - V[a + 1] * (V[b] * V[c + 2] - V[b + 2] * V[c]) + V[a + 2] * (V[b] * V[c + 1] - V[b + 1] * V[c]);
  }
  return v / 6;
}

export function writeStl(m: Mesh, name = "Chromalith"): Uint8Array {
  const nt = m.faces.length / 3;
  const buf = new ArrayBuffer(84 + nt * 50);
  const dv = new DataView(buf);
  const hdr = new TextEncoder().encode(name.slice(0, 80));
  new Uint8Array(buf, 0, 80).fill(32).set(hdr);
  dv.setUint32(80, nt, true);
  const V = m.vertices;
  let o = 84;
  for (let t = 0; t < nt; t++) {
    const a = m.faces[t * 3] * 3, b = m.faces[t * 3 + 1] * 3, c = m.faces[t * 3 + 2] * 3;
    const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2];
    const vx = V[c] - V[a], vy = V[c + 1] - V[a + 1], vz = V[c + 2] - V[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (const v of [nx, ny, nz, V[a], V[a + 1], V[a + 2], V[b], V[b + 1], V[b + 2], V[c], V[c + 1], V[c + 2]]) { dv.setFloat32(o, v, true); o += 4; }
    dv.setUint16(o, 0, true); o += 2;
  }
  return new Uint8Array(buf);
}
