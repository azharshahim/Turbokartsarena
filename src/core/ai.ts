/**
 * Turbo Karts Arena — pilotes IA.
 *
 * Contrôleur = anticipation de courbure (feed-forward) + correction de cap
 * + correction latérale bornée. Cette structure est stable à haute vitesse :
 * l'anticipation fait l'essentiel du travail, les corrections ne font que
 * rattraper les petites erreurs (pas d'oscillation).
 *
 * Zéro allocation par frame (tout est pré-calculé ou réutilisé).
 */

import { clamp } from './math';
import type { DriveInput, Kart } from './kart';
import type { Track } from './track';

/** Gains réglables (utilisés aussi par l'outil de calibration automatique). */
export const AI_TUNING = {
  /** Distance d'anticipation (m) = base + vitesse × facteur. */
  lookAheadBase: 12,
  lookAheadSpeed: 0.4,
  /** Anticipation de courbure : cap visé += -κ × v × ffGain. */
  ffGain: 0.45,
  ffSpeedCap: 46,
  /** Anticipation maximale (rad). */
  ffMax: 0.2,
  /** Gain de correction de cap. */
  headingGain: 4.6,
  /** Gain de correction latérale (borné par atan). */
  lateralGain: 2.4,
  /** Pente de la correction latérale : élevée = rattrapage rapide hors trajectoire. */
  lateralSlope: 4.0,
  /** Accélération latérale virtuelle (m/s²) pour la vitesse de passage en virage. */
  aLat: 11,
  /** Décélération de référence utilisée pour le freinage anticipé (m/s²). */
  brakeDecel: 12,
  /** Marge de sécurité sur la vitesse de virage. */
  cornerMargin: 0.82,
  /** Seuils de dérapage. */
  driftCurvature: 0.014,
  driftMinSpeed: 20,
  /** Rayon de sécurité pour éviter les karts devant. */
  avoidDist: 15,
  /** 0 = trajectoire neutre, 1 = coupe franchement la corde. */
  lineAggression: 0.3,
  /** Mélange anticipation de courbure / visée directe du point cible. */
  pursuitBlend: 0,
};

export interface AiBrain {
  noisePhase: number;
  noiseTimer: number;
  steeringNoise: number;
  offsetBias: number;
  driftCooldown: number;
  brakeHold: number;
  /** 0..1 — niveau du pilote (pilote le palier de dérapage visé et le bruit). */
  skill: number;
  /** Diagnostic (uniquement rempli si l'hôte active `AI_DEBUG`). */
  debug?: Record<string, number>;
}

/** Active le rapport de diagnostic de l'IA (utilisé par les outils de calibration). */
export const AI_DEBUG = { enabled: false };

const _input: DriveInput = { steer: 0, brake: false, drift: false, throttle: 1 };

function rand(a: number, b: number) {
  return a + (b - a) * Math.random();
}

function wrap(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function makeBrain(rng: () => number, skill: number): AiBrain {
  return {
    noisePhase: rng() * 100,
    noiseTimer: 0,
    steeringNoise: rng() * 2 - 1,
    offsetBias: rng() * 2 - 1,
    driftCooldown: rng() * 1.2,
    brakeHold: 0,
    skill,
  };
}

export function thinkAi(
  kart: Kart,
  brain: AiBrain,
  track: Track,
  dt: number,
  raceTime: number,
  others: Kart[],
): DriveInput {
  const st = kart.state;
  const T = AI_TUNING;
  const v = Math.max(0, st.speed);
  const speed = Math.abs(st.speed);

  /* ---------- humanisation ---------- */
  brain.noiseTimer -= dt;
  if (brain.noiseTimer <= 0) {
    brain.noiseTimer = rand(0.9, 2.6);
    brain.steeringNoise = rand(-1, 1);
  }
  if (brain.driftCooldown > 0) brain.driftCooldown -= dt;
  if (brain.brakeHold > 0) brain.brakeHold -= dt;

  const look = T.lookAheadBase + v * T.lookAheadSpeed;
  const ahead = track.sampleAtDistance(st.s + look);

  /* ---------- trajectoire visée ---------- */
  let latTarget = track.racingLineOffset(st.s + look) * T.lineAggression + brain.offsetBias * 1.0;

  // éviter un adversaire juste devant
  for (let i = 0; i < others.length; i++) {
    const o = others[i];
    if (o === kart) continue;
    const dx = o.state.x - st.x;
    const dz = o.state.z - st.z;
    const fwd = dx * Math.sin(st.heading) + dz * Math.cos(st.heading);
    const side = dx * Math.cos(st.heading) - dz * Math.sin(st.heading);
    if (fwd > 0.5 && fwd < T.avoidDist && Math.abs(side) < 3.6) {
      latTarget += side > 0 ? -3.4 : 3.4;
      break;
    }
  }
  // viser les plaques de turbo
  for (let i = 0; i < track.boostZones.length; i++) {
    const b = track.boostZones[i];
    let ds = b.s - st.s;
    const half = track.length * 0.5;
    if (ds > half) ds -= track.length;
    if (ds < -half) ds += track.length;
    if (ds > 1.5 && ds < 26) {
      latTarget = b.lateral;
      break;
    }
  }
  latTarget = clamp(latTarget, -ahead.halfWidth * 0.6, ahead.halfWidth * 0.6);

  // Hors piste : on oublie la course, on vise le centre de la piste.
  const offTrack = Math.abs(st.lateralOffset) > ahead.halfWidth * 0.98;
  if (offTrack) latTarget = -Math.sign(st.lateralOffset) * ahead.halfWidth * 0.15;

  /* ---------- commande de direction ---------- */
  const kAhead =
    track.sampleAtDistance(st.s + 6).curvature * 0.5 +
    track.sampleAtDistance(st.s + 18).curvature * 0.33 +
    track.sampleAtDistance(st.s + 32).curvature * 0.17;
  // κ > 0 ⇒ la piste tourne à gauche ⇒ le cap doit augmenter ⇒ terme positif
  // hors piste : on réduit l'anticipation pour privilégier le retour en piste
  const ffScale = Math.abs(st.lateralOffset) > ahead.halfWidth ? 0.25 : 1;
  // Borné : une anticipation trop forte fait couper puis sortir large à haute vitesse.
  let ff = kAhead * Math.min(T.ffSpeedCap, v) * T.ffGain * ffScale;
  ff = clamp(ff, -T.ffMax, T.ffMax);
  // Cap visé : combinaison de l'anticipation de courbure (stable à haute vitesse)
  // et d'une visée directe du point cible (rattrape les erreurs latérales).
  const tangentHeading = Math.atan2(ahead.tx, ahead.tz) + ff;
  const aimX = ahead.x + ahead.rx * latTarget;
  const aimZ = ahead.z + ahead.rz * latTarget;
  const aimHeading = Math.atan2(aimX - st.x, aimZ - st.z);
  const headingTarget =
    tangentHeading * (1 - T.pursuitBlend) + aimHeading * T.pursuitBlend;
  const hErr = wrap(headingTarget - st.heading);
  const latErr = latTarget - st.lateralOffset;
  // latErr > 0 ⇒ la cible est à droite ⇒ braquer à droite ⇒ terme négatif (interne)
  // Correction latérale : saturante (atan) mais à pente élevée, pour qu'un kart
  // sorti large revienne franchement au lieu de « longer » l'herbe.
  const latTerm = Math.atan((T.lateralSlope * latErr) / (speed + 8)) * T.lateralGain;

  let steerInternal = hErr * T.headingGain - latTerm;
  steerInternal += brain.steeringNoise * 0.045 * (1.2 - brain.skill);
  steerInternal += Math.sin(raceTime * 1.1 + brain.noisePhase) * 0.012;
  steerInternal = clamp(steerInternal, -1, 1);

  /* ---------- profil de vitesse (freinage anticipé) ---------- */
  // Pour chaque distance d devant le kart, on connaît la vitesse maximale de
  // passage en virage : v = sqrt(a_lat / κ). On en déduit la vitesse maximale
  // AUTORISÉE MAINTENANT pour pouvoir ralentir à temps :
  //     v_entrée = sqrt(v_courbe² + 2 · a_frein · d)
  // C'est ce qui évite les sorties de piste à l'entrée des virages.
  const vmax = kart.stats.maxSpeed * st.speedMult;
  let vAllowed = vmax;
  for (let d = 6; d <= 78; d += 6) {
    const smp = track.sampleAtDistance(st.s + d);
    const k = Math.abs(smp.curvature);
    if (k < 1e-4) continue;
    const vCorner = Math.min(vmax, Math.sqrt(T.aLat / k));
    const entry = Math.sqrt(vCorner * vCorner + 2 * T.brakeDecel * Math.max(0, d - 6));
    if (entry < vAllowed) vAllowed = entry;
  }
  vAllowed *= T.cornerMargin;
  let brake = !st.drifting && v > vAllowed;
  if (st.drifting && v > vAllowed * 1.22) brake = true;
  if (brain.brakeHold > 0) brake = true;

  /* ---------- dérapage ---------- */
  let drift = false;
  const kDrift = Math.abs(track.sampleAtDistance(st.s + 13).curvature);
  if (!st.drifting) {
    if (
      brain.driftCooldown <= 0 &&
      brain.skill > 0.4 &&
      speed > T.driftMinSpeed &&
      kDrift > T.driftCurvature &&
      Math.abs(steerInternal) > 0.3
    ) {
      drift = true;
      brain.driftCooldown = rand(0.8, 1.8);
    }
  } else {
    const targetTier = brain.skill > 0.88 ? 3 : brain.skill > 0.62 ? 2 : 1;
    const done = st.driftTier >= targetTier && st.driftTime > 0.55;
    const straightening = kDrift < 0.006;
    drift = !done && !straightening && speed > 15 && Math.sign(steerInternal) === st.driftDir;
    if (!drift) brain.driftCooldown = rand(0.3, 0.9);
  }

  /* ---------- coincé ---------- */
  if (st.stuckTime > 0.9) {
    brake = true;
    drift = false;
    steerInternal = -Math.sign(st.lateralOffset || 1) * 0.9;
    brain.brakeHold = 1.1;
  }

  if (AI_DEBUG.enabled) {
    brain.debug = {
      hErr,
      ff,
      latErr,
      latTerm,
      steerInternal,
      vAllowed,
      v,
      kAhead,
      offTrack: offTrack ? 1 : 0,
      rail: track.racingLineOffset(st.s + look),
      curvature: track.sampleAtDistance(st.s).curvature,
    };
  }

  _input.steer = -steerInternal; // convention écran : +1 = droite
  _input.brake = brake;
  _input.drift = drift;
  _input.throttle = brake ? 0.05 : 1;
  kart.aiDriftHold = false;
  return _input;
}
