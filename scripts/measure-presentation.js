// tabbit-cli nodejs stdin, isolated QA origin only. qaQuality / qaMode are optional task-local inputs.
assert(page.url().startsWith('http://hd2d-render-qa.localhost:4174/'));
const quality = globalThis.qaQuality ?? 'medium', mode = globalThis.qaMode ?? 'idle';
await page.evaluate(({ quality, mode }) => {
  const s = window.__embers.game.scene.getScene('battle'), host = s.renderHost, r = host.renderer;
  host.configure({ quality, dof: quality === 'high', timeOfDay: 'map', weather: 'clear', reducedMotion: false });
  r.cameraRig.reset();
  const gl = r.gl.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const original = r.update, camera = r.cameraRig.capture(), pending = [], cpu = [], gpu = [];
  const started = performance.now(); let measuring = false, hiddenFrames = 0;
  window.__qaPerformance = { started, done: false };
  r.update = function(delta) {
    const elapsed = performance.now() - started;
    if (!measuring && elapsed >= 10000) { measuring = true; host.startMeasurement(); }
    if (mode === 'camera') {
      r.cameraRig.target.x = Math.sin(elapsed / 2700) * 1.8;
      r.cameraRig.target.z = Math.cos(elapsed / 3500) * .8; r.cameraRig.apply();
    }
    const disjoint = ext && gl.getParameter(ext.GPU_DISJOINT_EXT);
    while (pending.length && (disjoint || gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE))) {
      const query = pending.shift();
      if (!disjoint) gpu.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(query);
    }
    const query = measuring && ext && !disjoint && pending.length < 8 ? gl.createQuery() : null;
    if (query) gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
    const start = performance.now(); original.call(r, delta);
    if (measuring) { cpu.push(performance.now() - start); if (document.hidden) hiddenFrames++; }
    if (query) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(query); }
    if (elapsed >= 70000) {
      r.update = original; r.cameraRig.restore(camera); pending.forEach(q => gl.deleteQuery(q));
      const percentiles = values => { values.sort((a,b)=>a-b); return { samples: values.length, p95: values[Math.floor(values.length*.95)] ?? null, p99: values[Math.floor(values.length*.99)] ?? null }; };
      const debug = host.debug();
      window.__qaPerformance = { done: true, quality, mode, warmupMs: 10000, sampleMs: elapsed - 10000,
        viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio, internalRatio: r.gl.getPixelRatio() },
        map: s.chapterId, units: s.units.filter(u=>u.hp>0).length, hiddenFrames,
        frames: { samples: debug.samples, p95: debug.p95, p99: debug.p99 }, cpu: percentiles(cpu), gpu: percentiles(gpu),
        gpuTimerSupported: !!ext, calls: debug.calls, triangles: debug.triangles, resources: debug.resources };
    }
  };
  if (mode === 'combat') {
    const before = structuredClone(s.units), a = s.units.find(u=>u.id==='kael'), b = s.units.find(u=>u.id==='c2boss');
    Object.assign(a,{x:7,y:0}); s.mode='locked'; s.animationSpeed=2;
    void (async()=>{
      let battles=0;
      while (!window.__qaPerformance.done) {
        a.hp=a.stats.maxHp; b.hp=b.stats.maxHp; s.present();
        await s.playStageCombat(a,b,a); battles++;
      }
      s.units.forEach(u=>Object.assign(u,before.find(old=>old.id===u.id)));
      s.mode='idle'; s.refreshHud(); window.__qaPerformance.battles=battles; window.__qaPerformance.combatFinished=true;
    })();
  }
}, { quality, mode });
await page.waitForFunction(() => window.__qaPerformance.done, null, { timeout: 85000 });
if (mode === 'combat') await page.waitForFunction(()=>window.__qaPerformance.combatFinished);
const report = await page.evaluate(() => window.__qaPerformance);
assert.equal(report.hiddenFrames, 0);
const path = artifactPath(`performance-${quality}-${mode}.json`);
await (await import('node:fs/promises')).writeFile(path, JSON.stringify(report, null, 2));
return { path, report, errors: (await page.pageErrors()).map(e=>e.stack) };
