/** Schnittstelle zum Rechen-Worker (Promise-basiert). */
import type { ColorStop, HeightSettings, Raster } from "./core";

const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
let nextId = 1;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
worker.onmessage = (ev) => {
  const p = pending.get(ev.data.id);
  if (!p) return;
  pending.delete(ev.data.id);
  ev.data.ok ? p.resolve(ev.data.result) : p.reject(new Error(ev.data.error));
};

function call<T>(msg: any, transfer: Transferable[] = []): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...msg, id }, transfer);
  });
}

export interface PreviewResult {
  width: number; height: number; preview: ArrayBuffer;
  layerCount: number; minLayer: number; size: [number, number]; maxZ: number;
  mode: "bright_high" | "dark_high" | "color";
  usage: { filament: ColorStop["filament"]; share: number; first: number; last: number }[];
  triangles: number;
  mesh: { vertices: ArrayBuffer; faces: ArrayBuffer; colors: ArrayBuffer; size: [number, number] };
}

export const setImage = (image: Raster | null) =>
  call<{ palette: { color: string; share: number }[] }>({ type: "image", image });
export const preview = (settings: HeightSettings, stops: ColorStop[]) => call<PreviewResult>({ type: "preview", settings, stops });
export const autoDistribute = (settings: HeightSettings, stops: ColorStop[]) => call<{ stops: ColorStop[] }>({ type: "auto", settings, stops });
export const exportAll = (settings: HeightSettings, stops: ColorStop[], name: string) =>
  call<{ stl: ArrayBuffer; report: string; json: string; preview: ArrayBuffer; width: number; height: number }>({ type: "export", settings, stops, name });
