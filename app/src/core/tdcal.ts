/** TD-Kalibrierung: eine Stufentreppe zum Drucken und ihre Auswertung, entweder aus einem Foto im Gegenlicht
 *  oder von Hand über die erste Stufe, durch die kein Licht mehr scheint.
 *
 *  Grundlage ist dasselbe Modell wie in der Farbsimulation: Durch eine Lage der Dicke t kommt der Anteil
 *  exp(-K t / TD) des Lichts, bei t = TD also noch 5 %. Im Foto fällt die Helligkeit der Stufen deshalb mit
 *  der Dicke exponentiell ab; aus der Steilheit dieses Abfalls ergibt sich der TD. Die Helligkeit der Lampe
 *  und die Belichtung kürzen sich dabei heraus. */
import { srgbToLinear } from "./color";
import type { HeightMap } from "./heightmap";
import { OPACITY_K } from "./plan";

export interface StairSpec {
  /** Erste Schicht in mm = Dicke der dünnsten Stufe */
  first: number;
  /** Schichthöhe in mm */
  layer: number;
  /** Schichten je Stufe */
  perStep: number;
  /** Anzahl der Stufen */
  count: number;
}

export const STAIR_STEP_MM = 8;
export const STAIR_WIDTH_MM = 20;
export const DEFAULT_STAIR: StairSpec = { first: 0.2, layer: 0.08, perStep: 1, count: 10 };

const r4 = (v: number) => Math.round(v * 10000) / 10000;

export function cleanStair(s: Partial<StairSpec>): StairSpec {
  const num = (v: unknown, lo: number, hi: number, d: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Number(v))) : d);
  return {
    first: r4(num(s.first, 0.04, 0.6, DEFAULT_STAIR.first)), layer: r4(num(s.layer, 0.04, 0.4, DEFAULT_STAIR.layer)),
    perStep: Math.round(num(s.perStep, 1, 10, DEFAULT_STAIR.perStep)), count: Math.round(num(s.count, 4, 20, DEFAULT_STAIR.count)),
  };
}

/** Dicke der Stufe i (0 = dünnste) in mm */
export const stairThickness = (s: StairSpec, i: number) => r4(s.first + i * s.perStep * s.layer);
export const stairThicknesses = (s: StairSpec) => Array.from({ length: s.count }, (_, i) => stairThickness(s, i));

/** Die Treppe als Höhenkarte: Stufen nebeneinander, dünnste links. Daraus entstehen STL und 3MF wie beim Relief. */
export function stairHeightMap(s: StairSpec, pixel = 0.5): HeightMap {
  const w = Math.round((s.count * STAIR_STEP_MM) / pixel) + 1, h = Math.round(STAIR_WIDTH_MM / pixel) + 1;
  const heights = new Float32Array(w * h);
  for (let x = 0; x < w; x++) {
    const t = stairThickness(s, Math.min(s.count - 1, Math.floor((x * pixel) / STAIR_STEP_MM + 1e-6)));
    for (let y = 0; y < h; y++) heights[y * w + x] = t;
  }
  return { width: w, height: h, heights, pixel_size_mm: pixel, base_layer_mm: s.first, layer_height_mm: s.layer,
    rgb: new Float32Array(w * h * 3).fill(0.5), border_px: 0, mask: null };
}

export interface PhotoPixels { data: ArrayLike<number>; width: number; height: number } // RGBA, 8 Bit

export interface StepSample {
  /** Mittlere Helligkeit (linear, 0..1) */
  lum: number;
  /** Anteil überbelichteter Punkte (0..1) */
  saturated: number;
  /** Anzahl ausgewerteter Punkte */
  n: number;
}

let LIN: Float32Array | null = null;
const lin = () => (LIN ??= Float32Array.from({ length: 256 }, (_, i) => srgbToLinear(i / 255)));

/** Halbe Kantenlänge des Messfelds je Stufe, in Bildpunkten: gut ein Viertel des Stufenabstands */
export const samplePatch = (a: [number, number], b: [number, number], count: number) =>
  Math.max(1, (Math.hypot(b[0] - a[0], b[1] - a[1]) / Math.max(1, count - 1)) * 0.28);

/** Misst die Helligkeit jeder Stufe. a = Mitte der dünnsten, b = Mitte der dicksten Stufe (Bildpunkte). */
export function sampleStair(img: PhotoPixels, a: [number, number], b: [number, number], count: number): StepSample[] {
  const L = lin(), half = samplePatch(a, b, count);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const ex = (b[0] - a[0]) / len, ey = (b[1] - a[1]) / len;
  const step = Math.max(1, half / 24); // höchstens rund 50 x 50 Punkte je Feld
  const out: StepSample[] = [];
  for (let i = 0; i < count; i++) {
    const f = count > 1 ? i / (count - 1) : 0;
    const cx = a[0] + (b[0] - a[0]) * f, cy = a[1] + (b[1] - a[1]) * f;
    const vals: number[] = [];
    let sat = 0;
    for (let u = -half; u <= half; u += step)
      for (let v = -half; v <= half; v += step) {
        const x = Math.round(cx + u * ex - v * ey), y = Math.round(cy + u * ey + v * ex);
        if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
        const o = (y * img.width + x) * 4, r = img.data[o], g = img.data[o + 1], bl = img.data[o + 2];
        if (r >= 250 || g >= 250 || bl >= 250) sat++;
        vals.push(0.2126 * L[r] + 0.7152 * L[g] + 0.0722 * L[bl]);
      }
    if (!vals.length) { out.push({ lum: 0, saturated: 0, n: 0 }); continue; }
    // Ausreißer (Staub, Schichtlinien, Glanzpunkte) weglassen: Mittel der mittleren 80 %
    vals.sort((p, q) => p - q);
    const cut = Math.floor(vals.length * 0.1);
    let sum = 0;
    for (let k = cut; k < vals.length - cut; k++) sum += vals[k];
    out.push({ lum: sum / Math.max(1, vals.length - 2 * cut), saturated: sat / vals.length, n: vals.length });
  }
  return out;
}

export type TdProblem = "few" | "flat";

export interface TdFit {
  ok: boolean;
  /** TD in mm (nur gültig, wenn ok) */
  td: number;
  /** Güte der Anpassung, 1 = die Stufen folgen genau dem Modell */
  r2: number;
  /** Welche Stufen in die Rechnung eingingen (Reihenfolge: dünnste zuerst) */
  used: boolean[];
  /** Stufen, die überbelichtet sind (nicht verwendet) */
  saturated: boolean[];
  /** Helligkeit je Stufe, dünnste zuerst */
  lum: number[];
  /** Die Marken waren vertauscht (erste Marke lag auf der dicken Seite) */
  reversed: boolean;
  /** Abgezogener Schwarzwert: Resthelligkeit der Stufen, durch die nichts mehr kommt */
  black: number;
  /** Modell: Helligkeit = a * exp(-k t) + black */
  a: number;
  k: number;
  problem?: TdProblem;
  /** Nur grobe Schätzung: wenige Stufen, schlechte Anpassung oder TD weit über der dicksten Stufe */
  rough: boolean;
}

/** Leitet den TD aus den gemessenen Helligkeiten ab. t = Dicke je Stufe (dünnste zuerst), samples in der Reihenfolge
 *  von der ersten zur zweiten Marke. */
export function fitTd(t: number[], samples: StepSample[]): TdFit {
  const n = Math.min(t.length, samples.length);
  let lum = samples.slice(0, n).map((s) => s.lum), sat = samples.slice(0, n).map((s) => s.saturated > 0.2 || s.n === 0);
  const reversed = n > 1 && lum[0] < lum[n - 1];
  if (reversed) { lum = lum.reverse(); sat = sat.reverse(); }
  const fail = (problem: TdProblem, used = new Array(n).fill(false), black = 0): TdFit =>
    ({ ok: false, td: 0, r2: 0, used, saturated: sat, lum, reversed, black, a: 0, k: 0, problem, rough: true });

  let top = 0;
  for (let i = 0; i < n; i++) if (!sat[i] && lum[i] > top) top = lum[i];
  if (top <= 0) return fail("few");

  // Schwarzwert: Die dicksten Stufen sind gleich dunkel, wenn nichts mehr durchkommt. Was dort noch an Helligkeit
  // bleibt, ist Streulicht und Rauschen der Kamera und wird abgezogen. Nur bei klarem Befund (mind. zwei Stufen).
  let black = 0, plateau = n;
  for (let j = n - 2; j >= 0; j--) {
    const tail = lum.slice(j);
    const lo = Math.min(...tail), hi = Math.max(...tail), mean = tail.reduce((p, q) => p + q, 0) / tail.length;
    if (hi < 0.12 * top && hi - lo <= 0.08 * mean + 0.0004) { plateau = j; black = mean; } else break;
  }

  const used = lum.map((v, i) => !sat[i] && i < plateau && v - black > 0.02 * (top - black));
  const idx = used.flatMap((u, i) => (u ? [i] : []));
  if (idx.length < 2) return fail("few", used, black);

  // Gerade durch ln(Helligkeit) über der Dicke; helle Stufen zählen mehr, weil ihr Messwert sicherer ist
  let sw = 0, sx = 0, sy = 0;
  const y = idx.map((i) => Math.log(lum[i] - black)), w = idx.map((i) => (lum[i] - black) ** 2);
  idx.forEach((i, j) => { sw += w[j]; sx += w[j] * t[i]; sy += w[j] * y[j]; });
  const mx = sx / sw, my = sy / sw;
  let sxx = 0, sxy = 0, syy = 0;
  idx.forEach((i, j) => { sxx += w[j] * (t[i] - mx) ** 2; sxy += w[j] * (t[i] - mx) * (y[j] - my); syy += w[j] * (y[j] - my) ** 2; });
  if (sxx <= 0) return fail("few", used, black);
  const slope = sxy / sxx;
  if (!(slope < -1e-3)) return fail("flat", used, black);
  const k = -slope, td = OPACITY_K / k, r2 = syy > 0 ? Math.min(1, (sxy * sxy) / (sxx * syy)) : 1;
  const thickest = t[idx[idx.length - 1]];
  return { ok: true, td, r2, used, saturated: sat, lum, reversed, black, a: Math.exp(my + k * mx), k,
    rough: idx.length < 4 || r2 < 0.9 || td > 2.5 * thickest };
}

/** Von Hand: `dark` = erste Stufe (0 = dünnste), durch die kein Licht mehr scheint. Der TD liegt zwischen ihr und
 *  der Stufe davor; bei der dünnsten Stufe ist er höchstens so groß wie ihre Dicke. */
export function tdFromDarkStep(s: StairSpec, dark: number): number {
  const i = Math.min(s.count - 1, Math.max(0, Math.round(dark)));
  return i === 0 ? stairThickness(s, 0) : r4((stairThickness(s, i - 1) + stairThickness(s, i)) / 2);
}

/** Sinnvoll gerundeter TD für die Bibliothek */
export const roundTd = (td: number) => (td < 1 ? Math.round(td * 20) / 20 : Math.round(td * 10) / 10);
