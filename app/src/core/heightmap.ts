/** Bild -> Höhenkarte (mm), auf Druckschichten quantisiert, mit Form (rund, Loch, Rand, Ziffern). */
import { SRGB_TO_LINEAR_8, srgbToLab } from "./color";
import { crop, gaussianBlur, medianFilter, minFeature, resize, type Raster } from "./raster";

export const LUMA_METHODS = {
  rec709: "Wahrnehmung (Rec. 709)",
  rec601: "Wahrnehmung (Rec. 601)",
  average: "Mittelwert RGB",
  lightness: "CIE L* (Helligkeit)",
  max: "Maximum RGB",
} as const;
export type LumaMethod = keyof typeof LUMA_METHODS;

export const HEIGHT_MODES = {
  auto: "Automatisch (bunt = farbtreu, sonst Helligkeit)",
  bright_high: "Hell = hoch",
  dark_high: "Dunkel = hoch",
  color: "Farbtreu (nach Filamentfarben)",
} as const;
export type HeightMode = keyof typeof HEIGHT_MODES;
export type EffectiveMode = Exclude<HeightMode, "auto">;

export const SHAPES = { rect: "Rechteck", circle: "Rund" } as const;
export type Shape = keyof typeof SHAPES;
export const BREAKOUTS = { off: "Aus", attached: "Aufliegend (ohne Stützen)", floating: "Schwebend (mit Stützen)" } as const;
export type Breakout = keyof typeof BREAKOUTS;

export interface HeightSettings {
  width_mm: number;
  pixel_size_mm: number;
  min_height_mm: number;
  max_height_mm: number;
  base_layer_mm: number;
  layer_height_mm: number;
  luma_method: LumaMethod;
  linearize: boolean;
  height_mode: HeightMode;
  brightness: number;
  contrast: number;
  gamma: number;
  smoothing_px: number;
  detail_mm: number;
  border_mm: number;
  border_height_mm: number;
  shape: Shape;
  hole_mm: number;
  rim_mm: number;
  raise_mm: number;
  clock_numbers: boolean;
  numbers_mm: number;
  /** Motiv innerhalb der Form: Größe (1 = füllt die Form) und Versatz in % der Breite/Höhe. */
  image_scale: number;
  image_x: number;
  image_y: number;
  /** Motiv ragt über die Form hinaus: aus, aufliegend (eigene Grundplatte) oder schwebend (Luft darunter, braucht Stützen) */
  breakout: Breakout;
  /** Größe der Form in % der Bildbreite und ihr Versatz in % */
  breakout_frame: number;
  breakout_x: number;
  breakout_y: number;
  /** Farbtoleranz, bis zu der ein Punkt noch als Hintergrund gilt */
  breakout_tol: number;
  /** schwebend: Höhe der Unterseite über dem Druckbett */
  breakout_float_mm: number;
  /** Lithophanie statt Farbrelief */
  litho: boolean;
  litho_form: "flat" | "curved" | "cylinder" | "sphere";
  litho_min_mm: number;
  litho_max_mm: number;
  litho_angle_deg: number;
  litho_band_deg: number;
  litho_hole_mm: number;
  litho_loop: boolean;
  litho_invert: boolean;
  /** Breite des Bildes auf Kugel/Zylinder als Winkel (Grad); die Höhe folgt aus dem Seitenverhältnis */
  litho_img_deg: number;
  /** Bild um die Achse drehen (Grad) bzw. nach oben/unten schieben (-100..100 %) */
  litho_img_x: number;
  litho_img_y: number;
  /** Bild rundum wiederholen statt einmal aufsetzen */
  litho_repeat: boolean;
  /** Höhe des Zylinders; 0 = aus dem Bild */
  litho_height_mm: number;
  /** Kugel: Öffnung oben mit Schraubdeckel für das Leuchtmittel */
  litho_cap: boolean;
  /** Wandstärke von Kugel/Zylinder außerhalb des Bildes */
  litho_rest_mm: number;
  litho_cap_mm: number;
}

export const DEFAULT_SETTINGS: HeightSettings = {
  width_mm: 100, pixel_size_mm: 0.2, min_height_mm: 0.48, max_height_mm: 2.24,
  base_layer_mm: 0.2, layer_height_mm: 0.08, luma_method: "rec709", linearize: false,
  height_mode: "auto", brightness: 0, contrast: 1, gamma: 1, smoothing_px: 0, detail_mm: 0.4,
  border_mm: 0, border_height_mm: 0, shape: "rect", hole_mm: 0, rim_mm: 0, raise_mm: 0.6,
  clock_numbers: false, numbers_mm: 12, image_scale: 1, image_x: 0, image_y: 0,
  breakout: "off", breakout_frame: 75, breakout_x: 0, breakout_y: 0, breakout_tol: 14, breakout_float_mm: 0.6,
  litho: false, litho_form: "flat", litho_min_mm: 0.6, litho_max_mm: 2.6, litho_angle_deg: 120, litho_band_deg: 55,
  litho_hole_mm: 30, litho_loop: true, litho_invert: false,
  litho_img_deg: 150, litho_img_x: 0, litho_img_y: 0, litho_repeat: false, litho_height_mm: 0, litho_cap: false, litho_cap_mm: 26, litho_rest_mm: 2.2,
};

export function normalizeSettings(d: Partial<HeightSettings> | undefined): HeightSettings {
  const s: any = { ...DEFAULT_SETTINGS };
  for (const k of Object.keys(DEFAULT_SETTINGS)) if (d && (d as any)[k] !== undefined) s[k] = (d as any)[k];
  return s;
}

export function validate(s: HeightSettings): void {
  if (s.width_mm <= 0 || s.pixel_size_mm <= 0) throw new Error("Breite und Rasterweite müssen größer als 0 sein.");
  if (s.layer_height_mm <= 0 || s.base_layer_mm <= 0) throw new Error("Schichthöhen müssen größer als 0 sein.");
  if (s.max_height_mm <= s.min_height_mm) throw new Error("Maximale Höhe muss größer als die minimale Höhe sein.");
  if (s.min_height_mm < s.base_layer_mm) throw new Error("Minimale Höhe darf nicht kleiner als die erste Schicht sein.");
}

// ---------------------------------------------------------------- Schichten
export const layerTopZ = (layer: number, base: number, step: number) => (layer < 1 ? 0 : base + (layer - 1) * step);
export const layerBottomZ = (layer: number, base: number, step: number) => layerTopZ(layer - 1, base, step);
export const layerIndex = (z: number, base: number, step: number) => Math.round((z - base) / step) + 1;
export const quantize = (h: number, base: number, step: number) => base + Math.max(Math.round((h - base) / step), 0) * step;

// ---------------------------------------------------------------- Höhenkarte
export interface HeightMap {
  width: number; // Punkte in x
  height: number; // Punkte in y
  heights: Float32Array; // mm
  pixel_size_mm: number;
  base_layer_mm: number;
  layer_height_mm: number;
  rgb: Float32Array; // Originalfarben je Punkt (3 pro Punkt)
  border_px: number;
  mask: Uint8Array | null; // 1 = Material vorhanden
  /** Unterseite je Punkt in mm (schwebende Teile); fehlt = überall 0 */
  bottom?: Float32Array | null;
  /** Motiv (1) gegenüber Hintergrund (0), nur während des Aufbaus */
  subject?: Uint8Array | null;
  /** Farbinseln: zusätzliche Wechsel und Schichtzahl des Reliefs ohne Inseln */
  islandStops?: import("./plan").ColorStop[];
  restLayers?: number;
}

export const sizeMm = (hm: HeightMap): [number, number] => [(hm.width - 1) * hm.pixel_size_mm, (hm.height - 1) * hm.pixel_size_mm];

export function maxZ(hm: HeightMap): number {
  let m = 0;
  for (let i = 0; i < hm.heights.length; i++) if (hm.heights[i] > m) m = hm.heights[i];
  return m;
}

export const layerCount = (hm: HeightMap) => layerIndex(maxZ(hm), hm.base_layer_mm, hm.layer_height_mm);

export function minLayer(hm: HeightMap): number {
  let m = Infinity;
  for (let i = 0; i < hm.heights.length; i++) if ((!hm.mask || hm.mask[i]) && hm.heights[i] < m) m = hm.heights[i];
  return layerIndex(m === Infinity ? 0 : m, hm.base_layer_mm, hm.layer_height_mm);
}

/** Motiv innerhalb des Rasters verkleinern/vergrößern und verschieben. Die Fläche außerhalb des Motivs wird
 *  mit der Randfarbe des Bildes gefüllt, damit ein einfarbiger Hintergrund nahtlos weiterläuft. */
function placeImage(w: number, h: number, rgb: Float32Array, alpha: Float32Array, sc: number, ox: number, oy: number) {
  const fill = [0, 0, 0]; let fn = 0;
  const edge = (i: number) => { if (alpha[i] >= 0.5) { fill[0] += rgb[i * 3]; fill[1] += rgb[i * 3 + 1]; fill[2] += rgb[i * 3 + 2]; fn++; } };
  for (let x = 0; x < w; x++) { edge(x); edge((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { edge(y * w); edge(y * w + w - 1); }
  const out = new Float32Array(w * h * 3), oa = new Float32Array(w * h);
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = (x - cx - ox) / sc + cx, sy = (y - cy - oy) / sc + cy, o = y * w + x;
      if (sx < 0 || sy < 0 || sx > w - 1 || sy > h - 1) {
        if (fn) { out[o * 3] = fill[0] / fn; out[o * 3 + 1] = fill[1] / fn; out[o * 3 + 2] = fill[2] / fn; oa[o] = 1; }
        continue;
      }
      const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), fx = sx - x0, fy = sy - y0;
      const i00 = y0 * w + x0, i10 = y0 * w + x1, i01 = y1 * w + x0, i11 = y1 * w + x1;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      for (let c = 0; c < 3; c++) out[o * 3 + c] = rgb[i00 * 3 + c] * w00 + rgb[i10 * 3 + c] * w10 + rgb[i01 * 3 + c] * w01 + rgb[i11 * 3 + c] * w11;
      oa[o] = alpha[i00] * w00 + alpha[i10] * w10 + alpha[i01] * w01 + alpha[i11] * w11;
    }
  return { w, h, rgb: out, alpha: oa };
}

/** Bild auf Modellraster bringen. Rückgabe: RGB (3/Punkt) und Alpha. */
export function prepareImage(img: Raster, s: HeightSettings): { w: number; h: number; rgb: Float32Array; alpha: Float32Array } {
  let src = img;
  if (s.shape === "circle" && img.width !== img.height) {
    const side = Math.min(img.width, img.height);
    src = crop(img, Math.floor((img.width - side) / 2), Math.floor((img.height - side) / 2), side, side);
  }
  const w = Math.max(2, Math.round(s.width_mm / s.pixel_size_mm) + 1);
  const h = Math.max(2, Math.round((w * src.height) / src.width));
  const r = resize(src, w, h);
  const rgb = new Float32Array(w * h * 3), alpha = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    rgb[i * 3] = r.data[i * 4]; rgb[i * 3 + 1] = r.data[i * 4 + 1]; rgb[i * 3 + 2] = r.data[i * 4 + 2];
    alpha[i] = r.data[i * 4 + 3];
  }
  const sc = s.image_scale ?? 1, ox = ((s.image_x ?? 0) / 100) * w, oy = ((s.image_y ?? 0) / 100) * h;
  if (Math.abs(sc - 1) > 1e-3 || Math.abs(ox) > 1e-3 || Math.abs(oy) > 1e-3) return placeImage(w, h, rgb, alpha, Math.max(0.05, sc), ox, oy);
  return { w, h, rgb, alpha };
}

const lin = (v: number) => SRGB_TO_LINEAR_8[Math.max(0, Math.min(255, Math.round(v * 255)))];

export function luminance(rgb: Float32Array, method: LumaMethod, linearize: boolean): Float32Array {
  const n = rgb.length / 3, out = new Float32Array(n);
  const useLin = linearize || method === "lightness";
  for (let i = 0; i < n; i++) {
    let r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
    if (useLin) { r = lin(r); g = lin(g); b = lin(b); }
    let y: number;
    switch (method) {
      case "rec601": y = 0.299 * r + 0.587 * g + 0.114 * b; break;
      case "average": y = (r + g + b) / 3; break;
      case "max": y = Math.max(r, g, b); break;
      case "lightness": {
        const yy = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        y = (yy > 216 / 24389 ? Math.cbrt(yy) * 116 - 16 : (yy * 24389) / 27) / 100;
        break;
      }
      default: y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    out[i] = Math.max(0, Math.min(1, y));
  }
  return out;
}

export function adjustTone(v: number, s: HeightSettings): number {
  let x = Math.max(0, Math.min(1, (v - 0.5) * s.contrast + 0.5 + s.brightness));
  if (s.gamma !== 1) x = Math.pow(x, 1 / Math.max(s.gamma, 1e-3));
  return x;
}

export function detailKernel(s: HeightSettings): number {
  const k = s.detail_mm > 0 ? Math.round(s.detail_mm / s.pixel_size_mm) : 0;
  return k >= 2 ? k | 1 : 0;
}

/** Liefert für ein Raster (w×h) eine Maske der Uhr-Ziffern (1 = Ziffer). */
export type DigitRenderer = (w: number, h: number, digits: { text: string; x: number; y: number }[], sizePx: number) => Uint8Array;

export interface BuildOptions {
  mode: EffectiveMode;
  /** Für den farbtreuen Modus: RGB (3/Punkt) -> Höhe in mm je Punkt */
  colorFn?: (rgb: Float32Array, w: number, h: number) => Float32Array;
  renderDigits?: DigitRenderer;
}

/** Beruhigt fast ebene Flächen: Wo in der Umgebung nur zwei benachbarte Schichten vorkommen (z. B. ein fast
 *  weißer Hintergrund genau an einer Rundungsgrenze), gewinnt die Mehrheit. Das entfernt haarfeine Rillen und
 *  Sprenkel von einer Schicht Höhe, die sich ohnehin nicht sauber drucken lassen. Kanten und Details mit mehr
 *  als einer Schicht Unterschied bleiben unberührt. */
export function calmLayers(heights: Float32Array, w: number, h: number, step: number, r = 1, passes = 2): void {
  const tol = step * 0.25, win = (2 * r + 1) ** 2;
  for (let p = 0; p < passes; p++) {
    const src = heights.slice();
    let changed = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v = src[y * w + x];
        let lo = v, hi = v, nHi = 0, nLo = 0, ok = true;
        for (let dy = -r; dy <= r && ok; dy++) {
          const yy = Math.min(h - 1, Math.max(0, y + dy)) * w;
          for (let dx = -r; dx <= r; dx++) {
            const u = src[yy + Math.min(w - 1, Math.max(0, x + dx))];
            if (u < lo) lo = u; else if (u > hi) hi = u;
            if (hi - lo > step + tol) { ok = false; break; }
          }
        }
        if (!ok || hi - lo < tol) continue;
        const mid = (lo + hi) / 2;
        for (let dy = -r; dy <= r; dy++) {
          const yy = Math.min(h - 1, Math.max(0, y + dy)) * w;
          for (let dx = -r; dx <= r; dx++) src[yy + Math.min(w - 1, Math.max(0, x + dx))] > mid ? nHi++ : nLo++;
        }
        const t = nHi * 2 > win ? hi : nLo * 2 > win ? lo : v;
        if (t !== v) { heights[y * w + x] = t; changed++; }
      }
    if (!changed) break;
  }
}

/** Entfernt Scheinstufen: Flecken, die nur knapp über eine Rundungsgrenze gerutscht sind (z. B. eine kaum
 *  sichtbare Struktur in einem fast weißen Hintergrund), werden der umgebenden Schicht zugeschlagen. Ein Fleck
 *  gilt als Scheinstufe, wenn sein Mittelwert (vor dem Runden) nah an der Nachbarschicht liegt und er fast
 *  ganz von genau dieser Schicht umgeben ist. Echte Verläufe und Kanten bleiben, weil deren Stufen mittig liegen. */
export function calmRegions(heights: Float32Array, cont: Float32Array, w: number, h: number, step: number, near = 0.72): void {
  const n = w * h, label = new Int32Array(n).fill(-1), queue = new Int32Array(n);
  const same = (a: number, b: number) => Math.abs(a - b) < step * 0.25;
  for (let pass = 0; pass < 2; pass++) {
    label.fill(-1);
    let changed = false;
    for (let s0 = 0; s0 < n; s0++) {
      if (label[s0] >= 0) continue;
      const v = heights[s0];
      let head = 0, tail = 0, sum = 0, up = 0, down = 0, other = 0;
      queue[tail++] = s0; label[s0] = s0;
      while (head < tail) {
        const i = queue[head++], x = i % w;
        sum += cont[i];
        for (let k = 0; k < 4; k++) {
          const j = k === 0 ? i - 1 : k === 1 ? i + 1 : k === 2 ? i - w : i + w;
          if (j < 0 || j >= n || (k === 0 && x === 0) || (k === 1 && x === w - 1)) continue;
          const u = heights[j];
          if (same(u, v)) { if (label[j] < 0) { label[j] = s0; queue[tail++] = j; } }
          else if (same(u, v + step)) up++; else if (same(u, v - step)) down++; else other++;
        }
      }
      const border = up + down + other;
      if (!border || tail > n * 0.4) continue;
      const mean = sum / tail, d = (mean - v) / step; // Lage innerhalb der Schicht: -0,5 … +0,5
      const target = up >= border * 0.8 && d > 1 - near ? v + step : down >= border * 0.8 && d < -(1 - near) ? v - step : NaN;
      if (Number.isNaN(target)) continue;
      for (let q = 0; q < tail; q++) heights[queue[q]] = target;
      changed = true;
    }
    if (!changed) break;
  }
}

/** Trennt Motiv und Hintergrund: transparente Stellen sind Hintergrund; sonst alles, was vom Bildrand aus
 *  erreichbar ist und der Randfarbe ähnelt (Abstand im Lab-Raum unter `tol`). Liefert 1 = Motiv. */
export function subjectMask(rgb: Float32Array, alpha: Float32Array, w: number, h: number, tol: number): Uint8Array {
  const n = w * h, bg = new Uint8Array(n);
  let clear = 0;
  for (let i = 0; i < n; i++) if (alpha[i] < 0.5) { bg[i] = 1; clear++; }
  if (clear < n * 0.02) {
    const lab = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) srgbToLab(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2], lab, i * 3);
    const edge: number[] = [];
    for (let x = 0; x < w; x++) edge.push(x, (h - 1) * w + x);
    for (let y = 1; y < h - 1; y++) edge.push(y * w, y * w + w - 1);
    const med = (c: number) => { const v = edge.map((i) => lab[i * 3 + c]).sort((a, b) => a - b); return v[v.length >> 1]; };
    const L = med(0), A = med(1), B = med(2), t2 = tol * tol;
    const like = (i: number) => (lab[i * 3] - L) ** 2 + (lab[i * 3 + 1] - A) ** 2 + (lab[i * 3 + 2] - B) ** 2 < t2;
    const queue = new Int32Array(n);
    let head = 0, tail = 0;
    for (const i of edge) if (!bg[i] && like(i)) { bg[i] = 1; queue[tail++] = i; }
    while (head < tail) {
      const i = queue[head++], x = i % w;
      for (let k = 0; k < 4; k++) {
        const j = k === 0 ? i - 1 : k === 1 ? i + 1 : k === 2 ? i - w : i + w;
        if (j < 0 || j >= n || (k === 0 && x === 0) || (k === 1 && x === w - 1) || bg[j] || !like(j)) continue;
        bg[j] = 1; queue[tail++] = j;
      }
    }
  }
  // Sprenkel und ausgefranste Ränder glätten
  const f = medianFilter(Float32Array.from(bg, (v) => 1 - v), w, h, 5);
  return Uint8Array.from(f, (v) => (v > 0.5 ? 1 : 0));
}

export function buildHeightmap(img: Raster, s: HeightSettings, opt: BuildOptions): HeightMap {
  validate(s);
  const { w, h, rgb, alpha } = prepareImage(img, s);
  const n = w * h;
  let heights: Float32Array;
  if (opt.mode === "color") {
    if (!opt.colorFn) throw new Error("Farbtreuer Modus braucht einen Filament-Stapel.");
    const src = new Float32Array(rgb.length);
    for (let c = 0; c < 3; c++) {
      const ch = new Float32Array(n);
      for (let i = 0; i < n; i++) ch[i] = rgb[i * 3 + c];
      const bl = gaussianBlur(ch, w, h, s.smoothing_px);
      for (let i = 0; i < n; i++) src[i * 3 + c] = adjustTone(bl[i], s);
    }
    // Median: an Farbkanten treffen Mischpunkte oft eine ganz andere Höhe; solche 1-Punkt-Säume müssen weg
    heights = medianFilter(opt.colorFn(src, w, h), w, h, detailKernel(s));
  } else {
    let lum = luminance(rgb, s.luma_method, s.linearize);
    // kein Median: feine Linien (Haare, Konturen) sollen bleiben; minFeature macht sie unten druckbar
    // Grundglättung in halber Mindestbreite: feine Linien werden zu flachen, runden Rippen statt zu hohen Wänden
    lum = gaussianBlur(lum, w, h, Math.hypot(s.smoothing_px, s.detail_mm > 0 ? (0.5 * s.detail_mm) / s.pixel_size_mm : 0));
    heights = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = adjustTone(lum[i], s);
      const relief = opt.mode === "bright_high" ? t : 1 - t;
      heights[i] = s.min_height_mm + relief * (s.max_height_mm - s.min_height_mm);
    }
  }
  if (s.detail_mm > 0) heights = minFeature(heights, w, h, Math.max(2, Math.round(s.detail_mm / s.pixel_size_mm)), s.layer_height_mm * 1.5);
  for (let i = 0; i < n; i++) {
    if (alpha[i] < 0.5) heights[i] = s.min_height_mm;
  }
  const cont = heights.slice();
  for (let i = 0; i < n; i++) heights[i] = quantize(heights[i], s.base_layer_mm, s.layer_height_mm);
  calmRegions(heights, cont, w, h, s.layer_height_mm);
  calmLayers(heights, w, h, s.layer_height_mm, Math.max(1, Math.min(2, Math.round(0.4 / s.pixel_size_mm))));
  let hm: HeightMap = { width: w, height: h, heights, pixel_size_mm: s.pixel_size_mm, base_layer_mm: s.base_layer_mm,
    layer_height_mm: s.layer_height_mm, rgb, border_px: 0, mask: null };
  if (s.breakout !== "off") hm.subject = subjectMask(rgb, alpha, w, h, s.breakout_tol);
  else if (s.border_mm > 0) hm = addBorder(hm, s); // Rahmen und Herausragen schließen sich aus
  if (s.breakout !== "off") { applyBreakout(hm, s, opt.renderDigits); hm.subject = null; return hm; }
  applyShape(hm, s, opt.renderDigits);
  return hm;
}

function addBorder(hm: HeightMap, s: HeightSettings): HeightMap {
  const b = Math.max(1, Math.round(s.border_mm / s.pixel_size_mm));
  const bh = quantize(s.border_height_mm || s.max_height_mm, s.base_layer_mm, s.layer_height_mm);
  const W = hm.width + 2 * b, H = hm.height + 2 * b;
  const heights = new Float32Array(W * H).fill(bh), rgb = new Float32Array(W * H * 3);
  for (let y = 0; y < hm.height; y++) {
    heights.set(hm.heights.subarray(y * hm.width, (y + 1) * hm.width), (y + b) * W + b);
    rgb.set(hm.rgb.subarray(y * hm.width * 3, (y + 1) * hm.width * 3), ((y + b) * W + b) * 3);
  }
  return { ...hm, width: W, height: H, heights, rgb, border_px: b };
}

/** Form (Kreis oder Rechteck) kleiner als das Bild, das Motiv darf darüber hinausragen. Der Umriss ist die
 *  Form plus alle Motivteile, die mit ihr zusammenhängen. Schwebend: außerhalb der Form beginnt das Material
 *  erst in `breakout_float_mm` Höhe (Unterseite eben, damit Stützen sauber anliegen). */
export function applyBreakout(hm: HeightMap, s: HeightSettings, renderDigits?: DigitRenderer): void {
  const { width: w, height: h, pixel_size_mm: ps } = hm, n = w * h, sub = hm.subject!;
  const k = Math.min(1, Math.max(0.2, s.breakout_frame / 100));
  const cx = (w - 1) / 2 + (s.breakout_x / 100) * w, cy = (h - 1) / 2 + (s.breakout_y / 100) * h;
  const radius = (Math.min(w - 1, h - 1) * k) / 2, hx = ((w - 1) * k) / 2, hy = ((h - 1) * k) / 2;
  const rim = s.rim_mm / ps, hole = s.hole_mm / 2 / ps;
  const top = quantize(maxZ(hm) + s.raise_mm, hm.base_layer_mm, hm.layer_height_mm);
  const frame = new Uint8Array(n), mask = new Uint8Array(n), queue = new Int32Array(n);
  let head = 0, tail = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x, dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy);
      const inside = s.shape === "circle" ? r <= radius : Math.abs(dx) <= hx && Math.abs(dy) <= hy;
      if (!inside) continue;
      frame[i] = 1;
      if (hole > 0 && r < hole) continue;
      mask[i] = 1; queue[tail++] = i;
      const onRim = rim > 0 && (s.shape === "circle" ? r >= radius - rim : Math.abs(dx) >= hx - rim || Math.abs(dy) >= hy - rim);
      // der Rand läuft hinter dem Motiv durch: wo das Motiv liegt, bleibt dessen Relief
      if (onRim && !sub[i]) hm.heights[i] = top;
    }
  // Motivteile außerhalb der Form, die an der Form hängen
  while (head < tail) {
    const i = queue[head++], x = i % w;
    for (let d = 0; d < 4; d++) {
      const j = d === 0 ? i - 1 : d === 1 ? i + 1 : d === 2 ? i - w : i + w;
      if (j < 0 || j >= n || (d === 0 && x === 0) || (d === 1 && x === w - 1) || mask[j] || frame[j] || !sub[j]) continue;
      mask[j] = 1; queue[tail++] = j;
    }
  }
  if (s.clock_numbers && renderDigits && s.shape === "circle") {
    const sizePx = Math.max(6, Math.round(s.numbers_mm / ps)), rr = radius - Math.max(rim, 0) - (s.numbers_mm * 0.75) / ps;
    const dm = renderDigits(w, h, Array.from({ length: 12 }, (_, q) => {
      const a = ((q + 1) * 30 * Math.PI) / 180;
      return { text: String(q + 1), x: cx + rr * Math.sin(a), y: cy - rr * Math.cos(a) };
    }), sizePx);
    for (let i = 0; i < n; i++) if (dm[i] && mask[i] && frame[i] && !sub[i]) hm.heights[i] = top;
  }
  if (s.breakout === "floating") {
    const z0 = quantize(Math.max(s.breakout_float_mm, hm.base_layer_mm), hm.base_layer_mm, hm.layer_height_mm);
    const minTop = quantize(z0 + 0.4, hm.base_layer_mm, hm.layer_height_mm);
    const bottom = new Float32Array(n);
    let any = false;
    for (let i = 0; i < n; i++) if (mask[i] && !frame[i]) { bottom[i] = z0; any = true; if (hm.heights[i] < minTop) hm.heights[i] = minTop; }
    hm.bottom = any ? bottom : null;
  }
  for (let i = 0; i < n; i++) if (!mask[i]) hm.heights[i] = 0;
  hm.mask = mask;
}

export function applyShape(hm: HeightMap, s: HeightSettings, renderDigits?: DigitRenderer): void {
  const { width: w, height: h, pixel_size_mm: ps } = hm;
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  const top = quantize(maxZ(hm) + s.raise_mm, hm.base_layer_mm, hm.layer_height_mm);
  const radius = s.shape === "circle" ? (Math.min(w - 1, h - 1) * ps) / 2 : null;
  const mask = new Uint8Array(w * h).fill(1);
  let anyCut = false;
  const rimPx = Math.max(1, Math.round(s.rim_mm / ps));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const r = Math.hypot((x - cx) * ps, (y - cy) * ps);
      if (radius !== null && r > radius) { mask[i] = 0; anyCut = true; continue; }
      if (s.hole_mm > 0 && r < s.hole_mm / 2) { mask[i] = 0; anyCut = true; continue; }
      if (s.rim_mm > 0) {
        const onRim = radius !== null ? r >= radius - s.rim_mm
          : x < rimPx || y < rimPx || x >= w - rimPx || y >= h - rimPx;
        if (onRim) hm.heights[i] = top;
      }
    }
  if (s.clock_numbers && renderDigits) {
    const sizePx = Math.max(6, Math.round(s.numbers_mm / ps));
    const outer = (radius ?? (Math.min(w - 1, h - 1) * ps) / 2) - Math.max(s.rim_mm, 0);
    const rr = (outer - s.numbers_mm * 0.75) / ps;
    const digits = Array.from({ length: 12 }, (_, k) => {
      const a = ((k + 1) * 30 * Math.PI) / 180;
      return { text: String(k + 1), x: cx + rr * Math.sin(a), y: cy - rr * Math.cos(a) };
    });
    const dm = renderDigits(w, h, digits, sizePx);
    for (let i = 0; i < w * h; i++) if (dm[i] && mask[i]) hm.heights[i] = top;
  }
  if (anyCut) {
    for (let i = 0; i < w * h; i++) if (!mask[i]) hm.heights[i] = 0;
    hm.mask = mask;
  }
}

/** Verkleinern durch Blockmittelung (für Vorschau/3D), danach wieder quantisiert. */
export function downsample(hm: HeightMap, maxSide: number): HeightMap {
  const f = Math.ceil(Math.max(hm.width, hm.height) / maxSide);
  if (f <= 1) return hm;
  const W = Math.floor(hm.width / f), H = Math.floor(hm.height / f);
  const heights = new Float32Array(W * H), rgb = new Float32Array(W * H * 3);
  const mask = hm.mask ? new Uint8Array(W * H) : null;
  const bottom = hm.bottom ? new Float32Array(W * H) : null;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let hs = 0, r = 0, g = 0, b = 0, m = 0, bz = 0, bn = 0;
      for (let dy = 0; dy < f; dy++)
        for (let dx = 0; dx < f; dx++) {
          const i = (y * f + dy) * hm.width + x * f + dx;
          hs += hm.heights[i]; r += hm.rgb[i * 3]; g += hm.rgb[i * 3 + 1]; b += hm.rgb[i * 3 + 2];
          if (hm.mask) m += hm.mask[i];
          if (bottom && hm.bottom![i] > bz) bz = hm.bottom![i];
          if (bottom && hm.bottom![i] > 0) bn++;
        }
      const o = y * W + x, nn = f * f;
      heights[o] = quantize(hs / nn, hm.base_layer_mm, hm.layer_height_mm);
      rgb[o * 3] = r / nn; rgb[o * 3 + 1] = g / nn; rgb[o * 3 + 2] = b / nn;
      if (mask) mask[o] = m / nn > 0.5 ? 1 : 0;
      if (bottom) bottom[o] = bn / nn > 0.5 ? bz : 0;
    }
  return { ...hm, width: W, height: H, heights, rgb, mask, bottom, pixel_size_mm: hm.pixel_size_mm * f, border_px: Math.floor(hm.border_px / f) };
}
