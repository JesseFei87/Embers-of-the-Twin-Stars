import type { Stats, Unit, UnitClass } from './types';

export interface PromotionDefinition {
  from: UnitClass;
  to: UnitClass;
  minLevel: number;
  baseStats: Stats;
}

const base = (maxHp: number, strength: number, skill: number, speed: number, luck: number, defense: number, resistance: number): Stats =>
  ({ maxHp, strength, skill, speed, luck, defense, resistance });

export const promotions: Partial<Record<UnitClass, PromotionDefinition>> = {
  sword: { from: 'sword', to: 'hero', minLevel: 3, baseStats: base(28, 12, 10, 11, 0, 7, 5) },
  raider: { from: 'raider', to: 'hero', minLevel: 3, baseStats: base(26, 11, 10, 12, 0, 6, 4) },
  mage: { from: 'mage', to: 'sage', minLevel: 3, baseStats: base(24, 12, 9, 9, 0, 5, 10) },
  witch: { from: 'witch', to: 'sage', minLevel: 3, baseStats: base(24, 12, 9, 9, 0, 5, 10) },
  cleric: { from: 'cleric', to: 'saint', minLevel: 3, baseStats: base(24, 12, 8, 10, 0, 5, 13) },
  'star-cavalry': { from: 'star-cavalry', to: 'valkyrie', minLevel: 3, baseStats: base(29, 13, 10, 11, 0, 8, 13) },
  lancer: { from: 'lancer', to: 'paladin', minLevel: 3, baseStats: base(32, 13, 8, 9, 0, 10, 5) },
  knight: { from: 'knight', to: 'baron', minLevel: 3, baseStats: base(34, 14, 7, 6, 0, 14, 5) },
};

export function promotionFor(unit: Unit) { return promotions[unit.class]; }

export function promotionGains(unit: Unit, promotion: PromotionDefinition) {
  return Object.fromEntries(Object.entries(promotion.baseStats).map(([key, value]) => [key, Math.max(0, value - unit.stats[key as keyof Stats])])) as Partial<Record<keyof Stats, number>>;
}

export function applyPromotion(unit: Unit, promotion: PromotionDefinition) {
  const gains = promotionGains(unit, promotion);
  const hpGain = gains.maxHp ?? 0;
  for (const [key, value] of Object.entries(gains)) unit.stats[key as keyof Stats] += value;
  unit.hp += hpGain; unit.class = promotion.to; unit.level = 1; unit.exp = 0;
  return gains;
}
