// Run through tabbit-cli on the isolated QA origin, with an active battle.
assert(page.url().startsWith('http://hd2d-render-qa.localhost:4174/'));
const fixtures = await page.evaluate(async () => Promise.all(['starfall-bridge','moonlit-pass'].map(async id => (await fetch(`/docs/hd2d-evidence/${id}-fixture.json`)).json())));
async function loadFixture(fixture) {
  const epoch = await page.evaluate(f => { localStorage.setItem('embers-of-the-twin-stars-campaign-v2',JSON.stringify(f)); const s=window.__embers.game.scene.getScene('battle'), epoch=s.renderInstance; s.scene.restart(); return epoch; },fixture);
  await page.waitForFunction(epoch => { const s=window.__embers.game.scene.getScene('battle'); return s.renderInstance>epoch && s.renderHost?.enabled; },epoch);
  await page.evaluate(() => { const s=window.__embers.game.scene.getScene('battle'); s.animationSpeed=2; s.renderHost.configure({quality:'medium',dof:false,mapCombat:true}); });
}
async function clickTile(id) {
  const p=await page.evaluate(id=>window.__embers.game.scene.getScene('battle').renderHost.debug().points.find(p=>p.id===id),id);
  assert(p); await page.mouse.click(p.x,p.y);
}
const healing=JSON.parse(JSON.stringify(fixtures[0])); healing.battleUnits.find(u=>u.id==='kael').hp=10;
await loadFixture(healing); await clickTile('4,7'); await clickTile('4,7'); await page.locator('#heal').click(); await clickTile('3,7');
await page.waitForFunction(()=>window.__embers.game.scene.getScene('battle').mode==='idle');
const healed=await page.evaluate(()=>window.__embers.game.scene.getScene('battle').units.filter(u=>['kael','lyra'].includes(u.id)).map(u=>({id:u.id,hp:u.hp,acted:u.acted})));
assert.equal(healed.find(u=>u.id==='lyra').hp,healing.battleUnits.find(u=>u.id==='lyra').hp-1);
assert.equal(healed.find(u=>u.id==='kael').hp,10+healing.battleUnits.find(u=>u.id==='lyra').stats.strength);
await loadFixture(fixtures[1]); await page.locator('#end').click();
await page.waitForFunction(()=>{const s=window.__embers.game.scene.getScene('battle');return s.turn===2&&s.mode==='idle';},null,{timeout:45000});
const saved=await page.evaluate(()=>JSON.stringify(window.__embers.game.scene.getScene('battle').units));
await page.reload(); await page.locator('#continue').click(); await page.waitForFunction(()=>window.__embers.game.scene.getScene('battle').renderHost?.enabled);
assert.equal(await page.evaluate(()=>JSON.stringify(window.__embers.game.scene.getScene('battle').units)),saved);
await page.locator('#render-toggle').click(); assert.equal(await page.evaluate(()=>JSON.stringify(window.__embers.game.scene.getScene('battle').units)),saved);
await page.locator('#render-toggle').click(); await page.waitForFunction(()=>window.__embers.game.scene.getScene('battle').renderHost?.enabled);
const defeat=JSON.parse(JSON.stringify(fixtures[1])); defeat.battleUnits.find(u=>u.id==='kael').hp=0;
await loadFixture(defeat); await page.locator('#end').click(); await page.getByRole('heading',{name:'余烬熄灭'}).waitFor();
await page.locator('#again').click(); await page.locator('#start-battle').click(); await page.waitForFunction(()=>window.__embers.game.scene.getScene('battle').renderHost?.enabled);
const victory=JSON.parse(JSON.stringify(fixtures[1])); Object.assign(victory.battleUnits.find(u=>u.id==='kael'),{x:7,y:0}); victory.battleUnits.find(u=>u.id==='c2boss').hp=1;
await loadFixture(victory); await clickTile('7,0'); await clickTile('7,0'); await page.locator('#fight').click(); await clickTile('8,0');
for(let i=0;i<2;i++) await page.getByRole('button',{name:'继续对话',exact:true}).click();
await page.evaluate(()=>{const s=window.__embers.game.scene.getScene('battle'),original=s.resolvePlayerCombat; s.resolvePlayerCombat=function(a,b){const random=Math.random;try{Math.random=()=>.5;return original.call(this,a,b);}finally{Math.random=random;this.resolvePlayerCombat=original;}};});
await page.locator('#confirm-combat').click(); await page.locator('#map-stage-skip').click(); await page.locator('.chapter-summary').waitFor();
const summary=await page.locator('.chapter-summary').innerText(); assert(summary.includes('月影峡道'));
await page.locator('#again').click(); await page.waitForFunction(()=>window.__embers.game.scene.isActive('world'));
assert.equal(await page.locator('.hd-render-host').count(),0);
return {healed,secondChapterEnemyTurn:2,saveReloadAndRollback:true,defeatToPreparation:true,secondChapterVictoryToWorld:true,summary,errors:(await page.pageErrors()).map(e=>e.stack)};
