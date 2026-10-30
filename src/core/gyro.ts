/**
 * Turbo Karts Arena — direction par inclinaison (gyroscope / accéléromètre), V4.1.
 *
 * Pourquoi ce module existe : l'ancienne implémentation projetait la **vitesse
 * angulaire** du gyroscope (`atan2(z, 9.81)`) sur un angle de braquage. Or un
 * gyroscope ne mesure pas l'inclinaison : il mesure une rotation. Résultat sur
 * téléphone : la direction dérivait, ne revenait pas au centre et ne répondait
 * pas quand l'appareil était immobile. Impossible d'en déduire un volant fiable.
 *
 * Principe retenu (identique Android/web) : on part de l'**orientation** de
 * l'appareil (beta/gamma, issus de l'accéléromètre fusionné), on reconstruit le
 * vecteur gravité dans le référentiel de l'appareil, puis on projette ce vecteur
 * dans le référentiel de l'écran en tenant compte de l'angle d'orientation.
 * L'angle obtenu est « l'inclinaison du volant » : indépendant du sens de
 * rotation du téléphone (paysage gauche / paysage droit / portrait).
 *
 * Robustesse :
 *  - zone morte réglable (évite le tremblement du pouce) ;
 *  - filtrage passe-bas dépendant du temps (indépendant du framerate) ;
 *  - limitation de la vitesse de variation (pas de coup de volant involontaire) ;
 *  - détection automatique du demi-tour de référentiel (convention navigateur) ;
 *  - téléphone à plat ⇒ 0 (aucune oscillation possible) ;
 *  - module pur ⇒ testé sous Node, sans capteur.
 */

import { clamp, damp } from './math';
import type { GyroSensitivity } from './controlSettings';

export type ScreenAngle = 0 | 90 | 180 | 270;

export interface GyroPreset {
  /** Zone morte en degrés : en dessous, la direction reste au centre. */
  deadzone: number;
  /** Inclinaison (degrés) donnant le braquage maximal. */
  range: number;
  /** Constante de lissage (1/s) : plus haut = plus nerveux. */
  smoothing: number;
  /** Variation maximale du braquage par seconde (anti-coup de volant). */
  maxRate: number;
}

export const GYRO_PRESETS: Record<GyroSensitivity, GyroPreset> = {
  soft: { deadzone: 4.5, range: 32, smoothing: 9, maxRate: 2.2 },
  normal: { deadzone: 3, range: 21, smoothing: 15, maxRate: 4.2 },
  sport: { deadzone: 2, range: 13, smoothing: 22, maxRate: 7 },
};

/** Durée sans échantillon au-delà de laquelle le capteur est considéré muet. */
export const GYRO_SIGNAL_TIMEOUT_MS = 1200;
/** En dessous de cette composante dans le plan de l'écran, on considère le téléphone à plat. */
export const FLAT_PHONE_THRESHOLD = 0.15;

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/** Angle d'écran normalisé (les navigateurs renvoient parfois -90). */
export function normalizeScreenAngle(angle: number): ScreenAngle {
  if (!Number.isFinite(angle)) return 0;
  const a = ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
  return (a === 90 || a === 180 || a === 270 ? a : 0) as ScreenAngle;
}

/**
 * Vecteur gravité (unitaire, vers le bas) exprimé dans le référentiel appareil
 * (x = droite, y = haut de l'écran, z = sortie de l'écran).
 * Formule issue de la composition Rz(α)·Rx(β)·Ry(γ) de DeviceOrientation ;
 * α (boussole) n'intervient pas : la gravité est verticale, donc insensible au lacet.
 */
export function gravityInDeviceFrame(betaDeg: number, gammaDeg: number): { x: number; y: number; z: number } {
  const b = betaDeg * DEG;
  const g = gammaDeg * DEG;
  const cb = Math.cos(b);
  const sb = Math.sin(b);
  const cg = Math.cos(g);
  const sg = Math.sin(g);
  return { x: sg * cb, y: -sb, z: -cg * cb };
}

interface Axis {
  x: number;
  y: number;
  z: number;
}

/** Axes « droite » et « haut » de l'écran exprimés dans le référentiel appareil. */
export function screenAxes(angle: ScreenAngle): { right: Axis; up: Axis } {
  switch (angle) {
    case 90:
      return { right: { x: 0, y: -1, z: 0 }, up: { x: 1, y: 0, z: 0 } };
    case 180:
      return { right: { x: -1, y: 0, z: 0 }, up: { x: 0, y: -1, z: 0 } };
    case 270:
      return { right: { x: 0, y: 1, z: 0 }, up: { x: -1, y: 0, z: 0 } };
    default:
      return { right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } };
  }
}

/**
 * Inclinaison « volant » en degrés : 0 = position neutre, > 0 = le côté droit de
 * l'écran descend (virage à droite), < 0 = l'inverse. Le signe est identique en
 * portrait et dans les deux paysages : la correction de demi-tour ci-dessous
 * rend le résultat insensible à la convention du navigateur.
 */
export function tiltDegrees(betaDeg: number, gammaDeg: number, screenAngle: ScreenAngle = 0): number {
  if (!Number.isFinite(betaDeg) || !Number.isFinite(gammaDeg)) return 0;
  const g = gravityInDeviceFrame(betaDeg, gammaDeg);
  const { right, up } = screenAxes(normalizeScreenAngle(screenAngle));
  let gr = g.x * right.x + g.y * right.y + g.z * right.z;
  let gu = g.x * up.x + g.y * up.y + g.z * up.z;

  // Téléphone tenu écran vers soi : la gravité descend le long de l'écran (gu < 0).
  // Si c'est l'inverse, le référentiel est retourné de 180° (convention d'angle
  // différente selon le navigateur / le capteur) : on le remet d'aplomb.
  if (gu > 0.02) {
    gr = -gr;
    gu = -gu;
  }
  // Téléphone posé à plat : plus d'axe de gravité dans le plan de l'écran.
  if (Math.hypot(gr, gu) < FLAT_PHONE_THRESHOLD) return 0;
  return Math.atan2(gr, -gu) * RAD;
}

/**
 * Convertisseur inclinaison → braquage, avec zone morte, lissage et limitation
 * de vitesse. Instancié une seule fois par hôte (web / natif).
 */
export class TiltSteering {
  sensitivity: GyroSensitivity = 'normal';
  invertTilt = false;

  /** Calibration : inclinaison considérée comme « volant droit ». */
  private rest = 0;
  private smoothed = 0;
  private value = 0;
  private lastSampleAt = Number.NEGATIVE_INFINITY;
  private samples = 0;
  private started = false;

  get preset(): GyroPreset {
    return GYRO_PRESETS[this.sensitivity] ?? GYRO_PRESETS.normal;
  }

  /** Position neutre mémorisée, en degrés. */
  get calibration(): number {
    return this.rest;
  }

  /** Inclinaison lissée, corrigée de la calibration (degrés). */
  get tilt(): number {
    return this.smoothed - this.rest;
  }

  get steer(): number {
    return this.value;
  }

  get ready(): boolean {
    return this.samples > 0;
  }

  get sampleCount(): number {
    return this.samples;
  }

  setCalibration(degrees: number): void {
    if (!Number.isFinite(degrees)) return;
    this.rest = clamp(degrees, -35, 35);
  }

  /** Définit la position neutre à partir de l'inclinaison actuelle. */
  calibrate(): number {
    this.rest = clamp(this.started ? this.smoothed : 0, -35, 35);
    return this.rest;
  }

  /** Remet la direction au centre sans perdre la calibration (pause, changement d'écran). */
  reset(): void {
    this.value = 0;
    this.smoothed = this.started ? this.smoothed : 0;
  }

  /**
   * Nouvel échantillon d'orientation.
   * @returns braquage borné [-1..1] (positif = droite, convention écran).
   */
  push(betaDeg: number, gammaDeg: number, screenAngle: number, dtSeconds: number, nowMs?: number): number {
    if (!Number.isFinite(betaDeg) || !Number.isFinite(gammaDeg)) return this.value;
    const now = typeof nowMs === 'number' && Number.isFinite(nowMs) ? nowMs : Date.now();
    const dt = clamp(Number.isFinite(dtSeconds) ? dtSeconds : 1 / 60, 1 / 240, 0.1);
    const tilt = tiltDegrees(betaDeg, gammaDeg, normalizeScreenAngle(screenAngle));

    if (!this.started) {
      // Premier échantillon : on s'aligne sans à-coup.
      this.started = true;
      this.smoothed = tilt;
    } else {
      this.smoothed = damp(this.smoothed, tilt, this.preset.smoothing, dt);
    }
    this.lastSampleAt = now;
    this.samples += 1;

    const raw = this.steerFromTilt((this.smoothed - this.rest) * (this.invertTilt ? -1 : 1));
    const maxStep = this.preset.maxRate * dt;
    this.value = clamp(raw, this.value - maxStep, this.value + maxStep);
    return this.value;
  }

  /** Convertit une inclinaison (degrés, signe déjà corrigé) en braquage [-1..1]. */
  steerFromTilt(degrees: number): number {
    const { deadzone, range } = this.preset;
    const magnitude = Math.abs(degrees);
    if (magnitude <= deadzone) return 0;
    const span = Math.max(1, range - deadzone);
    const t = clamp((magnitude - deadzone) / span, 0, 1);
    // Légère courbe : précision autour du centre, verrouillage franc en butée.
    const shaped = t * t * (3 - 2 * t) * 0.35 + t * 0.65;
    return Math.sign(degrees) * shaped;
  }

  /** Le capteur a-t-il émis un échantillon récemment ? */
  hasSignal(nowMs: number = Date.now()): boolean {
    return this.samples > 0 && nowMs - this.lastSampleAt <= GYRO_SIGNAL_TIMEOUT_MS;
  }

  sinceLastSample(nowMs: number = Date.now()): number {
    return this.samples === 0 ? Number.POSITIVE_INFINITY : nowMs - this.lastSampleAt;
  }
}

/** Angle d'écran courant, lu sans casser les environnements sans `screen.orientation`. */
export function readScreenAngle(): ScreenAngle {
  if (typeof screen !== 'undefined' && screen.orientation && typeof screen.orientation.angle === 'number') {
    return normalizeScreenAngle(screen.orientation.angle);
  }
  const legacy = (globalThis as { orientation?: unknown }).orientation;
  if (typeof legacy === 'number') return normalizeScreenAngle(legacy);
  return 0;
}
