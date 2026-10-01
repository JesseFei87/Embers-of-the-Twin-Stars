import { cutoutPortraitUrl } from './replica';

export async function playDialogue(lines: Array<{ speaker: string; text: string; portrait: number; speakerId?: string }>) {
  const hud = document.querySelector<HTMLDivElement>('#hud')!;
  for (const line of lines) {
    await new Promise<void>(resolve => {
      const id = line.speakerId ?? ({ 凯尔: 'kael', 莱拉: 'lyra', 米菈: 'mira', 诺克斯: 'e2', 艾琳: 'c2recruit' } as Record<string, string>)[line.speaker];
      const portrait = id ? cutoutPortraitUrl({ id }) : undefined;
      hud.innerHTML = `<section class="paper-dialogue-screen"><div class="paper-dialogue" role="button" tabindex="0" aria-label="继续对话">${portrait ? `<img class="dialogue-cutout" src="${portrait}" alt="${line.speaker}">` : ''}<div class="dialogue-scroll"><div class="speaker">${line.speaker}</div><div class="line">${line.text}</div><div class="advance">点击继续 / Enter ↵</div></div></div></section>`;
      const panel = hud.querySelector<HTMLElement>('.paper-dialogue')!;
      panel.focus({ preventScroll: true });
      const next = () => { panel.onclick = null; panel.onkeydown = null; resolve(); };
      panel.onclick = next;
      panel.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); next(); } };
    });
  }
  hud.innerHTML = '';
}
