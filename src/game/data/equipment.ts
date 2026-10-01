import type { AttackProfile } from './types';

export const equipment: Record<string, AttackProfile> = {
  'iron-sword': { id: 'iron-sword', name: '铁剑', damageType: 'physical', might: 0, hit: 90, critical: 0, weight: 0, minRange: 1, maxRange: 1, hpCost: 0 },
  'steel-sword': { id: 'steel-sword', name: '钢剑', damageType: 'physical', might: 4, hit: 80, critical: 0, weight: 1, minRange: 1, maxRange: 1, hpCost: 0 },
  'iron-lance': { id: 'iron-lance', name: '铁枪', damageType: 'physical', might: 0, hit: 90, critical: 0, weight: 0, minRange: 1, maxRange: 1, hpCost: 0 },
  'steel-lance': { id: 'steel-lance', name: '钢枪', damageType: 'physical', might: 4, hit: 80, critical: 0, weight: 1, minRange: 1, maxRange: 1, hpCost: 0 },
  'raider-blade': { id: 'raider-blade', name: '鸦羽刀', damageType: 'physical', might: 1, hit: 85, critical: 5, weight: 0, minRange: 1, maxRange: 1, hpCost: 0 },
  'moon-blade': { id: 'moon-blade', name: '月辉剑', damageType: 'physical', might: 7, hit: 85, critical: 15, weight: 2, minRange: 1, maxRange: 1, hpCost: 0 },
  'silver-lance': { id: 'silver-lance', name: '银枪', damageType: 'physical', might: 8, hit: 80, critical: 5, weight: 2, minRange: 1, maxRange: 1, hpCost: 0 },
};
