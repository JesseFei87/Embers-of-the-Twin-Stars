import type { MovementProfile } from './types';

export type TerrainId = 'g' | 'f' | 'm' | 'w' | 'b' | 'r' | 's';

export interface TerrainDefinition {
  id: TerrainId;
  name: string;
  avoid: number;
  recovery: number;
  moveCost: Record<MovementProfile, number | null>;
}

export const terrainDefinitions: Record<TerrainId, TerrainDefinition> = {
  g: { id: 'g', name: '草地', avoid: 0, recovery: 0, moveCost: { agile: 1, infantry: 1, armored: 1, caster: 1, mounted: 1 } },
  f: { id: 'f', name: '森林', avoid: 40, recovery: 0, moveCost: { agile: 1, infantry: 2, armored: 2, caster: 1, mounted: 3 } },
  m: { id: 'm', name: '山地', avoid: 30, recovery: 0, moveCost: { agile: 3, infantry: 4, armored: null, caster: 3, mounted: null } },
  w: { id: 'w', name: '河流', avoid: 0, recovery: 0, moveCost: { agile: 4, infantry: null, armored: null, caster: null, mounted: null } },
  b: { id: 'b', name: '木桥', avoid: 0, recovery: 0, moveCost: { agile: 1, infantry: 1, armored: 1, caster: 1, mounted: 1 } },
  r: { id: 'r', name: '道路', avoid: 0, recovery: 0, moveCost: { agile: 1, infantry: 1, armored: 1, caster: 1, mounted: 1 } },
  s: { id: 's', name: '回复地形', avoid: 40, recovery: 5, moveCost: { agile: 1, infantry: 1, armored: 1, caster: 1, mounted: 1 } },
};

export const terrainMap: TerrainId[][] = [
  [...'ggggffffgg'], [...'gggffmffgg'], [...'ggggmmfggg'], [...'wwwwbbwwww'],
  [...'ggggrrgggg'], [...'gffgrrggfg'], [...'ggggrrffgg'], [...'ggggssgggg'],
] as TerrainId[][];
