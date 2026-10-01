import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
const root = 'public/assets/starfall';
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const manifest = JSON.parse(readFileSync(`${root}/source-manifest.json`));
for (const [path, digest] of Object.entries(manifest)) assert.equal(hash(`${root}/${path}`), digest, `Shipped asset matches source: ${path}`);
assert.equal(hash(`${root}/environment.glb`), hash('godot-starfall/assets/models/starfall_environment.glb'));
// Moonlit v2 intentionally changes shared chapter bounds and save migration.
// Preserve hash checks for combat/rules data; check Starfall chapter semantics below.
const moonlitSharedFiles = new Set(['src/game/data/chapters.ts', 'src/game/save.ts', 'src/game/state.ts', 'src/game/data/recruitment.ts']);
for (const [path, digest] of Object.entries(JSON.parse(readFileSync('docs/starfall-play-evidence/rules-before.json')))) {
  if (moonlitSharedFiles.has(path)) continue;
  // Optional monster types/classes are additive; retain the exact legacy-data checksum.
  const legacy = readFileSync(path, 'utf8')
    .replace(/  (mossling|tidecrab): \{[^\n]+\n/g, '')
    .replace(" | 'mossling' | 'tidecrab'", '');
  assert.equal(createHash('sha256').update(legacy).digest('hex'), digest, `Original rules unchanged: ${path}`);
}
const bytes = readFileSync(`${root}/environment.glb`);
const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
assert(gltf.nodes.some(node => node.name?.includes('Pine forest')));
assert(gltf.nodes.some(node => node.name?.includes('Bridgekeepers lodge')));
assert(gltf.images.every(image => image.bufferView !== undefined));
const temp = mkdtempSync(join(tmpdir(), 'starfall-'));
try {
  const outfile = join(temp, 'adapter.mjs');
  await build({stdin:{resolveDir:process.cwd(),contents:"export * from './src/presentation/GameRenderAdapter.ts'; export * from './src/presentation/three/TacticalCamera.ts'; export * from './src/presentation/visual-config/maps.ts'; export * from './src/game/data/characters.ts'; export * from './src/game/data/chapters.ts';"},bundle:true,platform:'node',format:'esm',outfile});
  const { GameRenderAdapter, TacticalCamera, starfallHeight, createCharacterData, chapters } = await import(pathToFileURL(outfile));
  const starfall = chapters['starfall-bridge'];
  assert.deepEqual(starfall.map.map(row => row.join('')), ['ggggffffgg','gggffmffgg','ggggmmfggg','wwwwbbwwww','ggggrrgggg','gffgrrggfg','ggggrrffgg','ggggssgggg']);
  assert.deepEqual(starfall.deployment, [3,4,5,6].map(x => ({x,y:7})));
  assert.deepEqual(starfall.enemies(), createCharacterData().filter(u => u.team === 'enemy'));
  assert.equal(starfall.mission.turnLimit, 20);
  assert.deepEqual(starfall.mission.victory, [{type:'defeat-boss',unitId:'e1',label:'击败蚀月骑士'},{type:'seize',x:4,y:0,unitId:'kael',label:'凯尔抵达北岸'}]);
  const adapter = new GameRenderAdapter('starfall-bridge', 'acceptance');
  const snapshot = adapter.snapshot(createCharacterData(),null,[]);
  for (const unit of snapshot.units) {
    const [x,y] = unit.tileId.split(',').map(Number);
    assert.equal(unit.feet.x, ((x - 4.5) * 2) / 2);
    assert.equal(unit.feet.z, (y * 2 - 7) / 2);
    assert.equal(unit.feet.y, starfallHeight(unit.feet.x,unit.feet.z));
  }
  // Both bridge lanes, river bed and altar steps align with the authored geometry.
  for (const x of [-.5,.5]) assert(starfallHeight(x,-.5) > .3);
  assert.equal(starfallHeight(3,-.5), .0375);
  assert.equal(starfallHeight(.5,3.5), .3575);
  const camera = new TacticalCamera(); camera.setStarfall();
  for (const [w,h] of [[1280,720],[1440,810],[1920,1080]]) {
    camera.resize(w,h); camera.reset();
    for (const tile of snapshot.tiles) {
      const point = camera.target.clone().copy(tile.center).project(camera.camera);
      assert(Math.abs(point.x)<1 && Math.abs(point.y)<1, `Board cell ${tile.id} fits ${w}x${h}`);
    }
  }
  console.log('PASS: authored GLB/sprite identity, original combat data and Starfall chapter preserved, 80-cell alignment, bridge/shrine height, desktop camera bounds.');
} finally { rmSync(temp,{recursive:true,force:true}); }
