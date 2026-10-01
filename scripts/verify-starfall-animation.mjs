import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
const temp = mkdtempSync(join(tmpdir(), 'starfall-animation-'));
try {
  const outfile = join(temp, 'view.mjs');
  await build({stdin:{resolveDir:process.cwd(),contents:"export * from './src/presentation/three/UnitSpriteView.ts'; export * from './src/presentation/three/AssetRegistry.ts'; export { Texture, TextureLoader } from 'three'; export * from './src/game/ui/noxSprite.ts'; export * from './src/game/ui/replica.ts'; export * from './src/presentation/visual-config/combatVisuals.ts';"},bundle:true,platform:'node',format:'esm',outfile});
  const { UnitSpriteView, AssetRegistry, Texture, TextureLoader, noxFrameLayout, noxSpriteData, cutoutPortraitUrl, mapSpriteMarkup, combatVisual } = await import(pathToFileURL(outfile));
  const { PerspectiveCamera, Vector3 } = await import('three');
  globalThis.document = {createElement:tag=>tag === 'canvas' ? {width:0,height:0,getContext:()=>({drawImage(){}})} : {dataset:{},style:{},querySelector:()=>({style:{}}),remove(){}}};
  TextureLoader.prototype.loadAsync = async function(url) { const t = new Texture(); t.image = {width:128,height:128}; t.userData.url = url; return t; };
  for (const sprite of ['sword','lancer','cavalry','mage','knight','raider']) {
    const assets = new AssetRegistry();
    const view = await UnitSpriteView.create({id:'test',sprite,feet:{x:0,y:0,z:0},hp:20,maxHp:20,name:sprite,team:'player',acted:false},assets,true);
    assert.equal(new Set(view.textures).size,6,`${sprite}: six distinct animation frames`);
    const geometry = view.body.geometry;
    for (const frame of [1,2,3,4,5,0]) {
      view.pose(frame);
      assert.equal(view.body.material.map,view.textures[frame]);
      assert.equal(view.body.material.emissiveMap,view.textures[frame], 'lighting follows the current silhouette');
      assert.equal(view.body.customDepthMaterial.map,view.textures[frame], 'shadow follows current silhouette');
      assert.equal(view.body.geometry,geometry,'no per-frame geometry resizing');
    }
    assert.equal(view.body.position.y,0,'idle restores foot anchor');
    // Screen proportions stay constant while orbiting and looking down at a unit.
    const camera=new PerspectiveCamera(35,1.6,.1,100);
    for(const yaw of [-.45,0,.45])for(const pitch of [.58,.9,1.05]){
      camera.position.set(Math.sin(yaw)*Math.sin(pitch)*12,Math.cos(pitch)*12,Math.cos(yaw)*Math.sin(pitch)*12);
      camera.lookAt(0,0,0);camera.updateMatrixWorld();view.billboard(camera,true);view.group.updateMatrixWorld(true);
      const project=p=>{const q=view.body.localToWorld(p).project(camera);q.x*=camera.aspect;q.z=0;return q;};
      const origin=project(new Vector3()),width=project(new Vector3(1,0,0)).distanceTo(origin),height=project(new Vector3(0,1,0)).distanceTo(origin);
      assert(Math.abs(width/height-1)<1e-6,'overhead camera must not squash a sprite');
      assert(view.body.localToWorld(new Vector3()).distanceTo(view.group.position)<1e-6,'foot anchor stays on its tile');
      assert.equal(view.ring.rotation.x,0,'contact ring does not tilt with the portrait');
    }
    const hashes = new Set();
    for (let frame=1;frame<=6;frame++) {
      const bytes=readFileSync(`public/assets/starfall/animations/${sprite}/0${frame}.png`);
      assert.equal(bytes.readUInt32BE(16),128);assert.equal(bytes.readUInt32BE(20),128);
      hashes.add(createHash('sha256').update(bytes).digest('hex'));
    }
    assert.equal(hashes.size,6,`${sprite}: poses are not copies of one bitmap`);
    view.dispose(); assets.dispose();
  }
  // Nox keeps her own scout identity on either team and in both render modes.
  assert.equal(combatVisual({sprite:'raider',magical:false}).style,'slash');
  for (const starfall of [false,true]) for (const team of ['enemy','player']) {
    const assets = new AssetRegistry();
    const nox = await UnitSpriteView.create({id:'e2',sprite:'raider',feet:{x:0,y:0,z:0},hp:17,maxHp:17,name:'诺克斯',team,acted:false},assets,starfall);
    const generic = await UnitSpriteView.create({id:'e3',sprite:'raider',feet:{x:0,y:0,z:0},hp:17,maxHp:17,name:'暮鸦',team:'enemy',acted:false},assets,starfall);
    const geometry = nox.body.geometry;
    assert.equal(new Set(nox.textures).size,6);
    for (let frame=0;frame<6;frame++) {
      const layout=noxFrameLayout(frame,starfall?52:92);
      assert(layout.x>=0 && layout.y>=0 && layout.x+layout.width<=128 && layout.y+layout.height<=128.0001,'every pose fits the normalized canvas');
      assert(Math.abs(layout.x+layout.source.footX*(starfall?52:92)/noxSpriteData.frames[0].height-64)<1e-6,'boot anchor stays centered');
      assert(Math.abs(layout.y+layout.height-128)<1e-6,'boots stay on the ground');
      assert.equal(nox.textures[frame].isCanvasTexture,true,'Nox uses her unique atlas');
      assert.match(generic.textures[frame].userData.url,/raider/,'ordinary scouts retain their hooded skin');
      nox.pose(frame);
      assert.equal(nox.body.geometry,geometry);
      assert.equal(nox.body.material.map,nox.textures[frame]);
      assert.equal(nox.body.customDepthMaterial.map,nox.textures[frame]);
      if(starfall) assert.equal(nox.body.material.emissiveMap,nox.textures[frame]);
    }
    nox.dispose(); generic.dispose(); assets.dispose();
  }
  for(const id of ['e1','e2','e3','e4','e5','c2e2','c2e3']) {
    const url=cutoutPortraitUrl({id}); assert(url,'requested portrait has a cutout mapping'); readFileSync(`public${url}`);
  }
  assert.match(mapSpriteMarkup({id:'e2'}),/nox\/sheet.png/,'recruited Nox roster preview uses her scout atlas');
  assert(!mapSpriteMarkup({id:'e2'}).includes('/mage/'));
  const assets=new AssetRegistry();
  const classic=await assets.texture('sword',2);
  assert.equal(classic.userData.url,'/assets/hd2d/sword/03.png');assets.dispose();
  console.log('PASS: Nox scout identity/anchors/recruitment, transparent portrait mappings, six distinct poses per character, fixed geometry/anchor, animated diffuse/emission/shadow maps, classic assets preserved.');
} finally { delete globalThis.document; rmSync(temp,{recursive:true,force:true}); }
