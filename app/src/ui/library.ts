/** Filament-Bibliothek: suchen, anlegen, bearbeiten, löschen, importieren, exportieren, zum Stapel hinzufügen. */
import { makeFilament, serializeLibrary, filamentLabel, type Filament } from "../core";
import { saveFile } from "../platform";
import { button, clear, contextMenu, h, modal, toast, confirmDialog } from "./dom";
import { filesFromDrop, findLibraryFolders, importFiles, pickFilesBrowser, pickFolderDesktop, readFolder } from "./importer";
import { isTauri, store } from "../platform";
import { openSpoolman } from "./spoolman";
import { openTdCalibration } from "./tdcal";

export interface LibraryHost {
  library: Filament[];
  saveLibrary(): void;
  /** TD-Kalibrierung für ein Filament der Bibliothek (übernimmt das Ergebnis selbst) */
  measureTd?(f: Filament | null): Promise<void>;
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
    const td = h("input", { type: "number", value: cur.td, step: 0.05, min: 0.05, max: 100 });
    const measure = button("Messen …", async () => {
      const r = await openTdCalibration({ ...cur, brand: brand.value.trim(), name: name.value.trim(), color: color.value, td: Number(td.value) || cur.td }, true);
      if (r) td.value = String(r.td);
    }, { cls: "small", title: "TD mit einer gedruckten Stufentreppe bestimmen" });
    const owned = h("input", { type: "checkbox", checked: cur.owned });
    const form = h("div", { class: "form-grid" },
      "Marke", brand, "Name", name, "Material", material,
      "Farbe", h("div", { style: { display: "flex", gap: "8px" } }, color, hex),
      h("span", { title: "Transmissions-Distanz: Schichtdicke in mm, ab der das Filament fast deckt." }, cur.td_estimated ? "TD (mm, geschätzt)" : "TD (mm)"), h("div", { style: { display: "flex", gap: "8px", alignItems: "center" } }, td, measure),
      "Vorhanden", h("label", { class: "switch", style: { justifyContent: "flex-start" } }, owned));
    let result: Filament | null = null;
    const close = modal(f ? "Filament bearbeiten" : "Neues Filament", form, [
      button("Abbrechen", () => close()),
      button("Speichern", () => {
        if (!name.value.trim()) { toast("Bitte einen Namen eingeben.", "err"); return; }
        result = { ...cur, brand: brand.value.trim(), name: name.value.trim(), material: material.value.trim() || "PLA",
          color: color.value, td: Math.max(0.05, Number(td.value) || 1), owned: owned.checked };
        if (Number(td.value) !== cur.td) delete result.td_estimated;
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
          h("td", { style: { fontFamily: "monospace" } }, f.color), h("td", f.td_estimated ? { title: "Geschätzt vom farblich nächsten Filament. Bitte den echten TD eintragen.", style: { color: "var(--warn)" } } : null, (f.td_estimated ? "~" : "") + f.td.toFixed(1)),
          h("td", null, f.owned ? "✓" : ""),
          h("td", { title: f.spoolman_id != null ? "Restmenge laut Spoolman" : "" }, f.remaining_g != null && f.spoolman_id != null ? `${f.remaining_g} g` : ""));
        tr.addEventListener("click", () => {
          current = f.id;
          if (select) chosen.has(f.id) ? chosen.delete(f.id) : chosen.add(f.id);
          refresh();
        });
        tr.addEventListener("contextmenu", (e) => {
          current = f.id; refresh();
          contextMenu(e, [
            { label: "Bearbeiten …", icon: "edit", fn: () => edit(f) },
            ...(host.measureTd ? [{ label: "TD messen …", icon: "contrast", fn: () => host.measureTd!(f).then(refresh) }] : []),
            { label: f.owned ? "Als nicht vorhanden markieren" : "Als vorhanden markieren", icon: "library", fn: () => { f.owned = !f.owned; host.saveLibrary(); refresh(); } },
            { label: "Duplizieren", icon: "plus", fn: () => { const c = makeFilament({ ...f, id: undefined, name: f.name + " (Kopie)" }); delete c.spoolman_id; host.library.splice(host.library.indexOf(f) + 1, 0, c); host.saveLibrary(); current = c.id; refresh(); } },
            null,
            { label: "Aus der Bibliothek löschen", icon: "trash", danger: true, fn: () => del(f) },
          ]);
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
    const del = async (f: Filament | undefined) => {
      if (!f || !(await confirmDialog("Filament löschen", `„${filamentLabel(f)}“ aus der Bibliothek löschen?`, "Löschen"))) return;
      host.library.splice(host.library.indexOf(f), 1); chosen.delete(f.id); host.saveLibrary(); refresh();
    };
    search.addEventListener("input", refresh);
    ownedOnly.addEventListener("change", refresh);
    const tools = h("div", { style: { display: "flex", gap: "8px", alignItems: "center", marginBottom: "10px", flexWrap: "wrap" } },
      search, h("label", { class: "switch", style: { gap: "8px" } }, "Nur vorhandene", ownedOnly),
      button("Neu", () => edit(null), { icon: "plus" }),
      button("Bearbeiten", () => { const f = host.library.find((x) => x.id === current); if (f) edit(f); }, { icon: "edit" }),
      button("Löschen", () => del(host.library.find((x) => x.id === current)), { icon: "trash" }),
      ...(host.measureTd ? [button("TD messen", () => host.measureTd!(host.library.find((x) => x.id === current) ?? null).then(refresh), { icon: "contrast", title: "TD mit einer gedruckten Stufentreppe bestimmen: Foto im Gegenlicht auswerten oder die erste dunkle Stufe angeben" })] : []),
      button("Importieren", () => importDialog(host).then(refresh), { icon: "upload", title: "Filamente aus Bibliotheks- oder Set-Dateien (.json/.fss) oder einem ganzen Ordner übernehmen" }),
      button("Spoolman", () => openSpoolman(host).then(refresh), { icon: "download", title: "Rollen aus Spoolman als vorhandene Filamente übernehmen (Farbe, Material, Preis, Restgewicht)" }),
      button("Exportieren", () => saveFile("filamente.json", serializeLibrary(host.library), [{ name: "JSON", extensions: ["json"] }]), { icon: "download" }));
    const table = h("table", { class: "lib-table" },
      h("thead", null, h("tr", null, ...["", "Marke", "Name", "Material", "Farbe", "TD", "Vorh.", "Rest"].map((t) => h("th", null, t)))), tbody);
    const content = h("div", null, tools, h("div", { style: { maxHeight: "56vh", overflow: "auto" } }, table),
      h("p", { class: "hint", style: { margin: "10px 0 0" } }, "Tipp: Bibliotheks-Dateien oder ganze Ordner hierher ziehen, um Filamente zu übernehmen."));
    content.addEventListener("dragover", (e) => { e.preventDefault(); e.stopPropagation(); });
    content.addEventListener("drop", async (e) => {
      e.preventDefault(); e.stopPropagation();
      if (!e.dataTransfer) return;
      const files = await filesFromDrop(e.dataTransfer);
      importFiles(host.library, files, "Aus den abgelegten Dateien:"); host.saveLibrary(); refresh();
    });
    let picked: Filament[] = [];
    const finish = () => { picked = host.library.filter((f) => chosen.has(f.id)); close(); };
    const addBtn: HTMLButtonElement | null = select ? button("Zum Stapel hinzufügen", finish, { cls: "primary" }) : null;
    const close = modal(select ? "Filamente hinzufügen" : "Filament-Bibliothek", content,
      [count, h("div", { class: "spacer" }), button(select ? "Abbrechen" : "Schließen", () => close()), ...(addBtn ? [addBtn] : [])], false, () => resolve(picked));
    refresh();
    search.focus();
  });
}

/** Import-Dialog: gefundene Ordner zur Auswahl, Ordner wählen, einzelne Dateien wählen. */
export function importDialog(host: LibraryHost): Promise<void> {
  return new Promise((resolve) => {
    const list = h("div", { style: { display: "grid", gap: "8px", margin: "10px 0" } });
    const searching = h("div", { class: "hint", style: { display: "flex", gap: "8px", alignItems: "center" } }, h("div", { class: "spinner" }), "Suche nach vorhandenen Filament-Bibliotheken …");
    const run = async (label: string, get: () => Promise<{ files: { name: string; text: string }[]; folder?: string } | null>) => {
      const r = await get();
      if (!r) return;
      close();
      if (r.folder) store.set("importFolder", r.folder);
      importFiles(host.library, r.files, label);
      host.saveLibrary();
    };
    const fromFolder = (folder: string) => run(`Aus dem Ordner ${folder}:`, async () => ({ files: await readFolder(folder), folder }));
    const content = h("div", { style: { lineHeight: "1.55" } },
      h("p", { style: { marginTop: 0 } }, "Übernimmt Filamente mit Farbe und TD aus vorhandenen Bibliotheks- und Set-Dateien (.json, .fss), auch aus einem ganzen Ordner mit Unterordnern. Doppelte werden automatisch übersprungen."),
      isTauri() ? searching : null, list,
      h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
        button("Ordner wählen …", async () => {
          if (isTauri()) { const d = await pickFolderDesktop(); if (d) fromFolder(d); }
          else run("Aus dem gewählten Ordner:", async () => ({ files: await pickFilesBrowser(true) }));
        }, { icon: "folder" }),
        button("Dateien wählen …", () => run("Aus den gewählten Dateien:", async () => {
          if (!isTauri()) return { files: await pickFilesBrowser(false) };
          const { open } = await import("@tauri-apps/plugin-dialog");
          const { readFile } = await import("@tauri-apps/plugin-fs");
          const ps = await open({ multiple: true, filters: [{ name: "Filament-Bibliothek / Set", extensions: ["json", "fss"] }] });
          if (!ps) return null;
          const arr = Array.isArray(ps) ? ps : [ps];
          return { files: await Promise.all(arr.map(async (p) => ({ name: String(p).split(/[\\/]/).pop()!, text: new TextDecoder().decode(await readFile(String(p))) }))) };
        }), { icon: "file" })));
    const close = modal("Filamente importieren", content, [button("Schließen", () => close())], true, () => resolve());
    if (isTauri()) findLibraryFolders().then((found) => {
      searching.remove();
      if (!found.length) { list.append(h("div", { class: "hint" }, "Keine Bibliothek automatisch gefunden. Wähle den Ordner bitte selbst.")); return; }
      list.append(h("div", { class: "hint" }, "Gefunden:"));
      for (const f of found) {
        const b = button(f, () => fromFolder(f), { icon: "library", cls: "primary", title: "Alle Bibliotheken und Sets aus diesem Ordner übernehmen" });
        b.style.whiteSpace = "normal"; b.style.height = "auto"; b.style.padding = "8px 12px"; b.style.textAlign = "left";
        list.append(b);
      }
    });
  });
}
