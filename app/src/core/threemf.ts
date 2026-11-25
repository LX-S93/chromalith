/** 3MF-Export: Modell plus Farbwechsel für PrusaSlicer sowie Bambu Studio / OrcaSlicer. */
import { filamentLabel } from "./filaments";
import { layerCount, layerTopZ, type HeightMap } from "./heightmap";
import type { Mesh } from "./mesh";
import { segments, type ColorStop } from "./plan";
import { makeZip } from "./zip";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (v: number) => (Math.round(v * 10000) / 10000).toString();

function modelXml(m: Mesh, name: string): string {
  const parts: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06">',
    '<metadata name="slic3rpe:Version3mf">1</metadata>',
    `<metadata name="Title">${esc(name)}</metadata>`,
    '<metadata name="Application">Chromalith</metadata>',
    '<resources>', `<object id="1" name="${esc(name)}" type="model">`, "<mesh>", "<vertices>"];
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
  parts.push("</triangles>", "</mesh>", "</object>", "</resources>", "<build>", '<item objectid="1" printable="1"/>', "</build>", "</model>");
  return parts.join("\n");
}

export interface ColorChange { z: number; layer: number; color: string; label: string }

export function colorChanges(hm: HeightMap, stops: ColorStop[]): ColorChange[] {
  const segs = segments(stops, hm.base_layer_mm, hm.layer_height_mm, layerCount(hm));
  return segs.slice(1).map((s) => ({
    z: layerTopZ(s.first, hm.base_layer_mm, hm.layer_height_mm), layer: s.first,
    color: s.filament.color.toUpperCase(), label: filamentLabel(s.filament),
  }));
}

export async function write3mf(m: Mesh, hm: HeightMap, stops: ColorStop[], name: string): Promise<Uint8Array> {
  const changes = colorChanges(hm, stops);
  const first = segments(stops, hm.base_layer_mm, hm.layer_height_mm, layerCount(hm))[0]?.filament;
  const prusaGcode = ['<?xml version="1.0" encoding="utf-8"?>', "<custom_gcodes_per_print_z>",
    ...changes.map((c) => `<code print_z="${num(c.z)}" type="0" extruder="1" color="${c.color}" extra="${esc(c.label)}" gcode="M600"/>`),
    '<mode value="SingleExtruder"/>', "</custom_gcodes_per_print_z>"].join("\n");
  const bambuGcode = ['<?xml version="1.0" encoding="utf-8"?>', "<custom_gcodes_per_layer>", "<plate>", '<plate_info id="1"/>',
    ...changes.map((c) => `<layer top_z="${num(c.z)}" type="0" extruder="1" color="${c.color}" extra="" gcode="M600"/>`),
    '<mode value="SingleExtruder"/>', "</plate>", "</custom_gcodes_per_layer>"].join("\n");
  const objConfig = ['<?xml version="1.0" encoding="UTF-8"?>', "<config>", '<object id="1" instances_count="1">',
    `<metadata type="object" key="name" value="${esc(name)}"/>`,
    `<metadata type="object" key="layer_height" value="${num(hm.layer_height_mm)}"/>`,
    `<volume firstid="0" lastid="${m.faces.length / 3 - 1}">`, `<metadata type="volume" key="name" value="${esc(name)}"/>`,
    '<metadata type="volume" key="volume_type" value="ModelPart"/>', '<metadata type="volume" key="extruder" value="1"/>',
    "</volume>", "</object>", "</config>"].join("\n");
  const notes = ["Chromalith – Farbwechsel", `Erste Schicht ${num(hm.base_layer_mm)} mm, weitere Schichten ${num(hm.layer_height_mm)} mm`,
    first ? `Start: ${filamentLabel(first)} (${first.color})` : "",
    ...changes.map((c) => `Schicht ${c.layer}, Z ${c.z.toFixed(2)} mm: ${c.label} (${c.color})`)].join("\n");
  return makeZip([
    { name: "[Content_Types].xml", data: '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="config" ContentType="text/plain"/><Default Extension="txt" ContentType="text/plain"/></Types>' },
    { name: "_rels/.rels", data: '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>' },
    { name: "3D/3dmodel.model", data: modelXml(m, name) },
    { name: "Metadata/Prusa_Slicer_custom_gcode_per_print_z.xml", data: prusaGcode },
    { name: "Metadata/Slic3r_PE_model.config", data: objConfig },
    { name: "Metadata/custom_gcode_per_layer.xml", data: bambuGcode },
    { name: "Metadata/chromalith_farbwechsel.txt", data: notes },
  ]);
}
