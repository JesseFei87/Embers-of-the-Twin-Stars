import * as THREE from 'three';
import type { Vec3 } from '../contracts';

export class TacticalCamera {
  readonly camera = new THREE.PerspectiveCamera(35, 1, .1, 400);
  readonly target = new THREE.Vector3(0, 0, 0);
  private distance = 18;
  private fitDistance = 18;
  private fitWidth = 11;
  private minFitDistance = 17.5;
  private panBounds = { x: 5, z: 4 };
  setMapSize(cols: number, rows: number) { this.fitWidth = cols + 1; this.minFitDistance = Math.max(17.5, rows * 1.8); this.panBounds = { x: cols / 2, z: rows / 2 }; }
  private offset = new THREE.Vector3(0, .72, 1).normalize();
  private moonlit = false;
  setStarfall() { this.offset.set(10, 14, 26.2).normalize(); this.fitWidth = 13.5; }
  setMoonlit() { this.moonlit=true; this.offset.set(1,23,30).normalize(); this.fitWidth=15; this.minFitDistance=24; this.panBounds={x:2,z:2}; }
  resize(width: number, height: number) {
    const zoom = this.distance / this.fitDistance;
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.fitDistance = Math.max(this.minFitDistance, this.fitWidth / this.camera.aspect / (2 * Math.tan(THREE.MathUtils.degToRad(17.5))));
    this.distance = this.fitDistance * THREE.MathUtils.clamp(zoom, .55, this.moonlit ? 1 : 1.25);
    this.apply();
  }
  rotate(dx: number, dy: number) {
    const spherical = new THREE.Spherical().setFromVector3(this.offset);
    spherical.theta -= dx * .006;
    spherical.phi = THREE.MathUtils.clamp(spherical.phi + dy * .004, .3, 1.36);
    if(this.moonlit) { spherical.theta=THREE.MathUtils.clamp(spherical.theta,-.45,.45); spherical.phi=THREE.MathUtils.clamp(spherical.phi,.58,1.05); }
    this.offset.setFromSpherical(spherical); this.apply();
  }
  reset() { this.target.set(0, .1, 0); this.distance = this.fitDistance; if(this.moonlit)this.offset.set(1,23,30).normalize(); this.apply(); }
  private boundMoonlitTarget() {
    if(!this.moonlit)return;
    const limit=THREE.MathUtils.lerp(.5,2,THREE.MathUtils.clamp((1-this.distance/this.fitDistance)/.45,0,1));
    this.target.x=THREE.MathUtils.clamp(this.target.x,-limit,limit);this.target.z=THREE.MathUtils.clamp(this.target.z,-limit,limit);
  }
  focus(point: Vec3) { this.target.set(point.x,point.y,point.z); this.boundMoonlitTarget(); this.apply(); }
  pan(dx: number, dy: number) {
    this.target.x = THREE.MathUtils.clamp(this.target.x + (dx * this.offset.z + dy * this.offset.x) / Math.hypot(this.offset.x, this.offset.z) * this.distance * .0015, -this.panBounds.x, this.panBounds.x);
    this.target.z = THREE.MathUtils.clamp(this.target.z + (-dx * this.offset.x + dy * this.offset.z) / Math.hypot(this.offset.x, this.offset.z) * this.distance * .0015, -this.panBounds.z, this.panBounds.z);
    this.boundMoonlitTarget(); this.apply();
  }
  zoom(delta: number) { this.distance = THREE.MathUtils.clamp(this.distance * Math.exp(delta * .001), this.fitDistance * .55, this.fitDistance * (this.moonlit ? 1 : 1.25)); this.boundMoonlitTarget(); this.apply(); }
  capture() { return { target: this.target.clone(), distance: this.distance, offset: this.offset.clone() }; }
  restore(state: ReturnType<TacticalCamera['capture']>) { this.offset.copy(state.offset); this.target.copy(state.target); this.distance = state.distance; this.apply(); }
  cinematic(a: Vec3, b: Vec3, progress: number, saved: ReturnType<TacticalCamera['capture']>) {
    const middle = new THREE.Vector3((a.x + b.x) / 2, (a.y + b.y) / 2 + .3, (a.z + b.z) / 2);
    this.target.copy(saved.target).lerp(middle, progress);
    const framing = Math.max(7, Math.hypot(a.x - b.x, a.z - b.z) * 2.6 / Math.min(1, this.camera.aspect));
    this.distance = THREE.MathUtils.lerp(saved.distance, Math.min(saved.distance, framing), progress);
    this.apply();
  }
  shake(amount: number, time: number) { this.apply(); this.camera.position.x += Math.sin(time * 71) * amount; this.camera.position.y += Math.cos(time * 83) * amount * .6; }
  apply() { this.camera.position.copy(this.target).addScaledVector(this.offset, this.distance); this.camera.lookAt(this.target); this.camera.updateMatrixWorld(); }
}
