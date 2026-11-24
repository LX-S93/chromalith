/** Farbtreuer Modus: Höhe je Punkt so wählen, dass die simulierte Mischfarbe der echten
 *  Bildfarbe am nächsten kommt (Abstand im CIE-Lab-Raum). */
import { labArray } from "./color";
import type { Filament } from "./filaments";
import { layerTopZ, type HeightMap } from "./heightmap";
import { simulate, type ColorStop } from "./plan";

export function layerPalette(stops: ColorStop[], base: number, step: number, minH: number, maxH: number) {
  const k0 = Math.max(1, Math.round((minH - base) / step) + 1);
  const k1 = Math.max(k0, Math.round((maxH - base) / step) + 1);
  const heights = new Float32Array(k1 - k0 + 1).map((_, i) => layerTopZ(k0 + i, base, step));
  const hm: HeightMap = { width: heights.length, height: 1, heights, pixel_size_mm: 1, base_layer_mm: base,
    layer_height_mm: step, rgb: new Float32Array(heights.length * 3), border_px: 0, mask: null };
  return { heights, colors: simulate(hm, stops) };
}

function nearestIndex(lab: Float32Array, pal: Float32Array, out: Int32Array | null): number {
  const n = lab.length / 3, k = pal.length / 3;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const L = lab[i * 3], A = lab[i * 3 + 1], B = lab[i * 3 + 2];
    let best = Infinity, bi = 0;
    for (let j = 0; j < k; j++) {
      const dl = L - pal[j * 3], da = A - pal[j * 3 + 1], db = B - pal[j * 3 + 2];
      const d = dl * dl + da * da + db * db;
      if (d < best) { best = d; bi = j; }
    }
    if (out) out[i] = bi;
    total += Math.sqrt(best);
  }
  return total / Math.max(1, n);
}

export function nearestHeights(rgb: Float32Array, heights: Float32Array, colors: Float32Array): Float32Array {
  const idx = new Int32Array(rgb.length / 3);
  nearestIndex(labArray(rgb), labArray(colors), idx);
  return Float32Array.from(idx, (i) => heights[i]);
}

export function colorError(lab: Float32Array, stops: ColorStop[], base: number, step: number, minH: number, maxH: number): number {
  const { colors } = layerPalette(stops, base, step, minH, maxH);
  return nearestIndex(lab, labArray(colors), null);
}

/** Wechsel-Schichten für die gegebene Reihenfolge so wählen, dass die Bildfarben am besten
 *  getroffen werden (Koordinatenabstieg auf einer verkleinerten Kopie). */
export function optimizePlan(rgb: Float32Array, w: number, h: number, filaments: Filament[], base: number, step: number,
  minH: number, maxH: number, passes = 3, maxSide = 90): ColorStop[] {
  const n = filaments.length;
  if (!n) return [];
  const f = Math.max(1, Math.ceil(Math.max(w, h) / maxSide));
  const sm: number[] = [];
  for (let y = 0; y < h; y += f) for (let x = 0; x < w; x += f) { const i = (y * w + x) * 3; sm.push(rgb[i], rgb[i + 1], rgb[i + 2]); }
  const lab = labArray(Float32Array.from(sm));
  const kMin = Math.max(1, Math.round((minH - base) / step) + 1);
  const kMax = Math.max(kMin + 1, Math.round((maxH - base) / step) + 1);
  let starts = [1, ...Array.from({ length: n - 1 }, (_, i) => kMin + Math.round(((i + 1) * (kMax - kMin)) / n))];
  for (let i = 1; i < n; i++) starts[i] = Math.max(starts[i], starts[i - 1] + 1);
  const err = (st: number[]) => colorError(lab, filaments.map((fl, i) => ({ filament: fl, start_layer: st[i] })), base, step, minH, maxH);
  let best = err(starts);
  for (let p = 0; p < passes; p++) {
    let improved = false;
    for (let i = 1; i < n; i++) {
      const lo = starts[i - 1] + 1, hi = i + 1 < n ? starts[i + 1] - 1 : kMax + 1;
      for (let c = lo; c <= hi; c++) {
        if (c === starts[i]) continue;
        const trial = starts.slice(); trial[i] = c;
        const e = err(trial);
        if (e < best - 1e-6) { best = e; starts = trial; improved = true; }
      }
    }
    if (!improved) break;
  }
  return filaments.map((fl, i) => ({ filament: fl, start_layer: starts[i] }));
}
