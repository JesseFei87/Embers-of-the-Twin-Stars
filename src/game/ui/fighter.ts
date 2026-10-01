import type { Unit, UnitClass } from '../data/types';
import { noxSpriteMarkup } from './noxSprite';
import { moonlitSpriteKey } from './moonlitSprites';

export function spriteVisual(cls: UnitClass) {
  if (cls === 'mossling' || cls === 'tidecrab') return cls;
  if (['star-cavalry', 'valkyrie'].includes(cls)) return 'cavalry';
  if (['mage', 'cleric', 'witch', 'sage', 'saint'].includes(cls)) return 'mage';
  if (['lancer', 'paladin'].includes(cls)) return 'lancer';
  if (['knight', 'baron'].includes(cls)) return 'knight';
  return cls === 'raider' ? 'raider' : 'sword';
}

/** All poses share a normalized canvas and bottom-center anchor. */
export function fighterArt(unit: Unit) {
  const visual = moonlitSpriteKey(unit.id) ?? spriteVisual(unit.class);
  if (unit.id === 'e2') return `<div class="fighter-art hd-fighter" role="img" aria-label="${unit.name}的斥候战斗精灵"><div class="hd-body">${Array.from({ length: 6 }, (_, i) => `<div class="hd-pose" data-pose="${i}" ${i ? 'hidden' : ''}>${noxSpriteMarkup(i, 92)}</div>`).join('')}</div></div>`;
  return `<div class="fighter-art hd-fighter ${visual === 'cavalry' ? 'mounted' : ''}" role="img" aria-label="${unit.name}的${visual}战斗精灵"><div class="hd-body">${Array.from({ length: 6 }, (_, i) => `<img class="hd-pose" data-pose="${i}" src="/assets/hd2d/${visual}/0${i + 1}.png" alt="" draggable="false" ${i ? 'hidden' : ''}>`).join('')}</div></div>`;
}

export function showFighterPose(element: HTMLElement, pose: number) {
  element.querySelectorAll<HTMLImageElement>('.hd-pose').forEach(image => image.hidden = Number(image.dataset.pose) !== pose);
}
