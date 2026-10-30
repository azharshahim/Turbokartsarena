import * as assert from 'node:assert';
import { CIRCUITS, THEMES } from '../src/game/circuits';
import { terrainFactors, terrainForTheme, TERRAIN_PHYSICS } from '../src/core/terrain';
import { terrainTexture } from '../src/render/textures';
import { createGiftMesh, updateGiftMesh } from '../src/render/gifts3d';
import { spawnGifts } from '../src/core/powerups';
import { BoxGeometry, Mesh } from 'three';

assert.equal(CIRCUITS.length, 12);
for (const c of CIRCUITS) assert.equal(terrainForTheme(c.theme), terrainForTheme(THEMES[c.themeId].id), c.id);
assert.equal(new Set(CIRCUITS.map(c => terrainForTheme(c.theme))).size, 6);
assert.ok(TERRAIN_PHYSICS.snow.grip < TERRAIN_PHYSICS.dirt.grip);
assert.ok(TERRAIN_PHYSICS.sand.acceleration < TERRAIN_PHYSICS.asphalt.acceleration);
assert.ok(terrainFactors('alpes', true).grip > terrainFactors('alpes', false).grip);
const samples = (['dirt', 'sand', 'gravel', 'snow', 'volcanic'] as const).map(k => Array.from(terrainTexture(k, 32, 1).albedo.image.data as Uint8Array).join(','));
assert.equal(new Set(samples).size, 5);
const gift = spawnGifts(1, 42)[0];
const mesh = createGiftMesh(gift);
assert.ok(((mesh.children[0] as Mesh).geometry as BoxGeometry).parameters.width > 0.9);
updateGiftMesh(mesh, gift, 1); const angle = mesh.rotation.y; updateGiftMesh(mesh, gift, 2); assert.notEqual(mesh.rotation.y, angle);
gift.active = false; updateGiftMesh(mesh, gift, 3); assert.equal(mesh.visible, false);
console.log('V4 ciblé OK — 12 circuits, six terrains, textures, physique et cadeaux');

// Verify actual geometry on all fourteen vehicles, not only material colors.
import { createVehicle } from '../src/render/vehicles';
import { VEHICLES, vehicleProfile } from '../src/game/vehicles';
import { ROSTER } from '../src/game/roster';
import { QUALITY } from '../src/core/config';
function measure(model: ReturnType<typeof createVehicle>) {
  let triangles = 0, draws = 0;
  model.body.traverse(o => {
    if (o instanceof Mesh) {
      triangles += (o.geometry.index?.count ?? o.geometry.getAttribute('position').count) / 3;
      draws++;
      const positions = o.geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++) {
        assert.ok(Number.isFinite(positions.getX(i)) && Number.isFinite(positions.getY(i)) && Number.isFinite(positions.getZ(i)), 'finite geometry');
      }
    }
  });
  return { triangles, draws };
}
assert.equal(VEHICLES.length, 14);
for (const vehicle of VEHICLES) {
  const counts: number[] = [];
  for (const quality of [QUALITY.low, QUALITY.high, QUALITY.ultra]) {
    const model = createVehicle(vehicleProfile(ROSTER[0], vehicle), quality);
    const metrics = measure(model);
    assert.equal(model.wheels.length, vehicle.kind === 'kart' ? 4 : 2, vehicle.id);
    assert.equal(model.frontWheels.length, vehicle.kind === 'kart' ? 2 : 1);
    assert.ok(metrics.draws < 100, `${vehicle.id}: batched draw budget`);
    assert.ok(metrics.triangles < 65000, `${vehicle.id}: triangle budget`);
    assert.ok(model.root.userData.wheelRadius > 0);
    counts.push(metrics.triangles);
    model.dispose();
  }
  assert.ok(counts[2] > counts[1] && counts[1] > counts[0], `${vehicle.id}: visible geometric quality tiers`);
}
console.log('V4 véhicules OK — 14 modèles, géométrie finie, trois niveaux, budgets statiques et pivots');

import { Track } from '../src/core/track';
import { terrainAtProgress, terrainFactorsFor } from '../src/core/terrain';
import { buildTrackMesh } from '../src/render/trackMesh';
import { createMaterials } from '../src/render/models';
import { collectGiftMesh } from '../src/render/gifts3d';
import { CinematicScenery } from '../src/render/cinematicScenery';
import { EffectsRegistry } from '../src/render/particles';
import { smokeTexture, glowTexture } from '../src/render/textures';
for (const theme of ['alpes', 'ocean', 'tropical', 'sahara', 'volcanic']) {
  const circuit = CIRCUITS.find(c => c.theme === theme)!;
  const track = new Track(circuit);
  const mats = createMaterials(THEMES[circuit.themeId], QUALITY.low);
  if (theme === 'alpes' || theme === 'volcanic') {
    assert.notEqual(mats.road.map, mats.grass.map, 'independent terrain UV transforms');
    assert.equal(mats.road.map!.repeat.x, 1, 'road ruts remain visible');
    assert.equal(mats.grass.map!.repeat.x, 240);
  }
  const visual = buildTrackMesh(track, mats, QUALITY.low, THEMES[circuit.themeId]);
  const road = visual.group.children[0] as Mesh;
  assert.ok(Array.isArray(road.material) && road.material.length > 1, `${theme}: rendered sections`);
  assert.equal(road.geometry.groups.reduce((sum, group) => sum + group.count, 0), road.geometry.index!.count);
  for (let i = 0; i < track.count; i += 9) {
    const p = track.worldAt((i + .25) * track.step, 0);
    const contact = track.query(p.x, p.z, -1, false);
    const group = road.geometry.groups.find(g => i * 24 >= g.start && i * 24 < g.start + g.count)!;
    assert.equal(contact.terrain, (road.material as import('three').Material[])[group.materialIndex!].userData.terrain, `${theme}/${i}: physics matches visible material group ${group.materialIndex}`);
  }
  const scenery = new CinematicScenery(track, QUALITY.low, circuit.seed);
  scenery.update(1, { x: 0, y: 0, z: 0 }, false);
  scenery.update(2, { x: 0, y: 0, z: 0 }, true);
  assert.ok(scenery.group.children.length > 0);
  scenery.group.traverse(o => {
    if (!(o instanceof Mesh)) return;
    const materials = Array.isArray(o.material) ? o.material : [o.material];
    if (!materials.some(m => (m as import('three').MeshStandardMaterial).isMeshStandardMaterial)) return;
    const normals = o.geometry.getAttribute('normal');
    assert.ok(normals, `${theme}: lit scenery needs normals (NaN otherwise spreads through HDR bloom)`);
    assert.equal(normals.count, o.geometry.getAttribute('position').count);
    for (let i = 0; i < normals.count; i++)
      assert.ok(Number.isFinite(normals.getX(i) + normals.getY(i) + normals.getZ(i)), `${theme}: finite normals`);
  });
  scenery.dispose(); visual.dispose(); mats.dispose();
}
assert.equal(terrainAtProgress('alpes', .35), 'asphalt');
assert.equal(terrainAtProgress('alpes', .1), 'snow');
assert.deepEqual(terrainFactorsFor('snow', false), TERRAIN_PHYSICS.snow);
const collectingGift = spawnGifts(1, 42)[0], collectingMesh = createGiftMesh(collectingGift);
collectingGift.active = false; collectGiftMesh(collectingMesh, 5);
updateGiftMesh(collectingMesh, collectingGift, 5.2); assert.equal(collectingMesh.visible, true); assert.ok(collectingMesh.scale.x > 1);
updateGiftMesh(collectingMesh, collectingGift, 6); assert.equal(collectingMesh.visible, false);
collectingGift.active = true; updateGiftMesh(collectingMesh, collectingGift, 25); assert.equal(collectingMesh.visible, true); assert.equal(collectingMesh.scale.x, 1);
const effects = new EffectsRegistry({ smoke: smokeTexture(16).albedo, glow: glowTexture(16).albedo }, 180);
for (const surface of ['sand', 'snow', 'gravel', 'dirt', 'volcanic'] as const) effects.surfaceSpray(surface, 0, 0, 0, 30, 0, 1);
effects.giftBurst(0, 0, 0); effects.update(.05);
assert.ok(effects.debris.activeCount > 0); assert.ok(effects.confetti.activeCount > 0); effects.dispose();
console.log('V4 continuation OK — contacts multi-surfaces, groupes de rendu, décors, collecte et projections');
