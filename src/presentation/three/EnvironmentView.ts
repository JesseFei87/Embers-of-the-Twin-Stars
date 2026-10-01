import * as THREE from 'three';
import type { DisplaySettings } from '../DisplaySettings';
import { qualityProfiles } from '../DisplaySettings';
import { AssetRegistry } from './AssetRegistry';

// Deterministic visual hash, independent of Math.random and battle RNG.
export const visualNoise = (i: number) => { const value = Math.sin(i * 127.1 + 311.7) * 43758.5453; return value - Math.floor(value); };
export class EnvironmentView {
  readonly group = new THREE.Group();
  private particles: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private rain: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private mist: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  constructor(assets: AssetRegistry) {
    const geometry = assets.own(new THREE.BufferGeometry()); geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(120 * 3), 3));
    this.particles = new THREE.Points(geometry, assets.own(new THREE.PointsMaterial({ color: 0xffe4a1, size: .035, transparent: true, opacity: .65, depthWrite: false })));
    this.particles.frustumCulled = false;
    const rainGeometry = assets.own(new THREE.BufferGeometry()); rainGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(120 * 6), 3));
    this.rain = new THREE.LineSegments(rainGeometry, assets.own(new THREE.LineBasicMaterial({ color: 0xb1cbdc, transparent: true, opacity: .35, depthWrite: false }))); this.rain.frustumCulled = false;
    this.mist = new THREE.Mesh(assets.own(new THREE.PlaneGeometry(11, 9).rotateX(-Math.PI / 2)), assets.own(new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, tint: { value: new THREE.Color(0xb5c7c6) } }, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: `varying vec2 vUv;uniform float time;uniform vec3 tint;void main(){float edge=smoothstep(0.1,0.5,abs(vUv.x-.5));float fog=sin(vUv.y*25.+sin(vUv.x*17.+time*.07))*0.5+0.5;gl_FragColor=vec4(tint,edge*fog*.12);}`,
    }))); this.mist.position.y = .28; this.group.add(this.mist, this.particles, this.rain);
  }
  update(time: number, settings: DisplaySettings) {
    const count = qualityProfiles[settings.quality].particles;
    this.particles.visible = settings.particles && !settings.reducedMotion && settings.weather !== 'rain';
    this.rain.visible = settings.particles && !settings.reducedMotion && settings.weather === 'rain';
    this.particles.material.color.setHex(settings.weather === 'snow' ? 0xe6f3ff : 0xffe4a1);
    this.particles.material.size = settings.weather === 'snow' ? .065 : .035;
    this.mist.visible = settings.mist && settings.quality !== 'low'; this.mist.material.uniforms.time.value = settings.reducedMotion ? 0 : time;
    const position = this.particles.geometry.getAttribute('position');
    for (let i = 0; i < count; i++) {
      const x = visualNoise(i * 3) * 12 - 6, z = visualNoise(i * 3 + 1) * 10 - 5;
      const speed = settings.weather === 'rain' ? -5 : settings.weather === 'snow' ? -.5 : .045;
      const y = ((visualNoise(i * 3 + 2) * 5 + time * speed) % 5 + 5) % 5;
      const rain = this.rain.geometry.getAttribute('position'); rain.setXYZ(i * 2, x, y, z); rain.setXYZ(i * 2 + 1, x + .025, y + .2, z);
      position.setXYZ(i, x + Math.sin(time * .18 + i) * .12, y, z);
    }
    position.needsUpdate = true; this.particles.geometry.setDrawRange(0, count); this.rain.geometry.getAttribute('position').needsUpdate = true; this.rain.geometry.setDrawRange(0, count * 2);
  }
}
export function addMaterialDetail(materials: Map<string, THREE.MeshStandardMaterial>, assets: AssetRegistry) {
  for (const [kind, material] of materials) {
    if (kind === 'glow') continue;
    const data = new Uint8Array(32 * 32 * 4);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const noise = visualNoise(x + y * 32 + kind.charCodeAt(0));
      const seam = kind === 'r' || kind === 's' ? (y % 8 === 0 || (x + Math.floor(y / 8) * 4) % 12 === 0) : kind === 'b' || kind === 'trunk' ? y % 7 === 0 : false;
      const value = seam ? 145 : 218 + Math.floor(noise * 26), i = (y * 32 + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = value; data[i + 3] = 255;
    }
    const map = assets.own(new THREE.DataTexture(data, 32, 32)); map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.magFilter = THREE.NearestFilter; map.minFilter = THREE.LinearMipmapLinearFilter; map.generateMipmaps = true; map.needsUpdate = true;
    const bump = assets.own(map.clone()); bump.colorSpace = THREE.NoColorSpace; bump.needsUpdate = true;
    material.map = map; material.bumpMap = bump; material.bumpScale = kind === 'w' ? .012 : .009; material.needsUpdate = true;
  }
}
