/** 3MF-Export: Modell plus Farbwechsel für Bambu Studio / OrcaSlicer (als Projekt) oder PrusaSlicer.
 *
 *  Bambu Studio / OrcaSlicer: Beide übernehmen Wechsel nur aus einem vollständigen Projekt und kennen keinen
 *  Farbwechsel-Befehl mehr, sondern nur „Filament wechseln“ (auf einen anderen Platz der Filamentliste) und
 *  „Pause“. Mit einer Vorlage (siehe slicer.ts) entsteht deshalb ein Projekt, in dem die Filamente des Stapels
 *  als Plätze 1..n stehen und jeder Wechsel ein Filamentwechsel auf den passenden Platz ist. Das AMS wechselt
 *  dann von selbst. Ohne Vorlage enthält die Datei nur das Modell.
 *
 *  PrusaSlicer: liest die Farbwechsel (M600) auch ohne Projekt-Einstellungen. */
import { filamentLabel, type Filament } from "./filaments";
import { layerCount, layerTopZ, type HeightMap } from "./heightmap";
import type { Mesh } from "./mesh";
import { segments, type ColorStop } from "./plan";
import { patchProjectSettings, planSlots, type ChangeMode, type SlicerTarget, type SlicerTemplate } from "./slicer";
import { makeZip } from "./zip";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (v: number) => (Math.round(v * 10000) / 10000).toString();

const CORE_NS = 'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"';
const NS = `${CORE_NS} xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"`;
const uuid = (n: number) => `00000000-61cb-4c03-9d28-80fed5dfa1d${n}`;
/** Kennung ohne Vorlage: Der Slicer lädt dann ohnehin nur das Modell. */
const PLAIN_APP = "BambuStudio-01.10.02.76";

function meshXml(m: Mesh): string[] {
  const parts: string[] = ["<mesh>", "<vertices>"];
  const V = m.vertices;
  let chunk: string[] = [];
  for (let i = 0; i < V.length; i += 3) {
    chunk.push(`<vertex x="${num(V[i])}" y="${num(V[i + 1])}" z="${num(V[i + 2])}"/>`);
    if (chunk.length >= 20000) { parts.push(chunk.join("")); chunk = []; }
  }
  parts.push(chunk.join("")); chunk = [];
  parts.push("</vertices>", "<triangles>");
  const F = m.faces;
  for (let i = 0; i < F.length; i += 3) {
    chunk.push(`<triangle v1="${F[i]}" v2="${F[i + 1]}" v3="${F[i + 2]}"/>`);
    if (chunk.length >= 20000) { parts.push(chunk.join("")); chunk = []; }
  }
  parts.push(chunk.join(""));
  parts.push("</triangles>", "</mesh>");
  return parts;
}

/** Netz als eigene Objektdatei (Aufbau wie in Bambu Studio / OrcaSlicer). */
function objectXml(m: Mesh): string {
  return ['<?xml version="1.0" encoding="UTF-8"?>',
    `<model unit="millimeter" xml:lang="en-US" ${NS} requiredextensions="p">`,
    '<metadata name="BambuStudio:3mfVersion">1</metadata>', "<resources>",
    `<object id="1" p:UUID="${uuid(1)}" type="model">`, ...meshXml(m), "</object>", "</resources>", "<build/>", "</model>"].join("\n");
}

function mainXml(name: string, tx: number, ty: number, app: string): string {
  return ['<?xml version="1.0" encoding="UTF-8"?>',
    `<model unit="millimeter" xml:lang="en-US" ${NS} requiredextensions="p">`,
    `<metadata name="Application">${esc(app)}</metadata>`,
    '<metadata name="BambuStudio:3mfVersion">1</metadata>',
    `<metadata name="Title">${esc(name)}</metadata>`,
    '<metadata name="Designer">Chromalith</metadata>',
    "<resources>",
    `<object id="2" p:UUID="${uuid(2)}" type="model">`,
    `<components><component p:path="/3D/Objects/object_1.model" objectid="1" p:UUID="${uuid(3)}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></components>`,
    "</object>", "</resources>",
    `<build p:UUID="${uuid(4)}">`,
    `<item objectid="2" p:UUID="${uuid(5)}" transform="1 0 0 0 1 0 0 0 1 ${num(tx)} ${num(ty)} 0" printable="1"/>`,
    "</build>", "</model>"].join("\n");
}

/** Einfache 3MF nach dem Kernstandard: ein Objekt mit Netz in der Hauptdatei (PrusaSlicer). */
function plainXml(m: Mesh, name: string): string {
  return ['<?xml version="1.0" encoding="UTF-8"?>',
    `<model unit="millimeter" xml:lang="en-US" ${CORE_NS}>`,
    `<metadata name="Title">${esc(name)}</metadata>`,
    '<metadata name="Application">Chromalith</metadata>',
    "<resources>", `<object id="1" name="${esc(name)}" type="model">`, ...meshXml(m), "</object>", "</resources>",
    '<build><item objectid="1"/></build>', "</model>"].join("\n");
}

export interface ColorChange { z: number; layer: number; color: string; label: string; filament: Filament }

/** Wechsel des Stapels: je Wechsel die Oberkante der ersten Schicht in der neuen Farbe. */
export function colorChanges(hm: HeightMap, stops: ColorStop[]): ColorChange[] {
  const segs = segments(stops, hm.base_layer_mm, hm.layer_height_mm, layerCount(hm));
  return segs.slice(1).map((s) => ({
    z: layerTopZ(s.first, hm.base_layer_mm, hm.layer_height_mm), layer: s.first,
    color: s.filament.color.toUpperCase(), label: filamentLabel(s.filament), filament: s.filament,
  }));
}

export interface ThreeMfOptions {
  target?: SlicerTarget;
  /** Vorlage aus dem eigenen Slicer (nur Bambu Studio / OrcaSlicer) */
  template?: SlicerTemplate | null;
  changeMode?: ChangeMode;
  /** Text für die Pause, Platzhalter {} = Name des Filaments */
  pauseText?: string;
}

export interface ThreeMfInfo {
  target: SlicerTarget;
  /** Wie die Wechsel in der Datei stehen. "none": gar nicht (Grund in `reason`) */
  changes: "ams" | "pause" | "m600" | "none";
  reason?: "no_template" | "too_many";
  /** Drucker, Prozess, Filamentfarben und Schichthöhen stehen in der Datei */
  project: boolean;
  /** Verschiedene Filamente des Stapels mit ihrem Platz; `type` = Material des Platzes in der Vorlage */
  slots: { slot: number; filament: Filament; type?: string }[];
  /** Filamente (Plätze) der Vorlage, 0 ohne Vorlage */
  available: number;
  changeCount: number;
}

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="config" ContentType="text/plain"/><Default Extension="txt" ContentType="text/plain"/></Types>';
const RELS = '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>';

export async function write3mf(m: Mesh, hm: HeightMap, stops: ColorStop[], name: string, opt: ThreeMfOptions = {}): Promise<{ data: Uint8Array; info: ThreeMfInfo }> {
  const target = opt.target ?? "bambu";
  const segs = segments(stops, hm.base_layer_mm, hm.layer_height_mm, layerCount(hm));
  const changes = colorChanges(hm, stops);
  const plan = planSlots(segs);
  const tpl = target === "bambu" ? opt.template ?? null : null;
  const first = segs[0]?.filament;
  const notes = ["Chromalith – Farbwechsel", `Erste Schicht ${num(hm.base_layer_mm)} mm, weitere Schichten ${num(hm.layer_height_mm)} mm`,
    first ? `Start: ${filamentLabel(first)} (${first.color})` : "",
    ...changes.map((c) => `Schicht ${c.layer}, Z ${c.z.toFixed(2)} mm: ${c.label} (${c.color})`)].join("\n");
  const info: ThreeMfInfo = {
    target, changes: "none", project: false, available: tpl?.filaments.length ?? 0, changeCount: changes.length,
    slots: plan.filaments.map((f, i) => ({ slot: i + 1, filament: f, type: tpl?.filaments[i]?.type || undefined })),
  };

  if (target === "prusa") {
    // PrusaSlicer: Farbwechsel (M600) je Schicht; die Schichthöhen stellt man dort im Druckprofil ein
    const gcode = ['<?xml version="1.0" encoding="utf-8"?>', "<custom_gcodes_per_print_z>",
      ...changes.map((c) => `<code print_z="${num(c.z)}" type="0" extruder="1" color="${c.color}" extra="" gcode="M600"/>`),
      '<mode value="SingleExtruder"/>', "</custom_gcodes_per_print_z>"].join("\n");
    if (changes.length) info.changes = "m600";
    const data = await makeZip([
      { name: "[Content_Types].xml", data: CONTENT_TYPES }, { name: "_rels/.rels", data: RELS },
      { name: "3D/3dmodel.model", data: plainXml(m, name) },
      ...(changes.length ? [{ name: "Metadata/Prusa_Slicer_custom_gcode_per_print_z.xml", data: gcode }] : []),
      { name: "Metadata/chromalith_farbwechsel.txt", data: notes },
    ]);
    return { data, info };
  }

  const [w, d] = [(hm.width - 1) * hm.pixel_size_mm, (hm.height - 1) * hm.pixel_size_mm];
  const bed = tpl?.bed ?? [128, 128];
  const tx = bed[0] - w / 2, ty = bed[1] - d / 2;
  const nTri = m.faces.length / 3;

  // Wechsel: nur mit Vorlage, und als Filamentwechsel nur, wenn die Vorlage genug Plätze hat
  const mode: ChangeMode = opt.changeMode ?? "ams";
  let layers: string[] = [], modeTag = "MultiAsSingle";
  if (changes.length && !tpl) info.reason = "no_template";
  else if (changes.length && mode === "ams" && plan.filaments.length > tpl!.filaments.length) info.reason = "too_many";
  else if (changes.length && mode === "ams") {
    // Filamentwechsel auf den Platz des neuen Filaments; gilt ab der Schicht, deren Oberkante top_z ist
    layers = changes.map((c, i) => `<layer top_z="${num(c.z)}" type="2" extruder="${plan.slot[i + 1]}" color="${c.color}" extra="" gcode="tool_change"/>`);
    info.changes = "ams";
  } else if (changes.length) {
    // Pause vor der Schicht: Der Drucker hält an, das Filament wird von Hand gewechselt
    const text = opt.pauseText ?? "Filament wechseln: {}";
    layers = changes.map((c) => `<layer top_z="${num(c.z)}" type="1" extruder="1" color="" extra="${esc(text.replace("{}", c.label))}" gcode="${esc(tpl!.pause)}"/>`);
    modeTag = tpl!.filaments.length > 1 ? "MultiAsSingle" : "SingleExtruder";
    info.changes = "pause";
  }
  const gcode = ['<?xml version="1.0" encoding="utf-8"?>', "<custom_gcodes_per_layer>", "<plate>", '<plate_info id="1"/>',
    ...layers, `<mode value="${modeTag}"/>`, "</plate>", "</custom_gcodes_per_layer>"].join("\n");

  // Projekt-Einstellungen: bei Filamentwechseln bekommen die Plätze die Farben des Stapels, sonst nur Platz 1
  let project: string | null = null;
  if (tpl) {
    const colors: (string | null)[] = tpl.filaments.map(() => null);
    if (info.changes === "ams") plan.filaments.forEach((f, i) => (colors[i] = f.color));
    else if (first) colors[0] = first.color;
    project = patchProjectSettings(tpl.settings, { colors, layerHeight: hm.layer_height_mm, firstLayer: hm.base_layer_mm });
    info.project = true;
  }

  const settings = ['<?xml version="1.0" encoding="UTF-8"?>', "<config>",
    '<object id="2">',
    `<metadata key="name" value="${esc(name)}"/>`,
    '<metadata key="extruder" value="1"/>',
    ...(tpl ? [] : [`<metadata key="layer_height" value="${num(hm.layer_height_mm)}"/>`]),
    `<metadata face_count="${nTri}"/>`,
    '<part id="1" subtype="normal_part">',
    `<metadata key="name" value="${esc(name)}"/>`,
    '<metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>',
    `<mesh_stat face_count="${nTri}" edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/>`,
    "</part>", "</object>",
    "<plate>", '<metadata key="plater_id" value="1"/>', '<metadata key="plater_name" value=""/>', '<metadata key="locked" value="false"/>',
    "<model_instance>", '<metadata key="object_id" value="2"/>', '<metadata key="instance_id" value="0"/>', '<metadata key="identify_id" value="1"/>', "</model_instance>",
    "</plate>",
    "<assemble>", `<assemble_item object_id="2" instance_id="0" transform="1 0 0 0 1 0 0 0 1 ${num(tx)} ${num(ty)} 0" offset="0 0 0"/>`, "</assemble>",
    "</config>"].join("\n");
  const data = await makeZip([
    { name: "[Content_Types].xml", data: CONTENT_TYPES }, { name: "_rels/.rels", data: RELS },
    { name: "3D/3dmodel.model", data: mainXml(name, tx, ty, tpl?.app ?? PLAIN_APP) },
    { name: "3D/_rels/3dmodel.model.rels", data: '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/Objects/object_1.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>' },
    { name: "3D/Objects/object_1.model", data: objectXml(m) },
    { name: "Metadata/model_settings.config", data: settings },
    ...(project ? [{ name: "Metadata/project_settings.config", data: project }, ...tpl!.presets.filter((p) => !/project_settings\.config$/i.test(p.name))] : []),
    ...(layers.length ? [{ name: "Metadata/custom_gcode_per_layer.xml", data: gcode }] : []),
    { name: "Metadata/chromalith_farbwechsel.txt", data: notes },
  ]);
  return { data, info };
}
