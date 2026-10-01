import type { Unit } from '../data/types';

/** Presentation-only identities; old saves keep their original portrait IDs. */
export function portraitIndex(unit: Pick<Unit, 'id' | 'portrait'>): number {
  if (unit.id === 'c2recruit') return 6;
  if (unit.id === 'c2boss') return 7;
  if (unit.id === 'c2e5') return 8;
  return unit.portrait;
}

export const characterNotes: Record<string, string> = {
  kael: '在烽火中选择守护的年轻剑士。沉稳而坚定，把同伴的安危放在荣耀之前。',
  lyra: '温柔的星辉骑士。相信祈祷与勇气能跨越长夜，策马奔赴需要她的伙伴身边。',
  mira: '苍林出身的枪卫。寡言、冷静，习惯先观察地形，再为队伍找到前进的道路。',
  e2: '机敏的年轻斥候。玩笑掩藏着戒备；看似轻快的脚步，始终在寻找真正值得信任的人。',
  c2recruit: '赤褐长辫、白披肩的守关剑士。谨慎却不冷漠，拔剑守护不愿向献祭妥协的良知。',
  c2boss: '骄傲而冷峻的月蚀女巫。将情绪藏在平静的目光后，让雷光替她宣示意志。',
};
