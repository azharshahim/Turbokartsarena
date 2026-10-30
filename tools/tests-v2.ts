import assert from 'node:assert/strict';
import { CIRCUITS } from '../src/game/circuits';
import { ROSTER } from '../src/game/roster';
import { VEHICLES, vehicleProfile } from '../src/game/vehicles';
import { Race } from '../src/core/race';
import { Kart, effectiveStats, resolveKartCollisions } from '../src/core/kart';
import { Track } from '../src/core/track';
import { makeBrain, thinkAi } from '../src/core/ai';
import { makeRng } from '../src/core/math';
import { buildHazards, hazardSignPosition, upcomingHazard } from '../src/core/hazards';
import { createVehicle } from '../src/render/vehicles';
import { QUALITY } from '../src/core/config';
import { Box3 } from 'three';
let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`PASS ${name}`);
}
test('8 circuits, 8 independent vehicles and 12 distinct drivers', () => {
  assert.ok(CIRCUITS.length >= 8); // V3 : les 8 circuits V2 sont conservés (vérifiés ci-dessous)
  assert.ok(VEHICLES.length >= 8);
  assert.equal(ROSTER.length, 12);
  assert.equal(new Set(ROSTER.map((p) => p.id)).size, 12);
  assert.equal(new Set(ROSTER.map((p) => p.suitColor)).size, 12);
  assert.ok(VEHICLES.filter((v) => v.kind === 'kart').length >= 4);
  assert.ok(VEHICLES.filter((v) => v.kind === 'sport').length >= 2);
  assert.equal(new Set(CIRCUITS.map((c) => JSON.stringify(c.control))).size, CIRCUITS.length);
});
for (const circuit of CIRCUITS)
  test(`${circuit.name}: hazards reflect actual geometry/features and signs clear all road ribbons`, () => {
    const track = new Track(circuit),
      hazards = buildHazards(track, circuit);
    assert.ok(hazards.length > 0);
    let placed = 0;
    for (const h of hazards) {
      const s = track.sampleAtDistance(h.s);
      if (h.kind === 'left') assert.ok(s.curvature > 0.018);
      if (h.kind === 'right') assert.ok(s.curvature < -0.018);
      if (h.kind === 'slippery') assert.ok(circuit.rain);
      if (h.kind === 'tunnel' || h.kind === 'works' || h.kind === 'rocks' || h.kind === 'bridge')
        assert.ok(
          circuit.features?.some((f) => f.kind === h.kind && Math.abs(f.start * track.length - h.s) < 0.01),
        );
      const sign = hazardSignPosition(track, h);
      if (sign) {
        placed++;
        assert.ok(track.samples.every((p) => Math.hypot(p.x - sign.x, p.z - sign.z) > p.halfWidth + 2));
      }
      const warning = upcomingHazard([h], (h.s - 30 + track.length) % track.length, track.length, 20);
      assert.ok(warning);
      assert.ok(Math.abs(warning.distance - 30) < 0.01);
      assert.equal(upcomingHazard([h], (h.s + 10) % track.length, track.length, 20), null);
    }
    assert.ok(placed > 0);
  });
for (const vehicle of VEHICLES)
  test(`${vehicle.name}: detailed meshes, independent rider posture and LOD`, () => {
    for (const driver of ROSTER) {
      const profile = vehicleProfile(driver, vehicle),
        model = createVehicle(profile, QUALITY.low);
      assert.equal(model.wheels.length, vehicle.kind === 'kart' ? 4 : 2);
      assert.equal(model.frontWheels.length, vehicle.kind === 'kart' ? 2 : 1);
      assert.ok(model.driver.head.position.y > (vehicle.kind === 'kart' ? 1 : 1.6));
      model.root.updateMatrixWorld(true);
      const box = new Box3().setFromObject(model.root);
      assert.ok(box.max.y > 1.3 && box.max.y < 3);
      let vertices = 0;
      model.body.traverse((o: any) => {
        if (o.isMesh) {
          const a = o.geometry.getAttribute('position');
          vertices += a.count;
          for (let i = 0; i < a.array.length; i++) assert.ok(Number.isFinite(a.array[i]));
        }
      });
      assert.ok(vertices > 1500, 'geometry must contain the detailed model');
      model.dispose();
    }
  });
test('motorcycle braking, acceleration, corner lean and stability differ from karts', () => {
  const track = new Track(CIRCUITS[0]);
  const results = [];
  for (const index of [0, 4, 6, 7]) {
    const p = vehicleProfile(ROSTER[0], VEHICLES[index]),
      k = new Kart(0, p, true);
    k.reset(track.gridPositions(1)[0], track, 0);
    for (let i = 0; i < 120; i++)
      k.step(1 / 120, { steer: 0, drift: false, brake: false, throttle: 1 }, track, i / 120);
    const acceleration = k.state.speed;
    k.state.speed = 25;
    k.state.vx = Math.sin(k.state.heading) * 25;
    k.state.vz = Math.cos(k.state.heading) * 25;
    for (let i = 0; i < 20; i++)
      k.step(1 / 120, { steer: 0.4, drift: false, brake: false, throttle: 1 }, track, i / 120);
    results.push({ acceleration, roll: Math.abs(k.state.visualRoll), stats: effectiveStats(p) });
  }
  assert.ok(results[1].acceleration > results[0].acceleration);
  assert.ok(results[1].roll > results[0].roll * 2);
  assert.ok(results[1].stats.brake > results[0].stats.brake);
  assert.ok(results[3].stats.stability > results[1].stats.stability);
});
test('all vehicle pairs collide with finite positions and mass-weighted separation', () => {
  const track = new Track(CIRCUITS[0]);
  for (const va of VEHICLES)
    for (const vb of VEHICLES) {
      const a = new Kart(0, vehicleProfile(ROSTER[0], va), true),
        b = new Kart(1, vehicleProfile(ROSTER[1], vb), false);
      a.reset(track.gridPositions(2)[0], track, 0);
      b.reset(track.gridPositions(2)[1], track, 0);
      b.state.x = a.state.x + 1;
      b.state.z = a.state.z;
      a.state.vx = 10;
      b.state.vx = -10;
      assert.equal(resolveKartCollisions([a, b], 1 / 120).length, 1);
      assert.ok(Number.isFinite(a.state.x) && Number.isFinite(b.state.x));
      assert.ok(b.state.x - a.state.x > 1);
    }
});
test('difficulty changes AI without changing the player and lap count is respected', () => {
  const easy = new Race({ circuit: CIRCUITS[0], difficulty: 'discovery', laps: 1 }),
    hard = new Race({ circuit: CIRCUITS[0], difficulty: 'expert', laps: 5 });
  assert.ok(easy.aiSpeed < hard.aiSpeed);
  assert.equal(easy.player.stats.maxSpeed, hard.player.stats.maxSpeed);
  assert.equal(easy.laps, 1);
  assert.equal(hard.laps, 5);
});
test('guardrails stop outward motion and wet roads reduce lateral grip', () => {
  const race = new Race({ circuit: CIRCUITS[0], playerProfile: vehicleProfile(ROSTER[0], VEHICLES[0]) });
  const k = race.player,
    track = race.track,
    sample = track.sampleAtDistance(50);
  const position = track.worldAt(50, sample.halfWidth + 1.3);
  k.state.x = position.x;
  k.state.y = position.y;
  k.state.z = position.z;
  k.state.heading = Math.atan2(sample.tx, sample.tz);
  k.state.vx = sample.tx * 10 + sample.rx * 20;
  k.state.vz = sample.tz * 10 + sample.rz * 20;
  k.state.trackIndex = track.query(position.x, position.z, 0, false).index;
  k.step(1 / 60, { steer: 0, brake: false, drift: false, throttle: 0 }, track, 0);
  assert.ok(track.query(k.state.x, k.state.z, k.state.trackIndex).lateral <= sample.halfWidth + 1.5);
  assert.ok(k.state.vx * sample.rx + k.state.vz * sample.rz < 2);
  const lateral: number[] = [];
  for (const rain of [false, true]) {
    const tr = new Track({ ...CIRCUITS[0], rain });
    const kart = new Kart(0, vehicleProfile(ROSTER[0], VEHICLES[4]), true);
    kart.reset(tr.gridPositions(1)[0], tr, 0);
    const h = kart.state.heading;
    kart.state.vx = Math.sin(h) * 25 + Math.cos(h) * 5;
    kart.state.vz = Math.cos(h) * 25 - Math.sin(h) * 5;
    kart.state.speed = 25;
    kart.step(1 / 120, { steer: 0, brake: false, drift: false, throttle: 0 }, tr, 0);
    lateral.push(Math.abs(kart.state.lateralSpeed));
  }
  assert.ok(lateral[1] > lateral[0]);
});
for (const circuit of CIRCUITS)
  for (const vehicle of VEHICLES)
    test(`${circuit.name} / ${vehicle.name}: AI-driven complete timed race`, () => {
      const race = new Race({
        circuit,
        playerProfile: vehicleProfile(ROSTER[0], vehicle),
        opponents: 7,
        laps: 1,
        catchUp: false,
      });
      const brain = makeBrain(makeRng(7), 1);
      let frames = 0,
        onRoad = 0;
      for (let t = 0; t < 150 && race.phase !== 'finished'; t += 1 / 60) {
        race.update(1 / 60, {
          player: thinkAi(race.player, brain, race.track, 1 / 60, race.raceTime, race.karts),
        });
        race.events.length = 0;
        if (race.phase === 'racing') {
          frames++;
          if (race.player.state.onRoad) onRoad++;
        }
      }
      assert.equal(race.phase, 'finished');
      assert.equal(race.player.state.lapTimes.length, 1);
      assert.ok(race.player.state.finishTime > 15 && race.player.state.finishTime < 150);
      assert.ok(onRoad / frames > 0.75, `only ${((100 * onRoad) / frames).toFixed(0)}% on road`);
      assert.ok(race.karts.every((k) => Number.isFinite(k.state.x) && Number.isFinite(k.state.speed)));
    });
console.log(`${passed} V2 checks passed.`);
