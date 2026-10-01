export type Team = 'player' | 'enemy';
export type UnitClass = 'sword' | 'mage' | 'cleric' | 'star-cavalry' | 'witch' | 'lancer' | 'knight' | 'raider' | 'hero' | 'sage' | 'saint' | 'valkyrie' | 'paladin' | 'baron' | 'mossling' | 'tidecrab';
export type MovementProfile = 'agile' | 'infantry' | 'armored' | 'caster' | 'mounted';
export type DamageType = 'physical' | 'magical' | 'healing';
export type AiBehavior = 'active' | 'guard' | 'alert' | 'support';
export type PortraitId = 0 | 1 | 2 | 3 | 4 | 5;

export interface Stats {
  maxHp: number;
  strength: number;
  skill: number;
  speed: number;
  luck: number;
  defense: number;
  resistance: number;
}

export interface Unit {
  id: string;
  name: string;
  title: string;
  team: Team;
  class: UnitClass;
  x: number;
  y: number;
  hp: number;
  level: number;
  exp: number;
  stats: Stats;
  growths: Stats;
  itemId?: string;
  dropItemId?: string;
  spells: string[];
  activeSpellId?: string;
  activeHealingSpellId?: string;
  acted: boolean;
  portrait: PortraitId;
  ai?: AiBehavior;
  aiRange?: number;
}

export interface AttackProfile {
  id: string;
  name: string;
  damageType: Exclude<DamageType, 'healing'>;
  might: number;
  hit: number;
  critical: number;
  weight: number;
  minRange: number;
  maxRange: number;
  hpCost: number;
}
