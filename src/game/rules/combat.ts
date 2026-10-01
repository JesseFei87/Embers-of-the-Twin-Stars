import { attackProfile, itemAvoidBonus, terrainAt, type AttackProfile, type Unit } from '../state';

export interface CombatForecast {
  profile: AttackProfile;
  attackSpeed: number;
  hitChance: number;
  criticalChance: number;
  damage: number;
}

export type CombatEvent =
  | { type: 'cost'; unitId: string; amount: number; hpAfter: number; profile: AttackProfile }
  | { type: 'strike'; attackerId: string; defenderId: string; profile: AttackProfile; hit: boolean; hitRoll: number; critical: boolean; criticalRoll?: number; damage: number; hpAfter: number; hitChance: number; criticalChance: number; followUp: boolean };

export interface CombatTimeline {
  events: CombatEvent[];
  finalHp: Record<string, number>;
}

export interface CombatantPreview extends CombatForecast {
  attacks: number;
  canAttack: boolean;
  totalHpCost: number;
  expectedDamage: number;
  fullHitDamage: number;
}

export interface CombatPreview {
  initiator: CombatantPreview;
  defender: CombatantPreview;
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

export const attackSpeed = (unit: Unit) => unit.stats.speed - attackProfile(unit).weight;

export function canAttackAt(unit: Unit, range: number) {
  const profile = attackProfile(unit);
  return range >= profile.minRange && range <= profile.maxRange && unit.hp > profile.hpCost;
}

export function forecast(attacker: Unit, defender: Unit): CombatForecast {
  const profile = attackProfile(attacker);
  const magical = profile.damageType === 'magical';
  const avoid = (magical
    ? defender.stats.speed + defender.stats.luck
    : terrainAt(defender.x, defender.y).avoid + defender.stats.speed - attackProfile(defender).weight) + itemAvoidBonus(defender);
  const hitChance = clamp((magical ? profile.hit : profile.hit + attacker.stats.skill) - avoid, 0, 100);
  const criticalChance = clamp(Math.floor((attacker.stats.skill + attacker.stats.luck) / 2) + profile.critical, 0, 100);
  const defense = magical ? defender.stats.resistance : defender.stats.defense;
  const damage = clamp(attacker.stats.strength + profile.might - defense, 1, 60);
  return { profile, attackSpeed: attackSpeed(attacker), hitChance, criticalChance, damage };
}

export function previewCombat(initiator: Unit, defender: Unit, range: number): CombatPreview {
  const initiatorCanAttack = canAttackAt(initiator, range);
  const defenderCanAttack = canAttackAt(defender, range);
  const initiatorForecast = forecast(initiator, defender);
  const defenderForecast = forecast(defender, initiator);
  let initiatorAttacks = initiatorCanAttack ? 1 : 0;
  let defenderAttacks = defenderCanAttack ? 1 : 0;
  if (initiatorCanAttack && initiatorForecast.attackSpeed > defenderForecast.attackSpeed) initiatorAttacks++;
  else if (defenderCanAttack && defenderForecast.attackSpeed > initiatorForecast.attackSpeed) defenderAttacks++;
  const affordableAttacks = (unit: Unit, profile: AttackProfile) => profile.hpCost > 0 ? Math.floor((unit.hp - 1) / profile.hpCost) : Infinity;
  initiatorAttacks = Math.min(initiatorAttacks, affordableAttacks(initiator, initiatorForecast.profile));
  defenderAttacks = Math.min(defenderAttacks, affordableAttacks(defender, defenderForecast.profile));
  const preview = (result: CombatForecast, attacks: number, canAttack: boolean): CombatantPreview => ({
    ...result,
    attacks,
    canAttack,
    totalHpCost: result.profile.hpCost * attacks,
    expectedDamage: attacks * result.damage * result.hitChance / 100 * (1 + 2 * result.criticalChance / 100),
    fullHitDamage: attacks * result.damage,
  });
  return {
    initiator: preview(initiatorForecast, initiatorAttacks, initiatorCanAttack),
    defender: preview(defenderForecast, defenderAttacks, defenderCanAttack),
  };
}

export function resolveCombat(initiator: Unit, defender: Unit, range: number, random: () => number = Math.random): CombatTimeline {
  const hp: Record<string, number> = { [initiator.id]: initiator.hp, [defender.id]: defender.hp };
  const events: CombatEvent[] = [];

  const strike = (attacker: Unit, target: Unit, followUp: boolean) => {
    if (hp[attacker.id] <= 0 || hp[target.id] <= 0 || !canAttackAt({ ...attacker, hp: hp[attacker.id] }, range)) return;
    const result = forecast(attacker, target);
    if (result.profile.hpCost > 0) {
      hp[attacker.id] -= result.profile.hpCost;
      events.push({ type: 'cost', unitId: attacker.id, amount: result.profile.hpCost, hpAfter: hp[attacker.id], profile: result.profile });
    }
    const roll = () => clamp(Math.floor(random() * 100) + 1, 1, 100);
    const hitRoll = roll();
    const hit = hitRoll <= result.hitChance;
    const criticalRoll = hit ? roll() : undefined;
    const critical = criticalRoll !== undefined && criticalRoll <= result.criticalChance;
    const damage = hit ? result.damage * (critical ? 3 : 1) : 0;
    hp[target.id] = Math.max(0, hp[target.id] - damage);
    events.push({ type: 'strike', attackerId: attacker.id, defenderId: target.id, profile: result.profile, hit, hitRoll, critical, criticalRoll, damage, hpAfter: hp[target.id], hitChance: result.hitChance, criticalChance: result.criticalChance, followUp });
  };

  strike(initiator, defender, false);
  strike(defender, initiator, false);
  if (hp[initiator.id] > 0 && hp[defender.id] > 0) {
    const initiatorSpeed = attackSpeed(initiator);
    const defenderSpeed = attackSpeed(defender);
    if (initiatorSpeed > defenderSpeed) strike(initiator, defender, true);
    else if (defenderSpeed > initiatorSpeed) strike(defender, initiator, true);
  }
  return { events, finalHp: hp };
}
