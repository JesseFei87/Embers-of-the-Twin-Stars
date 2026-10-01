import { paperBook, paperTitle } from './parchment';
import { portraitIndex } from './portraits';
import { spriteVisual } from './fighter';
import { noxSpriteMarkup } from './noxSprite';
import { moonlitSpriteKey } from './moonlitSprites';
import type { Unit } from '../state';

export function installReplicaLayout() {
  const resize = () => {
    const style = document.documentElement.style;
    const battleScale = Math.min(innerWidth / 1440, innerHeight / 810);
    style.setProperty('--replica-scale', String(Math.min(innerWidth / 1672, innerHeight / 941)));
    style.setProperty('--battle-scale', String(battleScale));
    style.setProperty('--battle-menu-scale', String(Math.min(innerWidth / 1100, innerHeight / 810)));
    style.setProperty('--battle-width', `${innerWidth / battleScale}px`);
    style.setProperty('--battle-height', `${innerHeight / battleScale}px`);
  };
  resize(); window.addEventListener('resize', resize);
}

/** Shared by the roster and battlefield; identities survive recruitment/save loads. */
export function cutoutPortraitUrl(unit: Pick<Unit, 'id'>): string | undefined {
  if (unit.id.startsWith('mossling-')) return '/assets/hd2d/mossling/01.png';
  if (unit.id.startsWith('tidecrab-')) return '/assets/hd2d/tidecrab/01.png';
  const portraits: Record<string, string> = {
    kael: 'kael-bust-refined', mira: 'mira-bust', e2: 'nox-bust',
    e1: 'eclipse-knight-bust', e3: 'dusk-raven-bust',
    e4: 'black-knight-bust', e5: 'black-knight-bust',
    c2e1: 'black-knight-bust', c2e2: 'dusk-raven-bust', c2e3: 'dusk-raven-bust',
    c2recruit: 'eileen-bust-refined', c2e5: 'altar-mage-bust',
  };
  if (unit.id === 'lyra') return '/assets/chronicle/replica/lyra-bust.png';
  return portraits[unit.id] ? `/assets/chronicle/battle-v2/${portraits[unit.id]}.png` : undefined;
}

export function portraitUrl(unit: Unit) {
  if (moonlitSpriteKey(unit.id) || ['mossling', 'tidecrab'].includes(unit.class)) return cutoutPortraitUrl(unit)!;
  return `/assets/chronicle/portraits/${['kael', 'veteran', 'mira', 'knight', 'lyra', 'nox', 'erin', 'selene'][portraitIndex(unit)]}.png`;
}

export function mapSpriteMarkup(unit: Unit, className = '', label = '') {
  if (unit.id === 'e2') return noxSpriteMarkup(0, 52, className, label);
  return `<img class="${className}" src="/assets/starfall/animations/${moonlitSpriteKey(unit.id) ?? spriteVisual(unit.class)}/01.png" alt="${label}">`;
}

/** A dialog is added above the current scene, so closing it preserves its state. */
export function showChronicleDialog(title: string, content: string, onClose?: () => void, leftPage?: string) {
  const previous = document.activeElement as HTMLElement | null;
  const dialog = document.createElement('dialog');
  dialog.className = title === '战场菜单' ? 'chronicle-dialog' : 'chronicle-dialog paper-dialog';
  dialog.innerHTML = `<div class="chronicle-dialog-paper"><small>EMBERS OF TWIN STARS</small><h2>${title}</h2>${content}<button class="small-btn" data-dialog-close>返回</button></div>`;
  if (title !== '战场菜单') {
    dialog.innerHTML = paperBook(leftPage ?? `${paperTitle('远征记录')}<nav class="paper-index"><p>${title}</p></nav><p class="paper-muted">沿途的故事与同伴的足迹，都记录在此。</p>`, `${leftPage ? '' : paperTitle(title, 'CURRENT RECORD')}${content}`, '<button class="paper-button primary" data-dialog-close>返回</button>', title);
  }
  document.querySelector('#hud')!.append(dialog);
  dialog.querySelector('[data-dialog-close]')!.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { dialog.remove(); previous?.focus(); onClose?.(); }, { once: true });
  dialog.showModal();
  return dialog;
}

export function portraitMarkup(unit: Unit, className = '') {
  const cutout = cutoutPortraitUrl(unit);
  return `<img class="paper-portrait ${cutout ? 'cutout' : 'portrait-fallback'} ${className}" src="${cutout ?? portraitUrl(unit)}" alt="${unit.name}">`;
}
