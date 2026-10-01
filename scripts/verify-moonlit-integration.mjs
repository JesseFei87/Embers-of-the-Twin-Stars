import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const layout=JSON.parse(readFileSync('public/assets/moonlit/layout.json'));
assert.equal(hash('public/assets/moonlit/environment.glb'),hash('godot-starfall/assets/models/moonlit_environment.glb'));
assert.equal(hash('public/assets/moonlit/layout.json'),hash('godot-starfall/assets/moonlit-layout.json'));
const dir=mkdtempSync(join(tmpdir(),'moonlit-integration-'));
try {
 const outfile=join(dir,'rules.mjs');
 await build({stdin:{resolveDir:process.cwd(),contents:"export * from './src/presentation/GameRenderAdapter.ts';export * from './src/presentation/three/TacticalCamera.ts';export * from './src/game/data/chapters.ts';export * from './src/presentation/DisplaySettings.ts';"},bundle:true,format:'esm',platform:'node',outfile});
 const g=await import(pathToFileURL(outfile));const chapter=g.chapters['moonlit-pass'];
 assert.deepEqual(chapter.map.map(r=>r.join('')),layout.rows);
 const adapter=new g.GameRenderAdapter(chapter.id,'verify');
 for(const tile of adapter.tiles)assert.equal(tile.center.y,layout.cell_heights[tile.grid.y][tile.grid.x]*.5,`Godot and browser height: ${tile.id}`);
 const camera=new g.TacticalCamera();camera.setMapSize(12,12);camera.setMoonlit();
 for(const [w,h] of [[1280,720],[1440,810],[1920,1080],[1074,909]]){
  camera.resize(w,h);camera.reset();
  for(const tile of adapter.tiles){const p=camera.target.clone().copy(tile.center).project(camera.camera);assert(Math.abs(p.x)<1&&Math.abs(p.y)<1,`${tile.id} fits ${w}x${h}`);}
  camera.rotate(1e6,1e6);camera.pan(1e6,1e6);camera.zoom(1e6);
  const state=camera.capture();assert(Math.abs(Math.atan2(state.offset.x,state.offset.z))<=.450001);assert(Math.abs(state.target.x)<=.5&&Math.abs(state.target.z)<=.5);
  assert(Math.abs(Math.atan2(state.offset.x,state.offset.z))>.4,'Moonlit orbit expands beyond the former 3 degree limit');
  camera.zoom(-1e6);camera.pan(1e6,1e6);assert(Math.abs(camera.target.x)<=2&&Math.abs(camera.target.z)<=2);
  camera.reset();assert.equal(camera.target.x,0);assert.equal(camera.target.z,0);
 }
 globalThis.matchMedia=()=>({matches:false});globalThis.localStorage={getItem:()=>JSON.stringify({mapCombat:false})};
 assert.equal(g.readDisplaySettings().mapCombat,true,'Legacy 2D combat preference cannot restore the 2D stage');
 console.log('PASS: shipped authored Moonlit model/layout, all 144 native elevations, four desktop camera sizes, bounded backdrop-facing orbit, legacy combat preference migration.');
}finally{rmSync(dir,{recursive:true,force:true});}
