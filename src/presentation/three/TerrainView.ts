import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { RenderSnapshot, TileView } from '../contracts';
import { AssetRegistry } from './AssetRegistry';

export const terrainColors: Record<string, number> = { g: 0x63836b, f: 0x435f51, m: 0x7c838a, w: 0x2c8190, b: 0x96734d, r: 0xa69c7f, s: 0xb8b4a4 };
export function tileGeometry(tile: TileView, offset = 0): THREE.BufferGeometry {
  const points: number[] = [], indices: number[] = [];
  for (let i = 0; i < 9; i++) points.push(tile.center.x - .5 + (i % 3) / 2, tile.heights[i] + offset, tile.center.z - .5 + Math.floor(i / 3) / 2);
  for (let row = 0; row < 2; row++) for (let col = 0; col < 2; col++) {
    const a = row * 3 + col; indices.push(a, a + 3, a + 1, a + 1, a + 3, a + 4);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}
export class TerrainView {
  readonly group = new THREE.Group();
  readonly picks: THREE.Mesh[] = [];
  readonly occluders: THREE.Mesh[] = [];
  readonly materials = new Map<string, THREE.MeshStandardMaterial>();
  private edges = new THREE.Group();
  constructor(readonly snapshot: RenderSnapshot, private assets: AssetRegistry) {
    const batches = new Map<string, THREE.BufferGeometry[]>();
    const add = (key: string, geometry: THREE.BufferGeometry) => {
      const normalized = geometry.index ? geometry.toNonIndexed() : geometry;
      if (normalized !== geometry) geometry.dispose();
      const positions = normalized.getAttribute('position'), normals = normalized.getAttribute('normal'), uv: number[] = [];
      for (let i = 0; i < positions.count; i++) {
        if (Math.abs(normals.getY(i)) > .55) uv.push(positions.getX(i), positions.getZ(i));
        else if (Math.abs(normals.getX(i)) > Math.abs(normals.getZ(i))) uv.push(positions.getZ(i), positions.getY(i));
        else uv.push(positions.getX(i), positions.getY(i));
      }
      normalized.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      const batch = batches.get(key) ?? []; batch.push(normalized); batches.set(key, batch);
    };
    const box = (key: string, x: number, y: number, z: number, w: number, h: number, d: number) => add(key, new THREE.BoxGeometry(w, h, d).translate(x, y, z));
    const colors = { ...terrainColors, side: 0x4c5556, trunk: 0x605747, leaf: 0x476b65, leafGold: 0x9a9664, metal: 0x8d999e, glow: 0xa6e7ff, roof: 0x48576b };
    for (const [key, color] of Object.entries(colors)) this.materials.set(key, assets.own(new THREE.MeshStandardMaterial({
      color, roughness: key === 'w' ? .28 : key === 'metal' ? .38 : .88, metalness: key === 'metal' ? .65 : 0,
      ...(key === 'glow' ? { emissive: color, emissiveIntensity: 1.5 } : {}),
    })));
    const pickMaterial = assets.own(new THREE.MeshBasicMaterial({ visible: false }));
    for (const tile of snapshot.tiles) {
      if (!terrainColors[tile.terrain]) throw new Error(`未知地形视觉：${tile.terrain}`);
      const geometry = tileGeometry(tile); add(tile.terrain, geometry);
      const pick = new THREE.Mesh(assets.own(geometry.clone()), pickMaterial); pick.userData.tileId = tile.id; this.picks.push(pick);
      const { x, y, z } = tile.center;
      // Closed sides and the bridge deck have real thickness.
      const side: number[] = [], idx: number[] = [];
      for (const edge of [[0, 1, 2], [2, 5, 8], [8, 7, 6], [6, 3, 0]]) for (let i = 0; i < 2; i++) {
        const a = edge[i], b = edge[i + 1], start = side.length / 3;
        for (const [k, bottom] of [[a, false], [b, false], [a, true], [b, true]] as const) side.push(x - .5 + (k % 3) / 2, bottom ? (tile.terrain === 'b' ? tile.heights[k] - .13 : -.65) : tile.heights[k], z - .5 + Math.floor(k / 3) / 2);
        idx.push(start, start + 1, start + 2, start + 1, start + 3, start + 2);
      }
      const sides = new THREE.BufferGeometry(); sides.setAttribute('position', new THREE.Float32BufferAttribute(side, 3)); sides.setIndex(idx); sides.computeVertexNormals(); add(tile.terrain === 'b' ? 'b' : 'side', sides);
      if (tile.terrain === 'b') {
        box('trunk', x - .36, -.25, z, .13, .65, .13); box('trunk', x + .36, -.25, z, .13, .65, .13);
        for (let j = 0; j < 5; j++) box('trunk', x, y + .005, z - .4 + j * .2, .94, .014, .014);
      }
      if (tile.terrain === 'f') {
        const tx = x + .29, tz = z - .3;
        box('trunk', tx, y + .35, tz, .12, .7, .12);
        const tiers = [new THREE.ConeGeometry(.4, .7, 7).translate(0, -.22, 0), new THREE.ConeGeometry(.31, .6, 7).translate(0, .06, 0), new THREE.ConeGeometry(.2, .5, 7).translate(0, .33, 0)];
        const crownGeometry = mergeGeometries(tiers)!; tiers.forEach(g => g.dispose());
        const crown = new THREE.Mesh(assets.own(crownGeometry), assets.own(this.materials.get((tile.grid.x + tile.grid.y) % 4 ? 'leaf' : 'leafGold')!.clone()));
        crown.position.set(tx, y + .93, tz); crown.castShadow = true; crown.receiveShadow = true;
        this.occluders.push(crown); this.group.add(crown);
      }
      if (tile.terrain === 'm') add('m', new THREE.DodecahedronGeometry(.26, 0).scale(1, 1.4, .85).translate(x + .3, y + .15, z - .26));
      if (tile.terrain === 's') {
        for (const sx of [-.37, .37]) box('metal', x + sx, y + .04, z, .024, .02, .72);
        add('glow', new THREE.TorusGeometry(.23, .014, 4, 16).rotateX(-Math.PI / 2).translate(x, y + .018, z));
      }
    }
    // Original procedural architecture around the playable boundary; no new blocked cells.
    for (const x of [-snapshot.cols / 2 - .45, snapshot.cols / 2 + .45]) for (const z of [-3, 1, 3]) {
      box('m', x, .1, z, .34, 1.5, .34); box('metal', x, .9, z, .45, .15, .45);
    }
    // A small ruined watch house, outside the logical grid. The roof participates in occlusion fading.
    box('m', -snapshot.cols / 2 - .8, .06, -.8, .85, 1.3, 1.1);
    const roof = new THREE.Mesh(assets.own(new THREE.ConeGeometry(.8, .55, 4).rotateY(Math.PI / 4)), assets.own(this.materials.get('roof')!.clone()));
    roof.position.set(-snapshot.cols / 2 - .8, .98, -.8); roof.castShadow = true; this.occluders.push(roof); this.group.add(roof);
    box('glow', -snapshot.cols / 2 - .36, .35, -.8, .025, .24, .18);
    box('side', 0, -.85, 0, snapshot.cols + .2, .4, snapshot.rows + .2);
    for (const [key, list] of batches) {
      const merged = mergeGeometries(list); list.forEach(part => part.dispose());
      if (!merged) throw new Error(`地形几何合并失败：${key}`);
      const geometry = assets.own(merged);
      const mesh = new THREE.Mesh(geometry, this.materials.get(key)!); mesh.castShadow = key !== 'w' && key !== 'glow'; mesh.receiveShadow = true; this.group.add(mesh);
    }
    const lineMaterial = assets.own(new THREE.LineBasicMaterial({ color: 0xd0dccc, transparent: true, opacity: .15 }));
    const linePoints: THREE.Vector3[] = [];
    for (const tile of snapshot.tiles) for (const [a, b] of [[0, 1], [1, 2], [2, 5], [5, 8], [8, 7], [7, 6], [6, 3], [3, 0]]) {
      for (const k of [a, b]) linePoints.push(new THREE.Vector3(tile.center.x - .5 + (k % 3) / 2, tile.heights[k] + .014, tile.center.z - .5 + Math.floor(k / 3) / 2));
    }
    this.edges.add(new THREE.LineSegments(assets.own(new THREE.BufferGeometry().setFromPoints(linePoints)), lineMaterial)); this.group.add(this.edges);
    this.group.add(...this.picks);
  }
}
