import * as assert from 'node:assert';
import { computeSafeLayout, isButtonVisible, TEST_VIEWPORTS, DEFAULT_ANDROID_INSETS } from '../src/core/safeLayout';
import { spawnGifts, pickupGift, applyHit, fireWeapon, stepProjectile, makeRacer, updateGifts, aiShouldFire, recoverSpeed } from '../src/core/powerups';
import { defaultGarage, buyVehicle, buyUpgrade, awardRace, saveGarage, loadGarage, upgradeMultiplier } from '../src/game/economy';
import { VEHICLES } from '../src/game/vehicles';
import { CIRCUITS } from '../src/game/circuits';
// Phase 1 : aucun bouton masqué sur les 6 résolutions demandées
for (const vp of TEST_VIEWPORTS) { const l = computeSafeLayout(vp); assert.ok(isButtonVisible(vp, DEFAULT_ANDROID_INSETS, l.contentPaddingBottom, 62), `bouton visible ${vp.width}x${vp.height}`); assert.ok(l.minTouchTarget >= 48); assert.equal(l.isLandscape, vp.width > vp.height); }
assert.ok(computeSafeLayout({width:360,height:800}, DEFAULT_ANDROID_INSETS, 900).needsScroll);
// Phase 2
const gifts = spawnGifts(12, 42); assert.deepEqual(spawnGifts(12,42).map(g=>g.s), gifts.map(g=>g.s)); assert.ok(gifts.every(g=>Math.abs(g.lateral)<=0.5));
const r = makeRacer(); assert.ok(pickupGift(r, gifts[0], 0, 1)); assert.equal(gifts[0].active,false); updateGifts(gifts,25); assert.equal(gifts[0].active,true);
// Phase 3
const r2 = makeRacer(); r2.shield=true; assert.equal(applyHit(r2,10),'shielded'); assert.equal(r2.speedFactor,1);
const r3 = makeRacer(); assert.equal(applyHit(r3,0),'hit'); assert.equal(applyHit(r3,1),'immune'); recoverSpeed(r3,10); assert.equal(r3.speedFactor,1);
r3.weapon='homing'; const p=fireWeapon(r3,0,0,0,0,0)!; assert.ok(p); for(let i=0;i<10;i++) stepProjectile(p,0.1,{x:5,z:50}); assert.ok(p.z>0);
assert.ok(aiShouldFire(true,true,10,0)); assert.ok(!aiShouldFire(true,false,10,0));
// Phase 4
const g = defaultGarage(); assert.equal(buyVehicle(g,'falcon',99999).ok,false); assert.ok(g.coins>=0);
g.coins=1000; assert.ok(buyVehicle(g,'falcon',600).ok); assert.equal(buyVehicle(g,'falcon',600).ok,false); assert.equal(g.coins,400);
assert.ok(buyUpgrade(g,'falcon','engine').ok); assert.ok(upgradeMultiplier(g,'falcon','engine')>1);
const gain=awardRace(g,'race-1',1,3); assert.ok(gain>0); assert.equal(awardRace(g,'race-1',1,3),0);
const mem={m:new Map<string,string>(),getItem(k:string){return this.m.get(k)??null},setItem(k:string,v:string){this.m.set(k,v)}};
saveGarage(mem,g); assert.equal(loadGarage(mem).coins,g.coins);
// Phases 5/6 données
assert.ok(CIRCUITS.length>=12, `circuits=${CIRCUITS.length}`); assert.ok(VEHICLES.length>=14, `vehicles=${VEHICLES.length}`);
for (const c of CIRCUITS) assert.ok(c.control.length>=8 && c.boosts.length>=1, c.id);
console.log(`V3 OK — ${CIRCUITS.length} circuits, ${VEHICLES.length} véhicules, safe-area ${TEST_VIEWPORTS.length} résolutions`);
