import { MAP_H, MAP_W, classes, move, terrainAt, type Unit } from '../state';

export interface Position { x: number; y: number }
export interface ReachablePosition extends Position { cost: number }
export type OccupiedCheck = (x: number, y: number, ignore?: Unit) => boolean;

const keyOf = (x: number, y: number) => `${x},${y}`;

function movementCost(unit: Unit, x: number, y: number) {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return null;
  return terrainAt(x, y).moveCost[classes[unit.class].movementProfile];
}

function search(unit: Unit, occupied: OccupiedCheck) {
  const start = keyOf(unit.x, unit.y);
  const cost = new Map<string, number>([[start, 0]]);
  const parent = new Map<string, string | null>([[start, null]]);
  const open: ReachablePosition[] = [{ x: unit.x, y: unit.y, cost: 0 }];
  const dirs = [[1, 0], [-1, 0], [0, -1], [0, 1]];
  while (open.length) {
    open.sort((a, b) => a.cost - b.cost);
    const current = open.shift()!;
    if (current.cost !== cost.get(keyOf(current.x, current.y))) continue;
    for (const [dx, dy] of dirs) {
      const x = current.x + dx, y = current.y + dy;
      const stepCost = movementCost(unit, x, y);
      if (stepCost === null || occupied(x, y, unit)) continue;
      const nextCost = current.cost + stepCost;
      const nextKey = keyOf(x, y);
      if (nextCost > move(unit) || nextCost >= (cost.get(nextKey) ?? Infinity)) continue;
      cost.set(nextKey, nextCost); parent.set(nextKey, keyOf(current.x, current.y));
      open.push({ x, y, cost: nextCost });
    }
  }
  return { cost, parent, start };
}

export function reachableTiles(unit: Unit, occupied: OccupiedCheck): ReachablePosition[] {
  const { cost } = search(unit, occupied);
  return [...cost].map(([key, value]) => {
    const [x, y] = key.split(',').map(Number);
    return { x, y, cost: value };
  });
}

export function findPath(unit: Unit, targetX: number, targetY: number, occupied: OccupiedCheck): Position[] {
  if (targetX === unit.x && targetY === unit.y) return [];
  const { parent, start } = search(unit, occupied);
  const target = keyOf(targetX, targetY);
  if (!parent.has(target)) return [];
  const path: Position[] = [];
  let cursor: string | null = target;
  while (cursor && cursor !== start) {
    const [x, y] = cursor.split(',').map(Number);
    path.unshift({ x, y });
    cursor = parent.get(cursor) ?? null;
  }
  return path;
}
