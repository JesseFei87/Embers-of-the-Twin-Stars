import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Bundle the real rules into Node; no browser or player save is touched.
const temporary = mkdtempSync(join(tmpdir(), 'embers-rules-'));
try {
  const entry = `
    export * from './src/game/state.ts';
    export * from './src/game/rules/combat.ts';
    export * from './src/game/rules/movement.ts';
    export * from './src/game/data/characters.ts';
    export * from './src/game/data/chapters.ts';
    export * from './src/game/data/promotions.ts';
    export * from './src/game/data/recruitment.ts';
    export * from './src/game/save.ts';
    export * from './src/game/ui/portraits.ts';
    export * from './src/game/ui/fighter.ts';
    export * from './src/game/ui/replica.ts';
    export * from './src/game/ui/moonlitSprites.ts';
  `;
  const outfile = join(temporary, 'rules.mjs');
  await build({ stdin: { contents: entry, resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', outfile });
  const game = await import(pathToFileURL(outfile).href);
  const units = game.createCharacterData();
  const kael = units.find(unit => unit.id === 'kael');
  const lyra = units.find(unit => unit.id === 'lyra');
  const enemy = units.find(unit => unit.id === 'e1');
  const before = structuredClone([kael, enemy]);
  const preview = game.previewCombat(kael, enemy, 1);
  assert.equal(game.attackSpeed(kael), kael.stats.speed - game.attackProfile(kael).weight);
  assert.equal(preview.initiator.attacks, 2, 'Faster unit retains its follow-up');
  const hit = game.resolveCombat(kael, enemy, 1, () => 0);
  const miss = game.resolveCombat(kael, enemy, 1, () => .9999);
  assert(hit.events.some(event => event.type === 'strike' && event.hit));
  assert(miss.events.some(event => event.type === 'strike' && !event.hit));
  assert.deepEqual([kael, enemy], before, 'Resolver is still independent of presentation');
  for (const timeline of [hit, miss]) {
    const hp = { [kael.id]: kael.hp, [enemy.id]: enemy.hp };
    for (const event of timeline.events) hp[event.type === 'strike' ? event.defenderId : event.unitId] = event.hpAfter;
    assert.deepEqual(hp, timeline.finalHp, 'Timeline and final HP agree');
  }
  assert.equal(game.healingSpell(lyra).hpCost, 1);
  assert.equal(game.healingSpell(kael), undefined);
  const promoted = structuredClone(lyra);
  promoted.level = 3;
  const spellsBefore = [...promoted.spells];
  game.applyPromotion(promoted, game.promotionFor(promoted));
  assert.equal(promoted.class, 'valkyrie');
  assert.equal(promoted.level, 1);
  assert.deepEqual(promoted.spells, spellsBefore);
  const memories = new Map();
  globalThis.localStorage = { getItem: key => memories.get(key) ?? null, setItem: (key, value) => memories.set(key, value), removeItem: key => memories.delete(key) };
  const newCampaign = game.createNewCampaign();
  assert(game.isChapterAvailable('moonlit-pass', newCampaign.unlockedChapterIds), 'Moonlit is open without clearing Starfall');
  assert.deepEqual(newCampaign.completedChapterIds, []);
  assert(!newCampaign.unlockedChapterIds.includes('moonlit-pass'), 'Preview access must not become a permanent story unlock');
  assert(!game.isChapterAvailable('ashen-frontier', newCampaign.unlockedChapterIds));
  const inventoryCount = game.ensureCampaign().inventory.length;
  assert.equal(game.visitWorldNode('village').save.inventory.length, inventoryCount + 1);
  assert.equal(game.visitWorldNode('village').save.inventory.length, inventoryCount + 1, 'Village cannot duplicate supplies');
  game.saveWorldPosition(520, 400);
  assert.deepEqual(game.loadGame().worldPosition, { x: 520, y: 400 });
  for (const chapter of Object.values(game.chapters)) {
    const roster = game.createCharacterData().filter(unit => unit.team === 'player');
    const deployed = roster.map((unit, i) => ({ ...unit, ...chapter.deployment[i] }));
    game.beginBattle(chapter.id, roster, deployed, []);
    const restored = game.unitsForBattle();
    assert.equal(restored.chapterId, chapter.id);
    assert.equal(restored.units.length, deployed.length + chapter.enemies().length);
    for (const unit of restored.units) {
      for (const tile of game.reachableTiles(unit, () => false)) {
        assert.notEqual(game.terrainAt(tile.x, tile.y).moveCost[game.classes[unit.class].movementProfile], null);
        assert(tile.cost <= game.classes[unit.class].movement);
      }
    }
  }
  const moonlit = game.chapters['moonlit-pass'];
  game.setActiveChapter('moonlit-pass');
  assert.deepEqual([game.MAP_W, game.MAP_H], [12, 12]);
  assert.equal(moonlit.enemies().length, 7);
  assert.deepEqual(moonlit.deployment.map(p => p.y), [11, 11, 11, 11]);
  const cells = [...moonlit.deployment, ...moonlit.enemies()];
  assert.equal(new Set(cells.map(p => `${p.x},${p.y}`)).size, cells.length);
  const southKael = { ...kael, ...moonlit.deployment[0] };
  assert(game.reachableTiles(southKael, () => false).some(p => p.x === 4 && p.y === 10), 'New deployment can move north');
  // Flood the real movement graph; every land cell, reinforcement and objective must be accessible.
  const visited = new Set(), queue = [moonlit.deployment[0]];
  while (queue.length) {
    const point = queue.shift(), key = `${point.x},${point.y}`;
    if (visited.has(key)) continue;
    visited.add(key);
    queue.push(...game.reachableTiles({ ...kael, class: 'lancer', ...point }, () => false).filter(p => !visited.has(`${p.x},${p.y}`)));
  }
  assert.equal(visited.size, 136, 'All 136 nonriver cells connect to deployment');
  assert(visited.has('0,0') && visited.has('11,11') && visited.has('9,2'));
  // A v1 map save retains its ongoing battle, translated once into the expanded coordinate frame.
  const old = game.createNewCampaign();
  old.activeChapterId = 'moonlit-pass'; old.status = 'battle'; old.turn = 6; old.phase = 'enemy';
  old.battleLoot = ['moon-blade'];
  old.battleUnits = [{ ...kael, x: 3, y: 7, hp: 12, acted: true }, ...moonlit.enemies().filter(u => !['c2e4','c2e5'].includes(u.id)).map(u => ({ ...u, x: u.x-1, y: u.y-2 }))];
  old.battleUnits.find(u => u.id === 'c2e2').hp = 0;
  memories.set('embers-of-the-twin-stars-campaign-v2', JSON.stringify(old));
  const migrated = game.loadGame();
  assert.equal(migrated.turn, 6); assert.equal(migrated.phase, 'enemy');
  assert.deepEqual(migrated.battleLoot, ['moon-blade']);
  assert.deepEqual([migrated.battleUnits[0].x, migrated.battleUnits[0].y, migrated.battleUnits[0].hp, migrated.battleUnits[0].acted], [4,9,12,true]);
  assert.equal(migrated.battleUnits.find(u => u.id === 'c2e2').hp, 0);
  assert.equal(migrated.battleUnits.filter(u => u.team === 'enemy').length, 7);
  assert.deepEqual(game.loadGame(), migrated, 'Loading twice must not shift or duplicate units');
  assert(game.isChapterAvailable('moonlit-pass', migrated.unlockedChapterIds));
  game.setActiveChapter('starfall-bridge');
  assert.deepEqual([game.MAP_W, game.MAP_H], [10,8], 'Switching back restores Starfall bounds');
  const second = moonlit.enemies();
  assert.equal(game.portraitIndex(second.find(unit => unit.id === 'c2boss')), 7);
  assert.equal(game.portraitIndex(second.find(unit => unit.id === 'c2recruit')), 6);
  const recruit = second.find(unit => unit.id === 'c2recruit');
  assert.equal(game.canRecruit(lyra, recruit, 12), true);
  assert.equal(game.canRecruit(lyra, recruit, 13), false);
  assert.equal(game.canRecruit(kael, recruit, 1), false);
  const warden = second.find(unit => unit.id === 'c2e5');
  assert.equal(recruit.class, 'sword');
  assert.equal(game.attackProfile(recruit).id, 'iron-sword');
  assert.equal(game.attackProfile(warden).damageType, 'magical');
  assert.equal(game.attackProfile(warden).maxRange, 2);
  assert.equal(game.attackProfile(warden).hpCost, 1);
  assert.equal(game.canRecruit(lyra, warden, 1), false);
  assert.equal(game.recruitmentRules.c2recruit.recruitedTitle, '誓月剑士');
  for (const unit of [recruit, warden]) {
    const identity = game.moonlitSpriteKey(unit.id);
    assert(identity && identity !== game.spriteVisual('lancer'));
    for (const root of ['hd2d', 'starfall/animations']) for (let pose = 1; pose <= 6; pose++) {
      assert(existsSync(`public/assets/${root}/${identity}/0${pose}.png`));
    }
    assert(game.fighterArt(unit).includes(`/hd2d/${identity}/`));
    assert(game.mapSpriteMarkup(unit).includes(`/animations/${identity}/`));
  }
  const joined = { ...structuredClone(recruit), team: 'player', title: '誓月剑士' };
  assert.equal(game.moonlitSpriteKey(joined.id), game.moonlitSpriteKey(recruit.id));
  game.applyPromotion(joined, game.promotionFor(joined));
  assert.equal(joined.class, 'hero');
  assert(game.fighterArt(joined).includes('/hd2d/eileen/'));
  assert(game.cutoutPortraitUrl(joined).endsWith('/eileen-bust-refined.png'));
  // Previously recruited and active enemies migrate once without resetting gameplay.
  const legacyArt = game.createNewCampaign();
  legacyArt.activeChapterId = 'moonlit-pass'; legacyArt.moonlitLayoutVersion = 2;
  legacyArt.turn = 7; legacyArt.phase = 'enemy';
  legacyArt.roster.push({ ...recruit, class: 'paladin', team: 'player', itemId: 'iron-lance', level: 8, exp: 61, hp: 13, acted: true });
  legacyArt.battleUnits = [{ ...recruit, class: 'lancer', itemId: 'iron-lance', hp: 9 }, { ...warden, class: 'lancer', itemId: 'iron-lance', hp: 0 }];
  memories.set('embers-of-the-twin-stars-campaign-v2', JSON.stringify(legacyArt));
  const restoredArt = game.loadGame();
  const restoredEileen = restoredArt.roster.find(unit => unit.id === 'c2recruit');
  assert.deepEqual([restoredEileen.class, restoredEileen.team, restoredEileen.level, restoredEileen.exp, restoredEileen.hp, restoredEileen.acted], ['hero','player',8,61,13,true]);
  assert.equal(restoredArt.battleUnits[0].class, 'sword');
  assert.equal(restoredArt.battleUnits[1].hp, 0, 'Defeated altar mage stays defeated');
  assert.equal(restoredArt.battleUnits[1].itemId, undefined);
  assert.deepEqual([restoredArt.turn, restoredArt.phase], [7,'enemy']);
  assert.deepEqual(game.loadGame(), restoredArt, 'Identity migration is idempotent');
  for (const cls of Object.keys(game.classes)) for (let pose = 1; pose <= 6; pose++) {
    assert(existsSync(`public/assets/hd2d/${game.spriteVisual(cls)}/0${pose}.png`), `Missing ${cls} pose ${pose}`);
  }
  for (const file of ['portraits', 'village', 'battle', 'terrain', 'props']) assert(existsSync(`public/assets/hd2d/${file}.png`));
  console.log('PASS: combat, hit/miss, timeline HP, healing, weighted movement, both chapters, save compatibility, one-time supplies, portraits and sprite assets.');
} finally {
  rmSync(temporary, { recursive: true });
}
