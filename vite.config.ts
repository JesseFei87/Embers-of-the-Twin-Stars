import { defineConfig } from 'vite';

// The optional renderer must not trigger a late dependency scan and reload the current battle.
export default defineConfig({
  optimizeDeps: { include: ['phaser', 'three', 'three/addons/utils/BufferGeometryUtils.js', 'three/addons/loaders/GLTFLoader.js',
    'three/addons/postprocessing/EffectComposer.js', 'three/addons/postprocessing/RenderPass.js',
    'three/addons/postprocessing/OutputPass.js', 'three/addons/postprocessing/ShaderPass.js',
    'three/addons/postprocessing/UnrealBloomPass.js'] },
});
