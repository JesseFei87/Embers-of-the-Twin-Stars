import { readDisplaySettings } from '../../presentation/DisplaySettings';

// Battle HUD refreshes often: unfurl only when a different kind of panel opens.
export function installChronicleMotion(hud: HTMLElement) {
  let previous = '';
  const update = () => {
    const reduced = readDisplaySettings().reducedMotion;
    document.documentElement.dataset.reducedMotion = String(reduced);
    const panel = hud.querySelector<HTMLElement>('.dialogue, .detail-card, .promotion-card, .result-card, .exp-card, .shrine-card, .render-settings, .prep-screen, .combat-preview, .destination-card');
    const signature = panel?.className ?? '';
    if (panel && signature !== previous && !reduced) panel.dataset.unfurl = 'true';
    previous = signature;
  };
  const observer = new MutationObserver(update);
  observer.observe(hud, { childList: true, subtree: true });
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', update);
  update();
}
