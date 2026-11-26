/** Update-Funktion der Desktop-App: fragt das neueste Release bei GitHub ab und installiert es auf Wunsch.
 *  Herunterladen, Prüfen (Größe und SHA-256) und Starten des Installers erledigt die App-Seite (Rust). */
import { isTauri, store } from "./platform";
import { button, h, modal, toast } from "./ui/dom";
import { tr } from "./i18n";

export interface Release { version: string; notes: string; url: string; size: number; sha256: string | null }

/** Vergleicht zwei Versionsnummern (1.2.3); > 0, wenn a neuer ist. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(/[.+-]/).map((x) => parseInt(x, 10) || 0), pb = b.replace(/^v/, "").split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) { const d = (pa[i] ?? 0) - (pb[i] ?? 0); if (d) return d; }
  return 0;
}

/** Liest aus der GitHub-Antwort Version, Hinweise und die Installationsdatei. */
export function parseRelease(json: any): Release | null {
  const version = String(json?.tag_name ?? "").replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+$/.test(version) || json?.draft || json?.prerelease) return null;
  const asset = (json.assets ?? []).find((a: any) => /^Chromalith-[\w.]+-Setup\.exe$/.test(String(a?.name)) && (a.state ?? "uploaded") === "uploaded");
  if (!asset || !(asset.size > 0)) return null;
  const digest = /^sha256:([0-9a-f]{64})$/i.exec(String(asset.digest ?? ""));
  return { version, notes: String(json.body ?? "").trim(), url: String(asset.browser_download_url), size: asset.size, sha256: digest ? digest[1] : null };
}

const errorText = (e: any) => {
  const m = String(e?.message ?? e);
  return m === "checksum" ? "Die heruntergeladene Datei ist beschädigt (Prüfsumme stimmt nicht)."
    : m === "windows-only" ? "Automatische Updates gibt es nur in der Windows-App."
    : m === "bad-url" ? "Für dieses Release gibt es keine Installationsdatei." : m;
};

let open = false;
/** Sucht nach einer neueren Version. `manual`: vom Menü aus – meldet dann auch „ist aktuell“ und Fehler. */
export async function checkForUpdate(current: string, manual: boolean, isDirty: () => boolean, save: () => Promise<void>) {
  if (!isTauri()) { if (manual) toast("Im Browser lädt immer die neueste Version; ein Update ist nicht nötig."); return; }
  if (open) return;
  let rel: Release | null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    rel = parseRelease(JSON.parse(await invoke<string>("latest_release")));
  } catch (e) { if (manual) toast(tr("Update-Prüfung fehlgeschlagen: {}").replace("{}", tr(errorText(e))), "err"); return; }
  if (!rel || compareVersions(rel.version, current) <= 0) { if (manual) toast(`Chromalith ist aktuell (Version ${current}).`, "ok"); return; }
  if (!manual && store.get("updateSkip", "") === rel.version) return;
  const r = rel;
  open = true;
  const auto = h("input", { type: "checkbox", checked: store.get("updateAuto", true) });
  auto.addEventListener("change", () => store.set("updateAuto", auto.checked));
  const now = button("Jetzt aktualisieren", async () => {
    if (isDirty()) {
      // offene Änderungen: speichern und aktualisieren, verwerfen und aktualisieren oder abbrechen
      const choice = await new Promise<"save" | "discard" | null>((resolve) => {
        let c: "save" | "discard" | null = null;
        const closeAsk = modal("Ungespeicherte Änderungen", h("p", { style: { margin: "0", lineHeight: "1.5" } }, "Das aktuelle Projekt hat ungespeicherte Änderungen. Beim Update startet Chromalith neu."),
          [button("Abbrechen", () => closeAsk()), button("Verwerfen und aktualisieren", () => { c = "discard"; closeAsk(); }),
            button("Speichern und aktualisieren", () => { c = "save"; closeAsk(); }, { cls: "primary" })], true, () => resolve(c));
      });
      if (!choice) return;
      if (choice === "save") { await save(); if (isDirty()) return; }
    }
    now.disabled = true; now.textContent = "Lade Update …";
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      toast("Update wird installiert. Chromalith startet danach neu.", "", 60000);
      await invoke("install_update", { url: r.url, size: r.size, sha256: r.sha256 });
    } catch (e) { now.disabled = false; now.textContent = "Jetzt aktualisieren"; toast(tr("Update fehlgeschlagen: {}").replace("{}", tr(errorText(e))), "err", 9000); }
  }, { cls: "primary" });
  const close = modal("Update verfügbar", h("div", { style: { lineHeight: "1.5" } },
    h("p", { style: { marginTop: "0" } }, `Chromalith ${r.version} ist verfügbar (installiert: ${current}).`),
    r.notes ? h("div", { class: "hint" }, "Neu in dieser Version:") : null,
    r.notes ? h("pre", { "data-notr": true, style: { whiteSpace: "pre-wrap", font: "inherit", fontSize: "13px", background: "var(--bg)", padding: "10px", borderRadius: "8px", maxHeight: "240px", overflow: "auto", margin: "6px 0 12px" } }, r.notes) : null,
    h("label", { class: "hint", style: { display: "flex", gap: "8px", alignItems: "center" } }, auto, "Beim Start automatisch nach Updates suchen")),
    [button("Diese Version überspringen", () => { store.set("updateSkip", r.version); close(); }, { cls: "ghost" }), button("Später", () => close()), now],
    true, () => { open = false; });
}

/** Beim Start still nachsehen (nur Desktop-App, abschaltbar im Update-Dialog). */
export function autoCheckForUpdate(current: string, isDirty: () => boolean, save: () => Promise<void>) {
  if (isTauri() && store.get("updateAuto", true)) setTimeout(() => checkForUpdate(current, false, isDirty, save), 4000);
}
