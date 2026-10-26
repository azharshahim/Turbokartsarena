/**
 * Turbo Karts Arena — modèles 3D procéduraux.
 *
 * Tous les modèles sont construits par code (aucun asset externe) :
 *  - 5 silhouettes de karts distinctes (compact, muscle, formula, buggy, rally)
 *  - un pilote articulé (tête casquée, buste, bras sur le volant)
 *  - le décor de chaque circuit (nature, tribunes, portiques, drones néon…)
 *
 * Les matériaux sont PBR (albedo + normal + roughness) partagés et mis en cache
 * pour limiter les changements d'état GPU.
 */

import * as THREE from 'three';
import type { KartProfile } from '../game/roster';
import type { CircuitTheme } from '../game/circuits';
import type { QualitySettings } from '../core/config';
import {
  asphaltTexture,
  bannerTexture,
  bodyPaintTexture,
  concreteTexture,
  grassTexture,
  metalTexture,
  sandTexture,
  curbTexture,
  type TextureSet,
} from './textures';
import { makeRng, rrange } from '../core/math';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface MaterialLibrary {
  road: THREE.MeshStandardMaterial;
  curb: THREE.MeshStandardMaterial;
  grass: THREE.MeshStandardMaterial;
  sand: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
  paint: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  glow: Record<string, THREE.MeshStandardMaterial>;
  dispose(): void;
}

function std(set: TextureSet, repeat: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  const m = new THREE.MeshStandardMaterial({
    map: set.albedo,
    normalMap: set.normal,
    roughnessMap: set.roughness,
    roughness: 1,
    metalness: 0,
    ...extra,
  });
  set.albedo.repeat.set(repeat, repeat);
  set.normal.repeat.set(repeat, repeat);
  set.roughness.repeat.set(repeat, repeat);
  return m;
}

export function createMaterials(theme: CircuitTheme, q: QualitySettings): MaterialLibrary {
  const size = q.textureSize;
  const aniso = q.anisotropy;
  const isSand = theme.id === 'desert';
  const isCity = theme.id === 'neon';

  const asphalt = asphaltTexture(size, aniso, isCity ? 0.3 : 0.34);
  const curb = curbTexture(size, aniso, theme.curbColors[0], theme.curbColors[1]);
  const ground = isSand ? sandTexture(size, aniso) : isCity ? concreteTexture(size, aniso) : grassTexture(size, aniso);
  const paint = bodyPaintTexture(size, aniso);
  const metal = metalTexture(size, aniso);

  const road = std(asphalt, 1, {
    roughness: 0.88,
    metalness: 0.03,
    color: new THREE.Color(0xffffff),
    vertexColors: true,
  });
  const curbMat = std(curb, 1, { roughness: 0.5, color: 0xffffff });
  curbMat.emissiveMap = curb.albedo;
  curbMat.emissive = new THREE.Color(0xffffff);
  curbMat.emissiveIntensity = isCity ? 0.5 : 0.08;
  const groundMat = std(ground, 240, { roughness: 0.95, color: new THREE.Color(isCity ? 0xd8dcff : 0xf2f6ee) });
  const paintMat = std(paint, 1, { roughness: 0.28, metalness: 0.55, envMapIntensity: 1.35 });
  const metalMat = std(metal, 1, { roughness: 0.42, metalness: 0.9, envMapIntensity: 1.1 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x14141a, roughness: 0.88, metalness: 0.02 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    metalness: 1,
    roughness: 0.02,
    envMapIntensity: 2.2,
    transparent: true,
    opacity: 0.55,
  });

  const glow: Record<string, THREE.MeshStandardMaterial> = {};
  for (const [k, hex] of Object.entries({
    blue: 0x40c8ff,
    orange: 0xff9a2e,
    purple: 0xc65cff,
    pink: 0xff3d6e,
    yellow: 0xffe14d,
    green: 0x2ee08a,
    white: 0xffffff,
    teal: 0x35f5c8,
  })) {
    glow[k] = new THREE.MeshStandardMaterial({
      color: hex,
      emissive: new THREE.Color(hex),
      emissiveIntensity: 2.6,
      roughness: 0.3,
      metalness: 0,
      toneMapped: true,
    });
  }

  return {
    road,
    curb: curbMat,
    grass: groundMat,
    sand: groundMat,
    concrete: groundMat,
    paint: paintMat,
    metal: metalMat,
    rubber,
    glass,
    glow,
    dispose() {
      for (const m of [road, curbMat, groundMat, paintMat, metalMat, rubber, glass]) m.dispose();
      for (const m of Object.values(glow)) m.dispose();
    },
  };
}

/* ------------------------------------------------------------------ */
/* Kart                                                               */
/* ------------------------------------------------------------------ */

export interface KartModel {
  root: THREE.Group;
  /** Version basse définition (LOD) affichée au-delà de `lodDistance`. */
  lod: THREE.Group;
  /** Châssis : tangage/roulis visuels sans impacter la physique. */
  body: THREE.Group;
  wheels: THREE.Object3D[];
  frontWheels: THREE.Object3D[];
  exhaust: THREE.Object3D;
  boostLight: THREE.Mesh;
  driver: { head: THREE.Object3D; body: THREE.Object3D };
  dispose(): void;
}

const SHARED_GEO = {
  wheel: new THREE.CylinderGeometry(0.42, 0.42, 0.34, 16),
  hub: new THREE.CylinderGeometry(0.2, 0.2, 0.36, 10),
  torso: new THREE.CapsuleGeometry(0.24, 0.3, 6, 10),
  head: new THREE.SphereGeometry(0.27, 16, 12),
  visor: new THREE.SphereGeometry(0.275, 16, 12, -0.6, 1.2, 1.1, 0.9),
  arm: new THREE.CapsuleGeometry(0.07, 0.34, 4, 6),
};

export function createKart(profile: KartProfile, mats: MaterialLibrary, q: QualitySettings): KartModel {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const geoDisposables: THREE.BufferGeometry[] = [];
  const matDisposables: THREE.Material[] = [];
  const seg = Math.max(6, Math.round(q.radialSegments * 0.6));

  const paintMat = mats.paint.clone();
  paintMat.color = new THREE.Color(profile.bodyColor);
  // Peinture automobile : métal modéré + environnement neutre. Un metalness élevé
  // ferait virer la teinte au vert (reflet du sol).
  paintMat.metalness = 0.28;
  paintMat.roughness = 0.2;
  paintMat.envMapIntensity = 1.5;
  paintMat.name = 'kartBody';
  const accentMat = mats.paint.clone();
  accentMat.color = new THREE.Color(profile.accentColor);
  accentMat.metalness = 0.45;
  accentMat.roughness = 0.18;
  accentMat.envMapIntensity = 1.6;
  const suitMat = new THREE.MeshStandardMaterial({ color: profile.suitColor, roughness: 0.72 });
  const skinMat = new THREE.MeshStandardMaterial({ color: profile.skinColor, roughness: 0.7 });
  const visorMat = new THREE.MeshStandardMaterial({
    color: profile.visorColor,
    metalness: 0.9,
    roughness: 0.06,
    emissive: new THREE.Color(profile.visorColor),
    emissiveIntensity: 0.35,
  });
  matDisposables.push(paintMat, accentMat, suitMat, skinMat, visorMat);

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    geoDisposables.push(geo);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    body.add(m);
    return m;
  };

  /* --- châssis : une silhouette par archétype --- */
  const shape = profile.shape;
  const isWide = shape === 'muscle' || shape === 'rally';
  const W = isWide ? 0.62 : 0.55; // demi-voie
  const L = shape === 'formula' ? 2.45 : shape === 'buggy' ? 1.85 : 2.15;

  const darkTrim = new THREE.MeshStandardMaterial({ color: 0x2e3140, roughness: 0.55, metalness: 0.25, envMapIntensity: 0.8 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xd7dbe8, roughness: 0.18, metalness: 1 });
  matDisposables.push(darkTrim, chrome);

  // fond plat + carénage latéral
  add(new THREE.BoxGeometry(W * 2.05, 0.13, L * 0.94), darkTrim, 0, 0.3, 0);
  // caisson central
  const tub = add(new THREE.BoxGeometry(W * 1.62, 0.44, L * 0.8), paintMat, 0, 0.48, 0.02);
  tub.scale.z = 1;
  // capot avant incliné
  const hood = add(new THREE.BoxGeometry(W * 1.35, 0.26, L * 0.42), paintMat, 0, 0.62, L * 0.26);
  hood.rotation.x = -0.14;
  // pointe avant
  const nose = add(new THREE.ConeGeometry(W * 1.15, L * 0.34, seg), accentMat, 0, 0.55, L * 0.47);
  nose.rotation.x = Math.PI / 2;
  nose.scale.set(1, 1, 0.55);
  // bande d'accent sur le capot
  const stripe = add(new THREE.BoxGeometry(W * 0.34, 0.05, L * 0.62), accentMat, 0, 0.76, L * 0.12);
  stripe.rotation.x = -0.06;
  // pontons / jupes latérales
  for (const side of [-1, 1]) {
    const pod = add(new THREE.CapsuleGeometry(W * 0.24, L * 0.5, 5, seg), paintMat, side * W * 1.12, 0.38, -0.04);
    pod.rotation.x = Math.PI / 2;
    pod.scale.set(1, 1, 0.48);
    add(new THREE.BoxGeometry(0.08, 0.24, L * 0.5), accentMat, side * W * 1.36, 0.48, -0.02);
  }

  // aileron arrière + mât
  const wingMat = shape === 'rally' ? darkTrim : accentMat;
  const wing = add(new THREE.BoxGeometry(W * 2.5, 0.09, 0.44), wingMat, 0, 1.02, -L * 0.46);
  wing.rotation.x = -0.13;
  add(new THREE.BoxGeometry(W * 2.5, 0.06, 0.1), darkTrim, 0, 0.94, -L * 0.5);
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(0.08, 0.46, 0.12), chrome, side * W * 1.05, 0.82, -L * 0.46);
    // dérive latérale
    const fin = add(new THREE.BoxGeometry(0.07, 0.3, 0.42), accentMat, side * W * 1.22, 1.0, -L * 0.46);
    fin.rotation.z = side * 0.15;
  }

  // aileron avant
  const fw = add(new THREE.BoxGeometry(W * 2.3, 0.07, 0.34), accentMat, 0, 0.32, L * 0.46);
  fw.rotation.x = 0.1;
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(0.07, 0.26, 0.3), darkTrim, side * W * 1.1, 0.22, L * 0.46);
  }

  // siège baquet + harnais
  const seat = add(new THREE.BoxGeometry(W * 1.15, 0.55, 0.5), darkTrim, 0, 0.72, -0.28);
  seat.rotation.x = -0.2;
  add(new THREE.BoxGeometry(0.12, 0.5, 0.06), accentMat, -W * 0.35, 0.78, -0.06);
  add(new THREE.BoxGeometry(0.12, 0.5, 0.06), accentMat, W * 0.35, 0.78, -0.06);

  // pilote
  const driver = new THREE.Group();
  driver.position.set(0, 0.86, -0.24);
  body.add(driver);

  const torso = new THREE.Mesh(SHARED_GEO.torso, suitMat);
  torso.rotation.x = -0.14;
  torso.scale.set(1.05, 1, 0.82);
  torso.castShadow = true;
  driver.add(torso);

  const head = new THREE.Group();
  head.position.set(0, 0.44, 0.02);
  driver.add(head);
  const helmetMat = new THREE.MeshStandardMaterial({
    color: profile.bodyColor,
    roughness: 0.22,
    metalness: 0.45,
    envMapIntensity: 1.4,
  });
  matDisposables.push(helmetMat);
  const skull = new THREE.Mesh(SHARED_GEO.head, helmetMat);
  skull.scale.set(1, 1.05, 1.08);
  skull.castShadow = true;
  head.add(skull);
  const visor = new THREE.Mesh(SHARED_GEO.visor, visorMat);
  visor.position.z = 0.03;
  visor.scale.set(1.02, 1, 1.02);
  head.add(visor);
  const helmetStripe = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.34, 0.06), accentMat);
  helmetStripe.position.set(0, 0.13, 0.15);
  helmetStripe.rotation.x = -0.2;
  head.add(helmetStripe);

  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(SHARED_GEO.arm, suitMat);
    arm.position.set(side * 0.23, 0.1, 0.18);
    arm.rotation.set(0.95, 0, side * 0.28);
    arm.castShadow = true;
    driver.add(arm);
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 6), accentMat);
    glove.position.set(side * 0.2, 0.02, 0.34);
    driver.add(glove);
  }

  // volant + colonne de direction
  const wheelRing = add(new THREE.TorusGeometry(0.17, 0.035, 6, 16), darkTrim, 0, 0.8, 0.14);
  wheelRing.rotation.x = 1.15;
  add(new THREE.CylinderGeometry(0.035, 0.035, 0.34, 6), chrome, 0, 0.72, 0.3).rotation.x = 1.15;

  // échappements relevés (style kart de course)
  for (const side of [-1, 1]) {
    const pipe = add(new THREE.CylinderGeometry(0.075, 0.095, 0.42, 8), chrome, side * 0.3, 0.74, -L * 0.44);
    pipe.rotation.x = Math.PI / 2.35;
  }

  /* --- roues --- */
  const wheels: THREE.Object3D[] = [];
  const frontWheels: THREE.Object3D[] = [];
  const wheelPositions: Array<[number, number, boolean]> = [
    [-W, 0.42, true],
    [W, 0.42, true],
    [-W, -0.42, false],
    [W, -0.42, false],
  ];
  const tireMat = mats.rubber;
  const hubMat = accentMat;
  for (const [x, z, front] of wheelPositions) {
    const pivot = new THREE.Group();
    pivot.position.set(x * 1.02, 0.42, z * (L * 0.34));
    body.add(pivot);
    const tire = new THREE.Mesh(SHARED_GEO.wheel, tireMat);
    tire.rotation.z = Math.PI / 2;
    tire.castShadow = true;
    const hub = new THREE.Mesh(SHARED_GEO.hub, hubMat);
    hub.rotation.z = Math.PI / 2;
    pivot.add(tire, hub);
    wheels.push(tire);
    if (front) frontWheels.push(pivot);
  }

  /* --- lumière de turbo (derrière le kart) --- */
  const exhaust = new THREE.Group();
  exhaust.position.set(0, 0.72, -L * 0.5 - 0.06);
  body.add(exhaust);
  const boostLight = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 10, 8),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0x40c8ff), transparent: true, opacity: 0 }),
  );
  exhaust.add(boostLight);

  /* --- LOD : silhouette simplifiée (2 boîtes + 4 disques) pour les karts lointains --- */
  const lod = new THREE.Group();
  const lodGeo: THREE.BufferGeometry[] = [];
  const lodTub = new THREE.BoxGeometry(W * 1.9, 0.5, L * 0.95);
  lodGeo.push(lodTub);
  const lodBody = new THREE.Mesh(lodTub, paintMat);
  lodBody.position.y = 0.45;
  lod.add(lodBody);
  const lodPilot = new THREE.SphereGeometry(0.3, 6, 5);
  lodGeo.push(lodPilot);
  const lodHead = new THREE.Mesh(lodPilot, helmetMat);
  lodHead.position.set(0, 0.95, -0.2);
  lod.add(lodHead);
  const lodWheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.3, 8);
  lodGeo.push(lodWheelGeo);
  for (const [x, z] of [
    [-W, L * 0.34],
    [W, L * 0.34],
    [-W, -L * 0.34],
    [W, -L * 0.34],
  ]) {
    const w = new THREE.Mesh(lodWheelGeo, mats.rubber);
    w.rotation.z = Math.PI / 2;
    w.position.set(x * 1.05, 0.4, z);
    lod.add(w);
  }
  lod.visible = false;
  root.add(lod);

  return {
    root,
    lod,
    body,
    wheels,
    frontWheels,
    exhaust,
    boostLight,
    driver: { head, body: torso },
    dispose() {
      for (const g of geoDisposables) g.dispose();
      for (const m of matDisposables) m.dispose();
      (boostLight.material as THREE.Material).dispose();
      boostLight.geometry.dispose();
      for (const g of lodGeo) g.dispose();
    },
  };
}

/* ------------------------------------------------------------------ */
/* Décor                                                              */
/* ------------------------------------------------------------------ */

export interface SceneryResult {
  group: THREE.Group;
  /** Objets animés (drones, fanions, éoliennes) à mettre à jour. */
  animated: Array<{ obj: THREE.Object3D; kind: 'spin' | 'bob' | 'flag'; phase: number; speed: number }>;
  dispose(): void;
}

/** Arbre / cactus / pylône selon le thème, en pools de 3 variantes. */
export function createScenery(
  theme: CircuitTheme,
  mats: MaterialLibrary,
  q: QualitySettings,
  trackPoints: Array<{
    x: number;
    y: number;
    z: number;
    rx: number;
    rz: number;
    tx: number;
    tz: number;
    halfWidth: number;
  }>,
  seed: number,
): SceneryResult {
  const group = new THREE.Group();
  const rng = makeRng(seed);
  const disposables: Array<THREE.BufferGeometry | THREE.Material> = [];
  const animated: SceneryResult['animated'] = [];

  const foliageMats = theme.foliage.map(
    (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.86, flatShading: true }),
  );
  const rockMat = new THREE.MeshStandardMaterial({ color: theme.rock, roughness: 0.92, flatShading: true });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5b3f2a, roughness: 0.95 });
  disposables.push(...foliageMats, rockMat, trunkMat);

  /* --- végétation / rochers dispersés le long de la piste --- */
  const count = q.treeCount;
  const variants: THREE.Object3D[] = [];
  const isNight = theme.id === 'neon';
  const isDesert = theme.id === 'desert';

  // 3 variantes réutilisées par InstancedMesh (un appel de dessin par variante)
  // Chaque variante est un petit "buisson d'arbres" fusionné (tronc + 3 houppes) :
  // 1 seul appel de dessin instancié, mais une silhouette crédible.
  const makeTreeVariant = (kind: 'pine' | 'round' | 'cactus' | 'palm' | 'neon') => {
    const parts: THREE.BufferGeometry[] = [];
    const push = (geo: THREE.BufferGeometry, x: number, y: number, z: number, sx = 1, sy = 1) => {
      geo.scale(sx, sy, sx);
      geo.translate(x, y, z);
      // mergeGeometries exige des attributs homogènes (indexé ou non) :
      // on normalise tout en non-indexé.
      parts.push(geo.index ? geo.toNonIndexed() : geo);
    };
    if (kind === 'pine') {
      push(new THREE.CylinderGeometry(0.22, 0.32, 2.2, 6), 0, 1.1, 0);
      push(new THREE.ConeGeometry(1.75, 3.0, 8), 0, 2.4, 0);
      push(new THREE.ConeGeometry(1.35, 2.6, 8), 0, 3.9, 0);
      push(new THREE.ConeGeometry(0.9, 2.0, 8), 0, 5.2, 0);
    } else if (kind === 'round') {
      push(new THREE.CylinderGeometry(0.28, 0.4, 2.6, 6), 0, 1.3, 0);
      push(new THREE.IcosahedronGeometry(1.75, 0), 0, 3.4, 0);
      push(new THREE.IcosahedronGeometry(1.2, 0), 0.9, 3.0, 0.5);
      push(new THREE.IcosahedronGeometry(1.05, 0), -0.85, 3.15, -0.4);
    } else if (kind === 'cactus') {
      push(new THREE.CylinderGeometry(0.5, 0.62, 4.6, 7), 0, 2.3, 0);
      push(new THREE.CylinderGeometry(0.3, 0.3, 2.0, 6), 0.85, 2.9, 0, 1, 1);
      push(new THREE.CylinderGeometry(0.28, 0.28, 1.6, 6), -0.8, 2.4, 0, 1, 1);
      push(new THREE.SphereGeometry(0.55, 8, 6), 0, 4.6, 0);
    } else if (kind === 'palm') {
      push(new THREE.CylinderGeometry(0.24, 0.36, 5.4, 6), 0, 2.7, 0);
      for (let i = 0; i < 5; i++) {
        const leaf = new THREE.ConeGeometry(0.42, 3.2, 5);
        leaf.rotateZ(Math.PI / 2.1);
        leaf.rotateY((i / 5) * Math.PI * 2);
        leaf.translate(0, 5.4, 0);
        parts.push(leaf.index ? leaf.toNonIndexed() : leaf);
      }
    } else {
      push(new THREE.CylinderGeometry(0.3, 0.44, 5.2, 6), 0, 2.6, 0);
      push(new THREE.BoxGeometry(1.5, 3.6, 1.5), 0, 4.6, 0);
      push(new THREE.BoxGeometry(0.9, 1.2, 0.9), 0, 6.6, 0);
    }
    // attributs communs : position + normal + uv
    for (const p of parts) {
      if (!p.getAttribute('uv')) {
        const n = p.getAttribute('position').count;
        p.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
      }
    }
    return mergeGeometries(parts) ?? parts[0];
  };

  const kinds: Array<'pine' | 'round' | 'cactus' | 'palm' | 'neon'> = isDesert
    ? ['cactus', 'cactus', 'round']
    : isNight
      ? ['neon', 'neon', 'round']
      : ['pine', 'round', 'palm'];

  const treeGeo: THREE.BufferGeometry[] = kinds.map((k) => makeTreeVariant(k));
  for (const g of treeGeo) disposables.push(g);

  for (let v = 0; v < 3; v++) {
    const geo = treeGeo[v];
    const mat = v === 2 ? rockMat : foliageMats[v % foliageMats.length];
    const inst = new THREE.InstancedMesh(geo, mat, Math.ceil(count / 3) + 2);
    inst.castShadow = q.shadows;
    inst.receiveShadow = false;
    variants.push(inst);
    group.add(inst);
  }
  const dummy = new THREE.Object3D();
  const counts = [0, 0, 0];
  const maxPer = Math.ceil(count / 3) + 2;

  const isClearOfTrack = (x: number, z: number, margin: number) => {
    for (let k = 0; k < trackPoints.length; k++) {
      const tp = trackPoints[k];
      const dx = x - tp.x;
      const dz = z - tp.z;
      const minD = tp.halfWidth + margin;
      if (dx * dx + dz * dz < minD * minD) return false;
    }
    return true;
  };

  for (let i = 0; i < count; i++) {
    const p = trackPoints[Math.floor(rng() * trackPoints.length)];
    const side = rng() < 0.5 ? -1 : 1;
    const dist = p.halfWidth + rrange(rng, 6, 46);
    const x = p.x + p.rx * dist * side + rrange(rng, -6, 6);
    const z = p.z + p.rz * dist * side + rrange(rng, -6, 6);
    const y = p.y - rrange(rng, 0.5, 3);
    const v = Math.floor(rng() * 3);
    if (counts[v] >= maxPer) continue;
    const s = rrange(rng, 0.7, 1.7);
    const rotY = rng() * Math.PI * 2;
    if (!isClearOfTrack(x, z, 3.2)) continue;
    dummy.position.set(x, y + (isDesert ? 1.6 : 2.2) * s, z);
    dummy.rotation.set(0, rotY, 0);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    (variants[v] as THREE.InstancedMesh).setMatrixAt(counts[v]++, dummy.matrix);
  }
  for (let v = 0; v < 3; v++) {
    const im = variants[v] as THREE.InstancedMesh;
    im.count = counts[v];
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = false;
  }

  /* --- glissières et piles de pneus --- */
  const tireGeo = new THREE.TorusGeometry(0.42, 0.17, 6, 10);
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x22222c, roughness: 0.92, metalness: 0.05 });
  disposables.push(tireGeo, tireMat);
  const tireCount = Math.min(240, Math.floor(trackPoints.length * 0.6));
  const tires = new THREE.InstancedMesh(tireGeo, tireMat, tireCount * 3);
  tires.castShadow = q.shadows;
  tires.receiveShadow = false;
  let ti = 0;
  for (let i = 0; i < trackPoints.length && ti < tireCount * 3 - 3; i += 2) {
    const p = trackPoints[i];
    // on garnit surtout l'extérieur des virages
    for (const side of [-1, 1]) {
      const dist = p.halfWidth + 2.6;
      const tx = p.x + p.rx * dist * side;
      const tz = p.z + p.rz * dist * side;
      if (!isClearOfTrack(tx, tz, 1.8)) continue;
      for (let stack = 0; stack < 3; stack++) {
        dummy.position.set(
          tx,
          p.y + 0.18 + stack * 0.3,
          tz,
        );
        dummy.rotation.set(Math.PI / 2, 0, rng() * 3);
        dummy.scale.setScalar(rrange(rng, 0.85, 1.15));
        dummy.updateMatrix();
        tires.setMatrixAt(ti++, dummy.matrix);
      }
    }
  }
  tires.count = ti;
  tires.instanceMatrix.needsUpdate = true;
  group.add(tires);

  /* --- tribunes le long de la ligne droite --- */
  const standMat = new THREE.MeshStandardMaterial({ color: isNight ? 0x2a2a48 : 0xd8dae6, roughness: 0.7, metalness: 0.1 });
  const crowdMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.9 });
  disposables.push(standMat, crowdMat);
  const standGeo = new THREE.BoxGeometry(14, 2.2, 5);
  const roofGeo = new THREE.BoxGeometry(15, 0.35, 6);
  disposables.push(standGeo, roofGeo);
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xf2f4ff, roughness: 0.5, metalness: 0.3 });
  disposables.push(roofMat);

  const crowdGeo = new THREE.BoxGeometry(0.45, 0.7, 0.45);
  disposables.push(crowdGeo);
  const rows = 3;
  const perRow = Math.max(2, Math.round(q.crowdCount / rows));
  const crowdTotal = rows * perRow;
  const crowd = new THREE.InstancedMesh(crowdGeo, crowdMat, Math.max(1, crowdTotal) * 2);
  crowd.castShadow = false;
  const colors = new Float32Array(Math.max(1, crowdTotal) * 2 * 3);
  crowd.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
  group.add(crowd);

  let ci = 0;
  const standSpots = [0.04, 0.5, 0.78, 0.28].slice(0, Math.max(1, q.level === 'low' ? 1 : 3));
  const findClearSideSpot = (startIdx: number, offset: number, clearance: number) => {
    const nPts = trackPoints.length;
    for (let stepOff = 0; stepOff <= 40; stepOff++) {
      for (const dir of stepOff === 0 ? [0] : [1, -1]) {
        const idx = (startIdx + dir * stepOff + nPts) % nPts;
        const p = trackPoints[idx];
        for (const side of [1, -1]) {
          const bx = p.x + p.rx * (p.halfWidth + offset) * side;
          const bz = p.z + p.rz * (p.halfWidth + offset) * side;
          if (
            isClearOfTrack(bx, bz, clearance) &&
            isClearOfTrack(bx + p.tx * 6, bz + p.tz * 6, clearance * 0.8) &&
            isClearOfTrack(bx - p.tx * 6, bz - p.tz * 6, clearance * 0.8)
          ) {
            return { p, side, baseX: bx, baseZ: bz };
          }
        }
      }
    }
    return null;
  };

  for (const frac of standSpots) {
    const startIdx = Math.floor(trackPoints.length * frac) % trackPoints.length;
    const spot = findClearSideSpot(startIdx, 9, 6.2);
    if (!spot) continue;
    const { p, baseX, baseZ } = spot;
    const stand = new THREE.Mesh(standGeo, standMat);
    stand.position.set(baseX, p.y + 1.1, baseZ);
    stand.rotation.y = Math.atan2(p.rx, p.rz);
    stand.castShadow = q.shadows;
    group.add(stand);
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.set(baseX, p.y + 5.2, baseZ);
    roof.rotation.y = Math.atan2(p.rx, p.rz);
    roof.castShadow = q.shadows;
    group.add(roof);

    // foule colorée instanciée au-dessus des gradins
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < perRow; c++) {
        if (ci >= crowd.instanceColor!.count) break;
        dummy.position.set(
          baseX + p.rx * (c - perRow / 2) * 1.1 + p.tx * 0,
          p.y + 2.3 + r * 0.5,
          baseZ + p.rz * (c - perRow / 2) * 1.1,
        );
        dummy.rotation.set(0, Math.random() * 6.28, 0);
        dummy.scale.setScalar(rrange(rng, 0.8, 1.25));
        dummy.updateMatrix();
        crowd.setMatrixAt(ci, dummy.matrix);
        const col = new THREE.Color().setHSL(rng(), 0.7, 0.6);
        crowd.setColorAt(ci, col);
        ci++;
      }
    }
  }
  crowd.count = ci;
  crowd.instanceMatrix.needsUpdate = true;
  if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;

  /* --- portiques de départ / passage --- */
  const gantryMat = new THREE.MeshStandardMaterial({ color: 0x1b2338, roughness: 0.5, metalness: 0.6 });
  disposables.push(gantryMat);
  const pillarGeo = new THREE.BoxGeometry(0.9, 7, 0.9);
  disposables.push(pillarGeo);
  const bannerGeo = new THREE.BoxGeometry(1, 1.1, 0.35);
  const bannerTex = bannerTexture(Math.min(256, q.textureSize), theme.mood === 'night' ? 0x35f5c8 : 0xffe14d, 0x141428);
  const bannerMat = new THREE.MeshStandardMaterial({
    map: bannerTex.albedo,
    emissiveMap: bannerTex.albedo,
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 0.75,
    roughness: 0.4,
    metalness: 0.1,
  });
  disposables.push(bannerGeo, bannerMat);
  for (const frac of [0, 0.25, 0.55, 0.8]) {
    const startIdx = Math.floor(trackPoints.length * frac) % trackPoints.length;
    const nPts = trackPoints.length;
    let chosen: (typeof trackPoints)[number] | null = null;
    for (let stepOff = 0; stepOff <= 45; stepOff++) {
      for (const dir of stepOff === 0 ? [0] : [1, -1]) {
        const idx = (startIdx + dir * stepOff + nPts) % nPts;
        const cand = trackPoints[idx];
        const candPrev = trackPoints[(idx - 2 + nPts) % nPts];
        const candNext = trackPoints[(idx + 2) % nPts];
        // Évite de poser un portique au milieu d'une épingle serrée
        if (stepOff > 0 || frac !== 0) {
          const align = candPrev.tx * candNext.tx + candPrev.tz * candNext.tz;
          if (align < 0.92) continue;
        }
        const candSpan = cand.halfWidth + 2.2;
        const pLeftOk = isClearOfTrack(cand.x - cand.rx * candSpan, cand.z - cand.rz * candSpan, 3.2);
        const pRightOk = isClearOfTrack(cand.x + cand.rx * candSpan, cand.z + cand.rz * candSpan, 3.2);
        if (pLeftOk && pRightOk) {
          chosen = cand;
          break;
        }
      }
      if (chosen) break;
    }
    if (!chosen) continue;
    const p = chosen;
    const gate = new THREE.Group();
    const span = p.halfWidth + 2.2;
    // le portique local est orienté en Z ; on l'aligne sur la normale latérale
    gate.rotation.y = Math.atan2(p.rx, p.rz);
    for (const s of [-1, 1]) {
      const pil = new THREE.Mesh(pillarGeo, gantryMat);
      pil.position.set(0, 3.2, span * s);
      pil.castShadow = q.shadows;
      gate.add(pil);
    }
    const banner = new THREE.Mesh(bannerGeo, bannerMat);
    banner.scale.set(1.2, 1, span * 2.15);
    banner.position.y = 6.4;
    gate.add(banner);
    gate.position.set(p.x, p.y, p.z);
    group.add(gate);
  }

  /* --- éléments d'ambiance propres au thème --- */
  if (isNight) {
    // tours lumineuses + drones
    const towerGeo = new THREE.BoxGeometry(6, 30, 6);
    disposables.push(towerGeo);
    const towerMat = new THREE.MeshStandardMaterial({ color: 0x141428, roughness: 0.6, metalness: 0.4 });
    disposables.push(towerMat);
    const neonGeo = new THREE.BoxGeometry(6.4, 0.5, 6.4);
    disposables.push(neonGeo);
    for (let i = 0; i < Math.max(6, Math.floor(q.treeCount / 12)); i++) {
      const p = trackPoints[Math.floor(rng() * trackPoints.length)];
      const side = rng() < 0.5 ? -1 : 1;
      const dist = p.halfWidth + rrange(rng, 16, 60);
      const h = rrange(rng, 14, 42);
      const tx = p.x + p.rx * dist * side;
      const tz = p.z + p.rz * dist * side;
      if (!isClearOfTrack(tx, tz, 6.5)) continue;
      const g = new THREE.Group();
      const tower = new THREE.Mesh(towerGeo, towerMat);
      tower.scale.y = h / 30;
      tower.position.y = h / 2;
      g.add(tower);
      for (let k = 0; k < 5; k++) {
        const strip = new THREE.Mesh(neonGeo, mats.glow[k % 2 === 0 ? 'teal' : 'pink']);
        strip.scale.set(1, 1, 1);
        strip.position.y = h * (0.18 + k * 0.17);
        g.add(strip);
      }
      g.position.set(tx, p.y - 2, tz);
      group.add(g);
    }
    // drones flottants au-dessus de la piste
    const droneGeo = new THREE.OctahedronGeometry(0.7, 0);
    disposables.push(droneGeo);
    const droneMat = mats.glow.pink;
    for (let i = 0; i < 10; i++) {
      const d = new THREE.Mesh(droneGeo, droneMat);
      const p = trackPoints[Math.floor((i / 10) * trackPoints.length)];
      d.position.set(p.x, p.y + 9 + Math.random() * 5, p.z);
      group.add(d);
      animated.push({ obj: d, kind: 'bob', phase: Math.random() * 6.28, speed: 1 + Math.random() });
    }
  } else if (isDesert) {
    // arches rocheuses
    const archGeo = new THREE.TorusGeometry(9, 3.2, 6, 12, Math.PI);
    disposables.push(archGeo);
    for (let i = 0; i < 7; i++) {
      const p = trackPoints[Math.floor(rng() * trackPoints.length)];
      const side = rng() < 0.5 ? -1 : 1;
      const dist = p.halfWidth + rrange(rng, 12, 40);
      const rotJitter = rng() - 0.5;
      const scale = rrange(rng, 0.8, 1.6);
      const ax = p.x + p.rx * dist * side;
      const az = p.z + p.rz * dist * side;
      if (!isClearOfTrack(ax, az, 12.5 * scale)) continue;
      const arch = new THREE.Mesh(archGeo, rockMat);
      arch.position.set(ax, p.y - 1, az);
      arch.rotation.y = Math.atan2(p.rx, p.rz) + rotJitter;
      arch.scale.setScalar(scale);
      arch.castShadow = q.shadows;
      group.add(arch);
    }
  } else {
    // mer au large + parasols + nuages bas
    const seaGeo = new THREE.CircleGeometry(520, 24);
    disposables.push(seaGeo);
    const seaMat = new THREE.MeshStandardMaterial({
      color: theme.water,
      roughness: 0.12,
      metalness: 0.55,
      transparent: true,
      opacity: 0.92,
    });
    disposables.push(seaMat);
    const sea = new THREE.Mesh(seaGeo, seaMat);
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(0, -6, 0);
    group.add(sea);

    // fanions animés autour des stands
    const flagGeo = new THREE.PlaneGeometry(1.6, 1);
    disposables.push(flagGeo);
    for (let i = 0; i < 16; i++) {
      const p = trackPoints[Math.floor(rng() * trackPoints.length)];
      const side = rng() < 0.5 ? -1 : 1;
      const dist = p.halfWidth + rrange(rng, 5, 16);
      const hue = rng();
      const phase = rng() * 6.28;
      const speed = 2 + rng() * 2;
      const fx = p.x + p.rx * dist * side;
      const fz = p.z + p.rz * dist * side;
      if (!isClearOfTrack(fx, fz, 2.5)) continue;
      const flagMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(hue, 0.8, 0.58),
        side: THREE.DoubleSide,
        roughness: 0.8,
      });
      disposables.push(flagMat);
      const flag = new THREE.Mesh(flagGeo, flagMat);
      flag.position.set(fx, p.y + 3.4, fz);
      group.add(flag);
      animated.push({ obj: flag, kind: 'flag', phase, speed });
    }
  }

  return {
    group,
    animated,
    dispose() {
      for (const d of disposables) d.dispose();
      group.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          const m = (o as THREE.Mesh).material;
          if (Array.isArray(m)) m.forEach((x) => x.dispose());
          else if (m && !disposables.includes(m)) m.dispose();
        }
      });
    },
  };
}
