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

/** Normalized lap intervals. Render boundaries are snapped to the same track
 * samples as physics, so the visible material never differs from the contact. */
export interface TerrainSection { start: number; end: number; terrain: Terrain }
const SECTIONS: Record<string, TerrainSection[]> = {
  coast: [{ start: .32, end: .43, terrain: 'sand' }],
  desert: [{ start: .5, end: .65, terrain: 'sand' }],
  alpine: [{ start: .55, end: .72, terrain: 'asphalt' }],
  sahara: [{ start: .27, end: .4, terrain: 'gravel' }],
  jungle: [{ start: .48, end: .62, terrain: 'gravel' }],
  mediterranean: [{ start: .62, end: .74, terrain: 'gravel' }],
  alpes: [{ start: .3, end: .4, terrain: 'asphalt' }],
  ocean: [{ start: .12, end: .25, terrain: 'sand' }],
  tropical: [{ start: .5, end: .62, terrain: 'asphalt' }],
  volcanic: [{ start: .55, end: .66, terrain: 'asphalt' }],
};
export function terrainAtProgress(theme: string, progress: number): Terrain {
  const t = ((progress % 1) + 1) % 1;
  for (const section of SECTIONS[theme] ?? []) if (t >= section.start && t < section.end) return section.terrain;
  return terrainForTheme(theme);
}
export function terrainFactorsFor(surface: Terrain, bike: boolean) {
  const p = TERRAIN_PHYSICS[surface];
  return { grip: bike ? 1 - (1 - p.grip) * .85 : p.grip, acceleration: p.acceleration };
}
