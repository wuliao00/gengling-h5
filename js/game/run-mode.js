// run-mode.js — 波次闯关的共用状态机：无尽模式（肉鸽词条）与 Boss Rush 共用一套机器。
// 只负责"下一关怎么生成 / 词条怎么发 / 纪录怎么算"，表现层（弹窗、音效、渲染）留给 Game 与 Scenes。

import { BOONS, BOON_BY_ID } from '../data/boons.js';
import { LEVELS } from '../data/levels.js';
import { Meta } from './meta.js';

const BOSS_RUSH_HERO = 1.6;          // Boss Rush 血量倍率
const ENDLESS_HEAL = 0.2;            // 无尽波间基础回复

export class RunMode {
  constructor(game, mode = 'endless') {
    this.game = game;
    this.mode = mode;
    this.wave = 0;
    this.boons = {};                 // id → 已选层数（局内，不入档）
    this.goldEarned = 0;
    this.candyEarned = 0;
    this.revivesLeft = 0;
  }

  get isBossRush() { return this.mode === 'bossrush'; }
  get totalWaves() { return this.isBossRush ? 8 : Infinity; }
  get finished() { return this.wave >= this.totalWaves; }

  stacks(id) { return this.boons[id] || 0; }
  /** 本局已选强化的可读摘要 */
  boonSummary() {
    return Object.entries(this.boons)
      .map(([id, n]) => { const b = BOON_BY_ID[id]; return b ? `${b.name}×${n}` : null; })
      .filter(Boolean).join('、');
  }
  // 某类词条的累计增益（未选则为 0）
  bonus(kind) {
    let v = 0;
    for (const b of BOONS) if (b.kind === kind) v += b.per * this.stacks(b.id);
    return v;
  }
  // 供 battle 读取的生效快照
  boonMap() {
    return {
      atk: this.bonus('atk'), score: this.bonus('score'), steps: this.bonus('steps'),
      cd: this.bonus('cd'), shield: this.bonus('shield'), slow: this.bonus('slow'),
      resist: this.bonus('resist'),
    };
  }

  rollChoices(n = 3) {
    const pool = BOONS.filter(b => this.stacks(b.id) < b.max);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, Math.min(n, pool.length));
  }

  pick(id) {
    const b = BOON_BY_ID[id];
    if (!b || this.stacks(id) >= b.max) return false;
    this.boons[id] = this.stacks(id) + 1;
    if (b.kind === 'revive') this.revivesLeft += 1;
    return true;
  }

  /** 第 wave 波关卡（Boss Rush 取各章 Boss 强化版；无尽走原曲线） */
  levelFor(wave) {
    return this.isBossRush ? this._bossRushLevel(wave) : this.game._endlessLevel(wave);
  }

  _bossRushLevel(idx) {
    const chapter = idx;                       // 1..8 章各取一个 Boss 关
    const src = LEVELS.find(l => l.chapter === chapter && (l.type === 'boss' || l.boss))
      || LEVELS.find(l => l.chapter === chapter && l.boss);
    if (!src) return this.game._endlessLevel(idx);
    return {
      ...src,
      id: 9100 + idx,
      name: `Boss Rush · 第${idx}场 ${src.name}`,
      steps: (src.steps || 20) + 6,
      boons: this.boonMap(),
      enemies: (src.enemies || []).map(e => ({
        ...JSON.parse(JSON.stringify(e)),
        hp: Math.round(e.hp * BOSS_RUSH_HERO),
        maxHp: Math.round(e.hp * BOSS_RUSH_HERO),
        atk: Math.round((e.atk || 0) * 1.15),
        phaseAt: e.phaseAt || 0.5,
      })),
    };
  }

  /** 一波通关：发金币（+糖果），写纪录 */
  onWaveCleared(wave) {
    const goldBase = this.isBossRush ? 100 + wave * 40 : 30 + wave * 5;
    const gold = Math.round(goldBase * (1 + this.bonus('gold')));
    const candy = Math.round(this.bonus('candy'));
    this.goldEarned += gold;
    this.candyEarned += candy;
    const s = Meta.get();
    Meta.addGold(gold);
    if (candy) s.items.candyS = (s.items.candyS || 0) + candy;
    const best = this._persistBest(wave);
    Meta.persist();
    return { gold, candy, best };
  }

  /** 本局结束：写纪录并给出结算数据 */
  onRunFailed(wave) {
    const best = this._persistBest(wave);
    Meta.persist();
    return { wave, best, goldEarned: this.goldEarned, candyEarned: this.candyEarned, mode: this.mode };
  }

  _persistBest(wave) {
    const s = Meta.get();
    const key = this.isBossRush ? 'bossRushBest' : 'endlessBest';
    const best = Math.max(wave, s.progress[key] || 0);
    s.progress[key] = best;
    if (this.isBossRush && wave >= 8 && !s.progress.bossRushCrown) {
      s.progress.bossRushCrown = true;
      Meta.addGold(1500);
      this.goldEarned += 1500;
    }
    return best;
  }

  /** 波间回复比例（奶一口词条可叠加） */
  get healRate() { return ENDLESS_HEAL + this.bonus('heal'); }
}
