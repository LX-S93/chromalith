/** Lentikularbild: eine gerippte Oberfläche aus dreieckigen Rippen, die von oben nach unten laufen. Die linken
 *  Flanken tragen Bild 1, die rechten Bild 2. Von links sieht man das eine, von rechts das andere Motiv, von vorn
 *  beide ineinander.
 *
 *  Anders als beim Farbrelief entsteht die Farbe hier nicht aus der Höhe: Jede Flanke hat an jeder Stelle genau
 *  ein Filament. In einer Schicht liegen deshalb mehrere Farben nebeneinander, gedruckt wird mit einem
 *  Filamentwechsler (AMS). Exportiert wird ein Teil je Filament; im Slicer werden sie als ein Objekt aus mehreren
 *  Teilen geladen. */
import { hexToRgb, linearToSrgb, srgbToLab, srgbToLinear } from "./color";
import type { HeightSettings } from "./heightmap";
import type { Mesh } from "./mesh";
import { OPACITY_K } from "./plan";
import { coverResize, type Raster } from "./raster";

/** Höhe einer Bildzeile entlang der Rippe (mm): etwa eine Druckbahn */
export const LENTI_ROW_MM = 0.4;
/** Schmalste Bildspalte auf einer Flanke (mm): Breite Flanken tragen mehrere Spalten nebeneinander */
export const LENTI_COL_MM = 0.5;
/** Dünnste farbige Lage unter den Rippen (mm): Auch im Tal liegt Farbe, nicht die Grundplatte */
export const LENTI_SKIN_MM = 0.2;
/** Schichthöhe, für die Platte und Farbschicht ausgelegt sind und mit der der Druckaufwand geschätzt wird (mm) */
export const LENTI_LAYER_MM = 0.2;

export interface LentiModel {
  /** Rippen, Bildspalten je Flanke, Spalten je Bild (cols × sub) und Zeilen */
  cols: number;
  sub: number;
  icols: number;
  rows: number;
  /** Breite einer Rippe und Höhe einer Zeile in mm */
  pitch: number;
  dy: number;
  base: number;
  skin: number;
  height: number;
  /** Größe des Drucks in mm (Breite, Höhe des Bildes) */
  width: number;
  depth: number;
  /** Farbe (Index in der Palette) je Bildspalte und Zeile: a = linke Flanken (Bild 1), b = rechte Flanken (Bild 2) */
  a: Uint8Array;
  b: Uint8Array;
  /** Anteil jeder Palettenfarbe an der Oberfläche (0..1) */
  share: number[];
}

/** Palettenfarbe für Vorschau und 3D-Ansicht: nur der Farbton (deckend) oder ein Filament mit seinem TD */
export type LentiColor = string | { color: string; td: number };
const hexOf = (c: LentiColor) => (typeof c === "string" ? c : c.color);
const labOfHex = (c: string) => { const v = hexToRgb(c), l = [0, 0, 0]; srgbToLab(v[0], v[1], v[2], l); return l; };

/** Hellste Farbe der Palette: Sie füllt durchsichtige Stellen und ist die empfohlene Farbe der Grundplatte. */
export function lentiLightest(colors: LentiColor[]): number {
  let best = 0, bl = -Infinity;
  colors.forEach((c, i) => { const l = labOfHex(hexOf(c))[0]; if (l > bl) { bl = l; best = i; } });
  return best;
}

/** Ordnet jedem Bildpunkt die ähnlichste Palettenfarbe zu (Abstand im Lab-Farbraum). Durchsichtige Stellen bekommen
 *  die hellste Farbe. `aspect` ist das Seitenverhältnis der Fläche: Die Bildpunkte sind nicht quadratisch. */
export function lentiIndex(img: Raster, cols: number, rows: number, colors: string[], aspect = cols / rows): Uint8Array {
  const r = coverResize(img, cols, rows, aspect), out = new Uint8Array(cols * rows);
  const labs = colors.map(labOfHex), lightest = lentiLightest(colors);
  const px = [0, 0, 0];
  for (let i = 0; i < cols * rows; i++) {
    if (r.data[i * 4 + 3] < 0.5) { out[i] = lightest; continue; }
    srgbToLab(r.data[i * 4], r.data[i * 4 + 1], r.data[i * 4 + 2], px);
    let best = 0, bd = Infinity;
    for (let k = 0; k < labs.length; k++) {
      const d = (px[0] - labs[k][0]) ** 2 + (px[1] - labs[k][1]) ** 2 + (px[2] - labs[k][2]) ** 2;
      if (d < bd) { bd = d; best = k; }
    }
    out[i] = best;
  }
  return out;
}

/** Baut das Lentikularbild aus zwei Bildern und einer Palette (Filamentfarben). Fehlt das zweite Bild, tragen beide
 *  Flanken das erste. Das zweite Bild füllt die Fläche des ersten; was übersteht, wird mittig abgeschnitten. */
export function lentiModel(first: Raster, second: Raster | null, colors: string[], s: HeightSettings): LentiModel {
  if (!colors.length) throw new Error("Für das Lentikularbild braucht der Stapel mindestens ein Filament.");
  if (colors.length > 255) colors = colors.slice(0, 255);
  const pitch = Math.max(0.8, s.lenti_pitch_mm), cols = Math.max(2, Math.round(s.width_mm / pitch));
  const sub = Math.max(1, Math.floor(pitch / 2 / LENTI_COL_MM + 1e-6)), icols = cols * sub;
  const width = cols * pitch, depth = (width * first.height) / first.width;
  const rows = Math.max(1, Math.round(depth / LENTI_ROW_MM));
  const a = lentiIndex(first, icols, rows, colors, width / depth), b = second ? lentiIndex(second, icols, rows, colors, width / depth) : a.slice();
  const share = colors.map(() => 0);
  for (let i = 0; i < a.length; i++) { share[a[i]] += 0.5 / a.length; share[b[i]] += 0.5 / a.length; }
  return { cols, sub, icols, rows, pitch, dy: depth / rows, base: Math.max(0.2, s.lenti_base_mm), skin: Math.max(LENTI_SKIN_MM, s.lenti_skin_mm ?? LENTI_SKIN_MM), height: Math.max(0.2, s.lenti_height_mm), width, depth, a, b, share };
}

/** Geschlossenes Netz aus Säulen über einem Raster von nx × ny Zellen. `zTop` ist die Oberseite je Rasterlinie in x
 *  (die Oberfläche hängt nur von x ab), `zBot` die ebene Unterseite, `has` sagt, welche Zellen dazugehören.
 *  Zeile 0 liegt oben (größtes y), wie im Bild. */
export function columnMesh(nx: number, ny: number, dx: number, dy: number, zTop: (vx: number) => number, zBot: number, has: (cx: number, cy: number) => boolean): Mesh | null {
  const W = nx + 1, N = W * (ny + 1);
  const ok = (cx: number, cy: number) => cx >= 0 && cy >= 0 && cx < nx && cy < ny && has(cx, cy);
  const faces: number[] = [];
  const used = new Uint8Array(2 * N);
  const tri = (p: number, q: number, r: number) => { faces.push(p, q, r); used[p] = used[q] = used[r] = 1; };
  for (let cy = 0; cy < ny; cy++)
    for (let cx = 0; cx < nx; cx++) {
      if (!ok(cx, cy)) continue;
      const a = (cy + 1) * W + cx, b = (cy + 1) * W + cx + 1, c = cy * W + cx + 1, d = cy * W + cx;
      tri(a, b, c); tri(a, c, d);
      tri(a + N, c + N, b + N); tri(a + N, d + N, c + N);
      const edges: [number, number, number, number][] = [[a, b, 0, 1], [b, c, 1, 0], [c, d, 0, -1], [d, a, -1, 0]];
      for (const [p, q, ex, ey] of edges)
        if (!ok(cx + ex, cy + ey)) { tri(p + N, q + N, q); tri(p + N, q, p); }
    }
  if (!faces.length) return null;
  const remap = new Int32Array(2 * N).fill(-1);
  let k = 0;
  for (let i = 0; i < 2 * N; i++) if (used[i]) remap[i] = k++;
  const vertices = new Float32Array(k * 3);
  for (let i = 0; i < 2 * N; i++) {
    const r = remap[i];
    if (r < 0) continue;
    const g = i % N, vx = g % W, vy = Math.floor(g / W);
    vertices[r * 3] = vx * dx; vertices[r * 3 + 1] = (ny - vy) * dy; vertices[r * 3 + 2] = i < N ? zTop(vx) : zBot;
  }
  return { vertices, faces: Uint32Array.from(faces, (v) => remap[v]), topIndex: new Int32Array(k).fill(-1) };
}

/** Das Raster hat je Rippe 2 × sub Zellen: erst die Spalten der linken Flanke (Tal → Grat), dann die der rechten. */
const cellsX = (m: LentiModel) => m.cols * 2 * m.sub;
const cellDx = (m: LentiModel) => m.pitch / (2 * m.sub);
/** Oberseite an der Rasterlinie vx: vom Tal gleichmäßig zum Grat in der Mitte der Rippe und wieder hinab */
const ridgeZ = (m: LentiModel) => (vx: number) => { const n = 2 * m.sub, j = vx % n; return m.base + m.skin + (m.height * (j <= m.sub ? j : n - j)) / m.sub; };
/** Palettenfarbe einer Zelle: linke Hälfte jeder Rippe = Bild 1, rechte Hälfte = Bild 2 */
const cellColor = (m: LentiModel, cx: number, cy: number) => {
  const n = 2 * m.sub, j = cx % n, col = Math.floor(cx / n) * m.sub;
  return j < m.sub ? m.a[col + j + cy * m.icols] : m.b[col + j - m.sub + cy * m.icols];
};

/** Druckteile: die Grundplatte und je Palettenfarbe ein Teil (null, wenn die Farbe nicht vorkommt). Die Teile
 *  berühren sich lückenlos und überlappen nicht. */
export function lentiParts(m: LentiModel, colors: number): { base: Mesh; parts: (Mesh | null)[] } {
  const base = columnMesh(1, 1, m.width, m.depth, () => m.base, 0, () => true)!;
  const parts: (Mesh | null)[] = [];
  for (let k = 0; k < colors; k++)
    parts.push(m.share[k] > 0 ? columnMesh(cellsX(m), m.rows, cellDx(m), m.dy, ridgeZ(m), m.base, (cx, cy) => cellColor(m, cx, cy) === k) : null);
  return { base, parts };
}

/** Sichtbarer Anteil der linken und rechten Flanken bei einem Blick von der Seite. `angleDeg` > 0: Betrachter steht
 *  links. Dazu die Helligkeit beider Flanken (Licht aus Blickrichtung). */
export function lentiVisible(m: LentiModel, angleDeg: number): { left: number; right: number; shadeL: number; shadeR: number } {
  const t = (Math.max(-85, Math.min(85, angleDeg)) * Math.PI) / 180, half = m.pitch / 2, len = Math.hypot(half, m.height);
  const wl = Math.max(0, half * Math.cos(t) + m.height * Math.sin(t)), wr = Math.max(0, half * Math.cos(t) - m.height * Math.sin(t));
  const sum = wl + wr || 1;
  return { left: wl / sum, right: wr / sum, shadeL: 0.55 + 0.45 * (wl / len), shadeR: 0.55 + 0.45 * (wr / len) };
}
/** Ab diesem Winkel zur Seite (Grad) ist nur noch eines der beiden Bilder zu sehen. */
export const lentiPureAngle = (m: LentiModel) => (Math.atan2(m.pitch / 2, m.height) * 180) / Math.PI;

/** Sichtbare Farbe (sRGB) je Palettenfarbe und Bildspalte der Flanke, Spalte 0 liegt am Tal. Am Tal ist die farbige
 *  Lage dünn: Durchscheinende Filamente lassen dort die Grundplatte durch. Gerechnet wird mit einer Grundplatte in
 *  der hellsten Farbe der Palette (oder `base`); Farben ohne TD gelten als deckend. */
export function lentiShades(m: LentiModel, palette: LentiColor[], base?: string): Float32Array[] {
  const b = hexToRgb(base ?? hexOf(palette[lentiLightest(palette)])).map(srgbToLinear);
  return palette.map((p) => {
    const rgb = hexToRgb(hexOf(p)), out = new Float32Array(m.sub * 3);
    for (let j = 0; j < m.sub; j++) {
      const through = baseShare(m, p, j);
      for (let c = 0; c < 3; c++) out[j * 3 + c] = linearToSrgb(b[c] * through + srgbToLinear(rgb[c]) * (1 - through));
    }
    return out;
  });
}
/** Anteil der Grundplatte an der sichtbaren Farbe in Bildspalte j einer Flanke (0 = am Tal): Mittel über ihre Dicken */
function baseShare(m: LentiModel, p: LentiColor, j: number): number {
  if (typeof p === "string") return 0;
  const k = OPACITY_K / Math.max(p.td, 0.05), t0 = m.skin + (m.height * j) / m.sub, t1 = m.skin + (m.height * (j + 1)) / m.sub;
  return (Math.exp(-k * t0) - Math.exp(-k * t1)) / (k * (t1 - t0));
}
/** Wie stark die Grundplatte im Mittel durch die Farben scheint (0..1), gewichtet mit der Fläche jeder Farbe. Die
 *  hellste Farbe zählt nicht mit: In ihr wird die Grundplatte gedruckt. */
export function lentiThrough(m: LentiModel, palette: LentiColor[]): number {
  const light = lentiLightest(palette);
  let sum = 0, area = 0;
  palette.forEach((p, k) => {
    if (k === light || !(m.share[k] > 0)) return;
    let t = 0;
    for (let j = 0; j < m.sub; j++) t += baseShare(m, p, j) / m.sub;
    sum += t * m.share[k]; area += m.share[k];
  });
  return area > 0 ? sum / area : 0;
}

/** Ansicht aus einem Blickwinkel als Bild (sRGB, 3/Punkt): jede Rippe `px` Punkte breit. Die sichtbare Breite
 *  jeder Flanke teilen sich ihre Bildspalten gleichmäßig. */
export function lentiView(m: LentiModel, colors: LentiColor[], angleDeg: number, px = Math.max(8, 4 * m.sub)): { rgb: Float32Array; width: number; height: number } {
  const width = m.cols * px, height = Math.max(1, Math.round((width * m.depth) / m.width));
  const v = lentiVisible(m, angleDeg), shades = lentiShades(m, colors), rgb = new Float32Array(width * height * 3);
  // Spalte im Bild und Flanke für jeden Punkt einer Rippe
  const sideOf = new Uint8Array(px), colOf = new Uint16Array(px);
  for (let k = 0; k < px; k++) {
    const f = (k + 0.5) / px, left = f < v.left;
    sideOf[k] = left ? 0 : 1;
    colOf[k] = Math.min(m.sub - 1, Math.floor(((left ? f / v.left : (f - v.left) / (v.right || 1)) * m.sub)));
  }
  for (let y = 0; y < height; y++) {
    const row = Math.min(m.rows - 1, Math.floor(((y + 0.5) / height) * m.rows)) * m.icols;
    for (let x = 0; x < width; x++) {
      const k = x % px, j = colOf[k], i = Math.floor(x / px) * m.sub + j, left = !sideOf[k];
      // linke Flanke: Spalte 0 am Tal; rechte Flanke: Spalte 0 am Grat
      const c = shades[(left ? m.a : m.b)[row + i]], q = (left ? j : m.sub - 1 - j) * 3, sh = left ? v.shadeL : v.shadeR, o = (y * width + x) * 3;
      rgb[o] = c[q] * sh; rgb[o + 1] = c[q + 1] * sh; rgb[o + 2] = c[q + 2] * sh;
    }
  }
  return { rgb, width, height };
}

/** Netz für die 3D-Ansicht: die gerippte Oberfläche mit der Farbe jeder Flanke (jede Zelle hat eigene Eckpunkte,
 *  damit die Farben nicht ineinanderlaufen), dazu Seitenwände und Boden in Grau. */
export function lentiPreviewMesh(m: LentiModel, colors: LentiColor[], maxCells = 160000): { vertices: Float32Array; faces: Uint32Array; colors: Float32Array } {
  const nx = cellsX(m), step = Math.max(1, Math.ceil((nx * m.rows) / maxCells)), ny = Math.ceil(m.rows / step);
  const shades = lentiShades(m, colors), z = ridgeZ(m), dx = cellDx(m), n = 2 * m.sub;
  const V: number[] = [], C: number[] = [], F: number[] = [];
  const quad = (p: number[][], c: ArrayLike<number>, co = 0) => {
    const o = V.length / 3;
    for (const q of p) { V.push(q[0], q[1], q[2]); C.push(c[co], c[co + 1], c[co + 2]); }
    F.push(o, o + 1, o + 2, o, o + 2, o + 3);
  };
  const grey = [0.55, 0.55, 0.55];
  for (let ry = 0; ry < ny; ry++) {
    const cy = Math.min(m.rows - 1, ry * step), y1 = m.depth - ry * step * m.dy, y0 = Math.max(0, m.depth - (ry + 1) * step * m.dy);
    for (let cx = 0; cx < nx; cx++) {
      const x0 = cx * dx, x1 = x0 + dx;
      const j = cx % n;
      quad([[x0, y0, z(cx)], [x1, y0, z(cx + 1)], [x1, y1, z(cx + 1)], [x0, y1, z(cx)]], shades[cellColor(m, cx, cy)], (j < m.sub ? j : n - 1 - j) * 3);
    }
  }
  for (let cx = 0; cx < nx; cx++) {
    const x0 = cx * dx, x1 = x0 + dx;
    quad([[x0, 0, 0], [x1, 0, 0], [x1, 0, z(cx + 1)], [x0, 0, z(cx)]], grey);
    quad([[x1, m.depth, 0], [x0, m.depth, 0], [x0, m.depth, z(cx)], [x1, m.depth, z(cx + 1)]], grey);
  }
  quad([[0, m.depth, 0], [0, 0, 0], [0, 0, z(0)], [0, m.depth, z(0)]], grey);
  quad([[m.width, 0, 0], [m.width, m.depth, 0], [m.width, m.depth, z(nx)], [m.width, 0, z(nx)]], grey);
  quad([[0, m.depth, 0], [m.width, m.depth, 0], [m.width, 0, 0], [0, 0, 0]], grey);
  return { vertices: Float32Array.from(V), faces: Uint32Array.from(F), colors: Float32Array.from(C) };
}

export interface LentiPrint {
  /** Schichten mit mehreren Farben und Filamentwechsel insgesamt (Schätzung: jede Farbe einmal je Schicht) */
  layers: number;
  colors: number;
  changes: number;
  /** Volumen in mm³: Grundplatte und je Palettenfarbe */
  baseVolume: number;
  volumes: number[];
}

/** Was der Druck braucht: Schichten mit Farbwechseln und Material je Farbe. */
export function lentiPrint(m: LentiModel, layerHeight = LENTI_LAYER_MM): LentiPrint {
  const layers = Math.max(1, Math.ceil((m.skin + m.height) / Math.max(0.04, layerHeight) - 1e-6));
  const colors = m.share.filter((v) => v > 0).length, cell = cellDx(m) * m.dy;
  // Säulen nahe am Grat sind höher als die am Tal: mittlere Höhe je Bildspalte der Flanke
  const volumes = m.share.map(() => 0);
  for (let i = 0; i < m.a.length; i++) {
    const t = ((i % m.icols) % m.sub + 0.5) / m.sub;
    volumes[m.a[i]] += cell * (m.skin + m.height * t);
    volumes[m.b[i]] += cell * (m.skin + m.height * (1 - t));
  }
  return { layers, colors, changes: colors > 1 ? layers * colors : 0, baseVolume: m.width * m.depth * m.base, volumes };
}
