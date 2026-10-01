import layout from './layout.json';
export type Point = { x: number; y: number };
export const worldNodes = layout.nodes;
export type WorldNode = typeof worldNodes[number];
export const roadVertices = [...layout.nodes, ...layout.junctions];
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const roads = layout.roads.map(r => ({ ...r, points: r.points.map(([x, y]) => ({ x, y })), length: r.points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - r.points[i][0], p[1] - r.points[i][1]), 0) }));
/** Keep saved travel coordinates stable while placing each road on the supplied image. */
export function mapPosition(point: Point): Point {
  let nearest = Infinity, result = { x: 0, y: 0 };
  for (const road of roads) for (let i = 0; i < road.points.length - 1; i++) {
    const a = road.points[i], b = road.points[i + 1], dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
    const d = Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
    if (d < nearest) {
      nearest = d;
      const start = road.imagePoints[i], end = road.imagePoints[i + 1];
      result = { x: start[0] + (end[0] - start[0]) * t, y: start[1] + (end[1] - start[1]) * t };
    }
  }
  return result;
}
export function shortestRoadPath(from: string, to: string): Point[] {
  const costs = new Map(roadVertices.map(v => [v.id, Infinity])); costs.set(from, 0);
  const previous = new Map<string, { id: string; road: typeof roads[number] }>();
  const pending = new Set(costs.keys());
  while (pending.size) {
    const id = [...pending].sort((a, b) => costs.get(a)! - costs.get(b)!)[0]; pending.delete(id);
    if (id === to || !Number.isFinite(costs.get(id))) break;
    for (const road of roads.filter(r => r.from === id || r.to === id)) {
      const other = road.from === id ? road.to : road.from, cost = costs.get(id)! + road.length;
      if (cost < costs.get(other)!) { costs.set(other, cost); previous.set(other, { id, road }); }
    }
  }
  const route: Point[][] = []; let id = to;
  while (id !== from) {
    const step = previous.get(id); if (!step) return [];
    route.unshift(step.road.from === step.id ? step.road.points : [...step.road.points].reverse()); id = step.id;
  }
  return route.flatMap((points, i) => i ? points.slice(1) : points);
}
/** Position always lies on an authored road; even old free-roaming saves are projected onto one. */
export class RoadNavigator {
  position: Point;
  private path: Point[] = [];
  destination?: string;
  facingLeft = false;
  constructor(position: Point) { this.position = this.project(position).point; }
  get moving() { return this.path.length > 0; }
  private project(point: Point) {
    let best = { point: roads[0].points[0], road: roads[0], index: 0, distance: Infinity };
    for (const road of roads) for (let i = 0; i < road.points.length - 1; i++) {
      const a = road.points[i], b = road.points[i + 1], dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
      const p = { x: a.x + dx * t, y: a.y + dy * t }, d = distance(point, p);
      if (d < best.distance) best = { point: p, road, index: i, distance: d };
    }
    return best;
  }
  travelTo(id: string) {
    const { road, index } = this.project(this.position);
    const options = [
      [this.position, ...road.points.slice(0, index + 1).reverse(), ...shortestRoadPath(road.from, id).slice(1)],
      [this.position, ...road.points.slice(index + 1), ...shortestRoadPath(road.to, id).slice(1)],
    ];
    const length = (p: Point[]) => p.slice(1).reduce((n, v, i) => n + distance(p[i], v), 0);
    this.path = options.sort((a, b) => length(a) - length(b))[0].slice(1).map(p => ({ ...p })); this.destination = id;
  }
  direction(dx: number, dy: number) {
    if (this.moving) return;
    const vertex = roadVertices.find(v => distance(v, this.position) < .1);
    if (!vertex) {
      const { road, index } = this.project(this.position), forward = mapPosition(road.points[index + 1]), backward = mapPosition(road.points[index]);
      this.travelTo((forward.x - backward.x) * dx + (forward.y - backward.y) * dy >= 0 ? road.to : road.from); return;
    }
    const choices = roads.filter(r => r.from === vertex.id || r.to === vertex.id).map(road => {
      const p = mapPosition(road.from === vertex.id ? road.points[1] : road.points.at(-2)!), origin = mapPosition(vertex);
      const length = distance(p, origin); return { id: road.from === vertex.id ? road.to : road.from, dot: ((p.x - origin.x) * dx + (p.y - origin.y) * dy) / length };
    }).sort((a, b) => b.dot - a.dot);
    if (choices[0]?.dot > .2) this.travelTo(choices[0].id);
  }
  stop() { this.path = []; this.destination = undefined; }
  update(seconds: number) {
    let step = Math.min(seconds, .1) * 95;
    while (step > 0 && this.path.length) {
      const p = this.path[0], d = distance(this.position, p); this.facingLeft = p.x < this.position.x;
      if (d <= step) { this.position = { ...p }; this.path.shift(); step -= d; }
      else { this.position.x += (p.x - this.position.x) / d * step; this.position.y += (p.y - this.position.y) / d * step; step = 0; }
    }
  }
  nearby() { return worldNodes.find(n => distance(n, this.position) < .5); }
}
