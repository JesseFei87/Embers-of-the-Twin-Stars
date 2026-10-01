import { MAP_H, MAP_W, attackProfile, type Unit } from '../state';
import { reachableTiles, type OccupiedCheck, type Position } from './movement';

const keyOf = (x: number, y: number) => `${x},${y}`;

export interface ThreatRange {
  movement: Position[];
  attack: Position[];
}

export function enemyThreatRange(enemy: Unit, occupied: OccupiedCheck): ThreatRange {
  const movement = enemy.ai === 'guard' ? [{ x: enemy.x, y: enemy.y }] : reachableTiles(enemy, occupied);
  const profile = attackProfile(enemy);
  const attack = new Map<string, Position>();
  for (const origin of movement) {
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
      const range = Math.abs(origin.x - x) + Math.abs(origin.y - y);
      if (range >= profile.minRange && range <= profile.maxRange) attack.set(keyOf(x, y), { x, y });
    }
  }
  return { movement, attack: [...attack.values()] };
}
