import type { KartProfile } from './roster';
export type VehicleKind = 'kart' | 'sport' | 'cross' | 'touring';
export interface Vehicle {
  id: string;
  name: string;
  description: string;
  kind: VehicleKind;
  color: number;
  accent: number;
  speed: number;
  accel: number;
  grip: number;
  handling: number;
  mass: number;
  brake: number;
  stability: number;
  shape: KartProfile['shape'];
}
export const VEHICLES: Vehicle[] = [
  {
    id: 'apex',
    name: 'Apex R4',
    description: 'Kart compétition · châssis tubulaire',
    kind: 'kart',
    color: 0xef375a,
    accent: 0xffd75a,
    speed: 1,
    accel: 1.02,
    grip: 1,
    handling: 1,
    mass: 1,
    brake: 1,
    stability: 1,
    shape: 'compact',
  },
  {
    id: 'vector',
    name: 'Vector Formula',
    description: 'Kart caréné · ailerons et diffuseur',
    kind: 'kart',
    color: 0x6375ff,
    accent: 0xd9eeff,
    speed: 1.04,
    accel: 0.96,
    grip: 1.03,
    handling: 0.96,
    mass: 1.08,
    brake: 1.04,
    stability: 1.1,
    shape: 'formula',
  },
  {
    id: 'nomad',
    name: 'Nomad RX',
    description: 'Kart rallye · arceau et pneus mixtes',
    kind: 'kart',
    color: 0xf78b32,
    accent: 0x282d38,
    speed: 0.97,
    accel: 1.06,
    grip: 1.08,
    handling: 0.97,
    mass: 1.18,
    brake: 0.98,
    stability: 1.15,
    shape: 'rally',
  },
  {
    id: 'pulse',
    name: 'Pulse Sprint',
    description: 'Kart léger · agilité et relance',
    kind: 'kart',
    color: 0x34d9bc,
    accent: 0xf0ffff,
    speed: 0.96,
    accel: 1.12,
    grip: 0.98,
    handling: 1.08,
    mass: 0.88,
    brake: 1.02,
    stability: 0.95,
    shape: 'buggy',
  },
  {
    id: 'aerion',
    name: 'Aerion S',
    description: 'Sportive · carénage intégral et freinage radial',
    kind: 'sport',
    color: 0xdf304a,
    accent: 0xe9eef7,
    speed: 1.06,
    accel: 1.16,
    grip: 1.12,
    handling: 0.96,
    mass: 0.84,
    brake: 1.2,
    stability: 1.18,
    shape: 'formula',
  },
  {
    id: 'spectre',
    name: 'Spectre RR',
    description: 'Sportive · empattement long et couple progressif',
    kind: 'sport',
    color: 0x7790ff,
    accent: 0x16f2df,
    speed: 1.08,
    accel: 1.08,
    grip: 1.16,
    handling: 0.92,
    mass: 0.9,
    brake: 1.15,
    stability: 1.28,
    shape: 'formula',
  },
  {
    id: 'terra',
    name: 'Terra X',
    description: 'Motocross · grands débattements et pneus crantés',
    kind: 'cross',
    color: 0x68d154,
    accent: 0xfff1cb,
    speed: 0.96,
    accel: 1.18,
    grip: 1.02,
    handling: 1.08,
    mass: 0.78,
    brake: 0.95,
    stability: 0.95,
    shape: 'buggy',
  },
  {
    id: 'horizon',
    name: 'Horizon GT',
    description: 'Touring · bulle haute et valises latérales',
    kind: 'touring',
    color: 0xecd5a2,
    accent: 0x303f5d,
    speed: 1.01,
    accel: 1.02,
    grip: 1.2,
    handling: 0.9,
    mass: 1.16,
    brake: 1.1,
    stability: 1.4,
    shape: 'muscle',
  },
];
export type Difficulty = 'discovery' | 'arcade' | 'expert';
export const DIFFICULTIES: Record<
  Difficulty,
  { name: string; aiSpeed: number; skill: number; catchUp: boolean }
> = {
  discovery: { name: 'Découverte', aiSpeed: 0.82, skill: 0.5, catchUp: false },
  arcade: { name: 'Arcade', aiSpeed: 1, skill: 0.8, catchUp: true },
  expert: { name: 'Expert', aiSpeed: 1.06, skill: 1, catchUp: false },
};
export function vehicleProfile(driver: KartProfile, vehicle: Vehicle): KartProfile {
  return {
    ...driver,
    riderColor: driver.bodyColor,
    riderAccent: driver.accentColor,
    vehicleId: vehicle.id,
    bodyColor: vehicle.color,
    accentColor: vehicle.accent,
    speed: vehicle.speed,
    accel: vehicle.accel,
    grip: vehicle.grip,
    handling: vehicle.handling,
    mass: vehicle.mass,
    shape: vehicle.shape,
  };
}
export function vehicleFor(profile: KartProfile): Vehicle | undefined {
  return VEHICLES.find((v) => v.id === profile.vehicleId);
}
