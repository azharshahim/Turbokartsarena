import * as T from 'three';
import { createVehicle } from './vehicles';
import { QUALITY } from '../core/config';
import type { KartProfile } from '../game/roster';
import { makeCanvasShim } from './world';
/** Same geometry in the garage and on track; no pre-rendered selection thumbnails. */
export class Showroom {
  readonly renderer: T.WebGLRenderer;
  private native: boolean;
  readonly scene = new T.Scene();
  readonly camera = new T.PerspectiveCamera(34, 1, 0.1, 50);
  private model: ReturnType<typeof createVehicle>;
  private floor: T.Mesh;
  private canvas: HTMLCanvasElement | null;
  private angle = -0.5;
  private dragging = false;
  private lastX = 0;
  private lastTime = 0;
  private onDown = (e: PointerEvent) => { this.dragging = true; this.lastX = e.clientX; this.canvas?.setPointerCapture(e.pointerId); };
  private onMove = (e: PointerEvent) => { if (this.dragging) { this.angle += (e.clientX - this.lastX) * 0.012; this.lastX = e.clientX; } };
  private onUp = () => { this.dragging = false; };
  private onWheel = (e: WheelEvent) => { e.preventDefault(); this.zoom(e.deltaY * 0.003); };
  zoom(amount: number) { this.camera.position.setLength(T.MathUtils.clamp(this.camera.position.length() + amount, 3.5, 9)); }

  constructor(canvas: HTMLCanvasElement | null, profile: KartProfile, gl?: any) {
    this.native = !!gl;
    this.canvas = canvas;
    if (canvas) {
      canvas.style.touchAction = 'pan-y';
      canvas.addEventListener('pointerdown', this.onDown);
      canvas.addEventListener('pointermove', this.onMove);
      canvas.addEventListener('pointerup', this.onUp);
      canvas.addEventListener('pointercancel', this.onUp);
      canvas.addEventListener('wheel', this.onWheel, { passive: false });
    }
    this.renderer = new T.WebGLRenderer({
      canvas: canvas ?? makeCanvasShim(gl),
      context: gl,
      antialias: true,
      alpha: true,
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setClearColor(0x0b1426, 0);
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.camera.position.set(3.4, 2.3, 4.4);
    this.camera.lookAt(0, 0.75, 0);
    this.scene.add(new T.HemisphereLight(0xd8ecff, 0x343447, 2.8));
    const key = new T.DirectionalLight(0xffffff, 3);
    key.position.set(3, 5, 2);
    this.scene.add(key);
    const rim = new T.DirectionalLight(0x62b5ff, 2.5);
    rim.position.set(-3, 3, -4);
    this.scene.add(rim);
    this.floor = new T.Mesh(
      new T.CylinderGeometry(2, 2.15, 0.1, 48),
      new T.MeshStandardMaterial({ color: 0x26344a, metalness: 0.5, roughness: 0.4 }),
    );
    this.floor.position.y = -0.09;
    this.scene.add(this.floor);
    this.model = createVehicle(profile, QUALITY.high);
    this.scene.add(this.model.root);
  }
  select(profile: KartProfile) {
    this.scene.remove(this.model.root);
    this.model.dispose();
    this.model = createVehicle(profile, QUALITY.high);
    this.scene.add(this.model.root);
  }
  frame(time: number, width: number, height: number) {
    this.renderer.setSize(Math.max(1, width), Math.max(1, height), false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    if (this.lastTime && !this.dragging) this.angle += Math.min(0.05, (time - this.lastTime) / 1000) * 0.35;
    this.lastTime = time;
    this.model.root.rotation.y = this.angle;
    this.renderer.render(this.scene, this.camera);
    const gl = this.renderer.getContext() as any;
    if (gl.endFrameEXP) gl.endFrameEXP();
  }
  dispose() {
    if (this.canvas) {
      this.canvas.removeEventListener('pointerdown', this.onDown);
      this.canvas.removeEventListener('pointermove', this.onMove);
      this.canvas.removeEventListener('pointerup', this.onUp);
      this.canvas.removeEventListener('pointercancel', this.onUp);
      this.canvas.removeEventListener('wheel', this.onWheel);
    }
    this.model.dispose();
    this.floor.geometry.dispose();
    (this.floor.material as T.Material).dispose();
    this.renderer.dispose();
    if (!this.native) this.renderer.forceContextLoss();
  }
}
