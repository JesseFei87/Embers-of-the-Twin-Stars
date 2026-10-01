import type { Unit } from './types';

export type VictoryCondition =
  | { type: 'rout'; label: string }
  | { type: 'defeat-boss'; unitId: string; label: string }
  | { type: 'seize'; x: number; y: number; unitId?: string; label: string };

export interface MissionDefinition {
  title: string;
  turnLimit: number;
  leaderId: string;
  victoryMode: 'any' | 'all';
  victory: VictoryCondition[];
}

export const currentMission: MissionDefinition = {
  title: '穿越星落桥',
  turnLimit: 20,
  leaderId: 'kael',
  victoryMode: 'any',
  victory: [
    { type: 'defeat-boss', unitId: 'e1', label: '击败蚀月骑士' },
    { type: 'seize', x: 4, y: 0, unitId: 'kael', label: '凯尔抵达北岸' },
  ],
};

export interface MissionResult { status: 'playing' | 'victory' | 'defeat'; reason: string }

export function evaluateMission(mission: MissionDefinition, units: Unit[], turn: number): MissionResult {
  const living = units.filter(unit => unit.hp > 0);
  if (!living.some(unit => unit.id === mission.leaderId)) return { status: 'defeat', reason: '主角战败' };
  if (!living.some(unit => unit.team === 'player')) return { status: 'defeat', reason: '我方全灭' };
  if (turn > mission.turnLimit) return { status: 'defeat', reason: '超过回合限制' };
  const completed = mission.victory.map(condition => {
    if (condition.type === 'rout') return !living.some(unit => unit.team === 'enemy');
    if (condition.type === 'defeat-boss') return !living.some(unit => unit.id === condition.unitId);
    return living.some(unit => (!condition.unitId || unit.id === condition.unitId) && unit.team === 'player' && unit.x === condition.x && unit.y === condition.y);
  });
  const won = mission.victoryMode === 'all' ? completed.every(Boolean) : completed.some(Boolean);
  return won ? { status: 'victory', reason: mission.victory.filter((_, index) => completed[index]).map(condition => condition.label).join(' / ') } : { status: 'playing', reason: '' };
}
