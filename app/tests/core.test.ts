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
