/** Eingabefelder: Schieberegler mit Zahlenfeld, Auswahl, Schalter. */
import { h } from "./dom";

export interface Field { el: HTMLElement; set(v: any): void; }

const decimalsOf = (step: number) => (String(step).split(".")[1] ?? "").length;

export function sliderField(label: string, lo: number, hi: number, step: number, unit: string,
  onChange: (v: number) => void, tip?: string, decimals = decimalsOf(step)): Field {
  const range = h("input", { type: "range", min: lo, max: hi, step });
  const num = h("input", { class: "num", type: "number", min: lo, max: hi, step });
  const fmt = (v: number) => v.toFixed(decimals);
  const apply = (v: number, from: "range" | "num") => {
    if (!Number.isFinite(v)) return;
    v = Math.min(hi, Math.max(lo, v));
    if (from !== "range") range.value = String(v);
    if (from !== "num" || num.value !== fmt(v)) num.value = fmt(v);
    onChange(Number(fmt(v)));
  };
  range.addEventListener("input", () => apply(Number(range.value), "range"));
  num.addEventListener("change", () => apply(Number(num.value.replace(",", ".")), "num"));
  num.addEventListener("keydown", (e) => { if (e.key === "Enter") num.blur(); });
  range.addEventListener("dblclick", () => num.select());
  const el = h("div", { class: "field", title: tip },
    h("label", null, label),
    h("div", { class: "row" }, range, num, h("span", { class: "unit" }, unit)));
  return { el, set(v: number) { range.value = String(v); num.value = fmt(v); } };
}

export function selectField(label: string, options: Record<string, string>, onChange: (v: string) => void, tip?: string): Field {
  const sel = h("select", { class: "select" }, ...Object.entries(options).map(([k, v]) => h("option", { value: k }, v)));
  sel.addEventListener("change", () => onChange(sel.value));
  const el = h("div", { class: "field", title: tip }, h("label", null, label), sel);
  return { el, set(v: string) { sel.value = v; } };
}

export function switchField(label: string, onChange: (v: boolean) => void, tip?: string): Field {
  const cb = h("input", { type: "checkbox" });
  cb.addEventListener("change", () => onChange(cb.checked));
  const el = h("label", { class: "switch", title: tip }, label, cb);
  return { el, set(v: boolean) { cb.checked = v; } };
}

export function section(title: string, open = true, ...children: HTMLElement[]) {
  const d = h("details", { class: "section", open }, h("summary", null, title), h("div", { class: "body" }, ...children));
  return d;
}
