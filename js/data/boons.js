// boons.js — 肉鸽词条池（局内生效，重开清空）。kind 决定在 battle/run 的哪一处生效。
export const BOONS = [
  { id: 'atk',    name: '梗力爆发', desc: '队伍攻击 +15%',     per: 0.15, max: 3, kind: 'atk' },
  { id: 'shield', name: '护身符',   desc: '开局多 1 层护盾',   per: 1,    max: 3, kind: 'shield' },
  { id: 'steps',  name: '再多一步', desc: '每波步数 +2',       per: 2,    max: 5, kind: 'steps' },
  { id: 'cd',     name: '熟练度',   desc: '主动技能 CD -1',    per: 1,    max: 2, kind: 'cd' },
  { id: 'score',  name: '梗值翻倍', desc: '消除加分 +10%',     per: 0.10, max: 3, kind: 'score' },
  { id: 'heal',   name: '奶一口',   desc: '波间回复 +15%',     per: 0.15, max: 2, kind: 'heal' },
  { id: 'revive', name: '复活币',   desc: '倒下可再起 1 次',   per: 1,    max: 1, kind: 'revive' },
  { id: 'hammer', name: '铁匠铺',   desc: '每波发 1 把锤子',   per: 1,    max: 2, kind: 'hammer' },
  { id: 'slow',   name: '看穿套路', desc: '敌人技能周期 +1',   per: 1,    max: 2, kind: 'slow' },
  { id: 'resist', name: '解咒师',   desc: '行锁/诅咒持续 -1',  per: 1,    max: 2, kind: 'resist' },
  { id: 'gold',   name: '生意兴隆', desc: '金币收益 +25%',     per: 0.25, max: 2, kind: 'gold' },
  { id: 'candy',  name: '糖果批发', desc: '每波通关糖果 +1',   per: 1,    max: 2, kind: 'candy' },
];

export const BOON_BY_ID = Object.fromEntries(BOONS.map(b => [b.id, b]));
