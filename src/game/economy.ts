/** Phase 4 — Turbo Coins, garage, améliorations. Logique pure + persistance injectable. */
import type { KartProfile } from './roster';
export interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void }
export type UpgradeKind = 'engine' | 'acceleration' | 'topSpeed' | 'braking' | 'grip' | 'protection' | 'turbo';
export const UPGRADE_KINDS: UpgradeKind[] = ['engine','acceleration','topSpeed','braking','grip','protection','turbo'];
export const MAX_UPGRADE_LEVEL = 5;
export interface GarageState {
  coins: number; owned: string[]; selected: string;
  upgrades: Record<string, Partial<Record<UpgradeKind, number>>>;
  rewardedRaces: string[]; bestTimes: Record<string, number>;
  stats: { races: number; wins: number; coinsCollected: number };
}
export const GARAGE_STORAGE_KEY = 'turbokarts.v3.garage.v1';
const KEY = GARAGE_STORAGE_KEY;
export function defaultGarage(): GarageState {
  return { coins: 500, owned: ['apex','vector','nomad','pulse','aerion','spectre','terra','horizon'], selected: 'apex', upgrades: {}, rewardedRaces: [], bestTimes: {}, stats: { races: 0, wins: 0, coinsCollected: 0 } }; // les 8 véhicules V2 restent débloqués
}
export function upgradeCost(kind: UpgradeKind, level: number): number { return 100 + level * 75 + UPGRADE_KINDS.indexOf(kind) * 10; }
/** Multiplicateur réel appliqué aux caractéristiques : +3 % par niveau. */
export function upgradeMultiplier(state: GarageState, vehicleId: string, kind: UpgradeKind): number {
  return 1 + 0.03 * (state.upgrades[vehicleId]?.[kind] ?? 0);
}
export function buyVehicle(state: GarageState, vehicleId: string, price: number): { ok: boolean; reason?: string } {
  if (state.owned.includes(vehicleId)) return { ok: false, reason: 'already-owned' }; // anti double-facturation
  if (price < 0 || state.coins < price) return { ok: false, reason: 'insufficient-funds' };
  state.coins -= price; state.owned.push(vehicleId); return { ok: true };
}
export function buyUpgrade(state: GarageState, vehicleId: string, kind: UpgradeKind): { ok: boolean; reason?: string; cost?: number } {
  if (!state.owned.includes(vehicleId)) return { ok: false, reason: 'not-owned' };
  const lvl = state.upgrades[vehicleId]?.[kind] ?? 0;
  if (lvl >= MAX_UPGRADE_LEVEL) return { ok: false, reason: 'max-level' };
  const cost = upgradeCost(kind, lvl);
  if (state.coins < cost) return { ok: false, reason: 'insufficient-funds' };
  state.coins -= cost;
  (state.upgrades[vehicleId] ??= {})[kind] = lvl + 1;
  return { ok: true, cost };
}
/** Récompense de fin de course, idempotente par raceId (anti-abus). */
export function awardRace(state: GarageState, raceId: string, place: number, coinsCollected = 0, timeSec?: number, circuitId?: string): number {
  if (state.rewardedRaces.includes(raceId)) return 0;
  state.rewardedRaces.push(raceId);
  let gain = 50 + coinsCollected * 10 + (place === 1 ? 150 : place === 2 ? 75 : place === 3 ? 40 : 0);
  if (circuitId && timeSec && (!state.bestTimes[circuitId] || timeSec < state.bestTimes[circuitId])) { state.bestTimes[circuitId] = timeSec; gain += 50; }
  state.coins = Math.max(0, state.coins + gain);
  state.stats.races++; if (place === 1) state.stats.wins++; state.stats.coinsCollected += coinsCollected;
  return gain;
}
export function saveGarage(storage: StorageLike, state: GarageState): void { storage.setItem(KEY, JSON.stringify(state)); }
export function loadGarage(storage: StorageLike): GarageState {
  try { const raw = storage.getItem(KEY); if (!raw) return defaultGarage();
    const p = JSON.parse(raw) as GarageState;
    if (typeof p.coins !== 'number' || !Array.isArray(p.owned)) return defaultGarage();
    return { ...defaultGarage(), ...p, coins: Math.max(0, Math.floor(p.coins)) };
  } catch { return defaultGarage(); }
}

/** Applique les améliorations achetées aux caractéristiques réelles du véhicule. */
export function upgradedProfile(base: KartProfile, garage: GarageState): KartProfile {
  const v = base.vehicleId ?? 'apex'; const m = (k: UpgradeKind) => upgradeMultiplier(garage, v, k);
  return { ...base, speed: base.speed * m('engine') * m('topSpeed'), accel: base.accel * m('acceleration') * m('turbo'), grip: base.grip * m('grip'), brake: (base.brake ?? 1) * m('braking'), stability: (base.stability ?? 1) * m('protection') };
}
