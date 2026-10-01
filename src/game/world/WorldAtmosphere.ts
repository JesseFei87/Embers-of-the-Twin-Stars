import * as THREE from 'three';

export type WorldEnvironment = { smoke: number[][]; ships: string[]; volcano: number[] };
type Puff = { sprite: THREE.Sprite; origin: THREE.Vector3; phase: number };
/** All effects use world coordinates and a shared, bounded simulation clock. */
export class WorldAtmosphere {
  readonly ocean: THREE.ShaderMaterial;
  private smoke: Puff[] = [];
  private clouds: Array<{ group: THREE.Group; origin: THREE.Vector3; speed: number }> = [];
  private ships: Array<{ object: THREE.Object3D; origin: THREE.Vector3; rotation: THREE.Euler; phase: number }> = [];
  private ash: Puff[] = [];
  private sparks: THREE.InstancedMesh;
  private vent: THREE.Vector3;
  private glow = new THREE.PointLight(0xff521b, 0, 15, 2);
  private dummy = new THREE.Object3D();
  private cloudTexture: THREE.CanvasTexture;
  private mask: THREE.Texture;
  private lights: THREE.MeshStandardMaterial[] = [];
  constructor(private scene: THREE.Scene, meta: WorldEnvironment, private particles: boolean) {
    this.vent = new THREE.Vector3(...meta.volcano as [number, number, number]);
    this.mask = new THREE.TextureLoader().load('/assets/world3d/shore-mask.png');
    this.mask.minFilter = this.mask.magFilter = THREE.LinearFilter;
    this.ocean = new THREE.ShaderMaterial({ uniforms: { time: { value: 0 }, shore: { value: this.mask } },
      vertexShader: `varying vec3 world;uniform float time;
      void main(){vec3 p=position;p.z+=sin(p.x*.82+time*1.25)*.035+sin(p.y*1.3-time*.9)*.025;world=(modelMatrix*vec4(p,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(world,1.);}`,
      fragmentShader: `varying vec3 world;uniform float time;uniform sampler2D shore;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1)),f.x),f.y);}
      void main(){vec2 p=world.xz,uv=vec2(p.x,-p.y)/64.+.5;
      float d=(texture2D(shore,clamp(uv,0.,1.)).r-.5)*8.;
      float n=noise(p*1.5+vec2(time*.12,-time*.10)),f=noise(p*8.+vec2(-time*.31,time*.23));
      float wave=sin(p.x*8.+p.y*6.-time*2.2+n*7.)*.5+.5;
      float shallow=exp(-abs(d)*1.45);vec3 col=mix(vec3(.018,.087,.15),vec3(.055,.34,.35),shallow*.78+n*.14);
      float crest=pow(max(0.,sin(d*15.+time*2.4+n*3.)),7.);
      float foam=(crest*.72+smoothstep(.4,.8,f)*.7)*exp(-abs(d+.10)*3.4);
      float glint=pow(wave,40.)*pow(f,6.)*.14;col+=glint*vec3(.65,.8,.88);
      col=mix(col,vec3(.67,.84,.81),clamp(foam,0.,.8));
      float horizon=1.-exp(-length(p)*.002);col=mix(col,vec3(.20,.32,.40),horizon);gl_FragColor=vec4(col,1.);}` });
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400, 200, 200), this.ocean); sea.rotation.x = -Math.PI / 2; sea.position.y = .02; sea.name = 'LivingSea'; scene.add(sea);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128; const ctx = canvas.getContext('2d')!;
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 63); g.addColorStop(0, 'rgba(255,255,255,.8)'); g.addColorStop(.35, 'rgba(255,255,255,.6)'); g.addColorStop(.7, 'rgba(255,255,255,.20)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
    this.cloudTexture = new THREE.CanvasTexture(canvas);
    const puff = (color: number, opacity: number) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.cloudTexture, color, opacity, transparent: true, depthWrite: false })); scene.add(s); return s;
    };
    meta.smoke.forEach((p, i) => { for (let j = 0; j < 5; j++) this.smoke.push({ sprite: puff(0xd8cdb7, .35), origin: new THREE.Vector3(...p as [number, number, number]), phase: j / 5 + i * .137 }); });
    for (let i = 0; i < 13; i++) {
      const group = new THREE.Group(); group.name = `DriftingCloud_${i}`; scene.add(group);
      for (let j = 0; j < 7; j++) {
        const s = puff(j % 3 ? 0xe4edf0 : 0xbfcfd9, .18); group.add(s); s.position.set(Math.sin(j * 2.3 + i) * 2.3, Math.cos(j * 1.7) * .35, Math.cos(j * 2.3 + i) * .8); s.scale.set(3.6 + (j % 3), 1.35 + (j % 2) * .4, 1);
      }
      this.clouds.push({ group, origin: new THREE.Vector3(-52 + (i * 17.31) % 104, 10 + i % 4 * 1.3, -38 + (i * 19.7) % 76), speed: .12 + i % 3 * .025 });
    }
    meta.ships.forEach((name, i) => { const object = scene.getObjectByName(name); if (object) this.ships.push({ object, origin: object.position.clone(), rotation: object.rotation.clone(), phase: i * 1.8 }); });
    for (let i = 0; i < 26; i++) this.ash.push({ sprite: puff(0x535260, .55), origin: this.vent, phase: i / 26 });
    this.sparks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.065, 0), new THREE.MeshBasicMaterial({ color: 0xff8a25 }), 48); this.sparks.name = 'VolcanicEjecta'; this.sparks.frustumCulled = false; scene.add(this.sparks);
    this.glow.position.copy(this.vent).add(new THREE.Vector3(0, 1, 0)); scene.add(this.glow);
    scene.traverse(o => { if (o instanceof THREE.Mesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m instanceof THREE.MeshStandardMaterial && m.name === 'window' && !this.lights.includes(m)) this.lights.push(m); });
  }
  update(time: number) {
    this.ocean.uniforms.time.value = time;
    for (const puff of this.smoke) {
      puff.sprite.visible = this.particles; const life = (time * .14 + puff.phase) % 1;
      puff.sprite.position.copy(puff.origin).add(new THREE.Vector3(life * .9, life * 2.1, Math.sin(life * 3 + puff.phase) * .18)); puff.sprite.scale.setScalar(.16 + life * 1.05); puff.sprite.material.opacity = Math.sin(life * Math.PI) * .4;
    }
    for (const cloud of this.clouds) { cloud.group.position.copy(cloud.origin); cloud.group.position.x = ((cloud.origin.x + time * cloud.speed + 55) % 110) - 55; }
    for (const ship of this.ships) {
      const t = time * 1.1 + ship.phase;
      ship.object.position.copy(ship.origin).add(new THREE.Vector3(Math.sin(t * .42) * .14, Math.sin(t) * .065, Math.cos(t * .38) * .11));
      ship.object.rotation.copy(ship.rotation); ship.object.rotation.x += Math.sin(t + .3) * .035; ship.object.rotation.z += Math.cos(t * .9) * .055;
    }
    // A short eruption every 23 seconds; quiet intervals keep the world readable.
    const cycle = (time + 19) % 23, burst = cycle < 4.8;
    this.glow.intensity = burst ? 14 + Math.sin(time * 13) * 3 : 2;
    this.ash.forEach(puff => {
      puff.sprite.visible = this.particles; const life = (time * .09 + puff.phase) % 1;
      puff.sprite.position.copy(puff.origin).add(new THREE.Vector3(life * 2.5, .2 + life * 5.5, Math.sin(puff.phase * 40 + life) * .55)); puff.sprite.scale.setScalar(.5 + life * (burst ? 3.8 : 2.1)); puff.sprite.material.opacity = Math.sin(life * Math.PI) * (burst ? .48 : .27);
    });
    this.sparks.visible = this.particles && burst;
    if (burst) for (let i = 0; i < 48; i++) {
      const age = (cycle + i * .047) % 2.3, angle = i * 2.399;
      this.dummy.position.copy(this.vent).add(new THREE.Vector3(Math.cos(angle) * age * (.6 + i % 5 * .13), .2 + age * 4.2 - age * age * 2, Math.sin(angle) * age * (.6 + i % 4 * .16)));
      this.dummy.scale.setScalar(.7 + i % 3 * .3); this.dummy.updateMatrix(); this.sparks.setMatrixAt(i, this.dummy.matrix);
    }
    this.sparks.instanceMatrix.needsUpdate = burst;
    this.lights.forEach(m => { m.emissiveIntensity = 1.3 + Math.sin(time * 1.7) * .16; });
  }
  dispose() { this.cloudTexture.dispose(); this.mask.dispose(); }
}
