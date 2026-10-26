/**
 * Turbo Karts Arena — utilitaires mathématiques (déterministes, zéro allocation)
 * Aucune dépendance : ce module tourne aussi bien sur Hermes (Android) que sur V8 (web).
 */

export const TAU = Math.PI * 2;

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number) => (b === a ? 0 : (v - a) / (b - a));

/** Interpolation indépendante du framerate : t = 1 - e^(-k·dt) */
export const damp = (a: number, b: number, k: number, dt: number) =>
  lerp(a, b, 1 - Math.exp(-k * dt));

/** Rampe linéaire avec easing "smoothstep" pour le feeling arcade. */
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01(invLerp(a, b, v));
  return t * t * (3 - 2 * t);
};

/** Rapproche un angle de sa cible en tenant compte du modulo 2π. */
export function angleDelta(from: number, to: number) {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function dampAngle(from: number, to: number, k: number, dt: number) {
  return from + angleDelta(from, to) * (1 - Math.exp(-k * dt));
}

/** Générateur pseudo-aléatoire déterministe (mulberry32) — même piste sur tous les appareils. */
export function makeRng(seed: number) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rand = () => number;
export const rrange = (rng: Rand, a: number, b: number) => a + (b - a) * rng();

/* ---------- bruit de valeur 2D (pour les textures procédurales) ---------- */

function hash2(x: number, y: number, seed: number) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Bruit de valeur bilinéaire adouci, période `p` (tileable). */
export function valueNoise2D(x: number, y: number, period: number, seed: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const x0 = ((xi % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y0 = ((yi % period) + period) % period;
  const y1 = (y0 + 1) % period;
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

/** FBM tileable : `octaves` couches de bruit de fréquence croissante. */
export function fbm2D(x: number, y: number, period: number, octaves: number, seed: number) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let p = period;
  let fx = x;
  let fy = y;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2D(fx, fy, p, seed + i * 977);
    norm += amp;
    amp *= 0.5;
    p *= 2;
    fx *= 2;
    fy *= 2;
  }
  return sum / norm;
}
