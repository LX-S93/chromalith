/** Minimaler ZIP-Schreiber und -Leser (Deflate über CompressionStream / DecompressionStream). */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(d: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < d.length; i++) c = CRC_TABLE[(c ^ d[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function deflate(d: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === "undefined") return null;
  const cs = new CompressionStream("deflate-raw");
  const out = new Response(new Blob([d as BlobPart]).stream().pipeThrough(cs)).arrayBuffer();
  return new Uint8Array(await out);
}

export async function makeZip(files: { name: string; data: Uint8Array | string }[]): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const raw = typeof f.data === "string" ? enc.encode(f.data) : f.data;
    const name = enc.encode(f.name);
    const crc = crc32(raw);
    const comp = await deflate(raw);
    const useDeflate = comp !== null && comp.length < raw.length;
    const body = useDeflate ? comp! : raw;
    const method = useDeflate ? 8 : 0;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, method, true);
    lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, body.length, true); lh.setUint32(22, raw.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, body);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, method, true); ch.setUint16(12, 0, true); ch.setUint16(14, 0x21, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, body.length, true); ch.setUint32(24, raw.length, true); ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + body.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let o = 0;
  for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}

async function inflate(d: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") throw new Error("Diese Umgebung kann keine ZIP-Dateien entpacken.");
  const ds = new DecompressionStream("deflate-raw");
  return new Uint8Array(await new Response(new Blob([d as BlobPart]).stream().pipeThrough(ds)).arrayBuffer());
}

/** Liest Dateien aus einem ZIP-Archiv (z. B. einer .3mf). `want` wählt aus, welche entpackt werden;
 *  ohne Angabe alle. Rückgabe: Dateiname -> Inhalt. Verschlüsselte und ZIP64-Archive werden nicht unterstützt. */
export async function readZip(bytes: Uint8Array, want: (name: string) => boolean = () => true): Promise<Map<string, Uint8Array>> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) if (v.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error("Die Datei ist kein ZIP-Archiv.");
  const count = v.getUint16(end + 10, true);
  let p = v.getUint32(end + 16, true);
  if (count === 0xffff || p === 0xffffffff) throw new Error("Das Archiv ist zu groß (ZIP64 wird nicht unterstützt).");
  const dec = new TextDecoder();
  const out = new Map<string, Uint8Array>();
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || v.getUint32(p, true) !== 0x02014b50) throw new Error("Das ZIP-Archiv ist beschädigt.");
    const flags = v.getUint16(p + 8, true), method = v.getUint16(p + 10, true);
    const csize = v.getUint32(p + 20, true), nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true), local = v.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen)).replace(/\\/g, "/");
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/") || !want(name)) continue;
    if (flags & 1) throw new Error("Das Archiv ist verschlüsselt.");
    if (local + 30 > bytes.length || v.getUint32(local, true) !== 0x04034b50) throw new Error("Das ZIP-Archiv ist beschädigt.");
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const body = bytes.subarray(start, start + csize);
    if (method === 0) out.set(name, body.slice());
    else if (method === 8) out.set(name, await inflate(body));
    else throw new Error("Das Archiv nutzt ein nicht unterstütztes Packverfahren.");
  }
  return out;
}
