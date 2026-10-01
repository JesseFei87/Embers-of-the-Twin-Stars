import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const temporary = mkdtempSync(join(tmpdir(), 'embers-presentation-'));
try {
  const outfile = join(temporary, 'test.mjs');
  await build({ stdin: { resolveDir: process.cwd(), contents: `
    export * from './src/presentation/GameRenderAdapter.ts';
    export * from './src/presentation/CombatPlayback.ts';
    export * from './src/presentation/three/TerrainView.ts';
    export * from './src/presentation/three/AssetRegistry.ts';
    export * from './src/presentation/three/TacticalCamera.ts';
    export * from './src/presentation/visual-config/maps.ts';
    export * from './src/game/data/chapters.ts';
    export * from './src/game/data/characters.ts';
    export * from './src/game/state.ts';
    export * from './src/game/save.ts';
    export * from './src/game/rules/combat.ts';
    export * from './src/game/rules/movement.ts';
    export * from './src/game/rules/ai.ts';
  ` }, bundle: true, platform: 'node', format: 'esm', outfile });
  const game = await import(pathToFileURL(outfile));
  const camera = new game.TacticalCamera();
  camera.resize(1461, 907); camera.reset(); camera.resize(1280, 720);
  for (const x of [-5, 5]) {
    const point = camera.target.clone().set(x, .1, 0).project(camera.camera);
    assert(Math.abs(point.x) < 1, 'Resizing the desktop window keeps both board edges in view');
  }
  const resized = camera.capture(); camera.resize(1461, 907); camera.resize(1280, 720);
  assert.equal(camera.capture().distance, resized.distance, 'Viewport changes preserve relative zoom');
  const facing = camera.capture();
  camera.rotate(Math.PI * 2 / .006, 0);
  assert(camera.capture().offset.distanceTo(facing.offset) < 1e-9, 'Orbit completes a full 360 degrees');
  camera.rotate(180, 40); const rotated = camera.capture();
  camera.cinematic({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 1, rotated);
  camera.restore(rotated);
  assert(camera.capture().offset.distanceTo(rotated.offset) < 1e-9, 'Combat restore retains orbit orientation');
  camera.rotate(0, 100000); assert(camera.capture().offset.y > .2, 'Orbit cannot cross beneath terrain');
  camera.restore(facing);
  const freeze = obj => { if (obj && typeof obj === 'object') { Object.values(obj).forEach(freeze); Object.freeze(obj); } return obj; };
  const memories = new Map();
  globalThis.localStorage = { getItem: key => memories.get(key) ?? null, setItem: (key, value) => memories.set(key, value), removeItem: key => memories.delete(key) };
  game.createNewCampaign();
  for (const chapter of Object.values(game.chapters)) {
    game.setActiveChapter(chapter.id);
    const roster = game.createCharacterData().filter(unit => unit.team === 'player');
    const units = [...roster.map((unit, i) => ({ ...unit, ...chapter.deployment[i] })), ...chapter.enemies()];
    const adapter = new game.GameRenderAdapter(chapter.id, `${chapter.id}:test`);
    const fittedCamera = new game.TacticalCamera();
    fittedCamera.setMapSize(adapter.cols, adapter.rows);
    for (const [width,height] of [[1280,720],[1440,810],[1920,1080],[1074,909]]) {
      fittedCamera.resize(width,height); fittedCamera.reset();
      for (const tile of adapter.tiles) {
        const projected = fittedCamera.target.clone().copy(tile.center).project(fittedCamera.camera);
        assert(Math.abs(projected.x)<1 && Math.abs(projected.y)<1, `${chapter.id} cell ${tile.id} fits ${width}x${height}`);
      }
    }
    const immutable = freeze(structuredClone(units));
    const random = Math.random; Math.random = () => { throw new Error('Adapter consumed rules RNG'); };
    let snapshot;
    try { snapshot = adapter.snapshot(immutable, 'kael', []); } finally { Math.random = random; }
    assert.equal(snapshot.units.length, units.length);
    assert.equal(snapshot.tiles.length, chapter.map.length * chapter.map[0].length);
    assert.throws(() => adapter.snapshot(units, null, [{ tileId: '100,100' }]), /未知视觉/);
    snapshot.units[0].feet.x += 50;
    assert.deepEqual(units, immutable, 'No mutable references to Unit or Stats escape');
    for (const tile of adapter.tiles) {
      const p = game.surfacePoint(adapter.tiles, adapter.cols, adapter.rows, tile.center.x, tile.center.z);
      assert(Math.abs(p.y - tile.center.y) < 1e-8, 'Standing centers meet real surface');
      if (tile.grid.x < adapter.cols - 1) {
        const next = adapter.tiles.find(t => t.grid.x === tile.grid.x + 1 && t.grid.y === tile.grid.y);
        for (let row = 0; row < 3; row++) assert.equal(tile.heights[row * 3 + 2], next.heights[row * 3], 'Adjacent terrain edges match');
      }
    }
    for (const unit of units) {
      const occupied = (x, y, ignore) => units.some(other => other !== ignore && other.hp > 0 && other.x === x && other.y === y);
      const before = game.reachableTiles(unit, occupied);
      adapter.snapshot(units, unit.id, before.map(p => ({ tileId: `${p.x},${p.y}`, color: 0, alpha: .1 })));
      assert.deepEqual(game.reachableTiles(unit, occupied), before);
      if (unit.team === 'enemy') {
        const players = units.filter(u => u.team === 'player'), enemies = units.filter(u => u.team === 'enemy');
        const decision = game.chooseEnemyAction(unit, players, occupied, enemies);
        adapter.snapshot(units, null, []);
        assert.deepEqual(game.chooseEnemyAction(unit, players, occupied, enemies), decision);
      }
    }
    const move = adapter.movement(units[0].id, { x: 4, y: 4 }, { x: 4, y: 3 });
    assert.equal(move.path.length, 9);
    for (const p of move.path) assert.deepEqual(p, game.surfacePoint(adapter.tiles, adapter.cols, adapter.rows, p.x, p.z));
    const kael = units[0], enemy = units.find(u => u.team === 'enemy');
    for (const rolls of [[.999], [0], [.5, .99, .1, .99]]) {
      const run = render => {
        const copy = structuredClone(units), a = copy.find(u => u.id === kael.id), b = copy.find(u => u.id === enemy.id);
        let index = 0;
        const result = game.resolveCombat(a, b, 1, () => rolls[index++ % rolls.length]);
        for (const event of result.events) {
          copy.find(u => u.id === (event.type === 'cost' ? event.unitId : event.defenderId)).hp = event.hpAfter;
          if (render) adapter.snapshot(copy, null, []);
        }
        return { copy, result, index };
      };
      assert.deepEqual(run(true), run(false), 'Presentation leaves result order, HP and RNG consumption intact');
    }
    game.beginBattle(chapter.id, roster, units.filter(u => u.team === 'player'), []);
    // The battle scene's initial autosave synchronizes roster positions with deployment.
    game.saveGame(units, 1, 'player', []);
    const old = game.loadGame();
    const saved = game.unitsForBattle(); adapter.snapshot(saved.units, null, []);
    game.saveGame(saved.units, saved.turn, saved.phase, saved.battleLoot);
    const restored = game.loadGame();
    delete old.savedAt; delete restored.savedAt;
    assert.deepEqual(restored, old, 'Classic → 3D projection → save → classic preserves v2 semantics');
    writeFileSync(`docs/hd2d-evidence/${chapter.id}-fixture.json`, JSON.stringify({ ...old, savedAt: 0 }, null, 2));
  }
  // Geometry batches really construct, including mixed indexed/non-indexed source assets.
  const registry = new game.AssetRegistry();
  const terrainAdapter = new game.GameRenderAdapter('starfall-bridge', 'geometry');
  const terrain = new game.TerrainView(terrainAdapter.snapshot(game.createCharacterData(), null, []), registry);
  assert.equal(terrain.picks.length, 80); registry.dispose();
  for (const magical of [false, true]) for (const roll of [0, .5, .9999]) {
    game.setActiveChapter('starfall-bridge');
    const units = game.createCharacterData();
    const attacker = units.find(u => u.id === (magical ? 'lyra' : 'kael'));
    const defender = units.find(u => u.id === 'e4');
    if (magical) { attacker.activeSpellId = 'starfire'; attacker.spells.push('starfire'); }
    const timeline = game.resolveCombat(attacker, defender, magical ? 2 : 1, () => roll);
    const frozen = freeze(structuredClone(timeline));
    const adapter = new game.GameRenderAdapter('starfall-bridge', `combat-${magical}-${roll}`);
    const steps = adapter.combat(frozen, units, 'action');
    if (magical) assert(steps.some(e => e.type === 'cost' && e.amount === 1));
    assert.equal(steps.length, timeline.events.length, 'No fabricated counterattacks or death strikes');
    for (const step of steps) if (step.type === 'strike' && !step.hit) { assert.equal(step.damage, 0); assert.equal(step.hpBefore, step.hpAfter); }
    for (let skipAt = 0; skipAt <= steps.length; skipAt++) {
      const playback = new game.CombatPlayback(steps), hp = { [attacker.id]: attacker.hp, [defender.id]: defender.hp }, ids = [];
      const apply = event => { ids.push(event.id); hp[event.type === 'cost' ? event.unitId : event.targetId] = event.hpAfter; };
      for (const step of steps.slice(0, skipAt)) { playback.commit(step, apply); assert.equal(playback.commit(step, apply), false); }
      playback.skip(apply); playback.skip(apply);
      assert.deepEqual(hp, timeline.finalHp, 'Every skip boundary has the exact original final HP');
      assert.equal(new Set(ids).size, ids.length, 'Each actual cost/strike commits once');
      assert.equal(playback.complete, true);
    }
    if (steps.length > 1) assert.throws(() => new game.CombatPlayback(steps).commit(steps[1], () => {}), /Out-of-order/);
  }
  const clock = new game.PresentationClock(); let contacts = 0;
  const normal = clock.play(.1, p => { if (p === 1) contacts++; }); clock.update(.05); clock.update(.05); clock.update(100);
  assert.equal(await normal, true); assert.equal(contacts, 1);
  const canceled = clock.play(.4, p => { if (p === 1) contacts++; }); clock.cancel(); clock.update(100);
  assert.equal(await canceled, false); assert.equal(contacts, 1, 'Canceled callbacks cannot leak into a new scene');
  let progress = 0; const resumed = clock.play(1, p => { progress = p; }); clock.update(60); assert.equal(progress, .05, 'Background delta is clamped'); clock.cancel(); await resumed;
  memories.clear(); memories.set('embers-of-the-twin-stars-save-v1', JSON.stringify({ version: 1, status: 'active', turn: 3, units: game.createCharacterData() }));
  const legacy = game.unitsForBattle(); assert.equal(legacy.turn, 3);
  new game.GameRenderAdapter(legacy.chapterId, 'v1').snapshot(legacy.units, null, []);
  game.saveGame(legacy.units, legacy.turn); assert.deepEqual(game.unitsForBattle().units, legacy.units, 'Migrated v1 save remains playable through 3D');
  const protectedPaths = ['src/game/rules', 'src/game/data'];
  const files = ['src/game/state.ts', 'src/game/save.ts', ...protectedPaths.flatMap(dir => readdirSync(dir).filter(f => f.endsWith('.ts')).map(f => `${dir}/${f}`))];
  for (const file of files) assert(!/(?:from\s*['"][^'"]*(?:presentation|three|babylon)|import\(['"][^'"]*(?:presentation|three|babylon))/.test(readFileSync(file, 'utf8')), `Forbidden rendering dependency: ${file}`);
  assert.throws(() => new game.GameRenderAdapter('unknown-map', 'test'), /未配置/);
  console.log('PASS: immutable adapter, terrain seams/ramps, both maps, movement/AI/RNG parity, v2 save roundtrip, protected dependency boundary, geometry batches, v1 saves, ordered cost/strike commits, every skip boundary, cancellation and large-delta recovery.');
} finally { rmSync(temporary, { recursive: true }); }
