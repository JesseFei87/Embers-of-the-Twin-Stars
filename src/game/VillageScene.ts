import Phaser from 'phaser';
import { visitWorldNode } from './save';
import { playDialogue } from './ui/dialogue';
import { addAtmosphere } from './ui/atmosphere';

const hud = document.querySelector<HTMLDivElement>('#hud')!;
const places = [
  { id: 'supply', x: 325, y: 295, name: '炉火补给屋', icon: '⌂', text: '拜访村民，领取为远征准备的补给。' },
  { id: 'chapel', x: 680, y: 315, name: '村中祈愿堂', icon: '✦', text: '听听莱拉对故乡与星光的回忆。' },
  { id: 'exit', x: 470, y: 565, name: '离开村庄', icon: '↟', text: '返回北境世界地图，继续远征。' },
];
type Place = typeof places[number];
const plaza = new Phaser.Geom.Polygon([315, 291, 480, 275, 685, 307, 805, 340, 821, 444, 586, 507, 530, 610, 420, 610, 382, 510, 195, 442, 181, 341]);
const inside = (x: number, y: number) => Phaser.Geom.Polygon.Contains(plaza, x, y);

export class VillageScene extends Phaser.Scene {
  private hero!: Phaser.GameObjects.Sprite;
  private shadow!: Phaser.GameObjects.Ellipse;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private route: Array<{ x: number; y: number }> = [];
  private selected?: Place;
  private nearby?: Place;
  private modal = false;
  private stamp = '';
  constructor() { super('village'); }

  preload() {
    this.load.image('hd-village', '/assets/hd2d/village.png');
    for (let i = 0; i < 3; i++) this.load.image('hd-hero-' + i, `/assets/hd2d/sword/0${i + 1}.png`);
  }

  create() {
    this.route = []; this.selected = undefined; this.nearby = undefined; this.modal = false; this.stamp = '';
    this.add.image(480, 320, 'hd-village').setDisplaySize(960, 640);
    addAtmosphere(this);
    for (const [x, y] of [[597, 251], [721, 255], [579, 469], [379, 459]]) {
      const glow = this.add.circle(x, y, 15, 0xffd88b, .12).setBlendMode(Phaser.BlendModes.ADD).setDepth(5);
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) this.tweens.add({ targets: glow, alpha: .28, scale: 1.25, duration: 1100 + x, repeat: -1, yoyo: true });
    }
    this.shadow = this.add.ellipse(470, 508, 28, 9, 0x0e1721, .5).setDepth(10);
    this.hero = this.add.sprite(470, 510, 'hd-hero-0').setOrigin(.5, 1).setDisplaySize(70, 70).setDepth(11);
    for (const place of places) {
      this.add.ellipse(place.x, place.y, 35, 12, 0xf6dc91, .14).setStrokeStyle(1, 0xffdf91, .7).setDepth(3);
      this.add.text(place.x, place.y + 13, place.icon + ' ' + place.name, { fontFamily: 'serif', fontSize: '12px', color: '#ffedbb', stroke: '#0b1c27', strokeThickness: 4 }).setOrigin(.5).setDepth(12);
    }
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,ENTER,SPACE,ESC') as Record<string, Phaser.Input.Keyboard.Key>;
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.modal || p.event.target !== this.game.canvas) return;
      const place = places.find(item => Phaser.Math.Distance.Between(p.x, p.y, item.x, item.y) < 36);
      if (place) this.go(place, place); else if (inside(p.x, p.y)) this.go({ x: p.x, y: p.y });
    });
    this.events.once('shutdown', () => { this.input.removeAllListeners('pointerdown'); this.input.keyboard?.removeCapture('W,A,S,D,UP,DOWN,LEFT,RIGHT,ENTER,SPACE,ESC'); });
    this.render();
  }

  private go(target: { x: number; y: number }, place?: Place) {
    if (this.modal) return;
    this.selected = place;
    const direct = Array.from({ length: 20 }, (_, i) => (i + 1) / 20).every(t => inside(this.hero.x + (target.x - this.hero.x) * t, this.hero.y + (target.y - this.hero.y) * t));
    this.route = direct ? [target] : [{ x: 480, y: 400 }, target];
    this.render();
  }

  update(time: number, delta: number) {
    if (!this.hero || this.modal) return;
    const k = this.keys;
    let dx = Number(k.D.isDown || k.RIGHT.isDown) - Number(k.A.isDown || k.LEFT.isDown);
    let dy = Number(k.S.isDown || k.DOWN.isDown) - Number(k.W.isDown || k.UP.isDown);
    if (dx || dy) { this.route = []; this.selected = undefined; }
    const step = Math.min(delta, 50) * .15;
    if (!dx && !dy && this.route.length) {
      const target = this.route[0]; dx = target.x - this.hero.x; dy = target.y - this.hero.y;
      if (Math.hypot(dx, dy) <= step) { this.hero.setPosition(target.x, target.y); this.route.shift(); dx = 0; dy = 0; }
    }
    const length = Math.hypot(dx, dy);
    if (length) {
      const x = this.hero.x + dx / length * step, y = this.hero.y + dy / length * step;
      if (inside(x, y)) this.hero.setPosition(x, y);
      this.hero.setFlipX(dx < 0).setTexture('hd-hero-' + [0, 1, 0, 2][Math.floor(time / 115) % 4]);
    } else this.hero.setTexture('hd-hero-0');
    this.shadow.setPosition(this.hero.x, this.hero.y - 2);
    this.nearby = places.find(p => Phaser.Math.Distance.Between(p.x, p.y, this.hero.x, this.hero.y) < 28);
    const stamp = (this.nearby?.id ?? '') + ':' + this.route.length;
    if (stamp !== this.stamp) { this.stamp = stamp; this.render(); }
    if (Phaser.Input.Keyboard.JustDown(k.ENTER) || Phaser.Input.Keyboard.JustDown(k.SPACE)) void this.enter();
    if (Phaser.Input.Keyboard.JustDown(k.ESC)) { this.route = []; this.selected = undefined; this.render(); }
  }

  private render() {
    const place = this.selected ?? this.nearby;
    const arrived = place?.id === this.nearby?.id && !this.route.length;
    hud.innerHTML = `<section class="world-ui village-ui"><header class="atlas-heading"><small>HEARTH & HOME · NORTHERN REALMS</small><h1>晨雾村</h1><p>炉火不熄，故乡仍在。</p></header>
      ${place ? `<aside class="destination-card"><small>村庄探索</small><h2>${place.name}</h2><p>${place.text}</p><div class="destination-status">${arrived ? '已抵达 · 请确认互动' : '正在前往'}</div><button class="primary" id="village-enter" ${arrived ? '' : 'disabled'}>确认${place.id === 'exit' ? '离开' : '进入'} ↵</button></aside>` : ''}
      <footer class="atlas-dock"><div class="travel-party"><div><b>晨雾村 · 自由探索</b><small>WASD / 方向键行走 · 点击目的地 · Enter 确认</small></div></div><nav aria-label="村庄地点">${places.map(p => `<button data-village-place="${p.id}"><span>${p.icon}</span>${p.name}</button>`).join('')}</nav></footer></section>`;
    hud.querySelectorAll<HTMLButtonElement>('[data-village-place]').forEach(button => button.onclick = () => { const p = places.find(p => p.id === button.dataset.villagePlace)!; this.go(p, p); });
    hud.querySelector('#village-enter')?.addEventListener('click', () => void this.enter());
  }

  private async enter() {
    const place = this.selected ?? this.nearby;
    if (this.modal || !place || this.route.length || place.id !== this.nearby?.id) return;
    this.modal = true;
    if (place.id === 'exit') { hud.innerHTML = ''; this.scene.start('world'); return; }
    if (place.id === 'supply') {
      const result = visitWorldNode('village');
      await playDialogue([{ speaker: '凯尔', portrait: 0, text: result.firstVisit ? '村民为我们留下了一瓶圣泉药。我已将它放入仓库——这份心意，一定不会辜负。' : '补给已经收下。等道路重新开放，村里的炉火与集市也会恢复往日的热闹。' }]);
    } else await playDialogue([{ speaker: '莱拉', portrait: 4, text: '小时候，我们总在这里等待第一颗星。真正能回应远征者、治愈队伍的群星神殿还在北方……走吧，哥哥。' }]);
    this.modal = false; this.render();
  }
}
