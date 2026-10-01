import { paperSheet, paperTitle, paperMessage, paperButton } from '../game/ui/parchment';
import { readDisplaySettings, saveDisplaySettings, type DisplaySettings } from './DisplaySettings';
import type { MovementEvent, StrikeView, PickResult, RenderSnapshot } from './contracts';
import type { ThreeTacticalRenderer } from './three/ThreeTacticalRenderer';
import { mapVisuals } from './visual-config/maps';

export class RenderHost {
  private renderer?: ThreeTacticalRenderer;
  private mounting?: ThreeTacticalRenderer;
  private element?: HTMLDivElement;
  private status?: HTMLDivElement;
  private generation = 0;
  private raf = 0;
  private lastTime = 0;
  private resizeObserver?: ResizeObserver;
  private cleanup: Array<() => void> = [];
  private frameTimes: number[] = [];
  private snapshot: RenderSnapshot;
  private gestures = new Map<number, { x: number; y: number }>();
  private dragged = false;
  private dragDistance = 0;
  rotateView = false;
  private hovered = '';
  settings = readDisplaySettings();
  enabled = false;
  loading = false;
  constructor(initial: RenderSnapshot, private select: (pick: PickResult) => void, private changed: (enabled: boolean, message?: string) => void, private hover?: (pick: PickResult) => void) { this.snapshot = initial; }
  async enable() {
    if (this.enabled || this.loading || !(this.snapshot.mapId in mapVisuals)) return;
    this.loading = true; const generation = ++this.generation;
    this.showStatus('正在加载 3D 场景…');
    this.changed(false, '正在加载 3D 场景…');
    let renderer: ThreeTacticalRenderer | undefined;
    try {
      const module = await import('./three/ThreeTacticalRenderer');
      if (generation !== this.generation) return;
      renderer = new module.ThreeTacticalRenderer(reason => this.disable(reason)); this.mounting = renderer;
      const element = document.createElement('div'); element.className = 'hd-render-host'; element.setAttribute('aria-label', '三维战棋场景');
      this.element = element;
      await Promise.race([renderer.mount(element, this.snapshot), new Promise<never>((_, reject) => {
        const timeout = window.setTimeout(() => reject(new Error('3D 资源加载超时')), 45000);
        this.cleanup.push(() => window.clearTimeout(timeout));
      })]);
      if (generation !== this.generation) { renderer.dispose(); return; }
      this.renderer = renderer; this.mounting = undefined; this.loading = false; this.enabled = true;
      this.status?.remove(); this.status=undefined;
      document.querySelector('#game')!.append(element);
      renderer.reset(this.snapshot); renderer.configure(this.settings);
      this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(element);
      this.resize(); renderer.cameraRig.reset();
      this.bindInput(element); this.lastTime = 0; this.raf = requestAnimationFrame(this.tick);
      this.changed(true);
    } catch (error) {
      renderer?.dispose(); if (generation === this.generation) this.disable(`3D 场景加载失败：${error instanceof Error ? error.message : '请重试'}`);
    }
  }
  present(snapshot: RenderSnapshot, events: readonly MovementEvent[] = []) { this.snapshot = snapshot; this.renderer?.present(snapshot, events); }
  private resize() { const rect = this.element?.getBoundingClientRect(); if (rect?.width && rect.height) this.renderer?.resize(rect.width, rect.height, window.devicePixelRatio); }
  private tick = (time: number) => {
    if (!this.enabled) return;
    const delta = this.lastTime ? Math.min((time - this.lastTime) / 1000, .05) : 0;
    if (this.lastTime && this.frameTimes.length < 12000) this.frameTimes.push(time - this.lastTime);
    this.lastTime = time;
    try { this.renderer?.update(delta); } catch (error) { this.disable(`3D 画面恢复失败：${String(error)}`); return; }
    this.raf = requestAnimationFrame(this.tick);
  };
  private bindInput(element: HTMLElement) {
    const on = <K extends keyof HTMLElementEventMap>(type: K, handler: (event: HTMLElementEventMap[K]) => void, options?: AddEventListenerOptions) => {
      element.addEventListener(type, handler, options); this.cleanup.push(() => element.removeEventListener(type, handler, options));
    };
    let rightDrag: { x: number; y: number } | undefined;
    on('contextmenu', event => event.preventDefault());
    on('pointerdown', event => { this.dragDistance = 0; element.setPointerCapture(event.pointerId); this.gestures.set(event.pointerId, { x: event.clientX, y: event.clientY }); this.dragged = this.gestures.size > 1 || event.button !== 0; });
    on('pointermove', event => {
      if (this.renderer?.combat?.busy) return;
      if (event.buttons === 2) {
        if (rightDrag) this.renderer?.cameraRig.rotate(event.clientX - rightDrag.x, event.clientY - rightDrag.y);
        rightDrag = { x:event.clientX, y:event.clientY }; this.dragged = true; return;
      }
      rightDrag = undefined;
      const before = this.gestures.get(event.pointerId);
      if (!before) {
        const pick = this.renderer?.pick(event.clientX, event.clientY) ?? null;
        const key = JSON.stringify(pick);
        if (key !== this.hovered) { this.hovered = key; this.hover?.(pick); }
        return;
      }
      const dx = event.clientX - before.x, dy = event.clientY - before.y;
      this.dragDistance += Math.hypot(dx, dy);
      if (this.dragDistance > 3) this.dragged = true;
      if (this.gestures.size > 1) {
        const other = [...this.gestures.entries()].find(([id]) => id !== event.pointerId)![1];
        const oldDistance = Math.hypot(before.x - other.x, before.y - other.y), newDistance = Math.hypot(event.clientX - other.x, event.clientY - other.y);
        this.renderer?.cameraRig.zoom((oldDistance - newDistance) * 3); this.renderer?.cameraRig.pan(-dx / 2, -dy / 2);
      } else if (this.dragged) {
        if (this.rotateView || event.shiftKey) this.renderer?.cameraRig.rotate(dx, dy);
        else this.renderer?.cameraRig.pan(-dx, -dy);
      }
      this.gestures.set(event.pointerId, { x: event.clientX, y: event.clientY });
    });
    on('pointerup', event => { rightDrag = undefined; const click = !this.dragged && event.button === 0 && !this.renderer?.combat?.busy && this.gestures.size === 1; this.gestures.delete(event.pointerId); if (click) this.select(this.renderer?.pick(event.clientX, event.clientY) ?? null); });
    on('pointercancel', event => { this.gestures.delete(event.pointerId); this.dragged = true; });
    on('wheel', event => { event.preventDefault(); if (!this.renderer?.combat?.busy) this.renderer?.cameraRig.zoom(event.deltaY); }, { passive: false });
    const visibility = () => {
      cancelAnimationFrame(this.raf); this.lastTime = 0;
      if (!document.hidden && this.enabled) { this.renderer?.skipPresentation(); this.raf = requestAnimationFrame(this.tick); }
    };
    document.addEventListener('visibilitychange', visibility); this.cleanup.push(() => document.removeEventListener('visibilitychange', visibility));
  }
  pose(unitId: string, frame: number) { this.renderer?.pose(unitId, frame); }
  feedback(unitId: string, message: string, color: string) { this.renderer?.feedback(unitId, message, color); }
  beginCombat(ids: readonly string[]) { return this.renderer?.combat.begin(this.snapshot.sceneKey, ids) ?? Promise.resolve(); }
  windup(event: StrikeView) { return this.renderer?.combat.windup(event) ?? Promise.resolve(false); }
  impact(event: StrikeView) { return this.renderer?.combat.impact(event) ?? Promise.resolve(); }
  combatDelay(seconds: number) { return this.renderer?.combat.clock.play(seconds) ?? Promise.resolve(false); }
  endCombat() { return this.renderer?.combat.end() ?? Promise.resolve(); }
  setCombatSpeed(speed: number) { if (this.renderer) this.renderer.combatSpeed = speed; }
  skipPresentation() { this.renderer?.skipPresentation(); }
  configure(changes: Partial<DisplaySettings>) { this.settings = { ...this.settings, ...changes }; saveDisplaySettings(this.settings); this.renderer?.configure(this.settings); this.resize(); }
  focus() { const unit = this.snapshot.units.find(unit => unit.id === this.snapshot.selectedUnitId); if (unit) this.renderer?.cameraRig.focus(unit.feet); }
  resetCamera() { this.renderer?.cameraRig.reset(); }
  debug() {
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    return { quality: this.settings.quality, settings: { ...this.settings }, enabled: this.enabled, samples: sorted.length, p95: sorted[Math.floor(sorted.length * .95)], p99: sorted[Math.floor(sorted.length * .99)],
      calls: this.renderer?.gl.info.render.calls, triangles: this.renderer?.gl.info.render.triangles,
      resources: this.renderer ? { ...this.renderer.gl.info.memory } : null, sceneKey: this.snapshot.sceneKey,
      points: this.snapshot.tiles.map(tile => {
        // Projection is provided only as a read-only diagnostic by the development entry.
        const camera = this.renderer?.cameraRig.camera;
        if (!camera || !this.element) return null;
        const e = camera.matrixWorldInverse.elements, p = camera.projectionMatrix.elements;
        const { x, y, z } = tile.center;
        const cx = e[0]*x + e[4]*y + e[8]*z + e[12], cy = e[1]*x + e[5]*y + e[9]*z + e[13], cz = e[2]*x + e[6]*y + e[10]*z + e[14];
        const rect = this.element.getBoundingClientRect();
        return { id: tile.id, x: rect.left + (cx * p[0] / -cz + 1) * rect.width / 2, y: rect.top + (1 - cy * p[5] / -cz) * rect.height / 2 };
      }) };
  }
  startMeasurement() { this.frameTimes = []; }
  private showStatus(message: string, retry = false) {
    this.status?.remove();
    const panel=document.createElement('div'); panel.className='render-status'; panel.setAttribute('role','alert');
    panel.innerHTML = paperSheet(`${paperTitle(retry ? '战场暂未展开' : '铺展开眼前的战场', 'EXPEDITION STATUS')}<p data-status-message></p>${paperMessage('战斗进度已保留。' + (retry ? '请重新加载 3D 场景。' : '正在准备场景与角色。'))}`, retry ? paperButton('重新加载 3D 场景', 'render-retry', true) : '');
    panel.querySelector('[data-status-message]')!.textContent = message;
    panel.querySelector('#render-retry')?.addEventListener('click', () => void this.enable());
    document.body.append(panel); this.status=panel;
  }
  disable(message?: string) {
    ++this.generation; this.loading = false; this.enabled = false;
    cancelAnimationFrame(this.raf); this.raf = 0;
    this.cleanup.splice(0).forEach(fn => fn()); this.resizeObserver?.disconnect(); this.resizeObserver = undefined; this.gestures.clear();
    this.renderer?.dispose(); this.mounting?.dispose(); this.renderer = this.mounting = undefined; this.element?.remove(); this.element = undefined;
    this.status?.remove(); this.status=undefined;
    if(message) this.showStatus(message,true);
    this.changed(false, message);
  }
  dispose() { this.disable(); }
}
