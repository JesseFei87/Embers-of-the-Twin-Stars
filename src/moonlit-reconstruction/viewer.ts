import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createMoonlitCrescentAltarModel } from './createAltar';
const params=new URLSearchParams(location.search);
if(params.has('review'))document.body.classList.add('review');
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(1);renderer.setSize(innerWidth,innerHeight);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;document.body.prepend(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color('#111a2e');
const camera=new THREE.OrthographicCamera(-5,5,4,-4,.1,150);
const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,2,0);controls.enableDamping=true;controls.minZoom=.3;controls.maxZoom=5;
let interactive=false;controls.addEventListener('start',()=>{interactive=true});
scene.add(new THREE.HemisphereLight(0xbdd5ff,0x292537,2.1));
const key=new THREE.DirectionalLight(0xdde8ff,3.5);key.position.set(-7,12,8);key.castShadow=true;key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-8,right:8,top:10,bottom:-8,near:.1,far:45});key.shadow.bias=-.0002;scene.add(key);
const rim=new THREE.DirectionalLight(0x8d85c4,1.1);rim.position.set(4,4,-8);scene.add(rim);
const model=createMoonlitCrescentAltarModel({textureSize:128});scene.add(model);
const clay=new THREE.MeshStandardMaterial({color:0x969ca6,roughness:.87});
model.traverse(o=>{if(o instanceof THREE.Mesh){if(o.name==='root-visual'||o.name==='root')o.visible=false;else if(!params.has('material'))o.material=clay;}});
const ground=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:0x121b2d,roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=-.05;ground.receiveShadow=true;scene.add(ground);
function view(angle=0){interactive=false;controls.enabled=!params.has('review');const a=angle*Math.PI/180;camera.position.set(Math.sin(a)*13,7,Math.cos(a)*13);camera.lookAt(0,2,0);camera.zoom=1;const h=3.15;camera.left=-h*innerWidth/innerHeight;camera.right=h*innerWidth/innerHeight;camera.top=2+h;camera.bottom=2-h;camera.top=h;camera.bottom=-h;camera.updateProjectionMatrix();controls.target.set(0,2,0);renderer.render(scene,camera);}
view(Number(params.get('angle')||0));
const originals=new Map<THREE.Object3D,THREE.Vector3>();model.traverse(o=>{if(o instanceof THREE.Group&&o!==model)originals.set(o,o.position.clone());});let exploded=false;
function explode(){exploded=!exploded;for(const [o,p]of originals){o.position.copy(p);if(exploded)o.position.sub(new THREE.Vector3(0,2,0)).multiplyScalar(1.6).add(new THREE.Vector3(0,2,0));}camera.zoom=exploded?.7:1;camera.updateProjectionMatrix();document.querySelector('#explode')!.classList.toggle('active',exploded);}
document.querySelector('#explode')!.addEventListener('click',explode);document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b=>b.onclick=()=>view(Number(b.dataset.view)));document.querySelector('#reset')!.addEventListener('click',()=>{if(exploded)explode();view()});
const ray=new THREE.Raycaster();renderer.domElement.addEventListener('pointerdown',e=>{ray.setFromCamera(new THREE.Vector2(e.clientX/innerWidth*2-1,1-e.clientY/innerHeight*2),camera);const hit=ray.intersectObject(model,true)[0];document.querySelector('#part')!.textContent=hit?hit.object.parent?.name||hit.object.name:'';});
function geometry(){const meshes:any[]=[];model.updateMatrixWorld(true);model.traverse(o=>{if(o instanceof THREE.Mesh&&o.visible){const p=o.geometry.attributes.position;meshes.push({id:o.name,name:o.name,positions:Array.from(p.array),normals:Array.from(o.geometry.attributes.normal.array),indices:o.geometry.index?Array.from(o.geometry.index.array):null,matrixWorld:o.matrixWorld.toArray()});}});return {meshes};}
function mask(){scene.background=new THREE.Color('white');ground.visible=false;model.traverse(o=>{if(o instanceof THREE.Mesh)o.material=new THREE.MeshBasicMaterial({color:'black'});});renderer.render(scene,camera);}
function axial(name:string){interactive=false;camera.up.set(0,1,0);camera.position.set(15,2,0);if(name==='thickness-axis'){camera.position.set(0,16,0);camera.up.set(0,0,-1);}camera.lookAt(0,2,0);renderer.render(scene,camera);}
Object.assign(window,{moonlitReview:{view,axial,model,scene,camera,renderer,geometry,mask,stats:()=>({triangles:renderer.info.render.triangles,drawCalls:renderer.info.render.calls,parts:model.children.length})},__ready:true});
function loop(){requestAnimationFrame(loop);if(interactive)controls.update();renderer.render(scene,camera);}loop();
addEventListener('resize',()=>{renderer.setSize(innerWidth,innerHeight);view()});
