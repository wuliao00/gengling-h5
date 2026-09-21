// battle.js — 《梗灵大陆》战斗状态机（无 DOM，board 依赖注入）
// 用法：new Battle(level, teamChars, board, rng)
//   teamChars: [{ id, name?, hp, atk, mult, skillLv, skill:{...}, passive:{...} }]（由 Meta.charPower + CHARACTERS 组装）
//   board:     core/Board 实例（测试可传 stub，实现同名原子操作）
//   rng:       { next(), int(n), pick(arr) }
// V2.2：逐角色 HP（state.members）+ Boss trait 技能系统 + turnEvents 回合事件流 + slotCounter

import { RESONANCES } from '../data/characters.js';
import { castSkill } from './skills.js';
import { ENEMY_SKILLS } from './enemy-skills.js';

function deepCopy(o) { return JSON.parse(JSON.stringify(o)); }

const FREE_ITEM_POOL = ['hammer', 'crossBomb', 'colorBottle', 'extraSteps', 'shield'];

// 梗之护盾分级减伤比例（与 data/items.js 的 shieldReduce 对应；battle 层按键名查表避免耦合）
const SHIELD_REDUCE = { shield: 0.5, shieldMini: 0.5, shieldMax: 0.7, shieldProMax: 0.85, shieldUltra: 1.0 };

// 敌人技能元数据与执行体见 enemy-skills.js（注册表），本文件只负责调度

export class Battle {
  constructor(level, teamChars, board, rng) {
    this.level = level;
    this.board = board;
    this.rng = rng;
    this.team = teamChars || [];
    // 局内词条加成（由 RunMode 随关卡注入）
    this.boons = Object.assign({ atk: 0, score: 0, cd: 0, shield: 0, slow: 0, resist: 0 }, level.boons || {});

    // ===== 逐角色 HP（V2.2，取代共享 HP）=====
    const members = this.team.map(c => ({
      id: c.id,
      name: c.name || c.id,
      hp: c.hp || 0,
      maxHp: c.hp || 0,
      fainted: false
    }));

    this.state = {
      members,                                // [{id, name, hp, maxHp, fainted}]
      hp: members.reduce((a, m) => a + m.hp, 0),     // 兼容保留 = Σ成员hp（血条兜底）
      maxHp: members.reduce((a, m) => a + m.maxHp, 0),
      shield: Math.max(0, Math.round(this.boons.shield || 0)),   // 兼容镜像 = shields.length
      shields: Array(Math.max(0, Math.round(this.boons.shield || 0))).fill(0.5),  // 护身符词条给开局护盾
      enemies: deepCopy(level.enemies || []).map(e => this._normalizeEnemy(e)),
      turn: 0,
      slotCounter: 0,     // V2.2：回合计数（老虎机 UI 每 5 回合触发）
      rowLocks: [],       // V2.2：被封锁行 [{row, turns}]（实际封锁由 UI 层执行）
      fogTurns: 0,        // V2.2：起雾剩余回合（UI 层渲染雾气）
      skillCds: Object.fromEntries(this.team.map(c => [c.id, 0])),
      convert: null,   // 面师傅变色的剩余回合（记录用）
      freeItem: null,  // 牛肉面套餐开场赠送道具
      logs: [],
      over: false,
      win: false
    };

    this.turnEvents = [];   // V2.2：本回合事件（endTurn 开头清空，UI 按此播动画）
    this._pendingEvents = []; // 清空前产生、需延后补发给 UI 的事件
    this._bossEvents = [];  // V2.2：Boss 技能对棋盘的操作事件（tornado/thunder/gust，UI 取用）
    this.betColor = null;   // V2.2：押注色（bet trait 触发后由 playerClearsColor 判定，一次性）

    this.movesUsed = 0;
    this.extraSteps = 0;   // extraSteps 道具累计步数（外部取用）
    this.targetIdx = 0;    // 锁定敌人索引（多敌人时默认第一个存活）
    this.timeLeft = null;  // timed 关剩余秒数

    const g = level.goal || {};
    if (level.type === 'timed' || g.kind === 'timed') {
      this.timeLeft = g.time != null ? g.time : 60;
    }

    // ===== 共鸣（队内角色 id 命中即生效）=====
    const ids = this.team.map(c => c.id);
    this.resonances = RESONANCES
      .filter(r => r.chars.every(ch => ids.includes(ch)))
      .map(r => r.id);

    // ===== 被动：小牛 teamBuff（队伍 ≥2 人时全队 ATK+%；小牛倒下后失效）=====
    this.atkBuff = 0;
    this._xiaoniuIdx = -1;
    const xnIdx = this.team.findIndex(c => c.id === 'xiaoniu');
    const xn = this.team[xnIdx];
    if (xn && xn.passive && xn.passive.effect === 'teamBuff' && this.team.length >= (xn.passive.minTeamSize || 2)) {
      const maxed = (xn.skillLv || 1) >= 10;
      this.atkBuff = maxLn(maxed, xn.passive) || 0.15;
      this._xiaoniuIdx = xnIdx;
    }

    // ===== 共鸣：牛肉面套餐 → 开战送 1 个随机道具 =====
    if (this.hasResonance('beefnoodle')) {
      const item = this.rng && this.rng.pick
        ? this.rng.pick(FREE_ITEM_POOL)
        : FREE_ITEM_POOL[Math.floor(Math.random() * FREE_ITEM_POOL.length)];
      this.state.freeItem = item;
      this.log(`共鸣【牛肉面套餐】：获得道具 ${item}×1`);
    }
  }

  log(msg) { this.state.logs.push(msg); }

  hasResonance(id) { return this.resonances.includes(id); }

  aliveEnemies() { return this.state.enemies.filter(e => e.hp > 0); }

  /** V2.2：存活的成员索引列表 */
  aliveMemberIdx() {
    return this.state.members.map((m, i) => (m.fainted ? -1 : i)).filter(i => i >= 0);
  }

  /** V2.2：按 id 判断队员是否倒下（被动失效判定用） */
  isFainted(id) {
    const i = this.team.findIndex(c => c.id === id);
    const m = i >= 0 ? this.state.members[i] : null;
    return !m || m.fainted;
  }

  /** 当前锁定目标（索引失效时回退到第一个存活敌人） */
  currentTarget() {
    const es = this.state.enemies;
    const t = es[this.targetIdx];
    if (t && t.hp > 0) return t;
    return es.find(e => e.hp > 0) || null;
  }
  setTarget(i) { this.targetIdx = i; }

  /** 队伍平均 ATK：只统计存活成员（含小牛 teamBuff 与自封之王 rage 临时加攻） */
  avgAtk() {
    const alive = this.aliveMemberIdx();
    if (!alive.length) return 0;
    let atk = alive.reduce((a, i) => a + (this.team[i] ? (this.team[i].atk || 0) : 0), 0) / alive.length;
    if (this.atkBuff && alive.includes(this._xiaoniuIdx)) atk *= 1 + this.atkBuff;
    atk *= 1 + this.rageBonus();
    atk *= 1 + (this.boons.atk || 0);   // 梗力爆发词条
    return atk;
  }

  /** 自封之王 rage：HP 低于阈值临时加攻（王者牧场共鸣阈值翻倍；倒下后被动失效） */
  rageBonus() {
    const zf = this.team.find(c => c.id === 'zifengzhiwang');
    if (!zf || this.isFainted('zifengzhiwang')) return 0;
    if (!zf.passive || zf.passive.effect !== 'rage') return 0;
    const s = this.state;
    if (s.maxHp <= 0) return 0;
    const pct = s.hp / s.maxHp; // 仍按共享 HP 比例（state.hp = Σ成员hp）
    let thresholds = (zf.passive.thresholds || [0.5, 0.25]).slice();
    if (this.hasResonance('kingranch')) thresholds = thresholds.map(t => t * 2);
    const maxed = (zf.skillLv || 1) >= 10;
    const v = maxed ? (zf.passive.maxValue != null ? zf.passive.maxValue : 0.80)
      : (zf.passive.value != null ? zf.passive.value : 0.30);
    if (pct < thresholds[1]) return v * 2; // 深度狂暴
    if (pct < thresholds[0]) return v;
    return 0;
  }

  /** V2.2：治疗所有存活成员各 n（全额，各自封顶 maxHp），并同步 state.hp */
  healPlayer(n) {
    const s = this.state;
    const amount = Math.round(n);
    if (amount <= 0 || s.hp <= 0) return 0;
    if (!s.members.length) { // 兼容无成员的遗留结构
      const healed = Math.min(s.maxHp, s.hp + amount) - s.hp;
      s.hp += healed;
      return healed;
    }
    let total = 0;
    for (const m of s.members) {
      if (m.fainted) continue;
      const before = m.hp;
      m.hp = Math.min(m.maxHp, m.hp + amount);
      total += m.hp - before;
    }
    s.hp = s.members.reduce((a, m) => a + m.hp, 0);
    return total;
  }

  /** 对锁定敌人造成伤害（V2.2：shell 期间受伤减半），返回实际伤害 */
  damageEnemy(dmg, source) {
    if (dmg <= 0 || this.state.over) return 0;
    const e = this.currentTarget();
    if (!e) return 0;
    let d = Math.round(dmg);
    if (e.shieldTurns > 0) d = Math.round(d / 2); // 缩壳减伤 50%
    d = this._passiveDamage(this.state.enemies.indexOf(e), e, d);  // 被动型技能（闪避等）
    const dealt = Math.min(e.hp, d);
    e.hp -= dealt;
    if (e.hp <= 0) {
      e.hp = 0;
      this.log(`${e.name} 被击败！（-${dealt}）`);
      this._deferEvent({ kind: 'enemyDown', enemy: this.state.enemies.indexOf(e), name: e.name });
    } else {
      this.log(`${e.name} 受到 ${dealt} 伤害（HP ${e.hp}/${e.maxHp}）`);
      // 阶段变化：跨过血量阈值换技能集（技能 phase 字段由 _scheduleSkills 过滤）
      if (e.phaseAt > 0 && e.phase === 1 && e.hp / e.maxHp <= e.phaseAt) {
        e.phase = 2;
        e.charging = null;
        for (const id in e.skillState) e.skillState[id] = { turn: 0, charge: 0 };
        this._deferEvent({ kind: 'enemyPhase', enemy: this.state.enemies.indexOf(e), phase: 2, name: e.name });
        this.log(`${e.name} 进入狂暴阶段！`);
      }
    }
    // 敌人全灭立即判胜
    const g = this.level.goal || {};
    if ((g.kind === 'enemy' || this.level.type === 'boss') && this.aliveEnemies().length === 0) {
      this.state.over = true;
      this.state.win = true;
      this.log('战斗胜利！');
    }
    return dealt;
  }

  /** V2.2：押注判定（main 在每次 moveResult 后调用）。
   *  命中 betColor → 锁定敌人回血 5%；未命中 → 锁定敌人受 500 伤。判定后 betColor 重置。 */
  playerClearsColor(color, n) {
    if (this.betColor == null || this.state.over) return null;
    const e = this.currentTarget();
    if (!e) return null;
    const enemyIdx = this.state.enemies.indexOf(e);
    const hit = color === this.betColor;
    const res = { kind: 'betResult', enemy: enemyIdx, hit, color, betColor: this.betColor };
    if (hit) {
      const heal = Math.round(e.maxHp * 0.05);
      e.hp = Math.min(e.maxHp, e.hp + heal);
      res.heal = heal;
      this.log(`押注命中（${color} 色）：${e.name} 回复 ${heal} HP`);
    } else {
      const dealt = this.damageEnemy(500, { source: 'bet' });
      res.dmg = dealt;
      this.log(`押注未命中（${color} ≠ ${this.betColor}）：${e.name} 受到 ${dealt} 伤害`);
    }
    this.betColor = null; // 需再次触发 bet trait 才会重押
    this.turnEvents.push(res);
    return res;
  }

  /** 敌人运行时字段归一化：技能列表 + 每技能独立节奏 + 阶段 */
  _normalizeEnemy(e) {
    return Object.assign({}, e, {
      maxHp: e.hp, stunned: 0, turnCount: 0,
      skills: (e.skills || []).map(sk => ({
        id: sk.id,
        every: sk.every ?? (ENEMY_SKILLS[sk.id]?.every ?? 3),
        param: sk.param || {},
        name: sk.name || null,
        charge: sk.charge || 0,
        phase: sk.phase || 0,
      })),
      skillState: {},
      charging: null,
      phase: 1,
      phaseAt: e.phaseAt || 0,
      shieldTurns: 0,
      atkBuff: 0, atkBuffTurns: 0,
    });
  }

  /** 召唤物工厂：与主敌人走同一归一化路径；spec 来自关卡数据时优先用 spec，小怪自带一个弱技能 */
  spawnMinion(tier = 0, spec = null) {
    const base = [800, 1400][tier] || 800, baseAtk = [100, 180][tier] || 100;
    const pool = ['dodge', 'fog', 'rockfall', 'curse'];
    const r = this.rng || { int: n => Math.floor(Math.random() * n) };
    return this._normalizeEnemy({
      name: (spec && spec.name) || ['小怪', '强化小怪'][tier] || '小怪',
      hp: (spec && spec.hp) || base, atk: (spec && spec.atk) || baseAtk,
      atkEvery: 1, summoned: true,
      skills: (spec && spec.skills) || [{ id: pool[r.int(pool.length)], every: 5 }],
    });
  }

  /** 技能调度：每技能独立计数；charge>0 的技能先预警再放大招；被震慑时整体暂停 */
  _scheduleSkills(ei, e) {
    if (e.stunned > 0) return;
    for (const sk of e.skills) {
      if (sk.phase && sk.phase !== e.phase) continue;
      const st = e.skillState[sk.id] || (e.skillState[sk.id] = { turn: 0, charge: 0 });
      const every = Math.max(1, sk.every + (this.boons.slow || 0));   // 看穿套路：拉长敌人技能周期
      if (st.charge > 0) {
        if (--st.charge === 0) { e.charging = null; this._castSkill(ei, e, sk, true); }
        else if (e.charging) e.charging.left = st.charge;
        continue;
      }
      st.turn++;
      if (sk.every <= 0 || st.turn % every !== 0) continue;
      if (sk.charge > 0) {
        st.charge = sk.charge;
        const nm = sk.name || ENEMY_SKILLS[sk.id]?.name || sk.id;
        e.charging = { skill: sk.id, name: nm, left: sk.charge, total: sk.charge };  // UI 蓄力条读它
        this.turnEvents.push({ kind: 'chargeStart', enemy: ei, skill: sk.id, turns: sk.charge, name: nm });
      } else {
        this._castSkill(ei, e, sk, false);
      }
    }
  }

  _castSkill(ei, e, sk, big) {
    const def = ENEMY_SKILLS[sk.id];
    if (!def || typeof def.cast !== 'function') return;
    const ctx = {
      state: this.state, board: this.board, rng: this.rng,
      enemy: e, enemyIdx: ei, param: sk.param, big,
      colors: this.level.colors || 6, resist: this.boons.resist || 0,
      bossEvents: this._bossEvents,
      pushEvent: ev => this.turnEvents.push(ev),
      log: m => this.log(m),
      // board 原子操作的返回形状历史上不统一（数组 或 {events}），在此归一，技能侧不必各自判断
      pushBoard: res => { this._bossEvents.push(...(Array.isArray(res) ? res : (res && res.events) || [])); },
      setBetColor: c => { this.betColor = c; },
      spawnMinion: (t, spec) => this.spawnMinion(t, spec),
    };
    if (def.cast(ctx) === false) return;   // 技能自行判定条件不满足 → 不记事件、不出声
    const name = sk.name || def.name || sk.id;
    this.turnEvents.push({ kind: 'bossSkill', enemy: ei, skill: sk.id, name, big });
    this.log(`${e.name} 发动【${name}】`);
  }

  /** 被动技能（如闪避）改写伤害 */
  _passiveDamage(ei, e, dmg) {
    let d = dmg;
    for (const sk of e.skills || []) {
      const def = ENEMY_SKILLS[sk.id];
      if (def && typeof def.onDamage === 'function') {
        const ctx = { state: this.state, board: this.board, rng: this.rng, enemy: e, enemyIdx: ei, param: sk.param, big: false, bossEvents: this._bossEvents, pushEvent: ev => this.turnEvents.push(ev), log: m => this.log(m), setBetColor: c => { this.betColor = c; }, spawnMinion: t => this.spawnMinion(t) };
        d = def.onDamage(ctx, d);
      }
    }
    return d;
  }

  /** 延后补发：这些事件产生于 endTurn 清空 turnEvents 之前，直接 push 会被抹掉 */
  _deferEvent(ev) { this._pendingEvents.push(ev); }

  /** 诅咒格反噬：每格使锁定敌人回复 1% 最大血 */
  onCurseClear(n) {
    const e = this.currentTarget();
    if (!e || e.hp <= 0 || !(n > 0)) return;
    const heal = Math.round(e.maxHp * 0.01 * n);
    if (heal <= 0) return;
    e.hp = Math.min(e.maxHp, e.hp + heal);
    this._deferEvent({ kind: 'curseHit', enemy: this.state.enemies.indexOf(e), n, heal });
    this.log(`诅咒方块反噬：${e.name} 回复 ${heal} HP`);
  }

  /** V2.2：随机挑选一名存活成员（返回 alive 列表中的下标） */
  pickTarget(alive) {
    if (this.rng && this.rng.int) return this.rng.int(alive.length);
    return Math.floor(Math.random() * alive.length);
  }

  /** 统计一次 moveResult 消除的方块数（match/bomb/rainbow 事件） */
  static countCleared(moveResult) {
    if (!moveResult) return 0;
    let n = 0;
    if (Array.isArray(moveResult.events)) {
      for (const ev of moveResult.events) {
        if (ev.type === 'match' && Array.isArray(ev.cells)) n += ev.cells.length;
        else if ((ev.type === 'bomb' || ev.type === 'rainbow') && Array.isArray(ev.cleared)) n += ev.cleared.length;
      }
    }
    if (n === 0 && moveResult.matchedCounts) {
      n = Object.values(moveResult.matchedCounts).reduce((a, b) => a + b, 0);
    }
    return n;
  }

  /**
   * 每次玩家有效交换后调用：
   * 消除伤害 → CD 递减 → 被动结算 → 敌人行动 → 胜负判定
   */
  onMoveResult(moveResult) {
    if (this.state.over) return { damage: 0, cleared: 0 };
    this.movesUsed++;

    const cleared = Battle.countCleared(moveResult);
    // 诅咒格反噬：消除含诅咒格使锁定敌人回血
    for (const ev of (moveResult && moveResult.events) || []) {
      if (ev.type === 'curseHit') this.onCurseClear(ev.n);
    }
    const moves = moveResult ? (moveResult.moves || 0) : 0;
    // 伤害 = 消除数 × 队伍平均ATK × 0.5 × (1 + 0.15×连锁数)；猫狗双全 +10%
    let dmg = 0;
    if (cleared > 0) {
      dmg = Math.round(cleared * this.avgAtk() * 0.5 * (1 + 0.15 * moves));
      if (this.hasResonance('catdog')) dmg = Math.round(dmg * 1.1);
      this.damageEnemy(dmg, { source: 'match' });
    }

    this.endTurn();
    return { damage: dmg, cleared, over: this.state.over, win: this.state.win };
  }

  /** 回合收尾：turnEvents 清空 → CD/行锁/雾递减 → 被动结算 → 敌人行动（trait+攻击）→ 胜负判定 */
  endTurn() {
    const s = this.state;
    this.turnEvents = []; // V2.2：每回合开头清空
    if (this._pendingEvents && this._pendingEvents.length) {   // 本回合产生于清空之前的事件补入，UI 才收得到
      this.turnEvents.push(...this._pendingEvents);
      this._pendingEvents = [];
    }
    s.turn++;
    s.slotCounter = (s.slotCounter || 0) + 1; // V2.2：回合计数 +1

    // 技能 CD 递减
    for (const k of Object.keys(s.skillCds)) {
      s.skillCds[k] = Math.max(0, s.skillCds[k] - 1);
    }

    // 面师傅变色持续回合递减
    if (s.convert) {
      s.convert.turns--;
      if (s.convert.turns <= 0) s.convert = null;
    }

    // V2.2：行封锁 / 雾 回合递减（回合开始时扣减，本回合新触发的效果完整持续）
    if (Array.isArray(s.rowLocks) && s.rowLocks.length) {
      for (const lk of s.rowLocks) lk.turns--;
      s.rowLocks = s.rowLocks.filter(lk => lk.turns > 0);
    }
    if (s.fogTurns > 0) s.fogTurns--;

    // 被动：哈基喵每 3 回合回 5% HP（倒下后失效）
    const hj = this.team.find(c => c.id === 'hajimiao');
    if (hj && !this.isFainted('hajimiao') && hj.passive && hj.passive.effect === 'heal'
      && s.turn % 3 === 0 && s.hp > 0 && s.hp < s.maxHp) {
      const maxed = (hj.skillLv || 1) >= 10;
      const pct = maxed && hj.passive.maxValue != null ? hj.passive.maxValue : hj.passive.value;
      const healed = this.healPlayer(s.maxHp * pct);
      if (healed > 0) {
        this.turnEvents.push({ kind: 'heal', amount: healed, name: hj.passive.name, by: 'hajimiao' });
        this.log(`哈基喵被动【${hj.passive.name}】：全队回复 ${healed} HP`);
      }
    }

    // 共鸣：暖胃猫每回合回 8% HP
    if (this.hasResonance('warmcat') && s.hp > 0 && s.hp < s.maxHp) {
      const healed = this.healPlayer(s.maxHp * 0.08);
      if (healed > 0) this.turnEvents.push({ kind: 'heal', amount: healed, name: '暖胃猫', by: 'warmcat' });
    }

    // 敌人行动
    for (let ei = 0; ei < s.enemies.length; ei++) {
      const e = s.enemies[ei];
      if (e.hp <= 0) continue;
      if (e.stunned > 0) {
        e.stunned--;
        for (const id in e.skillState) e.skillState[id].charge = 0;   // 震慑打断蓄力
        e.charging = null;
        this.log(`${e.name} 被震慑，无法行动`);
        continue;
      }

      // V2.2：自身护盾 / 攻击 buff 持续回合递减（自己回合开始时）
      if (e.shieldTurns > 0) e.shieldTurns--;
      if (e.atkBuffTurns > 0) {
        e.atkBuffTurns--;
        if (e.atkBuffTurns <= 0) e.atkBuff = 0;
      }

      e.turnCount++;

      this._scheduleSkills(ei, e);

      // 攻击：随机命中一名存活成员，伤害 = atk×(1+atkBuff||0)；护盾按分级减伤
      if (e.turnCount % (e.atkEvery || 1) === 0) {
        const dmg = Math.round((e.atk || 0) * (1 + (e.atkBuff || 0)));
        const alive = s.members.map((m, i) => ({ m, i })).filter(x => !x.m.fainted);
        if (dmg > 0 && alive.length > 0) {
          // 护盾减伤：优先消耗 shields 队列（分级），兼容旧 state.shield 计数（视为全额格挡）
          let reduce = 0;
          if (Array.isArray(s.shields) && s.shields.length) { reduce = s.shields.shift(); s.shield = s.shields.length; }
          else if (s.shield > 0) { reduce = 1; s.shield--; }
          const realDmg = reduce >= 1 ? 0 : Math.round(dmg * (1 - reduce));
          if (realDmg <= 0) {
            this.turnEvents.push({ kind: 'enemyAttack', enemy: ei, target: -1, dmg: 0, blocked: true, reduce });
            this.log(`梗之护盾完全抵消了 ${e.name} 的攻击！`);
          } else {
            const t = this.pickTarget(alive);
            const m = alive[t].m;
            m.hp = Math.max(0, m.hp - realDmg);
            this.turnEvents.push({ kind: 'enemyAttack', enemy: ei, target: alive[t].i, dmg: realDmg, shielded: reduce > 0, reduce });
            this.log(`${e.name} 对 ${m.name} 造成 ${realDmg} 伤害${reduce > 0 ? `（护盾减伤${Math.round(reduce * 100)}%）` : ''}`);
            if (m.hp <= 0) {
              m.fainted = true;
              this.turnEvents.push({ kind: 'memberFainted', idx: alive[t].i });
              this.log(`${m.name} 倒下了！`);
            }
            s.hp = s.members.reduce((a, mm) => a + mm.hp, 0); // 同步共享 HP
          }
        }
      }
    }

    // 胜负判定
    if (s.hp <= 0 || (s.members.length > 0 && s.members.every(m => m.fainted))) {
      s.hp = 0;
      s.over = true;
      s.win = false;
      this.log('队伍战败……');
    } else {
      const g = this.level.goal || {};
      if (g.kind === 'enemy' && this.aliveEnemies().length === 0) {
        s.over = true;
        s.win = true;
        this.log('战斗胜利！');
      }
    }
  }

  /** 释放技能：倒下/CD 检查 → skills.js 执行 → 大狗旺震慑被动 → 敌人行动 */
  useSkill(charIdx) {
    if (this.state.over) return { ok: false, reason: 'over' };
    const ch = this.team[charIdx];
    if (!ch) return { ok: false, reason: 'noChar' };
    const mem = this.state.members[charIdx];
    if (mem && mem.fainted) return { ok: false, reason: 'fainted' }; // V2.2：倒下成员不可施放
    if ((this.state.skillCds[ch.id] || 0) > 0) return { ok: false, reason: 'cd', cdLeft: this.state.skillCds[ch.id] };

    const ctx = { board: this.board, battle: this, rng: this.rng, events: [] };
    const r = castSkill(ch, ctx);

    // 被动：大狗旺技能后 40%（满级 65%）震慑锁定敌人 1 回合
    let stunnedName = null;
    if (ch.id === 'dasangwang' && ch.passive && ch.passive.effect === 'chanceStun') {
      const maxed = (ch.skillLv || 1) >= 10;
      const p = maxed && ch.passive.maxValue != null ? ch.passive.maxValue : ch.passive.value;
      if (this.rng.next() < p) {
        const t = this.currentTarget();
        if (t) {
          t.stunned += ch.passive.stunTurns || 1;
          stunnedName = t.name;
          this.log(`大狗旺震慑了 ${t.name}！`);
        }
      }
    }

    this.endTurn(); // 敌人行动 + 胜负判定

    // 技能 CD（天空之猫共鸣 CD-1，最低 1）；在 endTurn 之后赋值避免被本回合递减
    const baseCd = (ch.skill && ch.skill.cd) || 4;
    const cd = Math.max(1, baseCd - (this.hasResonance('skycat') ? 1 : 0) - (this.boons.cd || 0));
    this.state.skillCds[ch.id] = cd;
    return { ok: true, damage: r.damage, wheel: r.wheel, events: ctx.events, score: ctx.score || 0, matchedCounts: ctx.matchedCounts || {}, stunned: stunnedName };
  }

  /** 战斗内道具（库存扣减由外部/Meta 处理）。board 原子操作返回 MoveResult，取其 events。 */
  useItem(item, target, opts = {}) {
    // V5：返回 {events, score, matchedCounts}，让道具清除也计入关卡目标进度
    const out = { events: [], score: 0, matchedCounts: {} };
    const acc = (r) => {
      const mr = Array.isArray(r) ? { events: r } : r;
      if (!mr) return;
      if (Array.isArray(mr.events)) out.events.push(...mr.events);
      out.score += mr.score || 0;
      for (const [k, v] of Object.entries(mr.matchedCounts || {})) out.matchedCounts[k] = (out.matchedCounts[k] || 0) + v;
    };
    switch (item) {
      case 'hammer': // 消除指定 1 个方块
        if (!target) return null;
        acc(this.board.clearCells([target]));
        break;
      case 'crossBomb': // 指定方块所在行列
        if (!target) return null;
        acc(this.board.clearRow(target.r));
        acc(this.board.clearCol(target.c));
        break;
      case 'colorBottle': // 全场 from 色 → to 色
        acc(this.board.convertColor(opts.from, opts.to));
        break;
      case 'extraSteps': // 额外 5 步（外部步数 + battle 记录）
        this.extraSteps += 5;
        this.log('使用额外5步：步数 +5');
        break;
      case 'shield': case 'shieldMini': case 'shieldMax': case 'shieldProMax': case 'shieldUltra': {
        // 梗之护盾：入队一个减伤比例，受击时消耗（取代旧版"完全格挡"）
        const reduce = SHIELD_REDUCE[item] != null ? SHIELD_REDUCE[item] : 0.5;
        this.state.shields.push(reduce);
        this.state.shield = this.state.shields.length;
        this.log(reduce >= 1 ? '获得梗之护盾·Ultra（完全格挡）' : `获得梗之护盾（减伤${Math.round(reduce * 100)}%）`);
        break;
      }
      default:
        return null;
    }
    return out;
  }

  /** 战斗内"输出型"道具（锤子/十字炸弹/颜色转换瓶）：
   *  清除方块 → 按消除数对锁定敌人造成伤害（与 onMoveResult 同源公式）→ 推进回合（敌人行动）。
   *  修复旧版"道具对怪物无作用、不算一回合"；不消耗步数（movesUsed/extraSteps 不变）。 */
  useItemCombat(item, target, opts = {}) {
    const ir = this.useItem(item, target, opts) || { events: [], score: 0, matchedCounts: {} };
    const cleared = Battle.countCleared(ir);
    let damage = 0;
    if (cleared > 0 && !this.state.over) {
      damage = Math.round(cleared * this.avgAtk() * 0.5);
      if (this.hasResonance('catdog')) damage = Math.round(damage * 1.1);
      this.damageEnemy(damage, { source: 'item' });
    }
    if (!this.state.over) this.endTurn(); // 道具也算一回合：敌人行动 + CD/行锁递减 + 胜负判定
    return { events: ir.events, score: ir.score, matchedCounts: ir.matchedCounts, damage, cleared, over: this.state.over, win: this.state.win };
  }

  /** timed 关计时推进（外部每秒/每帧调用） */
  tickTime(sec) {
    if (this.state.over) return;
    if (this.timeLeft == null) return;
    this.timeLeft = Math.max(0, this.timeLeft - sec);
    if (this.timeLeft <= 0) {
      this.state.over = true;
      this.state.win = false;
      this.log('时间到！');
    }
  }

  /**
   * 外部根据 moveResult 的 matchedCounts/score 判断目标进度。
   * 返回 true 时 battle.over=true, win=true。
   * progress 形如 { matchedCounts:{color:n}, collected:n, score:n, count:n }
   */
  checkGoal(progress = {}) {
    if (this.state.over) return this.state.win;
    const g = this.level.goal || {};
    let ok = false;
    switch (g.kind) {
      case 'enemy':
        ok = this.aliveEnemies().length === 0;
        break;
      case 'collect': {
        if (g.color != null) {
          ok = ((progress.matchedCounts && progress.matchedCounts[g.color]) || 0) >= g.count;
        } else if (progress.collected != null) {
          ok = progress.collected >= g.count;
        } else if (progress.matchedCounts) {
          ok = Object.values(progress.matchedCounts).reduce((a, b) => a + b, 0) >= g.count;
        }
        break;
      }
      case 'score':
      case 'timed':
        ok = (progress.score || 0) >= (g.score != null ? g.score : (g.count || 0));
        break;
      default: {
        // fourMatch/fiveMatch/bombClear/chainClear 等计数型目标
        if (progress.count != null && g.count != null) ok = progress.count >= g.count;
        else if (progress.score != null && g.score != null) ok = progress.score >= g.score;
        break;
      }
    }
    if (ok) {
      this.state.over = true;
      this.state.win = true;
      this.log('目标达成，战斗胜利！');
    }
    return ok;
  }

  /** 剩余步数 */
  remainingSteps() {
    return Math.max(0, (this.level.steps || 0) + this.extraSteps - this.movesUsed);
  }

  /** 星级评价：剩余步数 ≥5→3星, 2-4→2星, 1→1星；timed 关按剩余时间百分比 */
  stars() {
    const g = this.level.goal || {};
    if (this.level.type === 'timed' || g.kind === 'timed') {
      const total = g.time || 60;
      const pct = total > 0 ? this.timeLeft / total : 0;
      return pct >= 0.5 ? 3 : pct >= 0.2 ? 2 : 1;
    }
    const left = this.remainingSteps();
    return left >= 5 ? 3 : left >= 2 ? 2 : 1;
  }
}

// 小工具：被动取值（普通值 / 满级值）
function maxLn(maxed, passive) {
  if (!passive) return 0;
  if (maxed && passive.maxValue != null) return passive.maxValue;
  return passive.value != null ? passive.value : 0;
}
