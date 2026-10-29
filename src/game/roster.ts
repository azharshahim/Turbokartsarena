/**
 * Turbo Karts Arena — casting 100 % original.
 * Aucune référence à une franchise existante : noms, silhouettes et palettes inédits.
 */

export interface KartProfile {
  id: string;
  /** Independent vehicle selection; legacy profiles remain valid. */
  vehicleId?: string;
  riderColor?: number;
  riderAccent?: number;
  name: string;
  tagline: string;
  /** Couleur de la carrosserie. */
  bodyColor: number;
  /** Couleur d'accent (aileron, bandes, néons). */
  accentColor: number;
  /** Couleur du pilote (combinaison). */
  suitColor: number;
  skinColor: number;
  visorColor: number;
  /** Stats normalisées (1 = neutre). */
  speed: number;
  accel: number;
  grip: number;
  handling: number;
  mass: number;
  /** Archétype de carrosserie. */
  shape: 'compact' | 'muscle' | 'formula' | 'buggy' | 'rally' | 'hover';
}

export const ROSTER: KartProfile[] = [
  {
    id: 'nova',
    name: 'Nova Vex',
    tagline: 'Pilote d’usine · équilibrée',
    bodyColor: 0xff3d6e,
    accentColor: 0xffe14d,
    suitColor: 0x1b1030,
    skinColor: 0xf0b48a,
    visorColor: 0x39f0ff,
    speed: 1.0,
    accel: 1.02,
    grip: 1.0,
    handling: 1.0,
    mass: 1.0,
    shape: 'compact',
  },
  {
    id: 'krugg',
    name: 'Bram Krugg',
    tagline: 'Poids lourd · vitesse de pointe',
    bodyColor: 0x2f6bff,
    accentColor: 0x8ef0ff,
    suitColor: 0x0d1b3a,
    skinColor: 0xc98b63,
    visorColor: 0xff9a2e,
    speed: 1.07,
    accel: 0.9,
    grip: 0.96,
    handling: 0.9,
    mass: 1.22,
    shape: 'muscle',
  },
  {
    id: 'suki',
    name: 'Suki Marlow',
    tagline: 'As du dérapage · turbo chargé vite',
    bodyColor: 0x2ee08a,
    accentColor: 0xfff2b0,
    suitColor: 0x103125,
    skinColor: 0x8d5a3b,
    visorColor: 0xffe14d,
    speed: 0.97,
    accel: 1.08,
    grip: 0.92,
    handling: 1.1,
    mass: 0.86,
    shape: 'buggy',
  },
  {
    id: 'teo',
    name: 'Teo Rask',
    tagline: 'Châssis agile · virages serrés',
    bodyColor: 0xa855f7,
    accentColor: 0x35f5c8,
    suitColor: 0x241038,
    skinColor: 0xe8c39e,
    visorColor: 0xff4d9e,
    speed: 0.95,
    accel: 1.12,
    grip: 1.06,
    handling: 1.14,
    mass: 0.82,
    shape: 'formula',
  },
  {
    id: 'iron',
    name: 'Mara Iron',
    tagline: 'Blindée · encaisse les chocs',
    bodyColor: 0xff8a1f,
    accentColor: 0x2b2b33,
    suitColor: 0x3a2a12,
    skinColor: 0x9a6b4a,
    visorColor: 0x8ef0ff,
    speed: 1.03,
    accel: 0.96,
    grip: 1.02,
    handling: 0.94,
    mass: 1.35,
    shape: 'rally',
  },
  {
    id: 'glint',
    name: 'Glint',
    tagline: 'Prototype à sustentation · contrôle total',
    bodyColor: 0x22d3ee,
    accentColor: 0xff2f8f,
    suitColor: 0x0b2b33,
    skinColor: 0xb9e4f0,
    visorColor: 0xffe14d,
    speed: 0.99,
    accel: 1.05,
    grip: 1.09,
    handling: 1.05,
    mass: 0.94,
    shape: 'hover',
  },
  {
    id: 'hex',
    name: 'Hex Duval',
    tagline: 'Vétéran roublard · régularité',
    bodyColor: 0xfacc15,
    accentColor: 0x1a1a22,
    suitColor: 0x2a2410,
    skinColor: 0x6b4326,
    visorColor: 0x39f0ff,
    speed: 1.01,
    accel: 1.0,
    grip: 1.0,
    handling: 1.02,
    mass: 1.05,
    shape: 'compact',
  },
  {
    id: 'zera',
    name: 'Zera Kwon',
    tagline: 'Bleu électrique · reine du boost',
    bodyColor: 0x6366f1,
    accentColor: 0xffe14d,
    suitColor: 0x121438,
    skinColor: 0xd8a078,
    visorColor: 0x35f5c8,
    speed: 1.02,
    accel: 1.03,
    grip: 0.94,
    handling: 1.06,
    mass: 0.9,
    shape: 'formula',
  },
  {
    id: 'lina',
    name: 'Lina Sol',
    tagline: 'Éclaireuse alpine · précision',
    bodyColor: 16119295,
    accentColor: 5084927,
    suitColor: 2381436,
    skinColor: 14261111,
    visorColor: 10480383,
    speed: 1,
    accel: 1.02,
    grip: 1,
    handling: 1,
    mass: 1,
    shape: 'compact',
  },
  {
    id: 'idris',
    name: 'Idris Sirocco',
    tagline: 'Rallye du désert · endurance',
    bodyColor: 14787648,
    accentColor: 4541497,
    suitColor: 11954486,
    skinColor: 7159076,
    visorColor: 16770413,
    speed: 1.07,
    accel: 0.9,
    grip: 0.96,
    handling: 0.9,
    mass: 1,
    shape: 'compact',
  },
  {
    id: 'aya',
    name: 'Aya Mori',
    tagline: 'Pilote de nuit · trajectoires nettes',
    bodyColor: 14113775,
    accentColor: 6349789,
    suitColor: 10299516,
    skinColor: 15315854,
    visorColor: 7927039,
    speed: 0.97,
    accel: 1.08,
    grip: 0.92,
    handling: 1.1,
    mass: 1,
    shape: 'compact',
  },
  {
    id: 'nilo',
    name: 'Nilo Costa',
    tagline: 'Coastal racing · souplesse',
    bodyColor: 3974112,
    accentColor: 15263402,
    suitColor: 2260840,
    skinColor: 9658176,
    visorColor: 16757600,
    speed: 0.95,
    accel: 1.12,
    grip: 1.06,
    handling: 1.14,
    mass: 1,
    shape: 'compact',
  },
];

export const PLAYER_PROFILE = ROSTER[0];
