/** Bild -> Höhenkarte (mm), auf Druckschichten quantisiert, mit Form (rund, Loch, Rand, Ziffern). */
import { SRGB_TO_LINEAR_8 } from "./color";
import { crop, gaussianBlur, medianFilter, resize, type Raster } from "./raster";

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
}

export const DEFAULT_SETTINGS: HeightSettings = {
  width_mm: 100, pixel_size_mm: 0.2, min_height_mm: 0.48, max_height_mm: 2.24,
  base_layer_mm: 0.2, layer_height_mm: 0.08, luma_method: "rec709", linearize: false,
  height_mode: "auto", brightness: 0, contrast: 1, gamma: 1, smoothing_px: 0, detail_mm: 0,
  border_mm: 0, border_height_mm: 0, shape: "rect", hole_mm: 0, rim_mm: 0, raise_mm: 0.6,
  clock_numbers: false, numbers_mm: 12,
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
    heights = medianFilter(opt.colorFn(src, w, h), w, h, detailKernel(s));
  } else {
    let lum = luminance(rgb, s.luma_method, s.linearize);
    lum = medianFilter(lum, w, h, detailKernel(s));
    lum = gaussianBlur(lum, w, h, s.smoothing_px);
    heights = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = adjustTone(lum[i], s);
      const relief = opt.mode === "bright_high" ? t : 1 - t;
      heights[i] = s.min_height_mm + relief * (s.max_height_mm - s.min_height_mm);
    }
  }
  for (let i = 0; i < n; i++) {
    if (alpha[i] < 0.5) heights[i] = s.min_height_mm;
    heights[i] = quantize(heights[i], s.base_layer_mm, s.layer_height_mm);
  }
  let hm: HeightMap = { width: w, height: h, heights, pixel_size_mm: s.pixel_size_mm, base_layer_mm: s.base_layer_mm,
    layer_height_mm: s.layer_height_mm, rgb, border_px: 0, mask: null };
  if (s.border_mm > 0) hm = addBorder(hm, s);
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
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let hs = 0, r = 0, g = 0, b = 0, m = 0;
      for (let dy = 0; dy < f; dy++)
        for (let dx = 0; dx < f; dx++) {
          const i = (y * f + dy) * hm.width + x * f + dx;
          hs += hm.heights[i]; r += hm.rgb[i * 3]; g += hm.rgb[i * 3 + 1]; b += hm.rgb[i * 3 + 2];
          if (hm.mask) m += hm.mask[i];
        }
      const o = y * W + x, nn = f * f;
      heights[o] = quantize(hs / nn, hm.base_layer_mm, hm.layer_height_mm);
      rgb[o * 3] = r / nn; rgb[o * 3 + 1] = g / nn; rgb[o * 3 + 2] = b / nn;
      if (mask) mask[o] = m / nn > 0.5 ? 1 : 0;
    }
  return { ...hm, width: W, height: H, heights, rgb, mask, pixel_size_mm: hm.pixel_size_mm * f, border_px: Math.floor(hm.border_px / f) };
}
