import * as THREE from 'three';
import { surfacePoint } from '../visual-config/maps';
import type { TileView, UnitView, Vec3 } from '../contracts';
import { AssetRegistry } from './AssetRegistry';
import { moonlitSpriteKey } from '../../game/ui/moonlitSprites';

export class UnitSpriteView {
  readonly group = new THREE.Group();
  private billboardRoot = new THREE.Group();
  readonly body: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial>;
  readonly ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  readonly label = document.createElement('div');
  readonly shadow: THREE.Mesh;
  readonly textures: THREE.Texture[];
  private frame = -1;
  private surfaceStamp = '';
  private contactCoordinates: Array<{ mesh: THREE.Mesh; coordinates: Float32Array }> = [];
  private depth: THREE.MeshDepthMaterial;
  data: UnitView;
  private constructor(unit: UnitView, textures: THREE.Texture[], assets: AssetRegistry, private starfall = false) {
    this.data = unit; this.textures = textures;
    const size = starfall ? textures[0].image.height * .0135 : unit.sprite === 'cavalry' ? 1.27 : 1.13;
    const width = starfall ? textures[0].image.width * .0135 : size;
    const geometry = assets.own(new THREE.PlaneGeometry(width, size).translate(0, size / 2, 0));
    const material = assets.own(new THREE.MeshLambertMaterial({ map: textures[0], alphaTest: .45, side: THREE.DoubleSide, ...(starfall ? { emissive: 0xffffff, emissiveMap: textures[0], emissiveIntensity: .5 } : {}) }));
    this.body = new THREE.Mesh(geometry, material); this.body.castShadow = true; this.body.receiveShadow = false;
    this.depth = assets.own(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: textures[0], alphaTest: .45, side: THREE.DoubleSide }));
    this.body.customDepthMaterial = this.depth; this.body.userData.unitId = unit.id;
    const teamColor = unit.team === 'player' ? 0x65eee1 : 0xff7599;
    this.ring = new THREE.Mesh(assets.own(new THREE.RingGeometry(.26, .3, 28).rotateX(-Math.PI / 2)), assets.own(new THREE.MeshBasicMaterial({ color: teamColor, side: THREE.DoubleSide, depthWrite: false })));
    this.ring.position.y = .018;
    // Radial alpha texture for a soft contact shadow, independent of the light shadow map.
    const data = new Uint8Array(32 * 32 * 4);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const i = (y * 32 + x) * 4; data[i + 3] = Math.round(Math.max(0, 1 - Math.hypot(x - 15.5, y - 15.5) / 16) ** 1.3 * 145);
    }
    const blob = assets.own(new THREE.DataTexture(data, 32, 32)); blob.needsUpdate = true;
    this.shadow = new THREE.Mesh(assets.own(new THREE.PlaneGeometry(.8, .53, 4, 4).rotateX(-Math.PI / 2)), assets.own(new THREE.MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 })));
    this.shadow.position.y = .01;
    this.contactCoordinates = [this.shadow, this.ring].map(mesh => ({ mesh, coordinates: new Float32Array(mesh.geometry.getAttribute('position').array) }));
    this.billboardRoot.add(this.body);
    this.group.add(this.shadow, this.ring, this.billboardRoot); this.group.position.copy(unit.feet);
    this.label.className = `hd-unit-label ${unit.team}`; this.label.dataset.unitId = unit.id;
    this.label.innerHTML = '<span></span><i><b></b></i>';
    this.sync(unit); this.pose(0);
  }
  static async create(unit: UnitView, assets: AssetRegistry, starfall = false) {
    const textures = await Promise.all(Array.from({ length: 6 }, (_, frame) => unit.id === 'e2' ? assets.noxTexture(frame, starfall) : assets.texture(moonlitSpriteKey(unit.id) ?? unit.sprite, frame, starfall)));
    return new UnitSpriteView(unit, textures, assets, starfall);
  }
  sync(unit: UnitView, position = true) {
    this.data = unit; if (position) this.group.position.copy(unit.feet);
    this.group.visible = unit.hp > 0; this.label.hidden = unit.hp <= 0;
    this.label.className = `hd-unit-label ${unit.team}${unit.acted ? ' acted' : ''}`;
    this.label.querySelector('span')!.textContent = `${unit.name}${unit.acted ? ' ✓' : ''}`;
    this.setHp(unit.hp);
    this.ring.material.color.setHex(unit.team === 'player' ? 0x65eee1 : 0xff7599);
    this.body.material.color.setHex(unit.acted ? 0xaeb9bf : 0xffffff);
  }
  setHp(hp: number) { (this.label.querySelector('b') as HTMLElement).style.width = `${Math.max(0, hp / this.data.maxHp * 100)}%`; this.label.title = `${this.data.name} HP ${hp}/${this.data.maxHp}`; }
  pose(frame: number) {
    if (this.frame === frame) return;
    this.frame = frame;
    this.body.material.map = this.textures[frame];
    if (this.starfall) this.body.material.emissiveMap = this.textures[frame];
    this.depth.map = this.textures[frame];
  }
  face(left: boolean) { this.body.scale.x = left ? -1 : 1; }
  billboard(camera: THREE.Camera, faceCamera = false) {
    if(faceCamera) this.billboardRoot.quaternion.copy(camera.quaternion);
    else this.billboardRoot.rotation.set(0,Math.atan2(camera.position.x-this.group.position.x,camera.position.z-this.group.position.z),0);
  }
  project(camera: THREE.Camera, width: number, height: number) {
    const p = this.group.position.clone().add(new THREE.Vector3(0, -.025, .1)).project(camera);
    this.label.style.transform = `translate(-50%, 0) translate(${(p.x + 1) * width / 2}px, ${(1 - p.y) * height / 2}px)`;
    this.label.style.display = p.z > 1 || Math.abs(p.x) > 1 || Math.abs(p.y) > 1 ? 'none' : '';
  }
  conform(tiles: readonly TileView[], cols: number, rows: number) {
    const feet = this.group.position, stamp = `${feet.x},${feet.y},${feet.z}`;
    if (stamp === this.surfaceStamp) return; this.surfaceStamp = stamp;
    for (const { mesh, coordinates } of this.contactCoordinates) {
      const position = mesh.geometry.getAttribute('position');
      for (let i = 0; i < position.count; i++) position.setY(i, surfacePoint(tiles, cols, rows, feet.x + coordinates[i * 3], feet.z + coordinates[i * 3 + 2]).y - feet.y);
      position.needsUpdate = true;
    }
  }
  move(point: Vec3) { this.group.position.copy(point); }
  dispose() { this.label.remove(); this.group.removeFromParent(); }
}
