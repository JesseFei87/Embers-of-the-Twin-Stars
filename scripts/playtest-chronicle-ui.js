// Tabbit CLI only; the dedicated QA origin keeps real campaign saves untouched.
assert(page.url().startsWith('http://starfall-check.localhost:4174/'));
await page.setViewportSize({width:1440,height:900});await page.reload();await page.locator('#start').click();
if(await page.locator('#new-confirm').count())await page.locator('#new-confirm').click();
await page.locator('.dialogue').waitFor();
const motion=await page.locator('.dialogue').evaluate(el=>({unfurl:el.dataset.unfurl,animation:getComputedStyle(el).animationName,rod:getComputedStyle(el,'::after').animationName}));
assert.equal(motion.animation,'chronicle-unfurl');assert.equal(motion.rod,'chronicle-spindle');
await page.getByRole('button',{name:'继续对话',exact:true}).press('Enter');
await page.waitForFunction(()=>document.querySelector('.speaker')?.textContent==='莱拉');
const portrait=await page.locator('.portrait').evaluate(el=>getComputedStyle(el).backgroundImage);assert(portrait.includes('/chronicle/portraits/lyra.png'));
await page.getByRole('button',{name:'继续对话',exact:true}).press('Enter');await page.getByRole('button',{name:'继续对话',exact:true}).press('Enter');
await page.locator('[data-world-node="starfall-bridge"]').click();await page.waitForFunction(()=>document.querySelector('#world-enter')&&!document.querySelector('#world-enter').disabled,null,{timeout:20000});await page.locator('#world-enter').click();
for(let i=0;i<10;i++){await page.waitForFunction(()=>document.querySelector('.dialogue,.prep-screen'));if(await page.locator('.prep-screen').count())break;await page.getByRole('button',{name:'继续对话',exact:true}).press('Enter');}
await page.locator('.prep-screen').waitFor();await page.locator('[data-inspect="lyra"]').click();assert((await page.locator('.dossier-cover').evaluate(el=>getComputedStyle(el).backgroundImage)).includes('/lyra.png'));
await page.locator('#start-battle').click();await page.waitForFunction(()=>window.__embers.game.scene.getScene('battle').renderHost?.enabled);
await page.locator('#render-settings').click();await page.locator('[data-render-setting="reducedMotion"]').check();await page.locator('#render-settings-close').click();await page.locator('#render-settings').click();
const reduced=await page.locator('.render-settings').evaluate(el=>getComputedStyle(el).animationName);assert.equal(reduced,'none');
await page.locator('[data-render-setting="reducedMotion"]').uncheck();await page.locator('#render-settings-close').click();
await page.setViewportSize({width:390,height:844});const p=await page.evaluate(()=>window.__embers.game.scene.getScene('battle').renderHost.debug().points.find(p=>p.id==='4,7'));await page.mouse.click(p.x,p.y);await page.locator('#detail').click();
const detail=await page.locator('.detail-card').evaluate(el=>({width:el.getBoundingClientRect().width,unfurl:el.dataset.unfurl,numberColor:getComputedStyle(el.querySelector('.detail-stats b')).color}));assert(detail.width<=390);assert.equal(detail.numberColor,'rgb(75, 65, 46)');
await page.locator('#detail-close').click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
globalThis.chronicleResults={motion,portrait,reduced,detail,keyboardDialogue:true,worldTravel:true,preparationLaunch:true,mobile390:true,errors:(await page.pageErrors()).map(e=>e.stack)};
const path=artifactPath('chronicle-final-report.json');await(await import('node:fs/promises')).writeFile(path,JSON.stringify({ui:globalThis.chronicleResults,animation:globalThis.animationResults,combat:globalThis.starfallResults},null,2));return {path,...globalThis.chronicleResults};
