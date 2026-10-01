// Run with tabbit-cli nodejs stdin on the isolated QA origin. This file is not shipped.
assert(page.url().startsWith('http://hd2d-render-qa.localhost:4174/'));
if (await page.locator('#continue').count()) { await page.locator('#continue').click(); await page.getByRole('button', { name: '返回经典画面', exact: true }).waitFor(); }
const fixture = await page.evaluate(async () => (await fetch('/docs/hd2d-evidence/starfall-bridge-fixture.json')).json());
const results = [];
for (const scenario of [
  { name: 'melee-hit-followup', unit: 'kael', roll: .5, distance: 1 },
  { name: 'melee-miss', unit: 'kael', roll: .9999, distance: 1 },
  { name: 'critical-death', unit: 'kael', roll: 0, distance: 1 },
  { name: 'mounted-spell-cost', unit: 'lyra', roll: .5, distance: 2 },
]) {
  const variants = [];
  for (const variant of ['classic', 'three-play', 'three-skip']) {
    const epoch = await page.evaluate(({ fixture, scenario }) => {
      const f = structuredClone(fixture), player = f.battleUnits.find(u => u.id === scenario.unit), enemy = f.battleUnits.find(u => u.id === 'e4');
      Object.assign(player, { x: 3, y: 4 + scenario.distance });
      if (scenario.name === 'mounted-spell-cost') { player.activeSpellId = 'starfire'; if (!player.spells.includes('starfire')) player.spells.push('starfire'); }
      if (scenario.name === 'critical-death') enemy.hp = 5;
      const s = window.__embers.game.scene.getScene('battle'), epoch = s.renderInstance;
      localStorage.setItem('embers-of-the-twin-stars-campaign-v2', JSON.stringify(f)); s.scene.restart(); return epoch;
    }, { fixture, scenario });
    await page.waitForFunction(epoch => { const s = window.__embers.game.scene.getScene('battle'); return s.renderInstance > epoch && s.renderHost?.enabled && s.renderHost.debug().samples >= 2; }, epoch);
    await page.evaluate(({ scenario, variant }) => {
      const s = window.__embers.game.scene.getScene('battle');
      s.renderHost.configure({ mapCombat: variant !== 'classic', reducedMotion: false, quality: 'medium', dof: false });
      s.animationSpeed = 2; s.mode = 'locked';
      const a = s.units.find(u => u.id === scenario.unit), b = s.units.find(u => u.id === 'e4');
      const saved = s.renderHost.renderer.cameraRig.capture();
      const random = Math.random;
      let promise;
      try { Math.random = () => scenario.roll; promise = s.playStageCombat(a, b, a); } finally { Math.random = random; }
      window.__qaCombat = { done: false, saved };
      promise.then(timeline => { window.__qaCombat = { done: true, timeline, saved, hp: { [a.id]: a.hp, [b.id]: b.hp } }; });
    }, { scenario, variant });
    if (variant === 'three-skip') await page.locator('#map-stage-skip').click();
    await page.waitForFunction(() => window.__qaCombat.done, null, { timeout: 20000 });
    const result = await page.evaluate(() => {
      const s = window.__embers.game.scene.getScene('battle'), r = s.renderHost.renderer, qa = window.__qaCombat;
      return { hp: qa.hp, timeline: qa.timeline, camera: r.cameraRig.capture(), savedCamera: qa.saved, busy: r.combat.busy, holds: r.combat.holds.size, effects: [r.combat.effect.visible, r.combat.slash.visible, r.combat.burst.visible] };
    });
    assert.deepEqual(result.hp, result.timeline.finalHp);
    assert.deepEqual(result.camera, result.savedCamera);
    assert.equal(result.busy, false); assert.equal(result.holds, 0); assert(result.effects.every(v => !v));
    if (scenario.name === 'mounted-spell-cost') assert(result.timeline.events.some(e => e.type === 'cost' && e.amount === 1));
    variants.push({ variant, ...result });
  }
  assert.deepEqual(variants[0].timeline, variants[1].timeline);
  assert.deepEqual(variants[1].timeline, variants[2].timeline);
  assert.deepEqual(variants[0].hp, variants[2].hp);
  results.push({ scenario: scenario.name, finalHp: variants[0].hp, events: variants[0].timeline.events.map(e => ({ type: e.type, hit: e.hit, critical: e.critical, followUp: e.followUp, damage: e.damage })), variantsAgree: true, cameraRestored: true });
}
const report = { results, errors: (await page.pageErrors()).map(e => e.stack) };
const path = artifactPath('p2-parity.json');
await (await import('node:fs/promises')).writeFile(path, JSON.stringify(report, null, 2));
return { path, ...report };
