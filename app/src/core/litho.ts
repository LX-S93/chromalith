/** Lithophanie: Bild -> Wandstärke (dunkel = dick), Körper in vier Formen und Simulation mit Licht von hinten. */
import { hexToRgb, linearToSrgb, srgbToLinear } from "./color";
import { adjustTone, detailKernel, luminance, prepareImage, type HeightSettings } from "./heightmap";
import { OPACITY_K } from "./plan";
import { gaussianBlur, medianFilter, type Raster } from "./raster";
import type { Mesh } from "./mesh";

export const LITHO_FORMS = { flat: "Flach (Bild, Fensterbild)", curved: "Gebogen (steht von selbst)", cylinder: "Zylinder (Lampenschirm)", sphere: "Kugel (Ornament)" } as const;
export type LithoForm = keyof typeof LITHO_FORMS;

export interface LithoThickness { w: number; h: number; t: Float32Array; alpha: Float32Array;
  /** Wandstärke, über die Streuweite des Materials gemittelt: Licht wird in der Wand gestreut und verwischt feine Details. */
  ts: Float32Array; }

/** Blau wird in weißem Kunststoff stärker gestreut und geschluckt als Rot: dicke Stellen wirken wärmer. */
export const LITHO_SPECTRUM: [number, number, number] = [0.9, 1.0, 1.22];
/** Anteil des Lichts, der gestreut (verwischt) statt geradlinig durch die Wand kommt. */
export const LITHO_SCATTER = 0.55;

/** Filmic-Tonemapping (ACES-Näherung), wie es Kameras und das Auge bei hellen Lichtern tun. */
export const acesTone = (x: number) => Math.min(1, Math.max(0, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)));

/** Wandstärke je Bildpunkt in mm. Nutzt Helligkeit, Kontrast, Gamma und Glättung wie das Farbrelief. */
export function lithoThickness(img: Raster, s: HeightSettings): LithoThickness {
  const { w, h, rgb, alpha } = prepareImage(img, { ...s, shape: "rect" });
  let lum = luminance(rgb, s.luma_method, s.linearize);
  lum = medianFilter(lum, w, h, detailKernel(s));
  lum = gaussianBlur(lum, w, h, s.smoothing_px);
  const lo = s.litho_min_mm, hi = Math.max(lo + 0.1, s.litho_max_mm);
  const t = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    let v = adjustTone(lum[i], s);
    if (s.litho_invert) v = 1 - v;
    t[i] = alpha[i] < 0.5 ? hi : lo + (1 - v) * (hi - lo);
  }
  // Streuweite etwa ein Drittel der mittleren Wandstärke
  const sigma = Math.max(0.6, ((lo + hi) / 2) * 0.33 / (s.width_mm / Math.max(1, w - 1)));
  return { w, h, t, alpha, ts: gaussianBlur(t, w, h, sigma) };
}

/** Durchscheinende Farbe (sRGB 0..1) bei Wandstärke t: Licht × Filamentfarbe × Abschwächung. */
export function lithoTransmit(t: number, filamentColor: string, td: number, light: string, intensity: number): [number, number, number] {
  const f = hexToRgb(filamentColor).map(srgbToLinear), l = hexToRgb(light).map(srgbToLinear);
  // Beer-Lambert: bei t = TD kommen noch 5 % durch; farbige Filamente färben stärker, je dicker die Wand ist
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const a = Math.exp((-OPACITY_K * LITHO_SPECTRUM[c] * t) / Math.max(td, 0.05));
    const tint = Math.pow(Math.max(f[c], 0.02), Math.min(1.5, t / Math.max(td, 0.05) + 0.15));
    out[c] = linearToSrgb(acesTone(l[c] * intensity * 1.6 * a * tint));
  }
  return out;
}

export interface LithoLight { filamentColor: string; td: number; light: string; intensity: number }

/** Flache Vorschau im Gegenlicht (sRGB, 3/Punkt). */
export function lithoSimulate(th: LithoThickness, o: LithoLight): Float32Array {
  const out = new Float32Array(th.w * th.h * 3);
  // Abschwächung über eine Tabelle, damit große Bilder schnell bleiben
  const N = 256, lo = 0, hi = 12, lut = new Float32Array(N * 3);
  for (let k = 0; k < N; k++) lut.set(lithoTransmit(lo + ((hi - lo) * k) / (N - 1), o.filamentColor, o.td, o.light, o.intensity), k * 3);
  for (let i = 0; i < th.w * th.h; i++) {
    const te = th.t[i] + (th.ts[i] - th.t[i]) * LITHO_SCATTER;
    const k = Math.min(N - 1, Math.max(0, Math.round(((te - lo) / (hi - lo)) * (N - 1))));
    out[i * 3] = lut[k * 3]; out[i * 3 + 1] = lut[k * 3 + 1]; out[i * 3 + 2] = lut[k * 3 + 2];
  }
  return out;
}

export interface LithoMesh extends Mesh {
  /** Wandstärke je Vertex (für die Farbe in der 3D-Ansicht); Innenseite = -1 */
  thick: Float32Array;
  /** gestreute (verwischte) Wandstärke je Vertex */
  thickS: Float32Array;
  /** Richtung von der Innen- zur Außenfläche je Vertex (glatte Flächennormale ohne Relief) */
  baseN: Float32Array;
  size: [number, number, number];
  note: string;
}

const bilinear = (th: { w: number; h: number; t: Float32Array }, u: number, v: number): number => {
  const x = Math.min(th.w - 1, Math.max(0, u * (th.w - 1))), y = Math.min(th.h - 1, Math.max(0, v * (th.h - 1)));
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(th.w - 1, x0 + 1), y1 = Math.min(th.h - 1, y0 + 1), fx = x - x0, fy = y - y0;
  return th.t[y0 * th.w + x0] * (1 - fx) * (1 - fy) + th.t[y0 * th.w + x1] * fx * (1 - fy) + th.t[y1 * th.w + x0] * (1 - fx) * fy + th.t[y1 * th.w + x1] * fx * fy;
};

/** Baut den Körper. Das Relief liegt außen, die Innenseite (zum Licht) ist glatt. Z zeigt nach oben. */
export function lithoMesh(th: LithoThickness, s: HeightSettings, maxSide = Infinity): LithoMesh {
  const form = s.litho_form, W = s.width_mm, aspect = th.h / th.w, hi = Math.max(s.litho_min_mm + 0.1, s.litho_max_mm);
  let nu: number, nv: number, wrap = false, note = "";
  /** Punkt bei (u, v) im Abstand d von der Innenfläche nach außen */
  let pos: (u: number, v: number, d: number, out: Float32Array, o: number) => void;
  type Src = { w: number; h: number; t: Float32Array };
  let thickAt = (u: number, v: number, src: Src) => bilinear(src, u, v);
  const blurred: Src = { w: th.w, h: th.h, t: th.ts };
  const res = (len: number) => Math.max(2, Math.round(len / s.pixel_size_mm) + 1);
  if (form === "cylinder") {
    const R = Math.max(5, W / 2 - hi), H = 2 * Math.PI * (R + hi) * aspect;
    nu = res(2 * Math.PI * (R + hi)) - 1; nv = res(H); wrap = true;
    note = `Zylinder: Durchmesser außen ${W.toFixed(0)} mm, Höhe ${H.toFixed(0)} mm (aus dem Seitenverhältnis des Bildes). Das Bild läuft einmal rundum.`;
    pos = (u, v, d, out, o) => { const a = -u * 2 * Math.PI, r = R + d; out[o] = r * Math.sin(a) * -1; out[o + 1] = -r * Math.cos(a); out[o + 2] = (1 - v) * H; };
  } else if (form === "sphere") {
    const R = Math.max(8, W / 2 - hi), band = (Math.min(80, Math.max(20, s.litho_band_deg)) * Math.PI) / 180;
    const holeR = Math.max(0.35, s.litho_hole_mm / 2), topR = 0.35;
    const latTop = Math.acos(Math.min(1, topR / R)), latBot = -Math.acos(Math.min(1, holeR / R));
    nu = res(2 * Math.PI * (R + hi)) - 1; nv = res((latTop - latBot) * (R + hi)); wrap = true;
    note = `Kugel: Durchmesser außen ${W.toFixed(0)} mm. Das Bild läuft einmal rundum; oben und unten ist die Wand dick und bleibt dunkel.` +
      (s.litho_hole_mm > 0.7 ? ` Öffnung unten ${s.litho_hole_mm.toFixed(0)} mm für das Licht.` : "");
    const lat = (v: number) => latTop + (latBot - latTop) * v;
    pos = (u, v, d, out, o) => { const a = u * 2 * Math.PI, la = lat(v), r = R + d; out[o] = r * Math.cos(la) * Math.sin(a); out[o + 1] = -r * Math.cos(la) * Math.cos(a); out[o + 2] = r * Math.sin(la) + R + hi; };
    thickAt = (u, v, src) => {
      const la = lat(v), k = (band - la) / (2 * band); // 0 = oberer Bildrand
      if (k < 0 || k > 1) return hi;
      // weicher Übergang zum dicken Rand
      const edge = Math.min(k, 1 - k) * 2 * band * R, t = bilinear(src, u, k);
      return edge < 1 ? hi + (t - hi) * edge : t;
    };
  } else if (form === "curved") {
    const A = (Math.min(300, Math.max(20, s.litho_angle_deg)) * Math.PI) / 180, R = W / A, H = W * aspect;
    nu = res(W); nv = res(H);
    note = `Gebogen: Bogenlänge ${W.toFixed(0)} mm, Höhe ${H.toFixed(0)} mm, Radius ${R.toFixed(0)} mm.`;
    pos = (u, v, d, out, o) => { const a = (u - 0.5) * A, r = R + d; out[o] = r * Math.sin(a); out[o + 1] = R - r * Math.cos(a); out[o + 2] = (1 - v) * H; };
  } else {
    const H = W * aspect;
    nu = res(W); nv = res(H);
    note = `Flach: ${W.toFixed(0)} × ${H.toFixed(0)} mm. Am besten stehend drucken (hochkant), dann werden die Helligkeitsstufen am feinsten.`;
    pos = (u, v, d, out, o) => { out[o] = u * W; out[o + 1] = -d; out[o + 2] = (1 - v) * H; };
  }
  // Auflösung für die Vorschau begrenzen
  const f = Math.max(1, Math.max(nu, nv) / maxSide);
  nu = Math.max(wrap ? 8 : 2, Math.round(nu / f)); nv = Math.max(2, Math.round(nv / f));
  const cols = nu, n = cols * nv;
  const vertices = new Float32Array(2 * n * 3), thick = new Float32Array(2 * n).fill(-1), topIndex = new Int32Array(2 * n).fill(-1);
  const thickS = new Float32Array(2 * n).fill(-1), baseN = new Float32Array(2 * n * 3);
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < cols; i++) {
      const u = wrap ? i / cols : i / (cols - 1), v = j / (nv - 1), k = j * cols + i;
      const t = thickAt(u, v, th);
      pos(u, v, t, vertices, k * 3); pos(u, v, 0, vertices, (n + k) * 3);
      thick[k] = t; thickS[k] = thickAt(u, v, blurred); topIndex[k] = k;
      let nx = vertices[k * 3] - vertices[(n + k) * 3], ny = vertices[k * 3 + 1] - vertices[(n + k) * 3 + 1], nz = vertices[k * 3 + 2] - vertices[(n + k) * 3 + 2];
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      baseN.set([nx, ny, nz], k * 3); baseN.set([nx, ny, nz], (n + k) * 3);
    }
  const faces: number[] = [];
  const iu = wrap ? cols : cols - 1;
  for (let j = 0; j < nv - 1; j++)
    for (let i = 0; i < iu; i++) {
      const i2 = (i + 1) % cols;
      const a = (j + 1) * cols + i, b = (j + 1) * cols + i2, c = j * cols + i2, d = j * cols + i;
      faces.push(a, b, c, a, c, d); // außen
      faces.push(a + n, c + n, b + n, a + n, d + n, c + n); // innen
    }
  // Ränder schließen: oben (j = 0) und unten (j = nv-1), bei offenen Formen auch links und rechts
  for (let i = 0; i < iu; i++) {
    const i2 = (i + 1) % cols;
    let p = i, q = i2; faces.push(p, q, q + n, p, q + n, p + n);
    p = (nv - 1) * cols + i; q = (nv - 1) * cols + i2; faces.push(q, p, p + n, q, p + n, q + n);
  }
  if (!wrap) for (let j = 0; j < nv - 1; j++) {
    let p = j * cols, q = (j + 1) * cols; faces.push(q, p, p + n, q, p + n, q + n);
    p = j * cols + cols - 1; q = (j + 1) * cols + cols - 1; faces.push(p, q, q + n, p, q + n, p + n);
  }
  const mesh: LithoMesh = { vertices, faces: Uint32Array.from(faces), topIndex, thick, thickS, baseN, size: [0, 0, 0], note };
  if (form === "sphere" && s.litho_loop) addLoop(mesh, hi + Math.max(8, W / 2 - hi), W);
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.vertices.length; i += 3) for (let c = 0; c < 3; c++) { const x = mesh.vertices[i + c]; if (x < mn[c]) mn[c] = x; if (x > mx[c]) mx[c] = x; }
  mesh.size = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
  return mesh;
}

/** Aufhänge-Öse oben auf der Kugel: ein stehender Ring, der in die Kugel hineinragt (der Slicer verschmilzt beides). */
function addLoop(m: LithoMesh, rOuter: number, W: number) {
  const ringR = Math.max(3, W * 0.06), tube = Math.max(1.2, W * 0.022), seg = 28, sides = 12;
  const cz = 2 * rOuter + ringR - tube * 1.2; // Mitte des Rings knapp über dem Pol
  const base = m.vertices.length / 3;
  const v: number[] = [], f: number[] = [];
  for (let i = 0; i < seg; i++) for (let j = 0; j < sides; j++) {
    const a = (i / seg) * 2 * Math.PI, b = (j / sides) * 2 * Math.PI, r = ringR + tube * Math.cos(b);
    v.push(r * Math.cos(a), tube * Math.sin(b), cz + r * Math.sin(a));
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < sides; j++) {
    const i2 = (i + 1) % seg, j2 = (j + 1) % sides;
    const a = base + i * sides + j, b = base + i2 * sides + j, c = base + i2 * sides + j2, d = base + i * sides + j2;
    f.push(a, c, b, a, d, c);
  }
  const nv = new Float32Array(m.vertices.length + v.length); nv.set(m.vertices); nv.set(v, m.vertices.length);
  const nf = new Uint32Array(m.faces.length + f.length); nf.set(m.faces); nf.set(f, m.faces.length);
  const nt = new Float32Array(m.thick.length + v.length / 3).fill(99); nt.set(m.thick);
  const ns = new Float32Array(nt.length).fill(99); ns.set(m.thickS);
  const nb = new Float32Array(nt.length * 3); nb.set(m.baseN);
  for (let i = m.thick.length; i < nt.length; i++) nb[i * 3 + 2] = 1;
  m.thickS = ns; m.baseN = nb;
  const ti = new Int32Array(m.topIndex.length + v.length / 3).fill(-1); ti.set(m.topIndex);
  m.vertices = nv; m.faces = nf; m.thick = nt; m.topIndex = ti;
}
