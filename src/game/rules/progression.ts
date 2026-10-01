import type { CombatTimeline } from './combat';
import type { Stats, Unit } from '../data/types';
import { spellLearning } from '../data/spellLearning';
import { attackSpells, healingSpells } from '../state';

const statKeys = ['maxHp', 'strength', 'skill', 'speed', 'luck', 'defense', 'resistance'] as const;
export type StatKey = typeof statKeys[number];
export type StatGains = Partial<Record<StatKey, number>>;

export interface ExperienceResult {
  gained: number;
  levels: number;
  statGains: StatGains;
  learnedSpells: string[];
}

export function combatExperience(unit: Unit, opponent: Unit, timeline: CombatTimeline) {
  const strikes = timeline.events.filter(event => event.type === 'strike' && event.attackerId === unit.id);
  if (!strikes.length || unit.hp <= 0) return 0;
  const damage = strikes.reduce((sum, event) => sum + (event.type === 'strike' ? event.damage : 0), 0);
  const defeated = timeline.finalHp[opponent.id] === 0;
  return Math.min(99, 8 + Math.floor(damage / 2) + (defeated ? 20 + Math.max(0, opponent.level - unit.level) * 3 : 0));
}

export function healingExperience(amount: number) {
  return Math.min(30, 8 + Math.floor(amount / 2));
}

export function grantExperience(unit: Unit, amount: number, random: () => number = Math.random): ExperienceResult {
  const result: ExperienceResult = { gained: amount, levels: 0, statGains: {}, learnedSpells: [] };
  if (amount <= 0 || unit.level >= 20) return result;
  unit.exp += amount;
  while (unit.exp >= 100 && unit.level < 20) {
    unit.exp -= 100; unit.level++; result.levels++;
    for (const key of statKeys) {
      if (random() * 100 >= unit.growths[key]) continue;
      unit.stats[key]++; result.statGains[key] = (result.statGains[key] ?? 0) + 1;
      if (key === 'maxHp') unit.hp++;
    }
  }
  for (const entry of spellLearning[unit.id] ?? []) {
    if (entry.level > unit.level || unit.spells.includes(entry.spellId)) continue;
    unit.spells.push(entry.spellId); result.learnedSpells.push(entry.spellId);
    if (attackSpells[entry.spellId] && !unit.activeSpellId) unit.activeSpellId = entry.spellId;
    if (healingSpells[entry.spellId] && !unit.activeHealingSpellId) unit.activeHealingSpellId = entry.spellId;
  }
  if (unit.level >= 20) unit.exp = 0;
  return result;
}

export const statLabels: Record<keyof Stats, string> = {
  maxHp: 'HP', strength: '力量', skill: '技术', speed: '速度', luck: '幸运', defense: '防御', resistance: '魔防',
};
