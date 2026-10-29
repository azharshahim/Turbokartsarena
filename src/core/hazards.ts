import type { Circuit } from '../game/circuits';
import type { Track } from './track';
export type HazardKind =
  | 'left'
  | 'right'
  | 'bends'
  | 'descent'
  | 'slippery'
  | 'narrow'
  | 'works'
  | 'rocks'
  | 'tunnel'
  | 'bridge';
export const HAZARD_LABELS: Record<HazardKind, string> = {
  left: 'Virage à gauche',
  right: 'Virage à droite',
  bends: 'Succession de virages',
  descent: 'Forte descente',
  slippery: 'Chaussée glissante',
  narrow: 'Rétrécissement',
  works: 'Travaux en accotement',
  rocks: 'Rochers en bordure',
  tunnel: 'Entrée de tunnel',
  bridge: 'Passage sur viaduc',
};
export interface Hazard {
  kind: HazardKind;
  s: number;
  signS: number;
  label: string;
}
export function buildHazards(track: Track, circuit: Circuit): Hazard[] {
  const result: Hazard[] = [];
  const add = (kind: HazardKind, s: number) => {
    s = (s + track.length) % track.length;
    if (
      result.some(
        (h) => h.kind === kind && Math.min(Math.abs(h.s - s), track.length - Math.abs(h.s - s)) < 90,
      )
    )
      return;
    result.push({ kind, s, signS: (s - 45 + track.length) % track.length, label: HAZARD_LABELS[kind] });
  };
  for (let s = 0; s < track.length; s += 30) {
    const p = track.sampleAtDistance(s),
      next = track.sampleAtDistance(s + 30);
    if (Math.abs(p.curvature) > 0.018) add(p.curvature > 0 ? 'left' : 'right', s);
    if (p.curvature * next.curvature < -0.00015) add('bends', s);
    if ((next.y - p.y) / 30 < -0.085) add('descent', s);
    if (p.halfWidth - next.halfWidth > 1.4) add('narrow', s + 30);
  }
  for (const feature of circuit.features ?? []) add(feature.kind, feature.start * track.length);
  if (circuit.rain) for (const fraction of [0.12, 0.5, 0.82]) add('slippery', fraction * track.length);
  return result.sort((a, b) => a.s - b.s);
}
export function upcomingHazard(
  hazards: Hazard[],
  s: number,
  length: number,
  speed: number,
): { hazard: Hazard; distance: number } | null {
  const reach = Math.max(45, Math.min(100, Math.abs(speed) * 2.5));
  let nearest: Hazard | undefined;
  let distance = Infinity;
  for (const hazard of hazards) {
    const d = (hazard.s - s + length) % length;
    if (d < reach && d < distance) {
      nearest = hazard;
      distance = d;
    }
  }
  return nearest ? { hazard: nearest, distance } : null;
}
/** Locate signs outside every ribbon, not just the local edge of an S bend. */
export function hazardSignPosition(track: Track, hazard: Hazard) {
  const p = track.sampleAtDistance(hazard.signS);
  for (const extra of [3.5, 6, 9])
    for (const side of [1, -1]) {
      const distance = p.halfWidth + extra,
        x = p.x + p.rx * distance * side,
        z = p.z + p.rz * distance * side;
      if (track.samples.every((s) => Math.hypot(s.x - x, s.z - z) > s.halfWidth + 2))
        return { x, y: p.y, z, heading: Math.atan2(p.tx, p.tz) + Math.PI };
    }
  return null;
}
