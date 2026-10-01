// Run inside tabbit-cli on the dedicated test origin; never writes the user's usual game save.
const test=pages().find(p=>p.url().startsWith('http://starfall-check.localhost:4174/'));
assert(test);usePage(test);
const fixtures=await test.evaluate(async()=>Promise.all(['starfall-bridge','moonlit-pass'].map(async id=>(await fetch(`/docs/hd2d-evidence/${id}-fixture.json`)).json())));
async function load(fixture) {
  await test.evaluate(f=>localStorage.setItem('embers-of-the-twin-stars-campaign-v2',JSON.stringify(f)),fixture);
  await test.reload();await test.locator('#continue').click();
  await test.waitForFunction(()=>window.__embers.game.scene.getScene('battle').renderHost?.enabled);
}
async function tile(id) {
  const p=await test.evaluate(id=>window.__embers.game.scene.getScene('battle').renderHost.debug().points.find(p=>p.id===id),id);
  assert(p);await test.mouse.click(p.x,p.y);
}
const healing=structuredClone(fixtures[0]);healing.battleUnits.find(u=>u.id==='kael').hp=10;
await load(healing);await tile('4,7');await tile('4,7');await test.locator('#heal').click();await tile('3,7');
await test.waitForFunction(()=>window.__embers.game.scene.getScene('battle').mode==='idle');
const healed=await test.evaluate(()=>window.__embers.game.scene.getScene('battle').units.filter(u=>['kael','lyra'].includes(u.id)).map(u=>({id:u.id,hp:u.hp,acted:u.acted})));
assert.equal(healed.find(u=>u.id==='lyra').hp,healing.battleUnits.find(u=>u.id==='lyra').hp-1);
assert.equal(healed.find(u=>u.id==='kael').hp,19);
await test.locator('#end').click();
await test.waitForFunction(()=>{const s=window.__embers.game.scene.getScene('battle');return s.turn===2&&s.mode==='idle';},null,{timeout:45000});
const saved=await test.evaluate(()=>JSON.stringify(window.__embers.game.scene.getScene('battle').units));
await test.reload();await test.locator('#continue').click();await test.waitForFunction(()=>window.__embers.game.scene.getScene('battle').renderHost?.enabled);
assert.equal(await test.evaluate(()=>JSON.stringify(window.__embers.game.scene.getScene('battle').units)),saved);
await test.locator('#render-toggle').click();
assert.equal(await test.evaluate(()=>JSON.stringify(window.__embers.game.scene.getScene('battle').units)),saved);
await test.locator('#render-toggle').click();await test.waitForFunction(()=>window.__embers.game.scene.getScene('battle').renderHost?.enabled);
assert.equal(await test.evaluate(()=>JSON.stringify(window.__embers.game.scene.getScene('battle').units)),saved);
const picking=await test.evaluate(()=>{const h=window.__embers.game.scene.getScene('battle').renderHost;return h.debug().points.flatMap(p=>{const pick=h.renderer.pick(p.x,p.y);const id=pick?.kind==='unit'?h.renderer.units.get(pick.unitId).data.tileId:pick?.tileId;return id===p.id?[]:[{cell:p.id,pick}];});});
assert.equal(picking.length,0,JSON.stringify(picking));
globalThis.starfallResults={...globalThis.starfallResults,healed,enemyTurn:2,saveReload:true,classicRoundtrip:true,all80CellsPickCorrectly:true};
return {...globalThis.starfallResults,errors:(await test.pageErrors()).map(e=>e.message)};
