/** Spoolman-Anbindung: Rollen aus der Spoolman-API (GET /api/v1/spool) in Bibliotheks-Filamente übersetzen.
 *  Hier nur die reine Umrechnung, ohne Netzwerk – der Abruf liegt in der Plattform-Schicht. */
import { hexToRgb, labOf } from "./color";
import { filamentKey, newId, normalizeColor, type Filament } from "./filaments";

/** Vereinheitlicht die eingegebene Adresse: ergänzt http://, entfernt Pfad-Reste wie /api/v1. */
export function spoolmanBase(input: string): string {
  let s = input.trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = "http://" + s;
  return s.replace(/\/+$/, "").replace(/\/api(\/v1)?$/i, "").replace(/\/+$/, "");
}
export const spoolmanUrl = (base: string, path: string) => `${spoolmanBase(base)}/api/v1/${path.replace(/^\/+/, "")}`;

/** Zusatzfelder kommen JSON-kodiert ("1.8" oder "\"1,8\""). */
function extraNumber(v: unknown): number | null {
  let x: unknown = v;
  for (let i = 0; i < 2 && typeof x === "string"; i++) {
    const s = x.trim();
    try { x = JSON.parse(s); } catch { x = Number(s.replace(",", ".")); break; }
  }
  const n = typeof x === "number" ? x : Number(String(x).replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

const TD_KEY = /^([a-z0-9]+[_\- ])?td([_\- ]?(value|wert|mm))?$|transmi/i;
/** TD aus den Zusatzfeldern eines Spoolman-Filaments (Schlüssel z. B. „td“, „td_mm“ oder mit Vorsatz wie „filament_td“). */
export function spoolmanTd(extra: unknown): number | null {
  if (!extra || typeof extra !== "object") return null;
  for (const [k, v] of Object.entries(extra)) if (TD_KEY.test(k)) { const n = extraNumber(v); if (n !== null && n <= 100) return n; }
  return null;
}

export interface SpoolmanEntry {
  spoolman_id: number;
  name: string; brand: string; material: string; color: string;
  td: number | null;
  remaining_g: number | null;
  price: number | null; // € pro kg
  spools: number;
}

/** Fasst die Rollen je Spoolman-Filament zusammen (Restgewicht addiert). Archivierte Rollen zählen nicht. */
export function spoolmanEntries(spools: any): { entries: SpoolmanEntry[]; skipped: number } {
  if (!Array.isArray(spools)) throw new Error("Unerwartete Antwort – ist das die Adresse von Spoolman?");
  const map = new Map<number, SpoolmanEntry>();
  let skipped = 0;
  for (const s of spools) {
    const f = s?.filament;
    if (!f || s.archived) continue;
    const color = normalizeColor(f.color_hex) ?? normalizeColor(String(f.multi_color_hexes ?? "").split(",")[0]);
    if (!color) { skipped++; continue; }
    const id = Number(f.id);
    let e = map.get(id);
    if (!e) {
      e = { spoolman_id: id, name: String(f.name ?? "").trim() || String(f.material ?? "Filament"), brand: String(f.vendor?.name ?? "").trim(),
        material: String(f.material ?? "PLA").trim() || "PLA", color, td: spoolmanTd(f.extra) ?? spoolmanTd(s.extra), remaining_g: null, price: null, spools: 0 };
      map.set(id, e);
    }
    e.spools++;
    const rest = Number(s.remaining_weight);
    if (s.remaining_weight != null && Number.isFinite(rest)) e.remaining_g = (e.remaining_g ?? 0) + Math.max(0, rest);
    const price = Number(s.price ?? f.price), weight = Number(s.initial_weight ?? f.weight) || 1000;
    if (e.price === null && Number.isFinite(price) && price > 0) e.price = Math.round((price / weight) * 1000 * 100) / 100;
  }
  return { entries: [...map.values()], skipped };
}

export interface SpoolmanSync { added: number; updated: number; gone: number; estimated: number; skipped: number; total: number }

/** TD schätzen: vom farblich nächsten Bibliotheks-Filament mit bekanntem TD (gleiches Material bevorzugt). */
function estimateTd(e: SpoolmanEntry, known: Filament[]): number {
  const lab = labOf(hexToRgb(e.color));
  let best = 2, bd = Infinity;
  for (const f of known) {
    const l = labOf(hexToRgb(f.color));
    let d = (l[0] - lab[0]) ** 2 + (l[1] - lab[1]) ** 2 + (l[2] - lab[2]) ** 2;
    if (f.material.toUpperCase() !== e.material.toUpperCase()) d += 100;
    if (d < bd) { bd = d; best = f.td; }
  }
  return best;
}

/** Gleicht die Bibliothek mit Spoolman ab: Rollen werden „vorhanden“, Preis und Restgewicht übernommen.
 *  Ein in Chromalith gepflegter TD bleibt erhalten, solange Spoolman keinen eigenen liefert. */
export function syncSpoolman(library: Filament[], spools: any): SpoolmanSync {
  const { entries, skipped } = spoolmanEntries(spools);
  const known = library.filter((f) => !f.td_estimated);
  const byId = new Map(library.filter((f) => f.spoolman_id != null).map((f) => [f.spoolman_id!, f]));
  const byKey = new Map(library.filter((f) => f.spoolman_id == null).map((f) => [filamentKey(f), f]));
  const r: SpoolmanSync = { added: 0, updated: 0, gone: 0, estimated: 0, skipped, total: entries.length };
  const seen = new Set<number>();
  for (const e of entries) {
    seen.add(e.spoolman_id);
    const key = filamentKey({ brand: e.brand, name: e.name, material: e.material, color: e.color } as Filament);
    let f = byId.get(e.spoolman_id) ?? byKey.get(key);
    if (f) {
      r.updated++;
      Object.assign(f, { name: e.name, brand: e.brand, material: e.material, color: e.color });
    } else {
      r.added++;
      f = { id: newId(), name: e.name, brand: e.brand, material: e.material, color: e.color, td: estimateTd(e, known), owned: true, td_estimated: true };
      library.push(f);
    }
    f.spoolman_id = e.spoolman_id; f.owned = true;
    if (e.td !== null) { f.td = e.td; delete f.td_estimated; }
    if (f.td_estimated) r.estimated++;
    if (e.remaining_g !== null) f.remaining_g = Math.round(e.remaining_g); else delete f.remaining_g;
    if (e.price !== null) f.price = e.price; else delete f.price;
  }
  for (const f of library) if (f.spoolman_id != null && !seen.has(f.spoolman_id) && f.owned) { f.owned = false; f.remaining_g = 0; r.gone++; }
  return r;
}
