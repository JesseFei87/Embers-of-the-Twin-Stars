import type { CombatTimeline } from '../game/rules/combat';
import { chapters } from '../game/data/chapters';
import type { Unit } from '../game/data/types';
import { spriteVisual } from '../game/ui/fighter';
import type { CombatStep, GridPos, MovementEvent, RenderSnapshot, SpriteKey, TileMark } from './contracts';
import { makeTiles, surfacePoint, tileId, visualFor } from './visual-config/maps';

export class GameRenderAdapter {
  private revision = 0;
  private sequence = 0;
  readonly tiles;
  readonly cols: number;
  readonly rows: number;
  constructor(readonly mapId: string, readonly sceneKey: string) {
    visualFor(mapId);
    const map = chapters[mapId].map;
    this.cols = map[0].length; this.rows = map.length;
    this.tiles = makeTiles(map, mapId);
    this.tiles.forEach(tile => { Object.freeze(tile.grid); Object.freeze(tile.center); Object.freeze(tile.heights); Object.freeze(tile); });
    Object.freeze(this.tiles);
  }
  snapshot(units: readonly Unit[], selected: string | null, marks: readonly TileMark[], choosingTarget = false): RenderSnapshot {
    for (const mark of marks) if (!this.tiles.some(tile => tile.id === mark.tileId)) throw new Error(`未知视觉格子：${mark.tileId}`);
    return {
      sceneKey: this.sceneKey, mapId: this.mapId, revision: ++this.revision,
      cols: this.cols, rows: this.rows, tiles: this.tiles, selectedUnitId: selected, choosingTarget,
      marks: marks.map(mark => ({ ...mark })),
      units: units.map(unit => {
        const tile = this.tiles.find(tile => tile.id === tileId(unit.x, unit.y));
        if (!tile) throw new Error(`单位 ${unit.id} 位于无效格子`);
        return { id: unit.id, name: unit.name, tileId: tile.id, sprite: spriteVisual(unit.class) as SpriteKey,
          feet: { ...tile.center }, team: unit.team, hp: unit.hp, maxHp: unit.stats.maxHp, acted: unit.acted };
      }),
    };
  }
  combat(timeline: CombatTimeline, units: readonly Unit[], actionId: string): readonly CombatStep[] {
    const hp = new Map(units.map(unit => [unit.id, unit.hp]));
    return timeline.events.map((event, index): CombatStep => {
      const unitId = event.type === 'cost' ? event.unitId : event.defenderId;
      const hpBefore = hp.get(unitId);
      if (hpBefore === undefined) throw new Error(`事件引用未知单位：${unitId}`);
      hp.set(unitId, event.hpAfter);
      const base = { id: `${actionId}:${index}`, sceneKey: this.sceneKey, sequence: ++this.sequence,
        abilityId: event.profile.id, abilityName: event.profile.name, hpBefore, hpAfter: event.hpAfter };
      if (event.type === 'cost') return Object.freeze({ ...base, type: 'cost', unitId, amount: event.amount });
      const source = units.find(unit => unit.id === event.attackerId);
      if (!source) throw new Error(`事件引用未知攻击者：${event.attackerId}`);
      return Object.freeze({ ...base, type: 'strike', sourceId: event.attackerId, targetId: event.defenderId,
        sprite: spriteVisual(source.class) as SpriteKey, magical: event.profile.damageType === 'magical',
        hit: event.hit, critical: event.critical, followUp: event.followUp, damage: event.damage });
    });
  }
  movement(unitId: string, from: GridPos, to: GridPos): MovementEvent {
    const sequence = ++this.sequence;
    // Subdivide to follow the actual surface instead of jumping between tile-center heights.
    const path = Array.from({ length: 9 }, (_, i) => surfacePoint(this.tiles, this.cols, this.rows,
      from.x + (to.x - from.x) * i / 8 + .5 - this.cols / 2,
      from.y + (to.y - from.y) * i / 8 + .5 - this.rows / 2));
    return { type: 'movement', id: `move-${sequence}`, sceneKey: this.sceneKey, sequence, unitId, path };
  }
}
