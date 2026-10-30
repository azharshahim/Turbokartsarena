/** Road material is shared by rendering and driving; unknown themes remain asphalt. */
export type Terrain = 'asphalt' | 'dirt' | 'sand' | 'gravel' | 'snow' | 'volcanic';
const TERRAIN_BY_THEME: Record<string, Terrain> = {
  coast: 'asphalt', desert: 'gravel', neon: 'asphalt', alpine: 'gravel',
  tokyo: 'asphalt', sahara: 'sand', jungle: 'dirt', mediterranean: 'asphalt',
  alpes: 'snow', ocean: 'asphalt', tropical: 'dirt', volcanic: 'volcanic',
};
export const TERRAIN_PHYSICS: Record<Terrain, { grip: number; acceleration: number }> = {
  asphalt: { grip: 1, acceleration: 1 },
  dirt: { grip: 0.82, acceleration: 0.92 },
  sand: { grip: 0.72, acceleration: 0.78 },
  gravel: { grip: 0.72, acceleration: 0.9 },
  snow: { grip: 0.58, acceleration: 0.86 },
  volcanic: { grip: 0.8, acceleration: 0.91 },
};
export function terrainForTheme(theme: string): Terrain { return TERRAIN_BY_THEME[theme] ?? 'asphalt'; }
/** Bikes retain a little more lateral stability, while still feeling the surface. */
export function terrainFactors(theme: string, bike: boolean) {
  const p = TERRAIN_PHYSICS[terrainForTheme(theme)];
  return { grip: bike ? 1 - (1 - p.grip) * 0.85 : p.grip, acceleration: p.acceleration };
}
