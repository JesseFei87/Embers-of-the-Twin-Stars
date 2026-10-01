import Phaser from 'phaser';
import { battleMusic, bindMusicSettings } from '../audio/BattleMusic';
import { MAP_H, MAP_W, attackProfile, attackSpells, classes, currentMission, distance, healingSpell, healingSpells, maxHp, terrain, terrainAt, type Team, type Unit, type UnitClass } from './state';
import { canAttackAt, forecast, previewCombat, resolveCombat, type CombatEvent, type CombatTimeline } from './rules/combat';
import { findPath as weightedPath, reachableTiles } from './rules/movement';
import { chooseEnemyAction } from './rules/ai';
import { enemyThreatRange } from './rules/threat';
import { evaluateMission } from './data/mission';
import { combatExperience, grantExperience, healingExperience, statLabels } from './rules/progression';
import { applyPromotion, promotionFor, promotionGains } from './data/promotions';
import { canRecruit, recruitmentRuleFor } from './data/recruitment';
import { abandonBattle, completeChapter, saveGame, unitsForBattle } from './save';
import { chapters } from './data/chapters';
import { itemDescription, itemName, utilityItems } from './data/items';
import { fighterArt, showFighterPose, spriteVisual } from './ui/fighter';
import { drawTacticalMap } from './ui/tacticalMap';
import { playDialogue } from './ui/dialogue';
import { portraitIndex, characterNotes } from './ui/portraits';
import { noxFrameCanvas, noxSpriteData } from './ui/noxSprite';
import { moonlitSpriteKey, moonlitSpriteKeys } from './ui/moonlitSprites';
import { portraitUrl, cutoutPortraitUrl, showChronicleDialog, portraitMarkup } from './ui/replica';
import { paperBook, paperSheet, paperTitle, paperMessage, paperButton, paperTabs, paperPage, settingsPages } from './ui/parchment';
import { CombatPlayback } from '../presentation/CombatPlayback';
import { GameRenderAdapter } from '../presentation/GameRenderAdapter';
import { RenderHost } from '../presentation/RenderHost';
import type { DisplaySettings } from '../presentation/DisplaySettings';
import type { CombatStep, MovementEvent, PickResult, TileMark } from '../presentation/contracts';
import '../presentation/presentation.css';
import mapIcon from '@phosphor-icons/core/assets/regular/map-trifold.svg';
import partyIcon from '@phosphor-icons/core/assets/fill/flag-fill.svg';
import compassIcon from '@phosphor-icons/core/assets/thin/compass-rose-thin.svg';
import questsIcon from '@phosphor-icons/core/assets/regular/scroll.svg';
import saveIcon from '@phosphor-icons/core/assets/regular/feather.svg';
import systemIcon from '@phosphor-icons/core/assets/fill/gear-fill.svg';

const battleMenuIcons: Record<string, string> = { map:mapIcon, party:partyIcon, items:'/assets/chronicle/battle-v2/items-pouch.png', quests:questsIcon, save:saveIcon, system:systemIcon };

const hud = document.querySelector<HTMLDivElement>('#hud')!;
const sleep = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));
type Mode = 'idle' | 'move' | 'command' | 'target' | 'confirm' | 'heal-target' | 'enemy' | 'locked' | 'ended';
const stagingKey = 'embers-battle-staging-v1';

const classLabel = Object.fromEntries(Object.entries(classes).map(([id, value]) => [id, value.name])) as Record<UnitClass, string>;

export class PixelBattleScene extends Phaser.Scene {
  private readonly tile = 64;
  private readonly ox = 160;
  private readonly oy = 64;
  private units: Unit[] = [];
  private containers = new Map<string, Phaser.GameObjects.Container>();
  private unitSprites = new Map<string, Phaser.GameObjects.Sprite>();
  private overlays: Phaser.GameObjects.Rectangle[] = [];
  private dangerOverlays: Phaser.GameObjects.Rectangle[] = [];
  private selected?: Unit;
  private mode: Mode = 'idle';
  private turn = 1;
  private animFrame = 0;
  private walkingUnitId?: string;
  private castingUnitId?: string;
  private chapterId = 'starfall-bridge';
  private collectedLoot: string[] = [];
  private pendingMove?: { unitId: string; x: number; y: number };
  private showAllThreats = false;
  private animationSpeed: 1 | 2 = 1;
  private compactCombat = false;
  private skipCurrentStage = false;
  private showCombatLog = false;
  private combatLog: string[] = [];
  private bossDialoguePlayed = false;
  private renderHost?: RenderHost;
  private renderAdapter?: GameRenderAdapter;
  private renderNotice = '';
  private renderInstance = 0;
  private combatActionId = 0;
  private leaving = false;
  private pathMarks: TileMark[] = [];
  private staging = false;
  private toolsOpen = false;

  constructor() { super('battle'); }

  init(data: { staging?: boolean } = {}) { this.staging = !!data.staging; }

  preload() {
    this.load.image('battle-backdrop-v4', '/assets/hd2d/battle.png');
    this.load.image('hd-terrain', '/assets/hd2d/terrain.png');
    this.load.image('hd-props', '/assets/hd2d/props.png');
    this.load.image('nox-atlas', noxSpriteData.image);
    for (const key of moonlitSpriteKeys) for (let frame = 0; frame < 6; frame++) {
      this.load.image(`hd-${key}-${frame}`, `/assets/hd2d/${key}/0${frame + 1}.png`);
    }
    const classes: UnitClass[] = ['sword', 'mage', 'cleric', 'star-cavalry', 'witch', 'lancer', 'knight', 'raider', 'hero', 'sage', 'saint', 'valkyrie', 'paladin', 'baron', 'mossling', 'tidecrab'];
    for (const cls of classes) {
      for (let frame = 0; frame < 6; frame++) this.load.image(this.textureKey(cls, 'player', frame), this.mapAssetPath(cls, frame));
    }
  }

  create() {
    this.leaving = false; this.pathMarks = [];
    for (let frame = 0; frame < 6; frame++) {
      const key = `hd-nox-${frame}`;
      if (!this.textures.exists(key)) this.textures.addCanvas(key, noxFrameCanvas(this.textures.get('nox-atlas').getSourceImage() as HTMLImageElement, frame, 92));
    }
    const saved = unitsForBattle();
    this.units = saved.units; this.turn = saved.turn; this.chapterId = saved.chapterId;
    battleMusic.playChapter(this.chapterId);
    this.events.once('shutdown', () => battleMusic.stop());
    this.toolsOpen = false;
    // UI-only checkpoint: old/in-progress saves open directly in the compact HUD.
    const stagingSignature = JSON.stringify({ chapterId: this.chapterId, turn: this.turn, units: this.units });
    try {
      this.staging ||= localStorage.getItem(stagingKey) === stagingSignature;
      if (saved.phase === 'enemy') this.staging = false;
      if (this.staging) localStorage.setItem(stagingKey, stagingSignature);
      else localStorage.removeItem(stagingKey);
    } catch { /* A nonpersistent session still supports the two UI phases. */ }
    this.containers.clear(); this.unitSprites.clear(); this.overlays = []; this.dangerOverlays = [];
    this.selected = undefined; this.mode = 'idle'; this.animFrame = 0; this.walkingUnitId = undefined; this.collectedLoot = [...saved.battleLoot]; this.pendingMove = undefined;
    this.castingUnitId = undefined;
    this.showAllThreats = false; this.showCombatLog = false; this.combatLog = []; this.bossDialoguePlayed = false;
    this.cameras.main.setBackgroundColor('#06111a');
    this.units.forEach(unit => this.drawUnit(unit));
    const resizeMap = () => { this.cameras.main.setZoom(Math.min(1, 640 / (MAP_W * this.tile), 512 / (MAP_H * this.tile))).centerOn(this.ox + MAP_W * this.tile / 2, this.oy + MAP_H * this.tile / 2); };
    resizeMap(); this.scale.on('resize', resizeMap);
    this.events.once('shutdown', () => { this.scale.off('resize', resizeMap); this.input.off('pointerdown', this.handleGridClick, this); });
    this.time.removeAllEvents();
    this.time.addEvent({ delay: 110, loop: true, callback: () => this.animateUnits() });
    this.input.off('pointerdown', this.handleGridClick, this);
    this.cameras.main.visible = false;
    this.renderAdapter = new GameRenderAdapter(this.chapterId, `${this.chapterId}:${++this.renderInstance}`);
    const resumeEnemy = saved.phase === 'enemy' || this.living().filter(unit => unit.team === 'player').every(unit => unit.acted);
    let enemyPhaseResumed = false;
    this.renderHost = new RenderHost(this.renderSnapshot(), pick => this.handleRenderPick(pick), (enabled, message) => {
      if (this.leaving || !this.cameras.main) return;
      this.cameras.main.visible = false;
      this.renderNotice = message ?? '';
      if (enabled && resumeEnemy && !enemyPhaseResumed) { enemyPhaseResumed = true; this.time.delayedCall(0, () => void this.enemyPhase()); }
      if (['idle', 'move', 'command', 'target', 'heal-target', 'enemy'].includes(this.mode)) this.refreshHud();
    }, pick => this.previewRenderPath(pick));
    this.events.once('shutdown', () => { this.leaving = true; this.renderHost?.dispose(); this.renderHost = undefined; });
    this.mode = resumeEnemy ? 'enemy' : 'idle';
    this.refreshHud(resumeEnemy ? '正在恢复敌方阶段…' : '');
    if (!this.staging) this.showBanner(resumeEnemy ? '敌方阶段' : '我方阶段');
    if (!resumeEnemy) this.autosave();
    void this.renderHost.enable();
  }

  private renderSnapshot() {
    const marks: TileMark[] = [...this.dangerOverlays, ...this.overlays].map(overlay => ({
      tileId: `${Math.round((overlay.x - this.ox - 32) / this.tile)},${Math.round((overlay.y - this.oy - 32) / this.tile)}`,
      color: overlay.fillColor, alpha: overlay.fillAlpha,
    }));
    return this.renderAdapter!.snapshot(this.units, this.selected?.id ?? null, [...marks, ...this.pathMarks], ['move', 'target', 'heal-target', 'confirm'].includes(this.mode));
  }
  private present(events: readonly MovementEvent[] = []) { if (this.renderAdapter && !this.leaving) this.renderHost?.present(this.renderSnapshot(), events); }
  private handleRenderPick(pick: PickResult) {
    if (!pick) return;
    const tile = pick.kind === 'unit' ? this.units.find(unit => unit.id === pick.unitId) : (() => { const [x, y] = pick.tileId.split(',').map(Number); return { x, y }; })();
    if (tile) this.handleTileClick(tile.x, tile.y);
  }

  private previewRenderPath(pick: PickResult) {
    if (this.mode !== 'move' || !this.selected) return;
    const position = pick?.kind === 'unit' ? this.units.find(unit => unit.id === pick.unitId) : pick?.kind === 'tile' ? (() => { const [x, y] = pick.tileId.split(',').map(Number); return { x, y }; })() : undefined;
    this.pathMarks = position ? this.findPath(this.selected, position.x, position.y).map(p => ({ tileId: `${p.x},${p.y}`, color: 0xffd887, alpha: .46 })) : [];
    this.present();
  }

  private showRenderSettings() {
    if (!this.renderHost || ['locked', 'enemy', 'confirm', 'ended'].includes(this.mode)) return;
    const returnMode = this.mode; this.mode = 'confirm';
    const settings = this.renderHost.settings;
    const pages = settingsPages(settings);
    hud.innerHTML = paperBook(pages.left, pages.right, paperButton('返回战场', 'render-settings-close', true, true), '系统设置');
    hud.querySelector('#render-quality')?.addEventListener('change', event => this.renderHost?.configure({ quality: (event.target as HTMLSelectElement).value as DisplaySettings['quality'] }));
    hud.querySelector('#render-time')?.addEventListener('change', event => this.renderHost?.configure({ timeOfDay: (event.target as HTMLSelectElement).value as DisplaySettings['timeOfDay'] }));
    hud.querySelector('#render-weather')?.addEventListener('change', event => this.renderHost?.configure({ weather: (event.target as HTMLSelectElement).value as DisplaySettings['weather'] }));
    hud.querySelectorAll<HTMLInputElement>('[data-render-setting]').forEach(input => input.addEventListener('change', () => this.renderHost?.configure({ [input.dataset.renderSetting!]: input.checked })));
    bindMusicSettings(hud);
    hud.querySelector('#render-settings-close')?.addEventListener('click', () => { this.mode = returnMode; this.refreshHud(); });
  }

  private drawBackdrop() {
    const zoom = Math.min(1, 640 / (MAP_W * this.tile), 512 / (MAP_H * this.tile));
    const width = 960 / zoom, height = 640 / zoom, cx = this.ox + MAP_W * this.tile / 2, cy = this.oy + MAP_H * this.tile / 2;
    this.add.image(cx, cy, 'battle-backdrop-v4').setDisplaySize(width, height).setAlpha(.28).setDepth(-21);
    const g = this.add.graphics().setDepth(-20);
    g.fillGradientStyle(0x0b1825, 0x0b1825, 0x142830, 0x091523, .75).fillRect(cx - width / 2, cy - height / 2, width, height);
  }

  private drawPixelMap() {
    drawTacticalMap(this, terrain, this.ox, this.oy);
  }

  private createPixelUnitTextures() {
    const classes: UnitClass[] = ['sword', 'mage', 'lancer', 'knight', 'raider'];
    const teams: Team[] = ['player', 'enemy'];
    for (const cls of classes) for (const team of teams) for (let frame = 0; frame < 3; frame++) {
      const key = this.textureKey(cls, team, frame);
      if (this.textures.exists(key)) continue;
      const texture = this.textures.createCanvas(key, 32, 40)!;
      const ctx = texture.getContext();
      ctx.imageSmoothingEnabled = false;
      this.paintUnit(ctx, cls, team, frame);
      texture.refresh();
    }
  }

  private unitTextureKey(unit: Unit, frame: number) {
    const identity = moonlitSpriteKey(unit.id);
    return unit.id === 'e2' ? `hd-nox-${frame}` : identity ? `hd-${identity}-${frame}` : this.textureKey(unit.class, unit.team, frame);
  }
  private textureKey(cls: UnitClass, _team: Team, frame: number) { return `hd-${cls}-${frame}`; }
  private mapAssetPath(cls: UnitClass, frame: number) {
    return `/assets/hd2d/${spriteVisual(cls)}/0${frame + 1}.png`;
  }
  private assetClass(cls: UnitClass) {
    if (cls === 'star-cavalry' || cls === 'valkyrie') return 'star-cavalry';
    if (cls === 'cleric' || cls === 'witch' || cls === 'sage' || cls === 'saint') return 'mage';
    if (cls === 'hero') return 'sword';
    if (cls === 'paladin') return 'lancer';
    if (cls === 'baron') return 'knight';
    return cls;
  }
  private stageAssetPath(cls: UnitClass) {
    const visual = this.assetClass(cls);
    return visual === 'star-cavalry' ? '/assets/sprites-v3/stage/star-cavalry.png' : `/assets/sprites-v2/stage/${visual}.png`;
  }
  private classEmblem(cls: UnitClass) {
    const visual = this.assetClass(cls);
    return visual === 'star-cavalry' ? '✦♞' : visual === 'mage' ? '✦' : visual === 'lancer' ? '➶' : visual === 'knight' ? '◆' : visual === 'raider' ? '⚔' : '⚔';
  }
  private isHealer(unit: Unit) { return !!healingSpell(unit); }
  private aiLabel(unit: Unit) {
    if (unit.team !== 'enemy') return '';
    return { active: '主动', guard: '守位', alert: `警戒 ${unit.aiRange ?? 5}`, support: `援护 ${unit.aiRange ?? 5}` }[unit.ai ?? 'active'];
  }
  private px(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w: number, h: number) { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); }

  private paintUnit(ctx: CanvasRenderingContext2D, cls: UnitClass, team: Team, frame: number) {
    ctx.clearRect(0, 0, 32, 40);
    const primary = team === 'player' ? '#168a91' : '#713555';
    const light = team === 'player' ? '#59d6cf' : '#df5f86';
    const dark = team === 'player' ? '#0b4753' : '#321d39';
    const metal = team === 'player' ? '#d8e4c7' : '#a9a1b7';
    const bob = frame === 1 ? 1 : 0, foot = frame === 2 ? 2 : 0;
    this.px(ctx, 'rgba(0,0,0,.35)', 6, 35, 21, 3);
    if (cls === 'lancer') { this.px(ctx, '#e8d18c', 25, 2 + bob, 2, 33); this.px(ctx, '#f5f0cf', 23, 1 + bob, 6, 5); }
    if (cls === 'sword') { this.px(ctx, '#e8d18c', 2, 14 - frame, 3, 22); this.px(ctx, '#f5f0cf', 1, 10 - frame, 5, 8); }
    if (cls === 'raider') { this.px(ctx, '#d9c487', 2, 19 - frame, 8, 3); this.px(ctx, '#eef1d7', 1, 17 - frame, 7, 3); }
    this.px(ctx, dark, 9, 14 + bob, 15, 18);
    this.px(ctx, primary, 7, 17 + bob, 19, 12);
    this.px(ctx, light, 9, 17 + bob, 4, 10);
    if (cls === 'knight') {
      this.px(ctx, metal, 6, 14 + bob, 21, 17); this.px(ctx, dark, 9, 17 + bob, 15, 11);
      this.px(ctx, primary, 3, 18 + bob, 8, 15); this.px(ctx, light, 5, 20 + bob, 3, 9);
    }
    if (cls === 'mage') {
      this.px(ctx, '#eee6d3', 8, 17 + bob, 17, 14); this.px(ctx, primary, 6, 23 + bob, 21, 10);
      this.px(ctx, frame === 1 ? '#fff4a4' : '#63e0df', 26, 8, 4, 4); this.px(ctx, light, 27, 5 + frame, 2, 10);
    }
    this.px(ctx, '#d6a47d', 11, 7 + bob, 11, 9);
    this.px(ctx, cls === 'knight' ? metal : dark, 9, 4 + bob, 15, 7);
    this.px(ctx, light, 11, 5 + bob, 4, 3);
    if (cls === 'raider') { this.px(ctx, dark, 7, 5 + bob, 19, 5); this.px(ctx, '#f06a93', 12, 9 + bob, 3, 2); }
    this.px(ctx, dark, 8 - foot, 30 + bob, 7, 6); this.px(ctx, dark, 18 + foot, 30 + bob, 7, 6);
    this.px(ctx, '#d7bd72', 8 - foot, 35 + bob, 8, 2); this.px(ctx, '#d7bd72', 18 + foot, 35 + bob, 8, 2);
  }

  private drawUnit(unit: Unit) {
    const x = this.ox + unit.x * this.tile + 32, y = this.oy + unit.y * this.tile + 29;
    const color = unit.team === 'player' ? 0x5be0d5 : 0xef6289;
    const ring = this.add.ellipse(0, 18, 43, 19, color, .16).setStrokeStyle(2, color, .8);
    const mounted = this.assetClass(unit.class) === 'star-cavalry';
    const sprite = this.add.sprite(0, 19, this.unitTextureKey(unit, 0)).setDisplaySize(mounted ? 70 : 66, mounted ? 70 : 66).setOrigin(.5, 1).setFlipX(unit.team === 'enemy');
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) this.tweens.add({ targets: sprite, y: 17.5, duration: 1100 + unit.x * 50, repeat: -1, yoyo: true, ease: 'Sine.easeInOut' });
    const hpBack = this.add.rectangle(0, 27, 42, 5, 0x071018).setStrokeStyle(1, 0xe7d7a3, .5);
    const hp = this.add.rectangle(-20, 27, 40 * unit.hp / maxHp(unit), 3, unit.team === 'player' ? 0x66d89c : 0xe85a72).setOrigin(0, .5).setName('hp');
    const label = this.add.text(0, 31, unit.name, { fontFamily: 'monospace', fontSize: 10, color: '#fff5cf', stroke: '#071018', strokeThickness: 3 }).setOrigin(.5, 0);
    const container = this.add.container(x, y, [ring, sprite, hpBack, hp, label]).setDepth(10 + unit.y * .1).setSize(50, 58).setInteractive({ useHandCursor: true });
    container.setData('unit', unit.id);
    this.containers.set(unit.id, container); this.unitSprites.set(unit.id, sprite);
  }

  private redrawUnit(unit: Unit) {
    this.containers.get(unit.id)?.destroy(); this.containers.delete(unit.id); this.unitSprites.delete(unit.id); this.drawUnit(unit);
  }

  private autosave(phase: 'player' | 'enemy' = 'player') { saveGame(this.units, this.turn, phase, this.collectedLoot); }

  private animateUnits() {
    this.animFrame = (this.animFrame + 1) % 3;
    for (const unit of this.living()) {
      const sprite = this.unitSprites.get(unit.id); if (!sprite) continue;
      if (this.castingUnitId === unit.id) continue;
      sprite.setTexture(this.unitTextureKey(unit, this.walkingUnitId === unit.id ? this.animFrame : 0));
      if ((unit.class === 'mage' || this.isHealer(unit)) && this.animFrame === 1) sprite.setTint(0xe6ffff); else sprite.clearTint();
    }
  }

  private living() { return this.units.filter(unit => unit.hp > 0); }
  private occupied(x: number, y: number, ignore?: Unit) { return this.living().some(unit => unit !== ignore && unit.x === x && unit.y === y); }
  private isReachable(unit: Unit, x: number, y: number) { return this.findPath(unit, x, y).length > 0 || unit.x === x && unit.y === y; }
  private adjacentEnemies(unit: Unit) { return this.living().filter(other => other.team !== unit.team && canAttackAt(unit, distance(unit, other))); }
  private adjacentInjuredAllies(unit: Unit) {
    const spell = healingSpell(unit); if (!spell) return [];
    return this.living().filter(other => other !== unit && other.team === unit.team && other.hp < maxHp(other) && distance(unit, other) >= spell.minRange && distance(unit, other) <= spell.maxRange);
  }
  private adjacentTalkTargets(unit: Unit) { return this.living().filter(other => other.team !== unit.team && distance(unit, other) === 1 && !!recruitmentRuleFor(other)); }
  private adjacentAllies(unit: Unit) { return this.living().filter(other => other !== unit && other.team === unit.team && distance(unit, other) === 1); }

  private findPath(unit: Unit, targetX: number, targetY: number) {
    return weightedPath(unit, targetX, targetY, (x, y, ignore) => this.occupied(x, y, ignore));
  }

  private async walkPath(unit: Unit, path: Array<{ x: number; y: number }>) {
    const container = this.containers.get(unit.id)!; const sprite = this.unitSprites.get(unit.id)!;
    this.walkingUnitId = unit.id;
    for (let index = 0; index < path.length; index++) {
      const step = path[index]; sprite.setTexture(this.unitTextureKey(unit, index % 2 ? 2 : 1));
      if (step.x !== unit.x) sprite.setFlipX(step.x < unit.x);
      const from = { x: unit.x, y: unit.y };
      unit.x = step.x; unit.y = step.y;
      this.present(this.renderAdapter ? [this.renderAdapter.movement(unit.id, from, step)] : []);
      container.setDepth(10 + unit.y * .1);
      await new Promise<void>(resolve => this.tweens.add({ targets: container, x: this.ox + step.x * 64 + 32, y: this.oy + step.y * 64 + 29, duration: 190, ease: 'Linear', onComplete: () => resolve() }));
    }
    this.walkingUnitId = undefined;
    sprite.setTexture(this.unitTextureKey(unit, 0));
  }

  private handleGridClick(pointer: Phaser.Input.Pointer) {
    if (pointer.event.target !== this.game.canvas) return;
    const point = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const x = Math.floor((point.x - this.ox) / this.tile), y = Math.floor((point.y - this.oy) / this.tile);
    this.handleTileClick(x, y);
  }

  private handleTileClick(x: number, y: number) {
    if (this.staging || hud.querySelector('dialog[open]') || this.scene.isPaused()) return;
    if (['enemy', 'locked', 'confirm', 'ended'].includes(this.mode) || !this.renderHost?.enabled) return;
    if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return;
    const clicked = this.living().find(unit => unit.x === x && unit.y === y);
    const selectedHeal = this.selected ? healingSpell(this.selected) : undefined;
    if (this.mode === 'heal-target' && clicked && this.selected && selectedHeal && clicked.team === 'player' && clicked !== this.selected && clicked.hp < maxHp(clicked) && distance(this.selected, clicked) >= selectedHeal.minRange && distance(this.selected, clicked) <= selectedHeal.maxRange) {
      void this.resolveHeal(this.selected, clicked); return;
    }
    if (this.mode === 'target' && clicked && this.selected && clicked.team === 'enemy' && canAttackAt(this.selected, distance(this.selected, clicked))) {
      void this.openCombatPreview(this.selected, clicked); return;
    }
    if (this.mode === 'move' && this.selected && this.isReachable(this.selected, x, y)) {
      void this.moveSelected(x, y); return;
    }
    if (['command', 'target', 'heal-target'].includes(this.mode)) return;
    if (clicked?.team === 'player' && !clicked.acted) this.select(clicked);
    else if (clicked?.team === 'enemy') this.inspectEnemy(clicked);
    else if (clicked) { this.selected = clicked; this.mode = 'idle'; this.clearOverlays(); this.refreshHud(); }
    else { this.selected = undefined; this.mode = 'idle'; this.clearOverlays(); this.refreshHud(); }
  }

  private select(unit: Unit) {
    this.selected = unit; this.mode = 'move'; this.pendingMove = undefined; this.clearOverlays();
    reachableTiles(unit, (x, y, ignore) => this.occupied(x, y, ignore)).forEach(tile => this.addOverlay(tile.x, tile.y, 0x50e1d2, .28));
    this.refreshHud('选择移动位置');
  }

  private addOverlay(x: number, y: number, color: number, alpha: number) {
    const overlay = this.add.rectangle(this.ox + x * this.tile + 32, this.oy + y * this.tile + 32, 58, 58, color, alpha).setStrokeStyle(3, color, .9).setDepth(2);
    this.overlays.push(overlay);
  }
  private clearOverlays() { this.pathMarks = []; this.overlays.forEach(overlay => overlay.destroy()); this.overlays = []; }

  private clearDangerOverlays() { this.dangerOverlays.forEach(overlay => overlay.destroy()); this.dangerOverlays = []; }

  private inspectEnemy(enemy: Unit) {
    this.selected = enemy; this.mode = 'idle'; this.clearOverlays();
    const threat = enemyThreatRange(enemy, (x, y, ignore) => this.occupied(x, y, ignore));
    const movement = new Set(threat.movement.map(tile => `${tile.x},${tile.y}`));
    threat.movement.forEach(tile => this.addOverlay(tile.x, tile.y, 0xa751b9, .16));
    threat.attack.filter(tile => !movement.has(`${tile.x},${tile.y}`)).forEach(tile => this.addOverlay(tile.x, tile.y, 0xff4f68, .28));
    this.refreshHud(`${enemy.name}：紫色为移动，红色为攻击范围`);
  }

  private updateDangerOverlays() {
    this.clearDangerOverlays(); if (!this.showAllThreats) return;
    const tiles = new Map<string, { x: number; y: number }>();
    for (const enemy of this.living().filter(unit => unit.team === 'enemy')) {
      enemyThreatRange(enemy, (x, y, ignore) => this.occupied(x, y, ignore)).attack.forEach(tile => tiles.set(`${tile.x},${tile.y}`, tile));
    }
    for (const tile of tiles.values()) {
      this.dangerOverlays.push(this.add.rectangle(this.ox + tile.x * this.tile + 32, this.oy + tile.y * this.tile + 32, 60, 60, 0xe53f59, .16).setStrokeStyle(2, 0xff6478, .32).setDepth(1));
    }
  }

  private toggleAllThreats() {
    if (this.mode === 'enemy' || this.mode === 'locked') return;
    this.showAllThreats = !this.showAllThreats; this.updateDangerOverlays();
    this.refreshHud(this.showAllThreats ? '已显示全体敌军最大威胁范围' : '已隐藏全体敌军威胁范围');
  }

  private async moveSelected(x: number, y: number) {
    const unit = this.selected!; this.mode = 'locked'; this.clearOverlays();
    this.pendingMove = { unitId: unit.id, x: unit.x, y: unit.y };
    const path = this.findPath(unit, x, y);
    if (path.length) await this.walkPath(unit, path);
    if (this.checkOutcome()) return;
    this.mode = 'command';
    this.adjacentEnemies(unit).forEach(enemy => this.addOverlay(enemy.x, enemy.y, 0xff5475, .32));
    this.adjacentInjuredAllies(unit).forEach(ally => this.addOverlay(ally.x, ally.y, 0x76f2ae, .24));
    this.adjacentTalkTargets(unit).forEach(target => this.addOverlay(target.x, target.y, 0xffc75b, .34));
    const usableItem = unit.itemId ? utilityItems[unit.itemId] : undefined;
    const actions = [this.adjacentEnemies(unit).length ? '战斗' : '', this.isHealer(unit) && this.adjacentInjuredAllies(unit).length ? '回复魔法' : '', this.adjacentTalkTargets(unit).length ? '交谈' : '', this.adjacentAllies(unit).length ? '交换' : '', usableItem?.kind === 'healing' && unit.hp < maxHp(unit) ? '物品' : '', '待机'].filter(Boolean).join(' / ');
    this.refreshHud(`行动选择：${actions}`);
  }

  private returnToCommand() {
    if (!this.selected || !['target', 'heal-target'].includes(this.mode)) return;
    this.mode = 'command'; this.clearOverlays();
    this.adjacentEnemies(this.selected).forEach(enemy => this.addOverlay(enemy.x, enemy.y, 0xff5475, .32));
    this.adjacentInjuredAllies(this.selected).forEach(ally => this.addOverlay(ally.x, ally.y, 0x76f2ae, .24));
    this.adjacentTalkTargets(this.selected).forEach(target => this.addOverlay(target.x, target.y, 0xffc75b, .34));
    this.refreshHud('已返回行动菜单；移动位置保持不变');
  }

  private cancelMove() {
    if (!this.selected || this.mode !== 'command' || !this.pendingMove || this.pendingMove.unitId !== this.selected.id) return;
    this.selected.x = this.pendingMove.x; this.selected.y = this.pendingMove.y; this.redrawUnit(this.selected);
    this.pendingMove = undefined; this.select(this.selected);
  }

  private commitAction() { this.pendingMove = undefined; }

  private chooseBattle() {
    if (!this.selected || this.mode !== 'command') return;
    const targets = this.adjacentEnemies(this.selected); if (!targets.length) return;
    this.mode = 'target'; this.clearOverlays(); targets.forEach(enemy => this.addOverlay(enemy.x, enemy.y, 0xff4268, .44));
    this.refreshHud('点击红色敌人，进入战斗舞台');
  }

  private showCombatPreview(player: Unit, enemy: Unit) {
    this.mode = 'confirm'; this.clearOverlays();
    const range = distance(player, enemy);
    const preview = previewCombat(player, enemy, range);
    const side = (unit: Unit, result: typeof preview.initiator, label: string, role: string) => `${paperTitle(unit.name, role)}<div class="paper-combat-identity">${portraitMarkup(unit)}<p>Lv.${unit.level}<br>${classLabel[unit.class]}<br>${result.profile.name}</p></div><div class="paper-hp">生命 <b>${unit.hp} / ${maxHp(unit)}</b><i style="--hp:${unit.hp / maxHp(unit) * 100}%"></i></div><div class="paper-combat-numbers"><span>单次伤害<b>${result.canAttack ? `${result.damage}${result.attacks > 1 ? ` × ${result.attacks}` : ''}` : '—'}</b></span><span>命中<b>${result.canAttack ? `${result.hitChance}%` : '—'}</b></span><span>必杀<b>${result.canAttack ? `${result.criticalChance}%` : '—'}</b></span></div>${paperMessage(result.canAttack ? `${result.attacks > 1 ? '可追击 · ' : ''}最多消耗 ${result.totalHpCost} HP` : unit.hp <= result.profile.hpCost ? 'HP 不足，无法施法' : '超出射程，无法攻击', label === 'enemy' ? '' : 'success')}<details class="paper-forecast-details"><summary>详细预测</summary><p>普通全中 ${result.fullHitDamage} · 理论期望 ${result.expectedDamage.toFixed(1)}。任一方战败或 HP 不足时，后续攻击取消。</p></details>`;
    const order = [player.name + '攻击'];
    if (preview.defender.canAttack) order.push(`${enemy.name}反击`);
    if (preview.initiator.attacks > 1) order.push(`${player.name}追击`);
    else if (preview.defender.attacks > 1) order.push(`${enemy.name}追击`);
    hud.innerHTML = paperBook(side(player, preview.initiator, 'player', 'ATTACKER · 我方'), side(enemy, preview.defender, 'enemy', 'DEFENDER · 敌方'), `<div class="paper-order">行动顺序 · ${preview.initiator.canAttack ? order.join(' → ') : '无法发起攻击'}</div>${paperButton('返回选敌', 'cancel-combat', false, true, true)}${paperButton('开始战斗', 'confirm-combat', true, false, true)}`, '战斗预测');
    window.setTimeout(() => {
      const confirm = hud.querySelector<HTMLButtonElement>('#confirm-combat'); const cancel = hud.querySelector<HTMLButtonElement>('#cancel-combat');
      if (!confirm || !cancel || this.mode !== 'confirm') return;
      confirm.disabled = !preview.initiator.canAttack; cancel.disabled = false;
      confirm.addEventListener('click', () => void this.resolvePlayerCombat(player, enemy), { once: true });
      cancel.addEventListener('click', () => { this.mode = 'target'; this.returnToCommand(); }, { once: true });
    }, 180);
  }

  private async openCombatPreview(player: Unit, enemy: Unit) {
    if (this.chapterId === 'moonlit-pass' && enemy.id === 'c2boss' && !this.bossDialoguePlayed) {
      this.bossDialoguePlayed = true; this.mode = 'locked';
      await this.playBattleDialogue([
        { speakerId: 'c2boss', text: '凡人也敢踏上月蚀祭坛？你们的星光，只配成为献祭的余火。' },
        { speakerId: 'kael', text: '那就亲眼看看，余火如何烧穿你的黑夜。' },
      ]);
    }
    if (player.hp <= 0 || enemy.hp <= 0) return;
    this.showCombatPreview(player, enemy);
  }

  private chooseHeal() {
    if (!this.selected || this.mode !== 'command') return;
    const spell = healingSpell(this.selected);
    if (!spell || this.selected.hp <= spell.hpCost) return;
    const targets = this.adjacentInjuredAllies(this.selected); if (!targets.length) return;
    this.mode = 'heal-target'; this.clearOverlays(); targets.forEach(ally => this.addOverlay(ally.x, ally.y, 0x60f0a1, .48));
    this.refreshHud(`点击绿色友军：${spell.name}消耗施法者 ${spell.hpCost} HP`);
  }

  private showUnitDetails(unit: Unit, returnMode: Mode = this.mode, activeTab = 0) {
    this.mode = 'confirm';
    const terrainInfo = terrainAt(unit.x, unit.y);
    const stats = Object.entries(unit.stats).map(([key, value]) => `<span>${statLabels[key as keyof Unit['stats']]} <b>${value}</b></span>`).join('');
    const growths = Object.entries(unit.growths).map(([key, value]) => `<span>${statLabels[key as keyof Unit['stats']]} <b>${value}%</b></span>`).join('');
    const spellRows = unit.spells.map(id => {
      const attack = attackSpells[id]; const heal = healingSpells[id];
      if (attack) return `<button class="spell-row ${unit.activeSpellId === id ? 'active' : ''}" data-attack-spell="${id}" ${unit.team === 'player' ? '' : 'disabled'}><b>${attack.name}${unit.activeSpellId === id ? ' · 已装备' : ''}</b><span>威力 ${attack.might}　命中 ${attack.hit}　射程 ${attack.minRange}-${attack.maxRange}　HP ${attack.hpCost}</span></button>`;
      if (heal) return `<button class="spell-row ${unit.activeHealingSpellId === id ? 'active' : ''}" data-heal-spell="${id}" ${unit.team === 'player' ? '' : 'disabled'}><b>${heal.name}${unit.activeHealingSpellId === id ? ' · 已装备' : ''}</b><span>回复魔法　射程 ${heal.minRange}-${heal.maxRange}　HP ${heal.hpCost}</span></button>`;
      return '';
    }).join('') || '<div class="empty-spells">尚未习得魔法</div>';
    const promotion = promotionFor(unit); const atShrine = terrainInfo.id === 's'; const eligible = !!promotion && unit.level >= promotion.minLevel && atShrine && unit.team === 'player';
    const promotionText = promotion ? `${classes[unit.class].name} → ${classes[promotion.to].name}（Lv.${promotion.minLevel}，须位于神殿）` : '当前职业已无后续转职';
    hud.innerHTML = paperBook(`${paperTitle(unit.name, 'CHARACTER DOSSIER')}${portraitMarkup(unit)}<p class="paper-center">Lv.${unit.level} ${classLabel[unit.class]} · EXP ${unit.exp}/100</p><p class="paper-muted">${characterNotes[unit.id] ?? unit.title}</p>`, `${paperTabs(['能力', '成长率', '魔法书'], activeTab)}${paperPage(0, `<h3>角色能力</h3><div class="paper-stat-list">${stats}</div><p class="paper-muted">携带：${itemName(unit.itemId)}<br>${itemDescription(unit.itemId)}<br>${terrainInfo.name} · 回避 +${terrainInfo.avoid} / 恢复 ${terrainInfo.recovery} HP</p>`, activeTab)}${paperPage(1, `<h3>成长率</h3><div class="paper-stat-list">${growths}</div>`, activeTab)}${paperPage(2, `<h3>魔法书</h3><p class="paper-muted">攻击与回复魔法分别装备${unit.team === 'player' ? '' : ' · 敌方只读'}</p><div class="paper-spells">${spellRows}</div>`, activeTab)}${paperMessage(promotionText)}`, paperButton('返回战场', 'detail-close', false, true) + paperButton('转职预览', 'promote', true, false, !eligible), '角色详情');
    hud.querySelector('#detail-close')?.addEventListener('click', () => { this.mode = returnMode; this.refreshHud(); });
    hud.querySelectorAll<HTMLButtonElement>('[data-attack-spell]').forEach(button => button.addEventListener('click', () => { unit.activeSpellId = button.dataset.attackSpell; this.autosave(); this.showUnitDetails(unit, returnMode, 2); }));
    hud.querySelectorAll<HTMLButtonElement>('[data-heal-spell]').forEach(button => button.addEventListener('click', () => { unit.activeHealingSpellId = button.dataset.healSpell; this.autosave(); this.showUnitDetails(unit, returnMode, 2); }));
    hud.querySelector('#promote')?.addEventListener('click', () => this.showPromotionPreview(unit, returnMode));
  }

  private showPromotionPreview(unit: Unit, returnMode: Mode) {
    const promotion = promotionFor(unit); if (!promotion || unit.level < promotion.minLevel || terrainAt(unit.x, unit.y).id !== 's') return;
    const gains = promotionGains(unit, promotion);
    const comparison = Object.entries(unit.stats).map(([key, value]) => {
      const gain = gains[key as keyof Unit['stats']] ?? 0;
      return `<tr><th scope="row">${statLabels[key as keyof Unit['stats']]}</th><td>${value}</td><td>${value + gain}</td><td>${gain ? `+${gain}` : '—'}</td></tr>`;
    }).join('');
    hud.innerHTML = paperBook(`${paperTitle(unit.name, 'CLASS CHANGE')}${portraitMarkup(unit)}<p class="paper-center">${classes[unit.class].name} → ${classes[promotion.to].name}</p>`, `${paperTitle('转职预览')}<table class="paper-comparison"><thead><tr><th>能力</th><th>当前</th><th>转职后</th><th>提升</th></tr></thead><tbody>${comparison}</tbody></table>${paperMessage('能力不足职业基础值时自动补足；等级重置为 Lv.1，装备与已学魔法保留。')}`, paperButton('取消转职', 'cancel-promotion', false, true) + paperButton('确认转职', 'confirm-promotion', true), '转职预览');
    hud.querySelector('#cancel-promotion')?.addEventListener('click', () => this.showUnitDetails(unit, returnMode));
    hud.querySelector('#confirm-promotion')?.addEventListener('click', () => {
      void this.performPromotion(unit, promotion, returnMode);
    }, { once: true });
  }

  private async performPromotion(unit: Unit, promotion: NonNullable<ReturnType<typeof promotionFor>>, returnMode: Mode) {
    const from = classes[unit.class].name; applyPromotion(unit, promotion); this.redrawUnit(unit); this.autosave();
    hud.innerHTML = paperSheet(`<div class="paper-growth">${portraitMarkup(unit)}<div>${paperTitle(unit.name, 'CLASS CHANGE')}${paperMessage(`${from} → ${classes[unit.class].name}`, 'success')}<p>Lv.1 · 能力已更新</p></div></div>`);
    await sleep(1200); this.showUnitDetails(unit, returnMode);
  }

  private chooseTalk() {
    if (!this.selected || this.mode !== 'command') return;
    const target = this.adjacentTalkTargets(this.selected)[0]; if (!target) return;
    void this.resolveTalk(this.selected, target);
  }

  private chooseTrade() {
    if (!this.selected || this.mode !== 'command') return;
    const unit = this.selected, allies = this.adjacentAllies(unit); if (!allies.length) return;
    this.mode = 'confirm';
    const target = allies[0];
    const exchange = (ally: Unit) => `<h3>交换后</h3><div class="paper-stat-list"><span>${unit.name}获得 <b>${itemName(ally.itemId)}</b></span><span>${ally.name}获得 <b>${itemName(unit.itemId)}</b></span></div>`;
    hud.innerHTML = paperBook(`${paperTitle('交接装备', 'EQUIPMENT EXCHANGE')}${portraitMarkup(unit)}<p>${unit.name} · ${itemName(unit.itemId)}</p>${paperMessage(`确认交换将结束${unit.name}的本次行动。`, 'warning')}`, `${paperTitle('选择相邻同伴')}<label class="paper-setting">交换对象<select id="trade-target">${allies.map(ally => `<option value="${ally.id}">${ally.name} · ${itemName(ally.itemId)}</option>`).join('')}</select></label><div id="trade-comparison">${target ? portraitMarkup(target) + exchange(target) : paperMessage('附近没有可交换的同伴。')}</div>`, paperButton('取消', 'cancel-trade', false, true) + paperButton('确认交换', 'confirm-trade', true, false, !target), '装备交换');
    hud.querySelector('#trade-target')?.addEventListener('change', event => {
      const ally = allies.find(candidate => candidate.id === (event.target as HTMLSelectElement).value);
      if (ally) hud.querySelector('#trade-comparison')!.innerHTML = portraitMarkup(ally) + exchange(ally);
    });
    hud.querySelector('#cancel-trade')?.addEventListener('click', () => { this.mode = 'command'; this.refreshHud(); });
    hud.querySelector('#confirm-trade')?.addEventListener('click', () => {
      const targetId = hud.querySelector<HTMLSelectElement>('#trade-target')?.value; const target = allies.find(ally => ally.id === targetId); if (!target) return;
      [unit.itemId, target.itemId] = [target.itemId, unit.itemId]; unit.acted = true; this.commitAction(); this.selected = undefined; this.autosave(); this.mode = 'idle'; this.refreshHud(`${unit.name} 与 ${target.name} 交换了装备`);
      if (this.living().filter(candidate => candidate.team === 'player').every(candidate => candidate.acted)) void this.enemyPhase();
    }, { once: true });
  }

  private async useItem() {
    if (!this.selected || this.mode !== 'command') return;
    const unit = this.selected, item = unit.itemId ? utilityItems[unit.itemId] : undefined;
    if (!item || item.kind !== 'healing' || !item.heal || unit.hp >= maxHp(unit)) return;
    this.mode = 'locked'; const healed = Math.min(item.heal, maxHp(unit) - unit.hp); unit.hp += healed; unit.itemId = undefined; unit.acted = true; this.commitAction();
    this.syncUnit(unit); this.floatText(unit, `+${healed} HP`, '#8dffc0'); await sleep(700); this.selected = undefined; this.autosave();
    if (this.checkOutcome()) return; this.mode = 'idle'; this.refreshHud(`${unit.name} 使用了${item.name}`);
    if (this.living().filter(candidate => candidate.team === 'player').every(candidate => candidate.acted)) await this.enemyPhase();
  }

  private async resolveTalk(recruiter: Unit, target: Unit) {
    const rule = recruitmentRuleFor(target); if (!rule) return;
    this.mode = 'locked'; this.clearOverlays();
    const success = canRecruit(recruiter, target, this.turn);
    const dialogue = success ? rule.success : this.turn > rule.lastTurn ? rule.lateRefusal : rule.refusal;
    await this.playBattleDialogue(dialogue);
    recruiter.acted = true; this.commitAction();
    if (success) {
      target.team = 'player'; target.title = rule.recruitedTitle; target.acted = true; if (rule.recruitedGrowths) target.growths = { ...rule.recruitedGrowths }; this.redrawUnit(target); this.showBanner(`${target.name} 加入队伍`);
    }
    this.updateDangerOverlays();
    this.selected = undefined; this.autosave();
    if (this.checkOutcome()) return;
    this.mode = 'idle'; this.refreshHud(success ? `${target.name} 已加入我方` : '交谈未能说服对方');
    if (this.living().filter(unit => unit.team === 'player').every(unit => unit.acted)) await this.enemyPhase();
  }

  private async playBattleDialogue(lines: Array<{ speakerId: string; text: string }>) {
    await playDialogue(lines.map(line => {
      const speaker = this.units.find(unit => unit.id === line.speakerId);
      return { speakerId: line.speakerId, speaker: speaker?.name ?? '？？？', text: line.text, portrait: speaker ? portraitIndex(speaker) : 3 };
    }));
  }

  private async resolveHeal(caster: Unit, target: Unit) {
    this.mode = 'locked'; this.clearOverlays();
    const spell = healingSpell(caster); if (!spell || caster.hp <= spell.hpCost) return;
    const casterSprite = this.unitSprites.get(caster.id)!; const targetContainer = this.containers.get(target.id)!;
    this.castingUnitId = caster.id; this.renderHost?.pose(caster.id, 3);
    casterSprite.setTexture(this.unitTextureKey(caster, 3)).setTint(0xc8fff0);
    for (let i = 0; i < 9; i++) {
      const star = this.add.text(targetContainer.x - 24 + (i * 17) % 48, targetContainer.y + 20 - (i % 3) * 8, i % 2 ? '✦' : '·', { fontFamily: 'monospace', fontSize: i % 2 ? 18 : 28, color: i % 3 ? '#8dffd0' : '#fff3a8', stroke: '#0b4b44', strokeThickness: 2 }).setDepth(20).setOrigin(.5);
      this.tweens.add({ targets: star, y: star.y - 70, x: star.x + (i % 2 ? 8 : -8), alpha: 0, scale: 1.6, duration: 620, delay: i * 45, ease: 'Stepped', onComplete: () => star.destroy() });
    }
    const rune = this.add.circle(targetContainer.x, targetContainer.y + 15, 12, 0x72f6b0, .18).setStrokeStyle(3, 0xbaffd6, .9).setDepth(19);
    this.tweens.add({ targets: rune, scale: 3.2, alpha: 0, angle: 180, duration: 760, ease: 'Stepped', onComplete: () => rune.destroy() });
    await sleep(420);
    casterSprite.setTexture(this.unitTextureKey(caster, 4)); this.renderHost?.pose(caster.id, 4);
    const healed = Math.min(maxHp(target) - target.hp, caster.stats.strength);
    caster.hp -= spell.hpCost; target.hp += healed;
    this.syncUnit(caster); this.syncUnit(target);
    this.floatText(caster, `-${spell.hpCost} HP`, '#b8fff0'); this.floatText(target, `+${healed} HP`, '#85ffad');
    await sleep(350); this.renderHost?.pose(caster.id, 5);
    await sleep(170); this.renderHost?.pose(caster.id, 0); this.castingUnitId = undefined; casterSprite.clearTint().setTexture(this.unitTextureKey(caster, 0));
    await this.awardExperience(caster, healingExperience(healed));
    caster.acted = true; this.commitAction(); this.selected = undefined;
    this.autosave();
    if (this.checkOutcome()) return;
    this.mode = 'idle'; this.refreshHud('回复魔法完成');
    if (this.living().filter(unit => unit.team === 'player').every(unit => unit.acted)) await this.enemyPhase();
  }

  private floatText(unit: Unit, text: string, color: string) {
    this.renderHost?.feedback(unit.id, text, color);
    const container = this.containers.get(unit.id); if (!container) return;
    const label = this.add.text(container.x, container.y - 36, text, { fontFamily: 'monospace', fontSize: 16, fontStyle: 'bold', color, stroke: '#061018', strokeThickness: 4 }).setOrigin(.5).setDepth(30);
    this.tweens.add({ targets: label, y: label.y - 36, alpha: 0, duration: 850, ease: 'Stepped', onComplete: () => label.destroy() });
  }

  private async awardExperience(unit: Unit, amount: number) {
    if (unit.team !== 'player' || unit.hp <= 0 || amount <= 0) return;
    let seed = this.turn * 811 + unit.level * 97 + unit.id.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
    const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000);
    const result = grantExperience(unit, amount, random);
    const gains = Object.entries(result.statGains).map(([key, value]) => `<span>${statLabels[key as keyof Unit['stats']]} +${value}</span>`).join('');
    const learned = result.learnedSpells.map(id => attackSpells[id]?.name ?? healingSpells[id]?.name ?? id);
    hud.innerHTML = paperSheet(`<div class="paper-growth">${portraitMarkup(unit)}<div>${paperTitle(`${unit.name} · Lv.${unit.level}`, result.levels ? 'LEVEL UP' : 'EXPERIENCE')}<p>EXP +${result.gained}　${unit.exp}/100</p><div class="paper-hp"><i style="--hp:${unit.exp}%"></i></div>${result.levels ? `<div class="paper-stat-list">${gains || '<span>能力维持</span>'}</div>` : ''}${learned.length ? paperMessage(`习得魔法：${learned.join('、')}`, 'success') : ''}</div></div>`);
    await sleep(result.levels ? 1550 : 850); hud.innerHTML = '';
  }

  private waitSelected() {
    if (!this.selected || !['command', 'move'].includes(this.mode)) return;
    this.selected.acted = true; this.commitAction(); this.selected = undefined; this.mode = 'idle'; this.clearOverlays();
    this.autosave();
    if (this.checkOutcome()) return;
    this.refreshHud();
    if (this.living().filter(unit => unit.team === 'player').every(unit => unit.acted)) void this.enemyPhase();
  }

  private async resolvePlayerCombat(player: Unit, enemy: Unit) {
    const instance = this.renderInstance;
    this.mode = 'locked'; this.clearOverlays();
    const timeline = await this.playStageCombat(player, enemy, player);
    if (this.leaving || instance !== this.renderInstance) return;
    player.acted = true; this.commitAction(); this.selected = undefined;
    this.syncUnit(player); this.syncUnit(enemy);
    this.collectDrop(enemy);
    this.updateDangerOverlays();
    await this.awardExperience(player, combatExperience(player, enemy, timeline));
    this.autosave();
    const ended = this.checkOutcome(); if (ended) return;
    this.mode = 'idle'; this.refreshHud();
    if (this.living().filter(unit => unit.team === 'player').every(unit => unit.acted)) await this.enemyPhase();
  }

  private async playStageCombat(player: Unit, enemy: Unit, initiator: Unit): Promise<CombatTimeline> {
    const defender = initiator === player ? enemy : player;
    this.skipCurrentStage = false;
    const timeline = resolveCombat(initiator, defender, distance(initiator, defender));
    this.recordCombat(initiator, defender, timeline);
    if (this.compactCombat) {
      this.applyTimelineFinalHp(timeline);
      this.showBanner(`${initiator.name} 与 ${defender.name} 交战`);
      await this.stageDelay(260);
      return timeline;
    }
    return this.playMapCombat(player, enemy, initiator, timeline);
  }

  private async playMapCombat(player: Unit, enemy: Unit, initiator: Unit, timeline: CombatTimeline) {
    const host = this.renderHost!, instance = this.renderInstance;
    const playback = new CombatPlayback(this.renderAdapter!.combat(timeline, this.units, `combat-${++this.combatActionId}`));
    const alive = () => !this.leaving && this.renderInstance === instance;
    const apply = (event: CombatStep) => {
      const unit = this.units.find(unit => unit.id === (event.type === 'cost' ? event.unitId : event.targetId));
      if (unit) unit.hp = event.hpAfter; // Same precomputed, once-only cost/contact commit as the legacy stage.
      this.present(); this.updateStageStats(player, enemy);
    };
    hud.innerHTML = `<section class="map-combat"><div class="map-combat-caption"><small>CLASH OF THE TWIN STARS</small><h2>${initiator.name} 发起攻击</h2><p id="map-combat-event">交战开始</p></div>${this.stagePanel(enemy, player, 'enemy')}${this.stagePanel(player, enemy, 'player')}<div class="stage-controls"><button class="small-btn" id="map-stage-speed">${this.animationSpeed}×</button><button class="small-btn" id="map-stage-skip">跳过演出</button></div></section>`;
    host.setCombatSpeed(this.animationSpeed);
    hud.querySelector('#map-stage-speed')?.addEventListener('click', event => { this.animationSpeed = this.animationSpeed === 1 ? 2 : 1; host.setCombatSpeed(this.animationSpeed); (event.currentTarget as HTMLElement).textContent = `${this.animationSpeed}×`; });
    hud.querySelector('#map-stage-skip')?.addEventListener('click', () => { this.skipCurrentStage = true; host.skipPresentation(); });
    await host.beginCombat([player.id, enemy.id]);
    for (const event of playback.steps) {
      if (!alive()) return timeline;
      if (this.skipCurrentStage || !host.enabled) { playback.skip(apply); break; }
      const caption = hud.querySelector('#map-combat-event');
      if (caption) caption.textContent = event.type === 'cost' ? `${event.abilityName} · 消耗 ${event.amount} HP` : `${event.followUp ? '追击 · ' : ''}${event.abilityName}`;
      if (event.type === 'cost') { playback.commit(event, apply); await host.combatDelay(.18); continue; }
      const reachedContact = await host.windup(event);
      if (!alive()) return timeline;
      if (!reachedContact || this.skipCurrentStage || !host.enabled) { playback.skip(apply); break; }
      playback.commit(event, apply);
      if (caption) caption.textContent = event.hit ? `${event.critical ? '必杀！' : '命中'} −${event.damage} HP` : 'MISS · 攻击落空';
      await host.impact(event);
    }
    if (alive()) { await host.endCombat(); if (alive()) { this.present(); hud.innerHTML = ''; } }
    return timeline;
  }

  private stageDelay(ms: number) {
    return new Promise<void>(resolve => {
      let elapsed = 0, previous = performance.now();
      const tick = (now: number) => {
        elapsed += (now - previous) * this.animationSpeed; previous = now;
        if (this.skipCurrentStage || elapsed >= ms || !this.scene.isActive()) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  private applyTimelineFinalHp(timeline: CombatTimeline) {
    for (const [id, hp] of Object.entries(timeline.finalHp)) {
      const unit = this.units.find(candidate => candidate.id === id); if (unit) unit.hp = hp;
    }
  }

  private recordCombat(initiator: Unit, defender: Unit, timeline: CombatTimeline) {
    const name = (id: string) => this.units.find(unit => unit.id === id)?.name ?? id;
    const lines = [`◆ T${this.turn} ${initiator.name} vs ${defender.name}`];
    for (const event of timeline.events) {
      if (event.type === 'cost') {
        lines.push(`　${name(event.unitId)} ${event.profile.name}消耗 ${event.amount}HP`);
        continue;
      }
      const follow = event.followUp ? '追击 ' : '';
      const verdict = event.hit ? `${event.critical ? '必杀' : '命中'} -${event.damage}` : 'MISS';
      const critical = event.hit && event.criticalChance > 0 && event.criticalRoll !== undefined ? `，必杀 ${event.criticalRoll}/${event.criticalChance}` : '';
      lines.push(`　${name(event.attackerId)} ${follow}命中 ${event.hitRoll}/${event.hitChance}${critical} → ${verdict}`);
    }
    this.combatLog = [...lines, ...this.combatLog].slice(0, 16);
  }

  private showStage(player: Unit, enemy: Unit, initiator: Unit) {
    hud.innerHTML = `<section class="battle-stage illustrated-stage hd-stage ${this.chapterId === 'moonlit-pass' ? 'moonlit-stage' : ''}" style="--battle-speed:${this.animationSpeed}">
      <div class="stage-curtain top"></div><div class="stage-curtain bottom"></div><div class="stage-lights"></div>
      <div class="stage-side enemy-side"><span class="class-emblem">${this.classEmblem(enemy.class)} ${classLabel[enemy.class]}</span><div class="stage-fighter enemy class-${enemy.class}" data-id="${enemy.id}">${fighterArt(enemy)}</div></div>
      <div class="stage-side player-side"><span class="class-emblem">${this.classEmblem(player.class)} ${classLabel[player.class]}</span><div class="stage-fighter player class-${player.class}" data-id="${player.id}">${fighterArt(player)}</div></div>
      ${this.stagePanel(enemy, player, 'enemy')}${this.stagePanel(player, enemy, 'player')}
      <div class="stage-caption"><small>CLASH OF THE TWIN STARS</small>ROUND ${this.turn} · ${chapters[this.chapterId].title}<span>${initiator.name} 发起攻击</span></div><div class="weapon-fx"></div><div class="impact-ring"></div><div class="stage-fx" aria-live="polite"></div><div class="stage-roll" aria-live="polite"></div>
      <div class="stage-controls"><button class="small-btn" id="stage-speed">${this.animationSpeed}×</button><button class="small-btn" id="stage-skip">跳过演出</button></div>
    </section>`;
    hud.querySelector('#stage-speed')?.addEventListener('click', () => {
      this.animationSpeed = this.animationSpeed === 1 ? 2 : 1;
      const stage = hud.querySelector<HTMLElement>('.battle-stage');
      stage?.style.setProperty('--battle-speed', String(this.animationSpeed));
      stage?.getAnimations({ subtree: true }).filter(animation => animation.id === 'stage-travel').forEach(animation => animation.updatePlaybackRate(this.animationSpeed));
      const button = hud.querySelector<HTMLButtonElement>('#stage-speed'); if (button) button.textContent = `${this.animationSpeed}×`;
    });
    hud.querySelector('#stage-skip')?.addEventListener('click', () => { this.skipCurrentStage = true; });
  }

  private stagePanel(unit: Unit, opponent: Unit, side: 'enemy' | 'player') {
    const result = forecast(unit, opponent);
    const able = canAttackAt(unit, distance(unit, opponent));
    return `<div class="stage-panel ${side}" data-panel="${unit.id}"><div class="stage-name"><b>${unit.name}</b><span>${classLabel[unit.class]}</span></div>
      <div class="stage-row"><span>HP</span><div class="stage-hp"><i style="width:${unit.hp / maxHp(unit) * 100}%"></i></div><strong class="hp-value">${unit.hp}/${maxHp(unit)}</strong></div>
      <div class="stage-metrics"><span>命中率 <b>${able ? result.hitChance + '%' : '—'}</b></span><span>${able ? '伤害' : '无法攻击'} <b>${able ? result.damage : '—'}</b></span></div></div>`;
  }

  private paintStageFighter(canvas: HTMLCanvasElement, unit: Unit, faceLeft: boolean) {
    const ctx = canvas.getContext('2d')!; ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, 64, 80);
    ctx.save(); if (faceLeft) { ctx.translate(64, 0); ctx.scale(-1, 1); }
    this.paintStageUnit(ctx, unit); ctx.restore();
  }

  private paintStageUnit(ctx: CanvasRenderingContext2D, unit: Unit) {
    const enemy = unit.team === 'enemy';
    const outline = enemy ? '#1b1324' : '#092c37', dark = enemy ? '#3a2044' : '#0a5360';
    const mid = enemy ? '#743454' : '#138e96', light = enemy ? '#df5d86' : '#5ce0d5';
    const metal = enemy ? '#a7a1b5' : '#e5e7ce', metalDark = enemy ? '#5d586d' : '#879c91';
    const skin = '#d9a47a', skinLight = '#f0c59a';
    const b = (color: string, x: number, y: number, w: number, h: number) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };
    b('rgba(0,0,0,.4)', 8, 73, 47, 5); b('rgba(0,0,0,.25)', 14, 69, 38, 8);

    // Weapon silhouettes are class-specific and stay readable at stage scale.
    if (unit.class === 'sword') {
      b('#6e4c2b', 51, 35, 5, 35); b('#d9bc72', 48, 34, 11, 4);
      for (let i = 0; i < 7; i++) b(i % 2 ? '#fff9d9' : '#cbd9cf', 53 + i, 8 + i * 4, 4, 6);
      b('#fffbe1', 53, 7, 3, 30);
    } else if (unit.class === 'lancer') {
      b('#7b522c', 54, 10, 4, 61); b('#e9d68d', 55, 10, 2, 60);
      b('#eff2d8', 50, 3, 12, 9); b('#ffffff', 54, 1, 4, 10); b('#9bafaa', 52, 10, 8, 5);
    } else if (unit.class === 'mage') {
      b('#735033', 52, 15, 5, 55); b('#c9a567', 53, 16, 2, 52);
      b('#6cffff', 49, 5, 12, 12); b('#d8ffff', 52, 7, 6, 6); b(light, 51, 3, 8, 4);
      b('#87f4ef', 46, 10, 4, 3); b('#87f4ef', 60, 13, 3, 4);
    } else if (unit.class === 'raider') {
      b('#d9d6c2', 49, 28, 13, 4); b('#fffbdc', 55, 25, 8, 4); b('#795432', 44, 30, 10, 4);
      b('#d9d6c2', 4, 37, 14, 4); b('#fffbdc', 2, 34, 9, 4); b('#795432', 14, 39, 9, 4);
    }

    // Boots and animated-ready separated legs.
    b(outline, 16, 58, 13, 15); b(outline, 35, 58, 13, 15);
    b(dark, 18, 58, 9, 12); b(dark, 37, 58, 9, 12);
    b(metalDark, 15, 69, 16, 5); b(metalDark, 34, 69, 17, 5); b(metal, 18, 69, 10, 2); b(metal, 37, 69, 11, 2);

    // Cloak silhouette, torso and readable armor clusters.
    b(outline, 12, 31, 41, 32); b(dark, 14, 33, 37, 29);
    b(mid, 10, 36, 10, 23); b(mid, 46, 35, 9, 24);
    b(light, 12, 38, 5, 16); b(light, 48, 37, 3, 15);
    if (unit.class === 'knight') {
      b(metalDark, 12, 29, 42, 34); b(metal, 16, 31, 33, 27); b(dark, 20, 35, 25, 24);
      b(mid, 22, 38, 21, 15); b(light, 23, 39, 5, 11);
      b(outline, 4, 32, 18, 31); b(metalDark, 6, 34, 14, 27); b(mid, 8, 37, 10, 21); b(light, 10, 40, 3, 15);
      b('#d1b66f', 10, 57, 5, 3);
    } else if (unit.class === 'mage') {
      b('#e8dfc7', 15, 31, 35, 26); b('#b7b0a0', 18, 34, 29, 20); b(mid, 13, 47, 39, 16);
      b(light, 16, 49, 5, 12); b('#d8b85e', 29, 34, 6, 6); b('#fff2a1', 31, 35, 2, 4);
    } else {
      b(mid, 17, 33, 32, 26); b(light, 19, 35, 7, 18); b('#d8bd72', 28, 34, 5, 24);
      b(outline, 28, 38, 5, 5); b('#f1d88b', 29, 39, 3, 3);
    }

    // Neck, face, hair or helmet.
    b(outline, 20, 12, 26, 22); b(skin, 23, 15, 20, 17); b(skinLight, 25, 16, 8, 8);
    if (unit.class === 'knight') {
      b(metalDark, 18, 8, 29, 21); b(metal, 21, 10, 23, 15); b(outline, 22, 18, 22, 6);
      b(light, 25, 19, 4, 2); b(light, 37, 19, 4, 2); b(metalDark, 31, 6, 5, 7);
      b('#d7b55e', 31, 10, 4, 5);
    } else {
      b(outline, 18, 8, 30, 12); b(dark, 20, 9, 26, 9); b(dark, 18, 14, 7, 12); b(dark, 42, 14, 6, 10);
      b(light, 22, 10, 8, 3); b('#20202a', 27, 21, 3, 3); b('#20202a', 37, 21, 3, 3);
      b('#8d4f42', 32, 27, 6, 2);
      if (unit.class === 'mage') { b(mid, 15, 5, 34, 8); b(light, 20, 4, 19, 4); b('#d8b85e', 41, 5, 5, 5); }
      if (unit.class === 'raider') { b(outline, 16, 6, 34, 8); b('#ef668d', 26, 18, 4, 2); b('#ef668d', 38, 18, 4, 2); }
    }

    // Pixel highlights and outfit rivets.
    b('#fff2b1', 15, 33, 3, 3); b('#fff2b1', 48, 32, 3, 3);
    b(metal, 22, 57, 4, 3); b(metal, 39, 57, 4, 3);
  }

  private async stageStrike(attacker: Unit, defender: Unit, event: Extract<CombatEvent, { type: 'strike' }>, player: Unit, enemy: Unit) {
    const attackerEl = hud.querySelector<HTMLElement>(`.stage-fighter[data-id="${attacker.id}"]`)!;
    const defenderEl = hud.querySelector<HTMLElement>(`.stage-fighter[data-id="${defender.id}"]`)!;
    const stage = hud.querySelector<HTMLElement>('.battle-stage')!; const visualClass = this.assetClass(attacker.class);
    const magical = event.profile.damageType === 'magical';
    const weaponClass = `weapon-${magical ? 'mage' : visualClass}`;
    const a = attackerEl.getBoundingClientRect(), d = defenderEl.getBoundingClientRect();
    const stageBounds = stage.getBoundingClientRect();
    for (const effect of stage.querySelectorAll<HTMLElement>('.weapon-fx,.impact-ring')) {
      effect.style.left = `${d.x + d.width * .5 - stageBounds.x}px`;
      effect.style.top = `${d.y + d.height * .65 - stageBounds.y}px`;
    }
    const direction = attacker.team === 'player' ? -1 : 1;
    const approach = magical ? 0 : direction * Math.max(0, Math.abs(d.x - a.x) - a.width * .6);
    const travel = attackerEl.animate([
      { transform: 'translateX(0)', offset: 0 },
      { transform: `translateX(${-direction * 18}px)`, offset: .18 },
      { transform: `translateX(${approach}px)`, offset: .48 },
      { transform: `translateX(${approach}px)`, offset: .7 },
      { transform: 'translateX(0)', offset: 1 },
    ], { duration: 1100, easing: 'cubic-bezier(.22,.7,.24,1)', fill: 'both' });
    travel.id = 'stage-travel'; travel.playbackRate = this.animationSpeed;
    attackerEl.classList.add(magical ? 'rig-cast' : 'rig-action');
    showFighterPose(attackerEl, 3);
    const rollEl = hud.querySelector<HTMLElement>('.stage-roll'); if (rollEl) { rollEl.className = 'stage-roll'; rollEl.textContent = ''; }
    this.stageMessage(event.profile.damageType === 'magical' ? `✦ ${event.profile.name}` : visualClass === 'lancer' ? '➶ 突刺' : visualClass === 'raider' ? '⚔ 双刃' : visualClass === 'knight' ? '◆ 盾击' : '⚔ 斩击', attacker.team);
    await this.stageDelay(300);
    if (!event.hit) defenderEl.classList.add('rig-dodge');
    await this.stageDelay(230);
    showFighterPose(attackerEl, 4);
    stage.classList.add(weaponClass);
    if (event.hit) {
      this.stageRoll(event);
      defender.hp = event.hpAfter;
      defenderEl.classList.add('rig-hurt'); stage.classList.add('impact');
      this.stageMessage(event.critical ? `必杀 -${event.damage}` : `-${event.damage}`, event.critical ? 'critical' : 'damage');
      this.cameras.main.shake(event.critical ? 360 : 240, event.critical ? .016 : .01); this.updateStageStats(player, enemy);
    } else {
      this.stageRoll(event);
      this.stageMessage('MISS', 'miss');
    }
    await this.stageDelay(240);
    showFighterPose(attackerEl, 5);
    await this.stageDelay(330);
    travel.cancel();
    defenderEl.classList.remove('rig-hurt', 'rig-dodge');
    if (defender.hp <= 0) defenderEl.classList.add('rig-defeated');
    attackerEl.classList.remove('rig-action', 'rig-cast');
    showFighterPose(attackerEl, 0);
    stage.classList.remove(weaponClass, 'impact');
    await this.stageDelay(240);
  }

  private stageMessage(text: string, kind: string) {
    const fx = hud.querySelector<HTMLElement>('.stage-fx'); if (!fx) return;
    fx.className = `stage-fx ${kind}`; fx.textContent = text;
    fx.getBoundingClientRect(); fx.classList.add('show');
  }

  private stageRoll(event: Extract<CombatEvent, { type: 'strike' }>) {
    const roll = hud.querySelector<HTMLElement>('.stage-roll'); if (!roll) return;
    const hitText = event.hit ? `${event.hitRoll} ≤ ${event.hitChance}` : `${event.hitRoll} > ${event.hitChance}`;
    const criticalText = event.hit && event.criticalChance > 0 && event.criticalRoll !== undefined
      ? `　必杀 ${event.criticalRoll} ${event.critical ? '≤' : '>'} ${event.criticalChance}` : '';
    roll.className = `stage-roll ${event.hit ? 'hit' : 'miss'} show`;
    roll.textContent = `命中判定 ${hitText}${criticalText}`;
  }

  private updateStageStats(player: Unit, enemy: Unit) {
    for (const unit of [player, enemy]) {
      const panel = hud.querySelector<HTMLElement>(`[data-panel="${unit.id}"]`); if (!panel) continue;
      const bar = panel.querySelector<HTMLElement>('.stage-hp i')!; const value = panel.querySelector<HTMLElement>('.hp-value')!;
      bar.style.width = `${Math.max(0, unit.hp / maxHp(unit) * 100)}%`; value.textContent = `${unit.hp}/${maxHp(unit)}`;
    }
  }

  private syncUnit(unit: Unit) {
    this.present();
    const container = this.containers.get(unit.id); if (!container) return;
    if (unit.hp <= 0) {
      this.tweens.add({ targets: container, alpha: 0, y: '+=18', scale: .4, duration: 460, ease: 'Stepped', onComplete: () => container.destroy() }); return;
    }
    const bar = container.getByName('hp') as Phaser.GameObjects.Rectangle;
    bar.setDisplaySize(40 * unit.hp / maxHp(unit), 3);
    this.tweens.add({ targets: container, x: '+=5', duration: 50, yoyo: true, repeat: 3 });
  }

  private collectDrop(unit: Unit) {
    if (unit.hp > 0 || !unit.dropItemId) return;
    this.collectedLoot.push(unit.dropItemId); this.floatText(unit, `获得 ${itemName(unit.dropItemId)}`, '#ffe59a'); unit.dropItemId = undefined;
  }

  private async applyPhaseRecovery(team: Team) {
    let recovered = false;
    for (const unit of this.living().filter(candidate => candidate.team === team)) {
      const amount = Math.min(terrainAt(unit.x, unit.y).recovery, maxHp(unit) - unit.hp);
      if (amount <= 0) continue;
      unit.hp += amount; recovered = true; this.syncUnit(unit); this.floatText(unit, `地形 +${amount} HP`, '#fff0a4');
    }
    if (recovered) await sleep(650);
  }

  private async enemyPhase() {
    const instance = this.renderInstance;
    this.mode = 'enemy'; this.selected = undefined; this.clearOverlays(); this.clearDangerOverlays(); this.autosave('enemy'); this.refreshHud(); this.showBanner('敌方阶段'); await sleep(1050);
    if (this.leaving || instance !== this.renderInstance) return;
    await this.applyPhaseRecovery('enemy');
    for (const enemy of this.living().filter(unit => unit.team === 'enemy')) {
      const players = this.living().filter(unit => unit.team === 'player'); if (!players.length) break;
      const enemies = this.living().filter(unit => unit.team === 'enemy');
      const decision = chooseEnemyAction(enemy, players, (x, y, ignore) => this.occupied(x, y, ignore), enemies);
      if (decision.path.length) await this.walkPath(enemy, decision.path);
      const target = decision.targetId ? this.living().find(unit => unit.id === decision.targetId) : undefined;
      if (target && canAttackAt(enemy, distance(enemy, target))) {
        const timeline = await this.playStageCombat(target, enemy, enemy);
        if (this.leaving || instance !== this.renderInstance) return;
        this.syncUnit(target); this.syncUnit(enemy); this.collectDrop(enemy);
        await this.awardExperience(target, combatExperience(target, enemy, timeline));
        if (this.checkOutcome()) return;
      }
      await sleep(180);
    }
    this.turn++; this.living().filter(unit => unit.team === 'player').forEach(unit => unit.acted = false);
    if (this.checkOutcome()) return;
    this.mode = 'locked'; this.showBanner('我方阶段'); this.refreshHud();
    await this.applyPhaseRecovery('player');
    if (this.leaving || instance !== this.renderInstance) return;
    this.autosave('player'); this.mode = 'idle'; this.updateDangerOverlays(); this.refreshHud();
  }

  private async endTurn() {
    if (this.staging || !['idle', 'move', 'command'].includes(this.mode)) return;
    this.commitAction();
    this.living().filter(unit => unit.team === 'player').forEach(unit => unit.acted = true);
    if (this.checkOutcome()) return;
    await this.enemyPhase();
  }

  private showBanner(text: string) {
    hud.querySelector('.phase-banner')?.remove(); const banner = document.createElement('div'); banner.className = 'phase-banner'; banner.textContent = text; hud.appendChild(banner); window.setTimeout(() => banner.remove(), 1300);
  }

  private checkOutcome() {
    const result = evaluateMission(currentMission, this.units, this.turn);
    if (result.status === 'playing') return false;
    const players = result.status === 'victory';
    this.mode = 'ended'; this.clearOverlays(); this.clearDangerOverlays(); this.present();
    if (players) {
      const rating = this.chapterRating();
      const summary = completeChapter(this.units, this.collectedLoot, rating);
      const epilogue = chapters[this.chapterId].repeatable ? '林海与潮声重新安静下来。战斗经验已保留，全队生命已恢复；返回地图后可再次挑战。' : this.chapterId === 'moonlit-pass' ? (this.units.some(unit => unit.id === 'c2recruit' && unit.team === 'player' && unit.hp > 0) ? '祭坛熄灭后，艾琳为众人指出了通往灰烬边境的旧路。月色第一次没有落在囚笼上。' : '祭坛熄灭了，但峡谷中的祈祷仍无人回应。北方的灰烬边境，传来了新的烽火。') : '星落桥重新点起灯火，通往北境的道路再次开启。';
      hud.innerHTML = paperBook(`${paperTitle(summary.title + (chapters[this.chapterId].repeatable ? ' · 讨伐完成' : '解放'), 'BATTLE REPORT')}<div class="paper-rating">${rating}</div><p>${epilogue}</p>${paperMessage(result.reason, 'success')}`, `${paperTitle('远征收获')}<h3>队伍成长</h3><div class="paper-stat-list">${summary.roster.map(unit => `<span>${unit.name}<b>Lv.${unit.level} ${unit.class}</b></span>`).join('')}</div><h3>新加入</h3><p>${summary.recruited.join('、') || '无'}</p><h3>战利品</h3><p>${summary.items.join('、') || '无'}</p><p class="paper-muted">${chapters[this.chapterId].repeatable ? '重复讨伐独立累计；经验已保留，不重复领取主线首次奖励。' : '战果已入账，返回地图不会重复发放。'}</p>`, paperButton('返回世界地图', 'again', true, true), '战斗胜利');
      hud.querySelector('#again')?.addEventListener('click', () => this.scene.start('world'), { once: true });
    } else {
      abandonBattle();
      hud.innerHTML = paperSheet(`${paperTitle('余烬熄灭', 'THE FLAME FADES')}<p>${result.reason}</p><p>远征仍有再次出发的机会。</p>${paperMessage('回到战前整备，调整部署与装备后重新挑战。')}`, paperButton('返回战前整备', 'again', true, true), '战斗失败');
      hud.querySelector('#again')?.addEventListener('click', () => this.scene.start('preparation', { chapterId: this.chapterId }), { once: true });
    }
    return true;
  }

  private chapterRating(): 'S' | 'A' | 'B' | 'C' {
    const recruited = this.units.some(unit => unit.id === 'c2recruit' && unit.team === 'player' && unit.hp > 0);
    const playerUnits = this.units.filter(unit => unit.team === 'player');
    const noLosses = playerUnits.every(unit => unit.hp > 0);
    let score = this.turn <= 8 ? 2 : this.turn <= 12 ? 1 : 0;
    if (recruited) score++; if (noLosses) score++;
    return score >= 4 ? 'S' : score === 3 ? 'A' : score === 2 ? 'B' : 'C';
  }

  private showBattleMenu() {
    if (['locked','enemy','confirm','ended'].includes(this.mode)) return;
    let choice = '';
    const dialog = showChronicleDialog('战场菜单', `<img class="battle-book-compass" src="${compassIcon}" alt=""><div class="battle-menu-grid">${[['map','地图与演出'],['party','查看编队'],['items','队伍道具'],['quests','当前任务'],['save','存档信息'],['system','系统设置']].map(([id,label])=>`<button class="small-btn" data-battle-menu="${id}"><img src="${battleMenuIcons[id]}" alt="">${label}</button>`).join('')}</div>`);
    dialog.classList.add('battle-menu-dialog');
    dialog.setAttribute('aria-label', '战场菜单');
    dialog.querySelector('[data-dialog-close]')!.textContent = '返回战场';
    dialog.querySelectorAll<HTMLButtonElement>('[data-battle-menu]').forEach(button => button.addEventListener('click', () => { choice = button.dataset.battleMenu!; dialog.close(); }));
    dialog.addEventListener('close', () => { if (choice) this.openBattleMenuItem(choice); }, { once: true });
  }

  private openBattleMenuItem(item: string) {
    if (['locked','enemy','confirm','ended'].includes(this.mode)) return;
    const party = this.units.filter(unit => unit.team === 'player');
    if (item === 'map') { this.toolsOpen = !this.toolsOpen; this.refreshHud(); }
    else if (item === 'system') this.showRenderSettings();
    else if (item === 'party') {
      if (this.staging) { this.scene.start('preparation', { chapterId:this.chapterId, fromStaging:true }); return; }
      this.scene.pause(); this.scene.launch('preparation', { chapterId:this.chapterId, readOnly:true, roster:party, onReturn:()=>{ this.scene.resume(); this.refreshHud(); } });
    } else if (item === 'items') {
      const dialog = showChronicleDialog('队伍道具', party.map(member=>`<p><b>${member.name}</b>　${itemName(member.itemId)}</p>`).join('') + (this.staging ? '<button class="small-btn" id="staging-equipment">分配装备</button>' : '<p>选择单位后，可在行动栏使用回复道具或与相邻同伴交换。</p>'));
      let edit = false;
      dialog.querySelector('#staging-equipment')?.addEventListener('click', () => { edit = true; dialog.close(); });
      dialog.addEventListener('close', () => { if (edit) this.openBattleMenuItem('party'); }, { once:true });
    } else if (item === 'quests') showChronicleDialog('当前目标', `<p>${currentMission.title}</p><p>胜利：${currentMission.victory.map(condition=>condition.label).join(' / ')}</p><p>失败：凯尔战败或超过 ${currentMission.turnLimit} 回合。</p>`);
    else if (item === 'save') showChronicleDialog('远征记录', `<p>每次完成行动后自动保存。</p><p>${chapters[this.chapterId].title} · ${this.staging ? '战前整备' : `第 ${this.turn} 回合`}</p><p>手动存档栏位 · 待开放</p>`);
  }

  private refreshHud(message = '') {
    this.present();
    if (this.mode === 'ended' || hud.querySelector('.battle-stage, dialog[open]')) return;
    const unit = this.selected; const adjacent = unit ? this.adjacentEnemies(unit) : [];
    const healTargets = unit ? this.adjacentInjuredAllies(unit) : [];
    const talkTargets = unit ? this.adjacentTalkTargets(unit) : [];
    const tradeTargets = unit ? this.adjacentAllies(unit) : [];
    const profile = unit ? attackProfile(unit) : undefined;
    const healProfile = unit ? healingSpell(unit) : undefined;
    const heldUtility = unit?.itemId ? utilityItems[unit.itemId] : undefined;
    const recruitRule = unit ? recruitmentRuleFor(unit) : undefined;
    const recruiters = recruitRule?.recruiterIds.map(id => this.units.find(candidate => candidate.id === id)?.name ?? id).join('、');
    const recruitHint = recruitRule && unit?.team === 'enemy' ? `<div class="recruit-hint">交谈招募：${recruiters} · 最迟第 ${recruitRule.lastTurn} 回合</div>` : '';
    const card = unit ? `<div class="unit-card pixel-card"><div class="mini-portrait p${portraitIndex(unit)}"></div><div><span class="unit-name">${unit.name}</span><span class="battle-unit-class">Lv.${unit.level} · ${classLabel[unit.class]}</span><span class="unit-title">${classLabel[unit.class]} · ${unit.title}${unit.team === 'enemy' ? ` · ${this.aiLabel(unit)}` : ''}</span></div>
      <div class="unit-level">Lv.${unit.level}　EXP ${unit.exp}/100</div><div class="hp-line"><i style="width:${unit.hp / maxHp(unit) * 100}%"></i></div><div class="stats"><span>HP ${unit.hp}/${maxHp(unit)}</span><span>攻 ${unit.stats.strength + (profile?.might ?? 0)}</span><span>防 ${unit.stats.defense}</span><span>速 ${unit.stats.speed - (profile?.weight ?? 0)}</span></div>${recruitHint}</div>` : '';
    const cutout = unit ? cutoutPortraitUrl(unit) : undefined;
    const canCommand = !!unit && this.mode === 'command';
    const objectives = currentMission.victory.map(condition => condition.label).join(' / ');
    const log = this.showCombatLog ? `<div class="combat-log"><b>战斗记录</b>${this.combatLog.map(line => `<span>${line}</span>`).join('') || '<span>尚无交战</span>'}</div>` : '';
    const party = this.units.filter(candidate => candidate.team === 'player');
    const chapter = chapters[this.chapterId];
    const shell = this.staging ? `<div class="replica-battle replica-stage ${this.staging ? 'battle-staging' : 'battle-live'} ${this.toolsOpen ? 'tools-open' : ''} ${unit ? 'unit-selected' : ''}"><img class="hud-plate" src="/assets/chronicle/replica/hud-overlay.png" alt="">
      <div class="location-title"><small>双星余烬</small><h2>${chapter.title}</h2><span>${chapter.repeatable ? 'REPEATABLE ENCOUNTER' : this.chapterId === 'starfall-bridge' ? 'STARFALL BRIDGE' : 'MOONLIT PASS'}</span><p>北境诸国 · 星陨之地</p></div>
      <div class="chapter-status"><b>${chapter.repeatable ? '支线讨伐' : `第 ${chapter.order} 章`}</b><small>${chapter.subtitle}</small></div><div class="currency-status"><b>— G</b><small>货币 · 待开放</small></div><span class="weather-caption">${this.renderHost?.settings.timeOfDay === 'night' || (!chapter.repeatable && this.renderHost?.settings.timeOfDay !== 'day') ? '月夜' : '晴朗'}</span>
      <button id="minimap-focus" class="replica-minimap" aria-label="聚焦全图"><canvas width="200" height="170" aria-label="实时战术小地图"></canvas></button><button id="camera-orbit" class="small-btn camera-orbit" aria-pressed="${!!this.renderHost?.rotateView}">${this.renderHost?.rotateView ? '旋转中 · 切回平移' : '旋转视角'}</button><span class="minimap-caption">${chapter.title}</span>
      <h3 class="quest-heading">当前目标<small>${chapter.repeatable ? 'ENCOUNTER' : 'MAIN QUEST'}</small></h3><div class="quest-placeholders"><p>${objectives}<small>${chapter.repeatable ? '低难度 · 可重复挑战' : chapter.subtitle}</small></p><p>${chapter.repeatable ? '积累战斗经验' : '保护凯尔'}<small>${chapter.repeatable ? '结束后全队恢复生命' : `限时 ${currentMission.turnLimit} 回合`}</small></p></div>
      <nav class="replica-dock" aria-label="战场菜单">${['地图','编队','道具','任务','存档','系统'].map((label,i)=>`<button id="dock-${['map','party','items','quests','save','system'][i]}"><span>${label}</span></button>`).join('')}</nav>
      <div class="party-cards">${Array.from({length:Math.max(4,party.length)},(_,i)=>{const member=party[i];return member ? `<button data-party-unit="${member.id}" class="party-card ${member.id === unit?.id ? 'selected' : ''}" aria-label="选择 ${member.name}"><img src="${portraitUrl(member)}" alt=""><b>${member.name}<span>Lv.${member.level}</span></b><span>HP <strong>${member.hp} / ${maxHp(member)}</strong></span><progress value="${member.hp}" max="${maxHp(member)}"></progress><small>${member.acted ? '已行动' : '可行动'} · ${classes[member.class].name}</small></button>` : '<div class="party-card empty"><span>等待同伴</span><small>尚未加入</small></div>';}).join('')}</div><span class="replica-motto">TWO STARS　·　ONE TOMORROW</span>
      ${this.staging ? '<button id="deploy-battle" class="deploy-battle">出征<small>进入正式战斗</small></button>' : `<button id="battle-menu" class="battle-menu" ${['locked','enemy','confirm','ended'].includes(this.mode) ? 'disabled' : ''}>菜单</button>`}` : `<div class="replica-battle battle-live ${this.toolsOpen ? 'tools-open' : ''} ${unit ? 'unit-selected' : ''}" data-battle-state="${unit ? 'selected' : 'overview'}">
      <div class="battle-objective"><img src="/assets/chronicle/battle-v2/objective.png" alt=""><div class="location-title"><h2>${chapter.title}</h2><p>${objectives}</p></div></div>
      <img class="battle-navigator" src="/assets/chronicle/battle-v2/navigator.png" alt="">
      <button id="minimap-focus" class="replica-minimap" aria-label="聚焦全图" title="聚焦全图"><canvas width="240" height="240" aria-label="实时战术小地图"></canvas></button>
      <button id="camera-orbit" class="small-btn camera-orbit" aria-pressed="${!!this.renderHost?.rotateView}" ${this.renderHost?.enabled ? '' : 'disabled'}>${this.renderHost?.rotateView ? '切回平移' : '旋转视角'}</button>
      <img class="battle-menu-art" src="/assets/chronicle/battle-v2/corner-menu.png" alt=""><button id="battle-menu" class="battle-menu" ${['locked','enemy','confirm','ended'].includes(this.mode) ? 'disabled' : ''}>菜单</button>`;
    hud.innerHTML = `${shell}<div class="battle-top pixel-ui"><span class="phase">${this.staging ? '战前整备' : this.mode === 'enemy' ? '敌方阶段' : '我方阶段'}</span><span class="turn">第 ${this.turn} 回合</span></div><div class="mission-box"><b>${currentMission.title}</b><span>胜利：${objectives}</span><span>失败：凯尔战败或超过 ${currentMission.turnLimit} 回合</span></div>
      <div class="battle-tip" role="status" data-has-message="${!!message}">${message || (this.staging ? '确认编队与装备后，点击「出征」' : this.mode === 'move' ? '选择移动位置' : this.mode === 'command' ? '选择角色行动' : ['target','heal-target'].includes(this.mode) ? '选择目标' : '选择我方角色')}</div>
      <div class="battle-tools-panel"><button id="close-battle-tools" class="small-btn">返回战场</button><div class="render-tools">${this.renderHost?.enabled ? '<button class="small-btn" id="render-focus">聚焦单位</button><button class="small-btn" id="render-reset">全图</button><button class="small-btn" id="render-settings">画面设置</button>' : ''}</div>${this.renderNotice ? `<div class="render-notice" role="status">${this.renderNotice}</div>` : ''}
      <div class="tactical-tools"><button class="small-btn ${this.showAllThreats ? 'active' : ''}" id="danger" ${this.mode === 'enemy' || this.mode === 'locked' ? 'disabled' : ''}>全体危险</button><button class="small-btn" id="speed">演出 ${this.animationSpeed}×</button><button class="small-btn ${this.compactCombat ? 'active' : ''}" id="compact">${this.compactCombat ? '简略演出' : '完整演出'}</button><button class="small-btn ${this.showCombatLog ? 'active' : ''}" id="combat-log">战斗记录</button></div>${log}</div><div class="battle-action-group">${unit ? `<img class="battle-portrait ${cutout ? 'cutout' : 'framed'}" src="${cutout ?? portraitUrl(unit)}" alt="${unit.name}立绘">` : ''}${card}
      <div class="commands pixel-commands"><button class="command battle-command" id="fight" ${canCommand && adjacent.length ? '' : 'disabled'}>战斗</button><button class="command heal-command" id="heal" ${canCommand && unit && healProfile && unit.hp > healProfile.hpCost && healTargets.length ? '' : 'disabled'}>回复魔法</button><button class="command talk-command" id="talk" ${canCommand && talkTargets.length ? '' : 'disabled'}>交谈</button><button class="command" id="trade" ${canCommand && tradeTargets.length ? '' : 'disabled'}>交换</button><button class="command" id="item" ${canCommand && unit && heldUtility?.kind === 'healing' && unit.hp < maxHp(unit) ? '' : 'disabled'}>物品</button><button class="command" id="detail" ${unit ? '' : 'disabled'}>详情</button><button class="command" id="back" ${this.mode === 'target' || this.mode === 'heal-target' ? '' : 'disabled'}>返回行动</button><button class="command" id="cancel-move" ${canCommand && this.pendingMove ? '' : 'disabled'}>取消移动</button><button class="command" id="wait" ${unit && ['move', 'command'].includes(this.mode) ? '' : 'disabled'}>待机</button><button class="command" id="end" ${['idle', 'move', 'command'].includes(this.mode) ? '' : 'disabled'}>结束回合</button></div></div></div>`;
    const minimap = hud.querySelector<HTMLCanvasElement>('.replica-minimap canvas')!;
    const context = minimap.getContext('2d')!;
    const colors: Record<string,string> = { f:'#26372f', w:'#294854', b:'#a99b72', r:'#817f67', g:'#39493b', m:'#3b4540', s:'#698e88' };
    const cell = Math.min(this.staging ? 20 : 21, (minimap.width - (this.staging ? 0 : 30)) / MAP_W, (minimap.height - (this.staging ? 0 : 72)) / MAP_H);
    const offsetX = (minimap.width - MAP_W * cell) / 2, offsetY = (minimap.height - MAP_H * cell) / 2;
    context.fillStyle = '#172930'; context.fillRect(0, 0, minimap.width, minimap.height);
    chapter.map.forEach((row,y) => row.forEach((tile,x) => {
      context.fillStyle = colors[tile] ?? '#485447'; context.fillRect(offsetX+x*cell,offsetY+y*cell,cell,cell);
      context.strokeStyle = '#b8ac7b42'; context.lineWidth = .7; context.strokeRect(offsetX+x*cell,offsetY+y*cell,cell,cell);
    }));
    this.units.filter(member=>member.hp>0).forEach(member=> {
      const x = offsetX+(member.x+.5)*cell, y = offsetY+(member.y+.5)*cell;
      context.fillStyle = member.team === 'player' ? '#74ecf4' : '#f05d53';
      context.beginPath(); context.arc(x,y,4.6,0,Math.PI*2); context.fill();
      if (member.id === unit?.id) { context.strokeStyle = '#fff3c8'; context.lineWidth = 1.5; context.beginPath(); context.arc(x,y,7,0,Math.PI*2); context.stroke(); }
    });
    hud.querySelector('#camera-orbit')?.addEventListener('click', () => { if (this.renderHost) { this.renderHost.rotateView = !this.renderHost.rotateView; this.refreshHud(this.renderHost.rotateView ? '拖动旋转视角 · 滚轮缩放' : '拖动平移 · 右键拖动旋转'); } });
    hud.querySelector('#minimap-focus')?.addEventListener('click', () => this.renderHost?.resetCamera());
    for (const item of ['map','party','items','quests','save','system']) hud.querySelector(`#dock-${item}`)?.addEventListener('click', () => this.openBattleMenuItem(item));
    hud.querySelector('#battle-menu')?.addEventListener('click', () => this.showBattleMenu());
    hud.querySelector('#close-battle-tools')?.addEventListener('click', () => { this.toolsOpen = false; this.refreshHud(); });
    hud.querySelector('#deploy-battle')?.addEventListener('click', () => {
      this.staging = false; this.toolsOpen = false;
      try { localStorage.removeItem(stagingKey); } catch { /* Session-only UI state. */ }
      this.refreshHud(); this.showBanner('我方阶段');
    });
    hud.querySelectorAll<HTMLButtonElement>('[data-party-unit]').forEach(button=>button.addEventListener('click',()=> { const member = party.find(candidate=>candidate.id===button.dataset.partyUnit); if(member) this.handleTileClick(member.x,member.y); }));
    hud.querySelector('#render-settings')?.addEventListener('click', () => this.showRenderSettings());
    hud.querySelector('#render-focus')?.addEventListener('click', () => this.renderHost?.focus());
    hud.querySelector('#render-reset')?.addEventListener('click', () => this.renderHost?.resetCamera());
    hud.querySelector('#fight')?.addEventListener('click', () => this.chooseBattle());
    hud.querySelector('#heal')?.addEventListener('click', () => this.chooseHeal());
    hud.querySelector('#talk')?.addEventListener('click', () => this.chooseTalk());
    hud.querySelector('#trade')?.addEventListener('click', () => this.chooseTrade());
    hud.querySelector('#item')?.addEventListener('click', () => void this.useItem());
    hud.querySelector('#detail')?.addEventListener('click', () => unit && this.showUnitDetails(unit));
    hud.querySelector('#danger')?.addEventListener('click', () => this.toggleAllThreats());
    hud.querySelector('#speed')?.addEventListener('click', () => { this.animationSpeed = this.animationSpeed === 1 ? 2 : 1; this.refreshHud('已调整战斗演出速度'); });
    hud.querySelector('#compact')?.addEventListener('click', () => { this.compactCombat = !this.compactCombat; this.refreshHud(this.compactCombat ? '后续战斗使用简略演出' : '后续战斗使用完整舞台演出'); });
    hud.querySelector('#combat-log')?.addEventListener('click', () => { this.showCombatLog = !this.showCombatLog; this.refreshHud(); });
    hud.querySelector('#back')?.addEventListener('click', () => this.returnToCommand());
    hud.querySelector('#cancel-move')?.addEventListener('click', () => this.cancelMove());
    hud.querySelector('#wait')?.addEventListener('click', () => this.waitSelected());
    hud.querySelector('#end')?.addEventListener('click', () => void this.endTurn());
  }
}
