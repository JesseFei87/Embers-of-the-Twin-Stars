const volumeKey = 'embers-music-volume-v1';
const starfallTrack = '/assets/audio/starfall-under-the-same-stars.wav?v=3';

/** One soundtrack voice, independent of HUD redraws and combat animation speed. */
export class BattleMusic {
  private context?: AudioContext;
  private master?: GainNode;
  private voice?: { source: AudioBufferSourceNode; gain: GainNode };
  private buffer?: Promise<AudioBuffer>;
  private wanted = false;
  private installed = false;
  volume = .55;

  constructor() {
    try {
      const saved = localStorage.getItem(volumeKey);
      if (saved !== null && Number.isFinite(Number(saved))) this.volume = Math.max(0, Math.min(1, Number(saved)));
    } catch { /* Music preferences also work without persistent storage. */ }
  }

  install() {
    if (this.installed) return;
    this.installed = true;
    window.addEventListener('pointerdown', this.unlock);
    window.addEventListener('keydown', this.unlock);
    document.addEventListener('visibilitychange', this.visibility);
  }

  // Resume in the user gesture, before asynchronous scene loading loses activation.
  private unlock = () => {
    if (document.hidden) return;
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.context.destination);
    }
    void this.context.resume().then(() => this.start()).catch(() => { /* Retry on the next gesture. */ });
  };

  private visibility = () => {
    if (!this.context) return;
    if (document.hidden) void this.context.suspend().catch(() => {});
    else if (this.wanted) this.unlock();
  };

  playChapter(chapterId: string) {
    if (chapterId !== 'starfall-bridge') { this.stop(); return; }
    this.wanted = true;
    void this.start();
  }

  private async start() {
    const context = this.context;
    if (!this.wanted || this.voice || !context || context.state !== 'running' || document.hidden) return;
    try {
      this.buffer ??= fetch(starfallTrack).then(response => {
        if (!response.ok) throw new Error('Music asset unavailable');
        return response.arrayBuffer();
      }).then(bytes => context.decodeAudioData(bytes));
      const buffer = await this.buffer;
      // A menu transition, tab switch, or a second gesture may happen during decode.
      if (!this.wanted || this.voice || this.context !== context || context.state !== 'running' || document.hidden) return;
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer; source.loop = true; source.loopStart = 0; source.loopEnd = buffer.duration;
      source.connect(gain); gain.connect(this.master!);
      gain.gain.setValueAtTime(0, context.currentTime);
      gain.gain.linearRampToValueAtTime(1, context.currentTime + 1.5);
      source.onended = () => { source.disconnect(); gain.disconnect(); };
      this.voice = { source, gain };
      source.start();
    } catch {
      this.buffer = undefined; // A failed download never blocks the game; the next gesture retries.
    }
  }

  setVolume(value: number) {
    if (!Number.isFinite(value)) return;
    this.volume = Math.max(0, Math.min(1, value));
    try { localStorage.setItem(volumeKey, String(this.volume)); } catch { /* Keep session volume. */ }
    if (this.master && this.context) {
      const param = this.master.gain;
      param.cancelScheduledValues(this.context.currentTime);
      param.setValueAtTime(param.value, this.context.currentTime);
      param.linearRampToValueAtTime(this.volume, this.context.currentTime + .1);
    }
  }

  stop() {
    this.wanted = false;
    if (!this.voice || !this.context) return;
    const { source, gain } = this.voice;
    const now = this.context.currentTime;
    gain.gain.cancelScheduledValues(now); gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + .6);
    source.stop(now + .6); this.voice = undefined;
  }

  dispose() {
    this.stop();
    window.removeEventListener('pointerdown', this.unlock);
    window.removeEventListener('keydown', this.unlock);
    document.removeEventListener('visibilitychange', this.visibility);
    void this.context?.close(); this.context = undefined; this.buffer = undefined; this.installed = false;
  }
}

export const battleMusic = new BattleMusic();

export function musicSettingsMarkup() {
  const percent = Math.round(battleMusic.volume * 100);
  return `<label class="music-volume">背景音乐 <input data-music-volume type="range" min="0" max="100" step="1" value="${percent}" aria-label="背景音乐音量"><output data-music-value>${percent === 0 ? '静音' : `${percent}%`}</output></label>`;
}

export function bindMusicSettings(root: ParentNode) {
  root.querySelector<HTMLInputElement>('[data-music-volume]')?.addEventListener('input', event => {
    const percent = Number((event.target as HTMLInputElement).value);
    battleMusic.setVolume(percent / 100);
    const output = root.querySelector('[data-music-value]');
    if (output) output.textContent = percent === 0 ? '静音' : `${percent}%`;
  });
}
