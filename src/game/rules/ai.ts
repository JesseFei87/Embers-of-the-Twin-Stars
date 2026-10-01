import { distance, maxHp, terrainAt, type Unit } from '../state';
import { previewCombat } from './combat';
import { findPath, reachableTiles, type OccupiedCheck, type Position } from './movement';

export interface EnemyDecision {
  path: Position[];
  targetId?: string;
  score: number;
}

export function enemyIsActivated(enemy: Unit, players: Unit[], allies: Unit[] = []) {
  if (enemy.ai === 'guard') return false;
  if (!enemy.ai || enemy.ai === 'active') return true;
  const radius = enemy.aiRange ?? 5;
  if (enemy.ai === 'alert') return players.some(player => distance(enemy, player) <= radius);
  return allies.some(ally => ally !== enemy && (ally.hp < maxHp(ally) || players.some(player => distance(ally, player) <= radius)));
}

export function chooseEnemyAction(enemy: Unit, players: Unit[], occupied: OccupiedCheck, allies: Unit[] = []): EnemyDecision {
  const canMove = enemyIsActivated(enemy, players, allies);
  const positions = canMove ? reachableTiles(enemy, occupied) : [{ x: enemy.x, y: enemy.y, cost: 0 }];
  let best: EnemyDecision = { path: [], score: -Infinity };
  for (const position of positions) {
    const acting = { ...enemy, x: position.x, y: position.y };
    const terrain = terrainAt(position.x, position.y);
    const terrainValue = terrain.avoid * .25 + (enemy.hp < maxHp(enemy) ? terrain.recovery * 4 : 0);
    let attacked = false;
    for (const player of players) {
      const range = distance(acting, player);
      const preview = previewCombat(acting, player, range);
      if (!preview.initiator.canAttack) continue;
      attacked = true;
      const expectedDamage = preview.initiator.damage * preview.initiator.attacks * preview.initiator.hitChance / 100;
      const expectedRisk = preview.defender.canAttack ? preview.defender.damage * preview.defender.attacks * preview.defender.hitChance / 100 : 0;
      const canKill = preview.initiator.damage * preview.initiator.attacks >= player.hp;
      const hpAfterCasting = enemy.hp - preview.initiator.totalHpCost;
      const canBeKilled = preview.defender.damage * preview.defender.attacks >= hpAfterCasting;
      const castingRisk = preview.initiator.totalHpCost * (hpAfterCasting <= maxHp(enemy) / 3 ? 8 : 3);
      const score = 90 + expectedDamage * 10 - expectedRisk * 7 - castingRisk + (canKill ? 500 : 0) - (canBeKilled ? 120 : 0) + terrainValue + (player.id === 'kael' ? 18 : 0) - position.cost;
      if (score > best.score) best = { path: findPath(enemy, position.x, position.y, occupied), targetId: player.id, score };
    }
    if (!attacked) {
      const nearest = Math.min(...players.map(player => distance(acting, player)));
      const score = -nearest * 12 + terrainValue - position.cost;
      if (score > best.score) best = { path: findPath(enemy, position.x, position.y, occupied), score };
    }
  }
  return best;
}
