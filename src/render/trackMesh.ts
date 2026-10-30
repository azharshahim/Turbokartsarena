import { terrainAtProgress, type Terrain } from '../core/terrain';
import { asphaltTexture, terrainTexture } from './textures';
/**
 * Turbo Karts Arena — géométrie de la piste.
 *
 * La route est un ruban extrudé le long de la spline (largeur variable, dévers,
 * dénivelé). Les vibreurs sont des rubans latéraux, les plaques de turbo des
 * quads HDR (luminance > 1 pour déclencher le bloom).
 */

import * as THREE from 'three';
import type { Track } from '../core/track';
import type { MaterialLibrary } from './models';
import type { QualitySettings } from '../core/config';
import { lineTexture } from './textures';

export interface TrackMesh {
  group: THREE.Group;
  /** Matériaux animés (pulsation des plaques de boost). */
  boostMaterials: THREE.MeshStandardMaterial[];
  update(time: number, boostPulse: number): void;
  dispose(): void;
}

export function buildTrackMesh(
  track: Track,
  mats: MaterialLibrary,
  q: QualitySettings,
  theme: { curbColors: [number, number]; id: string },
): TrackMesh {
  const group = new THREE.Group();
  const disposables: Array<THREE.BufferGeometry | THREE.Material> = [];
  const n = track.count;
  const step = track.step;

  // Demi-largeurs visuelles par côté : à l'intérieur d'une épingle très serrée,
  // si la demi-largeur dépasse le rayon géométrique réel de courbure, les rubans
  // extrudés (route, vibreurs, liserés néon) rebroussent chemin et créent un pli.
  const computeSideHalfWidths = (side: -1 | 1) => {
    const caps = new Float64Array(n);
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const p = track.sampleAtIndex(i);
      let innerRadius = Infinity;
      for (const d of [1, 2, 3]) {
        const a = track.sampleAtIndex(i - d);
        const b = track.sampleAtIndex(i + d);
        const ux = p.x - a.x;
        const uz = p.z - a.z;
        const vx = b.x - p.x;
        const vz = b.z - p.z;
        const lu = Math.hypot(ux, uz);
        const lv = Math.hypot(vx, vz);
        if (lu < 1e-4 || lv < 1e-4) continue;
        // > 0 lorsque la courbe tourne vers `side` (côté intérieur du virage)
        const bendToSide = (vx / lv - ux / lu) * (p.rx * side) + (vz / lv - uz / lu) * (p.rz * side);
        if (bendToSide <= 1e-4) continue;
        const cross = Math.abs(ux * vz - uz * vx);
        if (cross > 1e-5) {
          const r = (lu * lv * Math.hypot(b.x - a.x, b.z - a.z)) / (2 * cross);
          if (r < innerRadius) innerRadius = r;
        }
      }
      let oppCap = Infinity;
      for (let j = 0; j < n; j++) {
        const circ = Math.min(Math.abs(j - i), n - Math.abs(j - i));
        if (circ < 6) continue;
        const qSample = track.sampleAtIndex(j);
        if (p.tx * qSample.tx + p.tz * qSample.tz > 0.35) continue;
        const dx = qSample.x - p.x;
        const dz = qSample.z - p.z;
        // Uniquement si l'autre branche se trouve bien du côté `side`
        if (dx * p.rx * side + dz * p.rz * side <= 0) continue;
        const d = Math.hypot(dx, dz);
        const cCap = (d - 3.2) * 0.5;
        if (cCap < oppCap) oppCap = cCap;
      }
      const cap = Math.min(p.halfWidth, Math.max(4.5, Math.min(innerRadius - 1.95, oppCap)));
      caps[i] = cap;
      out[i] = cap;
    }
    for (let pass = 0; pass < 5; pass++) {
      const prev = Float64Array.from(out);
      for (let i = 0; i < n; i++) {
        const avg = (prev[(i - 1 + n) % n] + prev[i] * 2 + prev[(i + 1) % n]) * 0.25;
        out[i] = Math.min(caps[i], avg);
      }
    }
    return out;
  };
  const leftHalfWidths = computeSideHalfWidths(-1);
  const rightHalfWidths = computeSideHalfWidths(1);
  const sideHalfWidthAt = (i: number, side: number) => {
    const idx = ((i % n) + n) % n;
    return side < 0 ? leftHalfWidths[idx] : rightHalfWidths[idx];
  };

  /* ---------------- route ---------------- */
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const vcolors: number[] = [];
  const indices: number[] = [];
  const cols = 5; // subdivision latérale : nécessaire pour le dévers et l'ombrage
  let vAccum = 0;

  for (let i = 0; i <= n; i++) {
    const smp = track.sampleAtIndex(i);
    const prev = track.sampleAtIndex(i - 1);
    const dy = smp.y - prev.y;
    const dist = Math.hypot(step, dy);
    if (i > 0) vAccum += dist / 6; // 1 tuile de texture tous les 6 m
    const lhw = sideHalfWidthAt(i, -1);
    const rhw = sideHalfWidthAt(i, 1);
    for (let c = 0; c < cols; c++) {
      const t = (c / (cols - 1)) * 2 - 1; // -1 … 1
      const lat = t < 0 ? t * lhw : t * rhw;
      const x = smp.x + smp.rx * lat;
      const z = smp.z + smp.rz * lat;
      const y = smp.y + lat * smp.bank;
      positions.push(x, y, z);
      // normale approximative (piste quasi horizontale + dévers)
      const nx = -smp.bank * smp.rx + 0;
      const nz = -smp.bank * smp.rz;
      const len = Math.hypot(nx, 1, nz);
      normals.push(nx / len, 1 / len, nz / len);
      uvs.push((t + 1) * 0.5 * ((lhw + rhw) * 0.5 / 3.4), vAccum);
      // gomme déposée sur la trajectoire de course + bords plus clairs
      const groove = Math.exp(-Math.pow((t - Math.sign(smp.curvature) * 0.35) * 2.6, 2)) * 0.22;
      const edgeLight = 1 + Math.pow(Math.abs(t), 6) * 0.25;
      const k = (0.93 - groove) * edgeLight;
      vcolors.push(k * 0.97, k, k * 1.03);
    }
  }
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = i * cols + c;
      const b = a + 1;
      const d = (i + 1) * cols + c;
      const e = d + 1;
      indices.push(a, b, d, b, e, d);
    }
  }
  const roadGeo = new THREE.BufferGeometry();
  roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  roadGeo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  roadGeo.setAttribute('color', new THREE.Float32BufferAttribute(vcolors, 3));
  roadGeo.setIndex(indices);
  roadGeo.computeBoundingSphere();
  // Contiguous material groups; one shared road geometry, only textures actually
  // used by this circuit are requested from the procedural cache.
  const surfaces: Terrain[] = [];
  const roadMaterials: THREE.MeshStandardMaterial[] = [];
  for (let i = 0; i < n; i++) {
    const surface = terrainAtProgress(theme.id, i / n);
    let slot = surfaces.indexOf(surface);
    if (slot < 0) {
      slot = surfaces.length; surfaces.push(surface);
      const maps = surface === 'asphalt' ? asphaltTexture(q.textureSize, q.anisotropy) : terrainTexture(surface, q.textureSize, q.anisotropy);
      const material = new THREE.MeshStandardMaterial({ map: maps.albedo, normalMap: maps.normal, roughnessMap: maps.roughness, roughness: .9, vertexColors: true });
      material.userData.terrain = surface;
      roadMaterials.push(material); disposables.push(material);
    }
    const last = roadGeo.groups[roadGeo.groups.length - 1];
    const count = (cols - 1) * 6;
    if (last && last.materialIndex === slot) last.count += count;
    else roadGeo.addGroup(i * count, count, slot);
  }
  const road = new THREE.Mesh(roadGeo, roadMaterials);
  road.receiveShadow = q.shadows;
  road.castShadow = false;
  group.add(road);
  disposables.push(roadGeo);

  /* ---------------- vibreurs (rubans latéraux) ---------------- */
  const curbGeos: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const pos: number[] = [];
    const uv: number[] = [];
    const nor: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= n; i++) {
      const smp = track.sampleAtIndex(i);
      const hw = sideHalfWidthAt(i, side);
      for (let c = 0; c < 2; c++) {
        const inner = hw - 0.25;
        const outer = hw + 1.25;
        const lat = (c === 0 ? inner : outer) * side;
        // léger relief : le vibreur est surélevé de 5 cm, biseau côté piste
        const lift = c === 0 ? 0.02 : 0.075;
        pos.push(smp.x + smp.rx * lat, smp.y + lat * smp.bank + lift, smp.z + smp.rz * lat);
        nor.push(0, 1, 0);
        uv.push(c, (i * step) / 1.9);
      }
    }
    for (let i = 0; i < n; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const curbMat = mats.curb;
    const curb = new THREE.Mesh(g, curbMat);
    curb.receiveShadow = q.shadows;
    group.add(curb);
    curbGeos.push(g);
  }
  disposables.push(...curbGeos);

  /* ---------------- lignes de rive ---------------- */
  const lineTex = lineTexture(q.textureSize);
  const lineMat = new THREE.MeshStandardMaterial({
    map: lineTex.albedo,
    color: new THREE.Color(theme.id === 'neon' ? 0xfff3b0 : 0xf5f7ff),
    emissive: new THREE.Color(theme.id === 'neon' ? 0xffe9a0 : 0x000000),
    emissiveIntensity: theme.id === 'neon' ? 0.85 : 0,
    roughness: 0.55,
    metalness: 0.02,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  disposables.push(lineMat);
  for (const side of [-1, 1]) {
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= n; i++) {
      const smp = track.sampleAtIndex(i);
      const hw = sideHalfWidthAt(i, side);
      const inner = hw - 0.62;
      const outer = hw - 0.24;
      for (let c = 0; c < 2; c++) {
        const lat = (c === 0 ? inner : outer) * side;
        pos.push(smp.x + smp.rx * lat, smp.y + lat * smp.bank + 0.03, smp.z + smp.rz * lat);
        uv.push(c, (i * step) / 4);
      }
    }
    for (let i = 0; i < n; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    disposables.push(g);
    const mesh = new THREE.Mesh(g, lineMat);
    mesh.receiveShadow = q.shadows;
    group.add(mesh);
  }

  /* ---------------- plaque de départ (damier) ---------------- */
  const startGeo = checkerBand(track, 0, 6);
  const startMat = new THREE.MeshStandardMaterial({
    map: makeCheckerTexture(q.textureSize),
    roughness: 0.55,
    metalness: 0.05,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });
  disposables.push(startGeo, startMat);
  const startLine = new THREE.Mesh(startGeo, startMat);
  startLine.receiveShadow = q.shadows;
  group.add(startLine);

  /* ---------------- plaques de turbo HDR ---------------- */
  const boostMaterials: THREE.MeshStandardMaterial[] = [];
  for (const zone of track.boostZones) {
    const len = zone.half * 2;
    const w = zone.halfWidth * 2;
    const geo = new THREE.PlaneGeometry(w, len, 1, 4);
    disposables.push(geo);
    const mat = new THREE.MeshStandardMaterial({
      map: makeBoostTexture(q.textureSize, theme.id === 'neon' ? 0x35f5c8 : 0x40c8ff),
      emissiveMap: null,
      emissive: new THREE.Color(theme.id === 'neon' ? 0x35f5c8 : 0x40c8ff),
      emissiveIntensity: 2.2,
      transparent: true,
      opacity: 0.92,
      roughness: 0.25,
      metalness: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    mat.map!.repeat.set(1, len / 3);
    boostMaterials.push(mat);
    disposables.push(mat);
    const pad = new THREE.Mesh(geo, mat);
    const smp = track.sampleAtDistance(zone.s);
    const px = smp.x + smp.rx * zone.lateral;
    const pz = smp.z + smp.rz * zone.lateral;
    pad.position.set(px, smp.y + smp.bank * zone.lateral + 0.05, pz);
    pad.rotation.set(-Math.PI / 2, 0, Math.atan2(smp.tx, smp.tz));
    pad.renderOrder = 2;
    group.add(pad);

    // rail lumineux de chaque côté de la plaque
    for (const s of [-1, 1]) {
      const railGeo = new THREE.BoxGeometry(0.16, 0.06, len);
      disposables.push(railGeo);
      const rail = new THREE.Mesh(railGeo, mats.glow[theme.id === 'neon' ? 'teal' : 'blue']);
      const rl = zone.lateral + s * zone.halfWidth;
      rail.position.set(smp.x + smp.rx * rl, smp.y + smp.bank * rl + 0.06, smp.z + smp.rz * rl);
      rail.rotation.y = Math.atan2(smp.tx, smp.tz);
      group.add(rail);
    }
  }

  /* ---------------- balises lumineuses (thème néon) ---------------- */
  if (theme.id === 'neon') {
    const postGeo = new THREE.BoxGeometry(0.22, 1.5, 0.22);
    disposables.push(postGeo);
    const postMat = new THREE.MeshStandardMaterial({
      color: 0x1a1830,
      emissive: new THREE.Color(0x35f5c8),
      emissiveIntensity: 1.6,
      roughness: 0.4,
      metalness: 0.3,
    });
    disposables.push(postMat);
    const spacing = 22;
    const postCount = Math.floor(track.length / spacing) * 2;
    const posts = new THREE.InstancedMesh(postGeo, postMat, postCount);
    const d2 = new THREE.Object3D();
    let pi = 0;
    for (let i = 0; i < postCount / 2; i++) {
      const smp = track.sampleAtDistance(i * spacing);
      for (const side of [-1, 1]) {
        const lat = (smp.halfWidth + 1.9) * side;
        const px = smp.x + smp.rx * lat;
        const pz = smp.z + smp.rz * lat;
        if (track.query(px, pz, -1, false).surface !== 'grass') continue;
        d2.position.set(px, smp.y + 0.75, pz);
        d2.rotation.set(0, Math.atan2(smp.tx, smp.tz), 0);
        d2.updateMatrix();
        posts.setMatrixAt(pi++, d2.matrix);
      }
    }
    posts.count = pi;
    posts.instanceMatrix.needsUpdate = true;
    group.add(posts);

    // liseré lumineux continu sous les vibreurs
    for (const side of [-1, 1]) {
      const g = new THREE.BufferGeometry();
      const pos2: number[] = [];
      const idx2: number[] = [];
      for (let i = 0; i <= n; i++) {
        const smp = track.sampleAtIndex(i);
        const lat = (sideHalfWidthAt(i, side) + 1.32) * side;
        pos2.push(smp.x + smp.rx * lat, smp.y + 0.06, smp.z + smp.rz * lat);
        pos2.push(smp.x + smp.rx * lat, smp.y + 0.34, smp.z + smp.rz * lat);
      }
      for (let i = 0; i < n; i++) {
        const a = i * 2;
        idx2.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos2, 3));
      g.setIndex(idx2);
      g.computeVertexNormals();
      disposables.push(g);
      const strip = new THREE.Mesh(
        g,
        mats.glow[side < 0 ? 'teal' : 'pink'],
      );
      group.add(strip);
    }
  }

  /* ---------------- murs de sécurité (low-poly) ---------------- */
  const wallGeo = new THREE.BoxGeometry(0.28, 1.1, 3.2);
  disposables.push(wallGeo);
  const wallMat = mats.metal.clone();
  wallMat.color = new THREE.Color(theme.id === 'neon' ? 0x3a3a5e : 0xd7dbe8);
  wallMat.roughness = 0.5;
  disposables.push(wallMat);
  const wallCount = Math.floor((n * step) / 12);
  const walls = new THREE.InstancedMesh(wallGeo, wallMat, wallCount * 2);
  walls.castShadow = q.shadows;
  walls.receiveShadow = q.shadows;
  const dummy = new THREE.Object3D();
  let wi = 0;
  for (let i = 0; i < wallCount; i++) {
    const s = i * 12 + 6;
    const smp = track.sampleAtDistance(s);
    // on ne pose des barrières que dans les zones à risque (virages)
    if (Math.abs(smp.curvature) < 0.008) continue;
    for (const side of [-1, 1]) {
      const lat = (smp.halfWidth + 4.5) * side;
      const wx = smp.x + smp.rx * lat;
      const wz = smp.z + smp.rz * lat;
      if (track.query(wx, wz, -1, false).surface !== 'grass') continue;
      dummy.position.set(wx, smp.y + 0.5, wz);
      dummy.rotation.set(0, Math.atan2(smp.tx, smp.tz), 0);
      dummy.updateMatrix();
      walls.setMatrixAt(wi++, dummy.matrix);
    }
  }
  walls.count = wi;
  walls.instanceMatrix.needsUpdate = true;
  group.add(walls);

  return {
    group,
    boostMaterials,
    update(time: number) {
      const pulse = 1.6 + Math.sin(time * 4) * 0.8;
      for (const m of boostMaterials) {
        m.emissiveIntensity = pulse;
        if (m.map) m.map.offset.y = -time * 1.6;
      }
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

function checkerBand(track: Track, s0: number, width: number) {
  const rows = 2;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let r = 0; r <= rows; r++) {
    const smp = track.sampleAtDistance(s0 - width * 0.5 + (r / rows) * width);
    for (let c = 0; c <= 1; c++) {
      const lat = (c === 0 ? -1 : 1) * smp.halfWidth;
      pos.push(smp.x + smp.rx * lat, smp.y + lat * smp.bank + 0.035, smp.z + smp.rz * lat);
      // damier de 1 m : UV exprimées en mètres / 2 (la texture fait 8 cases)
      uv.push(lat / 8, (r * width) / 8);
    }
  }
  for (let r = 0; r < rows; r++) {
    const a = r * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

let checkerCache: THREE.Texture | null = null;
function makeCheckerTexture(size: number) {
  if (checkerCache) return checkerCache;
  const s = Math.min(256, Math.max(64, size));
  const data = new Uint8Array(s * s * 4);
  const cells = 8;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const on = (Math.floor((x / s) * cells) + Math.floor((y / s) * cells)) % 2 === 0;
      const v = on ? 245 : 18;
      const i = (y * s + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, s, s, THREE.RGBAFormat);
  t.needsUpdate = true;
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  checkerCache = t;
  return t;
}

let boostCache: Map<number, THREE.Texture> = new Map();
function makeBoostTexture(size: number, color: number) {
  const cached = boostCache.get(color);
  if (cached) return cached;
  const s = Math.min(256, Math.max(64, size));
  const data = new Uint8Array(s * s * 4);
  const c = new THREE.Color(color);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const u = x / s;
      const v = y / s;
      // chevrons empilés
      const chev = Math.abs(((v * 4 + Math.abs(u - 0.5) * 1.2) % 1) - 0.5);
      const band = Math.max(0, 1 - chev * 6);
      const edge = Math.min(1, Math.min(u, 1 - u) * 7);
      const a = Math.max(0.12, band) * edge;
      const i = (y * s + x) * 4;
      data[i] = c.r * 255 * (0.35 + band);
      data[i + 1] = c.g * 255 * (0.35 + band);
      data[i + 2] = c.b * 255 * (0.35 + band);
      data[i + 3] = a * 255;
    }
  }
  const t = new THREE.DataTexture(data, s, s, THREE.RGBAFormat);
  t.needsUpdate = true;
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  boostCache.set(color, t);
  return t;
}
