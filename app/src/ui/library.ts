/** Filament-Bibliothek: suchen, anlegen, bearbeiten, löschen, importieren, exportieren, zum Stapel hinzufügen. */
import { makeFilament, parseFilaments, serializeLibrary, filamentLabel, type Filament } from "../core";
import { openFile, saveFile } from "../platform";
import { button, clear, h, modal, toast, confirmDialog } from "./dom";

export interface LibraryHost {
  library: Filament[];
  saveLibrary(): void;
}

export function editFilament(f: Filament | null): Promise<Filament | null> {
  return new Promise((resolve) => {
    const cur = f ?? makeFilament({ name: "", color: "#808080", td: 2, brand: "", owned: true });
    const brand = h("input", { type: "text", value: cur.brand });
    const name = h("input", { type: "text", value: cur.name });
    const material = h("input", { type: "text", value: cur.material });
    const color = h("input", { type: "color", value: cur.color });
    const hex = h("input", { type: "text", value: cur.color, style: { width: "100px" } });
    color.addEventListener("input", () => (hex.value = color.value));
    hex.addEventListener("change", () => { if (/^#[0-9a-f]{6}$/i.test(hex.value)) color.value = hex.value; });
    const td = h("input", { type: "number", value: cur.td, step: 0.1, min: 0.1, max: 100 });
    const owned = h("input", { type: "checkbox", checked: cur.owned });
    const form = h("div", { class: "form-grid" },
      "Marke", brand, "Name", name, "Material", material,
      "Farbe", h("div", { style: { display: "flex", gap: "8px" } }, color, hex),
      h("span", { title: "Transmissions-Distanz: Schichtdicke in mm, ab der das Filament fast deckt." }, "TD (mm)"), td,
      "Vorhanden", h("label", { class: "switch", style: { justifyContent: "flex-start" } }, owned));
    let result: Filament | null = null;
    const close = modal(f ? "Filament bearbeiten" : "Neues Filament", form, [
      button("Abbrechen", () => close()),
      button("Speichern", () => {
        if (!name.value.trim()) { toast("Bitte einen Namen eingeben.", "err"); return; }
        result = { ...cur, brand: brand.value.trim(), name: name.value.trim(), material: material.value.trim() || "PLA",
          color: color.value, td: Math.max(0.05, Number(td.value) || 1), owned: owned.checked };
        close();
      }, { cls: "primary" }),
    ], true, () => resolve(result));
    name.focus();
  });
}

/** Öffnet die Bibliothek. Im Auswahlmodus werden die gewählten Filamente zurückgegeben. */
export function openLibrary(host: LibraryHost, select = false): Promise<Filament[]> {
  return new Promise((resolve) => {
    const chosen = new Set<string>();
    const search = h("input", { class: "search", placeholder: "Suchen (Marke, Name, Material) …" });
    const ownedOnly = h("input", { type: "checkbox" });
    const tbody = h("tbody");
    const count = h("span", { class: "hint" });
    let current: string | null = null;
    const refresh = () => {
      clear(tbody);
      const q = search.value.toLowerCase().trim();
      const rows = host.library.filter((f) => (!ownedOnly.checked || f.owned) && (!q || `${f.brand} ${f.name} ${f.material}`.toLowerCase().includes(q)));
      for (const f of rows) {
        const tr = h("tr", { class: chosen.has(f.id) || current === f.id ? "sel" : "" },
          h("td", null, h("div", { class: "swatch", style: { background: f.color } })),
          h("td", null, f.brand), h("td", null, f.name), h("td", null, f.material),
          h("td", { style: { fontFamily: "monospace" } }, f.color), h("td", null, f.td.toFixed(1)),
          h("td", null, f.owned ? "✓" : ""));
        tr.addEventListener("click", () => {
          current = f.id;
          if (select) chosen.has(f.id) ? chosen.delete(f.id) : chosen.add(f.id);
          refresh();
        });
        tr.addEventListener("dblclick", () => { if (select) { chosen.add(f.id); finish(); } else edit(f); });
        tbody.append(tr);
      }
      count.textContent = select ? `${chosen.size} ausgewählt · ${rows.length} von ${host.library.length}` : `${rows.length} von ${host.library.length} Filamenten`;
      addBtn && (addBtn.disabled = chosen.size === 0);
    };
    const edit = async (f: Filament | null) => {
      const r = await editFilament(f);
      if (!r) return;
      const i = host.library.findIndex((x) => x.id === r.id);
      if (i >= 0) host.library[i] = r; else host.library.push(r);
      host.saveLibrary(); current = r.id; refresh();
    };
    search.addEventListener("input", refresh);
    ownedOnly.addEventListener("change", refresh);
    const tools = h("div", { style: { display: "flex", gap: "8px", alignItems: "center", marginBottom: "10px", flexWrap: "wrap" } },
      search, h("label", { class: "switch", style: { gap: "8px" } }, "Nur vorhandene", ownedOnly),
      button("Neu", () => edit(null), { icon: "plus" }),
      button("Bearbeiten", () => { const f = host.library.find((x) => x.id === current); if (f) edit(f); }, { icon: "edit" }),
      button("Löschen", async () => {
        const f = host.library.find((x) => x.id === current);
        if (!f || !(await confirmDialog("Filament löschen", `„${filamentLabel(f)}“ aus der Bibliothek löschen?`, "Löschen"))) return;
        host.library.splice(host.library.indexOf(f), 1); chosen.delete(f.id); host.saveLibrary(); refresh();
      }, { icon: "trash" }),
      button("Importieren", async () => {
        const file = await openFile([{ name: "Filament-Bibliothek", extensions: ["json", "fss"] }]);
        if (!file) return;
        try {
          const list = parseFilaments(JSON.parse(new TextDecoder().decode(file.bytes)));
          const ids = new Set(host.library.map((f) => f.id));
          let n = 0;
          for (const f of list) if (!ids.has(f.id)) { host.library.push(f); n++; }
          host.saveLibrary(); refresh();
          toast(`${n} Filamente importiert${list.length > n ? `, ${list.length - n} schon vorhanden` : ""}.`, "ok");
        } catch (e: any) { toast("Import fehlgeschlagen: " + e.message, "err"); }
      }, { icon: "upload" }),
      button("Exportieren", () => saveFile("filamente.json", serializeLibrary(host.library), [{ name: "JSON", extensions: ["json"] }]), { icon: "download" }));
    const table = h("table", { class: "lib-table" },
      h("thead", null, h("tr", null, ...["", "Marke", "Name", "Material", "Farbe", "TD", "Vorh."].map((t) => h("th", null, t)))), tbody);
    const content = h("div", null, tools, h("div", { style: { maxHeight: "56vh", overflow: "auto" } }, table));
    let picked: Filament[] = [];
    const finish = () => { picked = host.library.filter((f) => chosen.has(f.id)); close(); };
    const addBtn: HTMLButtonElement | null = select ? button("Zum Stapel hinzufügen", finish, { cls: "primary" }) : null;
    const close = modal(select ? "Filamente hinzufügen" : "Filament-Bibliothek", content,
      [count, h("div", { class: "spacer" }), button(select ? "Abbrechen" : "Schließen", () => close()), ...(addBtn ? [addBtn] : [])], false, () => resolve(picked));
    refresh();
    search.focus();
  });
}
