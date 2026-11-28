/** Chromalith – Oberfläche. */
import "./style.css";
import pkg from "../package.json";
import {
  BREAKOUTS, DEFAULT_SETTINGS, HEIGHT_MODES, LUMA_METHODS, SHAPES, filamentLabel, fromRGBA8, nearestFilament, normalizeSettings, parseFilaments,
  parseProject, serializeLibrary, serializeProject, starterLibrary, toRGBA8, validate, type ColorStop, type Filament,
  LITHO_FORMS, materialDensity, filamentAtLayer, layerTopZ, simulate, effectiveMode, type HeightSettings, type Island, type Project, type Raster,
  SLICER_TARGETS, filamentKey, planSlots, type ThreeMfInfo,
} from "./core";
import * as compute from "./compute";
import type { PreviewResult } from "./compute";
import { decodeImage, isPng, isTauri, openFile, openPage, rgbaToPng, saveFile, saveSibling, store } from "./platform";
import { $, button, clear, confirmDialog, h, icon, modal, toast } from "./ui/dom";
import { section, selectField, sliderField, switchField, type Field } from "./ui/fields";
import { editFilament, openLibrary } from "./ui/library";
import { openSpoolman, spoolmanAutoSync, syncSummary } from "./ui/spoolman";
import { findLibraryFolders, importFiles, readFolder } from "./ui/importer";
import { StackPanel } from "./ui/stack";
import { openSuggest } from "./ui/suggest";
import { loadSlicerPrefs, openSlicerSetup, slicerName, slotLimit } from "./ui/slicer";
import { IslandPanel } from "./ui/islands";
import { assistantHtml, openAssistant, type AssistData } from "./ui/assistant";
import { ImageView } from "./ui/view2d";
import { ModelView } from "./ui/view3d";
import { fileSuffix, lang, num, setLang, tr, trLines, watchDom } from "./i18n";
import { autoCheckForUpdate, checkForUpdate, showUpdate } from "./update";
import { EXAMPLES, EXAMPLE_GROUPS, type Example } from "./examples";

const VERSION = pkg.version;
watchDom();
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
/** Ziel-Slicer, Vorlage und Art der Farbwechsel für die 3MF (gilt für alle Projekte) */
const slicer = loadSlicerPrefs();
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
  if (k === "shape" || k === "clock_numbers" || k === "breakout") syncShapeFields();
  schedule();
}
let breakoutHint: HTMLElement;
const sl = (k: keyof HeightSettings, label: string, lo: number, hi: number, step: number, unit = "mm", tip?: string, dec?: number) =>
  (fields[k] = sliderField(label, lo, hi, step, unit, (v) => setSetting(k, v as any), tip, dec)).el;

// Kopfzeile
const undoBtn = button(null, () => undo(), { icon: "undo", cls: "ghost", title: "Rückgängig (Strg+Z)" });
const redoBtn = button(null, () => redo(), { icon: "redo", cls: "ghost", title: "Wiederholen (Strg+Y / Strg+Umschalt+Z)" });
const modeButtons = new Map<string, HTMLButtonElement>();
const modePill = h("div", { class: "mode-pill top", title: "Woraus die Höhe entsteht" });
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
    menuItem("Slicer und AMS …", slicerSetup, "", "layers"),
    menuItem("Filament-Bibliothek …", () => openLibrary(libHost).then(() => refreshAnalysis()), "Strg+L", "library"),
    menuItem("Spoolman verbinden …", () => openSpoolman(libHost).then(() => refreshAnalysis()), "", "download"),
    menuItem("Nach Updates suchen …", () => checkForUpdate(VERSION, true, () => state.dirty && !!state.image, () => saveProject(false)), "", "download"),
    menuItem("Sprache / Language …", chooseLanguage, "", "edit"),
    menuItem("☕ Kaffee spendieren", () => openPage("support").catch(() => {}), "", ""),
    menuItem("Über Chromalith", about, "", "layers")));
document.addEventListener("mousedown", (e) => { if (!menu.contains(e.target as Node)) menu.classList.remove("open"); });

const topbar = h("header", { class: "topbar" },
  h("div", { class: "brand" }, h("img", { src: "./icon.png", alt: "" }), "Chromalith", h("small", null, VERSION)),
  button("Bild öffnen", openImage, { icon: "image", cls: "collapsible", title: "Bild öffnen (Strg+O)" }),
  button("Projekt öffnen", openProject, { icon: "folder", cls: "collapsible", title: "Projekt öffnen (Strg+Umschalt+O)" }),
  button("Speichern", () => saveProject(false), { icon: "save", cls: "collapsible", title: "Projekt speichern (Strg+S)" }),
  undoBtn, redoBtn,
  button("Filamente", () => openLibrary(libHost).then(() => refreshAnalysis()), { icon: "library", cls: "collapsible", title: "Filament-Bibliothek: suchen, bearbeiten, importieren (Strg+L)" }),
  h("div", { class: "spacer" }),
  modePill,
  button("Umkehren", invertHeight, { icon: "swap", cls: "ghost collapsible", title: "Höhe umkehren: helle oder dunkle Bildstellen hoch" }),
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
    (fields.breakout = selectField("Motiv ragt über die Form", BREAKOUTS, (v) => setSetting("breakout", v as any),
      "Die Form wird kleiner als das Bild, und das Motiv darf darüber hinausragen (z. B. Ohren über den Kreis). Aufliegend: die überstehenden Teile bekommen eine eigene Grundplatte, druckbar ohne Stützen. Schwebend: unter den überstehenden Teilen ist Luft, im Slicer Stützen einschalten. Braucht ein Motiv vor einfarbigem oder transparentem Hintergrund.")).el,
    sl("breakout_frame", "Formgröße", 30, 100, 1, "%", "Größe der Form im Verhältnis zum Bild. Was vom Motiv darüber hinausgeht, ragt heraus.", 0),
    sl("breakout_x", "Form nach rechts", -40, 40, 0.5, "%", "Verschiebt die Form hinter dem Motiv waagerecht.", 1),
    sl("breakout_y", "Form nach unten", -40, 40, 0.5, "%", "Verschiebt die Form hinter dem Motiv senkrecht.", 1),
    sl("breakout_tol", "Hintergrund-Toleranz", 2, 60, 1, "", "Wie stark eine Farbe von der Randfarbe des Bildes abweichen darf und trotzdem als Hintergrund gilt. Höher, wenn Hintergrundreste stehen bleiben; niedriger, wenn Teile des Motivs fehlen.", 0),
    sl("breakout_float_mm", "Schwebehöhe", 0.2, 2, 0.04, "mm", "So hoch über dem Druckbett beginnt die Unterseite der schwebenden Teile. Je niedriger, desto dicker und farbtreuer bleiben sie.", 2),
    (breakoutHint = h("div", { class: "hint" }, "Schwebende Teile brauchen Stützen: im Slicer „Stützen“ einschalten, am besten nur auf dem Druckbett. Die Farben können dort abweichen, weil die unteren Filamente des Stapels fehlen. Die Vorschau zeigt das.")),
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
    sl("color_detail", "Detailtreue", 0, 1, 0.05, "", "Nur im farbtreuen Modus. Farben, die der Stapel nicht hergibt, werden nach ihrer Helligkeit einsortiert, statt alle auf derselben Schicht zu landen. So bleibt zum Beispiel eine Sonne vor hellem Himmel sichtbar. 0 = jede Stelle bekommt nur die ähnlichste Farbe; dabei können Details verschwinden.", 2),
    (fields.luma_method = selectField("Helligkeit", LUMA_METHODS, (v) => setSetting("luma_method", v as any), "Wie aus den Bildfarben die Helligkeit berechnet wird. „Wahrnehmung“ passt fast immer.")).el,
    (fields.linearize = switchField("sRGB linearisieren", (v) => setSetting("linearize", v), "Rechnet die Helligkeit physikalisch statt nach Bildschirmwerten. Macht Mitteltöne dunkler.")).el,
    sl("detail_mm", "Mindestdetail", 0, 2, 0.1, "mm", "Linien und Punkte, die schmaler sind als dieser Wert, lassen sich nicht drucken: einzelne Spitzen werden entfernt, feine Linien auf diese Breite verbreitert. Empfohlen: Düsenbreite (0,4 mm). 0 = aus.", 1),
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
// Nur fürs Farbrelief: Form, Schichten und Farbinseln, dazu Rahmen, Höhenmodus und Detailtreue.
// Die Lithophanie nutzt davon nichts, deshalb sind sie dort ausgeblendet (style.css: #app.litho [data-mode="relief"]).
for (const d of left.querySelectorAll<HTMLElement>("details.section")) if (["Form", "Schichten", "Farbinseln"].includes(d.querySelector("summary > span")!.textContent!)) d.dataset.mode = "relief";
for (const k of ["border_mm", "border_height_mm", "height_mode", "color_detail"] as const) fields[k]!.el.dataset.mode = "relief";

// ------------------------------------------------------------------ Lithophanie
/** Lichtquellen: Farbe (aus der Farbtemperatur), Punktlicht oder gleichmäßig, Höhe im Körper, Grundhelligkeit */
const LAMPS: Record<string, { name: string; color: string; point: boolean; height: number; power: number; spill: number }> = {
  tealight: { name: "LED-Teelicht (flackerfrei, 2200 K)", color: "#ffb46b", point: true, height: 0.18, power: 0.8, spill: 1.3 },
  warm: { name: "LED-Lampe warmweiß (2700 K)", color: "#ffd2a1", point: true, height: 0.5, power: 1.2, spill: 1 },
  neutral: { name: "LED-Lampe neutralweiß (4000 K)", color: "#ffeed8", point: true, height: 0.5, power: 1.2, spill: 1 },
  cold: { name: "LED-Lampe kaltweiß (6500 K)", color: "#eef2ff", point: true, height: 0.5, power: 1.2, spill: 1 },
  string: { name: "Lichterkette (viele kleine Lichter)", color: "#ffc98f", point: false, height: 0.5, power: 0.75, spill: 0.6 },
  panel: { name: "Leuchtrahmen / LED-Panel (gleichmäßig)", color: "#fff3e4", point: false, height: 0.5, power: 1, spill: 0.5 },
};
const LIGHTS = Object.fromEntries(Object.entries(LAMPS).map(([k, v]) => [k, v.name]));
const lithoView = {
  filament: store.get<{ name: string; color: string; td: number }>("lithoFilament", { name: "Generisch Weiß", color: "#f2f1ec", td: 4.5 }),
  lamp: store.get("lithoLamp", "warm"), intensity: store.get("lithoIntensity", 1), on: true,
};
const lamp = () => LAMPS[lithoView.lamp] ?? LAMPS.warm;
const lithoLight = () => ({ filamentColor: lithoView.filament.color, td: lithoView.filament.td, light: lamp().color, intensity: lithoView.intensity * lamp().power });
const kindPill = h("div", { class: "mode-pill", style: { display: "flex", marginBottom: "10px" }, title: "Farbrelief: farbiges Bild aus Filament-Schichten. Lithophanie: einfarbiges Bild, das im Gegenlicht erscheint." });
const kindBtns = ([[false, "Farbrelief"], [true, "Lithophanie"]] as const).map(([v, label]) => {
  const b = h("button", { style: { flex: "1" }, onclick: () => { setSetting("litho", v); syncLitho(); syncMode(); renderSteps(); } }, label);
  kindPill.append(b); return [v, b] as const;
});
const lithoFilBtn = button("", async () => {
  const f = (await openLibrary(libHost, true))[0];
  if (!f) return;
  lithoView.filament = { name: filamentLabel(f), color: f.color, td: f.td }; store.set("lithoFilament", lithoView.filament);
  syncLitho(); schedule(0);
}, { cls: "wide", title: "Filament der Lithophanie wählen. Weiß oder Natur mit TD 3 bis 6 funktioniert am besten." });
const lithoLightSel = selectField("Lichtquelle", LIGHTS, (v) => { lithoView.lamp = v; store.set("lithoLamp", v); schedule(0); },
  "Was hinter bzw. in der Lithophanie leuchtet. Eine einzelne LED gibt einen hellen Fleck in der Mitte, Lichterkette und Leuchtrahmen leuchten gleichmäßig.");
const lithoIntensity = sliderField("Lichtstärke", 0.4, 4, 0.1, "×", (v) => { lithoView.intensity = v; store.set("lithoIntensity", v); schedule(0); },
  "Wie hell die Lampe ist. Bei zu wenig Licht bleiben dicke Stellen schwarz, bei zu viel überstrahlen dünne.", 1);
lithoLightSel.set(lithoView.lamp); lithoIntensity.set(lithoView.intensity);
// Leuchtmittel für die Kugel: aus dem gemessenen Durchmesser folgen Öffnung und Mindestgröße der Kugel
const LIGHT_SIZES: Record<string, string> = { "0": "Eigenes Maß", "38": "LED-Teelicht Standard (38 mm)", "58": "LED-Teelicht Maxi (58 mm)", "45": "LED-Teelicht groß (45 mm)", "20": "Mini-LED / Lichterkette (20 mm)" };
function applyLightSize(d: number) {
  store.set("lithoLightMm", d);
  const open = Math.round(d + 2), s = state.settings;
  // mit Schraubdeckel kommt das Licht von oben hinein, sonst wird die Kugel über das Licht gestellt
  if (s.litho_cap) { setSetting("litho_cap_mm", Math.min(60, open)); fields.litho_cap_mm?.set(s.litho_cap_mm); }
  else { setSetting("litho_hole_mm", Math.min(60, open)); fields.litho_hole_mm?.set(s.litho_hole_mm); }
  // der Deckel soll höchstens gut die Hälfte des Kugeldurchmessers einnehmen
  const minW = Math.ceil((s.litho_cap ? (open + 14) / 0.6 : open / 0.62) / 5) * 5;
  if (s.width_mm < minW) {
    setSetting("width_mm", minW); fields.width_mm?.set(minW);
    toast(`Kugel auf ${minW} mm vergrößert, damit ein Leuchtmittel mit ${d} mm hinein- und herauspasst.`, "ok", 6000);
  }
}
const lightSizeSel = selectField("Leuchtmittel", LIGHT_SIZES, (v) => { if (v !== "0") { lightSize.set(Number(v)); applyLightSize(Number(v)); } },
  "Größe des Lichts, das in die Kugel soll. Daraus ergibt sich die Öffnung (2 mm Luft) und, wenn nötig, eine größere Kugel.");
const lightSize = sliderField("Leuchtmittel Ø (gemessen)", 10, 58, 1, "mm", (v) => { lightSizeSel.set(v in LIGHT_SIZES ? String(v) : "0"); applyLightSize(v); },
  "Durchmesser deines LED-Teelichts oder Lichts mit dem Messschieber messen und hier eintragen. Die Öffnung wird 2 mm größer.", 0);
{ const d = store.get("lithoLightMm", 38); lightSize.set(d); lightSizeSel.set(String(d) in LIGHT_SIZES ? String(d) : "0"); }
const lithoSection = section("Lithophanie", true,
  (fields.litho_form = selectField("Form", LITHO_FORMS, (v) => {
    // sinnvolle Bildgröße je Form: Zylinder rundum, Kugel vorn aufgesetzt
    if (v === "cylinder" && state.settings.litho_img_deg === 150) { setSetting("litho_img_deg", 360); fields.litho_img_deg?.set(360); }
    if (v === "sphere" && state.settings.litho_img_deg === 360) { setSetting("litho_img_deg", 150); fields.litho_img_deg?.set(150); }
    setSetting("litho_form", v as any); syncLitho(); }, "Flach für Fensterbilder und Leuchtrahmen, gebogen steht von selbst, Zylinder als Lampenschirm, Kugel als Ornament.")).el,
  sl("litho_min_mm", "Dünnste Stelle (hell)", 0.3, 2, 0.05, "mm", "Wandstärke an den hellsten Bildstellen. 0,6 mm bis 0,8 mm ist stabil und lässt viel Licht durch."),
  sl("litho_max_mm", "Dickste Stelle (dunkel)", 1.2, 6, 0.1, "mm", "Wandstärke an den dunkelsten Bildstellen. Üblich sind 2,4 bis 3 mm bei weißem PLA; Richtwert: etwa 60 % des TD-Werts deines Filaments.", 1),
  sl("litho_angle_deg", "Bogen", 30, 300, 5, "°", "Wie weit die gebogene Lithophanie herumläuft. 120° steht stabil.", 0),
  sl("litho_img_deg", "Bildgröße auf dem Körper", 30, 360, 5, "°", "Wie breit das Bild auf Kugel oder Zylinder liegt (als Winkel). Die Höhe folgt aus dem Bild, es wird nichts gestreckt; was über den Körper hinausragt, wird abgeschnitten.", 0),
  sl("litho_img_x", "Bild drehen (links/rechts)", -180, 180, 1, "°", "Schiebt das Bild um den Körper herum.", 0),
  sl("litho_img_y", "Bild nach oben/unten", -100, 100, 1, "%", "Schiebt das Bild auf dem Körper nach oben oder unten.", 0),
  (fields.litho_repeat = switchField("Bild rundum wiederholen", (v) => setSetting("litho_repeat", v), "Setzt das Bild mehrmals nebeneinander rund um den Körper, statt nur einmal vorn. Die Anzahl ergibt sich aus der Bildgröße.")).el,
  sl("litho_rest_mm", "Wandstärke neben dem Bild", 0.6, 4, 0.1, "mm", "Wandstärke von Kugel oder Zylinder dort, wo kein Bild liegt. Dünner leuchtet der ganze Körper mit, dicker bleibt er um das Bild herum dunkel.", 1),
  sl("litho_height_mm", "Höhe des Zylinders (0 = wie Bild)", 0, 300, 1, "mm", "Eigene Höhe für den Zylinder. Bei 0 ist er genau so hoch wie das Bild.", 0),
  sl("litho_hole_mm", "Öffnung unten Ø", 0, 60, 1, "mm", "Öffnung für LED-Teelicht oder Lichterkette. Die Kugel wird mit der Öffnung nach unten gedruckt. 0 = geschlossen.", 0),
  lightSizeSel.el, lightSize.el,
  (fields.litho_cap = switchField("Schraubdeckel oben", (v) => { setSetting("litho_cap", v); if (v) applyLightSize(store.get("lithoLightMm", 38)); syncLitho(); }, "Oben eine Öffnung mit Innengewinde in der Größe des Leuchtmittels, dazu ein Deckel mit Öse als zweites Teil. Unten bekommt die Kugel einen flachen Boden, auf dem das Licht steht. In der STL steht die Kugel auf dem Kopf auf der Gewindeseite, der Deckel daneben: genau so drucken.")).el,
  sl("litho_cap_mm", "Öffnung oben Ø", 12, 60, 1, "mm", "Lichte Weite der oberen Öffnung. 26 mm passt für kleine LED-Lichter und Lichterketten, ein LED-Teelicht braucht etwa 40 mm.", 0),
  (fields.litho_loop = switchField("Öse zum Aufhängen", (v) => setSetting("litho_loop", v), "Setzt oben einen Ring für Faden oder Haken auf die Kugel.")).el,
  (fields.litho_invert = switchField("Umkehren (Negativ)", (v) => setSetting("litho_invert", v), "Helle Stellen dick statt dünn. Nur für Sonderfälle.")).el,
  h("div", { class: "field" }, h("label", null, "Filament"), lithoFilBtn),
  lithoLightSel.el, lithoIntensity.el,
  h("p", { class: "hint", style: { margin: "4px 0 0" } }, "Die Simulation zeigt, wie das Bild mit Licht von hinten bzw. innen aussieht. Drucktipp: 100 % Füllung, 0,12 mm Schichthöhe, langsam."));
lithoSection.dataset.mode = "litho";
left.prepend(kindPill, lithoSection);
function syncLitho() {
  const on = !!state.settings.litho, form = state.settings.litho_form;
  app.classList.toggle("litho", on);
  for (const [v, b] of kindBtns) b.classList.toggle("active", v === on);
  lithoFilBtn.replaceChildren(h("div", { class: "swatch", style: { background: lithoView.filament.color } }), `${lithoView.filament.name} · TD ${lithoView.filament.td.toFixed(1)}`);
  const show = (k: keyof HeightSettings, vis: boolean) => { const el = fields[k]?.el; if (el) el.style.display = vis ? "" : "none"; };
  show("litho_angle_deg", form === "curved"); const round = form === "sphere" || form === "cylinder"; for (const k of ["litho_img_deg", "litho_img_x", "litho_img_y", "litho_repeat", "litho_rest_mm"] as const) show(k, round); show("litho_height_mm", form === "cylinder"); show("litho_cap", form === "sphere"); lightSizeSel.el.style.display = lightSize.el.style.display = form === "sphere" ? "" : "none"; show("litho_cap_mm", form === "sphere" && !!state.settings.litho_cap); show("litho_hole_mm", form === "sphere" && !state.settings.litho_cap); show("litho_loop", form === "sphere");
  const wl = fields.width_mm?.el.querySelector("label > span");
  if (wl) wl.textContent = !on ? "Breite" : form === "cylinder" || form === "sphere" ? "Durchmesser" : form === "curved" ? "Breite (Bogenlänge)" : "Breite";
}

// Mitte: Ansichten
const viewPreview = new ImageView();
const viewOriginal = new ImageView();
const view3d = new ModelView();
const analysisEl = h("div", { class: "view analysis" });
// 1× ist die echte Höhe des Drucks; mehr überzeichnet das Relief nur in der Ansicht
const zStart = Math.min(6, Math.max(1, Number(store.get("zScale", 1)) || 1));
const zLabel = h("span", null, `${zStart}×`);
const zRange = h("input", { type: "range", min: 1, max: 6, step: 0.5, value: zStart, style: { width: "110px" },
  title: "1× zeigt die echte Höhe des Drucks. Höhere Werte überzeichnen das Relief nur in dieser Ansicht, damit Stufen besser zu erkennen sind. Doppelklick: zurück auf 1×." });
const setZ = () => { zLabel.textContent = `${zRange.value}×`; view3d.setZScale(Number(zRange.value)); store.set("zScale", Number(zRange.value)); };
zRange.addEventListener("input", setZ);
zRange.addEventListener("dblclick", () => { zRange.value = "1"; setZ(); });
view3d.setZScale(zStart);
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
// Startbildschirm: Bild öffnen oder eines der mitgelieferten Beispiele laden
const exampleCard = (ex: Example) => h("button", { class: "example", title: ex.litho ? "Als Lithophanie öffnen" : "Als Farbrelief öffnen", onclick: () => loadExample(ex) },
  h("img", { src: `./examples/${ex.id}-thumb.jpg`, alt: "", loading: "lazy" }), h("span", null, ex.name), h("small", null, ex.litho ? "Lithophanie" : `${ex.stops.length} Filamente`));
const dropzone = h("div", { class: "dropzone" }, h("div", { class: "card welcome" },
  h("div", { class: "welcome-hero", style: { backgroundImage: "linear-gradient(90deg, #15161cf2 0%, #15161cb0 45%, #15161c20 100%), url(./examples/start.jpg)" } },
    h("h2", null, "Bild hierher ziehen"),
    h("p", null, "oder öffnen: PNG, JPG, BMP, WebP – oder ein Projekt (.chroma)"),
    h("div", { style: { display: "flex", gap: "8px", marginTop: "14px" } },
      button("Bild öffnen", openImage, { icon: "image", cls: "primary" }), button("Projekt öffnen", openProject, { icon: "folder" }))),
  h("div", { class: "welcome-title" }, "Oder mit einem Beispiel starten"),
  ...EXAMPLE_GROUPS.flatMap((g) => [h("div", { class: "welcome-group" }, g), h("div", { class: "examples" }, ...EXAMPLES.filter((e) => e.group === g).map(exampleCard))])));
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
// Lithophanie: Licht an/aus
const lightBtn = button("", () => { lithoView.on = !lithoView.on; syncLight(); }, { cls: "small on", title: "Lampe ein- und ausschalten: mit Licht erscheint das Bild, ohne sieht man nur das weiße Relief." });
function syncLight() {
  lightBtn.classList.toggle("on", lithoView.on);
  lightBtn.replaceChildren(icon("magic"), lithoView.on ? "Licht an" : "Licht aus");
  view3d.setLit(lithoView.on);
}
syncLight();
view3d.el.append(h("div", { class: "view-tools litho-only", style: { top: "44px" } }, lightBtn));

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
  "Rechts den Filament-Stapel wählen. „Vorschlagen“ sucht das beste Set, „Automatisch verteilen“ legt die Wechsel.",
  "Ergebnis prüfen: Vergleich mit dem Original, 3D-Ansicht, Farbanalyse mit Verbrauch und Kosten.",
  "Exportieren schreibt STL, 3MF mit Farbwechseln, Farbwechsel-Liste und den Druck-Assistenten.",
];
// Lithophanie: kein Filament-Stapel und keine Farbwechsel, dafür Wandstärken, ein Filament und die Lichtquelle
const STEPS_LITHO = ["Bild", "Form & Größe", "Filament & Licht", "Vorschau", "Export"];
const STEP_HINTS_LITHO = [
  "Bild öffnen oder ins Fenster ziehen.",
  "Links Form, Wandstärken und Größe einstellen. Die Bildkorrektur ist unter „Bild“ eingeklappt.",
  "Links Filament und Lichtquelle wählen. Die Simulation zeigt das Bild mit Licht von hinten.",
  "Ergebnis prüfen: 3D-Ansicht mit „Licht an“ und Vergleich mit dem Original.",
  "Exportieren schreibt die STL der Lithophanie und ein Vorschaubild im Gegenlicht.",
];
let step = 0;
const stepsEl = h("div", { class: "steps" });
const stepHint = h("div", { class: "step-hint" });
const flash = (el: HTMLElement) => { el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash"); };
function renderSteps() {
  clear(stepsEl);
  const litho = !!state.settings.litho, hints = litho ? STEP_HINTS_LITHO : STEP_HINTS;
  (litho ? STEPS_LITHO : STEPS).forEach((label, i) => {
    if (i) stepsEl.append(h("div", { class: "step-sep" }));
    stepsEl.append(h("button", { class: "step" + (i === step ? " current" : i < step ? " done" : ""), title: hints[i], onclick: () => goStep(i) },
      h("i", null, i < step ? "✓" : String(i + 1)), label));
  });
  stepHint.textContent = hints[step];
  stepsEl.append(stepHint);
  if (step < STEPS.length - 1 && state.image) stepsEl.append(button("Weiter", () => goStep(step + 1), { cls: "small primary" }));
}
function goStep(i: number) {
  if (i > 0 && !state.image) { toast("Bitte zuerst ein Bild öffnen."); i = 0; }
  step = i; renderSteps();
  const sections = [...left.querySelectorAll("details")] as HTMLDetailsElement[];
  if (i === 0) { if (!state.image) openImage(); else showTab(1); }
  if (i === 1) { sections.forEach((d, k) => (d.open = k < 2)); left.scrollTop = 0; flash(left); showTab(0); }
  if (i === 2) { if (state.settings.litho) { lithoSection.open = true; left.scrollTop = 0; flash(lithoSection); } else flash(stack.el); showTab(0); }
  if (i === 3) { showTab(0); if (!compareOn) { compareOn = true; store.set("compare", true); } updateCompare(); }
  if (i === 4) exportAll();
}

const main = h("main", { class: "main" }, stepsEl, tabs, views);

// Rechts: Stapel
const stack = new StackPanel({
  get stops() { return state.stops; },
  changed: (structural) => { markDirty(); if (structural) schedule(); else { livePreview(); schedule(320); } },
  add: async () => {
    const picked = await openLibrary(libHost, true);
    if (picked.length) stack.addFilaments(picked.map((f) => ({ ...f })));
  },
  auto: autoDistribute,
  suggest: suggestFilaments,
  blackWhite,
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
for (const [k, f] of Object.entries(fields)) f!.setDefault((DEFAULT_SETTINGS as any)[k]);
lithoIntensity.setDefault(1);
function syncFields() {
  for (const [k, f] of Object.entries(fields)) f!.set((state.settings as any)[k]);
  syncMode(); syncShapeFields(); syncLitho(); renderSteps();
}
function syncMode(effective?: string) {
  for (const [k, b] of modeButtons) b.classList.toggle("active", k === state.settings.height_mode);
  const eff = effective ?? state.result?.mode;
  // nur zeigen, was im aktuellen Modus wirkt: farbtreu rechnet nicht mit der Helligkeit, die Helligkeits-Modi nicht mit der Detailtreue
  const color = !state.settings.litho && (state.settings.height_mode === "auto" ? eff ?? effectiveMode({ settings: state.settings, stops: state.stops } as Project) : state.settings.height_mode) === "color";
  fields.color_detail!.el.style.display = color ? "" : "none";
  fields.luma_method!.el.style.display = fields.linearize!.el.style.display = color ? "none" : "";
  modeButtons.get("auto")!.textContent = state.settings.height_mode === "auto" && eff
    ? `Auto · ${{ bright_high: "hell hoch", dark_high: "dunkel hoch", color: "farbtreu" }[eff]}` : "Auto";
}
function syncShapeFields() {
  const round = state.settings.shape === "circle";
  const bo = state.settings.breakout;
  for (const k of ["breakout_frame", "breakout_x", "breakout_y", "breakout_tol"] as const) fields[k]!.el.style.display = bo !== "off" ? "" : "none";
  fields.breakout_float_mm!.el.style.display = breakoutHint.style.display = bo === "floating" ? "" : "none";
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
  const t = `${state.dirty ? "• " : ""}${tr(name ?? "")} – Chromalith ${VERSION}`;
  document.title = t;
  if (isTauri()) import("@tauri-apps/api/window").then((w) => w.getCurrentWindow().setTitle(t)).catch(() => {});
}

// ------------------------------------------------------------------ Berechnung
let timer = 0, running = false, queued = false;
/** Live-Vorschau beim Verschieben der Wechsel: nur das 2D-Bild, sofort; die volle Berechnung folgt nach einer Pause. */
let liveBusy = false, livePending = false;
async function livePreview() {
  if (!state.image || state.settings.litho || running) return;
  if (liveBusy) { livePending = true; return; }
  liveBusy = true;
  try {
    // farbtreu hängt die Höhe vom Stapel ab und muss neu gerechnet werden: dafür gröber, damit es flüssig bleibt
    const r = await compute.previewImage(state.settings, activeStops(), state.result?.mode === "color" ? 300 : 1200);
    if (!running) { state.previewRgba = new Uint8ClampedArray(r.preview); viewPreview.set(state.previewRgba, r.width, r.height); }
  } catch { /* die volle Berechnung meldet Fehler */ }
  finally { liveBusy = false; if (livePending) { livePending = false; livePreview(); } }
}
function schedule(delay = 140) { noteChange(); clearTimeout(timer); timer = window.setTimeout(rebuild, delay); }

async function rebuild() {
  if (!state.image) return;
  if (running) { queued = true; return; }
  try { validate(state.settings); } catch (e: any) { setStatus([`⚠ ${e.message}`]); return; }
  running = true; busy.classList.add("on");
  compute.setIslands(state.islands);
  try {
    if (state.settings.litho) { await rebuildLitho(); return; }
    const r = await compute.preview(state.settings, activeStops());
    state.result = r;
    state.previewRgba = new Uint8ClampedArray(r.preview);
    viewPreview.set(state.previewRgba, r.width, r.height);
    cutRange.max = String(r.layerCount);
    if (cutFull || Number(cutRange.value) > r.layerCount) cutRange.value = String(r.layerCount);
    view3d.setMesh(r.mesh);
    applyCut();
    const step = state.settings.layer_height_mm;
    updateSlots();
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

/** Lithophanie berechnen und anzeigen (2D im Gegenlicht, 3D als Körper mit Licht an/aus). */
async function rebuildLitho() {
  const r = await compute.litho(state.settings, lithoLight());
  state.result = null;
  state.previewRgba = new Uint8ClampedArray(r.preview);
  viewPreview.set(state.previewRgba, r.width, r.height);
  viewPreview.setCompare(null);
  view3d.setCompare(false);
  const closed = state.settings.litho_form === "cylinder" || state.settings.litho_form === "sphere";
  view3d.setFree(r.mesh, { ...lithoLight(), point: lamp().point, lampHeight: closed ? lamp().height : 0.5, behind: !closed, spill: lamp().spill * (closed ? 1 : 0.6) }, lithoView.on);
  const g = (r.volume_mm3 / 1000) * 1.24;
  setStatus([`<b>Lithophanie</b>`, `${r.size[0].toFixed(0)} × ${r.size[1].toFixed(0)} × ${r.size[2].toFixed(0)} mm`,
    `Wand ${state.settings.litho_min_mm.toFixed(2)}–${state.settings.litho_max_mm.toFixed(1)} mm`, `≈ ${g.toFixed(0)} g`, `≈ ${(r.triangles / 1e6).toFixed(2)} Mio. Dreiecke`, r.note]);
}

async function exportLitho() {
  busy.classList.add("on");
  try {
    const r = await compute.lithoExport(state.settings, lithoLight(), state.name);
    const stl = new Uint8Array(r.stl);
    const path = await saveFile(state.name + fileSuffix("_lithophanie.stl"), stl, [{ name: "STL", extensions: ["stl"] }]);
    if (!path) return;
    const files = [path];
    if (state.previewRgba) { const v = viewPreview.size; files.push(await saveSibling(path, "_gegenlicht.png", await rgbaToPng(state.previewRgba, v[0], v[1]))); }
    const close = modal("Export fertig", h("div", { style: { lineHeight: "1.6" } },
      h("p", { style: { marginTop: 0 } }, "Geschrieben:"),
      h("ul", { style: { paddingLeft: "18px" } }, ...files.map((f) => h("li", null, f.split(/[\\/]/).pop()!))),
      h("p", { class: "hint" }, `STL ${(stl.length / 1e6).toFixed(1)} MB, ${(r.triangles / 1e6).toFixed(2)} Mio. Dreiecke, ${r.size.map((x) => x.toFixed(0)).join(" × ")} mm, etwa ${((r.volume_mm3 / 1000) * 1.24).toFixed(0)} g.`),
      h("p", { class: "hint" }, r.note),
      h("p", { class: "hint" }, "Druck: einfarbig, 100 % Füllung (oder so viele Wände, dass alles massiv ist), Schichthöhe 0,12 mm oder feiner, langsam. Flache und gebogene Lithophanien stehend drucken. Die Kugel steht auf ihrer Öffnung und braucht dort etwas Rand (Brim).")),
      [button("OK", () => close(), { cls: "primary" })], true);
  } catch (e: any) { toast("Export fehlgeschlagen: " + e.message, "err"); }
  finally { if (!running) busy.classList.remove("on"); }
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
  openSuggest(state.settings, state.stops, library, slotLimit(slicer), (stops) => {
    state.stops.splice(0, state.stops.length, ...stops);
    state.settings.height_mode = "color";
    fields.height_mode!.set("color"); syncMode();
    stack.render(); markDirty(); rebuild();
    toast("Vorgeschlagenes Filament-Set übernommen.", "ok");
  });
}

/** Ein Klick: Schwarz-Weiß-Relief aus einem beliebigen (auch farbigen) Bild. */
async function blackWhite() {
  if (!state.image) { toast("Bitte zuerst ein Bild öffnen."); return; }
  const stops = defaultStops();
  if (stops.length < 2) { toast("In der Bibliothek fehlen die generischen Filamente Schwarz, Grau und Weiß.", "err"); return; }
  state.stops.splice(0, state.stops.length, ...stops);
  state.settings.height_mode = "auto";
  fields.height_mode!.set("auto"); syncMode();
  await autoDistribute();
  toast("Schwarz-Weiß-Relief erstellt. Rückgängig mit Strg+Z.", "ok");
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
  const f = num;
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
/** Plätze der Filamente für den Filamentwechsler aus dem zuletzt berechneten Ergebnis (samt Farbinseln). */
function updateSlots() {
  const limit = slotLimit(slicer), r = state.result;
  if (limit === null || !r || state.settings.litho) { stack.setSlots(null, null); return; }
  const plan = planSlots(r.usage);
  stack.setSlots(new Map(plan.filaments.map((f, i) => [filamentKey(f), i + 1])), limit);
}
async function slicerSetup() {
  await openSlicerSetup(slicer, updateSlots);
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

/** Lädt ein mitgeliefertes Beispiel samt passendem Filament-Stapel bzw. als Lithophanie. */
async function loadExample(ex: Example) {
  if (!(await confirmDiscard())) return;
  try {
    const bytes = new Uint8Array(await (await fetch(`./examples/${ex.id}.jpg`)).arrayBuffer());
    const img = await decodeImage(bytes);
    state.path = null; state.name = tr(ex.name);
    state.settings = normalizeSettings({ ...ex.settings });
    state.islands.splice(0); islandPanel.render();
    if (ex.stops.length) {
      const lib = new Map(starterLibrary().map((f) => [f.name, f]));
      state.stops.splice(0, state.stops.length, ...ex.stops.map(([n, layer]) => ({ filament: lib.get(n)!, start_layer: layer })).filter((x) => x.filament));
    }
    syncFields(); syncLitho();
    await setImage(img, null);
    stack.render();
    await rebuild();
    resetHistory();
    state.dirty = false; updateTitle();
    showTab(ex.litho ? 2 : 0);
  } catch (e: any) { toast("Das Beispiel konnte nicht geladen werden: " + e.message, "err"); }
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
  if (state.settings.litho) return exportLitho();
  busy.classList.add("on");
  try {
    compute.setIslands(state.islands);
    const r = await compute.exportAll(state.settings, activeStops(), state.name,
      { target: slicer.target, template: slicer.template, changeMode: slicer.changeMode, pauseText: tr("Filament wechseln: {}") });
    const stl = new Uint8Array(r.stl);
    const path = await saveFile(`${state.name}.stl`, stl, [{ name: "STL", extensions: ["stl"] }]);
    if (!path) return;
    const png = await rgbaToPng(new Uint8ClampedArray(r.preview), r.width, r.height);
    const files = [path,
      await saveSibling(path, ".3mf", new Uint8Array(r.threemf)),
      await saveSibling(path, fileSuffix("_farbwechsel.txt"), trLines(r.report)),
      await saveSibling(path, fileSuffix("_farbwechsel.json"), r.json),
      await saveSibling(path, fileSuffix("_vorschau.png"), png)];
    const ad = assistData();
    if (ad) files.push(await saveSibling(path, fileSuffix("_druckassistent.html"), assistantHtml(ad)));
    if (step < 4) { step = 4; renderSteps(); }
    const close = modal("Export fertig", h("div", null,
      h("p", { style: { marginTop: 0 } }, "Geschrieben:"),
      h("ul", { style: { paddingLeft: "18px", lineHeight: "1.7" } }, ...files.map((f) => h("li", null, f.split(/[\\/]/).pop()!))),
      h("p", { class: "hint" }, `STL ${(stl.length / 1e6).toFixed(1)} MB, 3MF ${(r.threemf.byteLength / 1e6).toFixed(1)} MB.`),
      ...slicerNotes(r.threemfInfo),
      h("pre", { style: { background: "var(--bg)", padding: "10px", borderRadius: "8px", maxHeight: "260px", overflow: "auto", fontSize: "12px" } }, trLines(r.report))),
      [button("Slicer und AMS …", () => { close(); slicerSetup(); }, { icon: "layers" }),
        button("Druck-Assistent öffnen", () => { close(); showAssistant(); }, { icon: "layers" }), button("OK", () => close(), { cls: "primary" })]);
  } catch (e: any) { toast("Export fehlgeschlagen: " + e.message, "err"); }
  finally { if (!running) busy.classList.remove("on"); }
}

/** Hinweise im Export-Dialog: was in der 3MF steht und was im Slicer noch zu tun ist. */
function slicerNotes(info: ThreeMfInfo): HTMLElement[] {
  const base = state.settings.base_layer_mm.toFixed(2), step = state.settings.layer_height_mm.toFixed(2);
  const hint = (text: string, warn = false) => h("p", { class: "hint" + (warn ? " warn" : "") }, text);
  if (info.target === "prusa") return [hint(
    (info.changes === "m600" ? `PrusaSlicer: die .3mf öffnen. Die ${info.changeCount} Farbwechsel (M600) stehen dann im Schicht-Regler. ` : "PrusaSlicer: die .3mf öffnen. ") +
    `Im Druckprofil die erste Schicht auf ${base} mm, die Schichthöhe auf ${step} mm und die Füllung auf 100 % stellen.`)];
  const out: HTMLElement[] = [];
  const tpl = slicer.template;
  if (!info.project) {
    out.push(hint("Ohne Vorlage enthält die .3mf nur das Modell. Bambu Studio und OrcaSlicer übernehmen Filamentwechsel und Schichthöhen nur aus einem vollständigen Projekt. Unter „Slicer und AMS“ einmal ein Projekt aus deinem Slicer als Vorlage wählen, dann stehen Drucker, Filamentfarben, Schichthöhen und Wechsel in der Datei.", true),
      hint(`Bis dahin im Slicer von Hand: erste Schicht ${base} mm, Schichthöhe ${step} mm, Füllung 100 %, Wechsel laut Liste unten.`));
    return out;
  }
  out.push(hint(`${SLICER_TARGETS.bambu}: die .3mf als Projekt öffnen. Drucker und Prozess kommen aus deiner Vorlage (${tpl ? slicerName(tpl.app) : ""}), die erste Schicht (${base} mm), die Schichthöhe (${step} mm) und 100 % Füllung sind eingetragen.`));
  if (info.changes === "ams") {
    out.push(hint(`Alle ${info.changeCount} Filamentwechsel sind eingetragen, das AMS wechselt von selbst. Filamente im Projekt:`),
      h("div", { style: { display: "grid", gap: "4px", margin: "0 0 8px" } }, ...info.slots.map((s) =>
        h("div", { style: { display: "flex", gap: "8px", alignItems: "center" } },
          h("div", { class: "swatch", style: { background: s.filament.color, width: "16px", height: "16px" } }),
          h("span", null, `Platz ${s.slot}`), h("span", { "data-notr": true }, tr(filamentLabel(s.filament))),
          s.type && s.type.toLowerCase() !== s.filament.material.trim().toLowerCase()
            ? h("span", { class: "hint warn" }, `Vorlage: ${s.type}, Filament: ${s.filament.material}`) : ""))),
      hint("Vor dem Druck im Slicer prüfen: Das Material jedes Platzes stammt aus der Vorlage und muss zu deinen Rollen passen. Die Spülmengen (im Slicer „Reinigungsvolumen“) sind geschätzt; dort lassen sie sich neu berechnen."));
  } else if (info.changes === "pause") {
    out.push(hint(`Vor jedem der ${info.changeCount} Wechsel steht eine Pause. Der Drucker hält an, du wechselst das Filament von Hand und setzt den Druck fort. Welche Farbe wann kommt, zeigt der Druck-Assistent.`));
  } else if (info.reason === "too_many") {
    out.push(hint(`Der Stapel braucht ${info.slots.length} verschiedene Filamente, die Vorlage hat ${info.available}. Die .3mf enthält deshalb keine Filamentwechsel. Abhilfe: weniger Filamente nehmen, eine Vorlage mit mehr Filamenten speichern oder unter „Slicer und AMS“ auf Pausen umstellen.`, true));
  }
  return out;
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
  const p = await saveFile(state.name + fileSuffix("_vorschau.png"), png, [{ name: "PNG", extensions: ["png"] }]);
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

function chooseLanguage() {
  const saved = store.get<string | null>("lang", null);
  const pick = (l: "de" | "en" | "auto", label: string, active: boolean) => button(label, async () => { if (await confirmDiscard()) setLang(l); }, { cls: active ? "primary" : "" });
  modal("Sprache / Language", h("div", { "data-notr": true, style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
    pick("auto", lang === "de" ? "Wie Betriebssystem" : "Follow system", saved !== "de" && saved !== "en"),
    pick("de", "Deutsch", saved === "de"), pick("en", "English", saved === "en")), [], true);
}

function about() {
  const close = modal("Über Chromalith", h("div", { style: { lineHeight: "1.6" } },
    h("div", { style: { display: "flex", gap: "14px", alignItems: "center" } }, h("img", { src: "./icon.png", width: 48, height: 48 }),
      h("div", null, h("b", null, `Chromalith ${VERSION}`), h("div", { class: "hint" }, "Farbige Reliefbilder aus Filament-Schichten für den 3D-Druck."))),
    h("p", null, "Eigenständige Entwicklung. Bild öffnen, Filamente stapeln, Wechsel-Schichten festlegen und als STL mit Farbwechsel-Liste exportieren."),
    h("p", { class: "hint" }, "Tastenkürzel: Strg+O Bild · Strg+Umschalt+O Projekt · Strg+S Speichern · Strg+E Export · Strg+L Bibliothek · Strg+N Neu"),
    h("p", { class: "hint" }, "Chromalith ist kostenlos und quelloffen (MIT-Lizenz). Wenn es dir gefällt, freue ich mich über einen Kaffee.")),
    [button("Projekt auf GitHub", () => openPage("project").catch(() => {}), { cls: "ghost" }),
      button("☕ Kaffee spendieren", () => openPage("support").catch(() => {})),
      button("Schließen", () => close(), { cls: "primary" })], true);
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
autoCheckForUpdate(VERSION, () => state.dirty && !!state.image, () => saveProject(false));

// für Tests/Fehlersuche
(window as any).chromalith = { showUpdate, state, rebuild, loadExample, EXAMPLES, loadProjectBytes, loadImageBytes, editFilament, fromRGBA8 };
