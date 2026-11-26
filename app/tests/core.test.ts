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
  const files = await unzip(await write3mf(mesh, hm, stops, "Test & <1>"));
  expect([...files.keys()]).toContain("3D/3dmodel.model");
  expect(files.get("3D/3dmodel.model")).toContain("Test &amp; &lt;1&gt;");
  expect(files.get("3D/3dmodel.model")).toContain('p:path="/3D/Objects/object_1.model"');
  expect(files.get("Metadata/model_settings.config")).toContain('key="layer_height" value="0.08"');
  const model = files.get("3D/Objects/object_1.model")!;
  expect((model.match(/<vertex /g) ?? []).length).toBe(mesh.vertices.length / 3);
  expect((model.match(/<triangle /g) ?? []).length).toBe(mesh.faces.length / 3);
  expect(files.get("Metadata/custom_gcode_per_layer.xml")).toContain(`top_z="${+(s.base_layer_mm + 11 * 0.08).toFixed(4)}"`);
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

import { compareVersions, parseRelease } from "../src/update";
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
