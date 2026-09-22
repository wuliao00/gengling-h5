// scenes.js — 场景管理器 + 7 大场景的 DOM 模板与逻辑
// 由 main.js 注入 game 对象（战斗流程控制器），数据读 Meta/Save。

import { prepCanvas, drawAvatarInto as _legacyAvatar, drawMonsterInto, drawLogo } from './render.js';
import { drawAvatar, drawAvatarAnim, drawPortrait } from './avatars.js';
import { renderWorldMap, chLabel } from './map.js';
import { CHARACTERS, RESONANCES } from '../data/characters.js';
import { CHAPTERS } from '../data/levels.js';
import { ITEMS, GIFTS } from '../data/items.js';
import { Meta, EXP_TABLE, STAR_COSTS, UNLOCK_SHARDS, ENERGY_MAX } from '../game/meta.js';
import { Save } from '../game/save.js';
import { Sfx, Bgm } from '../game/sfx.js';
import { DevGuard } from '../game/devguard.js';
import { Haptics } from '../game/haptics.js';
import * as Tele from '../game/telemetry.js';

// Q 版立绘便捷封装（画进指定 canvas）
function drawAvatarInto(canvas, charId, size, opts) {
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  drawAvatar(ctx, charId, size / 2, size / 2, size * 0.94, opts);
}

const COLOR_NAMES = ['红', '蓝', '绿', '黄', '紫', '橙', '彩'];
const CHAR_DEF = Object.fromEntries(CHARACTERS.map(c => [c.id, c]));
// 主页轮换曲目（3 首不同风格）
const HOME_TRACKS = ['menu', 'menu2', 'menu3'];
let _homeTrackIdx = 0;

// ============ 通用小工具 ============
function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
function esc(s) { return String(s ?? '').replace(/[<>&"]/g, m => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[m])); }
function todayKey() { const d = new Date(); return `${d.getFullYear()}${d.getMonth() + 1}${d.getDate()}`; }
function goldText(n) { return n >= 10000 ? (n / 10000).toFixed(1) + 'w' : String(n); }

// 关卡目标描述
export function goalText(level) {
  const g = level.goal || {};
  const cn = (i) => COLOR_NAMES[i] || '?';
  switch (g.kind) {
    case 'collect':
      if (Array.isArray(g.list)) return g.list.map(p => `${cn(p.color)}色方块×${p.count}`).join(' + ');
      if (g.color == null) return `消除 ${g.count} 个方块`;
      return `消除 ${g.count} 个${cn(g.color)}色方块${g.time ? `（限时 ${g.time} 秒）` : ''}`;
    case 'fourMatch': return `触发 ${g.count} 次 4 连消（产生炸弹）`;
    case 'fiveMatch': return `触发 ${g.count} 次 5 连消（产生彩虹球）`;
    case 'bombClear': return `用炸弹消除 ${g.count} 个方块`;
    case 'rainbowRed': return `用彩虹球消除${cn(g.color)}色方块`;
    case 'score': return `获得 ${g.score} 分`;
    case 'timed': return `${g.time} 秒内获得 ${g.score} 分`;
    case 'enemy': return (level.enemies || []).map(e => `击败${e.name}`).join(' + ');
    case 'chainClear': return `解除全部 ${g.count} 个锁链方块`;
    case 'treasure': return `触发 ${g.count} 次宝箱`;
    case 'floatClear': return `消除 ${g.count} 个浮空方块`;
    case 'silentClear': return `消除 ${g.count} 个静音区方块`;
    case 'clearEcho': return `消除全部 ${g.count} 个回声石`;
    case 'subClear': return `消除 ${g.count} 个子方块`;
    case 'slot': return `触发 ${g.count} 次老虎机`;
    case 'gamble': return '选择高风险模式通关';
    case 'combo': return (g.parts || []).map(p => goalText({ goal: p, enemies: level.enemies })).join(' + ');
    default: return '完成关卡目标';
  }
}

// ============ 场景管理器 ============
export const Scenes = {
  game: null,
  current: '',
  _timers: [],

  init(game) {
    this.game = game;
    this.show('home');
  },

  clearTimers() {
    for (const t of this._timers) clearInterval(t);
    this._timers = [];
  },

  show(name) {
    this.clearTimers();
    this.current = name;
    document.querySelectorAll('.scene').forEach(s => s.classList.remove('active'));
    const node = document.getElementById('scene-' + name);
    if (!node) return;
    node.classList.add('active');
    document.getElementById('app').classList.toggle('in-battle', name === 'battle');
    // 换页要有"翻页"声：以前只有全局 click，切场景本身是哑的，玩家不确定进没进去
    // 首帧（启动自动 show('home')）不播，否则一开机就响
    if (this._sceneBooted) Sfx.play('pageflip');
    this._sceneBooted = true;
    this.setAppBar(name);
    const fn = this['render_' + name];
    if (fn) fn.call(this, node);
    updateTopbar();
    // V5 BGM：按场景切换曲目 + 翻页音
    if (name !== 'battle') {
      Sfx.play('page');
      let track;
      if (name === 'home') {
        track = HOME_TRACKS[_homeTrackIdx++ % HOME_TRACKS.length];   // 主页轮换 3 首
      } else if (name === 'map' && this._mapChapter === 8) {
        track = 'event';                                             // 隐藏章「梗灵之巅」专属曲
      } else {
        track = { map: 'map', shop: 'shop', chars: 'menu', lineup: 'menu', result: 'result' }[name] || 'menu';
      }
      Bgm.play(track);
    }
  },

  /** 全局顶栏：标题 + 左侧返回/暂停位 + 右侧资源胶囊（各页不再自绘标题栏） */
  setAppBar(name) {
    document.body.dataset.scene = name;
    // Boss 关切战斗背景图（CSS 靠 body[data-boss] 选图），非战斗场景一律归零
    const isBoss = name === 'battle' && !!(this.game.level && this.game.level.boss);
    document.body.dataset.boss = isBoss ? '1' : '0';
    const title = document.getElementById('tbTitle');
    if (title) {
      title.hidden = name === 'home';   // 首页有大 logo，顶栏不再重复一次字标
      title.textContent = this.appTitle(name);
    }
    const back = document.getElementById('tbBack');
    if (back) {
      back.hidden = name === 'home';
      back.classList.toggle('is-pause', name === 'battle');
      back.textContent = name === 'battle' ? '⏸' : '‹';
      back.setAttribute('aria-label', name === 'battle' ? '暂停' : '返回');
      back.onclick = () => { if (name === 'battle') this.openPause(); else this.back(); };
    }
    const res = document.getElementById('tbRes');
    if (res) res.hidden = name === 'battle';
  },

  appTitle(name) {
    if (name === 'home') return '梗灵大陆';
    if (name === 'battle') {
      const lv = this.game.level;
      if (!lv) return '战斗';
      if (this.game.run) return this.game.run.isBossRush ? `Boss Rush · 第${this.game.run.wave}场` : `无尽 · 第${this.game.run.wave}波`;
      return `第${lv.id}关 · ${lv.name}`;
    }
    if (name === 'map') {
      // 顶栏只留"第N章"：完整章节名下面那排章节 tab 已经原样显示过了，
      // 这里再写全名会在 360 CSS px 真机上被挤成「第一章 · …」。
      const ch = (CHAPTERS || []).find(c => c.id === (this._mapChapter || 1));
      return ch ? chLabel(ch.id) : '世界地图';
    }
    return { lineup: '出战准备', chars: '梗灵图鉴', shop: '道具商店', result: '战斗结算' }[name] || '梗灵大陆';
  },

  /** 统一的返回路径 */
  back() {
    const from = this.current;
    if (from === 'lineup') return this.show('map');
    if (from === 'map' || from === 'chars' || from === 'shop' || from === 'result') return this.show('home');
  },

  /** 暂停菜单（顶栏 ⏸ 打开；音效开关后重开以刷新文案） */
  openPause() {
    const g = this.game;
    const prevTrack = Bgm.want;      // 暂停前正在播的战斗曲，恢复时续上
    Bgm.play('pause');
    const open = () => {
      const inRun = !!g.run;
      this._pauseMask && this._pauseMask.remove();
      this._pauseMask = modalBox(
        `<div class="mb-title">⏸ 暂停</div><div class="mb-text">${inRun ? '放弃后本局进度结束，回到首页（不影响主线关卡）' : '要继续战斗还是放弃本关？'}</div>`, [
        { text: '继续战斗', cls: 'btn-primary', fn: () => Bgm.play(prevTrack || 'normal') },
        { text: Sfx.muted ? '🔇 音效：关（点开）' : '🔊 音效：开（点关）', cls: 'btn-soft', fn: () => {
          Sfx.setMuted(!Sfx.muted);
          Meta.get().progress.muted = Sfx.muted;
          Meta.persist();
          open();
        } },
        { text: '放弃离开', cls: 'btn-red', fn: () => g.quitBattle() },
      ]);
    };
    open();
  },

  // ============================================================
  // HOME
  // ============================================================
  render_home(node) {
    node.innerHTML = `
      <div class="home-wrap">
        <canvas class="home-logo" id="homeLogo"></canvas>
        <canvas class="home-mascot" id="homeMascot"></canvas>
        <div class="home-energy-card card">
          <div class="stat-line"><span>⚡ 体力</span><b id="homeEnergy">--/--</b></div>
          <div class="bar"><i id="homeEnergyBar" style="width:0%"></i></div>
          <div class="home-tip" id="homeEnergyTip"></div>
          <button class="btn btn-mini btn-potion" id="btnPotion"></button>
        </div>
        <div class="home-btns">
          <button class="btn btn-big btn-primary" id="btnStart">开始冒险 ▶</button>
          <button class="btn btn-big btn-green" id="btnEndless"><span class="inf">∞</span> 无尽模式 <span class="dim" id="endlessBest"></span></button>
          <button class="btn btn-big btn-lav" id="btnBossRush">👑 Boss Rush <span class="dim" id="bossRushBest"></span></button>
          <div class="home-row">
            <button class="btn btn-soft" id="btnChars">梗灵图鉴</button>
            <button class="btn btn-soft" id="btnBag">🎒 背包</button>
            <button class="btn btn-soft" id="btnShop">道具商店</button>
          </div>
          <div class="home-row home-row-util">
            <button class="btn btn-ghost" id="btnMute">🔊 音效</button>
            <button class="btn btn-ghost" id="btnHaptic">📳 震动</button>
            <button class="btn btn-ghost" id="btnReset">🗑 重置</button>
            ${Meta.get().progress.dev && !DevGuard.isBanned() ? '<button class="btn btn-dev" id="btnDev" title="开发者面板">🛠</button>' : ''}
          </div>
        </div>
      </div>`;
    // V5 能量瓶：立即恢复 10 点体力
    const potBtn = document.getElementById('btnPotion');
    const syncPotion = () => {
      const n = Meta.get().items.energyPotion || 0;
      potBtn.textContent = `🧪 能量瓶×${n}（+10体力）`;
      potBtn.disabled = n <= 0;
    };
    syncPotion();
    potBtn.onclick = () => {
      const s = Meta.get();
      if ((s.items.energyPotion || 0) <= 0) { toast('没有能量瓶啦，去商店买吧～'); return; }
      if (s.energy >= ENERGY_MAX) { toast('体力已经满啦！'); return; }
      s.items.energyPotion--;
      s.energy = Math.min(ENERGY_MAX, s.energy + 10);
      s.energyTs = Date.now();
      Meta.persist();
      Sfx.play('energy');
      toast('🧪 咕嘟咕嘟…体力 +10！');
      syncPotion(); upd();
    };
    // V5 开发者面板
    const devBtn = document.getElementById('btnDev');
    if (devBtn) devBtn.onclick = () => askDevPassword(() => openDevPanel(this));
    drawLogo(document.getElementById('homeLogo'), 280, 131);
    drawAvatarInto(document.getElementById('homeMascot'), 'hajimiao', 120);
    const s0 = Meta.get();
    const best = s0.progress.endlessBest || 0;
    document.getElementById('endlessBest').textContent = best ? `最佳${best}波` : '';
    const brBest = s0.progress.bossRushBest || 0;
    document.getElementById('bossRushBest').textContent = brBest ? `最佳${brBest}场` : '';
    const muteBtn = document.getElementById('btnMute');
    const syncMute = () => { muteBtn.textContent = Sfx.muted ? '🔇 音效·关' : '🔊 音效·开'; };
    syncMute();
    muteBtn.onclick = () => {
      Sfx.setMuted(!Sfx.muted);
      s0.progress.muted = Sfx.muted;
      Meta.persist();
      syncMute();
      // 开关用一对上下行的双音：闭眼也分得清是开了还是关了
      if (!Sfx.muted) { Sfx.play('toggle_on'); Bgm.kick(); }
      else Sfx.play('toggle_off');
    };
    const hBtn = document.getElementById('btnHaptic');
    const syncHaptic = () => { hBtn.textContent = Haptics.enabled ? '📳 震动·开' : '📴 震动·关'; };
    syncHaptic();
    hBtn.onclick = () => {
      const on = Haptics.toggle();
      syncHaptic();
      Sfx.play(on ? 'toggle_on' : 'toggle_off');
      if (on) { Sfx.unlock(); Haptics.pulse('kill'); toast('📳 震动已开启', 1000); }
      else toast('📴 震动已关闭', 1000);
    };
    document.getElementById('btnEndless').onclick = () => {
      Sfx.unlock();
      modalConfirm('∞ 无尽模式', `肉鸽闯关：每波通关后可三选一强化词条，敌人一波比一波强，波间存活者回复 20% 血量。本波倒下的梗灵整局不会复活（选到复活币除外），全员倒下即结束。当前最佳：${best} 波。不消耗体力，失败不影响关卡进度。`, () => this.game.startEndless());
    };
    document.getElementById('btnBossRush').onclick = () => {
      Sfx.unlock();
      modalConfirm('👑 Boss Rush', `连续挑战 8 章 Boss 的强化版（血量 ×1.6，必带狂暴阶段）。每场通关同样三选一强化。当前最佳：${brBest} 场。全通额外奖励 1500 金币与「梗灵之王」称号。不消耗体力。`, () => this.game.startBossRush());
    };
    document.getElementById('btnStart').onclick = () => this.show('map');
    document.getElementById('btnChars').onclick = () => this.show('chars');
    document.getElementById('btnShop').onclick = () => this.show('shop');
    document.getElementById('btnBag').onclick = () => openBackpack();
    document.getElementById('btnReset').onclick = () => {
      modalConfirm('重置存档', '所有进度、角色、金币都会消失，确定要重来吗？', () => {
        Save.reset(); Meta.init(); toast('存档已重置，新的冒险开始啦！');
        this.show('home');
      });
    };
    const upd = () => {
      Meta.energy.regen();
      const s = Meta.get();
      const e1 = document.getElementById('homeEnergy');
      if (!e1) return;
      e1.textContent = `${s.energy}/${ENERGY_MAX}`;
      document.getElementById('homeEnergyBar').style.width = (s.energy / ENERGY_MAX * 100) + '%';
      if (s.energy >= ENERGY_MAX) document.getElementById('homeEnergyTip').textContent = '体力满满，冲鸭！';
      else {
        const s2 = Meta.get();
        const wait = Math.max(0, Math.ceil((5000 * 60 - (Date.now() - (s2.energyTs || Date.now()))) / 1000));
        document.getElementById('homeEnergyTip').textContent = `每 5 分钟恢复 1 点，下一滴还有 ${fmtSec(wait)}`;
      }
      updateTopbar();
    };
    upd();
    this._timers.push(setInterval(upd, 1000));
  },

  // ============================================================
  // MAP（世界地图：蜿蜒路径 + 关卡节点 + 章节主题背景）
  // ============================================================
  render_map(node) {
    const s = Meta.get();
    const chapterUnlocked = (ch) => {
      if (!ch.unlock) return true;
      if (ch.id === 8) {
        const ids = CHARACTERS.map(c => c.id);
        return ids.every(id => s.chars[id] && s.chars[id].unlocked && s.chars[id].level >= 15);
      }
      const prev = CHAPTERS.find(c => c.id === ch.id - 1);
      if (!prev) return true;
      const lvIds = Meta.levels.filter(l => l.chapter === prev.id).map(l => l.id);
      if (lvIds.every(id => (s.levelStars[id] || 0) > 0)) return true;
      // V5 兜底：关卡进度已越过上一章最后一关 ⇒ 上一章必然已通关（防老存档星级缺失）
      const prevLast = Math.max(...lvIds);
      return (s.unlockedLevels || 1) > prevLast;
    };
    node.innerHTML = '';
    renderWorldMap(node, {
      levels: Meta.levels,
      chapters: CHAPTERS,
      chapterUnlocked,
      levelStars: (id) => s.levelStars[id] || 0,
      unlockedLevels: s.unlockedLevels,
      currentChapter: this._mapChapter || 1,
      setChapter: (id) => { this._mapChapter = id; },
      onSelect: (levelId) => { this._levelId = levelId; this.show('lineup'); },
    });
  },

  // ============================================================
  // LINEUP（战前编队）
  // ============================================================
  render_lineup(node) {
    const s = Meta.get();
    const level = Meta.findLevel(this._levelId || 1);
    if (!level) { this.show('map'); return; }
    const power = level.power || 0;
    const teamPower = Math.round(Meta.teamPower());
    const warn = teamPower < power * 0.8;

    const itemKeys = ['hammer', 'crossBomb', 'colorBottle', 'extraSteps', 'shield', 'shieldMax', 'shieldProMax', 'shieldUltra'];
    this._lineupItems = this._lineupItems || {};

    node.innerHTML = `
      <div class="lineup-wrap">
        <div class="card lv-card">
          <div class="lv-card-head"><b>第${level.id}关 · ${esc(level.name)}</b>${level.boss ? '<span class="boss-tag">👑 Boss关</span>' : ''}</div>
          <div class="stat-line"><span>🎯 目标</span><b>${esc(goalText(level))}</b></div>
          <div class="stat-line"><span>👟 步数</span><b>${level.steps > 0 ? level.steps + ' 步' : (level.goal.time ? '限时 ' + level.goal.time + ' 秒' : '无限')}</b></div>
          ${(level.enemies || []).length ? `<div class="stat-line"><span>👹 敌人</span><b>${level.enemies.map(e => `${esc(e.name)}(${e.hp}HP)`).join('、')}</b></div>` : ''}
          <div class="stat-line"><span>⚔️ 战力</span><b class="${warn ? 'power-warn' : 'power-ok'}">我方 ${teamPower} / 推荐 ${power}</b></div>
          ${level.tutorial ? `<div class="tutorial-bubble">💡 ${esc(level.tutorial)}</div>` : ''}
        </div>
        <div class="card">
          <div class="lv-card-head"><b>出战梗灵（点击更换）</b></div>
          <div class="team-slots" id="teamSlots"></div>
          <div class="reso-line" id="resoLine"></div>
        </div>
        <div class="card">
          <div class="lv-card-head"><b>携带道具</b></div>
          <div class="item-checks" id="itemChecks"></div>
        </div>
        <button class="btn btn-big btn-primary lineup-fight" id="btnFight">开 战 !</button>
      </div>`;


    const slots = document.getElementById('teamSlots');
    const renderSlots = () => {
      slots.innerHTML = '';
      s.team.forEach((id, i) => {
        const d = id ? CHAR_DEF[id] : null;
        const slot = el(`<button class="team-slot ${id ? 'filled' : ''}">${id ? '' : '+'}</button>`);
        if (d) {
          const cv = document.createElement('canvas');
          cv.width = 72; cv.height = 72;
          slot.appendChild(cv);
          drawAvatarInto(cv, d.id, 72);
          const tag = el(`<span class="slot-name">${d.name} Lv${s.chars[id].level}</span>`);
          slot.appendChild(tag);
        }
        slot.onclick = () => {
          pickCharModal(d ? d.id : null, (pickId) => {
            if (pickId === null) { s.team[i] = null; Sfx.play('deselect'); }
            else if (!s.team.includes(pickId)) { s.team[i] = pickId; Sfx.play('select'); }
            Meta.persist(); renderSlots(); renderReso();
          });
        };
        slots.appendChild(slot);
      });
    };
    const renderReso = () => {
      const ids = s.team.filter(Boolean);
      const act = RESONANCES.filter(r => r.chars.every(c => ids.includes(c)));
      document.getElementById('resoLine').innerHTML =
        act.length ? '✨ 共鸣：' + act.map(r => `<b>${r.name}</b>`).join('、') : '<span class="dim">队内凑齐搭档可触发共鸣哦～</span>';
    };
    renderSlots(); renderReso();

    const checks = document.getElementById('itemChecks');
    for (const k of itemKeys) {
      const n = s.items[k] || 0;
      if (n <= 0) this._lineupItems[k] = false;   // 道具清零后别残留"已选中"状态
      const on = !!this._lineupItems[k];
      const it = el(`<button type="button" class="item-check ${n > 0 ? '' : 'off'} ${on ? 'on' : ''}" aria-pressed="${on}">
        <i class="ic-tick"></i>${ITEMS[k].name}×${n}</button>`);
      it.onclick = () => {
        if (n <= 0) { Sfx.play('deny'); toast('道具不足，去商店看看吧～'); return; }
        const next = !this._lineupItems[k];
        this._lineupItems[k] = next;
        Sfx.play(next ? 'select' : 'deselect');
        it.classList.toggle('on', next);
        it.setAttribute('aria-pressed', String(next));
      };
      checks.appendChild(it);
    }

    document.getElementById('btnFight').onclick = () => {
      const team = s.team.filter(Boolean);
      if (!team.length) { toast('至少带上 1 只梗灵出战哦！'); return; }
      if (!Meta.energy.cost(1)) { toast('体力不足啦，休息一下吧（5分钟回1点）'); return; }
      this.game.startBattle(level, [...s.team], Object.keys(this._lineupItems).filter(k => this._lineupItems[k]));
    };
  },

  // ============================================================
  // BATTLE（战斗）
  // ============================================================
  render_battle(node) {
    const g = this.game;
    const level = g.level;
    node.innerHTML = `
      <div class="bt-wrap">
        <div class="bt-top">
          <div class="bt-enemies" id="btEnemies"></div>
        </div>
        <div class="bt-goalbar">
          <div class="bt-goal" id="btGoal"></div>
          <div class="bt-turn" id="btTurn"></div>
          <div class="bt-steps" id="btSteps"></div>
          <button class="bt-auto" id="btAutoSkill">🤖自动:关</button>
          <div class="bt-timer" id="btTimer" style="display:none"></div>
        </div>
        <div class="bt-boardbox" id="btBoardBox"><div class="bt-tray"><canvas id="board"></canvas></div></div>
        <div class="bt-playerbar">
          <div class="bt-members" id="btMembers"></div>
        </div>
        <div class="bt-hud">
          <div class="bt-skills" id="btSkills"></div>
          <div class="bt-items" id="btItems"></div>
        </div>
      </div>`;

    // 敌人卡
    this.rebuildEnemies();
    if (g.battle.state.enemies.length === 0) document.getElementById('btEnemies').innerHTML = '<div class="ec-none">🕊 无敌人 · 完成目标即可通关</div>';

    // 战斗内自动技能按钮（需商店解锁）
    const ab = document.getElementById('btAutoSkill');
    if (ab) {
      const unlocked = !!(Meta.get().progress && Meta.get().progress.autoSkillUnlocked);
      const setLbl = () => {
        ab.textContent = unlocked ? (g.autoSkill ? '🤖自动:开' : '🤖自动:关') : '🔒自动';
        ab.classList.toggle('on', !!g.autoSkill);
        ab.classList.toggle('locked', !unlocked);
      };
      setLbl();
      ab.onclick = () => {
        if (!unlocked) { Sfx.play('invalid'); toast('🔒 自动技能需先在商店购买解锁'); return; }
        g.toggleAutoSkill();
        setLbl();
      };
    }

    // 技能按钮（头像 + 招式名标签，点击释放主动技能）
    const sk = document.getElementById('btSkills');
    sk.innerHTML = '';
    g.team.forEach((c, i) => {
      const slot = el(`<div class="skill-slot"></div>`);
      const b = el(`<button class="skill-btn" data-i="${i}"></button>`);
      const cv = document.createElement('canvas'); cv.width = 52; cv.height = 52;
      drawAvatarInto(cv, c.id, 52);
      b.appendChild(cv);
      b.appendChild(el(`<span class="cd-mask" style="display:none"></span><span class="cd-num" style="display:none"></span>`));
      b.title = `主动·${c.skill.name}：${c.skill.desc}`;
      b.onclick = () => g.useSkill(i);
      slot.appendChild(b);
      slot.appendChild(el(`<span class="skill-name">${esc(c.skill.name)}</span>`));
      sk.appendChild(slot);
    });

    // 道具栏（只显示带进来的）
    const iw = document.getElementById('btItems');
    iw.innerHTML = '';
    g.broughtItems.forEach(k => {
      const b = el(`<button class="item-btn" data-k="${k}">${ITEMS[k].name}<b id="itemN_${k}">×${Meta.get().items[k] || 0}</b></button>`);
      b.onclick = () => g.useItem(k);
      iw.appendChild(b);
    });

    // 成员卡片（逐角色 HP）——点击查看主动/被动/觉醒详情；须在绑定棋盘前建好，保证棋盘按最终布局测量
    const mw = document.getElementById('btMembers');
    mw.innerHTML = '';
    g.team.forEach((c) => {
      const card = el(`<div class="member-card" data-id="${c.id}">
        <canvas width="56" height="56"></canvas>
        <div class="mc-bar"><i style="width:100%"></i></div>
        <span class="mc-hp"></span>
      </div>`);
      drawAvatarInto(card.querySelector('canvas'), c.id, 34);
      card.onclick = () => { Sfx.play('select'); showCharInfo(c.id); };
      mw.appendChild(card);
    });

    g.bindBoardUI(document.getElementById('btBoardBox'));

    g.refreshBattleHUD();
  },

  /** 重建敌人条（战斗中召唤新怪后调用） */
  rebuildEnemies() {
    const g = this.game;
    const ew = document.getElementById('btEnemies');
    if (!ew || !g.battle) return;
    ew.innerHTML = '';
    g.battle.state.enemies.forEach((e, i) => {
      const card = el(`<div class="enemy-card ${i === (g.battle.targetIdx || 0) ? 'target' : ''}" data-i="${i}">
        <canvas class="ec-face" width="64" height="64"></canvas>
        <div class="ec-name">${esc(e.name)}</div>
        <div class="hpbar small"><i style="width:${Math.max(0, e.hp / e.maxHp * 100)}%"></i></div>
        <div class="chargebar" style="display:none"><i></i><b></b></div>
      </div>`);
      drawMonsterInto(card.querySelector('canvas'), e.name, 38, 'normal');
      card.onclick = () => {
        Sfx.play('select');
        g.battle.setTarget(i);
        ew.querySelectorAll('.enemy-card').forEach(c => c.classList.remove('target'));
        card.classList.add('target');
      };
      ew.appendChild(card);
    });
  },

  /** 战斗内刷新敌人血条/表情（由 main 调用） */
  refreshEnemies(moodIdx = -1) {
    const g = this.game;
    if (!g.battle) return;
    const cards = document.querySelectorAll('#btEnemies .enemy-card');
    g.battle.state.enemies.forEach((e, i) => {
      const card = cards[i];
      if (!card) return;
      const bar = card.querySelector('.hpbar i');
      bar.style.width = Math.max(0, e.hp / e.maxHp * 100) + '%';
      if (i === moodIdx) {
        const cv = card.querySelector('canvas');
        drawMonsterInto(cv, e.name, 64, e.hp <= 0 ? 'hurt' : 'hurt');
        setTimeout(() => drawMonsterInto(cv, e.name, 64, e.stunned > 0 ? 'stun' : 'normal'), 420);
      } else {
        drawMonsterInto(card.querySelector('canvas'), e.name, 64, e.stunned > 0 ? 'stun' : (e.hp <= 0 ? 'hurt' : 'normal'));
      }
      card.classList.toggle('dead', e.hp <= 0);
      const cb = card.querySelector('.chargebar');
      if (cb) {
        const ch = e.charging;
        cb.style.display = ch ? '' : 'none';
        if (ch) {
          cb.querySelector('i').style.width = Math.max(0, Math.min(100, (1 - ch.left / ch.total) * 100)) + '%';
          cb.querySelector('b').textContent = `⚡${ch.name} ${ch.left}`;
        }
      }
    });
  },

  // ============================================================
  // RESULT（结算）
  // ============================================================
  render_result(node) {
    const g = this.game;
    const r = g.result; // {win, stars, rewards, levelUps, unlocks, chapterBox, diff}
    const win = r.win;
    const s = Meta.get();
    const shards = Object.entries(r.rewards.shards || {});
    const run = r.run || null;                       // 波次闯关（无尽 / Boss Rush）
    const isBR = run && run.mode === 'bossrush';
    const unit = isBR ? '场' : '波';
    node.innerHTML = `
      <div class="result-wrap">
        <div class="result-title ${win ? 'win' : 'lose'}">${run ? (win ? '八场 Boss 全通！' : `止步第 ${run.wave} ${unit}！`) : (win ? (r.stars >= 3 ? '完美通关!' : '通关成功!') : '差一点点…')}</div>
        <div class="stars-row">${win && !run ? [1, 2, 3].map(i => `<span class="star ${i <= r.stars ? 'lit' : 'dim'}">★</span>`).join('') : ''}</div>
        ${win && !run ? '' : `<div class="result-sub">${esc(r.diff || '再试一次一定行！')}</div>`}
        ${run ? `<div class="card result-run-card">${isBR ? '👑 Boss Rush' : '<span class="inf">∞</span> 无尽模式'} · 历史最佳 <b>${run.best}</b> ${unit} · 本局赚了 <b>${run.goldEarned}</b> 金币</div>` : ''}
        ${win && !run ? `
          <div class="reward-list card">
            <div class="reward-row"><span class="reward-ico r-gold"></span>金币 +${r.rewards.gold}</div>
            <div class="reward-row"><span class="reward-ico">🍬</span>小糖果 ×${r.rewards.candy.small}</div>
            ${shards.map(([id, n]) => `<div class="reward-row"><span class="reward-ico">${CHAR_DEF[id] ? CHAR_DEF[id].emoji : '🧩'}</span>${CHAR_DEF[id] ? esc(CHAR_DEF[id].name) : ''}碎片 ×${n}</div>`).join('')}
            ${Object.entries(r.levelUps || {}).map(([id, ups]) => `<div class="reward-row"><span class="reward-ico">⬆️</span>${esc(CHAR_DEF[id].name)} 升到 Lv${ups[ups.length - 1]}</div>`).join('')}
          </div>` : ''}
        ${r.chapterBox ? `<div class="card chap-chest-win">🎁 章节宝箱「${esc(r.chapterBox.name)}」已存入背包！</div>` : ''}
        <div class="result-btns">
          ${run
            ? `<button class="btn btn-green btn-big" id="resRetry">${isBR ? '👑 再挑一次战' : '<span class="inf">∞</span> 再来一局'}</button>`
            : win
              ? `<button class="btn btn-primary btn-big" id="resNext">下一关 ▶</button>`
              : `<button class="btn btn-green btn-big" id="resRetry">免费重试 ↻</button>`}
          <button class="btn btn-soft" id="resBack">${run ? '返回首页' : '返回地图'}</button>
        </div>
      </div>`;
    // 失败时叠加"下雨"氛围背景
    if (!win) {
      const rw = node.querySelector('.result-wrap');
      if (rw) rw.classList.add('lose-rain');
    }
    if (win) {
      // 星星逐个弹出（音效与弹出动画同步）
      const stars = node.querySelectorAll('.star');
      stars.forEach((st, i) => {
        st.style.animationDelay = (i * 0.28) + 's';
        if (i < r.stars) setTimeout(() => Sfx.play('star'), 280 * i + 120);
      });
      if (r.rewards) setTimeout(() => Sfx.play('reward'), 200);
      if (r.chapterBox) setTimeout(() => Sfx.play('chest'), 700);
    }
    if (run) {
      document.getElementById('resRetry').onclick = () => { Sfx.play('confirm'); return isBR ? this.game.startBossRush() : this.game.startEndless(); };
      document.getElementById('resBack').onclick = () => { Sfx.play('back'); this.show('home'); };
      return;
    }
    node.querySelector(win ? '#resNext' : '#resRetry').onclick = () => {
      Sfx.play('confirm');
      const nextId = win ? (g.level.id + 1) : g.level.id;
      const lv = Meta.findLevel(nextId);
      if (win && (!lv || nextId > s.unlockedLevels)) { toast('已是最新进度，去刷新更早的关卡拿三星吧！'); this.show('map'); return; }
      this._levelId = nextId;
      this.show('lineup');
    };
    document.getElementById('resBack').onclick = () => { Sfx.play('back'); this.show('map'); };

    // 新角色解锁展示
    if (r.unlocks && r.unlocks.length) { Sfx.jingle('unlock');
      const id = r.unlocks[0];
      const d = CHAR_DEF[id];
      modalBox(`<div class="unlock-overlay">
        <div class="unlock-title">🎉 新梗灵觉醒！</div>
        <canvas id="unlockAvatar" width="160" height="160"></canvas>
        <div class="unlock-name">${d.name}</div>
        <div class="unlock-quote">"${esc(d.quote[0])}"</div>
      </div>`, [{ text: '太棒了!', cls: 'btn-primary', fn: () => {} }]);
      drawAvatarInto(document.getElementById('unlockAvatar'), id, 160);
    }
  },

  // ============================================================
  // CHARS（图鉴/养成）
  // ============================================================
  render_chars(node) {
    const s = Meta.get();
    node.innerHTML = `
      <div class="chars-wrap">
        <div class="char-list" id="charList"></div>
        <div class="char-detail card" id="charDetail"></div>
      </div>`;
    let sel = this._charSel || 'hajimiao';
    if (!s.chars[sel]) sel = 'hajimiao';

    const list = document.getElementById('charList');
    const renderList = () => {
      list.innerHTML = '';
      for (const d of CHARACTERS) {
        const st = s.chars[d.id];
        const card = el(`<button class="char-card ${d.id === sel ? 'on' : ''} ${st.unlocked ? '' : 'locked'}">
          <canvas width="56" height="56"></canvas>
          <div class="cc-info"><b>${d.name}</b><span>${st.unlocked ? 'Lv' + st.level + ' ' + '★'.repeat(st.star + 1) : '碎片 ' + st.shards + '/' + UNLOCK_SHARDS}</span></div>
        </button>`);
        drawAvatarInto(card.querySelector('canvas'), d.id, 56);
        card.onclick = () => { sel = d.id; this._charSel = d.id; Sfx.play('select'); renderList(); renderDetail(); };
        list.appendChild(card);
      }
    };

    const detail = document.getElementById('charDetail');
    const renderDetail = () => {
      const d = CHAR_DEF[sel];
      const st = s.chars[sel];
      const p = Meta.charPower(sel);
      const expNeed = EXP_TABLE[st.level - 1] || 0;
      const starCost = st.star < 4 ? STAR_COSTS[st.star] : 0;
      const resonance = RESONANCES.filter(r => r.chars.includes(sel));
      if (!st.unlocked) {
        detail.innerHTML = `
          <div class="cd-hero"><canvas id="cdAvatar" width="150" height="150"></canvas></div>
          <div class="cd-name"><b>${d.name}</b><span>${d.role}</span></div>
          <p class="cd-desc">${esc(d.desc)}</p>
          <div class="shard-bar"><i style="width:${Math.min(100, st.shards / UNLOCK_SHARDS * 100)}%"></i><span>${st.shards}/${UNLOCK_SHARDS}</span></div>
          <button class="btn btn-primary btn-big" id="cdUnlock" ${st.shards >= UNLOCK_SHARDS ? '' : 'disabled'}>解锁（30 碎片）</button>`;
        drawPortrait(document.getElementById('cdAvatar'), sel, 108, 108);
        document.getElementById('cdUnlock').onclick = () => {
          if (Meta.unlockChar(sel)) { toast(`${d.name} 加入了队伍！`); renderList(); renderDetail(); }
          else toast('碎片不够啦～');
        };
        return;
      }
      detail.innerHTML = `
        <div class="cd-hero"><canvas id="cdAvatar" width="150" height="150"></canvas></div>
        <div class="cd-name"><b>${d.name}</b><span>${d.role} · Lv${st.level}/30 · ${'★'.repeat(st.star + 1)}${'☆'.repeat(4 - st.star)}</span></div>
        <p class="cd-quote">"${esc(d.quote.join(' / '))}"</p>
        <div class="stat-line"><span>❤️ HP</span><b>${p.hp}</b></div>
        <div class="stat-line"><span>⚔️ ATK</span><b>${p.atk}</b></div>
        <div class="stat-line"><span>✨ 消除倍率</span><b>${p.mult}x</b></div>
        <div class="stat-line"><span>📈 经验</span><b>${st.exp}/${expNeed}</b></div>
        <div class="bar"><i style="width:${Math.min(100, st.exp / expNeed * 100)}%"></i></div>
        <div class="stat-line"><span>💗 好感度</span><b>Lv${st.favor}</b></div>
        <div class="char-btns">
          <button class="btn btn-soft" id="cdFeed" ${(s.items.candyS || 0) > 0 ? '' : 'disabled'}>喂糖果(${s.items.candyS || 0}) +100EXP</button>
          <button class="btn btn-soft" id="cdStar" ${starCost ? (st.shards >= starCost ? '' : 'disabled') : 'disabled'}>${st.star < 4 ? `升星(${st.shards}/${starCost})` : '已满星'}</button>
          <button class="btn btn-soft" id="cdSkill" ${(s.items.skillBook || 0) > 0 && st.skillLv < 10 ? '' : 'disabled'}>技能升级 Lv${st.skillLv}${st.skillLv >= 10 ? '(MAX)' : ''}</button>
          <button class="btn btn-soft" id="cdGift">送${d.favoriteGift} 🎁(200金)</button>
        </div>
        <div class="skill-desc"><b>主动·${d.skill.name}</b>：${esc(d.skill.desc)}</div>
        <div class="skill-desc"><b>被动·${d.passive.name}</b>：${esc(d.passive.desc)}</div>
        ${resonance.map(r => `<div class="reso-item"><b>✨ ${r.name}</b>：${esc(r.desc)}</div>`).join('')}`;
      drawPortrait(document.getElementById('cdAvatar'), sel, 108, 108);
      document.getElementById('cdFeed').onclick = () => {
        if ((s.items.candyS || 0) <= 0) { Sfx.play('deny'); return toast('没有小糖果啦'); }
        s.items.candyS--;
        const ups = Meta.addExp(sel, 100);
        Meta.persist();
        Sfx.play(ups.length ? 'levelup' : 'feed');
        toast(ups.length ? `${d.name} 升到了 Lv${ups[ups.length - 1]}!` : `${d.name} 获得 100EXP`);
        renderDetail(); renderList(); updateTopbar();
      };
      document.getElementById('cdStar').onclick = () => {
        if (Meta.starUp(sel)) { Sfx.play('starup'); toast(`${d.name} 升星成功！属性提升！`); renderDetail(); renderList(); }
        else { Sfx.play('deny'); toast('碎片不够啦～继续闯关收集吧！'); }
      };
      document.getElementById('cdSkill').onclick = () => {
        if ((s.items.skillBook || 0) <= 0 || st.skillLv >= 10) { Sfx.play('deny'); return; }
        s.items.skillBook--; st.skillLv++;
        Meta.persist();
        Sfx.play('skillup');
        toast(`${d.skill.name} 提升到 Lv${st.skillLv}!`);
        renderDetail();
      };
      document.getElementById('cdGift').onclick = () => {
        if (!Meta.spendGold(200)) { Sfx.play('deny'); return toast('金币不足（需要200）'); }
        Meta.addFavorExp(sel, 60);
        Sfx.play('gift');
        toast(`${d.name} 收到${d.favoriteGift}，好感度UP！`);
        renderDetail();
      };
    };
    renderList(); renderDetail();
  },

  // ============================================================
  // SHOP
  // ============================================================
  render_shop(node) {
    const s = Meta.get();
    node.innerHTML = `
      <div class="shop-wrap">
        <div class="shop-tabs">
          <button class="shop-tab on" data-t="main">常驻商店</button>
          <button class="shop-tab" data-t="daily">每日特惠</button>
        </div>
        <div id="shopBody"></div>
      </div>`;
    node.querySelectorAll('.shop-tab').forEach(b => {
      b.onclick = () => {
        node.querySelectorAll('.shop-tab').forEach(x => x.classList.remove('on'));
        b.classList.add('on');
        Sfx.play('tab');
        renderBody(b.dataset.t);
      };
    });
    const halfPrice = () => {
      // 转转君被动：概率半价
      const zz = s.chars.zhuanzhuanjun;
      if (!zz || !zz.unlocked) return false;
      const def = CHAR_DEF.zhuanzhuanjun;
      const maxed = zz.level >= 30;
      return Math.random() < (maxed ? def.passive.maxValue : def.passive.value);
    };
    const renderBody = (tab) => {
      const body = document.getElementById('shopBody');
      body.innerHTML = '';
      if (tab === 'main') {
        // 自动技能解锁（一次性购买，战斗内可开启自动释放技能）
        {
          const owned = !!(s.progress && s.progress.autoSkillUnlocked);
          const row = el(`<div class="shop-item"><div class="si-info"><b>🤖 自动技能解锁</b><span>战斗内可开启"自动释放角色技能"</span></div><button class="btn btn-soft" ${owned ? 'disabled' : ''}>${owned ? '已拥有' : '<i class="ico-coin"></i><span>2000</span>'}</button></div>`);
          row.querySelector('button').onclick = () => {
            if (owned) return;
            if (!Meta.spendGold(2000)) { Sfx.play('invalid'); return toast('金币不足'); }
            s.progress.autoSkillUnlocked = true; Meta.persist();
            Sfx.play('confirm');
            toast('🤖 自动技能已解锁！战斗内可开启');
            renderBody('main'); updateTopbar();
          };
          body.appendChild(row);
        }
        for (const [k, it] of Object.entries(ITEMS)) {
          const bought = s.progress['buy_' + k + '_' + todayKey()] || 0;
          const left = it.dailyLimit - bought;
          const row = el(`<div class="shop-item">
            <div class="si-info"><b>${it.name}</b><span>${esc(it.desc)}</span><span class="dim">今日限购剩 ${Math.max(0, left)}/${it.dailyLimit}</span></div>
            <button class="btn btn-soft" ${left > 0 ? '' : 'disabled'}><i class="ico-coin"></i><span>${it.price}</span></button>
          </div>`);
          row.querySelector('button').onclick = () => {
            if (left <= 0) return toast('今日限购已用完～');
            let price = it.price;
            const hp = halfPrice();
            if (hp) { price = Math.ceil(price / 2); toast('✨ 转转君的赌徒直觉触发：半价！'); }
            if (!Meta.spendGold(price)) { Sfx.play('invalid'); return toast('金币不足啦，多闯几关吧！'); }
            s.progress['buy_' + k + '_' + todayKey()] = bought + 1;
            s.items[k] = (s.items[k] || 0) + 1;
            Meta.persist();
            Sfx.play('coin');
            toast(`买到 ${it.name}×1！`);
            renderBody('main'); updateTopbar();
          };
          body.appendChild(row);
        }
      } else {
        const deals = [
          { key: 'shard3', name: '随机碎片×3', price: 500, desc: '随机获得 3 个角色碎片' },
          { key: 'itemBag', name: '随机道具礼包', price: 200, desc: '随机获得 2-4 个道具' },
          { key: 'expBag', name: '经验礼包', price: 350, desc: '随机获得 1-3 个中糖果' },
        ];
        for (const dl of deals) {
          const bought = s.progress['deal_' + dl.key + '_' + todayKey()] || 0;
          const row = el(`<div class="shop-item">
            <div class="si-info"><b>${dl.name} <i class="shop-badge">每日</i></b><span>${esc(dl.desc)}</span></div>
            <button class="btn btn-soft" ${bought ? 'disabled' : ''}><i class="ico-coin"></i><span>${dl.price}</span></button>
          </div>`);
          row.querySelector('button').onclick = () => {
            if (bought) return;
            if (!Meta.spendGold(dl.price)) { Sfx.play('invalid'); return toast('金币不足啦！'); }
            s.progress['deal_' + dl.key + '_' + todayKey()] = 1;
            if (dl.key === 'shard3') {
              const ids = CHARACTERS.map(c => c.id);
              const drops = {};
              for (let i = 0; i < 3; i++) {
                const id = ids[Math.floor(Math.random() * ids.length)];
                drops[id] = (drops[id] || 0) + 1;
              }
              for (const [id, n] of Object.entries(drops)) Meta.addShard(id, n);
              toast('获得碎片：' + Object.entries(drops).map(([id, n]) => (CHAR_DEF[id] || {}).name + '×' + n).join('、'));
            } else if (dl.key === 'itemBag') {
              const pool = ['hammer', 'crossBomb', 'colorBottle', 'extraSteps', 'shield'];
              const n = 2 + Math.floor(Math.random() * 3);
              const got = [];
              for (let i = 0; i < n; i++) {
                const k = pool[Math.floor(Math.random() * pool.length)];
                s.items[k] = (s.items[k] || 0) + 1;
                got.push(ITEMS[k].name);
              }
              toast('获得：' + got.join('、'));
            } else {
              const n = 1 + Math.floor(Math.random() * 3);
              s.items.candyM = (s.items.candyM || 0) + n;
              toast(`获得中糖果×${n}（图鉴里喂给梗灵吧）`);
            }
            Meta.persist();
            Sfx.play('coin');
            renderBody('daily'); updateTopbar();
          };
          body.appendChild(row);
        }
        body.appendChild(el(`<div class="dim shop-note">每日特惠每天 0 点刷新～</div>`));
      }
    };
    renderBody('main');
  },
};

// 背包：展示已拥有道具/糖果/技能书 + 自动技能解锁状态
function openBackpack() {
  const s = Meta.get();
  Sfx.play('page');
  const rows = Object.entries(s.items || {})
    .filter(([k, v]) => v > 0 && ITEMS[k])
    .map(([k, v]) => `<div class="bag-row"><b>${ITEMS[k].name}</b><span>×${v}</span></div>`).join('');
  const extra = (s.progress && s.progress.autoSkillUnlocked)
    ? `<div class="bag-row"><b>🤖 自动技能</b><span>已解锁</span></div>` : '';
  modalBox(`<div class="mb-title">🎒 背包</div><div class="bag-list">${rows || '<div class="dim">空空如也，去商店看看吧</div>'}${extra}</div>`,
    [{ text: '关闭', cls: 'btn-ghost' }]);
}

// ============ V5 开发者模式 ============
// 开启方式：URL ?dev=1 或连续点 5 次顶栏标题 → 露出 🛠 入口；进入面板必须输对密码。
//
// 防爆破与陷阱（详见 js/game/devguard.js）：
//   · 密码不落明文，改存 PBKDF2-SHA256 哈希；校验走 WebCrypto（安全上下文才可用）
//   · 最多 10 次，超限封禁调试入口；两次尝试间隔 <150ms 判为脚本化，直接封
//   · 陷阱①蜜罐令牌 gengling_dev_master：正常代码只写 '0'，被改成别的值即判定篡改
//   · 陷阱②守卫状态带签名：手改 ban:false 会让签名对不上，反手重新封禁
//   · 陷阱③诱饵密码：命中后静默封禁 + 给一个全是哑按钮的假面板，让攻击者以为进来了
let _devUnlocked = false;

/** 入口是否已被封禁（供首页决定要不要渲染 🛠 按钮） */
export function devEntryBanned() { return DevGuard.isBanned(); }

/** 启动时调用：埋蜜罐 + 查一次篡改 */
export function initDevGuard() {
  DevGuard.plantCanary();
  DevGuard.checkTamper();
}

/** 封禁页：红色警示 + 设备信息 + 本地日志摘要，并响三次警报 */
export function showDevBan() {
  const st = DevGuard.state();
  const d = DevGuard.device();
  const at = st.banAt ? new Date(st.banAt).toLocaleString('zh-CN', { hour12: false }) : '-';
  Sfx.play('alarm');
  setTimeout(() => Sfx.play('alarm'), 900);
  setTimeout(() => Sfx.play('alarm'), 1800);
  const srcName = { canary: '触碰蜜罐令牌', sig: '改动守卫状态', bot: '脚本化爆破', decoy: '命中诱饵密码' };
  const last = st.log.length ? st.log[st.log.length - 1] : null;
  modalBox(`
    <div class="dev-ban">
      <div class="dev-ban-title">⛔ 调试入口已封禁</div>
      <div class="dev-ban-sub">${last && srcName[last.src] ? '原因：' + srcName[last.src] : `密码连续输错 ${DevGuard.MAX_FAILS} 次`}</div>
      <div class="dev-ban-card">
        <div class="dev-ban-row"><span>设备识别码</span><b>${esc(d.fp)}</b></div>
        <div class="dev-ban-row"><span>机型 / 系统</span><b>${esc(d.model)}</b></div>
        <div class="dev-ban-row"><span>平台</span><b>${esc(d.platform)}</b></div>
        <div class="dev-ban-row"><span>屏幕</span><b>${esc(d.screen)}</b></div>
        <div class="dev-ban-row"><span>时区</span><b>${esc(d.tz)}</b></div>
        <div class="dev-ban-row"><span>封禁时间</span><b>${esc(at)}</b></div>
        <div class="dev-ban-row"><span>失败记录</span><b>${st.log.length} 条（存于本机）</b></div>
      </div>
      <div class="dev-ban-note">该记录已写入本机日志，关闭应用再打开仍然生效。</div>
    </div>`, [{ text: '知道了', cls: 'btn-ghost' }]);
}

/**
 * 假面板（陷阱③）：看起来就是开发者面板，但所有按钮都是哑的 ——
 * 只改自己的标签、弹一句"已生效"，不改任何真实状态。用于拖住已逆向出诱饵密码的人。
 */
function showFakeDevPanel() {
  const mask = modalBox(`
    <div class="mb-title">🛠 开发者面板</div>
    <div class="mb-text dim">已获得调试权限</div>
    <div class="dev-btns">
      <button class="btn btn-soft" id="fkAuto">🤖 全自动化：关</button>
      <button class="btn btn-soft" id="fkFinish">✅ 全关卡三星通关（解锁全部章节）</button>
      <button class="btn btn-soft" id="fkRes">💰 资源拉满（金币/体力/道具/碎片）</button>
      <button class="btn btn-soft" id="fkChar">🌟 全角色解锁+Lv30+满星（解锁隐藏章）</button>
      <button class="btn btn-soft" id="fkInfo">🔍 查看存档状态</button>
    </div>`, [{ text: '收起', cls: 'btn-ghost' }]);
  const fake = (id, fn) => { const b = mask.querySelector(id); if (b) b.onclick = fn; };
  fake('#fkAuto', (e) => {
    const b = e.currentTarget;
    const on = !/开/.test(b.textContent) || /：关/.test(b.textContent);
    b.textContent = `🤖 全自动化：${on ? '开' : '关'}`;
    Sfx.play('tap');
  });
  fake('#fkFinish', () => { Sfx.play('confirm'); toast('✅ 已全三星通关，所有章节解锁！'); });
  fake('#fkRes', () => { Sfx.play('coin'); toast('💰 资源已拉满！'); });
  fake('#fkChar', () => { Sfx.play('confirm'); toast('🌟 全角色满配！隐藏章节已解锁'); });
  fake('#fkInfo', () => {
    const s = Meta.get();
    modalBox(`<div class="mb-title">🔍 存档状态</div>
      <div class="mb-text" style="font-size:13px;line-height:1.8">
        关卡进度：${s.unlockedLevels}<br>金币：${s.gold} · 体力：${s.energy}/${ENERGY_MAX}
      </div>`);
  });
}

function askDevPassword(cb) {
  if (_devUnlocked) { cb(); return; }
  // 每次进门前重查篡改（可能刚有人在控制台里动过存储）
  if (DevGuard.checkTamper() || DevGuard.isBanned()) { showDevBan(); return; }

  let pwdVal = '';
  let mask = null;
  let busy = false;

  const onTry = async () => {
    if (busy) return;
    busy = true;
    const btn = mask && mask.querySelector('.modal-btns .btn-primary');
    const label = btn ? btn.textContent : '';
    if (btn) { btn.textContent = '校验中…'; btn.disabled = true; }
    try {
      const r = await DevGuard.verify(pwdVal);
      if (r.ok) {
        DevGuard.succeed();
        _devUnlocked = true;
        if (mask) mask.remove();
        Sfx.play('confirm');
        cb();
        return;
      }
      // 陷阱③：命中诱饵密码 —— 静默封禁，然后给一个全是哑按钮的假面板
      if (r.decoy) {
        DevGuard.ban('decoy');
        if (mask) mask.remove();
        Sfx.play('confirm');
        showFakeDevPanel();
        return;
      }
      if (r.insecure) {
        if (btn) { btn.textContent = label; btn.disabled = false; }
        busy = false;
        Sfx.play('invalid');
        toast('当前环境不支持安全校验，请在 https 或本地服务器下打开');
        return;
      }
      // 密码错误：计数（间隔过近会被判为脚本化并直接封禁）+ 采集设备信息入日志
      const f = DevGuard.fail('panel');
      if (mask) mask.remove();
      if (f.banned) { showDevBan(); return; }
      Sfx.play('invalid');
      toast(f.bot ? '⚠️ 检测到异常尝试频率' : `❌ 密码错误，还剩 ${f.remaining} 次机会`);
      askDevPassword(cb);   // 重开一次以刷新剩余次数
    } finally {
      if (btn && document.body.contains(btn)) { btn.textContent = label; btn.disabled = false; }
      busy = false;
    }
  };

  mask = modalBox(`
    <div class="mb-title">🔒 开发者面板</div>
    <div class="mb-text dim">请输入开发者密码</div>
    <div class="dev-tries">剩余尝试次数 <b>${DevGuard.remaining()}</b> / ${DevGuard.MAX_FAILS}</div>
    <input id="devPwd" type="password" class="dev-pwd" placeholder="开发者密码" autocomplete="off" />`, [
    { text: '进入', cls: 'btn-primary', fn: onTry },
    { text: '取消', cls: 'btn-ghost' },
  ]);
  const inp = mask.querySelector('#devPwd');
  if (inp) {
    inp.addEventListener('input', (e) => { pwdVal = e.target.value; });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') onTry(); });
    setTimeout(() => { try { inp.focus(); } catch (_) {} }, 60);
  }
}

function openDevPanel(sc) {
  const s = Meta.get();
  const mask = modalBox(`
    <div class="mb-title">🛠 开发者面板</div>
    <div class="mb-text dim">进度 ${s.unlockedLevels} 关 · 金币 ${s.gold} · 体力 ${s.energy}/${ENERGY_MAX}</div>
    <div class="dev-btns">
      <button class="btn btn-soft" id="devAuto">🤖 全自动化：${sc.game && sc.game.autoFull ? '开' : '关'}</button>
      <button class="btn btn-soft" id="devFinish">✅ 全关卡三星通关（解锁全部章节）</button>
      <button class="btn btn-soft" id="devRes">💰 资源拉满（金币/体力/道具/碎片）</button>
      <button class="btn btn-soft" id="devChar">🌟 全角色解锁+Lv30+满星（解锁隐藏章）</button>
      <button class="btn btn-soft" id="devInfo">🔍 查看存档状态</button>
      <button class="btn btn-soft" id="devTele">📊 关卡体验报表（埋点）</button>
      <button class="btn btn-soft" id="devGuard">🔒 调试守卫状态</button>
      <button class="btn btn-red" id="devOff">🚫 关闭开发者模式</button>
    </div>`, [{ text: '收起', cls: 'btn-ghost' }]);
  mask.querySelector('#devAuto').onclick = () => {
    const on = sc.game.toggleAutoFull();
    const b = mask.querySelector('#devAuto');
    if (b) b.textContent = `🤖 全自动化：${on ? '开' : '关'}`;
  };
  mask.querySelector('#devFinish').onclick = () => {
    const st = Meta.get();
    for (const lv of Meta.levels) st.levelStars[lv.id] = 3;
    st.unlockedLevels = Math.max(st.unlockedLevels, Meta.levels.length);
    Meta.persist();
    toast('✅ 已全三星通关，所有章节解锁！');
    mask.remove(); sc.show('home');
  };
  mask.querySelector('#devRes').onclick = () => {
    const st = Meta.get();
    st.gold = 99999; st.energy = ENERGY_MAX; st.energyTs = Date.now();
    for (const k of Object.keys(st.items)) st.items[k] = 99;
    Meta.persist();
    toast('💰 资源已拉满！');
    mask.remove(); sc.show('home');
  };
  mask.querySelector('#devChar').onclick = () => {
    const st = Meta.get();
    for (const c of CHARACTERS) {
      const ch = st.chars[c.id];
      ch.unlocked = true; ch.level = 30; ch.star = 4; ch.shards = 999; ch.skillLv = 10;
    }
    Meta.persist();
    toast('🌟 全角色满配！隐藏章节已解锁');
    mask.remove(); sc.show('home');
  };
  mask.querySelector('#devTele').onclick = () => {
    const rep = Tele.report();
    modalBox(`
      <div class="mb-title">📊 关卡体验报表</div>
      <pre class="tele-rep">${esc(rep)}</pre>`,
      [
        { text: '清空埋点', cls: 'btn-red', fn: () => { Tele.clear(); toast('埋点已清空'); } },
        { text: '复制全文', cls: 'btn-soft', fn: () => {
            try { navigator.clipboard.writeText(rep); toast('已复制到剪贴板'); }
            catch (_) { toast('这个环境不让复制，手动选吧'); }
          } },
        { text: '收起', cls: 'btn-ghost' },
      ]);
  };
  mask.querySelector('#devInfo').onclick = () => {
    const st = Meta.get();
    const cleared = Meta.levels.filter(l => (st.levelStars[l.id] || 0) > 0).map(l => l.id);
    const missing = Meta.levels.filter(l => !(st.levelStars[l.id] > 0)).map(l => l.id).slice(0, 20);
    modalBox(`
      <div class="mb-title">🔍 存档状态</div>
      <div class="mb-text" style="font-size:13px;line-height:1.8">
        关卡进度：${st.unlockedLevels}<br>
        已通关卡数：${cleared.length}/${Meta.levels.length}<br>
        缺星关卡（前20）：${missing.length ? missing.join(',') : '无'}<br>
        金币：${st.gold} · 体力：${st.energy}/${ENERGY_MAX}<br>
        队伍：${(st.team || []).filter(Boolean).join(',')}<br>
        角色：${CHARACTERS.map(c => `${c.name}${st.chars[c.id].unlocked ? 'Lv' + st.chars[c.id].level : '🔒'}`).join('、')}
      </div>`);
  };
  // 调试守卫状态：失败次数 + 设备信息 + 最近尝试记录（谁在试密码）
  mask.querySelector('#devGuard').onclick = () => {
    const st = DevGuard.state();
    const d = DevGuard.device();
    const rows = st.log.length
      ? st.log.slice(-8).reverse().map(l =>
          `<div class="dev-ban-row"><span>${esc(new Date(l.t).toLocaleString('zh-CN', { hour12: false }))}</span><b>${esc(l.fp)}</b></div>`).join('')
      : '<div class="dev-ban-note">暂无失败记录</div>';
    modalBox(`
      <div class="mb-title">🔒 调试守卫状态</div>
      <div class="dev-ban-card">
        <div class="dev-ban-row"><span>连续失败</span><b>${st.fails} / ${DevGuard.MAX_FAILS}</b></div>
        <div class="dev-ban-row"><span>剩余机会</span><b>${DevGuard.remaining()}</b></div>
        <div class="dev-ban-row"><span>是否封禁</span><b>${st.ban ? '是' : '否'}</b></div>
        <div class="dev-ban-row"><span>本机识别码</span><b>${esc(d.fp)}</b></div>
        <div class="dev-ban-row"><span>机型 / 系统</span><b>${esc(d.model)}</b></div>
        <div class="dev-ban-row"><span>屏幕</span><b>${esc(d.screen)}</b></div>
      </div>
      <div class="mb-title" style="font-size:15px;margin-top:10px">最近失败尝试</div>
      <div class="dev-ban-card">${rows}</div>`,
      [{ text: '关闭', cls: 'btn-ghost' }]);
  };
  mask.querySelector('#devOff').onclick = () => {
    Meta.get().progress.dev = false;
    Meta.persist();
    toast('开发者模式已关闭');
    mask.remove(); sc.show('home');
  };
}

// ============ 顶栏 ============
export function updateTopbar() {
  const s = Meta.get();
  const e = document.getElementById('tbEnergy');
  if (!e) return;
  Meta.energy.regen();
  e.textContent = `${s.energy}/${ENERGY_MAX}`;
  document.getElementById('tbGold').textContent = goldText(s.gold);
}

function fmtSec(sec) {
  sec = Math.max(0, sec | 0);
  const m = Math.floor(sec / 60), ss = sec % 60;
  return m > 0 ? `${m}分${ss}秒` : `${ss}秒`;
}

// ============ Toast / Modal ============
export function toast(msg, dur = 1800) {
  const root = document.getElementById('toast-root');
  const t = el(`<div class="toast">${esc(msg)}</div>`);
  root.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, dur);
}

export function modalBox(html, btns) {
  const root = document.getElementById('modal-root');
  const mask = el(`<div class="modal-mask"><div class="modal-box">${html}<div class="modal-btns"></div></div></div>`);
  const btnBox = mask.querySelector('.modal-btns');
  for (const b of btns || [{ text: '好的', cls: 'btn-primary' }]) {
    const dot = b.dot ? `<i class="mb-dot" style="background:${esc(b.dot)}"></i>` : '';
    const btn = el(`<button class="btn ${b.cls || 'btn-soft'}">${dot}<span>${esc(b.text)}</span></button>`);
    btn.onclick = () => { mask.remove(); if (b.fn) b.fn(); };
    btnBox.appendChild(btn);
  }
  root.appendChild(mask);
  return mask;
}

export function modalConfirm(title, text, onOk, btns) {
  const list = btns || [
    { text: '取消', cls: 'btn-ghost' },
    { text: '确定', cls: 'btn-primary', fn: onOk },
  ];
  return modalBox(`<div class="mb-title">${esc(title)}</div><div class="mb-text">${esc(text)}</div>`, list);
}

// 战斗中查看角色主动/被动/觉醒详情（点击成员卡触发）
function showCharInfo(id) {
  const d = CHAR_DEF[id];
  if (!d) return;
  Sfx.play('tap');
  modalBox(`
    <div class="ci-head"><span class="ci-emoji">${d.emoji || ''}</span><b>${esc(d.name)}</b><i>${esc(d.role)}</i></div>
    <div class="ci-block"><b>⚔️ 主动·${esc(d.skill.name)}</b><span>${esc(d.skill.desc)}</span></div>
    <div class="ci-block"><b>💫 被动·${esc(d.passive.name)}</b><span>${esc(d.passive.desc)}</span></div>
    ${d.awaken ? `<div class="ci-block"><b>🌟 觉醒·${esc(d.awaken.name)}</b><span>${esc(d.awaken.desc)}</span></div>` : ''}`,
    [{ text: '知道了', cls: 'btn-primary' }]);
}

// 选角色弹窗
function pickCharModal(currentId, onPick) {
  const s = Meta.get();
  const rows = CHARACTERS.map(d => {
    const st = s.chars[d.id];
    const isCur = d.id === currentId;
    const canTeam = st.unlocked && (!stInTeam(d.id) || isCur);
    return `<button class="modal-char ${canTeam ? '' : 'off'}" data-id="${d.id}" ${canTeam ? '' : 'disabled'}>
      <canvas width="52" height="52"></canvas>
      <div class="mc-info"><b>${d.name} ${st.unlocked ? 'Lv' + st.level : ''}</b>
      <span>${st.unlocked ? (stInTeam(d.id) ? '已在队' : d.role) : `碎片 ${st.shards}/${UNLOCK_SHARDS}`}</span></div>
      ${isCur ? '<i class="mc-cur">当前</i>' : ''}
    </button>`;
  }).join('');
  const mask = modalBox(`<div class="mb-title">选择出战梗灵</div><div class="modal-list">${rows}</div>`,
    [{ text: '收起', cls: 'btn-ghost' }]);
  mask.querySelectorAll('.modal-char').forEach(btn => {
    const id = btn.dataset.id;
    drawAvatarInto(btn.querySelector('canvas'), id, 52);
    btn.onclick = () => {
      mask.remove();
      if (stInTeam(id) && id !== currentId) return;
      onPick(id === currentId ? null : id);
    };
  });
}
function stInTeam(id) { return (Meta.get().team || []).includes(id); }
