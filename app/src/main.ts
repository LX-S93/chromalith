/** Chromalith – Oberfläche. */
import "./style.css";
import pkg from "../package.json";
import {
  HEIGHT_MODES, LUMA_METHODS, SHAPES, filamentLabel, fromRGBA8, nearestFilament, normalizeSettings, parseFilaments,
  parseProject, serializeLibrary, serializeProject, starterLibrary, toRGBA8, validate, type ColorStop, type Filament,
  type HeightSettings, type Raster,
} from "./core";
import * as compute from "./compute";
import type { PreviewResult } from "./compute";
import { decodeImage, isPng, isTauri, openFile, rgbaToPng, saveFile, saveSibling, store } from "./platform";
import { $, button, clear, confirmDialog, h, icon, modal, toast } from "./ui/dom";
import { section, selectField, sliderField, switchField, type Field } from "./ui/fields";
import { editFilament, openLibrary } from "./ui/library";
import { findLibraryFolders, importFiles, readFolder } from "./ui/importer";
import { StackPanel } from "./ui/stack";
import { openSuggest } from "./ui/suggest";
import { ImageView } from "./ui/view2d";
import { ModelView } from "./ui/view3d";

const VERSION = pkg.version;
const IMAGE_EXT = ["png", "jpg", "jpeg", "bmp", "gif", "webp"];

// ------------------------------------------------------------------ Zustand
const library: Filament[] = store.get<Filament[] | null>("library", null) ?? starterLibrary();
const state = {
  name: "Unbenannt",
  path: null as string | null,
  dirty: false,
  image: null as Raster | null,
  imagePng: null as Uint8Array | null,
  settings: normalizeSettings(undefined) as HeightSettings,
  stops: [] as ColorStop[],
  result: null as PreviewResult | null,
  previewRgba: null as Uint8ClampedArray | null,
  palette: [] as { color: string; share: number }[],
};
const saveLibrary = () => store.set("library", library);
const libHost = { library, saveLibrary };

function defaultStops(): ColorStop[] {
  const byName = new Map(library.filter((f) => f.brand === "Generisch").map((f) => [f.name, f]));
  return ["Schwarz", "Grau dunkel", "Grau hell", "Weiß"].map((n) => byName.get(n)).filter((f): f is Filament => !!f)
    .map((f, i) => ({ filament: { ...f }, start_layer: i + 1 }));
}
state.stops = defaultStops();

/** Erster Start der Desktop-App: Bibliothek der alten Python-Version übernehmen, falls vorhanden. */
async function importLegacyLibrary() {
  if (!isTauri() || store.get<Filament[] | null>("library", null)) return;
  try {
    const { dataDir, join } = await import("@tauri-apps/api/path");
    const { readFile, exists } = await import("@tauri-apps/plugin-fs");
    const base = await dataDir();
    for (const parts of [["Chromalith", "Chromalith"], ["Chromalith"]]) {
      const file = await join(base, ...parts, "filament_bibliothek.json");
      if (!(await exists(file))) continue;
      const list = parseFilaments(JSON.parse(new TextDecoder().decode(await readFile(file))));
      if (!list.length) continue;
      library.splice(0, library.length, ...list);
      saveLibrary();
      toast(`Filament-Bibliothek der bisherigen Version übernommen (${list.length} Filamente).`, "ok", 7000);
      return;
    }
  } catch { /* keine alte Bibliothek */ }
  saveLibrary();
  // Andere vorhandene Filament-Bibliotheken auf dem Rechner anbieten
  const found = await findLibraryFolders().catch(() => [] as string[]);
  if (!found.length) return;
  const files = await readFolder(found[0]);
  if (!files.length) return;
  const ok = await confirmDialog("Filament-Bibliothek gefunden",
    `Auf deinem Rechner liegt eine Filament-Bibliothek (${found[0]}). Sollen die Filamente mit Farbe und TD in Chromalith übernommen werden? Das geht auch später über „Filamente“ → „Importieren“.`,
    "Übernehmen", "Nicht jetzt");
  if (!ok) return;
  store.set("importFolder", found[0]);
  importFiles(library, files, `Aus dem Ordner ${found[0]}:`);
  saveLibrary(); refreshAnalysis();
}

// ------------------------------------------------------------------ Aufbau
const app = $("#app");
const fields: Partial<Record<keyof HeightSettings, Field>> = {};

function setSetting<K extends keyof HeightSettings>(k: K, v: HeightSettings[K]) {
  state.settings[k] = v;
  markDirty();
  if (k === "height_mode") syncMode();
  if (k === "shape" || k === "clock_numbers") syncShapeFields();
  schedule();
}
const sl = (k: keyof HeightSettings, label: string, lo: number, hi: number, step: number, unit = "mm", tip?: string, dec?: number) =>
  (fields[k] = sliderField(label, lo, hi, step, unit, (v) => setSetting(k, v as any), tip, dec)).el;

// Kopfzeile
const modeButtons = new Map<string, HTMLButtonElement>();
const modePill = h("div", { class: "mode-pill", title: "Woraus die Höhe entsteht" });
for (const [k, label] of [["auto", "Auto"], ["bright_high", "Hell hoch"], ["dark_high", "Dunkel hoch"], ["color", "Farbtreu"]] as const) {
  const b = h("button", { onclick: () => { fields.height_mode!.set(k); setSetting("height_mode", k); } }, label);
  modeButtons.set(k, b); modePill.append(b);
}
const menu = h("div", { class: "menu" });
const menuItem = (label: string, fn: () => void, kbd = "", ic = "") =>
  h("button", { onclick: () => { menu.classList.remove("open"); fn(); } }, ic ? icon(ic) : "", label, kbd ? h("kbd", null, kbd) : "");
menu.append(button(null, () => menu.classList.toggle("open"), { icon: "more", cls: "ghost", title: "Weitere Funktionen" }),
  h("div", { class: "menu-list" },
    menuItem("Neues Projekt", newProject, "Strg+N", "file"),
    menuItem("Projekt speichern unter …", () => saveProject(true), "Strg+Umschalt+S", "save"),
    menuItem("Originalbild exportieren …", exportOriginal, "", "image"),
    menuItem("Vorschaubild exportieren …", exportPreview, "", "image"),
    menuItem("Filament-Bibliothek …", () => openLibrary(libHost).then(() => refreshAnalysis()), "Strg+L", "library"),
    menuItem("Über Chromalith", about, "", "layers")));
document.addEventListener("mousedown", (e) => { if (!menu.contains(e.target as Node)) menu.classList.remove("open"); });

const topbar = h("header", { class: "topbar" },
  h("div", { class: "brand" }, h("img", { src: "./icon.svg", alt: "" }), "Chromalith", h("small", null, VERSION)),
  button("Bild öffnen", openImage, { icon: "image", title: "Bild öffnen (Strg+O)" }),
  button("Projekt öffnen", openProject, { icon: "folder", title: "Projekt öffnen (Strg+Umschalt+O)" }),
  button("Speichern", () => saveProject(false), { icon: "save", title: "Projekt speichern (Strg+S)" }),
  button("Filamente", () => openLibrary(libHost).then(() => refreshAnalysis()), { icon: "library", title: "Filament-Bibliothek: suchen, bearbeiten, importieren (Strg+L)" }),
  h("div", { class: "spacer" }),
  modePill,
  button("Umkehren", invertHeight, { icon: "swap", cls: "ghost", title: "Höhe umkehren: helle oder dunkle Bildstellen hoch" }),
  menu,
  button("Exportieren", exportAll, { icon: "download", cls: "primary", title: "STL + Farbwechsel-Liste exportieren (Strg+E)" }));

// Linke Seite: Einstellungen
const left = h("aside", { class: "left" },
  section("Größe", true,
    sl("width_mm", "Breite", 10, 400, 1, "mm", "Breite des Modells", 1),
    sl("pixel_size_mm", "Rasterweite", 0.05, 1, 0.05, "mm", "Abstand der Modellpunkte. Kleiner = feiner, aber größere STL. 0,2 mm passt zu 0,4-mm-Düsen."),
    sl("border_mm", "Rahmenbreite", 0, 20, 0.5, "mm", undefined, 1),
    sl("border_height_mm", "Rahmenhöhe (0 = max.)", 0, 10, 0.08)),
  section("Form", true,
    (fields.shape = selectField("Umriss", SHAPES, (v) => setSetting("shape", v as any))).el,
    sl("hole_mm", "Mittelloch Ø", 0, 20, 0.5, "mm", "Loch in der Mitte, z. B. 8 mm für die Achse eines Uhrwerks. 0 = kein Loch.", 1),
    sl("rim_mm", "Erhöhter Rand", 0, 15, 0.5, "mm", "Außenrand, der über dem Bild steht und in der obersten Farbe gedruckt wird.", 1),
    (fields.clock_numbers = switchField("Uhr-Ziffern 1–12", (v) => setSetting("clock_numbers", v))).el,
    sl("numbers_mm", "Ziffernhöhe", 4, 40, 0.5, "mm", undefined, 1),
    sl("raise_mm", "Rand/Ziffern über Bild", 0.08, 3, 0.08)),
  section("Schichten", true,
    sl("base_layer_mm", "Erste Schicht", 0.04, 0.4, 0.02),
    sl("layer_height_mm", "Schichthöhe", 0.04, 0.32, 0.02),
    sl("min_height_mm", "Minimale Höhe", 0.08, 5, 0.04),
    sl("max_height_mm", "Maximale Höhe", 0.4, 10, 0.04)),
  section("Bild", true,
    (fields.height_mode = selectField("Höhe aus", HEIGHT_MODES, (v) => setSetting("height_mode", v as any),
      "Automatisch: Bunte Filamente im Stapel = farbtreu. Sonst: Ist das oberste Filament dunkler als das unterste, werden dunkle Bildstellen hoch.")).el,
    (fields.luma_method = selectField("Helligkeit", LUMA_METHODS, (v) => setSetting("luma_method", v as any))).el,
    (fields.linearize = switchField("sRGB linearisieren", (v) => setSetting("linearize", v))).el,
    sl("detail_mm", "Mindestdetail", 0, 2, 0.1, "mm", "Bildpunkte, die kleiner sind als dieser Wert, werden entfernt (Median-Filter). Verhindert einzelne Zacken im Relief. 0 = aus.", 1),
    sl("smoothing_px", "Glätten", 0, 10, 0.25, "px", "Weichzeichnen des Bildes vor der Höhenberechnung."),
    sl("brightness", "Helligkeit +/-", -1, 1, 0.02, ""),
    sl("contrast", "Kontrast", 0, 4, 0.05, ""),
    sl("gamma", "Gamma", 0.2, 5, 0.05, "")));

// Mitte: Ansichten
const viewPreview = new ImageView();
const viewOriginal = new ImageView();
const view3d = new ModelView();
const analysisEl = h("div", { class: "view analysis" });
const zLabel = h("span", null, "2×");
const zRange = h("input", { type: "range", min: 1, max: 6, step: 0.5, value: 2, style: { width: "110px" } });
zRange.addEventListener("input", () => { zLabel.textContent = `${zRange.value}×`; view3d.setZScale(Number(zRange.value)); });
view3d.setZScale(2);
view3d.el.append(h("div", { class: "zbar" }, h("span", { class: "hint" }, "Höhe überhöhen"), zRange, zLabel),
  h("div", { class: "overlay-hint" }, "Ziehen = drehen · Rechts ziehen = verschieben · Rad = zoomen"));
viewPreview.el.append(h("div", { class: "overlay-hint" }, "Rad = zoomen · Ziehen = verschieben · Doppelklick = einpassen"));
const busy = h("div", { class: "busy" }, h("div", { class: "spinner" }), "Berechne …");
const dropzone = h("div", { class: "dropzone" }, h("div", { class: "card" },
  h("h2", null, "Bild hierher ziehen"),
  h("p", null, "oder öffnen: PNG, JPG, BMP, WebP – oder ein Projekt (.chroma)"),
  h("div", { style: { display: "flex", gap: "8px", justifyContent: "center", marginTop: "14px" } },
    button("Bild öffnen", openImage, { icon: "image", cls: "primary" }), button("Projekt öffnen", openProject, { icon: "folder" }))));
const views = h("div", { class: "views" }, viewPreview.el, viewOriginal.el, view3d.el, analysisEl, dropzone, busy);
const tabs = h("div", { class: "tabs" });
const TABS: [string, HTMLElement][] = [["Vorschau", viewPreview.el], ["Original", viewOriginal.el], ["3D", view3d.el], ["Farbanalyse", analysisEl]];
function showTab(i: number) {
  [...tabs.children].forEach((t, j) => t.classList.toggle("active", i === j));
  TABS.forEach(([, el], j) => el.classList.toggle("active", i === j));
  dropzone.style.display = state.image || i === 3 ? "none" : "";
  if (i === 2) view3d.resize();
}
TABS.forEach(([label], i) => tabs.append(h("button", { class: "tab", onclick: () => showTab(i) }, label)));
const main = h("main", { class: "main" }, tabs, views);

// Rechts: Stapel
const stack = new StackPanel({
  get stops() { return state.stops; },
  changed: () => { markDirty(); schedule(); },
  add: async () => {
    const picked = await openLibrary(libHost, true);
    if (picked.length) stack.addFilaments(picked.map((f) => ({ ...f })));
  },
  auto: autoDistribute,
  suggest: suggestFilaments,
  loadSet,
  saveSet: () => saveFile("set.json", serializeLibrary(state.stops.map((s) => s.filament)), [{ name: "Filament-Set", extensions: ["json"] }]),
});

// Statuszeile
const status = h("footer", { class: "status" });
const hover = h("span");
function setStatus(parts: (string | Node)[]) {
  clear(status);
  for (const p of parts) status.append(typeof p === "string" ? h("span", { html: p }) : p);
  status.append(h("div", { class: "spacer" }), hover);
}
viewPreview.onHover = (px, py) => {
  const r = state.result;
  if (!r || px < 0 || py < 0 || px > r.width || py > r.height) { hover.textContent = ""; return; }
  const k = r.size[0] / Math.max(1, r.width - 1);
  hover.textContent = `x ${(px * k).toFixed(1)} mm · y ${(py * k).toFixed(1)} mm`;
};

app.append(topbar, left, main, stack.el, status);
showTab(0);
syncFields();
stack.render();
setStatus(["Bild öffnen (Strg+O) oder Bild ins Fenster ziehen, um zu beginnen."]);
updateTitle();
refreshAnalysis();
importLegacyLibrary();

// ------------------------------------------------------------------ Synchronisation
function syncFields() {
  for (const [k, f] of Object.entries(fields)) f!.set((state.settings as any)[k]);
  syncMode(); syncShapeFields();
}
function syncMode(effective?: string) {
  for (const [k, b] of modeButtons) b.classList.toggle("active", k === state.settings.height_mode);
  const eff = effective ?? state.result?.mode;
  modeButtons.get("auto")!.textContent = state.settings.height_mode === "auto" && eff
    ? `Auto · ${{ bright_high: "hell hoch", dark_high: "dunkel hoch", color: "farbtreu" }[eff]}` : "Auto";
}
function syncShapeFields() {
  const round = state.settings.shape === "circle";
  fields.numbers_mm!.el.style.display = state.settings.clock_numbers ? "" : "none";
  fields.clock_numbers!.el.title = round ? "" : "Ziffern werden auf dem größten Kreis im Bild verteilt.";
}
function markDirty() { if (!state.dirty) { state.dirty = true; updateTitle(); } }
function updateTitle() {
  const name = state.path ? state.path.split(/[\\/]/).pop() : state.name;
  const t = `${state.dirty ? "• " : ""}${name} – Chromalith ${VERSION}`;
  document.title = t;
  if (isTauri()) import("@tauri-apps/api/window").then((w) => w.getCurrentWindow().setTitle(t)).catch(() => {});
}

// ------------------------------------------------------------------ Berechnung
let timer = 0, running = false, queued = false;
function schedule(delay = 140) { clearTimeout(timer); timer = window.setTimeout(rebuild, delay); }

async function rebuild() {
  if (!state.image) return;
  if (running) { queued = true; return; }
  try { validate(state.settings); } catch (e: any) { setStatus([`⚠ ${e.message}`]); return; }
  running = true; busy.classList.add("on");
  try {
    const r = await compute.preview(state.settings, state.stops);
    state.result = r;
    state.previewRgba = new Uint8ClampedArray(r.preview);
    viewPreview.set(state.previewRgba, r.width, r.height);
    view3d.setMesh(r.mesh);
    const step = state.settings.layer_height_mm;
    stack.setInfo({ layerCount: r.layerCount, minLayer: r.minLayer, base: state.settings.base_layer_mm, step, colorMode: r.mode === "color" });
    syncMode(r.mode);
    refreshAnalysis();
    const changes = Math.max(0, r.usage.length - 1);
    setStatus([
      `<b>${r.size[0].toFixed(1)} × ${r.size[1].toFixed(1)} mm</b>`, `${r.layerCount} Schichten`, `max. ${r.maxZ.toFixed(2)} mm`,
      `${changes} Farbwechsel`, `≈ ${(r.triangles / 1e6).toFixed(2)} Mio. Dreiecke`,
    ]);
  } catch (e: any) {
    setStatus([`⚠ ${e.message}`]);
  } finally {
    running = false; busy.classList.remove("on");
    if (queued) { queued = false; rebuild(); }
  }
}

async function autoDistribute() {
  if (!state.image) { toast("Bitte zuerst ein Bild öffnen."); return; }
  busy.classList.add("on");
  try {
    const { stops } = await compute.autoDistribute(state.settings, state.stops);
    state.stops.splice(0, state.stops.length, ...stops.sort((a, b) => a.start_layer - b.start_layer));
    stack.render(); markDirty(); await rebuild();
  } catch (e: any) { toast("Automatisch verteilen fehlgeschlagen: " + e.message, "err"); }
  finally { if (!running) busy.classList.remove("on"); }
}

function suggestFilaments() {
  if (!state.image) { toast("Bitte zuerst ein Bild öffnen."); return; }
  openSuggest(state.settings, state.stops, library, (stops) => {
    state.stops.splice(0, state.stops.length, ...stops);
    state.settings.height_mode = "color";
    fields.height_mode!.set("color"); syncMode();
    stack.render(); markDirty(); rebuild();
    toast("Vorgeschlagenes Filament-Set übernommen.", "ok");
  });
}

function invertHeight() {
  const cur = state.settings.height_mode === "auto" ? state.result?.mode ?? "bright_high" : state.settings.height_mode;
  const next = cur === "bright_high" ? "dark_high" : "bright_high";
  fields.height_mode!.set(next); setSetting("height_mode", next);
}

// ------------------------------------------------------------------ Analyse
function refreshAnalysis() {
  clear(analysisEl);
  const quality = (d: number) => (d < 10 ? "sehr gut" : d < 20 ? "gut" : d < 35 ? "mäßig" : "schlecht");
  const imgCard = h("div", { class: "card" }, h("h3", null, "Farben im Bild"),
    h("p", { class: "hint" }, "Hauptfarben mit Flächenanteil, dazu das ähnlichste Filament aus deiner Bibliothek."));
  if (!state.palette.length) imgCard.append(h("div", { class: "hint" }, "Noch kein Bild geladen."));
  else imgCard.append(h("div", { style: { margin: "0 0 10px" } }, button("Passendes Filament-Set vorschlagen", suggestFilaments, { icon: "magic", cls: "primary small" })));
  for (const p of state.palette) {
    const { filament: f, distance } = nearestFilament(p.color, library);
    imgCard.append(h("div", { class: "bar-row" }, h("div", { class: "swatch", style: { background: p.color } }),
      h("div", { class: "name" },
        h("span", null, f ? h("span", { style: { display: "inline-flex", gap: "6px", alignItems: "center" } },
          h("span", { class: "swatch", style: { background: f.color, width: "12px", height: "12px", display: "inline-block" } }),
          `${filamentLabel(f)}`) : p.color),
        h("small", null, `${p.color}${f ? ` · Abstand ${distance.toFixed(0)} (${quality(distance)})` : ""}`),
        h("div", { class: "bar" }, h("i", { style: { width: `${(p.share * 100).toFixed(1)}%`, background: p.color } }))),
      h("div", { class: "pct" }, `${(p.share * 100).toFixed(1)} %`)));
  }
  const useCard = h("div", { class: "card" }, h("h3", null, "Filamente im Ergebnis"),
    h("p", { class: "hint" }, "Anteil der Bildfläche, auf der das Filament ganz oben liegt."));
  const use = state.result?.usage ?? [];
  if (!use.length) useCard.append(h("div", { class: "hint" }, "Erscheint, sobald ein Bild berechnet ist."));
  for (const u of [...use].reverse())
    useCard.append(h("div", { class: "bar-row" }, h("div", { class: "swatch", style: { background: u.filament.color } }),
      h("div", { class: "name" }, h("span", null, filamentLabel(u.filament)), h("small", null, `Schicht ${u.first}–${u.last} (${u.last - u.first + 1})`),
        h("div", { class: "bar" }, h("i", { style: { width: `${(u.share * 100).toFixed(1)}%`, background: u.filament.color } }))),
      h("div", { class: "pct" }, `${(u.share * 100).toFixed(1)} %`)));
  const unused = use.filter((u, i) => i > 0 && u.share < 0.01).map((u) => u.filament.name);
  if (unused.length) useCard.append(h("p", { class: "hint warn", style: { marginTop: "10px" } },
    `Kaum sichtbar (unter 1 %): ${unused.join(", ")}. Diese Filamente kann man meist weglassen und spart einen Farbwechsel.`));
  analysisEl.append(imgCard, useCard);
}

// ------------------------------------------------------------------ Dateien
async function setImage(img: Raster, png: Uint8Array | null) {
  state.image = img;
  state.imagePng = png ?? (await rgbaToPng(toRGBA8(img), img.width, img.height));
  viewOriginal.set(toRGBA8(img), img.width, img.height);
  const { palette } = await compute.setImage(img);
  state.palette = palette;
  dropzone.style.display = "none";
  refreshAnalysis();
}

async function loadImageBytes(name: string, bytes: Uint8Array) {
  let img: Raster;
  try { img = await decodeImage(bytes); } catch { toast("Das Bild konnte nicht gelesen werden.", "err"); return; }
  if (!state.path) state.name = name.replace(/\.[^.]+$/, "");
  const first = !state.stops.slice(1).some((s) => s.start_layer > state.stops.indexOf(s) + 1);
  await setImage(img, isPng(bytes) ? bytes : null);
  markDirty(); updateTitle();
  await rebuild();
  if (first) await autoDistribute();
}

async function openImage() {
  const f = await openFile([{ name: "Bilder", extensions: IMAGE_EXT }]);
  if (f) await loadImageBytes(f.name, f.bytes);
}

async function confirmDiscard(): Promise<boolean> {
  if (!state.dirty || !state.image) return true;
  return confirmDialog("Ungespeicherte Änderungen", "Das aktuelle Projekt hat ungespeicherte Änderungen. Trotzdem fortfahren?", "Verwerfen");
}

async function loadProjectBytes(name: string, bytes: Uint8Array, path: string | null) {
  try {
    const p = parseProject(new TextDecoder().decode(bytes));
    state.settings = p.settings;
    state.stops.splice(0, state.stops.length, ...p.stops.sort((a, b) => a.start_layer - b.start_layer));
    state.name = p.name || name.replace(/\.[^.]+$/, "");
    state.path = path;
    syncFields();
    if (p.imagePng) await setImage(await decodeImage(p.imagePng), p.imagePng);
    stack.render();
    await rebuild();
    state.dirty = false; updateTitle();
    toast(`Projekt „${state.name}“ geladen.`, "ok");
  } catch (e: any) { toast("Projekt konnte nicht geladen werden: " + e.message, "err"); }
}

async function openProject() {
  if (!(await confirmDiscard())) return;
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readFile } = await import("@tauri-apps/plugin-fs");
    const path = await open({ multiple: false, filters: [{ name: "Chromalith-Projekt", extensions: ["chroma"] }] });
    if (!path || Array.isArray(path)) return;
    await loadProjectBytes(String(path).split(/[\\/]/).pop()!, await readFile(String(path)), String(path));
  } else {
    const f = await openFile([{ name: "Chromalith-Projekt", extensions: ["chroma"] }]);
    if (f) await loadProjectBytes(f.name, f.bytes, null);
  }
}

function projectText() {
  return serializeProject({ name: state.name, image: state.image, imagePng: state.imagePng, settings: state.settings, stops: state.stops });
}

async function saveProject(saveAs: boolean) {
  try {
    if (state.path && !saveAs && isTauri()) {
      const { writeFile } = await import("@tauri-apps/plugin-fs");
      await writeFile(state.path, new TextEncoder().encode(projectText()));
    } else {
      const p = await saveFile(`${state.name}.chroma`, projectText(), [{ name: "Chromalith-Projekt", extensions: ["chroma"] }]);
      if (!p) return;
      if (isTauri()) { state.path = p; state.name = p.split(/[\\/]/).pop()!.replace(/\.chroma$/i, ""); }
    }
    state.dirty = false; updateTitle();
    toast("Projekt gespeichert.", "ok");
  } catch (e: any) { toast("Speichern fehlgeschlagen: " + e.message, "err"); }
}

async function newProject() {
  if (!(await confirmDiscard())) return;
  state.image = null; state.imagePng = null; state.path = null; state.name = "Unbenannt"; state.result = null; state.palette = [];
  state.settings = normalizeSettings(undefined);
  state.stops.forEach((s, i) => (s.start_layer = i + 1));
  await compute.setImage(null);
  viewPreview.clear(); viewOriginal.clear(); view3d.clear();
  syncFields(); stack.render(); refreshAnalysis(); showTab(0);
  state.dirty = false; updateTitle();
  setStatus(["Bild öffnen (Strg+O) oder Bild ins Fenster ziehen, um zu beginnen."]);
}

async function exportAll() {
  if (!state.image) { toast("Bitte zuerst ein Bild öffnen."); return; }
  try { validate(state.settings); } catch (e: any) { toast(e.message, "err"); return; }
  busy.classList.add("on");
  try {
    const r = await compute.exportAll(state.settings, state.stops, state.name);
    const stl = new Uint8Array(r.stl);
    const path = await saveFile(`${state.name}.stl`, stl, [{ name: "STL", extensions: ["stl"] }]);
    if (!path) return;
    const png = await rgbaToPng(new Uint8ClampedArray(r.preview), r.width, r.height);
    const files = [path,
      await saveSibling(path, ".3mf", new Uint8Array(r.threemf)),
      await saveSibling(path, "_farbwechsel.txt", r.report),
      await saveSibling(path, "_farbwechsel.json", r.json),
      await saveSibling(path, "_vorschau.png", png)];
    const close = modal("Export fertig", h("div", null,
      h("p", { style: { marginTop: 0 } }, "Geschrieben:"),
      h("ul", { style: { paddingLeft: "18px", lineHeight: "1.7" } }, ...files.map((f) => h("li", null, f.split(/[\\/]/).pop()!))),
      h("p", { class: "hint" }, `STL ${(stl.length / 1e6).toFixed(1)} MB, 3MF ${(r.threemf.byteLength / 1e6).toFixed(1)} MB.`),
      h("p", { class: "hint" }, "Die 3MF enthält die Farbwechsel schon (PrusaSlicer, Bambu Studio, OrcaSlicer: einfach öffnen). Im Slicer nur noch die erste Schicht auf " +
        `${state.settings.base_layer_mm.toFixed(2)} mm und die Schichthöhe auf ${state.settings.layer_height_mm.toFixed(2)} mm stellen. Für andere Slicer stehen die Wechsel in der _farbwechsel.txt.`),
      h("pre", { style: { background: "var(--bg)", padding: "10px", borderRadius: "8px", maxHeight: "260px", overflow: "auto", fontSize: "12px" } }, r.report)),
      [button("OK", () => close(), { cls: "primary" })]);
  } catch (e: any) { toast("Export fehlgeschlagen: " + e.message, "err"); }
  finally { if (!running) busy.classList.remove("on"); }
}

async function exportOriginal() {
  if (!state.imagePng) { toast("Das Projekt enthält kein Bild."); return; }
  const p = await saveFile(`${state.name}_original.png`, state.imagePng, [{ name: "PNG", extensions: ["png"] }]);
  if (p) toast("Originalbild gespeichert.", "ok");
}

async function exportPreview() {
  const r = state.result;
  if (!r || !state.previewRgba) { toast("Noch keine Vorschau berechnet."); return; }
  const png = await rgbaToPng(state.previewRgba, r.width, r.height);
  const p = await saveFile(`${state.name}_vorschau.png`, png, [{ name: "PNG", extensions: ["png"] }]);
  if (p) toast("Vorschaubild gespeichert.", "ok");
}

async function loadSet() {
  const f = await openFile([{ name: "Filament-Sets", extensions: ["json", "fss"] }]);
  if (!f) return;
  try {
    const fils = parseFilaments(JSON.parse(new TextDecoder().decode(f.bytes)));
    if (!fils.length) throw new Error("Das Set ist leer.");
    state.stops.splice(0, state.stops.length, ...fils.map((fil, i) => ({ filament: fil, start_layer: i + 1 })));
    stack.render(); markDirty();
    if (state.image) await autoDistribute();
  } catch (e: any) { toast("Set konnte nicht geladen werden: " + e.message, "err"); }
}

function about() {
  const close = modal("Über Chromalith", h("div", { style: { lineHeight: "1.6" } },
    h("div", { style: { display: "flex", gap: "14px", alignItems: "center" } }, h("img", { src: "./icon.svg", width: 48, height: 48 }),
      h("div", null, h("b", null, `Chromalith ${VERSION}`), h("div", { class: "hint" }, "Farbige Reliefbilder aus Filament-Schichten für den 3D-Druck."))),
    h("p", null, "Eigenständige Entwicklung. Bild öffnen, Filamente stapeln, Wechsel-Schichten festlegen und als STL mit Farbwechsel-Liste exportieren."),
    h("p", { class: "hint" }, "Tastenkürzel: Strg+O Bild · Strg+Umschalt+O Projekt · Strg+S Speichern · Strg+E Export · Strg+L Bibliothek · Strg+N Neu")),
    [button("Schließen", () => close(), { cls: "primary" })], true);
}

// ------------------------------------------------------------------ Ziehen & Ablegen, Tasten
views.addEventListener("dragover", (e) => { e.preventDefault(); main.classList.add("drag-over"); });
views.addEventListener("dragleave", () => main.classList.remove("drag-over"));
views.addEventListener("drop", async (e) => {
  e.preventDefault(); main.classList.remove("drag-over");
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (/\.chroma$/i.test(file.name)) { if (await confirmDiscard()) await loadProjectBytes(file.name, bytes, null); }
  else await loadImageBytes(file.name, bytes);
});
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => e.preventDefault());

document.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || document.querySelector(".modal-back")) return;
  const k = e.key.toLowerCase();
  const map: Record<string, () => void> = {
    o: e.shiftKey ? openProject : openImage, s: () => saveProject(e.shiftKey), e: exportAll, n: newProject,
    l: () => openLibrary(libHost).then(() => refreshAnalysis()),
  };
  if (map[k]) { e.preventDefault(); map[k](); }
});

// Ungespeicherte Änderungen beim Schließen
if (isTauri()) {
  import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
    const win = getCurrentWindow();
    win.onCloseRequested(async (ev) => {
      if (state.dirty && state.image && !(await confirmDialog("Chromalith beenden", "Es gibt ungespeicherte Änderungen. Trotzdem beenden?", "Beenden"))) ev.preventDefault();
    });
  });
} else {
  window.addEventListener("beforeunload", (e) => { if (state.dirty && state.image) e.preventDefault(); });
}

// für Tests/Fehlersuche
(window as any).chromalith = { state, rebuild, loadProjectBytes, loadImageBytes, editFilament, fromRGBA8 };
