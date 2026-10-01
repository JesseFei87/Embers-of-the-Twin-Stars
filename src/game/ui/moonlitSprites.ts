/** Identity-based art stays attached when a unit changes team or promotes. */
export const moonlitSpriteKeys = ['eileen', 'altar-mage'] as const;
export type MoonlitSpriteKey = typeof moonlitSpriteKeys[number];

export function moonlitSpriteKey(id: string): MoonlitSpriteKey | undefined {
  if (id === 'c2recruit') return 'eileen';
  if (id === 'c2e5') return 'altar-mage';
  return undefined;
}
