import * as THREE from 'three';
import type { SpriteKey } from '../contracts';
import { noxFrameCanvas, noxSpriteData } from '../../game/ui/noxSprite';
import type { MoonlitSpriteKey } from '../../game/ui/moonlitSprites';

// One registry owns one mounted scene; meshes borrow resources, never dispose them.
export class AssetRegistry {
  private resources = new Set<{ dispose(): void }>();
  private textures = new Map<string, Promise<THREE.Texture>>();
  private disposed = false;
  own<T extends { dispose(): void }>(resource: T): T {
    if (this.disposed) resource.dispose(); else this.resources.add(resource);
    return resource;
  }
  texture(sprite: SpriteKey | MoonlitSpriteKey, frame: number, starfall = false) {
    const url = starfall ? `/assets/starfall/animations/${sprite}/0${frame + 1}.png` : `/assets/hd2d/${sprite}/0${frame + 1}.png`;
    if (!this.textures.has(url)) this.textures.set(url, new THREE.TextureLoader().loadAsync(url).then(texture => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.magFilter = texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      return this.own(texture);
    }));
    return this.textures.get(url)!;
  }
  noxTexture(frame: number, starfall: boolean) {
    const sourceKey = noxSpriteData.image;
    if (!this.textures.has(sourceKey)) this.textures.set(sourceKey, new THREE.TextureLoader().loadAsync(sourceKey).then(texture => this.own(texture)));
    const key = `${sourceKey}#${starfall ? 'map' : 'classic'}-${frame}`;
    if (!this.textures.has(key)) this.textures.set(key, this.textures.get(sourceKey)!.then(source => {
      const texture = new THREE.CanvasTexture(noxFrameCanvas(source.image, frame, starfall ? 52 : 92));
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.magFilter = texture.minFilter = THREE.NearestFilter; texture.generateMipmaps = false;
      return this.own(texture);
    }));
    return this.textures.get(key)!;
  }
  dispose() { this.disposed = true; this.resources.forEach(resource => resource.dispose()); this.resources.clear(); this.textures.clear(); }
}
