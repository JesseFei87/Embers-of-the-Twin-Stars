import { readDisplaySettings } from '../../presentation/DisplaySettings';
import { mapPosition, roads, worldNodes, type Point, type WorldNode } from './RoadNetwork';

type Actor = { element: HTMLImageElement; frames: HTMLImageElement[]; phase: number; patrol?: Point[] };
/** The supplied illustration and every map marker share one fixed image coordinate system. */
export class WorldMapView {
  readonly host = document.createElement('div');
  private surface = document.createElement('div');
  private background = new Image();
  private buttons = new Map<string, HTMLButtonElement>();
  private actors: Actor[] = [];
  private hero?: Actor;
  private clock = 0;
  private lastHeroX?: number;
  private disposed = false;
  private ready = false;
  private observer?: ResizeObserver;
  private settings = readDisplaySettings();
  constructor(private select: (node: WorldNode) => void) {
    this.host.className = 'world-map-host'; this.host.setAttribute('aria-label', '北境诸国图片大地图');
    this.surface.className = 'world-map-surface';
    this.background.className = 'world-map-image'; this.background.alt = '北境诸国：晨雾村、古桥、群星神殿、雪岭与灰烬城堡';
    this.background.draggable = false;
    this.surface.append(this.background); this.host.append(this.surface);
  }
  async mount(parent: HTMLElement) {
    parent.append(this.host);
    this.background.src = '/assets/world-map/northern-realms.png';
    try { await this.background.decode(); } catch { throw new Error('大地图图片加载失败，请重新载入。'); }
    if (this.disposed) return;
    const makeActor = async (sprite: string): Promise<Actor> => {
      const frames = await Promise.all(Array.from({ length: 6 }, async (_, i) => {
        const frame = new Image(); frame.src = `/assets/starfall/animations/${sprite}/0${i + 1}.png`; await frame.decode(); return frame;
      }));
      const element = new Image(); element.className = 'world-map-actor'; element.alt = ''; element.draggable = false; element.src = frames[0].src;
      this.surface.append(element); return { element, frames, phase: this.actors.length * 1.7 };
    };
    for (const node of worldNodes) {
      const button = document.createElement('button'); button.className = `world-map-node${node.enemy ? ' hostile' : ''}`;
      button.dataset.mapNode = node.id; button.setAttribute('aria-label', `${node.label}，${node.kind}`);
      button.innerHTML = `<span class="map-pin">${node.icon}</span><b>${node.label}</b>${node.id === 'moss-hollow' || node.id === 'tide-cove' ? '<small>初级讨伐 · 可重复</small>' : ''}`;
      button.style.left = `${node.image[0]}px`; button.style.top = `${node.image[1]}px`;
      button.onclick = () => this.select(node); this.surface.append(button); this.buttons.set(node.id, button);
      if (node.enemy) {
        const actor = await makeActor(node.enemy), road = roads.find(r => r.from === node.id || r.to === node.id)!;
        actor.patrol = road.from === node.id ? road.points.slice(0, 2) : road.points.slice(-2).reverse(); this.actors.push(actor);
      }
    }
    this.hero = await makeActor('sword'); this.hero.element.classList.add('world-map-hero');
    if (this.disposed) { this.host.remove(); return; }
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(this.host); this.resize(); this.ready = true;
  }
  private place(actor: Actor, point: Point, frame: number, facingLeft: boolean) {
    actor.element.style.left = `${point.x}px`; actor.element.style.top = `${point.y}px`;
    actor.element.style.setProperty('--actor-facing', facingLeft ? '-1' : '1');
    const src = actor.frames[frame].src; if (actor.element.src !== src) actor.element.src = src;
  }
  update(delta: number, position: Point, moving: boolean, facingLeft: boolean, selected?: string) {
    if (!this.ready || this.disposed) return;
    this.clock += Math.min(delta, .1); const time = this.settings.reducedMotion ? 0 : this.clock;
    for (const actor of this.actors) {
      const [a, b] = actor.patrol!, t = this.settings.reducedMotion ? 0 : (Math.sin(time * .55 + actor.phase) + 1) * .12;
      const p = mapPosition({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      this.place(actor, p, this.settings.reducedMotion ? 0 : 1 + Math.floor(time * 6) % 2, Math.cos(time * .55 + actor.phase) * (mapPosition(b).x - mapPosition(a).x) < 0);
    }
    const p = mapPosition(position);
    if (moving && this.lastHeroX !== undefined) facingLeft = p.x < this.lastHeroX;
    this.place(this.hero!, p, moving && !this.settings.reducedMotion ? 1 + Math.floor(time * 9) % 2 : 0, facingLeft);
    this.lastHeroX = p.x;
    for (const [id, button] of this.buttons) button.classList.toggle('selected', selected === id);
  }
  private resize() {
    const { width, height } = this.host.getBoundingClientRect();
    const scale = Math.min(width / 1672, height / 941);
    this.surface.style.transform = `scale(${scale})`;
    this.surface.style.left = `${width - 1672 * scale}px`;
    this.surface.style.top = `${(height - 941 * scale) / 2}px`;
  }
  dispose() { this.disposed = true; this.ready = false; this.observer?.disconnect(); this.host.remove(); }
}
