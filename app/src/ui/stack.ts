/** Filament-Stapel: Liste (oben = zuletzt gedruckt), Startschichten, Schichtbalken mit ziehbaren Wechseln. */
import { filamentAtLayer, filamentLabel, filamentLuminance, layerTopZ, type ColorStop } from "../core";
import { button, clear, h } from "./dom";

export interface LayerInfo { layerCount: number; minLayer: number; base: number; step: number; colorMode: boolean }

export interface StackHost {
  stops: ColorStop[];
  changed(structural: boolean): void;
  add(): void;
  auto(): void;
  loadSet(): void;
  suggest(): void;
  saveSet(): void;
}

export class StackPanel {
  el: HTMLElement;
  private list = h("div", { class: "stack-list" });
  private bar = h("canvas", { class: "layerbar", title: "Wechsel nach oben/unten ziehen" });
  private info = h("div", { class: "stack-info hint" });
  private selected: number | null = null;
  private li: LayerInfo = { layerCount: 30, minLayer: 1, base: 0.16, step: 0.08, colorMode: false };
  private zLabels = new Map<number, HTMLElement>();

  constructor(private host: StackHost) {
    const actions = h("div", { class: "stack-actions" },
      button("Hinzufügen", () => host.add(), { icon: "plus" }),
      button("Entfernen", () => this.remove(), { icon: "trash" }),
      button("Nach oben", () => this.move(+1), { icon: "up" }),
      button("Nach unten", () => this.move(-1), { icon: "down" }),
      button("Automatisch verteilen", () => host.auto(), { icon: "magic", cls: "primary wide",
        title: "Sucht passende Wechsel-Schichten. Im farbtreuen Modus so, dass die Bildfarben am besten getroffen werden." }),
      button("Filamente vorschlagen", () => host.suggest(), { icon: "library", cls: "wide",
        title: "Sucht aus deiner Bibliothek das Filament-Set, das die Bildfarben am besten trifft." }),
      button("Nach Helligkeit sortieren", () => this.sortByBrightness(), { icon: "sort", cls: "wide" }),
      button("Set laden", () => host.loadSet(), { icon: "folder" }),
      button("Set speichern", () => host.saveSet(), { icon: "save" }));
    this.el = h("aside", { class: "right" },
      h("div", { class: "stack-head" }, h("h3", null, "Filament-Stapel"), h("span", { class: "hint" }, "oben = zuletzt gedruckt")),
      h("div", { class: "stack-body" }, this.bar, this.list),
      this.info, actions);
    this.initDrag();
    new ResizeObserver(() => this.drawBar()).observe(this.bar);
  }

  get stops() { return this.host.stops; }

  setInfo(li: LayerInfo) {
    const same = JSON.stringify(li) === JSON.stringify(this.li);
    this.li = li;
    const before = this.stops.map((s) => s.start_layer).join();
    this.clamp();
    if (!same || before !== this.stops.map((s) => s.start_layer).join()) this.render();
    else this.drawBar();
  }

  /** Startschichten in den gültigen Bereich bringen (aufsteigend, erstes = 1). */
  clamp() {
    const st = this.stops;
    st.sort((a, b) => a.start_layer - b.start_layer);
    st.forEach((s, i) => { s.start_layer = i === 0 ? 1 : Math.max(st[i - 1].start_layer + 1, Math.min(s.start_layer, this.li.layerCount)); });
  }

  render() {
    clear(this.list);
    this.zLabels.clear();
    const st = this.stops;
    for (let idx = st.length - 1; idx >= 0; idx--) {
      const s = st[idx];
      const lo = idx === 0 ? 1 : st[idx - 1].start_layer + 1;
      const hi = idx === 0 ? 1 : idx + 1 < st.length ? st[idx + 1].start_layer - 1 : this.li.layerCount;
      const input = h("input", { class: "num", type: "number", min: lo, max: Math.max(lo, hi), step: 1, value: s.start_layer, disabled: idx === 0,
        title: idx === 0 ? "Das unterste Filament beginnt immer bei Schicht 1." : "Ab dieser Schicht wird dieses Filament gedruckt." });
      input.addEventListener("click", (e) => e.stopPropagation());
      input.addEventListener("input", () => {
        const v = Math.round(Number(input.value));
        if (!Number.isFinite(v) || v < lo || v > Math.max(lo, hi)) return;
        this.setLayer(idx, v, false);
      });
      input.addEventListener("change", () => this.setLayer(idx, Math.min(Math.max(lo, hi), Math.max(lo, Math.round(Number(input.value)) || lo)), true));
      const z = h("div", { class: "z" });
      this.zLabels.set(idx, z);
      const above = s.start_layer > this.li.layerCount && idx > 0;
      const row = h("div", { class: "stop" + (this.selected === idx ? " selected" : ""), style: { opacity: above ? "0.5" : "1" } },
        h("div", { class: "swatch", style: { background: s.filament.color } }),
        h("div", { class: "title" }, h("b", null, filamentLabel(s.filament)),
          h("small", null, `${s.filament.material} · TD ${s.filament.td.toFixed(1)}`)),
        h("div", null, h("div", { class: "layer" }, h("span", { class: "hint" }, "ab"), input), z));
      row.addEventListener("click", () => { this.selected = idx; this.render(); });
      this.list.append(row);
    }
    this.updateZ();
    this.updateInfo();
    this.drawBar();
  }

  private setLayer(idx: number, v: number, full: boolean) {
    this.stops[idx].start_layer = v;
    if (full) this.render(); else { this.updateZ(); this.drawBar(); }
    this.host.changed(false);
  }

  private updateZ() {
    this.stops.forEach((s, i) => {
      const z = i === 0 ? 0 : layerTopZ(s.start_layer - 1, this.li.base, this.li.step);
      const el = this.zLabels.get(i);
      if (el) el.textContent = `Z ${z.toFixed(2)} mm`;
    });
  }

  private updateInfo() {
    const { layerCount, minLayer, colorMode } = this.li;
    clear(this.info);
    let t = `Modell: ${layerCount} Schichten, Bild beginnt bei Schicht ${minLayer}.`;
    if (this.stops.slice(1).some((s) => s.start_layer > layerCount)) t += " Ein Filament liegt oberhalb des Modells.";
    this.info.append(t);
    if (colorMode) this.info.append(h("div", { style: { marginTop: "6px" } },
      "Farbtreuer Modus: Die Reihenfolge darf bunt gemischt sein. „Automatisch verteilen“ sucht die Wechsel, die die Bildfarben am besten treffen."));
    else if (!this.isMonotonic()) this.info.append(h("div", { class: "hint warn", style: { marginTop: "6px" } },
      "Hinweis: Die Filamente sind nicht nach Helligkeit geordnet. Die Höhe folgt der Bildhelligkeit, deshalb sollten die Farben von unten nach oben stetig dunkler (oder heller) werden. „Nach Helligkeit sortieren“ behebt das."));
  }

  isMonotonic(): boolean {
    const lum = this.stops.map((s) => filamentLuminance(s.filament));
    if (lum.length < 3) return true;
    const d = lum.slice(1).map((v, i) => v - lum[i]);
    return d.every((x) => x <= 0.03) || d.every((x) => x >= -0.03);
  }

  private remove() {
    if (this.selected === null) return;
    this.stops.splice(this.selected, 1);
    if (this.stops.length) this.stops[0].start_layer = 1;
    this.selected = this.stops.length ? Math.min(this.selected, this.stops.length - 1) : null;
    this.render(); this.host.changed(true);
  }

  private move(dir: number) {
    const i = this.selected, st = this.stops;
    if (i === null || i + dir < 0 || i + dir >= st.length) return;
    [st[i].filament, st[i + dir].filament] = [st[i + dir].filament, st[i].filament];
    this.selected = i + dir;
    this.render(); this.host.changed(true);
  }

  /** Filamente nach Helligkeit ordnen (Richtung nach dem untersten Filament), Startschichten bleiben. */
  private sortByBrightness() {
    const st = this.stops;
    if (st.length < 2) return;
    const fils = st.map((s) => s.filament);
    const lums = fils.map(filamentLuminance);
    const darkOnTop = lums[0] >= lums.reduce((a, b) => a + b, 0) / lums.length;
    fils.sort((a, b) => (darkOnTop ? filamentLuminance(b) - filamentLuminance(a) : filamentLuminance(a) - filamentLuminance(b)));
    st.forEach((s, i) => (s.filament = fils[i]));
    this.render(); this.host.changed(true);
  }

  /** Neue Filamente oben anfügen, jeweils auf halbem Weg zwischen letztem Wechsel und Modelloberkante. */
  addFilaments(list: ColorStop["filament"][]) {
    const st = this.stops;
    for (const f of list) {
      if (!st.length) { st.push({ filament: f, start_layer: 1 }); continue; }
      const last = st[st.length - 1].start_layer;
      let layer = Math.min(this.li.layerCount, Math.max(last + 1, Math.floor((last + this.li.layerCount + 1) / 2)));
      if (layer <= last) layer = last + 1;
      st.push({ filament: f, start_layer: layer });
    }
    this.render(); this.host.changed(true);
  }

  // ------------------------------------------------------------ Schichtbalken
  private geom() {
    const r = this.bar.getBoundingClientRect();
    const n = Math.max(1, this.li.layerCount);
    return { r, n, lh: r.height / n };
  }

  drawBar() {
    const { r, n, lh } = this.geom();
    const dpr = window.devicePixelRatio || 1;
    if (r.width < 2 || r.height < 2) return;
    this.bar.width = Math.round(r.width * dpr); this.bar.height = Math.round(r.height * dpr);
    const g = this.bar.getContext("2d")!;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, r.width, r.height);
    for (let layer = 1; layer <= n; layer++) {
      const f = filamentAtLayer(this.stops, layer);
      g.fillStyle = f ? f.color : "#000";
      const y = r.height - layer * lh;
      g.fillRect(0, y, r.width, lh + 0.5);
    }
    // Bereich unter dem Bild abdunkeln
    if (this.li.minLayer > 1) {
      g.fillStyle = "#0008";
      g.fillRect(0, r.height - (this.li.minLayer - 1) * lh, r.width, (this.li.minLayer - 1) * lh);
    }
    g.lineWidth = 2;
    this.stops.forEach((s, i) => {
      if (i === 0 || s.start_layer > n) return;
      const y = r.height - (s.start_layer - 1) * lh;
      g.strokeStyle = i === this.selected ? "#fff" : "#ffffffaa";
      g.beginPath(); g.moveTo(0, y); g.lineTo(r.width, y); g.stroke();
      g.fillStyle = "#fff";
      g.beginPath(); g.moveTo(r.width, y - 5); g.lineTo(r.width - 7, y); g.lineTo(r.width, y + 5); g.fill();
    });
  }

  private initDrag() {
    let dragging: number | null = null;
    const layerAt = (e: PointerEvent) => {
      const { r, n, lh } = this.geom();
      return Math.min(n, Math.max(1, Math.round((r.bottom - e.clientY) / lh) + 1));
    };
    this.bar.addEventListener("pointerdown", (e) => {
      const { r, lh } = this.geom();
      let best: number | null = null, bd = 9;
      this.stops.forEach((s, i) => {
        if (i === 0) return;
        const d = Math.abs(r.bottom - (s.start_layer - 1) * lh - e.clientY);
        if (d < bd) { bd = d; best = i; }
      });
      if (best === null) return;
      dragging = best; this.selected = best;
      this.bar.setPointerCapture(e.pointerId);
      this.render();
    });
    this.bar.addEventListener("pointermove", (e) => {
      if (dragging === null) return;
      const st = this.stops, i = dragging;
      const lo = st[i - 1].start_layer + 1;
      const hi = i + 1 < st.length ? st[i + 1].start_layer - 1 : this.li.layerCount;
      const v = Math.min(Math.max(lo, hi), Math.max(lo, layerAt(e)));
      if (v !== st[i].start_layer) this.setLayer(i, v, true);
    });
    const end = () => { dragging = null; };
    this.bar.addEventListener("pointerup", end);
    this.bar.addEventListener("pointercancel", end);
  }
}
