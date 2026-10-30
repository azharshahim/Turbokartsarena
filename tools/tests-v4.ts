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
