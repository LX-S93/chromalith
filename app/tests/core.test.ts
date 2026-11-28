import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS, autoDistribute, autoPlan, buildHeightmap, buildProject, effectiveMode, filamentUsage, heightmapToMesh,
  imagePalette, layerCount, makeFilament, meshVolume, nearestFilament, parseFilaments, parseProject, planReport,
  segments, serializeProject, simulate, sizeMm, starterLibrary, writeStl, type HeightSettings, type Project, type Raster,
} from "../src/core";

function gradient(w = 64, h = 32): Raster {
  const data = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = x / (w - 1), i = (y * w + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 1;
  }
  return { width: w, height: h, data };
}
const S = (o: Partial<HeightSettings> = {}): HeightSettings => ({ ...DEFAULT_SETTINGS, width_mm: 20, pixel_size_mm: 0.5, ...o });
const WHITE = makeFilament({ id: "w", name: "Weiß", color: "#ffffff", td: 4 });
const BLACK = makeFilament({ id: "k", name: "Schwarz", color: "#000000", td: 0.5 });
const RED = makeFilament({ id: "r", name: "Rot", color: "#ff0000", td: 2 });
const GREY = makeFilament({ id: "g", name: "Grau", color: "#808080", td: 1.5 });

function watertight(faces: Uint32Array) {
  const e = new Map<string, number>();
  for (let i = 0; i < faces.length; i += 3)
    for (const [a, b] of [[faces[i], faces[i + 1]], [faces[i + 1], faces[i + 2]], [faces[i + 2], faces[i]]])
      e.set(`${a},${b}`, (e.get(`${a},${b}`) ?? 0) + 1);
  for (const [k, n] of e) { const [a, b] = k.split(","); if (n !== 1 || e.get(`${b},${a}`) !== 1) return false; }
  return true;
}

describe("Höhenkarte", () => {
  it("quantisiert und Richtung stimmt", () => {
    const s = S();
    const hm = buildHeightmap(gradient(), s, { mode: "bright_high" });
    for (const h of hm.heights) { const k = (h - s.base_layer_mm) / s.layer_height_mm; expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-3); }
    expect(hm.heights[hm.width - 1]).toBeGreaterThan(hm.heights[0]);
    const dk = buildHeightmap(gradient(), s, { mode: "dark_high" });
    expect(dk.heights[dk.width - 1]).toBeLessThan(dk.heights[0]);
  });
  it("Rahmen vergrößert das Modell", () => {
    const hm = buildHeightmap(gradient(), S({ border_mm: 2 }), { mode: "bright_high" });
    expect(sizeMm(hm)[0]).toBeCloseTo(24, 1);
  });
});

describe("Netz", () => {
  it("rechteckig: geschlossen, Volumen passt", () => {
    const hm = buildHeightmap(gradient(30, 20), S({ width_mm: 10 }), { mode: "bright_high" });
    const m = heightmapToMesh(hm);
    expect(watertight(m.faces)).toBe(true);
    const [w, d] = sizeMm(hm);
    const mean = hm.heights.reduce((a, b) => a + b, 0) / hm.heights.length;
    expect(meshVolume(m)).toBeGreaterThan(0);
    expect(Math.abs(meshVolume(m) / (mean * w * d) - 1)).toBeLessThan(0.05);
    expect(writeStl(m).length).toBe(84 + (m.faces.length / 3) * 50);
  });
  it("rund mit Loch, Rand und Ziffern: geschlossen", () => {
    const s = S({ width_mm: 40, shape: "circle", hole_mm: 8, rim_mm: 2, clock_numbers: true, numbers_mm: 5 });
    const digits = (w: number, h: number) => { const m = new Uint8Array(w * h); m[Math.floor(h / 2) * w + 5] = 1; return m; };
    const hm = buildHeightmap(gradient(80, 60), s, { mode: "bright_high", renderDigits: digits });
    expect(hm.mask).not.toBeNull();
    expect(hm.mask![Math.floor(hm.height / 2) * hm.width + Math.floor(hm.width / 2)]).toBe(0);
    expect(watertight(heightmapToMesh(hm).faces)).toBe(true);
  });
});

describe("Plan und Simulation", () => {
  it("Segmente lückenlos, dunkel = hoch dunkler", () => {
    const hm = buildHeightmap(gradient(), S(), { mode: "dark_high" });
    const plan = autoPlan([WHITE, RED, BLACK], hm);
    const segs = segments(plan, hm.base_layer_mm, hm.layer_height_mm, layerCount(hm));
    expect(segs.map((s) => s.filament.id)).toEqual(["w", "r", "k"]);
    for (let i = 1; i < segs.length; i++) expect(segs[i].first).toBe(segs[i - 1].last + 1);
    const rgb = simulate(hm, plan);
    expect(rgb[0]).toBeLessThan(rgb[(hm.width - 1) * 3]);
    expect(planReport(hm, plan)).toContain("Wechsel vor Schicht");
  });
  it("farbtreu trifft Rot und Gelb", () => {
    const w = 80, h = 40, data = new Float32Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const left = i % w < 40;
      data.set(left ? [200 / 255, 30 / 255, 30 / 255, 1] : [240 / 255, 220 / 255, 20 / 255, 1], i * 4);
    }
    const yellow = makeFilament({ id: "y", name: "Gelb", color: "#f5d10f", td: 5 });
    const p: Project = { name: "t", image: { width: w, height: h, data }, imagePng: null, settings: S({ width_mm: 16, pixel_size_mm: 0.2 }),
      stops: [WHITE, yellow, RED].map((f) => ({ filament: f, start_layer: 1 })) };
    expect(effectiveMode(p)).toBe("color");
    p.stops = autoDistribute(p);
    const hm = buildProject(p);
    const rgb = simulate(hm, p.stops);
    const px = (x: number) => [0, 1, 2].map((c) => rgb[(20 * hm.width + x) * 3 + c]);
    const l = px(10), r = px(hm.width - 10);
    expect(l[0]).toBeGreaterThan(l[1] + 0.2);
    expect(r[0]).toBeGreaterThan(0.5); expect(r[1]).toBeGreaterThan(0.5);
  });
  it("Grau-Stapel: Helligkeitsmodus automatisch", () => {
    const p: Project = { name: "t", image: gradient(), imagePng: null, settings: S(), stops: [WHITE, GREY, BLACK].map((f) => ({ filament: f, start_layer: 1 })) };
    expect(effectiveMode(p)).toBe("dark_high");
  });
});

describe("Filamente, Analyse, Projekt", () => {
  it("Fremdschema importieren", () => {
    const f = parseFilaments({ filaments: [{ Brand: "X", Color: "#ff0000", Name: "Rot", Owned: true, Transmissivity: 2.5, Type: "PETG", uuid: "{abc}" }] })[0];
    expect([f.name, f.td, f.material, f.owned, f.id]).toEqual(["Rot", 2.5, "PETG", true, "abc"]);
    expect(starterLibrary().length).toBeGreaterThan(10);
  });
  it("Analyse summiert auf 1", () => {
    const hm = buildHeightmap(gradient(), S(), { mode: "bright_high" });
    const pal = imagePalette(hm.rgb, 4);
    expect(pal.reduce((a, b) => a + b.share, 0)).toBeCloseTo(1, 6);
    expect(nearestFilament("#fe0101", [WHITE, BLACK, RED]).filament!.id).toBe("r");
    const use = filamentUsage(hm, autoPlan([BLACK, WHITE], hm));
    expect(use.reduce((a, b) => a + b.share, 0)).toBeCloseTo(1, 6);
  });
  it("Projekt speichern/laden", () => {
    const p: Project = { name: "t", image: null, imagePng: new Uint8Array([137, 80, 78, 71, 1, 2, 3]), settings: S({ shape: "circle" }),
      stops: [{ filament: WHITE, start_layer: 1 }, { filament: BLACK, start_layer: 7 }] };
    const q = parseProject(serializeProject(p));
    expect(q.settings.shape).toBe("circle");
    expect(q.stops.map((s) => [s.filament.id, s.start_layer])).toEqual([["w", 1], ["k", 7]]);
    expect(Array.from(q.imagePng!)).toEqual(Array.from(p.imagePng!));
  });
  it("alte Python-Projekte (ohne neue Felder) laden", () => {
    const q = parseProject(JSON.stringify({ format: "chromalith-project", version: 1, name: "alt", settings: { width_mm: 120 }, plan: [], image_png: null }));
    expect(q.settings.width_mm).toBe(120);
    expect(q.settings.shape).toBe("rect");
  });
});

import { mergeFilaments, parseFilamentFiles } from "../src/core";
it("Ordner-Import: mehrere Dateien, Duplikate werden zusammengeführt", () => {
  const a = { name: "a.json", text: JSON.stringify({ Filaments: [
    { Brand: "X", Name: "Rot", Type: "PLA", Color: "#ff0000", Transmissivity: 2.5, uuid: "{1}" },
    { Brand: "X", Name: "Weiß", Type: "PLA", Color: "#FFFFFF", Transmissivity: 5, uuid: "{2}" }] }) };
  const b = { name: "set.fss", text: "﻿" + JSON.stringify({ filaments: [{ Brand: "X", Name: "Rot", Type: "PLA", Color: "#ff0000", Transmissivity: 2.5, uuid: "{1}" }] }) };
  const c = { name: "defaults.json", text: JSON.stringify({ something: 1 }) };
  const { filaments, used } = parseFilamentFiles([a, b, c, { name: "kaputt.json", text: "{" }]);
  expect(used).toEqual(["a.json", "set.fss"]);
  const lib = [makeFilament({ name: "Weiß", brand: "X", material: "PLA", color: "#ffffff", td: 4 })];
  const r = mergeFilaments(lib, filaments);
  expect(r).toEqual({ added: 1, duplicates: 2 });
  expect(lib.find((f) => f.name === "Rot")!.td).toBe(2.5);
});

import { suggestFilaments, labSample, starterLibrary as lib0 } from "../src/core";
it("Filament-Vorschlag trifft ein rot-blaues Bild mit roten und blauen Filamenten", () => {
  const w = 40, h = 20, rgb = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3, t = y / (h - 1);
    if (x < w / 2) { rgb[i] = 0.85 * (1 - t) + 0.1 * t; rgb[i + 1] = 0.1; rgb[i + 2] = 0.1; }
    else { rgb[i] = 0.1; rgb[i + 1] = 0.15; rgb[i + 2] = 0.8 * (1 - t) + 0.1 * t; }
  }
  const lab = labSample(rgb, w, h, 40);
  const r = suggestFilaments(lab, rgb, lib0(), { count: 4, base: 0.16, step: 0.08, minH: 0.48, maxH: 2.24 })!;
  expect(r.stops).toHaveLength(4);
  const names = r.stops.map((s) => s.filament.name).join(",");
  expect(names).toMatch(/Rot/);
  expect(names).toMatch(/Blau/);
  expect(r.error).toBeLessThan(30);
});

import { write3mf, colorChanges, crc32, normalizeSettings, fromRGBA8 } from "../src/core";

async function unzip(z: Uint8Array): Promise<Map<string, string>> {
  const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
  let e = z.length - 22;
  while (dv.getUint32(e, true) !== 0x06054b50) e--;
  const n = dv.getUint16(e + 10, true);
  let o = dv.getUint32(e + 16, true);
  const out = new Map<string, string>();
  for (let k = 0; k < n; k++) {
    expect(dv.getUint32(o, true)).toBe(0x02014b50);
    const method = dv.getUint16(o + 10, true), crc = dv.getUint32(o + 16, true), csize = dv.getUint32(o + 20, true);
    const nl = dv.getUint16(o + 28, true), lo = dv.getUint32(o + 42, true);
    const name = new TextDecoder().decode(z.subarray(o + 46, o + 46 + nl));
    const lnl = dv.getUint16(lo + 26, true), lel = dv.getUint16(lo + 28, true);
    const body = z.subarray(lo + 30 + lnl + lel, lo + 30 + lnl + lel + csize);
    const raw = method === 8
      ? new Uint8Array(await new Response(new Blob([body as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer())
      : body;
    expect(crc32(raw)).toBe(crc);
    out.set(name, new TextDecoder().decode(raw));
    o += 46 + nl + dv.getUint16(o + 30, true) + dv.getUint16(o + 32, true);
  }
  return out;
}

it("3MF: gültiges ZIP mit Modell und Farbwechseln", async () => {
  expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  const s = normalizeSettings({ width_mm: 20, pixel_size_mm: 1 });
  const img = fromRGBA8(4, 2, new Uint8Array([0,0,0,255, 80,80,80,255, 160,160,160,255, 255,255,255,255, 0,0,0,255, 80,80,80,255, 160,160,160,255, 255,255,255,255]));
  const lib = starterLibrary();
  const fil = (n: string) => lib.find((f) => f.name === n && f.brand === "Generisch")!;
  const stops = [{ filament: fil("Schwarz"), start_layer: 1 }, { filament: fil("Weiß"), start_layer: 12 }];
  const hm = buildHeightmap(img, s, { mode: "bright_high" });
  const mesh = heightmapToMesh(hm);
  const ch = colorChanges(hm, stops);
  expect(ch).toHaveLength(1);
  expect(ch[0].z).toBeCloseTo(s.base_layer_mm + 11 * 0.08, 5);
  const out = await write3mf(mesh, hm, stops, "Test & <1>");
  // ohne Vorlage: nur das Modell, weil der Slicer Wechsel nur aus einem vollständigen Projekt übernimmt
  expect(out.info).toMatchObject({ target: "bambu", changes: "none", reason: "no_template", project: false, changeCount: 1 });
  const files = await unzip(out.data);
  expect(files.has("Metadata/custom_gcode_per_layer.xml")).toBe(false);
  expect(files.get("Metadata/chromalith_farbwechsel.txt")).toContain("Schicht 12");
  expect([...files.keys()]).toContain("3D/3dmodel.model");
  expect(files.get("3D/3dmodel.model")).toContain("Test &amp; &lt;1&gt;");
  expect(files.get("3D/3dmodel.model")).toContain('p:path="/3D/Objects/object_1.model"');
  expect(files.get("Metadata/model_settings.config")).toContain('key="layer_height" value="0.08"');
  const model = files.get("3D/Objects/object_1.model")!;
  expect((model.match(/<vertex /g) ?? []).length).toBe(mesh.vertices.length / 3);
  expect((model.match(/<triangle /g) ?? []).length).toBe(mesh.faces.length / 3);
});

import { makeZip, readZip, readSlicerTemplate, patchProjectSettings, planSlots, flushVolume, validTemplate } from "../src/core";

/** Nachbau eines im Slicer gespeicherten Projekts (nur die Teile, die Chromalith liest). */
async function fakeProject(filaments = 4, app = "BambuStudio-02.03.00.70"): Promise<Uint8Array> {
  const n = filaments;
  const cfg = {
    version: "02.03.00.70", name: "project_settings", from: "project",
    printer_settings_id: "Testdrucker 0.4 nozzle", print_settings_id: "0.20mm Standard @Test",
    filament_settings_id: Array.from({ length: n }, (_, i) => `Test PLA ${i + 1}`), filament_type: Array(n).fill("PLA"),
    filament_colour: ["#FFFFFF", "#000000", "#FF0000", "#00FF00"].slice(0, n), filament_multi_colour: ["#FFFFFF", "#000000", "#FF0000", "#00FF00"].slice(0, n),
    filament_colour_type: Array(n).fill("1"),
    layer_height: "0.2", initial_layer_print_height: "0.2", nozzle_diameter: ["0.4"],
    sparse_infill_density: "15%", sparse_infill_pattern: "gyroid",
    different_settings_to_system: ["sparse_infill_density", ...Array(n).fill(""), ""],
    flush_volumes_matrix: Array(n * n).fill("111"), flush_multiplier: "1",
    printable_area: ["0x0", "180x0", "180x180", "0x180"], machine_pause_gcode: "M400 U1", enable_prime_tower: "1",
  };
  return makeZip([
    { name: "[Content_Types].xml", data: "<Types/>" },
    { name: "3D/3dmodel.model", data: `<?xml version="1.0"?><model><metadata name="Application">${app}</metadata><metadata name="BambuStudio:3mfVersion">1</metadata><resources/><build/></model>` },
    { name: "Metadata/project_settings.config", data: JSON.stringify(cfg, null, 4) },
    { name: "Metadata/filament_settings_1.config", data: '{"name":"Eigenes PLA"}' },
    { name: "Metadata/plate_1.png", data: new Uint8Array([1, 2, 3]) },
  ]);
}

describe("Slicer-Vorlage und 3MF-Projekt", () => {
  const lib = starterLibrary();
  const fil = (n: string) => lib.find((f) => f.name === n && f.brand === "Generisch")!;
  const s = normalizeSettings({ width_mm: 20, pixel_size_mm: 1 });
  const img = fromRGBA8(4, 2, new Uint8Array([0,0,0,255, 80,80,80,255, 160,160,160,255, 255,255,255,255, 0,0,0,255, 80,80,80,255, 160,160,160,255, 255,255,255,255]));
  const hm = buildHeightmap(img, s, { mode: "bright_high" });
  const mesh = heightmapToMesh(hm);
  // Schwarz, Weiß, Grau und oben noch einmal Schwarz: vier Abschnitte, drei verschiedene Filamente
  const stops = [{ filament: fil("Schwarz"), start_layer: 1 }, { filament: fil("Weiß"), start_layer: 6 }, { filament: fil("Grau hell"), start_layer: 12 }, { filament: fil("Schwarz"), start_layer: 18 }];

  it("ZIP lesen: Inhalt wie geschrieben, Auswahl nach Namen", async () => {
    const big = "abc".repeat(5000);
    const z = await makeZip([{ name: "a/b.txt", data: big }, { name: "c.bin", data: new Uint8Array([0, 255, 7]) }]);
    const all = await readZip(z);
    expect(new TextDecoder().decode(all.get("a/b.txt")!)).toBe(big);
    expect([...all.get("c.bin")!]).toEqual([0, 255, 7]);
    expect([...(await readZip(z, (n) => n.endsWith(".bin"))).keys()]).toEqual(["c.bin"]);
    await expect(readZip(new Uint8Array(100))).rejects.toThrow();
  });

  it("Vorlage lesen: Drucker, Prozess, Filamente, Bettmitte, eigene Profile", async () => {
    const t = await readSlicerTemplate(await fakeProject(), "meins.3mf");
    expect(t.app).toBe("BambuStudio-02.03.00.70");
    expect(t.printer).toBe("Testdrucker 0.4 nozzle");
    expect(t.process).toBe("0.20mm Standard @Test");
    expect(t.filaments).toHaveLength(4);
    expect(t.filaments[2]).toEqual({ name: "Test PLA 3", type: "PLA", color: "#FF0000" });
    expect(t.bed).toEqual([90, 90]);
    expect(t.presets.map((p) => p.name)).toEqual(["Metadata/filament_settings_1.config"]);
    expect(validTemplate(JSON.parse(JSON.stringify(t)))).toBe(true);
    expect(validTemplate({ app: "x" })).toBe(false);
    // eine Datei ohne Projekt-Einstellungen oder aus einem anderen Programm ist keine Vorlage
    await expect(readSlicerTemplate((await write3mf(mesh, hm, stops, "x")).data, "x.3mf")).rejects.toThrow(/Projekt/);
    await expect(readSlicerTemplate(await fakeProject(4, "Anderes-1.0"), "x.3mf")).rejects.toThrow(/Projekt/);
    expect((await readSlicerTemplate(await fakeProject(2, "OrcaSlicer-2.3.1"), "o.3mf")).filaments).toHaveLength(2);
  });

  it("Plätze: gleiches Filament belegt nur einen Platz; Spülmenge zu Hell größer als zu Dunkel", () => {
    const plan = planSlots(stops);
    expect(plan.slot).toEqual([1, 2, 3, 1]);
    expect(plan.filaments.map((f) => f.name)).toEqual(["Schwarz", "Weiß", "Grau hell"]);
    expect(flushVolume("#000000", "#ffffff")).toBeGreaterThan(flushVolume("#ffffff", "#000000") + 300);
    expect(flushVolume("#808080", "#808080")).toBe(150);
    expect(flushVolume("#000000", "#ffffff")).toBeLessThanOrEqual(800);
  });

  it("Projekt-Einstellungen: nur Farben, Schichthöhen und Spülmengen ändern sich", async () => {
    const t = await readSlicerTemplate(await fakeProject(), "meins.3mf");
    const before = JSON.parse(t.settings);
    const cfg = JSON.parse(patchProjectSettings(t.settings, { colors: ["#101010", "#f0f0f0", null, null], layerHeight: 0.08, firstLayer: 0.2 }));
    expect(cfg.filament_colour).toEqual(["#101010", "#F0F0F0", "#FF0000", "#00FF00"]);
    expect(cfg.filament_multi_colour.slice(0, 2)).toEqual(["#101010", "#F0F0F0"]);
    expect(cfg.layer_height).toBe("0.08");
    expect(cfg.initial_layer_print_height).toBe("0.2");
    // die geänderten Werte müssen als Abweichung vom Profil vermerkt sein, sonst nimmt der Slicer seine eigenen
    expect(cfg.different_settings_to_system[0].split(";").sort()).toEqual(["initial_layer_print_height", "layer_height", "sparse_infill_density", "sparse_infill_pattern"]);
    // massiv drucken: 100 % Füllung, und ein Muster, das der Slicer bei 100 % annimmt
    expect(cfg.sparse_infill_density).toBe("100%");
    expect(cfg.sparse_infill_pattern).toBe("zig-zag");
    const own = JSON.parse(patchProjectSettings(JSON.stringify({ ...before, sparse_infill_pattern: "concentric" }), { colors: [], layerHeight: 0.08, firstLayer: 0.2 }));
    expect(own.sparse_infill_pattern).toBe("concentric");
    expect(own.different_settings_to_system[0]).not.toContain("sparse_infill_pattern");
    expect(cfg.different_settings_to_system).toHaveLength(6);
    const m = cfg.flush_volumes_matrix, at = (i: number, j: number) => Number(m[i * 4 + j]);
    expect(at(0, 1)).toBe(flushVolume("#101010", "#f0f0f0"));
    expect(at(1, 0)).toBe(flushVolume("#f0f0f0", "#101010"));
    expect(at(0, 2)).toBe(flushVolume("#101010", "#ff0000"));
    expect(at(2, 3)).toBe(111); // beide Farben unverändert
    expect(at(0, 0)).toBe(111);
    for (const k of Object.keys(before)) if (!["filament_colour", "filament_multi_colour", "layer_height", "different_settings_to_system", "flush_volumes_matrix", "sparse_infill_density", "sparse_infill_pattern"].includes(k)) expect(cfg[k]).toEqual(before[k]);
  });

  it("3MF mit Vorlage: Projekt mit Filamentwechseln auf die Plätze", async () => {
    const tpl = await readSlicerTemplate(await fakeProject(), "meins.3mf");
    const out = await write3mf(mesh, hm, stops, "Bild", { template: tpl });
    expect(out.info).toMatchObject({ target: "bambu", changes: "ams", project: true, available: 4, changeCount: 3 });
    expect(out.info.slots.map((x) => [x.slot, x.filament.name, x.type])).toEqual([[1, "Schwarz", "PLA"], [2, "Weiß", "PLA"], [3, "Grau hell", "PLA"]]);
    const files = await unzip(out.data);
    expect(files.get("3D/3dmodel.model")).toContain('<metadata name="Application">BambuStudio-02.03.00.70</metadata>');
    // Modell mittig auf dem Bett der Vorlage (180 mm)
    expect(files.get("3D/3dmodel.model")).toMatch(/<item objectid="2"[^>]*transform="1 0 0 0 1 0 0 0 1 8[0-9.]* 8[0-9.]* 0"/);
    const cfg = JSON.parse(files.get("Metadata/project_settings.config")!);
    expect(cfg.filament_colour).toEqual([fil("Schwarz").color, fil("Weiß").color, fil("Grau hell").color].map((c) => c.toUpperCase()).concat(["#00FF00"]));
    expect(cfg.layer_height).toBe("0.08");
    expect(cfg.printer_settings_id).toBe("Testdrucker 0.4 nozzle");
    expect(files.get("Metadata/filament_settings_1.config")).toBe('{"name":"Eigenes PLA"}');
    const g = files.get("Metadata/custom_gcode_per_layer.xml")!;
    const z = (layer: number) => +(s.base_layer_mm + (layer - 1) * 0.08).toFixed(4);
    expect(g).toContain(`<layer top_z="${z(6)}" type="2" extruder="2" color="${fil("Weiß").color.toUpperCase()}" extra="" gcode="tool_change"/>`);
    expect(g).toContain(`<layer top_z="${z(12)}" type="2" extruder="3"`);
    expect(g).toContain(`<layer top_z="${z(18)}" type="2" extruder="1"`);
    expect(g).toContain('<plate_info id="1"/>');
    expect(g).toContain('<mode value="MultiAsSingle"/>');
    expect(files.get("Metadata/model_settings.config")).toContain('key="extruder" value="1"');
  });

  it("3MF mit Vorlage: zu wenige Plätze, Pausen und PrusaSlicer", async () => {
    const two = await readSlicerTemplate(await fakeProject(2), "zwei.3mf");
    const few = await write3mf(mesh, hm, stops, "Bild", { template: two });
    expect(few.info).toMatchObject({ changes: "none", reason: "too_many", project: true, available: 2 });
    const f1 = await unzip(few.data);
    expect(f1.has("Metadata/custom_gcode_per_layer.xml")).toBe(false);
    expect(JSON.parse(f1.get("Metadata/project_settings.config")!).layer_height).toBe("0.08");

    const pause = await write3mf(mesh, hm, stops, "Bild", { template: two, changeMode: "pause", pauseText: "Wechsel: {}" });
    expect(pause.info.changes).toBe("pause");
    const g = (await unzip(pause.data)).get("Metadata/custom_gcode_per_layer.xml")!;
    expect((g.match(/type="1"/g) ?? []).length).toBe(3);
    expect(g).toContain('extra="Wechsel: Generisch Weiß" gcode="M400 U1"');

    const prusa = await write3mf(mesh, hm, stops, "Bild", { target: "prusa", template: two });
    expect(prusa.info).toMatchObject({ target: "prusa", changes: "m600", project: false });
    const fp = await unzip(prusa.data);
    expect(fp.has("Metadata/project_settings.config")).toBe(false);
    const pg = fp.get("Metadata/Prusa_Slicer_custom_gcode_per_print_z.xml")!;
    expect((pg.match(/<code print_z="[0-9.]+" type="0" extruder="1" color="#[0-9A-F]{6}" extra="" gcode="M600"\/>/g) ?? []).length).toBe(3);
    expect(pg).toContain('<mode value="SingleExtruder"/>');
    const model = fp.get("3D/3dmodel.model")!;
    expect((model.match(/<triangle /g) ?? []).length).toBe(mesh.faces.length / 3);
    expect(model).toContain('<build><item objectid="1"/></build>');
  });
});

import { applyIslands, effectiveStops } from "../src/core";
it("Farbinsel: Bereich wird angehoben und bekommt eigenes Filament", () => {
  // 10×10 Grau, in der Mitte ein rotes 4×4-Quadrat
  const w = 10, px = new Uint8Array(w * w * 4);
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, red = x >= 3 && x < 7 && y >= 3 && y < 7;
    px.set(red ? [220, 20, 20, 255] : [128, 128, 128, 255], i);
  }
  const img = fromRGBA8(w, w, px);
  const lib = starterLibrary();
  const fil = (n: string) => lib.find((f) => f.name === n && f.brand === "Generisch")!;
  const s = normalizeSettings({ width_mm: 9, pixel_size_mm: 1 });
  const p: Project = { name: "t", image: img, imagePng: null, settings: s,
    stops: [{ filament: fil("Schwarz"), start_layer: 1 }, { filament: fil("Weiß"), start_layer: 8 }],
    islands: [{ id: "a", filament: fil("Rot"), seeds: [{ x: 0.5, y: 0.5 }], tolerance: 15, contiguous: true, raise_mm: 0.4, keep_relief: false }] };
  const hm = buildProject(p, undefined, { ...s, height_mode: "bright_high" });
  const rest = hm.heights[0], top = hm.heights[5 * hm.width + 5];
  expect(top).toBeGreaterThan(rest + 0.3);
  const nTop = hm.heights.filter((v) => v === top).length;
  expect(nTop).toBeGreaterThanOrEqual(10); expect(nTop).toBeLessThanOrEqual(24);
  const est = effectiveStops(hm, p.stops);
  expect(est[est.length - 1].filament.name).toBe("Rot");
  expect(est[est.length - 1].start_layer).toBe(hm.restLayers! + 1);
  void applyIslands;
});

import { spoolmanBase, spoolmanUrl, spoolmanEntries, syncSpoolman, spoolmanTd, serializeLibrary } from "../src/core";
describe("Spoolman", () => {
  const vendor = { id: 1, name: "Bambu Lab", extra: {} };
  const spools = [
    { id: 1, remaining_weight: 800, price: 20, archived: false, extra: {},
      filament: { id: 10, name: "Basic Rot", vendor, material: "PLA", weight: 1000, price: 25, color_hex: "C12E1F", extra: { td: "\"1,8\"" } } },
    { id: 2, remaining_weight: 150.4, archived: false, extra: {},
      filament: { id: 10, name: "Basic Rot", vendor, material: "PLA", weight: 1000, price: 25, color_hex: "C12E1F", extra: { td: "\"1,8\"" } } },
    { id: 3, remaining_weight: 500, archived: false, extra: {},
      filament: { id: 11, name: "Matte Weiß", vendor, material: "PLA", weight: 500, price: 12, color_hex: "ffffff", extra: {} } },
    { id: 4, remaining_weight: 0, archived: true, extra: {}, filament: { id: 12, name: "Alt", material: "PETG", color_hex: "000000" } },
    { id: 5, remaining_weight: 10, extra: {}, filament: { id: 13, name: "Ohne Farbe", material: "PLA" } },
  ];
  it("vereinheitlicht die Adresse", () => {
    expect(spoolmanBase(" 192.168.60.10:7912/ ")).toBe("http://192.168.60.10:7912");
    expect(spoolmanBase("https://spool.example/api/v1/")).toBe("https://spool.example");
    expect(spoolmanUrl("192.168.60.10:7912", "spool")).toBe("http://192.168.60.10:7912/api/v1/spool");
  });
  it("liest TD aus Zusatzfeldern", () => {
    expect(spoolmanTd({ td: "2.5" })).toBe(2.5);
    expect(spoolmanTd({ filament_td: "\"3\"" })).toBe(3);
    expect(spoolmanTd({ notiz: "\"x\"" })).toBeNull();
  });
  it("fasst Rollen je Filament zusammen", () => {
    const { entries, skipped } = spoolmanEntries(spools);
    expect(skipped).toBe(1);
    expect(entries.length).toBe(2);
    const rot = entries.find((e) => e.spoolman_id === 10)!;
    expect(rot).toMatchObject({ brand: "Bambu Lab", color: "#c12e1f", td: 1.8, spools: 2, price: 20 });
    expect(rot.remaining_g).toBeCloseTo(950.4);
    expect(entries.find((e) => e.spoolman_id === 11)!.price).toBe(24);
    expect(() => spoolmanEntries({ detail: "x" })).toThrow();
  });
  it("gleicht die Bibliothek ab und behält eigene TD-Werte", () => {
    const lib = starterLibrary();
    const n = lib.length;
    const r = syncSpoolman(lib, spools);
    expect(r).toMatchObject({ added: 2, updated: 0, estimated: 1, total: 2 });
    expect(lib.length).toBe(n + 2);
    const weiss = lib.find((f) => f.spoolman_id === 11)!;
    expect(weiss.owned && weiss.td_estimated).toBe(true);
    weiss.td = 6.5; delete weiss.td_estimated;
    const r2 = syncSpoolman(lib, spools.slice(0, 2));
    expect(r2).toMatchObject({ added: 0, updated: 1, gone: 1 });
    expect(lib.length).toBe(n + 2);
    expect(weiss.td).toBe(6.5);
    expect(weiss.owned).toBe(false);
    // Zusatzangaben überstehen Speichern und Laden
    const back = parseFilaments(JSON.parse(serializeLibrary(lib))).find((f) => f.spoolman_id === 10)!;
    expect(back).toMatchObject({ price: 20, remaining_g: 950, td: 1.8, owned: true });
  });
});

import { calmLayers, normalized as normStops } from "../src/core";
describe("Flächen beruhigen und ausgeblendete Filamente", () => {
  it("entfernt feine Rillen von einer Schicht, lässt Kanten stehen", () => {
    const w = 20, h = 20, step = 0.08, a = new Float32Array(w * h).fill(1.0);
    for (let i = 0; i < 20; i++) a[i * w + ((i * 7) % 10)] = 1.0 - step; // Sprenkel / Zickzack links
    for (let y = 0; y < h; y++) for (let x = 14; x < w; x++) a[y * w + x] = 0.52; // echte Kante rechts
    calmLayers(a, w, h, step, 1);
    for (let y = 0; y < h; y++) for (let x = 0; x < 12; x++) expect(a[y * w + x]).toBeCloseTo(1.0);
    expect(a[5 * w + 13]).toBeCloseTo(1.0);
    expect(a[5 * w + 14]).toBeCloseTo(0.52);
  });
  it("ausgeblendete Filamente zählen nicht", () => {
    const [s, g, w] = starterLibrary();
    const st = normStops([{ filament: s, start_layer: 1, disabled: true }, { filament: g, start_layer: 5 }, { filament: w, start_layer: 9 }]);
    expect(st.map((x) => [x.filament.id, x.start_layer])).toEqual([[g.id, 1], [w.id, 9]]);
    const p = parseProject(serializeProject({ name: "t", image: null, imagePng: null, settings: normalizeSettings(undefined),
      stops: [{ filament: s, start_layer: 1 }, { filament: g, start_layer: 5, disabled: true }], islands: [] } as any));
    expect(p.stops.map((x) => !!x.disabled)).toEqual([false, true]);
  });
});

describe("Motiv skalieren", () => {
  it("verkleinert das Motiv, Raster und Umriss bleiben", () => {
    const img = gradient(64, 64);
    const s0 = { ...normalizeSettings(undefined), width_mm: 20, pixel_size_mm: 0.5 };
    const a = buildHeightmap(img, s0, { mode: "bright_high" });
    const b = buildHeightmap(img, { ...s0, image_scale: 0.5, image_x: 10 }, { mode: "bright_high" });
    expect([b.width, b.height]).toEqual([a.width, a.height]);
    const w = b.width, mid = Math.floor(b.height / 2) * w;
    // Außerhalb des Motivs: einheitliche Randfarbe -> gleiche Höhe links außen und in der Ecke
    expect(b.heights[mid + 1]).toBeCloseTo(b.heights[2 * w + 2]);
    // Im Motiv steigt der Verlauf doppelt so schnell an wie vorher
    const c = Math.floor(w / 2) + Math.round(0.1 * w);
    expect(b.heights[mid + c + 6] - b.heights[mid + c - 6]).toBeGreaterThan((a.heights[mid + Math.floor(w / 2) + 6] - a.heights[mid + Math.floor(w / 2) - 6]) * 1.5);
    expect(normalizeSettings({ width_mm: 50 } as any).image_scale).toBe(1);
  });
});

describe("Filament-Vorschlag", () => {
  it("deckt kleine, kräftige Farben trotz großem Hintergrund ab und hält die Anzahl ein", () => {
    // 100×100 weiß, darin kleine Farbfelder (zusammen ca. 10 % der Fläche)
    const w = 100, h = 100, rgb = new Float32Array(w * h * 3).fill(1);
    const patches: [number, number, number][] = [[0.8, 0.1, 0.1], [0.1, 0.5, 0.15], [0.1, 0.2, 0.7], [0.95, 0.8, 0.1], [0.05, 0.05, 0.05]];
    patches.forEach((c, k) => { for (let y = 40; y < 55; y++) for (let x = 10 + k * 16; x < 24 + k * 16; x++) rgb.set(c, (y * w + x) * 3); });
    const lib = starterLibrary();
    const o = { count: 7, base: 0.2, step: 0.08, minH: 0.48, maxH: 2.24 };
    const r = suggestFilaments(labSample(rgb, w, h, 72), rgb, lib, o)!;
    expect(r.stops.length).toBe(7);
    const names = r.stops.map((s) => s.filament.name).join(" ");
    for (const n of ["Rot", "Blau", "Grün"]) expect(names).toContain(n);
  });
});

import { lithoMesh, lithoThickness, lithoTransmit, lithoSimulate } from "../src/core";
describe("Lithophanie", () => {
  const img = gradient(48, 32);
  const base = { ...normalizeSettings(undefined), litho: true, width_mm: 60, pixel_size_mm: 1 };
  it("dunkel = dick, hell = dünn", () => {
    const th = lithoThickness(img, base);
    expect(th.t[0]).toBeCloseTo(2.6, 1);
    expect(th.t[th.w - 1]).toBeCloseTo(0.6, 1);
    const sim = lithoSimulate(th, { filamentColor: "#ffffff", td: 4, light: "#ffffff", intensity: 1 });
    expect(sim[(th.w - 1) * 3]).toBeGreaterThan(sim[0] + 0.2);
    expect(lithoTransmit(0.6, "#ffffff", 4, "#ffffff", 1)[0]).toBeGreaterThan(lithoTransmit(3, "#ffffff", 4, "#ffffff", 1)[0]);
  });
  for (const [form, extra] of [["flat", {}], ["curved", {}], ["cylinder", {}], ["cylinder", { litho_img_deg: 120, litho_height_mm: 50, litho_repeat: true }],
    ["sphere", {}], ["sphere", { litho_cap: true }], ["sphere", { litho_cap: true, litho_repeat: true, litho_img_deg: 90 }]] as const)
    it(`Körper „${form}“ ${JSON.stringify(extra)} ist geschlossen und richtig herum`, () => {
      const s = { ...base, litho_form: form, ...extra };
      const m = lithoMesh(lithoThickness(img, s), s);
      const edges = new Map<string, number>();
      for (let i = 0; i < m.faces.length; i += 3) for (let k = 0; k < 3; k++) {
        const a = m.faces[i + k], b = m.faces[i + ((k + 1) % 3)];
        edges.set(`${a}_${b}`, (edges.get(`${a}_${b}`) ?? 0) + 1);
      }
      for (const [k, c] of edges) { const [a, b] = k.split("_"); expect(c).toBe(1); expect(edges.get(`${b}_${a}`)).toBe(1); }
      expect(meshVolume(m)).toBeGreaterThan(100);
      expect(m.size[2]).toBeGreaterThan(20);
    });
  it("Bild auf der Kugel wird aufgesetzt, nicht gestreckt: daneben bleibt die Wand gleichmäßig", () => {
    const s = { ...base, litho_form: "sphere" as const, litho_img_deg: 90, litho_rest_mm: 1.5 };
    const m = lithoMesh(lithoThickness(img, s), s);
    let rest = 0, pic = 0;
    for (const t of m.thick) { if (Math.abs(t - 1.5) < 1e-4) rest++; else if (t > 0 && t < 90) pic++; }
    // 90° breites Bild im Format 3:2 bedeckt nur einen kleinen Teil der Kugel
    expect(pic).toBeGreaterThan(20);
    expect(rest).toBeGreaterThan(pic * 3);
  });
  it("Schraubdeckel: Kugel steht in der Druckdatei auf dem Kopf auf der Gewindeseite, Deckel daneben", () => {
    const s = { ...base, litho_form: "sphere" as const, litho_cap: true, litho_cap_mm: 26 };
    const off = lithoMesh(lithoThickness(img, s), s), on = lithoMesh(lithoThickness(img, s), s, Infinity, true);
    expect(off.size[0]).toBeGreaterThan(on.size[0] + 20);
    expect(on.vertices.length).toBe(off.vertices.length);
    let minZ = Infinity; for (let i = 2; i < off.vertices.length; i += 3) minZ = Math.min(minZ, off.vertices[i]);
    expect(minZ).toBeCloseTo(0, 3);
    // auf dem Bett liegt ein ebener Ring: viele Punkte genau bei z = 0
    let flat = 0; for (let i = 2; i < off.vertices.length; i += 3) if (Math.abs(off.vertices[i]) < 1e-4) flat++;
    expect(flat).toBeGreaterThan(150);
  });
});

import { compareVersions, parseRelease, pickNotes } from "../src/update";
describe("Update", () => {
  it("vergleicht Versionen", () => {
    expect(compareVersions("0.16.0", "0.15.9")).toBeGreaterThan(0);
    expect(compareVersions("v0.16.0", "0.16.0")).toBe(0);
    expect(compareVersions("0.9.0", "0.10.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
  });
  it("liest das Release und nimmt nur die Installationsdatei", () => {
    const sha = "a".repeat(64);
    const rel = parseRelease({ tag_name: "v0.17.0", body: "Notes", assets: [
      { name: "Chromalith-windows.zip", size: 5, browser_download_url: "x" },
      { name: "Chromalith-0.17.0-Setup.exe", size: 123, state: "uploaded", digest: "sha256:" + sha, browser_download_url: "https://github.com/LX-S93/chromalith/releases/download/v0.17.0/Chromalith-0.17.0-Setup.exe" }] });
    expect(rel).toMatchObject({ version: "0.17.0", size: 123, sha256: sha, notes: "Notes" });
    expect(parseRelease({ tag_name: "v0.17.0", assets: [] })).toBeNull();
    expect(parseRelease({ tag_name: "v0.17.0", prerelease: true, assets: [{ name: "Chromalith-0.17.0-Setup.exe", size: 1 }] })).toBeNull();
    expect(parseRelease({ tag_name: "nightly", assets: [] })).toBeNull();
  });
});

describe("Druckbare Mindestbreite", () => {
  it("entfernt Einzelspitzen und verbreitert feine Linien", () => {
    const w = 40, h = 40, px = new Uint8Array(w * h * 4).fill(255);
    const dark = (x: number, y: number) => { const o = (y * w + x) * 4; px[o] = px[o + 1] = px[o + 2] = 0; };
    dark(8, 8); // einzelner Punkt
    for (let y = 5; y < 35; y++) dark(25, y); // 1 Punkt breite Linie
    const img = fromRGBA8(w, h, px);
    const base = { ...DEFAULT_SETTINGS, width_mm: 7.8, pixel_size_mm: 0.2, height_mode: "dark_high" as const };
    const raw = buildHeightmap(img, { ...base, detail_mm: 0 }, { mode: "dark_high" });
    const fix = buildHeightmap(img, { ...base, detail_mm: 0.4 }, { mode: "dark_high" });
    const lo = Math.min(...fix.heights);
    expect(raw.heights[8 * w + 8]).toBeGreaterThan(lo + 1);
    expect(fix.heights[8 * w + 8]).toBeLessThan(lo + 0.2); // höchstens ein flacher Buckel
    const width = (hm: typeof fix) => [...hm.heights.subarray(20 * w, 21 * w)].filter((v) => v > lo + 0.3).length;
    expect(width(raw)).toBe(1);
    expect(width(fix)).toBeGreaterThanOrEqual(2); // Linie bleibt, aber druckbar breit
  });
});

describe("Release-Hinweise", () => {
  const body = "- New thing\n\n<!-- de\n- Neue Sache\n-->\n";
  it("wählt die deutsche Fassung aus dem Kommentar, sonst Englisch ohne Kommentar", () => {
    expect(pickNotes(body, "de")).toBe("- Neue Sache");
    expect(pickNotes(body, "en")).toBe("- New thing");
    expect(pickNotes("- Only English", "de")).toBe("- Only English");
  });
});

describe("Motiv ragt über die Form", () => {
  // weißer Hintergrund, dunkler Balken von oben bis zur Mitte: ragt oben über den Kreis hinaus
  const w = 60, h = 60, px = new Uint8Array(w * h * 4).fill(255);
  for (let y = 2; y < 34; y++) for (let x = 26; x < 34; x++) { const o = (y * w + x) * 4; px[o] = px[o + 1] = px[o + 2] = 20; }
  const img = fromRGBA8(w, h, px);
  const base = { ...DEFAULT_SETTINGS, width_mm: 11.8, pixel_size_mm: 0.2, shape: "circle" as const, breakout_frame: 60 };
  const closed = (hm: ReturnType<typeof buildHeightmap>) => {
    const m = heightmapToMesh(hm), edges = new Map<number, number>(), nv = m.vertices.length / 3;
    for (let i = 0; i < m.faces.length; i += 3) for (let k = 0; k < 3; k++) {
      const a = m.faces[i + k], b = m.faces[i + ((k + 1) % 3)];
      edges.set(a * nv + b, (edges.get(a * nv + b) ?? 0) + 1);
    }
    for (const [key] of edges) { const a = Math.floor(key / nv), b = key % nv; if (edges.get(b * nv + a) !== 1) return false; }
    return true;
  };
  it("aufliegend: Motiv außerhalb des Kreises bleibt, Hintergrund fällt weg", () => {
    const hm = buildHeightmap(img, { ...base, breakout: "attached" }, { mode: "dark_high" });
    expect(hm.mask![5 * w + 30]).toBe(1); // Balken über dem Kreis
    expect(hm.mask![5 * w + 5]).toBe(0); // Hintergrund außerhalb
    expect(hm.mask![30 * w + 20]).toBe(1); // Hintergrund im Kreis
    expect(hm.bottom ?? null).toBeNull();
    expect(closed(hm)).toBe(true);
  });
  it("schwebend: Unterseite angehoben, Netz bleibt geschlossen", () => {
    const hm = buildHeightmap(img, { ...base, breakout: "floating", breakout_float_mm: 0.8 }, { mode: "dark_high" });
    const z0 = hm.bottom![5 * w + 30];
    expect(z0).toBeGreaterThan(0.7);
    expect(hm.heights[5 * w + 30]).toBeGreaterThanOrEqual(z0 + 0.39);
    expect(hm.bottom![30 * w + 30]).toBe(0); // im Kreis liegt alles auf
    expect(closed(hm)).toBe(true);
    const m = heightmapToMesh(hm);
    expect(meshVolume(m)).toBeGreaterThan(0);
  });
  it("aus: unverändert ohne Unterseite", () => {
    const hm = buildHeightmap(img, { ...base, breakout: "off" }, { mode: "dark_high" });
    expect(hm.bottom ?? null).toBeNull();
    expect(hm.mask![5 * w + 30]).toBe(1); // voller Kreis wie bisher
    expect(hm.mask![2 * w + 2]).toBe(0);
  });
});

import { removeSeams, suggestStack, calmEnough, filamentLuminance } from "../src/core";
describe("Relief folgt dem Bild", () => {
  it("feine dunkle Linien bleiben als tiefe, schmale Rille erhalten", () => {
    const w = 40, h = 40, px = new Uint8Array(w * h * 4).fill(255);
    for (let y = 5; y < 35; y++) { const o = (y * w + 20) * 4; px[o] = px[o + 1] = px[o + 2] = 0; }
    const s = { ...DEFAULT_SETTINGS, width_mm: 7.8, pixel_size_mm: 0.2, height_mode: "bright_high" as const };
    const hm = buildHeightmap(fromRGBA8(w, h, px), s, { mode: "bright_high" });
    const hi = Math.max(...hm.heights), row = hm.heights.subarray(20 * w, 21 * w);
    expect(row[20]).toBeLessThan(hi - 1); // Rille bleibt über 1 mm tief
    expect(row[17]).toBeGreaterThan(hi - 0.1); // daneben bleibt die Fläche oben
    expect([...row].filter((v) => v < hi - 0.5).length).toBeLessThanOrEqual(2); // und sie wird nicht breiter
  });
  it("entfernt Mischkanten zwischen zwei Flächen, lässt echte Linien stehen", () => {
    const w = 9, h = 5, edge = new Float32Array(w * h), line = new Float32Array(w * h).fill(1);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) edge[y * w + x] = x < 4 ? 1 : x === 4 ? 0.4 : 2;
    for (let y = 0; y < h; y++) line[y * w + 4] = 0.4;
    const a = removeSeams(edge, w, h, 0.12), b = removeSeams(line, w, h, 0.12);
    expect(a[2 * w + 4]).toBe(1); // Ausreißer an der Kante fällt auf die nähere Seite
    expect(a[2 * w + 3]).toBe(1); expect(a[2 * w + 5]).toBe(2);
    expect(b[2 * w + 4]).toBeCloseTo(0.4); // Rille in einer ebenen Fläche bleibt
  });
  it("Vorschlag „dunkel unten“ sortiert den Stapel nach Helligkeit", () => {
    const w = 40, h = 20, rgb = new Float32Array(w * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3, t = y / (h - 1);
      if (x < w / 2) { rgb[i] = 0.85 * (1 - t) + 0.1 * t; rgb[i + 1] = 0.1; rgb[i + 2] = 0.1; }
      else { rgb[i] = 0.1; rgb[i + 1] = 0.15; rgb[i + 2] = 0.8 * (1 - t) + 0.1 * t; }
    }
    const lab = labSample(rgb, w, h, 40), o = { count: 4, base: 0.16, step: 0.08, minH: 0.48, maxH: 2.24 };
    const calm = suggestStack(lab, rgb, lib0(), o, "dark_base")!;
    expect(calm.order).toBe("dark_base");
    const lum = calm.stops.map((s) => filamentLuminance(s.filament));
    expect(lum).toEqual([...lum].sort((a, b) => a - b));
    const free = suggestStack(lab, rgb, lib0(), o, "free")!;
    expect(free.error).toBeLessThanOrEqual(calm.error + 1e-6); // freie Reihenfolge trifft die Farben mindestens so gut
    const auto = suggestStack(lab, rgb, lib0(), o, "auto")!;
    expect(auto.bestError).toBeCloseTo(free.error, 6);
    expect(auto.order).toBe(calmEnough(calm.error, free.error) ? "dark_base" : free.order);
  });
  it("Automatik: ruhiges Relief nur, solange die Farben kaum leiden", () => {
    expect(calmEnough(14.5, 12.2)).toBe(true);
    expect(calmEnough(20, 12)).toBe(false);
  });
});

import { toneCurve, nearestHeights, lightRange, normalizeSettings as norm2 } from "../src/core";
describe("Detailtreue im farbtreuen Modus", () => {
  it("Tonwertkurve staucht nur die Enden und erhält die Reihenfolge", () => {
    expect(toneCurve([20, 60], [10, 70])).toBeNull(); // Bild liegt im Bereich des Stapels
    const lut = toneCurve([10, 90], [10, 65])!;
    expect(lut[900]).toBeCloseTo(65, 3); // hellster Bildton -> hellster Ton des Stapels
    expect(lut[300]).toBeCloseTo(30, 3); // Mitteltöne bleiben
    for (let i = 1; i <= 1000; i++) expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1]);
    expect(lut[800]).toBeLessThan(lut[900]); // Unterschiede oberhalb des Erreichbaren bleiben Unterschiede
  });
  it("helle Töne jenseits des Stapels bleiben unterscheidbar", () => {
    // Stapel: zehn Grautöne von dunkel bis mittelhell; Bild: mittelgrau, hellgrau, weiß
    const k = 10, colors = new Float32Array(k * 3), heights = new Float32Array(k);
    for (let j = 0; j < k; j++) { colors.fill(0.1 + (0.45 * j) / (k - 1), j * 3, j * 3 + 3); heights[j] = 0.5 + j * 0.1; }
    const rgb = Float32Array.from([0.3, 0.3, 0.3, 0.75, 0.75, 0.75, 1, 1, 1]);
    const plain = nearestHeights(rgb, heights, colors, 0), fine = nearestHeights(rgb, heights, colors, 0.75);
    expect(plain[1]).toBe(plain[2]); // ohne Detailtreue fallen Hellgrau und Weiß auf dieselbe Schicht
    expect(fine[2]).toBeGreaterThan(fine[1]);
    expect(fine[1]).toBeGreaterThan(fine[0]);
    expect(fine[2]).toBeCloseTo(heights[k - 1]);
  });
  it("Helligkeitsbereich ohne Ausreißer; alte Projekte bekommen den Standardwert", () => {
    const lab = new Float32Array(3000); for (let i = 0; i < 1000; i++) lab[i * 3] = i === 0 ? 99 : 20 + (i % 50);
    expect(lightRange(lab)).toEqual([20, 69]);
    expect(norm2({ width_mm: 50 } as any).color_detail).toBe(0.75);
  });
});

describe("Lithophanie nutzt nur ihre eigenen Einstellungen", () => {
  it("Motivgröße und Motivlage aus dem Farbrelief wirken nicht", () => {
    const w = 24, h = 24, px = new Uint8Array(w * h * 4).fill(255);
    for (let y = 6; y < 18; y++) for (let x = 6; x < 18; x++) { const o = (y * w + x) * 4; px[o] = px[o + 1] = px[o + 2] = 30; }
    const img = fromRGBA8(w, h, px), s = { ...DEFAULT_SETTINGS, width_mm: 23 * 0.5, pixel_size_mm: 0.5, litho: true };
    const a = lithoThickness(img, s), b = lithoThickness(img, { ...s, image_scale: 0.5, image_x: 20, image_y: -10, shape: "circle" });
    expect(Array.from(b.t)).toEqual(Array.from(a.t));
  });
});

import { DEFAULT_STAIR, cleanStair, fitTd, linearToSrgb, roundTd, sampleStair, stairHeightMap, stairThicknesses, tdFromDarkStep, STAIR_STEP_MM, STAIR_WIDTH_MM, type StairSpec } from "../src/core";

/** Foto einer Treppe im Gegenlicht nachbauen: Stufen nebeneinander, Helligkeit nach dem Modell, dazu Streulicht. */
function stairPhoto(spec: StairSpec, td: number, o: { light?: number; black?: number; reverse?: boolean; tint?: [number, number, number] } = {}) {
  const sw = 40, hgt = 60, pad = 30, w = spec.count * sw + 2 * pad, h = hgt + 2 * pad;
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  const t = stairThicknesses(spec), tint = o.tint ?? [1, 1, 1];
  for (let i = 0; i < spec.count; i++) {
    const lum = Math.min(1, (o.light ?? 0.8) * Math.exp((-Math.log(20) * t[i]) / td) + (o.black ?? 0));
    const col = o.reverse ? spec.count - 1 - i : i;
    for (let y = pad; y < pad + hgt; y++) for (let x = pad + col * sw; x < pad + (col + 1) * sw; x++) {
      const p = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) data[p + c] = Math.round(255 * linearToSrgb(Math.min(1, lum * tint[c])));
    }
  }
  const cy = pad + hgt / 2, x0 = pad + sw / 2, x1 = pad + (spec.count - 0.5) * sw;
  return { img: { data, width: w, height: h }, a: [x0, cy] as [number, number], b: [x1, cy] as [number, number] };
}

describe("TD-Kalibrierung", () => {
  it("Treppe: Dicken, Höhenkarte und druckbares Netz", () => {
    expect(stairThicknesses(DEFAULT_STAIR)).toEqual([0.2, 0.28, 0.36, 0.44, 0.52, 0.6, 0.68, 0.76, 0.84, 0.92]);
    expect(stairThicknesses({ first: 0.08, layer: 0.08, perStep: 1, count: 10 })[9]).toBe(0.8);
    expect(cleanStair({ first: 9, layer: NaN, perStep: 2.4, count: 99 })).toEqual({ first: 0.6, layer: 0.08, perStep: 2, count: 20 });
    const hm = stairHeightMap(DEFAULT_STAIR);
    expect(sizeMm(hm)).toEqual([10 * STAIR_STEP_MM, STAIR_WIDTH_MM]);
    expect(hm.heights[0]).toBeCloseTo(0.2); expect(hm.heights[hm.width - 1]).toBeCloseTo(0.92);
    expect(layerCount(hm)).toBe(10);
    const m = heightmapToMesh(hm);
    expect(watertight(m.faces)).toBe(true);
    const ideal = stairThicknesses(DEFAULT_STAIR).reduce((p, q) => p + q, 0) * STAIR_STEP_MM * STAIR_WIDTH_MM;
    expect(Math.abs(meshVolume(m) - ideal) / ideal).toBeLessThan(0.02);
  });

  it("Foto: TD aus dem Helligkeitsabfall, unabhängig von Lampe und Belichtung", () => {
    const t = stairThicknesses(DEFAULT_STAIR);
    for (const td of [0.6, 1.4, 3]) for (const light of [0.3, 0.9]) {
      const p = stairPhoto(DEFAULT_STAIR, td, { light });
      const fit = fitTd(t, sampleStair(p.img, p.a, p.b, DEFAULT_STAIR.count));
      expect(fit.ok).toBe(true);
      expect(Math.abs(fit.td - td) / td).toBeLessThan(0.05);
      expect(fit.r2).toBeGreaterThan(0.98);
      expect(fit.reversed).toBe(false);
    }
  });

  it("Foto: vertauschte Marken, farbiges Filament und überbelichtete Stufen", () => {
    const t = stairThicknesses(DEFAULT_STAIR);
    const rev = stairPhoto(DEFAULT_STAIR, 1.2, { reverse: true });
    const f1 = fitTd(t, sampleStair(rev.img, rev.a, rev.b, 10));
    expect(f1.reversed).toBe(true); expect(Math.abs(f1.td - 1.2)).toBeLessThan(0.08);
    const red = stairPhoto(DEFAULT_STAIR, 2, { tint: [1, 0.25, 0.2] });
    expect(Math.abs(fitTd(t, sampleStair(red.img, red.a, red.b, 10)).td - 2)).toBeLessThan(0.15);
    // sehr helle Lampe: die dünnsten Stufen laufen ins Weiß und werden weggelassen
    const hot = stairPhoto(DEFAULT_STAIR, 1.5, { light: 2.2 });
    const f3 = fitTd(t, sampleStair(hot.img, hot.a, hot.b, 10));
    expect(f3.saturated.slice(0, 2)).toEqual([true, true]);
    expect(f3.used[0]).toBe(false);
    expect(Math.abs(f3.td - 1.5) / 1.5).toBeLessThan(0.06);
  });

  it("Foto: Streulicht auf den dunklen Stufen verfälscht deckende Filamente nicht", () => {
    const t = stairThicknesses(DEFAULT_STAIR);
    const p = stairPhoto(DEFAULT_STAIR, 0.3, { light: 0.9, black: 0.012 });
    const fit = fitTd(t, sampleStair(p.img, p.a, p.b, 10));
    expect(fit.ok).toBe(true);
    expect(fit.black).toBeGreaterThan(0.008);
    expect(Math.abs(fit.td - 0.3)).toBeLessThan(0.05);
    expect(fit.used.filter(Boolean).length).toBeLessThan(6);
  });

  it("Foto: ohne Abfall kein Ergebnis; sehr durchscheinend gilt als grobe Schätzung", () => {
    const t = stairThicknesses(DEFAULT_STAIR);
    const flat = fitTd(t, t.map(() => ({ lum: 0.5, saturated: 0, n: 100 })));
    expect(flat.ok).toBe(false); expect(flat.problem).toBe("flat");
    const few = fitTd(t, t.map(() => ({ lum: 1, saturated: 1, n: 100 })));
    expect(few.ok).toBe(false); expect(few.problem).toBe("few");
    const p = stairPhoto(DEFAULT_STAIR, 8);
    const far = fitTd(t, sampleStair(p.img, p.a, p.b, 10));
    expect(far.ok).toBe(true); expect(far.rough).toBe(true);
    expect(Math.abs(far.td - 8) / 8).toBeLessThan(0.15);
  });

  it("von Hand: TD liegt zwischen der ersten dunklen Stufe und der davor", () => {
    expect(tdFromDarkStep(DEFAULT_STAIR, 0)).toBe(0.2);
    expect(tdFromDarkStep(DEFAULT_STAIR, 4)).toBe(0.48);
    expect(tdFromDarkStep(DEFAULT_STAIR, 9)).toBe(0.88);
    expect(roundTd(0.48)).toBe(0.5); expect(roundTd(2.34)).toBe(2.3);
  });
});
