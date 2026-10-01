import type { CombatStep } from './contracts';

// Application-side cursor for the existing stepwise HP commits. The GPU never writes Unit state.
export class CombatPlayback {
  private next = 0;
  constructor(readonly steps: readonly CombatStep[]) {}
  commit(step: CombatStep, apply: (step: CombatStep) => void) {
    const index = this.steps.findIndex(candidate => candidate.id === step.id && candidate.sceneKey === step.sceneKey);
    if (index < 0) throw new Error('Unknown combat presentation event');
    if (index < this.next) return false;
    if (index !== this.next) throw new Error('Out-of-order combat presentation event');
    apply(this.steps[this.next]); this.next++; return true;
  }
  skip(apply: (step: CombatStep) => void) { while (this.next < this.steps.length) this.commit(this.steps[this.next], apply); }
  get complete() { return this.next === this.steps.length; }
}

export class PresentationClock {
  private current?: { elapsed: number; duration: number; draw: (progress: number) => void; resolve: (finished: boolean) => void };
  play(duration: number, draw: (progress: number) => void = () => {}) {
    this.cancel();
    return new Promise<boolean>(resolve => { this.current = { elapsed: 0, duration, draw, resolve }; draw(0); });
  }
  update(delta: number, speed = 1) {
    const task = this.current; if (!task) return;
    task.elapsed += Math.max(0, Math.min(delta, .05)) * speed;
    const progress = Math.min(1, task.elapsed / task.duration); task.draw(progress);
    if (progress >= 1 && this.current === task) { this.current = undefined; task.resolve(true); }
  }
  cancel() { const task = this.current; this.current = undefined; task?.resolve(false); }
}
