// input.js — 触摸/鼠标输入（滑动交换 + 拖拽跟手 + 目标选格）
// 使用 Pointer Events 自动兼容鼠标与触摸；防抖：动画播放中锁输入。

const SWIPE_THRESHOLD = 24; // 滑动判定阈值 px

export class BoardInput {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} opts
   *   onSwap(r1,c1,r2,c2)     滑动交换回调（仅相邻格）
   *   onPickCell(r,c)         目标选择模式下点击格子回调
   *   isPickMode()            是否处于目标选择模式（此时点按不触发交换）
   *   getMetrics()            可选：{ox,oy,cs} 由渲染器提供坐标换算
   *   onDrag({r,c,ox,oy})     拖动中回调（ox/oy 为跟手像素偏移，渲染器按帧读取）
   *   onDragEnd(drag, snap)   拖拽结束；snap=true 表示没换出去、需要回弹
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.opts = opts;
    this.locked = false;      // 动画播放中锁输入
    this._start = null;       // {r,c}
    this.drag = null;         // {r,c,ox,oy} 跟手中的棋子
    this._sx = 0; this._sy = 0;

    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => this._down(e), { passive: false });
    canvas.addEventListener('pointermove', (e) => this._move(e), { passive: false });
    canvas.addEventListener('pointerup', (e) => this._up(e), { passive: false });
    canvas.addEventListener('pointercancel', () => this._cancel());
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setLocked(v) { this.locked = !!v; }

  /** 屏幕坐标 → 棋盘格；出界返回 null */
  _cellOf(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    let ox, oy, cs;
    const m = this.opts.getMetrics ? this.opts.getMetrics() : null;
    if (m && m.cs > 0) {
      ox = m.ox; oy = m.oy; cs = m.cs;
    } else {
      cs = Math.min(rect.width, rect.height) / 8;
      ox = (rect.width - cs * 8) / 2;
      oy = (rect.height - cs * 8) / 2;
    }
    const c = Math.floor((clientX - rect.left - ox) / cs);
    const r = Math.floor((clientY - rect.top - oy) / cs);
    if (r < 0 || c < 0 || r > 7 || c > 7) return null;
    return { r, c };
  }

  _down(e) {
    if (this.locked) return;
    e.preventDefault();
    const cell = this._cellOf(e.clientX, e.clientY);
    this._sx = e.clientX; this._sy = e.clientY;
    this._start = cell;
    this.drag = (cell && !this._isPick()) ? { r: cell.r, c: cell.c, ox: 0, oy: 0 } : null;
    if (canvas$setPointerCapture(this.canvas, e)) { /* 捕获成功 */ }
  }

  /** 跟手偏移：只跟主轴、限制在一格内，避免拖出两格还挂着 */
  _trackDrag(dx, dy) {
    const d = this.drag;
    if (!d) return;
    const m = this.opts.getMetrics ? this.opts.getMetrics() : null;
    const cs = (m && m.cs > 0) ? m.cs : 40;
    if (Math.abs(dx) >= Math.abs(dy)) {
      d.ox = Math.max(-cs, Math.min(cs, dx)); d.oy = 0;
    } else {
      d.ox = 0; d.oy = Math.max(-cs, Math.min(cs, dy));
    }
    if (this.opts.onDrag) this.opts.onDrag(d);
  }

  _endDrag(snap) {
    const d = this.drag;
    this.drag = null;
    if (d && this.opts.onDragEnd) this.opts.onDragEnd(d, !!snap);
  }

  _move(e) {
    if (this.locked || !this._start) return;
    if (this._isPick()) return; // 选择模式只认点按
    const dx = e.clientX - this._sx;
    const dy = e.clientY - this._sy;
    this._trackDrag(dx, dy);
    if (Math.hypot(dx, dy) < SWIPE_THRESHOLD) return;
    const from = this._start;
    let r2 = from.r, c2 = from.c;
    if (Math.abs(dx) > Math.abs(dy)) c2 += dx > 0 ? 1 : -1;
    else r2 += dy > 0 ? 1 : -1;
    this._start = null;
    if (r2 < 0 || c2 < 0 || r2 > 7 || c2 > 7) return; // 滑出棋盘忽略
    this._endDrag(false);
    this._fireSwap(from.r, from.c, r2, c2);
  }

  _up(e) {
    const from = this._start;
    this._start = null;
    if (this.locked || !from) { this._endDrag(true); return; }
    const to = this._cellOf(e.clientX, e.clientY);
    if (!to) { this._endDrag(true); return; }
    // 目标选择模式：点按选格
    if (this._isPick()) {
      this._endDrag(true);
      if (this.opts.onPickCell) this.opts.onPickCell(to.r, to.c);
      return;
    }
    // 点按相邻格 = 交换（对鼠标玩家友好）
    const dr = Math.abs(to.r - from.r), dc = Math.abs(to.c - from.c);
    if (dr + dc === 1) {
      this._endDrag(false);
      this._fireSwap(from.r, from.c, to.r, to.c);
    } else {
      this._endDrag(true);
    }
  }

  _cancel() { this._start = null; this._endDrag(true); }

  _isPick() { return !!(this.opts.isPickMode && this.opts.isPickMode()); }

  _fireSwap(r1, c1, r2, c2) {
    if (this.opts.onSwap) this.opts.onSwap(r1, c1, r2, c2);
  }
}

function canvas$setPointerCapture(canvas, e) {
  try {
    if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
    return true;
  } catch (_) { return false; }
}
