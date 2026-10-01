export interface SpellLearningEntry { level: number; spellId: string }

export const spellLearning: Record<string, SpellLearningEntry[]> = {
  lyra: [
    { level: 2, spellId: 'seraphim' },
    { level: 4, spellId: 'physic' },
    { level: 6, spellId: 'thunder' },
  ],
};
