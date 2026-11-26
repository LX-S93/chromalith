/** Dialog „Filamente vorschlagen“: bestes Set aus der Bibliothek für das aktuelle Bild. */
import { SUGGEST_MODES, filamentLabel, materialFamily, type ColorStop, type Filament, type HeightSettings, type SuggestMode } from "../core";
import * as compute from "../compute";
import { store } from "../platform";
import { button, clear, h, modal } from "./dom";
import { selectField, sliderField, switchField } from "./fields";
import { num, tr } from "../i18n";

const quality = (e: number) => (e < 8 ? "sehr gut" : e < 12 ? "gut" : e < 18 ? "mittel" : "grob");

function canvasOf(r: { width: number; height: number; preview: ArrayBuffer }) {
  const c = h("canvas", { width: r.width, height: r.height, style: { width: "100%", borderRadius: "8px", display: "block" } });
  c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(r.preview), r.width, r.height), 0, 0);
  return c;
}

function stackList(stops: ColorStop[]) {
  return h("div", { style: { display: "grid", gap: "4px" } }, ...[...stops].reverse().map((s) =>
    h("div", { style: { display: "flex", gap: "8px", alignItems: "center" } },
      h("div", { class: "swatch", style: { background: s.filament.color, width: "16px", height: "16px" } }),
      h("span", { style: { flex: "1", minWidth: "0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, filamentLabel(s.filament)),
      h("small", { class: "hint" }, `TD ${s.filament.td.toFixed(1)} · ab ${s.start_layer}`))));
}

/** Ein Satz dazu, welcher Aufbau herauskam und warum. */
function why(order: "dark_base" | "light_base" | "free", error: number, best: number, mode: SuggestMode): string {
  const name = order === "dark_base" ? "Ruhiges Relief, dunkel unten und hell oben." : order === "light_base" ? "Nach Helligkeit sortiert, hell unten und dunkel oben." : "Freie Reihenfolge für die besten Farben.";
  if (mode !== "auto") return tr(name);
  if (order === "dark_base") return tr(name) + " " + (error > best + 0.2 ? tr("Die besten Farben wären um {} genauer, hätten aber ein unruhigeres Relief.").replace("{}", num(error - best, 1)) : tr("Das trifft hier auch die Farben am besten."));
  return tr(name) + " " + tr("Ein ruhiges Relief würde die Farben hier deutlich schlechter treffen; es lässt sich oben unter „Aufbau“ trotzdem wählen.");
}

export function openSuggest(settings: HeightSettings, current: ColorStop[], library: Filament[], apply: (stops: ColorStop[]) => void) {
  let count = store.get("suggestCount", 6);
  let ownedOnly = store.get("suggestOwned", false);
  const ownedN = library.filter((f) => f.owned).length;
  const countF = sliderField("Anzahl Filamente", 2, 10, 1, "", (v) => { count = v; store.set("suggestCount", v); }, "So viele Filamente soll der Vorschlag enthalten.");
  countF.set(count);
  const ownF = switchField(`Nur vorhandene Filamente (${ownedN})`, (v) => { ownedOnly = v; store.set("suggestOwned", v); },
    "Nur Filamente, die in der Bibliothek als „Vorhanden“ markiert sind.");
  ownF.set(ownedOnly && ownedN >= 2);
  if (ownedN < 2) { (ownF.el.querySelector("input") as HTMLInputElement).disabled = true; ownedOnly = false; }
  // Material: gemischte Materialien lassen sich schlecht zusammen drucken, deshalb standardmäßig nur eines
  const famCount = new Map<string, number>();
  for (const f of library) { const k = materialFamily(f.material); famCount.set(k, (famCount.get(k) ?? 0) + 1); }
  const fams = [...famCount.entries()].sort((a, b) => b[1] - a[1]);
  let material = store.get("suggestMaterial", fams.length > 1 && fams[0][1] >= 6 ? fams[0][0] : "");
  if (material && (famCount.get(material) ?? 0) < 2) material = "";
  const matF = selectField("Material", { "": `Alle Materialien (${library.length})`, ...Object.fromEntries(fams.map(([k, n]) => [k, `Nur ${k} (${n})`])) },
    (v) => { material = v; store.set("suggestMaterial", v); }, "Verschiedene Materialien (z. B. PLA und PETG) haften schlecht aufeinander. Am besten bei einem Material bleiben.");
  matF.set(material);
  // Aufbau des Stapels: ruhiges Relief (nach Helligkeit sortiert) oder beste Farben (freie Reihenfolge)
  let mode: SuggestMode = store.get("suggestMode", "auto");
  if (!(mode in SUGGEST_MODES)) mode = "auto";
  const modeF = selectField("Aufbau", SUGGEST_MODES, (v) => { mode = v as SuggestMode; store.set("suggestMode", v); },
    "Ruhiges Relief: Die Filamente liegen nach Helligkeit sortiert, die Höhe folgt weitgehend der Bildhelligkeit. Dunkel unten macht feine dunkle Details (Äste, Konturen) zu Rillen statt zu dünnen Wänden. Beste Farben: freie Reihenfolge, trifft die Farben am genauesten, kann aber hohe Blöcke mit steilen Wänden erzeugen. Automatisch nimmt das ruhige Relief, solange die Farben kaum darunter leiden.");
  modeF.set(mode);
  const bar = h("i", { style: { width: "0%", background: "var(--accent)" } });
  const progress = h("div", { style: { display: "none", gap: "6px" } }, h("div", { class: "hint" }, "Suche das beste Set … (dauert einige Sekunden)"), h("div", { class: "bar" }, bar));
  const result = h("div");
  const go = button("Vorschlag berechnen", run, { icon: "magic", cls: "primary" });
  const applyBtn = button("Übernehmen", () => {}, { cls: "primary" });
  applyBtn.disabled = true;
  const content = h("div", { style: { display: "grid", gap: "14px" } },
    h("p", { class: "hint", style: { margin: 0 } }, `Chromalith probiert Filamente aus deiner Bibliothek (${library.length}) durch und sucht das Set samt Reihenfolge und Wechsel-Schichten, mit dem die Farben des Bildes am besten getroffen werden.`),
    h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 16px", alignItems: "end" } }, countF.el, matF.el, modeF.el, ownF.el),
    h("div", null, go), progress, result);
  const close = modal("Filamente vorschlagen", content, [button("Schließen", () => close()), applyBtn]);

  async function run() {
    const lib = library.filter((f) => (!ownedOnly || f.owned) && (!material || materialFamily(f.material) === material));
    if (lib.length < 2) { clear(result); result.append(h("p", { class: "hint warn" }, "Mit diesen Filtern bleiben zu wenige Filamente übrig.")); return; }
    go.disabled = true; applyBtn.disabled = true; clear(result);
    progress.style.display = "grid"; bar.style.width = "0%";
    try {
      const colorSettings: HeightSettings = { ...settings, height_mode: "color" };
      const r = await compute.suggest(colorSettings, current, lib, count, mode, (f) => (bar.style.width = `${Math.round(f * 100)}%`));
      const [now, sug] = await Promise.all([compute.previewImage(settings, current), compute.previewImage(colorSettings, r.stops)]);
      progress.style.display = "none";
      const better = r.currentError !== null ? r.currentError - r.error : 0;
      result.append(
        h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" } },
          h("div", null, h("h3", { style: { margin: "0 0 6px", fontSize: "13px" } }, "Jetziger Stapel"), canvasOf(now),
            h("p", { class: "hint" }, r.currentError !== null ? `Ø Farbabweichung ${r.currentError.toFixed(1)} (${quality(r.currentError)})` : ""),
            stackList(current)),
          h("div", null, h("h3", { style: { margin: "0 0 6px", fontSize: "13px" } }, `Vorschlag: ${r.stops.length} Filamente`), canvasOf(sug),
            h("p", { class: "hint" }, `Ø Farbabweichung ${r.error.toFixed(1)} (${quality(r.error)})${better > 0.5 ? ` · ${Math.round((better / r.currentError!) * 100)} % näher am Bild` : ""}`),
            stackList(r.stops))),
        r.order ? h("p", { class: "hint" }, why(r.order, r.error, r.bestError ?? r.error, mode)) : "",
        r.stops.length < count ? h("p", { class: "hint" }, `Ein weiteres Filament würde das Ergebnis verschlechtern (oder die Bibliothek hat keine passenden mehr), deshalb nur ${r.stops.length}.`) : "",
        h("p", { class: "hint" }, "„Übernehmen“ ersetzt den Stapel und stellt die Höhe auf „Farbtreu“. Die Farbabweichung ist der mittlere Abstand im Lab-Farbraum: unter 8 ist kaum ein Unterschied zu sehen."));
      applyBtn.disabled = false;
      applyBtn.onclick = () => { apply(r.stops.map((s) => ({ filament: { ...s.filament }, start_layer: s.start_layer }))); close(); };
    } catch (e: any) {
      progress.style.display = "none";
      result.append(h("p", { class: "hint warn" }, "Kein Vorschlag möglich: " + e.message));
    } finally { go.disabled = false; }
  }
}
