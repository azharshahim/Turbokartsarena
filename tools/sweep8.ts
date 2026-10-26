import { Race } from '../src/core/race';
import { CIRCUITS } from '../src/game/circuits';
import { thinkAi, makeBrain, AI_TUNING } from '../src/core/ai';
import { makeRng } from '../src/core/math';
function evalAI(over: Partial<typeof AI_TUNING>) {
  const saved = { ...AI_TUNING }; Object.assign(AI_TUNING, over);
  let onRoad = 0, frames = 0, dist = 0, minSeed = 100;
  for (const c of CIRCUITS) for (const seed of [3, 7]) {
    const race = new Race({ circuit: c, opponents: 5 });
    const b = makeBrain(makeRng(seed), 1);
    const dt = 1/60; let ok = 0, fr = 0;
    for (let i = 0; i < 60*45; i++) {
      const inp = race.phase === 'racing' ? thinkAi(race.player, b, race.track, dt, race.raceTime, race.karts) : { steer: 0, brake: false, drift: false, throttle: 0 };
      race.update(dt, { player: inp }); race.events.length = 0;
      if (race.player.state.surface !== 'grass') ok++; fr++;
    }
    onRoad += ok / fr; frames++; dist += race.player.state.totalDistance;
    minSeed = Math.min(minSeed, ok / fr);
  }
  Object.assign(AI_TUNING, saved);
  return { onRoad: onRoad / frames, worst: minSeed, dist: dist / frames };
}
const base = { headingGain: 4.6, aLat: 30, lookAheadSpeed: 0.4, pursuitBlend: 0 };
const space: Array<Partial<typeof AI_TUNING>> = [];
for (const aLat of [14, 18, 24, 30])
  for (const cornerMargin of [0.86, 0.93, 1.0])
  for (const lineAggression of [0.2, 0.35, 0.6])
  for (const ffGain of [0.45, 0.75])
    space.push({ ...base, aLat, cornerMargin, lineAggression, ffGain });
const res = space.map(p => ({ p, m: evalAI(p) }))
  .sort((a,b) => (b.m.worst*200 + b.m.onRoad*200 + b.m.dist/60) - (a.m.worst*200 + a.m.onRoad*200 + a.m.dist/60));
for (const r of res.slice(0, 10))
  console.log(`aLat=${r.p.aLat} margin=${r.p.cornerMargin} line=${r.p.lineAggression} ff=${r.p.ffGain} → moy=${(r.m.onRoad*100).toFixed(1)}% pire=${(r.m.worst*100).toFixed(1)}% dist=${r.m.dist.toFixed(0)}m`);
