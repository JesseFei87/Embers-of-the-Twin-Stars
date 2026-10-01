import type { StrikeView } from '../contracts';

// All six shipped poses keep the existing feet pivot; release is pose 4.
export function combatVisual(event: StrikeView) {
  if (event.magical) return { style: event.abilityId === 'thunder' ? 'lightning' : 'spell', windup: .42, travel: .3, recovery: .42,
    color: event.abilityId === 'starfire' ? 0xffbc67 : event.abilityId === 'thunder' ? 0xb2a6ff : 0xa6ffe5, approach: 0 };
  const styles = {
    mossling: { style: 'bash', windup: .3, travel: .2, recovery: .35, color: 0xd5e687, approach: .42 },
    tidecrab: { style: 'slash', windup: .26, travel: .16, recovery: .32, color: 0x8de1dc, approach: .48 },
    sword: { style: 'slash', windup: .23, travel: .17, recovery: .3, color: 0xffe6b0, approach: .54 },
    lancer: { style: 'thrust', windup: .3, travel: .16, recovery: .3, color: 0xaff7e6, approach: .5 },
    cavalry: { style: 'charge', windup: .32, travel: .26, recovery: .38, color: 0xffd693, approach: .7 },
    knight: { style: 'bash', windup: .4, travel: .19, recovery: .4, color: 0xd9c4ff, approach: .38 },
    raider: { style: 'slash', windup: .17, travel: .12, recovery: .24, color: 0xff8fbd, approach: .6 },
    mage: { style: 'thrust', windup: .3, travel: .2, recovery: .3, color: 0xa6ffe5, approach: .3 },
  };
  return styles[event.sprite];
}
