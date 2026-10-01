import type { Stats, Unit } from './types';

const growths = (maxHp: number, strength: number, skill: number, speed: number, luck: number, defense: number, resistance: number): Stats =>
  ({ maxHp, strength, skill, speed, luck, defense, resistance });

export const createCharacterData = (): Unit[] => [
  { id: 'kael', name: '凯尔', title: '星火剑士', team: 'player', class: 'sword', x: 3, y: 7, hp: 24, level: 1, exp: 0, stats: { maxHp: 24, strength: 10, skill: 7, speed: 9, luck: 7, defense: 4, resistance: 4 }, growths: growths(50, 40, 35, 40, 30, 25, 15), itemId: 'steel-sword', spells: [], acted: false, portrait: 0 },
  { id: 'lyra', name: '莱拉', title: '星祈骑士', team: 'player', class: 'star-cavalry', x: 4, y: 7, hp: 22, level: 1, exp: 0, stats: { maxHp: 22, strength: 9, skill: 6, speed: 8, luck: 6, defense: 4, resistance: 10 }, growths: growths(45, 35, 35, 40, 45, 25, 30), spells: ['resire', 'recover'], activeSpellId: 'resire', activeHealingSpellId: 'recover', acted: false, portrait: 4 },
  { id: 'mira', name: '米菈', title: '苍林枪卫', team: 'player', class: 'lancer', x: 5, y: 7, hp: 28, level: 1, exp: 0, stats: { maxHp: 28, strength: 10, skill: 5, speed: 6, luck: 3, defense: 7, resistance: 2 }, growths: growths(55, 45, 30, 25, 20, 40, 10), itemId: 'steel-lance', spells: [], acted: false, portrait: 2 },
  { id: 'e1', name: '蚀月骑士', title: '黑甲先锋', team: 'enemy', class: 'knight', x: 4, y: 1, hp: 27, level: 3, exp: 0, stats: { maxHp: 27, strength: 9, skill: 4, speed: 4, luck: 0, defense: 6, resistance: 1 }, growths: growths(0, 0, 0, 0, 0, 0, 0), itemId: 'iron-lance', spells: [], acted: false, portrait: 3 },
  { id: 'e2', name: '诺克斯', title: '受胁的斥候', team: 'enemy', class: 'raider', x: 1, y: 2, hp: 17, level: 2, exp: 0, stats: { maxHp: 17, strength: 7, skill: 4, speed: 8, luck: 1, defense: 2, resistance: 0 }, growths: growths(45, 35, 35, 45, 25, 20, 10), itemId: 'raider-blade', spells: [], acted: false, portrait: 5 },
  { id: 'e3', name: '暮鸦', title: '蚀月斥候', team: 'enemy', class: 'raider', x: 8, y: 2, hp: 17, level: 2, exp: 0, stats: { maxHp: 17, strength: 7, skill: 4, speed: 8, luck: 1, defense: 2, resistance: 0 }, growths: growths(0, 0, 0, 0, 0, 0, 0), itemId: 'raider-blade', spells: [], acted: false, portrait: 3 },
  { id: 'e4', name: '黑铠兵', title: '桥头守卫', team: 'enemy', class: 'knight', x: 3, y: 4, hp: 21, level: 2, exp: 0, stats: { maxHp: 21, strength: 8, skill: 3, speed: 3, luck: 0, defense: 5, resistance: 1 }, growths: growths(0, 0, 0, 0, 0, 0, 0), itemId: 'iron-lance', spells: [], acted: false, portrait: 3 },
  { id: 'e5', name: '黑铠兵', title: '桥头守卫', team: 'enemy', class: 'knight', x: 6, y: 4, hp: 21, level: 2, exp: 0, stats: { maxHp: 21, strength: 8, skill: 3, speed: 3, luck: 0, defense: 5, resistance: 1 }, growths: growths(0, 0, 0, 0, 0, 0, 0), itemId: 'iron-lance', spells: [], acted: false, portrait: 3 },
];
