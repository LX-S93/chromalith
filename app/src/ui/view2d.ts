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

  constructor() {
    this.canvas = h("canvas");
    this.el = h("div", { class: "view canvas-view" }, this.canvas);
    this.el.addEventListener("wheel", (e) => {
      e.preventDefault();
      if (!this.iw) return;
      const r = this.el.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const f = Math.exp(-e.deltaY * 0.0015);
      const ns = Math.min(40, Math.max(0.02, this.scale * f));
      this.x = mx - ((mx - this.x) * ns) / this.scale;
      this.y = my - ((my - this.y) * ns) / this.scale;
      this.scale = ns;
      this.apply();
    }, { passive: false });
    let drag: { x: number; y: number } | null = null;
    this.el.addEventListener("pointerdown", (e) => { drag = { x: e.clientX - this.x, y: e.clientY - this.y }; this.el.setPointerCapture(e.pointerId); this.el.style.cursor = "grabbing"; });
    this.el.addEventListener("pointermove", (e) => {
      if (drag) { this.x = e.clientX - drag.x; this.y = e.clientY - drag.y; this.apply(); }
      if (this.onHover && this.iw) {
        const r = this.el.getBoundingClientRect();
        this.onHover((e.clientX - r.left - this.x) / this.scale, (e.clientY - r.top - this.y) / this.scale);
      }
    });
    const end = () => { drag = null; this.el.style.cursor = ""; };
    this.el.addEventListener("pointerup", end);
    this.el.addEventListener("pointercancel", end);
    this.el.addEventListener("dblclick", () => this.fit());
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
  }
}
