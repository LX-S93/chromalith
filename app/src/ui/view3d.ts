/** 3D-Ansicht mit three.js: Netz mit simulierten Farben, Drehen/Zoomen, Z-Überhöhung. */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

/** Aussehen der Lithophanie in der 3D-Ansicht */
export interface LithoLook {
  filamentColor: string; td: number; light: string; intensity: number;
  /** Punktlicht (LED, Teelicht) mit Hotspot oder gleichmäßiges Licht (Leuchtrahmen, Lichterkette) */
  point: boolean;
  /** Höhe der Lampe im Körper, 0 = unten, 1 = oben */
  lampHeight: number;
  /** Lampe hinter dem Bild (flach, gebogen) statt im Körper */
  behind: boolean;
  /** Wie viel Licht auf den Tisch fällt */
  spill: number;
}
import { srgbToLinear } from "../core";
import { h } from "./dom";

export class ModelView {
  el: HTMLDivElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(35, 1, 0.5, 5000);
  private controls: OrbitControls | null = null;
  private mesh: THREE.Mesh | null = null;
  private zScale = 1;
  private size: [number, number] = [0, 0];
  private framed = false;
  private pending = false;
  private baseZ: Float32Array | null = null;
  private top: Int32Array | null = null;
  private baseCol: Float32Array | null = null;
  private meshOrig: THREE.Mesh | null = null;
  private comparing = false;
  private split = 0.5;
  private divider = h("div", { class: "divider", style: { top: "0", bottom: "0", display: "none" } }, h("span", null, "⇆"));
  private cut: { z: number; colorOf: (z: Float32Array) => Float32Array } | null = null;

  constructor() {
    this.el = h("div", { class: "view" }, this.divider);
    let drag = false;
    this.divider.addEventListener("pointerdown", (e) => { drag = true; this.divider.setPointerCapture(e.pointerId); e.stopPropagation(); });
    this.divider.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const r = this.el.getBoundingClientRect();
      this.split = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      this.placeDivider(); this.render();
    });
    const end = () => { drag = false; };
    this.divider.addEventListener("pointerup", end);
    this.divider.addEventListener("pointercancel", end);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x30323c, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-0.6, 0.8, 1.4);
    this.scene.add(sun);
    this.camera.up.set(0, 0, 1);
    new ResizeObserver(() => this.resize()).observe(this.el);
  }

  private ensure(): boolean {
    if (this.renderer) return true;
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      this.el.append(h("div", { class: "dropzone" }, h("div", { class: "card" }, "3D-Ansicht nicht verfügbar (kein WebGL).")));
      return false;
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.el.prepend(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.addEventListener("change", () => this.render());
    return true;
  }

  setMesh(m: { vertices: ArrayBuffer; faces: ArrayBuffer; colors: ArrayBuffer; orig?: ArrayBuffer; top?: ArrayBuffer; size: [number, number] }) {
    if (!this.ensure()) return;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(m.vertices);
    this.baseZ = new Float32Array(pos.length / 3);
    for (let i = 0; i < this.baseZ.length; i++) this.baseZ[i] = pos[i * 3 + 2];
    this.top = m.top ? new Int32Array(m.top) : null;
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const col = new Float32Array(m.colors);
    for (let i = 0; i < col.length; i++) col[i] = srgbToLinear(col[i]);
    this.baseCol = col.slice();
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(m.faces), 1));
    geo.computeVertexNormals();
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); }
    else this.mesh = null;
    this.free = null; this.freeKey = "";
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.scale.z = this.zScale;
    this.scene.add(this.mesh);
    // Zweites Netz für den Vergleich: das flache Originalbild (ohne Relief, unbeleuchtet wie ein Foto)
    if (this.meshOrig) { this.scene.remove(this.meshOrig); this.meshOrig.geometry.dispose(); this.meshOrig = null; }
    if (m.orig) {
      const g2 = new THREE.BufferGeometry();
      const flat = pos.slice();
      let zMin = Infinity;
      if (this.top) for (let i = 0; i < this.top.length; i++) if (this.top[i] >= 0 && pos[i * 3 + 2] < zMin) zMin = pos[i * 3 + 2];
      if (!Number.isFinite(zMin)) zMin = 0.2;
      for (let i = 0; i < flat.length / 3; i++) flat[i * 3 + 2] = this.top && this.top[i] >= 0 ? zMin : 0;
      g2.setAttribute("position", new THREE.BufferAttribute(flat, 3));
      const oc = new Float32Array(m.orig);
      for (let i = 0; i < oc.length; i++) oc[i] = srgbToLinear(oc[i]);
      g2.setAttribute("color", new THREE.BufferAttribute(oc, 3));
      g2.setIndex(geo.getIndex());
      this.meshOrig = new THREE.Mesh(g2, new THREE.MeshBasicMaterial({ vertexColors: true }));
      this.meshOrig.scale.z = this.zScale;
      this.meshOrig.visible = false;
      this.scene.add(this.meshOrig);
    }
    const changed = Math.abs(m.size[0] - this.size[0]) > 0.5 || Math.abs(m.size[1] - this.size[1]) > 0.5;
    this.size = m.size;
    if (changed || !this.framed) this.frame();
    if (this.cut) this.applyCut(); else this.render();
  }

  /** Zeigt den Druck nur bis zur Höhe z (mm). colorOf liefert die simulierte Farbe (sRGB, 3/Punkt) für die
   *  gekappten Höhen. null = ganzes Modell. */
  setCut(cut: { z: number; colorOf: (z: Float32Array) => Float32Array } | null) {
    this.cut = cut;
    this.applyCut();
  }

  private applyCut() {
    if (!this.mesh || !this.baseZ) return;
    const geo = this.mesh.geometry, pos = geo.getAttribute("position") as THREE.BufferAttribute, col = geo.getAttribute("color") as THREE.BufferAttribute;
    const n = this.baseZ.length, zCut = this.cut ? this.cut.z : Infinity;
    const z = new Float32Array(n);
    for (let i = 0; i < n; i++) { z[i] = Math.min(this.baseZ[i], zCut); pos.setZ(i, z[i]); }
    if (this.cut && this.top) {
      const c = this.cut.colorOf(z), a = col.array as Float32Array;
      for (let i = 0; i < n; i++) if (this.top[i] >= 0) for (let k = 0; k < 3; k++) a[i * 3 + k] = srgbToLinear(c[i * 3 + k]);
      col.needsUpdate = true;
    } else if (this.baseCol) { (col.array as Float32Array).set(this.baseCol); col.needsUpdate = true; }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    this.render();
  }

  /** Lithophanie-Körper mit physikalisch angelehnter Beleuchtung: Lampe als Punktlicht (Abfall mit dem Abstand,
   *  schräger Lichtweg durch die Wand), Abschwächung je Farbkanal nach Wandstärke und TD, Streuung im Material,
   *  Glühen (Bloom), Filmic-Tonemapping und Lichtschein auf dem Tisch. */
  private free: { lit: THREE.ShaderMaterial; plain: THREE.MeshStandardMaterial; ground: THREE.Mesh; on: boolean; lamp: THREE.Group; glow: THREE.MeshBasicMaterial; glowOn: THREE.Color } | null = null;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private freeKey = "";
  setFree(m: { vertices: ArrayBuffer; faces: ArrayBuffer; thick: ArrayBuffer; thickS: ArrayBuffer; baseN: ArrayBuffer }, o: LithoLook, lit: boolean) {
    if (!this.ensure()) return;
    this.clear();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(m.vertices), 3));
    geo.setAttribute("thick", new THREE.BufferAttribute(new Float32Array(m.thick), 1));
    geo.setAttribute("thickS", new THREE.BufferAttribute(new Float32Array(m.thickS), 1));
    geo.setAttribute("baseN", new THREE.BufferAttribute(new Float32Array(m.baseN), 3));
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(m.faces), 1));
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    const bb = geo.boundingBox!, c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3());
    // Lampe: bei geschlossenen Formen innen auf der Achse, sonst hinter dem Bild
    const lamp = new THREE.Vector3(c.x, c.y, bb.min.z + sz.z * o.lampHeight);
    let ref = Math.max(8, Math.min(sz.x, sz.y) / 2);
    if (o.behind) { ref = Math.max(sz.x, sz.z) * 0.75; lamp.set(c.x, bb.max.y + ref, bb.min.z + sz.z * o.lampHeight); }
    const lin = (hex: string) => new THREE.Color(hex); // THREE.Color rechnet sRGB -> linear
    const k = Math.log(20) / Math.max(o.td, 0.05);
    const litMat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: {
        lampPos: { value: lamp }, lampColor: { value: lin(o.light) }, intensity: { value: o.intensity }, refDist: { value: ref },
        point: { value: o.point ? 1 : 0 }, kAbs: { value: new THREE.Vector3(k * 0.9, k, k * 1.22) }, albedo: { value: lin(o.filamentColor) },
        td: { value: o.td }, scatter: { value: 0.55 },
      },
      vertexShader: `
        attribute float thick; attribute float thickS; attribute vec3 baseN;
        varying float vT; varying float vTs; varying vec3 vBase; varying vec3 vWorld; varying vec3 vNormal;
        void main() {
          vT = thick; vTs = thickS; vBase = baseN; vNormal = normal;
          vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: `
        uniform vec3 lampPos; uniform vec3 lampColor; uniform float intensity; uniform float refDist; uniform float point;
        uniform vec3 kAbs; uniform vec3 albedo; uniform float td; uniform float scatter;
        varying float vT; varying float vTs; varying vec3 vBase; varying vec3 vWorld; varying vec3 vNormal;
        void main() {
          vec3 toP = vWorld - lampPos; float d = length(toP); vec3 ray = toP / max(d, 1e-3);
          vec3 bn = normalize(vBase);
          // Einfallswinkel auf die Wand: schräg = weniger Licht pro Fläche und längerer Weg durchs Material
          float cosIn = mix(1.0, clamp(dot(ray, bn), 0.0, 1.0), point);
          float fall = mix(1.0, (refDist * refDist) / max(d * d, 1.0), point);
          vec3 E = lampColor * intensity * 1.6 * fall * (0.25 + 0.75 * cosIn);
          vec3 V = normalize(cameraPosition - vWorld);
          vec3 col;
          if (vT < 0.0) {
            // Innenseite: direkt angestrahlt, streut das Licht im Körper weiter
            col = E * albedo * 0.9 + lampColor * intensity * 0.25 * albedo;
          } else {
            float t = mix(vT, vTs, scatter);
            float path = t / max(mix(1.0, cosIn, 0.6), 0.35);
            vec3 T = exp(-kAbs * path) * pow(max(albedo, vec3(0.02)), vec3(min(1.5, path / td + 0.15)));
            // gestreutes Licht tritt nach allen Seiten aus; in Blickrichtung zur Lampe etwas mehr (Vorwärtsstreuung)
            float fwd = pow(max(dot(-V, ray), 0.0), 6.0);
            // Relief: Flanken, die von der Lampe weg zeigen, wirken etwas dunkler
            float relief = 0.82 + 0.18 * clamp(dot(normalize(vNormal), bn), 0.0, 1.0);
            col = E * T * (0.85 + 0.6 * fwd * exp(-0.5 * path)) * relief;
            // wenig Raumlicht von vorn, damit die Oberfläche nicht im Nichts verschwindet
            col += albedo * 0.012 * (0.4 + 0.6 * max(dot(normalize(vNormal), V), 0.0));
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const plain = new THREE.MeshStandardMaterial({ color: new THREE.Color(o.filamentColor), roughness: 0.6, metalness: 0, side: THREE.DoubleSide });
    this.baseZ = null; this.top = null; this.baseCol = null;
    this.mesh = new THREE.Mesh(geo, plain);
    this.scene.add(this.mesh);
    // Tisch mit Lichtschein
    const gr = Math.max(sz.x, sz.y, sz.z) * 4;
    const ground = new THREE.Mesh(new THREE.CircleGeometry(gr, 64), new THREE.ShaderMaterial({
      uniforms: { lampPos: { value: lamp }, lampColor: { value: lin(o.light) }, intensity: { value: o.intensity }, refDist: { value: ref }, radius: { value: gr },
        center: { value: new THREE.Vector3(c.x, c.y, bb.min.z) }, objR: { value: Math.max(sz.x, sz.y) / 2 }, spill: { value: o.spill } },
      vertexShader: `varying vec3 vWorld; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `
        uniform vec3 lampPos; uniform vec3 lampColor; uniform float intensity; uniform float refDist; uniform float radius; uniform vec3 center; uniform float objR; uniform float spill;
        varying vec3 vWorld;
        void main() {
          vec3 toL = lampPos - vWorld; float d = length(toL);
          float r = length(vWorld.xy - center.xy);
          // Licht, das durch Wand und Öffnungen auf den Tisch fällt: nimmt mit dem Abstand ab, flacher Einfall = schwächer
          float e = (refDist * refDist) / max(d * d, 1.0) * clamp(toL.z / d + 0.25, 0.05, 1.0);
          float contact = smoothstep(objR * 0.55, objR * 1.25, r) * 0.75 + 0.25;
          float fade = 1.0 - smoothstep(radius * 0.45, radius, r);
          vec3 table = vec3(0.085, 0.07, 0.06);
          vec3 col = table * (lampColor * intensity * spill * e * contact + vec3(0.02)) * fade;
          gl_FragColor = vec4(col, 1.0);
        }`,
    }));
    ground.position.set(c.x, c.y, bb.min.z - 0.05);
    this.scene.add(ground);
    // Sichtbare Lichtquelle: Glühlampe auf Fuß, LED-Teelicht, Lichterkette oder Leuchtrahmen
    const lampGroup = new THREE.Group();
    const glowCol = lin(o.light).multiplyScalar(2.2 * Math.max(0.5, o.intensity));
    const glow = new THREE.MeshBasicMaterial({ color: glowCol });
    const dark = new THREE.MeshBasicMaterial({ color: 0x121214 });
    const zF = bb.min.z, add = (g: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, upright = true) => {
      const me = new THREE.Mesh(g, mat); if (upright) me.rotation.x = Math.PI / 2; me.position.set(x, y, z); lampGroup.add(me); return me;
    };
    if (o.point) {
      const br = o.behind ? Math.max(4, ref * 0.07) : Math.max(2.5, Math.min(sz.x, sz.y) * 0.07);
      add(new THREE.SphereGeometry(br, 24, 16), glow, lamp.x, lamp.y, lamp.z, false);
      // Fassung und Fuß bis auf den Tisch
      add(new THREE.CylinderGeometry(br * 0.55, br * 0.6, br * 1.1, 20), dark, lamp.x, lamp.y, lamp.z - br * 1.3);
      const stem = Math.max(0, lamp.z - br * 1.85 - zF);
      if (stem > 1) add(new THREE.CylinderGeometry(br * 0.16, br * 0.16, stem, 12), dark, lamp.x, lamp.y, zF + stem / 2);
      add(new THREE.CylinderGeometry(br * 1.5, br * 1.7, Math.min(3, br * 0.5), 28), dark, lamp.x, lamp.y, zF + Math.min(1.5, br * 0.25));
    } else if (o.behind) {
      // Leuchtrahmen bzw. Lichterkette hinter dem Bild
      const py = bb.max.y + Math.max(6, sz.x * 0.08);
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(sz.x * 0.96, sz.z * 0.96), new THREE.MeshBasicMaterial({ color: lin(o.light).multiplyScalar(1.1 * Math.max(0.5, o.intensity)), side: THREE.DoubleSide }));
      panel.rotation.x = Math.PI / 2; panel.position.set(c.x, py, c.z); lampGroup.add(panel);
      const back = new THREE.Mesh(new THREE.BoxGeometry(sz.x * 1.02, 3, sz.z * 1.02), dark); back.position.set(c.x, py + 2, c.z); lampGroup.add(back);
    } else {
      // Lichterkette im Körper: kleine Lichter auf einer Spirale
      const n = 14, rr = Math.min(sz.x, sz.y) * 0.22, bs = Math.max(1.2, Math.min(sz.x, sz.y) * 0.022);
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1), a = t * Math.PI * 5;
        add(new THREE.SphereGeometry(bs, 12, 8), glow, c.x + rr * Math.cos(a), c.y + rr * Math.sin(a), zF + sz.z * (0.15 + 0.6 * t), false);
      }
    }
    this.scene.add(lampGroup);
    this.free = { lit: litMat, plain, ground, on: lit, lamp: lampGroup, glow, glowOn: glowCol.clone() };
    this.bloomScale = Math.min(1.4, 0.55 + 0.25 * o.intensity);
    this.setLit(lit);
    const key = `${sz.x.toFixed(0)}|${sz.y.toFixed(0)}|${sz.z.toFixed(0)}`;
    if (key !== this.freeKey && this.controls) {
      this.freeKey = key;
      const d = Math.max(sz.x, sz.z, sz.y) * 1.9;
      this.camera.position.set(c.x - d * (o.behind ? 0.35 : 0.12), c.y - d, c.z + d * (o.behind ? 0.3 : 0.15));
      this.controls.target.copy(c); this.controls.update();
      this.size = [0, 0]; this.framed = false;
    }
    this.render();
  }
  private bloomScale = 1;
  setLit(lit: boolean) {
    if (!this.mesh || !this.free) return;
    this.free.on = lit;
    this.mesh.material = lit ? this.free.lit : this.free.plain;
    this.free.ground.visible = lit;
    // ausgeschaltet bleibt die Lampe als matter Körper sichtbar
    this.free.glow.color.copy(lit ? this.free.glowOn : new THREE.Color(0xd8d4cc));
    this.render();
  }

  private renderFree() {
    const r = this.renderer!;
    if (!this.free!.on) { r.setScissorTest(false); r.render(this.scene, this.camera); return; }
    const box = this.el.getBoundingClientRect();
    if (!this.composer) {
      this.composer = new EffectComposer(r, new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 }));
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(box.width, box.height), 0.6, 0.7, 0.55);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
    this.composer.setPixelRatio(r.getPixelRatio());
    this.composer.setSize(box.width, box.height);
    this.bloom!.strength = 0.55 * this.bloomScale;
    const bg = this.scene.background, tm = r.toneMapping, ex = r.toneMappingExposure;
    this.scene.background = new THREE.Color(0x020203);
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
    this.composer.render();
    this.scene.background = bg; r.toneMapping = tm; r.toneMappingExposure = ex;
  }

  clear() {
    if (this.free) { this.scene.remove(this.free.lamp); this.free.lamp.traverse((x) => { const me = x as THREE.Mesh; if (me.geometry) me.geometry.dispose(); }); this.scene.remove(this.free.ground); this.free.ground.geometry.dispose(); this.free.lit.dispose(); this.free.plain.dispose(); }
    this.free = null;
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null; }
    if (this.meshOrig) { this.scene.remove(this.meshOrig); this.meshOrig.geometry.dispose(); this.meshOrig = null; }
    this.render();
  }

  setZScale(z: number) { this.zScale = z; if (this.mesh && !this.free) this.mesh.scale.z = z; if (this.meshOrig) this.meshOrig.scale.z = z; this.render(); }

  /** Vergleich: links vom Teiler das flache Originalbild, rechts der Druck als Relief. */
  setCompare(on: boolean) {
    this.comparing = on;
    this.divider.style.display = on ? "" : "none";
    this.placeDivider(); this.render();
  }
  private placeDivider() { this.divider.style.left = `${this.split * 100}%`; }

  frame() {
    if (!this.controls) return;
    const [w, hh] = this.size;
    const c = new THREE.Vector3(w / 2, hh / 2, 0);
    const d = Math.max(w, hh) * 1.9;
    this.camera.position.set(c.x, c.y - d * 0.75, d * 0.85);
    this.controls.target.copy(c);
    this.controls.update();
    this.framed = true;
  }

  resize() {
    if (!this.renderer) return;
    const r = this.el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    this.renderer.setSize(r.width, r.height, false);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.camera.aspect = r.width / r.height;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  render() {
    if (!this.renderer || this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      if (this.free && this.mesh) { this.renderFree(); return; }
      const r = this.renderer!, m = this.mesh, o = this.meshOrig;
      if (!this.comparing || !m || !o) { r.setScissorTest(false); if (o) o.visible = false; if (m) m.visible = true; r.render(this.scene, this.camera); return; }
      const box = this.el.getBoundingClientRect(), x = Math.round(box.width * this.split);
      r.setScissorTest(true);
      r.setScissor(0, 0, x, box.height); o.visible = true; m.visible = false; r.render(this.scene, this.camera);
      r.setScissor(x, 0, box.width - x, box.height); o.visible = false; m.visible = true; r.render(this.scene, this.camera);
      r.setScissorTest(false);
    });
  }
}
