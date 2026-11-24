/// <reference lib="webworker" />
/** Rechen-Worker: hält das Bild und rechnet Höhenkarte, Vorschau, Analyse und Export,
 *  ohne die Oberfläche zu blockieren. */
import {
  autoDistribute, buildProject, colorError, labSample, prepareImage, suggestFilaments, type Filament, downsample, effectiveMode, filamentUsage, heightmapToMesh, imagePalette, layerCount,
  maxZ, minLayer, planJson, planReport, simulate, sizeMm, writeStl, type ColorStop, type DigitRenderer,
  type HeightSettings, type Project, type Raster,
} from "./core";

let image: Raster | null = null;

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

const project = (settings: HeightSettings, stops: ColorStop[], name = ""): Project =>
  ({ name, image, imagePng: null, settings, stops });

function previewSettings(s: HeightSettings, maxSide: number): HeightSettings {
  return { ...s, pixel_size_mm: Math.max(s.pixel_size_mm, s.width_mm / maxSide) };
}

self.onmessage = (ev: MessageEvent) => {
  const { id, type } = ev.data;
  try {
    let result: any, transfer: Transferable[] = [];
    if (type === "image") {
      image = ev.data.image;
      result = { palette: image ? imagePalette(rgbOf(image), 10) : [] };
    } else if (type === "preview") {
      const s = previewSettings(ev.data.settings, ev.data.maxSide ?? 1200);
      const p = project(s, ev.data.stops);
      const hm = buildProject(p, renderDigits, s);
      const sim = simulate(hm, p.stops);
      const preview = toRGBA(sim, hm.width * hm.height);
      if (ev.data.lite) {
        (self as any).postMessage({ id, ok: true, result: { width: hm.width, height: hm.height, preview: preview.buffer } }, [preview.buffer]);
        return;
      }
      const small = downsample(hm, ev.data.maxSide3d ?? 360);
      const mesh = heightmapToMesh(small);
      const simSmall = simulate(small, p.stops);
      const colors = new Float32Array((mesh.vertices.length / 3) * 3).fill(0.55);
      for (let v = 0; v < mesh.topIndex.length; v++) {
        const t = mesh.topIndex[v];
        if (t >= 0) colors.set(simSmall.subarray(t * 3, t * 3 + 3), v * 3);
      }
      const full = ev.data.settings as HeightSettings;
      const fullW = Math.round(full.width_mm / full.pixel_size_mm) + 1;
      result = {
        width: hm.width, height: hm.height, preview: preview.buffer,
        layerCount: layerCount(hm), minLayer: minLayer(hm), size: sizeMm(hm), maxZ: maxZ(hm),
        mode: effectiveMode(p), usage: filamentUsage(hm, p.stops),
        triangles: 2 * fullW * Math.round(fullW * hm.height / hm.width),
        mesh: { vertices: mesh.vertices.buffer, faces: mesh.faces.buffer, colors: colors.buffer, size: sizeMm(small) },
      };
      transfer = [preview.buffer, mesh.vertices.buffer, mesh.faces.buffer, colors.buffer];
    } else if (type === "suggest") {
      if (!image) throw new Error("Kein Bild geladen.");
      const s = previewSettings(ev.data.settings, 160);
      const { w, h, rgb, alpha } = prepareImage(image, s);
      const lab = labSample(rgb, w, h, 40, alpha);
      let last = 0;
      const r = suggestFilaments(lab, rgb, ev.data.library as Filament[], {
        count: ev.data.count, base: s.base_layer_mm, step: s.layer_height_mm, minH: s.min_height_mm, maxH: s.max_height_mm,
        onProgress: (f) => { if (f - last > 0.02) { last = f; (self as any).postMessage({ id, progress: f }); } },
      });
      if (!r) throw new Error("Zu wenige Filamente für einen Vorschlag.");
      const cur = ev.data.stops as ColorStop[];
      const currentError = cur.length ? colorError(lab, cur, s.base_layer_mm, s.layer_height_mm, s.min_height_mm, s.max_height_mm) : null;
      result = { stops: r.stops, error: r.error, currentError };
    } else if (type === "auto") {
      const s = previewSettings(ev.data.settings, 600);
      result = { stops: autoDistribute(project(s, ev.data.stops), s, renderDigits) };
    } else if (type === "export") {
      const p = project(ev.data.settings, ev.data.stops, ev.data.name);
      const hm = buildProject(p, renderDigits);
      const stl = writeStl(heightmapToMesh(hm), `Chromalith ${ev.data.name}`);
      const sim = simulate(hm, p.stops);
      const preview = toRGBA(sim, hm.width * hm.height);
      result = { stl: stl.buffer, report: planReport(hm, p.stops, ev.data.name), json: JSON.stringify(planJson(hm, p.stops), null, 2),
        preview: preview.buffer, width: hm.width, height: hm.height };
      transfer = [stl.buffer as ArrayBuffer, preview.buffer];
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
