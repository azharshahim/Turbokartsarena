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
 * Robustesse (V4.1 — stabilisation de la direction) :
 *  - zone morte de 3° en mode Normal, réglable en un seul endroit ;
 *  - filtrage passe-bas **adaptatif** : plus fort près du centre (le tremblement
 *    du bras est absorbé), plus léger dès qu'on incline (réponse franche en virage) ;
 *  - recalage automatique du neutre : la dérive lente du poignet est compensée
 *    *à l'intérieur* de la zone morte, donc sans jamais modifier un vrai virage ;
 *  - recentrage progressif (bouton en course) : la position neutre rejoint la
 *    position actuelle en ~0,3 s, sans à-coup de direction ;
 *  - rotation d'écran : le braquage est conservé à l'identique (aucun saut) ;
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

/**
 * Zone morte de référence, en degrés — **seul endroit à modifier** pour régler la
 * tolérance au tremblement. Le mode Normal l'utilise telle quelle (~3°), le mode
 * Doux l'élargit (confort), le mode Sport la resserre (précision).
 */
export const GYRO_DEADZONE_DEG = 3;
/** Échelle de la zone morte par sensibilité. */
export const GYRO_DEADZONE_SCALE: Record<GyroSensitivity, number> = { soft: 1.7, normal: 1, sport: 0.7 };
/** Course d'inclinaison (au-delà de la zone morte) pour le braquage maximal. */
export const GYRO_RANGE_DEG: Record<GyroSensitivity, number> = { soft: 34, normal: 24, sport: 16 };
/** Lissage de base (1/s) : plus bas = plus filtré. */
export const GYRO_SMOOTHING: Record<GyroSensitivity, number> = { soft: 8, normal: 13, sport: 19 };
/** Limite de variation du braquage (par seconde). */
export const GYRO_MAX_RATE: Record<GyroSensitivity, number> = { soft: 2, normal: 3.4, sport: 5.5 };

export const GYRO_PRESETS: Record<GyroSensitivity, GyroPreset> = {
  soft: {
    deadzone: GYRO_DEADZONE_DEG * GYRO_DEADZONE_SCALE.soft,
    range: GYRO_RANGE_DEG.soft,
    smoothing: GYRO_SMOOTHING.soft,
    maxRate: GYRO_MAX_RATE.soft,
  },
  normal: {
    deadzone: GYRO_DEADZONE_DEG * GYRO_DEADZONE_SCALE.normal,
    range: GYRO_RANGE_DEG.normal,
    smoothing: GYRO_SMOOTHING.normal,
    maxRate: GYRO_MAX_RATE.normal,
  },
  sport: {
    deadzone: GYRO_DEADZONE_DEG * GYRO_DEADZONE_SCALE.sport,
    range: GYRO_RANGE_DEG.sport,
    smoothing: GYRO_SMOOTHING.sport,
    maxRate: GYRO_MAX_RATE.sport,
  },
};

/** Filtrage renforcé près du centre (facteur appliqué au lissage de base). */
export const GYRO_NEAR_CENTER_DAMPING = 0.55;
/** Recentrage doux : constante de temps ≈ 1/7 s. */
export const GYRO_RECENTER_RATE = 7;
/** Recalage auto du neutre : immobilité exigée avant d'agir. */
export const GYRO_TRIM_DELAY_S = 0.9;
/** Recalage auto : vitesse (1/s) de rapprochement du neutre. */
export const GYRO_TRIM_RATE = 0.5;
/** Recalage auto : mouvement maximal (deg/s) au-delà duquel on ne recalage pas. */
export const GYRO_TRIM_MOTION_LIMIT = 6;
/** Recalage auto : amplitude totale autorisée autour de la calibration (±degrés). */
export const GYRO_TRIM_LIMIT_DEG = 10;
/** Rotation d'écran : décalage maximal reporté sur le neutre (anti-fantôme). */
export const GYRO_ROTATION_SHIFT_LIMIT = 45;

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
 * Convertisseur inclinaison → braquage, avec zone morte, lissage adaptatif,
 * recalage automatique du neutre et recentrage progressif.
 * Instancié une seule fois par hôte (web / natif) ; module pur, testé sous Node.
 */
export class TiltSteering {
  sensitivity: GyroSensitivity = 'normal';
  invertTilt = false;

  /** Position neutre courante (peut dériver dans la zone morte). */
  private rest = 0;
  /** Cible du recentrage progressif. */
  private restTarget = 0;
  /** Position neutre de référence (calibration explicite, bornée ±35°). */
  private restRef = 0;
  private smoothed = 0;
  private value = 0;
  /** Dernière inclinaison brute, pour la détection d'immobilité. */
  private lastRaw = 0;
  /** Angle d'écran du dernier échantillon (rotation ⇒ re-cadrage sans saut). */
  private angle: ScreenAngle = 0;
  private stillTime = 0;
  private lastSampleAt = Number.NEGATIVE_INFINITY;
  private samples = 0;
  private started = false;

  get preset(): GyroPreset {
    return GYRO_PRESETS[this.sensitivity] ?? GYRO_PRESETS.normal;
  }

  /** Position neutre effective, en degrés (calibration + recalage automatique). */
  get calibration(): number {
    return this.rest;
  }

  /** Calibration explicite (référence), en degrés. */
  get reference(): number {
    return this.restRef;
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

  /** Durée d'immobilité utile au recalage automatique du neutre (diagnostics/tests). */
  get stillness(): number {
    return this.stillTime;
  }

  setCalibration(degrees: number): void {
    if (!Number.isFinite(degrees)) return;
    const bounded = clamp(degrees, -35, 35);
    this.rest = bounded;
    this.restTarget = bounded;
    this.restRef = bounded;
  }

  /** Définit la position neutre **instantanément** (départ de course, menu). */
  calibrate(): number {
    const degrees = clamp(this.started ? this.smoothed : 0, -35, 35);
    this.setCalibration(degrees);
    this.stillTime = 0;
    return degrees;
  }

  /**
   * Recentrage **progressif** (bouton « Recentrer » en course) : la position
   * neutre rejoint la position actuelle en ~0,3 s. Le braquage revient donc au
   * centre sans à-coup, contrairement à une calibration instantanée.
   * @returns la cible enregistrée (degrés), à persister si nécessaire.
   */
  recenter(): number {
    const target = clamp(this.started ? this.smoothed : 0, -35, 35);
    this.restTarget = target;
    this.restRef = target;
    this.stillTime = 0;
    return target;
  }

  /** Remet la direction au centre sans perdre la calibration (pause, changement d'écran). */
  reset(): void {
    this.value = 0;
    this.smoothed = this.started ? this.smoothed : 0;
    this.stillTime = 0;
  }

  /**
   * Nouvel échantillon d'orientation.
   * @returns braquage borné [-1..1] (positif = droite, convention écran).
   */
  push(betaDeg: number, gammaDeg: number, screenAngle: number, dtSeconds: number, nowMs?: number): number {
    if (!Number.isFinite(betaDeg) || !Number.isFinite(gammaDeg)) return this.value;
    const now = typeof nowMs === 'number' && Number.isFinite(nowMs) ? nowMs : Date.now();
    const dt = clamp(Number.isFinite(dtSeconds) ? dtSeconds : 1 / 60, 1 / 240, 0.1);
    const angle = normalizeScreenAngle(screenAngle);
    const raw = tiltDegrees(betaDeg, gammaDeg, angle);

    if (!this.started) {
      // Premier échantillon : on s'aligne sans à-coup.
      this.started = true;
      this.smoothed = raw;
      this.lastRaw = raw;
      this.angle = angle;
    } else if (angle !== this.angle) {
      // Rotation d'écran : on reporte le décalage sur le neutre pour conserver
      // EXACTEMENT le braquage courant (aucun saut au moment de la bascule).
      const shift = clamp(raw - this.smoothed, -GYRO_ROTATION_SHIFT_LIMIT, GYRO_ROTATION_SHIFT_LIMIT);
      this.smoothed = raw;
      this.rest = clamp(this.rest + shift, -35, 35);
      this.restTarget = clamp(this.restTarget + shift, -35, 35);
      this.restRef = clamp(this.restRef + shift, -35, 35);
      this.angle = angle;
      this.stillTime = 0;
    } else {
      // Filtrage adaptatif : fort près du centre (anti-tremblement), léger en virage.
      const nearCenter = Math.abs(this.smoothed - this.rest) < this.preset.deadzone * 1.5;
      const smoothing = this.preset.smoothing * (nearCenter ? GYRO_NEAR_CENTER_DAMPING : 1);
      this.smoothed = damp(this.smoothed, raw, smoothing, dt);
    }

    this.lastSampleAt = now;
    this.samples += 1;

    // 1. Recentrage progressif (bouton « Recentrer »).
    if (this.rest !== this.restTarget) {
      this.rest = damp(this.rest, this.restTarget, GYRO_RECENTER_RATE, dt);
      if (Math.abs(this.rest - this.restTarget) < 0.01) this.rest = this.restTarget;
    } else {
      // 2. Recalage automatique du neutre : uniquement DANS la zone morte
      //    (le braquage y vaut déjà 0) et seulement si le téléphone est immobile.
      //    Un virage, même doux, sort de cette bande : il n'est jamais annulé.
      const offset = this.smoothed - this.rest;
      const speed = Math.abs(this.smoothed - this.lastRaw) / dt;
      if (Math.abs(offset) <= this.preset.deadzone && speed < GYRO_TRIM_MOTION_LIMIT) {
        this.stillTime += dt;
        if (this.stillTime >= GYRO_TRIM_DELAY_S) {
          const next = clamp(
            this.rest + offset * clamp(dt * GYRO_TRIM_RATE, 0, 0.2),
            this.restRef - GYRO_TRIM_LIMIT_DEG,
            this.restRef + GYRO_TRIM_LIMIT_DEG,
          );
          this.rest = next;
          this.restTarget = next;
        }
      } else {
        this.stillTime = 0;
      }
    }

    this.lastRaw = raw;
    const rawSteer = this.steerFromTilt((this.smoothed - this.rest) * (this.invertTilt ? -1 : 1));
    const maxStep = this.preset.maxRate * dt;
    this.value = clamp(rawSteer, this.value - maxStep, this.value + maxStep);
    return this.value;
  }

  /** Convertit une inclinaison (degrés, signe déjà corrigé) en braquage [-1..1]. */
  steerFromTilt(degrees: number): number {
    const { deadzone, range } = this.preset;
    const magnitude = Math.abs(degrees);
    if (magnitude <= deadzone) return 0;
    const span = Math.max(1, range - deadzone);
    const t = clamp((magnitude - deadzone) / span, 0, 1);
    // Courbe douce au sortir de la zone morte, verrouillage franc en butée.
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
