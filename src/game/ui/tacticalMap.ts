import Phaser from 'phaser';

function atlasFrames(scene: Phaser.Scene, key: string) {
  const texture = scene.textures.get(key);
  const source = texture.getSourceImage() as HTMLImageElement;
  if (!texture.has('0')) for (let i = 0; i < 8; i++) {
    const split = key === 'hd-props' ? Math.round(source.height * .548) : Math.round(source.height / 2);
    const x = Math.round(i % 4 * source.width / 4), y = i < 4 ? 0 : split;
    texture.add(String(i), 0, x, y, Math.round((i % 4 + 1) * source.width / 4) - x, (i < 4 ? split : source.height) - y);
  }
}

/** Separate ground, upright scenery, water glints and light; dimensions follow the active chapter. */
export function drawTacticalMap(scene: Phaser.Scene, rows: string[], ox: number, oy: number) {
  const cols = rows[0].length, count = rows.length, width = cols * 64, height = count * 64;
  atlasFrames(scene, 'hd-terrain'); atlasFrames(scene, 'hd-props');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ground: Record<string, number> = { g: 0, f: 0, m: 0, w: 3, b: 4, r: 5, s: 0 };
  const prop = (frame: number, x: number, y: number, size: number, depth: number, sway = false) => {
    scene.add.ellipse(x + 5, y - 3, size * .62, size * .2, 0x061b23, .3).setDepth(depth - .01);
    const image = scene.add.image(x, y, 'hd-props', String(frame)).setOrigin(.5, .96).setDepth(depth);
    image.setDisplaySize(size, size * image.height / image.width);
    if (sway && !reduced) scene.tweens.add({ targets: image, angle: { from: -.6, to: .6 }, duration: 2600 + x % 800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    return image;
  };
  scene.add.rectangle(ox + width / 2 + 5, oy + height / 2 + 10, width + 16, height + 22, 0x020e17, .7).setDepth(-7);
  scene.add.rectangle(ox + width / 2, oy + height / 2 + 4, width + 2, height + 10, 0x375049).setDepth(-6);
  for (let y = 0; y < count; y++) for (let x = 0; x < cols; x++) {
    const type = rows[y][x], px = ox + x * 64, py = oy + y * 64;
    const tile = scene.add.image(px + 32, py + 32, 'hd-terrain', String(ground[type])).setDisplaySize(64, 64).setDepth(-5);
    if (type === 'g' || type === 'f' || type === 'm') tile.setFlip((x + y) % 2 === 1, y % 2 === 1);
    if (type === 'b') tile.setAngle(90);
    if (type === 'f') {
      tile.setTint(0x8da888);
      prop((x + y) % 4 === 0 ? 1 : 0, px + 21, py + 51, 57, 3 + y * .1, true);
      prop(2, px + 49, py + 59, 30, 3.1 + y * .1, true);
    } else if (type === 'm') prop(3, px + 32, py + 59, 70, 3 + y * .1);
    else if (type === 's') {
      prop(5, px + 32, py + 60, 66, 3 + y * .1);
      const light = scene.add.ellipse(px + 32, py + 43, 25, 10, 0xbaf5ea, .2).setDepth(4);
      if (!reduced) scene.tweens.add({ targets: light, alpha: .5, duration: 1800, repeat: -1, yoyo: true });
    } else if (type === 'g' && (x * 7 + y * 3) % 8 === 0) prop(2, px + 50, py + 58, 25, 3, true);
    if (type === 'w') {
      const glint = scene.add.graphics().setDepth(-3);
      glint.lineStyle(1, 0xe4ffff, .4);
      for (let i = 0; i < 3; i++) glint.lineBetween(px + 9 + i * 13, py + 14 + i * 17, px + 18 + i * 13, py + 13 + i * 17);
      if (!reduced) scene.tweens.add({ targets: glint, x: 4, alpha: .2, duration: 1600 + x * 65, repeat: -1, yoyo: true });
      for (const dy of [-1, 1]) if (rows[y + dy]?.[x] && rows[y + dy][x] !== 'w' && rows[y + dy][x] !== 'b') {
        scene.add.rectangle(px + 32, py + (dy === -1 ? 1 : 63), 64, 2, 0xd6e4c0, .6).setDepth(-2);
      }
    }
  }
  // Scenic fringe is outside the playable grid, so buildings never imply new movement rules.
  prop(4, ox - 69, oy + 255, 130, -1);
  prop(1, ox - 84, oy + 425, 145, -1, true);
  prop(0, ox + width + 80, oy + 182, 155, -1, true);
  prop(7, ox + width + 61, oy + 412, 120, -1);
  const grid = scene.add.graphics().setDepth(1);
  grid.lineStyle(1, 0xe5e4c4, .19);
  for (let x = 0; x <= cols; x++) grid.lineBetween(ox + x * 64, oy, ox + x * 64, oy + height);
  for (let y = 0; y <= count; y++) grid.lineBetween(ox, oy + y * 64, ox + width, oy + y * 64);
  grid.lineStyle(1, 0xe4c991, .65).strokeRect(ox - 2, oy - 2, width + 4, height + 4);
  for (let x = 0; x < cols; x++) scene.add.text(ox + x * 64 + 32, oy + height + 10, String(x + 1), { fontSize: '9px', color: '#b6c2b5' }).setOrigin(.5);
  for (let y = 0; y < count; y++) scene.add.text(ox - 13, oy + y * 64 + 32, String.fromCharCode(65 + y), { fontSize: '9px', color: '#b6c2b5' }).setOrigin(.5);
}
