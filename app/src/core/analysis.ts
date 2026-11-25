/** Farbanalyse: Hauptfarben des Bildes, ähnlichstes Filament, Flächenanteil je Filament. */
import { hexToRgb, labOf, rgbToHex, srgbToLab } from "./color";
import type { Filament } from "./filaments";
import { layerCount, type HeightMap } from "./heightmap";
import { innerIndices, segments, type ColorStop } from "./plan";

/** Hauptfarben per k-Means (deterministisch) auf einer verkleinerten Kopie. */
export function imagePalette(rgb: Float32Array, k = 10, maxSamples = 20000): { color: string; share: number }[] {
  const n = rgb.length / 3;
  const step = Math.max(1, Math.floor(n / maxSamples));
  const pts: number[][] = [];
  for (let i = 0; i < n; i += step) pts.push([rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]]);
  const labs = pts.map((p) => labOf(p));
  // k-means++ mit festem Zufallsgenerator
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const d2 = (a: number[], b: number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  const centers: number[][] = [labs[Math.floor(rnd() * labs.length)]];
  while (centers.length < Math.min(k, labs.length)) {
    const dist = labs.map((p) => Math.min(...centers.map((c) => d2(p, c))));
    const sum = dist.reduce((a, b) => a + b, 0);
    if (sum === 0) break;
    let r = rnd() * sum, i = 0;
    while (r > dist[i] && i < dist.length - 1) r -= dist[i++];
    centers.push(labs[i].slice());
  }
  const assign = new Int32Array(labs.length);
  for (let it = 0; it < 12; it++) {
    labs.forEach((p, i) => {
      let best = Infinity;
      centers.forEach((c, j) => { const d = d2(p, c); if (d < best) { best = d; assign[i] = j; } });
    });
    const acc = centers.map(() => [0, 0, 0, 0]);
    labs.forEach((p, i) => { const a = acc[assign[i]]; a[0] += p[0]; a[1] += p[1]; a[2] += p[2]; a[3]++; });
    acc.forEach((a, j) => { if (a[3]) centers[j] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; });
  }
  const sums = centers.map(() => [0, 0, 0, 0]);
  pts.forEach((p, i) => { const s = sums[assign[i]]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++; });
  return sums.filter((s) => s[3] > 0).map((s) => ({ color: rgbToHex([s[0] / s[3], s[1] / s[3], s[2] / s[3]]), share: s[3] / pts.length }))
    .sort((a, b) => b.share - a.share);
}

export function nearestFilament(color: string, filaments: Filament[]): { filament: Filament | null; distance: number } {
  if (!filaments.length) return { filament: null, distance: 0 };
  const c = labOf(hexToRgb(color));
  let best: Filament | null = null, bd = Infinity;
  const l = [0, 0, 0];
  for (const f of filaments) {
    const rgb = hexToRgb(f.color);
    srgbToLab(rgb[0], rgb[1], rgb[2], l);
    const d = Math.hypot(l[0] - c[0], l[1] - c[1], l[2] - c[2]);
    if (d < bd) { bd = d; best = f; }
  }
  return { filament: best, distance: bd };
}

/** Je Filament: Anteil der Bildfläche, auf der es ganz oben liegt. */
export function filamentUsage(hm: HeightMap, stops: ColorStop[]) {
  const idx = innerIndices(hm);
  const segs = segments(stops, hm.base_layer_mm, hm.layer_height_mm, Math.max(layerCount(hm), 1));
  const eps = 1e-4;
  const cell = hm.pixel_size_mm * hm.pixel_size_mm;
  return segs.map((s) => {
    let c = 0;
    for (const i of idx) { const h = hm.heights[i]; if (h > s.z0 + eps && h <= s.z1 + eps) c++; }
    // Volumen dieses Filaments: Material zwischen z0 und z1 über die ganze Fläche (inkl. Rahmen)
    let vol = 0;
    for (let i = 0; i < hm.heights.length; i++) {
      if (hm.mask && !hm.mask[i]) continue;
      const h = hm.heights[i];
      if (h > s.z0) vol += (Math.min(h, s.z1) - s.z0) * cell;
    }
    return { filament: s.filament, share: c / Math.max(1, idx.length), first: s.first, last: s.last, z0: s.z0, z1: s.z1, volume_mm3: vol };
  });
}

/** Materialfamilie für Filter: „PLA+“, „PLA Matte“ und „PLA-CF“ zählen zu PLA usw. */
export function materialFamily(material: string): string {
  const m = material.toUpperCase().trim();
  for (const f of ["PETG", "PLA", "ABS", "ASA", "TPU", "PC", "PA"]) if (m.startsWith(f)) return f;
  return m || "PLA";
}

/** Dichte in g/cm³ nach Material (Näherung). */
export function materialDensity(material: string): number {
  const m = material.toUpperCase();
  if (m.includes("PETG")) return 1.27;
  if (m.includes("ABS")) return 1.04;
  if (m.includes("ASA")) return 1.07;
  if (m.includes("TPU")) return 1.21;
  if (m.includes("PC")) return 1.2;
  return 1.24; // PLA
}
