/** Filamente, Bibliothek und Import vorhandener Bibliotheken/Sets. */
import { hexToRgb, luminanceOf, chroma, type RGB } from "./color";
import starter from "./starter_filaments.json";

export const LIBRARY_FORMAT = "chromalith-filaments";

export interface Filament {
  id: string;
  name: string;
  brand: string;
  material: string;
  color: string; // #rrggbb
  td: number; // Transmissions-Distanz in mm
  owned: boolean;
}

export const filamentRgb = (f: Filament): RGB => hexToRgb(f.color);
export const filamentLabel = (f: Filament) => `${f.brand} ${f.name}`.trim();
export const filamentLuminance = (f: Filament) => luminanceOf(hexToRgb(f.color));
export const isChromatic = (f: Filament, threshold = 15) => chroma(hexToRgb(f.color)) > threshold;

export function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `f-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function makeFilament(p: Partial<Filament> & { name: string; color: string; td: number }): Filament {
  return { id: p.id ?? newId(), brand: p.brand ?? "", material: p.material ?? "PLA", owned: p.owned ?? false,
    name: p.name, color: p.color, td: p.td };
}

function fromOwn(d: any): Filament {
  return makeFilament({ id: String(d.id ?? newId()), name: String(d.name), color: String(d.color), td: Number(d.td),
    brand: String(d.brand ?? ""), material: String(d.material ?? "PLA"), owned: Boolean(d.owned) });
}

/** Einträge im verbreiteten Schema Brand/Name/Type/Color/Transmissivity/Owned/uuid. */
function fromForeign(d: any): Filament {
  return makeFilament({ id: String(d.uuid ?? d.id ?? newId()).replace(/[{}]/g, ""), name: String(d.Name ?? ""),
    color: String(d.Color ?? "#808080"), td: Number(d.Transmissivity ?? 1), brand: String(d.Brand ?? ""),
    material: String(d.Type ?? "PLA"), owned: Boolean(d.Owned) });
}

export function parseFilaments(data: any): Filament[] {
  if (data && data.format === LIBRARY_FORMAT) return (data.filaments ?? []).map(fromOwn);
  let items: any[] | undefined;
  if (Array.isArray(data)) items = data;
  else if (data) for (const k of ["filaments", "Filaments", "filament_set"]) if (k in data) { items = data[k]; break; }
  if (!items) throw new Error("Keine Filamente in der Datei gefunden.");
  return items.map((d) => ("Transmissivity" in d || "Brand" in d || "Color" in d ? fromForeign(d) : fromOwn(d)));
}

export function serializeLibrary(list: Filament[]): string {
  return JSON.stringify({ format: LIBRARY_FORMAT, version: 1, filaments: list }, null, 2);
}

export function starterLibrary(): Filament[] {
  return parseFilaments(starter);
}
