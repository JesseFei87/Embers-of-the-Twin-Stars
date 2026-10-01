// Development fault injection on the isolated QA origin; no player-origin writes.
assert(page.url().startsWith('http://hd2d-render-qa.localhost:4174/'));
await page.goto('http://hd2d-render-qa.localhost:4174/?renderer=three');
await page.evaluate(async()=>{const f=await(await fetch('/docs/hd2d-evidence/starfall-bridge-fixture.json')).json();f.battleUnits.find(u=>u.id==='kael').y=5;localStorage.setItem('embers-of-the-twin-stars-campaign-v2',JSON.stringify(f));});
await page.reload(); await page.locator('#continue').click(); await page.waitForFunction(()=>window.__embers.game.scene.getScene('battle').renderHost?.enabled);
async function startCombat() {
  await page.evaluate(()=>{
    const s=window.__embers.game.scene.getScene('battle'), a=s.units.find(u=>u.id==='kael'),b=s.units.find(u=>u.id==='e4');
    s.renderHost.configure({mapCombat:true,reducedMotion:false});s.mode='locked';s.animationSpeed=1;
    const random=Math.random;let playing;try{Math.random=()=>.5;playing=s.playStageCombat(a,b,a);}finally{Math.random=random;}
    window.__qaRecovery={done:false};playing.then(timeline=>{window.__qaRecovery={done:true,timeline,hp:{kael:a.hp,e4:b.hp}};s.mode='idle';s.refreshHud();});
  });
  await page.locator('#map-stage-skip').waitFor();
}
const checkpoint=await page.evaluate(()=>JSON.stringify(window.__embers.game.scene.getScene('battle').units));
await startCombat(); await page.setViewportSize({width:390,height:844});
await page.waitForFunction(()=>window.__qaRecovery.done);
const resized=await page.evaluate(()=>window.__qaRecovery);assert.equal(JSON.stringify(resized.hp),JSON.stringify(resized.timeline.finalHp));
assert(await page.evaluate(()=>{const s=window.__embers.game.scene.getScene('battle');return !s.renderHost.renderer.combat.busy&&s.renderHost.debug().points.every(p=>p.x>0&&p.x<innerWidth);}));
await page.setViewportSize({width:1461,height:907});
await startCombat(); await page.reload(); await page.locator('#continue').click(); await page.waitForFunction(()=>window.__embers.game.scene.getScene('battle').renderHost?.enabled);
assert.equal(await page.evaluate(()=>JSON.stringify(window.__embers.game.scene.getScene('battle').units)),checkpoint);
await startCombat(); await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange'))); await page.waitForFunction(()=>window.__qaRecovery.done);
const resumed=await page.evaluate(()=>window.__qaRecovery);assert.equal(JSON.stringify(resumed.hp),JSON.stringify(resumed.timeline.finalHp));
const before=await page.evaluate(()=>JSON.stringify(window.__embers.game.scene.getScene('battle').units));
await page.locator('#render-toggle').click();
await page.route('**/assets/hd2d/sword/01.png',route=>route.abort());
try {
  await page.locator('#render-toggle').click();
  await page.waitForFunction(()=>{const h=window.__embers.game.scene.getScene('battle').renderHost;return !h.loading&&!h.enabled;});
  assert.equal(await page.locator('.hd-render-host').count(),0);
  assert.equal(await page.evaluate(()=>JSON.stringify(window.__embers.game.scene.getScene('battle').units)),before);
} finally { await page.unroute('**/assets/hd2d/sword/01.png'); }
await page.locator('#render-toggle').click(); await page.waitForFunction(()=>window.__embers.game.scene.getScene('battle').renderHost?.enabled);
return {resizeDuringCombat:resized.hp,reloadRestoresExistingCheckpoint:true,visibilityHandler:resumed.hp,missingTextureFallback:true,reenabled:true,errors:(await page.pageErrors()).map(e=>e.stack)};
