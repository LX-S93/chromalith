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
  onProgress?: (fraction: number) => void;
}

export interface Suggestion { stops: ColorStop[]; error: number }

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
 *  Bringt ein weiteres Filament keine Verbesserung, bleibt das Set kleiner. */
export function suggestFilaments(lab: Float32Array, rgb: Float32Array, library: Filament[], o: SuggestOptions): Suggestion | null {
  const cand = candidates(rgb, library, o.maxCandidates ?? 30);
  if (cand.length < 2) return null;
  const n = Math.min(o.count, cand.length);
  const labs = new Map(cand.map((f) => [f, labOf(hexToRgb(f.color))]));
  const tooClose = (set: Filament[], f: Filament) => set.some((g) => g !== f && d2(labs.get(g)!, labs.get(f)!) < 64);
  const evalOrder = (order: Filament[], passes = 2) => optimizeStarts(lab, order, o.base, o.step, o.minH, o.maxH, passes);
  const byLum = [...cand].sort((a, b) => filamentLuminance(a) - filamentLuminance(b));
  // Start: bestes Paar (unten dunkel/oben hell oder umgekehrt) aus den dunkelsten und hellsten Kandidaten
  let order: Filament[] = [byLum[0], byLum[byLum.length - 1]];
  let best = evalOrder(order).error;
  for (const d of byLum.slice(0, 3)) for (const l of byLum.slice(-3)) {
    if (d === l) continue;
    for (const pair of [[d, l], [l, d]]) { const e = evalOrder(pair).error; if (e < best) { best = e; order = pair; } }
  }
  const total = (n - 2) * cand.length + n * cand.length;
  let done = 0;
  const tick = () => o.onProgress?.(Math.min(1, ++done / total));
  while (order.length < n) {
    let bestO: Filament[] | null = null, bestE = Infinity;
    for (const f of cand) {
      tick();
      if (order.includes(f) || tooClose(order, f)) continue;
      // Position im Stapel: jede Stelle oberhalb des untersten Filaments probieren
      for (let pos = 1; pos <= order.length; pos++) {
        const trial = [...order.slice(0, pos), f, ...order.slice(pos)];
        const e = evalOrder(trial).error;
        if (e < bestE) { bestE = e; bestO = trial; }
      }
    }
    if (!bestO || bestE >= best - 0.05) break; // keine echte Verbesserung mehr
    order = bestO; best = bestE;
  }
  // Tauschrunde: jedes Filament probeweise durch jeden Kandidaten ersetzen
  for (let i = 0; i < order.length; i++) {
    for (const f of cand) {
      tick();
      if (order.includes(f)) continue;
      const trial = order.slice(); trial[i] = f;
      if (tooClose(trial, f)) continue;
      const e = evalOrder(trial).error;
      if (e < best - 1e-6) { best = e; order = trial; }
    }
  }
  const fin = evalOrder(order, 4);
  o.onProgress?.(1);
  return { stops: order.map((f, i) => ({ filament: f, start_layer: fin.starts[i] })), error: fin.error };
}
