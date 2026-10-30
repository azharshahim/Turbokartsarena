import { terrainFactorsFor } from './terrain';
/**
 * Turbo Karts Arena — modèle physique du kart (arcade).
 *
 * Choix de conception :
 *  - Modèle de vitesse "dérive latérale amortie" plutôt qu'une vraie simulation de pneus :
 *    cybernétique, prévisible, très agréable au doigt/pouce, et peu coûteux en CPU.
 *  - Dérapage en 3 paliers (bleu → orange → violet) chargés par la durée + l'angle de braquage.
 *  - Aucune allocation mémoire dans la boucle chaude (tout est réutilisé) pour tenir 60 FPS.
 */

import { vehicleFor } from '../game/vehicles';
import { PHYSICS } from './config';
import { clamp, damp, dampAngle, lerp, smoothstep } from './math';
import type { KartProfile } from '../game/roster';
import type { SurfaceKind, Track } from './track';

export type DriftTier = 0 | 1 | 2 | 3;
export type KartStatus = 'racing' | 'finished' | 'idle';

export interface DriveInput {
  /** -1 (gauche) … 1 (droite) */
  steer: number;
  brake: boolean;
  /** Bouton de dérapage maintenu. */
  drift: boolean;
  /** 0..1 — l'accélération est automatique par défaut. */
  throttle: number;
  /**
   * V4.1 — bouton TURBO : libère immédiatement le mini-turbo chargé pendant un
   * dérapage (la maîtrise est comptabilisée au relâchement). Optionnel : les
   * appels existants restent valides.
   */
  turbo?: boolean;
}

export const NEUTRAL_INPUT: DriveInput = { steer: 0, brake: false, drift: false, throttle: 1 };

export interface KartState {
  id: number;
  profileId: string;
  isPlayer: boolean;
  name: string;

  /* transform */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  heading: number;
  yawRate: number;

  /* sensations visuelles (jamais utilisées pour la physique) */
  visualYawSlip: number;
  visualRoll: number;
  visualPitch: number;
  hop: number;
  hopVel: number;
  bounce: number;

  /* dynamique */
  speed: number;
  lateralSpeed: number;
  airborne: boolean;
  airTime: number;

  /* entrées lissées */
  steer: number;
  brakeAmount: number;

  /* dérapage */
  drifting: boolean;
  driftDir: number;
  driftCharge: number;
  driftTier: DriftTier;
  driftTime: number;
  driftReleasedTime: number;
  driftSteerAccum: number;
  /** Temps passé en palier violet pendant le dérapage courant (maîtrise). */
  driftTier3Time: number;
  /** Anti ré-amorçage après une libération au bouton TURBO. */
  driftLockout: number;
  /** Durée restante d'affichage « MAÎTRISE » dans le HUD. */
  masteryFlash: number;
  /** Nombre de mini-turbos de maîtrise réussis dans la course. */
  masteryCount: number;

  /* turbo */
  boostTime: number;
  boostTier: DriftTier;
  boostCooldown: number;
  boostPadTime: number;

  /* piste */
  surface: SurfaceKind;
  s: number;
  lateralOffset: number;
  trackIndex: number;
  onRoad: boolean;
  offRoadTime: number;
  stuckTime: number;

  /* course */
  status: KartStatus;
  totalDistance: number;
  lap: number;
  prevTrackS: number;
  lapStartTime: number;
  lastLapTime: number;
  bestLapTime: number;
  lapTimes: number[];
  finishTime: number;
  place: number;
  speedMult: number;

  /* batterie d'effets */
  sparkTimer: number;
  smokeTimer: number;
  lastImpact: number;
  /** Cache interne (variation de vitesse) pour le tangage visuel. */
  _lastVf?: number;
}

function freshState(id: number, profile: KartProfile, isPlayer: boolean): KartState {
  return {
    id,
    profileId: profile.id,
    isPlayer,
    name: profile.name,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    heading: 0,
    yawRate: 0,
    visualYawSlip: 0,
    visualRoll: 0,
    visualPitch: 0,
    hop: 0,
    hopVel: 0,
    bounce: 0,
    speed: 0,
    lateralSpeed: 0,
    airborne: false,
    airTime: 0,
    steer: 0,
    brakeAmount: 0,
    drifting: false,
    driftDir: 0,
    driftCharge: 0,
    driftTier: 0,
    driftTime: 0,
    driftReleasedTime: 0,
    driftSteerAccum: 0,
    driftTier3Time: 0,
    driftLockout: 0,
    masteryFlash: 0,
    masteryCount: 0,
    boostTime: 0,
    boostTier: 0,
    boostCooldown: 0,
    boostPadTime: 0,
    surface: 'road',
    s: 0,
    lateralOffset: 0,
    trackIndex: 0,
    onRoad: true,
    offRoadTime: 0,
    stuckTime: 0,
    status: 'idle',
    totalDistance: 0,
    lap: 0,
    prevTrackS: 0,
    lapStartTime: 0,
    lastLapTime: 0,
    bestLapTime: 0,
    lapTimes: [],
    finishTime: 0,
    place: 1,
    speedMult: 1,
    sparkTimer: 0,
    smokeTimer: 0,
    lastImpact: 0,
  };
}

/** Stats effectives = stats de base du personnage × réglages globaux. */
export interface EffectiveStats {
  maxSpeed: number;
  accel: number;
  grip: number;
  turnRate: number;
  brake: number;
  stability: number;
  bike: boolean;
  driftGrip: number;
  mass: number;
}

export function effectiveStats(profile: KartProfile): EffectiveStats {
  const k = PHYSICS.kart;
  return {
    maxSpeed: k.maxSpeed * profile.speed,
    accel: k.accel * profile.accel,
    grip: k.gripRoad * profile.grip,
    turnRate: k.turnRate * profile.handling,
    driftGrip: k.gripDrift * profile.grip,
    mass: profile.mass,
    brake: profile.brake ?? vehicleFor(profile)?.brake ?? 1,
    stability: profile.stability ?? vehicleFor(profile)?.stability ?? 1,
    bike: !!vehicleFor(profile) && vehicleFor(profile)!.kind !== 'kart',
  };
}

export class Kart {
  readonly state: KartState;
  readonly profile: KartProfile;
  readonly stats: EffectiveStats;
  readonly playerFlag: boolean;
  /** IA (null pour le joueur). */
  aiSkill = 1;
  aiOffsetTarget = 0;
  aiRetarget = 0;
  aiDriftHold = false;

  constructor(id: number, profile: KartProfile, isPlayer: boolean) {
    this.playerFlag = isPlayer;
    this.state = freshState(id, profile, isPlayer);
    this.profile = profile;
    this.stats = effectiveStats(profile);
  }

  /** Place le kart sur la grille. */
  reset(pos: { x: number; y: number; z: number; heading: number }, track: Track, raceTime: number) {
    const st = this.state;
    st.x = pos.x;
    st.y = pos.y;
    st.z = pos.z;
    st.heading = pos.heading;
    st.vx = st.vy = st.vz = 0;
    st.yawRate = 0;
    st.speed = 0;
    st.lateralSpeed = 0;
    st.steer = 0;
    st.brakeAmount = 0;
    st.drifting = false;
    st.driftDir = 0;
    st.driftCharge = 0;
    st.driftTier = 0;
    st.driftTier3Time = 0;
    st.driftLockout = 0;
    st.masteryFlash = 0;
    st.masteryCount = 0;
    st.boostTime = 0;
    st.boostPadTime = 0;
    st.boostTier = 0;
    st.offRoadTime = 0;
    st.stuckTime = 0;
    st.airborne = false;
    st.airTime = 0;
    st.visualYawSlip = 0;
    st.visualRoll = 0;
    st.visualPitch = 0;
    st.hop = 0;
    st.hopVel = 0;
    st.status = 'racing';
    st.finishTime = 0;
    st.place = 1;
    st.speedMult = 1;

    const q = track.query(pos.x, pos.z, -1, false);
    st.trackIndex = q.index;
    st.s = q.s;
    st.prevTrackS = q.s;
    st.lateralOffset = q.lateral;
    st.surface = q.surface;
    st.totalDistance = 0;
    st.lap = 0;
    st.lapStartTime = raceTime;
    st.lastLapTime = 0;
    st.bestLapTime = 0;
    st.lapTimes = [];
  }

  get isPlayer() {
    return this.playerFlag;
  }

  get kmh() {
    return Math.abs(this.state.speed) * 3.6;
  }

  get driftChargeRatio() {
    const d = PHYSICS.drift;
    return clamp(this.state.driftCharge / d.tiers[2], 0, 1);
  }

  get boostRatio() {
    return clamp(this.state.boostTime / 1.9, 0, 1);
  }

  get isBoosting() {
    return this.state.boostTime > 0 || this.state.boostPadTime > 0;
  }

  /** Pas de simulation. `dt` doit valoir PHYSICS.fixedStep. */
  step(dt: number, input: DriveInput, track: Track, raceTime: number) {
    const st = this.state;
    const P = PHYSICS.kart;
    const D = PHYSICS.drift;
    if (st.status === 'finished' && st.speed < 0.5) {
      // on laisse rouler puis on fige
    }

    /* ---------- 1. entrées lissées ---------- */
    // CONVENTION (verrouillée par test) :
    //   forward = (sin h, cos h), right = forward × up = (-cos h, sin h)
    //   ⇒ h croissant = virage à GAUCHE.
    //   `input.steer` suit la convention écran : +1 = droite.
    //   `st.steer` est le braquage interne : +1 = gauche (lacet positif).
    // V4.1 : le rappel au centre est plus rapide que la mise en virage — le
    // pouce retrouve tout de suite la trajectoire, sans à-coup en entrée.
    const steerTarget = -clamp(input.steer, -1, 1);
    const steerRate =
      Math.abs(steerTarget) < 1e-3
        ? P.steerReturn
        : input.drift
          ? P.steerEngageDrift
          : P.steerEngage;
    st.steer = damp(st.steer, steerTarget, steerRate, dt);
    st.brakeAmount = damp(st.brakeAmount, input.brake ? 1 : 0, 18, dt);

    const steerMag = Math.abs(st.steer);

    /* ---------- 2. état du sol ---------- */
    const q = track.query(st.x, st.z, st.trackIndex);
    st.surface = q.surface;
    st.onRoad = q.onRoad;
    st.trackIndex = q.index;
    st.lateralOffset = q.lateral;
    st.s = q.s;
    const groundY = q.y;
    const prevS = st.prevTrackS;
    let ds = q.s - prevS;
    const halfLen = track.length * 0.5;
    if (ds > halfLen) ds -= track.length;
    if (ds < -halfLen) ds += track.length;
    st.prevTrackS = q.s;
    st.totalDistance += ds;

    const maxSpeed = this.stats.maxSpeed * st.speedMult;
    const speedFrac = Math.abs(st.speed) / maxSpeed;

    /* ---------- 3. dérapage : machine à états ---------- */
    if (st.driftLockout > 0) st.driftLockout = Math.max(0, st.driftLockout - dt);
    if (st.masteryFlash > 0) st.masteryFlash = Math.max(0, st.masteryFlash - dt);

    const canDrift = !st.airborne && Math.abs(st.speed) > PHYSICS.kart.driftEnterSpeed;
    const wantDrift = input.drift || (this.aiDriftHold && canDrift);
    /** V4.1 : le bouton TURBO libère le mini-turbo sans lâcher le pouce du dérapage. */
    const turboRelease = !!input.turbo && st.drifting && st.driftTier > 0;

    if (!st.drifting) {
      if (wantDrift && canDrift && st.driftLockout <= 0 && steerMag > D.enterSteerThreshold && st.brakeAmount < 0.4) {
        st.drifting = true;
        st.driftDir = Math.sign(st.steer) || 1;
        st.driftCharge = 0;
        st.driftTier = 0;
        st.driftTime = 0;
        st.driftSteerAccum = 0;
        st.driftTier3Time = 0;
        st.hop = 0.24;
        st.hopVel = 3.4;
        // petit coup de lacet pour "asseoir" le dérapage
        st.yawRate += st.driftDir * 0.95;
      }
    } else {
      st.driftTime += dt;
      const into = clamp(st.steer * st.driftDir, -1, 1);
      if (into > 0.15) st.driftSteerAccum += into * dt;

      // charge : base + angle de braquage + bonus de vitesse
      const gain =
        D.chargeRateBase + D.chargeRateSteer * Math.max(0, into) + D.chargeRateSpeedBonus * speedFrac;
      st.driftCharge = Math.min(D.chargeMax, st.driftCharge + gain * dt);

      const tiers = D.tiers;
      st.driftTier = (
        st.driftCharge >= tiers[3] ? 3 : st.driftCharge >= tiers[2] ? 2 : st.driftCharge >= tiers[1] ? 1 : 0
      ) as DriftTier;
      if (st.driftTier === 3) st.driftTier3Time += dt;

      // fin du dérapage : frein, relâchement, marche arrière ou bouton TURBO
      const released = !wantDrift && st.driftTime > 0.15;
      const braking = st.brakeAmount > 0.55;
      const tooSlow = Math.abs(st.speed) < 9;
      const reversed = Math.sign(st.speed) < 0 && Math.abs(st.speed) > 2;
      if (released || braking || tooSlow || reversed || turboRelease) {
        this.endDrift(track, raceTime, turboRelease);
      }
    }
    if (!st.drifting && st.driftReleasedTime > 0)
      st.driftReleasedTime = Math.max(0, st.driftReleasedTime - dt);

    /* ---------- 4. turbo ---------- */
    if (st.boostTime > 0) st.boostTime = Math.max(0, st.boostTime - dt);
    if (st.boostPadTime > 0) st.boostPadTime = Math.max(0, st.boostPadTime - dt);
    if (st.boostCooldown > 0) st.boostCooldown = Math.max(0, st.boostCooldown - dt);

    let boostTier: DriftTier = st.boostTier;
    let boostMult = 1;
    if (st.boostTime > 0) {
      boostMult = lerp(boostMult, D.boostMult[boostTier], smoothstep(0, 0.18, st.boostTime));
    }
    if (st.boostPadTime > 0) boostMult = Math.max(boostMult, 1.24);

    /* ---------- 5. forces longitudinales ---------- */
    const throttle = clamp(input.throttle, 0, 1);
    const grassPenalty = st.surface === 'grass' ? 0.7 : st.surface === 'curb' ? 0.97 : 1;
    const terrain = st.surface === 'grass' ? { grip: 1, acceleration: 1 } : terrainFactorsFor(q.terrain, this.stats.bike);

    const fwdX = Math.sin(st.heading);
    const fwdZ = Math.cos(st.heading);
    const rightX = fwdZ;
    const rightZ = -fwdX;

    let vf = st.vx * fwdX + st.vz * fwdZ;
    let vl = st.vx * rightX + st.vz * rightZ;

    if (st.boostTime > 0) {
      // poussée franche du turbo, indépendante du régime moteur
      const push = D.boostAccel[boostTier] * smoothstep(0, 0.25, st.boostTime);
      vf += push * dt;
    }

    if (throttle > 0.02 && st.brakeAmount < 0.5) {
      const ratio = clamp(vf / (maxSpeed * grassPenalty), -1, 1);
      // Courbe de couple : franche à bas régime, nulle à Vmax (0,98) → pas d'à-coup
      const falloff = Math.max(0, 1 - ratio * ratio);
      const engine = this.stats.accel * throttle * falloff * terrain.acceleration;
      vf += engine * dt;
    }

    // freinage / marche arrière
    if (st.brakeAmount > 0.05) {
      if (vf > 0.6) {
        vf -= P.brakeDecel * this.stats.brake * st.brakeAmount * dt;
      } else {
        const revMax = P.reverseMaxSpeed;
        if (vf > -revMax) vf -= this.stats.accel * 0.55 * st.brakeAmount * dt;
      }
    } else if (throttle < 0.02) {
      vf -= Math.sign(vf) * P.engineBrake * dt;
    }

    // dérapage : grattage de vitesse (V4.1 : plus doux, le dérapage conserve l'élan)
    if (st.drifting) vf -= (D.scrubBase + D.scrubSteer * steerMag) * dt;

    // résistances
    vf -= Math.sign(vf) * P.rollingResistance * dt;
    vf -= vf * Math.abs(vf) * P.dragCoef * dt;
    if (st.surface === 'grass') vf -= Math.sign(vf) * 6 * Math.min(1, Math.abs(vf) / 6) * dt;

    /* ---------- 6. rotation (lacet) ---------- */
    const absVf = Math.abs(vf);
    const poke = P.turnLowSpeed; // braquage résiduel à l'arrêt
    const authority = clamp(absVf / 9, 0, 1) * (1 - 0.28 * smoothstep(0.62, 1, absVf / maxSpeed));
    let targetYaw: number;
    if (st.drifting) {
      const into = clamp(st.steer * st.driftDir, -1, 1);
      const base = 0.72 + 0.42 * authority;
      const steerPart = 1.55 * st.steer;
      targetYaw = st.driftDir * base + steerPart * (0.55 + 0.45 * authority);
      // éviter les tête-à-queue : on borne le lacet pendant le dérapage
      targetYaw = clamp(targetYaw, -3.6, 3.6);
      void into;
    } else {
      const base = this.stats.turnRate * (authority + poke * (1 - authority));
      const speedDrop = lerp(1, 0.82, smoothstep(0.55, 1, absVf / maxSpeed));
      targetYaw = st.steer * base * speedDrop;
      if (absVf < 0.35) targetYaw = st.steer * 1.2;
    }
    st.yawRate = damp(st.yawRate, targetYaw, (st.drifting ? 8.5 : 11.5) / this.stats.stability, dt);
    if (!st.airborne) st.heading += st.yawRate * dt;

    /* ---------- 7. adhérence latérale ---------- */
    const gripBase = st.drifting
      ? this.stats.driftGrip
      : st.surface === 'grass'
        ? PHYSICS.kart.gripDirt
        : this.stats.grip;
    const grip = st.airborne
      ? 1.2
      : gripBase * terrain.grip * (track.layout.rain ? 0.85 : 1) * (this.stats.bike && st.drifting ? 1.25 : 1);
    const decay = 1 - Math.exp(-grip * dt);
    vl -= vl * decay;

    // limite d'angle de dérive (évite le spin infini sur l'herbe)
    const maxSlip = st.drifting ? 0.62 : st.surface === 'grass' ? 0.5 : 0.34;
    const cap = Math.abs(vf) * Math.tan(maxSlip);
    vl = clamp(vl, -cap, cap);

    // recomposition de la vitesse monde
    const nfx = Math.sin(st.heading);
    const nfz = Math.cos(st.heading);
    const nrx = nfz;
    const nrz = -nfx;
    st.vx = nfx * vf + nrx * vl;
    st.vz = nfz * vf + nrz * vl;
    st.speed = vf;
    st.lateralSpeed = vl;

    /* ---------- 8. plafond de vitesse ---------- */
    const capSpeed = maxSpeed * boostMult * (st.surface === 'grass' ? 0.7 : 1);
    if (vf > capSpeed) {
      const over = vf - capSpeed;
      vf -= over * Math.min(1, 7 * dt);
      st.vx = nfx * vf + nrx * vl;
      st.vz = nfz * vf + nrz * vl;
      st.speed = vf;
    }

    /* ---------- 9. intégration position ------------- */
    st.x += st.vx * dt;
    st.z += st.vz * dt;

    // Continuous safety rails follow the same width samples as the rendered
    // steel barriers. Resolve only local contacts; distant off-track states still
    // use the existing respawn recovery, rather than teleporting across a loop.
    if (track.layout.guardrails) {
      const edge = track.query(st.x, st.z, st.trackIndex);
      const limit = edge.halfWidth + (this.stats.bike ? 1.7 : 1.35);
      if (Math.abs(edge.lateral) > limit && Math.abs(edge.lateral) < edge.halfWidth + 5) {
        const side = Math.sign(edge.lateral);
        const pos = track.worldAt(edge.s, side * limit);
        const sample = track.sampleAtDistance(edge.s);
        st.x = pos.x;
        st.z = pos.z;
        const outward = (st.vx * sample.rx + st.vz * sample.rz) * side;
        if (outward > 0) {
          st.vx -= sample.rx * side * outward * 1.25;
          st.vz -= sample.rz * side * outward * 1.25;
          st.vx *= 0.88;
          st.vz *= 0.88;
          st.bounce = 0.15;
        }
      }
    }

    // vertical : saut / rampes / atterrissage
    if (st.airborne) {
      st.vy -= PHYSICS.gravity * dt;
      st.y += st.vy * dt;
      st.airTime += dt;
      if (st.y <= groundY) {
        st.y = groundY;
        st.vy = 0;
        st.airborne = false;
        st.bounce = clamp(Math.abs(st.vy) * 0.02, 0.05, 0.3);
        st.airTime = 0;
      }
    } else {
      // Suspension follows ordinary downhill grades; only a real drop leaves
      // the road. A 6 cm threshold disabled steering on every steep descent.
      if (st.y > groundY + 0.65) {
        st.airborne = true;
        st.vy = 0;
      } else {
        st.y = damp(st.y, groundY, 24, dt);
        // rampe de boost → petit envol
        if (q.surface === 'boost' && st.boostCooldown <= 0) {
          st.boostPadTime = 0.85;
          st.boostCooldown = 0.85;
        }
      }
    }

    /* ---------- 10. hors-piste / respawn ---------- */
    if (!q.onRoad) {
      st.offRoadTime += dt;
    } else {
      st.offRoadTime = Math.max(0, st.offRoadTime - dt * 2);
    }
    if (Math.abs(st.speed) < 2.2 && !st.airborne) st.stuckTime += dt;
    else st.stuckTime = 0;
    if (st.stuckTime > 2.6 || st.offRoadTime > 5.5) this.respawn(track, raceTime);

    /* ---------- 11. visuel ---------- */
    const slip = Math.atan2(vl, Math.max(4, Math.abs(vf)));
    st.visualYawSlip = damp(st.visualYawSlip, clamp(slip, -0.7, 0.7), 10, dt);
    const rollTarget = this.stats.bike
      ? clamp(-Math.atan((st.yawRate * Math.abs(vf)) / 28), -0.65, 0.65)
      : clamp(-st.yawRate * Math.abs(vf) * 0.0055, -0.16, 0.16);
    st.visualRoll = damp(st.visualRoll, rollTarget, 8, dt);
    const pitchTarget = st.airborne
      ? clamp(-st.vy * 0.018, -0.22, 0.22)
      : clamp(-(vf - (st._lastVf ?? vf)) * 0.004 + (st.surface === 'boost' ? -0.03 : 0), -0.1, 0.1);
    st._lastVf = vf;
    st.visualPitch = damp(st.visualPitch, pitchTarget, 7, dt);

    if (st.hop > 0 || st.hopVel !== 0) {
      st.hopVel -= 22 * dt;
      st.hop += st.hopVel * dt;
      if (st.hop <= 0) {
        st.hop = 0;
        st.hopVel = 0;
      }
    }
    st.bounce = Math.max(0, st.bounce - dt * 2.4);

    /* ---------- 12. minuteries d'effets ---------- */
    if (st.drifting && st.driftTier > 0) {
      st.sparkTimer += dt;
      st.smokeTimer += dt;
    }
  }

  /**
   * Fin du dérapage : convertit la charge en turbo.
   *
   * V4.1 — récompense de maîtrise : un dérapage tenu en palier violet au-delà de
   * `masteryHold` donne un mini-turbo renforcé (durée + impulsion), signalé au
   * HUD. Le reste de la physique (paliers, plafond de vitesse) est inchangé.
   *
   * La sortie est stabilisée : une partie de la vitesse latérale est réalignée
   * sur le cap, ce qui évite les tête-à-queue à la remise des gaz.
   */
  private endDrift(track: Track, raceTime: number, manual = false) {
    const st = this.state;
    const D = PHYSICS.drift;
    const tier = st.driftTier;
    const mastered = tier >= 3 && st.driftTier3Time >= D.masteryHold;
    if (tier > 0 && st.driftTime > 0.28) {
      const bonus = mastered ? D.masteryBonus : 0;
      const duration = D.boostDuration[tier] + bonus;
      const add = tier === st.boostTier && st.boostTime > 0 ? duration * D.stackFactor : duration;
      st.boostTime = Math.min(2.6 + D.masteryBonus, st.boostTime + add);
      st.boostTier = Math.max(st.boostTier, tier) as DriftTier;
      st.boostCooldown = 0.12;
      // impulsion immédiate : c'est ce qui rend le boost "satisfaisant"
      const kick = 2.6 + tier * 2.2 + (mastered ? D.masteryKick : 0);
      st.vx += Math.sin(st.heading) * kick;
      st.vz += Math.cos(st.heading) * kick;
      st.speed += kick;
      st.driftReleasedTime = 0.5;
      if (mastered) {
        st.masteryCount += 1;
        st.masteryFlash = 1.4;
      }
    } else if (tier === 0) {
      st.boostTier = 0;
    }

    // sortie de dérapage propre : on réaligne une partie de la vitesse latérale
    const fx = Math.sin(st.heading);
    const fz = Math.cos(st.heading);
    const vf = st.vx * fx + st.vz * fz;
    const vl = st.vx * fz - st.vz * fx;
    const keep = D.exitLateralKeep;
    st.vx = fx * vf + fz * vl * keep;
    st.vz = fz * vf - fx * vl * keep;

    st.drifting = false;
    st.driftDir = 0;
    st.driftCharge = 0;
    st.driftTier = 0;
    st.driftTime = 0;
    st.driftTier3Time = 0;
    if (manual) st.driftLockout = D.reentryLockout;
    void track;
    void raceTime;
  }

  respawn(track: Track, raceTime: number) {
    const st = this.state;
    const p = track.respawnPoint(st.s, st.lateralOffset * 0.4);
    st.x = p.x;
    st.y = p.y;
    st.z = p.z;
    st.heading = p.heading;
    st.yawRate = 0;
    st.vx = 0;
    st.vy = 0;
    st.vz = 0;
    st.speed = 0;
    st.lateralSpeed = 0;
    st.drifting = false;
    st.driftCharge = 0;
    st.driftTier = 0;
    st.driftDir = 0;
    st.driftTier3Time = 0;
    st.driftLockout = 0;
    st.offRoadTime = 0;
    st.stuckTime = 0;
    st.airborne = false;
    st.boostTime *= 0.5;
    st.steer = 0;
    st.visualYawSlip = 0;
    void raceTime;
  }

  lapTime(raceTime: number) {
    return raceTime - this.state.lapStartTime;
  }

  /** Comptabilise un tour bouclé. Renvoie true si c'est le dernier tour. */
  completeLap(raceTime: number) {
    const st = this.state;
    const t = raceTime - st.lapStartTime;
    st.lastLapTime = t;
    if (st.bestLapTime === 0 || t < st.bestLapTime) st.bestLapTime = t;
    st.lapTimes.push(t);
    st.lapStartTime = raceTime;
    st.lap += 1;
    return st.lap >= PHYSICS.race.laps;
  }
}

/* ------------------------------------------------------------------ */
/* Collisions kart ↔ kart                                             */
/* ------------------------------------------------------------------ */

const _impact = { x: 0, z: 0, power: 0 };

/**
 * Collisions circulaires avec impulsion : les karts se poussent, se percutent
 * et encaissent un "bump" visuel. O(n²) avec n ≤ 8 → négligeable.
 */
export function resolveKartCollisions(
  karts: Kart[],
  dt: number,
): Array<{ a: Kart; b: Kart; power: number; x: number; z: number }> {
  const results: Array<{ a: Kart; b: Kart; power: number; x: number; z: number }> = [];
  const R = PHYSICS.kart.radius;
  const minDist = R * 2;
  for (let i = 0; i < karts.length; i++) {
    const A = karts[i];
    const sa = A.state;
    for (let j = i + 1; j < karts.length; j++) {
      const B = karts[j];
      const sb = B.state;
      // rejet rapide
      if (Math.abs(sa.x - sb.x) > minDist + 1.5 || Math.abs(sa.z - sb.z) > minDist + 1.5) continue;
      const dx = sb.x - sa.x;
      const dz = sb.z - sa.z;
      const d = Math.hypot(dx, dz);
      if (d >= minDist || d < 1e-4) continue;

      const nx = dx / d;
      const nz = dz / d;
      const overlap = minDist - d;

      // séparation proportionnelle à la masse
      const totalMass = A.stats.mass + B.stats.mass;
      const pa = B.stats.mass / totalMass;
      const pb = A.stats.mass / totalMass;
      sa.x -= nx * overlap * pa;
      sa.z -= nz * overlap * pa;
      sb.x += nx * overlap * pb;
      sb.z += nz * overlap * pb;

      // impulsion le long de la normale
      const rvx = sb.vx - sa.vx;
      const rvz = sb.vz - sa.vz;
      const vn = rvx * nx + rvz * nz;
      const power = Math.abs(vn);
      if (vn < 0) {
        const restitution = 0.42;
        const jImp = (-(1 + restitution) * vn) / (1 / A.stats.mass + 1 / B.stats.mass);
        sa.vx -= (jImp * nx) / A.stats.mass;
        sa.vz -= (jImp * nz) / A.stats.mass;
        sb.vx += (jImp * nx) / B.stats.mass;
        sb.vz += (jImp * nz) / B.stats.mass;
        // petite rotation pour le fun
        const spin = clamp(vn * 0.04, -0.8, 0.8);
        sa.yawRate -= spin * pa;
        sb.yawRate += spin * pb;
        // recalcule les vitesses locales
        sa.speed = sa.vx * Math.sin(sa.heading) + sa.vz * Math.cos(sa.heading);
        sb.speed = sb.vx * Math.sin(sb.heading) + sb.vz * Math.cos(sb.heading);
        sa.bounce = clamp(power * 0.02, 0.05, 0.35);
        sb.bounce = clamp(power * 0.02, 0.05, 0.35);
        sa.lastImpact = 0.25;
        sb.lastImpact = 0.25;
        if (power > 1.2) {
          _impact.x = sa.x + nx * R;
          _impact.z = sa.z + nz * R;
          _impact.power = power;
          results.push({ a: A, b: B, power, x: _impact.x, z: _impact.z });
        }
      }
      void dt;
    }
  }
  return results;
}

/** Utilisé par l'IA pour viser un virage. */
export function headingTo(fromX: number, fromZ: number, toX: number, toZ: number) {
  return Math.atan2(toX - fromX, toZ - fromZ);
}

export { dampAngle };
