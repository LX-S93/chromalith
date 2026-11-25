/** Chromalith – Oberfläche. */
import "./style.css";
import pkg from "../package.json";
import {
  HEIGHT_MODES, LUMA_METHODS, SHAPES, filamentLabel, fromRGBA8, nearestFilament, normalizeSettings, parseFilaments,
  parseProject, serializeLibrary, serializeProject, starterLibrary, toRGBA8, validate, type ColorStop, type Filament,
  materialDensity, filamentAtLayer, layerTopZ, simulate, type HeightSettings, type Island, type Raster,
} from "./core";
import * as compute from "./compute";
import type { PreviewResult } from "./compute";
import { decodeImage, isPng, isTauri, openFile, rgbaToPng, saveFile, saveSibling, store } from "./platform";
import { $, button, clear, confirmDialog, h, icon, modal, toast } from "./ui/dom";
import { section, selectField, sliderField, switchField, type Field } from "./ui/fields";
import { editFilament, openLibrary } from "./ui/library";
import { openSpoolman, spoolmanAutoSync, syncSummary } from "./ui/spoolman";
import { findLibraryFolders, importFiles, readFolder } from "./ui/importer";
import { StackPanel } from "./ui/stack";
import { openSuggest } from "./ui/suggest";
import { IslandPanel } from "./ui/islands";
import { assistantHtml, openAssistant, type AssistData } from "./ui/assistant";
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
  islands: [] as Island[],
  result: null as PreviewResult | null,
  previewRgba: null as Uint8ClampedArray | null,
  palette: [] as { color: string; share: number }[],
};
/** Filamente, die gedruckt werden (ohne ausgeblendete). */
const activeStops = () => state.stops.filter((s) => !s.disabled);
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
const undoBtn = button(null, () => undo(), { icon: "undo", cls: "ghost", title: "Rückgängig (Strg+Z)" });
const redoBtn = button(null, () => redo(), { icon: "redo", cls: "ghost", title: "Wiederholen (Strg+Y / Strg+Umschalt+Z)" });
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
    menuItem("Druck-Assistent (Farbwechsel) …", showAssistant, "", "layers"),
    menuItem("Filament-Bibliothek …", () => openLibrary(libHost).then(() => refreshAnalysis()), "Strg+L", "library"),
    menuItem("Spoolman verbinden …", () => openSpoolman(libHost).then(() => refreshAnalysis()), "", "download"),
    menuItem("Über Chromalith", about, "", "layers")));
document.addEventListener("mousedown", (e) => { if (!menu.contains(e.target as Node)) menu.classList.remove("open"); });

const topbar = h("header", { class: "topbar" },
  h("div", { class: "brand" }, h("img", { src: "./icon.svg", alt: "" }), "Chromalith", h("small", null, VERSION)),
  button("Bild öffnen", openImage, { icon: "image", title: "Bild öffnen (Strg+O)" }),
  button("Projekt öffnen", openProject, { icon: "folder", title: "Projekt öffnen (Strg+Umschalt+O)" }),
  button("Speichern", () => saveProject(false), { icon: "save", title: "Projekt speichern (Strg+S)" }),
  undoBtn, redoBtn,
  button("Filamente", () => openLibrary(libHost).then(() => refreshAnalysis()), { icon: "library", title: "Filament-Bibliothek: suchen, bearbeiten, importieren (Strg+L)" }),
  h("div", { class: "spacer" }),
  modePill,
  button("Umkehren", invertHeight, { icon: "swap", cls: "ghost", title: "Höhe umkehren: helle oder dunkle Bildstellen hoch" }),
  menu,
  button("Exportieren", exportAll, { icon: "download", cls: "primary", title: "STL + Farbwechsel-Liste exportieren (Strg+E)" }));

// Linke Seite: Einstellungen
const left = h("aside", { class: "left" },
  section("Größe", true,
    sl("width_mm", "Breite", 10, 400, 1, "mm", "Breite des fertigen Drucks. Die Höhe ergibt sich aus dem Seitenverhältnis des Bildes.", 1),
    sl("pixel_size_mm", "Rasterweite", 0.05, 1, 0.05, "mm", "Abstand der Modellpunkte. Kleiner = feiner, aber größere STL. 0,2 mm passt zu 0,4-mm-Düsen."),
    sl("border_mm", "Rahmenbreite", 0, 20, 0.5, "mm", "Glatter Rahmen rund ums Bild. 0 = kein Rahmen.", 1),
    sl("border_height_mm", "Rahmenhöhe (0 = max.)", 0, 10, 0.08, "mm", "Höhe des Rahmens. 0 = so hoch wie die höchste Stelle des Bildes.")),
  section("Form", true,
    (fields.shape = selectField("Umriss", SHAPES, (v) => setSetting("shape", v as any), "Rund schneidet das Bild auf den größten Kreis in der Mitte zu, z. B. für Uhren.")).el,
    sl("hole_mm", "Mittelloch Ø", 0, 20, 0.5, "mm", "Loch in der Mitte, z. B. 8 mm für die Achse eines Uhrwerks. 0 = kein Loch.", 1),
    sl("rim_mm", "Erhöhter Rand", 0, 15, 0.5, "mm", "Außenrand, der über dem Bild steht und in der obersten Farbe gedruckt wird.", 1),
    sl("image_scale", "Motivgröße", 0.2, 2, 0.01, "×", "Verkleinert oder vergrößert nur das Motiv. Umriss und Größe des Drucks bleiben gleich, z. B. damit bei einer Uhr Platz für die Ziffern bleibt. Die freie Fläche bekommt die Randfarbe des Bildes."),
    sl("image_x", "Motiv nach rechts", -50, 50, 0.5, "%", "Verschiebt das Motiv waagerecht innerhalb der Form.", 1),
    sl("image_y", "Motiv nach unten", -50, 50, 0.5, "%", "Verschiebt das Motiv senkrecht innerhalb der Form.", 1),
    (fields.clock_numbers = switchField("Uhr-Ziffern 1–12", (v) => setSetting("clock_numbers", v), "Setzt die Ziffern 1 bis 12 erhaben auf das Bild.")).el,
    sl("numbers_mm", "Ziffernhöhe", 4, 40, 0.5, "mm", "Schriftgröße der Uhr-Ziffern.", 1),
    sl("raise_mm", "Rand/Ziffern über Bild", 0.08, 3, 0.08, "mm", "So weit stehen Rand und Ziffern über der höchsten Stelle des Bildes.")),
  section("Schichten", false,
    sl("base_layer_mm", "Erste Schicht", 0.04, 0.4, 0.02, "mm", "Höhe der ersten Druckschicht. Muss im Slicer genauso eingestellt sein (Bambu/Orca: 0,20 mm)."),
    sl("layer_height_mm", "Schichthöhe", 0.04, 0.32, 0.02, "mm", "Höhe aller weiteren Schichten. Kleiner = feinere Farbabstufungen, längerer Druck. Muss im Slicer genauso eingestellt sein."),
    sl("min_height_mm", "Minimale Höhe", 0.08, 5, 0.04, "mm", "Dicke an der dünnsten Stelle des Bildes (Grundplatte)."),
    sl("max_height_mm", "Maximale Höhe", 0.4, 10, 0.04, "mm", "Dicke an der dicksten Stelle. Mehr Höhe = mehr Schichten und feinere Abstufungen.")),
  section("Bild", false,
    (fields.height_mode = selectField("Höhe aus", HEIGHT_MODES, (v) => setSetting("height_mode", v as any),
      "Automatisch: Bunte Filamente im Stapel = farbtreu. Sonst: Ist das oberste Filament dunkler als das unterste, werden dunkle Bildstellen hoch.")).el,
    (fields.luma_method = selectField("Helligkeit", LUMA_METHODS, (v) => setSetting("luma_method", v as any), "Wie aus den Bildfarben die Helligkeit berechnet wird. „Wahrnehmung“ passt fast immer.")).el,
    (fields.linearize = switchField("sRGB linearisieren", (v) => setSetting("linearize", v), "Rechnet die Helligkeit physikalisch statt nach Bildschirmwerten. Macht Mitteltöne dunkler.")).el,
    sl("detail_mm", "Mindestdetail", 0, 2, 0.1, "mm", "Bildpunkte, die kleiner sind als dieser Wert, werden entfernt (Median-Filter). Verhindert einzelne Zacken im Relief. 0 = aus.", 1),
    sl("smoothing_px", "Glätten", 0, 10, 0.25, "px", "Weichzeichnen des Bildes vor der Höhenberechnung."),
    sl("brightness", "Helligkeit +/-", -1, 1, 0.02, "", "Hellt das Bild vor der Berechnung auf oder dunkelt es ab."),
    sl("contrast", "Kontrast", 0, 4, 0.05, "", "Über 1 = stärkere Unterschiede zwischen Hell und Dunkel."),
    sl("gamma", "Gamma", 0.2, 5, 0.05, "", "Verschiebt die Mitteltöne: über 1 dunkler, unter 1 heller.")));

// Farbinseln
let pickCallback: ((p: { x: number; y: number; color: string }) => void) | null = null;
const islandPanel = new IslandPanel({
  islands: state.islands, libHost,
  pick: (cb) => {
    if (!state.image) { toast("Bitte zuerst ein Bild öffnen."); return; }
    pickCallback = cb; showTab(1);
    viewOriginal.el.style.cursor = "crosshair";
    toast("Klicke im Original auf den Bereich, der die eigene Farbe bekommen soll.");
  },
  changed: () => { markDirty(); schedule(); },
});
left.append(section("Farbinseln", false, islandPanel.el));

// Mitte: Ansichten
const viewPreview = new ImageView();
const viewOriginal = new ImageView();
const view3d = new ModelView();
const analysisEl = h("div", { class: "view analysis" });
const zLabel = h("span", null, "2×");
const zRange = h("input", { type: "range", min: 1, max: 6, step: 0.5, value: 2, style: { width: "110px" } });
zRange.addEventListener("input", () => { zLabel.textContent = `${zRange.value}×`; view3d.setZScale(Number(zRange.value)); });
view3d.setZScale(2);
// Schicht-Regler: den Druck nur bis Schicht X ansehen (wie er nach jedem Farbwechsel aussieht)
const cutLabel = h("span", { style: { minWidth: "150px" } }, "alle Schichten");
const cutRange = h("input", { type: "range", min: 1, max: 1, step: 1, value: 1, style: { width: "180px" },
  title: "Zeigt den Druck nur bis zu dieser Schicht – so siehst du, wie das Bild Schicht für Schicht entsteht." });
let cutFull = true;
function applyCut() {
  const r = state.result;
  if (!r) return;
  const max = r.layerCount, layer = Math.min(max, Number(cutRange.value));
  cutFull = layer >= max;
  const base = state.settings.base_layer_mm, step = state.settings.layer_height_mm;
  if (cutFull) { cutLabel.textContent = `alle ${max} Schichten`; view3d.setCut(null); return; }
  const f = filamentAtLayer(r.simStops, layer);
  cutLabel.textContent = `Schicht ${layer} / ${max}${f ? " · " + f.name : ""}`;
  view3d.setCut({ z: layerTopZ(layer, base, step), colorOf: (z) => simulate({ heights: z, base_layer_mm: base, layer_height_mm: step, mask: null } as any, r.simStops, z, false) });
}
cutRange.addEventListener("input", applyCut);
view3d.el.append(h("div", { class: "zbar" }, h("span", { class: "hint" }, "Schicht"), cutRange, cutLabel, h("div", { class: "sep" }), h("span", { class: "hint" }, "Höhe überhöhen"), zRange, zLabel),
  h("div", { class: "overlay-hint", style: { bottom: "auto", top: "12px" } }, "Ziehen = drehen · Rechts ziehen = verschieben · Rad = zoomen"));
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
// Vergleich Original/Ergebnis
let compareOn = store.get("compare", false);
const compareBtn = button("Vergleich", () => { compareOn = !compareOn; store.set("compare", compareOn); updateCompare(); },
  { icon: "swap", cls: "small", title: "Original und Ergebnis nebeneinander: Teiler mit der Maus verschieben" });
viewPreview.el.append(h("div", { class: "view-tools" }, compareBtn));
let compare3d = store.get("compare3d", false);
const compare3dBtn = button("Vergleich", () => { compare3d = !compare3d; store.set("compare3d", compare3d); updateCompare3d(); },
  { icon: "swap", cls: "small", title: "Links vom Teiler das flache Originalbild, rechts der Druck als Relief mit Tiefe. Teiler mit der Maus verschieben." });
view3d.el.append(h("div", { class: "view-tools", style: { top: "44px" } }, compare3dBtn));
function updateCompare3d() {
  compare3dBtn.classList.toggle("on", compare3d);
  compare3dBtn.textContent = ""; compare3dBtn.append(icon("swap"), compare3d ? "Vergleich: links flaches Original, rechts Relief" : "Vergleich");
  view3d.setCompare(compare3d);
}
updateCompare3d();
function updateCompare() {
  compareBtn.classList.toggle("on", compareOn);
  compareBtn.textContent = ""; compareBtn.append(icon("swap"), compareOn ? "Vergleich: links Original, rechts Ergebnis" : "Vergleich");
  const r = state.result, img = state.image;
  if (!compareOn || !r || !img) { viewPreview.setCompare(null); return; }
  // Original auf das Raster der Vorschau legen (runder Zuschnitt und Rahmen wie im Modell)
  const src = h("canvas", { width: img.width, height: img.height });
  src.getContext("2d")!.putImageData(new ImageData(toRGBA8(img) as any, img.width, img.height), 0, 0);
  const c = h("canvas", { width: r.width, height: r.height });
  const g = c.getContext("2d")!;
  g.fillStyle = "#2b2b2b"; g.fillRect(0, 0, r.width, r.height);
  let sx = 0, sy = 0, sw = img.width, sh = img.height;
  if (state.settings.shape === "circle" && sw !== sh) { const side = Math.min(sw, sh); sx = Math.floor((sw - side) / 2); sy = Math.floor((sh - side) / 2); sw = sh = side; }
  g.imageSmoothingQuality = "high";
  const iw = r.width - 2 * r.border, ih = r.height - 2 * r.border, sc = state.settings.image_scale ?? 1;
  const dw = iw * sc, dh = ih * sc;
  g.save(); g.beginPath(); g.rect(r.border, r.border, iw, ih); g.clip();
  g.drawImage(src, sx, sy, sw, sh, r.border + (iw - dw) / 2 + ((state.settings.image_x ?? 0) / 100) * iw, r.border + (ih - dh) / 2 + ((state.settings.image_y ?? 0) / 100) * ih, dw, dh);
  g.restore();
  viewPreview.setCompare(c);
}

// Schritt-Leiste
const STEPS = ["Bild", "Größe & Form", "Filamente", "Vorschau", "Export"];
const STEP_HINTS = [
  "Bild öffnen oder ins Fenster ziehen.",
  "Links Breite und Form einstellen. Schichten und Bildkorrektur sind unter „Schichten“ und „Bild“ eingeklappt.",
  "Rechts den Filament-Stapel wählen. „Filamente vorschlagen“ sucht das beste Set, „Automatisch verteilen“ legt die Wechsel.",
  "Ergebnis prüfen: Vergleich mit dem Original, 3D-Ansicht, Farbanalyse mit Verbrauch und Kosten.",
  "Exportieren schreibt STL, 3MF mit Farbwechseln, Farbwechsel-Liste und den Druck-Assistenten.",
];
let step = 0;
const stepsEl = h("div", { class: "steps" });
const stepHint = h("div", { class: "step-hint" });
const flash = (el: HTMLElement) => { el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash"); };
function renderSteps() {
  clear(stepsEl);
  STEPS.forEach((label, i) => {
    if (i) stepsEl.append(h("div", { class: "step-sep" }));
    stepsEl.append(h("button", { class: "step" + (i === step ? " current" : i < step ? " done" : ""), title: STEP_HINTS[i], onclick: () => goStep(i) },
      h("i", null, i < step ? "✓" : String(i + 1)), label));
  });
  stepHint.textContent = STEP_HINTS[step];
  stepsEl.append(stepHint);
  if (step < STEPS.length - 1 && state.image) stepsEl.append(button("Weiter", () => goStep(step + 1), { cls: "small primary" }));
}
function goStep(i: number) {
  if (i > 0 && !state.image) { toast("Bitte zuerst ein Bild öffnen."); i = 0; }
  step = i; renderSteps();
  const sections = [...left.querySelectorAll("details")] as HTMLDetailsElement[];
  if (i === 0) { if (!state.image) openImage(); else showTab(1); }
  if (i === 1) { sections.forEach((d, k) => (d.open = k < 2)); left.scrollTop = 0; flash(left); showTab(0); }
  if (i === 2) { flash(stack.el); showTab(0); }
  if (i === 3) { showTab(0); if (!compareOn) { compareOn = true; store.set("compare", true); } updateCompare(); }
  if (i === 4) exportAll();
}

const main = h("main", { class: "main" }, stepsEl, tabs, views);

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
  pick: async () => (await openLibrary(libHost, true))[0] ?? null,
  edit: (f) => editFilament({ ...f }),
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
viewOriginal.onPick = (px, py) => {
  if (!pickCallback || !state.image) return;
  const img = state.image, ix = Math.min(img.width - 1, Math.floor(px)), iy = Math.min(img.height - 1, Math.floor(py));
  const i = (iy * img.width + ix) * 4;
  const hex = "#" + [0, 1, 2].map((c) => Math.round(img.data[i + c] * 255).toString(16).padStart(2, "0")).join("");
  const cb = pickCallback; pickCallback = null; viewOriginal.el.style.cursor = "";
  cb({ x: px / img.width, y: py / img.height, color: hex });
  showTab(0);
};
viewPreview.onHover = (px, py) => {
  const r = state.result;
  if (!r || px < 0 || py < 0 || px > r.width || py > r.height) { hover.textContent = ""; return; }
  const k = r.size[0] / Math.max(1, r.width - 1);
  hover.textContent = `x ${(px * k).toFixed(1)} mm · y ${(py * k).toFixed(1)} mm`;
};

app.append(topbar, left, main, stack.el, status);
showTab(0);
renderSteps(); updateCompare();
syncFields();
stack.render();
setStatus(["Bild öffnen (Strg+O) oder Bild ins Fenster ziehen, um zu beginnen."]);
updateTitle();
refreshAnalysis();
importLegacyLibrary();
spoolmanAutoSync(libHost).then((r) => {
  if (!r) return;
  refreshAnalysis();
  if (r.added || r.gone) toast(`Spoolman abgeglichen: ${syncSummary(r)}.`, "ok");
});

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
// ------------------------------------------------------------------ Rückgängig / Wiederholen
const hist = { stack: [] as string[], pos: -1, timer: 0, restoring: false };
const snap = () => JSON.stringify({ settings: state.settings, stops: state.stops, islands: state.islands });
function updateUndoButtons() {
  undoBtn.disabled = hist.pos <= 0;
  redoBtn.disabled = hist.pos >= hist.stack.length - 1;
}
function commitHistory() {
  clearTimeout(hist.timer);
  const sn = snap();
  if (hist.stack[hist.pos] === sn) return;
  hist.stack.splice(hist.pos + 1);
  hist.stack.push(sn);
  if (hist.stack.length > 200) hist.stack.shift();
  hist.pos = hist.stack.length - 1;
  updateUndoButtons();
}
/** Änderung merken (kurz zusammengefasst, damit ein Schieberegler-Zug ein Schritt ist). */
function noteChange() {
  if (hist.restoring) return;
  clearTimeout(hist.timer);
  hist.timer = window.setTimeout(commitHistory, 450);
}
function resetHistory() { clearTimeout(hist.timer); hist.stack = [snap()]; hist.pos = 0; updateUndoButtons(); }
function restoreHistory(sn: string) {
  const d = JSON.parse(sn);
  hist.restoring = true;
  state.settings = d.settings;
  state.stops.splice(0, state.stops.length, ...d.stops);
  state.islands.splice(0, state.islands.length, ...d.islands);
  syncFields(); stack.render(); islandPanel.render(); markDirty(); schedule(60);
  hist.restoring = false;
  updateUndoButtons();
}
function undo() {
  commitHistory();
  if (hist.pos <= 0) return;
  hist.pos--; restoreHistory(hist.stack[hist.pos]);
}
function redo() {
  clearTimeout(hist.timer);
  if (hist.pos >= hist.stack.length - 1) return;
  hist.pos++; restoreHistory(hist.stack[hist.pos]);
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
function schedule(delay = 140) { noteChange(); clearTimeout(timer); timer = window.setTimeout(rebuild, delay); }

async function rebuild() {
  if (!state.image) return;
  if (running) { queued = true; return; }
  try { validate(state.settings); } catch (e: any) { setStatus([`⚠ ${e.message}`]); return; }
  running = true; busy.classList.add("on");
  compute.setIslands(state.islands);
  try {
    const r = await compute.preview(state.settings, activeStops());
    state.result = r;
    state.previewRgba = new Uint8ClampedArray(r.preview);
    viewPreview.set(state.previewRgba, r.width, r.height);
    cutRange.max = String(r.layerCount);
    if (cutFull || Number(cutRange.value) > r.layerCount) cutRange.value = String(r.layerCount);
    view3d.setMesh(r.mesh);
    applyCut();
    const step = state.settings.layer_height_mm;
    stack.setInfo({ layerCount: r.stackLayers, minLayer: r.minLayer, base: state.settings.base_layer_mm, step, colorMode: r.mode === "color" });
    syncMode(r.mode);
    refreshAnalysis();
    updateCompare();
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
    compute.setIslands(state.islands);
  const off = state.stops.filter((s) => s.disabled);
  const { stops } = await compute.autoDistribute(state.settings, activeStops());
  stops.push(...off);
    state.stops.splice(0, state.stops.length, ...stops.sort((a, b) => a.start_layer - b.start_layer));
    stack.render(); markDirty(); noteChange(); await rebuild();
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
  analysisEl.append(imgCard, useCard, costCard());
}

/** Verbrauch, Gewicht und Kosten je Filament (aus dem Volumen der Schichten). */
function consumption() {
  const price = store.get("pricePerKg", 25);
  const byId = new Map(library.map((f) => [f.id, f]));
  return (state.result?.usage ?? []).map((u) => {
    const cm3 = u.volume_mm3 / 1000, g = cm3 * materialDensity(u.filament.material);
    // Preis und Restmenge aus der Bibliothek (z. B. von Spoolman), sonst der allgemeine Preis pro kg
    const lib = byId.get(u.filament.id) ?? u.filament;
    const own = lib.price != null;
    const rest = lib.spoolman_id != null && lib.owned ? lib.remaining_g ?? null : null;
    return { u, cm3, g, m: u.volume_mm3 / (Math.PI * 0.875 * 0.875) / 1000, cost: (g / 1000) * (own ? lib.price! : price), own, rest };
  });
}
function costCard() {
  const rows = consumption();
  const card = h("div", { class: "card wide" }, h("h3", null, "Verbrauch, Gewicht und Kosten"),
    h("p", { class: "hint" }, "Aus dem Volumen der Schichten berechnet (massiv gedruckt, ohne Spülmenge beim Farbwechsel und ohne Stützen)."));
  if (!rows.length) { card.append(h("div", { class: "hint" }, "Erscheint, sobald ein Bild berechnet ist.")); return card; }
  const priceIn = h("input", { class: "num", type: "number", min: 0, step: 1, value: store.get("pricePerKg", 25), style: { width: "70px" } });
  priceIn.addEventListener("change", () => { store.set("pricePerKg", Math.max(0, Number(priceIn.value) || 0)); refreshAnalysis(); });
  const f = (v: number, d = 1) => v.toFixed(d).replace(".", ",");
  const sum = rows.reduce((a, r) => ({ cm3: a.cm3 + r.cm3, g: a.g + r.g, m: a.m + r.m, cost: a.cost + r.cost }), { cm3: 0, g: 0, m: 0, cost: 0 });
  card.append(
    h("table", { class: "use-table" },
      h("thead", null, h("tr", null, ...["", "Filament", "Schichten", "Volumen", "Gewicht", "Länge (1,75 mm)", "Kosten"].map((t) => h("th", null, t)))),
      h("tbody", null, ...[...rows].reverse().map((r) => h("tr", null,
        h("td", null, h("div", { class: "swatch", style: { background: r.u.filament.color } })),
        h("td", null, filamentLabel(r.u.filament)), h("td", null, `${r.u.first}–${r.u.last}`),
        h("td", null, `${f(r.cm3)} cm³`),
        h("td", r.rest != null && r.rest < r.g ? { style: { color: "var(--err)" }, title: `Reicht nicht: laut Spoolman sind nur noch ${r.rest} g da.` } : r.rest != null ? { title: `Laut Spoolman noch ${r.rest} g vorhanden.` } : null,
          `${f(r.g)} g` + (r.rest != null && r.rest < r.g ? " ⚠" : "")),
        h("td", null, `${f(r.m, 2)} m`),
        h("td", r.own ? { title: "Mit dem Preis dieses Filaments aus Spoolman gerechnet." } : null, `${f(r.cost, 2)} €` + (r.own ? " *" : ""))))),
      h("tfoot", null, h("tr", null, h("td", null, ""), h("td", null, "Gesamt"), h("td", null, ""),
        h("td", null, `${f(sum.cm3)} cm³`), h("td", null, `${f(sum.g)} g`), h("td", null, `${f(sum.m, 2)} m`), h("td", null, `${f(sum.cost, 2)} €`)))),
    h("div", { style: { display: "flex", gap: "10px", alignItems: "center", marginTop: "12px", flexWrap: "wrap" } },
      h("span", { class: "hint" }, "Preis pro kg"), priceIn, h("span", { class: "hint" }, rows.some((r) => r.own) ? "€ (für Filamente ohne eigenen Preis; * = Preis aus Spoolman)" : "€"), h("div", { class: "spacer" }),
      button("Druck-Assistent öffnen", showAssistant, { icon: "layers", cls: "small primary", title: "Führt beim Drucken Schritt für Schritt durch die Farbwechsel" })));
  return card;
}

function assistData(): AssistData | null {
  const r = state.result;
  if (!r) return null;
  return { name: state.name, base: state.settings.base_layer_mm, step: state.settings.layer_height_mm, layers: r.layerCount, maxZ: r.maxZ,
    usage: r.usage.map((u) => ({ filament: u.filament, first: u.first, last: u.last })) };
}
function showAssistant() {
  const d = assistData();
  if (!d) { toast("Bitte zuerst ein Bild öffnen."); return; }
  openAssistant(d);
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
  if (step === 0) { step = 1; renderSteps(); }
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
  resetHistory();
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
    state.islands.splice(0, state.islands.length, ...p.islands);
    islandPanel.render();
    state.path = path;
    syncFields();
    if (p.imagePng) await setImage(await decodeImage(p.imagePng), p.imagePng);
    stack.render();
    await rebuild();
    resetHistory();
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
  return serializeProject({ name: state.name, image: state.image, imagePng: state.imagePng, settings: state.settings, stops: state.stops, islands: state.islands });
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
  state.islands.splice(0); islandPanel.render();
  state.stops.forEach((s, i) => (s.start_layer = i + 1));
  await compute.setImage(null);
  viewPreview.clear(); viewOriginal.clear(); view3d.clear();
  syncFields(); stack.render(); refreshAnalysis(); showTab(0);
  step = 0; renderSteps(); viewPreview.setCompare(null);
  resetHistory();
  state.dirty = false; updateTitle();
  setStatus(["Bild öffnen (Strg+O) oder Bild ins Fenster ziehen, um zu beginnen."]);
}

async function exportAll() {
  if (!state.image) { toast("Bitte zuerst ein Bild öffnen."); return; }
  try { validate(state.settings); } catch (e: any) { toast(e.message, "err"); return; }
  busy.classList.add("on");
  try {
    compute.setIslands(state.islands);
    const r = await compute.exportAll(state.settings, activeStops(), state.name);
    const stl = new Uint8Array(r.stl);
    const path = await saveFile(`${state.name}.stl`, stl, [{ name: "STL", extensions: ["stl"] }]);
    if (!path) return;
    const png = await rgbaToPng(new Uint8ClampedArray(r.preview), r.width, r.height);
    const files = [path,
      await saveSibling(path, ".3mf", new Uint8Array(r.threemf)),
      await saveSibling(path, "_farbwechsel.txt", r.report),
      await saveSibling(path, "_farbwechsel.json", r.json),
      await saveSibling(path, "_vorschau.png", png)];
    const ad = assistData();
    if (ad) files.push(await saveSibling(path, "_druckassistent.html", assistantHtml(ad)));
    if (step < 4) { step = 4; renderSteps(); }
    const close = modal("Export fertig", h("div", null,
      h("p", { style: { marginTop: 0 } }, "Geschrieben:"),
      h("ul", { style: { paddingLeft: "18px", lineHeight: "1.7" } }, ...files.map((f) => h("li", null, f.split(/[\\/]/).pop()!))),
      h("p", { class: "hint" }, `STL ${(stl.length / 1e6).toFixed(1)} MB, 3MF ${(r.threemf.byteLength / 1e6).toFixed(1)} MB.`),
      h("p", { class: "hint" }, "Bambu Studio / OrcaSlicer: die .3mf öffnen (bei Nachfrage als Projekt laden). Die Farbwechsel stehen dann schon im Schicht-Regler. " +
        `Im Prozess muss die erste Schicht ${state.settings.base_layer_mm.toFixed(2)} mm und die Schichthöhe ${state.settings.layer_height_mm.toFixed(2)} mm sein ` +
        "(die Schichthöhe ist am Objekt schon eingetragen). Für andere Slicer stehen die Wechsel in der _farbwechsel.txt."),
      h("pre", { style: { background: "var(--bg)", padding: "10px", borderRadius: "8px", maxHeight: "260px", overflow: "auto", fontSize: "12px" } }, r.report)),
      [button("Druck-Assistent öffnen", () => { close(); showAssistant(); }, { icon: "layers" }), button("OK", () => close(), { cls: "primary" })]);
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
  const t = e.target as HTMLElement;
  const typing = t instanceof HTMLInputElement && (t.type === "text" || t.type === "search");
  if ((k === "z" || k === "y") && !typing) {
    e.preventDefault();
    if (t instanceof HTMLInputElement) t.blur();
    (k === "y" || e.shiftKey) ? redo() : undo();
    return;
  }
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

resetHistory();

// für Tests/Fehlersuche
(window as any).chromalith = { state, rebuild, loadProjectBytes, loadImageBytes, editFilament, fromRGBA8 };
