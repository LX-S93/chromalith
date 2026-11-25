/** 3D-Ansicht mit three.js: Netz mit simulierten Farben, Drehen/Zoomen, Z-Überhöhung. */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
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
    const mat = (this.mesh?.material as THREE.Material) ?? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0 });
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

  clear() {
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null; }
    if (this.meshOrig) { this.scene.remove(this.meshOrig); this.meshOrig.geometry.dispose(); this.meshOrig = null; }
    this.render();
  }

  setZScale(z: number) { this.zScale = z; if (this.mesh) this.mesh.scale.z = z; if (this.meshOrig) this.meshOrig.scale.z = z; this.render(); }

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
