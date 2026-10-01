import { noxSpriteData } from './noxSpriteData';

export { noxSpriteData };

/** One pixel scale for every pose; boot centers share the same bottom pivot. */
export function noxFrameLayout(frame: number, standingHeight = 52) {
  const source = noxSpriteData.frames[frame];
  const scale = standingHeight / noxSpriteData.frames[0].height;
  return { source, x: 64 - source.footX * scale, y: 128 - source.height * scale,
    width: source.width * scale, height: source.height * scale };
}

/** Normalize at texture upload, keeping the generated atlas unchanged on disk. */
export function noxFrameCanvas(image: CanvasImageSource, frame: number, standingHeight = 52) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d')!; context.imageSmoothingEnabled = false;
  const { source: s, x, y, width, height } = noxFrameLayout(frame, standingHeight);
  context.drawImage(image, s.x, s.y, s.width, s.height, x, y, width, height);
  return canvas;
}

/** Inline SVG clips the same atlas rectangle for roster and classic combat UI. */
export function noxSpriteMarkup(frame = 0, standingHeight = 52, className = '', label = '') {
  const { source: s, x, y, width, height } = noxFrameLayout(frame, standingHeight);
  return `<svg class="${className}" viewBox="0 0 128 128" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'} style="image-rendering:pixelated"><svg x="${x}" y="${y}" width="${width}" height="${height}" viewBox="${s.x} ${s.y} ${s.width} ${s.height}" overflow="hidden"><image href="${noxSpriteData.image}" width="${noxSpriteData.width}" height="${noxSpriteData.height}"/></svg></svg>`;
}
