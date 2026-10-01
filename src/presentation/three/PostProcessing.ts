import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

export class PostProcessing {
  readonly composer: EffectComposer;
  private bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), .22, .35, 1.6);
  private output = new OutputPass();
  private depthTarget = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  private depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  private dof = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, depthMap: { value: null }, resolution: { value: new THREE.Vector2(1, 1) }, near: { value: .1 }, far: { value: 90 }, focus: { value: 18 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `#include <packing>
      varying vec2 vUv; uniform sampler2D tDiffuse, depthMap; uniform vec2 resolution; uniform float near, far, focus;
      float depth(vec2 uv){ return -perspectiveDepthToViewZ(unpackRGBAToDepth(texture2D(depthMap,uv)),near,far); }
      void main(){
        float d=depth(vUv); float blur=clamp((abs(d-focus)-3.0)*0.6,0.0,2.0);
        vec4 color=texture2D(tDiffuse,vUv); float weight=1.0;
        for(int i=0;i<8;i++){
          float angle=float(i)*0.785398; vec2 uv=vUv+vec2(cos(angle),sin(angle))*blur/resolution;
          // Reject samples across silhouettes; alpha-cutout actors have their actual depth.
          float w=1.0-smoothstep(0.25,1.2,abs(depth(uv)-d)); color+=texture2D(tDiffuse,uv)*w; weight+=w;
        }
        gl_FragColor=color/weight;
      }`,
  });
  readonly hdr: boolean;
  constructor(private gl: THREE.WebGLRenderer, private scene: THREE.Scene, private camera: THREE.PerspectiveCamera) {
    this.hdr = gl.extensions.has('EXT_color_buffer_float');
    const target = new THREE.WebGLRenderTarget(1, 1, { type: this.hdr ? THREE.HalfFloatType : THREE.UnsignedByteType });
    this.composer = new EffectComposer(gl, target);
    this.composer.addPass(new RenderPass(scene, camera)); this.composer.addPass(this.dof); this.composer.addPass(this.bloom); this.composer.addPass(this.output);
    this.dof.uniforms.depthMap.value = this.depthTarget.texture;
  }
  resize(width: number, height: number) { this.composer.setPixelRatio(1); this.composer.setSize(width, height); this.depthTarget.setSize(width, height); this.dof.uniforms.resolution.value.set(width, height); }
  render(bloom: boolean, dof: boolean, focus: THREE.Vector3) {
    this.bloom.enabled = bloom && this.hdr; this.dof.enabled = dof;
    if (dof) {
      this.dof.uniforms.focus.value = -focus.clone().applyMatrix4(this.camera.matrixWorldInverse).z;
      const restore: Array<() => void> = [];
      const background = this.scene.background, oldTarget = this.gl.getRenderTarget();
      const clear = this.gl.getClearColor(new THREE.Color()), alpha = this.gl.getClearAlpha();
      const shadows = this.gl.shadowMap.autoUpdate; this.gl.shadowMap.autoUpdate = false;
      try {
        this.scene.background = null;
        this.scene.traverse(object => {
          if (object instanceof THREE.Mesh) {
            const material = object.material;
            if (Array.isArray(material)) return;
            if (!material.visible || (material.transparent && !material.alphaTest)) {
              const visible = object.visible; object.visible = false; restore.push(() => { object.visible = visible; });
            } else {
              object.material = object.customDepthMaterial ?? this.depthMaterial; restore.push(() => { object.material = material; });
            }
          } else if (object instanceof THREE.Points || object instanceof THREE.LineSegments) {
            const visible = object.visible; object.visible = false; restore.push(() => { object.visible = visible; });
          }
        });
        this.gl.setRenderTarget(this.depthTarget); this.gl.setClearColor(0xffffff, 1); this.gl.clear(); this.gl.render(this.scene, this.camera);
      } finally { restore.forEach(fn => fn()); this.scene.background = background; this.gl.setClearColor(clear, alpha); this.gl.setRenderTarget(oldTarget); this.gl.shadowMap.autoUpdate = shadows; }
    }
    // Three r180 renders linear into offscreen targets; OutputPass applies ACES and sRGB once.
    this.composer.render();
  }
  dispose() { this.dof.dispose(); this.bloom.dispose(); this.output.dispose(); this.composer.dispose(); this.depthTarget.dispose(); this.depthMaterial.dispose(); }
}
