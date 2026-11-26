/** Farbwechsel-Plan (welches Filament ab welcher Schicht) und Farbsimulation. */
import { hexToRgb, linearToSrgb, srgbToLinear } from "./color";
import { filamentLabel, type Filament } from "./filaments";
import { layerBottomZ, layerCount, layerIndex, layerTopZ, maxZ, minLayer, sizeMm, type HeightMap } from "./heightmap";

/** Deckkraft einer Lage der Dicke t: 1 - exp(-K t / TD); bei t = TD sind 95 % abgedeckt. */
export const OPACITY_K = Math.log(20);
export const BACKGROUND: [number, number, number] = [0.17, 0.17, 0.17];

export interface ColorStop {
  filament: Filament;
  start_layer: number; // 1-basiert
  /** Vorübergehend ausgeblendet: bleibt im Stapel, wird aber nicht gedruckt und nicht berechnet. */
  disabled?: boolean;
}

export interface Segment {
  filament: Filament;
  z0: number;
  z1: number;
  first: number;
  last: number;
}

/** Nach Startschicht sortiert (stabil). */
export const ordered = (stops: ColorStop[]) => stops.map((s, i) => [s, i] as const)
  .sort((a, b) => a[0].start_layer - b[0].start_layer || a[1] - b[1]).map((x) => x[0]);

/** Sortiert, erste Startschicht = 1, gleiche Startschicht: letzte gewinnt. */
export function normalized(stops: ColorStop[]): ColorStop[] {
  const out: ColorStop[] = [];
  for (const s of ordered(stops.filter((x) => !x.disabled))) {
    if (out.length && out[out.length - 1].start_layer === s.start_layer) out[out.length - 1] = s;
    else out.push(s);
  }
  if (out.length) out[0] = { ...out[0], start_layer: 1 };
  return out;
}

export function segments(stops: ColorStop[], base: number, step: number, maxLayer: number): Segment[] {
  const st = normalized(stops).filter((s) => s.start_layer <= maxLayer);
  return st.map((s, i) => {
    const last = i + 1 < st.length ? st[i + 1].start_layer - 1 : maxLayer;
    return { filament: s.filament, z0: layerBottomZ(s.start_layer, base, step), z1: layerTopZ(last, base, step), first: s.start_layer, last };
  });
}

export function filamentAtLayer(stops: ColorStop[], layer: number): Filament | null {
  let cur: Filament | null = null;
  for (const s of normalized(stops)) if (s.start_layer <= layer) cur = s.filament;
  return cur;
}

/** Simulierte Draufsicht (sRGB, 3/Punkt). Schichten werden von unten nach oben übereinandergelegt. */
export function simulate(hm: HeightMap, stops: ColorStop[], heights: Float32Array = hm.heights, maskOut = true): Float32Array {
  const n = heights.length;
  const out = new Float32Array(n * 3);
  const segs = segments(stops, hm.base_layer_mm, hm.layer_height_mm, Math.max(layerCount(hm), 1));
  if (!segs.length) return out.fill(0.5);
  const lins = segs.map((s) => hexToRgb(s.filament.color).map(srgbToLinear));
  const ks = segs.map((s) => OPACITY_K / Math.max(s.filament.td, 1e-3));
  const bot = heights === hm.heights ? hm.bottom ?? null : null;
  for (let i = 0; i < n; i++) {
    const h = heights[i], z0 = bot ? bot[i] : 0;
    // schwebende Teile: die Schichten unter der Unterseite fehlen, die Farbe beginnt beim ersten vorhandenen Filament
    let k0 = 0;
    if (z0 > 0) while (k0 < segs.length - 1 && segs[k0].z1 <= z0) k0++;
    let r = lins[k0][0], g = lins[k0][1], b = lins[k0][2];
    for (let k = k0; k < segs.length; k++) {
      const t = Math.min(h, segs[k].z1) - Math.max(segs[k].z0, z0);
      if (t <= 0) break;
      const a = 1 - Math.exp(-ks[k] * t);
      r += (lins[k][0] - r) * a; g += (lins[k][1] - g) * a; b += (lins[k][2] - b) * a;
    }
    out[i * 3] = linearToSrgb(r); out[i * 3 + 1] = linearToSrgb(g); out[i * 3 + 2] = linearToSrgb(b);
  }
  if (maskOut && hm.mask && heights === hm.heights)
    for (let i = 0; i < n; i++) if (!hm.mask[i]) out.set(BACKGROUND, i * 3);
  return out;
}

/** Bildinnenfläche (ohne Rahmen, nur Material) als Liste von Indizes. */
export function innerIndices(hm: HeightMap): Uint32Array {
  const b = hm.border_px, idx: number[] = [];
  for (let y = b; y < hm.height - b; y++)
    for (let x = b; x < hm.width - b; x++) {
      const i = y * hm.width + x;
      if (!hm.mask || hm.mask[i]) idx.push(i);
    }
  return Uint32Array.from(idx);
}

/** Verteilt die Filamente so, dass jedes etwa gleich viel Bildfläche prägt (Höhen-Quantile). */
export function autoPlan(filaments: Filament[], hm: HeightMap): ColorStop[] {
  if (!filaments.length) return [];
  const lo = minLayer(hm), hi = layerCount(hm);
  const idx = innerIndices(hm);
  const layers = Array.from(idx, (i) => layerIndex(hm.heights[i], hm.base_layer_mm, hm.layer_height_mm)).sort((a, b) => a - b);
  const n = filaments.length;
  const stops: ColorStop[] = [{ filament: filaments[0], start_layer: 1 }];
  for (let i = 1; i < n; i++) {
    const q = layers[Math.min(layers.length - 1, Math.floor((layers.length * i) / n))] ?? lo;
    const prev = stops[stops.length - 1].start_layer;
    const cap = hi - 2 * (n - 1 - i) - 1; // jedes weitere Filament bekommt mindestens 2 Schichten
    let layer = Math.max(q + 1, lo + 1, prev + 1);
    layer = Math.max(Math.min(layer, cap), prev + 1);
    stops.push({ filament: filaments[i], start_layer: Math.min(layer, hi) });
  }
  return stops;
}

export function planReport(hm: HeightMap, stops: ColorStop[], title = ""): string {
  const segs = segments(stops, hm.base_layer_mm, hm.layer_height_mm, layerCount(hm));
  const [w, d] = sizeMm(hm);
  const f2 = (v: number) => v.toFixed(2);
  const lines = ["Chromalith – Farbwechsel-Plan"];
  if (title) lines.push(`Projekt: ${title}`);
  lines.push(
    `Modellgröße: ${w.toFixed(1)} x ${d.toFixed(1)} mm, Höhe ${f2(maxZ(hm))} mm`,
    `Erste Schicht: ${f2(hm.base_layer_mm)} mm, weitere Schichten: ${f2(hm.layer_height_mm)} mm`,
    `Schichten gesamt: ${layerCount(hm)}`, "",
    "Wichtig: Im Slicer genau diese Schichthöhen einstellen.",
    "Den Farbwechsel jeweils VOR der genannten Schicht einfügen (z. B. M600 / Pause).", "");
  segs.forEach((s, i) => {
    const f = s.filament;
    const desc = `${filamentLabel(f)} (${f.material}, ${f.color}, TD ${f.td} mm)`;
    if (i === 0) lines.push(`Start mit Schicht 1 (Z 0.00 mm): ${desc}`);
    else lines.push(`Wechsel vor Schicht ${s.first} (Oberkante Z ${f2(layerTopZ(s.first, hm.base_layer_mm, hm.layer_height_mm))} mm, ab Z ${f2(s.z0)} mm): ${desc}`);
    lines.push(`    Schichten ${s.first}–${s.last}`);
  });
  return lines.join("\n") + "\n";
}

export function planJson(hm: HeightMap, stops: ColorStop[]) {
  const segs = segments(stops, hm.base_layer_mm, hm.layer_height_mm, layerCount(hm));
  return {
    format: "chromalith-colorplan", version: 1, base_layer_mm: hm.base_layer_mm, layer_height_mm: hm.layer_height_mm,
    layer_count: layerCount(hm), max_z_mm: +maxZ(hm).toFixed(4),
    changes: segs.map((s) => ({ start_layer: s.first, end_layer: s.last, z_from_mm: +s.z0.toFixed(4), z_to_mm: +s.z1.toFixed(4), filament: s.filament })),
  };
}
