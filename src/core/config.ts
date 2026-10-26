/**
 * Réglages de gameplay — tout le "feeling" arcade est centralisé ici.
 * Unités : mètres, secondes, radians.
 */

export const PHYSICS = {
  /** Pas fixe de simulation (120 Hz) : indispensable pour une physique stable à 60 FPS. */
  fixedStep: 1 / 120,
  maxStepsPerFrame: 8,
  gravity: 26,

  kart: {
    radius: 1.15,
    mass: 1,
    /** Vitesse max de référence (m/s) — ~162 km/h affiché. */
    maxSpeed: 42,
    reverseMaxSpeed: 11,
    /** Accélération "auto" : force à bas régime, s'affaiblit vers Vmax. */
    accel: 16,
    accelFalloff: 0.9,
    brakeDecel: 48,
    engineBrake: 7.5,
    rollingResistance: 0.6,
    dragCoef: 0.00042,
    /** Adhérence latérale : plus haut = plus "collant". */
    gripRoad: 9.2,
    gripDrift: 2.35,
    gripDirt: 5.2,
    /** Vitesse de rotation max en virage (rad/s). */
    turnRate: 2.35,
    turnRateDrift: 3.15,
    turnLowSpeed: 0.45,
    /** Angle visuel de dérive (le kart "regarde" dans le virage). */
    driftSlipVisual: 0.42,
    driftEnterSpeed: 13,
    /** Vitesse minimale pour "coller" le kart à la route (évite les tête-à-queue). */
    minMoveSpeed: 0.6,
  },

  /** 3 paliers de turbo — bleu / orange / violet. */
  drift: {
    enterSteerThreshold: 0.22,
    chargeRateBase: 0.78,
    chargeRateSteer: 0.75,
    chargeRateSpeedBonus: 0.5,
    chargeMax: 3.0,
    /** Seuils de déclenchement des paliers. */
    tiers: [0, 0.62, 1.35, 2.15] as const,
    /** Durée du boost par palier (s). */
    boostDuration: [0, 0.8, 1.3, 1.9] as const,
    /** Multiplicateur de vitesse max pendant le boost. */
    boostMult: [1, 1.2, 1.29, 1.4] as const,
    boostAccel: [0, 22, 30, 38] as const,
    /** Un boost fraîchement déclenché ne se cumule pas : il prolonge. */
    stackFactor: 0.85,
  },

  ai: {
    lookAheadBase: 12,
    lookAheadSpeed: 0.42,
    steerGain: 2.6,
    /** Écart de vitesse pour rester dans le rétro du joueur (équilibrage). */
    catchupRange: 55,
    catchupBoost: 0.1,
    catchupPenalty: 0.12,
    driftSkill: [0.35, 0.95] as const,
  },

  race: {
    laps: 3,
    countdown: 3.2,
    /** Temps accordé après l'arrivée pour finir le tour. */
    resultsDelay: 1.4,
  },
} as const;

export type QualityLevel = 'low' | 'high' | 'ultra';

export interface QualitySettings {
  level: QualityLevel;
  /** Résolution de rendu max (px). 0 = native. */
  maxPixels: number;
  pixelRatioCap: number;
  shadows: boolean;
  shadowMapSize: number;
  textureSize: number;
  anisotropy: number;
  bloom: boolean;
  bloomStrength: number;
  motionBlur: boolean;
  chromatic: boolean;
  speedLines: boolean;
  particleBudget: number;
  crowdCount: number;
  treeCount: number;
  drawDistance: number;
  antialias: 'none' | 'msaa' | 'fxaa';
  radialSegments: number;
}

export const QUALITY: Record<QualityLevel, QualitySettings> = {
  low: {
    level: 'low',
    maxPixels: 1280 * 620,
    pixelRatioCap: 1,
    shadows: false,
    shadowMapSize: 512,
    textureSize: 256,
    anisotropy: 2,
    bloom: false,
    bloomStrength: 0,
    motionBlur: false,
    chromatic: false,
    speedLines: true,
    particleBudget: 180,
    crowdCount: 0,
    treeCount: 60,
    drawDistance: 260,
    antialias: 'none',
    radialSegments: 10,
  },
  high: {
    level: 'high',
    maxPixels: 1920 * 900,
    pixelRatioCap: 2,
    shadows: true,
    shadowMapSize: 1024,
    textureSize: 512,
    anisotropy: 4,
    bloom: true,
    bloomStrength: 0.55,
    motionBlur: true,
    chromatic: true,
    speedLines: true,
    particleBudget: 900,
    crowdCount: 14,
    treeCount: 220,
    drawDistance: 420,
    antialias: 'fxaa',
    radialSegments: 16,
  },
  ultra: {
    level: 'ultra',
    maxPixels: 2560 * 1200,
    pixelRatioCap: 3,
    shadows: true,
    shadowMapSize: 2048,
    textureSize: 1024,
    anisotropy: 8,
    bloom: true,
    bloomStrength: 0.8,
    motionBlur: true,
    chromatic: true,
    speedLines: true,
    particleBudget: 2200,
    crowdCount: 26,
    treeCount: 420,
    drawDistance: 600,
    antialias: 'fxaa',
    radialSegments: 24,
  },
};

/** Détection automatique de l'appareil → niveau de qualité de départ. */
export function autoQuality(input: {
  totalMemoryGB?: number;
  logicalCores?: number;
  gpuRenderer?: string;
  isNative: boolean;
  deviceYearClass?: number;
}): QualityLevel {
  const { totalMemoryGB = 0, logicalCores = 0, gpuRenderer = '', isNative } = input;
  const r = gpuRenderer.toLowerCase();
  const weakGpu = /mali-4|mali-t7|mali-g3|adreno \(tm\) [34]|powervr sgx|powervr rogue ge8/.test(r);
  const strongGpu = /apple a1[4-9]|apple m[1-9]|adreno \(tm\) 7[0-9]|adreno \(tm\) 6[5-9]|mali-g[7-9][0-9]|immortalis|xclipse/.test(
    r,
  );
  if (weakGpu || totalMemoryGB <= 2.5 || (logicalCores > 0 && logicalCores <= 4 && totalMemoryGB < 6)) {
    return 'low';
  }
  if (strongGpu || (isNative && totalMemoryGB >= 7 && logicalCores >= 8)) return 'ultra';
  if (totalMemoryGB >= 4 || logicalCores >= 6) return 'high';
  return isNative ? 'high' : 'low';
}
