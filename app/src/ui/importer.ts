/** Filamente aus vorhandenen Bibliotheken übernehmen: ganzen Ordner einlesen (automatisch gesucht
 *  oder gewählt), mehrere Dateien oder per Ziehen & Ablegen. Duplikate werden zusammengeführt. */
import { mergeFilaments, parseFilamentFiles, type Filament } from "../core";
import { isTauri, store } from "../platform";
import { button, h, modal } from "./dom";

export interface TextFile { name: string; text: string }
const FILE_RE = /\.(json|fss)$/i;
const SKIP_DIRS = /^(\.|node_modules$|appdata$|windows$|\$recycle\.bin$|system volume information$|programdata$)/i;
const dec = new TextDecoder();

// ------------------------------------------------------------ Desktop: Ordner lesen und suchen
async function fsApi() {
  const fs = await import("@tauri-apps/plugin-fs");
  const path = await import("@tauri-apps/api/path");
  return { ...fs, join: path.join };
}

/** Alle .json/.fss-Dateien eines Ordners (rekursiv, begrenzt). */
export async function readFolder(dir: string, depth = 5): Promise<TextFile[]> {
  const { readDir, readFile, join } = await fsApi();
  const out: TextFile[] = [];
  const walk = async (d: string, left: number) => {
    let entries;
    try { entries = await readDir(d); } catch { return; }
    for (const e of entries) {
      const p = await join(d, e.name);
      if (e.isDirectory) { if (left > 0 && !SKIP_DIRS.test(e.name)) await walk(p, left - 1); }
      else if (e.isFile && FILE_RE.test(e.name) && out.length < 2000) {
        try { out.push({ name: e.name, text: dec.decode(await readFile(p)) }); } catch { /* nicht lesbar */ }
      }
    }
  };
  await walk(dir, depth);
  return out;
}

/** Sucht in üblichen Orten nach Ordnern „Filaments“, in denen Bibliotheks-Dateien liegen. */
export async function findLibraryFolders(): Promise<string[]> {
  if (!isTauri()) return [];
  const { readDir, join } = await fsApi();
  const path = await import("@tauri-apps/api/path");
  const roots = new Set<string>();
  const last = store.get<string | null>("importFolder", null);
  if (last) roots.add(last);
  for (const fn of [path.documentDir, path.desktopDir, path.downloadDir, path.homeDir]) {
    try { roots.add(await fn()); } catch { /* gibt es nicht */ }
  }
  roots.add("C:\\Program Files"); roots.add("C:\\Program Files (x86)");
  const found: string[] = [];
  let visited = 0;
  const walk = async (d: string, left: number) => {
    if (visited++ > 4000) return;
    let entries;
    try { entries = await readDir(d); } catch { return; }
    if (/[\\/]filaments$/i.test(d) && entries.some((e) => (e.isFile && FILE_RE.test(e.name)) || e.isDirectory)) { found.push(d); return; }
    for (const e of entries) if (e.isDirectory && left > 0 && !SKIP_DIRS.test(e.name)) await walk(await join(d, e.name), left - 1);
  };
  for (const r of roots) {
    if (found.some((f) => f.toLowerCase().startsWith(r.toLowerCase()))) continue;
    await walk(r, r === last ? 1 : 5);
  }
  return [...new Set(found)];
}

export async function pickFolderDesktop(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const p = await open({ directory: true, multiple: false, title: "Ordner mit Filament-Bibliotheken wählen" });
  return p && !Array.isArray(p) ? String(p) : null;
}

// ------------------------------------------------------------ Browser: Dateien/Ordner wählen, Ablegen
export function pickFilesBrowser(folder: boolean): Promise<TextFile[]> {
  return new Promise((resolve) => {
    const input = h("input", { type: "file", multiple: true, accept: folder ? undefined : ".json,.fss" });
    if (folder) (input as any).webkitdirectory = true;
    input.onchange = async () => resolve(await Promise.all([...(input.files ?? [])].filter((f) => FILE_RE.test(f.name))
      .map(async (f) => ({ name: f.name, text: await f.text() }))));
    input.oncancel = () => resolve([]);
    input.click();
  });
}

/** Abgelegte Dateien und Ordner (rekursiv) einlesen. */
export async function filesFromDrop(dt: DataTransfer): Promise<TextFile[]> {
  const out: TextFile[] = [];
  const readEntry = async (entry: any): Promise<void> => {
    if (entry.isFile) {
      if (!FILE_RE.test(entry.name)) return;
      const file: File = await new Promise((res, rej) => entry.file(res, rej));
      out.push({ name: file.name, text: await file.text() });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (;;) {
        const batch: any[] = await new Promise((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const e of batch) await readEntry(e);
      }
    }
  };
  const entries = [...dt.items].map((i) => (i as any).webkitGetAsEntry?.()).filter(Boolean);
  if (entries.length) for (const e of entries) await readEntry(e);
  else for (const f of [...dt.files]) if (FILE_RE.test(f.name)) out.push({ name: f.name, text: await f.text() });
  return out;
}

// ------------------------------------------------------------ Übernehmen + Zusammenfassung
export function importFiles(library: Filament[], files: TextFile[], source: string): { added: number; duplicates: number; files: number } {
  const { filaments, used } = parseFilamentFiles(files);
  const r = mergeFilaments(library, filaments);
  const res = { ...r, files: used.length };
  const close = modal("Filamente übernommen", h("div", { style: { lineHeight: "1.7" } },
    h("p", { style: { marginTop: 0 } }, source),
    used.length
      ? h("ul", { style: { paddingLeft: "18px", margin: "0 0 8px" } },
        h("li", null, h("b", null, `${r.added} neue Filamente`), " mit Farbe und TD in deine Bibliothek übernommen"),
        h("li", null, `${r.duplicates} waren schon vorhanden (doppelt) und wurden übersprungen`),
        h("li", null, `${used.length} Dateien gelesen`))
      : h("p", { class: "hint warn" }, "In der Auswahl wurden keine Filament-Dateien (.json/.fss) gefunden."),
    r.added ? h("p", { class: "hint" }, "Übernommene Filamente sind als „nicht vorhanden“ markiert. Deine eigenen Rollen kannst du in der Bibliothek als „Vorhanden“ markieren und dann mit dem Filter „Nur vorhandene“ schnell finden.") : null),
    [button("OK", () => close(), { cls: "primary" })], true);
  return res;
}
