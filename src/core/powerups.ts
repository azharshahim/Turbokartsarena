/** Phases 2+3 — Cadeaux 3D, bonus, armes, bouclier. Logique pure déterministe (testable sans Three.js). */
export type GiftKind = 'turbo' | 'superTurbo' | 'shield' | 'repair' | 'coins' | 'weapon';
export const GIFT_KINDS: GiftKind[] = ['turbo','superTurbo','shield','repair','coins','weapon'];
export type WeaponKind = 'projectile' | 'homing' | 'bomb' | 'shockwave';
export interface Gift { id: number; kind: GiftKind; /** position normalisée sur la spline 0..1 */ s: number; lateral: number; active: boolean; respawnAt: number }
export interface RacerCombat {
  speedFactor: number; shield: boolean; weapon: WeaponKind | null; health: number;
  boostUntil: number; invulnerableUntil: number; coins: number;
}
export function makeRacer(): RacerCombat { return { speedFactor: 1, shield: false, weapon: null, health: 100, boostUntil: 0, invulnerableUntil: 0, coins: 0 }; }
/** Placement déterministe : au centre de la piste (lateral ∈ [-0.5,0.5]), jamais dans un obstacle (les obstacles sont latéraux). */
export function spawnGifts(count = 12, seed = 1337): Gift[] {
  let x = seed >>> 0; const rnd = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
  return Array.from({ length: count }, (_, i) => ({
    id: i, kind: GIFT_KINDS[i % GIFT_KINDS.length], s: (i + 0.5) / count, lateral: (rnd() * 2 - 1) * 0.4, active: true, respawnAt: 0,
  }));
}
export function giftRotation(t: number, id: number): number { return (t * 1.8 + id * 0.7) % (Math.PI * 2); }
export function giftBobY(t: number, id: number): number { return 1 + Math.sin(t * 2 + id) * 0.15; }
export function applyGift(r: RacerCombat, kind: GiftKind, now: number): void {
  switch (kind) {
    case 'turbo': r.boostUntil = Math.max(r.boostUntil, now + 2.5); break;
    case 'superTurbo': r.boostUntil = Math.max(r.boostUntil, now + 4); r.speedFactor = Math.min(1.6, r.speedFactor + 0.1); break;
    case 'shield': r.shield = true; break;
    case 'repair': r.health = 100; break;
    case 'coins': r.coins += 5; break;
    case 'weapon': r.weapon = 'projectile'; break;
  }
}
export function pickupGift(r: RacerCombat, g: Gift, now: number, dist: number): boolean {
  if (!g.active || dist > 2.2) return false;
  applyGift(r, g.kind, now); g.active = false; g.respawnAt = now + 20; return true; // réapparition déterministe +20 s
}
export function updateGifts(gifts: Gift[], now: number): void { for (const g of gifts) if (!g.active && now >= g.respawnAt) g.active = true; }
export interface Projectile { x: number; z: number; vx: number; vz: number; kind: WeaponKind; owner: number; alive: boolean; bornAt: number }
export function fireWeapon(r: RacerCombat, owner: number, x: number, z: number, angle: number, now: number): Projectile | null {
  if (!r.weapon) return null; const kind = r.weapon; r.weapon = null;
  const sp = kind === 'homing' ? 42 : kind === 'shockwave' ? 0 : 55;
  return { x, z, vx: Math.sin(angle) * sp, vz: Math.cos(angle) * sp, kind, owner, alive: true, bornAt: now };
}
/** Guidage limité : corrige la trajectoire au plus de 1.6 rad/s, portée 60 m. */
export function stepProjectile(p: Projectile, dt: number, target?: { x: number; z: number }): void {
  if (!p.alive) return;
  if (p.kind === 'homing' && target) {
    const want = Math.atan2(target.x - p.x, target.z - p.z), cur = Math.atan2(p.vx, p.vz);
    let d = want - cur; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    const turn = Math.max(-1.6 * dt, Math.min(1.6 * dt, d)), sp = Math.hypot(p.vx, p.vz), a = cur + turn;
    p.vx = Math.sin(a) * sp; p.vz = Math.cos(a) * sp;
  }
  p.x += p.vx * dt; p.z += p.vz * dt;
  if (p.kind === 'homing' && Math.hypot(p.x, p.z) > 10000) p.alive = false;
}
export function projectileHits(p: Projectile, tx: number, tz: number, radius = 1.8): boolean {
  return p.alive && p.kind !== 'bomb' && Math.hypot(p.x - tx, p.z - tz) <= radius;
}
/** Impact : bouclier absorbe, sinon ralentissement temporaire + invulnérabilité 2 s. Jamais de blocage permanent. */
export function applyHit(r: RacerCombat, now: number): 'shielded' | 'hit' | 'immune' {
  if (now < r.invulnerableUntil) return 'immune';
  if (r.shield) { r.shield = false; r.invulnerableUntil = now + 2; return 'shielded'; }
  r.speedFactor = 0.45; r.health = Math.max(20, r.health - 25); r.invulnerableUntil = now + 2; return 'hit';
}
export function recoverSpeed(r: RacerCombat, dt: number): void { r.speedFactor = Math.min(1, r.speedFactor + dt * 0.25); }
/** IA : attaque seulement si une arme est détenue, cible devant, cooldown respecté. */
export function aiShouldFire(hasWeapon: boolean, targetAhead: boolean, now: number, lastShot: number): boolean {
  return hasWeapon && targetAhead && now - lastShot > 4;
}
