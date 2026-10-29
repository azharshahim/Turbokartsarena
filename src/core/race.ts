/**
 * Turbo Karts Arena — gestion de course.
 * Simule à pas fixe (120 Hz), découple la simulation du rendu, produit des
 * événements pour le rendu (particules, audio, HUD).
 */

import { DIFFICULTIES, VEHICLES, vehicleProfile, type Difficulty } from '../game/vehicles';
import { PHYSICS } from './config';
import { Kart, NEUTRAL_INPUT, resolveKartCollisions, type DriveInput } from './kart';
import { Track } from './track';
import { makeRng, clamp } from './math';
import { makeBrain, thinkAi, type AiBrain } from './ai';
import { PLAYER_PROFILE, ROSTER, type KartProfile } from '../game/roster';
import type { Circuit } from '../game/circuits';

export type RacePhase = 'countdown' | 'racing' | 'finished';

export type RaceEvent =
  | { type: 'driftTier'; kartId: number; tier: number }
  | { type: 'driftEnd'; kartId: number; tier: number; boosted: boolean }
  | { type: 'boost'; kartId: number; tier: number }
  | { type: 'pad'; kartId: number }
  | { type: 'impact'; kartId: number; otherId: number; power: number; x: number; y: number; z: number }
  | { type: 'lap'; kartId: number; lap: number; lapTime: number }
  | { type: 'respawn'; kartId: number }
  | { type: 'finish'; kartId: number; place: number; time: number }
  | { type: 'countdownTick'; value: number }
  | { type: 'go' };

export interface RaceInputs {
  player: DriveInput;
}

export interface RaceOptions {
  circuit: Circuit;
  laps?: number;
  difficulty?: Difficulty;
  playerProfile?: KartProfile;
  opponents?: number;
  rfSpeed?: number;
  catchUp?: boolean;
}

export class Race {
  readonly laps: number;
  readonly aiSpeed: number;
  readonly track: Track;
  readonly circuit: Circuit;
  readonly player: Kart;
  readonly karts: Kart[] = [];
  readonly events: RaceEvent[] = [];
  phase: RacePhase = 'countdown';
  raceTime = 0;
  countdown = PHYSICS.race.countdown;
  finishOrder: number[] = [];
  playerPlace = 1;
  catchUp: boolean;
  /** Multiplicateur global de vitesse (accessibilité). */
  speedScale: number;

  private brains = new Map<number, AiBrain>();
  private accumulator = 0;
  private lastCountdownTick = 99;
  private rng: () => number;

  constructor(opts: RaceOptions) {
    this.circuit = opts.circuit;
    this.laps = Math.round(clamp(opts.laps ?? PHYSICS.race.laps, 1, 5));
    const difficulty = opts.difficulty ? DIFFICULTIES[opts.difficulty] : undefined;
    this.aiSpeed = difficulty?.aiSpeed ?? 1;
    this.track = new Track({ ...opts.circuit, guardrails: true });
    this.catchUp = opts.catchUp ?? difficulty?.catchUp ?? true;
    this.speedScale = opts.rfSpeed ?? 1;
    this.rng = makeRng(opts.circuit.seed + 7);

    const playerProfile = opts.playerProfile ?? PLAYER_PROFILE;
    const others = ROSTER.filter((p) => p.id !== playerProfile.id);
    const opponentCount = clamp(opts.opponents ?? 5, 1, 7);

    this.player = new Kart(0, playerProfile, true);
    this.karts.push(this.player);

    for (let i = 0; i < opponentCount; i++) {
      const driver = others[i % others.length];
      const profile = playerProfile.vehicleId
        ? vehicleProfile(driver, VEHICLES[i % VEHICLES.length])
        : driver;
      const k = new Kart(i + 1, profile, false);
      k.aiSkill = difficulty?.skill ?? 0.45 + (i / Math.max(1, opponentCount - 1)) * 0.5;
      this.brains.set(k.state.id, makeBrain(this.rng, k.aiSkill));
      this.karts.push(k);
    }
    this.reset();
  }

  reset() {
    const grid = this.track.gridPositions(this.karts.length);
    this.raceTime = 0;
    this.phase = 'countdown';
    this.countdown = PHYSICS.race.countdown;
    this.accumulator = 0;
    this.lastCountdownTick = 99;
    this.finishOrder = [];
    this.playerPlace = 1;
    this.events.length = 0;
    for (let i = 0; i < this.karts.length; i++) {
      const k = this.karts[i];
      k.reset(grid[i], this.track, 0);
      k.state.speedMult = this.speedScale;
      k.aiOffsetTarget = 0;
      k.aiRetarget = 0;
    }
  }

  get finished() {
    return this.phase === 'finished';
  }

  /** Temps de course formaté mm:ss.mmm */
  get clock() {
    return formatTime(this.raceTime);
  }

  get lapDisplay() {
    return `${Math.min(this.laps, this.player.state.lap + 1)}/${this.laps}`;
  }

  /** 0..1 : progression du joueur dans le tour courant (pour le HUD). */
  get lapProgress() {
    const st = this.player.state;
    return clamp(
      st.totalDistance / this.track.length - Math.floor(st.totalDistance / this.track.length),
      0,
      1,
    );
  }

  /** Rangs de tous les karts (1 = leader). */
  computePlaces() {
    const order = [...this.karts].sort((a, b) => {
      const fa = a.state.status === 'finished';
      const fb = b.state.status === 'finished';
      if (fa && fb) return a.state.place - b.state.place;
      if (fa) return -1;
      if (fb) return 1;
      return b.state.totalDistance - a.state.totalDistance;
    });
    for (let i = 0; i < order.length; i++) order[i].state.place = i + 1;
    this.playerPlace = this.player.state.place;
    return order;
  }

  update(dt: number, inputs: RaceInputs) {
    const fixed = PHYSICS.fixedStep;
    this.accumulator += Math.min(dt, 0.25);

    let steps = 0;
    while (this.accumulator >= fixed && steps < PHYSICS.maxStepsPerFrame) {
      this.simulate(fixed, inputs);
      this.accumulator -= fixed;
      steps++;
    }
    if (steps === PHYSICS.maxStepsPerFrame) this.accumulator = 0;
  }

  private simulate(dt: number, inputs: RaceInputs) {
    // --- compte à rebours ---
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      const tick = Math.ceil(this.countdown);
      if (tick !== this.lastCountdownTick && tick > 0) {
        this.lastCountdownTick = tick;
        this.events.push({ type: 'countdownTick', value: tick });
      }
      if (this.countdown <= 0) {
        this.phase = 'racing';
        this.raceTime = 0;
        this.events.push({ type: 'go' });
        for (const k of this.karts) k.state.lapStartTime = 0;
      }
      return;
    }

    this.raceTime += dt;

    // --- entrées ---
    for (const k of this.karts) {
      let input: DriveInput;
      if (k.isPlayer) {
        input = k.state.status === 'finished' ? finishedInput : inputs.player;
      } else {
        const brain = this.brains.get(k.state.id)!;
        if (k.state.status === 'finished') input = NEUTRAL_INPUT;
        else input = thinkAi(k, brain, this.track, dt, this.raceTime, this.karts);
      }

      // équilibrage : les IA ajustent leur vitesse selon l'écart avec le joueur
      if (this.catchUp && !k.isPlayer) {
        const gap = this.player.state.totalDistance - k.state.totalDistance;
        const target = 1 + clamp(gap / PHYSICS.ai.catchupRange, -1, 1) * PHYSICS.ai.catchupBoost;
        k.state.speedMult = this.speedScale * this.aiSpeed * Math.min(1.1, Math.max(0.88, target));
      } else if (!k.isPlayer) {
        k.state.speedMult = this.speedScale * this.aiSpeed;
      } else {
        k.state.speedMult = this.speedScale;
      }

      const wasDrift = k.state.drifting;
      const prevTier = k.state.driftTier;
      const prevBoost = k.state.boostTime;
      const prevPad = k.state.boostPadTime;
      const prevLap = k.state.lap;

      k.step(dt, input, this.track, this.raceTime);

      // --- événements ---
      if (!wasDrift && k.state.drifting) {
        this.events.push({ type: 'driftTier', kartId: k.state.id, tier: 0 });
      }
      if (k.state.drifting && k.state.driftTier > prevTier) {
        this.events.push({ type: 'driftTier', kartId: k.state.id, tier: k.state.driftTier });
      }
      if (wasDrift && !k.state.drifting) {
        this.events.push({
          type: 'driftEnd',
          kartId: k.state.id,
          tier: Math.max(prevTier, k.state.boostTier),
          boosted: k.state.boostTime > prevBoost,
        });
      }
      if (k.state.boostTime > prevBoost && k.state.boostTime - prevBoost > 0.5) {
        this.events.push({ type: 'boost', kartId: k.state.id, tier: k.state.boostTier });
      }
      if (k.state.boostPadTime > prevPad && k.state.boostPadTime - prevPad > 0.3) {
        this.events.push({ type: 'pad', kartId: k.state.id });
      }

      // --- tours ---
      const lapsDone = Math.floor(k.state.totalDistance / this.track.length);
      if (lapsDone > prevLap && k.state.status === 'racing') {
        const last = k.completeLap(this.raceTime);
        this.events.push({
          type: 'lap',
          kartId: k.state.id,
          lap: k.state.lap,
          lapTime: last ? k.state.lastLapTime : k.state.lapTimes[k.state.lapTimes.length - 1],
        });
        if (k.state.lap >= this.laps) {
          k.state.status = 'finished';
          k.state.finishTime = this.raceTime;
          this.finishOrder.push(k.state.id);
          k.state.place = this.finishOrder.length;
          this.events.push({
            type: 'finish',
            kartId: k.state.id,
            place: k.state.place,
            time: this.raceTime,
          });
          if (k.isPlayer) {
            this.phase = 'finished';
            this.computePlaces();
            for (const o of this.karts) {
              if (o.state.status !== 'finished') {
                o.state.status = 'finished';
                o.state.finishTime = this.raceTime + 0.0;
              }
            }
          }
        }
      }
    }

    // --- collisions ---
    const hits = resolveKartCollisions(this.karts, dt);
    for (const h of hits) {
      this.events.push({
        type: 'impact',
        kartId: h.a.state.id,
        otherId: h.b.state.id,
        power: h.power,
        x: h.x,
        y: h.a.state.y + 0.7,
        z: h.z,
      });
    }

    // --- places ---
    this.computePlaces();
  }
}

const finishedInput: DriveInput = { steer: 0, brake: false, drift: false, throttle: 0.35 };

export function formatTime(t: number) {
  if (!isFinite(t)) return '--:--.---';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const ms = Math.floor((t % 1) * 1000);
  return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

export function formatLap(t: number) {
  const s = Math.floor(t % 60);
  const ms = Math.floor((t % 1) * 1000);
  return `${s}.${ms.toString().padStart(3, '0')}`;
}
