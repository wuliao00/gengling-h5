// enemy-skills.js — 敌人技能注册表
// 引擎（battle.js）只负责调度：到周期 → 查表 → 执行 → 产出事件；新机制在此注册，不改调度。
// ctx: { state, board, rng, enemy, enemyIdx, param, big, pushEvent, log, pushBoard, setBetColor, spawnMinion }
// 约定：cast 返回 false 表示"条件不满足，本次不发动"（不记事件、不出声）

export const ENEMY_SKILLS = {
  shell: {
    name: '缩壳', every: 3,
    cast(ctx) { ctx.enemy.shieldTurns = Math.max(1, (ctx.param.turns ?? 1) - (ctx.resist || 0)); },
  },
  rockfall: {
    name: '落石', every: 3,
    cast(ctx) {
      const rows = (ctx.param.rows ?? 1) + (ctx.big ? 1 : 0);
      const turns = Math.max(1, (ctx.param.turns ?? 3) + (ctx.big ? 2 : 0) - (ctx.resist || 0));
      for (let i = 0; i < rows; i++) ctx.state.rowLocks.push({ row: ctx.rng.int(8), turns });
    },
  },
  noise: {
    name: '噪音波', every: 3,
    cast(ctx) {
      const rows = (ctx.param.rows ?? 2) + (ctx.big ? 1 : 0);
      const turns = Math.max(1, (ctx.param.turns ?? 1) + (ctx.big ? 1 : 0) - (ctx.resist || 0));
      const r1 = ctx.rng.int(8);
      for (let i = 0; i < rows; i++) {
        const row = i === 0 ? r1 : (r1 + 1 + ctx.rng.int(7)) % 8;
        ctx.state.rowLocks.push({ row, turns });
      }
    },
  },
  tornado: {
    name: '龙卷风', every: 3,
    cast(ctx) {
      const r = ctx.rng.int(8), c = ctx.rng.int(8), rad = ctx.big ? 2 : (ctx.param.radius ?? 1);
      ctx.pushBoard(ctx.board.clearArea?.(r, c, rad));
    },
  },
  thunder: {
    name: '雷击', every: 3,
    cast(ctx) {
      const r = ctx.rng.int(8), c = ctx.rng.int(8), rad = ctx.big ? 2 : (ctx.param.radius ?? 1);
      ctx.pushBoard(ctx.board.clearArea?.(r, c, rad));
    },
  },
  gust: {
    name: '卷风', every: 3,
    cast(ctx) { ctx.pushBoard(ctx.board.shuffleAll?.()); },
  },
  fog: {
    name: '起雾', every: 3,
    cast(ctx) { ctx.state.fogTurns = ctx.param.turns ?? 2; },
  },
  bet: {
    name: '押注', every: 3,
    // 固定 6 色：与既有押注判定一致（棋盘颜色少于 6 时，押到不存在的颜色即玩家必中，属既有行为）
    cast(ctx) { ctx.setBetColor(ctx.rng.int(6)); },
  },
  sub_convert: {
    name: '子化', every: 3,
    cast(ctx) {
      const n = ctx.param.count ?? 3;
      ctx.pushBoard(ctx.board.setSub?.(ctx.board.randomCells(n)));
    },
  },
  allin: {
    name: '全押', every: 3,
    cast(ctx) {
      const e = ctx.enemy, at = ctx.param.atHpPct ?? 0.4;
      if (e.maxHp > 0 && e.hp / e.maxHp < at && !(e.atkBuffTurns > 0)) {
        e.atkBuff = ctx.param.mult ?? 1;
        e.atkBuffTurns = ctx.param.dur ?? 3;
      }
    },
  },
  summon: {
    name: '召唤', every: 3,
    // param.count / param.minion 来自关卡数据（此前引擎一律忽略，按 generic 小怪处理）
    cast(ctx) {
      const p = ctx.param;
      // 关卡数据可用 atHpPct 表示"血量低于此比例才召唤"（峡谷领主即如此描述）
      if (p.atHpPct && ctx.enemy.hp / ctx.enemy.maxHp > p.atHpPct) return false;
      const n = Math.max(1, p.count ?? 1);
      for (let i = 0; i < n; i++) {
        if (ctx.state.enemies.length >= 4) break;
        ctx.state.enemies.push(ctx.spawnMinion(0, ctx.param.minion));
      }
    },
  },
  minions: {
    name: '群唤', every: 5,
    cast(ctx) {
      for (let i = 0; i < 2; i++) {
        if (ctx.state.enemies.length >= 4) break;
        ctx.state.enemies.push(ctx.spawnMinion(0, null));
      }
    },
  },
  curse: {
    name: '诅咒方块', every: 4,
    cast(ctx) { ctx.pushBoard(ctx.board.setCursed?.(null, ctx.big ? 5 : (ctx.param.count ?? 3))); },
  },
  terrain: {
    name: '地形改造', every: 5,
    cast(ctx) {
      const row = ctx.rng.int(8);
      const res = ctx.rng.next() < 0.5 ? ctx.board.freezeRow?.(row, Math.max(1, (ctx.param.turns ?? 2) - (ctx.resist || 0)))
                                       : ctx.board.floatRow?.(row);
      ctx.pushBoard(res);
    },
  },
  color_lock: {
    name: '锁色', every: 3,
    cast(ctx) { ctx.pushBoard(ctx.board.setLockedColor?.(ctx.rng.int(ctx.colors ?? 6), ctx.param.turns ?? 3)); },
  },
  color_swap: {
    name: '换色', every: 4,
    cast(ctx) {
      const n = ctx.colors ?? 6;
      const a = ctx.rng.int(n);
      let b = ctx.rng.int(n);
      if (b === a) b = (b + 1) % n;
      ctx.pushBoard(ctx.board.convertColor?.(a, b));
    },
  },
  // 被动型：不周期触发，只在受伤结算时改写伤害
  dodge: {
    name: '闪避', every: 0,
    onDamage(ctx, dmg) { return ctx.rng.next() < (ctx.param.pct ?? 0.2) ? Math.round(dmg / 2) : dmg; },
  },
};
