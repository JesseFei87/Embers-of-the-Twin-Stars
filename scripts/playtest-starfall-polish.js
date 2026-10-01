// Tabbit browser QA, on the isolated origin only. Fixtures never touch player saves.
assert.equal(new URL(page.url()).origin, 'http://replica-check.localhost:4174');
const fixture = await page.evaluate(async () => (await fetch('/docs/hd2d-evidence/starfall-bridge-fixture.json')).json());
const ready = async () => page.waitForFunction(() => window.__embers.game.scene.getScene('battle').renderHost?.enabled);
const tile = async id => {
  const point = await page.evaluate(id => window.__embers.game.scene.getScene('battle').renderHost.debug().points.find(p => p.id === id), id);
  assert(point); await page.mouse.click(point.x, point.y);
};
await page.evaluate(f => localStorage.setItem('embers-of-the-twin-stars-campaign-v2', JSON.stringify(f)), fixture);
await page.setViewportSize({ width: 390, height: 844 }); await page.reload(); await page.locator('#continue').click(); await ready();
await tile('3,7'); await tile('3,5'); await page.waitForFunction(() => window.__embers.game.scene.getScene('battle').mode === 'command');
await page.locator('#cancel-move').click(); assert.equal(await page.evaluate(() => window.__embers.game.scene.getScene('battle').units.find(u => u.id === 'kael').y), 7);
await tile('3,5'); await page.waitForFunction(() => window.__embers.game.scene.getScene('battle').mode === 'command');
await page.locator('#fight').click(); await tile('3,4'); await page.locator('#confirm-combat').click();
await page.waitForFunction(() => window.__embers.game.scene.getScene('battle').mode === 'idle', null, { timeout: 30000 });
const state = await page.evaluate(() => JSON.stringify(window.__embers.game.scene.getScene('battle').units));
const settings = [];
for (const quality of ['low', 'medium', 'high']) {
  for (const time of ['day', 'night']) {
    await page.locator('#battle-menu').click(); await page.locator('[data-battle-menu=system]').click(); await page.locator('#render-quality').selectOption(quality); await page.locator('#render-time').selectOption(time); await page.locator('#render-settings-close').click();
    assert.equal(await page.evaluate(() => JSON.stringify(window.__embers.game.scene.getScene('battle').units)), state);
    settings.push({ quality, time, statePreserved: true });
  }
}
await page.locator('#battle-menu').click(); await page.locator('[data-battle-menu=system]').click(); await page.locator('#render-time').selectOption('day'); await page.locator('#render-quality').selectOption('medium'); await page.locator('[data-render-setting="reducedMotion"]').check(); await page.locator('#render-settings-close').click();
const frozen = await page.evaluate(async () => {
  const terrain = window.__embers.game.scene.getScene('battle').renderHost.renderer.terrain;
  const before = terrain.waterTime.value;
  for (let i = 0; i < 5; i++) await new Promise(requestAnimationFrame);
  return terrain.waterTime.value === before;
}); assert(frozen);
const picking = [];
for (const size of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  await page.setViewportSize(size);
  const failures = await page.evaluate(() => {
    const host = window.__embers.game.scene.getScene('battle').renderHost;
    host.resetCamera();
    return host.debug().points.filter(p => {
      const hit = host.renderer.pick(p.x, p.y);
      return (hit?.kind === 'unit' ? host.renderer.units.get(hit.unitId).data.tileId : hit?.tileId) !== p.id;
    }).map(p => p.id);
  }); assert.equal(failures.length, 0); picking.push({ ...size, failures });
}
await page.locator('#battle-menu').click(); await page.locator('[data-battle-menu=system]').click(); await page.locator('[data-render-setting="reducedMotion"]').uncheck(); await page.locator('#render-settings-close').click();
const errors = (await page.pageErrors()).map(e => e.message);
const shaderErrors = (await page.consoleMessages()).filter(m => m.type() === 'error').map(m => m.text());
assert.equal(errors.length, 0); assert.equal(shaderErrors.length, 0);
const report = { date: new Date().toISOString(), moveCancelAttack: true, settings, reducedMotionFreezesWater: frozen, picking, errors, shaderErrors };
const path = artifactPath('starfall-polish-report.json'); await (await import('node:fs/promises')).writeFile(path, JSON.stringify(report, null, 2));
return { path, ...report };
