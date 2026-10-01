import type { AttackProfile, MovementProfile, UnitClass } from './types';

export interface ClassDefinition {
  id: UnitClass;
  name: string;
  movement: number;
  movementProfile: MovementProfile;
  defaultAttack: AttackProfile;
  canHeal: boolean;
}

const basicAttack = (id: string, name: string): AttackProfile => ({
  id, name, damageType: 'physical', might: 0, hit: 90, critical: 0,
  weight: 0, minRange: 1, maxRange: 1, hpCost: 0,
});

export const classes: Record<UnitClass, ClassDefinition> = {
  mossling: { id: 'mossling', name: '苔灯灵', movement: 3, movementProfile: 'infantry', defaultAttack: basicAttack('moss-root', '藤根拍击'), canHeal: false },
  tidecrab: { id: 'tidecrab', name: '潮壳蟹', movement: 3, movementProfile: 'infantry', defaultAttack: basicAttack('tide-claw', '蟹钳夹击'), canHeal: false },
  sword: { id: 'sword', name: '剑士', movement: 5, movementProfile: 'agile', defaultAttack: basicAttack('class-sword', '短剑'), canHeal: false },
  mage: { id: 'mage', name: '术士', movement: 4, movementProfile: 'caster', defaultAttack: { id: 'class-fire', name: '星火', damageType: 'magical', might: 3, hit: 80, critical: 0, weight: 3, minRange: 1, maxRange: 2, hpCost: 1 }, canHeal: false },
  cleric: { id: 'cleric', name: '僧侣', movement: 4, movementProfile: 'caster', defaultAttack: { id: 'class-resire', name: '圣光', damageType: 'magical', might: 0, hit: 50, critical: 0, weight: 2, minRange: 1, maxRange: 2, hpCost: 0 }, canHeal: true },
  'star-cavalry': { id: 'star-cavalry', name: '星祈骑兵', movement: 7, movementProfile: 'mounted', defaultAttack: { id: 'class-star-lance', name: '星辉骑枪', damageType: 'magical', might: 2, hit: 80, critical: 0, weight: 3, minRange: 1, maxRange: 2, hpCost: 1 }, canHeal: true },
  witch: { id: 'witch', name: '女巫', movement: 4, movementProfile: 'caster', defaultAttack: { id: 'class-fire', name: '星火', damageType: 'magical', might: 3, hit: 80, critical: 0, weight: 3, minRange: 1, maxRange: 2, hpCost: 1 }, canHeal: true },
  lancer: { id: 'lancer', name: '枪卫', movement: 4, movementProfile: 'infantry', defaultAttack: basicAttack('class-lance', '短枪'), canHeal: false },
  knight: { id: 'knight', name: '重甲', movement: 3, movementProfile: 'armored', defaultAttack: basicAttack('class-lance', '短枪'), canHeal: false },
  raider: { id: 'raider', name: '斥候', movement: 5, movementProfile: 'agile', defaultAttack: basicAttack('class-blade', '弯刀'), canHeal: false },
  hero: { id: 'hero', name: '勇者', movement: 6, movementProfile: 'agile', defaultAttack: basicAttack('class-hero', '勇者剑'), canHeal: false },
  sage: { id: 'sage', name: '贤者', movement: 5, movementProfile: 'caster', defaultAttack: { id: 'class-sage-fire', name: '星火', damageType: 'magical', might: 3, hit: 80, critical: 0, weight: 3, minRange: 1, maxRange: 2, hpCost: 1 }, canHeal: true },
  saint: { id: 'saint', name: '圣女', movement: 5, movementProfile: 'caster', defaultAttack: { id: 'class-saint-light', name: '圣光', damageType: 'magical', might: 0, hit: 50, critical: 0, weight: 2, minRange: 1, maxRange: 2, hpCost: 0 }, canHeal: true },
  valkyrie: { id: 'valkyrie', name: '星辉女武神', movement: 8, movementProfile: 'mounted', defaultAttack: { id: 'class-valkyrie', name: '星界骑枪', damageType: 'magical', might: 5, hit: 85, critical: 5, weight: 3, minRange: 1, maxRange: 2, hpCost: 1 }, canHeal: true },
  paladin: { id: 'paladin', name: '圣骑士', movement: 7, movementProfile: 'agile', defaultAttack: basicAttack('class-paladin-lance', '骑士枪'), canHeal: false },
  baron: { id: 'baron', name: '男爵', movement: 4, movementProfile: 'armored', defaultAttack: basicAttack('class-baron-lance', '重枪'), canHeal: false },
};
