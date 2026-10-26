/**
 * Turbo Karts Arena — tests du moteur (aucun navigateur requis).
 *   npx esbuild tools/tests.ts --bundle --platform=node --format=cjs --outfile=/tmp/t.cjs && node /tmp/t.cjs
 * ou : npm test
 */

import { Kart, resolveKartCollisions } from '../src/core/kart';
import { Track } from '../src/core/track';
import { Race, formatTime } from '../src/core/race';
import { CIRCUITS } from '../src/game/circuits';
import { ROSTER } from '../src/game/roster';
import { makeBrain, thinkAi } from '../src/core/ai';
import { makeRng } from '../src/core/math';
import { PHYSICS, autoQuality } from '../src/core/config';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e: any) {
    failed++;
    failures.push(name);
    console.log(`  ❌ ${name}\n     ${e.message}`);
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function near(actual: number, min: number, max: number, label: string) {
  assert(
    actual >= min && actual <= max,
    `${label} hors plage : ${actual.toFixed(3)} (attendu ${min}…${max})`,
  );
}

const dt = PHYSICS.fixedStep;

/* ================================================================== */
console.log('\n▸ Convention d’axes');
/* ================================================================== */

test('input.steer +1 fait aller le kart à DROITE', () => {
  const track = new Track(CIRCUITS[0]);
  const grid = track.gridPositions(1)[0];
  const run = (steer: number) => {
    const k = new Kart(0, ROSTER[0], true);
    k.reset(grid, track, 0);
    const st = k.state;
    st.vx = Math.sin(st.heading) * 20;
    st.vz = Math.cos(st.heading) * 20;
    const rx = -Math.cos(st.heading);
    const rz = Math.sin(st.heading);
    const x0 = st.x;
    const z0 = st.z;
    for (let i = 0; i < 72; i++) k.step(dt, { steer, brake: false, drift: false, throttle: 1 }, track, i * dt);
    return (st.x - x0) * rx + (st.z - z0) * rz;
  };
  const right = run(1);
  const left = run(-1);
  assert(right > 1.5, `steer +1 devrait aller à droite (obtenu ${right.toFixed(2)} m)`);
  assert(left < -1.5, `steer -1 devrait aller à gauche (obtenu ${left.toFixed(2)} m)`);
});

test('le cap, la piste et la trajectoire utilisent la même convention', () => {
  const track = new Track(CIRCUITS[0]);
  for (let s = 0; s < track.length; s += 7) {
    const smp = track.sampleAtDistance(s);
    const rail = track.racingLineOffset(s);
    // trajectoire en virage à gauche (curvature>0) ⇒ corde à droite (rail>0)
    if (smp.curvature > 0.012) assert(rail >= -0.01, `corde du mauvais côté à s=${s.toFixed(0)}`);
    if (smp.curvature < -0.012) assert(rail <= 0.01, `corde du mauvais côté à s=${s.toFixed(0)}`);
  }
});

/* ================================================================== */
console.log('\n▸ Pistes');
/* ================================================================== */

for (const circuit of CIRCUITS) {
  test(`${circuit.name} : géométrie jouable`, () => {
    const track = new Track(circuit);
    near(track.length, 800, 1600, 'longueur (m)');
    assert(track.count > 300, 'pas assez d’échantillons');

    // pas de rayon de virage absurde
    let maxCurv = 0;
    for (const s of track.samples) maxCurv = Math.max(maxCurv, Math.abs(s.curvature));
    // Un kart tourne sur ~5 m de rayon à 40 km/h : 10 m est largement jouable.
    assert(1 / maxCurv > 9, `rayon minimal trop serré : ${(1 / maxCurv).toFixed(1)} m`);

    // la piste ne se recoupe pas (distance mini entre points éloignés)
    let minDist = Infinity;
    for (let i = 0; i < track.count; i += 3) {
      for (let j = i + 40; j < track.count - 20; j += 3) {
        const a = track.samples[i];
        const b = track.samples[j];
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        if (d < minDist) minDist = d;
      }
    }
    assert(minDist > 22, `piste qui se croise : ${minDist.toFixed(1)} m entre deux tronçons`);

    // la requête de proximité doit retrouver la piste depuis un point hors-piste
    const bad = track.query(track.samples[10].x + 400, track.samples[10].z + 400, 10);
    assert(bad.surface === 'grass', 'un point lointain doit être hors piste');

    // une position sur la piste doit être reconnue comme route
    const onTrack = track.query(track.samples[42].x, track.samples[42].z, 42);
    assert(onTrack.onRoad && Math.abs(onTrack.lateral) < 0.3, 'point central mal classé');
  });
}

test('déterminisme : deux constructions identiques donnent la même piste', () => {
  const a = new Track(CIRCUITS[1]);
  const b = new Track(CIRCUITS[1]);
  for (let i = 0; i < a.count; i += 13) {
    assert(Math.abs(a.samples[i].x - b.samples[i].x) < 1e-6, 'positions divergentes');
    assert(Math.abs(a.samples[i].halfWidth - b.samples[i].halfWidth) < 1e-6, 'largeurs divergentes');
  }
});

/* ================================================================== */
console.log('\n▸ Physique (accélération auto, freinage, vitesse)');
/* ================================================================== */

/**
 * Piste de test : « stade » (deux longues lignes droites + deux virages).
 * On démarre au début de la ligne droite pour mesurer l'accélération et la
 * vitesse de pointe sans que le kart ne quitte la piste.
 */
export const TEST_TRACK = new Track({
  id: 'test-straight',
  name: 'Banc de test',
  theme: 'test',
  seed: 1,
  width: 44,
  widthVariance: 0,
  grandstands: 0,
  boosts: [],
  maxCurvature: 1,
  smoothIterations: 0,
  smoothStrength: 0,
  control: [
    { x: -400, y: 0, z: -450 },
    { x: -400, y: 0, z: -150 },
    { x: -400, y: 0, z: 150 },
    { x: -400, y: 0, z: 450 },
    { x: -200, y: 0, z: 640 },
    { x: 200, y: 0, z: 640 },
    { x: 400, y: 0, z: 450 },
    { x: 400, y: 0, z: 150 },
    { x: 400, y: 0, z: -150 },
    { x: 400, y: 0, z: -450 },
    { x: 200, y: 0, z: -640 },
    { x: -200, y: 0, z: -640 },
  ],
});

const track0 = TEST_TRACK;
const raceTrack0 = new Track(CIRCUITS[0]);
/** Point de départ au début de la plus longue ligne droite. */
const straightStart = (() => {
  const n = track0.count;
  let best = 0;
  let bestLen = 0;
  for (let i = 0; i < n; i++) {
    let len = 0;
    for (let k = 0; k < 200; k++) {
      if (Math.abs(track0.samples[(i + k) % n].curvature) > 0.004) break;
      len++;
    }
    if (len > bestLen) {
      bestLen = len;
      best = i;
    }
  }
  return { index: best, length: bestLen * track0.step };
})();

function startOnStraight() {
  const k = new Kart(0, ROSTER[0], true);
  const smp = track0.samples[straightStart.index];
  k.reset({ x: smp.x, y: smp.y, z: smp.z, heading: Math.atan2(smp.tx, smp.tz) }, track0, 0);
  return k;
}

function straightRun(seconds: number, input = { steer: 0, brake: false, drift: false, throttle: 1 }) {
  const k = startOnStraight();
  const marks: Array<{ t: number; v: number }> = [];
  for (let i = 0; i < seconds / dt; i++) {
    k.step(dt, input, track0, i * dt);
    marks.push({ t: i * dt, v: k.state.speed });
  }
  return { k, marks };
}

test('accélération automatique : 0 → 100 km/h en 2 à 4 s', () => {
  const { marks } = straightRun(8);
  const t100 = marks.find((m) => m.v * 3.6 >= 100)?.t ?? Infinity;
  near(t100, 2.0, 4.0, 'temps 0-100 km/h (s)');
});

test('vitesse de pointe entre 130 et 160 km/h sans turbo', () => {
  const { marks } = straightRun(26);
  const vmax = Math.max(...marks.map((m) => m.v)) * 3.6;
  near(vmax, 130, 160, 'vitesse de pointe (km/h)');
});

test('freinage : arrêt depuis 120 km/h en moins de 45 m', () => {
  const k = startOnStraight();
  const st = k.state;
  st.speed = 33;
  st.vx = Math.sin(st.heading) * 33;
  st.vz = Math.cos(st.heading) * 33;
  const x0 = st.x;
  const z0 = st.z;
  let t = 0;
  while (st.speed > 0.5 && t < 6) {
    k.step(dt, { steer: 0, brake: true, drift: false, throttle: 0 }, track0, t);
    t += dt;
  }
  const dist = Math.hypot(st.x - x0, st.z - z0);
  assert(st.speed <= 0.9, `le kart ne s’arrête pas (${(st.speed * 3.6).toFixed(0)} km/h)`);
  assert(dist < 45, `distance de freinage trop longue : ${dist.toFixed(1)} m`);
});

test('frein maintenu à l’arrêt ⇒ marche arrière', () => {
  const k = startOnStraight();
  for (let i = 0; i < 120 * 2; i++) k.step(dt, { steer: 0, brake: true, drift: false, throttle: 0 }, track0, i * dt);
  assert(k.state.speed < -1, 'pas de marche arrière');
  assert(k.state.speed > -PHYSICS.kart.reverseMaxSpeed - 1, 'marche arrière trop rapide');
});

/* ================================================================== */
console.log('\n▸ Dérapage et turbo (3 paliers)');
/* ================================================================== */

test('les 3 paliers sont atteignables et bien ordonnés', () => {
  const k = startOnStraight();
  const st = k.state;
  st.speed = 30;
  st.vx = Math.sin(st.heading) * 30;
  st.vz = Math.cos(st.heading) * 30;
  const reached: Record<number, number> = {};
  let t = 0;
  for (let i = 0; i < 120 * 4; i++) {
    k.step(dt, { steer: 0.85, drift: true, brake: false, throttle: 1 }, track0, t);
    t += dt;
    if (st.driftTier > 0 && reached[st.driftTier] === undefined) reached[st.driftTier] = t;
    if (st.driftTier === 3 && t > (reached[3] ?? 0) + 0.15) break;
  }
  assert(reached[1] !== undefined, 'palier bleu jamais atteint');
  assert(reached[2] !== undefined, 'palier orange jamais atteint');
  assert(reached[3] !== undefined, 'palier violet jamais atteint');
  assert(reached[1] < reached[2] && reached[2] < reached[3], 'paliers dans le désordre');
  near(reached[3], 1.0, 2.6, 'temps pour le palier violet (s)');
});

test('relâcher le dérapage déclenche un turbo proportionné au palier', () => {
  const measure = (holdSeconds: number) => {
    const k = startOnStraight();
    const st = k.state;
    st.speed = 32;
    st.vx = Math.sin(st.heading) * 32;
    st.vz = Math.cos(st.heading) * 32;
    let t = 0;
    for (; t < holdSeconds; t += dt) {
      k.step(dt, { steer: 0.8, drift: true, brake: false, throttle: 1 }, track0, t);
    }
    const vBefore = st.speed;
    const tier = st.driftTier;
    for (let i = 0; i < 6; i++) k.step(dt, { steer: 0, drift: false, brake: false, throttle: 1 }, track0, t + i * dt);
    return { boost: st.boostTime, tier, gain: st.speed - vBefore, dur: PHYSICS.drift.boostDuration[tier] };
  };
  const small = measure(0.55);
  const big = measure(1.6);
  assert(small.boost > 0, 'aucun turbo sur un dérapage court');
  assert(big.boost > small.boost, 'le turbo ne récompense pas un dérapage plus long');
  assert(big.gain > 4, `impulsion de turbo trop faible (${big.gain.toFixed(1)} m/s)`);
  assert(big.tier === 3, `palier violet attendu, obtenu ${big.tier}`);
});

test('le dérapage ne permet pas de dépasser largement le plafond de vitesse', () => {
  const k = startOnStraight();
  const st = k.state;
  st.speed = 30;
  st.vx = Math.sin(st.heading) * 30;
  st.vz = Math.cos(st.heading) * 30;
  let maxV = 0;
  let t = 0;
  for (let phase = 0; phase < 6; phase++) {
    for (let i = 0; i < 120; i++) {
      k.step(dt, { steer: 0.7, drift: true, brake: false, throttle: 1 }, track0, t);
      t += dt;
      maxV = Math.max(maxV, st.speed);
    }
    for (let i = 0; i < 90; i++) {
      k.step(dt, { steer: 0, drift: false, brake: false, throttle: 1 }, track0, t);
      t += dt;
      maxV = Math.max(maxV, st.speed);
    }
  }
  const ratio = maxV / (k.stats.maxSpeed * 1.4);
  assert(ratio < 1.05, `vitesse excessive : ${(maxV * 3.6).toFixed(0)} km/h`);
});

/* ================================================================== */
console.log('\n▸ Collisions entre karts');
/* ================================================================== */

test('deux karts qui se percutent se repoussent sans se traverser', () => {
  const a = new Kart(0, ROSTER[0], true);
  const b = new Kart(1, ROSTER[1], false);
  const grid = track0.gridPositions(2);
  a.reset(grid[0], track0, 0);
  b.reset(grid[1], track0, 0);
  // on les place face à face
  b.state.x = a.state.x + 1.2;
  b.state.z = a.state.z;
  a.state.vx = 20;
  a.state.vz = 0;
  b.state.vx = -20;
  b.state.vz = 0;
  a.state.speed = 20;
  b.state.speed = 20;
  const events = resolveKartCollisions([a, b], dt);
  const dist = Math.hypot(a.state.x - b.state.x, a.state.z - b.state.z);
  assert(events.length === 1, 'collision non détectée');
  assert(dist >= PHYSICS.kart.radius * 1.9, `karts encore superposés (${dist.toFixed(2)} m)`);
  assert(a.state.vx < 20, 'le kart A n’a pas été ralenti');
  assert(events[0].power > 1, 'impulsion trop faible');
});

test('un kart lourd pousse un kart léger', () => {
  const light = new Kart(0, ROSTER.find((p) => p.id === 'teo')!, true);
  const heavy = new Kart(1, ROSTER.find((p) => p.id === 'iron')!, false);
  const grid = track0.gridPositions(2);
  light.reset(grid[0], track0, 0);
  heavy.reset(grid[1], track0, 0);
  heavy.state.x = light.state.x + 1.5;
  heavy.state.z = light.state.z;
  const xl = light.state.x;
  const xh = heavy.state.x;
  resolveKartCollisions([light, heavy], dt);
  const movedLight = Math.abs(light.state.x - xl);
  const movedHeavy = Math.abs(heavy.state.x - xh);
  assert(movedLight > movedHeavy, 'la masse n’influence pas la poussée');
});

/* ================================================================== */
console.log('\n▸ Course complète (IA)');
/* ================================================================== */

for (const circuit of CIRCUITS.slice(0, 2)) {
  test(`${circuit.name} : 3 tours bouclés par l’IA, sans blocage`, () => {
    const race = new Race({ circuit, opponents: 5 });
    const brain = makeBrain(makeRng(7), 1);
    const frame = 1 / 60;
    let onRoad = 0;
    let frames = 0;
    let respawns = 0;
    let t = 0;
    while (t < 220 && race.player.state.status !== 'finished') {
      const input =
        race.phase === 'racing'
          ? thinkAi(race.player, brain, race.track, frame, race.raceTime, race.karts)
          : { steer: 0, brake: false, drift: false, throttle: 0 };
      race.update(frame, { player: input });
      for (const e of race.events) if (e.type === 'respawn') respawns++;
      race.events.length = 0;
      if (race.phase === 'racing') {
        if (race.player.state.surface !== 'grass') onRoad++;
        frames++;
      }
      t += frame;
    }
    const st = race.player.state;
    assert(st.status === 'finished', `course non terminée (tour ${st.lap})`);
    assert(st.lapTimes.length === PHYSICS.race.laps, `${st.lapTimes.length} tours comptés`);
    // Tolérance arcade : les IA se battent, coupent et débordent un peu, comme
    // un adversaire humain. Ce qui compte : elles bouclent les 3 tours.
    assert(onRoad / frames > 0.8, `l’IA sort trop souvent : ${((onRoad / frames) * 100).toFixed(0)} % sur piste`);
    assert(respawns <= 2, `${respawns} réapparitions : pilotage instable`);
    // un tour doit être cohérent : ni 5 s ni 3 minutes
    for (const lap of st.lapTimes) near(lap, 20, 75, 'temps au tour (s)');
  });
}

test('classement cohérent (le leader a parcouru le plus de distance)', () => {
  const race = new Race({ circuit: CIRCUITS[0], opponents: 5 });
  const brain = makeBrain(makeRng(3), 1);
  for (let i = 0; i < 60 * 40; i++) {
    const input =
      race.phase === 'racing'
        ? thinkAi(race.player, brain, race.track, 1 / 60, race.raceTime, race.karts)
        : { steer: 0, brake: false, drift: false, throttle: 0 };
    race.update(1 / 60, { player: input });
    race.events.length = 0;
  }
  const order = race.computePlaces();
  for (let i = 1; i < order.length; i++) {
    assert(
      order[i - 1].state.totalDistance >= order[i].state.totalDistance - 1e-6,
      'classement incohérent',
    );
    assert(order[i].state.place === i + 1, 'numéro de place incohérent');
  }
});

test('le compte à rebours bloque bien les karts', () => {
  const race = new Race({ circuit: CIRCUITS[0], opponents: 3 });
  const z0 = race.player.state.z;
  for (let i = 0; i < 60; i++) race.update(1 / 60, { player: { steer: 0, brake: false, drift: false, throttle: 1 } });
  assert(race.phase === 'countdown', 'la course a démarré trop tôt');
  assert(Math.abs(race.player.state.z - z0) < 0.4, 'le kart bouge pendant le compte à rebours');
  for (let i = 0; i < 60 * 4; i++) race.update(1 / 60, { player: { steer: 0, brake: false, drift: false, throttle: 1 } });
  assert(race.phase === 'racing', 'la course ne démarre pas');
  assert(race.player.state.speed > 3, 'le kart n’accélère pas après le départ');
});

/* ================================================================== */
console.log('\n▸ Format et qualité');
/* ================================================================== */

test('formatage des temps', () => {
  assert(formatTime(0) === '0:00.000', formatTime(0));
  assert(formatTime(65.4321) === '1:05.432', formatTime(65.4321));
});

test('détection automatique de la qualité', () => {
  assert(autoQuality({ isNative: true, gpuRenderer: 'Mali-400 MP', totalMemoryGB: 1, logicalCores: 4 }) === 'low', 'vieil appareil mal détecté');
  assert(autoQuality({ isNative: true, gpuRenderer: 'Adreno (TM) 740', totalMemoryGB: 12, logicalCores: 8 }) === 'ultra', 'flagship mal détecté');
  assert(autoQuality({ isNative: true, gpuRenderer: '', totalMemoryGB: 4, logicalCores: 6 }) === 'high', 'milieu de gamme mal détecté');
});

test('stats des personnages : aucun archétype dominan', () => {
  // aucun kart ne doit être meilleur partout
  for (const a of ROSTER) {
    const betterEverywhere = ROSTER.some(
      (b) =>
        b.id !== a.id &&
        b.speed >= a.speed &&
        b.accel >= a.accel &&
        b.grip >= a.grip &&
        b.handling >= a.handling &&
        (b.speed > a.speed || b.accel > a.accel || b.grip > a.grip || b.handling > a.handling),
    );
    assert(!betterEverywhere, `${a.name} est dominé par un autre kart`);
  }
});

/* ================================================================== */
console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} test(s) réussi(s), ${failed} échec(s)`);
if (failed > 0) {
  console.log('Échecs :', failures.join(', '));
  process.exit(1);
}
