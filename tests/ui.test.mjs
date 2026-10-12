// ui.test.mjs — jsdom 无头集成冒烟：验证主循环/场景/战斗接线无异常
// 运行：node tests/ui.test.mjs
import { JSDOM } from 'jsdom';
import assert from 'node:assert';

// ===== Canvas 2D 桩（jsdom 无 canvas 实现）=====
function stubCtx() {
  const gradient = { addColorStop() {} };
  return new Proxy({}, {
    get(t, k) {
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => gradient;
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      if (typeof k === 'string') return t[k] !== undefined ? t[k] : () => {};
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

const dom = new JSDOM(`<!DOCTYPE html><html><body>
<div id="app">
  <header id="topbar">
    <button id="tbBack"></button>
    <div id="tbTitle">梗灵大陆</div>
    <div id="tbRes"><b id="tbEnergy"></b><b id="tbGold"></b></div>
  </header>
  <div class="scene" id="scene-home"></div>
  <div class="scene" id="scene-map"></div>
  <div class="scene" id="scene-lineup"></div>
  <div class="scene" id="scene-battle"><canvas id="board"></canvas></div>
  <div class="scene" id="scene-result"></div>
  <div class="scene" id="scene-chars"></div>
  <div class="scene" id="scene-shop"></div>
</div>
<div id="toast-root"></div><div id="modal-root"></div>
</body></html>`, { url: 'http://localhost/', pretendToBeVisual: true });

global.window = dom.window;
global.document = dom.window.document;
global.location = dom.window.location;
global.localStorage = dom.window.localStorage;
global.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
global.cancelAnimationFrame = (id) => clearTimeout(id);
global.getComputedStyle = dom.window.getComputedStyle;
// HTMLCanvasElement.getContext 桩
dom.window.HTMLCanvasElement.prototype.getContext = function () {
  if (!this._ctx) this._ctx = stubCtx();
  return this._ctx;
};

const { default: Game } = await import('../js/main.js');
const { Meta } = await import('../js/game/meta.js');
const { Board } = await import('../js/core/board.js');
const { Scenes } = await import('../js/ui/scenes.js');
const { LEVELS } = await import('../js/data/levels.js');

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log('[PASS]', name); }
  catch (e) { console.log('[FAIL]', name, '—', e.message); process.exitCode = 1; }
}
const eq = (a, b, m) => assert.equal(a, b, `${m || ''}（期望 ${b}，实得 ${a}）`);
const eqDeep = (a, b, m) => assert.deepEqual(a, b, `${m || ''}（期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}）`);
const okA = async (name, fn) => {
  try { await fn(); passed++; console.log('[PASS]', name); }
  catch (e) { console.log('[FAIL]', name, '—', e.message); process.exitCode = 1; }
};

// 等待微任务/定时器排空
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));
// 等战斗演出跑完（Game.busy 期间 useSkill 会被直接 return，固定 sleep 时长会偶发失败）
const waitIdle = async (timeout = 12000) => {
  const t0 = Date.now();
  while (Game.busy && Date.now() - t0 < timeout) await tick(20);
  await tick(30);
};

// ===== 1. 启动 =====
Meta.init();
Game.start();
await tick(50);
ok('启动进入 home 场景', () => assert.ok(document.getElementById('scene-home').classList.contains('active')));

// ===== 2. 地图场景（世界地图）=====
Scenes.show('map');
await tick(50);
ok('世界地图渲染', () => {
  const node = document.getElementById('scene-map');
  assert.ok(node.innerHTML.length > 100, '地图内容为空');
});

// ===== 3. 编队场景 =====
Scenes._levelId = 1;
Scenes.show('lineup');
await tick(50);
ok('编队场景渲染（成员槽/道具）', () => {
  assert.ok(document.querySelectorAll('#teamSlots .team-slot').length === 3);
  assert.ok(document.querySelectorAll('#itemChecks .item-check').length === 8);
});

// ===== 4. 开战（普通关）=====
Game.startBattle(LEVELS.find(l => l.id === 1), ['hajimiao', null, null], ['hammer']);
await tick(80);
ok('战斗场景渲染（敌人条/成员卡/技能/棋盘）', () => {
  assert.ok(document.getElementById('scene-battle').classList.contains('active'));
  assert.ok(document.querySelectorAll('#btMembers .member-card').length === 1, '成员卡缺失');
  assert.ok(document.querySelectorAll('#btSkills .skill-btn').length === 1, '技能按钮缺失');
});
ok('棋盘满格', () => {
  for (const row of Game.board.grid) for (const c of row) assert.ok(c, '有空格');
});

// ===== 5. 用 useHint 模拟一次有效交换 =====
const hint = Game.board.useHint();
assert.ok(hint, '无可行交换');
await Game.doSwap(hint.r1, hint.c1, hint.r2, hint.c2);
await tick(50);
ok('交换后回合推进（步数减少/无异常）', () => {
  assert.equal(Game.movesUsed, 1);
});

// ===== 6. 技能释放 =====
await waitIdle();
await Game.useSkill(0);
await waitIdle();
ok('技能释放后 CD 生效', () => {
  assert.ok((Game.battle.state.skillCds.hajimiao || 0) > 0);
});

// ===== 7. 气流关（第 37 关）：机制识别 + applyWind =====
Game.renderer.detach();
Game.startBattle(LEVELS.find(l => l.id === 37), ['hajimiao', null, null], []);
await tick(80);
ok('气流关机制识别', () => assert.ok(Game.mech.wind === true));
const h2 = Game.board.useHint();
await Game.doSwap(h2.r1, h2.c1, h2.r2, h2.c2);
await Game.doSwap(...(Object.values(Game.board.useHint())));
await tick(80);
ok('两步后触发气流（棋盘仍满格）', () => {
  assert.equal(Game.movesUsed, 2);
  for (const row of Game.board.grid) for (const c of row) assert.ok(c, '气流后有空格');
});

// ===== 8. 浮空/宝箱/子方块种子 =====
Game.renderer.detach();
Game.startBattle(LEVELS.find(l => l.id === 40), ['hajimiao', null, null], []);
let floatN = 0;
for (const row of Game.board.grid) for (const c of row) if (c.float) floatN++;
ok('浮空关生成浮空格', () => assert.ok(floatN > 0, '无浮空格'));
Game.renderer.detach();
Game.startBattle(LEVELS.find(l => l.id === 46), ['hajimiao', null, null], []);
let treN = 0;
for (const row of Game.board.grid) for (const c of row) if (c.treasure) treN++;
ok('宝箱关生成宝箱格', () => assert.ok(treN > 0, '无宝箱格'));
Game.renderer.detach();
Game.startBattle(LEVELS.find(l => l.id === 59), ['hajimiao', null, null], []);
let subN = 0;
for (const row of Game.board.grid) for (const c of row) if (c.sub) subN++;
ok('子方块关生成通配格', () => assert.ok(subN > 0, '无子方块格'));

// ===== 9. 老虎机关（第 64 关）机制识别 =====
Game.renderer.detach();
Game.startBattle(LEVELS.find(l => l.id === 64), ['hajimiao', null, null], []);
ok('老虎机关机制识别', () => assert.ok(Game.mech.slot === true));

// ===== 10. 赌局关弹窗（第 67 关）=====
const modalBefore = document.querySelectorAll('#modal-root .modal-mask').length;
Game.battle = null; // 清掉上一关残留，验证选择前不开新战斗
Game.startBattle(LEVELS.find(l => l.id === 67), ['hajimiao', null, null], []);
ok('赌局关弹出模式选择', () => {
  assert.ok(document.querySelectorAll('#modal-root .modal-mask').length > modalBefore, '未弹窗');
  assert.ok(!Game.battle, '选择前不应开战');
});

// ===== 11. 敌人技能接线（第 36 关噪音怪兽 → 注册表 noise）=====
const { ENEMY_SKILLS } = await import('../js/game/enemy-skills.js');
Game.renderer.detach();
document.querySelectorAll('#modal-root .modal-mask').forEach(m => m.remove());
Game.startBattle(LEVELS.find(l => l.id === 36), ['hajimiao', 'dasangwang', 'mianshifu'], []);
ok('Boss 关接线注册表：技能合法且带阶段', () => {
  const e = Game.battle.state.enemies[0];
  assert.ok(e.skills.length >= 2, 'Boss 应有多技能');
  assert.ok(e.skills.every(s => ENEMY_SKILLS[s.id]), '技能都在注册表内');
  assert.ok(e.phaseAt > 0, 'Boss 应有阶段阈值');
});
ok('逐角色 HP：3 成员', () => {
  assert.equal(Game.battle.state.members.length, 3);
  assert.ok(Game.battle.state.members.every(m => m.maxHp > 0));
});
// 模拟多回合验证 Boss 技能触发不抛错（直接打 endTurn）
for (let i = 0; i < 8 && !Game.battle.state.over; i++) {
  const h3 = Game.board.useHint();
  if (h3) await Game.doSwap(h3.r1, h3.c1, h3.r2, h3.c2);
}
await tick(100);
ok('8 回合战斗循环无异常（含 Boss 技能/成员受击）', () => {
  assert.ok(Game.battle.state.turn > 0);
});

// ===== 12. 结算场景 =====
// 强制胜利走结算
Game.battle.state.over = true;
Game.battle.state.win = true;
Game._endBattle();
await tick(800);
ok('结算场景渲染', () => {
  assert.ok(document.getElementById('scene-result').classList.contains('active'));
});

// ===== 13. 改名大狗旺 =====
Game.renderer.detach();
const { CHARACTERS } = await import('../js/data/characters.js');
ok('大嗓汪已改名大狗旺', () => {
  const d = CHARACTERS.find(c => c.id === 'dasangwang');
  assert.equal(d.name, '大狗旺');
});

// ===== 14. 音效模块（jsdom 无 AudioContext，应静默降级不抛错）=====
const { Sfx } = await import('../js/game/sfx.js');
ok('Sfx 无 AudioContext 降级不抛错', () => {
  Sfx.play('match', { step: 2 });
  Sfx.jingle('victory');
  Sfx.setMuted(true);
  Sfx.play('match');
  Sfx.setMuted(false);
});

// ===== 15. 无尽模式（肉鸽三选一） =====
const boonBtns = () => {
  const boxes = document.querySelectorAll('#modal-root .modal-box');
  const last = boxes[boxes.length - 1];
  return last ? [...last.querySelectorAll('.modal-btns button')] : [];
};
// 三选一里可能出现"复活币"，它会让倒地成员直接再起，掩盖本组用例要验证的血量继承规则；
// 卡池是随机顺序，所以默认跳过它，保证断言稳定。
const pickBoon = async (i = 0) => {
  await tick(1200);
  const btns = boonBtns().filter(b => !/复活/.test(b.textContent));
  if (btns.length) btns[Math.min(i, btns.length - 1)].click();
  await tick(200);
};
Game.renderer.detach();
Game.run = null;
Game.startEndless();
await tick(120);
ok('无尽模式进入第 1 波', () => {
  assert.ok(Game.run && Game.run.wave === 1);
  assert.ok(document.getElementById('scene-battle').classList.contains('active'));
  assert.equal(Game.level.id, 9001);
  assert.ok(Game.battle.state.members.length >= 1);
});
ok('无尽波次强度递增', () => {
  const l1 = Game._endlessLevel(1), l5 = Game._endlessLevel(5), l9 = Game._endlessLevel(9);
  assert.ok(l5.enemies[0].hp > l1.enemies[0].hp);
  assert.ok(l9.enemies[0].hp > l5.enemies[0].hp);
  assert.ok(l5.enemies[0].name.includes('Boss'), '第5波应是Boss波');
});
// 通关一波 → 弹三选一 → 选完进入第 2 波并继承血量
Game.battle.state.enemies.forEach(e => e.hp = 0);
Game.battle.state.over = true;
Game.battle.state.win = true;
Game._endBattle();
await tick(1200);
ok('一波通关后弹三选一强化卡（3 个可选项）', () => {
  assert.equal(boonBtns().length, 3, `应有 3 个词条按钮（实际 ${boonBtns().length}）`);
  assert.equal(Game.run.wave, 1, '选卡前不推进波次');
});
await pickBoon(0);
ok('选定词条后进入第 2 波（血量继承 + 回复 20%）', () => {
  assert.equal(Game.run.wave, 2);
  assert.equal(Game.level.id, 9002);
  assert.equal(Object.keys(Game.run.boons).length, 1, '词条已记录');
  const prev = Game.run.membersHp || {};
  assert.ok(Game.battle.state.members.every(m => {
    const p = prev[m.id];
    if (p == null) return true;
    return m.hp === Math.min(m.maxHp, Math.round(p * 1.2));
  }));
});

// 无尽模式：本波倒下的梗灵，下一波不得复活（回归）
const _team0 = Meta.get().team.slice();
Meta.get().team.splice(0, 3, 'hajimiao', 'dasangwang', 'mianshifu');
Meta.persist();
Game.renderer.detach();
Game.run = null;
Game.startEndless();
await tick(120);
const downId = Game.battle.state.members[0].id;
Game.battle.state.members[0].hp = 0;
Game.battle.state.members[0].fainted = true;
Game.battle.state.enemies.forEach(e => e.hp = 0);
Game.battle.state.over = true;
Game.battle.state.win = true;
Game._endBattle();
await pickBoon();
ok('无尽模式：倒下成员下一波保持倒地（不满血复活）', () => {
  assert.equal(Game.run.wave, 2);
  const m = Game.battle.state.members.find(x => x.id === downId);
  assert.equal(m.hp, 0, '血量应保持 0');
  assert.equal(m.fainted, true, '应保持倒地');
});
ok('无尽模式：存活成员正常继承血量并回复 20%', () => {
  const other = Game.battle.state.members.find(x => x.id !== downId);
  assert.ok(other.hp > 0 && !other.fainted, '存活成员应可继续作战');
});
ok('无尽模式：共享血条只累计存活成员', () => {
  const sum = Game.battle.state.members.reduce((a, m) => a + m.hp, 0);
  assert.equal(Game.battle.state.hp, sum);
});

// 复活币：倒地成员下一波可以 30% 血再起一次
Game.run.revivesLeft = 1;
Game.battle.state.enemies.forEach(e => e.hp = 0);
Game.battle.state.over = true;
Game.battle.state.win = true;
Game._endBattle();
await pickBoon();
ok('复活币生效：倒地成员以 30% 血再起且额度用尽', () => {
  assert.equal(Game.run.wave, 3);
  const m = Game.battle.state.members.find(x => x.id === downId);
  eq(m.hp, Math.round(m.maxHp * 0.3), '30% 血量');
  eq(m.fainted, false, '不再倒地');
  eq(Game.run.revivesLeft, 0, '额度已消耗');
});

// 全员倒下 → 不再开启下一波，直接结束本局
Game.battle.state.members.forEach(m => { m.hp = 0; m.fainted = true; });
Game.battle.state.enemies.forEach(e => e.hp = 0);
Game.battle.state.over = true;
Game.battle.state.win = true;
Game._endBattle();
await pickBoon();
ok('无尽模式：全员倒下时本局结束而不开新波', () => {
  assert.equal(Game.level.id, 9003, '应停留在第 3 波，不进入第 4 波');
  eq(Game.result.win, false, '应判负');
  eq(Game.result.run.mode, 'endless', '结算数据标明模式');
});
Game.renderer.detach();
Game.run = null;
Meta.get().team.splice(0, 3, ..._team0);
Meta.persist();

// ===== 15b. Boss Rush 入口与流程 =====
Game.run = null;
Game.startBossRush();
await tick(150);
ok('Boss Rush 第 1 场取第一章 Boss 关的强化版', () => {
  assert.ok(Game.run && Game.run.isBossRush, '模式正确');
  eq(Game.run.totalWaves, 8, '共 8 场');
  eq(Game.level.id, 9101, '关卡 id');
  assert.ok(/Boss Rush/.test(Game.level.name), '关卡名');
  assert.ok(Game.level.enemies[0].phaseAt > 0, '强制带阶段');
});
Game.battle.state.enemies.forEach(e => e.hp = 0);
Game.battle.state.over = true;
Game.battle.state.win = true;
Game._endBattle();
await pickBoon();
ok('Boss Rush 首场通关后进入第 2 场', () => {
  eq(Game.run.wave, 2, '第 2 场');
  eq(Game.level.id, 9102, '第 2 场关卡 id');
});
Game.quitBattle();
Game.run = null;

// ===== 15c. 真机反馈的两个 bug 回归 =====
ok('run 模式战斗内带上了背包里的道具（词条发的锤子能用）', () => {
  Game.run = null;
  const st = Meta.get();
  st.items.hammer = 3;
  st.items.crossBomb = 1;
  st.items.colorBottle = 0;
  Game.startEndless();
  assert.ok(Game.broughtItems.includes('hammer'), '锤子应可带入');
  assert.ok(Game.broughtItems.includes('crossBomb'), '十字炸弹应可带入');
  assert.ok(!Game.broughtItems.includes('colorBottle'), '数量为 0 的道具不带');
});
ok('铁匠铺词条发的锤子会落库（persist 后可见）', () => {
  const before = Meta.get().items.hammer;
  Game.run.boons.hammer = 1;
  Game.run.wave = 1;
  Game._nextWave();
  assert.equal(Meta.get().items.hammer, before + 1, '背包锤子 +1');
  Game.run = null;
});
ok('run 中放弃回到首页，而不是普通关卡地图', () => {
  Game.run = null;
  Game.startEndless();
  Game.quitBattle();
  assert.equal(Game.run, null, 'run 已清空');
  assert.ok(document.getElementById('scene-home').classList.contains('active'), '应停在首页');
  assert.ok(!document.getElementById('scene-map').classList.contains('active'), '不应回到关卡地图');
});
Game.run = null;

ok('无尽波次也带新技能：每波有技能、Boss 波有阶段与蓄力、id 合法', () => {
  for (let w = 1; w <= 20; w++) {
    const lv = Game._endlessLevel(w);
    const e = lv.enemies[0];
    assert.ok(e.skills && e.skills.length >= 1, `第${w}波应有技能`);
    assert.ok(e.skills.every(s => ENEMY_SKILLS[s.id]), `第${w}波技能 id 应都在注册表内`);
    if (w % 5 === 0) {
      assert.ok(e.phaseAt > 0, `第${w}波是 Boss 波，应有阶段阈值`);
      assert.ok(e.skills.length >= 3, `第${w}波 Boss 应有 3 技能`);
      if (w >= 3) assert.ok(e.skills.some(s => s.charge), `第${w}波 Boss 应有蓄力大招`);
    }
  }
  const kinds = new Set();
  for (let w = 1; w <= 20; w++) Game._endlessLevel(w).enemies[0].skills.forEach(s => kinds.add(s.id));
  assert.ok(kinds.size >= 6, `20 波应覆盖至少 6 种技能（实际 ${kinds.size}）`);
});
Game.run = null;

// ===== 17. 震动反馈 =====
const { Haptics } = await import('../js/game/haptics.js');
const vibCalls = [];
// 只给现有 navigator 挂一个 vibrate，不替换整个对象（Node 的 navigator 有内部私有字段）
Object.defineProperty(globalThis.navigator, 'vibrate', {
  value: p => { vibCalls.push(p); return true; }, configurable: true, writable: true,
});

ok('navigator.vibrate 缺失时静默降级不抛错', () => {
  const saved = globalThis.navigator.vibrate;
  Object.defineProperty(globalThis.navigator, 'vibrate', { value: undefined, configurable: true, writable: true });
  eq(Haptics.pulse('kill'), false, '无 vibrate 时返回 false');
  Object.defineProperty(globalThis.navigator, 'vibrate', { value: saved, configurable: true, writable: true });
});
ok('开关默认开启，pulse 会带节奏参数下发', () => {
  Haptics.set(true);
  eq(Haptics.enabled, true, '默认开');
  vibCalls.length = 0;
  Haptics.pulse('rage');
  eq(vibCalls.length, 1, '震一次');
  assert.ok(Array.isArray(vibCalls[0]) && vibCalls[0].length >= 3, '狂暴用多段节奏');
});
ok('关掉开关后不再震动，且状态写入存档', () => {
  Haptics.toggle();
  eq(Haptics.enabled, false, '已关闭');
  eq(Meta.get().progress.haptics, false, '落库');
  vibCalls.length = 0;
  eq(Haptics.pulse('win'), false, '不震动');
  eq(vibCalls.length, 0, '无下发');
  Haptics.toggle();
  eq(Haptics.enabled, true, '可再开');
});
ok('首页有震动开关按钮且点击会切换', () => {
  Scenes.show('home');
  const btn = document.getElementById('btnHaptic');
  assert.ok(btn, '按钮存在');
  const before = Haptics.enabled;
  btn.click();
  assert.notEqual(Haptics.enabled, before, '点击后状态翻转');
  btn.click();
  assert.equal(Haptics.enabled, before, '再点回来');
});
await okA("击溃单个敌人会产生一次震动（还有敌人存活时才会走回合演出）", async () => {
  Haptics.set(true);
  Game.renderer.detach();
  Game.run = null;
  Game.startBattle(LEVELS.find(l => l.id === 13), ['hajimiao', null, null], []);
  vibCalls.length = 0;
  const t = Game.battle.state.enemies[Game.battle.targetIdx];
  t.hp = 1;
  Game.battle.damageEnemy(500, { source: 'test' });
  assert.equal(Game.battle.state.over, false, '仍应有敌人存活');
  Game.battle.onMoveResult({ events: [], score: 0, matchedCounts: {}, moves: 0 });
  await Game._processTurn();
  assert.ok(vibCalls.length >= 1, '应有震动下发');
});

// ===== 18. 敌人技能事件可达 UI（回归：曾被 endTurn 清空吃掉） =====
await okA("狂暴与蓄力事件能在真实回合里被 UI 消费到", async () => {
  Game.renderer.detach();
  Game.run = null;
  Game.startBattle(LEVELS.find(l => l.id === 36), ['hajimiao', 'dasangwang', 'mianshifu'], []);
  const e = Game.battle.state.enemies[0];
  e.skills = [{ id: 'fog', every: 1, charge: 1 }, { id: 'thunder', every: 9, phase: 2 }];
  e.phaseAt = 0.5;
  e.skillState = {};
  Game.battle.damageEnemy(Math.round(e.maxHp * 0.55), { source: 'test' });
  Game.battle.onMoveResult({ events: [], score: 0, matchedCounts: {}, moves: 0 });
  await Game._processTurn();
  const toasts = [...document.querySelectorAll('#toast-root .toast')].map(t => t.textContent);
  assert.ok(toasts.some(t => /狂暴/.test(t)), '应弹狂暴横幅');
});

// ===== 19. 第5关 rainbowRed 胜利条件回归（越消越多 bug）=====
Game.renderer.detach();
Game.run = null;
Game.startBattle(LEVELS.find(l => l.id === 5), ['hajimiao', null, null], []);
ok('第5关目标为 rainbowRed', () => assert.equal(Game.level.goal.kind, 'rainbowRed'));
ok('未用彩虹球前不判胜（即使场上无红方块）', () => {
  const r = Game._goalDone(Game.level.goal);
  assert.equal(r.ok, false);
});
ok('用彩虹球消除红方块后立即判胜（无视补充刷出的新红块）', () => {
  Game.progress.rainbowCleared[0] = 8; // 模拟彩虹球事件清掉 8 个红
  const r = Game._goalDone(Game.level.goal);
  assert.equal(r.ok, true);
  assert.equal(r.count, 8);
});

// ===== 17. 音效健全性：代码引用的音效/曲目名必须真实存在（防 "wind 无声" 类回归）=====
const fs = await import('node:fs');
const path = await import('node:path');
const { Bgm } = await import('../js/game/sfx.js');
const JS_DIR = path.resolve(import.meta.dirname, '../js');
function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d =>
    d.isDirectory() ? jsFiles(path.join(dir, d.name)) : (d.name.endsWith('.js') ? [path.join(dir, d.name)] : []));
}
// 只取 Sfx.play('字面量' 形式；动态拼接（如 Sfx.play(Sfx.has(...) ? x : y)）由调用方兜底，不在此列
function literalSfxNames(src) {
  const out = [];
  const re = /Sfx\.play\(\s*'([A-Za-z_][A-Za-z_0-9]*)'/g;
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}
ok('代码中 Sfx.play 的字面量音效名全部已定义', () => {
  const missing = [];
  for (const f of jsFiles(JS_DIR)) {
    for (const n of literalSfxNames(fs.readFileSync(f, 'utf8'))) {
      if (!Sfx.has(n)) missing.push(`${path.relative(JS_DIR, f)} → ${n}`);
    }
  }
  assert.deepEqual(missing, [], '未定义的音效：' + missing.join('；'));
});
ok('音效表已覆盖全部 Boss trait 机制', () => {
  const traits = ['shell', 'rockfall', 'noise', 'tornado', 'gust', 'fog', 'thunder', 'bet', 'sub_convert', 'allin', 'summon'];
  const missing = traits.filter(t => !Sfx.has(t));
  assert.deepEqual(missing, [], '缺 trait 音效：' + missing.join('；'));
});
ok('jingle 名合法（victory/three/defeat/unlock）', () => {
  const allowed = new Set(['victory', 'three', 'failure', 'defeat', 'unlock']);
  const bad = [];
  for (const f of jsFiles(JS_DIR)) {
    const src = fs.readFileSync(f, 'utf8');
    const re = /Sfx\.jingle\(\s*'([A-Za-z_][A-Za-z_0-9]*)'/g;
    let m;
    while ((m = re.exec(src))) if (!allowed.has(m[1])) bad.push(`${path.relative(JS_DIR, f)} → ${m[1]}`);
  }
  assert.deepEqual(bad, [], '未知 jingle：' + bad.join('；'));
});
ok('代码中 Bgm.play 的字面量曲目名全部已定义', () => {
  const missing = [];
  for (const f of jsFiles(JS_DIR)) {
    const src = fs.readFileSync(f, 'utf8');
    const re = /Bgm\.play\(\s*'([A-Za-z_][A-Za-z_0-9]*)'/g;
    let m;
    while ((m = re.exec(src))) if (!Bgm.has(m[1])) missing.push(`${path.relative(JS_DIR, f)} → ${m[1]}`);
  }
  assert.deepEqual(missing, [], '未定义的曲目：' + missing.join('；'));
});

// ===== 18. 调试守卫：公开版契约 =====
// 私有版这一段有 13 条用例，断言的是防爆破语义：9 次递减 / 第 10 次封禁 / 封禁独立于游戏存档 /
// 正确口令清计数 / 诱饵口令 / 陷阱令牌 / 守卫状态自签名 / 脚本化连打。
// 公开版无这些机制（js/game/devguard.js 整体换成空壳占位实现，见该文件头注释），照搬必然失败，
// 所以这里换成"公开版自己的契约"断言：调试入口在公开版不可达，且模块不含任何密钥/口令/指纹采集面。
const { DevGuard, deviceInfo } = await import('../js/game/devguard.js');
const { Save } = await import('../js/game/save.js');

ok('公开版契约：MAX_FAILS=0 且 remaining()=0 —— 没有可猜测的尝试预算', () => {
  eq(DevGuard.MAX_FAILS, 0, 'MAX_FAILS');
  eq(DevGuard.remaining(), 0, 'remaining()');
});

await okA('公开版契约：verify() 对任何口令都 resolve false —— 调试入口进不去', async () => {
  for (const pwd of ['', ' ', '0', '1', 'dev', 'admin', 'root', undefined, null]) {
    assert.equal(await DevGuard.verify(pwd), false, `verify(${JSON.stringify(pwd)}) 应恒 false`);
  }
});

ok('公开版契约：isBanned() 恒 false，连打/调用全部守卫方法后仍是 false', () => {
  eq(DevGuard.isBanned(), false, '初始不封禁');
  DevGuard._clear();
  // 私有版这种"间隔 50ms 连打 20 次"会触发脚本化判定并封禁；公开版没有该机制，必须毫无反应
  for (let i = 0; i < 20; i++) {
    const r = DevGuard.fail('probe', 1000 + i * 50);
    assert.equal(r, false, '公开版 fail() 返回 false，不返回私有版的 {banned,remaining} 结构');
    eq(DevGuard.isBanned(), false, '连续失败不该封禁');
    eq(DevGuard.remaining(), 0, 'remaining() 恒 0');
  }
  DevGuard.succeed(); DevGuard.ban(); DevGuard.checkTamper(); DevGuard.plantCanary(); DevGuard._clear();
  eq(DevGuard.isBanned(), false, '全部方法调用后仍不封禁');
});

ok('公开版契约：state()/log()/device()/deviceInfo() 既不暴露计数，也不采集设备指纹', () => {
  eqDeep(DevGuard.state(), { ban: false, fails: 0, log: [] }, 'state() 返回固定空状态');
  eqDeep(DevGuard.log(), [], 'log() 恒空数组');
  eqDeep(DevGuard.device(), {}, 'device() 恒空对象（无 fp/机型/屏幕/时区）');
  eqDeep(deviceInfo(), {}, 'deviceInfo() 恒空对象');
  DevGuard.fail('probe', 800000);
  eq(DevGuard.state().fails, 0, '失败不计数');
  eq(DevGuard.log().length, 0, '失败不写日志');
});

ok('公开版契约：守卫方法不往本机存储写任何键（没有陷阱令牌/守卫状态文件）', () => {
  const before = Object.keys(localStorage).sort();
  DevGuard.plantCanary(); DevGuard.checkTamper();
  DevGuard.fail('probe', 1); DevGuard.succeed(); DevGuard.ban('probe'); DevGuard._clear();
  eqDeep(Object.keys(localStorage).sort(), before, 'localStorage 键集合不应变化');
});

ok('公开版契约：重置游戏存档前后守卫状态都不变（两者本就互不依赖）', () => {
  const before = JSON.stringify(DevGuard.state());
  Save.reset();                 // 玩家能点到的"重置存档"
  eq(JSON.stringify(DevGuard.state()), before, '存档重置不该动守卫状态');
  eq(DevGuard.isBanned(), false, '重置后仍不封禁');
});

ok('公开版契约：devguard.js 实现体（去掉注释）没有字符串常量，也没有口令派生/哈希逻辑', () => {
  const src = fs.readFileSync(path.resolve(import.meta.dirname, '../js/game/devguard.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.ok(!/['"`]/.test(code), '实现里不该出现引号包裹的口令/盐/哈希常量（公开版无密钥可泄露面）');
  assert.ok(!/subtle|deriveBits|digest|crypto|scrypt|bcrypt|atob|btoa|hash|salt|localStorage/i.test(code),
    '实现里不该有口令校验算法或本机存储读写');
});

ok('公开版契约：首页不渲染 🛠 调试按钮，main.js 里没有入口接线', () => {
  Scenes.show('home');
  eq(document.getElementById('btnDev'), null, '公开版首页不该出现调试按钮');
  eq(!!Meta.get().progress.dev, false, 'progress.dev 不可被默认存档解锁');
  const mainSrc = fs.readFileSync(path.resolve(import.meta.dirname, '../js/main.js'), 'utf8');
  assert.ok(!/btnDev|askDevPassword|openDevPanel|progress\.dev\s*=[^=]/.test(mainSrc),
    'main.js 不应带调试入口的解锁接线（公开版已整体移除）');
});

// ===== 19. 全局顶栏：所有场景共用一条，页面不再自绘标题栏 =====
ok('首页顶栏无返回键、不重复字标（大 logo 即标题）', () => {
  Scenes.show('home');
  eq(document.getElementById('tbBack').hidden, true, '首页不该有返回键');
  eq(document.getElementById('tbTitle').hidden, true, '首页顶栏让位给大 logo');
});
ok('地图顶栏显示章节名并可返回首页', () => {
  Scenes.show('map');
  assert.ok(/第一章/.test(document.getElementById('tbTitle').textContent), '标题应为当前章节');
  eq(document.getElementById('tbTitle').hidden, false, '非首页要显示标题');
  document.getElementById('tbBack').click();
  eq(Scenes.current, 'home', '返回应回首页');
});
ok('编队返回回地图（不再是各页自己写死的跳转）', () => {
  Scenes.show('map');
  Scenes.show('lineup');
  eq(document.getElementById('tbTitle').textContent, '出战准备');
  document.getElementById('tbBack').click();
  eq(Scenes.current, 'map', '编队返回应回地图');
});
ok('战斗顶栏：返回位变暂停、资源胶囊让位给棋盘', () => {
  Game.renderer.detach();
  Game.run = null;
  Game.startBattle(LEVELS.find(l => l.id === 1), ['hajimiao', null, null], [], { decided: true });
  const back = document.getElementById('tbBack');
  assert.equal(back.textContent, '⏸', '战斗里左槽应是暂停');
  assert.ok(back.classList.contains('is-pause'), '暂停态样式');
  eq(document.getElementById('tbRes').hidden, true, '战斗中隐藏体力/金币');
  assert.ok(/第1关/.test(document.getElementById('tbTitle').textContent), '顶栏显示关卡名');
});
ok('顶栏 ⏸ 能打开暂停菜单', () => {
  document.getElementById('tbBack').click();
  const boxes = document.querySelectorAll('#modal-root .modal-box');
  const txt = boxes[boxes.length - 1]?.textContent || '';
  assert.ok(/暂停/.test(txt), '应弹出暂停菜单');
  [...boxes[boxes.length - 1].querySelectorAll('button')].find(b => /继续战斗/.test(b.textContent)).click();
});
ok('页面模板不再自带 .scene-head 顶栏', () => {
  for (const s of ['lineup', 'chars', 'shop']) {
    Scenes.show(s);
    eq(document.querySelectorAll('#scene-' + s + ' .scene-head').length, 0, s + ' 仍残留私有标题栏');
  }
  Game.renderer.detach();
  Scenes.show('home');
});

// ===== 20. 编队道具勾选：勾与选中框必须是同一状态源 =====
ok('道具勾选不再依赖嵌套 input（勾与绿框不可能各翻一半）', () => {
  const s = Meta.get();
  const prev = { ...s.items };
  s.items.hammer = 3; s.items.shieldUltra = 2; Meta.persist();
  Scenes.show('lineup');
  const chips = [...document.querySelectorAll('#itemChecks .item-check')];
  assert.ok(chips.length >= 2, '应渲染出道具芯片');
  eq(chips.filter(c => c.querySelector('input')).length, 0, 'button 内不得再嵌 input');
  assert.ok(chips.every(c => c.querySelector('.ic-tick')), '每个芯片要有自绘勾位');
  const ultra = chips.find(c => /Ultra/.test(c.textContent));
  eq(ultra.classList.contains('on'), false, '初始未选');
  ultra.click();
  eq(ultra.classList.contains('on'), true, '点击后选中');
  eq(Scenes._lineupItems.shieldUltra, true, '状态与视觉一致');
  eq(ultra.getAttribute('aria-pressed'), 'true', '无障碍状态同步');
  ultra.click();
  eq(ultra.classList.contains('on'), false, '再点取消');
  eq(Scenes._lineupItems.shieldUltra, false, '状态回到未选');
  // 道具被用光后不得残留"已选中"
  Scenes._lineupItems.hammer = true;
  s.items.hammer = 0; Meta.persist();
  Scenes.show('lineup');
  const ham = [...document.querySelectorAll('#itemChecks .item-check')].find(c => /锤子/.test(c.textContent));
  eq(Scenes._lineupItems.hammer, false, '数量为 0 时清除残留选中');
  eq(ham.classList.contains('on'), false, '0 数量的芯片不该有选中框');
  Object.assign(s.items, prev); Meta.persist();
  Scenes._lineupItems = {};
});

// ===== 21. 棋盘拖拽跟手 =====
const { BoardInput } = await import('../js/ui/input.js');
ok('拖拽逐帧上报偏移、限制在一格内，过阈值成交换且不回弹', () => {
  const cv = document.getElementById('board');
  cv.getBoundingClientRect = () => ({ left: 0, top: 0, width: 320, height: 320, right: 320, bottom: 320 });
  const drags = [], swaps = [], ends = [];
  const inp = new BoardInput(cv, {
    getMetrics: () => ({ ox: 0, oy: 0, cs: 40 }),
    onSwap: (a, b, c, d) => swaps.push([a, b, c, d]),
    onDrag: d => drags.push([Math.round(d.ox), Math.round(d.oy)]),
    onDragEnd: (d, snap) => ends.push(snap),
  });
  const pe = (type, x, y) => cv.dispatchEvent(new window.MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }));

  pe('pointerdown', 20, 20);          // 第 0 行 0 列
  pe('pointermove', 30, 20);          // 跟手 10px（未达 24 阈值）
  eqDeep(drags[drags.length - 1], [10, 0], '小位移也要跟手');
  eq(swaps.length, 0, '未过阈值不该交换');
  pe('pointermove', 400, 20);         // 远超一格
  eqDeep(drags[drags.length - 1], [40, 0], '偏移被夹在一格内');
  pe('pointermove', 60, 20);          // 过阈值 → 成交换
  eqDeep(swaps[0], [0, 0, 0, 1], '应交换到右邻格');
  eqDeep(ends, [false], '换出去就不该回弹');
  inp.setLocked(true);
  drags.length = 0;
  pe('pointerdown', 20, 20); pe('pointermove', 60, 20);
  eq(drags.length, 0, '动画锁定期完全不响应拖动');
});
ok('未达阈值就松手 → 回弹（snap=true）且不产生交换', () => {
  const cv = document.getElementById('board');
  cv.getBoundingClientRect = () => ({ left: 0, top: 0, width: 320, height: 320, right: 320, bottom: 320 });
  const swaps = [], ends = [];
  const inp = new BoardInput(cv, {
    getMetrics: () => ({ ox: 0, oy: 0, cs: 40 }),
    onSwap: (...a) => swaps.push(a),
    onDragEnd: (d, snap) => ends.push(snap),
  });
  const pe = (type, x, y) => cv.dispatchEvent(new window.MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }));
  pe('pointerdown', 20, 20);
  pe('pointermove', 28, 20);          // 8px，未过阈值
  pe('pointerup', 28, 20);
  eq(swaps.length, 0, '轻点不该触发交换');
  eqDeep(ends, [true], '松手要回弹');
  inp.setLocked(true);
});

// ===== 22. 渲染层拖拽状态（跟手绘制的数据源） =====
const { BoardRenderer } = await import('../js/ui/render.js');
ok('setDrag 镜像偏移并取消回弹；endDrag(snap) 起回弹补间且会自行收尾', () => {
  const r = new BoardRenderer();
  r.board = { grid: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => ({ color: 0 }))) };

  r.setDrag({ r: 2, c: 3, ox: 12, oy: 0 });
  eq(r.drag.ox, 12, '偏移写入');
  eqDeep([r.drag.r, r.drag.c], [2, 3], '记住被拖的格');
  r.setDrag({ r: 2, c: 3, ox: 25, oy: 0 });
  eq(r.drag.ox, 25, '同一格继续拖应更新偏移');

  r.endDrag({ r: 2, c: 3, ox: 25, oy: 0 }, false);
  eq(r.drag, null, '换出去后不该再有拖拽态');
  eq(r._dragSnap, null, '换出去不该回弹');

  r.endDrag({ r: 2, c: 3, ox: 20, oy: 0 }, true);
  assert.ok(r._dragSnap, '松手未换出应起回弹');
  const v0 = r._dragView(r._dragSnap.t0);
  eq(Math.round(v0.ox), 20, '回弹起点=松手处');
  const vMid = r._dragView(r._dragSnap.t0 + 75);
  assert.ok(vMid.ox < 20 && vMid.ox > 0, '回弹中应收敛');
  const vEnd = r._dragView(r._dragSnap.t0 + 999);
  eq(vEnd, null, '回弹结束应清空');
  eq(r._dragSnap, null, '回弹结束后不留状态');

  r.setDrag({ r: 1, c: 1, ox: 5, oy: 5 });
  const a = r._dragView(performance.now());
  const b = r._dragView(performance.now() + 8);
  assert.ok(a === b, '每帧复用同一对象，不产生 GC 压力');
  r.drag = null;
});

console.log(process.exitCode ? '\nSOME FAILED' : `\nALL GREEN: ${passed} tests passed`);
setTimeout(() => process.exit(process.exitCode || 0), 50); // 定时器/rAF 不阻塞退出
