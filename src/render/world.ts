import { CinematicScenery } from './cinematicScenery';
/**
 * Turbo Karts Arena — moteur de rendu PARTAGÉ.
 *
 * Ce fichier est utilisé tel quel par :
 *   • l'application Android (expo-gl + Hermes)
 *   • la preview web (react-free, canvas WebGL2)
 *
 * Il assemble : ciel HDR → environnement PBR préconvolué → piste → décor →
 * karts → particules → post-traitement, et pilote la caméra de course.
 *
 * Optimisations 60 FPS :
 *   • réduction dynamique de résolution (jusqu'à la résolution native de l'écran)
 *   • pooling des particules, matériaux et géométries partagés
 *   • InstancedMesh pour la végétation, la foule et les barrières
 *   • ombres douces PCF avec carte de taille adaptée au palier
 *   • un seul render target de post-traitement + bloom préfiltré
 */

import * as THREE from 'three';
import { createRoadside } from './roadside';
import { upcomingHazard } from '../core/hazards';
import type { Difficulty } from '../game/vehicles';
import { Race } from '../core/race';
import { makeBrain, thinkAi, type AiBrain } from '../core/ai';
import type { DriveInput } from '../core/kart';
import { clamp, damp, dampAngle, lerp, smoothstep } from '../core/math';
import { PHYSICS, type QualitySettings } from '../core/config';
import type { Circuit, CircuitTheme } from '../game/circuits';
import { THEMES } from '../game/circuits';
import type { KartProfile } from '../game/roster';
import { buildTrackMesh, type TrackMesh } from './trackMesh';
import {
  createKart,
  createMaterials,
  createScenery,
  type KartModel,
  type MaterialLibrary,
  type SceneryResult,
} from './models';
import { createPostFX, type PostFX } from './postfx';
import { EffectsRegistry } from './particles';
import { buildEnvironment, SkyDome } from './sky';
import { glowTexture, smokeTexture } from './textures';
import { aiShouldFire, applyHit, fireWeapon, makeRacer, pickupGift, projectileHits, recoverSpeed, spawnGifts, stepProjectile, updateGifts, type Gift, type Projectile, type RacerCombat, type WeaponKind } from '../core/powerups';
import { createGiftMesh, createShieldBubble, updateGiftMesh, collectGiftMesh } from './gifts3d';

export interface EngineOptions {
  /** Contexte WebGL (expo-gl) ou null si `canvas` est fourni. */
  gl: WebGLRenderingContext | WebGL2RenderingContext | any;
  canvas: HTMLCanvasElement | any | null;
  width: number;
  height: number;
  pixelRatio: number;
  quality: QualitySettings;
  circuit: Circuit;
  profile: KartProfile;
  laps: number;
  reducedMotion?: boolean;
  onGiftPickup?: () => void;
  difficulty?: Difficulty;
  onFrame?: (dt: number) => void;
  onFinish?: () => void;
}

interface KartVisual {
  model: KartModel;
  wheelSpin: number;
  steerVisual: number;
  boostLightPower: number;
  spinVel: number[];
}

export class PhysicsEngine {
  readonly race: Race;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  quality: QualitySettings;
  circuit: Circuit;
  theme: CircuitTheme;

  private postfx: PostFX;
  private sky: SkyDome;
  private materials: MaterialLibrary;
  private scenery: SceneryResult;
  private cinematicScenery: CinematicScenery;
  private windUniforms: Array<{ value: number }> = [];
  reducedMotion = false;
  private onGiftPickup?: () => void;
  readonly roadside: ReturnType<typeof createRoadside>;
  private trackMesh: TrackMesh;
  private effects: EffectsRegistry;
  private kartVisuals: KartModel[] = [];
  private visuals: KartVisual[] = [];
  private sun: THREE.DirectionalLight;
  private fill: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private input: DriveInput = { steer: 0, drift: false, brake: false, throttle: 1 };

  /* caméra / ressenti */
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camDesired = new THREE.Vector3();
  private camYaw = 0;
  private shake = 0;
  private camFov = 62;
  private lastTime = 0;
  private elapsed = 0;
  private disposeFns: Array<() => void> = [];
  private environmentTarget?: THREE.WebGLRenderTarget;
  private contextResourcesReleased = false;
  private terrain: THREE.Mesh | null = null;

  /* résolution dynamique */
  private targetPixelRatio: number;
  private currentPixelRatio: number;
  private frameAvg = 1 / 60;
  private resizeCooldown = 0;
  private width: number;
  private height: number;
  private isNative: boolean;

  /* HUD / événements à remonter */
  private finishedFired = false;

  /* ---- V3 : cadeaux, combat, projectiles ---- */
  readonly combat: RacerCombat[] = [];
  private gifts: Gift[] = [];
  private giftMeshes: THREE.Group[] = [];
  private giftPos: Array<{ x: number; y: number; z: number }> = [];
  private projectiles: Array<{ p: Projectile; mesh: THREE.Mesh; travelled: number }> = [];
  private shieldMeshes: THREE.Mesh[] = [];
  private aiLastShot: number[] = [];
  combatEvent = '';
  private combatEventAt = -10;

  constructor(opts: EngineOptions) {
    this.circuit = opts.circuit;
    this.theme = THEMES[opts.circuit.themeId] ?? THEMES.coast;
    this.quality = opts.quality;
    this.width = Number.isFinite(opts.width) ? Math.max(1, Math.floor(opts.width)) : 1;
    this.height = Number.isFinite(opts.height) ? Math.max(1, Math.floor(opts.height)) : 1;
    this.isNative = !!opts.gl && !opts.canvas;
    this.targetPixelRatio = clamp(opts.pixelRatio, 0.6, opts.quality.pixelRatioCap);
    this.currentPixelRatio = this.targetPixelRatio;

    /* ---------------- renderer ---------------- */
    const canvas = opts.canvas ?? makeCanvasShim(opts.gl);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      context: opts.gl,
      antialias: false, // on gère l'AA par le post-traitement / le MSAA du render target
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    });
    this.renderer.setPixelRatio(this.currentPixelRatio);
    this.renderer.setSize(this.width, this.height, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.88;
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x0a0f1e, 1);

    const maxRes = this.quality.maxPixels;
    const px = this.width * this.height * this.currentPixelRatio * this.currentPixelRatio;
    if (px > maxRes) {
      this.currentPixelRatio *= Math.sqrt(maxRes / px);
      this.renderer.setPixelRatio(this.currentPixelRatio);
    }

    /* ---------------- scène ---------------- */
    this.camera = new THREE.PerspectiveCamera(
      this.camFov,
      this.width / this.height,
      0.4,
      this.quality.drawDistance * 1.6,
    );
    this.scene.fog = new THREE.FogExp2(this.theme.fogColor, this.theme.fogDensity);

    this.sky = new SkyDome(this.theme);
    this.scene.add(this.sky.mesh);

    /* environnement PBR préconvolué (reflets réalistes sans fichier HDR) */
    this.restoreContextResources();

    /* ---------------- lumières ---------------- */
    this.hemi = new THREE.HemisphereLight(
      this.theme.hemiSky,
      this.theme.hemiGround,
      this.theme.hemiIntensity,
    );
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(this.theme.sunColor, this.theme.sunIntensity);
    const sd = this.theme.sunDir;
    this.sun.position.set(sd[0] * 120, sd[1] * 140, sd[2] * 120);
    this.sun.castShadow = this.quality.shadows;
    if (this.quality.shadows) {
      const s = this.quality.shadowMapSize;
      this.sun.shadow.mapSize.set(s, s);
      this.sun.shadow.camera.near = 20;
      this.sun.shadow.camera.far = 380;
      const span = 70;
      const cam = this.sun.shadow.camera as THREE.OrthographicCamera;
      cam.left = -span;
      cam.right = span;
      cam.top = span;
      cam.bottom = -span;
      cam.updateProjectionMatrix();
      this.sun.shadow.bias = -0.0008;
      this.sun.shadow.normalBias = 0.04;
      this.sun.shadow.radius = this.quality.level === 'ultra' ? 3.2 : 2;
    }
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // Lumière d'appoint : évite les carrosseries "sales" dans l'ombre et donne
    // du volume aux karts sans coûter d'ombre supplémentaire.
    this.fill = new THREE.DirectionalLight(0xdfe9ff, this.theme.mood === 'night' ? 0.55 : 0.55);
    this.fill.position.set(-60, 40, -80);
    this.scene.add(this.fill);
    this.scene.add(this.fill.target);

    /* ---------------- course ---------------- */
    this.race = new Race({
      circuit: opts.circuit,
      playerProfile: opts.profile,
      opponents: 5,
      laps: opts.laps,
      difficulty: opts.difficulty,
    });

    /* ---------------- matériaux / géométries ---------------- */
    this.materials = createMaterials(this.theme, this.quality);
    /* sol : grand disque de terrain, adapté au thème, avec micro-relief */
    const terrainGeo = new THREE.PlaneGeometry(1500, 1500, 110, 110);
    terrainGeo.rotateX(-Math.PI / 2);
    const pos = terrainGeo.getAttribute('position') as THREE.BufferAttribute;
    const track = this.race.track;
    const seaFloor = Math.min(...track.samples.map(p => p.y)) - 10;
    const coastal = ['ocean', 'coast', 'mediterranean', 'volcanic'].includes(this.theme.id);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      // Le terrain épouse la piste (talus) puis devient colline au loin :
      // la route n'est jamais enterrée ni suspendue. Sous la chaussée, on
      // creuse légèrement la maille grossière (~13,6 m) pour qu'aucune
      // diagonale de triangle ne remonte à travers un virage relevé.
      const h = track.groundHeight(x, z);
      const q = track.query(x, z, -1, false);
      const over = Math.max(0, Math.abs(q.lateral) - q.halfWidth);
      const t = clamp(over / 7.5, 0, 1);
      const s = t * t * (3 - 2 * t);
      const clearance = lerp(0.68, 0.12, s);
      // A viaduct needs visible space under its deck instead of buried piers.
      // Only visual terrain is lowered; the sampled driving ribbon stays intact.
      let valley = 0;
      for (const feature of opts.circuit.features ?? []) {
        if (feature.kind !== 'bridge') continue;
        const fraction = q.s / track.length;
        if (fraction > feature.start && fraction < feature.end) {
          const along = Math.sin(((fraction - feature.start) / (feature.end - feature.start)) * Math.PI);
          valley = Math.max(valley, Math.pow(along, 0.6) * 8 * (1 - smoothstep(3, 18, over)));
        }
      }
      pos.setY(i, coastal ? lerp(h - clearance - valley, seaFloor, smoothstep(24, 70, over)) : h - clearance - valley);
    }
    terrainGeo.computeVertexNormals();
    const groundMesh = new THREE.Mesh(terrainGeo, this.materials.grass);
    groundMesh.receiveShadow = this.quality.shadows;
    groundMesh.position.y = -0.02;
    this.scene.add(groundMesh);
    this.terrain = groundMesh;

    this.trackMesh = buildTrackMesh(this.race.track, this.materials, this.quality, {
      curbColors: this.theme.curbColors,
      id: this.theme.id,
    });
    this.scene.add(this.trackMesh.group);

    const trackPoints = this.race.track.samples.map((s) => ({
      x: s.x,
      y: s.y,
      z: s.z,
      tx: s.tx,
      tz: s.tz,
      rx: s.rx,
      rz: s.rz,
      halfWidth: s.halfWidth,
    }));
    this.scenery = createScenery(this.theme, this.materials, this.quality, trackPoints, opts.circuit.seed);
    this.scene.add(this.scenery.group);
    this.scenery.group.traverse(o => {
      if (o instanceof THREE.Mesh) {
        const list = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of list) if (m.userData.windTime && !this.windUniforms.includes(m.userData.windTime)) this.windUniforms.push(m.userData.windTime);
      }
    });
    this.reducedMotion = opts.reducedMotion ?? false;
    this.onGiftPickup = opts.onGiftPickup;
    this.cinematicScenery = new CinematicScenery(track, this.quality, opts.circuit.seed);
    this.scene.add(this.cinematicScenery.group);
    this.roadside = createRoadside(this.race.track, opts.circuit, this.quality);
    this.scene.add(this.roadside.group);
    if (opts.circuit.rain) {
      this.materials.road.roughness = 0.3;
      this.materials.road.metalness = 0.15;
    }
    if (opts.circuit.environment === 'dunes') this.materials.road.color.setHex(0xe0bf8d);

    /* ---------------- karts ---------------- */
    for (const kart of this.race.karts) {
      const model = createKart(
        // l'IA utilise le profil du roster d'origine
        kart.profile,
        this.materials,
        this.quality,
      );
      this.kartVisuals.push(model);
      this.visuals.push({
        model,
        wheelSpin: 0,
        steerVisual: 0,
        boostLightPower: 0,
        spinVel: model.wheels.map(() => 0),
      });
      this.scene.add(model.root);
    }

    /* ---------------- V3 : cadeaux 3D + boucliers ---------------- */
    const samples = this.race.track.samples;
    this.gifts = spawnGifts(12, opts.circuit.seed);
    for (const gift of this.gifts) {
      const smp = samples[Math.min(samples.length - 1, Math.floor(gift.s * samples.length))];
      const px = smp.x + smp.rx * gift.lateral * smp.halfWidth;
      const pz = smp.z + smp.rz * gift.lateral * smp.halfWidth;
      this.giftPos.push({ x: px, y: smp.y, z: pz });
      const mesh = createGiftMesh(gift);
      mesh.position.set(px, smp.y + 1, pz);
      this.giftMeshes.push(mesh);
      this.scene.add(mesh);
    }
    for (let i = 0; i < this.race.karts.length; i++) {
      this.combat.push(makeRacer());
      this.aiLastShot.push(-10);
      const bubble = createShieldBubble();
      bubble.visible = false;
      bubble.position.y = 1;
      this.shieldMeshes.push(bubble);
      this.scene.add(bubble);
    }

    /* ---------------- particules ---------------- */
    const smokeTex = smokeTexture(this.quality.level === 'low' ? 64 : 128).albedo;
    const glowTex = glowTexture(this.quality.level === 'low' ? 64 : 128).albedo;
    this.disposeFns.push(() => {
      smokeTex.dispose();
      glowTex.dispose();
    });
    this.effects = new EffectsRegistry({ smoke: smokeTex, glow: glowTex }, this.quality.particleBudget);
    for (const p of this.effects.all()) this.scene.add(p.points);

    /* ---------------- post-traitement ---------------- */
    this.postfx = createPostFX(this.renderer, this.scene, this.camera, this.quality);
    this.postfx.setSize(this.width, this.height, this.currentPixelRatio);

    /* ---------------- caméra initiale ---------------- */
    const p = this.race.player.state;
    this.camPos.set(p.x - Math.sin(p.heading) * 8, p.y + 4, p.z - Math.cos(p.heading) * 8);
    this.camYaw = p.heading;
    this.camera.position.copy(this.camPos);
    this.scene.add(this.camera);

    this.onFinish = opts.onFinish;
    this.onFrame = opts.onFrame;
  }

  onFinish?: () => void;
  onFrame?: (dt: number) => void;
  /** Mode démo : l'IA pilote aussi le kart du joueur. */
  autopilot = false;
  private autopilotBrain: AiBrain = makeBrain(() => Math.random(), 0.9);

  /* ------------------------------------------------------------------ */
  /* Entrées                                                            */
  /* ------------------------------------------------------------------ */

  setInput(input: Partial<DriveInput>) {
    if (input.steer !== undefined) this.input.steer = clamp(input.steer, -1, 1);
    if (input.drift !== undefined) this.input.drift = input.drift;
    if (input.brake !== undefined) this.input.brake = input.brake;
    if (input.throttle !== undefined) this.input.throttle = clamp(input.throttle, 0, 1);
  }

  get player() {
    return this.race.player;
  }

  /** Detach GPU-only targets while the context is lost. Old-context framebuffer
   * handles must not be deleted/reused after the browser creates a new epoch. */
  releaseContextResources() {
    if (!this.renderer.getContext().isContextLost() || this.contextResourcesReleased) return;
    this.environmentTarget?.dispose();
    this.environmentTarget = undefined;
    this.scene.environment = null;
    this.postfx.dispose();
    this.sun.shadow.dispose();
    this.sun.shadow.map = null;
    this.sun.shadow.mapPass = null;
    this.contextResourcesReleased = true;
  }

  /** Called only at construction / after a real context-restored event.
   * GPU-generated PMREM contents cannot be re-uploaded from CPU image data. */
  restoreContextResources() {
    if (this.renderer.getContext().isContextLost()) throw new Error('Le contexte graphique n’est pas rétabli.');
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    let target: THREE.WebGLRenderTarget;
    try {
      target = buildEnvironment(this.renderer, this.theme, pmrem, this.quality.level === 'ultra' ? 256 : 128);
    } finally {
      // Scratch targets/materials are not needed throughout the race.
      pmrem.dispose();
    }
    this.environmentTarget?.dispose();
    this.environmentTarget = target;
    this.scene.environment = target.texture;
    this.scene.environmentIntensity = this.theme.mood === 'night' ? 0.4 : 0.45;
    if (this.contextResourcesReleased) {
      this.postfx = createPostFX(this.renderer, this.scene, this.camera, this.quality);
      this.postfx.setSize(this.width, this.height, this.currentPixelRatio);
      this.contextResourcesReleased = false;
    }
  }

  /** Réinitialise l'horloge de rendu après une suspension, sans toucher à la course. */
  resetFrameClock() {
    this.lastTime = 0;
  }

  restart() {
    this.resetCombat();
    this.race.reset();
    this.race.phase = 'countdown';
    this.finishedFired = false;
    this.lastTime = 0;
    this.shake = 0;
    this.input = { steer: 0, drift: false, brake: false, throttle: 1 };
    const p = this.race.player.state;
    this.camPos.set(p.x - Math.sin(p.heading) * 8, p.y + 4, p.z - Math.cos(p.heading) * 8);
    this.camYaw = p.heading;
  }

  /* ------------------------------------------------------------------ */
  /* Boucle                                                             */
  /* ------------------------------------------------------------------ */

  frame(timeMs: number, render = true) {
    const t = timeMs * 0.001;
    let dt = this.lastTime === 0 ? 1 / 60 : t - this.lastTime;
    this.lastTime = t;
    dt = clamp(dt, 1 / 240, 0.1);
    this.elapsed += dt;

    /* ---- simulation (pas fixe interne) ---- */
    const playerInput = this.autopilot
      ? thinkAi(this.race.player, this.autopilotBrain, this.race.track, dt, this.elapsed, this.race.karts)
      : this.input;
    this.race.update(dt, { player: playerInput });
    this.updateCombat(dt);
    this.consumeEvents();

    /* ---- visuels ---- */
    this.syncKarts(dt);
    this.roadside.update(dt, this.player.state.x, this.player.state.y, this.player.state.z);
    this.updateCamera(dt);
    this.sky.update(this.camera, this.reducedMotion ? 0 : this.elapsed);
    this.trackMesh.update(this.elapsed, 1);

    this.cinematicScenery.update(this.elapsed, this.player.state, this.reducedMotion);
    // Shared foliage uniforms, discovered once in constructor below.
    for (const uniform of this.windUniforms) uniform.value = this.reducedMotion ? 0 : this.elapsed;
    for (const a of this.scenery.animated) {
      if (this.reducedMotion) continue;
      if (a.kind === 'bob') {
        a.obj.position.y += Math.sin(this.elapsed * a.speed + a.phase) * dt * 0.6;
        a.obj.rotation.y += dt * a.speed;
      } else if (a.kind === 'flag') {
        a.obj.rotation.y = Math.sin(this.elapsed * a.speed + a.phase) * 0.35;
      }
    }

    this.effects.update(dt);

    // Reallocating the drawing buffer clears it. Adapt BEFORE drawing, never
    // after the final pass / native presentation (which exposed a black frame
    // even when the browser window had not changed size).
    this.frameAvg = lerp(this.frameAvg, dt, 0.08);
    this.adaptResolution(dt);
    this.updatePostFX(dt);

    /* ---- rendu ---- */
    if (render) {
      this.renderer.info.autoReset = false;
      this.renderer.info.reset();
      this.postfx.render(dt);
      const gl = this.renderer.getContext() as any;
      if (this.isNative && typeof gl.endFrameEXP === 'function') gl.endFrameEXP();
    }

    this.onFrame?.(dt);
  }

  private consumeEvents() {
    const evts = this.race.events;
    for (let i = 0; i < evts.length; i++) {
      const e = evts[i];
      const isPlayer = (id: number) => id === this.race.player.state.id;
      switch (e.type) {
        case 'impact': {
          this.effects.impact(e.x, e.y, e.z, e.power);
          if (isPlayer(e.kartId) || isPlayer((e as any).otherId))
            this.shake = Math.min(1, this.shake + e.power * 0.06);
          break;
        }
        case 'pad':
        case 'boost': {
          if (isPlayer(e.kartId)) this.shake = Math.max(this.shake, 0.18);
          break;
        }
        case 'finish': {
          if (isPlayer(e.kartId) && !this.finishedFired) {
            this.finishedFired = true;
            const s = this.race.player.state;
            this.effects.finishBurst(s.x, s.y, s.z);
            this.onFinish?.();
          }
          break;
        }
        case 'lap': {
          // le HUD lit directement l'état de course ; rien à mémoriser ici
          break;
        }
        default:
          break;
      }
    }
    evts.length = 0;
  }

  /* ------------------------------------------------------------------ */
  /* Synchronisation visuelle des karts                                 */
  /* ------------------------------------------------------------------ */

  private syncKarts(dt: number) {
    for (let i = 0; i < this.race.karts.length; i++) {
      const kart = this.race.karts[i];
      const st = kart.state;
      const model = this.kartVisuals[i];
      const vis = this.visuals[i];
      if (!model) continue;

      // LOD : au-delà de 42 m (ou hors qualité haute) on affiche la silhouette simple
      const distToCam = this.camera.position.distanceTo(model.root.position);
      const useLod = distToCam > 42 || (this.quality.level === 'low' && distToCam > 26);
      model.body.visible = !useLod;
      model.lod.visible = useLod;
      model.root.position.set(st.x, st.y, st.z);
      model.root.rotation.y = st.heading + st.visualYawSlip;
      model.body.rotation.z = st.visualRoll;
      model.body.rotation.x = st.visualPitch;
      model.body.position.y = st.hop + st.bounce * 0.12;

      // roues : rotation + braquage
      vis.wheelSpin += (st.speed / (model.root.userData.wheelRadius ?? 0.42)) * dt;
      const steerAngle = damp(
        vis.steerVisual,
        st.steer * 0.5 + (st.drifting ? st.driftDir * 0.16 : 0),
        12,
        dt,
      );
      vis.steerVisual = steerAngle;
      for (let w = 0; w < model.wheels.length; w++) {
        model.wheels[w].rotation.x = vis.wheelSpin;
      }
      for (const fw of model.frontWheels) fw.rotation.y = steerAngle;

      if (!this.reducedMotion && Math.abs(st.speed) > 3) {
        const contact = this.race.track.query(st.x, st.z, st.trackIndex);
        this.effects.surfaceSpray(contact.terrain, st.x, st.y, st.z, Math.abs(st.speed), st.heading, dt);
        // Wheel carrier travel, not a whole-model bob. Spin/steering pivots stay intact.
        for (let w = 0; w < model.wheels.length; w++) {
          const pivot = model.wheels[w].parent;
          if (pivot) {
            const rest = model.root.userData.wheelRadius ?? .34;
            pivot.position.y = rest + Math.sin(this.elapsed * (12 + Math.abs(st.speed) * .4) + w * 1.6) * (contact.terrain === 'asphalt' ? .012 : .045);
          }
        }
      }
      // pilote : se penche dans les virages
      model.driver.body.rotation.z = -st.steer * 0.22;
      model.driver.head.rotation.y = st.steer * 0.3;

      // lumière de turbo
      const boosting = kart.isBoosting;
      const tier = st.boostTier;
      vis.boostLightPower = damp(vis.boostLightPower, boosting ? 1 : 0, boosting ? 16 : 6, dt);
      const lightMat = model.boostLight.material as THREE.MeshBasicMaterial;
      const col = tier >= 3 ? 0xc65cff : tier === 2 ? 0xff9a2e : 0x40c8ff;
      lightMat.color.setHex(col);
      lightMat.opacity = vis.boostLightPower * 0.95;
      const ls = 0.8 + vis.boostLightPower * (1.4 + Math.random() * 0.5);
      model.boostLight.scale.setScalar(ls);

      // particules
      const fwdX = Math.sin(st.heading);
      const fwdZ = Math.cos(st.heading);
      const rightX = -Math.cos(st.heading);
      const rightZ = Math.sin(st.heading);
      if (st.drifting) {
        this.effects.driftTrail(st.x, st.y, st.z, rightX, rightZ, Math.abs(st.speed), st.driftTier, dt);
      }
      if (boosting && Math.random() < 0.9) {
        this.effects.boostJet(st.x, st.y, st.z, fwdX, fwdZ, tier);
      }
      if ((st.surface === 'grass' || this.circuit.environment === 'dunes') && Math.abs(st.speed) > 6) {
        this.effects.offRoadDust(st.x, st.y, st.z, Math.abs(st.speed), dt);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Caméra                                                            */
  /* ------------------------------------------------------------------ */

  private updateCamera(dt: number) {
    const kart = this.race.player;
    const st = kart.state;
    const speed = Math.abs(st.speed);
    const speedNorm = clamp(speed / PHYSICS.kart.maxSpeed, 0, 1.4);

    // orientation lissée de la caméra : suit le cap mais "regarde" un peu plus loin
    const headingTarget = st.heading + st.visualYawSlip * 0.55;
    this.camYaw = dampAngle(this.camYaw, headingTarget, st.drifting ? 5.5 : 7.5, dt);

    const back = 5.9 + speedNorm * 1.5;
    const up = (kart.stats.bike ? 2.75 : 2.55) + speedNorm * 0.4;
    const fwdX = Math.sin(this.camYaw);
    const fwdZ = Math.cos(this.camYaw);

    const desired = this.camDesired.set(st.x - fwdX * back, st.y + up, st.z - fwdZ * back);
    // la caméra ne traverse pas le sol de la piste
    const groundY = this.race.track.query(desired.x, desired.z, st.trackIndex).y;
    desired.y = Math.max(desired.y, groundY + 1.5);

    const stiffness = st.drifting ? 9 : 12;
    this.camPos.x = damp(this.camPos.x, desired.x, stiffness, dt);
    this.camPos.y = damp(this.camPos.y, desired.y, stiffness * 0.75, dt);
    this.camPos.z = damp(this.camPos.z, desired.z, stiffness, dt);

    // tremblement d'impact
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const shakeAmp = this.reducedMotion ? 0 : this.shake * 0.28;
    this.camera.position.set(
      this.camPos.x + (Math.random() - 0.5) * shakeAmp,
      this.camPos.y + (Math.random() - 0.5) * shakeAmp,
      this.camPos.z + (Math.random() - 0.5) * shakeAmp,
    );

    const lookAhead = 9 + speedNorm * 6;
    this.camLook.set(
      st.x + Math.sin(st.heading) * lookAhead,
      st.y + 1.25,
      st.z + Math.cos(st.heading) * lookAhead,
    );
    if (!this.reducedMotion && (this.race.phase === 'countdown' || this.race.phase === 'finished')) {
      const intro = this.race.phase === 'countdown';
      const turn = intro ? Math.max(0, this.race.countdown - .6) / 2.6 * 1.3 : this.elapsed * .7;
      const angle = st.heading + turn;
      this.camera.position.set(st.x - Math.sin(angle) * 7, st.y + (intro ? 3.5 : 2.5), st.z - Math.cos(angle) * 7);
      this.camLook.set(st.x, st.y + .9, st.z);
      this.camPos.copy(this.camera.position);
    }
    this.camera.lookAt(this.camLook);

    // FOV dynamique : effet de vitesse + coup de zoom au turbo
    const boost = kart.isBoosting ? 1 : 0;
    const fovTarget = this.reducedMotion ? 60 : 60 + speedNorm * 8 + boost * 6 + (st.drifting ? 2 : 0);
    this.camFov = damp(this.camFov, fovTarget, 4.5, dt);
    if (Math.abs(this.camera.fov - this.camFov) > 0.05) {
      this.camera.fov = this.camFov;
      this.camera.updateProjectionMatrix();
    }

    this.fill.position.set(st.x - Math.sin(st.heading) * 60, st.y + 45, st.z - Math.cos(st.heading) * 60);
    this.fill.target.position.set(st.x, st.y, st.z);
    this.fill.target.updateMatrixWorld();

    // le soleil suit le joueur pour garder des ombres nettes partout
    if (this.quality.shadows) {
      const sd = this.theme.sunDir;
      this.sun.position.set(st.x + sd[0] * 120, st.y + sd[1] * 140, st.z + sd[2] * 120);
      this.sun.target.position.set(st.x, st.y, st.z);
      this.sun.target.updateMatrixWorld();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Post-traitement piloté par l'état de course                        */
  /* ------------------------------------------------------------------ */

  private updatePostFX(dt: number) {
    const kart = this.race.player;
    const st = kart.state;
    const speedNorm = clamp(Math.abs(st.speed) / (PHYSICS.kart.maxSpeed * 1.25), 0, 1);
    const u = this.postfx.speedPass.uniforms;
    u.uTime.value = this.reducedMotion ? 0 : this.elapsed;
    u.uMotionBlur.value = !this.reducedMotion && this.quality.motionBlur ? 1 : 0;
    u.uSpeedLines.value = !this.reducedMotion && this.quality.speedLines ? 1 : 0;
    u.uSpeed.value = damp(u.uSpeed.value as number, speedNorm, 6, dt);
    u.uBoost.value = damp(u.uBoost.value as number, kart.isBoosting ? 1 : 0, 8, dt);
    u.uBoostTier.value = st.boostTier;
    u.uFlash.value = damp(u.uFlash.value as number, !this.reducedMotion && st.driftReleasedTime > 0 ? 0.16 : 0, 14, dt);
    const flashCol = st.boostTier >= 3 ? 0xc65cff : st.boostTier === 2 ? 0xff9a2e : 0x40c8ff;
    (u.uFlashColor.value as THREE.Color).setHex(flashCol);
    // aberration qui monte avec la vitesse
    u.uAberration.value = !this.reducedMotion && this.quality.chromatic ? 0.0012 + speedNorm * 0.0022 : 0;
    if (this.postfx.bloomPass) {
      this.postfx.bloomPass.strength =
        this.quality.bloomStrength * (0.7 + speedNorm * 0.35 + (kart.isBoosting ? 0.45 : 0));
    }
    this.effects.setSizeScale(this.height * this.currentPixelRatio * 0.5);
  }

  /* ------------------------------------------------------------------ */
  /* Résolution dynamique                                               */
  /* ------------------------------------------------------------------ */

  private adaptResolution(dt: number) {
    this.resizeCooldown -= dt;
    const target = 1 / 60;
    const pixelLimit = this.quality.maxPixels > 0 ? Math.sqrt(this.quality.maxPixels / (this.width * this.height)) : Infinity;
    const ratioLimit = Math.min(this.targetPixelRatio, pixelLimit);
    // tolérance : on ne réagit qu'aux vraies baisses durables
    if (this.resizeCooldown > 0) return;
    if (this.frameAvg > target * 1.28 && this.currentPixelRatio > 0.62) {
      this.currentPixelRatio = Math.max(0.62, this.currentPixelRatio * 0.9);
      this.applyResolution();
    } else if (this.frameAvg < target * 0.86 && this.currentPixelRatio < ratioLimit) {
      this.currentPixelRatio = Math.min(ratioLimit, this.currentPixelRatio * 1.05);
      this.applyResolution();
    }
  }

  private applyResolution() {
    this.renderer.setPixelRatio(this.currentPixelRatio);
    this.postfx.setSize(this.width, this.height, this.currentPixelRatio);
    this.resizeCooldown = 0.5;
  }

  /** Appelé par l'hôte lors d'une rotation / changement de taille. */
  resize(width: number, height: number) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return;
    width = Math.floor(width); height = Math.floor(height);
    if (this.width === width && this.height === height) return;
    this.width = width;
    this.height = height;
    const pixelLimit = this.quality.maxPixels > 0 ? Math.sqrt(this.quality.maxPixels / (width * height)) : Infinity;
    this.currentPixelRatio = Math.min(this.currentPixelRatio, this.targetPixelRatio, pixelLimit);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setDrawingBufferSize(width, height, this.currentPixelRatio);
    this.postfx.setSize(width, height, this.currentPixelRatio);
  }

  /* ------------------------------------------------------------------ */

  /* ---------------- V3 : combat ---------------- */
  private resetCombat() {
    for (let i = 0; i < this.combat.length; i++) this.combat[i] = makeRacer();
    this.gifts = spawnGifts(12, this.circuit.seed);
    for (const pr of this.projectiles) {
      this.scene.remove(pr.mesh);
      pr.mesh.geometry.dispose();
      (pr.mesh.material as THREE.Material).dispose();
    }
    this.projectiles = [];
    this.combatEvent = '';
  }
  firePlayerWeapon() { this.fireFrom(0); }
  private fireFrom(i: number) {
    const c = this.combat[i]; if (!c?.weapon) return;
    const st = this.race.karts[i].state;
    const kind = c.weapon;
    if (kind === 'shockwave') {
      c.weapon = null;
      for (let j = 0; j < this.race.karts.length; j++) {
        if (j === i) continue;
        const o = this.race.karts[j].state;
        if (Math.hypot(o.x - st.x, o.z - st.z) < 13) this.hitKart(j, i);
      }
      if (i === 0) this.combatEvent = 'Onde de choc !';
      return;
    }
    const p = fireWeapon(c, i, st.x, st.y !== undefined ? st.z : st.z, st.heading, this.elapsed);
    if (!p) return;
    if (kind === 'bomb') { p.vx = 0; p.vz = 0; }
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(kind === 'bomb' ? 0.45 : 0.28, 10, 8),
      new THREE.MeshBasicMaterial({ color: kind === 'bomb' ? 0x222222 : kind === 'homing' ? 0xff9a2e : 0xffe14d }),
    );
    mesh.position.set(st.x, st.y + 1, st.z);
    this.scene.add(mesh);
    this.projectiles.push({ p, mesh, travelled: 0 });
  }
  private hitKart(j: number, _owner: number) {
    const res = applyHit(this.combat[j], this.elapsed);
    if (res === 'hit') { this.race.karts[j].state.speed *= 0.45; if (j === 0) { this.shake = Math.max(this.shake, 0.4); this.combatEvent = 'Touché !'; this.combatEventAt = this.elapsed; } }
    else if (res === 'shielded' && j === 0) { this.combatEvent = 'Bouclier : impact absorbé !'; this.combatEventAt = this.elapsed; }
  }
  private updateCombat(dt: number) {
    const now = this.elapsed;
    updateGifts(this.gifts, now);
    const WEAPONS: WeaponKind[] = ['projectile', 'homing', 'bomb', 'shockwave'];
    for (let i = 0; i < this.race.karts.length; i++) {
      const kart = this.race.karts[i]; const c = this.combat[i]; if (!c) continue;
      const st = kart.state;
      recoverSpeed(c, dt);
      st.speedMult = (now < c.boostUntil ? 1.3 : 1) * c.speedFactor;
      const bubble = this.shieldMeshes[i];
      if (bubble) { bubble.visible = c.shield; bubble.position.set(st.x, st.y + 1, st.z); }
      for (let gi = 0; gi < this.gifts.length; gi++) {
        const g = this.gifts[gi]; if (!g.active) continue;
        const gp = this.giftPos[gi];
        const dist = Math.hypot(st.x - gp.x, st.z - gp.z);
        const before = c.weapon;
        if (pickupGift(c, g, now, dist)) {
          if (!this.reducedMotion) {
            collectGiftMesh(this.giftMeshes[gi], now);
            this.effects.giftBurst(gp.x, gp.y, gp.z);
          }
          if (i === 0) this.onGiftPickup?.();
          if (g.kind === 'weapon') c.weapon = WEAPONS[g.id % WEAPONS.length];
          if (i === 0) {
            this.combatEvent = { turbo: 'Turbo !', superTurbo: 'Super Turbo !', shield: 'Bouclier actif !', repair: 'Réparé !', coins: '+5 Turbo Coins', weapon: 'Arme récupérée !' }[g.kind];
            this.combatEventAt = now;
          }
          void before;
        }
      }
      if (i > 0 && aiShouldFire(!!c.weapon, this.aiTargetAhead(i), now, this.aiLastShot[i])) { this.aiLastShot[i] = now; this.fireFrom(i); }
    }
    for (let gi = 0; gi < this.gifts.length; gi++) { const m = this.giftMeshes[gi]; if (m) { updateGiftMesh(m, this.gifts[gi], now); m.position.x = this.giftPos[gi].x; m.position.z = this.giftPos[gi].z; m.position.y += this.giftPos[gi].y; } }
    // projectiles
    for (let k = this.projectiles.length - 1; k >= 0; k--) {
      const pr = this.projectiles[k]; const p = pr.p;
      let target: { x: number; z: number } | undefined;
      if (p.kind === 'homing') { let best = 1e9; for (let j = 0; j < this.race.karts.length; j++) { if (j === p.owner) continue; const o = this.race.karts[j].state; const d = Math.hypot(o.x - p.x, o.z - p.z); if (d < best) { best = d; target = o; } } }
      stepProjectile(p, dt, target);
      pr.travelled += Math.hypot(p.vx, p.vz) * dt;
      pr.mesh.position.set(p.x, pr.mesh.position.y, p.z);
      let dead = !p.alive || pr.travelled > 70 || now - p.bornAt > 12;
      if (p.kind === 'bomb') { pr.mesh.position.y = this.race.karts[p.owner].state.y + 0.4; for (let j = 0; j < this.race.karts.length; j++) { if (j !== p.owner && projectileHits({ ...p, alive: true, kind: 'projectile' }, this.race.karts[j].state.x, this.race.karts[j].state.z, 2.4)) { this.hitKart(j, p.owner); dead = true; } } }
      else for (let j = 0; j < this.race.karts.length; j++) { if (j === p.owner) continue; const o = this.race.karts[j].state; if (projectileHits(p, o.x, o.z)) { this.hitKart(j, p.owner); dead = true; break; } }
      if (dead) { this.scene.remove(pr.mesh); (pr.mesh.material as THREE.Material).dispose(); pr.mesh.geometry.dispose(); this.projectiles.splice(k, 1); }
    }
    if (now - this.combatEventAt > 3) this.combatEvent = '';
  }
  private aiTargetAhead(i: number): boolean {
    const st = this.race.karts[i].state; const fx = Math.sin(st.heading), fz = Math.cos(st.heading);
    for (let j = 0; j < this.race.karts.length; j++) { if (j === i) continue; const o = this.race.karts[j].state; const dx = o.x - st.x, dz = o.z - st.z; if (dx * fx + dz * fz > 4 && Math.hypot(dx, dz) < 45) return true; }
    return false;
  }
  get combatHud() {
    const c = this.combat[0] ?? makeRacer();
    return { weapon: c.weapon, shield: c.shield, coins: c.coins, health: c.health, event: this.combatEvent, projectiles: this.projectiles.length, giftsActive: this.gifts.filter((g) => g.active).length };
  }

  get stats() {
    const k = this.race.player;
    return {
      speed: Math.round(k.kmh),
      tier: k.state.driftTier,
      charge: k.driftChargeRatio,
      boosting: k.isBoosting,
      place: k.state.place,
      lap: k.state.lap,
      phase: this.race.phase,
      hazard: upcomingHazard(this.roadside.hazards, k.state.s, this.race.track.length, k.state.speed),
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      fps: Math.round(1 / Math.max(1e-3, this.frameAvg)),
      pixelRatio: this.currentPixelRatio,
      particles: this.effects.all().reduce((a, p) => a + p.activeCount, 0),
    };
  }

  dispose() {
    for (const fn of this.disposeFns) fn();
    for (const m of this.kartVisuals) {
      m.dispose();
      this.scene.remove(m.root);
    }
    // Gift ribbons share a material within each box: dispose each resource once.
    const giftMaterials = new Set<THREE.Material>();
    for (const gift of this.giftMeshes) gift.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) giftMaterials.add(material);
    });
    for (const material of giftMaterials) material.dispose();
    for (const bubble of this.shieldMeshes) { bubble.geometry.dispose(); (bubble.material as THREE.Material).dispose(); }
    for (const projectile of this.projectiles) { projectile.mesh.geometry.dispose(); (projectile.mesh.material as THREE.Material).dispose(); }
    this.effects.dispose();
    this.trackMesh.dispose();
    this.terrain?.geometry.dispose();
    this.scenery.dispose();
    this.cinematicScenery.dispose();
    this.roadside.dispose();
    this.materials.dispose();
    this.sky.dispose();
    this.postfx.dispose();
    this.environmentTarget?.dispose();
    this.sun.shadow.dispose();
    this.renderer.dispose();
    if (!this.isNative) this.renderer.forceContextLoss();
    void smoothstep;
  }
}

/**
 * expo-gl expose un contexte sans canvas DOM. three.js a besoin d'un objet
 * minimal (style, dimensions, événements) : on lui fournit ce shim.
 */
export function makeCanvasShim(gl: any) {
  const vga: any = {
    width: gl.drawingBufferWidth,
    height: gl.drawingBufferHeight,
    style: {},
    clientWidth: gl.drawingBufferWidth,
    clientHeight: gl.drawingBufferHeight,
    getContext: () => gl,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    setAttribute: () => undefined,
    getExtension: (n: string) => gl.getExtension?.(n),
  };
  return vga as HTMLCanvasElement;
}
