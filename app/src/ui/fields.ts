/** Eingabefelder: Schieberegler mit Zahlenfeld, Auswahl, Schalter. */
import { h } from "./dom";

import { tr } from "../i18n";

export interface Field { el: HTMLElement; set(v: any): void; /** Ausgangswert: Abweichungen werden markiert und lassen sich zurücksetzen */ setDefault(v: any): void; }

const decimalsOf = (step: number) => (String(step).split(".")[1] ?? "").length;

/** Markiert ein Feld als geändert und hängt den Zurücksetzen-Knopf an. `reset` setzt Wert und meldet die Änderung. */
function tracker(el: HTMLElement, slot: HTMLElement, same: (a: any, b: any) => boolean, show: (v: any) => string, reset: (def: any) => void) {
  let def: any, cur: any;
  const btn = h("button", { class: "reset", type: "button", "data-reset": true, "aria-label": "Auf Ausgangswert zurücksetzen" }, "↺");
  btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); if (def !== undefined) reset(def); });
  slot.append(btn);
  const sync = () => {
    const changed = def !== undefined && cur !== undefined && !same(cur, def);
    el.classList.toggle("changed", changed);
    btn.title = def === undefined ? "" : tr("Zurücksetzen auf {}").replace("{}", show(def));
  };
  return { value(v: any) { cur = v; sync(); }, def(v: any) { def = v; sync(); }, get default() { return def; }, reset: () => { if (def !== undefined) reset(def); } };
}

export function sliderField(label: string, lo: number, hi: number, step: number, unit: string,
  onChange: (v: number) => void, tip?: string, decimals = decimalsOf(step)): Field {
  const range = h("input", { type: "range", min: lo, max: hi, step });
  const num = h("input", { class: "num", type: "number", min: lo, max: hi, step });
  const tick = h("i", { class: "tick" });
  const wrap = h("div", { class: "range-wrap" }, range, tick);
  const fmt = (v: number) => v.toFixed(decimals);
  const pct = (v: number) => (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo || 1);
  // Balken zwischen Ausgangswert und aktuellem Wert: ohne Änderung bleibt der Regler neutral
  let cur = lo, defV: number | null = null;
  const paint = (v: number = cur) => {
    cur = v;
    const a = pct(v), b = defV === null ? a : pct(defV);
    wrap.style.setProperty("--a", String(Math.min(a, b))); wrap.style.setProperty("--b", String(Math.max(a, b)));
  };
  const apply = (v: number, from: "range" | "num" | "reset") => {
    if (!Number.isFinite(v)) return;
    v = Math.min(hi, Math.max(lo, v));
    if (from !== "range") range.value = String(v);
    if (from !== "num" || num.value !== fmt(v)) num.value = fmt(v);
    paint(v); t.value(Number(fmt(v)));
    onChange(Number(fmt(v)));
  };
  range.addEventListener("input", () => apply(Number(range.value), "range"));
  num.addEventListener("change", () => apply(Number(num.value.replace(",", ".")), "num"));
  num.addEventListener("keydown", (e) => { if (e.key === "Enter") num.blur(); });
  // Doppelklick auf den Regler springt zum Ausgangswert zurück
  wrap.addEventListener("dblclick", () => t.reset());
  const lab = h("label", null, h("span", null, label));
  const el = h("div", { class: "field", title: tip }, lab,
    h("div", { class: "row" }, wrap, num, h("span", { class: "unit" }, unit)));
  const t = tracker(el, lab, (a, b) => Math.abs(a - b) < 0.5 * 10 ** -decimals, (d) => `${fmt(d)}${unit ? " " + unit : ""}`, (d) => apply(d, "reset"));
  return { el, set(v: number) { range.value = String(v); num.value = fmt(v); paint(v); t.value(v); },
    setDefault(v: number) { defV = v; paint(); tick.style.setProperty("--def", String(pct(v))); tick.classList.add("on"); t.def(v); } };
}

export function selectField(label: string, options: Record<string, string>, onChange: (v: string) => void, tip?: string): Field {
  const sel = h("select", { class: "select" }, ...Object.entries(options).map(([k, v]) => h("option", { value: k }, v)));
  sel.addEventListener("change", () => { t.value(sel.value); onChange(sel.value); });
  const lab = h("label", null, h("span", null, label));
  const el = h("div", { class: "field", title: tip }, lab, sel);
  const t = tracker(el, lab, (a, b) => a === b, (d) => tr(options[d] ?? String(d)), (d) => { sel.value = d; t.value(d); onChange(d); });
  return { el, set(v: string) { sel.value = v; t.value(v); }, setDefault(v: string) { t.def(v); } };
}

export function switchField(label: string, onChange: (v: boolean) => void, tip?: string): Field {
  const cb = h("input", { type: "checkbox" });
  cb.addEventListener("change", () => { t.value(cb.checked); onChange(cb.checked); });
  const text = h("span", { class: "switch-label" }, h("span", null, label));
  const el = h("label", { class: "switch", title: tip }, text, cb);
  const t = tracker(el, text, (a, b) => !!a === !!b, (d) => tr(d ? "an" : "aus"), (d) => { cb.checked = !!d; t.value(!!d); onChange(!!d); });
  return { el, set(v: boolean) { cb.checked = v; t.value(v); }, setDefault(v: boolean) { t.def(v); } };
}

export function section(title: string, open = true, ...children: HTMLElement[]) {
  const body = h("div", { class: "body" }, ...children);
  const reset = h("button", { class: "sec-reset", type: "button", title: "Alle geänderten Werte dieses Abschnitts zurücksetzen" }, "↺ ", h("span", null, "Zurücksetzen"));
  reset.addEventListener("click", (e) => {
    e.preventDefault(); e.stopPropagation();
    body.querySelectorAll<HTMLElement>(".changed [data-reset]").forEach((b) => b.click());
  });
  const d = h("details", { class: "section", open }, h("summary", null, h("span", null, title), reset), body);
  return d;
}
