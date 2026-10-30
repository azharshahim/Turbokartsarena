import type { Terrain } from '../core/terrain';
/**
 * Turbo Karts Arena — particules GPU-friendly avec pooling.
 *
 * Un seul `THREE.Points` par système, un seul appel de dessin, toutes les
 * particules dans des tableaux typés pré-alloués. Aucune allocation à
 * l'exécution : les particules mortes sont simplement recyclées.
 *
 * Systèmes : fumée de dérapage, étincelles de turbo, poussière hors-piste,
 * éclaboussures (circuit côtier), confettis d'arrivée.
 */

import * as THREE from 'three';

export interface ParticleSystemOptions {
  capacity: number;
  texture: THREE.Texture;
  size: [number, number];
  colorA: THREE.Color;
  colorB: THREE.Color;
  blending?: THREE.Blending;
  gravity?: number;
  drag?: number;
  /** Taille en unités monde (true) ou en pixels (false). */
  worldSize?: boolean;
  opacity?: number;
  /** Facteur de grossissement au cours de la vie. */
  grow?: number;
}

const VERT = /* glsl */ `
  attribute float aSize;
  attribute float aLife;
  attribute vec3 aColor;
  varying float vLife;
  varying vec3 vColor;
  uniform float uSizeScale;
  void main() {
    vLife = aLife;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uSizeScale / max(-mv.z, 0.1);
    gl_PointSize = clamp(gl_PointSize, 1.0, 320.0);
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uOpacity;
  varying float vLife;
  varying vec3 vColor;
  void main() {
    vec4 tex = texture2D(uMap, gl_PointCoord);
    float a = tex.a * vLife * uOpacity;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vColor * tex.rgb, a);
    #include <colorspace_fragment>
  }
`;

export class ParticleSystem {
  readonly points: THREE.Points;
  readonly capacity: number;
  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;
  private alphas: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size0: Float32Array;
  private grow: Float32Array;
  private alive = 0;
  private cursor = 0;
  private gravity: number;
  private drag: number;
  private opts: ParticleSystemOptions;
  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;

  constructor(opts: ParticleSystemOptions) {
    this.opts = opts;
    this.capacity = opts.capacity;
    this.gravity = opts.gravity ?? 0;
    this.drag = opts.drag ?? 1.2;

    const n = opts.capacity;
    this.positions = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 3);
    this.sizes = new Float32Array(n);
    this.alphas = new Float32Array(n);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.size0 = new Float32Array(n);
    this.grow = new Float32Array(n);
    for (let i = 0; i < n; i++) this.positions[i * 3 + 1] = -9999;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    geo.setAttribute('aLife', new THREE.BufferAttribute(this.alphas, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: opts.texture },
        uOpacity: { value: opts.opacity ?? 1 },
        uSizeScale: { value: 420 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: opts.blending ?? THREE.NormalBlending,
    });

    this.geometry = geo;
    this.material = mat;
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
  }

  tint(a: number, b: number, gravity: number) {
    this.opts.colorA.setHex(a); this.opts.colorB.setHex(b); this.gravity = gravity;
  }

  /** Émet une particule. Les arguments sont volontairement positionnels (zéro allocation). */
  emit(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    size: number,
    life: number,
    colorMix = Math.random(),
    grow = 0.9,
  ) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    const i3 = i * 3;
    this.positions[i3] = x;
    this.positions[i3 + 1] = y;
    this.positions[i3 + 2] = z;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    const a = this.opts.colorA;
    const b = this.opts.colorB;
    this.colors[i3] = a.r + (b.r - a.r) * colorMix;
    this.colors[i3 + 1] = a.g + (b.g - a.g) * colorMix;
    this.colors[i3 + 2] = a.b + (b.b - a.b) * colorMix;
    this.size0[i] = size;
    this.sizes[i] = size;
    this.grow[i] = grow;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.alphas[i] = 1;
  }

  update(dt: number) {
    const n = this.capacity;
    const pos = this.positions;
    const vel = this.vel;
    let alive = 0;
    const damp = Math.exp(-this.drag * dt);
    for (let i = 0; i < n; i++) {
      const l = this.life[i];
      if (l <= 0) {
        if (this.alphas[i] !== 0) {
          this.alphas[i] = 0;
          this.sizes[i] = 0;
        }
        continue;
      }
      const i3 = i * 3;
      const nl = l - dt;
      this.life[i] = nl;
      if (nl <= 0) {
        this.alphas[i] = 0;
        this.sizes[i] = 0;
        pos[i3 + 1] = -9999;
        continue;
      }
      alive++;
      vel[i3] *= damp;
      vel[i3 + 2] *= damp;
      vel[i3 + 1] = vel[i3 + 1] * damp + this.gravity * dt;
      pos[i3] += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;
      const t = nl / this.maxLife[i];
      // fondu d'apparition puis de disparition
      this.alphas[i] = Math.min(1, t * 2.4) * Math.min(1, (1 - t) * 3.2);
      this.sizes[i] = this.size0[i] * (1 + (1 - t) * this.grow[i]);
    }
    this.alive = alive;
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aLife') as THREE.BufferAttribute).needsUpdate = true;
  }

  get activeCount() {
    return this.alive;
  }

  /** Ajuste le budget selon la résolution (particules plus grosses si l'écran est petit). */
  setSizeScale(v: number) {
    this.material.uniforms.uSizeScale.value = v;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/* ------------------------------------------------------------------ */
/* Gestes de particules (appelés par le rendu)                        */
/* ------------------------------------------------------------------ */

const _c = new THREE.Color();

/**
 * Registre des effets : centralise le budget de particules et les gestes
 * (dérapage, boost, poussière, éclaboussures, impacts).
 */
export class EffectsRegistry {
  smoke: ParticleSystem;
  sparks: ParticleSystem;
  dust: ParticleSystem;
  splash: ParticleSystem;
  confetti: ParticleSystem;
  debris: ParticleSystem;

  constructor(textures: { smoke: THREE.Texture; glow: THREE.Texture }, budget: number) {
    this.smoke = new ParticleSystem({
      capacity: Math.max(40, Math.floor(budget * 0.42)),
      texture: textures.smoke,
      size: [1, 1],
      colorA: new THREE.Color(0xe8e8f0),
      colorB: new THREE.Color(0x8a8a99),
      gravity: 0.6,
      drag: 2.2,
      opacity: 0.55,
      grow: 2.4,
    });
    this.sparks = new ParticleSystem({
      capacity: Math.max(30, Math.floor(budget * 0.3)),
      texture: textures.glow,
      size: [1, 1],
      colorA: new THREE.Color(0xffffff),
      colorB: new THREE.Color(0x40c8ff),
      blending: THREE.AdditiveBlending,
      gravity: -9,
      drag: 0.6,
      opacity: 1,
      grow: 0.4,
    });
    this.dust = new ParticleSystem({
      capacity: Math.max(30, Math.floor(budget * 0.10)),
      texture: textures.smoke,
      size: [1, 1],
      colorA: new THREE.Color(0xd8c39a),
      colorB: new THREE.Color(0xa88a5c),
      gravity: 0.3,
      drag: 2.6,
      opacity: 0.42,
      grow: 2.8,
    });
    this.splash = new ParticleSystem({
      capacity: Math.max(20, Math.floor(budget * 0.1)),
      texture: textures.glow,
      size: [1, 1],
      colorA: new THREE.Color(0xd6f4ff),
      colorB: new THREE.Color(0x5fc8f0),
      gravity: -12,
      drag: 0.9,
      opacity: 0.85,
      grow: 0.6,
    });
    this.debris = new ParticleSystem({
      capacity: Math.max(16, Math.floor(budget * .08)), texture: textures.smoke,
      size: [1, 1], colorA: new THREE.Color(0xffffff), colorB: new THREE.Color(0xbac8db),
      gravity: -8, drag: 1.2, opacity: .8, grow: .2,
    });
    this.confetti = new ParticleSystem({
      capacity: 240,
      texture: textures.glow,
      size: [1, 1],
      colorA: new THREE.Color(0xffe14d),
      colorB: new THREE.Color(0xff3d6e),
      gravity: -5.5,
      drag: 1.4,
      opacity: 0.95,
      grow: 0,
    });
  }

  all() {
    return [this.smoke, this.sparks, this.dust, this.splash, this.confetti, this.debris];
  }

  /** Fumée + étincelles de dérapage. `tier` colore les étincelles. */
  driftTrail(
    x: number,
    y: number,
    z: number,
    dirX: number,
    dirZ: number,
    speed: number,
    tier: number,
    dt: number,
  ) {
    const smokeRate = 26 + speed * 0.9;
    if (Math.random() < smokeRate * dt) {
      for (let side = -1; side <= 1; side += 2) {
        const sx = x + dirX * side * 0.62;
        const sz = z + dirZ * side * 0.62;
        this.smoke.emit(
          sx,
          y + 0.12,
          sz,
          (Math.random() - 0.5) * 2.2 - dirX * side * 1.2,
          0.9 + Math.random() * 1.4,
          (Math.random() - 0.5) * 2.2 - dirZ * side * 1.2,
          0.55 + Math.random() * 0.5,
          0.5 + Math.random() * 0.55,
        );
      }
    }
    if (tier > 0) {
      _c.setHex(tier === 1 ? 0x40c8ff : tier === 2 ? 0xff9a2e : 0xc65cff);
      const rate = 22 * tier;
      if (Math.random() < rate * dt) {
        for (let side = -1; side <= 1; side += 2) {
          this.sparks.emit(
            x + dirX * side * 0.7,
            y + 0.16,
            z + dirZ * side * 0.7,
            -dirX * 2 + (Math.random() - 0.5) * 5,
            1.5 + Math.random() * 4,
            -dirZ * 2 + (Math.random() - 0.5) * 5,
            0.16 + Math.random() * 0.14,
            0.18 + Math.random() * 0.16,
            Math.random(),
          );
          const i = this.sparks.capacity;
          void i;
        }
      }
    }
  }

  boostJet(x: number, y: number, z: number, fwdX: number, fwdZ: number, tier: number) {
    _c.setHex(tier >= 3 ? 0xc65cff : tier === 2 ? 0xff9a2e : 0x40c8ff);
    for (let i = 0; i < 2; i++) {
      this.sparks.emit(
        x - fwdX * 1.1 + (Math.random() - 0.5) * 0.35,
        y + 0.42 + Math.random() * 0.2,
        z - fwdZ * 1.1 + (Math.random() - 0.5) * 0.35,
        -fwdX * (6 + Math.random() * 6),
        Math.random() * 1.5,
        -fwdZ * (6 + Math.random() * 6),
        0.22 + Math.random() * 0.18,
        0.16 + Math.random() * 0.14,
        Math.random(),
      );
    }
  }

  offRoadDust(x: number, y: number, z: number, speed: number, dt: number) {
    if (Math.random() < (12 + speed * 0.6) * dt) {
      this.dust.emit(
        x + (Math.random() - 0.5) * 1.4,
        y + 0.1,
        z + (Math.random() - 0.5) * 1.4,
        (Math.random() - 0.5) * 3,
        1 + Math.random() * 2,
        (Math.random() - 0.5) * 3,
        0.6 + Math.random() * 0.6,
        0.5 + Math.random() * 0.5,
      );
    }
  }

  surfaceSpray(surface: Terrain, x: number, y: number, z: number, speed: number, heading: number, dt: number) {
    if (surface === 'asphalt' || speed < 3 || Math.random() > Math.min(1, dt * (8 + speed * .7))) return;
    const snowy = surface === 'snow', gravel = surface === 'gravel' || surface === 'volcanic';
    const color = snowy ? 0xf0f9ff : surface === 'sand' ? 0xe5c282 : surface === 'dirt' ? 0x9e6940 : 0x73737a;
    this.debris.tint(color, snowy ? 0xb5daed : 0x645342, gravel ? -13 : -4);
    for (const side of [-1, 1]) {
      const x0 = x + Math.cos(heading) * side * .65 - Math.sin(heading), z0 = z - Math.sin(heading) * side * .65 - Math.cos(heading);
      this.debris.emit(x0, y + .15, z0, -Math.sin(heading) * speed * .15 + side, 1.5 + Math.random() * 2, -Math.cos(heading) * speed * .15,
        gravel ? .09 : snowy ? .3 : .5, gravel ? .5 : .85, Math.random(), snowy ? 1.4 : .5);
    }
  }
  giftBurst(x: number, y: number, z: number) {
    for (let i = 0; i < 24; i++) {
      const angle = i / 24 * Math.PI * 2;
      this.confetti.emit(x, y + 1, z, Math.cos(angle) * 4, 2 + Math.random() * 3, Math.sin(angle) * 4, .2, .8);
    }
  }

  impact(x: number, y: number, z: number, power: number) {
    const n = Math.min(26, 6 + Math.floor(power * 3));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 2 + Math.random() * power * 0.9;
      this.sparks.emit(
        x,
        y,
        z,
        Math.cos(a) * s,
        1.5 + Math.random() * 4,
        Math.sin(a) * s,
        0.2 + Math.random() * 0.2,
        0.25 + Math.random() * 0.25,
        Math.random(),
      );
    }
  }

  finishBurst(x: number, y: number, z: number) {
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 3 + Math.random() * 9;
      this.confetti.emit(
        x,
        y + 1.5,
        z,
        Math.cos(a) * s,
        4 + Math.random() * 9,
        Math.sin(a) * s,
        0.22 + Math.random() * 0.2,
        1.4 + Math.random() * 1.1,
        Math.random(),
      );
    }
  }

  update(dt: number) {
    this.smoke.update(dt);
    this.sparks.update(dt);
    this.dust.update(dt);
    this.splash.update(dt);
    this.confetti.update(dt);
    this.debris.update(dt);
  }

  setSizeScale(v: number) {
    for (const p of this.all()) p.setSizeScale(v);
  }

  dispose() {
    for (const p of this.all()) p.dispose();
  }
}
