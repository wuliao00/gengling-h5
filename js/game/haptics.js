// haptics.js — 关键事件震动反馈（H5 用 navigator.vibrate，桌面浏览器自动忽略）
// 开关状态存在 progress.haptics（默认开）。只用于重事件，避免高频震动导致手感疲劳与耗电。

import { Meta } from './meta.js';

const PATTERNS = {
  faint: [40, 30, 60],        // 我方成员倒下：两下重击
  kill: [25],                 // 击溃敌人：短促一下
  bossSkill: [30],            // Boss 放技能：中等一下
  charge: [15, 40, 15],       // 蓄力预警：三下提示
  rage: [60, 40, 120],        // 狂暴阶段：长-短-长
  win: [20, 40, 20, 40, 60],  // 通关：上扬节奏
  lose: [120, 60, 120],       // 失败：两下重击
};

export const Haptics = {
  PATTERNS,
  get enabled() {
    const s = Meta.get();
    return !s || !s.progress || s.progress.haptics !== false;
  },
  set(v) {
    const s = Meta.get();
    if (!s) return;
    s.progress.haptics = !!v;
    Meta.persist();
  },
  toggle() {
    const next = !this.enabled;
    this.set(next);
    return next;
  },
  /** kind 取 PATTERNS 的键；不支持或已关闭时无操作 */
  pulse(kind) {
    const p = PATTERNS[kind];
    if (!p || !this.enabled) return false;
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') return navigator.vibrate(p);
    } catch (e) { /* 部分浏览器会拒绝调用，忽略 */ }
    return false;
  },
};
