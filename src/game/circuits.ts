/**
 * Turbo Karts Arena — les trois circuits.
 * Tracés dessinés à la main en points de contrôle (unités : mètres).
 */

import type { TrackLayout } from '../core/track';

export interface CircuitTheme {
  id: string;
  name: string;
  /** Couleurs du ciel HDR. */
  skyTop: number;
  skyHorizon: number;
  skySun: number;
  fogColor: number;
  fogDensity: number;
  sunDir: [number, number, number];
  sunColor: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  groundColor: number;
  roadColor: number;
  curbColors: [number, number];
  /** Palettes de la nature (feuillage, roche, eau). */
  foliage: number[];
  rock: number;
  water: number;
  /** Ambiance : 'day' | 'sunset' | 'night' */
  mood: 'day' | 'sunset' | 'night';
  ambientBoost: number;
}

export const THEMES: Record<string, CircuitTheme> = {
  coast: {
    id: 'coast',
    name: 'Côte Solaire',
    skyTop: 0x2f7fd6,
    skyHorizon: 0x8fd0f5,
    skySun: 0xfff4d6,
    fogColor: 0xa8d8f2,
    fogDensity: 0.0014,
    sunDir: [0.45, 0.72, 0.42],
    sunColor: 0xfff2d8,
    sunIntensity: 1.85,
    hemiSky: 0xdcefff,
    hemiGround: 0x9aa88a,
    hemiIntensity: 0.4,
    groundColor: 0x7ab04a,
    roadColor: 0x3b3b44,
    curbColors: [0xff4d5e, 0xf7f7fb],
    foliage: [0x2f8f4e, 0x3fae5c, 0x1f7a44, 0x8fd44e],
    rock: 0x8e8b7a,
    water: 0x1f9bd1,
    mood: 'day',
    ambientBoost: 1,
  },
  desert: {
    id: 'desert',
    name: 'Canyon Écarlate',
    skyTop: 0xf07a3c,
    skyHorizon: 0xffb877,
    skySun: 0xfff0c0,
    fogColor: 0xe8a878,
    fogDensity: 0.0018,
    sunDir: [-0.55, 0.42, 0.52],
    sunColor: 0xffd2a1,
    sunIntensity: 2.1,
    hemiSky: 0xffd0a8,
    hemiGround: 0xb08a70,
    hemiIntensity: 0.5,
    groundColor: 0xd08a4f,
    roadColor: 0x4a3b38,
    curbColors: [0xffc21f, 0x2b2b33],
    foliage: [0x6f8f3a, 0xa8873a, 0x8f5f2f],
    rock: 0xb55a34,
    water: 0x2fa8a0,
    mood: 'sunset',
    ambientBoost: 1.05,
  },
  neon: {
    id: 'neon',
    name: 'Néon Nuit',
    skyTop: 0x080a1f,
    skyHorizon: 0x2a1b52,
    skySun: 0x9d7bff,
    fogColor: 0x241a4a,
    fogDensity: 0.0026,
    sunDir: [0.2, 0.6, -0.8],
    sunColor: 0xa8c0ff,
    sunIntensity: 1.5,
    hemiSky: 0x6a5ac0,
    hemiGround: 0x2a2440,
    hemiIntensity: 0.95,
    groundColor: 0x3a3654,
    roadColor: 0x3a3a4c,
    curbColors: [0x35f5c8, 0xd946ef],
    foliage: [0x1f7a6a, 0x2a2a6a, 0x6a2a7a],
    rock: 0x2b2b3d,
    water: 0x1a4bd1,
    mood: 'night',
    ambientBoost: 2.2,
  },
};

export interface Circuit extends TrackLayout {
  themeId: keyof typeof THEMES;
  subtitle: string;
}

export const CIRCUITS: Circuit[] = [
  {
    id: 'coast',
    themeId: 'coast',
    name: 'Côte Solaire',
    subtitle: 'Littoral · virages fluides',
    theme: 'coast',
    seed: 1337,
    width: 17,
    widthVariance: 5.5,
    widthScale: 1.25,
    maxCurvature: 0.05,
    grandstands: 3,
    boosts: [
      [0.11, 0.0, 14],
      [0.36, 0.3, 12],
      [0.62, -0.25, 14],
      [0.86, 0.1, 12],
    ],
    control: [
      { x: 0, y: 0, z: 0 },
      { x: 70, y: 0, z: -12 },
      { x: 132, y: 2, z: 18 },
      { x: 168, y: 6, z: 78 },
      { x: 150, y: 9, z: 138 },
      { x: 92, y: 8, z: 168 },
      { x: 40, y: 3, z: 148 },
      { x: 30, y: 0, z: 96 },
      { x: 6, y: 0, z: 92 },
      { x: -18, y: 2, z: 138 },
      { x: -74, y: 6, z: 160 },
      { x: -136, y: 7, z: 128 },
      { x: -166, y: 4, z: 62 },
      { x: -150, y: 1, z: -6 },
      { x: -96, y: 0, z: -34 },
      { x: -40, y: 0, z: -26 },
    ],
  },
  {
    id: 'desert',
    themeId: 'desert',
    name: 'Canyon Écarlate',
    subtitle: 'Désert · épingles et dévers',
    theme: 'desert',
    seed: 90210,
    width: 15.5,
    widthVariance: 6.5,
    widthScale: 1.25,
    maxCurvature: 0.048,
    grandstands: 2,
    boosts: [
      [0.08, -0.2, 12],
      [0.28, 0.25, 16],
      [0.47, 0.0, 14],
      [0.7, -0.3, 12],
      [0.9, 0.2, 14],
    ],
    control: [
      { x: 0, y: 0, z: 0 },
      { x: 58, y: 1, z: 20 },
      { x: 96, y: 4, z: 66 },
      { x: 78, y: 8, z: 112 },
      { x: 26, y: 12, z: 126 },
      { x: -22, y: 14, z: 106 },
      { x: -30, y: 16, z: 58 },
      { x: -74, y: 18, z: 28 },
      { x: -104, y: 16, z: 34 },
      { x: -140, y: 12, z: 84 },
      { x: -122, y: 8, z: 138 },
      { x: -68, y: 6, z: 166 },
      { x: -150, y: 4, z: 186 },
      { x: -196, y: 2, z: 132 },
      { x: -184, y: 1, z: 52 },
      { x: -96, y: 0, z: -12 },
      { x: -40, y: 0, z: -18 },
    ],
  },
  {
    id: 'neon',
    themeId: 'neon',
    name: 'Néon Nuit',
    subtitle: 'Urbain · nuit électrique',
    theme: 'neon',
    seed: 424242,
    width: 18,
    widthVariance: 4.5,
    widthScale: 1.25,
    maxCurvature: 0.052,
    grandstands: 4,
    boosts: [
      [0.06, 0.0, 16],
      [0.22, 0.28, 12],
      [0.4, -0.3, 14],
      [0.56, 0.0, 16],
      [0.74, 0.32, 12],
      [0.92, -0.2, 14],
    ],
    control: [
      { x: 0, y: 0, z: 0 },
      { x: 84, y: 0, z: -6 },
      { x: 150, y: 1, z: 34 },
      { x: 176, y: 2, z: 96 },
      { x: 140, y: 2, z: 148 },
      { x: 172, y: 1, z: 200 },
      { x: 108, y: 0, z: 216 },
      { x: 44, y: 0, z: 186 },
      { x: 12, y: 1, z: 130 },
      { x: -34, y: 2, z: 150 },
      { x: -96, y: 3, z: 190 },
      { x: -160, y: 4, z: 154 },
      { x: -184, y: 3, z: 92 },
      { x: -150, y: 1, z: 30 },
      { x: -96, y: 0, z: -10 },
      { x: -44, y: 0, z: -14 },
    ],
  },
];

export function circuitById(id: string) {
  return CIRCUITS.find((c) => c.id === id) ?? CIRCUITS[0];
}
