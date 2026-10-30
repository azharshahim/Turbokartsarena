import { CinematicScenery } from './cinematicScenery';
import { Track } from '../core/track';
import type { Circuit } from '../game/circuits';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
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
  private width = 0;
  private height = 0;
  private backdrop?: CinematicScenery;
  private circuitId = '';
  private mirror: Reflector;
  private dragging = false;
  private lastX = 0;
  private lastTime = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchDistance = 0;
  reducedMotion = false;
  rotate(delta: number) { this.angle += delta; }
  private distance() {
    const p = [...this.pointers.values()];
    return p.length === 2 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : 0;
  }
  private onDown = (e: PointerEvent) => {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.dragging = true; this.lastX = e.clientX;
    this.pinchDistance = this.distance();
    this.canvas?.setPointerCapture(e.pointerId);
  };
  private onMove = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      const distance = this.distance();
      this.zoom((this.pinchDistance - distance) * 0.015);
      this.pinchDistance = distance;
    } else if (this.pointers.size === 1) this.rotate((e.clientX - this.lastX) * 0.012);
    this.lastX = e.clientX;
  };
  private onUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    this.dragging = this.pointers.size > 0;
    this.pinchDistance = this.distance();
    const remaining = [...this.pointers.values()][0];
    if (remaining) this.lastX = remaining.x;
  };
  private onWheel = (e: WheelEvent) => { e.preventDefault(); this.zoom(e.deltaY * 0.003); };
  zoom(amount: number) {
    this.camera.position.setLength(T.MathUtils.clamp(this.camera.position.length() + amount, 3.5, 9));
    this.camera.lookAt(0, 0.75, 0);
  }

  constructor(canvas: HTMLCanvasElement | null, profile: KartProfile, gl?: any) {
    this.native = !!gl;
    this.canvas = canvas;
    if (canvas) {
      canvas.style.touchAction = 'none';
      this.reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      canvas.addEventListener('pointerdown', this.onDown);
      canvas.addEventListener('pointermove', this.onMove);
      canvas.addEventListener('pointerup', this.onUp);
      canvas.addEventListener('pointercancel', this.onUp);
      canvas.addEventListener('lostpointercapture', this.onUp);
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
      new T.MeshStandardMaterial({ color: 0x26344a, metalness: 0.5, roughness: 0.18 }),
    );
    this.floor.position.y = -0.09;
    this.scene.add(this.floor);
    this.mirror = new Reflector(new T.CircleGeometry(1.97, 48), { textureWidth: 512, textureHeight: 512, color: 0x788da6, clipBias: .003, multisample: 0 });
    // The reflection does not need HDR storage. RGBA8 is renderable on every
    // WebGL2 device; half-float + MSAA (Reflector defaults) fails on mobile GPUs.
    this.mirror.getRenderTarget().texture.type = T.UnsignedByteType;
    this.mirror.rotation.x = -Math.PI / 2;
    this.mirror.position.y = -.025;
    this.scene.add(this.mirror);
    // Raised luminous turntable edge; reusable geometry disposed with the stage.
    const ring = new T.Mesh(new T.TorusGeometry(2.03, 0.025, 6, 64),
      new T.MeshStandardMaterial({ color: 0x64e5ff, emissive: 0x278eae, emissiveIntensity: 2 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.03;
    this.floor.add(ring);
    this.model = createVehicle(profile, QUALITY.ultra);
    this.scene.add(this.model.root);
  }
  setCircuit(circuit: Circuit) {
    if (this.circuitId === circuit.id) return;
    this.circuitId = circuit.id;
    if (this.backdrop) { this.scene.remove(this.backdrop.group); this.backdrop.dispose(); }
    this.backdrop = new CinematicScenery(new Track(circuit), QUALITY.low, circuit.seed);
    this.backdrop.group.scale.setScalar(.028);
    this.backdrop.group.position.y = -.5;
    this.scene.add(this.backdrop.group);
  }
  setBackdropVisible(visible: boolean) { if (this.backdrop) this.backdrop.group.visible = visible; }
  select(profile: KartProfile) {
    this.scene.remove(this.model.root);
    this.model.dispose();
    this.model = createVehicle(profile, QUALITY.ultra);
    this.scene.add(this.model.root);
  }
  frame(time: number, width: number, height: number) {
    // Hidden/rotating layouts can transiently measure zero. Keep the last valid
    // drawing buffer instead of allocating 1px or projecting an invalid aspect.
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || this.renderer.getContext().isContextLost()) return;
    width = Math.floor(width); height = Math.floor(height);
    if (width !== this.width || height !== this.height) {
      this.width = width; this.height = height;
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
    if (this.lastTime && !this.dragging && !this.reducedMotion) this.angle += Math.min(0.05, (time - this.lastTime) / 1000) * 0.35;
    this.lastTime = time;
    this.backdrop?.update(time / 1000, { x: 0, y: 0, z: 0 }, this.reducedMotion);
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
      this.canvas.removeEventListener('lostpointercapture', this.onUp);
      this.canvas.removeEventListener('wheel', this.onWheel);
    }
    this.model.dispose();
    this.backdrop?.dispose();
    this.mirror.geometry.dispose();
    (this.mirror.material as T.Material).dispose();
    this.mirror.getRenderTarget().dispose();
    this.floor.traverse(o => {
      if (o instanceof T.Mesh && o !== this.floor) {
        o.geometry.dispose();
        (o.material as T.Material).dispose();
      }
    });
    this.pointers.clear();
    this.floor.geometry.dispose();
    (this.floor.material as T.Material).dispose();
    this.renderer.dispose();
    if (!this.native) this.renderer.forceContextLoss();
  }
}
