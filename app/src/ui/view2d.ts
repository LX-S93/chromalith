/** Bildansicht mit Zoom (Mausrad, um den Mauszeiger), Verschieben (Ziehen) und Einpassen (Doppelklick). */
import { h } from "./dom";

export class ImageView {
  el: HTMLDivElement;
  canvas: HTMLCanvasElement;
  private scale = 1; private x = 0; private y = 0;
  private fitted = false;
  private iw = 0; private ih = 0;
  /** mm pro Bildpunkt für die Anzeige der Mausposition */
  onHover?: (px: number, py: number) => void;
  /** Klick (ohne Verschieben) an Bildposition */
  onPick?: (px: number, py: number) => void;
  get size() { return [this.iw, this.ih] as const; }

  /** Bildausschnitt wählen: Solange gesetzt, verschiebt Ziehen nicht die Ansicht, sondern meldet den Weg in
   *  Bildpunkten seit Beginn des Ziehens; das Mausrad meldet den Faktor, Doppelklick setzt zurück. */
  grab: { start(): void; move(dx: number, dy: number): void; end(): void; zoom(f: number): void; reset(): void } | null = null;
  /** Bild über dem Hauptbild (z. B. das Original am neuen Platz, solange gezogen wird) */
  private ovl = h("canvas", { class: "cmp ovl" });
  setOverlay(src: HTMLCanvasElement | null) {
    this.ovl.style.display = src ? "" : "none";
    if (src) { this.ovl.width = src.width; this.ovl.height = src.height; this.ovl.getContext("2d")!.drawImage(src, 0, 0); }
    this.apply();
  }

  /** Vergleich: zweites Bild (links vom Teiler sichtbar) */
  private cmp = h("canvas", { class: "cmp" });
  private divider = h("div", { class: "divider" }, h("span", null, "⇆"));
  private split = 0.5;
  private comparing = false;

  /** Vergleichsbild setzen (gleiche Seitenlage wie das Hauptbild) oder mit null ausschalten. */
  setCompare(src: HTMLCanvasElement | null) {
    this.comparing = !!src;
    this.cmp.style.display = this.divider.style.display = src ? "" : "none";
    if (src) { this.cmp.width = src.width; this.cmp.height = src.height; this.cmp.getContext("2d")!.drawImage(src, 0, 0); }
    this.apply();
  }

  constructor() {
    this.canvas = h("canvas");
    this.el = h("div", { class: "view canvas-view" }, this.canvas, this.cmp, this.ovl, this.divider);
    this.cmp.style.display = this.divider.style.display = this.ovl.style.display = "none";
    let dragDiv = false;
    this.divider.addEventListener("pointerdown", (e) => { dragDiv = true; this.divider.setPointerCapture(e.pointerId); e.stopPropagation(); });
    this.divider.addEventListener("pointermove", (e) => {
      if (!dragDiv || !this.iw) return;
      const r = this.el.getBoundingClientRect();
      this.split = Math.min(1, Math.max(0, (e.clientX - r.left - this.x) / (this.iw * this.scale)));
      this.apply(); e.stopPropagation();
    });
    const endDiv = (e: PointerEvent) => { dragDiv = false; e.stopPropagation(); };
    this.divider.addEventListener("pointerup", endDiv);
    this.divider.addEventListener("pointercancel", endDiv);
    this.divider.addEventListener("dblclick", (e) => e.stopPropagation());
    this.el.addEventListener("wheel", (e) => {
      e.preventDefault();
      if (!this.iw) return;
      const r = this.el.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const f = Math.exp(-e.deltaY * 0.0015);
      if (this.grab) { this.grab.zoom(f); return; }
      const ns = Math.min(40, Math.max(0.02, this.scale * f));
      this.x = mx - ((mx - this.x) * ns) / this.scale;
      this.y = my - ((my - this.y) * ns) / this.scale;
      this.scale = ns;
      this.apply();
    }, { passive: false });
    let drag: { x: number; y: number } | null = null;
    let down = { x: 0, y: 0 };
    let grabbing = false;
    // Knöpfe über dem Bild (Vergleich, Tag/Nacht) bekommen ihren Klick selbst: Hielte die Ansicht den Zeiger fest,
    // ginge der Klick an sie statt an den Knopf
    const onTool = (e: Event) => e.target instanceof Element && !!e.target.closest(".view-tools");
    this.el.addEventListener("pointerdown", (e) => {
      if (onTool(e)) return;
      down = { x: e.clientX, y: e.clientY };
      if (this.grab && this.iw) { grabbing = true; this.grab.start(); this.el.setPointerCapture(e.pointerId); return; }
      drag = { x: e.clientX - this.x, y: e.clientY - this.y }; this.el.setPointerCapture(e.pointerId); this.el.style.cursor = "grabbing";
    });
    this.el.addEventListener("pointermove", (e) => {
      if (grabbing && this.grab) this.grab.move((e.clientX - down.x) / this.scale, (e.clientY - down.y) / this.scale);
      if (drag) { this.x = e.clientX - drag.x; this.y = e.clientY - drag.y; this.apply(); }
      if (this.onHover && this.iw) {
        const r = this.el.getBoundingClientRect();
        this.onHover((e.clientX - r.left - this.x) / this.scale, (e.clientY - r.top - this.y) / this.scale);
      }
    });
    const end = () => { drag = null; this.el.style.cursor = ""; if (grabbing) { grabbing = false; this.grab?.end(); } };
    this.el.addEventListener("pointerup", (e) => {
      if (drag && this.onPick && this.iw && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4) {
        const r = this.el.getBoundingClientRect();
        const px = (e.clientX - r.left - this.x) / this.scale, py = (e.clientY - r.top - this.y) / this.scale;
        if (px >= 0 && py >= 0 && px < this.iw && py < this.ih) this.onPick(px, py);
      }
      end();
    });
    this.el.addEventListener("pointercancel", end);
    this.el.addEventListener("dblclick", (e) => { if (onTool(e)) return; if (this.grab) this.grab.reset(); else this.fit(); });
    new ResizeObserver(() => { if (!this.fitted) this.fit(); }).observe(this.el);
  }

  /** Neues Bild setzen. Bleibt die Seitenlage gleich, bleibt auch der Ausschnitt erhalten. */
  set(rgba: Uint8ClampedArray, w: number, hgt: number) {
    const sameAspect = this.iw && Math.abs(this.iw / this.ih - w / hgt) < 0.01;
    if (sameAspect && this.iw !== w) { const k = this.iw / w; this.scale *= k; }
    this.canvas.width = w; this.canvas.height = hgt;
    this.canvas.getContext("2d")!.putImageData(new ImageData(rgba as any, w, hgt), 0, 0);
    this.iw = w; this.ih = hgt;
    if (!sameAspect || !this.fitted) this.fit(); else this.apply();
  }

  clear() { this.iw = this.ih = 0; this.canvas.width = this.canvas.height = 0; this.fitted = false; }

  fit() {
    const r = this.el.getBoundingClientRect();
    if (!this.iw || r.width < 10 || r.height < 10) { this.fitted = false; return; }
    this.scale = Math.min((r.width - 40) / this.iw, (r.height - 40) / this.ih);
    this.x = (r.width - this.iw * this.scale) / 2;
    this.y = (r.height - this.ih * this.scale) / 2;
    this.fitted = true;
    this.apply();
  }

  private apply() {
    const c = this.canvas;
    c.style.left = this.x + "px"; c.style.top = this.y + "px";
    c.style.width = this.iw * this.scale + "px"; c.style.height = this.ih * this.scale + "px";
    c.style.imageRendering = this.scale > 2.5 ? "pixelated" : "auto";
    if (this.ovl.style.display !== "none") { const o = this.ovl.style; o.left = c.style.left; o.top = c.style.top; o.width = c.style.width; o.height = c.style.height; }
    if (this.comparing) {
      const m = this.cmp.style;
      m.left = c.style.left; m.top = c.style.top; m.width = c.style.width; m.height = c.style.height;
      m.clipPath = `inset(0 ${(1 - this.split) * 100}% 0 0)`;
      const d = this.divider.style;
      d.left = this.x + this.iw * this.scale * this.split + "px"; d.top = this.y + "px"; d.height = this.ih * this.scale + "px";
    }
  }
}
