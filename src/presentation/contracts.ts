// Engine-neutral values only. No live Unit, Phaser or GPU objects cross this boundary.
export type Vec3 = Readonly<{ x: number; y: number; z: number }>;
export type GridPos = Readonly<{ x: number; y: number }>;
export type SpriteKey = 'sword' | 'lancer' | 'cavalry' | 'knight' | 'raider' | 'mage' | 'mossling' | 'tidecrab';
export interface TileView {
  readonly id: string;
  readonly grid: GridPos;
  readonly terrain: string;
  readonly center: Vec3;
  readonly heights: readonly number[]; // 3 × 3 vertices, NW to SE
}
export interface UnitView {
  readonly id: string;
  readonly name: string;
  readonly tileId: string;
  readonly sprite: SpriteKey;
  readonly feet: Vec3;
  readonly team: 'player' | 'enemy';
  readonly hp: number;
  readonly maxHp: number;
  readonly acted: boolean;
}
export interface TileMark { readonly tileId: string; readonly color: number; readonly alpha: number }
export interface RenderSnapshot {
  readonly sceneKey: string;
  readonly mapId: string;
  readonly revision: number;
  readonly cols: number;
  readonly rows: number;
  readonly tiles: readonly TileView[];
  readonly units: readonly UnitView[];
  readonly selectedUnitId: string | null;
  readonly marks: readonly TileMark[];
  readonly choosingTarget: boolean;
}
export interface MovementEvent {
  readonly type: 'movement'; readonly id: string; readonly sequence: number;
  readonly sceneKey: string; readonly unitId: string; readonly path: readonly Vec3[];
}
export type PickResult = { kind: 'tile'; tileId: string } | { kind: 'unit'; unitId: string } | null;
export interface TacticalRenderer {
  mount(host: HTMLElement, initial: RenderSnapshot): Promise<void>;
  present(snapshot: RenderSnapshot, events?: readonly MovementEvent[]): void;
  reset(snapshot: RenderSnapshot): void;
  update(delta: number): void;
  resize(width: number, height: number, dpr: number): void;
  pick(clientX: number, clientY: number): PickResult;
  skipPresentation(): void;
  dispose(): void;
}

interface CombatStepBase {
  readonly id: string;
  readonly sceneKey: string;
  readonly sequence: number;
  readonly abilityId: string;
  readonly abilityName: string;
  readonly hpBefore: number;
  readonly hpAfter: number;
}
export interface StrikeView extends CombatStepBase {
  readonly type: 'strike';
  readonly sourceId: string;
  readonly targetId: string;
  readonly sprite: SpriteKey;
  readonly magical: boolean;
  readonly hit: boolean;
  readonly critical: boolean;
  readonly followUp: boolean;
  readonly damage: number;
}
export interface CostView extends CombatStepBase { readonly type: 'cost'; readonly unitId: string; readonly amount: number }
export type CombatStep = StrikeView | CostView;
