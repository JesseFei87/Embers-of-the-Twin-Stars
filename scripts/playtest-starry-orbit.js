// Run only on the isolated QA origin; player saves are untouched.
assert.equal(new URL(page.url()).origin, 'http://replica-check.localhost:4174');
await page.setViewportSize({width:1349,height:909});
await page.evaluate(async()=>{const fixture=await(await fetch('/docs/hd2d-evidence/starfall-bridge-fixture.json')).json();localStorage.setItem('embers-of-the-twin-stars-campaign-v2',JSON.stringify(fixture));localStorage.removeItem('embers-battle-staging-v1');const key='embers-display-settings-v1',s=JSON.parse(localStorage.getItem(key)||'{}');s.timeOfDay='map';localStorage.setItem(key,JSON.stringify(s));});
await page.reload();await page.locator('#continue').click();await page.waitForFunction(()=>window.__embers.game.scene.getScene('battle').renderHost?.enabled);
const select=async id=>{const p=await page.evaluate(id=>{const s=window.__embers.game.scene.getScene('battle'),u=s.units.find(u=>u.id===id);return s.renderHost.debug().points.find(p=>p.id===`${u.x},${u.y}`)},id);await page.mouse.click(p.x,p.y);};
for(const id of ['kael','lyra','mira']){await select(id);await expect(page.locator('.battle-portrait')).toBeVisible();assert((await page.locator('.battle-portrait').getAttribute('src')).includes(id));}
const box=await page.locator('#minimap-focus').boundingBox();assert(box.width>=170);
const before=await page.evaluate(()=>window.__embers.game.scene.getScene('battle').renderHost.renderer.cameraRig.capture());
await page.mouse.move(600,350);await page.mouse.down({button:'right'});await page.mouse.move(740,350,{steps:14});await page.mouse.up({button:'right'});
const after=await page.evaluate(()=>window.__embers.game.scene.getScene('battle').renderHost.renderer.cameraRig.capture());assert.notEqual(JSON.stringify(before.offset),JSON.stringify(after.offset));assert.equal(await page.evaluate(()=>window.__embers.game.scene.getScene('battle').selected.id),'mira');
await page.locator('#camera-orbit').click();await expect(page.locator('#camera-orbit')).toHaveAttribute('aria-pressed','true');await page.mouse.move(650,350);await page.mouse.down();await page.mouse.move(520,350,{steps:14});await page.mouse.up();await page.locator('#camera-orbit').click();
await page.setViewportSize({width:390,height:844});const portrait=await page.locator('.battle-portrait').boundingBox(),card=await page.locator('.unit-card').boundingBox();assert(portrait.x>=0&&portrait.x+portrait.width<=card.x);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
const errors=(await page.pageErrors()).map(e=>e.message);assert.equal(errors.length,0);
return {portraits:true,enlargedMinimap:true,rightOrbit:true,dragDoesNotSelect:true,orbitToggle:true,mobileLayout:true,errors};
