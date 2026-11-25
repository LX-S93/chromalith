/** Plattform-Schicht: Dateien öffnen/speichern als Desktop-App (Tauri) oder im Browser. */
import { fromRGBA8, type Raster } from "./core";

export const isTauri = () => typeof (window as any).__TAURI_INTERNALS__ !== "undefined";

export interface OpenedFile { name: string; bytes: Uint8Array }
export interface Filter { name: string; extensions: string[] }

export async function openFile(filters: Filter[]): Promise<OpenedFile | null> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readFile } = await import("@tauri-apps/plugin-fs");
    const path = await open({ multiple: false, filters });
    if (!path || Array.isArray(path)) return null;
    return { name: String(path).split(/[\\/]/).pop()!, bytes: await readFile(String(path)) };
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = filters.flatMap((f) => f.extensions.map((e) => (e === "*" ? "*" : "." + e))).join(",");
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) } : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** Speichert eine Datei. Desktop: Speichern-Dialog; Browser: Download.
 *  Gibt den gewählten Pfad (Desktop) bzw. Dateinamen zurück. */
export async function saveFile(defaultName: string, data: Uint8Array | string, filters: Filter[]): Promise<string | null> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    const path = await save({ defaultPath: defaultName, filters });
    if (!path) return null;
    await writeFile(path, bytes);
    return path;
  }
  download(defaultName, bytes);
  return defaultName;
}

/** Schreibt eine Begleitdatei neben eine schon gespeicherte Datei (Desktop) bzw. lädt sie herunter. */
export async function saveSibling(basePath: string, suffix: string, data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const target = basePath.replace(/\.[^.\\/]+$/, "") + suffix;
  if (isTauri()) {
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    await writeFile(target, bytes);
  } else download(target.split(/[\\/]/).pop()!, bytes);
  return target;
}

function download(name: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function decodeImage(bytes: Uint8Array): Promise<Raster> {
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart]));
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const g = c.getContext("2d")!;
  g.drawImage(bmp, 0, 0);
  return fromRGBA8(bmp.width, bmp.height, g.getImageData(0, 0, bmp.width, bmp.height).data);
}

export async function rgbaToPng(rgba: Uint8ClampedArray, w: number, h: number): Promise<Uint8Array> {
  const c = new OffscreenCanvas(w, h);
  c.getContext("2d")!.putImageData(new ImageData(rgba as any, w, h), 0, 0);
  const blob = await c.convertToBlob({ type: "image/png" });
  return new Uint8Array(await blob.arrayBuffer());
}

/** JSON von einem Dienst im Netz holen (z. B. Spoolman). Desktop: über die App selbst, damit weder
 *  CORS noch „unsichere Inhalte“ im Weg stehen; Browser: normaler Abruf (der Dienst muss CORS erlauben). */
export async function fetchJson(url: string, timeoutMs = 8000): Promise<any> {
  const f: typeof fetch = isTauri() ? ((await import("@tauri-apps/plugin-http")).fetch as any) : fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await f(url, { method: "GET", headers: { Accept: "application/json" }, signal: ctl.signal });
    if (!r.ok) throw new Error(`Der Server antwortet mit Fehler ${r.status}.`);
    return await r.json();
  } catch (e: any) {
    if (ctl.signal.aborted) throw new Error("Keine Antwort innerhalb von 8 Sekunden.");
    if (e instanceof SyntaxError) throw new Error("Die Antwort ist kein JSON – stimmt die Adresse?");
    throw e;
  } finally { clearTimeout(timer); }
}

export const isPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

/** Persönliche Daten (Bibliothek, letzte Einstellungen) im lokalen Speicher. */
export const store = {
  get<T>(key: string, fallback: T): T {
    try { const v = localStorage.getItem("chromalith." + key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
  },
  set(key: string, value: unknown) { localStorage.setItem("chromalith." + key, JSON.stringify(value)); },
};
