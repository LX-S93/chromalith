/** Dialog „TD messen“: Stufentreppe zum Drucken speichern, dann ein Foto im Gegenlicht auswerten oder die erste
 *  dunkle Stufe von Hand angeben. */
import {
  STAIR_STEP_MM, STAIR_WIDTH_MM, cleanStair, filamentLabel, fitTd, heightmapToMesh, makeFilament, roundTd, samplePatch, sampleStair,
  stairHeightMap, stairThickness, stairThicknesses, tdFromDarkStep, write3mf, writeStl,
  type Filament, type PhotoPixels, type StairSpec, type TdFit, type ThreeMfOptions,
} from "../core";
import { num, tr } from "../i18n";
import { openFile, saveFile, saveSibling, store } from "../platform";
import { button, clear, h, modal, toast } from "./dom";

export interface TdCalHost {
  /** Schichthöhen des aktuellen Projekts als Startwerte für die Treppe */
  layers(): { first: number; layer: number };
  /** Filament aus der Bibliothek wählen */
  pick(): Promise<Filament | null>;
  /** Ziel-Slicer und Vorlage für die .3mf der Treppe */
  slicer(): ThreeMfOptions;
}

let host: TdCalHost | null = null;
export function setTdCalHost(h: TdCalHost) { host = h; }

const IMAGE_EXT = ["png", "jpg", "jpeg", "bmp", "gif", "webp"];
const mm = (v: number) => num(v, 2);

async function loadPhoto(bytes: Uint8Array): Promise<{ canvas: HTMLCanvasElement; pixels: PhotoPixels }> {
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart]));
  const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bmp.width * s)); canvas.height = Math.max(1, Math.round(bmp.height * s));
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { canvas, pixels: { data: d.data, width: d.width, height: d.height } };
}

export interface TdResult { filament: Filament | null; td: number }

/** Öffnet die Kalibrierung. `fixed`: das Filament steht fest (aus „Filament bearbeiten“), es wird nur der Wert geliefert. */
export function openTdCalibration(filament: Filament | null = null, fixed = false): Promise<TdResult | null> {
  return new Promise((resolve) => {
    if (!host) { resolve(null); return; }
    const hst = host;
    let fil = filament, result: TdResult | null = null;
    const saved = store.get<Partial<StairSpec> | null>("tdStair", null);
    let spec = cleanStair(saved ?? { ...hst.layers(), perStep: 1, count: 10 });
    let mode: "photo" | "hand" = store.get<string>("tdMode", "photo") === "hand" ? "hand" : "photo";
    let photo: { canvas: HTMLCanvasElement; pixels: PhotoPixels } | null = null;
    let a: [number, number] = [0, 0], b: [number, number] = [0, 0];
    let fit: TdFit | null = null;
    let dark: number | "none" | null = null;
    let td: number | null = null;

    // ---- Filament
    const filEl = h("div", { style: { display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" } });
    const renderFil = () => {
      clear(filEl);
      if (fil) filEl.append(h("div", { class: "swatch", style: { background: fil.color } }),
        h("b", { "data-notr": true }, tr(filamentLabel(fil)) || "–"),
        h("span", { class: "hint" }, `bisher TD ${num(fil.td, 2)} mm` + (fil.td_estimated ? " (geschätzt)" : "")));
      else filEl.append(h("span", { class: "hint" }, "Noch kein Filament gewählt. Der Wert lässt sich am Ende einem Filament zuweisen."));
      if (!fixed) filEl.append(button(fil ? "Anderes Filament …" : "Filament wählen …", async () => { const f = await hst.pick(); if (f) { fil = f; renderFil(); renderResult(); } }, { icon: "library", cls: "small" }));
    };

    // ---- 1 Treppe
    const stairInfo = h("p", { class: "hint", style: { margin: "0" } });
    const specChanged = () => { spec = cleanStair(spec); store.set("tdStair", spec); renderStairInfo(); renderHand(); evaluate(); };
    const numField = (label: string, key: keyof StairSpec, lo: number, hi: number, step: number, unit: string, tip: string) => {
      const dec = step < 1 ? 2 : 0;
      const input = h("input", { class: "num", type: "number", min: lo, max: hi, step, value: spec[key].toFixed(dec), style: { width: "84px" } });
      input.addEventListener("change", () => {
        const v = Number(input.value.replace(",", "."));
        if (Number.isFinite(v)) { spec[key] = v; specChanged(); }
        input.value = spec[key].toFixed(dec);
      });
      return h("label", { class: "td-num", title: tip, style: { display: "grid", gap: "4px" } }, h("span", { class: "hint" }, label),
        h("span", { style: { display: "flex", gap: "6px", alignItems: "center" } }, input, unit ? h("span", { class: "hint" }, unit) : ""));
    };
    const fFirst = numField("Erste Schicht", "first", 0.04, 0.6, 0.02, "mm", "Höhe der ersten Druckschicht = Dicke der dünnsten Stufe. Im Slicer genauso einstellen.");
    const fLayer = numField("Schichthöhe", "layer", 0.04, 0.4, 0.02, "mm", "Höhe aller weiteren Schichten. Im Slicer genauso einstellen.");
    const fPer = numField("Schichten je Stufe", "perStep", 1, 10, 1, "", "Mehr Schichten je Stufe für durchscheinende Filamente (Weiß, Gelb, Transparent): Die Treppe reicht dann weiter.");
    const fCount = numField("Stufen", "count", 4, 20, 1, "", "Anzahl der Stufen. Jede ist 8 mm lang.");
    const renderStairInfo = () => {
      stairInfo.textContent = `${spec.count} Stufen von ${mm(stairThickness(spec, 0))} bis ${mm(stairThickness(spec, spec.count - 1))} mm, Größe ${spec.count * STAIR_STEP_MM} × ${STAIR_WIDTH_MM} mm.`;
    };
    async function saveStair() {
      try {
        const hm = stairHeightMap(spec), mesh = heightmapToMesh(hm);
        const name = tr("TD-Treppe");
        const path = await saveFile(`${name}.stl`, writeStl(mesh, "Chromalith TD"), [{ name: "STL", extensions: ["stl"] }]);
        if (!path) return;
        const f = fil ?? makeFilament({ name: "TD", color: "#808080", td: 1 });
        const out = await write3mf(mesh, hm, [{ filament: f, start_layer: 1 }], name, hst.slicer());
        await saveSibling(path, ".3mf", out.data);
        toast(out.info.project
          ? "Treppe gespeichert (STL und 3MF). Die .3mf enthält die Schichthöhen und 100 % Füllung."
          : "Treppe gespeichert (STL und 3MF). Schichthöhen und 100 % Füllung im Slicer einstellen.", "ok", 7000);
      } catch (e: any) { toast("Die Treppe ließ sich nicht speichern: " + e.message, "err"); }
    }

    // ---- 2 Auswerten: Foto
    const view = h("canvas", { class: "td-photo", style: { maxWidth: "100%", maxHeight: "44vh", borderRadius: "8px", background: "var(--bg)", touchAction: "none", cursor: "grab", display: "block" } });
    const chart = h("canvas", { width: 520, height: 240, style: { width: "100%", maxWidth: "520px" } });
    const photoText = h("div", { style: { display: "grid", gap: "6px" } });
    const photoGrid = h("div", { style: { display: "none", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "14px", alignItems: "start" } },
      h("div", null, view), h("div", { style: { display: "grid", gap: "8px" } }, chart, photoText));
    let touched = false;
    const drawPhoto = () => {
      if (!photo) return;
      const { canvas } = photo, ctx = view.getContext("2d")!;
      if (view.width !== canvas.width || view.height !== canvas.height) { view.width = canvas.width; view.height = canvas.height; }
      ctx.drawImage(canvas, 0, 0);
      const u = Math.max(1.5, canvas.width / 420), half = samplePatch(a, b, spec.count);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ex = (b[0] - a[0]) / len, ey = (b[1] - a[1]) / len;
      const stroke = (color: string, w: number, path: () => void) => { ctx.strokeStyle = color; ctx.lineWidth = w; ctx.beginPath(); path(); ctx.stroke(); };
      for (const [c, w] of [["#000a", u * 2.4], ["#fff", u]] as const) stroke(c, w, () => { ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); });
      // Messfelder: grün = ausgewertet, rot = überbelichtet, grau = nicht verwendet
      const order = (i: number) => (fit?.reversed ? spec.count - 1 - i : i);
      for (let i = 0; i < spec.count; i++) {
        const f = spec.count > 1 ? i / (spec.count - 1) : 0, cx = a[0] + (b[0] - a[0]) * f, cy = a[1] + (b[1] - a[1]) * f;
        const k = order(i), col = !fit ? "#fff" : fit.saturated[k] ? "#ff5a5a" : fit.used[k] ? "#5fe08a" : "#9aa0b4";
        const corner = (su: number, sv: number): [number, number] => [cx + su * half * ex - sv * half * ey, cy + su * half * ey + sv * half * ex];
        for (const [c, w] of [["#000a", u * 2.4], [col, u]] as const) stroke(c, w, () => {
          const p = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
          ctx.moveTo(p[0][0], p[0][1]); for (const q of p.slice(1)) ctx.lineTo(q[0], q[1]); ctx.closePath();
        });
      }
      // Marken
      const r = u * 9;
      for (const [p, label, col] of [[a, "1", "#8b5cf6"], [b, String(spec.count), "#f59e0b"]] as const) {
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2); ctx.fill();
        stroke("#fff", u * 1.2, () => ctx.arc(p[0], p[1], r, 0, Math.PI * 2));
        ctx.fillStyle = "#fff"; ctx.font = `600 ${Math.round(r * 1.15)}px system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(label, p[0], p[1] + r * 0.06);
      }
    };
    const drawChart = () => {
      const ctx = chart.getContext("2d")!, W = chart.width, H = chart.height;
      ctx.clearRect(0, 0, W, H);
      if (!fit) return;
      const css = getComputedStyle(document.documentElement), muted = css.getPropertyValue("--muted").trim() || "#9aa0b4", line = css.getPropertyValue("--line-2").trim() || "#333";
      const t = stairThicknesses(spec), l = 46, r = 12, top = 12, bot = 34;
      const tMax = t[t.length - 1] * 1.05, yMax = Math.max(...fit.lum, 1e-6) * 1.08;
      const X = (v: number) => l + ((W - l - r) * v) / tMax, Y = (v: number) => H - bot - ((H - top - bot) * Math.min(v, yMax)) / yMax;
      ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(l, top); ctx.lineTo(l, H - bot); ctx.lineTo(W - r, H - bot); ctx.stroke();
      ctx.fillStyle = muted; ctx.font = "12px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "top";
      for (const i of [0, Math.floor((t.length - 1) / 2), t.length - 1]) ctx.fillText(mm(t[i]), X(t[i]), H - bot + 5);
      ctx.fillText(tr("Dicke (mm)"), (l + W - r) / 2, H - 15);
      ctx.save(); ctx.translate(12, (top + H - bot) / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = "middle"; ctx.fillText(tr("Helligkeit"), 0, 0); ctx.restore();
      if (fit.ok) {
        ctx.strokeStyle = "#8b5cf6"; ctx.lineWidth = 2; ctx.beginPath();
        // Kurve nur dort zeichnen, wo sie ins Diagramm passt (links von der dünnsten Stufe steigt sie weit darüber hinaus)
        let pen = false;
        for (let i = 0; i <= 120; i++) {
          const v = (tMax * i) / 120, y = fit.a * Math.exp(-fit.k * v) + fit.black;
          if (y > yMax) continue;
          pen ? ctx.lineTo(X(v), Y(y)) : ctx.moveTo(X(v), Y(y)); pen = true;
        }
        ctx.stroke();
        if (fit.td < tMax) {
          ctx.setLineDash([4, 4]); ctx.strokeStyle = muted; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X(fit.td), top); ctx.lineTo(X(fit.td), H - bot); ctx.stroke(); ctx.setLineDash([]);
          ctx.textBaseline = "top"; ctx.textAlign = X(fit.td) > W - 60 ? "right" : "left"; ctx.fillText("TD", X(fit.td) + (X(fit.td) > W - 60 ? -5 : 5), top);
        }
      }
      fit.lum.forEach((v, i) => {
        ctx.beginPath(); ctx.arc(X(t[i]), Y(v), 4.5, 0, Math.PI * 2);
        if (fit!.used[i]) { ctx.fillStyle = "#5fe08a"; ctx.fill(); }
        else { ctx.strokeStyle = fit!.saturated[i] ? "#ff5a5a" : muted; ctx.lineWidth = 1.5; ctx.stroke(); }
      });
    };
    const evaluate = () => {
      if (mode === "photo") {
        // Ausgewertet wird erst, wenn die Marken einmal gesetzt wurden: vorher liegen sie irgendwo im Bild
        fit = photo && touched ? fitTd(stairThicknesses(spec), sampleStair(photo.pixels, a, b, spec.count)) : null;
        td = fit?.ok ? fit.td : null;
        drawPhoto(); drawChart();
        clear(photoText);
        const line = (text: string, warn = false) => photoText.append(h("div", { class: "hint" + (warn ? " warn" : "") }, text));
        if (photo && !touched) line("Jetzt die Marke 1 auf die Mitte der dünnsten Stufe ziehen und die andere Marke auf die Mitte der dicksten. Die Felder dazwischen zeigen, wo gemessen wird.");
        if (fit) {
          const n = fit.used.filter(Boolean).length, sat = fit.saturated.filter(Boolean).length;
          if (!fit.ok) line(fit.problem === "flat"
            ? "Die Stufen werden von Marke 1 zur letzten Marke nicht dunkler. Liegen beide Marken auf der Treppe?"
            : "Zu wenige Stufen lassen sich auswerten. Sie sind überbelichtet oder ganz dunkel: mit anderer Belichtung noch einmal fotografieren.", true);
          else {
            line(`Ausgewertet: ${n} von ${spec.count} Stufen.` + " " + (fit.r2 >= 0.98 ? "Die Messwerte folgen dem Modell sehr gut." : fit.r2 >= 0.9 ? "Die Messwerte folgen dem Modell gut." : "Die Messwerte streuen stark."));
            if (fit.black > 0) line("Die dicksten Stufen sind gleich dunkel: Dort kommt kein Licht mehr durch, sie zählen als Schwarzwert.");
            if (fit.reversed) line("Die Marken lagen vertauscht (Marke 1 auf der dicken Seite). Das ist berücksichtigt.");
            if (fit.rough) line(fit.td > 2.5 * stairThickness(spec, spec.count - 1)
              ? "Grobe Schätzung: Das Filament ist für diese Treppe zu durchscheinend. Mit mehr Schichten je Stufe wird der Wert genauer."
              : "Grobe Schätzung: wenige auswertbare Stufen oder unruhige Messwerte. Ein gleichmäßigeres Licht und ein gerades Foto helfen.", true);
          }
          if (sat) line(`${sat} Stufen sind überbelichtet und wurden weggelassen.`, !fit.ok);
        }
      } else {
        fit = null;
        td = typeof dark === "number" ? tdFromDarkStep(spec, dark) : null;
      }
      renderResult();
    };
    const resetMarks = () => {
      if (!photo) return;
      const { width: w, height: hh } = photo.pixels;
      a = [w * 0.14, hh * 0.5]; b = [w * 0.86, hh * 0.5];
    };
    async function setPhoto(bytes: Uint8Array) {
      try { photo = await loadPhoto(bytes); } catch { toast("Dieses Bild lässt sich nicht lesen.", "err"); return; }
      resetMarks(); touched = false; photoGrid.style.display = "grid";
      evaluate();
    }
    const pos = (e: PointerEvent): [number, number] => { const r = view.getBoundingClientRect(); return [((e.clientX - r.left) * view.width) / r.width, ((e.clientY - r.top) * view.height) / r.height]; };
    let drag: [number, number] | null = null;
    view.addEventListener("pointerdown", (e) => {
      const p = pos(e); drag = Math.hypot(p[0] - a[0], p[1] - a[1]) <= Math.hypot(p[0] - b[0], p[1] - b[1]) ? a : b;
      drag[0] = p[0]; drag[1] = p[1]; touched = true; view.setPointerCapture(e.pointerId); view.style.cursor = "grabbing"; evaluate();
    });
    view.addEventListener("pointermove", (e) => { if (!drag) return; const p = pos(e); drag[0] = Math.min(view.width, Math.max(0, p[0])); drag[1] = Math.min(view.height, Math.max(0, p[1])); evaluate(); });
    const drop = () => { drag = null; view.style.cursor = "grab"; };
    view.addEventListener("pointerup", drop); view.addEventListener("pointercancel", drop);
    const photoPane = h("div", { style: { display: "grid", gap: "10px" } },
      h("p", { class: "hint", style: { margin: 0 } }, "Die Treppe auf eine gleichmäßig helle Fläche legen, zum Beispiel ein weißes Bild auf einem Tablet oder Handy. Den Raum abdunkeln und gerade von oben fotografieren, ohne Blitz und möglichst ohne HDR. Dann die beiden Marken auf die Mitte der dünnsten Stufe (1) und der dicksten Stufe ziehen."),
      h("div", null, button("Foto wählen …", async () => { const f = await openFile([{ name: "Bilder", extensions: IMAGE_EXT }]); if (f) setPhoto(f.bytes); }, { icon: "image" })),
      photoGrid);
    photoPane.addEventListener("dragover", (e) => { e.preventDefault(); e.stopPropagation(); });
    photoPane.addEventListener("drop", async (e) => {
      e.preventDefault(); e.stopPropagation();
      const f = e.dataTransfer?.files?.[0];
      if (f) setPhoto(new Uint8Array(await f.arrayBuffer()));
    });

    // ---- 2 Auswerten: von Hand
    const darkSel = h("select", { class: "select" });
    darkSel.addEventListener("change", () => { dark = darkSel.value === "" ? null : darkSel.value === "none" ? "none" : Number(darkSel.value); evaluate(); });
    const handNote = h("div", { class: "hint" });
    const renderHand = () => {
      clear(darkSel);
      darkSel.append(h("option", { value: "" }, "Bitte wählen …"),
        ...stairThicknesses(spec).map((t, i) => h("option", { value: String(i) }, `Stufe ${i + 1} (${mm(t)} mm)`)),
        h("option", { value: "none" }, "Keine: auch durch die dickste Stufe scheint Licht"));
      if (typeof dark === "number" && dark >= spec.count) dark = null;
      darkSel.value = dark === null ? "" : String(dark);
    };
    const handPane = h("div", { style: { display: "grid", gap: "10px" } },
      h("p", { class: "hint", style: { margin: 0 } }, "Die Treppe vor ein weißes Display oder eine Lampe halten und von der dünnen Seite her zählen. Welche ist die erste Stufe, durch die kein Licht mehr scheint?"),
      h("div", { class: "field" }, h("label", null, h("span", null, "Erste dunkle Stufe")), darkSel),
      handNote,
      h("p", { class: "hint", style: { margin: 0 } }, "Je heller die Lampe, desto später wirkt eine Stufe dunkel. Das Foto ist genauer, weil es den ganzen Verlauf auswertet."));

    const pill = h("div", { class: "mode-pill" });
    const modeBtn: Record<string, HTMLButtonElement> = {};
    for (const [k, label] of [["photo", "Foto im Gegenlicht"], ["hand", "Von Hand"]] as const)
      pill.append((modeBtn[k] = h("button", { onclick: () => { mode = k; store.set("tdMode", k); renderMode(); evaluate(); } }, label)));
    const renderMode = () => {
      for (const k of Object.keys(modeBtn)) modeBtn[k].classList.toggle("active", k === mode);
      photoPane.style.display = mode === "photo" ? "grid" : "none"; handPane.style.display = mode === "hand" ? "grid" : "none";
    };

    // ---- 3 Ergebnis
    const resultEl = h("div", { class: "td-result", style: { display: "flex", gap: "12px", alignItems: "baseline", flexWrap: "wrap" } });
    const applyBtn = button("Übernehmen", () => { if (td !== null) { result = { filament: fil, td: roundTd(td) }; close(); } }, { cls: "primary" });
    const renderResult = () => {
      clear(resultEl); clear(handNote);
      if (mode === "hand") {
        if (dark === "none") handNote.append(`Der TD liegt über ${mm(stairThickness(spec, spec.count - 1))} mm. Eine Treppe mit mehr Schichten je Stufe drucken oder das Foto auswerten.`);
        else if (dark === 0) handNote.append("Schon die dünnste Stufe ist dunkel: Der TD ist höchstens so groß wie ihre Dicke. Eine dünnere erste Schicht zeigt es genauer.");
        else if (typeof dark === "number") handNote.append(`Der TD liegt zwischen Stufe ${dark} und Stufe ${dark + 1}.`);
      }
      if (td === null) resultEl.append(h("span", { class: "hint" }, mode === "photo" && !photo ? "Noch kein Foto gewählt." : mode === "photo" && !touched ? "Die Marken sind noch nicht gesetzt." : "Noch kein Ergebnis."));
      else resultEl.append(h("div", { style: { fontSize: "20px", fontWeight: "600" } }, `TD ${num(roundTd(td), 2)} mm`),
        fil ? h("span", { class: "hint" }, `bisher ${num(fil.td, 2)} mm`) : "");
      applyBtn.disabled = td === null || (!fil && !fixed);
      applyBtn.textContent = fil && !fixed ? tr("Für dieses Filament übernehmen") : tr("Übernehmen");
      applyBtn.title = !fil && !fixed ? tr("Zuerst oben ein Filament wählen.") : "";
    };

    const head = (n: number, text: string) => h("h3", { style: { margin: "0", fontSize: "14px" } }, `${n} · `, h("span", null, text));
    const body = h("div", { style: { display: "grid", gap: "16px" } },
      filEl,
      h("div", { class: "card", style: { display: "grid", gap: "10px" } }, head(1, "Treppe drucken"),
        h("div", { style: { display: "flex", gap: "10px 26px", flexWrap: "wrap" } }, fFirst, fLayer, fPer, fCount),
        stairInfo,
        h("p", { class: "hint", style: { margin: 0 } }, "Im Filament drucken, das du messen willst: 100 % Füllung und genau diese Schichthöhen. Mit einer Vorlage unter „Slicer und AMS“ stehen beide schon in der .3mf."),
        h("div", null, button("Treppe speichern …", saveStair, { icon: "download" }))),
      h("div", { class: "card", style: { display: "grid", gap: "12px" } },
        h("div", { style: { display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" } }, head(2, "Auswerten"), pill),
        photoPane, handPane),
      h("p", { class: "hint", style: { margin: 0 } }, "Der TD ist die Dicke, bei der nur noch 5 % des Lichts durchkommen. Kamera und Licht sind nie ganz neutral: Der Wert ist ein guter Richtwert, kein Laborwert."));

    const close = modal("TD messen", body, [resultEl, h("div", { class: "spacer" }), button("Abbrechen", () => close()), applyBtn], false, () => resolve(result));
    renderFil(); renderStairInfo(); renderHand(); renderMode(); evaluate();
  });
}
