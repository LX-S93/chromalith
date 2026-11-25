/** Linke Seite, Abschnitt „Farbinseln“: Bereiche per Klick ins Originalbild wählen und mit eigenem Filament anheben. */
import { ISLAND_DEFAULTS, filamentLabel, nearestFilament, newId, type Filament, type Island } from "../core";
import { button, clear, h } from "./dom";
import { sliderField, switchField } from "./fields";
import { openLibrary, type LibraryHost } from "./library";

export interface IslandHost {
  islands: Island[];
  libHost: LibraryHost;
  /** Startet die Auswahl im Originalbild; liefert Position (0..1) und Farbe am Klickpunkt. */
  pick(cb: (p: { x: number; y: number; color: string }) => void): void;
  changed(): void;
}

export class IslandPanel {
  el = h("div", { style: { display: "grid", gap: "10px" } });
  private list = h("div", { style: { display: "grid", gap: "10px" } });
  constructor(private host: IslandHost) {
    this.el.append(
      h("p", { class: "hint", style: { margin: 0 } }, "Einen Bereich (z. B. Augen, Blüte) in eigener Farbe hervorheben: Er wird über das übrige Relief angehoben und oben mit dem gewählten Filament gedruckt."),
      this.list,
      button("Farbinsel hinzufügen", () => this.add(), { icon: "plus", title: "Danach im Original-Bild auf den Bereich klicken" }));
  }

  private add() {
    this.host.pick(({ x, y, color }) => {
      const lib = this.host.libHost.library;
      const owned = lib.filter((f) => f.owned);
      const f = nearestFilament(color, owned.length >= 3 ? owned : lib).filament ?? lib[0];
      this.host.islands.push({ id: newId(), filament: { ...f }, seeds: [{ x, y }], ...ISLAND_DEFAULTS });
      this.render(); this.host.changed();
    });
  }

  render() {
    clear(this.list);
    this.host.islands.forEach((isl, k) => {
      const set = (fn: () => void) => { fn(); this.host.changed(); };
      const tol = sliderField("Farbtoleranz", 2, 60, 1, "", (v) => set(() => (isl.tolerance = v)), "Wie stark die Farbe vom angeklickten Punkt abweichen darf.");
      tol.set(isl.tolerance);
      const raise = sliderField("Höhe über dem Relief", 0.08, 2, 0.08, "mm", (v) => set(() => (isl.raise_mm = v)), "Dicke der Inselfarbe. Mehr = kräftigere Farbe.");
      raise.set(isl.raise_mm);
      const cont = switchField("Nur zusammenhängende Fläche", (v) => set(() => (isl.contiguous = v)), "Aus: alle Stellen im Bild mit ähnlicher Farbe.");
      cont.set(isl.contiguous);
      const relief = switchField("Relief in der Insel behalten", (v) => set(() => (isl.keep_relief = v)));
      relief.set(isl.keep_relief);
      const chooseFil = async () => {
        const picked: Filament[] = await openLibrary(this.host.libHost, true);
        if (picked[0]) { isl.filament = { ...picked[0] }; this.render(); this.host.changed(); }
      };
      this.list.append(h("div", { class: "card", style: { padding: "10px", display: "grid", gap: "8px" } },
        h("div", { style: { display: "flex", gap: "8px", alignItems: "center" } },
          h("button", { class: "swatch", title: "Filament wählen", style: { background: isl.filament.color, cursor: "pointer" }, onclick: chooseFil }),
          h("div", { style: { flex: "1", minWidth: "0" } }, h("b", { style: { display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, `Insel ${k + 1}: ${filamentLabel(isl.filament)}`),
            h("small", { class: "hint" }, `${isl.seeds.length} Punkt${isl.seeds.length === 1 ? "" : "e"} · TD ${isl.filament.td.toFixed(1)}`))),
        tol.el, raise.el, cont.el, relief.el,
        h("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap" } },
          button("Punkt dazu", () => this.host.pick(({ x, y }) => { isl.seeds.push({ x, y }); this.render(); this.host.changed(); }), { icon: "plus", cls: "small" }),
          button("Filament", chooseFil, { icon: "library", cls: "small" }),
          button("Löschen", () => { this.host.islands.splice(k, 1); this.render(); this.host.changed(); }, { icon: "trash", cls: "small" }))));
    });
  }
}
