/** Farbumrechnungen (sRGB, linear, CIE-Lab). Alle Werte 0..1. */

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  let c = hex.trim().replace(/^#/, "");
  if (c.length === 3) c = c.split("").map((ch) => ch + ch).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(c)) throw new Error(`Ungültige Farbe: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255) as RGB;
}

export function rgbToHex(rgb: ArrayLike<number>): string {
  const h = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
  return `#${h(rgb[0])}${h(rgb[1])}${h(rgb[2])}`;
}

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c: number): number {
  c = Math.max(0, Math.min(1, c));
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** Schnelle Tabelle für sRGB(8 bit) -> linear. */
export const SRGB_TO_LINEAR_8 = new Float32Array(256).map((_, i) => srgbToLinear(i / 255));

const WX = 0.95047, WY = 1.0, WZ = 1.08883;
const EPS = 216 / 24389, KAPPA = 24389 / 27;
const f = (t: number) => (t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116);

/** sRGB (0..1) -> Lab, schreibt in out[o..o+2]. */
export function srgbToLab(r: number, g: number, b: number, out: Float32Array | number[], o = 0): void {
  const lr = srgbToLinear(r), lg = srgbToLinear(g), lb = srgbToLinear(b);
  const x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / WX;
  const y = (0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb) / WY;
  const z = (0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / WZ;
  const fx = f(x), fy = f(y), fz = f(z);
  out[o] = 116 * fy - 16;
  out[o + 1] = 500 * (fx - fy);
  out[o + 2] = 200 * (fy - fz);
}

export function labOf(rgb: ArrayLike<number>): number[] {
  const out = [0, 0, 0];
  srgbToLab(rgb[0], rgb[1], rgb[2], out);
  return out;
}

/** Lab für ein ganzes RGB-Array (Länge 3n). */
export function labArray(rgb: Float32Array): Float32Array {
  const out = new Float32Array(rgb.length);
  for (let i = 0; i < rgb.length; i += 3) srgbToLab(rgb[i], rgb[i + 1], rgb[i + 2], out, i);
  return out;
}

export function luminanceOf(rgb: ArrayLike<number>): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

export function chroma(rgb: ArrayLike<number>): number {
  const l = labOf(rgb);
  return Math.hypot(l[1], l[2]);
}
