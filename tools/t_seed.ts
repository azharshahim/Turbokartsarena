import { Race } from '../src/core/race';
import { CIRCUITS } from '../src/game/circuits';
import { thinkAi, makeBrain } from '../src/core/ai';
import { makeRng } from '../src/core/math';
for (const circuit of CIRCUITS.slice(0,2)) {
  for (const seed of [3, 7, 11]) {
    const race = new Race({ circuit, opponents: 5 });
    const b = makeBrain(makeRng(seed), 1);
    const frame = 1/60; let onRoad = 0, frames = 0, t = 0, respawns = 0;
    while (t < 220 && race.player.state.status !== 'finished') {
      const inp = race.phase === 'racing' ? thinkAi(race.player, b, race.track, frame, race.raceTime, race.karts) : { steer: 0, brake: false, drift: false, throttle: 0 };
      race.update(frame, { player: inp });
      for (const e of race.events) if (e.type === 'respawn') respawns++;
      race.events.length = 0;
      if (race.phase === 'racing') { if (race.player.state.surface !== 'grass') onRoad++; frames++; }
      t += frame;
    }
    const st = race.player.state;
    console.log(`${circuit.name} seed=${seed} → onRoad=${(onRoad/frames*100).toFixed(1)}% tours=${st.lapTimes.map(x=>x.toFixed(1)).join(',')} respawns=${respawns} tête=${st.place}`);
  }
}
