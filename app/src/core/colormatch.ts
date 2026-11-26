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

/** Helligkeitsbereich [dunkel, hell] in L*. */
export type LightRange = [number, number];

/** Robuster Helligkeitsbereich einer Lab-Liste: ohne den äußersten Anteil `p` an beiden Enden. */
export function lightRange(lab: Float32Array, p = 0.005): LightRange {
  const hist = new Uint32Array(101), n = lab.length / 3;
  if (!n) return [0, 100];
  for (let i = 0; i < lab.length; i += 3) hist[Math.min(100, Math.max(0, Math.round(lab[i])))]++;
  const cut = Math.floor(n * p);
  let lo = 0, hi = 100;
  for (let acc = 0; lo < 100; lo++) { acc += hist[lo]; if (acc > cut) break; }
  for (let acc = 0; hi > 0; hi--) { acc += hist[hi]; if (acc > cut) break; }
  return [lo, Math.max(lo, hi)];
}

const paletteRange = (pal: Float32Array): LightRange => {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < pal.length; i += 3) { if (pal[i] < lo) lo = pal[i]; if (pal[i] > hi) hi = pal[i]; }
  return [lo, hi];
};

/** Tonwertkurve für den farbtreuen Modus. Ein Filament-Stapel erreicht oft nicht die hellsten oder dunkelsten Töne
 *  des Bildes. Ohne Kurve landen dann alle Töne jenseits des Erreichbaren auf derselben Schicht, und was sich dort
 *  nur in der Helligkeit unterscheidet (eine Sonne vor hellem Himmel), verschwindet. Die Kurve staucht deshalb das
 *  Ende des Bildbereichs in das Ende des Stapelbereichs: Die Reihenfolge der Helligkeiten bleibt erhalten, Töne in
 *  der Mitte bleiben unverändert. `knee` = Breite des gestauchten Bereichs als Vielfaches des Überstands,
 *  `amount` = Stärke (0 = keine Kurve, 1 = volle Kurve).
 *  Rückgabe: Tabelle L* (in Zehnteln, 0 bis 100) -> L* für die Zuordnung, oder null, wenn nichts zu stauchen ist. */
export function toneCurve(img: LightRange, pal: LightRange, amount = 1, knee = 1): Float32Array | null {
  const [a, b] = img, [A, B] = pal;
  if (amount <= 0 || (b <= B + 1 && a >= A - 1)) return null;
  const mid = (A + B) / 2;
  const kh = b > B ? Math.max(mid, B - knee * (b - B)) : Infinity;
  const kl = a < A ? Math.min(mid, A + knee * (A - a)) : -Infinity;
  const lut = new Float32Array(1001);
  for (let i = 0; i <= 1000; i++) {
    const L = i / 10;
    const t = L > kh ? Math.min(B, kh + ((L - kh) * (B - kh)) / (b - kh)) : L < kl ? Math.max(A, kl - ((kl - L) * (kl - A)) / (kl - a)) : L;
    lut[i] = L + Math.min(1, amount) * (t - L);
  }
  return lut;
}

/** Detailtreue im farbtreuen Modus (0 bis 1). 0 = jede Stelle bekommt die Schicht mit dem kleinsten Farbabstand.
 *  Höher = Farben, die der Stapel nicht hergibt, werden nach ihrer Helligkeit einsortiert statt alle auf dieselbe
 *  Schicht zu fallen, und die Tonwertkurve greift: Helligkeitsunterschiede des Bildes bleiben im Druck erhalten.
 *  Farben, die der Stapel gut trifft, bleiben davon unberührt. */
export const DETAIL_DEFAULT = 0.75;
export interface MatchOptions {
  /** Helligkeitsbereich des Bildes für die Tonwertkurve; null = keine Kurve */
  range?: LightRange | null;
  /** Detailtreue 0 bis 1; ohne Angabe 0 (reiner Farbabstand) */
  detail?: number;
}
/** Ab diesem Farbabstand zur besten Schicht gilt eine Farbe als „nicht im Stapel“; ab OUT_HI zählt fast nur noch
 *  ihre Helligkeit (Gewicht bis LIGHT_MAX bei voller Detailtreue). */
const OUT_LO = 6, OUT_HI = 18, LIGHT_MAX = 16;

/** Passende Palettenfarbe je Punkt; Rückgabe: mittlerer Farbabstand (ΔE) der gewählten Farben zur Bildfarbe.
 *  Ohne Optionen ist das die Schicht mit dem kleinsten Farbabstand. Diese glatte Zielgröße nutzen die Suche nach
 *  Filamenten und das automatische Verteilen. Die Detailtreue kommt erst beim Berechnen der Höhen dazu. */
function nearestIndex(lab: Float32Array, pal: Float32Array, out: Int32Array | null, o: MatchOptions = {}): number {
  const n = lab.length / 3, k = pal.length / 3;
  const detail = Math.min(1, Math.max(0, o.detail ?? 0)), wMax = 1 + (LIGHT_MAX - 1) * detail;
  const lut = o.range && detail > 0 ? toneCurve(o.range, paletteRange(pal), detail * 2) : null;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const L0 = lab[i * 3], A = lab[i * 3 + 1], B = lab[i * 3 + 2];
    const L = lut ? lut[Math.min(1000, Math.max(0, Math.round(L0 * 10)))] : L0;
    let best = Infinity, bi = 0;
    for (let j = 0; j < k; j++) {
      const dl = L - pal[j * 3], da = A - pal[j * 3 + 1], db = B - pal[j * 3 + 2];
      const d = dl * dl + da * da + db * db;
      if (d < best) { best = d; bi = j; }
    }
    // Farbe außerhalb des Stapels: Helligkeit stärker gewichten und von der ähnlichsten Schicht aus schrittweise
    // nach oben oder unten wandern, solange es besser wird. So bleibt der Punkt im selben Farbbereich des Stapels
    // (kein Sprung zu einem ganz anderen Farbton mit zufällig passender Helligkeit).
    if (detail > 0 && best > OUT_LO * OUT_LO) {
      const t = Math.min(1, (Math.sqrt(best) - OUT_LO) / (OUT_HI - OUT_LO)), wl = 1 + (wMax - 1) * t * t * (3 - 2 * t);
      const cost = (j: number) => { const dl = L - pal[j * 3], da = A - pal[j * 3 + 1], db = B - pal[j * 3 + 2]; return wl * dl * dl + da * da + db * db; };
      let c = cost(bi);
      for (const dir of [1, -1]) {
        let j = bi + dir, moved = false;
        while (j >= 0 && j < k) { const cj = cost(j); if (cj >= c) break; c = cj; bi = j; j += dir; moved = true; }
        if (moved) break;
      }
    }
    if (out) out[i] = bi;
    if (detail > 0) { const dl = L0 - pal[bi * 3], da = A - pal[bi * 3 + 1], db = B - pal[bi * 3 + 2]; best = dl * dl + da * da + db * db; }
    total += Math.sqrt(best);
  }
  return total / Math.max(1, n);
}

/** Höhe je Bildpunkt aus der passenden Schicht. `detail` = Detailtreue (siehe oben); der Helligkeitsbereich des
 *  Bildes wird dafür aus den sichtbaren Punkten bestimmt (`alpha`: durchsichtige zählen nicht). */
export function nearestHeights(rgb: Float32Array, heights: Float32Array, colors: Float32Array, detail = 0, alpha?: Float32Array): Float32Array {
  const idx = new Int32Array(rgb.length / 3), lab = labArray(rgb);
  let range: LightRange | null = null;
  if (detail > 0) {
    if (!alpha) range = lightRange(lab);
    else { const vis: number[] = []; for (let i = 0; i < alpha.length; i++) if (alpha[i] >= 0.5) vis.push(lab[i * 3], 0, 0); range = vis.length ? lightRange(Float32Array.from(vis)) : null; }
  }
  nearestIndex(lab, labArray(colors), idx, { range, detail });
  return Float32Array.from(idx, (i) => heights[i]);
}

/** Mittlerer Farbabstand (ΔE) zwischen Bild (Lab-Stichprobe) und der jeweils ähnlichsten Schicht des Stapels. */
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

/** Helligkeits-Modus: Die Höhe steht durch die Bildhelligkeit fest; die Wechsel-Schichten werden so gelegt, dass
 *  die simulierte Farbe je Höhe möglichst gut zu den Bildfarben an diesen Stellen passt (kleinste Quadrate im
 *  Lab-Raum, Koordinatenabstieg). Rechnet auf einem Histogramm je Schicht und ist deshalb sehr schnell. */
export function optimizeLumaPlan(hm: HeightMap, filaments: Filament[], initial: ColorStop[], passes = 6): ColorStop[] {
  const n = filaments.length;
  if (n < 2) return initial;
  const base = hm.base_layer_mm, step = hm.layer_height_mm;
  let K = 1;
  for (let i = 0; i < hm.heights.length; i++) if (!hm.mask || hm.mask[i]) K = Math.max(K, Math.round((hm.heights[i] - base) / step) + 1);
  // je Schicht: Anzahl und Summe der Bildfarben (L, a, b); die Summe der Quadrate ist für den Vergleich konstant
  const cnt = new Float64Array(K + 1), sum = new Float64Array((K + 1) * 3);
  const lab = [0, 0, 0];
  const b = hm.border_px;
  for (let y = b; y < hm.height - b; y++) for (let x = b; x < hm.width - b; x++) {
    const i = y * hm.width + x;
    if (hm.mask && !hm.mask[i]) continue;
    const k = Math.min(K, Math.max(1, Math.round((hm.heights[i] - base) / step) + 1));
    srgbToLab(hm.rgb[i * 3], hm.rgb[i * 3 + 1], hm.rgb[i * 3 + 2], lab, 0);
    cnt[k]++; sum[k * 3] += lab[0]; sum[k * 3 + 1] += lab[1]; sum[k * 3 + 2] += lab[2];
  }
  const heights = new Float32Array(K).map((_, i) => layerTopZ(i + 1, base, step));
  const row: HeightMap = { width: K, height: 1, heights, pixel_size_mm: 1, base_layer_mm: base, layer_height_mm: step,
    rgb: new Float32Array(K * 3), border_px: 0, mask: null };
  const err = (st: number[]) => {
    const sim = simulate(row, filaments.map((f, i) => ({ filament: f, start_layer: st[i] })), heights, false);
    let e = 0;
    for (let k = 1; k <= K; k++) {
      if (!cnt[k]) continue;
      srgbToLab(sim[(k - 1) * 3], sim[(k - 1) * 3 + 1], sim[(k - 1) * 3 + 2], lab, 0);
      for (let c = 0; c < 3; c++) e += cnt[k] * lab[c] * lab[c] - 2 * lab[c] * sum[k * 3 + c];
    }
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
