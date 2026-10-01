import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { DisplaySettings } from '../DisplaySettings';
import type { RenderSnapshot } from '../contracts';
import { AssetRegistry } from './AssetRegistry';
import { tileGeometry } from './TerrainView';

const noise = `float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}`;

// A presentation-only copy of the same GLB used by the editable Godot scene.
export class StarfallEnvironment {
  readonly group = new THREE.Group();
  readonly picks: THREE.Mesh[] = [];
  readonly occluders: THREE.Mesh[] = [];
  private water: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  private sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private shafts = new THREE.Group();
  private lights: THREE.PointLight[] = [];
  private waterTime = { value: 0 };
  private weatherTime = 0;
  private constructor(private assets: AssetRegistry, snapshot: RenderSnapshot) {
    this.group.name = 'StarfallImportedEnvironment';
    const invisible = assets.own(new THREE.MeshBasicMaterial({ visible: false }));
    for (const tile of snapshot.tiles) {
      const pick = new THREE.Mesh(assets.own(tileGeometry(tile, .045)), invisible);
      pick.userData.tileId = tile.id; this.picks.push(pick); this.group.add(pick);
    }
    const waterMaterial = assets.own(new THREE.MeshStandardMaterial({ color: 0x397e85, roughness: .3, metalness: .08 }));
    waterMaterial.onBeforeCompile = shader => {
      shader.uniforms.flowTime = this.waterTime;
      shader.vertexShader = 'varying vec3 waterWorld;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nwaterWorld=(modelMatrix*vec4(position,1.)).xyz;');
      shader.fragmentShader = `varying vec3 waterWorld;uniform float flowTime;\n${noise}\n` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        vec2 p=waterWorld.xz*vec2(4.,14.)+vec2(-flowTime*.8,0.);
        float n=noise(p);
        float ripple=pow(.5+.5*sin(p.y*2.4+n*4.+flowTime*1.2),18.);
        float bank=smoothstep(.32,.58,abs(waterWorld.z+.5));
        float foam=ripple*smoothstep(.48,.8,noise(p*.8))*(.2+bank*.55);
        diffuseColor.rgb=mix(diffuseColor.rgb*(.68+n*.5+bank*.12),vec3(.66,.85,.82),foam);`);
    };
    this.water = new THREE.Mesh(assets.own(new THREE.PlaneGeometry(30, 1.2).rotateX(-Math.PI / 2)), waterMaterial);
    this.water.position.set(0, .0375, -.5); this.water.receiveShadow = true; this.group.add(this.water);
    this.sky = new THREE.Mesh(assets.own(new THREE.SphereGeometry(65, 24, 12)), assets.own(new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, uniforms: { time: { value: 0 }, night: { value: 0 } },
      vertexShader: 'varying vec3 direction;void main(){direction=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: `varying vec3 direction;uniform float time;uniform float night;${noise}
        void main(){vec3 d=normalize(direction);float h=max(0.,d.y);
        vec3 color=mix(mix(vec3(.36,.53,.62),vec3(.033,.055,.092),night),mix(vec3(.035,.15,.34),vec3(.007,.016,.042),night),pow(h,.45));
        vec2 p=d.xz/(h+.12)*2.3+vec2(.018,.006)*time;
        float cloud=noise(p)*.53+noise(p*2.03+17.1)*.27+noise(p*4.07+8.3)*.13+noise(p*8.17)*.07;
        float alpha=smoothstep(.45,.66,cloud)*smoothstep(.005,.12,d.y);
        color=mix(color,mix(vec3(.75,.79,.78),vec3(.07,.1,.16),night),alpha*.92);
        float sun=pow(max(0.,dot(d,normalize(vec3(-.72,1.,-.35)))),22.);
        vec2 starUv=vec2(atan(d.z,d.x)/6.2831853+.5,asin(d.y)/3.1415926+.5);
        vec2 cell=starUv*vec2(520.,260.);vec2 id=floor(cell);vec2 local=fract(cell)-.5;
        float star=pow(max(0.,1.-length(local)*2.8),5.)*step(.975,hash(id));
        float band=exp(-pow(dot(d,normalize(vec3(.2,1.,-.35)))*6.,2.));
        float dust=noise(starUv*vec2(70.,110.))*.6+noise(starUv*220.)*.4;
        vec3 galaxy=mix(vec3(.15,.23,.43),vec3(.34,.26,.45),dust)*band*(.3+dust)*.95;
        float moonDot=dot(d,normalize(vec3(-.35,.07,-1.)));
        float moon=smoothstep(.99935,.99955,moonDot);
        float halo=pow(max(0.,moonDot),180.);
        float skyMask=smoothstep(-.65,-.08,d.y);
        color+=night*skyMask*(galaxy+vec3(.72,.83,1.)*star*1.8+vec3(.22,.32,.48)*halo+vec3(1.,.94,.79)*moon*2.);
        gl_FragColor=vec4(color+vec3(.45,.27,.10)*sun*(1.-night),1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    })));
    this.sky.renderOrder = -10; this.group.add(this.sky);
    // Depth-tested light scattering meshes accompany actual shadow-casting sunlight.
    for (let i = 0; i < 3; i++) {
      const material = assets.own(new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, uniforms: {},
        vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
        fragmentShader: 'varying vec2 vUv;void main(){float edge=pow(max(0.,sin(vUv.x*3.14159)),2.);float end=smoothstep(0.,.22,vUv.y)*(1.-smoothstep(.6,1.,vUv.y));gl_FragColor=vec4(.95,.81,.55,edge*end*.035);}',
      }));
      const shaft = new THREE.Mesh(assets.own(new THREE.PlaneGeometry(1.4+i*.3, 11)), material);
      const top = new THREE.Vector3(-8.5+i*1.5, 8, -4.5+i*1.75), bottom = top.clone().add(new THREE.Vector3(5.5,-7.6,2.66));
      shaft.position.copy(top).add(bottom).multiplyScalar(.5);
      shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), top.sub(bottom).normalize());
      this.shafts.add(shaft);
    }
    this.group.add(this.shafts);
  }
  static async create(snapshot: RenderSnapshot, assets: AssetRegistry) {
    const view = new StarfallEnvironment(assets, snapshot);
    const [gltf, layout] = await Promise.all([
      new GLTFLoader().loadAsync('/assets/starfall/environment.glb'),
      fetch('/assets/starfall/layout.json').then(response => { if (!response.ok) throw new Error('星落桥布局加载失败'); return response.json(); }),
    ]);
    gltf.scene.scale.setScalar(.5); gltf.scene.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = [];
    gltf.scene.traverse(object => { if (object instanceof THREE.Mesh) meshes.push(object); });
    const textures = new Set<THREE.Texture>();
    for (const mesh of meshes) {
      assets.own(mesh.geometry);
      const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[];
      for (const material of materials) {
        assets.own(material);
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
        material.roughness = .9;
        if (/bough/i.test(material.name)) { material.color.setHex(0xd5dec4); material.alphaTest = .45; material.side = THREE.DoubleSide; }
        if (/limestone|river_slate/.test(material.name)) {
          material.color.setHex(0xf2f0df);
          material.onBeforeCompile = shader => {
            shader.vertexShader = 'varying vec3 stoneWorld;\n' + shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nstoneWorld=(modelMatrix*vec4(position,1.)).xyz;');
            shader.fragmentShader = `varying vec3 stoneWorld;\n${noise}\n` + shader.fragmentShader;
            shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
              float wear=noise(stoneWorld.xz*7.+stoneWorld.y*3.);
              float moss=smoothstep(.53,.78,noise(stoneWorld.xz*2.3+stoneWorld.y));
              diffuseColor.rgb*=.88+wear*.2;
              diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.68,.83,.49),moss*.45);`);
          };
        }
        if (/fern_green/.test(material.name)) { material.side=THREE.DoubleSide; material.color.setHex(0x93b475); }
        if (/lantern_glass/.test(material.name)) material.emissiveIntensity = 1.5;
      }
      mesh.castShadow = !/flower|tuft/i.test(mesh.name); mesh.receiveShadow = true;
      // Source meshes batch the entire forest; split spatially so only nearby occluding trees fade.
      if (/Pine_forest.*bough/i.test(mesh.name)) {
        view.splitForest(mesh, materials[0]); mesh.visible = false;
      } else if (/lodge|gate|Rocks/i.test(mesh.name)) {
        mesh.material = Array.isArray(mesh.material) ? materials.map(material => assets.own(material.clone())) : assets.own(materials[0].clone());
        view.occluders.push(mesh);
      }
    }
    textures.forEach(texture => assets.own(texture));
    view.group.add(gltf.scene);
    view.addMeadow();
    for (const [x,y,z] of layout.lamps as number[][]) {
      const light = new THREE.PointLight(0xffb554, 6, 2.5, 2); light.position.set(x*.5,y*.5,z*.5);
      view.group.add(light); view.lights.push(light);
    }
    const crystal = new THREE.PointLight(0x71ffef, 3, 2, 2); crystal.position.set(0,.7,3.5); view.group.add(crystal);
    return view;
  }
  private addMeadow() {
    const vertices: number[] = [];
    for (let leaf = 0; leaf < 7; leaf++) {
      const angle = leaf * Math.PI * 2 / 7, x = Math.cos(angle), z = Math.sin(angle);
      vertices.push(-z*.009,0,x*.009, z*.009,0,-x*.009, x*.09,.12,z*.09);
      vertices.push(x*.09,.12,z*.09, x*.14+z*.012,.17,z*.14-x*.012, x*.2,.11,z*.2);
    }
    const geometry = this.assets.own(new THREE.BufferGeometry()); geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3)); geometry.computeVertexNormals();
    const material = this.assets.own(new THREE.MeshStandardMaterial({color:0x819264,side:THREE.DoubleSide,roughness:1}));
    const transforms: THREE.Matrix4[] = [], random = (i: number) => { const n=Math.sin(i*127.1+87211)*43758.5453;return n-Math.floor(n); };
    for (let i=0;i<4200;i++) {
      const x=random(i*3)*16-8,z=random(i*3+1)*14-7;
      if (z> -1.3 && z<.35 || Math.abs(x)<1.05 && z>-.5 || x> -4.3 && x< -2.4 && z> -3.6 && z< -1.7) continue;
      const y=.16+Math.max(0,Math.min(1,(-z*2-2)/3))*.65+.025*Math.sin(x*1.4)*Math.cos(z*1.2);
      const scale=.45+random(i*3+2)*.55;
      transforms.push(new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),random(i+23)*6.28),new THREE.Vector3(scale,scale,scale)));
    }
    const meadow=this.assets.own(new THREE.InstancedMesh(geometry,material,transforms.length));
    meadow.name='StarfallMeadow'; meadow.receiveShadow=true;
    transforms.forEach((matrix,i)=>{ meadow.setMatrixAt(i,matrix); meadow.setColorAt(i,new THREE.Color().setHSL(.19+random(i+41)*.07,.22+random(i+73)*.15,.46+random(i+97)*.18)); }); this.group.add(meadow);
  }
  private splitForest(mesh: THREE.Mesh, material: THREE.MeshStandardMaterial) {
    const source = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    source.applyMatrix4(mesh.matrixWorld);
    const position = source.getAttribute('position'), normal = source.getAttribute('normal'), uv = source.getAttribute('uv');
    const chunks = new Map<string, { p: number[]; n: number[]; uv: number[] }>();
    for (let i = 0; i < position.count; i += 3) {
      const x = (position.getX(i)+position.getX(i+1)+position.getX(i+2))/3;
      const z = (position.getZ(i)+position.getZ(i+1)+position.getZ(i+2))/3;
      const key = `${Math.floor(x/2)},${Math.floor(z/2)}`;
      let chunk = chunks.get(key); if (!chunk) { chunk = { p: [], n: [], uv: [] }; chunks.set(key, chunk); }
      for (let j = i; j < i+3; j++) { chunk.p.push(position.getX(j),position.getY(j),position.getZ(j)); chunk.n.push(normal.getX(j),normal.getY(j),normal.getZ(j)); chunk.uv.push(uv.getX(j),uv.getY(j)); }
    }
    source.dispose();
    for (const [key, chunk] of chunks) {
      const geometry = this.assets.own(new THREE.BufferGeometry());
      geometry.setAttribute('position',new THREE.Float32BufferAttribute(chunk.p,3)); geometry.setAttribute('normal',new THREE.Float32BufferAttribute(chunk.n,3)); geometry.setAttribute('uv',new THREE.Float32BufferAttribute(chunk.uv,2));
      // Continuous world-space variation avoids visible color seams between fade chunks.
      const colors = [], color = new THREE.Color();
      for (let i=0;i<chunk.p.length;i+=3) {
        const variation=.5+.5*Math.sin(chunk.p[i]*1.7+chunk.p[i+2]*2.3);
        const tip=Math.min(.08,chunk.p[i+1]*.02);
        color.setRGB(.83+variation*.1+tip,.91+tip,.76+variation*.13+tip);
        colors.push(color.r,color.g,color.b);
      }
      geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
      const tree = new THREE.Mesh(geometry,this.assets.own(material.clone())); tree.name=`StarfallCanopy-${key}`;
      tree.material.vertexColors=true;
      tree.castShadow=true; tree.receiveShadow=true; this.group.add(tree); this.occluders.push(tree);
    }
  }
  update(delta: number, settings: DisplaySettings) {
    if (!settings.reducedMotion) this.weatherTime += delta;
    this.waterTime.value = this.weatherTime;
    this.sky.material.uniforms.time.value = this.weatherTime;
    this.sky.material.uniforms.night.value = settings.timeOfDay !== 'day' ? 1 : 0;
    this.shafts.visible = settings.mist && settings.timeOfDay === 'day' && settings.quality !== 'low';
    this.lights.forEach(light => { light.intensity = settings.timeOfDay !== 'day' ? 5 : 6; });
  }
}
