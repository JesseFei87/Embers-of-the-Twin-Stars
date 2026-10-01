/** A bounded desktop orbit. The complete island is modeled on every side. */
export class WorldOrbit {
  yaw = 0;
  pitch = 43 * Math.PI / 180;
  zoom = 1;
  rotate(horizontal: number, vertical = 0) {
    this.yaw = ((this.yaw + horizontal) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    this.pitch = Math.max(28 * Math.PI / 180, Math.min(62 * Math.PI / 180, this.pitch + vertical));
  }
  magnify(amount: number) { this.zoom = Math.max(.85, Math.min(1.7, this.zoom * amount)); }
  reset() { this.yaw = 0; this.pitch = 43 * Math.PI / 180; this.zoom = 1; }
  get degrees() { return Math.round(this.yaw * 180 / Math.PI) % 360; }
  screenDirection(x: number, y: number) {
    return { x: x * Math.cos(this.yaw) + y * Math.sin(this.yaw), y: -x * Math.sin(this.yaw) + y * Math.cos(this.yaw) };
  }
}
