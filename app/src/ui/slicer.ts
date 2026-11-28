/** Dialog „Slicer und AMS“: Ziel-Slicer, Vorlage aus dem eigenen Slicer, Art der Farbwechsel. */
import { CHANGE_MODES, SLICER_TARGETS, readSlicerTemplate, validTemplate, type ChangeMode, type SlicerTarget, type SlicerTemplate } from "../core";
import { openFile, store } from "../platform";
import { button, clear, h, modal, toast } from "./dom";
import { selectField, sliderField } from "./fields";

export interface SlicerPrefs {
  target: SlicerTarget;
  changeMode: ChangeMode;
  /** AMS-Plätze, solange keine Vorlage gewählt ist (mit Vorlage zählen deren Filamente) */
  slots: number;
  template: SlicerTemplate | null;
}

export function loadSlicerPrefs(): SlicerPrefs {
  const p = store.get<Partial<SlicerPrefs>>("slicer", {});
  const t = store.get<unknown>("slicerTemplate", null);
  return {
    target: p.target === "prusa" ? "prusa" : "bambu",
    changeMode: p.changeMode === "pause" ? "pause" : "ams",
    slots: Number.isFinite(p.slots) ? Math.min(16, Math.max(1, Math.round(p.slots!))) : 4,
    template: validTemplate(t) ? t : null,
  };
}

function save(p: SlicerPrefs) {
  store.set("slicer", { target: p.target, changeMode: p.changeMode, slots: p.slots });
  try { store.set("slicerTemplate", p.template); }
  catch { toast("Die Vorlage ließ sich nicht dauerhaft speichern (lokaler Speicher voll). Sie gilt bis zum Schließen des Programms.", "err", 8000); }
}

/** Zahl der Plätze, auf die Filamentwechsel verteilt werden können. null: keine Grenze, weil von Hand gewechselt wird. */
export function slotLimit(p: SlicerPrefs): number | null {
  if (p.target !== "bambu" || p.changeMode !== "ams") return null;
  return p.template ? p.template.filaments.length : p.slots;
}

/** „BambuStudio-02.03.00.70“ -> „Bambu Studio 2.3.0.70“ */
export function slicerName(app: string): string {
  const [prog, ...rest] = app.split("-");
  const ver = rest.join("-").split(".").map((x) => (/^\d+$/.test(x) ? String(Number(x)) : x)).join(".");
  return `${prog === "BambuStudio" ? "Bambu Studio" : prog} ${ver}`.trim();
}

export function openSlicerSetup(prefs: SlicerPrefs, changed: () => void): Promise<void> {
  return new Promise((resolve) => {
    const body = h("div", { style: { display: "grid", gap: "14px" } });
    const update = () => { save(prefs); changed(); render(); };

    const targetF = selectField("3MF für", SLICER_TARGETS, (v) => { prefs.target = v as SlicerTarget; update(); },
      "Für welchen Slicer die exportierte .3mf geschrieben wird.");
    const modeF = selectField("Farbwechsel", CHANGE_MODES, (v) => { prefs.changeMode = v as ChangeMode; update(); },
      "AMS: Jeder Wechsel wird ein Filamentwechsel auf den Platz des neuen Filaments. Pause: Der Drucker hält vor der Schicht an und das Filament wird von Hand gewechselt.");
    const slotsF = sliderField("AMS-Plätze", 1, 16, 1, "", (v) => { prefs.slots = v; save(prefs); changed(); },
      "So viele Filamente kann dein Drucker ohne Eingriff wechseln (ein AMS: 4). Chromalith warnt, wenn der Stapel mehr braucht.");

    async function choose() {
      const f = await openFile([{ name: "Slicer-Projekt (3MF)", extensions: ["3mf"] }]);
      if (!f) return;
      try {
        prefs.template = await readSlicerTemplate(f.bytes, f.name);
        toast("Vorlage übernommen.", "ok");
        update();
      } catch (e: any) { toast(e.message, "err", 9000); }
    }

    function templateCard(t: SlicerTemplate) {
      return h("div", { style: { display: "grid", gap: "8px", padding: "12px", borderRadius: "10px", background: "var(--bg)" } },
        h("div", null, h("b", { "data-notr": true }, t.source), h("span", { class: "hint", "data-notr": true }, ` · ${slicerName(t.app)}`)),
        h("div", { class: "hint" }, "Drucker: ", h("span", { "data-notr": true }, t.printer || "?")),
        h("div", { class: "hint" }, "Prozess: ", h("span", { "data-notr": true }, t.process || "?")),
        h("div", { style: { display: "grid", gap: "4px" } }, ...t.filaments.map((f, i) =>
          h("div", { style: { display: "flex", gap: "8px", alignItems: "center" } },
            h("div", { class: "swatch", style: { background: f.color, width: "16px", height: "16px" } }),
            h("span", null, `Platz ${i + 1}`), h("span", { class: "hint", "data-notr": true }, [f.name, f.type && !f.name.includes(f.type) ? `(${f.type})` : ""].filter(Boolean).join(" "))))),
        h("p", { class: "hint", style: { margin: 0 } }, "Drucker, Prozess und das Material der Plätze kommen aus der Vorlage. Chromalith trägt beim Export die Farben des Stapels, die Schichthöhen, 100 % Füllung und die Filamentwechsel ein."));
    }

    function render() {
      clear(body);
      targetF.set(prefs.target); modeF.set(prefs.changeMode); slotsF.set(prefs.slots);
      body.append(targetF.el);
      if (prefs.target === "prusa") {
        body.append(h("p", { class: "hint", style: { margin: 0 } },
          "PrusaSlicer übernimmt die Farbwechsel (M600) direkt aus der .3mf. Die erste Schicht und die Schichthöhe stellst du dort im Druckprofil ein; die Werte stehen nach dem Export im Hinweis."));
        return;
      }
      body.append(
        h("p", { class: "hint", style: { margin: 0 } },
          "Bambu Studio und OrcaSlicer übernehmen Filamentwechsel nur aus einem vollständigen Projekt mit Drucker, Prozess und Filamenten. Diese Einstellungen kennt nur dein Slicer. Chromalith braucht deshalb einmal ein dort gespeichertes Projekt als Vorlage."),
        prefs.template ? templateCard(prefs.template) : h("ol", { class: "hint", style: { margin: 0, paddingLeft: "18px", lineHeight: "1.7" } },
          h("li", null, "Im Slicer deinen Drucker und einen Prozess wählen."),
          h("li", null, "So viele Filamente anlegen, wie dein AMS Plätze hat (am einfachsten über die AMS-Synchronisierung), jeweils mit dem Material deiner Rollen."),
          h("li", null, "„Datei → Projekt speichern als“ wählen. Die Druckplatte darf leer sein."),
          h("li", null, "Hier diese .3mf als Vorlage wählen.")),
        h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
          button(prefs.template ? "Andere Vorlage wählen …" : "Vorlage wählen …", choose, { icon: "folder", cls: prefs.template ? "" : "primary" }),
          prefs.template ? button("Vorlage entfernen", () => { prefs.template = null; update(); }, { icon: "trash" }) : ""),
        modeF.el);
      if (!prefs.template) body.append(slotsF.el);
      if (prefs.template && prefs.changeMode === "ams" && prefs.template.filaments.length < 2)
        body.append(h("p", { class: "hint warn", style: { margin: 0 } },
          "Die Vorlage enthält nur ein Filament. Für Filamentwechsel braucht sie so viele Filamente, wie der Stapel verschiedene Farben hat. Im Slicer Filamente hinzufügen, das Projekt neu speichern und hier noch einmal wählen."));
    }
    render();
    const close = modal("Slicer und AMS", body, [button("Fertig", () => close(), { cls: "primary" })], "medium", () => resolve());
  });
}
