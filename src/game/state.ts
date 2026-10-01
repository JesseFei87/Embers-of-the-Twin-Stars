import { classes } from './data/classes';
import { equipment } from './data/equipment';
import { attackSpells, healingSpells } from './data/spells';
import { terrainDefinitions, terrainMap } from './data/terrain';
import { chapters } from './data/chapters';
import { itemAvoid } from './data/items';
import type { AttackProfile, Unit } from './data/types';

export type { AttackProfile, Team, Unit, UnitClass } from './data/types';
export { classes, equipment, attackSpells, healingSpells, terrainDefinitions };

export let MAP_W = terrainMap[0].length;
export let MAP_H = terrainMap.length;
export let activeChapterId = 'starfall-bridge';
let activeTerrainMap = terrainMap;
export let terrain = activeTerrainMap.map(row => row.join(''));
export let currentMission = chapters[activeChapterId].mission;

export function setActiveChapter(chapterId: string) {
  const chapter = chapters[chapterId] ?? chapters['starfall-bridge'];
  MAP_W = chapter.map[0].length; MAP_H = chapter.map.length;
  activeChapterId = chapter.id; activeTerrainMap = chapter.map; terrain = chapter.map.map(row => row.join('')); currentMission = chapter.mission;
}

export const distance = (a: Pick<Unit, 'x' | 'y'>, b: Pick<Unit, 'x' | 'y'>) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export const maxHp = (unit: Unit) => unit.stats.maxHp;
export const move = (unit: Unit) => classes[unit.class].movement;
export const terrainAt = (x: number, y: number) => terrainDefinitions[activeTerrainMap[y][x]];
export const itemAvoidBonus = (unit: Unit) => itemAvoid(unit.itemId);

export function attackProfile(unit: Unit): AttackProfile {
  const spell = (unit.activeSpellId && unit.spells.includes(unit.activeSpellId) ? attackSpells[unit.activeSpellId] : undefined) ?? unit.spells.map(id => attackSpells[id]).find(Boolean);
  return spell ?? (unit.itemId ? equipment[unit.itemId] : undefined) ?? classes[unit.class].defaultAttack;
}

export function healingSpell(unit: Unit) {
  if (!classes[unit.class].canHeal) return undefined;
  return (unit.activeHealingSpellId && unit.spells.includes(unit.activeHealingSpellId) ? healingSpells[unit.activeHealingSpellId] : undefined) ?? unit.spells.map(id => healingSpells[id]).find(Boolean);
}
