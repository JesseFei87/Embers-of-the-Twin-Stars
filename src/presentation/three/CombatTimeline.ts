import * as THREE from 'three';
import { PresentationClock } from '../CombatPlayback';
import type { StrikeView } from '../contracts';
import type { DisplaySettings } from '../DisplaySettings';
import { combatVisual } from '../visual-config/combatVisuals';
import type { AssetRegistry } from './AssetRegistry';
import type { TacticalCamera } from './TacticalCamera';
import type { UnitSpriteView } from './UnitSpriteView';

export class CombatTimeline {
  readonly clock = new PresentationClock();
  readonly holds = new Set<string>();
  private saved?: ReturnType<TacticalCamera['capture']>;
  private effect: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private slash: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  private burst: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private lastSequence = 0;
  private sceneKey = '';
  private active = false;
  private generation = 0;
  private impactTime = 0;
  private message = document.createElement('div');
  constructor(private camera: TacticalCamera, private units: Map<string, UnitSpriteView>, scene: THREE.Scene, assets: AssetRegistry, labels: HTMLElement, private settings: () => DisplaySettings) {
    this.effect = new THREE.Mesh(assets.own(new THREE.SphereGeometry(.09, 10, 6)), assets.own(new THREE.MeshBasicMaterial({ color: 0xffb974, toneMapped: false })));
    this.slash = new THREE.Mesh(assets.own(new THREE.TorusGeometry(.42, .022, 4, 24, Math.PI * 1.4)), assets.own(new THREE.MeshBasicMaterial({ color: 0xffe2b0, transparent: true, depthWrite: false, toneMapped: false })));
    const geometry = assets.own(new THREE.BufferGeometry()); geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(32 * 3), 3));
    this.burst = new THREE.Points(geometry, assets.own(new THREE.PointsMaterial({ color: 0xffe6bf, size: .055, transparent: true, depthWrite: false, toneMapped: false })));
    this.burst.frustumCulled = false;
    this.effect.visible = this.slash.visible = this.burst.visible = false;
    scene.add(this.effect, this.slash, this.burst); this.message.className = 'hd-impact-text'; labels.append(this.message);
  }
  get busy() { return this.active; }
  async begin(sceneKey: string, ids: readonly string[]) {
    this.cancel();
    if (sceneKey !== this.sceneKey) { this.lastSequence = 0; this.sceneKey = sceneKey; }
    this.active = true; ids.forEach(id => this.holds.add(id)); this.saved = this.camera.capture();
    const [a, b] = ids.map(id => this.units.get(id));
    if (a && b && !this.settings().reducedMotion) await this.clock.play(.3, t => this.camera.cinematic(a.data.feet, b.data.feet, t * t * (3 - 2 * t), this.saved!));
  }
  async windup(event: StrikeView) {
    if (!this.active || event.sceneKey !== this.sceneKey || event.sequence <= this.lastSequence) return false;
    const generation = this.generation;
    this.lastSequence = event.sequence;
    const source = this.units.get(event.sourceId), target = this.units.get(event.targetId); if (!source || !target) return false;
    const visual = combatVisual(event), from = new THREE.Vector3().copy(source.data.feet), to = new THREE.Vector3().copy(target.data.feet);
    source.face(to.x < from.x); target.face(to.x >= from.x); source.pose(3); this.message.textContent = '';
    this.effect.material.color.setHex(visual.color); this.slash.material.color.setHex(visual.color); this.burst.material.color.setHex(visual.color);
    const reduced = this.settings().reducedMotion;
    let finished = await this.clock.play(reduced ? .08 : visual.windup, t => { if (!reduced) source.body.rotation.z = Math.sin(t * Math.PI) * -.07; });
    if (!finished || !this.active || generation !== this.generation) return false;
    source.pose(4);
    finished = await this.clock.play(reduced ? .08 : visual.travel, t => {
      if (reduced) return;
      if (event.magical) {
        this.effect.visible = true; this.effect.position.copy(from).lerp(to, t); this.effect.position.y += .6 + Math.sin(t * Math.PI) * (visual.style === 'lightning' ? .04 : .4);
        this.effect.scale.set(visual.style === 'lightning' ? .6 : 1.2, visual.style === 'lightning' ? 3.5 : 1.2, 1.2);
      } else source.group.position.copy(from).lerp(to, t * visual.approach);
      if (!event.hit && t > .6) target.body.position.x = (t - .6) * .55;
    });
    return finished && generation === this.generation;
  }
  async impact(event: StrikeView) {
    if (!this.active) return;
    const generation = this.generation;
    const source = this.units.get(event.sourceId), target = this.units.get(event.targetId); if (!source || !target) return;
    const settings = this.settings(), visual = combatVisual(event);
    const from = source.group.position.clone(), destination = new THREE.Vector3().copy(source.data.feet);
    const impact = target.group.position.clone().add(new THREE.Vector3(0, .65, 0));
    this.effect.visible = false;
    this.message.textContent = event.hit ? `${event.critical ? '必杀 ' : ''}−${event.damage}` : 'MISS';
    this.message.dataset.kind = event.hit ? 'hit' : 'miss';
    const p = impact.clone().project(this.camera.camera);
    this.message.style.left = `${(p.x + 1) * 50}%`; this.message.style.top = `${(1 - p.y) * 50}%`; this.message.style.opacity = '1';
    this.slash.position.copy(impact); this.slash.lookAt(this.camera.camera.position); this.slash.rotation.z = event.magical ? 0 : -.6;
    this.slash.scale.setScalar(event.critical ? 1.45 : 1);
    this.slash.visible = event.hit && settings.flashes && !settings.reducedMotion;
    this.slash.material.opacity = .8;
    this.burst.visible = event.hit && settings.particles && settings.flashes && !settings.reducedMotion;
    this.burst.position.copy(impact);
    if (event.hit && settings.flashes && !settings.reducedMotion) target.body.material.color.setHex(0xffb3ae);
    // Local hit stop leaves the application, input and save APIs running.
    if (event.hit && !settings.reducedMotion) await this.clock.play(event.critical ? .075 : .045);
    if (!this.active || generation !== this.generation) return;
    source.pose(5);
    await this.clock.play(settings.reducedMotion ? .15 : visual.recovery, t => {
      source.group.position.copy(from).lerp(destination, t); source.body.rotation.z *= 1 - t;
      target.body.position.x *= 1 - t;
      if (event.hit && settings.shake && !settings.reducedMotion) this.camera.shake((event.critical ? .045 : .018) * (1 - t), this.impactTime);
      this.slash.material.opacity = .8 * (1 - t); this.slash.scale.setScalar((event.critical ? 1.45 : 1) + t * .5);
      const positions = this.burst.geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++) { const angle = i * 2.399; positions.setXYZ(i, Math.cos(angle) * t * .8, Math.sin(i * 7) * t * .6 - t * t * .3, Math.sin(angle) * t * .8); }
      positions.needsUpdate = true; this.burst.material.opacity = 1 - t;
      this.message.style.opacity = `${1 - t * .55}`;
      if (event.hit && event.hpAfter <= 0) target.body.scale.y = 1 - t * .75;
    });
    if (!this.active || generation !== this.generation) return;
    source.pose(0); source.group.position.copy(source.data.feet); target.body.material.color.setHex(target.data.acted ? 0xaeb9bf : 0xffffff);
    if (event.hpAfter <= 0) { target.group.visible = false; target.label.hidden = true; this.holds.delete(target.data.id); }
    this.clearEffects(); this.camera.apply();
  }
  async end() {
    const generation = this.generation;
    if (this.saved && !this.settings().reducedMotion) {
      const from = this.camera.capture(), saved = this.saved;
      await this.clock.play(.3, t => this.camera.restore({ offset: saved.offset, target: from.target.clone().lerp(saved.target, t), distance: THREE.MathUtils.lerp(from.distance, saved.distance, t) }));
    }
    if (generation === this.generation) this.cancel();
  }
  update(delta: number, speed: number) { this.impactTime += delta; this.clock.update(delta, speed); }
  private clearEffects() { this.effect.visible = this.slash.visible = this.burst.visible = false; this.message.style.opacity = '0'; }
  cancel() {
    ++this.generation; this.clock.cancel(); this.active = false; this.holds.clear(); this.clearEffects();
    if (this.saved) this.camera.restore(this.saved); this.saved = undefined;
    for (const view of this.units.values()) { view.body.position.set(0, 0, 0); view.body.rotation.z = 0; view.body.scale.y = 1; view.pose(0); view.sync(view.data); }
  }
}
