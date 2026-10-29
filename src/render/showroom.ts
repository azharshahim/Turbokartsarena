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
  constructor(canvas: HTMLCanvasElement | null, profile: KartProfile, gl?: any) {
    this.native = !!gl;
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
    this.model.root.rotation.y = Math.sin(time * 0.0002) * 0.6 - 0.5;
    this.renderer.render(this.scene, this.camera);
    const gl = this.renderer.getContext() as any;
    if (gl.endFrameEXP) gl.endFrameEXP();
  }
  dispose() {
    this.model.dispose();
    this.floor.geometry.dispose();
    (this.floor.material as T.Material).dispose();
    this.renderer.dispose();
    if (!this.native) this.renderer.forceContextLoss();
  }
}
