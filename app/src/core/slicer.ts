/** Anbindung an den Slicer: Vorlage (ein vom Slicer gespeichertes Projekt), Plätze für die Filamente und
 *  die Anpassung der Projekt-Einstellungen für den 3MF-Export.
 *
 *  Warum eine Vorlage? Bambu Studio und OrcaSlicer übernehmen Filamentwechsel aus einer .3mf nur, wenn die
 *  Datei ein vollständiges Projekt ist (Drucker, Prozess, Filamente). Fehlen die Einstellungen, laden sie nur
 *  die Geometrie. Die Einstellungen eines Druckers kennt nur der Slicer selbst, deshalb liest Chromalith sie
 *  aus einem Projekt, das der Nutzer einmal in seinem Slicer gespeichert hat, und ändert darin nur, was zum
 *  Druck gehört: Filamentfarben, Schichthöhen, Füllung und Spülmengen. */
import { hexToRgb, labOf } from "./color";
import { filamentKey, type Filament } from "./filaments";
import { readZip } from "./zip";

export type SlicerTarget = "bambu" | "prusa";
export const SLICER_TARGETS: Record<SlicerTarget, string> = { bambu: "Bambu Studio / OrcaSlicer", prusa: "PrusaSlicer" };

/** Wie ein Farbwechsel in der 3MF steht: als Filamentwechsel (AMS wechselt selbst) oder als Pause zum Wechseln von Hand. */
export type ChangeMode = "ams" | "pause";
export const CHANGE_MODES: Record<ChangeMode, string> = { ams: "AMS wechselt automatisch", pause: "Pause, Wechsel von Hand" };

export interface TemplateFilament { name: string; type: string; color: string }

export interface SlicerTemplate {
  /** Kennung des Programms, das die Vorlage geschrieben hat (steht so in der Vorlage) */
  app: string;
  /** Dateiname der Vorlage, nur zur Anzeige */
  source: string;
  /** Projekt-Einstellungen der Vorlage (JSON-Text, unverändert) */
  settings: string;
  /** Eigene Profile, die der Slicer ins Projekt gelegt hat (unverändert übernommen) */
  presets: { name: string; data: string }[];
  printer: string;
  process: string;
  filaments: TemplateFilament[];
  /** Mitte des Druckbetts in mm */
  bed: [number, number];
  /** Pausen-Befehl des Druckers */
  pause: string;
}

const SETTINGS_FILE = "metadata/project_settings.config";
const MODEL_FILE = "3d/3dmodel.model";
const PRESET_FILE = /^metadata\/(print_setting_|process_settings_|filament_settings_|machine_settings_)[^/]*$/;
const APP_PREFIX = /^(BambuStudio|OrcaSlicer)-/;

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)) : typeof v === "string" && v ? [v] : []);
const fmt = (v: number) => (Math.round(v * 10000) / 10000).toString();
const hex6 = (c: string) => { const m = /^#?([0-9a-fA-F]{6})/.exec(c.trim()); return m ? "#" + m[1].toUpperCase() : "#808080"; };

function bedCenter(area: unknown): [number, number] {
  const pts = list(area).map((p) => p.split("x").map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite));
  if (pts.length < 3) return [128, 128];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

/** Liest eine Vorlage aus einem Projekt, das in Bambu Studio oder OrcaSlicer gespeichert wurde. */
export async function readSlicerTemplate(bytes: Uint8Array, source: string): Promise<SlicerTemplate> {
  const files = await readZip(bytes, (n) => { const l = n.toLowerCase(); return l === SETTINGS_FILE || l === MODEL_FILE || PRESET_FILE.test(l); });
  const dec = new TextDecoder();
  let settings = "", model = "";
  const presets: SlicerTemplate["presets"] = [];
  for (const [name, data] of files) {
    const l = name.toLowerCase();
    if (l === SETTINGS_FILE) settings = dec.decode(data);
    else if (l === MODEL_FILE) model = dec.decode(data.subarray(0, 20000));
    else presets.push({ name, data: dec.decode(data) });
  }
  const app = /<metadata\s+name="Application"\s*>([^<]+)<\/metadata>/.exec(model)?.[1].trim() ?? "";
  if (!settings || !APP_PREFIX.test(app))
    throw new Error("Diese Datei ist kein gespeichertes Projekt aus Bambu Studio oder OrcaSlicer. Im Slicer „Datei → Projekt speichern als“ wählen und die so gespeicherte .3mf nehmen.");
  let cfg: any;
  try { cfg = JSON.parse(settings); } catch { throw new Error("Die Projekt-Einstellungen der Vorlage sind nicht lesbar."); }
  const colors = list(cfg?.filament_colour);
  if (!colors.length) throw new Error("Die Vorlage enthält keine Filamente.");
  const names = list(cfg.filament_settings_id), types = list(cfg.filament_type);
  return {
    app, source, settings, presets,
    printer: String(cfg.printer_settings_id ?? ""), process: String(cfg.print_settings_id ?? ""),
    filaments: colors.map((c, i) => ({ name: names[i] ?? "", type: types[i] ?? "", color: hex6(c) })),
    bed: bedCenter(cfg.printable_area),
    pause: typeof cfg.machine_pause_gcode === "string" && cfg.machine_pause_gcode.trim() ? cfg.machine_pause_gcode : "M400 U1",
  };
}

/** Prüft gespeicherte Vorlagen-Daten (z. B. aus dem lokalen Speicher). */
export function validTemplate(t: any): t is SlicerTemplate {
  return !!t && typeof t.app === "string" && APP_PREFIX.test(t.app) && typeof t.settings === "string" && Array.isArray(t.filaments) && t.filaments.length > 0
    && Array.isArray(t.presets) && Array.isArray(t.bed);
}

export interface SlotPlan {
  /** Verschiedene Filamente in der Reihenfolge ihres ersten Einsatzes: Index + 1 = Platz */
  filaments: Filament[];
  /** Platz (1-basiert) je Abschnitt des Stapels */
  slot: number[];
}

/** Weist jedem Filament des Stapels einen Platz zu. Dasselbe Filament an mehreren Stellen belegt nur einen Platz. */
export function planSlots(segs: { filament: Filament }[]): SlotPlan {
  const keys: string[] = [], filaments: Filament[] = [], slot: number[] = [];
  for (const s of segs) {
    const k = filamentKey(s.filament);
    let i = keys.indexOf(k);
    if (i < 0) { i = keys.length; keys.push(k); filaments.push(s.filament); }
    slot.push(i + 1);
  }
  return { filaments, slot };
}

/** Geschätzte Spülmenge in mm³ beim Wechsel von einer Farbe zur nächsten. Eigene, bewusst großzügige Schätzung:
 *  Am meisten braucht der Wechsel zu einer helleren Farbe, dazu kommt der Abstand im Farbton. Zu wenig gespült
 *  zeigt sich als Schlieren der alten Farbe am Anfang der neuen Schicht; zu viel kostet nur etwas Filament. */
export function flushVolume(fromHex: string, toHex: string): number {
  const a = labOf(hexToRgb(hex6(fromHex))), b = labOf(hexToRgb(hex6(toHex)));
  const lighter = Math.max(0, b[0] - a[0]), hue = Math.hypot(b[1] - a[1], b[2] - a[2]);
  return Math.round(Math.min(800, 150 + 5.5 * lighter + 1.5 * hue) / 10) * 10;
}

/** Füllmuster, die der Slicer bei 100 % Füllung annimmt */
const SOLID_PATTERNS = ["concentric", "zig-zag", "monotonic", "monotonicline", "alignedrectilinear", "hilbertcurve", "archimedeanchords", "octagramspiral"];

export interface ProjectPatch {
  /** Neue Farbe je Platz (Index 0 = Platz 1); null oder fehlend = Farbe der Vorlage behalten */
  colors: (string | null)[];
  layerHeight: number;
  firstLayer: number;
}

/** Trägt Filamentfarben, Schichthöhen, 100 % Füllung und Spülmengen in die Projekt-Einstellungen der Vorlage ein.
 *  Alles andere (Drucker, Düse, Temperaturen, Geschwindigkeiten) bleibt, wie der Slicer es gespeichert hat. */
export function patchProjectSettings(settings: string, patch: ProjectPatch): string {
  const cfg = JSON.parse(settings);
  const cur = list(cfg.filament_colour), n = cur.length;
  if (!n) throw new Error("Die Vorlage enthält keine Filamente.");
  const next = cur.map((c, i) => (patch.colors[i] ? hex6(patch.colors[i]!) : hex6(c)));
  const changed = cur.map((_, i) => !!patch.colors[i]);
  // Schreibweise der Vorlage beibehalten (mit oder ohne Deckkraft am Ende)
  cfg.filament_colour = cur.map((c, i) => (changed[i] ? next[i] + (c.trim().length === 9 ? "FF" : "") : c));
  if (Array.isArray(cfg.filament_multi_colour)) cfg.filament_multi_colour = cfg.filament_multi_colour.map((c: string, i: number) => (changed[i] ? cfg.filament_colour[i] : c));
  if (Array.isArray(cfg.filament_colour_type)) cfg.filament_colour_type = cfg.filament_colour_type.map((c: string, i: number) => (changed[i] ? "1" : c));

  cfg.layer_height = fmt(patch.layerHeight);
  cfg.initial_layer_print_height = fmt(patch.firstLayer);
  // Der Slicer übernimmt aus dem Projekt nur die Werte, die als „abweichend vom Profil“ vermerkt sind; die übrigen
  // nimmt er aus seinem eigenen Profil. Erster Eintrag der Liste = Prozess.
  const diff = Array.isArray(cfg.different_settings_to_system) ? cfg.different_settings_to_system.map((x: unknown) => String(x ?? "")) : [];
  while (diff.length < n + 2) diff.push("");
  const keys = new Set(diff[0].split(";").filter(Boolean));
  keys.add("layer_height"); keys.add("initial_layer_print_height");
  // Ein Relief wird massiv gedruckt, sonst stimmen die Farben nicht: 100 % Füllung. Muster, die der Slicer bei
  // 100 % ablehnt, werden auf gerade Linien umgestellt.
  cfg.sparse_infill_density = "100%"; keys.add("sparse_infill_density");
  if (!SOLID_PATTERNS.includes(String(cfg.sparse_infill_pattern ?? ""))) { cfg.sparse_infill_pattern = "zig-zag"; keys.add("sparse_infill_pattern"); }
  diff[0] = [...keys].join(";");
  cfg.different_settings_to_system = diff;

  // Spülmengen: Tabelle „von Platz i nach Platz j“, je Düse ein Block. Nur Paare mit geänderter Farbe neu schätzen.
  const mat = cfg.flush_volumes_matrix, nozzles = Math.max(1, list(cfg.nozzle_diameter).length);
  if (Array.isArray(mat) && mat.length === nozzles * n * n)
    for (let b = 0; b < nozzles; b++)
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++)
          if (i !== j && (changed[i] || changed[j])) mat[b * n * n + i * n + j] = String(flushVolume(next[i], next[j]));
  return JSON.stringify(cfg, null, 4);
}
