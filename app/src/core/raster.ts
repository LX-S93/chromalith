/** Einfaches RGBA-Rasterbild (Float 0..1) und Bildoperationen ohne Browser-Abhängigkeit. */

export interface Raster {
  width: number;
  height: number;
  /** RGBA, Länge width*height*4, Werte 0..1 */
  data: Float32Array;
}

export function fromRGBA8(width: number, height: number, rgba: Uint8ClampedArray | Uint8Array): Raster {
  const data = new Float32Array(width * height * 4);
  for (let i = 0; i < data.length; i++) data[i] = rgba[i] / 255;
  return { width, height, data };
}

export function toRGBA8(r: Raster): Uint8ClampedArray {
  const out = new Uint8ClampedArray(r.data.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(r.data[i] * 255);
  return out;
}

export function crop(r: Raster, x0: number, y0: number, w: number, h: number): Raster {
  const data = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const src = ((y0 + y) * r.width + x0) * 4;
    data.set(r.data.subarray(src, src + w * 4), y * w * 4);
  }
  return { width: w, height: h, data };
}

/** Größenänderung: beim Verkleinern Flächenmittel (Box-Filter), beim Vergrößern bilinear. */
export function resize(r: Raster, w: number, h: number): Raster {
  const out = new Float32Array(w * h * 4);
  const sx = r.width / w, sy = r.height / h;
  if (sx >= 1 && sy >= 1) {
    for (let y = 0; y < h; y++) {
      const y0 = y * sy, y1 = (y + 1) * sy;
      for (let x = 0; x < w; x++) {
        const x0 = x * sx, x1 = (x + 1) * sx;
        let a0 = 0, a1 = 0, a2 = 0, a3 = 0, wsum = 0;
        for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) {
          const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
          if (wy <= 0) continue;
          for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
            const wx = Math.min(xx + 1, x1) - Math.max(xx, x0);
            if (wx <= 0) continue;
            const wgt = wx * wy;
            const i = (Math.min(yy, r.height - 1) * r.width + Math.min(xx, r.width - 1)) * 4;
            a0 += r.data[i] * wgt; a1 += r.data[i + 1] * wgt; a2 += r.data[i + 2] * wgt; a3 += r.data[i + 3] * wgt;
            wsum += wgt;
          }
        }
        const o = (y * w + x) * 4;
        out[o] = a0 / wsum; out[o + 1] = a1 / wsum; out[o + 2] = a2 / wsum; out[o + 3] = a3 / wsum;
      }
    }
  } else {
    for (let y = 0; y < h; y++) {
      const fy = Math.max(0, Math.min(r.height - 1, (y + 0.5) * sy - 0.5));
      const y0 = Math.floor(fy), y1 = Math.min(r.height - 1, y0 + 1), ty = fy - y0;
      for (let x = 0; x < w; x++) {
        const fx = Math.max(0, Math.min(r.width - 1, (x + 0.5) * sx - 0.5));
        const x0 = Math.floor(fx), x1 = Math.min(r.width - 1, x0 + 1), tx = fx - x0;
        const o = (y * w + x) * 4;
        for (let c = 0; c < 4; c++) {
          const a = r.data[(y0 * r.width + x0) * 4 + c], b = r.data[(y0 * r.width + x1) * 4 + c];
          const cc = r.data[(y1 * r.width + x0) * 4 + c], d = r.data[(y1 * r.width + x1) * 4 + c];
          out[o + c] = (a * (1 - tx) + b * tx) * (1 - ty) + (cc * (1 - tx) + d * tx) * ty;
        }
      }
    }
  }
  return { width: w, height: h, data: out };
}

/** Separabler Gauß-Weichzeichner auf einem Kanal-Array (w*h). */
export function gaussianBlur(a: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma <= 0) return a;
  const radius = Math.max(1, Math.ceil(3 * sigma));
  const k = new Float32Array(2 * radius + 1);
  let s = 0;
  for (let i = -radius; i <= radius; i++) s += k[i + radius] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const tmp = new Float32Array(a.length), out = new Float32Array(a.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let i = -radius; i <= radius; i++) acc += a[y * w + Math.min(w - 1, Math.max(0, x + i))] * k[i + radius];
      tmp[y * w + x] = acc;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let i = -radius; i <= radius; i++) acc += tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x] * k[i + radius];
      out[y * w + x] = acc;
    }
  return out;
}

/** Median über ein size×size-Fenster (size ungerade). Entfernt einzelne Ausreißer. */
export function medianFilter(a: Float32Array, w: number, h: number, size: number): Float32Array {
  if (size < 2) return a;
  size |= 1;
  const r = size >> 1;
  const out = new Float32Array(a.length);
  const win = new Float32Array(size * size);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy)) * w;
        for (let dx = -r; dx <= r; dx++) win[n++] = a[yy + Math.min(w - 1, Math.max(0, x + dx))];
      }
      win.sort();
      out[y * w + x] = win[n >> 1];
    }
  return out;
}
