import type { Stats, Unit } from './types';

export interface RecruitmentRule {
  targetId: string;
  recruiterIds: string[];
  lastTurn: number;
  recruitedTitle: string;
  success: Array<{ speakerId: string; text: string }>;
  refusal: Array<{ speakerId: string; text: string }>;
  lateRefusal: Array<{ speakerId: string; text: string }>;
  recruitedGrowths?: Stats;
}

export const recruitmentRules: Record<string, RecruitmentRule> = {
  e2: {
    targetId: 'e2', recruiterIds: ['kael'], lastTurn: 10, recruitedTitle: '晨雾游侠',
    success: [
      { speakerId: 'kael', text: '你一直避开村民。你并不认同蚀月军，对吗？' },
      { speakerId: 'e2', text: '……他们挟持了我的家人。若你真能打破封锁，我愿替你带路。' },
      { speakerId: 'kael', text: '加入我们。先夺下星落桥，再一起救出他们。' },
    ],
    refusal: [
      { speakerId: 'e2', text: '我只和能为这支队伍负责的人谈。让凯尔来见我。' },
    ],
    lateRefusal: [
      { speakerId: 'e2', text: '太迟了……蚀月军已经把我的家人转移。我不能再拿他们冒险。' },
    ],
  },
  c2recruit: {
    targetId: 'c2recruit', recruiterIds: ['lyra'], lastTurn: 12, recruitedTitle: '誓月剑士',
    success: [
      { speakerId: 'lyra', text: '你的剑一直避开要害。你也在等待离开月蚀军的机会吧？' },
      { speakerId: 'c2recruit', text: '我守在这里，只为阻止女巫继续献祭峡谷中的人。让我与你们并肩。' },
    ],
    refusal: [{ speakerId: 'c2recruit', text: '让那位圣职者来。我只相信能听见亡者祈祷的人。' }],
    lateRefusal: [{ speakerId: 'c2recruit', text: '献祭已经开始……我必须独自守住这里，不能再离开。' }],
    recruitedGrowths: { maxHp: 50, strength: 40, skill: 35, speed: 35, luck: 30, defense: 30, resistance: 15 },
  },
};

export function recruitmentRuleFor(target: Unit) { return recruitmentRules[target.id]; }

export function canRecruit(recruiter: Unit, target: Unit, turn: number) {
  const rule = recruitmentRuleFor(target);
  return !!rule && rule.recruiterIds.includes(recruiter.id) && turn <= rule.lastTurn;
}
