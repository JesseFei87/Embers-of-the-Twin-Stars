import { equipment } from './equipment';

export interface UtilityItem {
  id: string;
  name: string;
  description: string;
  kind: 'healing' | 'special';
  heal?: number;
  avoid?: number;
  consumable: boolean;
}

export const utilityItems: Record<string, UtilityItem> = {
  'healing-draught': { id: 'healing-draught', name: '圣泉药', description: '使用后恢复 10 HP。', kind: 'healing', heal: 10, consumable: true },
  'star-charm': { id: 'star-charm', name: '星之护符', description: '携带时回避 +10。', kind: 'special', avoid: 10, consumable: false },
};

export const itemName = (id?: string) => id ? equipment[id]?.name ?? utilityItems[id]?.name ?? id : '无';
export const itemDescription = (id?: string) => id ? utilityItems[id]?.description ?? (equipment[id] ? `威力 ${equipment[id].might} / 命中 ${equipment[id].hit} / 重量 ${equipment[id].weight}` : '') : '不携带物品';
export const itemAvoid = (id?: string) => id ? utilityItems[id]?.avoid ?? 0 : 0;
