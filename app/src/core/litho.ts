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
/** `mounted`: Deckel aufgeschraubt zeigen (Vorschau) statt daneben gestellt (Druck). */
export function lithoMesh(th: LithoThickness, s: HeightSettings, maxSide = Infinity, mounted = false): LithoMesh {
  const form = s.litho_form, W = s.width_mm, aspect = th.h / th.w, hi = Math.max(s.litho_min_mm + 0.1, s.litho_max_mm);
  let nu: number, nv: number, wrap = false, note = "";
  /** Punkt bei (u, v) im Abstand d von der Innenfläche nach außen */
  let pos: (u: number, v: number, d: number, out: Float32Array, o: number) => void;
  type Src = { w: number; h: number; t: Float32Array };
  let thickAt = (u: number, v: number, src: Src) => bilinear(src, u, v);
  const blurred: Src = { w: th.w, h: th.h, t: th.ts };
  const res = (len: number) => Math.max(2, Math.round(len / s.pixel_size_mm) + 1);
  // Bild auf Kugel und Zylinder: Breite als Winkel, Höhe aus dem Seitenverhältnis – so wird nichts gestreckt.
  const TAU = 2 * Math.PI;
  const copies = s.litho_repeat ? Math.max(1, Math.round(360 / Math.min(360, Math.max(20, s.litho_img_deg)))) : 1;
  const imgA = s.litho_repeat ? TAU / copies : (Math.min(360, Math.max(20, s.litho_img_deg)) * Math.PI) / 180;
  const lon0 = (s.litho_img_x * Math.PI) / 180, offY = Math.min(1, Math.max(-1, s.litho_img_y / 100));
  const wrapPi = (a: number) => a - TAU * Math.round(a / TAU);
  /** weicher Übergang zur dicken (dunklen) Wand am Bildrand; du, dv = Abstand zum Rand in mm */
  const rest = Math.min(hi, Math.max(0.4, s.litho_rest_mm));
  const soften = (t: number, edge: number) => (edge < 1 ? rest + (t - rest) * Math.max(0, edge) : t);
  let cap: { ro: number; zb: number; zt: number } | null = null;
  if (form === "cylinder") {
    const R = Math.max(5, W / 2 - hi), Ro = R + hi, Hi = Ro * imgA * aspect;
    const H = s.litho_height_mm > 0 ? Math.max(10, s.litho_height_mm) : Hi, zc = H / 2 + offY * (H / 2);
    nu = res(TAU * Ro) - 1; nv = res(H); wrap = true;
    note = `Zylinder: Durchmesser außen ${W.toFixed(0)} mm, Höhe ${H.toFixed(0)} mm.` + (copies > 1 ? ` Das Bild läuft ${copies}-mal rundum.` : imgA >= TAU - 1e-6 ? " Das Bild läuft einmal rundum." : "");
    pos = (u, v, d, out, o) => { const a = u * TAU, r = R + d; out[o] = r * Math.sin(a); out[o + 1] = -r * Math.cos(a); out[o + 2] = (1 - v) * H; };
    const full = s.litho_repeat || imgA >= TAU - 1e-6;
    thickAt = (u, v, src) => {
      let iu = wrapPi(u * TAU - lon0) / imgA + 0.5;
      if (full) iu -= Math.floor(iu);
      const iv = 0.5 - ((1 - v) * H - zc) / Hi;
      if (iu < 0 || iu > 1 || iv < 0 || iv > 1) return rest;
      const t = bilinear(src, iu, iv);
      return soften(t, Math.min(full ? Infinity : Math.min(iu, 1 - iu) * imgA * Ro, Hi >= H && !offY ? Infinity : Math.min(iv, 1 - iv) * Hi));
    };
  } else if (form === "sphere") {
    const R = Math.max(8, W / 2 - hi);
    // Mit Schraubdeckel: oben die Öffnung fürs Licht (plus Gewindetiefe), unten ein gleich großer flacher Boden als Standfläche
    const capR = Math.min(R * 0.7 - CAP.depth, Math.max(6, s.litho_cap_mm / 2));
    const topR = s.litho_cap ? capR + CAP.depth : 0.35, holeR = s.litho_cap ? topR : Math.max(0.35, s.litho_hole_mm / 2);
    const latTop = Math.acos(Math.min(1, topR / R)), latBot = -Math.acos(Math.min(1, holeR / R));
    nu = res(TAU * (R + hi)) - 1; nv = res((latTop - latBot) * (R + hi)); wrap = true;
    note = `Kugel: Durchmesser außen ${W.toFixed(0)} mm.` + (copies > 1 ? ` Das Bild läuft ${copies}-mal rundum.` : "") + " Außerhalb des Bildes ist die Wand dick und bleibt dunkel." +
      (s.litho_cap ? ` Oben Öffnung ${(2 * capR).toFixed(0)} mm mit Innengewinde, Deckel mit Öse als zweites Teil, unten flacher Boden fürs Licht. In der STL steht die Kugel auf dem Kopf: so drucken.`
        : s.litho_hole_mm > 0.7 ? ` Öffnung unten ${s.litho_hole_mm.toFixed(0)} mm.` : "");
    const lat = (v: number) => latTop + (latBot - latTop) * v;
    pos = (u, v, d, out, o) => { const a = u * TAU, la = lat(v), r = R + d; out[o] = r * Math.cos(la) * Math.sin(a); out[o + 1] = -r * Math.cos(la) * Math.cos(a); out[o + 2] = r * Math.sin(la) + R + hi; };
    const lat0 = offY * (Math.PI / 3), imgH = imgA * aspect;
    // Mitte des Bildes und die Richtungen „rechts“ und „oben“ dort (für das Aufsetzen wie ein Aufkleber)
    const C = [Math.cos(lat0) * Math.sin(lon0), -Math.cos(lat0) * Math.cos(lon0), Math.sin(lat0)];
    const E = [Math.cos(lon0), Math.sin(lon0), 0], N = [-Math.sin(lat0) * Math.sin(lon0), Math.sin(lat0) * Math.cos(lon0), Math.cos(lat0)];
    thickAt = (u, v, src) => {
      const a = u * TAU, la = lat(v);
      let iu: number, iv: number;
      if (s.litho_repeat) {
        // rundum: am Äquator maßstabsgetreu
        iu = wrapPi(a - lon0) / imgA + 0.5; iu -= Math.floor(iu);
        iv = 0.5 - (la - lat0) / imgH;
      } else {
        // einmal aufgesetzt: Abstände von der Bildmitte bleiben erhalten, dadurch wird das Bild nicht gestreckt
        const P = [Math.cos(la) * Math.sin(a), -Math.cos(la) * Math.cos(a), Math.sin(la)];
        const dot = Math.min(1, Math.max(-1, P[0] * C[0] + P[1] * C[1] + P[2] * C[2])), th0 = Math.acos(dot);
        const k = th0 < 1e-6 ? 1 : th0 / Math.sin(th0);
        if (th0 > Math.PI * 0.97) return rest;
        iu = 0.5 + ((P[0] * E[0] + P[1] * E[1]) * k) / imgA;
        iv = 0.5 - ((P[0] * N[0] + P[1] * N[1] + P[2] * N[2]) * k) / imgH;
      }
      if (iu < 0 || iu > 1 || iv < 0 || iv > 1) return rest;
      const t = bilinear(src, iu, iv);
      return soften(t, Math.min(s.litho_repeat ? Infinity : Math.min(iu, 1 - iu) * imgA * R, Math.min(iv, 1 - iv) * imgH * R));
    };
    if (s.litho_cap) cap = { ro: capR, zb: Math.sqrt(R * R - topR * topR), zt: 0 };
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
  if (form === "sphere") {
    const Ro = hi + Math.max(8, W / 2 - hi);
    if (cap) addCap(mesh, cap.ro, cap.zb, Ro, W, s.litho_loop, mounted);
    else if (s.litho_loop) addLoop(mesh, W, 0, 2 * Ro - Math.max(1.2, W * 0.022) * 1.2);
  }
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.vertices.length; i += 3) for (let c = 0; c < 3; c++) { const x = mesh.vertices[i + c]; if (x < mn[c]) mn[c] = x; if (x > mx[c]) mx[c] = x; }
  mesh.size = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
  return mesh;
}

/** Hängt ein eigenes, geschlossenes Teil an das Netz an (der Slicer verschmilzt überlappende Teile). */
function addPart(m: LithoMesh, v: number[], f: number[]) {
  const base = m.vertices.length / 3, n = v.length / 3;
  const nv = new Float32Array(m.vertices.length + v.length); nv.set(m.vertices); nv.set(v, m.vertices.length);
  const nf = new Uint32Array(m.faces.length + f.length); nf.set(m.faces); for (let i = 0; i < f.length; i++) nf[m.faces.length + i] = f[i] + base;
  const nt = new Float32Array(m.thick.length + n).fill(99); nt.set(m.thick);
  const ns = new Float32Array(nt.length).fill(99); ns.set(m.thickS);
  const nb = new Float32Array(nt.length * 3); nb.set(m.baseN);
  for (let i = m.thick.length; i < nt.length; i++) nb[i * 3 + 2] = 1;
  const ti = new Int32Array(m.topIndex.length + n).fill(-1); ti.set(m.topIndex);
  m.vertices = nv; m.faces = nf; m.thick = nt; m.thickS = ns; m.baseN = nb; m.topIndex = ti;
}

/** Aufhänge-Öse: ein stehender Ring um (cx, 0, cz + Ringradius), der unten in das Teil darunter hineinragt. */
function addLoop(m: LithoMesh, W: number, cx: number, zBase: number) {
  const ringR = Math.max(3, W * 0.06), tube = Math.max(1.2, W * 0.022), seg = 28, sides = 12;
  const cz = zBase + ringR;
  const v: number[] = [], f: number[] = [];
  for (let i = 0; i < seg; i++) for (let j = 0; j < sides; j++) {
    const a = (i / seg) * 2 * Math.PI, b = (j / sides) * 2 * Math.PI, r = ringR + tube * Math.cos(b);
    v.push(cx + r * Math.cos(a), tube * Math.sin(b), cz + r * Math.sin(a));
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < sides; j++) {
    const i2 = (i + 1) % seg, j2 = (j + 1) % sides;
    const a = i * sides + j, b = i2 * sides + j, c = i2 * sides + j2, d = i * sides + j2;
    f.push(a, c, b, a, d, c);
  }
  addPart(m, v, f);
}

/** Rohr um die Z-Achse durch (cx, 0) mit frei geformter Innen- und Außenwand (Radius je Winkel und Höhe); rin = null: massiv. */
function tube(cx: number, z0: number, z1: number, rin: ((a: number, z: number) => number) | null, rout: (a: number, z: number) => number, seg = 96, nz = 24) {
  const v: number[] = [], f: number[] = [], rows = nz + 1;
  const ring = (r: (a: number, z: number) => number) => {
    for (let j = 0; j < rows; j++) for (let i = 0; i < seg; i++) {
      const a = (i / seg) * 2 * Math.PI, z = z0 + ((z1 - z0) * j) / nz, rr = r(a, z);
      v.push(cx + rr * Math.cos(a), rr * Math.sin(a), z);
    }
  };
  ring(rout);
  const inner = rin ? seg * rows : -1;
  if (rin) ring(rin); else { v.push(cx, 0, z0, cx, 0, z1); }
  for (let i = 0; i < seg; i++) {
    const i2 = (i + 1) % seg;
    for (let j = 0; j < nz; j++) {
      const a = j * seg + i, b = j * seg + i2, c = (j + 1) * seg + i2, d = (j + 1) * seg + i;
      f.push(a, b, c, a, c, d);
      if (rin) f.push(inner + a, inner + c, inner + b, inner + a, inner + d, inner + c);
    }
    const top = nz * seg;
    if (rin) {
      f.push(top + i, top + i2, inner + top + i2, top + i, inner + top + i2, inner + top + i); // oben
      f.push(i2, i, inner + i, i2, inner + i, inner + i2); // unten
    } else {
      const cb = seg * rows, ct = cb + 1;
      f.push(top + i, top + i2, ct, i2, i, cb);
    }
  }
  return { v, f };
}

/** Schraubverschluss der Kugel. Oben sitzt ein Kragen mit Innengewinde, unten ein flacher Boden gleicher Größe, auf dem
 *  das Licht steht. Der Deckel ist ein eigenes Teil: Stopfen mit Außengewinde, Rand und (auf Wunsch) Öse.
 *  Gedruckt wird die Kugel auf dem Kopf, also auf der ebenen Gewindeseite; der Deckel steht auf dem Gewinde, die
 *  Unterseite seines Rands ist 45° schräg und braucht keine Stützen. Rundgewinde, 3,5 mm Steigung, 0,35 mm Spiel. */
export const CAP = { wall: 2.4, depth: 1.3, pitch: 3.5, play: 0.35, turns: 8, lid: 2 };
function addCap(m: LithoMesh, ro: number, zin: number, Ro: number, W: number, loop: boolean, mounted: boolean) {
  const prof = (a: number, z: number) => 0.5 * (1 + Math.cos(2 * Math.PI * (z / CAP.pitch - a / (2 * Math.PI))));
  const rc = ro + CAP.depth + CAP.wall; // Außenradius des Kragens
  // ebene Oberkante knapp über der Kugel, der Kragen reicht von dort nach innen
  const zt = Ro + Math.sqrt(Math.max(0, Ro * Ro - rc * rc)) + 1.5, zc = zt - CAP.turns;
  const collar = tube(0, zc, zt, (a, z) => ro + CAP.depth * prof(a, z), () => rc, 96, Math.round(CAP.turns / 0.3));
  addPart(m, collar.v, collar.f);
  // flacher Boden: füllt die untere Öffnung, Oberseite = Standfläche fürs Licht
  const rIn = ro + CAP.depth, zFloorTop = Ro - zin, zFloorBot = Ro - (Ro * zin) / (Ro - (Ro - Math.hypot(zin, rIn)));
  const floor = tube(0, Math.min(zFloorBot, zFloorTop - 1.6), zFloorTop, null, () => (rIn * Ro) / Math.hypot(zin, rIn) + 0.2, 96, 1);
  addPart(m, floor.v, floor.f);
  let dx = 0, z0 = zt - CAP.turns + 0.8;
  if (!mounted) {
    // Druckstellung: Kugel auf den Kopf (halbe Drehung um X), Gewindeseite auf das Bett; Deckel daneben
    for (let i = 0; i < m.vertices.length; i += 3) { m.vertices[i + 1] = -m.vertices[i + 1]; m.vertices[i + 2] = zt - m.vertices[i + 2]; }
    for (let i = 0; i < m.baseN.length; i += 3) { m.baseN[i + 1] = -m.baseN[i + 1]; m.baseN[i + 2] = -m.baseN[i + 2]; }
    dx = Ro + rc + 8; z0 = 0;
  }
  // Deckel: Stopfen mit Außengewinde (hohl), darüber der Rand mit schräger Unterseite, obenauf die Öse
  const hPlug = CAP.turns - 0.8, rp = ro - CAP.play, rf = rc + 1;
  const plug = tube(dx, z0, z0 + hPlug + 0.2, () => Math.max(2, rp - CAP.wall), (a, z) => rp + CAP.depth * prof(a, z - z0 + (mounted ? z0 : 0)) * Math.min(1, Math.max(0.15, (z - z0) / 1.2)), 96, Math.round(hPlug / 0.3));
  addPart(m, plug.v, plug.f);
  const hCh = rf - rp, zl = z0 + hPlug;
  const lid = tube(dx, zl, zl + hCh + CAP.lid, null, (a, z) => Math.min(rf + 0.3 * Math.cos(a * 24), rp + (z - zl)), 96, Math.max(8, Math.round((hCh + CAP.lid) / 0.4)));
  addPart(m, lid.v, lid.f);
  if (loop) addLoop(m, W, dx, zl + hCh + CAP.lid - Math.max(1.2, W * 0.022) * 1.2);
}
