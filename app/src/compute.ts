/** Schnittstelle zum Rechen-Worker (Promise-basiert). */
import type { ColorStop, HeightSettings, LithoLight, Raster } from "./core";

const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
let nextId = 1;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; progress?: (f: number) => void }>();
worker.onmessage = (ev) => {
  const p = pending.get(ev.data.id);
  if (!p) return;
  if (ev.data.progress !== undefined) { p.progress?.(ev.data.progress); return; }
  pending.delete(ev.data.id);
  ev.data.ok ? p.resolve(ev.data.result) : p.reject(new Error(ev.data.error));
};

function call<T>(msg: any, transfer: Transferable[] = [], progress?: (f: number) => void): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject, progress });
    worker.postMessage(withIslands({ ...msg, id }), transfer);
  });
}

export interface PreviewResult {
  width: number; height: number; preview: ArrayBuffer;
  layerCount: number; minLayer: number; size: [number, number]; maxZ: number;
  mode: "bright_high" | "dark_high" | "color";
  usage: { filament: ColorStop["filament"]; share: number; first: number; last: number; z0: number; z1: number; volume_mm3: number }[];
  border: number;
  triangles: number;
  stackLayers: number;
  simStops: ColorStop[];
  mesh: { vertices: ArrayBuffer; faces: ArrayBuffer; colors: ArrayBuffer; orig: ArrayBuffer; top: ArrayBuffer; size: [number, number] };
}

let islandState: unknown[] = [];
/** Farbinseln für alle folgenden Berechnungen setzen. */
export const setIslands = (islands: unknown[]) => { islandState = islands; };
const withIslands = (m: any) => ({ ...m, islands: islandState });

export const setImage = (image: Raster | null) =>
  call<{ palette: { color: string; share: number }[] }>({ type: "image", image });
export const preview = (settings: HeightSettings, stops: ColorStop[]) => call<PreviewResult>({ type: "preview", settings, stops });
export const autoDistribute = (settings: HeightSettings, stops: ColorStop[]) => call<{ stops: ColorStop[] }>({ type: "auto", settings, stops });
export const exportAll = (settings: HeightSettings, stops: ColorStop[], name: string) =>
  call<{ stl: ArrayBuffer; threemf: ArrayBuffer; report: string; json: string; preview: ArrayBuffer; width: number; height: number }>({ type: "export", settings, stops, name });
export const previewImage = (settings: HeightSettings, stops: ColorStop[], maxSide = 520) =>
  call<{ width: number; height: number; preview: ArrayBuffer }>({ type: "preview", settings, stops, maxSide, lite: true });
export const suggest = (settings: HeightSettings, stops: ColorStop[], library: ColorStop["filament"][], count: number, mode: string, progress?: (f: number) => void) =>
  call<{ stops: ColorStop[]; error: number; currentError: number | null; order?: "dark_base" | "light_base" | "free"; bestError?: number }>({ type: "suggest", settings, stops, library, count, mode }, [], progress);

export interface LithoResult {
  width: number; height: number; preview: ArrayBuffer; size: [number, number, number]; note: string; volume_mm3: number; triangles: number;
  mesh: { vertices: ArrayBuffer; faces: ArrayBuffer; thick: ArrayBuffer; thickS: ArrayBuffer; baseN: ArrayBuffer };
}
export const litho = (settings: HeightSettings, light: LithoLight) => call<LithoResult>({ type: "litho", settings, light });
export const lithoExport = (settings: HeightSettings, light: LithoLight, name: string) =>
  call<{ stl: ArrayBuffer; triangles: number; size: [number, number, number]; volume_mm3: number; note: string }>({ type: "litho", settings, light, name, export: true });
