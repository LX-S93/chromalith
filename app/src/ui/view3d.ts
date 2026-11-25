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

  constructor() {
    this.el = h("div", { class: "view" });
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

  setMesh(m: { vertices: ArrayBuffer; faces: ArrayBuffer; colors: ArrayBuffer; size: [number, number] }) {
    if (!this.ensure()) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(m.vertices), 3));
    const col = new Float32Array(m.colors);
    for (let i = 0; i < col.length; i++) col[i] = srgbToLinear(col[i]);
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(m.faces), 1));
    geo.computeVertexNormals();
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); }
    else this.mesh = null;
    const mat = (this.mesh?.material as THREE.Material) ?? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.scale.z = this.zScale;
    this.scene.add(this.mesh);
    const changed = Math.abs(m.size[0] - this.size[0]) > 0.5 || Math.abs(m.size[1] - this.size[1]) > 0.5;
    this.size = m.size;
    if (changed || !this.framed) this.frame();
    this.render();
  }

  clear() { if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null; } this.render(); }

  setZScale(z: number) { this.zScale = z; if (this.mesh) this.mesh.scale.z = z; this.render(); }

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
    requestAnimationFrame(() => { this.pending = false; this.renderer!.render(this.scene, this.camera); });
  }
}
