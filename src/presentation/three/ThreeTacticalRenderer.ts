import * as THREE from 'three';
import type { MovementEvent, PickResult, RenderSnapshot, TacticalRenderer } from '../contracts';
import type { DisplaySettings } from '../DisplaySettings';
import { qualityProfiles } from '../DisplaySettings';
import { PostProcessing } from './PostProcessing';
import { EnvironmentView } from './EnvironmentView';
import { surfacePoint, visualFor } from '../visual-config/maps';
import { AssetRegistry } from './AssetRegistry';
import { TacticalCamera } from './TacticalCamera';
import { tileGeometry } from './TerrainView';
import { CombatTimeline } from './CombatTimeline';
import { StarfallEnvironment } from './StarfallEnvironment';
import { EncounterEnvironment } from './EncounterEnvironment';
import { MoonlitEnvironment } from './MoonlitEnvironment';
import { UnitSpriteView } from './UnitSpriteView';

export class ThreeTacticalRenderer implements TacticalRenderer {
  readonly scene = new THREE.Scene();
  readonly cameraRig = new TacticalCamera();
  readonly assets = new AssetRegistry();
  readonly units = new Map<string, UnitSpriteView>();
  readonly labels = document.createElement('div');
  readonly gl: THREE.WebGLRenderer;
  terrain!: StarfallEnvironment | MoonlitEnvironment | EncounterEnvironment;
  snapshot!: RenderSnapshot;
  combat!: CombatTimeline;
  combatSpeed = 1;
  private marks = new THREE.Group();
  private ray = new THREE.Raycaster();
  private width = 1;
  private height = 1;
  private disposed = false;
  private clock = 0;
  private settings!: DisplaySettings;
  private post?: PostProcessing;
  private environment!: EnvironmentView;
  private light!: THREE.DirectionalLight;
  private sky!: THREE.HemisphereLight;
  private feedbacks: Array<{ label: HTMLElement; unitId: string; age: number }> = [];
  private dpr = 1;
  private lastSequence = 0;
  private occlusionTime = 0;
  private occlusionBounds = new Map<THREE.Mesh, THREE.Box3>();
  private movement = new Map<string, { event: MovementEvent; elapsed: number }>();
  private markResources: Array<{ dispose(): void }> = [];
  constructor(private onFailure: (reason: string) => void) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!context) throw new Error('设备未能创建 WebGL2 场景');
    this.gl = new THREE.WebGLRenderer({ canvas, context, antialias: true });
    this.gl.outputColorSpace = THREE.SRGBColorSpace; this.gl.toneMapping = THREE.ACESFilmicToneMapping; this.gl.toneMappingExposure = 1.15;
    this.gl.shadowMap.enabled = true; this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.gl.info.autoReset = false;
    this.gl.domElement.addEventListener('webglcontextlost', this.contextLost);
  }
  private contextLost = (event: Event) => { event.preventDefault(); this.onFailure('3D 画面已中断，请重新加载场景'); };
  async mount(host: HTMLElement, initial: RenderSnapshot) {
    this.snapshot = initial;
    this.cameraRig.setMapSize(initial.cols, initial.rows);
    const preset = visualFor(initial.mapId);
    this.scene.background = new THREE.Color(preset.background);
    const sky = this.sky = new THREE.HemisphereLight(preset.sky, preset.ground, 2.3); this.scene.add(sky);
    const light = this.light = new THREE.DirectionalLight(preset.sun, 3.1); light.position.set(-5, 10, 4); light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024); Object.assign(light.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 26 });
    light.shadow.bias = -.0003; light.shadow.normalBias = .025; this.scene.add(light);
    this.assets.own(light.shadow);
    if (initial.mapId === 'starfall-bridge') {
      this.terrain = await StarfallEnvironment.create(initial, this.assets);
      if (this.disposed) return;
      this.cameraRig.setStarfall();
      light.position.set(-9,12.5,-4.375);
      Object.assign(light.shadow.camera,{ left: -13, right: 13, top: 13, bottom: -13, near: .1, far: 45 });
      light.shadow.camera.updateProjectionMatrix();
      this.gl.toneMappingExposure = 1.12;
    } else if (initial.mapId === 'moonlit-pass') {
      this.terrain = await MoonlitEnvironment.create(initial, this.assets);
      if (this.disposed) return;
      this.cameraRig.setMoonlit();
      light.position.set(-7.5,13,-7.5);
      Object.assign(light.shadow.camera,{left:-14,right:14,top:14,bottom:-14,near:.1,far:60});
      light.shadow.camera.updateProjectionMatrix();
      this.gl.toneMappingExposure=1.1;
    }
    if (initial.mapId === 'moss-hollow' || initial.mapId === 'tide-cove') {
      this.terrain = await EncounterEnvironment.create(initial, this.assets);
      if (this.disposed) return;
      this.cameraRig.setStarfall();
      light.position.set(-5, 12, 4); this.gl.toneMappingExposure = 1.1;
    }
    this.scene.add(this.terrain.group, this.marks);
    this.environment = new EnvironmentView(this.assets); this.scene.add(this.environment.group);
    await Promise.all(initial.units.map(async unit => {
      const view = await UnitSpriteView.create(unit, this.assets, true);
      if (this.disposed) { view.dispose(); return; }
      this.units.set(unit.id, view); this.scene.add(view.group); this.labels.append(view.label);
    }));
    if (this.disposed) return;
    this.labels.className = 'hd-unit-labels'; host.append(this.gl.domElement, this.labels);
    this.combat = new CombatTimeline(this.cameraRig, this.units, this.scene, this.assets, this.labels, () => this.settings);
    this.reset(this.snapshot); this.cameraRig.reset();
  }
  present(snapshot: RenderSnapshot, events: readonly MovementEvent[] = []) {
    if (snapshot.sceneKey !== this.snapshot.sceneKey) { this.reset(snapshot); return; }
    if (snapshot.revision < this.snapshot.revision) return;
    this.snapshot = snapshot;
    for (const event of events) {
      if (event.sceneKey !== snapshot.sceneKey || event.sequence <= this.lastSequence) continue;
      this.lastSequence = event.sequence; this.movement.set(event.unitId, { event, elapsed: 0 });
    }
    for (const unit of snapshot.units) {
      const view = this.units.get(unit.id);
      if (view) {
        view.sync(unit, !this.movement.has(unit.id) && !this.combat?.holds.has(unit.id));
        if (this.combat?.holds.has(unit.id)) { view.group.visible = true; view.label.hidden = false; }
        view.ring.scale.setScalar(unit.id === snapshot.selectedUnitId ? 1.2 : 1);
      }
    }
    this.redrawMarks();
  }
  private redrawMarks() {
    this.marks.clear(); this.markResources.forEach(resource => resource.dispose()); this.markResources = [];
    for (const mark of this.snapshot.marks) {
      const tile = this.snapshot.tiles.find(tile => tile.id === mark.tileId)!;
      const geometry = tileGeometry(tile, .022);
      const positions = geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++) {
        positions.setX(i, tile.center.x + (positions.getX(i) - tile.center.x) * .92);
        positions.setZ(i, tile.center.z + (positions.getZ(i) - tile.center.z) * .92);
        positions.setY(i, surfacePoint(this.snapshot.tiles, this.snapshot.cols, this.snapshot.rows, positions.getX(i), positions.getZ(i)).y + .022);
      }
      const material = new THREE.MeshBasicMaterial({ color: mark.color, transparent: true, opacity: mark.alpha * .45, depthWrite: false, side: THREE.DoubleSide });
      const outline = new THREE.BufferGeometry().setFromPoints([0, 1, 2, 5, 8, 7, 6, 3].map(i => new THREE.Vector3().fromBufferAttribute(positions, i)));
      const edgeMaterial = new THREE.LineBasicMaterial({ color: mark.color, transparent: true, opacity: .85, depthWrite: false });
      this.markResources.push(geometry, material, outline, edgeMaterial);
      this.marks.add(new THREE.Mesh(geometry, material), new THREE.LineLoop(outline, edgeMaterial));
    }
  }
  reset(snapshot: RenderSnapshot) {
    this.combat?.cancel(); this.movement.clear(); this.lastSequence = 0; this.snapshot = snapshot;
    for (const unit of snapshot.units) this.units.get(unit.id)?.sync(unit);
    this.redrawMarks();
  }
  update(delta: number) {
    if (this.disposed) return;
    this.clock += delta; this.combat?.update(delta, this.combatSpeed);
    for (const [id, move] of this.movement) {
      const view = this.units.get(id); if (!view) continue;
      move.elapsed += delta;
      const progress = Math.min(1, move.elapsed / .19), path = move.event.path;
      const frame = progress * (path.length - 1), index = Math.min(path.length - 2, Math.floor(frame));
      view.move(new THREE.Vector3().copy(path[index]).lerp(path[index + 1], frame - index));
      view.pose(Math.floor(this.clock * 10) % 2 + 1); view.face(path[path.length - 1].x < path[0].x);
      if (progress === 1) { this.movement.delete(id); view.pose(0); }
    }
    for (const view of this.units.values()) { view.conform(this.snapshot.tiles, this.snapshot.cols, this.snapshot.rows); view.billboard(this.cameraRig.camera, this.snapshot.mapId !== 'starfall-bridge'); view.project(this.cameraRig.camera, this.width, this.height); }
    this.feedbacks = this.feedbacks.filter(item => {
      item.age += delta;
      const unit = this.units.get(item.unitId);
      if (!unit || item.age > 1) { item.label.remove(); return false; }
      const p = unit.group.position.clone().add(new THREE.Vector3(0, 1 + item.age * .35, 0)).project(this.cameraRig.camera);
      item.label.style.left = `${(p.x + 1) * 50}%`; item.label.style.top = `${(1 - p.y) * 50}%`; item.label.style.opacity = `${1 - item.age}`;
      return true;
    });
    this.occlusionTime -= delta;
    if (this.occlusionTime <= 0) {
      this.occlusionTime = .15;
      this.scene.updateMatrixWorld();
      const important = [...this.units.values()].filter(view => view.group.visible);
      const blocked = new Set<THREE.Object3D>();
      for (const view of important) {
        const to = view.group.position.clone().add(new THREE.Vector3(0, .6, 0));
        this.ray.set(this.cameraRig.camera.position, to.clone().sub(this.cameraRig.camera.position).normalize());
        this.ray.far = this.cameraRig.camera.position.distanceTo(to);
        const nearby = this.terrain.occluders.filter(object => {
          let bounds = this.occlusionBounds.get(object);
          if (!bounds) { bounds = new THREE.Box3().setFromObject(object); this.occlusionBounds.set(object, bounds); }
          return this.ray.ray.intersectsBox(bounds);
        });
        this.ray.intersectObjects(nearby, false).forEach(hit => blocked.add(hit.object));
      }
      for (const object of this.terrain.occluders) {
        const materials = (Array.isArray(object.material) ? object.material : [object.material]) as THREE.MeshStandardMaterial[];
        for (const material of materials) {
          const faded = blocked.has(object);
          if (material.transparent !== faded) { material.transparent = faded; material.depthWrite = !faded; material.needsUpdate = true; }
          material.opacity = faded ? .2 : 1;
          if (material.alphaTest > 0) material.alphaTest = faded ? .08 : .45;
        }
      }
    }
    this.ray.far = Infinity;
    if (this.settings) {
      this.environment.update(this.clock, this.settings);
      const distance = this.cameraRig.camera.position.distanceTo(this.cameraRig.target);
      this.scene.fog = this.settings.fog ? (this.scene.fog ?? new THREE.Fog(this.scene.background as THREE.Color, distance - 2, distance + 14)) : null;
      if (this.scene.fog instanceof THREE.Fog) { this.scene.fog.near = distance - 2; this.scene.fog.far = distance + (this.terrain instanceof MoonlitEnvironment ? 110 : 32); }
      if (this.terrain instanceof MoonlitEnvironment) this.terrain.update(delta, this.settings, this.cameraRig.camera);
      else this.terrain.update(delta, this.settings);
    }
    this.gl.info.reset();
    if (this.post) this.post.render(this.settings.bloom, this.settings.dof && this.settings.quality === 'high' && !this.snapshot.choosingTarget,
      this.units.get(this.snapshot.selectedUnitId ?? '')?.group.position ?? this.cameraRig.target);
    else this.gl.render(this.scene, this.cameraRig.camera);
  }
  resize(width: number, height: number, dpr: number) {
    // Restore the tactical camera before adapting it to a changed aspect ratio.
    if ((width !== this.width || height !== this.height) && this.combat?.busy) this.skipPresentation();
    this.width = width; this.height = height;
    this.dpr = dpr;
    const profile = qualityProfiles[this.settings?.quality ?? 'medium'];
    const ratio = Math.min(dpr, profile.dpr) * profile.scale;
    this.gl.setPixelRatio(ratio); this.gl.setSize(width, height);
    this.post?.resize(Math.round(width * ratio), Math.round(height * ratio));
    this.cameraRig.resize(width, height);
  }
  configure(settings: DisplaySettings) {
    this.settings = { ...settings };
    const starfallNight = settings.timeOfDay === 'night' || (settings.timeOfDay === 'map' && !(this.terrain instanceof EncounterEnvironment));
    const preset = visualFor(starfallNight ? 'moonlit-pass' : settings.timeOfDay === 'map' ? this.snapshot.mapId : settings.timeOfDay === 'night' ? 'moonlit-pass' : 'starfall-bridge');
    (this.scene.background as THREE.Color).setHex(preset.background);
    if (this.scene.fog instanceof THREE.Fog) this.scene.fog.color.setHex(preset.background);
    this.light.intensity = starfallNight ? 2.1 : 3.1;
    this.sky.intensity = this.snapshot.mapId === 'starfall-bridge' ? 3.0 : 1.5;
    this.light.color.setHex(starfallNight ? 0xb9d5ff : preset.sun); this.sky.color.setHex(preset.sky); this.sky.groundColor.setHex(preset.ground);
    this.gl.shadowMap.enabled = qualityProfiles[settings.quality].shadows;
    const size = settings.quality === 'high' ? 2048 : 1024;
    if (this.light && this.light.shadow.mapSize.x !== size) {
      this.light.shadow.map?.dispose(); this.light.shadow.map = null; this.light.shadow.mapSize.set(size, size); this.light.shadow.needsUpdate = true;
    }
    if (settings.quality !== 'low' && (settings.bloom || settings.dof)) this.post ??= new PostProcessing(this.gl, this.scene, this.cameraRig.camera);
    else { this.post?.dispose(); this.post = undefined; }
    this.resize(this.width, this.height, this.dpr);
  }
  pose(unitId: string, frame: number) { this.units.get(unitId)?.pose(frame); }
  feedback(unitId: string, message: string, color: string) {
    if (this.feedbacks.length >= 8) this.feedbacks.shift()!.label.remove();
    const label = document.createElement('div'); label.className = 'hd-feedback'; label.textContent = message; label.style.color = color;
    this.labels.append(label); this.feedbacks.push({ label, unitId, age: 0 });
  }
  pick(clientX: number, clientY: number): PickResult {
    const rect = this.gl.domElement.getBoundingClientRect();
    if (clientX < rect.left || clientY < rect.top || clientX > rect.right || clientY > rect.bottom) return null;
    this.ray.setFromCamera(new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1, 1 - (clientY - rect.top) / rect.height * 2), this.cameraRig.camera);
    const hit = this.ray.intersectObjects(this.terrain.picks, false)[0];
    // Grid surfaces have priority: a foreground billboard must not steal a rear target's cell.
    if (hit) {
      const tileId = hit.object.userData.tileId;
      const occupant = [...this.units.values()].find(view => view.data.hp > 0 && view.data.tileId === tileId);
      return occupant ? { kind: 'unit', unitId: occupant.data.id } : { kind: 'tile', tileId };
    }
    return null;
  }
  skipPresentation() { this.combat?.cancel(); this.movement.clear(); for (const unit of this.snapshot.units) { const view = this.units.get(unit.id); view?.sync(unit); view?.pose(0); } }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.combat?.cancel(); this.movement.clear(); this.units.forEach(view => view.dispose()); this.units.clear();
    this.markResources.forEach(resource => resource.dispose()); this.post?.dispose(); this.assets.dispose(); this.scene.clear(); this.feedbacks = []; this.labels.remove();
    this.gl.domElement.removeEventListener('webglcontextlost', this.contextLost); this.gl.dispose(); this.gl.forceContextLoss(); this.gl.domElement.remove();
  }
}
