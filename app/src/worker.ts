/// <reference lib="webworker" />
/** Rechen-Worker: hält das Bild und rechnet Höhenkarte, Vorschau, Analyse und Export,
 *  ohne die Oberfläche zu blockieren. */
import {
  autoDistribute, buildProject, write3mf, effectiveStops, type Island, colorError, labSample, prepareImage, suggestStack, type SuggestMode, type Filament, downsample, effectiveMode, filamentUsage, heightmapToMesh, imagePalette, layerCount,
  lithoMesh, lithoThickness, lithoSimulate, meshVolume, type LithoLight,
  maxZ, minLayer, planJson, planReport, simulate, sizeMm, writeStl, type ColorStop, type DigitRenderer,
  nightPlate, nightSimulate, nightTarget, nightThickness, type HeightMap, type NightLight,
  lentiModel, lentiParts, lentiPreviewMesh, lentiPrint, lentiPureAngle, lentiView,
  type HeightSettings, type Project, type Raster,
} from "./core";

let image: Raster | null = null;
let imageVersion = 0;
/** Tag-und-Nacht-Bild: das zweite Bild, das im Gegenlicht erscheint */
let night: Raster | null = null;
let cache: { key: string; hm: ReturnType<typeof buildProject>; small?: ReturnType<typeof downsample>; mesh?: ReturnType<typeof heightmapToMesh> } | null = null;

const renderDigits: DigitRenderer = (w, h, digits, sizePx) => {
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  g.font = `700 ${sizePx}px "Segoe UI", system-ui, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (const d of digits) g.fillText(d.text, d.x, d.y);
  const px = g.getImageData(0, 0, w, h).data;
  const m = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) m[i] = px[i * 4 + 3] > 127 ? 1 : 0;
  return m;
};

const toRGBA = (rgb: Float32Array, n: number) => {
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    out[i * 4] = rgb[i * 3] * 255; out[i * 4 + 1] = rgb[i * 3 + 1] * 255; out[i * 4 + 2] = rgb[i * 3 + 2] * 255; out[i * 4 + 3] = 255;
  }
  return out;
};

let islands: Island[] = [];
const project = (settings: HeightSettings, stops: ColorStop[], name = ""): Project =>
  ({ name, image, imagePng: null, settings, stops, islands });

function previewSettings(s: HeightSettings, maxSide: number): HeightSettings {
  return { ...s, pixel_size_mm: Math.max(s.pixel_size_mm, s.width_mm / maxSide) };
}

/** Rückplatte für das Nachtbild: Dicke je Punkt, Vorschau im Gegenlicht und Kennzahlen. */
function nightResult(hm: HeightMap, stops: ColorStop[], s: HeightSettings, light: NightLight) {
  const { t, info, day } = nightThickness(hm, stops, nightTarget(night!, hm.width, hm.height), s, light.td);
  const sim = nightSimulate(hm, stops, t, light, day);
  let vol = 0;
  for (let i = 0; i < t.length; i++) if (!hm.mask || hm.mask[i]) vol += t[i];
  return { t, info, through: sim.through, preview: toRGBA(sim.rgb, hm.width * hm.height), volume_mm3: vol * hm.pixel_size_mm * hm.pixel_size_mm };
}
/** Die Einstellungen der Rückplatte ändern das Farbrelief nicht: sie gehören nicht in den Schlüssel des Zwischenspeichers. */
const reliefKey = (s: HeightSettings) => { const { night_min_mm, night_max_mm, night_auto, night_comp, ...rest } = s; return rest; };

self.onmessage = (ev: MessageEvent) => {
  const { id, type } = ev.data;
  if (ev.data.islands) islands = ev.data.islands;
  try {
    let result: any, transfer: Transferable[] = [];
    if (type === "image") {
      image = ev.data.image; imageVersion++; cache = null;
      result = { palette: image ? imagePalette(rgbOf(image), 10) : [] };
    } else if (type === "night") {
      night = ev.data.image;
      result = {};
    } else if (type === "preview") {
      const s = previewSettings(ev.data.settings, ev.data.maxSide ?? 1200);
      const p = project(s, ev.data.stops);
      // Höhenkarte und Netz hängen im Helligkeitsmodus nicht vom Stapel ab: beim Verschieben der Wechsel
      // wird nur neu eingefärbt (schnell genug für eine Live-Vorschau).
      const mode = effectiveMode(p);
      const key = mode !== "color" && !islands.length ? JSON.stringify([imageVersion, reliefKey(s), mode]) : "";
      const hit = key !== "" && cache?.key === key ? cache : null;
      const hm = hit ? hit.hm : buildProject(p, renderDigits, s);
      if (!hit) cache = key ? { key, hm } : null;
      const est = effectiveStops(hm, p.stops);
      const sim = simulate(hm, est);
      const preview = toRGBA(sim, hm.width * hm.height);
      if (ev.data.lite) {
        (self as any).postMessage({ id, ok: true, result: { width: hm.width, height: hm.height, preview: preview.buffer } }, [preview.buffer]);
        return;
      }
      const c3 = hit?.small ? hit : null;
      const small = c3 ? c3.small! : downsample(hm, ev.data.maxSide3d ?? 600);
      const built = c3 ? c3.mesh! : heightmapToMesh(small);
      if (cache && cache.hm === hm && !c3) { cache.small = small; cache.mesh = built; }
      // Kopien versenden: die Puffer im Zwischenspeicher müssen hier bleiben
      const mesh = cache?.mesh === built ? { ...built, vertices: built.vertices.slice(), faces: built.faces.slice(), topIndex: built.topIndex.slice() } : built;
      const simSmall = simulate(small, est);
      const colors = new Float32Array((mesh.vertices.length / 3) * 3).fill(0.55);
      for (let v = 0; v < mesh.topIndex.length; v++) {
        const t = mesh.topIndex[v];
        if (t >= 0) colors.set(simSmall.subarray(t * 3, t * 3 + 3), v * 3);
      }
      const orig = new Float32Array(colors.length).fill(0.55);
      for (let v = 0; v < mesh.topIndex.length; v++) {
        const t = mesh.topIndex[v];
        if (t >= 0) orig.set(small.rgb.subarray(t * 3, t * 3 + 3), v * 3);
      }
      const full = ev.data.settings as HeightSettings;
      const fullW = Math.round(full.width_mm / full.pixel_size_mm) + 1;
      result = {
        width: hm.width, height: hm.height, preview: preview.buffer,
        layerCount: layerCount(hm), minLayer: minLayer(hm), size: sizeMm(hm), maxZ: maxZ(hm),
        mode: effectiveMode(p), simStops: est, usage: filamentUsage(hm, est), stackLayers: hm.restLayers ?? layerCount(hm), border: hm.border_px,
        triangles: 2 * fullW * Math.round(fullW * hm.height / hm.width),
        mesh: { vertices: mesh.vertices.buffer, faces: mesh.faces.buffer, colors: colors.buffer, orig: orig.buffer, top: mesh.topIndex.buffer, size: sizeMm(small) },
      };
      transfer = [preview.buffer, mesh.vertices.buffer, mesh.faces.buffer, colors.buffer, orig.buffer, mesh.topIndex.buffer];
      if (night && ev.data.night) {
        const nr = nightResult(hm, est, s, ev.data.night);
        result.night = { preview: nr.preview.buffer, info: nr.info, through: nr.through, volume_mm3: nr.volume_mm3 };
        transfer.push(nr.preview.buffer);
      }
    } else if (type === "litho") {
      if (!image) throw new Error("Kein Bild geladen.");
      const full = ev.data.settings as HeightSettings, light = ev.data.light as LithoLight;
      if (ev.data.export) {
        const m = lithoMesh(lithoThickness(image, full), full);
        const stl = writeStl(m, `Chromalith Lithophanie ${ev.data.name ?? ""}`);
        result = { stl: stl.buffer, triangles: m.faces.length / 3, size: m.size, volume_mm3: meshVolume(m), note: m.note };
        transfer = [stl.buffer];
      } else {
        const s = previewSettings(full, 700);
        const th = lithoThickness(image, s);
        const preview = toRGBA(lithoSimulate(th, light), th.w * th.h);
        const m = lithoMesh(th, s, 420, true);
        const fullW = Math.round(full.width_mm / full.pixel_size_mm) + 1;
        result = { width: th.w, height: th.h, preview: preview.buffer, size: m.size, note: m.note, volume_mm3: meshVolume(m),
          triangles: Math.round((m.faces.length / 3) * Math.max(1, (fullW / th.w)) ** 2),
          mesh: { vertices: m.vertices.buffer, faces: m.faces.buffer, thick: m.thick.buffer, thickS: m.thickS.buffer, baseN: m.baseN.buffer } };
        transfer = [preview.buffer, m.vertices.buffer, m.faces.buffer, m.thick.buffer, m.thickS.buffer, m.baseN.buffer];
      }
    } else if (type === "lenti") {
      if (!image) throw new Error("Kein Bild geladen.");
      const s = ev.data.settings as HeightSettings, pal = ev.data.palette as Filament[], colors = pal.map((f) => f.color);
      const model = lentiModel(image, night, colors, s), print = lentiPrint(model);
      if (ev.data.export) {
        const { base, parts } = lentiParts(model, colors.length);
        const baseStl = writeStl(base, "Chromalith Lentikular Grundplatte");
        const stls = parts.map((m, k) => (m ? writeStl(m, `Chromalith Lentikular Teil ${k + 1}`) : null));
        // Ansichten von links und rechts, etwas jenseits des Winkels, ab dem nur noch ein Bild zu sehen ist
        const angle = Math.min(80, lentiPureAngle(model) + 5);
        const views = [angle, -angle].map((a) => { const v = lentiView(model, pal, a); return { rgba: toRGBA(v.rgb, v.width * v.height).buffer, width: v.width, height: v.height }; });
        result = { base: baseStl.buffer, parts: stls.map((u) => (u ? u.buffer : null)), views, model, print,
          triangles: base.faces.length / 3 + parts.reduce((n, m) => n + (m ? m.faces.length / 3 : 0), 0) };
        transfer = [baseStl.buffer, ...stls.filter((u): u is Uint8Array => !!u).map((u) => u.buffer), ...views.map((v) => v.rgba)];
      } else {
        const pm = lentiPreviewMesh(model, pal);
        result = { model, print, mesh: { vertices: pm.vertices.buffer, faces: pm.faces.buffer, colors: pm.colors.buffer } };
        transfer = [pm.vertices.buffer, pm.faces.buffer, pm.colors.buffer];
      }
    } else if (type === "suggest") {
      if (!image) throw new Error("Kein Bild geladen.");
      const s = previewSettings(ev.data.settings, 220);
      const { w, h, rgb, alpha } = prepareImage(image, s);
      const lab = labSample(rgb, w, h, 72, alpha);
      let last = 0;
      const r = suggestStack(lab, rgb, ev.data.library as Filament[], {
        count: ev.data.count, base: s.base_layer_mm, step: s.layer_height_mm, minH: s.min_height_mm, maxH: s.max_height_mm,
        onProgress: (f) => { if (f - last > 0.02) { last = f; (self as any).postMessage({ id, progress: f }); } },
      }, (ev.data.mode ?? "auto") as SuggestMode);
      if (!r) throw new Error("Zu wenige Filamente für einen Vorschlag.");
      const cur = ev.data.stops as ColorStop[];
      const currentError = cur.length ? colorError(lab, cur, s.base_layer_mm, s.layer_height_mm, s.min_height_mm, s.max_height_mm) : null;
      result = { stops: r.stops, error: r.error, currentError, order: r.order, bestError: r.bestError };
    } else if (type === "auto") {
      const s = previewSettings(ev.data.settings, 600);
      result = { stops: autoDistribute(project(s, ev.data.stops), s, renderDigits) };
    } else if (type === "export") {
      const p = project(ev.data.settings, ev.data.stops, ev.data.name);
      const hm = buildProject(p, renderDigits);
      const est = effectiveStops(hm, p.stops);
      const mesh = heightmapToMesh(hm);
      const stl = writeStl(mesh, `Chromalith ${ev.data.name}`);
      const sim = simulate(hm, est);
      const preview = toRGBA(sim, hm.width * hm.height);
      // Tag-und-Nacht-Bild: die Rückplatte als zweites Teil, gleicher Umriss und gleiche Lage wie das Tagbild
      let nightOut: any = null;
      const extra: Transferable[] = [];
      if (night && ev.data.night) {
        const nr = nightResult(hm, est, ev.data.settings, ev.data.night);
        const nm = heightmapToMesh(nightPlate(hm, nr.t));
        const nstl = writeStl(nm, `Chromalith Nachtbild ${ev.data.name}`);
        nightOut = { stl: nstl.buffer, preview: nr.preview.buffer, info: nr.info, through: nr.through, volume_mm3: meshVolume(nm), triangles: nm.faces.length / 3 };
        extra.push(nstl.buffer, nr.preview.buffer);
      }
      write3mf(mesh, hm, est, ev.data.name, ev.data.slicer ?? {}).then(({ data: tmf, info }) => {
        const result = { stl: stl.buffer, threemf: tmf.buffer, threemfInfo: info, report: planReport(hm, est, ev.data.name),
          json: JSON.stringify(planJson(hm, est), null, 2), preview: preview.buffer, width: hm.width, height: hm.height, night: nightOut };
        (self as any).postMessage({ id, ok: true, result }, [stl.buffer, tmf.buffer, preview.buffer, ...extra]);
      }, (e) => (self as any).postMessage({ id, ok: false, error: String(e?.message ?? e) }));
      return;
    }
    (self as any).postMessage({ id, ok: true, result }, transfer);
  } catch (e: any) {
    (self as any).postMessage({ id, ok: false, error: String(e?.message ?? e) });
  }
};

function rgbOf(r: Raster): Float32Array {
  // für die Analyse auf max. 400 px verkleinert
  const f = Math.max(1, Math.ceil(Math.max(r.width, r.height) / 400));
  const out: number[] = [];
  for (let y = 0; y < r.height; y += f) for (let x = 0; x < r.width; x += f) {
    const i = (y * r.width + x) * 4;
    if (r.data[i + 3] < 0.5) continue;
    out.push(r.data[i], r.data[i + 1], r.data[i + 2]);
  }
  return Float32Array.from(out);
}
