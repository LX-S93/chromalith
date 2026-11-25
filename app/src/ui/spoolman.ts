/** Spoolman-Anbindung: Adresse einstellen, Rollen abrufen und mit der Bibliothek abgleichen (nur lesend). */
import { spoolmanBase, spoolmanUrl, syncSpoolman, type Filament, type SpoolmanSync } from "../core";
import { fetchJson, isTauri, store } from "../platform";
import { button, h, modal, toast } from "./dom";

export interface SpoolmanHost { library: Filament[]; saveLibrary(): void }

export const spoolmanAddress = () => store.get("spoolmanUrl", "");

/** Holt alle Rollen und gleicht die Bibliothek ab. Wirft bei Verbindungsfehlern. */
export async function spoolmanSync(host: SpoolmanHost, base = spoolmanAddress()): Promise<SpoolmanSync> {
  const spools = await fetchJson(spoolmanUrl(base, "spool"));
  const r = syncSpoolman(host.library, spools);
  host.saveLibrary();
  store.set("spoolmanLast", { time: Date.now(), ...r });
  return r;
}

export function syncSummary(r: SpoolmanSync): string {
  const parts = [`${r.total} Filament${r.total === 1 ? "" : "e"} aus Spoolman`, `${r.added} neu`, `${r.updated} aktualisiert`];
  if (r.gone) parts.push(`${r.gone} nicht mehr vorhanden`);
  if (r.estimated) parts.push(`${r.estimated} mit geschätztem TD`);
  if (r.skipped) parts.push(`${r.skipped} Rollen ohne Farbe übersprungen`);
  return parts.join(" · ");
}

/** Abgleich beim Programmstart, wenn eine Adresse hinterlegt ist. Fehler bleiben still (z. B. unterwegs). */
export async function spoolmanAutoSync(host: SpoolmanHost): Promise<SpoolmanSync | null> {
  if (!spoolmanAddress() || !store.get("spoolmanAuto", true)) return null;
  try { return await spoolmanSync(host); } catch { return null; }
}

export function openSpoolman(host: SpoolmanHost): Promise<void> {
  return new Promise((resolve) => {
    const url = h("input", { class: "search", type: "text", value: spoolmanAddress(), placeholder: "z. B. http://192.168.1.20:7912", style: { flex: "1", minWidth: "260px" } });
    const auto = h("input", { type: "checkbox", checked: store.get("spoolmanAuto", true) });
    auto.addEventListener("change", () => store.set("spoolmanAuto", auto.checked));
    const status = h("div", { class: "hint", style: { minHeight: "38px", marginTop: "12px", lineHeight: "1.5" } });
    const last = store.get<any>("spoolmanLast", null);
    if (last && spoolmanAddress()) status.textContent = `Letzter Abgleich ${new Date(last.time).toLocaleString("de-DE")}: ${syncSummary(last)}`;
    const run = async () => {
      const base = spoolmanBase(url.value);
      if (!base) { toast("Bitte die Adresse von Spoolman eingeben.", "err"); return; }
      url.value = base;
      go.disabled = true;
      status.replaceChildren(h("div", { style: { display: "flex", gap: "8px", alignItems: "center" } }, h("div", { class: "spinner" }), "Verbinde mit Spoolman …"));
      try {
        const r = await spoolmanSync(host, base);
        store.set("spoolmanUrl", base);
        status.replaceChildren(h("strong", { style: { color: "var(--ok, #6c6)" } }, "Verbunden. "), syncSummary(r) + ".",
          r.estimated ? h("div", null, "Geschätzte TD-Werte sind in der Bibliothek mit „~“ markiert. Trage dort den echten TD ein oder lege in Spoolman beim Filament ein Zusatzfeld „td“ an.") : "");
      } catch (e: any) {
        status.replaceChildren(h("strong", { style: { color: "var(--err, #e66)" } }, "Keine Verbindung. "), String(e?.message ?? e),
          h("div", null, isTauri()
            ? "Prüfe Adresse und Port und ob dieser PC im selben Netz wie Spoolman ist."
            : "Im Browser muss Spoolman Zugriffe von dieser Seite erlauben (Einstellung SPOOLMAN_CORS_ORIGIN). In der Desktop-App ist das nicht nötig."));
      } finally { go.disabled = false; }
    };
    const go = button("Verbinden und abgleichen", run, { cls: "primary", icon: "download" });
    url.addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
    const content = h("div", { style: { lineHeight: "1.55", maxWidth: "620px" } },
      h("p", { style: { marginTop: 0 } }, "Übernimmt deine Rollen aus Spoolman als „vorhandene“ Filamente: Farbe, Material, Hersteller, Preis und Restgewicht. Vorschläge und Kosten rechnen dann mit dem, was wirklich im Regal liegt."),
      h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } }, url, go),
      h("label", { class: "switch", style: { justifyContent: "flex-start", gap: "8px", marginTop: "12px" } }, auto, "Beim Programmstart automatisch abgleichen"),
      status,
      h("p", { class: "hint", style: { marginBottom: 0 } }, "Chromalith liest nur aus Spoolman und ändert dort nichts. Der TD-Wert wird aus einem Zusatzfeld „td“ am Filament gelesen, falls vorhanden."),
      spoolmanAddress() ? button("Verbindung entfernen", () => {
        store.set("spoolmanUrl", ""); url.value = ""; status.textContent = "Verbindung entfernt. Bereits übernommene Filamente bleiben in der Bibliothek.";
      }, { cls: "small ghost" }) : "");
    const close = modal("Spoolman", content, [button("Schließen", () => close())], true, () => resolve());
    url.focus();
  });
}
