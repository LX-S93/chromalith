/** Farbinseln („Color Pop“): Bildbereiche, die über das restliche Relief angehoben und mit einem
 *  eigenen Filament gedruckt werden. Ein Bereich entsteht aus Klickpunkten und einer Farbtoleranz. */
import { srgbToLab } from "./color";
import { gaussianBlur } from "./raster";
import type { Filament } from "./filaments";
import { layerIndex, quantize, type HeightMap, type HeightSettings } from "./heightmap";
import { normalized, type ColorStop } from "./plan";

export interface IslandSeed { x: number; y: number } // 0..1 im Originalbild
export interface Island {
  id: string;
  filament: Filament;
  seeds: IslandSeed[];
  tolerance: number; // Lab-Abstand
  contiguous: boolean; // nur zusammenhängende Fläche um die Klickpunkte
  raise_mm: number; // Höhe über dem restlichen Relief
  keep_relief: boolean; // Relief innerhalb der Insel beibehalten
}

export const ISLAND_DEFAULTS = { tolerance: 28, contiguous: true, raise_mm: 0.48, keep_relief: false };

export function normalizeIsland(d: any): Island {
  return {
    id: String(d.id ?? Math.random().toString(16).slice(2)), filament: d.filament,
    seeds: (d.seeds ?? []).map((s: any) => ({ x: Number(s.x), y: Number(s.y) })),
    tolerance: Number(d.tolerance ?? ISLAND_DEFAULTS.tolerance), contiguous: d.contiguous ?? ISLAND_DEFAULTS.contiguous,
    raise_mm: Number(d.raise_mm ?? ISLAND_DEFAULTS.raise_mm), keep_relief: Boolean(d.keep_relief ?? ISLAND_DEFAULTS.keep_relief),
  };
}

/** Klickpunkt (Originalbild 0..1) -> Rasterpunkt der Höhenkarte (berücksichtigt runden Zuschnitt und Rahmen). */
export function seedToGrid(seed: IslandSeed, imgW: number, imgH: number, s: HeightSettings, hm: HeightMap): [number, number] | null {
  let u = seed.x, v = seed.y;
  if (s.shape === "circle" && imgW !== imgH) {
    const side = Math.min(imgW, imgH);
    const ox = Math.floor((imgW - side) / 2), oy = Math.floor((imgH - side) / 2);
    u = (u * imgW - ox) / side; v = (v * imgH - oy) / side;
  }
  if (u < 0 || v < 0 || u > 1 || v > 1) return null;
  const b = hm.border_px, w = hm.width - 2 * b, h = hm.height - 2 * b;
  return [b + Math.round(u * (w - 1)), b + Math.round(v * (h - 1))];
}

/** Maske einer Insel auf dem Raster der Höhenkarte. */
export function islandMask(hm: HeightMap, grid: [number, number][], tolerance: number, contiguous: boolean): Uint8Array {
  const { width: w, height: h, border_px: b } = hm;
  const n = w * h;
  const out = new Uint8Array(n);
  if (!grid.length) return out;
  const lab = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) srgbToLab(hm.rgb[i * 3], hm.rgb[i * 3 + 1], hm.rgb[i * 3 + 2], lab, i * 3);
  // leicht weichzeichnen, damit feine Musterung (Schuppen, Fell) nicht jede Fläche zerreißt
  const sigma = Math.max(1, 0.6 / hm.pixel_size_mm);
  for (let c = 0; c < 3; c++) {
    const ch = new Float32Array(n);
    for (let i = 0; i < n; i++) ch[i] = lab[i * 3 + c];
    const bl = gaussianBlur(ch, w, h, sigma);
    for (let i = 0; i < n; i++) lab[i * 3 + c] = bl[i];
  }
  // Farbe am Klickpunkt: Mittel über 3×3
  const refs = grid.map(([x, y]) => {
    const acc = [0, 0, 0]; let c = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < b || yy < b || xx >= w - b || yy >= h - b) continue;
      const i = (yy * w + xx) * 3; acc[0] += lab[i]; acc[1] += lab[i + 1]; acc[2] += lab[i + 2]; c++;
    }
    const i0 = (y * w + x) * 3;
    return [acc.map((v) => v / Math.max(1, c)), [lab[i0], lab[i0 + 1], lab[i0 + 2]]];
  }).flat();
  const t2 = tolerance * tolerance;
  const inside = (i: number) => {
    const x = i % w, y = (i / w) | 0;
    if (x < b || y < b || x >= w - b || y >= h - b || (hm.mask && !hm.mask[i])) return false;
    const L = lab[i * 3], A = lab[i * 3 + 1], B = lab[i * 3 + 2];
    return refs.some((r) => (L - r[0]) ** 2 + (A - r[1]) ** 2 + (B - r[2]) ** 2 <= t2);
  };
  if (!contiguous) { for (let i = 0; i < n; i++) if (inside(i)) out[i] = 1; return out; }
  const stack: number[] = [];
  for (const [x, y] of grid) { const i = y * w + x; if (!hm.mask || hm.mask[i]) { out[i] = 1; stack.push(i); } }
  while (stack.length) {
    const i = stack.pop()!, x = i % w;
    for (const j of [i - 1, i + 1, i - w, i + w]) {
      if (j < 0 || j >= n || out[j] || (j === i - 1 && x === 0) || (j === i + 1 && x === w - 1)) continue;
      if (inside(j)) { out[j] = 1; stack.push(j); }
    }
  }
  return out;
}

/** Hebt die Inseln an (übereinander gestapelt) und liefert die zusätzlichen Farbwechsel.
 *  restLayers = Schichtzahl des Reliefs ohne Inseln. */
export function applyIslands(hm: HeightMap, islands: Island[], imgW: number, imgH: number, s: HeightSettings):
  { stops: ColorStop[]; restLayers: number; masks: Uint8Array[] } {
  const base = hm.base_layer_mm, step = hm.layer_height_mm;
  const claimed = new Uint8Array(hm.width * hm.height);
  const masks = islands.map((isl) => {
    const grid = isl.seeds.map((sd) => seedToGrid(sd, imgW, imgH, s, hm)).filter((g): g is [number, number] => !!g);
    const m = islandMask(hm, grid, isl.tolerance, isl.contiguous);
    for (let i = 0; i < m.length; i++) { if (claimed[i]) m[i] = 0; else if (m[i]) claimed[i] = 1; }
    return m;
  });
  let restTop = 0;
  for (let i = 0; i < hm.heights.length; i++) if (!claimed[i] && (!hm.mask || hm.mask[i]) && hm.heights[i] > restTop) restTop = hm.heights[i];
  const restLayers = layerIndex(restTop, base, step);
  const stops: ColorStop[] = [];
  let cur = restTop;
  islands.forEach((isl, k) => {
    const m = masks[k];
    let lo = Infinity;
    for (let i = 0; i < m.length; i++) if (m[i] && hm.heights[i] < lo) lo = hm.heights[i];
    if (lo === Infinity) return;
    const top0 = quantize(cur + Math.max(step, isl.raise_mm), base, step);
    let top = top0;
    for (let i = 0; i < m.length; i++) {
      if (!m[i]) continue;
      const v = isl.keep_relief ? quantize(top0 + (hm.heights[i] - lo), base, step) : top0;
      hm.heights[i] = v;
      if (v > top) top = v;
    }
    stops.push({ filament: isl.filament, start_layer: layerIndex(cur, base, step) + 1 });
    cur = top;
  });
  return { stops, restLayers, masks };
}

/** Farbwechsel für Druck/Vorschau: eigener Stapel (bis zur Oberkante des Reliefs) plus Inseln. */
export function effectiveStops(hm: HeightMap, stops: ColorStop[]): ColorStop[] {
  if (!hm.islandStops?.length) return stops;
  const own = normalized(stops).filter((s) => s.start_layer <= (hm.restLayers ?? Infinity));
  return [...own, ...hm.islandStops];
}
