/** Kleine DOM-Helfer ohne Framework. */
type Attrs = Record<string, any>;
type Child = Node | string | number | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs)
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "html") el.innerHTML = v;
      else if (k in el && typeof v !== "string") (el as any)[k] = v;
      else el.setAttribute(k, v === true ? "" : String(v));
    }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

export function clear(el: HTMLElement) { while (el.firstChild) el.firstChild.remove(); }

/** Ein paar schlichte Linien-Icons (eigene Zeichnung). */
const ICONS: Record<string, string> = {
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 17-5-5-9 8"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  save: '<path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v6h8V3M7 21v-7h10v7"/>',
  download: '<path d="M12 3v12m0 0-5-5m5 5 5-5M4 21h16"/>',
  swap: '<path d="M7 4v16m0 0-4-4m4 4 4-4M17 20V4m0 0-4 4m4-4 4 4"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  magic: '<path d="m4 20 10-10m2-6 1 2 2 1-2 1-1 2-1-2-2-1 2-1zM19 12l.7 1.3L21 14l-1.3.7L19 16l-.7-1.3L17 14l1.3-.7z"/>',
  sort: '<path d="M4 6h10M4 12h7M4 18h4M17 4v16m0 0-3-3m3 3 3-3"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  library: '<path d="M4 4h4v16H4zM10 4h4v16h-4zM16 5l4 1-3 14-4-1z"/>',
  upload: '<path d="M12 21V9m0 0-5 5m5-5 5 5M4 3h16"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  file: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/>',
};
export function icon(name: string): SVGElement {
  const t = document.createElement("template");
  t.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ""}</svg>`;
  return t.content.firstChild as SVGElement;
}

export function button(label: string | null, onClick: () => void, opts: { icon?: string; cls?: string; title?: string; kbd?: string } = {}) {
  const b = h("button", { class: "btn " + (opts.cls ?? ""), title: opts.title, onclick: onClick });
  if (opts.icon) b.append(icon(opts.icon));
  if (label) b.append(label);
  return b;
}

let toastBox: HTMLElement | null = null;
export function toast(text: string, kind: "" | "ok" | "err" = "", ms = 4200) {
  if (!toastBox) { toastBox = h("div", { class: "toasts" }); document.body.append(toastBox); }
  const t = h("div", { class: "toast " + kind }, text);
  toastBox.append(t);
  setTimeout(() => t.remove(), ms);
}

/** Einfacher modaler Dialog. Gibt eine Funktion zum Schließen zurück; onClose wird immer genau einmal gerufen. */
export function modal(title: string, content: HTMLElement, footer: HTMLElement[] = [], small = false, onClose?: () => void): () => void {
  const back = h("div", { class: "modal-back" });
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true; back.remove(); document.removeEventListener("keydown", esc); onClose?.();
  };
  const esc = (e: KeyboardEvent) => {
    const all = document.querySelectorAll(".modal-back");
    if (e.key === "Escape" && all[all.length - 1] === back) { e.stopPropagation(); close(); }
  };
  const x = button(null, close, { icon: "close", cls: "ghost small", title: "Schließen" });
  const box = h("div", { class: "modal" + (small ? " small" : "") },
    h("header", null, h("h3", null, title), h("div", { class: "spacer" }), x),
    h("div", { class: "content" }, content),
    footer.length ? h("footer", null, ...footer) : null);
  back.append(box);
  back.addEventListener("mousedown", (e) => { if (e.target === back) close(); });
  document.addEventListener("keydown", esc);
  document.body.append(back);
  return close;
}

export function confirmDialog(title: string, text: string, ok = "OK", cancel = "Abbrechen"): Promise<boolean> {
  return new Promise((resolve) => {
    let result = false;
    const close = modal(title, h("p", { style: { margin: "0", lineHeight: "1.5" } }, text),
      [button(cancel, () => close()), button(ok, () => { result = true; close(); }, { cls: "primary" })], true, () => resolve(result));
  });
}
