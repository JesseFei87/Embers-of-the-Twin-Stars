import { createCharacterData } from './characters';
import type { MissionDefinition } from './mission';
import type { TerrainId } from './terrain';
import type { PortraitId, Stats, Unit } from './types';

export interface ChapterDefinition {
  id: string;
  order: number;
  repeatable?: boolean;
  title: string;
  subtitle: string;
  intro: Array<{ speaker: string; portrait: PortraitId; text: string }>;
  map: TerrainId[][];
  mission: MissionDefinition;
  deployment: Array<{ x: number; y: number }>;
  maxSortie: number;
  enemies: () => Unit[];
  rewards: string[];
  unlocks: string[];
}

const zero: Stats = { maxHp: 0, strength: 0, skill: 0, speed: 0, luck: 0, defense: 0, resistance: 0 };
const enemy = (data: Omit<Unit, 'growths' | 'exp' | 'acted' | 'spells'> & Partial<Pick<Unit, 'spells'>>): Unit => ({ ...data, growths: { ...zero }, exp: 0, acted: false, spells: data.spells ?? [] });
const map = (...rows: string[]) => rows.map(row => [...row] as TerrainId[]);

export const chapters: Record<string, ChapterDefinition> = {
  'starfall-bridge': {
    id: 'starfall-bridge', order: 1, title: '星落桥', subtitle: '序章 · 双星初燃',
    intro: [{ speaker: '米菈', portrait: 2, text: '桥上有重甲兵。森林能掩护我们的推进，别在开阔地和他们硬碰硬。' }, { speaker: '莱拉', portrait: 4, text: '骑兵适合沿道路快速支援，但森林会拖慢坐骑。我的星火术仍会燃烧自身生命。' }, { speaker: '凯尔', portrait: 0, text: '那就让我们替晨雾村夺回这条路。双星的余烬，还没有熄灭。' }],
    map: map('ggggffffgg', 'gggffmffgg', 'ggggmmfggg', 'wwwwbbwwww', 'ggggrrgggg', 'gffgrrggfg', 'ggggrrffgg', 'ggggssgggg'),
    mission: { title: '穿越星落桥', turnLimit: 20, leaderId: 'kael', victoryMode: 'any', victory: [{ type: 'defeat-boss', unitId: 'e1', label: '击败蚀月骑士' }, { type: 'seize', x: 4, y: 0, unitId: 'kael', label: '凯尔抵达北岸' }] },
    deployment: [{ x: 3, y: 7 }, { x: 4, y: 7 }, { x: 5, y: 7 }, { x: 6, y: 7 }], maxSortie: 4,
    enemies: () => createCharacterData().filter(unit => unit.team === 'enemy'), rewards: ['healing-draught'], unlocks: ['moonlit-pass'],
  },
  'moonlit-pass': {
    id: 'moonlit-pass', order: 2, title: '月影峡道', subtitle: '第一章 · 月下盟约',
    intro: [{ speaker: '诺克斯', portrait: 5, text: '峡道尽头就是月蚀军的祭坛。那位白披肩的剑士似乎也在暗中阻止献祭。' }, { speaker: '莱拉', portrait: 4, text: '我能感觉到她的祈祷。让我接近她，也许能避免无谓的战斗。' }, { speaker: '凯尔', portrait: 0, text: '夺下出口，击败女巫。今晚不再有人沦为祭品。' }],
    map: map('gggggggggggg', 'ggfgggrggggg', 'ggfffggggsgg', 'ggffmggffggg', 'gggmmgrffggg', 'wwwwbbbrwwww', 'ggggrrgggggg', 'ggffrrgmfggg', 'ggggrrfffggg', 'ggggrrgggggg', 'gggssssssggg', 'gggssssssggg'),
    mission: { title: '突破月影峡道', turnLimit: 18, leaderId: 'kael', victoryMode: 'any', victory: [{ type: 'defeat-boss', unitId: 'c2boss', label: '击败月蚀女巫' }, { type: 'seize', x: 9, y: 2, unitId: 'kael', label: '凯尔占领峡道出口' }] },
    deployment: [{ x: 4, y: 11 }, { x: 5, y: 11 }, { x: 6, y: 11 }, { x: 7, y: 11 }], maxSortie: 4,
    enemies: () => [
      enemy({ id: 'c2boss', name: '赛勒涅', title: '月蚀女巫', team: 'enemy', class: 'witch', x: 9, y: 2, hp: 28, level: 5, stats: { maxHp: 28, strength: 11, skill: 8, speed: 9, luck: 4, defense: 5, resistance: 10 }, activeSpellId: 'thunder', spells: ['thunder'], portrait: 3, dropItemId: 'moon-blade', ai: 'guard' }),
      enemy({ id: 'c2recruit', name: '艾琳', title: '白披肩剑士', team: 'enemy', class: 'sword', x: 6, y: 4, hp: 26, level: 3, stats: { maxHp: 26, strength: 10, skill: 7, speed: 8, luck: 5, defense: 7, resistance: 3 }, itemId: 'iron-sword', portrait: 2, ai: 'guard' }),
      enemy({ id: 'c2e1', name: '峡道重甲', title: '月蚀守卫', team: 'enemy', class: 'knight', x: 5, y: 5, hp: 22, level: 3, stats: { maxHp: 22, strength: 8, skill: 4, speed: 4, luck: 0, defense: 8, resistance: 2 }, itemId: 'iron-lance', portrait: 3, ai: 'alert', aiRange: 3 }),
      enemy({ id: 'c2e2', name: '暮鸦', title: '峡道斥候', team: 'enemy', class: 'raider', x: 3, y: 4, hp: 17, level: 3, stats: { maxHp: 17, strength: 7, skill: 5, speed: 9, luck: 2, defense: 3, resistance: 1 }, itemId: 'raider-blade', portrait: 3, ai: 'alert', aiRange: 5 }),
      enemy({ id: 'c2e3', name: '暮鸦', title: '峡道援兵', team: 'enemy', class: 'raider', x: 8, y: 4, hp: 17, level: 3, stats: { maxHp: 17, strength: 7, skill: 5, speed: 9, luck: 2, defense: 3, resistance: 1 }, itemId: 'raider-blade', portrait: 3, ai: 'support', aiRange: 2 }),
      enemy({ id: 'c2e4', name: '北坡斥候', title: '峡道巡逻兵', team: 'enemy', class: 'raider', x: 2, y: 0, hp: 17, level: 3, stats: { maxHp: 17, strength: 7, skill: 5, speed: 9, luck: 2, defense: 3, resistance: 1 }, itemId: 'raider-blade', portrait: 3, ai: 'alert', aiRange: 5 }),
      enemy({ id: 'c2e5', name: '祭坛术士', title: '覆面祭仪卫', team: 'enemy', class: 'mage', x: 5, y: 1, hp: 22, level: 3, stats: { maxHp: 22, strength: 8, skill: 6, speed: 6, luck: 1, defense: 3, resistance: 6 }, activeSpellId: 'starfire', spells: ['starfire'], portrait: 3, ai: 'support', aiRange: 3 }),
    ],
    rewards: ['silver-lance', 'star-charm'], unlocks: ['ashen-frontier'],
  },
};

// Optional encounters are deliberately outside main-story completion and unlock chains.
for (const [id, title, monster, name] of [
  ['moss-hollow', '苔灯林地', 'mossling', '苔灯灵'],
  ['tide-cove', '潮汐浅湾', 'tidecrab', '潮壳蟹'],
] as const) {
  chapters[id] = {
    id, title, order: 20, repeatable: true, subtitle: '初级讨伐 · 可反复挑战', intro: [],
    map: map('ggfggfgg', 'gggggggg', 'fggrrggf', 'gggrrggg', 'gggrrggg', 'gggggggg', 'gggggggg', 'gggggggg'),
    mission: { title: '击退三只魔物', turnLimit: 30, leaderId: 'kael', victoryMode: 'all', victory: [{ type: 'rout', label: '击败全部魔物' }] },
    deployment: [{ x: 2, y: 7 }, { x: 3, y: 7 }, { x: 4, y: 7 }, { x: 5, y: 7 }], maxSortie: 4,
    enemies: () => [[2, 2], [5, 2], [4, 0]].map(([x, y], index) => enemy({
      id: `${monster}-${index}`, name, title: monster === 'mossling' ? '林间魔物' : '浅湾魔物', team: 'enemy', class: monster,
      x, y, hp: monster === 'mossling' ? 12 : 14, level: index === 2 ? 2 : 1,
      stats: { maxHp: monster === 'mossling' ? 12 : 14, strength: 5, skill: 2, speed: 3, luck: 0, defense: monster === 'mossling' ? 1 : 3, resistance: 0 }, portrait: 3, ai: 'active',
    })), rewards: [], unlocks: [],
  };
}

export const chapterList = Object.values(chapters).filter(chapter => !chapter.repeatable).sort((a, b) => a.order - b.order);

// Preview access only. Remove this exception for the release prerequisite; it never grants story completion.
export function isChapterAvailable(chapterId: string, unlockedChapterIds: readonly string[]) {
  return !!chapters[chapterId]?.repeatable || chapterId === 'moonlit-pass' || unlockedChapterIds.includes(chapterId);
}
