import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { RenderSnapshot } from '../contracts';
import type { DisplaySettings } from '../DisplaySettings';
import { AssetRegistry } from './AssetRegistry';
import { tileGeometry } from './TerrainView';

export class EncounterEnvironment {
  readonly group = new THREE.Group();
  readonly picks: THREE.Mesh[] = [];
  readonly occluders: THREE.Mesh[] = [];
  private water?: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  private clock = 0;
  static async create(snapshot: RenderSnapshot, assets: AssetRegistry) {
    const view = new EncounterEnvironment();
    const model = await new GLTFLoader().loadAsync(`/assets/world3d/${snapshot.mapId}.glb`);
    model.scene.traverse(o => {
      if (o instanceof THREE.Mesh) {
        assets.own(o.geometry); (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { assets.own(m); for (const value of Object.values(m)) if (value instanceof THREE.Texture) assets.own(value); });
        o.castShadow = true; o.receiveShadow = true; (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.name === 'bough') { m.transparent = false; m.alphaTest = .4; m.depthWrite = true; m.side = THREE.DoubleSide; } });
      }
    });
    view.group.add(model.scene);
    const material = assets.own(new THREE.MeshBasicMaterial({ visible: false }));
    for (const tile of snapshot.tiles) {
      const pick = new THREE.Mesh(assets.own(tileGeometry(tile)), material); pick.userData.tileId = tile.id; view.picks.push(pick);
    }
    view.group.add(...view.picks);
    if (snapshot.mapId === 'tide-cove') {
      const water = view.water = new THREE.Mesh(assets.own(new THREE.PlaneGeometry(200, 200, 80, 80)), assets.own(new THREE.MeshStandardMaterial({ color: 0x317982, roughness: .3, metalness: .25 })));
      water.rotation.x = -Math.PI / 2; water.position.set(105, -.13, 0); view.group.add(water);
    }
    return view;
  }
  update(delta: number, settings: DisplaySettings) {
    if (!this.water || settings.reducedMotion) return;
    this.clock += delta; const p = this.water.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 2 + this.clock) * .025 + Math.cos(p.getY(i) * 3 - this.clock * 1.4) * .02);
    p.needsUpdate = true; this.water.geometry.computeVertexNormals();
  }
}
