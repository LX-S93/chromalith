/** Projekt (.chroma): Bild (eingebettet als PNG), Einstellungen, Filament-Stapel.
 *  Kompatibel mit den .chroma-Dateien der bisherigen Python-Version. */
import { colorError, layerPalette, nearestHeights, optimizeLumaPlan, optimizePlan } from "./colormatch";
import { isChromatic, filamentLuminance, filamentExtras, type Filament } from "./filaments";
import { buildHeightmap, normalizeSettings, prepareImage, type DigitRenderer, type EffectiveMode, type HeightMap, type HeightSettings } from "./heightmap";
import { autoPlan, ordered, type ColorStop } from "./plan";
import type { Raster } from "./raster";
import { applyIslands, normalizeIsland, type Island } from "./islands";

export const PROJECT_FORMAT = "chromalith-project";

export interface Project {
  name: string;
  image: Raster | null;
  /** PNG-Bytes des Originalbildes (unverändert, für Speichern/Export) */
  imagePng: Uint8Array | null;
  settings: HeightSettings;
  stops: ColorStop[];
  islands?: Island[];
  /** Tag-und-Nacht-Bild: zweites Bild (PNG), das im Gegenlicht erscheint, und das Filament der Rückplatte */
  nightPng?: Uint8Array | null;
  nightFilament?: NightFilament | null;
}
export interface NightFilament { name: string; color: string; td: number }

export function effectiveMode(p: Project): EffectiveMode {
  const m = p.settings.height_mode;
  if (m !== "auto") return m;
  if (p.stops.some((s) => isChromatic(s.filament))) return "color";
  const st = ordered(p.stops);
  if (st.length < 2) return "bright_high";
  return filamentLuminance(st[st.length - 1].filament) < filamentLuminance(st[0].filament) ? "dark_high" : "bright_high";
}

export function buildProject(p: Project, renderDigits?: DigitRenderer, settings: HeightSettings = p.settings): HeightMap {
  if (!p.image) throw new Error("Kein Bild geladen.");
  const mode = effectiveMode({ ...p, settings });
  let colorFn;
  if (mode === "color") {
    const { heights, colors } = layerPalette(p.stops, settings.base_layer_mm, settings.layer_height_mm, settings.min_height_mm, settings.max_height_mm);
    colorFn = (rgb: Float32Array, _w: number, _h: number, alpha: Float32Array) => nearestHeights(rgb, heights, colors, settings.color_detail, alpha);
  }
  const hm = buildHeightmap(p.image, settings, { mode, colorFn, renderDigits });
  const islands = (p.islands ?? []).filter((i) => i.seeds.length);
  if (islands.length) {
    const r = applyIslands(hm, islands, p.image.width, p.image.height, settings);
    hm.islandStops = r.stops; hm.restLayers = r.restLayers;
  }
  return hm;
}

/** Neue Verteilung der Wechsel-Schichten (Reihenfolge der Filamente bleibt). */
export function autoDistribute(p: Project, settings: HeightSettings = p.settings, renderDigits?: DigitRenderer): ColorStop[] {
  const fils = ordered(p.stops).map((s) => s.filament);
  if (!p.image || !fils.length) return p.stops;
  if (effectiveMode({ ...p, settings }) === "color") {
    const { w, h, rgb } = prepareImage(p.image, settings);
    return optimizePlan(rgb, w, h, fils, settings.base_layer_mm, settings.layer_height_mm, settings.min_height_mm, settings.max_height_mm);
  }
  const tmp: Project = { ...p, islands: [], stops: fils.map((f) => ({ filament: f, start_layer: 1 })) };
  const hm = buildProject(tmp, renderDigits, settings);
  return optimizeLumaPlan(hm, fils, autoPlan(fils, hm));
}

export { colorError };

// ---------------------------------------------------------------- Speichern / Laden
const b64encode = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const b64decode = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function serializeProject(p: Project): string {
  return JSON.stringify({
    format: PROJECT_FORMAT, version: 1, name: p.name, settings: p.settings,
    plan: p.stops.map((s) => ({ start_layer: s.start_layer, filament: s.filament, ...(s.disabled ? { disabled: true } : {}) })),
    islands: p.islands ?? [],
    image_png: p.imagePng ? b64encode(p.imagePng) : null,
    ...(p.nightPng ? { night_png: b64encode(p.nightPng), ...(p.nightFilament ? { night_filament: p.nightFilament } : {}) } : {}),
  });
}

export interface ParsedProject {
  name: string;
  settings: HeightSettings;
  stops: ColorStop[];
  islands: Island[];
  imagePng: Uint8Array | null;
  nightPng: Uint8Array | null;
  nightFilament: NightFilament | null;
}

export function parseProject(text: string): ParsedProject {
  const d = JSON.parse(text);
  if (d.format !== PROJECT_FORMAT) throw new Error("Keine Chromalith-Projektdatei.");
  const stops: ColorStop[] = (d.plan ?? []).map((s: any) => ({
    start_layer: Number(s.start_layer),
    ...(s.disabled === true ? { disabled: true } : {}),
    filament: { id: String(s.filament.id), name: String(s.filament.name), brand: String(s.filament.brand ?? ""),
      material: String(s.filament.material ?? "PLA"), color: String(s.filament.color), td: Number(s.filament.td),
      owned: Boolean(s.filament.owned), ...filamentExtras(s.filament) } as Filament,
  }));
  const islands = (d.islands ?? []).filter((i: any) => i && i.filament).map(normalizeIsland);
  const nf = d.night_filament;
  const nightFilament = nf && typeof nf.color === "string" && Number(nf.td) > 0 ? { name: String(nf.name ?? ""), color: nf.color, td: Number(nf.td) } : null;
  return { name: d.name ?? "Unbenannt", settings: normalizeSettings(d.settings), stops, islands, imagePng: d.image_png ? b64decode(d.image_png) : null,
    nightPng: typeof d.night_png === "string" && d.night_png ? b64decode(d.night_png) : null, nightFilament };
}
