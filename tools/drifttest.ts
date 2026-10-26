/** Vérifie qu'un joueur humain peut charger les 3 paliers de dérapage. */
import { Kart } from '../src/core/kart';
import { Track } from '../src/core/track';
import { CIRCUITS } from '../src/game/circuits';
import { ROSTER } from '../src/game/roster';

const track = new Track(CIRCUITS[0]);
const k = new Kart(0, ROSTER[0], true);
k.reset(track.gridPositions(1)[0], track, 0);
const st = k.state;
st.vx = Math.sin(st.heading) * 30; st.vz = Math.cos(st.heading) * 30;
st.speed = 30;
const dt = 1/120;
console.log('Temps pour atteindre chaque palier (dérapage maintenu, braquage plein) :');
let t = 0; const reached: Record<number, number> = {};
for (let i = 0; i < 120*4; i++) {
  // on maintient dérapage + braquage, en corrigeant pour rester globalement droit
  const inp = { steer: 0.85, drift: true, brake: false, throttle: 1 };
  k.step(dt, inp, track, t);
  t += dt;
  if (st.driftTier > 0 && reached[st.driftTier] === undefined) {
    reached[st.driftTier] = t;
    console.log(`  palier ${st.driftTier} (${['','bleu','orange','violet'][st.driftTier]}) à t=${t.toFixed(2)}s, charge=${st.driftCharge.toFixed(2)}`);
  }
  if (st.driftTier === 3 && t > reached[3] + 0.2) break;
}
// relâchement → boost ?
const before = st.speed;
const inp2 = { steer: 0, drift: false, brake: false, throttle: 1 };
for (let i = 0; i < 12; i++) k.step(dt, inp2, track, t + i*dt);
console.log(`après relâchement : boostTime=${(st.boostTime).toFixed(2)}s, palier=${st.boostTier}, +${(((st.speed-before))*3.6).toFixed(0)} km/h immédiat`);
let maxV = 0;
for (let i = 0; i < 120*2; i++) { k.step(dt, inp2, track, t+i*dt); maxV = Math.max(maxV, st.speed); }
console.log(`vitesse max pendant le turbo : ${(maxV*3.6).toFixed(0)} km/h (Vmax de base ${(k.stats.maxSpeed*3.6).toFixed(0)})`);
