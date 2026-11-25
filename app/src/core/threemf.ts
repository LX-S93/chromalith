/** 3MF-Export: Modell plus Farbwechsel für PrusaSlicer sowie Bambu Studio / OrcaSlicer. */
import { filamentLabel } from "./filaments";
import { layerCount, layerTopZ, type HeightMap } from "./heightmap";
import type { Mesh } from "./mesh";
import { segments, type ColorStop } from "./plan";
import { makeZip } from "./zip";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (v: number) => (Math.round(v * 10000) / 10000).toString();

const NS = 'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"';
const uuid = (n: number) => `00000000-61cb-4c03-9d28-80fed5dfa1d${n}`;

/** Netz als eigene Objektdatei (Aufbau wie in Bambu Studio / OrcaSlicer). */
function objectXml(m: Mesh): string {
  const parts: string[] = ['<?xml version="1.0" encoding="UTF-8"?>',
    `<model unit="millimeter" xml:lang="en-US" ${NS} requiredextensions="p">`,
    '<metadata name="BambuStudio:3mfVersion">1</metadata>', "<resources>",
    `<object id="1" p:UUID="${uuid(1)}" type="model">`, "<mesh>", "<vertices>"];
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
  parts.push("</triangles>", "</mesh>", "</object>", "</resources>", "<build/>", "</model>");
  return parts.join("\n");
}

function mainXml(name: string, tx: number, ty: number): string {
  return ['<?xml version="1.0" encoding="UTF-8"?>',
    `<model unit="millimeter" xml:lang="en-US" ${NS} requiredextensions="p">`,
    '<metadata name="Application">BambuStudio-01.10.02.76</metadata>',
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

export interface ColorChange { z: number; layer: number; color: string; label: string }

export function colorChanges(hm: HeightMap, stops: ColorStop[]): ColorChange[] {
  const segs = segments(stops, hm.base_layer_mm, hm.layer_height_mm, layerCount(hm));
  return segs.slice(1).map((s) => ({
    z: layerTopZ(s.first, hm.base_layer_mm, hm.layer_height_mm), layer: s.first,
    color: s.filament.color.toUpperCase(), label: filamentLabel(s.filament),
  }));
}

export async function write3mf(m: Mesh, hm: HeightMap, stops: ColorStop[], name: string, bedCenter: [number, number] = [128, 128]): Promise<Uint8Array> {
  const changes = colorChanges(hm, stops);
  const first = segments(stops, hm.base_layer_mm, hm.layer_height_mm, layerCount(hm))[0]?.filament;
  const [w, d] = [(hm.width - 1) * hm.pixel_size_mm, (hm.height - 1) * hm.pixel_size_mm];
  const tx = bedCenter[0] - w / 2, ty = bedCenter[1] - d / 2;
  const nTri = m.faces.length / 3;
  // Farbwechsel (Bambu Studio / OrcaSlicer): je Wechsel die Oberkante der ersten Schicht in neuer Farbe
  const gcode = ['<?xml version="1.0" encoding="utf-8"?>', "<custom_gcodes_per_layer>", "<plate>", '<plate_info id="1"/>',
    ...changes.map((c) => `<layer top_z="${num(c.z)}" type="0" extruder="1" color="${c.color}" extra="" gcode="M600"/>`),
    '<mode value="SingleExtruder"/>', "</plate>", "</custom_gcodes_per_layer>"].join("\n");
  const settings = ['<?xml version="1.0" encoding="UTF-8"?>', "<config>",
    '<object id="2">',
    `<metadata key="name" value="${esc(name)}"/>`,
    '<metadata key="extruder" value="1"/>',
    `<metadata key="layer_height" value="${num(hm.layer_height_mm)}"/>`,
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
  const notes = ["Chromalith – Farbwechsel", `Erste Schicht ${num(hm.base_layer_mm)} mm, weitere Schichten ${num(hm.layer_height_mm)} mm`,
    first ? `Start: ${filamentLabel(first)} (${first.color})` : "",
    ...changes.map((c) => `Schicht ${c.layer}, Z ${c.z.toFixed(2)} mm: ${c.label} (${c.color})`)].join("\n");
  return makeZip([
    { name: "[Content_Types].xml", data: '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="config" ContentType="text/plain"/><Default Extension="txt" ContentType="text/plain"/></Types>' },
    { name: "_rels/.rels", data: '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>' },
    { name: "3D/3dmodel.model", data: mainXml(name, tx, ty) },
    { name: "3D/_rels/3dmodel.model.rels", data: '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/Objects/object_1.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>' },
    { name: "3D/Objects/object_1.model", data: objectXml(m) },
    { name: "Metadata/model_settings.config", data: settings },
    { name: "Metadata/custom_gcode_per_layer.xml", data: gcode },
    { name: "Metadata/chromalith_farbwechsel.txt", data: notes },
  ]);
}
