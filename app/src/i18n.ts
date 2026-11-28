/** Sprache der Oberfläche. Quelltext und Schlüssel sind Deutsch; für Englisch wird beim Anzeigen übersetzt.
 *  Einträge mit {} sind Muster: an der Stelle steht ein beliebiger Wert (Zahl, Name), der übernommen wird. */
import { EN } from "./i18n-en";

export type Lang = "de" | "en";

function detect(): Lang {
  let saved: string | null = null;
  try { saved = JSON.parse(localStorage.getItem("chromalith.lang") ?? "null"); } catch { /* nichts gespeichert */ }
  if (saved === "de" || saved === "en") return saved;
  const sys = (typeof navigator !== "undefined" && (navigator.languages?.[0] ?? navigator.language)) || "en";
  return /^de\b/i.test(sys) ? "de" : "en";
}

export const lang: Lang = detect();
/** Sprache fest einstellen ("auto" = wieder nach dem Betriebssystem) und neu laden. */
export function setLang(l: Lang | "auto") {
  if (l === "auto") localStorage.removeItem("chromalith.lang"); else localStorage.setItem("chromalith.lang", JSON.stringify(l));
  location.reload();
}

const exact = new Map<string, string>();
const patterns: { re: RegExp; out: string; len: number }[] = [];
for (const [k, v] of Object.entries(EN)) {
  if (!k.includes("{}")) { exact.set(k, v); continue; }
  const re = new RegExp("^" + k.split("{}").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("([\\s\\S]*?)") + "$");
  patterns.push({ re, out: v, len: k.length });
}
patterns.sort((a, b) => b.len - a.len);
const cache = new Map<string, string>();

/** Übersetzt einen Anzeigetext. Unbekannte Texte (z. B. Filament- und Dateinamen) bleiben unverändert. */
export function tr(s: string): string {
  if (lang === "de" || !s || s.length < 2) return s;
  const hit = exact.get(s) ?? cache.get(s);
  if (hit !== undefined) return hit;
  let out = s;
  // führende/abschließende Leerzeichen erhalten
  const core = s.trim();
  if (core !== s && exact.has(core)) out = s.replace(core, exact.get(core)!);
  else for (const p of patterns) {
    const m = p.re.exec(s);
    if (!m) continue;
    let i = 0;
    out = p.out.replace(/\{\}/g, () => tr(m[++i] ?? ""));
    break;
  }
  // mehrere Sätze hintereinander (z. B. Hinweise zum Körper): Satz für Satz
  if (out === s && /[.!?] \S/.test(s)) { const parts = s.split(/(?<=[.!?]) /); if (parts.length > 1) out = parts.map((x) => tr(x)).join(" "); }
  if (cache.size < 5000) cache.set(s, out);
  return out;
}

/** Mehrzeilige Texte (z. B. die Farbwechsel-Liste) zeilenweise übersetzen. */
export const trLines = (text: string) => (lang === "de" ? text : text.split("\n").map((l) => { const t = l.trimStart(); return l.slice(0, l.length - t.length) + tr(t); }).join("\n"));

/** Zahl mit Dezimaltrennzeichen der Sprache. */
export const num = (v: number, d = 1) => (lang === "de" ? v.toFixed(d).replace(".", ",") : v.toFixed(d));

/** Im englischen Modus alles übersetzen, was in die Seite kommt (Texte, Tooltips, Platzhalter) –
 *  so bleibt der Quelltext der Oberfläche unverändert und nichts wird vergessen. */
const ATTRS = ["title", "placeholder", "aria-label"];
function trNode(n: Node) {
  if (n.nodeType === 3) {
    const p = n.parentElement;
    if (p && (p.tagName === "SCRIPT" || p.tagName === "STYLE" || p.closest("[data-notr]"))) return;
    const v = n.nodeValue ?? "", t = tr(v);
    if (t !== v) n.nodeValue = t;
    return;
  }
  if (n.nodeType !== 1) return;
  const el = n as Element;
  if (el.tagName === "SCRIPT" || el.tagName === "STYLE") return;
  for (const a of ATTRS) { const v = el.getAttribute(a); if (v) { const t = tr(v); if (t !== v) el.setAttribute(a, t); } }
  if (el.tagName === "IFRAME") return;
  for (let c = el.firstChild; c; c = c.nextSibling) trNode(c);
}
export function watchDom() {
  if (lang === "de" || typeof document === "undefined") return;
  document.documentElement.lang = "en";
  trNode(document.body);
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "childList") m.addedNodes.forEach(trNode);
      else if (m.type === "characterData") trNode(m.target);
      else if (m.type === "attributes" && m.attributeName) {
        const el = m.target as Element, v = el.getAttribute(m.attributeName);
        if (v) { const t = tr(v); if (t !== v) el.setAttribute(m.attributeName, t); }
      }
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

/** Endungen der exportierten Begleitdateien in der Sprache der Oberfläche. */
const FILES: Record<string, string> = { _farbwechsel: "_colour_changes", _vorschau: "_preview", _druckassistent: "_print_assistant", _lithophanie: "_lithophane",
  _nachtbild: "_night_image", _nachtvorschau: "_night_preview", _lentikular: "_lenticular" };
export const fileSuffix = (s: string) => (lang === "de" ? s : s.replace(/^_[a-z]+/, (m) => FILES[m] ?? m));
