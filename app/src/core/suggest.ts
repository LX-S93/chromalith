/** Filament-Vorschläge: aus der Bibliothek das Set suchen, mit dem das Bild farblich am besten getroffen wird. */
import { hexToRgb, labOf } from "./color";
import { optimizeStarts } from "./colormatch";
import { filamentKey, filamentLuminance, type Filament } from "./filaments";
import { imagePalette } from "./analysis";
import type { ColorStop } from "./plan";

export interface SuggestOptions {
  count: number; // Anzahl Filamente im Set
  base: number; step: number; minH: number; maxH: number;
  maxCandidates?: number;
  /** Aufbau des Stapels: dunkel unten und hell oben (ruhiges Relief, feine dunkle Details werden Rillen),
   *  hell unten und dunkel oben, oder freie Reihenfolge (beste Farben, kann hohe Stufen erzeugen). */
  order?: StackOrder;
  onProgress?: (fraction: number) => void;
}

/** Auswahl im Dialog: „auto“ nimmt das ruhige Relief, solange die Farben darunter nicht deutlich leiden. */
export const SUGGEST_MODES = { auto: "Automatisch", dark_base: "Ruhiges Relief: dunkel unten, hell oben", light_base: "Ruhiges Relief: hell unten, dunkel oben", free: "Beste Farben: freie Reihenfolge" } as const;
export type SuggestMode = keyof typeof SUGGEST_MODES;
export type StackOrder = Exclude<SuggestMode, "auto">;

export interface Suggestion { stops: ColorStop[]; error: number; /** gewählter Aufbau und, bei „auto“, der Fehler der besten Farben zum Vergleich */ order?: StackOrder; bestError?: number }

const d2 = (a: number[], b: number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** Vorauswahl: zu jeder Hauptfarbe des Bildes die ähnlichsten Filamente, dazu die dunkelsten/hellsten. */
export function candidates(rgb: Float32Array, library: Filament[], max = 36): Filament[] {
  const seen = new Set<string>();
  const lib = library.filter((f) => { const k = filamentKey(f); if (seen.has(k) || !(f.td > 0)) return false; seen.add(k); return true; });
  if (lib.length <= max) return lib;
  const labs = new Map(lib.map((f) => [f, labOf(hexToRgb(f.color))]));
  const pal = imagePalette(rgb, 12, 6000);
  const out: Filament[] = [];
  const add = (f: Filament) => {
    // nahezu gleiche Farbe mit ähnlicher TD nur einmal
    if (out.some((g) => d2(labs.get(g)!, labs.get(f)!) < 9 && Math.abs(g.td - f.td) < 0.6)) return;
    out.push(f);
  };
  const byLum = [...lib].sort((a, b) => filamentLuminance(a) - filamentLuminance(b));
  byLum.slice(0, 3).forEach(add); byLum.slice(-3).forEach(add);
  const perColor = Math.max(2, Math.ceil((max - out.length) / pal.length));
  for (const p of pal) {
    const c = labOf(hexToRgb(p.color));
    [...lib].sort((a, b) => d2(labs.get(a)!, c) - d2(labs.get(b)!, c)).slice(0, perColor + 2).forEach(add);
  }
  return out.slice(0, Math.max(max, 8));
}

/** Gierige Auswahl mit Einfügeposition und anschließender Tauschrunde.
 *  Die gewünschte Anzahl wird eingehalten, solange ein weiteres Filament das Ergebnis nicht verschlechtert. */
export function suggestFilaments(lab: Float32Array, rgb: Float32Array, library: Filament[], o: SuggestOptions): Suggestion | null {
  const cand = candidates(rgb, library, o.maxCandidates ?? 30);
  if (cand.length < 2) return null;
  const n = Math.min(o.count, cand.length);
  const labs = new Map(cand.map((f) => [f, labOf(hexToRgb(f.color))]));
  const tooClose = (set: Filament[], f: Filament) => set.some((g) => g !== f && d2(labs.get(g)!, labs.get(f)!) < 64);
  const evalOrder = (order: Filament[], passes = 2) => optimizeStarts(lab, order, o.base, o.step, o.minH, o.maxH, passes);
  const byLum = [...cand].sort((a, b) => filamentLuminance(a) - filamentLuminance(b));
  const mode = o.order ?? "free";
  // feste Richtung: die Reihenfolge ergibt sich aus der Helligkeit der Filamente
  const sorted = (set: Filament[]) => [...set].sort((a, b) => (mode === "light_base" ? -1 : 1) * (filamentLuminance(a) - filamentLuminance(b)));
  // Start: bestes Paar aus den dunkelsten und hellsten Kandidaten
  let order: Filament[] = mode === "free" ? [byLum[0], byLum[byLum.length - 1]] : sorted([byLum[0], byLum[byLum.length - 1]]);
  let best = evalOrder(order).error;
  for (const d of byLum.slice(0, 3)) for (const l of byLum.slice(-3)) {
    if (d === l) continue;
    for (const pair of mode === "free" ? [[d, l], [l, d]] : [sorted([d, l])]) { const e = evalOrder(pair).error; if (e < best) { best = e; order = pair; } }
  }
  const total = (n - 2) * cand.length + n * cand.length;
  let done = 0;
  const tick = () => o.onProgress?.(Math.min(1, ++done / total));
  while (order.length < n) {
    let bestO: Filament[] | null = null, bestE = Infinity;
    for (const f of cand) {
      tick();
      if (order.includes(f) || tooClose(order, f)) continue;
      // Position im Stapel: frei jede Stelle oberhalb des untersten Filaments, sonst nach Helligkeit einsortiert
      const trials = mode === "free" ? Array.from({ length: order.length }, (_, i) => [...order.slice(0, i + 1), f, ...order.slice(i + 1)]) : [sorted([...order, f])];
      for (const trial of trials) {
        const e = evalOrder(trial).error;
        if (e < bestE) { bestE = e; bestO = trial; }
      }
    }
    if (!bestO || bestE > best + 0.02) break; // nur abbrechen, wenn ein weiteres Filament das Ergebnis verschlechtert
    order = bestO; best = bestE;
  }
  // Tauschrunde: jedes Filament probeweise durch jeden Kandidaten ersetzen
  for (let i = 0; i < order.length; i++) {
    for (const f of cand) {
      tick();
      if (order.includes(f)) continue;
      let trial = order.slice(); trial[i] = f;
      if (tooClose(trial, f)) continue;
      if (mode !== "free") trial = sorted(trial);
      const e = evalOrder(trial).error;
      if (e < best - 1e-6) { best = e; order = trial; }
    }
  }
  const fin = evalOrder(order, 4);
  o.onProgress?.(1);
  // Filamente, deren Wechsel über der obersten Schicht läge, kämen im Druck nicht vor: weglassen
  const top = Math.round((o.maxH - o.base) / o.step) + 1;
  const stops = order.map((f, i) => ({ filament: f, start_layer: fin.starts[i] })).filter((s, i) => i === 0 || s.start_layer <= top);
  return { stops, error: fin.error };
}

/** „auto“ nimmt das ruhige Relief, solange dessen Farbabweichung höchstens um diesen Anteil (plus eine halbe
 *  Lab-Einheit) über der der besten Farben liegt. */
export const CALM_TOLERANCE = 0.2;
export const calmEnough = (calm: number, best: number) => calm <= best * (1 + CALM_TOLERANCE) + 0.5;

/** Vorschlag nach Wunsch. „auto“ rechnet alle drei Aufbauten und nimmt „dunkel unten, hell oben“ (Relief folgt der
 *  Bildhelligkeit, feine dunkle Details werden Rillen), solange die Farben dabei kaum schlechter getroffen werden
 *  (calmEnough); „free“ liefert das Beste aus allen drei Suchen. */
export function suggestStack(lab: Float32Array, rgb: Float32Array, library: Filament[], o: SuggestOptions, mode: SuggestMode = "auto"): Suggestion | null {
  const orders: StackOrder[] = mode === "auto" || mode === "free" ? ["dark_base", "light_base", "free"] : [mode];
  const res: Suggestion[] = [];
  orders.forEach((order, i) => {
    const r = suggestFilaments(lab, rgb, library, { ...o, order, onProgress: (f) => o.onProgress?.((i + f) / orders.length) });
    if (r) res.push({ ...r, order });
  });
  if (!res.length) return null;
  const best = res.reduce((a, b) => (b.error < a.error ? b : a));
  const calm = res.find((r) => r.order === "dark_base");
  const pick = mode === "auto" && calm && calmEnough(calm.error, best.error) ? calm : best;
  return { ...pick, bestError: best.error };
}
