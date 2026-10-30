/**
 * Turbo Karts Arena — textures procédurales (albedo + normal + roughness).
 *
 * Pourquoi procédural : un dépôt 100 % autonome, des textures tuilables sans
 * artefacts de raccord, et un budget mémoire maîtrisé sur mobile. Les textures
 * sont générées au chargement à la résolution du palier de qualité (256 / 512 /
 * 1024) puis compressées en ASTC côté natif par le pipeline de build.
 *
 * Aucune dépendance au DOM : on écrit dans un Uint8Array, ce qui fonctionne
 * aussi bien sous Hermes (Android) que dans le navigateur.
 */

import * as THREE from 'three';
import type { Terrain } from '../core/terrain';
import { fbm2D, valueNoise2D, clamp01, lerp } from '../core/math';

export interface TextureSet {
  albedo: THREE.Texture;
  normal: THREE.Texture;
  roughness: THREE.Texture;
  dispose(): void;
}

const cache = new Map<string, TextureSet>();

function dataTexture(data: Uint8Array, size: number, srgb: boolean, aniso: number) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/**
 * Fabrique générique : `shade(u, v)` renvoie l'albedo, la pente de hauteur (pour
 * la normal-map dérivée) et la rugosité. `(u, v)` sont en unités de motif.
 */
function buildTexture(
  key: string,
  size: number,
  aniso: number,
  shade: (u: number, v: number) => { r: number; g: number; b: number; h: number; rough: number },
): TextureSet {
  const cached = cache.get(`${key}:${size}`);
  if (cached) return cached;

  const albedo = new Uint8Array(size * size * 4);
  const normal = new Uint8Array(size * size * 4);
  const rough = new Uint8Array(size * size * 4);
  const height = new Float32Array(size * size);

  // 1) albedo + hauteur + rugosité
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = x / size;
      const v = y / size;
      const s = shade(u, v);
      const o = i * 4;
      albedo[o] = clamp01(s.r) * 255;
      albedo[o + 1] = clamp01(s.g) * 255;
      albedo[o + 2] = clamp01(s.b) * 255;
      albedo[o + 3] = 255;
      height[i] = s.h;
      const r = clamp01(s.rough) * 255;
      rough[o] = r;
      rough[o + 1] = r;
      rough[o + 2] = r;
      rough[o + 3] = 255;
    }
  }

  // 2) normal map dérivée de la hauteur (différences finies, bords tuilables)
  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  const strength = size / 512;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx;
      let ny = -dy;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      const o = (y * size + x) * 4;
      normal[o] = (nx * 0.5 + 0.5) * 255;
      normal[o + 1] = (ny * 0.5 + 0.5) * 255;
      normal[o + 2] = (nz * 0.5 + 0.5) * 255;
      normal[o + 3] = 255;
    }
  }

  const set: TextureSet = {
    albedo: dataTexture(albedo, size, true, aniso),
    normal: dataTexture(normal, size, false, aniso),
    roughness: dataTexture(rough, size, false, aniso),
    dispose() {
      set.albedo.dispose();
      set.normal.dispose();
      set.roughness.dispose();
    },
  };
  cache.set(`${key}:${size}`, set);
  return set;
}

/* ------------------------------------------------------------------ */
/* Motifs                                                             */
/* ------------------------------------------------------------------ */

/** Enrobé : agrégats + micro-rayures + traces de gomme. */
export function asphaltTexture(size: number, aniso: number, tint = 0.31) {
  return buildTexture('asphalt', size, aniso, (u, v) => {
    const grain = fbm2D(u * 96, v * 96, 96, 3, 11);
    const speck = valueNoise2D(u * 220, v * 220, 220, 7);
    const macro = fbm2D(u * 6, v * 6, 6, 3, 31);
    let c = tint + (grain - 0.5) * 0.19 + (speck > 0.93 ? 0.16 : 0) + (macro - 0.5) * 0.06;
    const h = grain * 0.6 + speck * 0.25 + macro * 0.15;
    return { r: c * 0.98, g: c, b: c * 1.06, h, rough: 0.86 + (1 - speck) * 0.12 };
  });
}

/** Road surfaces with distinct grain, ruts and height-derived normal maps. */
export function terrainTexture(kind: Exclude<Terrain, 'asphalt'>, size: number, aniso: number) {
  const palette: Record<Exclude<Terrain, 'asphalt'>, [number, number, number]> = {
    dirt: [0.49, 0.30, 0.17], sand: [0.82, 0.63, 0.39],
    gravel: [0.48, 0.43, 0.37], snow: [0.83, 0.90, 0.95], volcanic: [0.20, 0.18, 0.18],
  };
  return buildTexture(`road-${kind}`, size, aniso, (u, v) => {
    const grain = fbm2D(u * 100, v * 100, 100, 3, 13);
    const stones = valueNoise2D(u * 54, v * 54, 54, 19);
    const ripple = Math.sin((v * 18 + fbm2D(u * 4, v * 4, 4, 2, 3)) * Math.PI * 2);
    // Two pairs of compacted wheel tracks, repeated across the road.
    const rut = Math.max(0, 1 - Math.abs(Math.sin(u * Math.PI * 4)) * 9);
    const stone = (kind === 'gravel' || kind === 'volcanic') ? Math.max(0, stones - 0.53) : 0;
    const relief = kind === 'sand' ? ripple * 0.12 : stone * 0.5;
    const k = 0.84 + grain * 0.3 + relief - rut * 0.14;
    const c = palette[kind];
    return { r: c[0] * k, g: c[1] * k, b: c[2] * k,
      h: grain * 0.35 + relief - rut * 0.25, rough: kind === 'snow' ? 0.75 : 0.96 };
  });
}

/** Herbe dense (teintes multiples + zones sèches). */
export function grassTexture(size: number, aniso: number, base = [0.32, 0.62, 0.24]) {
  return buildTexture('grass', size, aniso, (u, v) => {
    const blades = fbm2D(u * 70, v * 70, 70, 4, 5);
    const patch = fbm2D(u * 5, v * 5, 5, 3, 77);
    const dry = fbm2D(u * 2.5, v * 2.5, 3, 2, 91);
    const b = 0.72 + (blades - 0.5) * 0.55;
    const dryK = Math.max(0, dry - 0.52) * 1.7;
    const r = lerp(base[0] * b, 0.62, dryK);
    const g = lerp(base[1] * b, 0.58, dryK);
    const bl = lerp(base[2] * b, 0.3, dryK);
    const shade = 0.86 + patch * 0.28;
    return { r: r * shade, g: g * shade, b: bl * shade, h: blades, rough: 0.95 };
  });
}

/** Sable de circuit désertique / sol latérite. */
export function sandTexture(size: number, aniso: number, base = [0.82, 0.62, 0.36]) {
  return buildTexture('sand', size, aniso, (u, v) => {
    const ripple = Math.sin((u * 22 + fbm2D(u * 8, v * 8, 8, 2, 3) * 3) * Math.PI * 2);
    const grain = fbm2D(u * 140, v * 140, 140, 3, 13);
    const k = 0.88 + ripple * 0.06 + (grain - 0.5) * 0.22;
    return {
      r: base[0] * k,
      g: base[1] * k,
      b: base[2] * k,
      h: grain * 0.5 + ripple * 0.5,
      rough: 0.92,
    };
  });
}

/** Béton de la ville néon (joints + plaques). */
export function concreteTexture(size: number, aniso: number, base = [0.16, 0.17, 0.22]) {
  return buildTexture('concrete', size, aniso, (u, v) => {
    const grain = fbm2D(u * 110, v * 110, 110, 3, 21);
    const seam = Math.abs(((u * 4) % 1) - 0.5) < 0.02 || Math.abs(((v * 4) % 1) - 0.5) < 0.02 ? 1 : 0;
    const c = base[0] * (0.85 + grain * 0.4 - seam * 0.25);
    return { r: c, g: base[1] * (0.85 + grain * 0.4 - seam * 0.25), b: base[2] * (0.85 + grain * 0.4 - seam * 0.25), h: grain - seam * 0.6, rough: 0.72 + seam * 0.2 };
  });
}

/** Carrosserie de kart : peinture métallisée à paillettes. */
export function bodyPaintTexture(size: number, aniso: number) {
  return buildTexture('paint', size, aniso, (u, v) => {
    const flake = valueNoise2D(u * 300, v * 300, 300, 3);
    const wav = fbm2D(u * 7, v * 7, 7, 2, 9);
    const c = 0.94 + (flake - 0.5) * 0.05 + (wav - 0.5) * 0.03;
    return { r: c, g: c, b: c, h: flake * 0.2, rough: 0.24 + (1 - flake) * 0.1 };
  });
}

/** Damier des vibreurs : deux couleurs réelles alternées (rouge/blanc, jaune/noir…). */
export function curbTexture(size: number, aniso: number, colorA = 0xff4d5e, colorB = 0xf7f7fb) {
  const ca = new THREE.Color(colorA);
  const cb = new THREE.Color(colorB);
  return buildTexture(`curb:${colorA}:${colorB}`, size, aniso, (u, v) => {
    const stripe = Math.floor(u * 10) % 2 === 0;
    const wear = fbm2D(u * 40, v * 40, 40, 3, 33);
    const k = 0.82 + wear * 0.3;
    const c = stripe ? ca : cb;
    return { r: c.r * k, g: c.g * k, b: c.b * k, h: 0.5 + wear * 0.25, rough: 0.48 + (1 - wear) * 0.25 };
  });
}

/** Métal brossé (armature, échappements). */
export function metalTexture(size: number, aniso: number) {
  return buildTexture('metal', size, aniso, (u, v) => {
    const brush = fbm2D(u * 200, v * 6, 200, 3, 51);
    const c = 0.55 + (brush - 0.5) * 0.25;
    return { r: c, g: c * 1.02, b: c * 1.08, h: brush * 0.4, rough: 0.34 + (1 - brush) * 0.2 };
  });
}

/** Halo radial doux (particules, glow). */
export function glowTexture(size: number) {
  return buildTexture('glow', size, 1, (u, v) => {
    const dx = u - 0.5;
    const dy = v - 0.5;
    const d = Math.min(1, Math.hypot(dx, dy) * 2);
    const k = Math.pow(1 - d, 2.2);
    return { r: k, g: k, b: k, h: 0, rough: 1 };
  });
}

/** Fumée : bruit doux avec alpha dans le canal rouge (utilisé en Points). */
export function smokeTexture(size: number) {
  return buildTexture('smoke', size, 1, (u, v) => {
    const n = fbm2D(u * 8, v * 8, 8, 4, 17);
    const dx = u - 0.5;
    const dy = v - 0.5;
    const d = Math.min(1, Math.hypot(dx, dy) * 2);
    const k = Math.pow(1 - d, 1.6) * (0.55 + n * 0.75);
    return { r: k, g: k, b: k, h: n, rough: 1 };
  });
}

export function clearTextureCache() {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}

/**
 * Marquages routiers : lignes de rive continues et bande damier d'arrivée.
 * Générés en alpha (blanc + alpha) pour être posés en surimpression sur l'asphalte.
 */
export function lineTexture(size: number) {
  return buildTexture('line', size, 1, (u, v) => {
    const wear = fbm2D(u * 50, v * 50, 50, 3, 71);
    const k = 0.8 + wear * 0.25;
    return { r: k, g: k, b: k * 0.98, h: 0.5, rough: 0.55 };
  });
}

/** Bannière des portiques : chevrons + bandes, lisible de loin. */
export function bannerTexture(size: number, base = 0xffe14d, ink = 0x1b1030) {
  const cb = new THREE.Color(base);
  const ci = new THREE.Color(ink);
  return buildTexture(`banner:${base}:${ink}`, size, 4, (u, v) => {
    const chev = Math.abs(((u * 3 + Math.abs(v - 0.5) * 0.6) % 1) - 0.5);
    const isInk = chev < 0.16 || v < 0.12 || v > 0.88;
    const c = isInk ? ci : cb;
    return { r: c.r, g: c.g, b: c.b, h: 0.5, rough: 0.45 };
  });
}
