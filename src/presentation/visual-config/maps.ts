import type { TileView, Vec3 } from '../contracts';

export const mapVisuals = {
  'moss-hollow': { background: 0x293d38, sun: 0xffdda0, sky: 0xc8dcc7, ground: 0x455338 },
  'tide-cove': { background: 0x3d7888, sun: 0xffe1a7, sky: 0xc3dfe5, ground: 0x7d785e },
  'starfall-bridge': { background: 0x162831, sun: 0xffdfa5, sky: 0xb4d9db, ground: 0x46514f },
  'moonlit-pass': { background: 0x111f36, sun: 0xc0d4ff, sky: 0x8ea9d8, ground: 0x444058 },
} as const;
export function visualFor(mapId: string) {
  const preset = mapVisuals[mapId as keyof typeof mapVisuals];
  if (!preset) throw new Error(`未配置地图视觉：${mapId}`);
  return preset;
}
export const tileId = (x: number, y: number) => `${x},${y}`;

// Visual relief only; rules never import this module. All adjacent surfaces share vertices.
function centerHeight(map: readonly (readonly string[])[], x: number, y: number): number {
  const row = Math.max(0, Math.min(map.length - 1, y));
  const col = Math.max(0, Math.min(map[0].length - 1, x));
  const kind = map[row][col];
  return kind === 'w' ? -.22 : (row < 2 ? .62 : row === 2 ? .32 : .08) + (kind === 'm' ? .35 : 0);
}
function relief(map: readonly (readonly string[])[], x: number, y: number) {
  const col = Math.floor(x), row = Math.floor(y), u = x - col, v = y - row;
  return (centerHeight(map, col, row) * (1 - u) + centerHeight(map, col + 1, row) * u) * (1 - v)
    + (centerHeight(map, col, row + 1) * (1 - u) + centerHeight(map, col + 1, row + 1) * u) * v;
}
// Imported Blender coordinates are twice the game board scale.
export function starfallHeight(x: number, z: number): number {
  const north = -z * 2;
  const ground = .16 + Math.max(0, Math.min(1, (north - 2) / 3)) * .65 + .025 * Math.sin(x * 1.4) * Math.cos(north * .6);
  if (z >= -1.3 && z <= .35 && Math.abs(x) <= .95) return .26 + .1 * Math.sin((.35 - z) / 1.65 * Math.PI);
  if (z > -1.1 && z < .05) return .0375;
  // Octagonal altar steps, sampled in the same half-scale space as the GLB.
  const dx = Math.abs(x), dz = Math.abs(z - 3.5);
  const octagon = Math.max(dx + dz * Math.tan(Math.PI / 8), dz + dx * Math.tan(Math.PI / 8));
  for (const [radius, top] of [[.35, .455], [.575, .3575], [.7, .2925]]) if (octagon <= radius) return top;
  return ground + (Math.abs(x) < .96 && z > .35 ? .025 : 0);
}
// Same surface elevations as build_moonlit.py; Blender/Godot units are twice game units.
export function moonlitHeight(x: number, z: number): number {
  const wx = x * 2, wz = z * 2, north = -wz;
  let height = Math.max(0, Math.min(1, (north - 2) / 4)) * .45 + .045 * Math.sin(wx * .7) * Math.cos(north * .6) + .06;
  if (wx >= -7 && wx <= -2.8 && north >= 2.7 && north <= 6) height += .95 * Math.max(0, Math.min(1, (-wx - 2.8) / 2));
  if (wz >= -2 && wz <= 0 && (wx < -4 || wx > 4)) height = -2.4;
  if (wx >= -4 && wx <= 2 && wz >= -2.6 && wz <= .56) height = .13;
  if (Math.abs(wx) <= 4.8 && north >= -13.8 && north <= -9.6) height = .245;
  const radius = Math.hypot(wx - 7, north - 7);
  for (const [r, top] of [[3.05,.62],[2.79,.83],[2.53,1.04],[2.27,1.28]]) if (radius < r) height = top;
  return Math.round(height * 10000) / 20000;
}
export function makeTiles(map: readonly (readonly string[])[], mapId?: string): TileView[] {
  const authoredHeight = mapId === 'starfall-bridge' ? starfallHeight : mapId === 'moonlit-pass' ? moonlitHeight : mapId === 'moss-hollow' || mapId === 'tide-cove' ? () => .08 : undefined;
  return map.flatMap((row, y) => row.map((terrain, x) => ({
    id: tileId(x, y), grid: { x, y }, terrain,
    center: { x: x + .5 - row.length / 2, y: authoredHeight ? authoredHeight(x + .5 - row.length / 2, y + .5 - map.length / 2) : centerHeight(map, x, y), z: y + .5 - map.length / 2 },
    heights: Array.from({ length: 9 }, (_, i) => authoredHeight ? authoredHeight(x - row.length / 2 + (i % 3) / 2, y - map.length / 2 + Math.floor(i / 3) / 2) : relief(map, x - .5 + (i % 3) / 2, y - .5 + Math.floor(i / 3) / 2)),
  })));
}
// Sample the very same triangles drawn by TerrainView, including ramps and bridge approaches.
export function surfacePoint(tiles: readonly TileView[], cols: number, rows: number, x: number, z: number): Vec3 {
  const col = Math.max(0, Math.min(cols - 1, Math.floor(x + cols / 2)));
  const row = Math.max(0, Math.min(rows - 1, Math.floor(z + rows / 2)));
  const tile = tiles[row * cols + col];
  const u = Math.max(0, Math.min(.999999, x + cols / 2 - col)) * 2;
  const v = Math.max(0, Math.min(.999999, z + rows / 2 - row)) * 2;
  const ix = Math.floor(u), iz = Math.floor(v), a = u - ix, b = v - iz;
  const h = tile.heights, k = iz * 3 + ix;
  const y = a + b <= 1 ? h[k] + a * (h[k + 1] - h[k]) + b * (h[k + 3] - h[k])
    : h[k + 4] + (1 - a) * (h[k + 3] - h[k + 4]) + (1 - b) * (h[k + 1] - h[k + 4]);
  return { x, y, z };
}
