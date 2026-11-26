/** Druck-Assistent: führt Schritt für Schritt durch die Farbwechsel. Die Seite ist eigenständig
 *  (eine HTML-Datei ohne Abhängigkeiten) und läuft so auch auf dem Handy neben dem Drucker. */
import { filamentLabel, layerTopZ, type Filament } from "../core";
import { saveFile } from "../platform";
import { button, h } from "./dom";
import { fileSuffix, lang, tr } from "../i18n";

/** Texte der eigenständigen Seite ({0}, {1} … sind Platzhalter). */
const TEXT = {
  de: {
    dec: ",", title: "Druck-Assistent", sum: "{0} Schichten · {1} mm hoch · {2} Farbwechsel", done: "Fertig", step: "Schritt {0} von {1}",
    allDone: "Alle Wechsel erledigt", loadStart: "Zum Start einlegen", loadNow: "Jetzt einlegen", finishing: "Druck läuft zu Ende",
    lastUntil: "Letzte Farbe bis Schicht {0}", layer1: "Schicht 1", printsIncl: "druckt bis einschließlich Schicht {0}", before: "vor Schicht {0}",
    atZ: "bei Z {0} mm · druckt bis Schicht {1}", back: "Zurück", restart: "Von vorn", ok: "Erledigt", okNext: "Erledigt, weiter", startL1: "Start, Schicht 1",
    info: "Erste Schicht {0} mm, danach {1} mm. Der Wechsel kommt jeweils, bevor die genannte Schicht gedruckt wird (Pause bzw. M600 im Slicer).",
  },
  en: {
    dec: ".", title: "Print assistant", sum: "{0} layers · {1} mm high · {2} colour changes", done: "Done", step: "Step {0} of {1}",
    allDone: "All changes done", loadStart: "Load for the start", loadNow: "Load now", finishing: "Print is finishing",
    lastUntil: "Last colour up to layer {0}", layer1: "Layer 1", printsIncl: "prints up to and including layer {0}", before: "before layer {0}",
    atZ: "at Z {0} mm · prints up to layer {1}", back: "Back", restart: "Start over", ok: "Done", okNext: "Done, next", startL1: "Start, layer 1",
    info: "First layer {0} mm, then {1} mm. Each change comes before the stated layer is printed (pause or M600 in the slicer).",
  },
};

export interface AssistData {
  name: string; base: number; step: number; layers: number; maxZ: number;
  usage: { filament: Filament; first: number; last: number }[];
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export function assistantHtml(d: AssistData): string {
  const steps = d.usage.map((u, i) => ({
    color: u.filament.color, name: tr(filamentLabel(u.filament)), material: u.filament.material,
    layer: u.first, last: u.last, z: i === 0 ? 0 : layerTopZ(u.first - 1, d.base, d.step),
  }));
  const data = JSON.stringify({ name: d.name, base: d.base, step: d.step, layers: d.layers, maxZ: d.maxZ, steps }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${TEXT[lang].title} – ${esc(d.name)}</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}
body{margin:0;background:#0b0c10;color:#e7e9ee;font:16px/1.45 "Segoe UI",system-ui,-apple-system,sans-serif;min-height:100vh;display:flex;flex-direction:column}
header{padding:14px 18px;border-bottom:1px solid #262935;display:flex;gap:12px;align-items:baseline;flex-wrap:wrap}
header b{font-size:18px}header span{color:#8b90a0;font-size:14px}
main{flex:1;display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:18px;padding:18px;max-width:1200px;width:100%;margin:0 auto}
@media(max-width:820px){main{grid-template-columns:1fr}}
.now{background:#15161c;border:1px solid #262935;border-radius:18px;padding:26px;display:flex;flex-direction:column;gap:14px;align-items:center;text-align:center;justify-content:center;min-height:52vh}
.count{color:#8b90a0;letter-spacing:.08em;text-transform:uppercase;font-size:13px}
.sw{width:min(34vw,170px);height:min(34vw,170px);border-radius:50%;border:4px solid #ffffff22;box-shadow:0 12px 50px #000a}
.act{color:#a78bfa;font-weight:600;font-size:clamp(18px,3.4vw,24px)}
.fil{font-size:clamp(28px,6.5vw,54px);font-weight:700;line-height:1.1}
.when{font-size:clamp(20px,4.2vw,32px)}.when small{display:block;color:#8b90a0;font-size:.6em;margin-top:4px}
.btns{display:flex;gap:10px;margin-top:8px;flex-wrap:wrap;justify-content:center}
button{font:inherit;color:inherit;border-radius:12px;border:1px solid #313545;background:#1b1d25;padding:14px 22px;cursor:pointer;min-width:130px}
button.p{background:#8b5cf6;border-color:#8b5cf6;color:#fff;font-weight:600}button:disabled{opacity:.4}
ol{list-style:none;margin:0;padding:0;display:grid;gap:8px;align-content:start}
li{display:grid;grid-template-columns:28px 1fr auto;gap:10px;align-items:center;padding:10px 12px;border-radius:12px;border:1px solid #262935;background:#15161c;cursor:pointer}
li.cur{border-color:#8b5cf6}li.done{opacity:.5}li.done .n::after{content:" ✓";color:#22c55e}
li i{width:24px;height:24px;border-radius:50%;border:1px solid #ffffff33}li small{color:#8b90a0;display:block}
.info{color:#8b90a0;font-size:13px;padding:0 18px 16px;max-width:1200px;margin:0 auto;width:100%}
</style></head><body>
<header><b id="t"></b><span id="s"></span></header>
<main><section class="now"><div class="count" id="c"></div><div class="sw" id="sw"></div><div class="act" id="a"></div><div class="fil" id="f"></div><div class="when" id="w"></div>
<div class="btns"><button id="prev"></button><button class="p" id="next"></button></div></section>
<ol id="l"></ol></main>
<div class="info" id="i"></div>
<script>
const D=${data},T=${JSON.stringify(TEXT[lang])};const key="chromalith-assistent-"+D.name+"-"+D.steps.length;let cur=+(localStorage.getItem(key)||0);if(!(cur>=0&&cur<=D.steps.length))cur=0;
const $=id=>document.getElementById(id),f2=v=>v.toFixed(2).replace(".",T.dec),t=(k,...a)=>T[k].replace(/\\{(\\d)\\}/g,(m,i)=>a[i]);
function draw(){const n=D.steps.length,done=cur>=n,s=D.steps[Math.min(cur,n-1)];
$("t").textContent=T.title+" · "+D.name;$("s").textContent=t("sum",D.layers,f2(D.maxZ),n-1);
$("c").textContent=done?T.done:t("step",cur+1,n);$("sw").style.background=s.color;
$("a").textContent=done?T.allDone:cur===0?T.loadStart:T.loadNow;$("f").textContent=done?T.finishing:s.name;
$("w").innerHTML=done?"<small>"+t("lastUntil",s.last)+"</small>":cur===0?T.layer1+"<small>"+t("printsIncl",s.last)+"</small>":t("before",s.layer)+"<small>"+t("atZ",f2(s.z),s.last)+"</small>";
$("prev").textContent=T.back;$("prev").disabled=cur===0;$("next").textContent=done?T.restart:cur===n-1?T.ok:T.okNext;
$("l").innerHTML="";D.steps.forEach((x,k)=>{const li=document.createElement("li");li.className=k<cur?"done":k===cur?"cur":"";
li.innerHTML='<i style="background:'+x.color+'"></i><div><span class="n"></span><small>'+(k===0?T.startL1:t("before",x.layer)+" · Z "+f2(x.z)+" mm")+'</small></div><small>'+x.material+'</small>';
li.querySelector(".n").textContent=x.name;li.onclick=()=>{cur=k;save()};$("l").appendChild(li)});
$("i").textContent=t("info",f2(D.base),f2(D.step));}
function save(){localStorage.setItem(key,cur);draw()}
$("prev").onclick=()=>{if(cur>0)cur--;save()};$("next").onclick=()=>{cur=cur>=D.steps.length?0:cur+1;save()};
document.addEventListener("keydown",e=>{if(e.key==="ArrowRight"||e.key===" ")$("next").click();if(e.key==="ArrowLeft")$("prev").click()});
if(navigator.wakeLock)navigator.wakeLock.request("screen").catch(()=>{});draw();
</script></body></html>`;
}

/** Zeigt den Assistenten im Vollbild; von dort lässt er sich als Datei fürs Handy speichern. */
export function openAssistant(d: AssistData) {
  const html = assistantHtml(d);
  const frame = h("iframe", { srcdoc: html, title: "Druck-Assistent" });
  const close = () => { back.remove(); document.removeEventListener("keydown", esc2, true); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };
  const esc2 = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  const back = h("div", { class: "assist-back" },
    h("div", { class: "assist-bar" }, h("b", null, "Druck-Assistent"),
      h("span", { class: "hint" }, "Führt dich beim Drucken durch die Farbwechsel. Fürs Handy als Datei speichern und dort öffnen."),
      h("div", { class: "spacer" }),
      button("Vollbild", () => back.requestFullscreen?.().catch(() => {}), { cls: "ghost" }),
      button("Fürs Handy speichern", () => saveFile(d.name + fileSuffix("_druckassistent.html"), html, [{ name: "HTML", extensions: ["html"] }]), { icon: "download" }),
      button("Schließen", close, { icon: "close" })),
    frame);
  document.addEventListener("keydown", esc2, true);
  document.body.append(back);
}
