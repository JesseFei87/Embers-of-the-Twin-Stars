import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { DisplaySettings } from '../DisplaySettings';
import type { RenderSnapshot } from '../contracts';
import { AssetRegistry } from './AssetRegistry';
import { tileGeometry } from './TerrainView';

const noise = `float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1)),f.x),f.y);}`;
const noise3 = `float hash3(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
float noise3(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(hash3(i),hash3(i+vec3(1,0,0)),f.x),mix(hash3(i+vec3(0,1,0)),hash3(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash3(i+vec3(0,0,1)),hash3(i+vec3(1,0,1)),f.x),mix(hash3(i+vec3(0,1,1)),hash3(i+vec3(1)),f.x),f.y),f.z);}`;
const vertex = `varying vec2 vUv;varying vec3 world;void main(){vUv=uv;world=(modelMatrix*vec4(position,1.)).xyz*2.;gl_Position=projectionMatrix*viewMatrix*vec4(world*.5,1.);}`;
const output = `
#include <tonemapping_fragment>
#include <colorspace_fragment>
`;
interface MoonlitLayout { lamps: number[][]; waterfalls: Array<{x:number;z:number;top:number;bottom:number;width:number}> }

/** Runtime effects around the exact authored Blender/Godot environment, at half scale. */
export class MoonlitEnvironment {
  readonly group = new THREE.Group();
  readonly picks: THREE.Mesh[] = [];
  readonly occluders: THREE.Mesh[] = [];
  private time = { value: 0 };
  private moonDirection = { value: new THREE.Vector3(-.6,-.3,-.7).normalize() };
  private skyAligned = false;
  private flames: THREE.Mesh[] = [];
  private lights: THREE.PointLight[] = [];
  private mist = new THREE.Group();
  private constructor(private assets: AssetRegistry, snapshot: RenderSnapshot) {
    this.group.name = 'MoonlitImportedEnvironment';
    const invisible = assets.own(new THREE.MeshBasicMaterial({ visible:false }));
    for (const tile of snapshot.tiles) {
      const pick = new THREE.Mesh(assets.own(tileGeometry(tile,.025)),invisible);
      pick.userData.tileId=tile.id; this.picks.push(pick); this.group.add(pick);
    }
  }
  static async create(snapshot: RenderSnapshot, assets: AssetRegistry) {
    const view = new MoonlitEnvironment(assets,snapshot);
    const [gltf,layout] = await Promise.all([
      new GLTFLoader().loadAsync('/assets/moonlit/environment.glb'),
      fetch('/assets/moonlit/layout.json').then(r=>{if(!r.ok)throw new Error('月影峡道布局加载失败');return r.json() as Promise<MoonlitLayout>;}),
    ]);
    gltf.scene.scale.setScalar(.5); gltf.scene.updateMatrixWorld(true);
    const textures=new Set<THREE.Texture>();
    gltf.scene.traverse(object=>{
      if (!(object instanceof THREE.Mesh)) return;
      assets.own(object.geometry);
      const materials=(Array.isArray(object.material)?object.material:[object.material]) as THREE.MeshStandardMaterial[];
      object.material=materials.map(material=>{
        assets.own(material);
        for(const value of Object.values(material))if(value instanceof THREE.Texture)textures.add(value);
        material.roughness=.92;
        if(material.name.startsWith('distant_panorama_')) {
          const haze=[.30,.56,.76][Number(material.name.slice(-1))];
          return assets.own(new THREE.ShaderMaterial({side:THREE.DoubleSide,transparent:true,depthWrite:false,vertexShader:vertex,
            uniforms:{map:{value:material.map},haze:{value:haze}},
            fragmentShader:`varying vec2 vUv;uniform sampler2D map;uniform float haze;void main(){vec4 c=texture2D(map,vUv);float edge=smoothstep(0.,.24,vUv.y)*smoothstep(0.,.035,vUv.x)*smoothstep(0.,.035,1.-vUv.x);gl_FragColor=vec4(mix(c.rgb*.64,vec3(.024,.047,.087),haze),c.a*edge);${output}}`,
          }));
        }
        if(/bough/.test(material.name)){material.side=THREE.DoubleSide;material.alphaTest=.45;}
        if(/fern|petals|flowers|needles/.test(material.name))material.side=THREE.DoubleSide;
        if(/moonlit_basalt/.test(material.name)) {
          material.map=null;
          material.onBeforeCompile=shader=>{
            shader.vertexShader='varying vec3 rockWorld;varying vec3 rockNormal;\n'+shader.vertexShader;
            shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nrockWorld=(modelMatrix*vec4(position,1.)).xyz*2.;rockNormal=normalize(mat3(modelMatrix)*normal);');
            shader.fragmentShader=`varying vec3 rockWorld;varying vec3 rockNormal;${noise3}\n`+shader.fragmentShader;
            shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
              vec3 p=rockWorld;float broad=noise3(p*vec3(.65,.42,.65));
              float joints=abs(sin((p.x+p.z*.77)*2.3+noise3(p*1.2)*1.5+p.y*.17));
              float fissure=(1.-smoothstep(.018,.078,joints))*smoothstep(.36,.69,noise3(p*2.1));
              float grain=hash3(floor(p*80.));float damp=(1.-smoothstep(-2.,1.2,p.y))*.35;
              vec3 rock=mix(vec3(.11,.135,.17),vec3(.25,.28,.32),broad)*(.88+.09*grain)*(1.-fissure*.58);
              float moss=smoothstep(.58,.76,noise3(p*1.7))*smoothstep(.45,.86,rockNormal.y);
              diffuseColor.rgb=mix(rock,vec3(.045,.067,.036),moss*.6)*(1.-damp);`);
          };
        }
        return material;
      });
      if(!Array.isArray(object.geometry.groups)||object.geometry.groups.length===0)object.material=object.material[0];
      object.castShadow=!/panorama|meadow|fern/i.test(object.name);object.receiveShadow=true;
      if(materials.some(m=>/bough/.test(m.name)))view.splitCanopy(object,materials[0]);
    });
    // Extended orbit can see beyond the original side walls. Reuse their rock
    // geometry outside the board to cover the outer ground edge at steep angles.
    const outerCliffs: THREE.Mesh[]=[];
    gltf.scene.traverse(object=>{
      if(!(object instanceof THREE.Mesh)||!/^(West|East)[ _]canyon[ _]wall/.test(object.name))return;
      const extension=object.clone();extension.name=`${object.name}-outer-ridge`;
      extension.position.x+=object.name.startsWith('West')?-8:8;extension.position.y-=3;
      outerCliffs.push(extension);
    });
    gltf.scene.add(...outerCliffs);
    textures.forEach(t=>assets.own(t)); view.group.add(gltf.scene);
    view.addEffects(layout);
    return view;
  }
  // Batched trees must fade locally, never turn the whole forest transparent.
  private splitCanopy(mesh: THREE.Mesh, material: THREE.MeshStandardMaterial) {
    const source=mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry.clone();source.applyMatrix4(mesh.matrixWorld);
    const p=source.getAttribute('position'),n=source.getAttribute('normal'),uv=source.getAttribute('uv');
    const chunks=new Map<string,{p:number[];n:number[];uv:number[]}>();
    for(let i=0;i<p.count;i+=3){
      const key=`${Math.floor((p.getX(i)+p.getX(i+1)+p.getX(i+2))/6)},${Math.floor((p.getZ(i)+p.getZ(i+1)+p.getZ(i+2))/6)}`;
      if(!chunks.has(key))chunks.set(key,{p:[],n:[],uv:[]});const c=chunks.get(key)!;
      for(let j=i;j<i+3;j++){c.p.push(p.getX(j),p.getY(j),p.getZ(j));c.n.push(n.getX(j),n.getY(j),n.getZ(j));c.uv.push(uv.getX(j),uv.getY(j));}
    }
    source.dispose();mesh.visible=false;
    for(const [key,c] of chunks){
      const geometry=this.assets.own(new THREE.BufferGeometry());
      geometry.setAttribute('position',new THREE.Float32BufferAttribute(c.p,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(c.n,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(c.uv,2));
      const tree=new THREE.Mesh(geometry,this.assets.own(material.clone()));tree.name=`MoonlitCanopy-${key}`;tree.castShadow=true;tree.receiveShadow=true;
      this.occluders.push(tree);this.group.add(tree);
    }
  }
  private effect(fragment: string, extra: Record<string,THREE.IUniform>={}, transparent=false) {
    return this.assets.own(new THREE.ShaderMaterial({vertexShader:vertex,fragmentShader:`varying vec2 vUv;varying vec3 world;uniform float time;${noise}\n${fragment}`,
      uniforms:{time:this.time,...extra},side:THREE.DoubleSide,transparent,depthWrite:!transparent}));
  }
  private plane(name:string,width:number,height:number,position:THREE.Vector3,material:THREE.Material,horizontal=false) {
    const geometry=this.assets.own(new THREE.PlaneGeometry(width*.5,height*.5));if(horizontal)geometry.rotateX(-Math.PI/2);
    const mesh=new THREE.Mesh(geometry,material);mesh.name=name;mesh.position.copy(position).multiplyScalar(.5);this.group.add(mesh);return mesh;
  }
  private addEffects(layout:MoonlitLayout) {
    const river=this.effect(`void main(){vec2 p=world.xz+vec2(-time*.8,time*.13);float n=noise(p*5.);float ripple=sin(p.x*15.+sin(p.y*7.)*2.5+n*2.);
      float sparkle=smoothstep(.96,.995,ripple)*smoothstep(.69,.88,n);float banks=1.-smoothstep(0.,.55,min(abs(world.z+2.6),abs(world.z-.55)));
      float foam=smoothstep(.67,.85,noise(p*vec2(2.4,5.)))*banks;vec3 c=mix(vec3(.025,.12,.23),vec3(.12,.37,.55),n*.55)+vec3(.44,.66,.8)*sparkle*.4;
      gl_FragColor=vec4(mix(c,vec3(.40,.63,.73),foam*.75),1.);${output}}`);
    this.plane('MainRiver',32,8,new THREE.Vector3(0,-1.25,-1),river,true);
    this.plane('WestRavine',9,17,new THREE.Vector3(-14,-1.3,-4),river,true);
    const waterfall=this.effect(`void main(){vec2 uv=vec2(vUv.x,1.-vUv.y);float y=uv.y;float fringe=.055+.012*sin(y*14.)+.010*sin(y*31.);
      float edge=smoothstep(fringe,fringe+.12,uv.x)*(1.-smoothstep(1.-fringe-.12,1.-fringe,uv.x))*smoothstep(0.,.075,y)*(1.-smoothstep(.80,1.,y));
      float bend=.42*sin(y*7.)+.22*sin(y*17.);float strands=noise(vec2(uv.x*38.+bend,y*2.5-time*.5));float fine=noise(vec2(uv.x*105.,y*3.-time*1.15));
      float rivulets=smoothstep(.38,.79,strands);float glints=pow(.5+.5*sin(y*40.-time*23.+uv.x*19.),10.)*fine;
      gl_FragColor=vec4(mix(vec3(.035,.11,.16),vec3(.39,.58,.66),.14+rivulets*.46+fine*.10+glints*.10),edge*(.12+rivulets*.42+fine*.10));${output}}`,{},true);
    const splash=this.effect(`void main(){float radius=length((vUv-.5)*2.);float edge=1.-smoothstep(.35,.96,radius);float foam=noise(vec2(vUv.x*12.,vUv.y*10.-time*.35));gl_FragColor=vec4(.24,.42,.53,edge*(.1+foam*.24));${output}}`,{},true);
    for(const [i,f] of layout.waterfalls.entries()){
      this.plane(`Waterfall${i}`,f.width,f.top-f.bottom,new THREE.Vector3(f.x,(f.top+f.bottom)*.5,f.z),waterfall);
      this.plane(`WaterfallFoam${i}`,f.width*1.6,1.15,new THREE.Vector3(f.x,f.bottom+.05,f.z+.35),splash,true);
    }
    for(const [i,[x,y,z]] of layout.lamps.entries()){
      const light=new THREE.PointLight(0xffa041,6,2.15,2);light.position.set(x*.5,(y+.2)*.5,z*.5);this.lights.push(light);this.group.add(light);
      const fire=this.effect(`uniform float seed;void main(){vec2 uv=vUv;float sway=sin(uv.y*7.-time*7.+seed)*.07*uv.y;float shape=1.-smoothstep(.04,.38*(1.-uv.y)+.01,abs(uv.x-.5+sway));float a=shape*smoothstep(0.,.13,uv.y)*(1.-smoothstep(.62,1.,uv.y));gl_FragColor=vec4(mix(vec3(3.,.22,.01),vec3(4.,2.3,.5),1.-uv.y),a);${output}}`,{seed:{value:i*1.73}},true);
      this.flames.push(this.plane(`Flame${i}`,.52,.88,new THREE.Vector3(x,y+.33,z),fire));
    }
    const altar=new THREE.PointLight(0xa674ff,2,2.7,2);altar.position.set(3.5,1.05,-3.5);this.group.add(altar);
    const sky=this.assets.own(new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,
      uniforms:{time:this.time,moonDirection:this.moonDirection},vertexShader:'varying vec3 direction;void main(){direction=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:`varying vec3 direction;uniform vec3 moonDirection;uniform float time;${noise}${noise3}
      void main(){vec3 ray=normalize(direction);vec2 sphere=vec2(atan(ray.z,ray.x),asin(ray.y));float nebula=noise(sphere*8.)*.6+noise(sphere*21.)*.4;
      vec3 c=mix(vec3(.002,.006,.017),vec3(.012,.027,.065),nebula);vec2 grid=sphere*vec2(320.,260.),cell=floor(grid),f=fract(grid);
      float star=(1.-smoothstep(.008,.07,length(f-vec2(hash(cell+13.),hash(cell+49.))*.64-.18)))*step(.91,hash(cell+97.));c+=vec3(.55,.66,.85)*star;
      vec3 moon=moonDirection;vec3 right=normalize(cross(moon,vec3(0,1,0)));vec3 up=normalize(cross(right,moon));vec2 uv=vec2(dot(ray,right),dot(ray,up));
      float facing=step(.9,dot(ray,moon));float crescent=(1.-smoothstep(.016,.0166,length(uv)))*smoothstep(.0156,.0163,length(uv-vec2(.008,.004)))*facing;
      c+=vec3(.62,.76,1.)*crescent*1.6;
      vec3 p=ray*vec3(4.5,10.,4.5)+vec3(time*.010,0.,time*.004);float field=noise3(p)*.58+noise3(p*2.07)*.28+noise3(p*4.19)*.14;
      c=mix(c,mix(vec3(.025,.04,.075),vec3(.12,.17,.25),field),smoothstep(.47,.72,field)*.66);gl_FragColor=vec4(c,1.);${output}}`,
    }));
    const dome=new THREE.Mesh(this.assets.own(new THREE.SphereGeometry(165,32,16)),sky);dome.renderOrder=-10;this.group.add(dome);
    const fog=this.effect(`void main(){float a=exp(-dot((vUv-.5)*4.,(vUv-.5)*4.))*(.4+noise(world.xz*.3+time*.03)*.6)*.12;gl_FragColor=vec4(.19,.28,.40,a);${output}}`,{},true);
    for(const [x,y,z,w,h] of [[-14,-.5,-15,12,32],[0,-15,-35,140,50],[0,-.9,-1,26,4]]){
      const mesh=this.plane('RavineMist',w,h,new THREE.Vector3(x,y,z),fog,true);this.group.remove(mesh);this.mist.add(mesh);
    }
    this.group.add(this.mist);
  }
  update(delta:number,settings:DisplaySettings,camera?:THREE.Camera) {
    if(!settings.reducedMotion)this.time.value+=delta;
    if(camera&&!this.skyAligned) {
      const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(-.85,.912),camera);
      ray.ray.intersectSphere(new THREE.Sphere(new THREE.Vector3(),165),this.moonDirection.value);
      this.moonDirection.value.normalize();this.skyAligned=true;
    }
    if(camera)for(const flame of this.flames)flame.quaternion.copy(camera.quaternion);
    this.mist.visible=settings.mist;
    this.lights.forEach((light,i)=>light.intensity=5.6+Math.sin(this.time.value*6+i)*.35);
  }
}
