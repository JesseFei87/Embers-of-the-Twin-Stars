import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const dir = mkdtempSync(join(tmpdir(), 'world-map-'));
try {
  const outfile = join(dir, 'rules.mjs');
  await build({ stdin: { resolveDir: process.cwd(), contents: "export * from './src/game/world/RoadNetwork.ts';export * from './src/game/save.ts';export * from './src/game/data/chapters.ts';export * from './src/game/rules/progression.ts';export * from './src/game/data/mission.ts';" }, bundle: true, platform: 'node', format: 'esm', outfile });
  const g = await import(pathToFileURL(outfile));
  assert.equal(typeof g.mapPosition, 'function', 'saved road coordinates map onto the illustration');
  assert.deepEqual(g.mapPosition({x:240,y:486}), {x:449,y:566});
  assert.deepEqual(g.mapPosition({x:260,y:483}), {x:481.5,y:558});
  for (const road of g.roads) {
    assert.equal(road.imagePoints.length, road.points.length);
    for (const [index, point] of road.points.entries()) {
      assert.deepEqual(g.mapPosition(point), {x:road.imagePoints[index][0],y:road.imagePoints[index][1]}, 'connected image roads meet without jumps');
    }
  }
  const data = new Map(); globalThis.localStorage = { getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,v), removeItem: k => data.delete(k) };
  const onRoad = p => g.roads.some(r => r.points.slice(1).some((b,i) => {
    const a=r.points[i], dx=b.x-a.x,dy=b.y-a.y,t=((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy);
    return t>=-1e-7&&t<=1+1e-7&&Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy)<1e-6;
  }));
  for (const start of [...g.worldNodes, {x:20,y:610}, {x:455,y:390}]) for (const target of g.worldNodes) {
    const nav = new g.RoadNavigator(start); assert(onRoad(nav.position), 'legacy position projects to road'); nav.travelTo(target.id);
    let guard=0; while (nav.moving && guard++<20000) {nav.update(.017); assert(onRoad(nav.position), `road-only movement ${target.id}`);}
    assert(guard<20000); assert(Math.hypot(nav.position.x-target.x,nav.position.y-target.y)<1e-6);
  }
  const nav=new g.RoadNavigator(g.worldNodes[0]);nav.direction(0,-1);for(let i=0;i<20;i++){nav.update(.02);assert(onRoad(nav.position));}nav.stop();const paused={...nav.position};nav.update(1);assert.deepEqual(nav.position,paused);
  const imageNav=new g.RoadNavigator(g.worldNodes[0]);imageNav.direction(-1,0);
  assert.equal(imageNav.destination,'tide-cove','left follows the visible coast road, even though its saved coordinates point right');
  let save=g.createNewCampaign();const beforeStory=[...save.completedChapterIds],beforeInventory=[...save.inventory],beforeUnlocks=[...save.unlockedChapterIds];
  for(const id of ['moss-hollow','tide-cove']) {
    const chapter=g.chapters[id];assert(g.isChapterAvailable(id,[]));assert(chapter.repeatable);assert.equal(chapter.enemies().length,3);
    for(let run=1;run<=2;run++) {
      save=g.ensureCampaign();const party=save.roster.map((u,i)=>({...structuredClone(u),...chapter.deployment[i],acted:false}));g.beginBattle(id,save.roster,party,save.inventory);
      const units=g.unitsForBattle().units;assert.equal(units.filter(u=>u.team==='enemy'&&u.hp>0).length,3);
      g.grantExperience(units[0],30,()=>.99);for(const u of units.filter(u=>u.team==='enemy'))u.hp=0;
      assert.equal(g.evaluateMission(chapter.mission,units,2).status,'victory');g.completeChapter(units,[],'A');save=g.ensureCampaign();
      assert.equal(save.encounterWins[id],run);assert.deepEqual(save.completedChapterIds,beforeStory);assert.deepEqual(save.inventory,beforeInventory);assert.deepEqual(save.unlockedChapterIds,beforeUnlocks);assert(save.roster.every(u=>u.hp===u.stats.maxHp&&!u.acted));
    }
  }
  assert.equal(save.roster[0].level,2);assert.equal(save.roster[0].exp,20,'repeat encounter experience survives reload');
  assert.deepEqual(g.chapterList.map(c=>c.id),['starfall-bridge','moonlit-pass']);
  const image=readFileSync('public/assets/world-map/northern-realms.png');
  assert.equal(image.readUInt32BE(16),1672);assert.equal(image.readUInt32BE(20),941);
  for(const id of ['moss-hollow','tide-cove'])assert(existsSync(`world-map/source/${id}.blend`)&&existsSync(`public/assets/world3d/${id}.glb`));
  console.log('PASS: image road mapping, all pairs road-only routing, free-roam save projection, keyboard/pause, 2 encounters × 2 clears, persistent XP, full healing, independent story progress/unlocks/inventory, original map image and 3D encounter assets.');
} finally { rmSync(dir,{recursive:true,force:true}); }
