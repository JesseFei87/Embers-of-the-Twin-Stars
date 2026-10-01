import { chapters } from './data/chapters';
import { createCharacterData } from './data/characters';
import { itemName } from './data/items';
import { classes, maxHp, setActiveChapter, type Unit } from './state';

const SAVE_KEY = 'embers-of-the-twin-stars-campaign-v2';
const LEGACY_SAVE_KEY = 'embers-of-the-twin-stars-save-v1';

export interface ChapterSummary {
  chapterId: string;
  title: string;
  recruited: string[];
  items: string[];
  roster: Array<{ name: string; level: number; class: string }>;
  rating?: 'S' | 'A' | 'B' | 'C';
}

export interface GameSave {
  version: 2;
  status: 'world' | 'battle';
  activeChapterId: string;
  turn: number;
  phase?: 'player' | 'enemy';
  roster: Unit[];
  battleUnits?: Unit[];
  battleLoot?: string[];
  inventory: string[];
  completedChapterIds: string[];
  unlockedChapterIds: string[];
  visitedNodes: string[];
  encounterWins?: Record<string, number>;
  lastSummary?: ChapterSummary;
  savedAt: number;
  moonlitLayoutVersion?: 2;
  worldPosition?: { x: number; y: number };
}

const persist = (save: GameSave) => { save.savedAt = Date.now(); localStorage.setItem(SAVE_KEY, JSON.stringify(save)); return save; };

function migrateCharacterArt(save: GameSave) {
  let changed = false;
  // Translate existing battle coordinates once; preserve turn, HP, loot and defeated units.
  if (save.activeChapterId === 'moonlit-pass' && save.battleUnits && save.moonlitLayoutVersion !== 2) {
    for (const unit of save.battleUnits) { unit.x += 1; unit.y += 2; }
    save.battleUnits.push(...chapters['moonlit-pass'].enemies().filter(unit =>
      ['c2e4', 'c2e5'].includes(unit.id) && !save.battleUnits!.some(existing => existing.id === unit.id)));
    save.moonlitLayoutVersion = 2;
    changed = true;
  }
  for (const unit of [...save.roster, ...(save.battleUnits ?? [])]) {
    // Replace only the retired Moonlit lancer identities; retain progress and team.
    if (unit.id === 'c2recruit' && ['lancer', 'paladin'].includes(unit.class)) {
      unit.class = unit.class === 'paladin' ? 'hero' : 'sword';
      unit.title = unit.team === 'player' ? '誓月剑士' : '白披肩剑士';
      if (unit.itemId === 'iron-lance') unit.itemId = 'iron-sword';
      changed = true;
    }
    if (unit.id === 'c2e5' && unit.class === 'lancer') {
      unit.class = 'mage'; unit.name = '祭坛术士'; unit.title = '覆面祭仪卫';
      delete unit.itemId; unit.spells = ['starfire']; unit.activeSpellId = 'starfire';
      unit.stats.defense = 3; unit.stats.resistance = 6;
      changed = true;
    }
    if (unit.id === 'lyra') {
      if (unit.class === 'cleric') {
        unit.class = 'star-cavalry'; unit.title = '星祈骑士';
        unit.stats.maxHp += 2; unit.hp += 2; unit.stats.skill += 1; unit.stats.speed += 1; unit.stats.defense += 2; unit.stats.resistance = Math.max(0, unit.stats.resistance - 1);
        changed = true;
      }
      if (unit.portrait !== 4) { unit.portrait = 4; changed = true; }
    }
    if (unit.id === 'e2' && unit.portrait !== 5) { unit.portrait = 5; changed = true; }
  }
  return changed ? persist(save) : save;
}

export function loadGame(): GameSave | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null') as GameSave | null;
    if (value?.version === 2 && Array.isArray(value.roster)) return migrateCharacterArt(value);
    const legacy = JSON.parse(localStorage.getItem(LEGACY_SAVE_KEY) ?? 'null') as { version?: number; status?: 'active' | 'completed'; turn?: number; units?: Unit[] } | null;
    if (legacy?.version !== 1 || !Array.isArray(legacy.units)) return undefined;
    const completed = legacy.status === 'completed';
    const migrated: GameSave = {
      version: 2, status: completed ? 'world' : 'battle', activeChapterId: 'starfall-bridge', turn: completed ? 1 : legacy.turn ?? 1,
      roster: legacy.units.filter(unit => unit.team === 'player'), battleUnits: completed ? undefined : legacy.units,
      inventory: ['iron-sword', 'iron-lance'], completedChapterIds: completed ? ['starfall-bridge'] : [],
      unlockedChapterIds: completed ? ['starfall-bridge', 'moonlit-pass'] : ['starfall-bridge'], visitedNodes: [], savedAt: Date.now(),
    };
    return persist(migrated);
  } catch { return undefined; }
}

export const clearSave = () => { localStorage.removeItem(SAVE_KEY); localStorage.removeItem(LEGACY_SAVE_KEY); };

export function createNewCampaign() {
  const save: GameSave = {
    version: 2, status: 'world', activeChapterId: 'starfall-bridge', turn: 1,
    roster: createCharacterData().filter(unit => unit.team === 'player'), inventory: ['iron-sword', 'iron-lance', 'healing-draught'],
    completedChapterIds: [], unlockedChapterIds: ['starfall-bridge'], visitedNodes: [], savedAt: Date.now(),
  };
  return persist(save);
}

export function ensureCampaign() { return loadGame() ?? createNewCampaign(); }

export function updateRosterUnit(updated: Unit) {
  const save = ensureCampaign(); const index = save.roster.findIndex(unit => unit.id === updated.id);
  if (index >= 0) save.roster[index] = structuredClone(updated);
  return persist(save);
}

export function selectChapter(chapterId: string) {
  const save = ensureCampaign(); save.activeChapterId = chapterId; save.status = 'world'; return persist(save);
}

export function saveWorldPosition(x: number, y: number) {
  const save = ensureCampaign(); save.worldPosition = { x, y }; return persist(save);
}

export function beginBattle(chapterId: string, roster: Unit[], deployed: Unit[], inventory: string[]) {
  const save = ensureCampaign(); const chapter = chapters[chapterId];
  setActiveChapter(chapterId); save.activeChapterId = chapterId; save.status = 'battle'; save.turn = 1; save.phase = 'player';
  save.roster = roster; save.inventory = inventory; save.battleUnits = [...deployed, ...chapter.enemies()]; save.battleLoot = []; save.lastSummary = undefined;
  if (chapterId === 'moonlit-pass') save.moonlitLayoutVersion = 2;
  return persist(save);
}

export function saveGame(units: Unit[], turn: number, phase: 'player' | 'enemy' = 'player', battleLoot: string[] = []) {
  const save = ensureCampaign(); save.status = 'battle'; save.turn = turn; save.phase = phase; save.battleUnits = units; save.battleLoot = [...battleLoot];
  const byId = new Map(units.filter(unit => unit.team === 'player').map(unit => [unit.id, unit]));
  save.roster = save.roster.map(unit => byId.get(unit.id) ?? unit);
  return persist(save);
}

export function unitsForBattle() {
  const save = ensureCampaign(); setActiveChapter(save.activeChapterId);
  const enemyAi = new Map(chapters[save.activeChapterId].enemies().map(unit => [unit.id, { ai: unit.ai, aiRange: unit.aiRange }]));
  const units = (save.battleUnits ?? []).map(unit => unit.team === 'enemy' ? { ...unit, ...enemyAi.get(unit.id) } : unit);
  return { units, turn: save.turn, phase: save.phase ?? 'player', battleLoot: save.battleLoot ?? [], chapterId: save.activeChapterId };
}

export function completeChapter(units: Unit[], collectedLoot: string[], rating?: ChapterSummary['rating']) {
  const save = ensureCampaign(); const chapter = chapters[save.activeChapterId]; const oldIds = new Set(save.roster.map(unit => unit.id));
  const firstClear = !save.completedChapterIds.includes(chapter.id);
  const survivors = units.filter(unit => unit.team === 'player' && unit.hp > 0);
  const byId = new Map(survivors.map(unit => [unit.id, unit]));
  save.roster = save.roster.map(unit => byId.get(unit.id) ?? unit);
  for (const unit of survivors) if (!save.roster.some(existing => existing.id === unit.id)) save.roster.push(unit);
  const recruited = survivors.filter(unit => !oldIds.has(unit.id)).map(unit => unit.name);
  const items = [...collectedLoot, ...(firstClear ? chapter.rewards : [])]; save.inventory.push(...items);
  if (chapter.repeatable) {
    save.encounterWins ??= {}; save.encounterWins[chapter.id] = (save.encounterWins[chapter.id] ?? 0) + 1;
    save.roster.forEach(unit => { unit.hp = maxHp(unit); unit.acted = false; });
  } else if (!save.completedChapterIds.includes(chapter.id)) save.completedChapterIds.push(chapter.id);
  for (const id of chapter.unlocks) if (!save.unlockedChapterIds.includes(id)) save.unlockedChapterIds.push(id);
  save.status = 'world'; save.battleUnits = undefined; save.battleLoot = undefined; save.turn = 1; save.phase = 'player';
  save.lastSummary = { chapterId: chapter.id, title: chapter.title, recruited, items: items.map(itemName), roster: save.roster.map(unit => ({ name: unit.name, level: unit.level, class: classes[unit.class].name })), rating };
  return persist(save).lastSummary!;
}

export function abandonBattle() {
  const save = ensureCampaign();
  save.roster.forEach(unit => { unit.hp = maxHp(unit); unit.acted = false; });
  save.status = 'world'; save.battleUnits = undefined; save.battleLoot = undefined; save.turn = 1; save.phase = 'player'; return persist(save);
}

export function visitWorldNode(nodeId: 'village' | 'shrine') {
  const save = ensureCampaign(); const firstVisit = !save.visitedNodes.includes(nodeId);
  if (nodeId === 'village' && firstVisit) save.inventory.push('healing-draught');
  if (nodeId === 'shrine') save.roster.forEach(unit => unit.hp = maxHp(unit));
  if (firstVisit) save.visitedNodes.push(nodeId);
  return { save: persist(save), firstVisit };
}
