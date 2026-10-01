import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type ProceduralModelOptions = {
  wireframe?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  textureSize?: number;
  textureAnisotropy?: number;
  qualityPriority?: 'reference-fidelity' | 'balanced';
};

export type ProceduralModelRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

type SculptMaterialSpec = Record<string, any>;

// bevelEnabled defaults to true on THREE.ExtrudeGeometry and rounds every
// corner — sharp/pointed profiles (blades, fork tines, spikes) need
// bevelEnabled: false plus lineTo()-only path segments near the tip, since a
// curve command cannot produce a true converging point.
function buildExtrudeShape(points: [number, number][], holes?: [number, number][][]): THREE.Shape {
  const shape = new THREE.Shape();
  if (points.length > 0) {
    shape.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i += 1) {
      shape.lineTo(points[i][0], points[i][1]);
    }
  }
  // Cutouts (e.g. an oval wire-cutter hole) as THREE.Path added to shape.holes —
  // dep-free boolean subtraction via the tessellator, no CSG library needed.
  for (const loop of holes ?? []) {
    if (loop.length < 3) continue;
    const path = new THREE.Path();
    path.moveTo(loop[0][0], loop[0][1]);
    for (let i = 1; i < loop.length; i += 1) path.lineTo(loop[i][0], loop[i][1]);
    path.closePath();
    shape.holes.push(path);
  }
  return shape;
}

// Build an N-gon oval loop (for hole authoring from a compact {cx,cy,rx,ry} descriptor).
function ovalLoop(cx: number, cy: number, rx: number, ry: number, seg = 24): [number, number][] {
  const loop: [number, number][] = [];
  for (let i = 0; i < seg; i += 1) {
    const a = (i / seg) * Math.PI * 2;
    loop.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return loop;
}

function buildExtrudeGeometry(profile: { points: [number, number][]; depth: number; holes?: [number, number][][]; ovalHoles?: { cx: number; cy: number; rx: number; ry: number }[] }): THREE.ExtrudeGeometry {
  const holes = [...(profile.holes ?? []), ...((profile.ovalHoles ?? []).map((o) => ovalLoop(o.cx, o.cy, o.rx, o.ry)))];
  const shape = buildExtrudeShape(profile.points, holes);
  return new THREE.ExtrudeGeometry(shape, {
    depth: profile.depth,
    bevelEnabled: false,
    steps: 1,
  });
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readLayerNumber(value: unknown, keys: string[], fallback: number): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      if (typeof record[key] === 'number') return record[key] as number;
    }
  }
  return fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-f]{3}$/i.test(hex)
    ? '#' + hex.slice(1).split('').map((part) => part + part).join('')
    : hex;
  const value = /^#[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized.slice(1), 16) : 0x8a7a5f;
  return [clampAlbedoChannel((value >> 16) & 255), clampAlbedoChannel((value >> 8) & 255), clampAlbedoChannel(value & 255)];
}

function materialPalette(spec: SculptMaterialSpec): string[] {
  const palette = spec.colorVariation?.palette;
  if (Array.isArray(palette) && palette.length > 0) return palette.filter((value) => typeof value === 'string');
  const secondary = spec.albedo?.secondary;
  const colors = [spec.baseColor ?? spec.color ?? spec.albedo?.dominant, ...(Array.isArray(secondary) ? secondary : [])];
  return colors.filter((value): value is string => typeof value === 'string' && value.startsWith('#'));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampAlbedoChannel(value: number): number {
  return Math.max(30, Math.min(240, Math.round(value)));
}

function clampPbrF0(value: number): number {
  return Math.max(0.02, Math.min(1, value));
}

function clampPbrIor(value: number): number {
  return Math.max(1, Math.min(2.5, value));
}

function clampPbrMetalness(value: number): number {
  return value >= 0.5 ? 1 : 0;
}

function clampedAlbedoColor(spec: SculptMaterialSpec): THREE.Color {
  const source = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  // setStyle with an explicit SRGBColorSpace, NOT the numeric constructor.
  //
  // `new THREE.Color(r, g, b)` treats its arguments as LINEAR working-space components,
  // while an authored `baseColor` hex is sRGB. Feeding one to the other skipped the
  // transfer function and lifted every dark albedo: #2e2a28, authored as a near-black
  // vinyl, rendered at roughly sRGB 0.46 — a mid grey. The error is largest exactly where
  // it matters most, because the transfer curve is steepest near black.
  return new THREE.Color().setStyle(source, THREE.SRGBColorSpace);
}

function smoothCurve(value: number): number {
  return value * value * (3 - 2 * value);
}

function periodicHash(x: number, y: number, seed: number, periodX: number, periodY: number): number {
  const wrappedX = ((x % periodX) + periodX) % periodX;
  const wrappedY = ((y % periodY) + periodY) % periodY;
  let value = Math.imul(wrappedX + seed * 17, 374761393) ^ Math.imul(wrappedY + seed * 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function periodicValueNoise(u: number, v: number, seed: number, periodX: number, periodY: number): number {
  const x = u * periodX;
  const y = v * periodY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothCurve(x - x0);
  const ty = smoothCurve(y - y0);
  const a = periodicHash(x0, y0, seed, periodX, periodY);
  const b = periodicHash(x0 + 1, y0, seed, periodX, periodY);
  const c = periodicHash(x0, y0 + 1, seed, periodX, periodY);
  const d = periodicHash(x0 + 1, y0 + 1, seed, periodX, periodY);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
}

type SurfaceBand = {
  frequency: number;
  amplitude: number;
  stretchX: number;
  stretchY: number;
  ridge: boolean;
};

function surfaceBands(spec: SculptMaterialSpec): SurfaceBand[] {
  const source = Array.isArray(spec.surfaceFrequencyBands) ? spec.surfaceFrequencyBands : [];
  const parsed = source.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const band = item as Record<string, unknown>;
    const frequency = typeof band.frequency === 'number' ? band.frequency : 0;
    const amplitude = typeof band.amplitude === 'number' ? band.amplitude : 0;
    if (frequency <= 0 || amplitude <= 0) return [];
    const stretch = Array.isArray(band.stretch) ? band.stretch : [1, 1];
    const description = `${String(band.pattern ?? '')} ${String(band.role ?? '')}`.toLowerCase();
    return [{
      frequency,
      amplitude,
      stretchX: typeof stretch[0] === 'number' ? Math.max(0.1, stretch[0]) : 1,
      stretchY: typeof stretch[1] === 'number' ? Math.max(0.1, stretch[1]) : 1,
      ridge: /(ridge|groove|grain|fiber|striated|crack)/.test(description),
    }];
  });
  return parsed.length > 0 ? parsed : [
    { frequency: 2, amplitude: 0.42, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 12, amplitude: 0.22, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 56, amplitude: 0.08, stretchX: 1, stretchY: 1, ridge: false },
  ];
}

function sampleSurface(u: number, v: number, bands: SurfaceBand[], seed: number): number {
  let value = 0;
  let weight = 0;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    const periodX = Math.max(1, Math.round(band.frequency * band.stretchX));
    const periodY = Math.max(1, Math.round(band.frequency * band.stretchY));
    let sample = periodicValueNoise(u, v, seed + index * 1013, periodX, periodY);
    if (band.ridge) sample = 1 - Math.abs(sample * 2 - 1);
    value += sample * band.amplitude;
    weight += band.amplitude;
  }
  return weight > 0 ? clamp01(value / weight) : 0.5;
}

function mixPalette(colors: [number, number, number][], value: number): [number, number, number] {
  if (colors.length === 1) return colors[0];
  const scaled = clamp01(value) * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const a = colors[index];
  const b = colors[index + 1];
  return [
    Math.round(THREE.MathUtils.lerp(a[0], b[0], mix)),
    Math.round(THREE.MathUtils.lerp(a[1], b[1], mix)),
    Math.round(THREE.MathUtils.lerp(a[2], b[2], mix)),
  ];
}

type ColorGradientStop = { offset: number; color: string };
type ColorGradientSpec = {
  type: 'linear' | 'radial';
  axis: [number, number];
  stops: ColorGradientStop[];
};

function parseRgba(value: string): [number, number, number] {
  const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
  if (!match) return [138, 122, 95];
  return [clampAlbedoChannel(Number(match[1])), clampAlbedoChannel(Number(match[2])), clampAlbedoChannel(Number(match[3]))];
}

// Analytical per-pixel gradient sample. The extraction schema's colorGradient carries
// exact rgba(...) stop colors (see extract_part_color_recipe.py), so this samples the
// same trend directly in JS math rather than round-tripping through a Canvas 2D
// createLinearGradient/createRadialGradient object — same visual result, and it composes
// directly with the existing noise/height-correlated colorVariation blend below.
function sampleColorGradient(gradient: ColorGradientSpec, u: number, v: number): [number, number, number] {
  const stops = gradient.stops.length >= 2 ? gradient.stops : [{ offset: 0, color: 'rgba(138,122,95,1)' }, { offset: 1, color: 'rgba(138,122,95,1)' }];
  let t: number;
  if (gradient.type === 'radial') {
    const [cx, cy] = gradient.axis;
    const dx = u - cx;
    const dy = v - cy;
    const maxRadius = Math.max(0.001, Math.hypot(Math.max(cx, 1 - cx), Math.max(cy, 1 - cy)));
    t = clamp01(Math.hypot(dx, dy) / maxRadius);
  } else {
    const [ax, ay] = gradient.axis;
    const projection = (u - 0.5) * ax + (v - 0.5) * ay;
    const maxProjection = 0.5 * (Math.abs(ax) + Math.abs(ay)) || 0.5;
    t = clamp01(projection / maxProjection + 0.5);
  }
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.max(0, Math.floor(scaled)));
  const mix = scaled - index;
  const a = parseRgba(stops[index].color);
  const b = parseRgba(stops[index + 1].color);
  return [
    THREE.MathUtils.lerp(a[0], b[0], mix),
    THREE.MathUtils.lerp(a[1], b[1], mix),
    THREE.MathUtils.lerp(a[2], b[2], mix),
  ];
}

function writePixel(data: Uint8ClampedArray, offset: number, red: number, green: number, blue: number): void {
  data[offset] = Math.max(0, Math.min(255, Math.round(red)));
  data[offset + 1] = Math.max(0, Math.min(255, Math.round(green)));
  data[offset + 2] = Math.max(0, Math.min(255, Math.round(blue)));
  data[offset + 3] = 255;
}

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function createMapTexture(
  canvas: HTMLCanvasElement,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [2, 2];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 2,
    typeof repeat[1] === 'number' ? repeat[1] : 2,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

type ProceduralTextureSet = {
  albedo: THREE.Texture;
  roughness: THREE.Texture;
  height: THREE.Texture;
  normal: THREE.Texture;
  ao: THREE.Texture;
  source: 'reference-pixel-extraction' | 'procedural';
};

function referenceMapUrl(spec: SculptMaterialSpec, channel: string): string | null {
  const reference = spec.referencePbr;
  if (!reference || typeof reference !== 'object') return null;
  if (reference.usable === false) return null;
  const confidence = typeof reference.confidence === 'number'
    ? reference.confidence
    : (typeof reference.estimatedFidelity === 'number' ? reference.estimatedFidelity : 0);
  const threshold = typeof reference.targetThreshold === 'number' ? reference.targetThreshold : 0.7;
  if (confidence < threshold) return null;
  const maps = reference.maps;
  if (!maps || typeof maps !== 'object') return null;
  const map = (maps as Record<string, unknown>)[channel];
  if (!map || typeof map !== 'object') return null;
  const record = map as Record<string, unknown>;
  const url = typeof record.url === 'string' && record.url.trim() ? record.url : record.path;
  return typeof url === 'string' && url.trim() ? url : null;
}

function createLoadedMapTexture(
  url: string,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [1, 1];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 1,
    typeof repeat[1] === 'number' ? repeat[1] : 1,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

function makeReferenceTextureSet(spec: SculptMaterialSpec, options: ProceduralModelOptions): ProceduralTextureSet | null {
  const albedo = referenceMapUrl(spec, 'albedo');
  const roughness = referenceMapUrl(spec, 'roughness');
  const height = referenceMapUrl(spec, 'height');
  const normal = referenceMapUrl(spec, 'normal');
  const ao = referenceMapUrl(spec, 'ao');
  if (!albedo || !roughness || !height || !normal || !ao) return null;
  return {
    albedo: createLoadedMapTexture(albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createLoadedMapTexture(roughness, THREE.NoColorSpace, spec, options),
    height: createLoadedMapTexture(height, THREE.NoColorSpace, spec, options),
    normal: createLoadedMapTexture(normal, THREE.NoColorSpace, spec, options),
    ao: createLoadedMapTexture(ao, THREE.NoColorSpace, spec, options),
    source: 'reference-pixel-extraction',
  };
}

function makeProceduralTextureSet(
  id: string,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): ProceduralTextureSet | null {
  if (typeof document === 'undefined') return null;
  const qualityFirst = (options.qualityPriority ?? 'reference-fidelity') === 'reference-fidelity';
  const requested = options.textureSize ?? spec.textureResolution;
  const requestedSize = typeof requested === 'number' && Number.isFinite(requested)
    ? requested
    : (qualityFirst ? 1024 : 512);
  const size = Math.max(256, Math.min(2048, 2 ** Math.round(Math.log2(requestedSize))));
  const canvases = {
    albedo: makeCanvas(size),
    roughness: makeCanvas(size),
    height: makeCanvas(size),
    normal: makeCanvas(size),
    ao: makeCanvas(size),
  };
  const contexts = {
    albedo: canvases.albedo.getContext('2d'),
    roughness: canvases.roughness.getContext('2d'),
    height: canvases.height.getContext('2d'),
    normal: canvases.normal.getContext('2d'),
    ao: canvases.ao.getContext('2d'),
  };
  if (!contexts.albedo || !contexts.roughness || !contexts.height || !contexts.normal || !contexts.ao) return null;
  const images = {
    albedo: contexts.albedo.createImageData(size, size),
    roughness: contexts.roughness.createImageData(size, size),
    height: contexts.height.createImageData(size, size),
    normal: contexts.normal.createImageData(size, size),
    ao: contexts.ao.createImageData(size, size),
  };
  const seed = hashString(id);
  const bands = surfaceBands(spec);
  const heightField = new Float32Array(size * size);
  const roughnessField = new Float32Array(size * size);
  const palette = materialPalette(spec);
  const fallback = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  const colors = (palette.length >= 2 ? palette : [fallback, '#6E614B', '#A08F70']).map(hexToRgb);
  const baseRoughness = clamp01(readLayerNumber(spec.roughness, ['base'], 0.76));
  const roughnessVariation = clamp01(readLayerNumber(spec.roughness, ['variation'], 0.18));
  const colorAmplitude = clamp01(readLayerNumber(spec.colorVariation, ['amplitude', 'variation'], 0.18));
  const heightCorrelation = clamp01(readLayerNumber(spec.colorVariation, ['heightCorrelation'], 0.3));
  const colorGradient: ColorGradientSpec | undefined = spec.colorGradient;
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const index = y * size + x;
      const height = sampleSurface(u, v, bands, seed + 101);
      const roughNoise = sampleSurface(u, v, bands, seed + 7001);
      const colorNoise = sampleSurface(u, v, bands, seed + 15013);
      heightField[index] = height;
      roughnessField[index] = clamp01(baseRoughness + (roughNoise - 0.5) * roughnessVariation * 2);
      let color: [number, number, number];
      if (colorGradient) {
        // Evidence-derived spatial gradient (Plan 1.3 Workstream C) takes priority
        // over the noise-based palette blend below — it is a measured trend, not a guess.
        color = sampleColorGradient(colorGradient, u, v);
      } else {
        const paletteValue = clamp01(
          0.5 + (colorNoise - 0.5) * colorAmplitude * 2 + (height - 0.5) * heightCorrelation
        );
        color = mixPalette(colors, paletteValue);
      }
      writePixel(images.albedo.data, index * 4, color[0], color[1], color[2]);
    }
  }
  const normalStrength = Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35));
  const aoStrength = clamp01(readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35));
  for (let y = 0; y < size; y += 1) {
    const up = ((y - 1 + size) % size) * size;
    const down = ((y + 1) % size) * size;
    for (let x = 0; x < size; x += 1) {
      const left = (x - 1 + size) % size;
      const right = (x + 1) % size;
      const index = y * size + x;
      const center = heightField[index];
      const dx = (heightField[y * size + right] - heightField[y * size + left]) * normalStrength * 6;
      const dy = (heightField[down + x] - heightField[up + x]) * normalStrength * 6;
      const inverseLength = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const normalX = -dx * inverseLength;
      const normalY = -dy * inverseLength;
      const normalZ = inverseLength;
      const neighborAverage = (
        heightField[y * size + left] + heightField[y * size + right]
        + heightField[up + x] + heightField[down + x]
      ) * 0.25;
      const cavity = Math.max(0, neighborAverage - center);
      const ao = clamp01(1 - aoStrength * (cavity * 12 + (1 - center) * 0.16));
      const offset = index * 4;
      const heightByte = center * 255;
      const roughnessByte = roughnessField[index] * 255;
      writePixel(images.height.data, offset, heightByte, heightByte, heightByte);
      writePixel(images.roughness.data, offset, roughnessByte, roughnessByte, roughnessByte);
      writePixel(
        images.normal.data, offset,
        (normalX * 0.5 + 0.5) * 255,
        (normalY * 0.5 + 0.5) * 255,
        (normalZ * 0.5 + 0.5) * 255,
      );
      writePixel(images.ao.data, offset, ao * 255, ao * 255, ao * 255);
    }
  }
  contexts.albedo.putImageData(images.albedo, 0, 0);
  contexts.roughness.putImageData(images.roughness, 0, 0);
  contexts.height.putImageData(images.height, 0, 0);
  contexts.normal.putImageData(images.normal, 0, 0);
  contexts.ao.putImageData(images.ao, 0, 0);
  return {
    albedo: createMapTexture(canvases.albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createMapTexture(canvases.roughness, THREE.NoColorSpace, spec, options),
    height: createMapTexture(canvases.height, THREE.NoColorSpace, spec, options),
    normal: createMapTexture(canvases.normal, THREE.NoColorSpace, spec, options),
    ao: createMapTexture(canvases.ao, THREE.NoColorSpace, spec, options),
    source: 'procedural',
  };
}

function createSculptMaterial(id: string, spec: SculptMaterialSpec, options: ProceduralModelOptions, denseComponent = false): THREE.MeshPhysicalMaterial {
  // A material that declares -- with evidence -- that its subject carries no texture
  // detail gets NO texture set. Synthesising one anyway is not a harmless default: the
  // branch below then forces color to white and roughness to 1 and reads both from the
  // generated maps, so the authored albedo and the reference-derived roughness are both
  // discarded, and the model gains mottling the reference does not have. Measured on the
  // tuxedo cat, whose black fur rendered as speckled grey-and-white from a palette that
  // only ever described two flat regions.
  const textureless = (spec.textureless as { declared?: boolean } | undefined)?.declared === true;
  const textures = textureless
    ? null
    : makeReferenceTextureSet(spec, options) ?? makeProceduralTextureSet(id, spec, options);
  const material = new THREE.MeshPhysicalMaterial({
    color: textures ? 0xffffff : clampedAlbedoColor(spec),
    roughness: textures ? 1 : clamp01(readLayerNumber(spec.roughness, ['base'], 0.76)),
    metalness: clampPbrMetalness(readLayerNumber(spec.metalness, ['base'], 0.0)),
    clearcoat: clamp01(readLayerNumber(spec.clearcoat, ['base', 'amount'], 0)),
    clearcoatRoughness: clamp01(readLayerNumber(spec.clearcoatRoughness, ['base'], 0.25)),
    transmission: clamp01(readLayerNumber(spec.transmission, ['base', 'amount'], 0)),
    ior: clampPbrIor(readLayerNumber(spec.ior, ['base', 'value'], 1.5)),
    thickness: Math.max(0, readLayerNumber(spec.thickness, ['base', 'amount'], 0)),
    attenuationDistance: Math.max(0.001, readLayerNumber(spec.attenuationDistance, ['base', 'value'], Infinity)),
    attenuationColor: new THREE.Color(typeof spec.attenuationColor === 'string' ? spec.attenuationColor : '#ffffff'),
    sheen: clamp01(readLayerNumber(spec.sheen, ['base', 'amount'], 0)),
    sheenColor: new THREE.Color(typeof spec.sheenColor === 'string' ? spec.sheenColor : '#ffffff'),
    sheenRoughness: clamp01(readLayerNumber(spec.sheenRoughness, ['base'], 1.0)),
    iridescence: clamp01(readLayerNumber(spec.iridescence, ['base', 'amount'], 0)),
    iridescenceIOR: clampPbrIor(readLayerNumber(spec.iridescenceIOR, ['base', 'value'], 1.3)),
    anisotropy: clamp01(readLayerNumber(spec.anisotropy, ['base', 'amount'], 0)),
    anisotropyRotation: readLayerNumber(spec.anisotropy, ['rotation'], 0),
    specularIntensity: clampPbrF0(readLayerNumber(spec.specularF0 ?? spec.f0 ?? spec.specularIntensity, ['base', 'value'], 1.0)),
    specularColor: new THREE.Color(typeof spec.specularColor === 'string' ? spec.specularColor : '#ffffff'),
    emissive: new THREE.Color(typeof spec.emissive === 'string' ? spec.emissive : '#000000'),
    emissiveIntensity: Math.max(0, readLayerNumber(spec.emissiveIntensity, ['base'], 1.0)),
    opacity: clamp01(readLayerNumber(spec.opacity, ['base'], 1)),
    transparent: readLayerNumber(spec.transmission, ['base', 'amount'], 0) > 0 || readLayerNumber(spec.opacity, ['base'], 1) < 1,
    alphaTest: Math.max(0, readLayerNumber(spec.alpha, ['cutoff', 'alphaTest'], 0)),
    wireframe: options.wireframe ?? false,
    side: spec.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide,
    flatShading: spec.flatShading === true,
  });
  if (textures) {
    material.map = textures.albedo;
    material.roughnessMap = textures.roughness;
    material.normalMap = textures.normal;
    material.normalScale.setScalar(Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35)));
    material.aoMap = textures.ao;
    material.aoMap.channel = 0;
    material.aoMapIntensity = readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35);
    const denseMesh = denseComponent || spec.denseMesh === true || spec.geometryDensity === 'dense' || spec.topologyClass === 'dense';
    const bumpScale = Math.max(0, readLayerNumber(spec.bump, ['amplitude', 'strength'], 0));
    const effectiveBumpScale = denseMesh ? Math.max(0.05, bumpScale) : bumpScale;
    if (effectiveBumpScale > 0) {
      material.bumpMap = textures.height;
      material.bumpScale = effectiveBumpScale;
    }
    const displacementScale = Math.max(0, readLayerNumber(spec.displacement, ['amplitude', 'strength'], 0));
    const effectiveDisplacementScale = denseMesh ? Math.max(0.005, displacementScale) : displacementScale;
    if (effectiveDisplacementScale > 0) {
      material.displacementMap = textures.height;
      material.displacementScale = effectiveDisplacementScale;
      material.displacementBias = -effectiveDisplacementScale * 0.5;
    }
  }
  material.envMapIntensity = readLayerNumber(spec, ['envMapIntensity'], 0.8);
  material.userData.sculptMaterial = spec;
  material.userData.proceduralMapsIndependent = true;
  material.userData.pbrConstraints = { albedoRange: [30, 240], binaryMetalness: true, f0Range: [0.02, 1], iorRange: [1, 2.5] };
  material.userData.pbrTextureSource = textures?.source ?? 'flat-fallback';
  material.userData.referencePbr = spec.referencePbr ?? null;
  material.userData.referenceMaterialId = spec.referenceMaterialId ?? spec.materialReference?.profileId ?? null;
  material.userData.materialEvidence = spec.materialEvidence ?? null;
  material.userData.validationViews = spec.materialReference?.validationViews ?? [];
  material.needsUpdate = true;
  return material;
}

type AttachmentEndpoint = {
  start: THREE.Vector3;
  midpoint: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
  baseRadius: number;
  endRadius: number;
};

function readVector3(value: unknown, fallback: [number, number, number]): THREE.Vector3 {
  if (Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number')) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function makeAttachmentEndpoint(attachment: unknown): AttachmentEndpoint | null {
  if (!attachment || typeof attachment !== 'object') return null;
  const record = attachment as Record<string, unknown>;
  const start = readVector3(record.localStart, [0, 0, 0]);
  const end = readVector3(record.localEnd, [0, 1, 0]);
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length <= 0.0001) return null;
  const direction = delta.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  const baseRadius = Math.max(0.005, readNumber(record.baseRadius, 0.06));
  const endRadius = Math.max(0.003, readNumber(record.endRadius, baseRadius * 0.55));
  return {
    start,
    midpoint: delta.multiplyScalar(0.5),
    quaternion,
    length,
    baseRadius,
    endRadius,
  };
}

// Generated from ObjectSculptSpec target: Moonlit crescent altar
// Sculpt build pass: structural-pass
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createMoonlitCrescentAltarModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Moonlit crescent altar";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 28, "aspect": 1.2926829268292683, "orientation": {"yaw": 0.0, "pitch": 0.0, "roll": 0.0}, "positionHint": [0.5, 5.8, 12.5], "note": "High oblique front; cropped reference retains torchlight and background. Rear inferred."}, "approximationNotes": []};
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["stone"] = createSculptMaterial(
    "stone",
    {"id": "stone", "name": "stone", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#6c7182", "color": "#6c7182", "albedo": {"dominant": "#6c7182", "secondary": ["#4e5361", "#8a909e"], "samplingNotes": "Reference appearance under blue moonlight; neutral albedo inferred, not measured inverse rendering."}, "colorVariation": {"palette": ["#6c7182", "#555b69", "#9295a2"], "pattern": "mottled", "amplitude": 0.19, "heightCorrelation": 0.3}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.89, "variation": 0.15, "map": "independent-procedural-field", "localResponse": "higher roughness in cavities, lower roughness on worn edges"}, "metalness": {"base": 0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.22, "scale": 25, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.18, "scratches": [], "chips": []}, "dirt": {"amount": 0.15, "cavityBias": 0.8, "color": "#2F2A22"}, "localOverrides": [{"id": "stone-lichen", "region": "lower stone and sheltered joints", "color": "#596354", "roughness": 0.97, "dirtAmount": 0.17, "cavityBias": 0.8, "evidenceRefs": ["altar-crop"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Independent procedural mineral albedo, roughness and height; source illumination is not a baked texture.", "referencePbr": {"sourceImage": "/Users/jessefei/Documents/ChatGPT/Sanjiaozhou/.img2threejs/moonlit-kit/references/stone-surface.png", "confidence": 0.809, "verdict": "pass", "usable": true, "maps": {"albedo": {"path": "/Users/jessefei/Documents/ChatGPT/Sanjiaozhou/.img2threejs/moonlit-kit/material-evidence/stone/stone_albedo.png", "url": "stone_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/Users/jessefei/Documents/ChatGPT/Sanjiaozhou/.img2threejs/moonlit-kit/material-evidence/stone/stone_roughness.png", "url": "stone_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/Users/jessefei/Documents/ChatGPT/Sanjiaozhou/.img2threejs/moonlit-kit/material-evidence/stone/stone_height.png", "url": "stone_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/Users/jessefei/Documents/ChatGPT/Sanjiaozhou/.img2threejs/moonlit-kit/material-evidence/stone/stone_normal.png", "url": "stone_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/Users/jessefei/Documents/ChatGPT/Sanjiaozhou/.img2threejs/moonlit-kit/material-evidence/stone/stone_ao.png", "url": "stone_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "limitation": "single-image PBR extraction is an estimate; 70%+ extraction confidence still needs render screenshot review"}},
    options
  );
  materialMap["dark-stone"] = createSculptMaterial(
    "dark-stone",
    {"id": "dark-stone", "name": "dark-stone", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#424853", "color": "#424853", "albedo": {"dominant": "#424853", "secondary": ["#4e5361", "#8a909e"], "samplingNotes": "Reference appearance under blue moonlight; neutral albedo inferred, not measured inverse rendering."}, "colorVariation": {"palette": ["#424853", "#555b69", "#9295a2"], "pattern": "mottled", "amplitude": 0.19, "heightCorrelation": 0.3}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.94, "variation": 0.15, "map": "independent-procedural-field", "localResponse": "higher roughness in cavities, lower roughness on worn edges"}, "metalness": {"base": 0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.22, "scale": 25, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.18, "scratches": [], "chips": []}, "dirt": {"amount": 0.15, "cavityBias": 0.8, "color": "#2F2A22"}, "localOverrides": [{"id": "dark-stone-lichen", "region": "lower stone and sheltered joints", "color": "#596354", "roughness": 0.97, "dirtAmount": 0.17, "cavityBias": 0.8, "evidenceRefs": ["altar-crop"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Independent procedural mineral albedo, roughness and height; source illumination is not a baked texture.", "referencePbr": {"sourceImage": "/Users/jessefei/Documents/ChatGPT/Sanjiaozhou/.img2threejs/moonlit-kit/references/dark-stone-surface.png", "confidence": 0.777, "verdict": "pass", "usable": true, "maps": {"albedo": {"path": "/Users/jessefei/Documents/ChatGPT/Sanjiaozhou/.img2threejs/moonlit-kit/material-evidence/dark-stone/dark-stone_albedo.png", "url": "dark-stone_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/Users/jessefei/Documents/ChatGPT/Sanjiaozhou/.img2threejs/moonlit-kit/material-evidence/dark-stone/dark-stone_roughness.png", "url": "dark-stone_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/Users/jessefei/Documents/ChatGPT/Sanjiaozhou/.img2threejs/moonlit-kit/material-evidence/dark-stone/dark-stone_height.png", "url": "dark-stone_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/Users/jessefei/Documents/ChatGPT/Sanjiaozhou/.img2threejs/moonlit-kit/material-evidence/dark-stone/dark-stone_normal.png", "url": "dark-stone_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/Users/jessefei/Documents/ChatGPT/Sanjiaozhou/.img2threejs/moonlit-kit/material-evidence/dark-stone/dark-stone_ao.png", "url": "dark-stone_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "limitation": "single-image PBR extraction is an estimate; 70%+ extraction confidence still needs render screenshot review"}},
    options
  );
  materialMap["moon-silver"] = createSculptMaterial(
    "moon-silver",
    {"id": "moon-silver", "name": "moon-silver", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#adb8cc", "color": "#adb8cc", "albedo": {"dominant": "#adb8cc", "secondary": ["#4e5361", "#8a909e"], "samplingNotes": "Reference appearance under blue moonlight; neutral albedo inferred, not measured inverse rendering."}, "colorVariation": {"palette": ["#adb8cc", "#555b69", "#9295a2"], "pattern": "mottled", "amplitude": 0.19, "heightCorrelation": 0.3}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.55, "variation": 0.15, "map": "independent-procedural-field", "localResponse": "higher roughness in cavities, lower roughness on worn edges"}, "metalness": {"base": 0.18, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.22, "scale": 25, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.18, "scratches": [], "chips": []}, "dirt": {"amount": 0.15, "cavityBias": 0.8, "color": "#2F2A22"}, "localOverrides": [{"id": "moon-silver-lichen", "region": "lower stone and sheltered joints", "color": "#596354", "roughness": 0.97, "dirtAmount": 0.17, "cavityBias": 0.8, "evidenceRefs": ["altar-crop"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Independent procedural mineral albedo, roughness and height; source illumination is not a baked texture.", "referencePbr": {"sourceImage": "/Users/jessefei/Documents/ChatGPT/Sanjiaozhou/.img2threejs/moonlit-kit/references/moon-silver-surface.png", "confidence": 0.759, "verdict": "pass", "usable": true, "maps": {"albedo": {"path": "/Users/jessefei/Documents/ChatGPT/Sanjiaozhou/.img2threejs/moonlit-kit/material-evidence/moon-silver/moon-silver_albedo.png", "url": "moon-silver_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/Users/jessefei/Documents/ChatGPT/Sanjiaozhou/.img2threejs/moonlit-kit/material-evidence/moon-silver/moon-silver_roughness.png", "url": "moon-silver_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/Users/jessefei/Documents/ChatGPT/Sanjiaozhou/.img2threejs/moonlit-kit/material-evidence/moon-silver/moon-silver_height.png", "url": "moon-silver_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/Users/jessefei/Documents/ChatGPT/Sanjiaozhou/.img2threejs/moonlit-kit/material-evidence/moon-silver/moon-silver_normal.png", "url": "moon-silver_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/Users/jessefei/Documents/ChatGPT/Sanjiaozhou/.img2threejs/moonlit-kit/material-evidence/moon-silver/moon-silver_ao.png", "url": "moon-silver_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "limitation": "single-image PBR extraction is an estimate; 70%+ extraction confidence still needs render screenshot review"}},
    options
  );
  materialMap["violet"] = createSculptMaterial(
    "violet",
    {"id": "violet", "name": "violet", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#604777", "color": "#604777", "albedo": {"dominant": "#604777", "secondary": ["#4e5361", "#8a909e"], "samplingNotes": "Reference appearance under blue moonlight; neutral albedo inferred, not measured inverse rendering."}, "colorVariation": {"palette": ["#604777", "#555b69", "#9295a2"], "pattern": "mottled", "amplitude": 0.19, "heightCorrelation": 0.3}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.72, "variation": 0.15, "map": "independent-procedural-field", "localResponse": "higher roughness in cavities, lower roughness on worn edges"}, "metalness": {"base": 0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.22, "scale": 25, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.18, "scratches": [], "chips": []}, "dirt": {"amount": 0.15, "cavityBias": 0.8, "color": "#2F2A22"}, "localOverrides": [{"id": "violet-lichen", "region": "lower stone and sheltered joints", "color": "#596354", "roughness": 0.97, "dirtAmount": 0.17, "cavityBias": 0.8, "evidenceRefs": ["altar-crop"]}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Independent procedural mineral albedo, roughness and height; source illumination is not a baked texture.", "referencePbr": {"sourceImage": "/Users/jessefei/Documents/ChatGPT/Sanjiaozhou/.img2threejs/moonlit-kit/references/violet-surface.png", "confidence": 0.758, "verdict": "pass", "usable": true, "maps": {"albedo": {"path": "/Users/jessefei/Documents/ChatGPT/Sanjiaozhou/.img2threejs/moonlit-kit/material-evidence/violet/violet_albedo.png", "url": "violet_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/Users/jessefei/Documents/ChatGPT/Sanjiaozhou/.img2threejs/moonlit-kit/material-evidence/violet/violet_roughness.png", "url": "violet_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/Users/jessefei/Documents/ChatGPT/Sanjiaozhou/.img2threejs/moonlit-kit/material-evidence/violet/violet_height.png", "url": "violet_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/Users/jessefei/Documents/ChatGPT/Sanjiaozhou/.img2threejs/moonlit-kit/material-evidence/violet/violet_normal.png", "url": "violet_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/Users/jessefei/Documents/ChatGPT/Sanjiaozhou/.img2threejs/moonlit-kit/material-evidence/violet/violet_ao.png", "url": "violet_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "limitation": "single-image PBR extraction is an estimate; 70%+ extraction confidence still needs render screenshot review"}},
    options
  );
  materialMap["hidden"] = createSculptMaterial(
    "hidden",
    {"id": "hidden", "name": "invisible root", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#8A7A5F", "color": "#8A7A5F", "albedo": {"dominant": "#8A7A5F", "secondary": ["#6E614B", "#A08F70"], "samplingNotes": "Use image-observed local color zones, not a single averaged color."}, "colorVariation": {"palette": ["#8A7A5F", "#6E614B", "#A08F70"], "pattern": "mottled", "amplitude": 0.15, "heightCorrelation": 0.3}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.75, "variation": 0.15, "map": "independent-procedural-field", "localResponse": "higher roughness in cavities, lower roughness on worn edges"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "opacity": 0, "transparent": true, "qualityTier": "utility"},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const endpoint_root_0 = makeAttachmentEndpoint(null);
  const node_root_0 = new THREE.Group();
  node_root_0.name = "root__pivot";
  node_root_0.scale.set(1, 1, 1);
  if (endpoint_root_0) {
    node_root_0.position.copy(endpoint_root_0.start);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_root_0.position.set(0.0, 0.0, 0.0);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_root_0.userData.sculptComponent = {"id": "root", "name": "root", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides"}, "parent": null, "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "root", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(138, 122, 95, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_root_0.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "root", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}};
  (nodes["root"] ?? root).add(node_root_0);
  nodes["root"] = node_root_0;
  const mesh_root_0Geometry = endpoint_root_0
    ? new THREE.CylinderGeometry(endpoint_root_0.endRadius, endpoint_root_0.baseRadius, endpoint_root_0.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_root_0) {
    mesh_root_0Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_root_0 = new THREE.Mesh(
    mesh_root_0Geometry,
    materialMap["hidden"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_root_0.name = "root";
  if (endpoint_root_0) {
    mesh_root_0.position.copy(endpoint_root_0.midpoint);
    mesh_root_0.quaternion.copy(endpoint_root_0.quaternion);
  }
  mesh_root_0.castShadow = options.castShadow ?? true;
  mesh_root_0.receiveShadow = options.receiveShadow ?? true;
  mesh_root_0.userData.sculptComponent = {"id": "root", "name": "root", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides"}, "parent": null, "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "root", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"}}, "material": "hidden", "materialLayers": ["hidden"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(138, 122, 95, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_root_0.add(mesh_root_0);
  meshes["root"] = mesh_root_0;
  colliders["root"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_root_0);

  const endpoint_terrace_0_1 = makeAttachmentEndpoint(null);
  const node_terrace_0_1 = new THREE.Group();
  node_terrace_0_1.name = "terrace-0__pivot";
  node_terrace_0_1.scale.set(1, 1, 1);
  if (endpoint_terrace_0_1) {
    node_terrace_0_1.position.copy(endpoint_terrace_0_1.start);
    node_terrace_0_1.rotation.set(-1.5707963267948966, 0.0, 0.0);
  } else {
    node_terrace_0_1.position.set(0.0, 0.0, 0.0);
    node_terrace_0_1.rotation.set(-1.5707963267948966, 0.0, 0.0);
  }
  node_terrace_0_1.userData.sculptComponent = {"id": "terrace-0", "name": "terrace-0", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides", "profile2D": {"points": [[3.25, 0.0], [3.23435036168464, 0.318555706071072], [3.187552161310499, 0.6340435465524168], [3.1100560911296786, 0.9434252010770026], [3.002608480661682, 1.2437211551865417], [2.866244109132154, 1.5320393946844924], [2.702276239983272, 1.805603257313707], [2.5122839734288953, 2.061778173531848], [2.29809703885628, 2.2980970388562794], [2.061778173531848, 2.5122839734288953], [1.8056032573137075, 2.702276239983272], [1.5320393946844928, 2.8662441091321536], [1.243721155186542, 3.002608480661682], [0.9434252010770026, 3.1100560911296786], [0.6340435465524171, 3.187552161310499], [0.31855570607107253, 3.2343503616846396], [1.9900510486144489e-16, 3.25], [-0.3185557060710721, 3.23435036168464], [-0.6340435465524166, 3.187552161310499], [-0.943425201077002, 3.110056091129679], [-1.2437211551865417, 3.002608480661682], [-1.5320393946844926, 2.866244109132154], [-1.8056032573137064, 2.7022762399832723], [-2.0617781735318474, 2.5122839734288958], [-2.2980970388562794, 2.29809703885628], [-2.5122839734288953, 2.061778173531848], [-2.7022762399832723, 1.805603257313707], [-2.8662441091321536, 1.532039394684493], [-3.002608480661682, 1.2437211551865421], [-3.1100560911296786, 0.9434252010770028], [-3.187552161310499, 0.634043546552418], [-3.2343503616846396, 0.3185557060710727], [-3.25, 3.9801020972288977e-16], [-3.23435036168464, -0.3185557060710719], [-3.187552161310499, -0.6340435465524171], [-3.110056091129679, -0.9434252010770019], [-3.0026084806616824, -1.2437211551865415], [-2.866244109132154, -1.5320393946844924], [-2.7022762399832727, -1.8056032573137064], [-2.5122839734288958, -2.061778173531847], [-2.29809703885628, -2.2980970388562794], [-2.061778173531849, -2.512283973428894], [-1.805603257313707, -2.702276239983272], [-1.5320393946844932, -2.8662441091321536], [-1.2437211551865437, -3.002608480661681], [-0.9434252010770029, -3.1100560911296786], [-0.6340435465524181, -3.1875521613104985], [-0.3185557060710715, -3.23435036168464], [-5.970153145843346e-16, -3.25], [0.3185557060710703, -3.23435036168464], [0.634043546552417, -3.187552161310499], [0.9434252010770017, -3.110056091129679], [1.2437211551865426, -3.0026084806616815], [1.5320393946844921, -2.866244109132154], [1.805603257313706, -2.7022762399832727], [2.0617781735318483, -2.512283973428895], [2.298097038856279, -2.29809703885628], [2.512283973428894, -2.0617781735318492], [2.702276239983272, -1.805603257313707], [2.866244109132153, -1.5320393946844935], [3.002608480661681, -1.2437211551865437], [3.1100560911296786, -0.9434252010770031], [3.1875521613104985, -0.6340435465524183], [3.23435036168464, -0.31855570607107164]], "depth": 0.25}}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0.0, 0], "rotation": [-1.5707963267948966, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "terrace-0", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tread-edge-0", "type": "bevel", "geometryEffect": "chamfer 0.018m on worn stair nose", "confidence": 0.85}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_terrace_0_1.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "terrace-0", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}};
  (nodes["root"] ?? root).add(node_terrace_0_1);
  nodes["terrace-0"] = node_terrace_0_1;
  const mesh_terrace_0_1Geometry = endpoint_terrace_0_1
    ? new THREE.CylinderGeometry(endpoint_terrace_0_1.endRadius, endpoint_terrace_0_1.baseRadius, endpoint_terrace_0_1.length, 32, 12)
    : buildExtrudeGeometry({"points": [[3.25, 0.0], [3.23435036168464, 0.318555706071072], [3.187552161310499, 0.6340435465524168], [3.1100560911296786, 0.9434252010770026], [3.002608480661682, 1.2437211551865417], [2.866244109132154, 1.5320393946844924], [2.702276239983272, 1.805603257313707], [2.5122839734288953, 2.061778173531848], [2.29809703885628, 2.2980970388562794], [2.061778173531848, 2.5122839734288953], [1.8056032573137075, 2.702276239983272], [1.5320393946844928, 2.8662441091321536], [1.243721155186542, 3.002608480661682], [0.9434252010770026, 3.1100560911296786], [0.6340435465524171, 3.187552161310499], [0.31855570607107253, 3.2343503616846396], [1.9900510486144489e-16, 3.25], [-0.3185557060710721, 3.23435036168464], [-0.6340435465524166, 3.187552161310499], [-0.943425201077002, 3.110056091129679], [-1.2437211551865417, 3.002608480661682], [-1.5320393946844926, 2.866244109132154], [-1.8056032573137064, 2.7022762399832723], [-2.0617781735318474, 2.5122839734288958], [-2.2980970388562794, 2.29809703885628], [-2.5122839734288953, 2.061778173531848], [-2.7022762399832723, 1.805603257313707], [-2.8662441091321536, 1.532039394684493], [-3.002608480661682, 1.2437211551865421], [-3.1100560911296786, 0.9434252010770028], [-3.187552161310499, 0.634043546552418], [-3.2343503616846396, 0.3185557060710727], [-3.25, 3.9801020972288977e-16], [-3.23435036168464, -0.3185557060710719], [-3.187552161310499, -0.6340435465524171], [-3.110056091129679, -0.9434252010770019], [-3.0026084806616824, -1.2437211551865415], [-2.866244109132154, -1.5320393946844924], [-2.7022762399832727, -1.8056032573137064], [-2.5122839734288958, -2.061778173531847], [-2.29809703885628, -2.2980970388562794], [-2.061778173531849, -2.512283973428894], [-1.805603257313707, -2.702276239983272], [-1.5320393946844932, -2.8662441091321536], [-1.2437211551865437, -3.002608480661681], [-0.9434252010770029, -3.1100560911296786], [-0.6340435465524181, -3.1875521613104985], [-0.3185557060710715, -3.23435036168464], [-5.970153145843346e-16, -3.25], [0.3185557060710703, -3.23435036168464], [0.634043546552417, -3.187552161310499], [0.9434252010770017, -3.110056091129679], [1.2437211551865426, -3.0026084806616815], [1.5320393946844921, -2.866244109132154], [1.805603257313706, -2.7022762399832727], [2.0617781735318483, -2.512283973428895], [2.298097038856279, -2.29809703885628], [2.512283973428894, -2.0617781735318492], [2.702276239983272, -1.805603257313707], [2.866244109132153, -1.5320393946844935], [3.002608480661681, -1.2437211551865437], [3.1100560911296786, -0.9434252010770031], [3.1875521613104985, -0.6340435465524183], [3.23435036168464, -0.31855570607107164]], "depth": 0.25});
  if (!endpoint_terrace_0_1) {
    mesh_terrace_0_1Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_terrace_0_1 = new THREE.Mesh(
    mesh_terrace_0_1Geometry,
    materialMap["stone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_terrace_0_1.name = "terrace-0";
  if (endpoint_terrace_0_1) {
    mesh_terrace_0_1.position.copy(endpoint_terrace_0_1.midpoint);
    mesh_terrace_0_1.quaternion.copy(endpoint_terrace_0_1.quaternion);
  }
  mesh_terrace_0_1.castShadow = options.castShadow ?? true;
  mesh_terrace_0_1.receiveShadow = options.receiveShadow ?? true;
  mesh_terrace_0_1.userData.sculptComponent = {"id": "terrace-0", "name": "terrace-0", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides", "profile2D": {"points": [[3.25, 0.0], [3.23435036168464, 0.318555706071072], [3.187552161310499, 0.6340435465524168], [3.1100560911296786, 0.9434252010770026], [3.002608480661682, 1.2437211551865417], [2.866244109132154, 1.5320393946844924], [2.702276239983272, 1.805603257313707], [2.5122839734288953, 2.061778173531848], [2.29809703885628, 2.2980970388562794], [2.061778173531848, 2.5122839734288953], [1.8056032573137075, 2.702276239983272], [1.5320393946844928, 2.8662441091321536], [1.243721155186542, 3.002608480661682], [0.9434252010770026, 3.1100560911296786], [0.6340435465524171, 3.187552161310499], [0.31855570607107253, 3.2343503616846396], [1.9900510486144489e-16, 3.25], [-0.3185557060710721, 3.23435036168464], [-0.6340435465524166, 3.187552161310499], [-0.943425201077002, 3.110056091129679], [-1.2437211551865417, 3.002608480661682], [-1.5320393946844926, 2.866244109132154], [-1.8056032573137064, 2.7022762399832723], [-2.0617781735318474, 2.5122839734288958], [-2.2980970388562794, 2.29809703885628], [-2.5122839734288953, 2.061778173531848], [-2.7022762399832723, 1.805603257313707], [-2.8662441091321536, 1.532039394684493], [-3.002608480661682, 1.2437211551865421], [-3.1100560911296786, 0.9434252010770028], [-3.187552161310499, 0.634043546552418], [-3.2343503616846396, 0.3185557060710727], [-3.25, 3.9801020972288977e-16], [-3.23435036168464, -0.3185557060710719], [-3.187552161310499, -0.6340435465524171], [-3.110056091129679, -0.9434252010770019], [-3.0026084806616824, -1.2437211551865415], [-2.866244109132154, -1.5320393946844924], [-2.7022762399832727, -1.8056032573137064], [-2.5122839734288958, -2.061778173531847], [-2.29809703885628, -2.2980970388562794], [-2.061778173531849, -2.512283973428894], [-1.805603257313707, -2.702276239983272], [-1.5320393946844932, -2.8662441091321536], [-1.2437211551865437, -3.002608480661681], [-0.9434252010770029, -3.1100560911296786], [-0.6340435465524181, -3.1875521613104985], [-0.3185557060710715, -3.23435036168464], [-5.970153145843346e-16, -3.25], [0.3185557060710703, -3.23435036168464], [0.634043546552417, -3.187552161310499], [0.9434252010770017, -3.110056091129679], [1.2437211551865426, -3.0026084806616815], [1.5320393946844921, -2.866244109132154], [1.805603257313706, -2.7022762399832727], [2.0617781735318483, -2.512283973428895], [2.298097038856279, -2.29809703885628], [2.512283973428894, -2.0617781735318492], [2.702276239983272, -1.805603257313707], [2.866244109132153, -1.5320393946844935], [3.002608480661681, -1.2437211551865437], [3.1100560911296786, -0.9434252010770031], [3.1875521613104985, -0.6340435465524183], [3.23435036168464, -0.31855570607107164]], "depth": 0.25}}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0.0, 0], "rotation": [-1.5707963267948966, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "terrace-0", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tread-edge-0", "type": "bevel", "geometryEffect": "chamfer 0.018m on worn stair nose", "confidence": 0.85}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_terrace_0_1.add(mesh_terrace_0_1);
  meshes["terrace-0"] = mesh_terrace_0_1;
  colliders["terrace-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["terrace-0"] ??= [];
  destructionGroups["terrace-0"].push(node_terrace_0_1);

  const endpoint_terrace_1_2 = makeAttachmentEndpoint(null);
  const node_terrace_1_2 = new THREE.Group();
  node_terrace_1_2.name = "terrace-1__pivot";
  node_terrace_1_2.scale.set(1, 1, 1);
  if (endpoint_terrace_1_2) {
    node_terrace_1_2.position.copy(endpoint_terrace_1_2.start);
    node_terrace_1_2.rotation.set(-1.5707963267948966, 0.0, 0.0);
  } else {
    node_terrace_1_2.position.set(0.0, 0.25, 0.0);
    node_terrace_1_2.rotation.set(-1.5707963267948966, 0.0, 0.0);
  }
  node_terrace_1_2.userData.sculptComponent = {"id": "terrace-1", "name": "terrace-1", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides", "profile2D": {"points": [[2.97, 0.0], [2.955698638216425, 0.29111090677879503], [2.9129322827975948, 0.5794182563879009], [2.8421127971246603, 0.8621454914457531], [2.743922211558522, 1.1365697941243167], [2.619306155114615, 1.4000483083732131], [2.4694647485385595, 1.6500435920682186], [2.295841046487329, 1.8841480539660271], [2.1001071401240465, 2.100107140124046], [1.8841480539660271, 2.295841046487329], [1.6500435920682188, 2.4694647485385595], [1.4000483083732136, 2.6193061551146144], [1.136569794124317, 2.743922211558522], [0.8621454914457531, 2.8421127971246603], [0.5794182563879012, 2.9129322827975948], [0.29111090677879553, 2.9556986382164245], [1.8186004967338196e-16, 2.97], [-0.29111090677879514, 2.955698638216425], [-0.5794182563879008, 2.9129322827975948], [-0.8621454914457527, 2.8421127971246607], [-1.1365697941243165, 2.743922211558522], [-1.4000483083732131, 2.619306155114615], [-1.650043592068218, 2.46946474853856], [-1.884148053966027, 2.2958410464873293], [-2.100107140124046, 2.1001071401240465], [-2.295841046487329, 1.8841480539660271], [-2.46946474853856, 1.6500435920682186], [-2.6193061551146144, 1.4000483083732138], [-2.743922211558522, 1.1365697941243171], [-2.8421127971246603, 0.8621454914457534], [-2.9129322827975948, 0.579418256387902], [-2.9556986382164245, 0.2911109067787957], [-2.97, 3.637200993467639e-16], [-2.955698638216425, -0.291110906778795], [-2.9129322827975948, -0.5794182563879012], [-2.8421127971246607, -0.8621454914457525], [-2.7439222115585222, -1.1365697941243165], [-2.619306155114615, -1.4000483083732131], [-2.4694647485385604, -1.650043592068218], [-2.2958410464873293, -1.8841480539660265], [-2.100107140124047, -2.100107140124046], [-1.8841480539660282, -2.295841046487328], [-1.6500435920682186, -2.4694647485385595], [-1.4000483083732138, -2.6193061551146144], [-1.1365697941243185, -2.7439222115585213], [-0.8621454914457535, -2.8421127971246603], [-0.5794182563879021, -2.9129322827975943], [-0.29111090677879453, -2.955698638216425], [-5.455801490201459e-16, -2.97], [0.2911109067787935, -2.955698638216425], [0.5794182563879011, -2.9129322827975948], [0.8621454914457524, -2.8421127971246607], [1.1365697941243174, -2.7439222115585213], [1.400048308373213, -2.619306155114615], [1.6500435920682175, -2.4694647485385604], [1.8841480539660276, -2.295841046487329], [2.1001071401240456, -2.100107140124047], [2.295841046487328, -1.8841480539660285], [2.4694647485385595, -1.6500435920682186], [2.619306155114614, -1.400048308373214], [2.7439222115585213, -1.1365697941243185], [2.8421127971246603, -0.8621454914457537], [2.9129322827975943, -0.5794182563879023], [2.955698638216425, -0.2911109067787947]], "depth": 0.25}}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0.25, 0], "rotation": [-1.5707963267948966, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "terrace-1", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tread-edge-1", "type": "bevel", "geometryEffect": "chamfer 0.018m on worn stair nose", "confidence": 0.85}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_terrace_1_2.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "terrace-1", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}};
  (nodes["root"] ?? root).add(node_terrace_1_2);
  nodes["terrace-1"] = node_terrace_1_2;
  const mesh_terrace_1_2Geometry = endpoint_terrace_1_2
    ? new THREE.CylinderGeometry(endpoint_terrace_1_2.endRadius, endpoint_terrace_1_2.baseRadius, endpoint_terrace_1_2.length, 32, 12)
    : buildExtrudeGeometry({"points": [[2.97, 0.0], [2.955698638216425, 0.29111090677879503], [2.9129322827975948, 0.5794182563879009], [2.8421127971246603, 0.8621454914457531], [2.743922211558522, 1.1365697941243167], [2.619306155114615, 1.4000483083732131], [2.4694647485385595, 1.6500435920682186], [2.295841046487329, 1.8841480539660271], [2.1001071401240465, 2.100107140124046], [1.8841480539660271, 2.295841046487329], [1.6500435920682188, 2.4694647485385595], [1.4000483083732136, 2.6193061551146144], [1.136569794124317, 2.743922211558522], [0.8621454914457531, 2.8421127971246603], [0.5794182563879012, 2.9129322827975948], [0.29111090677879553, 2.9556986382164245], [1.8186004967338196e-16, 2.97], [-0.29111090677879514, 2.955698638216425], [-0.5794182563879008, 2.9129322827975948], [-0.8621454914457527, 2.8421127971246607], [-1.1365697941243165, 2.743922211558522], [-1.4000483083732131, 2.619306155114615], [-1.650043592068218, 2.46946474853856], [-1.884148053966027, 2.2958410464873293], [-2.100107140124046, 2.1001071401240465], [-2.295841046487329, 1.8841480539660271], [-2.46946474853856, 1.6500435920682186], [-2.6193061551146144, 1.4000483083732138], [-2.743922211558522, 1.1365697941243171], [-2.8421127971246603, 0.8621454914457534], [-2.9129322827975948, 0.579418256387902], [-2.9556986382164245, 0.2911109067787957], [-2.97, 3.637200993467639e-16], [-2.955698638216425, -0.291110906778795], [-2.9129322827975948, -0.5794182563879012], [-2.8421127971246607, -0.8621454914457525], [-2.7439222115585222, -1.1365697941243165], [-2.619306155114615, -1.4000483083732131], [-2.4694647485385604, -1.650043592068218], [-2.2958410464873293, -1.8841480539660265], [-2.100107140124047, -2.100107140124046], [-1.8841480539660282, -2.295841046487328], [-1.6500435920682186, -2.4694647485385595], [-1.4000483083732138, -2.6193061551146144], [-1.1365697941243185, -2.7439222115585213], [-0.8621454914457535, -2.8421127971246603], [-0.5794182563879021, -2.9129322827975943], [-0.29111090677879453, -2.955698638216425], [-5.455801490201459e-16, -2.97], [0.2911109067787935, -2.955698638216425], [0.5794182563879011, -2.9129322827975948], [0.8621454914457524, -2.8421127971246607], [1.1365697941243174, -2.7439222115585213], [1.400048308373213, -2.619306155114615], [1.6500435920682175, -2.4694647485385604], [1.8841480539660276, -2.295841046487329], [2.1001071401240456, -2.100107140124047], [2.295841046487328, -1.8841480539660285], [2.4694647485385595, -1.6500435920682186], [2.619306155114614, -1.400048308373214], [2.7439222115585213, -1.1365697941243185], [2.8421127971246603, -0.8621454914457537], [2.9129322827975943, -0.5794182563879023], [2.955698638216425, -0.2911109067787947]], "depth": 0.25});
  if (!endpoint_terrace_1_2) {
    mesh_terrace_1_2Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_terrace_1_2 = new THREE.Mesh(
    mesh_terrace_1_2Geometry,
    materialMap["stone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_terrace_1_2.name = "terrace-1";
  if (endpoint_terrace_1_2) {
    mesh_terrace_1_2.position.copy(endpoint_terrace_1_2.midpoint);
    mesh_terrace_1_2.quaternion.copy(endpoint_terrace_1_2.quaternion);
  }
  mesh_terrace_1_2.castShadow = options.castShadow ?? true;
  mesh_terrace_1_2.receiveShadow = options.receiveShadow ?? true;
  mesh_terrace_1_2.userData.sculptComponent = {"id": "terrace-1", "name": "terrace-1", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides", "profile2D": {"points": [[2.97, 0.0], [2.955698638216425, 0.29111090677879503], [2.9129322827975948, 0.5794182563879009], [2.8421127971246603, 0.8621454914457531], [2.743922211558522, 1.1365697941243167], [2.619306155114615, 1.4000483083732131], [2.4694647485385595, 1.6500435920682186], [2.295841046487329, 1.8841480539660271], [2.1001071401240465, 2.100107140124046], [1.8841480539660271, 2.295841046487329], [1.6500435920682188, 2.4694647485385595], [1.4000483083732136, 2.6193061551146144], [1.136569794124317, 2.743922211558522], [0.8621454914457531, 2.8421127971246603], [0.5794182563879012, 2.9129322827975948], [0.29111090677879553, 2.9556986382164245], [1.8186004967338196e-16, 2.97], [-0.29111090677879514, 2.955698638216425], [-0.5794182563879008, 2.9129322827975948], [-0.8621454914457527, 2.8421127971246607], [-1.1365697941243165, 2.743922211558522], [-1.4000483083732131, 2.619306155114615], [-1.650043592068218, 2.46946474853856], [-1.884148053966027, 2.2958410464873293], [-2.100107140124046, 2.1001071401240465], [-2.295841046487329, 1.8841480539660271], [-2.46946474853856, 1.6500435920682186], [-2.6193061551146144, 1.4000483083732138], [-2.743922211558522, 1.1365697941243171], [-2.8421127971246603, 0.8621454914457534], [-2.9129322827975948, 0.579418256387902], [-2.9556986382164245, 0.2911109067787957], [-2.97, 3.637200993467639e-16], [-2.955698638216425, -0.291110906778795], [-2.9129322827975948, -0.5794182563879012], [-2.8421127971246607, -0.8621454914457525], [-2.7439222115585222, -1.1365697941243165], [-2.619306155114615, -1.4000483083732131], [-2.4694647485385604, -1.650043592068218], [-2.2958410464873293, -1.8841480539660265], [-2.100107140124047, -2.100107140124046], [-1.8841480539660282, -2.295841046487328], [-1.6500435920682186, -2.4694647485385595], [-1.4000483083732138, -2.6193061551146144], [-1.1365697941243185, -2.7439222115585213], [-0.8621454914457535, -2.8421127971246603], [-0.5794182563879021, -2.9129322827975943], [-0.29111090677879453, -2.955698638216425], [-5.455801490201459e-16, -2.97], [0.2911109067787935, -2.955698638216425], [0.5794182563879011, -2.9129322827975948], [0.8621454914457524, -2.8421127971246607], [1.1365697941243174, -2.7439222115585213], [1.400048308373213, -2.619306155114615], [1.6500435920682175, -2.4694647485385604], [1.8841480539660276, -2.295841046487329], [2.1001071401240456, -2.100107140124047], [2.295841046487328, -1.8841480539660285], [2.4694647485385595, -1.6500435920682186], [2.619306155114614, -1.400048308373214], [2.7439222115585213, -1.1365697941243185], [2.8421127971246603, -0.8621454914457537], [2.9129322827975943, -0.5794182563879023], [2.955698638216425, -0.2911109067787947]], "depth": 0.25}}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0.25, 0], "rotation": [-1.5707963267948966, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "terrace-1", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tread-edge-1", "type": "bevel", "geometryEffect": "chamfer 0.018m on worn stair nose", "confidence": 0.85}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_terrace_1_2.add(mesh_terrace_1_2);
  meshes["terrace-1"] = mesh_terrace_1_2;
  colliders["terrace-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["terrace-1"] ??= [];
  destructionGroups["terrace-1"].push(node_terrace_1_2);

  const endpoint_terrace_2_3 = makeAttachmentEndpoint(null);
  const node_terrace_2_3 = new THREE.Group();
  node_terrace_2_3.name = "terrace-2__pivot";
  node_terrace_2_3.scale.set(1, 1, 1);
  if (endpoint_terrace_2_3) {
    node_terrace_2_3.position.copy(endpoint_terrace_2_3.start);
    node_terrace_2_3.rotation.set(-1.5707963267948966, 0.0, 0.0);
  } else {
    node_terrace_2_3.position.set(0.0, 0.5, 0.0);
    node_terrace_2_3.rotation.set(-1.5707963267948966, 0.0, 0.0);
  }
  node_terrace_2_3.userData.sculptComponent = {"id": "terrace-2", "name": "terrace-2", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides", "profile2D": {"points": [[2.69, 0.0], [2.67704691474821, 0.26366610748651803], [2.6383124042846897, 0.524792966223385], [2.574169503119642, 0.7808657818145036], [2.485235942455361, 1.0294184330620915], [2.3723682010970752, 1.2680572220619337], [2.2366532570938467, 1.49448392682273], [2.0793981195457625, 1.7065179344002064], [1.902117241391813, 1.9021172413918126], [1.7065179344002064, 2.0793981195457625], [1.4944839268227301, 2.2366532570938467], [1.2680572220619342, 2.372368201097075], [1.0294184330620917, 2.485235942455361], [0.7808657818145036, 2.574169503119642], [0.5247929662233852, 2.6383124042846897], [0.2636661074865185, 2.6770469147482094], [1.64714994485319e-16, 2.69], [-0.26366610748651814, 2.67704691474821], [-0.5247929662233848, 2.6383124042846897], [-0.7808657818145032, 2.574169503119642], [-1.0294184330620912, 2.485235942455361], [-1.2680572220619337, 2.3723682010970752], [-1.4944839268227292, 2.236653257093847], [-1.706517934400206, 2.079398119545763], [-1.9021172413918126, 1.902117241391813], [-2.0793981195457625, 1.7065179344002064], [-2.236653257093847, 1.49448392682273], [-2.372368201097075, 1.2680572220619342], [-2.485235942455361, 1.0294184330620917], [-2.574169503119642, 0.7808657818145038], [-2.6383124042846897, 0.5247929662233859], [-2.6770469147482094, 0.26366610748651864], [-2.69, 3.29429988970638e-16], [-2.67704691474821, -0.263666107486518], [-2.6383124042846897, -0.5247929662233852], [-2.574169503119642, -0.7808657818145031], [-2.4852359424553616, -1.0294184330620912], [-2.3723682010970752, -1.2680572220619337], [-2.236653257093847, -1.4944839268227292], [-2.079398119545763, -1.7065179344002057], [-1.9021172413918133, -1.9021172413918126], [-1.7065179344002073, -2.0793981195457616], [-1.49448392682273, -2.2366532570938467], [-1.2680572220619344, -2.372368201097075], [-1.029418433062093, -2.4852359424553607], [-0.780865781814504, -2.574169503119642], [-0.5247929662233861, -2.6383124042846897], [-0.2636661074865176, -2.67704691474821], [-4.94144983455957e-16, -2.69], [0.26366610748651664, -2.67704691474821], [0.5247929662233851, -2.6383124042846897], [0.780865781814503, -2.574169503119642], [1.0294184330620921, -2.485235942455361], [1.2680572220619335, -2.3723682010970752], [1.494483926822729, -2.236653257093847], [1.7065179344002066, -2.079398119545762], [1.9021172413918124, -1.9021172413918133], [2.0793981195457616, -1.7065179344002075], [2.2366532570938467, -1.49448392682273], [2.3723682010970744, -1.2680572220619346], [2.4852359424553607, -1.0294184330620932], [2.574169503119642, -0.7808657818145041], [2.6383124042846897, -0.5247929662233862], [2.67704691474821, -0.26366610748651775]], "depth": 0.25}}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0.5, 0], "rotation": [-1.5707963267948966, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "terrace-2", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tread-edge-2", "type": "bevel", "geometryEffect": "chamfer 0.018m on worn stair nose", "confidence": 0.85}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_terrace_2_3.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "terrace-2", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}};
  (nodes["root"] ?? root).add(node_terrace_2_3);
  nodes["terrace-2"] = node_terrace_2_3;
  const mesh_terrace_2_3Geometry = endpoint_terrace_2_3
    ? new THREE.CylinderGeometry(endpoint_terrace_2_3.endRadius, endpoint_terrace_2_3.baseRadius, endpoint_terrace_2_3.length, 32, 12)
    : buildExtrudeGeometry({"points": [[2.69, 0.0], [2.67704691474821, 0.26366610748651803], [2.6383124042846897, 0.524792966223385], [2.574169503119642, 0.7808657818145036], [2.485235942455361, 1.0294184330620915], [2.3723682010970752, 1.2680572220619337], [2.2366532570938467, 1.49448392682273], [2.0793981195457625, 1.7065179344002064], [1.902117241391813, 1.9021172413918126], [1.7065179344002064, 2.0793981195457625], [1.4944839268227301, 2.2366532570938467], [1.2680572220619342, 2.372368201097075], [1.0294184330620917, 2.485235942455361], [0.7808657818145036, 2.574169503119642], [0.5247929662233852, 2.6383124042846897], [0.2636661074865185, 2.6770469147482094], [1.64714994485319e-16, 2.69], [-0.26366610748651814, 2.67704691474821], [-0.5247929662233848, 2.6383124042846897], [-0.7808657818145032, 2.574169503119642], [-1.0294184330620912, 2.485235942455361], [-1.2680572220619337, 2.3723682010970752], [-1.4944839268227292, 2.236653257093847], [-1.706517934400206, 2.079398119545763], [-1.9021172413918126, 1.902117241391813], [-2.0793981195457625, 1.7065179344002064], [-2.236653257093847, 1.49448392682273], [-2.372368201097075, 1.2680572220619342], [-2.485235942455361, 1.0294184330620917], [-2.574169503119642, 0.7808657818145038], [-2.6383124042846897, 0.5247929662233859], [-2.6770469147482094, 0.26366610748651864], [-2.69, 3.29429988970638e-16], [-2.67704691474821, -0.263666107486518], [-2.6383124042846897, -0.5247929662233852], [-2.574169503119642, -0.7808657818145031], [-2.4852359424553616, -1.0294184330620912], [-2.3723682010970752, -1.2680572220619337], [-2.236653257093847, -1.4944839268227292], [-2.079398119545763, -1.7065179344002057], [-1.9021172413918133, -1.9021172413918126], [-1.7065179344002073, -2.0793981195457616], [-1.49448392682273, -2.2366532570938467], [-1.2680572220619344, -2.372368201097075], [-1.029418433062093, -2.4852359424553607], [-0.780865781814504, -2.574169503119642], [-0.5247929662233861, -2.6383124042846897], [-0.2636661074865176, -2.67704691474821], [-4.94144983455957e-16, -2.69], [0.26366610748651664, -2.67704691474821], [0.5247929662233851, -2.6383124042846897], [0.780865781814503, -2.574169503119642], [1.0294184330620921, -2.485235942455361], [1.2680572220619335, -2.3723682010970752], [1.494483926822729, -2.236653257093847], [1.7065179344002066, -2.079398119545762], [1.9021172413918124, -1.9021172413918133], [2.0793981195457616, -1.7065179344002075], [2.2366532570938467, -1.49448392682273], [2.3723682010970744, -1.2680572220619346], [2.4852359424553607, -1.0294184330620932], [2.574169503119642, -0.7808657818145041], [2.6383124042846897, -0.5247929662233862], [2.67704691474821, -0.26366610748651775]], "depth": 0.25});
  if (!endpoint_terrace_2_3) {
    mesh_terrace_2_3Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_terrace_2_3 = new THREE.Mesh(
    mesh_terrace_2_3Geometry,
    materialMap["stone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_terrace_2_3.name = "terrace-2";
  if (endpoint_terrace_2_3) {
    mesh_terrace_2_3.position.copy(endpoint_terrace_2_3.midpoint);
    mesh_terrace_2_3.quaternion.copy(endpoint_terrace_2_3.quaternion);
  }
  mesh_terrace_2_3.castShadow = options.castShadow ?? true;
  mesh_terrace_2_3.receiveShadow = options.receiveShadow ?? true;
  mesh_terrace_2_3.userData.sculptComponent = {"id": "terrace-2", "name": "terrace-2", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides", "profile2D": {"points": [[2.69, 0.0], [2.67704691474821, 0.26366610748651803], [2.6383124042846897, 0.524792966223385], [2.574169503119642, 0.7808657818145036], [2.485235942455361, 1.0294184330620915], [2.3723682010970752, 1.2680572220619337], [2.2366532570938467, 1.49448392682273], [2.0793981195457625, 1.7065179344002064], [1.902117241391813, 1.9021172413918126], [1.7065179344002064, 2.0793981195457625], [1.4944839268227301, 2.2366532570938467], [1.2680572220619342, 2.372368201097075], [1.0294184330620917, 2.485235942455361], [0.7808657818145036, 2.574169503119642], [0.5247929662233852, 2.6383124042846897], [0.2636661074865185, 2.6770469147482094], [1.64714994485319e-16, 2.69], [-0.26366610748651814, 2.67704691474821], [-0.5247929662233848, 2.6383124042846897], [-0.7808657818145032, 2.574169503119642], [-1.0294184330620912, 2.485235942455361], [-1.2680572220619337, 2.3723682010970752], [-1.4944839268227292, 2.236653257093847], [-1.706517934400206, 2.079398119545763], [-1.9021172413918126, 1.902117241391813], [-2.0793981195457625, 1.7065179344002064], [-2.236653257093847, 1.49448392682273], [-2.372368201097075, 1.2680572220619342], [-2.485235942455361, 1.0294184330620917], [-2.574169503119642, 0.7808657818145038], [-2.6383124042846897, 0.5247929662233859], [-2.6770469147482094, 0.26366610748651864], [-2.69, 3.29429988970638e-16], [-2.67704691474821, -0.263666107486518], [-2.6383124042846897, -0.5247929662233852], [-2.574169503119642, -0.7808657818145031], [-2.4852359424553616, -1.0294184330620912], [-2.3723682010970752, -1.2680572220619337], [-2.236653257093847, -1.4944839268227292], [-2.079398119545763, -1.7065179344002057], [-1.9021172413918133, -1.9021172413918126], [-1.7065179344002073, -2.0793981195457616], [-1.49448392682273, -2.2366532570938467], [-1.2680572220619344, -2.372368201097075], [-1.029418433062093, -2.4852359424553607], [-0.780865781814504, -2.574169503119642], [-0.5247929662233861, -2.6383124042846897], [-0.2636661074865176, -2.67704691474821], [-4.94144983455957e-16, -2.69], [0.26366610748651664, -2.67704691474821], [0.5247929662233851, -2.6383124042846897], [0.780865781814503, -2.574169503119642], [1.0294184330620921, -2.485235942455361], [1.2680572220619335, -2.3723682010970752], [1.494483926822729, -2.236653257093847], [1.7065179344002066, -2.079398119545762], [1.9021172413918124, -1.9021172413918133], [2.0793981195457616, -1.7065179344002075], [2.2366532570938467, -1.49448392682273], [2.3723682010970744, -1.2680572220619346], [2.4852359424553607, -1.0294184330620932], [2.574169503119642, -0.7808657818145041], [2.6383124042846897, -0.5247929662233862], [2.67704691474821, -0.26366610748651775]], "depth": 0.25}}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0.5, 0], "rotation": [-1.5707963267948966, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "terrace-2", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tread-edge-2", "type": "bevel", "geometryEffect": "chamfer 0.018m on worn stair nose", "confidence": 0.85}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_terrace_2_3.add(mesh_terrace_2_3);
  meshes["terrace-2"] = mesh_terrace_2_3;
  colliders["terrace-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["terrace-2"] ??= [];
  destructionGroups["terrace-2"].push(node_terrace_2_3);

  const endpoint_terrace_3_4 = makeAttachmentEndpoint(null);
  const node_terrace_3_4 = new THREE.Group();
  node_terrace_3_4.name = "terrace-3__pivot";
  node_terrace_3_4.scale.set(1, 1, 1);
  if (endpoint_terrace_3_4) {
    node_terrace_3_4.position.copy(endpoint_terrace_3_4.start);
    node_terrace_3_4.rotation.set(-1.5707963267948966, 0.0, 0.0);
  } else {
    node_terrace_3_4.position.set(0.0, 0.75, 0.0);
    node_terrace_3_4.rotation.set(-1.5707963267948966, 0.0, 0.0);
  }
  node_terrace_3_4.userData.sculptComponent = {"id": "terrace-3", "name": "terrace-3", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides", "profile2D": {"points": [[2.4, 0.0], [2.3884433440132726, 0.23524113679094544], [2.353884672967753, 0.4682167728387078], [2.296656805757301, 0.6966832254107096], [2.2173108780270883, 0.9184402376762154], [2.116611034436052, 1.1313521683823944], [1.9955270695261085, 1.3333685592470452], [1.8552250880705687, 1.522543881992749], [1.697056274847714, 1.6970562748477138], [1.522543881992749, 1.8552250880705687], [1.3333685592470454, 1.9955270695261085], [1.1313521683823946, 2.1166110344360516], [0.9184402376762155, 2.2173108780270883], [0.6966832254107096, 2.296656805757301], [0.468216772838708, 2.353884672967753], [0.23524113679094583, 2.388443344013272], [1.4695761589768238e-16, 2.4], [-0.23524113679094555, 2.3884433440132726], [-0.46821677283870766, 2.353884672967753], [-0.6966832254107092, 2.2966568057573014], [-0.9184402376762153, 2.2173108780270883], [-1.1313521683823944, 2.116611034436052], [-1.3333685592470446, 1.9955270695261087], [-1.5225438819927488, 1.855225088070569], [-1.6970562748477138, 1.697056274847714], [-1.8552250880705687, 1.522543881992749], [-1.9955270695261087, 1.3333685592470452], [-2.1166110344360516, 1.1313521683823948], [-2.2173108780270883, 0.9184402376762157], [-2.296656805757301, 0.6966832254107097], [-2.353884672967753, 0.46821677283870866], [-2.388443344013272, 0.23524113679094596], [-2.4, 2.9391523179536476e-16], [-2.3884433440132726, -0.2352411367909454], [-2.353884672967753, -0.46821677283870805], [-2.2966568057573014, -0.696683225410709], [-2.2173108780270883, -0.9184402376762152], [-2.116611034436052, -1.1313521683823944], [-1.995527069526109, -1.3333685592470446], [-1.855225088070569, -1.5225438819927486], [-1.6970562748477145, -1.6970562748477138], [-1.52254388199275, -1.8552250880705679], [-1.3333685592470452, -1.9955270695261085], [-1.131352168382395, -2.1166110344360516], [-0.9184402376762167, -2.2173108780270874], [-0.6966832254107098, -2.296656805757301], [-0.4682167728387088, -2.3538846729677525], [-0.23524113679094508, -2.3884433440132726], [-4.408728476930471e-16, -2.4], [0.23524113679094422, -2.3884433440132726], [0.4682167728387079, -2.353884672967753], [0.6966832254107089, -2.2966568057573014], [0.918440237676216, -2.217310878027088], [1.1313521683823942, -2.116611034436052], [1.3333685592470443, -1.995527069526109], [1.5225438819927495, -1.8552250880705685], [1.6970562748477136, -1.6970562748477145], [1.8552250880705679, -1.5225438819927501], [1.9955270695261085, -1.3333685592470452], [2.1166110344360516, -1.131352168382395], [2.2173108780270874, -0.9184402376762169], [2.296656805757301, -0.6966832254107099], [2.3538846729677525, -0.4682167728387089], [2.3884433440132726, -0.23524113679094522]], "depth": 0.25}}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0.75, 0], "rotation": [-1.5707963267948966, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "terrace-3", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tread-edge-3", "type": "bevel", "geometryEffect": "chamfer 0.018m on worn stair nose", "confidence": 0.85}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_terrace_3_4.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "terrace-3", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}};
  (nodes["root"] ?? root).add(node_terrace_3_4);
  nodes["terrace-3"] = node_terrace_3_4;
  const mesh_terrace_3_4Geometry = endpoint_terrace_3_4
    ? new THREE.CylinderGeometry(endpoint_terrace_3_4.endRadius, endpoint_terrace_3_4.baseRadius, endpoint_terrace_3_4.length, 32, 12)
    : buildExtrudeGeometry({"points": [[2.4, 0.0], [2.3884433440132726, 0.23524113679094544], [2.353884672967753, 0.4682167728387078], [2.296656805757301, 0.6966832254107096], [2.2173108780270883, 0.9184402376762154], [2.116611034436052, 1.1313521683823944], [1.9955270695261085, 1.3333685592470452], [1.8552250880705687, 1.522543881992749], [1.697056274847714, 1.6970562748477138], [1.522543881992749, 1.8552250880705687], [1.3333685592470454, 1.9955270695261085], [1.1313521683823946, 2.1166110344360516], [0.9184402376762155, 2.2173108780270883], [0.6966832254107096, 2.296656805757301], [0.468216772838708, 2.353884672967753], [0.23524113679094583, 2.388443344013272], [1.4695761589768238e-16, 2.4], [-0.23524113679094555, 2.3884433440132726], [-0.46821677283870766, 2.353884672967753], [-0.6966832254107092, 2.2966568057573014], [-0.9184402376762153, 2.2173108780270883], [-1.1313521683823944, 2.116611034436052], [-1.3333685592470446, 1.9955270695261087], [-1.5225438819927488, 1.855225088070569], [-1.6970562748477138, 1.697056274847714], [-1.8552250880705687, 1.522543881992749], [-1.9955270695261087, 1.3333685592470452], [-2.1166110344360516, 1.1313521683823948], [-2.2173108780270883, 0.9184402376762157], [-2.296656805757301, 0.6966832254107097], [-2.353884672967753, 0.46821677283870866], [-2.388443344013272, 0.23524113679094596], [-2.4, 2.9391523179536476e-16], [-2.3884433440132726, -0.2352411367909454], [-2.353884672967753, -0.46821677283870805], [-2.2966568057573014, -0.696683225410709], [-2.2173108780270883, -0.9184402376762152], [-2.116611034436052, -1.1313521683823944], [-1.995527069526109, -1.3333685592470446], [-1.855225088070569, -1.5225438819927486], [-1.6970562748477145, -1.6970562748477138], [-1.52254388199275, -1.8552250880705679], [-1.3333685592470452, -1.9955270695261085], [-1.131352168382395, -2.1166110344360516], [-0.9184402376762167, -2.2173108780270874], [-0.6966832254107098, -2.296656805757301], [-0.4682167728387088, -2.3538846729677525], [-0.23524113679094508, -2.3884433440132726], [-4.408728476930471e-16, -2.4], [0.23524113679094422, -2.3884433440132726], [0.4682167728387079, -2.353884672967753], [0.6966832254107089, -2.2966568057573014], [0.918440237676216, -2.217310878027088], [1.1313521683823942, -2.116611034436052], [1.3333685592470443, -1.995527069526109], [1.5225438819927495, -1.8552250880705685], [1.6970562748477136, -1.6970562748477145], [1.8552250880705679, -1.5225438819927501], [1.9955270695261085, -1.3333685592470452], [2.1166110344360516, -1.131352168382395], [2.2173108780270874, -0.9184402376762169], [2.296656805757301, -0.6966832254107099], [2.3538846729677525, -0.4682167728387089], [2.3884433440132726, -0.23524113679094522]], "depth": 0.25});
  if (!endpoint_terrace_3_4) {
    mesh_terrace_3_4Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_terrace_3_4 = new THREE.Mesh(
    mesh_terrace_3_4Geometry,
    materialMap["stone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_terrace_3_4.name = "terrace-3";
  if (endpoint_terrace_3_4) {
    mesh_terrace_3_4.position.copy(endpoint_terrace_3_4.midpoint);
    mesh_terrace_3_4.quaternion.copy(endpoint_terrace_3_4.quaternion);
  }
  mesh_terrace_3_4.castShadow = options.castShadow ?? true;
  mesh_terrace_3_4.receiveShadow = options.receiveShadow ?? true;
  mesh_terrace_3_4.userData.sculptComponent = {"id": "terrace-3", "name": "terrace-3", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides", "profile2D": {"points": [[2.4, 0.0], [2.3884433440132726, 0.23524113679094544], [2.353884672967753, 0.4682167728387078], [2.296656805757301, 0.6966832254107096], [2.2173108780270883, 0.9184402376762154], [2.116611034436052, 1.1313521683823944], [1.9955270695261085, 1.3333685592470452], [1.8552250880705687, 1.522543881992749], [1.697056274847714, 1.6970562748477138], [1.522543881992749, 1.8552250880705687], [1.3333685592470454, 1.9955270695261085], [1.1313521683823946, 2.1166110344360516], [0.9184402376762155, 2.2173108780270883], [0.6966832254107096, 2.296656805757301], [0.468216772838708, 2.353884672967753], [0.23524113679094583, 2.388443344013272], [1.4695761589768238e-16, 2.4], [-0.23524113679094555, 2.3884433440132726], [-0.46821677283870766, 2.353884672967753], [-0.6966832254107092, 2.2966568057573014], [-0.9184402376762153, 2.2173108780270883], [-1.1313521683823944, 2.116611034436052], [-1.3333685592470446, 1.9955270695261087], [-1.5225438819927488, 1.855225088070569], [-1.6970562748477138, 1.697056274847714], [-1.8552250880705687, 1.522543881992749], [-1.9955270695261087, 1.3333685592470452], [-2.1166110344360516, 1.1313521683823948], [-2.2173108780270883, 0.9184402376762157], [-2.296656805757301, 0.6966832254107097], [-2.353884672967753, 0.46821677283870866], [-2.388443344013272, 0.23524113679094596], [-2.4, 2.9391523179536476e-16], [-2.3884433440132726, -0.2352411367909454], [-2.353884672967753, -0.46821677283870805], [-2.2966568057573014, -0.696683225410709], [-2.2173108780270883, -0.9184402376762152], [-2.116611034436052, -1.1313521683823944], [-1.995527069526109, -1.3333685592470446], [-1.855225088070569, -1.5225438819927486], [-1.6970562748477145, -1.6970562748477138], [-1.52254388199275, -1.8552250880705679], [-1.3333685592470452, -1.9955270695261085], [-1.131352168382395, -2.1166110344360516], [-0.9184402376762167, -2.2173108780270874], [-0.6966832254107098, -2.296656805757301], [-0.4682167728387088, -2.3538846729677525], [-0.23524113679094508, -2.3884433440132726], [-4.408728476930471e-16, -2.4], [0.23524113679094422, -2.3884433440132726], [0.4682167728387079, -2.353884672967753], [0.6966832254107089, -2.2966568057573014], [0.918440237676216, -2.217310878027088], [1.1313521683823942, -2.116611034436052], [1.3333685592470443, -1.995527069526109], [1.5225438819927495, -1.8552250880705685], [1.6970562748477136, -1.6970562748477145], [1.8552250880705679, -1.5225438819927501], [1.9955270695261085, -1.3333685592470452], [2.1166110344360516, -1.131352168382395], [2.2173108780270874, -0.9184402376762169], [2.296656805757301, -0.6966832254107099], [2.3538846729677525, -0.4682167728387089], [2.3884433440132726, -0.23524113679094522]], "depth": 0.25}}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 0.75, 0], "rotation": [-1.5707963267948966, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "terrace-3", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tread-edge-3", "type": "bevel", "geometryEffect": "chamfer 0.018m on worn stair nose", "confidence": 0.85}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_terrace_3_4.add(mesh_terrace_3_4);
  meshes["terrace-3"] = mesh_terrace_3_4;
  colliders["terrace-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["terrace-3"] ??= [];
  destructionGroups["terrace-3"].push(node_terrace_3_4);

  const endpoint_arch_upright_west_5 = makeAttachmentEndpoint(null);
  const node_arch_upright_west_5 = new THREE.Group();
  node_arch_upright_west_5.name = "arch-upright-west__pivot";
  node_arch_upright_west_5.scale.set(1, 1, 1);
  if (endpoint_arch_upright_west_5) {
    node_arch_upright_west_5.position.copy(endpoint_arch_upright_west_5.start);
    node_arch_upright_west_5.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_upright_west_5.position.set(-1.5, 2.0, -1.25);
    node_arch_upright_west_5.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_upright_west_5.userData.sculptComponent = {"id": "arch-upright-west", "name": "arch-upright-west", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.5, "height": 2.0, "depth": 0.5, "units": "relative", "confidence": 0.8}, "transform": {"position": [-1.5, 2, -1.25], "rotation": [0, 0, 0], "scale": [0.5, 2.0, 0.5]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "arch-upright-west", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "upright-joints-west", "type": "seam", "geometryEffect": "separate front masonry course faces", "confidence": 0.88}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_arch_upright_west_5.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "arch-upright-west", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}};
  (nodes["root"] ?? root).add(node_arch_upright_west_5);
  nodes["arch-upright-west"] = node_arch_upright_west_5;
  const mesh_arch_upright_west_5Geometry = endpoint_arch_upright_west_5
    ? new THREE.CylinderGeometry(endpoint_arch_upright_west_5.endRadius, endpoint_arch_upright_west_5.baseRadius, endpoint_arch_upright_west_5.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_arch_upright_west_5) {
    mesh_arch_upright_west_5Geometry.scale(0.5, 2.0, 0.5);
  }
  const mesh_arch_upright_west_5 = new THREE.Mesh(
    mesh_arch_upright_west_5Geometry,
    materialMap["stone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_upright_west_5.name = "arch-upright-west";
  if (endpoint_arch_upright_west_5) {
    mesh_arch_upright_west_5.position.copy(endpoint_arch_upright_west_5.midpoint);
    mesh_arch_upright_west_5.quaternion.copy(endpoint_arch_upright_west_5.quaternion);
  }
  mesh_arch_upright_west_5.castShadow = options.castShadow ?? true;
  mesh_arch_upright_west_5.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_upright_west_5.userData.sculptComponent = {"id": "arch-upright-west", "name": "arch-upright-west", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.5, "height": 2.0, "depth": 0.5, "units": "relative", "confidence": 0.8}, "transform": {"position": [-1.5, 2, -1.25], "rotation": [0, 0, 0], "scale": [0.5, 2.0, 0.5]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "arch-upright-west", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "upright-joints-west", "type": "seam", "geometryEffect": "separate front masonry course faces", "confidence": 0.88}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_arch_upright_west_5.add(mesh_arch_upright_west_5);
  meshes["arch-upright-west"] = mesh_arch_upright_west_5;
  colliders["arch-upright-west"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["arch-upright-west"] ??= [];
  destructionGroups["arch-upright-west"].push(node_arch_upright_west_5);

  const endpoint_broken_arch_west_6 = makeAttachmentEndpoint(null);
  const node_broken_arch_west_6 = new THREE.Group();
  node_broken_arch_west_6.name = "broken-arch-west__pivot";
  node_broken_arch_west_6.scale.set(1, 1, 1);
  if (endpoint_broken_arch_west_6) {
    node_broken_arch_west_6.position.copy(endpoint_broken_arch_west_6.start);
    node_broken_arch_west_6.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_broken_arch_west_6.position.set(0.0, 3.0, -1.5);
    node_broken_arch_west_6.rotation.set(0.0, 0.0, 0.0);
  }
  node_broken_arch_west_6.userData.sculptComponent = {"id": "broken-arch-west", "name": "broken-arch-west", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides", "profile2D": {"points": [[-0.3496580221993075, 1.7249171770005853], [-0.466970011763152, 1.6969204483752094], [-0.5820891719437037, 1.660955205869771], [-0.6944749183979321, 1.6171903375039642], [-0.8035995025319661, 1.5658313573084353], [-0.9089504897386546, 1.5071194402580905], [-1.010033165722677, 1.4413302897463256], [-1.1063728596134075, 1.3687728429183754], [-1.1975171729565142, 1.289787819943357], [-1.2830381041172358, 1.2047461240374457], [-1.3625340581194256, 1.1140470997514464], [-1.4356317324824144, 1.0181166577016316], [-1.501987870200066, 0.9174052745498416], [-1.5612908716302532, 0.8123858776246943], [-1.613262257725548, 0.7035516241174258], [-1.657657977733976, 0.5914135852809816], [-1.6942695552290545, 0.47649834650703893], [-1.7229250670875045, 0.3593455345506858], [-1.7434899508174884, 0.2405052835145876], [-1.755867636446264, 0.1205356514920387], [-1.76, 2.1553783664993416e-16], [-1.25, 1.5308084989341916e-16], [-1.2470650827033125, 0.08560770702559622], [-1.2382741127965116, 0.17081341158706506], [-1.2236683715110117, 0.2552169989706575], [-1.2033164454751808, 0.33842212109874925], [-1.1773139046406078, 0.4200380577279705], [-1.1457828534982586, 0.49968155121976265], [-1.1088713576919411, 0.5769786062675385], [-1.0667527487216377, 0.6515662461291488], [-1.019624810001715, 0.723094217117636], [-0.9677088480961831, 0.7912266333461977], [-0.911248653492355, 0.8556435540038677], [-0.8505093557929788, 0.9160424857552252], [-0.7857761787027041, 0.9721398032090734], [-0.7173531006553104, 1.0236720807857427], [-0.6455614273712035, 1.0703973297287575], [-0.5707382830482713, 1.1120961344520137], [-0.49323502727125856, 1.1485726828863383], [-0.41341560507365316, 1.1796556859870533], [-0.3316548378999659, 1.205199182084666], [-0.24833666349382638, 1.225083222301552]], "depth": 0.5}}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 3, -1.5], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "broken-arch-west", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "fracture-west", "type": "chip", "geometryEffect": "open crown gap and unequal voussoir endings", "confidence": 0.92}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_broken_arch_west_6.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "broken-arch-west", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}};
  (nodes["root"] ?? root).add(node_broken_arch_west_6);
  nodes["broken-arch-west"] = node_broken_arch_west_6;
  const mesh_broken_arch_west_6Geometry = endpoint_broken_arch_west_6
    ? new THREE.CylinderGeometry(endpoint_broken_arch_west_6.endRadius, endpoint_broken_arch_west_6.baseRadius, endpoint_broken_arch_west_6.length, 32, 12)
    : buildExtrudeGeometry({"points": [[-0.3496580221993075, 1.7249171770005853], [-0.466970011763152, 1.6969204483752094], [-0.5820891719437037, 1.660955205869771], [-0.6944749183979321, 1.6171903375039642], [-0.8035995025319661, 1.5658313573084353], [-0.9089504897386546, 1.5071194402580905], [-1.010033165722677, 1.4413302897463256], [-1.1063728596134075, 1.3687728429183754], [-1.1975171729565142, 1.289787819943357], [-1.2830381041172358, 1.2047461240374457], [-1.3625340581194256, 1.1140470997514464], [-1.4356317324824144, 1.0181166577016316], [-1.501987870200066, 0.9174052745498416], [-1.5612908716302532, 0.8123858776246943], [-1.613262257725548, 0.7035516241174258], [-1.657657977733976, 0.5914135852809816], [-1.6942695552290545, 0.47649834650703893], [-1.7229250670875045, 0.3593455345506858], [-1.7434899508174884, 0.2405052835145876], [-1.755867636446264, 0.1205356514920387], [-1.76, 2.1553783664993416e-16], [-1.25, 1.5308084989341916e-16], [-1.2470650827033125, 0.08560770702559622], [-1.2382741127965116, 0.17081341158706506], [-1.2236683715110117, 0.2552169989706575], [-1.2033164454751808, 0.33842212109874925], [-1.1773139046406078, 0.4200380577279705], [-1.1457828534982586, 0.49968155121976265], [-1.1088713576919411, 0.5769786062675385], [-1.0667527487216377, 0.6515662461291488], [-1.019624810001715, 0.723094217117636], [-0.9677088480961831, 0.7912266333461977], [-0.911248653492355, 0.8556435540038677], [-0.8505093557929788, 0.9160424857552252], [-0.7857761787027041, 0.9721398032090734], [-0.7173531006553104, 1.0236720807857427], [-0.6455614273712035, 1.0703973297287575], [-0.5707382830482713, 1.1120961344520137], [-0.49323502727125856, 1.1485726828863383], [-0.41341560507365316, 1.1796556859870533], [-0.3316548378999659, 1.205199182084666], [-0.24833666349382638, 1.225083222301552]], "depth": 0.5});
  if (!endpoint_broken_arch_west_6) {
    mesh_broken_arch_west_6Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_broken_arch_west_6 = new THREE.Mesh(
    mesh_broken_arch_west_6Geometry,
    materialMap["stone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_broken_arch_west_6.name = "broken-arch-west";
  if (endpoint_broken_arch_west_6) {
    mesh_broken_arch_west_6.position.copy(endpoint_broken_arch_west_6.midpoint);
    mesh_broken_arch_west_6.quaternion.copy(endpoint_broken_arch_west_6.quaternion);
  }
  mesh_broken_arch_west_6.castShadow = options.castShadow ?? true;
  mesh_broken_arch_west_6.receiveShadow = options.receiveShadow ?? true;
  mesh_broken_arch_west_6.userData.sculptComponent = {"id": "broken-arch-west", "name": "broken-arch-west", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides", "profile2D": {"points": [[-0.3496580221993075, 1.7249171770005853], [-0.466970011763152, 1.6969204483752094], [-0.5820891719437037, 1.660955205869771], [-0.6944749183979321, 1.6171903375039642], [-0.8035995025319661, 1.5658313573084353], [-0.9089504897386546, 1.5071194402580905], [-1.010033165722677, 1.4413302897463256], [-1.1063728596134075, 1.3687728429183754], [-1.1975171729565142, 1.289787819943357], [-1.2830381041172358, 1.2047461240374457], [-1.3625340581194256, 1.1140470997514464], [-1.4356317324824144, 1.0181166577016316], [-1.501987870200066, 0.9174052745498416], [-1.5612908716302532, 0.8123858776246943], [-1.613262257725548, 0.7035516241174258], [-1.657657977733976, 0.5914135852809816], [-1.6942695552290545, 0.47649834650703893], [-1.7229250670875045, 0.3593455345506858], [-1.7434899508174884, 0.2405052835145876], [-1.755867636446264, 0.1205356514920387], [-1.76, 2.1553783664993416e-16], [-1.25, 1.5308084989341916e-16], [-1.2470650827033125, 0.08560770702559622], [-1.2382741127965116, 0.17081341158706506], [-1.2236683715110117, 0.2552169989706575], [-1.2033164454751808, 0.33842212109874925], [-1.1773139046406078, 0.4200380577279705], [-1.1457828534982586, 0.49968155121976265], [-1.1088713576919411, 0.5769786062675385], [-1.0667527487216377, 0.6515662461291488], [-1.019624810001715, 0.723094217117636], [-0.9677088480961831, 0.7912266333461977], [-0.911248653492355, 0.8556435540038677], [-0.8505093557929788, 0.9160424857552252], [-0.7857761787027041, 0.9721398032090734], [-0.7173531006553104, 1.0236720807857427], [-0.6455614273712035, 1.0703973297287575], [-0.5707382830482713, 1.1120961344520137], [-0.49323502727125856, 1.1485726828863383], [-0.41341560507365316, 1.1796556859870533], [-0.3316548378999659, 1.205199182084666], [-0.24833666349382638, 1.225083222301552]], "depth": 0.5}}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 3, -1.5], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "broken-arch-west", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "fracture-west", "type": "chip", "geometryEffect": "open crown gap and unequal voussoir endings", "confidence": 0.92}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_broken_arch_west_6.add(mesh_broken_arch_west_6);
  meshes["broken-arch-west"] = mesh_broken_arch_west_6;
  colliders["broken-arch-west"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["broken-arch-west"] ??= [];
  destructionGroups["broken-arch-west"].push(node_broken_arch_west_6);

  const endpoint_arch_course_west_0_7 = makeAttachmentEndpoint(null);
  const node_arch_course_west_0_7 = new THREE.Group();
  node_arch_course_west_0_7.name = "arch-course-west-0__pivot";
  node_arch_course_west_0_7.scale.set(1, 1, 1);
  if (endpoint_arch_course_west_0_7) {
    node_arch_course_west_0_7.position.copy(endpoint_arch_course_west_0_7.start);
    node_arch_course_west_0_7.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_course_west_0_7.position.set(-1.51, 1.2, -0.976);
    node_arch_course_west_0_7.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_course_west_0_7.userData.sculptComponent = {"id": "arch-course-west-0", "name": "arch-course-west-0", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.56, "height": 0.36, "depth": 0.055, "units": "relative", "confidence": 0.8}, "transform": {"position": [-1.51, 1.2, -0.976], "rotation": [0, 0, 0], "scale": [0.56, 0.36, 0.055]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "arch-course-west-0", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_arch_course_west_0_7.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "arch-course-west-0", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}};
  (nodes["root"] ?? root).add(node_arch_course_west_0_7);
  nodes["arch-course-west-0"] = node_arch_course_west_0_7;
  const mesh_arch_course_west_0_7Geometry = endpoint_arch_course_west_0_7
    ? new THREE.CylinderGeometry(endpoint_arch_course_west_0_7.endRadius, endpoint_arch_course_west_0_7.baseRadius, endpoint_arch_course_west_0_7.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_arch_course_west_0_7) {
    mesh_arch_course_west_0_7Geometry.scale(0.56, 0.36, 0.055);
  }
  const mesh_arch_course_west_0_7 = new THREE.Mesh(
    mesh_arch_course_west_0_7Geometry,
    materialMap["stone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_course_west_0_7.name = "arch-course-west-0";
  if (endpoint_arch_course_west_0_7) {
    mesh_arch_course_west_0_7.position.copy(endpoint_arch_course_west_0_7.midpoint);
    mesh_arch_course_west_0_7.quaternion.copy(endpoint_arch_course_west_0_7.quaternion);
  }
  mesh_arch_course_west_0_7.castShadow = options.castShadow ?? true;
  mesh_arch_course_west_0_7.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_course_west_0_7.userData.sculptComponent = {"id": "arch-course-west-0", "name": "arch-course-west-0", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.56, "height": 0.36, "depth": 0.055, "units": "relative", "confidence": 0.8}, "transform": {"position": [-1.51, 1.2, -0.976], "rotation": [0, 0, 0], "scale": [0.56, 0.36, 0.055]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "arch-course-west-0", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_arch_course_west_0_7.add(mesh_arch_course_west_0_7);
  meshes["arch-course-west-0"] = mesh_arch_course_west_0_7;
  colliders["arch-course-west-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["arch-course-west-0"] ??= [];
  destructionGroups["arch-course-west-0"].push(node_arch_course_west_0_7);

  const endpoint_arch_course_west_1_8 = makeAttachmentEndpoint(null);
  const node_arch_course_west_1_8 = new THREE.Group();
  node_arch_course_west_1_8.name = "arch-course-west-1__pivot";
  node_arch_course_west_1_8.scale.set(1, 1, 1);
  if (endpoint_arch_course_west_1_8) {
    node_arch_course_west_1_8.position.copy(endpoint_arch_course_west_1_8.start);
    node_arch_course_west_1_8.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_course_west_1_8.position.set(-1.49, 1.6, -0.976);
    node_arch_course_west_1_8.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_course_west_1_8.userData.sculptComponent = {"id": "arch-course-west-1", "name": "arch-course-west-1", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.56, "height": 0.36, "depth": 0.055, "units": "relative", "confidence": 0.8}, "transform": {"position": [-1.49, 1.6, -0.976], "rotation": [0, 0, 0], "scale": [0.56, 0.36, 0.055]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "arch-course-west-1", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_arch_course_west_1_8.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "arch-course-west-1", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}};
  (nodes["root"] ?? root).add(node_arch_course_west_1_8);
  nodes["arch-course-west-1"] = node_arch_course_west_1_8;
  const mesh_arch_course_west_1_8Geometry = endpoint_arch_course_west_1_8
    ? new THREE.CylinderGeometry(endpoint_arch_course_west_1_8.endRadius, endpoint_arch_course_west_1_8.baseRadius, endpoint_arch_course_west_1_8.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_arch_course_west_1_8) {
    mesh_arch_course_west_1_8Geometry.scale(0.56, 0.36, 0.055);
  }
  const mesh_arch_course_west_1_8 = new THREE.Mesh(
    mesh_arch_course_west_1_8Geometry,
    materialMap["stone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_course_west_1_8.name = "arch-course-west-1";
  if (endpoint_arch_course_west_1_8) {
    mesh_arch_course_west_1_8.position.copy(endpoint_arch_course_west_1_8.midpoint);
    mesh_arch_course_west_1_8.quaternion.copy(endpoint_arch_course_west_1_8.quaternion);
  }
  mesh_arch_course_west_1_8.castShadow = options.castShadow ?? true;
  mesh_arch_course_west_1_8.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_course_west_1_8.userData.sculptComponent = {"id": "arch-course-west-1", "name": "arch-course-west-1", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.56, "height": 0.36, "depth": 0.055, "units": "relative", "confidence": 0.8}, "transform": {"position": [-1.49, 1.6, -0.976], "rotation": [0, 0, 0], "scale": [0.56, 0.36, 0.055]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "arch-course-west-1", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_arch_course_west_1_8.add(mesh_arch_course_west_1_8);
  meshes["arch-course-west-1"] = mesh_arch_course_west_1_8;
  colliders["arch-course-west-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["arch-course-west-1"] ??= [];
  destructionGroups["arch-course-west-1"].push(node_arch_course_west_1_8);

  const endpoint_arch_course_west_2_9 = makeAttachmentEndpoint(null);
  const node_arch_course_west_2_9 = new THREE.Group();
  node_arch_course_west_2_9.name = "arch-course-west-2__pivot";
  node_arch_course_west_2_9.scale.set(1, 1, 1);
  if (endpoint_arch_course_west_2_9) {
    node_arch_course_west_2_9.position.copy(endpoint_arch_course_west_2_9.start);
    node_arch_course_west_2_9.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_course_west_2_9.position.set(-1.51, 2.0, -0.976);
    node_arch_course_west_2_9.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_course_west_2_9.userData.sculptComponent = {"id": "arch-course-west-2", "name": "arch-course-west-2", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.56, "height": 0.36, "depth": 0.055, "units": "relative", "confidence": 0.8}, "transform": {"position": [-1.51, 2.0, -0.976], "rotation": [0, 0, 0], "scale": [0.56, 0.36, 0.055]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "arch-course-west-2", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_arch_course_west_2_9.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "arch-course-west-2", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}};
  (nodes["root"] ?? root).add(node_arch_course_west_2_9);
  nodes["arch-course-west-2"] = node_arch_course_west_2_9;
  const mesh_arch_course_west_2_9Geometry = endpoint_arch_course_west_2_9
    ? new THREE.CylinderGeometry(endpoint_arch_course_west_2_9.endRadius, endpoint_arch_course_west_2_9.baseRadius, endpoint_arch_course_west_2_9.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_arch_course_west_2_9) {
    mesh_arch_course_west_2_9Geometry.scale(0.56, 0.36, 0.055);
  }
  const mesh_arch_course_west_2_9 = new THREE.Mesh(
    mesh_arch_course_west_2_9Geometry,
    materialMap["stone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_course_west_2_9.name = "arch-course-west-2";
  if (endpoint_arch_course_west_2_9) {
    mesh_arch_course_west_2_9.position.copy(endpoint_arch_course_west_2_9.midpoint);
    mesh_arch_course_west_2_9.quaternion.copy(endpoint_arch_course_west_2_9.quaternion);
  }
  mesh_arch_course_west_2_9.castShadow = options.castShadow ?? true;
  mesh_arch_course_west_2_9.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_course_west_2_9.userData.sculptComponent = {"id": "arch-course-west-2", "name": "arch-course-west-2", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.56, "height": 0.36, "depth": 0.055, "units": "relative", "confidence": 0.8}, "transform": {"position": [-1.51, 2.0, -0.976], "rotation": [0, 0, 0], "scale": [0.56, 0.36, 0.055]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "arch-course-west-2", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_arch_course_west_2_9.add(mesh_arch_course_west_2_9);
  meshes["arch-course-west-2"] = mesh_arch_course_west_2_9;
  colliders["arch-course-west-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["arch-course-west-2"] ??= [];
  destructionGroups["arch-course-west-2"].push(node_arch_course_west_2_9);

  const endpoint_arch_course_west_3_10 = makeAttachmentEndpoint(null);
  const node_arch_course_west_3_10 = new THREE.Group();
  node_arch_course_west_3_10.name = "arch-course-west-3__pivot";
  node_arch_course_west_3_10.scale.set(1, 1, 1);
  if (endpoint_arch_course_west_3_10) {
    node_arch_course_west_3_10.position.copy(endpoint_arch_course_west_3_10.start);
    node_arch_course_west_3_10.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_course_west_3_10.position.set(-1.49, 2.4000000000000004, -0.976);
    node_arch_course_west_3_10.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_course_west_3_10.userData.sculptComponent = {"id": "arch-course-west-3", "name": "arch-course-west-3", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.56, "height": 0.36, "depth": 0.055, "units": "relative", "confidence": 0.8}, "transform": {"position": [-1.49, 2.4000000000000004, -0.976], "rotation": [0, 0, 0], "scale": [0.56, 0.36, 0.055]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "arch-course-west-3", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_arch_course_west_3_10.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "arch-course-west-3", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}};
  (nodes["root"] ?? root).add(node_arch_course_west_3_10);
  nodes["arch-course-west-3"] = node_arch_course_west_3_10;
  const mesh_arch_course_west_3_10Geometry = endpoint_arch_course_west_3_10
    ? new THREE.CylinderGeometry(endpoint_arch_course_west_3_10.endRadius, endpoint_arch_course_west_3_10.baseRadius, endpoint_arch_course_west_3_10.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_arch_course_west_3_10) {
    mesh_arch_course_west_3_10Geometry.scale(0.56, 0.36, 0.055);
  }
  const mesh_arch_course_west_3_10 = new THREE.Mesh(
    mesh_arch_course_west_3_10Geometry,
    materialMap["stone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_course_west_3_10.name = "arch-course-west-3";
  if (endpoint_arch_course_west_3_10) {
    mesh_arch_course_west_3_10.position.copy(endpoint_arch_course_west_3_10.midpoint);
    mesh_arch_course_west_3_10.quaternion.copy(endpoint_arch_course_west_3_10.quaternion);
  }
  mesh_arch_course_west_3_10.castShadow = options.castShadow ?? true;
  mesh_arch_course_west_3_10.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_course_west_3_10.userData.sculptComponent = {"id": "arch-course-west-3", "name": "arch-course-west-3", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.56, "height": 0.36, "depth": 0.055, "units": "relative", "confidence": 0.8}, "transform": {"position": [-1.49, 2.4000000000000004, -0.976], "rotation": [0, 0, 0], "scale": [0.56, 0.36, 0.055]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "arch-course-west-3", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_arch_course_west_3_10.add(mesh_arch_course_west_3_10);
  meshes["arch-course-west-3"] = mesh_arch_course_west_3_10;
  colliders["arch-course-west-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["arch-course-west-3"] ??= [];
  destructionGroups["arch-course-west-3"].push(node_arch_course_west_3_10);

  const endpoint_arch_course_west_4_11 = makeAttachmentEndpoint(null);
  const node_arch_course_west_4_11 = new THREE.Group();
  node_arch_course_west_4_11.name = "arch-course-west-4__pivot";
  node_arch_course_west_4_11.scale.set(1, 1, 1);
  if (endpoint_arch_course_west_4_11) {
    node_arch_course_west_4_11.position.copy(endpoint_arch_course_west_4_11.start);
    node_arch_course_west_4_11.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_course_west_4_11.position.set(-1.51, 2.8, -0.976);
    node_arch_course_west_4_11.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_course_west_4_11.userData.sculptComponent = {"id": "arch-course-west-4", "name": "arch-course-west-4", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.56, "height": 0.36, "depth": 0.055, "units": "relative", "confidence": 0.8}, "transform": {"position": [-1.51, 2.8, -0.976], "rotation": [0, 0, 0], "scale": [0.56, 0.36, 0.055]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "arch-course-west-4", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_arch_course_west_4_11.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "arch-course-west-4", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}};
  (nodes["root"] ?? root).add(node_arch_course_west_4_11);
  nodes["arch-course-west-4"] = node_arch_course_west_4_11;
  const mesh_arch_course_west_4_11Geometry = endpoint_arch_course_west_4_11
    ? new THREE.CylinderGeometry(endpoint_arch_course_west_4_11.endRadius, endpoint_arch_course_west_4_11.baseRadius, endpoint_arch_course_west_4_11.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_arch_course_west_4_11) {
    mesh_arch_course_west_4_11Geometry.scale(0.56, 0.36, 0.055);
  }
  const mesh_arch_course_west_4_11 = new THREE.Mesh(
    mesh_arch_course_west_4_11Geometry,
    materialMap["stone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_course_west_4_11.name = "arch-course-west-4";
  if (endpoint_arch_course_west_4_11) {
    mesh_arch_course_west_4_11.position.copy(endpoint_arch_course_west_4_11.midpoint);
    mesh_arch_course_west_4_11.quaternion.copy(endpoint_arch_course_west_4_11.quaternion);
  }
  mesh_arch_course_west_4_11.castShadow = options.castShadow ?? true;
  mesh_arch_course_west_4_11.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_course_west_4_11.userData.sculptComponent = {"id": "arch-course-west-4", "name": "arch-course-west-4", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.56, "height": 0.36, "depth": 0.055, "units": "relative", "confidence": 0.8}, "transform": {"position": [-1.51, 2.8, -0.976], "rotation": [0, 0, 0], "scale": [0.56, 0.36, 0.055]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "arch-course-west-4", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_arch_course_west_4_11.add(mesh_arch_course_west_4_11);
  meshes["arch-course-west-4"] = mesh_arch_course_west_4_11;
  colliders["arch-course-west-4"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["arch-course-west-4"] ??= [];
  destructionGroups["arch-course-west-4"].push(node_arch_course_west_4_11);

  const endpoint_voussoir_west_0_12 = makeAttachmentEndpoint(null);
  const node_voussoir_west_0_12 = new THREE.Group();
  node_voussoir_west_0_12.name = "voussoir-west-0__pivot";
  node_voussoir_west_0_12.scale.set(1, 1, 1);
  if (endpoint_voussoir_west_0_12) {
    node_voussoir_west_0_12.position.copy(endpoint_voussoir_west_0_12.start);
    node_voussoir_west_0_12.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_voussoir_west_0_12.position.set(0.0, 3.0, -0.99);
    node_voussoir_west_0_12.rotation.set(0.0, 0.0, 0.0);
  }
  node_voussoir_west_0_12.userData.sculptComponent = {"id": "voussoir-west-0", "name": "voussoir-west-0", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides", "profile2D": {"points": [[-0.37003479695035446, 1.7513349905274862], [-0.8041715882254997, 1.599189812589762], [-0.5525871807359578, 1.0988846198242497], [-0.2542697208094614, 1.203431306340116]], "depth": 0.055}}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 3, -0.99], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "voussoir-west-0", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_voussoir_west_0_12.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "voussoir-west-0", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}};
  (nodes["root"] ?? root).add(node_voussoir_west_0_12);
  nodes["voussoir-west-0"] = node_voussoir_west_0_12;
  const mesh_voussoir_west_0_12Geometry = endpoint_voussoir_west_0_12
    ? new THREE.CylinderGeometry(endpoint_voussoir_west_0_12.endRadius, endpoint_voussoir_west_0_12.baseRadius, endpoint_voussoir_west_0_12.length, 32, 12)
    : buildExtrudeGeometry({"points": [[-0.37003479695035446, 1.7513349905274862], [-0.8041715882254997, 1.599189812589762], [-0.5525871807359578, 1.0988846198242497], [-0.2542697208094614, 1.203431306340116]], "depth": 0.055});
  if (!endpoint_voussoir_west_0_12) {
    mesh_voussoir_west_0_12Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_voussoir_west_0_12 = new THREE.Mesh(
    mesh_voussoir_west_0_12Geometry,
    materialMap["stone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_voussoir_west_0_12.name = "voussoir-west-0";
  if (endpoint_voussoir_west_0_12) {
    mesh_voussoir_west_0_12.position.copy(endpoint_voussoir_west_0_12.midpoint);
    mesh_voussoir_west_0_12.quaternion.copy(endpoint_voussoir_west_0_12.quaternion);
  }
  mesh_voussoir_west_0_12.castShadow = options.castShadow ?? true;
  mesh_voussoir_west_0_12.receiveShadow = options.receiveShadow ?? true;
  mesh_voussoir_west_0_12.userData.sculptComponent = {"id": "voussoir-west-0", "name": "voussoir-west-0", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides", "profile2D": {"points": [[-0.37003479695035446, 1.7513349905274862], [-0.8041715882254997, 1.599189812589762], [-0.5525871807359578, 1.0988846198242497], [-0.2542697208094614, 1.203431306340116]], "depth": 0.055}}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 3, -0.99], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "voussoir-west-0", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_voussoir_west_0_12.add(mesh_voussoir_west_0_12);
  meshes["voussoir-west-0"] = mesh_voussoir_west_0_12;
  colliders["voussoir-west-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["voussoir-west-0"] ??= [];
  destructionGroups["voussoir-west-0"].push(node_voussoir_west_0_12);

  const endpoint_voussoir_west_1_13 = makeAttachmentEndpoint(null);
  const node_voussoir_west_1_13 = new THREE.Group();
  node_voussoir_west_1_13.name = "voussoir-west-1__pivot";
  node_voussoir_west_1_13.scale.set(1, 1, 1);
  if (endpoint_voussoir_west_1_13) {
    node_voussoir_west_1_13.position.copy(endpoint_voussoir_west_1_13.start);
    node_voussoir_west_1_13.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_voussoir_west_1_13.position.set(0.0, 3.0, -0.99);
    node_voussoir_west_1_13.rotation.set(0.0, 0.0, 0.0);
  }
  node_voussoir_west_1_13.userData.sculptComponent = {"id": "voussoir-west-1", "name": "voussoir-west-1", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides", "profile2D": {"points": [[-0.8303675670537606, 1.585745787818848], [-1.2070992844094217, 1.3217455570488073], [-0.8294592848176473, 0.9082385671340966], [-0.5705877695397349, 1.0896465469369736]], "depth": 0.055}}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 3, -0.99], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "voussoir-west-1", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_voussoir_west_1_13.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "voussoir-west-1", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}};
  (nodes["root"] ?? root).add(node_voussoir_west_1_13);
  nodes["voussoir-west-1"] = node_voussoir_west_1_13;
  const mesh_voussoir_west_1_13Geometry = endpoint_voussoir_west_1_13
    ? new THREE.CylinderGeometry(endpoint_voussoir_west_1_13.endRadius, endpoint_voussoir_west_1_13.baseRadius, endpoint_voussoir_west_1_13.length, 32, 12)
    : buildExtrudeGeometry({"points": [[-0.8303675670537606, 1.585745787818848], [-1.2070992844094217, 1.3217455570488073], [-0.8294592848176473, 0.9082385671340966], [-0.5705877695397349, 1.0896465469369736]], "depth": 0.055});
  if (!endpoint_voussoir_west_1_13) {
    mesh_voussoir_west_1_13Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_voussoir_west_1_13 = new THREE.Mesh(
    mesh_voussoir_west_1_13Geometry,
    materialMap["stone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_voussoir_west_1_13.name = "voussoir-west-1";
  if (endpoint_voussoir_west_1_13) {
    mesh_voussoir_west_1_13.position.copy(endpoint_voussoir_west_1_13.midpoint);
    mesh_voussoir_west_1_13.quaternion.copy(endpoint_voussoir_west_1_13.quaternion);
  }
  mesh_voussoir_west_1_13.castShadow = options.castShadow ?? true;
  mesh_voussoir_west_1_13.receiveShadow = options.receiveShadow ?? true;
  mesh_voussoir_west_1_13.userData.sculptComponent = {"id": "voussoir-west-1", "name": "voussoir-west-1", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides", "profile2D": {"points": [[-0.8303675670537606, 1.585745787818848], [-1.2070992844094217, 1.3217455570488073], [-0.8294592848176473, 0.9082385671340966], [-0.5705877695397349, 1.0896465469369736]], "depth": 0.055}}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 3, -0.99], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "voussoir-west-1", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_voussoir_west_1_13.add(mesh_voussoir_west_1_13);
  meshes["voussoir-west-1"] = mesh_voussoir_west_1_13;
  colliders["voussoir-west-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["voussoir-west-1"] ??= [];
  destructionGroups["voussoir-west-1"].push(node_voussoir_west_1_13);

  const endpoint_voussoir_west_2_14 = makeAttachmentEndpoint(null);
  const node_voussoir_west_2_14 = new THREE.Group();
  node_voussoir_west_2_14.name = "voussoir-west-2__pivot";
  node_voussoir_west_2_14.scale.set(1, 1, 1);
  if (endpoint_voussoir_west_2_14) {
    node_voussoir_west_2_14.position.copy(endpoint_voussoir_west_2_14.start);
    node_voussoir_west_2_14.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_voussoir_west_2_14.position.set(0.0, 3.0, -0.99);
    node_voussoir_west_2_14.rotation.set(0.0, 0.0, 0.0);
  }
  node_voussoir_west_2_14.userData.sculptComponent = {"id": "voussoir-west-2", "name": "voussoir-west-2", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides", "profile2D": {"points": [[-1.228677121809653, 1.3017113851931796], [-1.5198642841763876, 0.9455752522591719], [-1.0443760165010931, 0.6497528269713863], [-0.844286513869203, 0.8944720691550899]], "depth": 0.055}}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 3, -0.99], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "voussoir-west-2", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_voussoir_west_2_14.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "voussoir-west-2", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}};
  (nodes["root"] ?? root).add(node_voussoir_west_2_14);
  nodes["voussoir-west-2"] = node_voussoir_west_2_14;
  const mesh_voussoir_west_2_14Geometry = endpoint_voussoir_west_2_14
    ? new THREE.CylinderGeometry(endpoint_voussoir_west_2_14.endRadius, endpoint_voussoir_west_2_14.baseRadius, endpoint_voussoir_west_2_14.length, 32, 12)
    : buildExtrudeGeometry({"points": [[-1.228677121809653, 1.3017113851931796], [-1.5198642841763876, 0.9455752522591719], [-1.0443760165010931, 0.6497528269713863], [-0.844286513869203, 0.8944720691550899]], "depth": 0.055});
  if (!endpoint_voussoir_west_2_14) {
    mesh_voussoir_west_2_14Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_voussoir_west_2_14 = new THREE.Mesh(
    mesh_voussoir_west_2_14Geometry,
    materialMap["stone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_voussoir_west_2_14.name = "voussoir-west-2";
  if (endpoint_voussoir_west_2_14) {
    mesh_voussoir_west_2_14.position.copy(endpoint_voussoir_west_2_14.midpoint);
    mesh_voussoir_west_2_14.quaternion.copy(endpoint_voussoir_west_2_14.quaternion);
  }
  mesh_voussoir_west_2_14.castShadow = options.castShadow ?? true;
  mesh_voussoir_west_2_14.receiveShadow = options.receiveShadow ?? true;
  mesh_voussoir_west_2_14.userData.sculptComponent = {"id": "voussoir-west-2", "name": "voussoir-west-2", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides", "profile2D": {"points": [[-1.228677121809653, 1.3017113851931796], [-1.5198642841763876, 0.9455752522591719], [-1.0443760165010931, 0.6497528269713863], [-0.844286513869203, 0.8944720691550899]], "depth": 0.055}}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 3, -0.99], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "voussoir-west-2", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_voussoir_west_2_14.add(mesh_voussoir_west_2_14);
  meshes["voussoir-west-2"] = mesh_voussoir_west_2_14;
  colliders["voussoir-west-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["voussoir-west-2"] ??= [];
  destructionGroups["voussoir-west-2"].push(node_voussoir_west_2_14);

  const endpoint_voussoir_west_3_15 = makeAttachmentEndpoint(null);
  const node_voussoir_west_3_15 = new THREE.Group();
  node_voussoir_west_3_15.name = "voussoir-west-3__pivot";
  node_voussoir_west_3_15.scale.set(1, 1, 1);
  if (endpoint_voussoir_west_3_15) {
    node_voussoir_west_3_15.position.copy(endpoint_voussoir_west_3_15.start);
    node_voussoir_west_3_15.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_voussoir_west_3_15.position.set(0.0, 3.0, -0.99);
    node_voussoir_west_3_15.rotation.set(0.0, 0.0, 0.0);
  }
  node_voussoir_west_3_15.userData.sculptComponent = {"id": "voussoir-west-3", "name": "voussoir-west-3", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides", "profile2D": {"points": [[-1.5352122519105074, 0.9204473594855218], [-1.7191050164542754, 0.49877644531568], [-1.1812844526473512, 0.34273465236775774], [-1.054922385391019, 0.6324861743950791]], "depth": 0.055}}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 3, -0.99], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "voussoir-west-3", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_voussoir_west_3_15.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "voussoir-west-3", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}};
  (nodes["root"] ?? root).add(node_voussoir_west_3_15);
  nodes["voussoir-west-3"] = node_voussoir_west_3_15;
  const mesh_voussoir_west_3_15Geometry = endpoint_voussoir_west_3_15
    ? new THREE.CylinderGeometry(endpoint_voussoir_west_3_15.endRadius, endpoint_voussoir_west_3_15.baseRadius, endpoint_voussoir_west_3_15.length, 32, 12)
    : buildExtrudeGeometry({"points": [[-1.5352122519105074, 0.9204473594855218], [-1.7191050164542754, 0.49877644531568], [-1.1812844526473512, 0.34273465236775774], [-1.054922385391019, 0.6324861743950791]], "depth": 0.055});
  if (!endpoint_voussoir_west_3_15) {
    mesh_voussoir_west_3_15Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_voussoir_west_3_15 = new THREE.Mesh(
    mesh_voussoir_west_3_15Geometry,
    materialMap["stone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_voussoir_west_3_15.name = "voussoir-west-3";
  if (endpoint_voussoir_west_3_15) {
    mesh_voussoir_west_3_15.position.copy(endpoint_voussoir_west_3_15.midpoint);
    mesh_voussoir_west_3_15.quaternion.copy(endpoint_voussoir_west_3_15.quaternion);
  }
  mesh_voussoir_west_3_15.castShadow = options.castShadow ?? true;
  mesh_voussoir_west_3_15.receiveShadow = options.receiveShadow ?? true;
  mesh_voussoir_west_3_15.userData.sculptComponent = {"id": "voussoir-west-3", "name": "voussoir-west-3", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides", "profile2D": {"points": [[-1.5352122519105074, 0.9204473594855218], [-1.7191050164542754, 0.49877644531568], [-1.1812844526473512, 0.34273465236775774], [-1.054922385391019, 0.6324861743950791]], "depth": 0.055}}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 3, -0.99], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "voussoir-west-3", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_voussoir_west_3_15.add(mesh_voussoir_west_3_15);
  meshes["voussoir-west-3"] = mesh_voussoir_west_3_15;
  colliders["voussoir-west-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["voussoir-west-3"] ??= [];
  destructionGroups["voussoir-west-3"].push(node_voussoir_west_3_15);

  const endpoint_voussoir_west_4_16 = makeAttachmentEndpoint(null);
  const node_voussoir_west_4_16 = new THREE.Group();
  node_voussoir_west_4_16.name = "voussoir-west-4__pivot";
  node_voussoir_west_4_16.scale.set(1, 1, 1);
  if (endpoint_voussoir_west_4_16) {
    node_voussoir_west_4_16.position.copy(endpoint_voussoir_west_4_16.start);
    node_voussoir_west_4_16.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_voussoir_west_4_16.position.set(0.0, 3.0, -0.99);
    node_voussoir_west_4_16.rotation.set(0.0, 0.0, 0.0);
  }
  node_voussoir_west_4_16.userData.sculptComponent = {"id": "voussoir-west-4", "name": "voussoir-west-4", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides", "profile2D": {"points": [[-1.727076718220586, 0.47043172658783416], [-1.7899394563009101, 0.014722186563243258], [-1.2299583973464354, 0.01011636283396045], [-1.1867622141962686, 0.3232575551413609]], "depth": 0.055}}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 3, -0.99], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "voussoir-west-4", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_voussoir_west_4_16.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "voussoir-west-4", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}};
  (nodes["root"] ?? root).add(node_voussoir_west_4_16);
  nodes["voussoir-west-4"] = node_voussoir_west_4_16;
  const mesh_voussoir_west_4_16Geometry = endpoint_voussoir_west_4_16
    ? new THREE.CylinderGeometry(endpoint_voussoir_west_4_16.endRadius, endpoint_voussoir_west_4_16.baseRadius, endpoint_voussoir_west_4_16.length, 32, 12)
    : buildExtrudeGeometry({"points": [[-1.727076718220586, 0.47043172658783416], [-1.7899394563009101, 0.014722186563243258], [-1.2299583973464354, 0.01011636283396045], [-1.1867622141962686, 0.3232575551413609]], "depth": 0.055});
  if (!endpoint_voussoir_west_4_16) {
    mesh_voussoir_west_4_16Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_voussoir_west_4_16 = new THREE.Mesh(
    mesh_voussoir_west_4_16Geometry,
    materialMap["stone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_voussoir_west_4_16.name = "voussoir-west-4";
  if (endpoint_voussoir_west_4_16) {
    mesh_voussoir_west_4_16.position.copy(endpoint_voussoir_west_4_16.midpoint);
    mesh_voussoir_west_4_16.quaternion.copy(endpoint_voussoir_west_4_16.quaternion);
  }
  mesh_voussoir_west_4_16.castShadow = options.castShadow ?? true;
  mesh_voussoir_west_4_16.receiveShadow = options.receiveShadow ?? true;
  mesh_voussoir_west_4_16.userData.sculptComponent = {"id": "voussoir-west-4", "name": "voussoir-west-4", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides", "profile2D": {"points": [[-1.727076718220586, 0.47043172658783416], [-1.7899394563009101, 0.014722186563243258], [-1.2299583973464354, 0.01011636283396045], [-1.1867622141962686, 0.3232575551413609]], "depth": 0.055}}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 3, -0.99], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "voussoir-west-4", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_voussoir_west_4_16.add(mesh_voussoir_west_4_16);
  meshes["voussoir-west-4"] = mesh_voussoir_west_4_16;
  colliders["voussoir-west-4"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["voussoir-west-4"] ??= [];
  destructionGroups["voussoir-west-4"].push(node_voussoir_west_4_16);

  const endpoint_arch_upright_east_17 = makeAttachmentEndpoint(null);
  const node_arch_upright_east_17 = new THREE.Group();
  node_arch_upright_east_17.name = "arch-upright-east__pivot";
  node_arch_upright_east_17.scale.set(1, 1, 1);
  if (endpoint_arch_upright_east_17) {
    node_arch_upright_east_17.position.copy(endpoint_arch_upright_east_17.start);
    node_arch_upright_east_17.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_upright_east_17.position.set(1.5, 2.0, -1.25);
    node_arch_upright_east_17.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_upright_east_17.userData.sculptComponent = {"id": "arch-upright-east", "name": "arch-upright-east", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.5, "height": 2.0, "depth": 0.5, "units": "relative", "confidence": 0.8}, "transform": {"position": [1.5, 2, -1.25], "rotation": [0, 0, 0], "scale": [0.5, 2.0, 0.5]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "arch-upright-east", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "upright-joints-east", "type": "seam", "geometryEffect": "separate front masonry course faces", "confidence": 0.88}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_arch_upright_east_17.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "arch-upright-east", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}};
  (nodes["root"] ?? root).add(node_arch_upright_east_17);
  nodes["arch-upright-east"] = node_arch_upright_east_17;
  const mesh_arch_upright_east_17Geometry = endpoint_arch_upright_east_17
    ? new THREE.CylinderGeometry(endpoint_arch_upright_east_17.endRadius, endpoint_arch_upright_east_17.baseRadius, endpoint_arch_upright_east_17.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_arch_upright_east_17) {
    mesh_arch_upright_east_17Geometry.scale(0.5, 2.0, 0.5);
  }
  const mesh_arch_upright_east_17 = new THREE.Mesh(
    mesh_arch_upright_east_17Geometry,
    materialMap["stone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_upright_east_17.name = "arch-upright-east";
  if (endpoint_arch_upright_east_17) {
    mesh_arch_upright_east_17.position.copy(endpoint_arch_upright_east_17.midpoint);
    mesh_arch_upright_east_17.quaternion.copy(endpoint_arch_upright_east_17.quaternion);
  }
  mesh_arch_upright_east_17.castShadow = options.castShadow ?? true;
  mesh_arch_upright_east_17.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_upright_east_17.userData.sculptComponent = {"id": "arch-upright-east", "name": "arch-upright-east", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.5, "height": 2.0, "depth": 0.5, "units": "relative", "confidence": 0.8}, "transform": {"position": [1.5, 2, -1.25], "rotation": [0, 0, 0], "scale": [0.5, 2.0, 0.5]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "arch-upright-east", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "upright-joints-east", "type": "seam", "geometryEffect": "separate front masonry course faces", "confidence": 0.88}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_arch_upright_east_17.add(mesh_arch_upright_east_17);
  meshes["arch-upright-east"] = mesh_arch_upright_east_17;
  colliders["arch-upright-east"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["arch-upright-east"] ??= [];
  destructionGroups["arch-upright-east"].push(node_arch_upright_east_17);

  const endpoint_broken_arch_east_18 = makeAttachmentEndpoint(null);
  const node_broken_arch_east_18 = new THREE.Group();
  node_broken_arch_east_18.name = "broken-arch-east__pivot";
  node_broken_arch_east_18.scale.set(1, 1, 1);
  if (endpoint_broken_arch_east_18) {
    node_broken_arch_east_18.position.copy(endpoint_broken_arch_east_18.start);
    node_broken_arch_east_18.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_broken_arch_east_18.position.set(0.0, 3.0, -1.5);
    node_broken_arch_east_18.rotation.set(0.0, 0.0, 0.0);
  }
  node_broken_arch_east_18.userData.sculptComponent = {"id": "broken-arch-east", "name": "broken-arch-east", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides", "profile2D": {"points": [[1.76, 0.0], [1.7572371174804096, 0.0985784608783332], [1.7489571443759762, 0.1968474209539745], [1.7351860768150549, 0.2944983511450929], [1.7159671509815555, 0.39122466276072604], [1.6913607073689216, 0.48672267007866116], [1.6614440013327518, 0.5806925438090411], [1.6263109605368542, 0.6728392524501636], [1.5860718900542683, 0.7628734885809578], [1.5408531260491318, 0.8505125771819122], [1.4907966391267031, 0.935481363132653], [1.4360595885968797, 1.0175130750997556], [1.3768138290506646, 1.096350163102486], [1.3132453707987517, 1.1717451071268228], [1.2455537958662557, 1.243461194249005], [1.1739516313771596, 1.3112732618287104], [1.0986636822958173, 1.3749684044385149], [1.0199263256204707, 1.4343466423101237], [0.9379867682447521, 1.4892215491986964], [0.8531022708172269, 1.539420837693998], [0.7655393400357652, 1.5847869001407113], [0.5437069176390378, 1.125558877940846], [0.6058964991599622, 1.0933386631349418], [0.666183784264739, 1.057685759374074], [0.724379492628175, 1.0187121039134401], [0.7803009107214611, 0.9765400599705361], [0.8337724654667327, 0.9313020325488], [0.8846262754731931, 0.8831400527336684], [0.9327026781241133, 0.8322053317662094], [0.9778507308598471, 0.778657786294379], [1.0199286850830112, 0.72266553629244], [1.0588044311979425, 0.6644043772248955], [1.0943559133871676, 0.6040572281121535], [1.1264715128226337, 0.5418135572307938], [1.1550503981085611, 0.47786878725153664], [1.1800028418556476, 0.4124236816825575], [1.2012505023927, 0.34568371454450364], [1.2187266697312185, 0.2778584252561975], [1.2323764750106923, 0.20916076075645812], [1.2421570627670284, 0.1398064069275385], [1.2480377254832455, 0.07001311141927079], [1.25, 0.0]], "depth": 0.5}}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 3, -1.5], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "broken-arch-east", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "fracture-east", "type": "chip", "geometryEffect": "open crown gap and unequal voussoir endings", "confidence": 0.92}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_broken_arch_east_18.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "broken-arch-east", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}};
  (nodes["root"] ?? root).add(node_broken_arch_east_18);
  nodes["broken-arch-east"] = node_broken_arch_east_18;
  const mesh_broken_arch_east_18Geometry = endpoint_broken_arch_east_18
    ? new THREE.CylinderGeometry(endpoint_broken_arch_east_18.endRadius, endpoint_broken_arch_east_18.baseRadius, endpoint_broken_arch_east_18.length, 32, 12)
    : buildExtrudeGeometry({"points": [[1.76, 0.0], [1.7572371174804096, 0.0985784608783332], [1.7489571443759762, 0.1968474209539745], [1.7351860768150549, 0.2944983511450929], [1.7159671509815555, 0.39122466276072604], [1.6913607073689216, 0.48672267007866116], [1.6614440013327518, 0.5806925438090411], [1.6263109605368542, 0.6728392524501636], [1.5860718900542683, 0.7628734885809578], [1.5408531260491318, 0.8505125771819122], [1.4907966391267031, 0.935481363132653], [1.4360595885968797, 1.0175130750997556], [1.3768138290506646, 1.096350163102486], [1.3132453707987517, 1.1717451071268228], [1.2455537958662557, 1.243461194249005], [1.1739516313771596, 1.3112732618287104], [1.0986636822958173, 1.3749684044385149], [1.0199263256204707, 1.4343466423101237], [0.9379867682447521, 1.4892215491986964], [0.8531022708172269, 1.539420837693998], [0.7655393400357652, 1.5847869001407113], [0.5437069176390378, 1.125558877940846], [0.6058964991599622, 1.0933386631349418], [0.666183784264739, 1.057685759374074], [0.724379492628175, 1.0187121039134401], [0.7803009107214611, 0.9765400599705361], [0.8337724654667327, 0.9313020325488], [0.8846262754731931, 0.8831400527336684], [0.9327026781241133, 0.8322053317662094], [0.9778507308598471, 0.778657786294379], [1.0199286850830112, 0.72266553629244], [1.0588044311979425, 0.6644043772248955], [1.0943559133871676, 0.6040572281121535], [1.1264715128226337, 0.5418135572307938], [1.1550503981085611, 0.47786878725153664], [1.1800028418556476, 0.4124236816825575], [1.2012505023927, 0.34568371454450364], [1.2187266697312185, 0.2778584252561975], [1.2323764750106923, 0.20916076075645812], [1.2421570627670284, 0.1398064069275385], [1.2480377254832455, 0.07001311141927079], [1.25, 0.0]], "depth": 0.5});
  if (!endpoint_broken_arch_east_18) {
    mesh_broken_arch_east_18Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_broken_arch_east_18 = new THREE.Mesh(
    mesh_broken_arch_east_18Geometry,
    materialMap["stone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_broken_arch_east_18.name = "broken-arch-east";
  if (endpoint_broken_arch_east_18) {
    mesh_broken_arch_east_18.position.copy(endpoint_broken_arch_east_18.midpoint);
    mesh_broken_arch_east_18.quaternion.copy(endpoint_broken_arch_east_18.quaternion);
  }
  mesh_broken_arch_east_18.castShadow = options.castShadow ?? true;
  mesh_broken_arch_east_18.receiveShadow = options.receiveShadow ?? true;
  mesh_broken_arch_east_18.userData.sculptComponent = {"id": "broken-arch-east", "name": "broken-arch-east", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides", "profile2D": {"points": [[1.76, 0.0], [1.7572371174804096, 0.0985784608783332], [1.7489571443759762, 0.1968474209539745], [1.7351860768150549, 0.2944983511450929], [1.7159671509815555, 0.39122466276072604], [1.6913607073689216, 0.48672267007866116], [1.6614440013327518, 0.5806925438090411], [1.6263109605368542, 0.6728392524501636], [1.5860718900542683, 0.7628734885809578], [1.5408531260491318, 0.8505125771819122], [1.4907966391267031, 0.935481363132653], [1.4360595885968797, 1.0175130750997556], [1.3768138290506646, 1.096350163102486], [1.3132453707987517, 1.1717451071268228], [1.2455537958662557, 1.243461194249005], [1.1739516313771596, 1.3112732618287104], [1.0986636822958173, 1.3749684044385149], [1.0199263256204707, 1.4343466423101237], [0.9379867682447521, 1.4892215491986964], [0.8531022708172269, 1.539420837693998], [0.7655393400357652, 1.5847869001407113], [0.5437069176390378, 1.125558877940846], [0.6058964991599622, 1.0933386631349418], [0.666183784264739, 1.057685759374074], [0.724379492628175, 1.0187121039134401], [0.7803009107214611, 0.9765400599705361], [0.8337724654667327, 0.9313020325488], [0.8846262754731931, 0.8831400527336684], [0.9327026781241133, 0.8322053317662094], [0.9778507308598471, 0.778657786294379], [1.0199286850830112, 0.72266553629244], [1.0588044311979425, 0.6644043772248955], [1.0943559133871676, 0.6040572281121535], [1.1264715128226337, 0.5418135572307938], [1.1550503981085611, 0.47786878725153664], [1.1800028418556476, 0.4124236816825575], [1.2012505023927, 0.34568371454450364], [1.2187266697312185, 0.2778584252561975], [1.2323764750106923, 0.20916076075645812], [1.2421570627670284, 0.1398064069275385], [1.2480377254832455, 0.07001311141927079], [1.25, 0.0]], "depth": 0.5}}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 3, -1.5], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "broken-arch-east", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "fracture-east", "type": "chip", "geometryEffect": "open crown gap and unequal voussoir endings", "confidence": 0.92}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_broken_arch_east_18.add(mesh_broken_arch_east_18);
  meshes["broken-arch-east"] = mesh_broken_arch_east_18;
  colliders["broken-arch-east"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["broken-arch-east"] ??= [];
  destructionGroups["broken-arch-east"].push(node_broken_arch_east_18);

  const endpoint_arch_course_east_0_19 = makeAttachmentEndpoint(null);
  const node_arch_course_east_0_19 = new THREE.Group();
  node_arch_course_east_0_19.name = "arch-course-east-0__pivot";
  node_arch_course_east_0_19.scale.set(1, 1, 1);
  if (endpoint_arch_course_east_0_19) {
    node_arch_course_east_0_19.position.copy(endpoint_arch_course_east_0_19.start);
    node_arch_course_east_0_19.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_course_east_0_19.position.set(1.49, 1.2, -0.976);
    node_arch_course_east_0_19.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_course_east_0_19.userData.sculptComponent = {"id": "arch-course-east-0", "name": "arch-course-east-0", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.56, "height": 0.36, "depth": 0.055, "units": "relative", "confidence": 0.8}, "transform": {"position": [1.49, 1.2, -0.976], "rotation": [0, 0, 0], "scale": [0.56, 0.36, 0.055]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "arch-course-east-0", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_arch_course_east_0_19.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "arch-course-east-0", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}};
  (nodes["root"] ?? root).add(node_arch_course_east_0_19);
  nodes["arch-course-east-0"] = node_arch_course_east_0_19;
  const mesh_arch_course_east_0_19Geometry = endpoint_arch_course_east_0_19
    ? new THREE.CylinderGeometry(endpoint_arch_course_east_0_19.endRadius, endpoint_arch_course_east_0_19.baseRadius, endpoint_arch_course_east_0_19.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_arch_course_east_0_19) {
    mesh_arch_course_east_0_19Geometry.scale(0.56, 0.36, 0.055);
  }
  const mesh_arch_course_east_0_19 = new THREE.Mesh(
    mesh_arch_course_east_0_19Geometry,
    materialMap["stone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_course_east_0_19.name = "arch-course-east-0";
  if (endpoint_arch_course_east_0_19) {
    mesh_arch_course_east_0_19.position.copy(endpoint_arch_course_east_0_19.midpoint);
    mesh_arch_course_east_0_19.quaternion.copy(endpoint_arch_course_east_0_19.quaternion);
  }
  mesh_arch_course_east_0_19.castShadow = options.castShadow ?? true;
  mesh_arch_course_east_0_19.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_course_east_0_19.userData.sculptComponent = {"id": "arch-course-east-0", "name": "arch-course-east-0", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.56, "height": 0.36, "depth": 0.055, "units": "relative", "confidence": 0.8}, "transform": {"position": [1.49, 1.2, -0.976], "rotation": [0, 0, 0], "scale": [0.56, 0.36, 0.055]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "arch-course-east-0", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_arch_course_east_0_19.add(mesh_arch_course_east_0_19);
  meshes["arch-course-east-0"] = mesh_arch_course_east_0_19;
  colliders["arch-course-east-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["arch-course-east-0"] ??= [];
  destructionGroups["arch-course-east-0"].push(node_arch_course_east_0_19);

  const endpoint_arch_course_east_1_20 = makeAttachmentEndpoint(null);
  const node_arch_course_east_1_20 = new THREE.Group();
  node_arch_course_east_1_20.name = "arch-course-east-1__pivot";
  node_arch_course_east_1_20.scale.set(1, 1, 1);
  if (endpoint_arch_course_east_1_20) {
    node_arch_course_east_1_20.position.copy(endpoint_arch_course_east_1_20.start);
    node_arch_course_east_1_20.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_course_east_1_20.position.set(1.51, 1.6, -0.976);
    node_arch_course_east_1_20.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_course_east_1_20.userData.sculptComponent = {"id": "arch-course-east-1", "name": "arch-course-east-1", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.56, "height": 0.36, "depth": 0.055, "units": "relative", "confidence": 0.8}, "transform": {"position": [1.51, 1.6, -0.976], "rotation": [0, 0, 0], "scale": [0.56, 0.36, 0.055]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "arch-course-east-1", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_arch_course_east_1_20.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "arch-course-east-1", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}};
  (nodes["root"] ?? root).add(node_arch_course_east_1_20);
  nodes["arch-course-east-1"] = node_arch_course_east_1_20;
  const mesh_arch_course_east_1_20Geometry = endpoint_arch_course_east_1_20
    ? new THREE.CylinderGeometry(endpoint_arch_course_east_1_20.endRadius, endpoint_arch_course_east_1_20.baseRadius, endpoint_arch_course_east_1_20.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_arch_course_east_1_20) {
    mesh_arch_course_east_1_20Geometry.scale(0.56, 0.36, 0.055);
  }
  const mesh_arch_course_east_1_20 = new THREE.Mesh(
    mesh_arch_course_east_1_20Geometry,
    materialMap["stone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_course_east_1_20.name = "arch-course-east-1";
  if (endpoint_arch_course_east_1_20) {
    mesh_arch_course_east_1_20.position.copy(endpoint_arch_course_east_1_20.midpoint);
    mesh_arch_course_east_1_20.quaternion.copy(endpoint_arch_course_east_1_20.quaternion);
  }
  mesh_arch_course_east_1_20.castShadow = options.castShadow ?? true;
  mesh_arch_course_east_1_20.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_course_east_1_20.userData.sculptComponent = {"id": "arch-course-east-1", "name": "arch-course-east-1", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.56, "height": 0.36, "depth": 0.055, "units": "relative", "confidence": 0.8}, "transform": {"position": [1.51, 1.6, -0.976], "rotation": [0, 0, 0], "scale": [0.56, 0.36, 0.055]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "arch-course-east-1", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_arch_course_east_1_20.add(mesh_arch_course_east_1_20);
  meshes["arch-course-east-1"] = mesh_arch_course_east_1_20;
  colliders["arch-course-east-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["arch-course-east-1"] ??= [];
  destructionGroups["arch-course-east-1"].push(node_arch_course_east_1_20);

  const endpoint_arch_course_east_2_21 = makeAttachmentEndpoint(null);
  const node_arch_course_east_2_21 = new THREE.Group();
  node_arch_course_east_2_21.name = "arch-course-east-2__pivot";
  node_arch_course_east_2_21.scale.set(1, 1, 1);
  if (endpoint_arch_course_east_2_21) {
    node_arch_course_east_2_21.position.copy(endpoint_arch_course_east_2_21.start);
    node_arch_course_east_2_21.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_course_east_2_21.position.set(1.49, 2.0, -0.976);
    node_arch_course_east_2_21.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_course_east_2_21.userData.sculptComponent = {"id": "arch-course-east-2", "name": "arch-course-east-2", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.56, "height": 0.36, "depth": 0.055, "units": "relative", "confidence": 0.8}, "transform": {"position": [1.49, 2.0, -0.976], "rotation": [0, 0, 0], "scale": [0.56, 0.36, 0.055]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "arch-course-east-2", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_arch_course_east_2_21.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "arch-course-east-2", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}};
  (nodes["root"] ?? root).add(node_arch_course_east_2_21);
  nodes["arch-course-east-2"] = node_arch_course_east_2_21;
  const mesh_arch_course_east_2_21Geometry = endpoint_arch_course_east_2_21
    ? new THREE.CylinderGeometry(endpoint_arch_course_east_2_21.endRadius, endpoint_arch_course_east_2_21.baseRadius, endpoint_arch_course_east_2_21.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_arch_course_east_2_21) {
    mesh_arch_course_east_2_21Geometry.scale(0.56, 0.36, 0.055);
  }
  const mesh_arch_course_east_2_21 = new THREE.Mesh(
    mesh_arch_course_east_2_21Geometry,
    materialMap["stone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_course_east_2_21.name = "arch-course-east-2";
  if (endpoint_arch_course_east_2_21) {
    mesh_arch_course_east_2_21.position.copy(endpoint_arch_course_east_2_21.midpoint);
    mesh_arch_course_east_2_21.quaternion.copy(endpoint_arch_course_east_2_21.quaternion);
  }
  mesh_arch_course_east_2_21.castShadow = options.castShadow ?? true;
  mesh_arch_course_east_2_21.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_course_east_2_21.userData.sculptComponent = {"id": "arch-course-east-2", "name": "arch-course-east-2", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.56, "height": 0.36, "depth": 0.055, "units": "relative", "confidence": 0.8}, "transform": {"position": [1.49, 2.0, -0.976], "rotation": [0, 0, 0], "scale": [0.56, 0.36, 0.055]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "arch-course-east-2", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_arch_course_east_2_21.add(mesh_arch_course_east_2_21);
  meshes["arch-course-east-2"] = mesh_arch_course_east_2_21;
  colliders["arch-course-east-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["arch-course-east-2"] ??= [];
  destructionGroups["arch-course-east-2"].push(node_arch_course_east_2_21);

  const endpoint_arch_course_east_3_22 = makeAttachmentEndpoint(null);
  const node_arch_course_east_3_22 = new THREE.Group();
  node_arch_course_east_3_22.name = "arch-course-east-3__pivot";
  node_arch_course_east_3_22.scale.set(1, 1, 1);
  if (endpoint_arch_course_east_3_22) {
    node_arch_course_east_3_22.position.copy(endpoint_arch_course_east_3_22.start);
    node_arch_course_east_3_22.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_course_east_3_22.position.set(1.51, 2.4000000000000004, -0.976);
    node_arch_course_east_3_22.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_course_east_3_22.userData.sculptComponent = {"id": "arch-course-east-3", "name": "arch-course-east-3", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.56, "height": 0.36, "depth": 0.055, "units": "relative", "confidence": 0.8}, "transform": {"position": [1.51, 2.4000000000000004, -0.976], "rotation": [0, 0, 0], "scale": [0.56, 0.36, 0.055]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "arch-course-east-3", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_arch_course_east_3_22.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "arch-course-east-3", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}};
  (nodes["root"] ?? root).add(node_arch_course_east_3_22);
  nodes["arch-course-east-3"] = node_arch_course_east_3_22;
  const mesh_arch_course_east_3_22Geometry = endpoint_arch_course_east_3_22
    ? new THREE.CylinderGeometry(endpoint_arch_course_east_3_22.endRadius, endpoint_arch_course_east_3_22.baseRadius, endpoint_arch_course_east_3_22.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_arch_course_east_3_22) {
    mesh_arch_course_east_3_22Geometry.scale(0.56, 0.36, 0.055);
  }
  const mesh_arch_course_east_3_22 = new THREE.Mesh(
    mesh_arch_course_east_3_22Geometry,
    materialMap["stone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_course_east_3_22.name = "arch-course-east-3";
  if (endpoint_arch_course_east_3_22) {
    mesh_arch_course_east_3_22.position.copy(endpoint_arch_course_east_3_22.midpoint);
    mesh_arch_course_east_3_22.quaternion.copy(endpoint_arch_course_east_3_22.quaternion);
  }
  mesh_arch_course_east_3_22.castShadow = options.castShadow ?? true;
  mesh_arch_course_east_3_22.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_course_east_3_22.userData.sculptComponent = {"id": "arch-course-east-3", "name": "arch-course-east-3", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.56, "height": 0.36, "depth": 0.055, "units": "relative", "confidence": 0.8}, "transform": {"position": [1.51, 2.4000000000000004, -0.976], "rotation": [0, 0, 0], "scale": [0.56, 0.36, 0.055]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "arch-course-east-3", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_arch_course_east_3_22.add(mesh_arch_course_east_3_22);
  meshes["arch-course-east-3"] = mesh_arch_course_east_3_22;
  colliders["arch-course-east-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["arch-course-east-3"] ??= [];
  destructionGroups["arch-course-east-3"].push(node_arch_course_east_3_22);

  const endpoint_arch_course_east_4_23 = makeAttachmentEndpoint(null);
  const node_arch_course_east_4_23 = new THREE.Group();
  node_arch_course_east_4_23.name = "arch-course-east-4__pivot";
  node_arch_course_east_4_23.scale.set(1, 1, 1);
  if (endpoint_arch_course_east_4_23) {
    node_arch_course_east_4_23.position.copy(endpoint_arch_course_east_4_23.start);
    node_arch_course_east_4_23.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_arch_course_east_4_23.position.set(1.49, 2.8, -0.976);
    node_arch_course_east_4_23.rotation.set(0.0, 0.0, 0.0);
  }
  node_arch_course_east_4_23.userData.sculptComponent = {"id": "arch-course-east-4", "name": "arch-course-east-4", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.56, "height": 0.36, "depth": 0.055, "units": "relative", "confidence": 0.8}, "transform": {"position": [1.49, 2.8, -0.976], "rotation": [0, 0, 0], "scale": [0.56, 0.36, 0.055]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "arch-course-east-4", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_arch_course_east_4_23.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "arch-course-east-4", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}};
  (nodes["root"] ?? root).add(node_arch_course_east_4_23);
  nodes["arch-course-east-4"] = node_arch_course_east_4_23;
  const mesh_arch_course_east_4_23Geometry = endpoint_arch_course_east_4_23
    ? new THREE.CylinderGeometry(endpoint_arch_course_east_4_23.endRadius, endpoint_arch_course_east_4_23.baseRadius, endpoint_arch_course_east_4_23.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_arch_course_east_4_23) {
    mesh_arch_course_east_4_23Geometry.scale(0.56, 0.36, 0.055);
  }
  const mesh_arch_course_east_4_23 = new THREE.Mesh(
    mesh_arch_course_east_4_23Geometry,
    materialMap["stone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_arch_course_east_4_23.name = "arch-course-east-4";
  if (endpoint_arch_course_east_4_23) {
    mesh_arch_course_east_4_23.position.copy(endpoint_arch_course_east_4_23.midpoint);
    mesh_arch_course_east_4_23.quaternion.copy(endpoint_arch_course_east_4_23.quaternion);
  }
  mesh_arch_course_east_4_23.castShadow = options.castShadow ?? true;
  mesh_arch_course_east_4_23.receiveShadow = options.receiveShadow ?? true;
  mesh_arch_course_east_4_23.userData.sculptComponent = {"id": "arch-course-east-4", "name": "arch-course-east-4", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.56, "height": 0.36, "depth": 0.055, "units": "relative", "confidence": 0.8}, "transform": {"position": [1.49, 2.8, -0.976], "rotation": [0, 0, 0], "scale": [0.56, 0.36, 0.055]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "arch-course-east-4", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_arch_course_east_4_23.add(mesh_arch_course_east_4_23);
  meshes["arch-course-east-4"] = mesh_arch_course_east_4_23;
  colliders["arch-course-east-4"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["arch-course-east-4"] ??= [];
  destructionGroups["arch-course-east-4"].push(node_arch_course_east_4_23);

  const endpoint_voussoir_east_0_24 = makeAttachmentEndpoint(null);
  const node_voussoir_east_0_24 = new THREE.Group();
  node_voussoir_east_0_24.name = "voussoir-east-0__pivot";
  node_voussoir_east_0_24.scale.set(1, 1, 1);
  if (endpoint_voussoir_east_0_24) {
    node_voussoir_east_0_24.position.copy(endpoint_voussoir_east_0_24.start);
    node_voussoir_east_0_24.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_voussoir_east_0_24.position.set(0.0, 3.0, -0.99);
    node_voussoir_east_0_24.rotation.set(0.0, 0.0, 0.0);
  }
  node_voussoir_east_0_24.userData.sculptComponent = {"id": "voussoir-east-0", "name": "voussoir-east-0", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides", "profile2D": {"points": [[1.7899595258909629, 0.012037261823174949], [1.7478528532458781, 0.38614816249756156], [1.201038552789067, 0.26534203344804513], [1.2299721881820582, 0.008271414548885579]], "depth": 0.055}}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 3, -0.99], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "voussoir-east-0", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_voussoir_east_0_24.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "voussoir-east-0", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}};
  (nodes["root"] ?? root).add(node_voussoir_east_0_24);
  nodes["voussoir-east-0"] = node_voussoir_east_0_24;
  const mesh_voussoir_east_0_24Geometry = endpoint_voussoir_east_0_24
    ? new THREE.CylinderGeometry(endpoint_voussoir_east_0_24.endRadius, endpoint_voussoir_east_0_24.baseRadius, endpoint_voussoir_east_0_24.length, 32, 12)
    : buildExtrudeGeometry({"points": [[1.7899595258909629, 0.012037261823174949], [1.7478528532458781, 0.38614816249756156], [1.201038552789067, 0.26534203344804513], [1.2299721881820582, 0.008271414548885579]], "depth": 0.055});
  if (!endpoint_voussoir_east_0_24) {
    mesh_voussoir_east_0_24Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_voussoir_east_0_24 = new THREE.Mesh(
    mesh_voussoir_east_0_24Geometry,
    materialMap["stone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_voussoir_east_0_24.name = "voussoir-east-0";
  if (endpoint_voussoir_east_0_24) {
    mesh_voussoir_east_0_24.position.copy(endpoint_voussoir_east_0_24.midpoint);
    mesh_voussoir_east_0_24.quaternion.copy(endpoint_voussoir_east_0_24.quaternion);
  }
  mesh_voussoir_east_0_24.castShadow = options.castShadow ?? true;
  mesh_voussoir_east_0_24.receiveShadow = options.receiveShadow ?? true;
  mesh_voussoir_east_0_24.userData.sculptComponent = {"id": "voussoir-east-0", "name": "voussoir-east-0", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides", "profile2D": {"points": [[1.7899595258909629, 0.012037261823174949], [1.7478528532458781, 0.38614816249756156], [1.201038552789067, 0.26534203344804513], [1.2299721881820582, 0.008271414548885579]], "depth": 0.055}}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 3, -0.99], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "voussoir-east-0", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_voussoir_east_0_24.add(mesh_voussoir_east_0_24);
  meshes["voussoir-east-0"] = mesh_voussoir_east_0_24;
  colliders["voussoir-east-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["voussoir-east-0"] ??= [];
  destructionGroups["voussoir-east-0"].push(node_voussoir_east_0_24);

  const endpoint_voussoir_east_1_25 = makeAttachmentEndpoint(null);
  const node_voussoir_east_1_25 = new THREE.Group();
  node_voussoir_east_1_25.name = "voussoir-east-1__pivot";
  node_voussoir_east_1_25.scale.set(1, 1, 1);
  if (endpoint_voussoir_east_1_25) {
    node_voussoir_east_1_25.position.copy(endpoint_voussoir_east_1_25.start);
    node_voussoir_east_1_25.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_voussoir_east_1_25.position.set(0.0, 3.0, -0.99);
    node_voussoir_east_1_25.rotation.set(0.0, 0.0, 0.0);
  }
  node_voussoir_east_1_25.userData.sculptComponent = {"id": "voussoir-east-1", "name": "voussoir-east-1", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides", "profile2D": {"points": [[1.7425014058625439, 0.40962037372066684], [1.618288293335528, 0.7650117643887472], [1.1120081568730165, 0.5256784749710385], [1.1973613012351558, 0.2814709830594526]], "depth": 0.055}}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 3, -0.99], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "voussoir-east-1", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_voussoir_east_1_25.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "voussoir-east-1", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}};
  (nodes["root"] ?? root).add(node_voussoir_east_1_25);
  nodes["voussoir-east-1"] = node_voussoir_east_1_25;
  const mesh_voussoir_east_1_25Geometry = endpoint_voussoir_east_1_25
    ? new THREE.CylinderGeometry(endpoint_voussoir_east_1_25.endRadius, endpoint_voussoir_east_1_25.baseRadius, endpoint_voussoir_east_1_25.length, 32, 12)
    : buildExtrudeGeometry({"points": [[1.7425014058625439, 0.40962037372066684], [1.618288293335528, 0.7650117643887472], [1.1120081568730165, 0.5256784749710385], [1.1973613012351558, 0.2814709830594526]], "depth": 0.055});
  if (!endpoint_voussoir_east_1_25) {
    mesh_voussoir_east_1_25Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_voussoir_east_1_25 = new THREE.Mesh(
    mesh_voussoir_east_1_25Geometry,
    materialMap["stone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_voussoir_east_1_25.name = "voussoir-east-1";
  if (endpoint_voussoir_east_1_25) {
    mesh_voussoir_east_1_25.position.copy(endpoint_voussoir_east_1_25.midpoint);
    mesh_voussoir_east_1_25.quaternion.copy(endpoint_voussoir_east_1_25.quaternion);
  }
  mesh_voussoir_east_1_25.castShadow = options.castShadow ?? true;
  mesh_voussoir_east_1_25.receiveShadow = options.receiveShadow ?? true;
  mesh_voussoir_east_1_25.userData.sculptComponent = {"id": "voussoir-east-1", "name": "voussoir-east-1", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides", "profile2D": {"points": [[1.7425014058625439, 0.40962037372066684], [1.618288293335528, 0.7650117643887472], [1.1120081568730165, 0.5256784749710385], [1.1973613012351558, 0.2814709830594526]], "depth": 0.055}}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 3, -0.99], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "voussoir-east-1", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_voussoir_east_1_25.add(mesh_voussoir_east_1_25);
  meshes["voussoir-east-1"] = mesh_voussoir_east_1_25;
  colliders["voussoir-east-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["voussoir-east-1"] ??= [];
  destructionGroups["voussoir-east-1"].push(node_voussoir_east_1_25);

  const endpoint_voussoir_east_2_26 = makeAttachmentEndpoint(null);
  const node_voussoir_east_2_26 = new THREE.Group();
  node_voussoir_east_2_26.name = "voussoir-east-2__pivot";
  node_voussoir_east_2_26.scale.set(1, 1, 1);
  if (endpoint_voussoir_east_2_26) {
    node_voussoir_east_2_26.position.copy(endpoint_voussoir_east_2_26.start);
    node_voussoir_east_2_26.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_voussoir_east_2_26.position.set(0.0, 3.0, -0.99);
    node_voussoir_east_2_26.rotation.set(0.0, 0.0, 0.0);
  }
  node_voussoir_east_2_26.userData.sculptComponent = {"id": "voussoir-east-2", "name": "voussoir-east-2", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides", "profile2D": {"points": [[1.6078531706991555, 0.7867071764466574], [1.4077489105970422, 1.1055962213723602], [0.9673358435946157, 0.7597113699932978], [1.1048376536089168, 0.5405864955471444]], "depth": 0.055}}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 3, -0.99], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "voussoir-east-2", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_voussoir_east_2_26.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "voussoir-east-2", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}};
  (nodes["root"] ?? root).add(node_voussoir_east_2_26);
  nodes["voussoir-east-2"] = node_voussoir_east_2_26;
  const mesh_voussoir_east_2_26Geometry = endpoint_voussoir_east_2_26
    ? new THREE.CylinderGeometry(endpoint_voussoir_east_2_26.endRadius, endpoint_voussoir_east_2_26.baseRadius, endpoint_voussoir_east_2_26.length, 32, 12)
    : buildExtrudeGeometry({"points": [[1.6078531706991555, 0.7867071764466574], [1.4077489105970422, 1.1055962213723602], [0.9673358435946157, 0.7597113699932978], [1.1048376536089168, 0.5405864955471444]], "depth": 0.055});
  if (!endpoint_voussoir_east_2_26) {
    mesh_voussoir_east_2_26Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_voussoir_east_2_26 = new THREE.Mesh(
    mesh_voussoir_east_2_26Geometry,
    materialMap["stone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_voussoir_east_2_26.name = "voussoir-east-2";
  if (endpoint_voussoir_east_2_26) {
    mesh_voussoir_east_2_26.position.copy(endpoint_voussoir_east_2_26.midpoint);
    mesh_voussoir_east_2_26.quaternion.copy(endpoint_voussoir_east_2_26.quaternion);
  }
  mesh_voussoir_east_2_26.castShadow = options.castShadow ?? true;
  mesh_voussoir_east_2_26.receiveShadow = options.receiveShadow ?? true;
  mesh_voussoir_east_2_26.userData.sculptComponent = {"id": "voussoir-east-2", "name": "voussoir-east-2", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides", "profile2D": {"points": [[1.6078531706991555, 0.7867071764466574], [1.4077489105970422, 1.1055962213723602], [0.9673358435946157, 0.7597113699932978], [1.1048376536089168, 0.5405864955471444]], "depth": 0.055}}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 3, -0.99], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "voussoir-east-2", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_voussoir_east_2_26.add(mesh_voussoir_east_2_26);
  meshes["voussoir-east-2"] = mesh_voussoir_east_2_26;
  colliders["voussoir-east-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["voussoir-east-2"] ??= [];
  destructionGroups["voussoir-east-2"].push(node_voussoir_east_2_26);

  const endpoint_voussoir_east_3_27 = makeAttachmentEndpoint(null);
  const node_voussoir_east_3_27 = new THREE.Group();
  node_voussoir_east_3_27.name = "voussoir-east-3__pivot";
  node_voussoir_east_3_27.scale.set(1, 1, 1);
  if (endpoint_voussoir_east_3_27) {
    node_voussoir_east_3_27.position.copy(endpoint_voussoir_east_3_27.start);
    node_voussoir_east_3_27.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_voussoir_east_3_27.position.set(0.0, 3.0, -0.99);
    node_voussoir_east_3_27.rotation.set(0.0, 0.0, 0.0);
  }
  node_voussoir_east_3_27.userData.sculptComponent = {"id": "voussoir-east-3", "name": "voussoir-east-3", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides", "profile2D": {"points": [[1.3927522583661953, 1.124429253806509], [1.126769533271966, 1.3908595971161417], [0.7742606290081107, 0.9557303376831588], [0.9570308814471621, 0.7726525040122939]], "depth": 0.055}}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 3, -0.99], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "voussoir-east-3", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_voussoir_east_3_27.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "voussoir-east-3", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}};
  (nodes["root"] ?? root).add(node_voussoir_east_3_27);
  nodes["voussoir-east-3"] = node_voussoir_east_3_27;
  const mesh_voussoir_east_3_27Geometry = endpoint_voussoir_east_3_27
    ? new THREE.CylinderGeometry(endpoint_voussoir_east_3_27.endRadius, endpoint_voussoir_east_3_27.baseRadius, endpoint_voussoir_east_3_27.length, 32, 12)
    : buildExtrudeGeometry({"points": [[1.3927522583661953, 1.124429253806509], [1.126769533271966, 1.3908595971161417], [0.7742606290081107, 0.9557303376831588], [0.9570308814471621, 0.7726525040122939]], "depth": 0.055});
  if (!endpoint_voussoir_east_3_27) {
    mesh_voussoir_east_3_27Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_voussoir_east_3_27 = new THREE.Mesh(
    mesh_voussoir_east_3_27Geometry,
    materialMap["stone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_voussoir_east_3_27.name = "voussoir-east-3";
  if (endpoint_voussoir_east_3_27) {
    mesh_voussoir_east_3_27.position.copy(endpoint_voussoir_east_3_27.midpoint);
    mesh_voussoir_east_3_27.quaternion.copy(endpoint_voussoir_east_3_27.quaternion);
  }
  mesh_voussoir_east_3_27.castShadow = options.castShadow ?? true;
  mesh_voussoir_east_3_27.receiveShadow = options.receiveShadow ?? true;
  mesh_voussoir_east_3_27.userData.sculptComponent = {"id": "voussoir-east-3", "name": "voussoir-east-3", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides", "profile2D": {"points": [[1.3927522583661953, 1.124429253806509], [1.126769533271966, 1.3908595971161417], [0.7742606290081107, 0.9557303376831588], [0.9570308814471621, 0.7726525040122939]], "depth": 0.055}}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 3, -0.99], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "voussoir-east-3", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_voussoir_east_3_27.add(mesh_voussoir_east_3_27);
  meshes["voussoir-east-3"] = mesh_voussoir_east_3_27;
  colliders["voussoir-east-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["voussoir-east-3"] ??= [];
  destructionGroups["voussoir-east-3"].push(node_voussoir_east_3_27);

  const endpoint_voussoir_east_4_28 = makeAttachmentEndpoint(null);
  const node_voussoir_east_4_28 = new THREE.Group();
  node_voussoir_east_4_28.name = "voussoir-east-4__pivot";
  node_voussoir_east_4_28.scale.set(1, 1, 1);
  if (endpoint_voussoir_east_4_28) {
    node_voussoir_east_4_28.position.copy(endpoint_voussoir_east_4_28.start);
    node_voussoir_east_4_28.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_voussoir_east_4_28.position.set(0.0, 3.0, -0.99);
    node_voussoir_east_4_28.rotation.set(0.0, 0.0, 0.0);
  }
  node_voussoir_east_4_28.userData.sculptComponent = {"id": "voussoir-east-4", "name": "voussoir-east-4", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides", "profile2D": {"points": [[1.107961743859671, 1.4058878952972875], [0.7894096187455857, 1.6065280743989347], [0.5424434810374695, 1.1039271125758041], [0.7613368407527347, 0.9660570453718791]], "depth": 0.055}}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 3, -0.99], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "voussoir-east-4", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_voussoir_east_4_28.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "voussoir-east-4", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}};
  (nodes["root"] ?? root).add(node_voussoir_east_4_28);
  nodes["voussoir-east-4"] = node_voussoir_east_4_28;
  const mesh_voussoir_east_4_28Geometry = endpoint_voussoir_east_4_28
    ? new THREE.CylinderGeometry(endpoint_voussoir_east_4_28.endRadius, endpoint_voussoir_east_4_28.baseRadius, endpoint_voussoir_east_4_28.length, 32, 12)
    : buildExtrudeGeometry({"points": [[1.107961743859671, 1.4058878952972875], [0.7894096187455857, 1.6065280743989347], [0.5424434810374695, 1.1039271125758041], [0.7613368407527347, 0.9660570453718791]], "depth": 0.055});
  if (!endpoint_voussoir_east_4_28) {
    mesh_voussoir_east_4_28Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_voussoir_east_4_28 = new THREE.Mesh(
    mesh_voussoir_east_4_28Geometry,
    materialMap["stone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_voussoir_east_4_28.name = "voussoir-east-4";
  if (endpoint_voussoir_east_4_28) {
    mesh_voussoir_east_4_28.position.copy(endpoint_voussoir_east_4_28.midpoint);
    mesh_voussoir_east_4_28.quaternion.copy(endpoint_voussoir_east_4_28.quaternion);
  }
  mesh_voussoir_east_4_28.castShadow = options.castShadow ?? true;
  mesh_voussoir_east_4_28.receiveShadow = options.receiveShadow ?? true;
  mesh_voussoir_east_4_28.userData.sculptComponent = {"id": "voussoir-east-4", "name": "voussoir-east-4", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides", "profile2D": {"points": [[1.107961743859671, 1.4058878952972875], [0.7894096187455857, 1.6065280743989347], [0.5424434810374695, 1.1039271125758041], [0.7613368407527347, 0.9660570453718791]], "depth": 0.055}}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 3, -0.99], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "voussoir-east-4", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_voussoir_east_4_28.add(mesh_voussoir_east_4_28);
  meshes["voussoir-east-4"] = mesh_voussoir_east_4_28;
  colliders["voussoir-east-4"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["voussoir-east-4"] ??= [];
  destructionGroups["voussoir-east-4"].push(node_voussoir_east_4_28);

  const endpoint_crescent_29 = makeAttachmentEndpoint(null);
  const node_crescent_29 = new THREE.Group();
  node_crescent_29.name = "crescent__pivot";
  node_crescent_29.scale.set(1, 1, 1);
  if (endpoint_crescent_29) {
    node_crescent_29.position.copy(endpoint_crescent_29.start);
    node_crescent_29.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_crescent_29.position.set(0.0, 3.1, -1.14);
    node_crescent_29.rotation.set(0.0, 0.0, 0.0);
  }
  node_crescent_29.userData.sculptComponent = {"id": "crescent", "name": "crescent", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides", "profile2D": {"points": [[-0.38403700048308376, 0.5611733976766504], [-0.4243565736083786, 0.5313393439557783], [-0.4623673874967956, 0.49861447931181074], [-0.49786264007874514, 0.4631768470183089], [-0.5306492154763068, 0.42521924946359163], [-0.5605487346716863, 0.3849481991878538], [-0.5873985259981443, 0.3425827953286728], [-0.6110525101733315, 0.2983535315877301], [-0.631381995059904, 0.2525010422041372], [-0.6482763758294418, 0.2052747927570369], [-0.6616437367203453, 0.15693172292031485], [-0.6714113511157813, 0.10773484855366482], [-0.6775260772209474, 0.057951830735490366], [-0.6799546471869299, 0.00785351952297341], [-0.6786838481081442, -0.04228751963784975], [-0.6737205939086197, -0.09219848883477856], [-0.665091887726026, -0.14160784187689343], [-0.6528446749980925, -0.19024676167187463], [-0.6370455880507218, -0.23785062275535498], [-0.6177805835773941, -0.2841604310152532], [-0.5951544749821961, -0.32892423277810756], [-0.5692903621308121, -0.37189848559112054], [-0.5403289616119866, -0.4128493832420152], [-0.5084278411532376, -0.45155412780779486], [-0.47376056235607267, -0.48780214181167536], [-0.4365157364147521, -0.5213962138933181], [-0.3968959979560633, -0.5521535717592169], [-0.35511690258304857, -0.5799068765757323], [-0.3114057541207222, -0.6045051333946673], [-0.2660003679442723, -0.6258145126581133], [-0.21914777711801173, -0.6437190783130746], [-0.17110288838445029, -0.6581214185744895], [-0.12212709531575618, -0.6689431759049017], [-0.07248685617288977, -0.6761254733273779], [-0.022452244209736082, -0.6796292347522629], [0.027704521690534292, -0.6794353975750003], [0.07771055805264315, -0.675545016388358], [0.1272938014621606, -0.6679792572447981], [0.17618448875684387, -0.6567792825002092], [0.2241166247031797, -0.6420060268655227], [0.27082942917310754, -0.623739865884624], [0.3160687559473692, -0.6020801786422489], [0.35958847542633815, -0.5771448070809976], [0.401151813725547, -0.5490694148691075], [0.4405326408703881, -0.5180067493071511], [0.47751670108145283, -0.48412581028931573], [0.5119027784569717, -0.44761093084064935], [0.5435037917103633, -0.4086607742326856], [0.5721478120068185, -0.3674872531337793], [0.5394832544747107, -0.38849716536446655], [0.5056724889309209, -0.40760794410455126], [0.47082580908551414, -0.42475724830213535], [0.435056887892703, -0.43988913540890506], [0.3984824067396109, -0.4529542438696743], [0.36122167482125733, -0.46390995414414693], [0.32339623994340555, -0.47272052773563045], [0.2851294920228572, -0.47935722377317525], [0.24654626057862347, -0.4837983927668401], [0.2077724075269859, -0.4860295472302444], [0.16893441660878117, -0.4860434089400312], [0.13015898078824395, -0.48383993267807623], [0.09157258896934496, -0.4794263063789932], [0.053301113377785925, -0.472816927682455], [0.015469398954659819, -0.46403335696681847], [-0.021799143898799028, -0.4531042470172617], [-0.05838294189686574, -0.4400652495578632], [-0.09416265545214769, -0.4249588989525209], [-0.1290215679718804, -0.4078344734540926], [-0.16284596659778333, -0.3887478344543742], [-0.19552551314747207, -0.367761244259293], [-0.22695360404737447, -0.3449431629837558], [-0.2570277180830247, -0.32036802522869323], [-0.285649750832338, -0.2941159972688042], [-0.31272633469092237, -0.26627271554306997], [-0.338169143445467, -0.2369290073011102], [-0.36189518040166835, -0.2061805943166564], [-0.3838270491267948, -0.17412778063465065], [-0.4038932059237006, -0.14087512537057376], [-0.4220281932126988, -0.10653110162935395], [-0.4381728530599802, -0.07120774265649957], [-0.45227452015603065, -0.03502027637573152], [-0.46428719361453186, 0.0019132504947017848], [-0.4741716870313245, 0.039472357520867], [-0.481895756313928, 0.07753452357098947], [-0.4874342048646233, 0.11597558649022827], [-0.490768965773986, 0.15467014812861538], [-0.4918891607567435, 0.1934919834009229], [-0.4907911356377045, 0.23231445204406223], [-0.48747847227200236, 0.27101091172883296], [-0.48196197686076625, 0.30945513117841195], [-0.47425964470033644, 0.34752170194595006], [-0.4643966014800154, 0.3850864475080277], [-0.45240502131984406, 0.4220268283394666], [-0.43832402181577534, 0.4582223416481074], [-0.42219953643461305, 0.4935549144655835], [-0.4040841646749772, 0.527909288811797]], "depth": 0.14}}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 3.1, -1.14], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "crescent", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "moon-silver"}}, "material": "moon-silver", "materialLayers": ["moon-silver"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "crescent-tip", "type": "contour", "geometryEffect": "tapered hooked profile with real central negative space", "confidence": 0.9}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": ["Crescent circular intersections radius .68 offset .27 orientation .8 rad; continuous tips."], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(173, 184, 204, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_crescent_29.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "crescent", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "moon-silver"}};
  (nodes["root"] ?? root).add(node_crescent_29);
  nodes["crescent"] = node_crescent_29;
  const mesh_crescent_29Geometry = endpoint_crescent_29
    ? new THREE.CylinderGeometry(endpoint_crescent_29.endRadius, endpoint_crescent_29.baseRadius, endpoint_crescent_29.length, 32, 12)
    : buildExtrudeGeometry({"points": [[-0.38403700048308376, 0.5611733976766504], [-0.4243565736083786, 0.5313393439557783], [-0.4623673874967956, 0.49861447931181074], [-0.49786264007874514, 0.4631768470183089], [-0.5306492154763068, 0.42521924946359163], [-0.5605487346716863, 0.3849481991878538], [-0.5873985259981443, 0.3425827953286728], [-0.6110525101733315, 0.2983535315877301], [-0.631381995059904, 0.2525010422041372], [-0.6482763758294418, 0.2052747927570369], [-0.6616437367203453, 0.15693172292031485], [-0.6714113511157813, 0.10773484855366482], [-0.6775260772209474, 0.057951830735490366], [-0.6799546471869299, 0.00785351952297341], [-0.6786838481081442, -0.04228751963784975], [-0.6737205939086197, -0.09219848883477856], [-0.665091887726026, -0.14160784187689343], [-0.6528446749980925, -0.19024676167187463], [-0.6370455880507218, -0.23785062275535498], [-0.6177805835773941, -0.2841604310152532], [-0.5951544749821961, -0.32892423277810756], [-0.5692903621308121, -0.37189848559112054], [-0.5403289616119866, -0.4128493832420152], [-0.5084278411532376, -0.45155412780779486], [-0.47376056235607267, -0.48780214181167536], [-0.4365157364147521, -0.5213962138933181], [-0.3968959979560633, -0.5521535717592169], [-0.35511690258304857, -0.5799068765757323], [-0.3114057541207222, -0.6045051333946673], [-0.2660003679442723, -0.6258145126581133], [-0.21914777711801173, -0.6437190783130746], [-0.17110288838445029, -0.6581214185744895], [-0.12212709531575618, -0.6689431759049017], [-0.07248685617288977, -0.6761254733273779], [-0.022452244209736082, -0.6796292347522629], [0.027704521690534292, -0.6794353975750003], [0.07771055805264315, -0.675545016388358], [0.1272938014621606, -0.6679792572447981], [0.17618448875684387, -0.6567792825002092], [0.2241166247031797, -0.6420060268655227], [0.27082942917310754, -0.623739865884624], [0.3160687559473692, -0.6020801786422489], [0.35958847542633815, -0.5771448070809976], [0.401151813725547, -0.5490694148691075], [0.4405326408703881, -0.5180067493071511], [0.47751670108145283, -0.48412581028931573], [0.5119027784569717, -0.44761093084064935], [0.5435037917103633, -0.4086607742326856], [0.5721478120068185, -0.3674872531337793], [0.5394832544747107, -0.38849716536446655], [0.5056724889309209, -0.40760794410455126], [0.47082580908551414, -0.42475724830213535], [0.435056887892703, -0.43988913540890506], [0.3984824067396109, -0.4529542438696743], [0.36122167482125733, -0.46390995414414693], [0.32339623994340555, -0.47272052773563045], [0.2851294920228572, -0.47935722377317525], [0.24654626057862347, -0.4837983927668401], [0.2077724075269859, -0.4860295472302444], [0.16893441660878117, -0.4860434089400312], [0.13015898078824395, -0.48383993267807623], [0.09157258896934496, -0.4794263063789932], [0.053301113377785925, -0.472816927682455], [0.015469398954659819, -0.46403335696681847], [-0.021799143898799028, -0.4531042470172617], [-0.05838294189686574, -0.4400652495578632], [-0.09416265545214769, -0.4249588989525209], [-0.1290215679718804, -0.4078344734540926], [-0.16284596659778333, -0.3887478344543742], [-0.19552551314747207, -0.367761244259293], [-0.22695360404737447, -0.3449431629837558], [-0.2570277180830247, -0.32036802522869323], [-0.285649750832338, -0.2941159972688042], [-0.31272633469092237, -0.26627271554306997], [-0.338169143445467, -0.2369290073011102], [-0.36189518040166835, -0.2061805943166564], [-0.3838270491267948, -0.17412778063465065], [-0.4038932059237006, -0.14087512537057376], [-0.4220281932126988, -0.10653110162935395], [-0.4381728530599802, -0.07120774265649957], [-0.45227452015603065, -0.03502027637573152], [-0.46428719361453186, 0.0019132504947017848], [-0.4741716870313245, 0.039472357520867], [-0.481895756313928, 0.07753452357098947], [-0.4874342048646233, 0.11597558649022827], [-0.490768965773986, 0.15467014812861538], [-0.4918891607567435, 0.1934919834009229], [-0.4907911356377045, 0.23231445204406223], [-0.48747847227200236, 0.27101091172883296], [-0.48196197686076625, 0.30945513117841195], [-0.47425964470033644, 0.34752170194595006], [-0.4643966014800154, 0.3850864475080277], [-0.45240502131984406, 0.4220268283394666], [-0.43832402181577534, 0.4582223416481074], [-0.42219953643461305, 0.4935549144655835], [-0.4040841646749772, 0.527909288811797]], "depth": 0.14});
  if (!endpoint_crescent_29) {
    mesh_crescent_29Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_crescent_29 = new THREE.Mesh(
    mesh_crescent_29Geometry,
    materialMap["moon-silver"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_crescent_29.name = "crescent";
  if (endpoint_crescent_29) {
    mesh_crescent_29.position.copy(endpoint_crescent_29.midpoint);
    mesh_crescent_29.quaternion.copy(endpoint_crescent_29.quaternion);
  }
  mesh_crescent_29.castShadow = options.castShadow ?? true;
  mesh_crescent_29.receiveShadow = options.receiveShadow ?? true;
  mesh_crescent_29.userData.sculptComponent = {"id": "crescent", "name": "crescent", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides", "profile2D": {"points": [[-0.38403700048308376, 0.5611733976766504], [-0.4243565736083786, 0.5313393439557783], [-0.4623673874967956, 0.49861447931181074], [-0.49786264007874514, 0.4631768470183089], [-0.5306492154763068, 0.42521924946359163], [-0.5605487346716863, 0.3849481991878538], [-0.5873985259981443, 0.3425827953286728], [-0.6110525101733315, 0.2983535315877301], [-0.631381995059904, 0.2525010422041372], [-0.6482763758294418, 0.2052747927570369], [-0.6616437367203453, 0.15693172292031485], [-0.6714113511157813, 0.10773484855366482], [-0.6775260772209474, 0.057951830735490366], [-0.6799546471869299, 0.00785351952297341], [-0.6786838481081442, -0.04228751963784975], [-0.6737205939086197, -0.09219848883477856], [-0.665091887726026, -0.14160784187689343], [-0.6528446749980925, -0.19024676167187463], [-0.6370455880507218, -0.23785062275535498], [-0.6177805835773941, -0.2841604310152532], [-0.5951544749821961, -0.32892423277810756], [-0.5692903621308121, -0.37189848559112054], [-0.5403289616119866, -0.4128493832420152], [-0.5084278411532376, -0.45155412780779486], [-0.47376056235607267, -0.48780214181167536], [-0.4365157364147521, -0.5213962138933181], [-0.3968959979560633, -0.5521535717592169], [-0.35511690258304857, -0.5799068765757323], [-0.3114057541207222, -0.6045051333946673], [-0.2660003679442723, -0.6258145126581133], [-0.21914777711801173, -0.6437190783130746], [-0.17110288838445029, -0.6581214185744895], [-0.12212709531575618, -0.6689431759049017], [-0.07248685617288977, -0.6761254733273779], [-0.022452244209736082, -0.6796292347522629], [0.027704521690534292, -0.6794353975750003], [0.07771055805264315, -0.675545016388358], [0.1272938014621606, -0.6679792572447981], [0.17618448875684387, -0.6567792825002092], [0.2241166247031797, -0.6420060268655227], [0.27082942917310754, -0.623739865884624], [0.3160687559473692, -0.6020801786422489], [0.35958847542633815, -0.5771448070809976], [0.401151813725547, -0.5490694148691075], [0.4405326408703881, -0.5180067493071511], [0.47751670108145283, -0.48412581028931573], [0.5119027784569717, -0.44761093084064935], [0.5435037917103633, -0.4086607742326856], [0.5721478120068185, -0.3674872531337793], [0.5394832544747107, -0.38849716536446655], [0.5056724889309209, -0.40760794410455126], [0.47082580908551414, -0.42475724830213535], [0.435056887892703, -0.43988913540890506], [0.3984824067396109, -0.4529542438696743], [0.36122167482125733, -0.46390995414414693], [0.32339623994340555, -0.47272052773563045], [0.2851294920228572, -0.47935722377317525], [0.24654626057862347, -0.4837983927668401], [0.2077724075269859, -0.4860295472302444], [0.16893441660878117, -0.4860434089400312], [0.13015898078824395, -0.48383993267807623], [0.09157258896934496, -0.4794263063789932], [0.053301113377785925, -0.472816927682455], [0.015469398954659819, -0.46403335696681847], [-0.021799143898799028, -0.4531042470172617], [-0.05838294189686574, -0.4400652495578632], [-0.09416265545214769, -0.4249588989525209], [-0.1290215679718804, -0.4078344734540926], [-0.16284596659778333, -0.3887478344543742], [-0.19552551314747207, -0.367761244259293], [-0.22695360404737447, -0.3449431629837558], [-0.2570277180830247, -0.32036802522869323], [-0.285649750832338, -0.2941159972688042], [-0.31272633469092237, -0.26627271554306997], [-0.338169143445467, -0.2369290073011102], [-0.36189518040166835, -0.2061805943166564], [-0.3838270491267948, -0.17412778063465065], [-0.4038932059237006, -0.14087512537057376], [-0.4220281932126988, -0.10653110162935395], [-0.4381728530599802, -0.07120774265649957], [-0.45227452015603065, -0.03502027637573152], [-0.46428719361453186, 0.0019132504947017848], [-0.4741716870313245, 0.039472357520867], [-0.481895756313928, 0.07753452357098947], [-0.4874342048646233, 0.11597558649022827], [-0.490768965773986, 0.15467014812861538], [-0.4918891607567435, 0.1934919834009229], [-0.4907911356377045, 0.23231445204406223], [-0.48747847227200236, 0.27101091172883296], [-0.48196197686076625, 0.30945513117841195], [-0.47425964470033644, 0.34752170194595006], [-0.4643966014800154, 0.3850864475080277], [-0.45240502131984406, 0.4220268283394666], [-0.43832402181577534, 0.4582223416481074], [-0.42219953643461305, 0.4935549144655835], [-0.4040841646749772, 0.527909288811797]], "depth": 0.14}}, "parent": "root", "attachment": null, "dimensions": {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "relative", "confidence": 0.8}, "transform": {"position": [0, 3.1, -1.14], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "crescent", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "moon-silver"}}, "material": "moon-silver", "materialLayers": ["moon-silver"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "crescent-tip", "type": "contour", "geometryEffect": "tapered hooked profile with real central negative space", "confidence": 0.9}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": ["Crescent circular intersections radius .68 offset .27 orientation .8 rad; continuous tips."], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(173, 184, 204, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_crescent_29.add(mesh_crescent_29);
  meshes["crescent"] = mesh_crescent_29;
  colliders["crescent"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["crescent"] ??= [];
  destructionGroups["crescent"].push(node_crescent_29);

  const endpoint_obelisk_west_30 = makeAttachmentEndpoint(null);
  const node_obelisk_west_30 = new THREE.Group();
  node_obelisk_west_30.name = "obelisk-west__pivot";
  node_obelisk_west_30.scale.set(1, 1, 1);
  if (endpoint_obelisk_west_30) {
    node_obelisk_west_30.position.copy(endpoint_obelisk_west_30.start);
    node_obelisk_west_30.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_obelisk_west_30.position.set(-2.65, 1.9, -1.0);
    node_obelisk_west_30.rotation.set(0.0, 0.0, 0.0);
  }
  node_obelisk_west_30.userData.sculptComponent = {"id": "obelisk-west", "name": "obelisk-west", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.35, "height": 2.2, "depth": 0.35, "units": "relative", "confidence": 0.8}, "transform": {"position": [-2.65, 1.9, -1.0], "rotation": [0, 0, 0], "scale": [0.35, 2.2, 0.35]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "obelisk-west", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "dark-stone"}}, "material": "dark-stone", "materialLayers": ["dark-stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(66, 72, 83, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_obelisk_west_30.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "obelisk-west", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "dark-stone"}};
  (nodes["root"] ?? root).add(node_obelisk_west_30);
  nodes["obelisk-west"] = node_obelisk_west_30;
  const mesh_obelisk_west_30Geometry = endpoint_obelisk_west_30
    ? new THREE.CylinderGeometry(endpoint_obelisk_west_30.endRadius, endpoint_obelisk_west_30.baseRadius, endpoint_obelisk_west_30.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_obelisk_west_30) {
    mesh_obelisk_west_30Geometry.scale(0.35, 2.2, 0.35);
  }
  const mesh_obelisk_west_30 = new THREE.Mesh(
    mesh_obelisk_west_30Geometry,
    materialMap["dark-stone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_obelisk_west_30.name = "obelisk-west";
  if (endpoint_obelisk_west_30) {
    mesh_obelisk_west_30.position.copy(endpoint_obelisk_west_30.midpoint);
    mesh_obelisk_west_30.quaternion.copy(endpoint_obelisk_west_30.quaternion);
  }
  mesh_obelisk_west_30.castShadow = options.castShadow ?? true;
  mesh_obelisk_west_30.receiveShadow = options.receiveShadow ?? true;
  mesh_obelisk_west_30.userData.sculptComponent = {"id": "obelisk-west", "name": "obelisk-west", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.35, "height": 2.2, "depth": 0.35, "units": "relative", "confidence": 0.8}, "transform": {"position": [-2.65, 1.9, -1.0], "rotation": [0, 0, 0], "scale": [0.35, 2.2, 0.35]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "obelisk-west", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "dark-stone"}}, "material": "dark-stone", "materialLayers": ["dark-stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(66, 72, 83, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_obelisk_west_30.add(mesh_obelisk_west_30);
  meshes["obelisk-west"] = mesh_obelisk_west_30;
  colliders["obelisk-west"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["obelisk-west"] ??= [];
  destructionGroups["obelisk-west"].push(node_obelisk_west_30);

  const endpoint_obelisk_foot_west_31 = makeAttachmentEndpoint(null);
  const node_obelisk_foot_west_31 = new THREE.Group();
  node_obelisk_foot_west_31.name = "obelisk-foot-west__pivot";
  node_obelisk_foot_west_31.scale.set(1, 1, 1);
  if (endpoint_obelisk_foot_west_31) {
    node_obelisk_foot_west_31.position.copy(endpoint_obelisk_foot_west_31.start);
    node_obelisk_foot_west_31.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_obelisk_foot_west_31.position.set(-2.65, 0.9, -1.0);
    node_obelisk_foot_west_31.rotation.set(0.0, 0.0, 0.0);
  }
  node_obelisk_foot_west_31.userData.sculptComponent = {"id": "obelisk-foot-west", "name": "obelisk-foot-west", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.58, "height": 0.2, "depth": 0.56, "units": "relative", "confidence": 0.8}, "transform": {"position": [-2.65, 0.9, -1], "rotation": [0, 0, 0], "scale": [0.58, 0.2, 0.56]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "obelisk-foot-west", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_obelisk_foot_west_31.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "obelisk-foot-west", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}};
  (nodes["root"] ?? root).add(node_obelisk_foot_west_31);
  nodes["obelisk-foot-west"] = node_obelisk_foot_west_31;
  const mesh_obelisk_foot_west_31Geometry = endpoint_obelisk_foot_west_31
    ? new THREE.CylinderGeometry(endpoint_obelisk_foot_west_31.endRadius, endpoint_obelisk_foot_west_31.baseRadius, endpoint_obelisk_foot_west_31.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_obelisk_foot_west_31) {
    mesh_obelisk_foot_west_31Geometry.scale(0.58, 0.2, 0.56);
  }
  const mesh_obelisk_foot_west_31 = new THREE.Mesh(
    mesh_obelisk_foot_west_31Geometry,
    materialMap["stone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_obelisk_foot_west_31.name = "obelisk-foot-west";
  if (endpoint_obelisk_foot_west_31) {
    mesh_obelisk_foot_west_31.position.copy(endpoint_obelisk_foot_west_31.midpoint);
    mesh_obelisk_foot_west_31.quaternion.copy(endpoint_obelisk_foot_west_31.quaternion);
  }
  mesh_obelisk_foot_west_31.castShadow = options.castShadow ?? true;
  mesh_obelisk_foot_west_31.receiveShadow = options.receiveShadow ?? true;
  mesh_obelisk_foot_west_31.userData.sculptComponent = {"id": "obelisk-foot-west", "name": "obelisk-foot-west", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.58, "height": 0.2, "depth": 0.56, "units": "relative", "confidence": 0.8}, "transform": {"position": [-2.65, 0.9, -1], "rotation": [0, 0, 0], "scale": [0.58, 0.2, 0.56]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "obelisk-foot-west", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_obelisk_foot_west_31.add(mesh_obelisk_foot_west_31);
  meshes["obelisk-foot-west"] = mesh_obelisk_foot_west_31;
  colliders["obelisk-foot-west"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["obelisk-foot-west"] ??= [];
  destructionGroups["obelisk-foot-west"].push(node_obelisk_foot_west_31);

  const endpoint_obelisk_cap_west_32 = makeAttachmentEndpoint(null);
  const node_obelisk_cap_west_32 = new THREE.Group();
  node_obelisk_cap_west_32.name = "obelisk-cap-west__pivot";
  node_obelisk_cap_west_32.scale.set(1, 1, 1);
  if (endpoint_obelisk_cap_west_32) {
    node_obelisk_cap_west_32.position.copy(endpoint_obelisk_cap_west_32.start);
    node_obelisk_cap_west_32.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_obelisk_cap_west_32.position.set(-2.65, 3.02, -1.0);
    node_obelisk_cap_west_32.rotation.set(0.0, 0.0, 0.0);
  }
  node_obelisk_cap_west_32.userData.sculptComponent = {"id": "obelisk-cap-west", "name": "obelisk-cap-west", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.46, "height": 0.13, "depth": 0.43, "units": "relative", "confidence": 0.8}, "transform": {"position": [-2.65, 3.02, -1], "rotation": [0, 0, 0], "scale": [0.46, 0.13, 0.43]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "obelisk-cap-west", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_obelisk_cap_west_32.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "obelisk-cap-west", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}};
  (nodes["root"] ?? root).add(node_obelisk_cap_west_32);
  nodes["obelisk-cap-west"] = node_obelisk_cap_west_32;
  const mesh_obelisk_cap_west_32Geometry = endpoint_obelisk_cap_west_32
    ? new THREE.CylinderGeometry(endpoint_obelisk_cap_west_32.endRadius, endpoint_obelisk_cap_west_32.baseRadius, endpoint_obelisk_cap_west_32.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_obelisk_cap_west_32) {
    mesh_obelisk_cap_west_32Geometry.scale(0.46, 0.13, 0.43);
  }
  const mesh_obelisk_cap_west_32 = new THREE.Mesh(
    mesh_obelisk_cap_west_32Geometry,
    materialMap["stone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_obelisk_cap_west_32.name = "obelisk-cap-west";
  if (endpoint_obelisk_cap_west_32) {
    mesh_obelisk_cap_west_32.position.copy(endpoint_obelisk_cap_west_32.midpoint);
    mesh_obelisk_cap_west_32.quaternion.copy(endpoint_obelisk_cap_west_32.quaternion);
  }
  mesh_obelisk_cap_west_32.castShadow = options.castShadow ?? true;
  mesh_obelisk_cap_west_32.receiveShadow = options.receiveShadow ?? true;
  mesh_obelisk_cap_west_32.userData.sculptComponent = {"id": "obelisk-cap-west", "name": "obelisk-cap-west", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.46, "height": 0.13, "depth": 0.43, "units": "relative", "confidence": 0.8}, "transform": {"position": [-2.65, 3.02, -1], "rotation": [0, 0, 0], "scale": [0.46, 0.13, 0.43]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "obelisk-cap-west", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_obelisk_cap_west_32.add(mesh_obelisk_cap_west_32);
  meshes["obelisk-cap-west"] = mesh_obelisk_cap_west_32;
  colliders["obelisk-cap-west"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["obelisk-cap-west"] ??= [];
  destructionGroups["obelisk-cap-west"].push(node_obelisk_cap_west_32);

  const endpoint_obelisk_east_33 = makeAttachmentEndpoint(null);
  const node_obelisk_east_33 = new THREE.Group();
  node_obelisk_east_33.name = "obelisk-east__pivot";
  node_obelisk_east_33.scale.set(1, 1, 1);
  if (endpoint_obelisk_east_33) {
    node_obelisk_east_33.position.copy(endpoint_obelisk_east_33.start);
    node_obelisk_east_33.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_obelisk_east_33.position.set(2.65, 1.9, -1.0);
    node_obelisk_east_33.rotation.set(0.0, 0.0, 0.0);
  }
  node_obelisk_east_33.userData.sculptComponent = {"id": "obelisk-east", "name": "obelisk-east", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.35, "height": 2.2, "depth": 0.35, "units": "relative", "confidence": 0.8}, "transform": {"position": [2.65, 1.9, -1.0], "rotation": [0, 0, 0], "scale": [0.35, 2.2, 0.35]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "obelisk-east", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "dark-stone"}}, "material": "dark-stone", "materialLayers": ["dark-stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(66, 72, 83, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_obelisk_east_33.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "obelisk-east", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "dark-stone"}};
  (nodes["root"] ?? root).add(node_obelisk_east_33);
  nodes["obelisk-east"] = node_obelisk_east_33;
  const mesh_obelisk_east_33Geometry = endpoint_obelisk_east_33
    ? new THREE.CylinderGeometry(endpoint_obelisk_east_33.endRadius, endpoint_obelisk_east_33.baseRadius, endpoint_obelisk_east_33.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_obelisk_east_33) {
    mesh_obelisk_east_33Geometry.scale(0.35, 2.2, 0.35);
  }
  const mesh_obelisk_east_33 = new THREE.Mesh(
    mesh_obelisk_east_33Geometry,
    materialMap["dark-stone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_obelisk_east_33.name = "obelisk-east";
  if (endpoint_obelisk_east_33) {
    mesh_obelisk_east_33.position.copy(endpoint_obelisk_east_33.midpoint);
    mesh_obelisk_east_33.quaternion.copy(endpoint_obelisk_east_33.quaternion);
  }
  mesh_obelisk_east_33.castShadow = options.castShadow ?? true;
  mesh_obelisk_east_33.receiveShadow = options.receiveShadow ?? true;
  mesh_obelisk_east_33.userData.sculptComponent = {"id": "obelisk-east", "name": "obelisk-east", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.35, "height": 2.2, "depth": 0.35, "units": "relative", "confidence": 0.8}, "transform": {"position": [2.65, 1.9, -1.0], "rotation": [0, 0, 0], "scale": [0.35, 2.2, 0.35]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "obelisk-east", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "dark-stone"}}, "material": "dark-stone", "materialLayers": ["dark-stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(66, 72, 83, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_obelisk_east_33.add(mesh_obelisk_east_33);
  meshes["obelisk-east"] = mesh_obelisk_east_33;
  colliders["obelisk-east"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["obelisk-east"] ??= [];
  destructionGroups["obelisk-east"].push(node_obelisk_east_33);

  const endpoint_obelisk_foot_east_34 = makeAttachmentEndpoint(null);
  const node_obelisk_foot_east_34 = new THREE.Group();
  node_obelisk_foot_east_34.name = "obelisk-foot-east__pivot";
  node_obelisk_foot_east_34.scale.set(1, 1, 1);
  if (endpoint_obelisk_foot_east_34) {
    node_obelisk_foot_east_34.position.copy(endpoint_obelisk_foot_east_34.start);
    node_obelisk_foot_east_34.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_obelisk_foot_east_34.position.set(2.65, 0.9, -1.0);
    node_obelisk_foot_east_34.rotation.set(0.0, 0.0, 0.0);
  }
  node_obelisk_foot_east_34.userData.sculptComponent = {"id": "obelisk-foot-east", "name": "obelisk-foot-east", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.58, "height": 0.2, "depth": 0.56, "units": "relative", "confidence": 0.8}, "transform": {"position": [2.65, 0.9, -1], "rotation": [0, 0, 0], "scale": [0.58, 0.2, 0.56]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "obelisk-foot-east", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_obelisk_foot_east_34.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "obelisk-foot-east", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}};
  (nodes["root"] ?? root).add(node_obelisk_foot_east_34);
  nodes["obelisk-foot-east"] = node_obelisk_foot_east_34;
  const mesh_obelisk_foot_east_34Geometry = endpoint_obelisk_foot_east_34
    ? new THREE.CylinderGeometry(endpoint_obelisk_foot_east_34.endRadius, endpoint_obelisk_foot_east_34.baseRadius, endpoint_obelisk_foot_east_34.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_obelisk_foot_east_34) {
    mesh_obelisk_foot_east_34Geometry.scale(0.58, 0.2, 0.56);
  }
  const mesh_obelisk_foot_east_34 = new THREE.Mesh(
    mesh_obelisk_foot_east_34Geometry,
    materialMap["stone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_obelisk_foot_east_34.name = "obelisk-foot-east";
  if (endpoint_obelisk_foot_east_34) {
    mesh_obelisk_foot_east_34.position.copy(endpoint_obelisk_foot_east_34.midpoint);
    mesh_obelisk_foot_east_34.quaternion.copy(endpoint_obelisk_foot_east_34.quaternion);
  }
  mesh_obelisk_foot_east_34.castShadow = options.castShadow ?? true;
  mesh_obelisk_foot_east_34.receiveShadow = options.receiveShadow ?? true;
  mesh_obelisk_foot_east_34.userData.sculptComponent = {"id": "obelisk-foot-east", "name": "obelisk-foot-east", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.58, "height": 0.2, "depth": 0.56, "units": "relative", "confidence": 0.8}, "transform": {"position": [2.65, 0.9, -1], "rotation": [0, 0, 0], "scale": [0.58, 0.2, 0.56]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "obelisk-foot-east", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_obelisk_foot_east_34.add(mesh_obelisk_foot_east_34);
  meshes["obelisk-foot-east"] = mesh_obelisk_foot_east_34;
  colliders["obelisk-foot-east"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["obelisk-foot-east"] ??= [];
  destructionGroups["obelisk-foot-east"].push(node_obelisk_foot_east_34);

  const endpoint_obelisk_cap_east_35 = makeAttachmentEndpoint(null);
  const node_obelisk_cap_east_35 = new THREE.Group();
  node_obelisk_cap_east_35.name = "obelisk-cap-east__pivot";
  node_obelisk_cap_east_35.scale.set(1, 1, 1);
  if (endpoint_obelisk_cap_east_35) {
    node_obelisk_cap_east_35.position.copy(endpoint_obelisk_cap_east_35.start);
    node_obelisk_cap_east_35.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_obelisk_cap_east_35.position.set(2.65, 3.02, -1.0);
    node_obelisk_cap_east_35.rotation.set(0.0, 0.0, 0.0);
  }
  node_obelisk_cap_east_35.userData.sculptComponent = {"id": "obelisk-cap-east", "name": "obelisk-cap-east", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.46, "height": 0.13, "depth": 0.43, "units": "relative", "confidence": 0.8}, "transform": {"position": [2.65, 3.02, -1], "rotation": [0, 0, 0], "scale": [0.46, 0.13, 0.43]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "obelisk-cap-east", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_obelisk_cap_east_35.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "obelisk-cap-east", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}};
  (nodes["root"] ?? root).add(node_obelisk_cap_east_35);
  nodes["obelisk-cap-east"] = node_obelisk_cap_east_35;
  const mesh_obelisk_cap_east_35Geometry = endpoint_obelisk_cap_east_35
    ? new THREE.CylinderGeometry(endpoint_obelisk_cap_east_35.endRadius, endpoint_obelisk_cap_east_35.baseRadius, endpoint_obelisk_cap_east_35.length, 32, 12)
    : new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
  if (!endpoint_obelisk_cap_east_35) {
    mesh_obelisk_cap_east_35Geometry.scale(0.46, 0.13, 0.43);
  }
  const mesh_obelisk_cap_east_35 = new THREE.Mesh(
    mesh_obelisk_cap_east_35Geometry,
    materialMap["stone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_obelisk_cap_east_35.name = "obelisk-cap-east";
  if (endpoint_obelisk_cap_east_35) {
    mesh_obelisk_cap_east_35.position.copy(endpoint_obelisk_cap_east_35.midpoint);
    mesh_obelisk_cap_east_35.quaternion.copy(endpoint_obelisk_cap_east_35.quaternion);
  }
  mesh_obelisk_cap_east_35.castShadow = options.castShadow ?? true;
  mesh_obelisk_cap_east_35.receiveShadow = options.receiveShadow ?? true;
  mesh_obelisk_cap_east_35.userData.sculptComponent = {"id": "obelisk-cap-east", "name": "obelisk-cap-east", "level": "meso", "role": "body", "importance": 0.6, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete carved masonry part; assembled along existing construction seams.", "geometryDescriptor": {"topologyIntent": "Ruined lunar masonry with physically separate courses", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.018, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "flat stone cap normals and planar sides"}, "parent": "root", "attachment": null, "dimensions": {"width": 0.46, "height": 0.13, "depth": 0.43, "units": "relative", "confidence": 0.8}, "transform": {"position": [2.65, 3.02, -1], "rotation": [0, 0, 0], "scale": [0.46, 0.13, 0.43]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "obelisk-cap-east", "seamRefs": ["mortar"], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stone"}}, "material": "stone", "materialLayers": ["stone"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["altar-crop"], "details": [], "fidelityTier": "structure", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 113, 130, 1)", "secondaryAlbedo": "rgba(85, 91, 104, 1)", "materialClass": "stone", "materialClassConfidence": 0.8, "evidenceRefs": ["altar-crop"], "notes": "Neutral material appearance inferred from blue-lit reference."}};
  node_obelisk_cap_east_35.add(mesh_obelisk_cap_east_35);
  meshes["obelisk-cap-east"] = mesh_obelisk_cap_east_35;
  colliders["obelisk-cap-east"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["obelisk-cap-east"] ??= [];
  destructionGroups["obelisk-cap-east"].push(node_obelisk_cap_east_35);

  // repetition system: radial-floor-stones (InstancedMesh, radial, count=24, level=meso)
  {
    const parent = nodes["root"] ?? root;
    const geo = new THREE.BoxGeometry(1, 1, 1, 12, 12, 12);
    const mat = materialMap["stone"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
    // Contract (PLAN_1.5 WS-E): instanceScale is ABSOLUTE, in the parent pivot's
    // local units -- it is never multiplied by the parent component's own declared
    // dimensional scale. This falls out of the same fix as componentTree: the pivot
    // Group this cluster is parented to always carries identity scale (dimensions are
    // baked into that component's OWN geometry, not exposed on the Group), so an
    // instanced fastener/tooth/spoke sized [0.05, 0.05, 0.05] renders at exactly that
    // size regardless of how non-uniformly its host component is shaped, and a
    // `radial` ring's placement stays circular instead of being squashed into an
    // ellipse by a non-uniform host.
    const scl = [0.39, 0.055, 0.65];
    const axis = new THREE.Vector3(0.0, 1.0, 0.0).normalize();
    const radius = 1.94;
    const seed = Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3().crossVectors(axis, seed).normalize();
    // One InstancedMesh = one draw call for all repeated parts (teeth/fasteners/spokes),
    // replacing the former per-instance Mesh clone loop (real-time perf principle).
    const cluster = new THREE.InstancedMesh(geo, mat, 24);
    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(scl[0], scl[1], scl[2]);
    for (let i = 0; i < 24; i++) {
      const ang = ((0.0) + (i * 360) / 24) * Math.PI / 180;
      const dir = perp.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, ang));
      _p.copy(radius > 0 ? dir.clone().multiplyScalar(radius * 0.5) : new THREE.Vector3());
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      _m.compose(_p, _q, _s);
      cluster.setMatrixAt(i, _m);
    }
    cluster.instanceMatrix.needsUpdate = true;
    cluster.castShadow = options.castShadow ?? true;
    cluster.receiveShadow = options.receiveShadow ?? true;
    cluster.name = "radial-floor-stones";
    parent.add(cluster);
  }

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createMoonlitCrescentAltarLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Moonlit crescent altar look-dev lights";
  const hemi = new THREE.HemisphereLight(
    mode === 'reference' ? 0xfff0d6 : 0xf2f4ff,
    0x363b42,
    mode === 'grazing' ? 0.28 : mode === 'reference' ? 0.72 : 0.85,
  );
  lights.add(hemi);
  const key = new THREE.DirectionalLight(
    mode === 'reference' ? 0xffcf8a : 0xfff4e8,
    mode === 'grazing' ? 4.2 : mode === 'reference' ? 2.6 : 2.15,
  );
  if (mode === 'grazing') key.position.set(7.5, 1.1, 4.0);
  else if (mode === 'reference') key.position.set(-4.5, 7.5, 5.0);
  else key.position.set(-4.0, 6.0, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 7;
  key.shadow.blurSamples = 24;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.camera.left = -2.6;
  key.shadow.camera.right = 2.6;
  key.shadow.camera.top = 2.6;
  key.shadow.camera.bottom = -2.6;
  key.shadow.camera.updateProjectionMatrix();
  lights.add(key);
  const fill = new THREE.DirectionalLight(0xa8c4ff, mode === 'grazing' ? 0.12 : 0.42);
  fill.position.set(4.0, 3.0, 3.5);
  lights.add(fill);
  const rim = new THREE.DirectionalLight(0xfff1c4, mode === 'grazing' ? 0.28 : 0.85);
  rim.position.set(0.5, 4.5, -6.0);
  lights.add(rim);
  lights.userData.reviewMode = mode;
  lights.userData.lightingFromPhoto = ["Key: cool directional moonlight from upper left, #acc5ff, intensity 3.2; ACES exposure 1.0.", "Fill: blue-grey hemisphere, intensity .65; dark navy background.", "Rim: purple altar accent and warm flanking braziers; contact shadows enabled."];
  lights.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createMoonlitCrescentAltarEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}

// Plan 1.3 §3.2 — auto-framing by bounding box. The Divine Eye can only compare a
// render to the reference if the object is FRAMED consistently (an object framed
// differently scores as wrong even when its shape is right). This positions the camera
// deterministically from the object's bounding box so it fills the frame at a stable
// margin, and sets near/far to the object scale. Call after adding the model to the
// scene, and again on resize (after updating camera.aspect).
export function frameMoonlitCrescentAltarCamera(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  options: { margin?: number; azimuthDeg?: number; elevationDeg?: number } = {},
): void {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const margin = options.margin ?? 1.15;
  const maxDim = Math.max(size.x, size.y, size.z) * margin;
  const fov = (camera.fov * Math.PI) / 180;
  // distance so the largest object dimension fits vertically in the frame
  const distance = (maxDim / 2) / Math.tan(fov / 2);
  const az = ((options.azimuthDeg ?? 0) * Math.PI) / 180;
  const el = ((options.elevationDeg ?? 0) * Math.PI) / 180;
  const dir = new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  );
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.near = Math.max(0.01, distance - maxDim);
  camera.far = distance + maxDim * 2;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

// Plan 1.3 §3.2c — PRESENTATION composer (DOF + bloom). CRITICAL (R-POSTFX): this is
// for the showcase/hero render ONLY. The Divine Eye's EVALUATION render MUST use a
// plain renderer with NO composer — bloom blows highlights and DOF blurs edges, which
// would corrupt the deterministic IoU/DCD/edge/blowout signals. Enable dof/bloom ONLY
// when the reference photo actually exhibits them (detect_reference_effects.py authorizes).
export function createMoonlitCrescentAltarPresentationComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: { dof?: boolean; bloom?: boolean; bloomStrength?: number; dofFocus?: number; dofAperture?: number } = {},
): EffectComposer {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  if (options.dof) {
    composer.addPass(new BokehPass(scene, camera, {
      focus: options.dofFocus ?? 10.0,
      aperture: options.dofAperture ?? 0.0002,
      maxblur: 0.01,
    }));
  }
  if (options.bloom) {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    composer.addPass(new UnrealBloomPass(size, options.bloomStrength ?? 0.4, 0.4, 0.85));
  }
  return composer;
}

export function configureMoonlitCrescentAltarRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createMoonlitCrescentAltarInspectControls(
  camera: THREE.Camera,
  domElement: HTMLElement,
): OrbitControls {
  // View-dependent finishes only read correctly once the user orbits — their color
  // comes from the environment reflection, not albedo, so free rotation matters here.
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.minDistance = 1.0;
  controls.maxDistance = 8.0;
  controls.autoRotate = false;
  return controls;
}
