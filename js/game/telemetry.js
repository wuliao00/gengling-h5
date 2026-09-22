// js/game/telemetry.js —— 关卡体验埋点（本地环形缓冲，不联网、不上传）
//
// 为什么要它：这一轮用模拟器量出来的胜率是"模型值"，模型比真实新手强，
// 所以那些 83%~99% 只能保证相对排序和"能不能通关"，绝对数值必须靠真人数据校准。
// 没有这层数据，难度调优永远是猜。
//
// 隐私边界（重要）：只存关卡 id、结果、步数差、道具名这类**游戏内事实**，
// 不碰任何设备标识、位置、账号信息；上限 400 条，超出丢最旧的，且全部留在
// 本机 localStorage。开发者面板有"清空"入口。
//
// 提供三张现成报表（对应那份三消设计文档第四节）：
//   1) 关卡流失热力图：每关的失败率 + "最后一次事件停在第几关"
//   2) 失败原因分解：步数耗尽 / 全队倒下 / 主动退出 / 时间到
//   3) 复活漏斗：弹窗曝光 → 点击 → 点击后是否通关

const KEY = 'gengling.telemetry.v1';
const MAX = 400;

let buf = [];
let loaded = false;

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) buf = JSON.parse(raw) || [];
  } catch (_) { buf = []; }
  if (!Array.isArray(buf)) buf = [];
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(buf.slice(-MAX))); } catch (_) { /* 配额满就丢，不影响玩法 */ }
}

/**
 * 记一条事件。
 * @param {string} event 例如 level_start / level_end / revive_show / revive_tap
 * @param {object} data  只放游戏内事实，别放任何标识符
 */
export function log(event, data = {}) {
  try {
    load();
    buf.push({ t: Date.now(), e: event, ...data });
    if (buf.length > MAX) buf = buf.slice(-MAX);
    save();
  } catch (_) { /* 埋点绝不能把游戏搞崩 */ }
}

export function all() { load(); return buf.slice(); }

export function clear() { buf = []; try { localStorage.removeItem(KEY); } catch (_) {} }

/** 今日是否已经用过免费复活（用日期串判定，跨天自动重置） */
function today() { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }
export function freeReviveUsedToday() { load(); return buf.some(x => x.e === 'revive_free_used' && x.day === today()); }
export function markFreeReviveUsed() { load(); buf.push({ t: Date.now(), e: 'revive_free_used', day: today() }); save(); }

/**
 * 三张报表一次算完，供开发者面板显示 / 导出。
 */
export function summary() {
  load();
  const byLevel = new Map();
  const ensure = (id) => {
    if (!byLevel.has(id)) byLevel.set(id, { starts: 0, wins: 0, fails: 0, reasons: {}, reviveShow: 0, reviveTap: 0, reviveThenWin: 0 });
    return byLevel.get(id);
  };
  let lastLevelId = null;
  for (const x of buf) {
    const id = x.level != null ? x.level : null;
    if (x.e === 'level_start' && id != null) { ensure(id).starts++; lastLevelId = id; }
    else if (x.e === 'level_end' && id != null) {
      const r = ensure(id);
      if (x.win) r.wins++; else { r.fails++; r.reasons[x.reason || 'unknown'] = (r.reasons[x.reason || 'unknown'] || 0) + 1; }
      if (x.revived) r.reviveThenWin++;
      lastLevelId = id;
    }
    else if (x.e === 'revive_show' && id != null) ensure(id).reviveShow++;
    else if (x.e === 'revive_tap' && id != null) ensure(id).reviveTap++;
  }

  const rows = [...byLevel.entries()]
    .map(([id, v]) => ({
      id, ...v,
      winRate: v.starts ? +(v.wins / v.starts * 100).toFixed(0) : null,
    }))
    .sort((a, b) => a.id - b.id);

  const reasons = {};
  for (const r of rows) for (const [k, n] of Object.entries(r.reasons)) reasons[k] = (reasons[k] || 0) + n;

  const reviveShow = rows.reduce((a, r) => a + r.reviveShow, 0);
  const reviveTap = rows.reduce((a, r) => a + r.reviveTap, 0);

  // 流失点：事件里最后出现的关卡（本地没有服务端，只能给"最后一次玩到第几关"）
  return {
    events: buf.length,
    rows,
    failReasons: reasons,
    funnel: { reviveShow, reviveTap, tapRate: reviveShow ? +(reviveTap / reviveShow * 100).toFixed(0) : null },
    lastPlayedLevel: lastLevelId,
    worst: rows.filter(r => r.starts >= 3).sort((a, b) => (a.winRate ?? 100) - (b.winRate ?? 100)).slice(0, 8),
  };
}

/** 纯文本版，方便在开发者面板里直接复制走 */
export function report() {
  const s = summary();
  const lines = [`埋点条数 ${s.events}　最后玩到 #${s.lastPlayedLevel ?? '-'}`];
  lines.push('', '【失败原因分解】');
  for (const [k, n] of Object.entries(s.failReasons)) lines.push(`  ${k}: ${n}`);
  lines.push('', '【复活漏斗】', `  曝光 ${s.funnel.reviveShow} → 点击 ${s.funnel.reviveTap}` +
    (s.funnel.tapRate != null ? `（点击率 ${s.funnel.tapRate}%）` : ''));
  lines.push('', '【胜率最低的关（至少玩过 3 次）】');
  for (const r of s.worst) lines.push(`  #${r.id} 玩 ${r.starts} 次 胜率 ${r.winRate}% 原因 ${JSON.stringify(r.reasons)}`);
  return lines.join('\n');
}
