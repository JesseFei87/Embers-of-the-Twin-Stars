import Phaser from 'phaser';

/** Soft light sits above the illustrated layers, never changes terrain or hit tests. */
export function addAtmosphere(scene: Phaser.Scene, moonlit = false) {
  const key = moonlit ? 'hd-moonlight' : 'hd-sunlight';
  if (!scene.textures.exists(key)) {
    const texture = scene.textures.createCanvas(key, 960, 640)!;
    const c = texture.getContext();
    const light = c.createRadialGradient(760, 30, 10, 680, 100, 700);
    light.addColorStop(0, moonlit ? '#cadfff55' : '#ffe8a64d');
    light.addColorStop(.4, moonlit ? '#a7cfff0f' : '#fff0bc0c');
    light.addColorStop(1, '#ffffff00');
    c.fillStyle = light; c.fillRect(0, 0, 960, 640);
    const shade = c.createLinearGradient(0, 0, 0, 640);
    shade.addColorStop(0, '#0918273d'); shade.addColorStop(.23, '#09182700');
    shade.addColorStop(.75, '#09182700'); shade.addColorStop(1, '#09182766');
    c.fillStyle = shade; c.fillRect(0, 0, 960, 640); texture.refresh();
  }
  scene.add.image(480, 320, key).setDepth(900);
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (let i = 0; i < 18; i++) {
    const mote = scene.add.circle(80 + (i * 137) % 810, 90 + (i * 79) % 480, i % 3 ? 1 : 1.6, moonlit ? 0xc0eaff : 0xffe5a1, .3).setDepth(901);
    scene.tweens.add({ targets: mote, x: '+=25', y: '-=36', alpha: { from: .05, to: .5 }, duration: 2600 + i * 190, delay: i * 93, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }
}
