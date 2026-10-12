// 敌人技能系统单元测试：node tests/skills.test.mjs
import assert from 'node:assert/strict';
import { Battle } from '../js/game/battle.js';
import { ENEMY_SKILLS } from '../js/game/enemy-skills.js';
import { Board } from '../js/core/board.js';
import { RNG } from '../js/core/rng.js';
import { LEVELS } from '../js/data/levels.js';

let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; console.log('PASS', name); } catch (e) { fail++; console.log('FAIL', name, '-', e.message); } };
const eq = (a, b, m) => assert.equal(a, b, `${m || ''} 期望 ${b} 实得 ${a}`);

const stubBoard = () => ({
  clearArea: () => ({ events: [] }), shuffleAll: () => ({ events: [] }),
  randomCells: () => [], setSub: () => ({ events: [] }),
});
const mkChar = (id, atk, hp) => ({ id, name: id, atk, hp, mult: 1, skill: { name: 't', cd: 99 }, passive: null });
const mkLevel = (enemies, extra = {}) => ({ id: 1, chapter: 1, name: 'T', goal: { kind: 'enemy' }, steps: 99, colors: 4, enemies, board: {}, ...extra });
const emptyRes = { events: [], score: 0, matchedCounts: {}, moves: 0 };
const run = (b, n) => { for (let i = 0; i < n; i++) b.onMoveResult(emptyRes); };

ok('技能按 every 周期触发（every=2 → 第2回合触发一次）', () => {
  const lv = mkLevel([{ name: '测试怪', hp: 999999, atk: 1, atkEvery: 99, skills: [{ id: 'fog', every: 2 }] }]);
  const b = new Battle(lv, [mkChar('hajimiao', 10, 99999)], stubBoard(), new RNG(1));
  run(b, 1);
  eq(b.turnEvents.filter(e => e.kind === 'bossSkill').length, 0, '第1回合不触发');
  run(b, 1);
  const cast = b.turnEvents.filter(e => e.kind === 'bossSkill');
  eq(cast.length, 1, '第2回合触发');
  eq(cast[0].skill, 'fog', '事件带 skill id');
});

ok('蓄力：预警若干回合后以 big 释放', () => {
  const lv = mkLevel([{ name: '蓄力怪', hp: 999999, atk: 1, atkEvery: 99, skills: [{ id: 'fog', every: 2, charge: 2 }] }]);
  const b = new Battle(lv, [mkChar('hajimiao', 10, 99999)], stubBoard(), new RNG(1));
  const kinds = [], casts = [];
  for (let i = 0; i < 6; i++) {
    b.onMoveResult(emptyRes);
    for (const e of b.turnEvents) { kinds.push(e.kind); if (e.kind === 'bossSkill') casts.push(e); }
  }
  assert.ok(kinds.includes('chargeStart'), '有预警事件');
  eq(kinds.filter(k => k === 'chargeStart').length, 2, '第2、6回合各预警一次');
  eq(casts.length, 1, '蓄力完成后释放一次');
  eq(casts[0].big, true, '以 big 形态释放');
});

ok('蓄力期间被震慑：预警清零且不再累积', () => {
  const lv = mkLevel([{ name: '蓄力怪', hp: 999999, atk: 1, atkEvery: 99, skills: [{ id: 'fog', every: 2, charge: 3 }] }]);
  const b = new Battle(lv, [mkChar('hajimiao', 10, 99999)], stubBoard(), new RNG(1));
  run(b, 2);
  assert.ok(b.turnEvents.some(e => e.kind === 'chargeStart'), '先出现预警');
  eq(b.state.enemies[0].skillState.fog.charge, 3, '进入蓄力');
  b.state.enemies[0].stunned = 9;
  b.turnEvents.length = 0;
  run(b, 4);
  eq(b.state.enemies[0].skillState.fog.charge, 0, '震慑打断蓄力');
  eq(b.turnEvents.filter(e => e.kind === 'chargeStart').length, 0, '震慑期间不再预警');
});

ok('血量过阈值进入二阶段，一阶段技能停用', () => {
  const lv = mkLevel([{ name: '阶段Boss', hp: 1000, atk: 1, atkEvery: 99, phaseAt: 0.5,
    skills: [{ id: 'fog', every: 1, phase: 1 }, { id: 'thunder', every: 1, phase: 2 }] }]);
  const b = new Battle(lv, [mkChar('hajimiao', 10, 99999)], stubBoard(), new RNG(1));
  b.damageEnemy(600, { source: 'test' });
  eq(b.state.enemies[0].phase, 2, '进入二阶段');
  const seen = [];
  for (let i = 0; i < 2; i++) { b.onMoveResult(emptyRes); seen.push(...b.turnEvents.filter(e => e.kind === 'bossSkill').map(e => e.skill)); }
  assert.ok(!seen.includes('fog'), '一阶段技能不再触发');
  assert.ok(seen.includes('thunder'), '二阶段技能触发');
});

ok('setCursed 标记诅咒格并发出 curseSet 事件', () => {
  const b = new Board({ colors: 4, rng: new RNG(5) });
  const res = b.setCursed([{ r: 2, c: 2 }]);
  eq(b.grid[2][2].cursed, true, '标记成功');
  assert.ok(res.events.some(e => e.type === 'curseSet'), '有 curseSet 事件');
});

ok('消除含诅咒格 → curseHit 事件', () => {
  const b = new Board({ colors: 4, rng: new RNG(5) });
  for (let c = 0; c < 3; c++) b.grid[0][c].color = 0;   // 造一个三连
  b.grid[0][1].cursed = true;
  const res = b.settle();
  assert.ok((res.events || []).some(e => e.type === 'curseHit'), '有 curseHit');
});

ok('诅咒反噬使锁定敌人按格回血 1%', () => {
  const lv = mkLevel([{ name: '诅咒怪', hp: 1000, atk: 1, atkEvery: 99, skills: [{ id: 'curse', every: 1 }] }]);
  const b = new Battle(lv, [mkChar('hajimiao', 10, 99999)], stubBoard(), new RNG(1));
  b.damageEnemy(500, { source: 'test' });        // 先打掉一半，否则满血回不上去
  b.onMoveResult({ events: [{ type: 'curseHit', n: 2 }], score: 0, matchedCounts: {}, moves: 0 });
  eq(b.state.enemies[0].hp, 520, '2 格 → 回血最大生命的 2%');
  assert.ok(b.turnEvents.some(e => e.kind === 'curseHit'), '有 curseHit 战斗事件');
});

ok('4 连消净化半径 1 内的诅咒格', () => {
  const b = new Board({ colors: 4, rng: new RNG(5) });
  for (let c = 0; c < 4; c++) b.grid[0][c].color = 0;   // 造四连
  b.grid[1][1].cursed = true;
  const res = b.settle();
  assert.ok((res.events || []).some(e => e.type === 'curseCleanse'), '有净化事件');
  eq(b.grid[1][1].cursed, false, '邻格诅咒被净化');
});

ok('freezeRow 整行结冰并发出 terrain 事件', () => {
  const b = new Board({ colors: 4, rng: new RNG(9) });
  const res = b.freezeRow(2, 3);
  assert.ok(res.events.some(e => e.type === 'terrain' && e.kind === 'ice'), 'terrain 事件');
  eq(b.grid[2][0].ice, 3, '该行结冰');
});

ok('floatRow 整行浮空', () => {
  const b = new Board({ colors: 4, rng: new RNG(9) });
  const res = b.floatRow(1);
  assert.ok(res.events.some(e => e.type === 'terrain' && e.kind === 'float'), 'terrain float 事件');
  eq(b.grid[1][3].float, true, '该行悬空固定');
});

ok('锁色：该色不参与匹配，回合耗尽后自动解除', () => {
  const b = new Board({ colors: 4, rng: new RNG(9) });
  for (let c = 0; c < 3; c++) b.grid[0][c].color = 0;
  b.setLockedColor(0, 2);
  const r1 = b.settle();
  assert.ok(!(r1.events || []).some(e => e.type === 'match' && e.cells.some(p => p.r === 0)), '锁色期间该行不构成匹配');
  eq(b.grid[0][1].color, 0, '格子未被消除');
  b.settle();
  eq(b.lockedColor, null, '回合耗尽自动解锁');
});

ok('summon 按数据召出指定数量与规格的小怪，且小怪自带技能', () => {
  const lv = mkLevel([{ name: '召唤师', hp: 999999, atk: 1, atkEvery: 99,
    skills: [{ id: 'summon', every: 1, param: { count: 2, minion: { name: '回声蝠', hp: 800, atk: 120 } } }] }]);
  const b = new Battle(lv, [mkChar('hajimiao', 10, 99999)], stubBoard(), new RNG(1));
  b.onMoveResult(emptyRes);
  const mins = b.state.enemies.filter(e => e.summoned);
  eq(mins.length, 2, '按 count 召出 2 只');
  eq(mins[0].name, '回声蝠', '用数据里的规格');
  eq(mins[0].atk, 120, '攻击取自数据');
  assert.ok(mins[0].skills.length >= 1, '小怪自带技能');
  assert.ok(mins[0].skills.every(s => ENEMY_SKILLS[s.id]), '小怪技能都在注册表内');
});

ok('minions 一次召 2 只且总敌数不超过 4', () => {
  const lv = mkLevel([{ name: '牧场首领', hp: 999999, atk: 1, atkEvery: 99, skills: [{ id: 'minions', every: 1 }] }]);
  const b = new Battle(lv, [mkChar('hajimiao', 10, 99999)], stubBoard(), new RNG(3));
  for (let i = 0; i < 4; i++) b.onMoveResult(emptyRes);
  assert.ok(b.state.enemies.length > 1, '召出了小怪');
  assert.ok(b.state.enemies.length <= 4, `敌人总数不超 4（实际 ${b.state.enemies.length}）`);
});

ok('全部敌人有技能、技能 id 合法、周期在 1–8 内（白板清零）', () => {
  const bad = [];
  for (const l of LEVELS) for (const e of (l.enemies || [])) {
    if (!e.skills || !e.skills.length) { bad.push(`${l.id}/${e.name} 无技能`); continue; }
    for (const s of e.skills) {
      if (!ENEMY_SKILLS[s.id]) bad.push(`${l.id}/${e.name} 未知技能 ${s.id}`);
      if (!(s.every >= 1 && s.every <= 8)) bad.push(`${l.id}/${e.name} every=${s.every}`);
    }
  }
  eq(bad.length, 0, '完整性问题：' + bad.slice(0, 8).join(' | '));
});

ok('Boss 关带阶段变化，且技能数不少于 2', () => {
  const bosses = LEVELS.filter(l => l.type === 'boss' || l.boss);
  assert.ok(bosses.length >= 8, `应有 Boss 关（实际 ${bosses.length}）`);
  const bad = bosses.filter(l => (l.enemies || []).some(e => !e.phaseAt || e.skills.length < 2));
  eq(bad.length, 0, '缺阶段或多技能的 Boss：' + bad.slice(0, 5).map(l => l.id).join(','));
});

// ===== 期 2：run 状态机与词条池 =====
const { BOONS } = await import('../js/data/boons.js');
const { RunMode } = await import('../js/game/run-mode.js');
const { Meta } = await import('../js/game/meta.js');
const newRun = (mode = 'endless') => new RunMode({ _endlessLevel: w => ({ id: 9000 + w }) }, mode);

ok('词条池：12 条、id 唯一、字段完整', () => {
  eq(BOONS.length, 12, '词条数量');
  eq(new Set(BOONS.map(b => b.id)).size, 12, 'id 唯一');
  assert.ok(BOONS.every(b => b.max >= 1 && b.name && b.desc && b.kind), '字段完整');
});

ok('三选一不重复、不含已满层词条', () => {
  const run = newRun();
  for (let i = 0; i < 60; i++) {
    const c = run.rollChoices(3);
    eq(new Set(c.map(x => x.id)).size, c.length, '同批不重复');
    assert.ok(c.every(x => run.stacks(x.id) < x.max), '未达上限');
  }
});

ok('词条叠层受 max 约束，bonus/boonMap 正确汇总', () => {
  const run = newRun();
  for (let i = 0; i < 9; i++) run.pick('atk');
  eq(run.stacks('atk'), 3, '不超过 max=3');
  eq(Math.round(run.bonus('atk') * 100) / 100, 0.45, '每层 +15%');
  eq(Math.round(run.boonMap().atk * 100) / 100, 0.45, 'boonMap 同步');
});

ok('复活币只给一次额度且不可叠加', () => {
  const run = newRun();
  assert.ok(run.pick('revive'), '可选');
  eq(run.revivesLeft, 1, '一次复活');
  assert.ok(!run.pick('revive'), '已满层不可再选');
  eq(run.revivesLeft, 1, '额度不叠加');
});

ok('通关结算：金币吃 gold 加成并写入 progress 纪录', () => {
  Meta.init();
  const run = newRun();
  run.pick('gold');
  const res = run.onWaveCleared(2);
  eq(res.gold, Math.round(40 * 1.25), '30+2*5=40 再 ×1.25');
  eq(Meta.get().progress.endlessBest, 2, '写入无尽最佳波数');
});

ok('Boss Rush 全通给一次性 1500 金币与称号', () => {
  Meta.init();
  Meta.get().progress = {};
  Meta.get().gold = 0;
  const run = newRun('bossrush');
  eq(run.totalWaves, 8, '共 8 场');
  run.onWaveCleared(8);
  eq(Meta.get().progress.bossRushCrown, true, '发称号');
  eq(Meta.get().gold, 420 + 1500, '通关金 420 + 一次性 1500');
  eq(Meta.get().progress.bossRushBest, 8, '写入纪录');
  newRun('bossrush').onWaveCleared(8);
  eq(Meta.get().gold, 420 + 1500 + 420, '二次全通只给通关金，不再重复发称号金');
});

ok('词条注入战斗：atk 放大、敌人技能周期拉长、开局护盾生效', () => {
  const lv = mkLevel([{ name: '怪', hp: 999999, atk: 100, atkEvery: 1, skills: [{ id: 'fog', every: 2 }] }],
    { boons: { atk: 0.30, slow: 1, shield: 2 } });
  const b = new Battle(lv, [mkChar('hajimiao', 100, 99999)], stubBoard(), new RNG(1));
  eq(Math.round(b.avgAtk()), 130, '梗力爆发 +30%');
  eq(b.state.shields.length, 2, '开局两层护盾');
  eq(b.state.shield, 2, '镜像计数同步');
  b.onMoveResult(emptyRes);
  b.onMoveResult(emptyRes);
  assert.ok(!b.turnEvents.some(e => e.kind === 'bossSkill'), 'every 2+1 → 前两回合不放技能');
  b.onMoveResult(emptyRes);
  assert.ok(b.turnEvents.some(e => e.kind === 'bossSkill'), '第三回合才放');
});

ok('阶段切换事件能活到 UI（不被 endTurn 清空吃掉）', () => {
  const lv = mkLevel([{ name: '阶段Boss', hp: 1000, atk: 1, atkEvery: 1, phaseAt: 0.5,
    skills: [{ id: 'fog', every: 9, phase: 1 }] }]);
  const b = new Battle(lv, [mkChar('hajimiao', 500, 999999)], stubBoard(), new RNG(1));
  b.onMoveResult({ events: [], score: 0, matchedCounts: { 0: 2 }, moves: 0 });
  // 上面这次消除把血量打过 50% 阈值 → 应产生 enemyPhase
  eq(b.state.enemies[0].phase, 2, '已进入二阶段');
  assert.ok(b.turnEvents.some(e => e.kind === 'enemyPhase'), 'UI 应能读到 enemyPhase 事件');
});

ok('蓄力预警事件能活到 UI', () => {
  const lv = mkLevel([{ name: '蓄力怪', hp: 999999, atk: 1, atkEvery: 99, skills: [{ id: 'fog', every: 1, charge: 2 }] }]);
  const b = new Battle(lv, [mkChar('hajimiao', 10, 99999)], stubBoard(), new RNG(1));
  b.onMoveResult(emptyRes);
  assert.ok(b.turnEvents.some(e => e.kind === 'chargeStart'), 'UI 应能读到 chargeStart 事件');
});

console.log(`\n${fail ? 'SOME FAILED' : 'ALL GREEN'}: ${pass} passed`);
process.exit(fail ? 1 : 0);
