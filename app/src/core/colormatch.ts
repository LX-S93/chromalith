/** Farbtreuer Modus: Höhe je Punkt so wählen, dass die simulierte Mischfarbe der echten
 *  Bildfarbe am nächsten kommt (Abstand im CIE-Lab-Raum). */
import { labArray, srgbToLab } from "./color";
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

/** Kleine Lab-Stichprobe eines Bildes (höchstens maxSide Punkte je Seite). */
export function labSample(rgb: Float32Array, w: number, h: number, maxSide: number, alpha?: Float32Array, balanced = true): Float32Array {
  const f = Math.max(1, Math.ceil(Math.max(w, h) / maxSide));
  const sm: number[] = [];
  for (let y = 0; y < h; y += f) for (let x = 0; x < w; x += f) {
    const p = y * w + x;
    if (alpha && alpha[p] < 0.5) continue;
    sm.push(rgb[p * 3], rgb[p * 3 + 1], rgb[p * 3 + 2]);
  }
  const lab = labArray(Float32Array.from(sm));
  return balanced ? balanceSamples(lab) : lab;
}

/** Gleicht die Stichprobe aus, damit große einfarbige Flächen (z. B. ein weißer Hintergrund) kleine, aber
 *  wichtige Farben des Motivs nicht erdrücken: Jede Farbgruppe zählt nur noch mit der Wurzel ihrer Fläche. */
export function balanceSamples(lab: Float32Array, cell = 14): Float32Array {
  const bins = new Map<string, number[]>();
  for (let i = 0; i < lab.length; i += 3) {
    const k = `${Math.round(lab[i] / cell)},${Math.round(lab[i + 1] / cell)},${Math.round(lab[i + 2] / cell)}`;
    let b = bins.get(k); if (!b) bins.set(k, (b = []));
    b.push(i);
  }
  const out: number[] = [];
  for (const b of bins.values()) {
    const keep = Math.min(b.length, Math.ceil(Math.sqrt(b.length) * 4));
    for (let j = 0; j < keep; j++) { const i = b[Math.floor((j * b.length) / keep)]; out.push(lab[i], lab[i + 1], lab[i + 2]); }
  }
  return Float32Array.from(out);
}

/** Wechsel-Schichten (Koordinatenabstieg) für Filamente in fester Reihenfolge; liefert Startschichten und Fehler. */
export function optimizeStarts(lab: Float32Array, filaments: Filament[], base: number, step: number, minH: number, maxH: number,
  passes = 3): { starts: number[]; error: number } {
  const n = filaments.length;
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
  return { starts, error: best };
}

/** Wechsel-Schichten für die gegebene Reihenfolge so wählen, dass die Bildfarben am besten
 *  getroffen werden (Koordinatenabstieg auf einer verkleinerten Kopie). */
export function optimizePlan(rgb: Float32Array, w: number, h: number, filaments: Filament[], base: number, step: number,
  minH: number, maxH: number, passes = 3, maxSide = 90): ColorStop[] {
  if (!filaments.length) return [];
  const { starts } = optimizeStarts(labSample(rgb, w, h, maxSide), filaments, base, step, minH, maxH, passes);
  return filaments.map((fl, i) => ({ filament: fl, start_layer: starts[i] }));
}

/** Helligkeits-Modus: Wechsel-Schichten so legen, dass die simulierte Helligkeit (L*) je Höhe
 *  möglichst gut zur Bildhelligkeit an diesen Stellen passt (kleinste Quadrate, Koordinatenabstieg).
 *  Rechnet auf einem Histogramm je Schicht und ist deshalb sehr schnell. */
export function optimizeLumaPlan(hm: HeightMap, filaments: Filament[], initial: ColorStop[], passes = 6): ColorStop[] {
  const n = filaments.length;
  if (n < 2) return initial;
  const base = hm.base_layer_mm, step = hm.layer_height_mm;
  let K = 1;
  for (let i = 0; i < hm.heights.length; i++) if (!hm.mask || hm.mask[i]) K = Math.max(K, Math.round((hm.heights[i] - base) / step) + 1);
  const cnt = new Float64Array(K + 1), sum = new Float64Array(K + 1), sum2 = new Float64Array(K + 1);
  const lab = [0, 0, 0];
  const b = hm.border_px;
  for (let y = b; y < hm.height - b; y++) for (let x = b; x < hm.width - b; x++) {
    const i = y * hm.width + x;
    if (hm.mask && !hm.mask[i]) continue;
    const k = Math.min(K, Math.max(1, Math.round((hm.heights[i] - base) / step) + 1));
    srgbToLab(hm.rgb[i * 3], hm.rgb[i * 3 + 1], hm.rgb[i * 3 + 2], lab, 0);
    cnt[k]++; sum[k] += lab[0]; sum2[k] += lab[0] * lab[0];
  }
  const heights = new Float32Array(K).map((_, i) => layerTopZ(i + 1, base, step));
  const row: HeightMap = { width: K, height: 1, heights, pixel_size_mm: 1, base_layer_mm: base, layer_height_mm: step,
    rgb: new Float32Array(K * 3), border_px: 0, mask: null };
  const simL = new Float32Array(K + 1);
  const err = (st: number[]) => {
    const sim = simulate(row, filaments.map((f, i) => ({ filament: f, start_layer: st[i] })), heights, false);
    for (let k = 1; k <= K; k++) { srgbToLab(sim[(k - 1) * 3], sim[(k - 1) * 3 + 1], sim[(k - 1) * 3 + 2], lab, 0); simL[k] = lab[0]; }
    let e = 0;
    for (let k = 1; k <= K; k++) if (cnt[k]) e += cnt[k] * simL[k] * simL[k] - 2 * simL[k] * sum[k] + sum2[k];
    return e;
  };
  const byFil = new Map(initial.map((s) => [s.filament, s.start_layer]));
  let starts = filaments.map((f, i) => (i === 0 ? 1 : byFil.get(f) ?? i + 1));
  for (let i = 1; i < n; i++) starts[i] = Math.max(starts[i], starts[i - 1] + 1);
  let best = err(starts);
  for (let p = 0; p < passes; p++) {
    let improved = false;
    for (let i = 1; i < n; i++) {
      const lo = starts[i - 1] + 1, hi = i + 1 < n ? starts[i + 1] - 1 : K;
      for (let c = lo; c <= hi; c++) {
        if (c === starts[i]) continue;
        const t = starts.slice(); t[i] = c;
        const e = err(t);
        if (e < best - 1e-9) { best = e; starts = t; improved = true; }
      }
    }
    if (!improved) break;
  }
  return filaments.map((f, i) => ({ filament: f, start_layer: starts[i] }));
}
