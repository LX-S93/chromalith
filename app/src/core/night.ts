/** Tag-und-Nacht-Bild: Bei Licht von vorn sieht man das Farbrelief (Tagbild). Dahinter liegt eine zweite, einfarbige
 *  Platte, deren Dicke ein zweites Bild trägt: Mit Licht von hinten erscheint das Nachtbild.
 *
 *  Warum zwei Platten? Beim Farbrelief entsteht die Farbe aus der Höhe, jeder Bildpunkt hat also nur eine freie
 *  Größe. Zwei unabhängige Bilder brauchen zwei. Die zweite ist die Dicke der Rückplatte.
 *
 *  Das Tagbild lässt selbst unterschiedlich viel Licht durch (dicke Stellen weniger). Die Rückplatte gleicht das
 *  aus: wo das Tagbild viel Licht durchlässt, wird sie dicker. So erscheint das Nachtbild und nicht ein
 *  Schatten des Tagbilds. Ausgeglichen wird die Helligkeit; farbige Stellen des Tagbilds färben das Licht weiterhin. */
import { hexToRgb, linearToSrgb, srgbToLinear } from "./color";
import { layerCount, type HeightMap, type HeightSettings } from "./heightmap";
import { acesTone, LITHO_SCATTER, LITHO_SPECTRUM } from "./litho";
import { OPACITY_K, segments, type ColorStop } from "./plan";
import { crop, gaussianBlur, resize, type Raster } from "./raster";

const LUMA: [number, number, number] = [0.2126, 0.7152, 0.0722];
/** Dieser Anteil des Dickenbereichs bleibt mindestens für das Nachtbild selbst */
export const NIGHT_MIN_CONTRAST = 0.25;
/** Helligkeitsverhältnis hell zu dunkel, das die automatische Dicke dem Nachtbild gibt: etwas mehr als bei einer
 *  üblichen Lithophanie (dort etwa 4), damit es sich gegen die Farben des Tagbilds durchsetzt */
export const NIGHT_GOOD_RATIO = 6;
/** Dicker wird die Rückplatte nicht, wenn Chromalith die Dicke selbst wählt (mm) */
export const NIGHT_AUTO_MAX = 6;

/** Licht (linear, je Kanal), das durch eine Lage der Dicke t kommt, multipliziert auf `acc`. Die Helligkeit folgt
 *  dem TD (bei t = TD noch 5 %); die Filamentfarbe färbt das Licht, je dicker die Lage, desto kräftiger, ohne die
 *  Helligkeit ein zweites Mal zu mindern. Helle Filamente streuen Blau stärker als Rot (dicke Stellen wirken
 *  wärmer), dunkle schlucken alle Farben gleich. */
export function transmitInto(acc: number[] | Float32Array, o: number, t: number, colorLin: ArrayLike<number>, td: number): void {
  if (t <= 0) return;
  const x = t / Math.max(td, 0.05), p = Math.min(1.5, x);
  const light = Math.min(1, LUMA[0] * colorLin[0] + LUMA[1] * colorLin[1] + LUMA[2] * colorLin[2]);
  let norm = 0;
  const f = [0, 0, 0];
  for (let c = 0; c < 3; c++) { f[c] = Math.pow(Math.max(colorLin[c], 0.02), p); norm += LUMA[c] * f[c]; }
  for (let c = 0; c < 3; c++) acc[o + c] *= Math.exp(-OPACITY_K * (1 + (LITHO_SPECTRUM[c] - 1) * light) * x) * (f[c] / norm);
}

/** Durchlässigkeit des Farbreliefs je Bildpunkt (linear, 3/Punkt). Außerhalb der Form: 0. */
export function stackTransmission(hm: HeightMap, stops: ColorStop[]): Float32Array {
  const n = hm.heights.length, out = new Float32Array(n * 3);
  const segs = segments(stops, hm.base_layer_mm, hm.layer_height_mm, Math.max(layerCount(hm), 1));
  const lins = segs.map((s) => hexToRgb(s.filament.color).map(srgbToLinear));
  const cache = new Map<number, [number, number, number]>();
  for (let i = 0; i < n; i++) {
    if (hm.mask && !hm.mask[i]) continue;
    const h = hm.heights[i], z0 = hm.bottom ? hm.bottom[i] : 0;
    const key = z0 > 0 ? -1 : Math.round(h * 1000);
    let v = key >= 0 ? cache.get(key) : undefined;
    if (!v) {
      v = [1, 1, 1];
      for (let k = 0; k < segs.length; k++) transmitInto(v, 0, Math.min(h, segs[k].z1) - Math.max(segs[k].z0, z0), lins[k], segs[k].filament.td);
      if (key >= 0) cache.set(key, v);
    }
    out[i * 3] = v[0]; out[i * 3 + 1] = v[1]; out[i * 3 + 2] = v[2];
  }
  return out;
}

/** Helligkeit des Nachtbilds (0..1, wie am Bildschirm empfunden) auf dem Raster des Tagbilds. Das Nachtbild füllt
 *  die Fläche des Tagbilds; was übersteht, wird mittig abgeschnitten. */
export function nightTarget(night: Raster, w: number, h: number): Float32Array {
  const ar = w / h;
  let cw = night.width, ch = Math.round(cw / ar);
  if (ch > night.height) { ch = night.height; cw = Math.min(night.width, Math.max(1, Math.round(ch * ar))); }
  ch = Math.max(1, ch);
  const r = resize(crop(night, Math.floor((night.width - cw) / 2), Math.floor((night.height - ch) / 2), cw, ch), w, h);
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = r.data[i * 4 + 3];
    out[i] = a < 0.5 ? 0 : Math.min(1, Math.max(0, LUMA[0] * r.data[i * 4] + LUMA[1] * r.data[i * 4 + 1] + LUMA[2] * r.data[i * 4 + 2]));
  }
  return out;
}

export interface NightInfo {
  /** Durchlässigkeit des Tagbilds an den dunkelsten und hellsten Stellen (Anteil 0..1) */
  dayMin: number;
  dayMax: number;
  /** Wie weit die Helligkeitsunterschiede des Tagbilds ausgeglichen werden (0..1) */
  comp: number;
  /** Helligkeit des Nachtbilds: hellste Stelle im Verhältnis zur dunkelsten */
  ratio: number;
  /** Dickste Stelle (mm), mit der das Tagbild wie gewünscht ausgeglichen ist und das Nachtbild seinen vollen
   *  Kontrast bekommt (NIGHT_GOOD_RATIO) */
  suggestMax: number;
  /** Dünnste und dickste Stelle der Rückplatte in mm, wie sie gerechnet wurde */
  min: number;
  max: number;
  /** Größter TD (mm) eines Filaments für die Rückplatte, mit dem Ausgleich und Kontrast in die größte automatische
   *  Dicke passen */
  tdMax: number;
}

/** Wert an der Stelle p (0..1) einer aufsteigend sortierten Liste */
const quantile = (sorted: Float32Array, p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))] : 0);

/** Dicke der Rückplatte je Bildpunkt in mm (hell = dünn), mit Ausgleich des Tagbilds. */
export function nightThickness(hm: HeightMap, stops: ColorStop[], target: Float32Array, s: HeightSettings, backTd: number): { t: Float32Array; info: NightInfo; day: Float32Array } {
  const n = hm.heights.length, T = stackTransmission(hm, stops);
  const kB = OPACITY_K / Math.max(backTd, 0.05);
  const inside = (i: number) => !hm.mask || hm.mask[i] === 1;
  // g: so viel Rückplatte (mm) schluckt gleich viel Licht wie das Tagbild an dieser Stelle
  const g = new Float32Array(n), tmp = new Float32Array(n);
  let cnt = 0, sum = 0;
  for (let i = 0; i < n; i++) {
    if (!inside(i)) continue;
    const lum = Math.max(1e-6, LUMA[0] * T[i * 3] + LUMA[1] * T[i * 3 + 1] + LUMA[2] * T[i * 3 + 2]);
    g[i] = -Math.log(lum) / kB; tmp[cnt++] = g[i]; sum += g[i];
  }
  const lo = Math.max(0.2, s.night_min_mm), wish = Math.min(1, Math.max(0, s.night_comp));
  const contrast = Math.log(NIGHT_GOOD_RATIO) / kB;
  const tdFor = (G: number) => (OPACITY_K * Math.max(0.4, NIGHT_AUTO_MAX - lo)) / (wish * G * kB + Math.log(NIGHT_GOOD_RATIO));
  /** dickste Stelle: fest eingestellt oder so gewählt, dass Ausgleich und Kontrast Platz haben */
  const top = (need: number) => s.night_auto ? Math.max(lo + 0.4, Math.min(NIGHT_AUTO_MAX, Math.ceil(need * 10 - 1e-6) / 10)) : Math.max(lo + 0.2, s.night_max_mm);
  if (!cnt) { const hi = top(lo + contrast); return { day: T, t: new Float32Array(n).fill(hi), info: { dayMin: 0, dayMax: 0, comp: 1, ratio: Math.exp(kB * (hi - lo)), suggestMax: lo + contrast, min: lo, max: hi, tdMax: tdFor(0) } }; }
  const sorted = tmp.subarray(0, cnt).sort();
  const gLo = quantile(sorted, 0.02), gHi = quantile(sorted, 0.98), G = Math.max(0, gHi - gLo);
  const suggestMax = lo + wish * G + contrast, hi = top(suggestMax), R = hi - lo;
  // Kanten weich ausgleichen: die Platten liegen nie auf den Punkt genau übereinander, und Licht streut in der Wand
  const mean = sum / cnt;
  for (let i = 0; i < n; i++) if (!inside(i)) g[i] = mean;
  const gs = gaussianBlur(g, hm.width, hm.height, Math.max(0.5, 0.4 / hm.pixel_size_mm));
  // der Ausgleich darf höchstens so viel vom Dickenbereich nehmen, dass dem Nachtbild sein Mindestanteil bleibt
  const used = Math.min(wish * G, R * (1 - NIGHT_MIN_CONTRAST)), share = G > 1e-6 ? used / G : 0, Rc = R - used;
  const t = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (!inside(i)) { t[i] = hi; continue; }
    const extra = share * Math.min(G, Math.max(0, gHi - gs[i]));
    t[i] = Math.min(hi, lo + Rc * (1 - target[i]) + extra);
  }
  return { t, day: T, info: { dayMin: Math.exp(-kB * gHi), dayMax: Math.exp(-kB * gLo), comp: G > 1e-6 ? share : 1, ratio: Math.exp(kB * Rc), suggestMax, min: lo, max: hi, tdMax: tdFor(G) } };
}

export interface NightLight { filamentColor: string; td: number; light: string; intensity: number }

/** Vorschau mit Licht von hinten: Lampe, Rückplatte, Tagbild (sRGB, 3/Punkt). Die Belichtung wird wie vom Auge
 *  oder einer Kamera an die hellste Stelle angepasst; `through` sagt, wie viel Licht dort wirklich ankommt.
 *  `day` ist die Durchlässigkeit des Tagbilds, falls sie schon gerechnet ist (stackTransmission). */
export function nightSimulate(hm: HeightMap, stops: ColorStop[], t: Float32Array, o: NightLight, day?: Float32Array): { rgb: Float32Array; through: number } {
  const n = hm.heights.length, w = hm.width, h = hm.height;
  const T = day ?? stackTransmission(hm, stops);
  const back = hexToRgb(o.filamentColor).map(srgbToLinear), lamp = hexToRgb(o.light).map(srgbToLinear);
  // Die Rückplatte streut das Licht: feine Stufen in ihrer Dicke verschwimmen, umso mehr, je dicker sie ist
  // (Streuweite etwa ein Drittel der mittleren Dicke, wie bei der Lithophanie)
  let mean = 0, m = 0, tMax = 0;
  for (let i = 0; i < n; i++) if (!hm.mask || hm.mask[i]) { mean += t[i]; m++; if (t[i] > tMax) tMax = t[i]; }
  const ts = gaussianBlur(t, w, h, Math.max(0.6, ((mean / Math.max(1, m)) * 0.33) / hm.pixel_size_mm));
  // Abschwächung der Rückplatte über eine Tabelle, damit große Bilder schnell bleiben
  const N = 1024, lut = new Float32Array(N * 3).fill(1);
  for (let k = 0; k < N; k++) { transmitInto(lut, k * 3, (tMax * k) / (N - 1), back, o.td); for (let c = 0; c < 3; c++) lut[k * 3 + c] *= lamp[c]; }
  const lin = new Float32Array(n * 3), lum = new Float32Array(n);
  let cnt = 0;
  for (let i = 0; i < n; i++) {
    if (hm.mask && !hm.mask[i]) continue;
    const te = t[i] + (ts[i] - t[i]) * LITHO_SCATTER;
    const k = Math.min(N - 1, Math.max(0, Math.round((te / Math.max(tMax, 1e-6)) * (N - 1)))) * 3;
    const r = T[i * 3] * lut[k], g = T[i * 3 + 1] * lut[k + 1], b = T[i * 3 + 2] * lut[k + 2];
    lin[i * 3] = r; lin[i * 3 + 1] = g; lin[i * 3 + 2] = b;
    lum[cnt++] = LUMA[0] * r + LUMA[1] * g + LUMA[2] * b;
  }
  const through = quantile(lum.subarray(0, cnt).sort(), 0.99);
  const gain = (0.85 / Math.max(through, 1e-6)) * Math.max(0.05, o.intensity);
  const rgb = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    if (hm.mask && !hm.mask[i]) { rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = 0.04; continue; }
    for (let c = 0; c < 3; c++) rgb[i * 3 + c] = linearToSrgb(acesTone(lin[i * 3 + c] * gain));
  }
  return { rgb, through };
}

/** Marke auf der Rückplatte: ein kleiner erhabener Punkt (Durchmesser, Abstand zum Rand der Form und Höhe in mm) */
export const NIGHT_MARK = { d: 2.4, margin: 1, h: 0.6 };

/** Wo die Marke sitzt (Rasterpunkt im Tagbild): so nah wie möglich an der Ecke oben links, aber ganz in der Form. */
export function nightMark(hm: HeightMap): { x: number; y: number } | null {
  const w = hm.width, h = hm.height, R = Math.ceil((NIGHT_MARK.d / 2 + NIGHT_MARK.margin) / hm.pixel_size_mm);
  if (w < 2 * R + 1 || h < 2 * R + 1) return null;
  // Summentabelle der Form: Ein Punkt taugt, wenn das Quadrat um ihn ganz in der Form liegt
  const W = w + 1, sat = new Uint32Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += !hm.mask || hm.mask[y * w + x] ? 1 : 0; sat[(y + 1) * W + x + 1] = sat[y * W + x + 1] + row; }
  }
  const full = (2 * R + 1) ** 2;
  let best: { x: number; y: number } | null = null, bd = Infinity;
  for (let y = R; y < h - R; y++) for (let x = R; x < w - R; x++) {
    const d = x * x + y * y;
    if (d >= bd) continue;
    const sum = sat[(y + R + 1) * W + x + R + 1] - sat[(y - R) * W + x + R + 1] - sat[(y + R + 1) * W + x - R] + sat[(y - R) * W + x - R];
    if (sum === full) { bd = d; best = { x, y }; }
  }
  return best;
}

/** Die Rückplatte als Höhenkarte: gleicher Umriss und gleiches Raster wie das Tagbild, unten flach.
 *  Sie wird mit der glatten Seite auf dem Druckbett gedruckt und danach umgedreht: Die glatte Seite liegt am Tagbild
 *  an (kein Luftspalt, in dem das Licht verläuft), das Relief zeigt zur Lampe. Dafür ist sie hier schon gespiegelt.
 *  Ein kleiner erhabener Punkt zeigt, wie herum sie gehört: Er sitzt, von vorn auf das Bild gesehen, oben links. */
export function nightPlate(hm: HeightMap, t: Float32Array, mirror = true, mark = true): HeightMap {
  const w = hm.width, h = hm.height, heights = new Float32Array(w * h), mask = hm.mask ? new Uint8Array(w * h) : null;
  const src = Float32Array.from(t), m = mark ? nightMark(hm) : null;
  if (m) {
    let top = 0;
    for (let i = 0; i < src.length; i++) if (!hm.mask || hm.mask[i]) top = Math.max(top, src[i]);
    const r = NIGHT_MARK.d / 2 / hm.pixel_size_mm, r0 = Math.ceil(r);
    for (let y = Math.max(0, m.y - r0); y <= Math.min(h - 1, m.y + r0); y++) for (let x = Math.max(0, m.x - r0); x <= Math.min(w - 1, m.x + r0); x++)
      if ((x - m.x) ** 2 + (y - m.y) ** 2 <= r * r && (!hm.mask || hm.mask[y * w + x])) src[y * w + x] = top + NIGHT_MARK.h;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const from = y * w + (mirror ? w - 1 - x : x), to = y * w + x;
    heights[to] = src[from];
    if (mask) mask[to] = hm.mask![from];
  }
  return { width: w, height: h, heights, pixel_size_mm: hm.pixel_size_mm, base_layer_mm: hm.base_layer_mm, layer_height_mm: hm.layer_height_mm,
    rgb: new Float32Array(w * h * 3).fill(0.9), border_px: 0, mask };
}

/** Sucht in der Bibliothek ein Filament für die Rückplatte: hell und farbneutral (es liegt sichtbar hinter den
 *  dünnen Stellen des Tagbilds) und so wenig durchscheinend, dass Ausgleich und Kontrast in die Platte passen.
 *  Eigene Filamente gehen vor; sonst das mit dem größten passenden TD (dünne Schichten stufen dann am feinsten ab). */
export function pickNightFilament<T extends { color: string; td: number; owned?: boolean }>(library: T[], tdMax: number): T | null {
  let best: T | null = null, bestScore = -Infinity;
  for (const f of library) {
    const c = hexToRgb(f.color), lum = LUMA[0] * c[0] + LUMA[1] * c[1] + LUMA[2] * c[2];
    if (!(f.td >= 0.8) || f.td > tdMax || lum < 0.4 || Math.max(...c) - Math.min(...c) > 0.1) continue;
    const score = (f.owned ? 100 : 0) + f.td;
    if (score > bestScore) { best = f; bestScore = score; }
  }
  return best;
}
