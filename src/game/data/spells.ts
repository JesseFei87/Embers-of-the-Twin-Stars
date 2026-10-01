import type { AttackProfile } from './types';

export interface HealingSpell {
  id: string;
  name: string;
  hpCost: number;
  minRange: number;
  maxRange: number;
}

export const attackSpells: Record<string, AttackProfile> = {
  starfire: { id: 'starfire', name: '星火', damageType: 'magical', might: 3, hit: 80, critical: 0, weight: 3, minRange: 1, maxRange: 2, hpCost: 1 },
  resire: { id: 'resire', name: '圣光', damageType: 'magical', might: 0, hit: 50, critical: 0, weight: 2, minRange: 1, maxRange: 2, hpCost: 0 },
  seraphim: { id: 'seraphim', name: '天使之光', damageType: 'magical', might: 7, hit: 80, critical: 5, weight: 4, minRange: 1, maxRange: 2, hpCost: 3 },
  thunder: { id: 'thunder', name: '雷光', damageType: 'magical', might: 5, hit: 70, critical: 10, weight: 5, minRange: 1, maxRange: 3, hpCost: 2 },
};

export const healingSpells: Record<string, HealingSpell> = {
  recover: { id: 'recover', name: '回复', hpCost: 1, minRange: 1, maxRange: 1 },
  physic: { id: 'physic', name: '远愈', hpCost: 3, minRange: 1, maxRange: 3 },
};
