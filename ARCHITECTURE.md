# 《梗灵大陆》H5 公开版 — 架构与开发约定

面向想改代码的贡献者：分层约定、棋盘引擎契约、敌人技能注册表、性能红线、缓存策略，以及"新增内容该改哪个文件"的索引。快速上手请先看 [README.md](README.md)。

本仓库是纯 H5 公开版：不含 Android 壳工程、签名构建、开发者面板与口令校验（`js/game/devguard.js` 是保留同名导出的空壳）。本文只描述公开版实际存在的代码。

## 1. 总览与分层约定

- 纯 ES Modules，无构建工具，**运行时零依赖**，无外部音频/字体资源。
- 分层铁律：**`js/core` / `js/game` / `js/data` 不碰 DOM**（`save.js` 例外——它封装 `localStorage`，且须判空降级）；**`js/ui` 只做渲染与输入**，不写游戏规则。
- 因此逻辑层可被 node 直接 import 做无头测试，也可整体平移别的技术栈。任何"在 core/game 里 `document.getElementById`"的改动都违反约定。
- 界面为日式可爱风皮肤：`css/game.css` 定结构与布局（390px 竖屏优先），`css/kawaii.css` 靠层叠覆盖出马卡龙色板/圆角卡片/场景背景。

```
js/
  core/
    rng.js          # 可注入种子的随机数（RNG: next/int/pick/shuffle）
    board.js        # 三消棋盘纯逻辑引擎（无 DOM、无 Canvas）
  data/
    characters.js   # 7 角色数值/主动/被动/觉醒 + 7 条共鸣
    levels.js       # 8 章 156 关配置
    items.js        # 道具与商店
    boons.js        # 无尽模式 12 条强化词条
  game/
    save.js         # localStorage 存档适配层
    meta.js         # 体力/金币/进度/升级升星碎片好感度
    battle.js       # 战斗状态机（逐角色 HP、回合调度，不 import UI）
    skills.js       # 角色技能实现（把 effect 关键字翻成 board 原子操作）
    enemy-skills.js # 敌人技能注册表（17 种机制）
    run-mode.js     # 无尽 / Boss Rush 共用的波次状态机
    sfx.js          # WebAudio 合成引擎（Sfx 79 音效 + Bgm 14 首曲目）
    haptics.js      # 震动反馈封装
    telemetry.js    # 本地轻量埋点（无网络上报）
    devguard.js     # 公开版空壳：仅保留同名导出
  ui/
    render.js       # 棋盘 Canvas 渲染 + 动画队列（唯一的棋盘绘制者）
    scenes.js       # DOM 场景切换：home/map/lineup/battle/chars/shop/result…
    input.js        # pointer 滑动交换、目标选择模式
    avatars.js      # Canvas 手绘 Q 版立绘
    map.js          # 世界地图（章节路径 + 关卡节点）
    art.js          # PNG 素材预载，缺失时回退矢量绘制
  main.js           # 启动与粘合：Board/Battle 实例化、棋盘机制种子、事件消费
```

## 2. 全局约定

- 棋盘坐标 `r`（行，0-7，上→下）、`c`（列，0-7，左→右）。
- 颜色索引 0-6：0 红 1 蓝 2 绿 3 黄 4 紫 5 橙，6 为彩虹专用色（只出现在特殊方块上）。
- 特殊方块 `special`：`null | 'rowBomb' | 'colBomb' | 'rainbow'`（rowBomb 清整行、colBomb 清整列、rainbow 交换时清全场同色）。
- **障碍的"相邻"一律指上下左右 4 邻格**（不含对角线）。冰块掉层、锁链松动、静音区削层都按 4 邻判定；`swap` 的"相邻"是曼哈顿距离 = 1。
- Cell 字段：`{ color, special, ice, chain, echo, silent, float, treasure, sub, cursed }`。`sub` 格 `color = -1` 作通配。

## 3. js/core/board.js — 三消引擎与 `MoveResult` 契约

```js
new Board({ rows=8, cols=8, colors, rng, seedCells, noInitialMatches=true })
// seedCells: { ice:[{r,c,hp}], chain:[{r,c,hits}], echo:[{r,c}], silent:[{r,c,layer}],
//              float:[{r,c}], treasure:[{r,c}], sub:[{r,c}] }

board.swap(r1,c1,r2,c2)   // -> MoveResult | null（不相邻/被锁/无匹配且无特殊效果 => null，棋盘不变）
board.useHint()           // -> {r1,c1,r2,c2} | null，只返回真正可滑的解
board.ensurePlayable()    // 死局自救：洗到有解为止，返回事件数组
```

技能/道具原子操作（`clearCells / clearRow / clearCol / clearArea / convertColor / shuffleAll / randomCells / setSub / setCursed / setLockedColor / freezeRow / floatRow / applyWind / settle`）**一律返回 MoveResult 形状**：

```
MoveResult = { events, score, matchedCounts, specialCreated, moves }
// events:         按发生顺序的事件流，渲染层逐条播动画
// score:          本次操作总分
// matchedCounts:  { colorIdx: count }，战斗层按它结算伤害与目标计数
// specialCreated: 首个新生成的特殊方块（可为 null）
// moves:          连锁轮数
```

Event 类型（新增机制时只扩展类型、旧消费方向后兼容，**不许改既有事件字段语义**）：
`swap / invalid / match / specialSpawn / fall / refill / bomb / rainbow / iceBreak / chainOpen / silentOpen / silentCleared / echoCleared / wind / floatDrop / treasure / subConvert / curseSet / curseHit / curseCleanse / colorLock / terrain / shuffle`。

规则要点：3 连即消；横 4 连 → colBomb、竖 4 连 → rowBomb（写死）；5 连或 L/T 交叉 → rainbow；每轮全部匹配+炸弹+彩虹结算完后统一重力掉落+顶部补充，再检测连锁直到无匹配。冰块被本格或 4 邻参与匹配时 `ice-1`；锁链格不可交换不可消除，4 邻参与匹配时 `chain-1` 归零解锁；静音格同理且同样拒绝交换（`ensurePlayable` 会松动静音层保证有进展）。

## 4. js/game/battle.js — 战斗状态机

- **逐角色 HP 的唯一权威是 `state.members`**：`[{ id, name, hp, maxHp, fainted }]`，由出战队伍的 hp 生成。敌人攻击随机命中一名未倒下成员；成员 `hp<=0` 置 `fainted`（技能不可用、被动失效）；**全员倒下才判负**。
- `state.hp / maxHp` 保留为 `Σ成员 hp`，仅作血条兜底的兼容字段——任何新代码不得把它当真实血量读写。
- 治疗按存活成员计算；`avgAtk` 等派生值只算存活成员。
- 每回合产出 `turnEvents`（`enemyAttack / bossSkill / memberFainted / chargeStart …`）供 UI 逐条播动画；调度顺序：清 turnEvents → CD/行锁/雾递减 → 被动结算 → 敌人技能+普攻 → 胜负判定。
- 伤害模型：每消除 1 格 = 队伍平均 ATK × 0.5 × (1 + 0.15 × 连锁数)；技能伤害 = 出招者 ATK × dmgMult。

### 敌人技能注册表（enemy-skills.js）与命名归一化

- `ENEMY_SKILLS` 是全部敌人机制的注册表，现有 **17 个机制键**：`shell rockfall noise tornado thunder gust fog bet sub_convert allin summon minions curse terrain color_lock color_swap dodge`。每项 `{ name, every, cast(ctx), [onDamage] }`；`cast` 返回 `false` 表示条件不满足、本次不发动。`dodge` 这类被动型不周期触发，只挂 `onDamage` 改写伤害。
- **battle.js 只做调度：到周期 → 查表 → 执行 → 产出事件。新增机制只在注册表加一项，不改调度器。**
- 命名归一化：关卡数据里敌人技能写作 `skills: [{ id, every?, param?, name?, charge?, phase? }]`，**`id` 必须与注册表键完全一致**（snake_case 规范名）。`battle.js#_normalizeEnemy` 在战斗初始化时统一补齐缺省（`every` 取注册表值或 3、`param`/`phase`/运行期字段等），召唤物 `spawnMinion` 走同一归一化路径。历史文案里的 `trait` 字段名已被这套 `skills[].id` + 注册表取代。
- `charge > 0` 的技能先出预警（`e.charging` 供 UI 画蓄力条）再放大招；`phase` 让 Boss 换阶段换招。

### 其余 game/ 模块

- `run-mode.js`：无尽与 Boss Rush 共用波次状态机（词条发放、波次生成、纪录计算），表现层留给 Game/Scenes；Boss Rush 共 8 波、血量 1.6 倍强化。词条数据在 `data/boons.js`（12 条，`BOONS` / `BOON_BY_ID`）。
- `meta.js` / `save.js`：金币、体力（按时间戳回复）、关卡进度、角色养成与保底，全部落在一份 `localStorage` 存档里。
- `sfx.js`：纯 WebAudio 合成。`SFX` 表 **79 个音效**（含 7 个角色专属招式音），`TRACKS` 表 **14 首循环 BGM**（menu/menu2/menu3/map/normal/upbeat/combo/boss/time/shop/event/result/loading/pause），另有 `home/battle/battle2/battle3` 四个场景别名指向既有曲目。不加任何音频文件。
- `devguard.js`：公开版空壳，只保留同名导出，无任何口令/令牌/封禁逻辑。公开版的 `js/main.js` 与 `js/ui/scenes.js` 已不再引用它，本文件仅由 `tests/ui.test.mjs` 的「公开版契约」用例直接 import 来守住这条边界。**不要把私有版实现搬回来。**

## 5. js/data/ — 纯数据（新增内容优先改这里）

- `levels.js`：`CHAPTERS` 8 章（含隐藏章），`LEVELS` 共 156 关，按章实际分布 15/21/20/25/25/20/20/10。关卡字段：`type`（collect/score/enemy/timed/boss/combo）、`goal`、`steps`、`colors`、`enemies`（含 `skills`）、`board`（障碍种子）、`rewards`、`boss`、`power`。第 1-4 章手写，第 5-8 章（含隐藏章）由 `makeChapterLevels()` 按数值曲线程序化生成——结构完全一致。
  注意 `CHAPTERS[i].count` **只被程序化生成的 5-8 章消费**，1-4 章是手写数组、`count` 仅为展示性元数据；因此第 2 章 `count: 20` 与实际 21 关（16–36 号，37 号起属第 3 章，编号无缺口）的差异不影响任何运行时行为，不是 bug。改 5-8 章关数时**必须同步 `count`**，它直接决定生成循环上界与 `power` 爬坡分母。
- `characters.js`：7 角色（哈基喵 + 6 伙伴）`base/max/perLevel` 线性成长 + `skill/passive/awaken` + `RESONANCES` 7 条共鸣；effect 关键字由 `game/skills.js` 解释成 board 原子操作。
- `items.js`：战斗道具/糖果/礼物与商店价目。

## 6. 棋盘机制种子在 main.js 生成（别在 levels.js 里找格子坐标）

`main.js` 开局时把关卡配置翻译成 `seedCells`，规则两条：

1. **显式坐标类**（`ice/chain/echo/silent`）直接取 `level.board`——手写关要精确控制形状。
2. **数量类**（`float/treasure/sub`）：`board` 字段给数字（或干脆为空）时，由 `seedMech` 兜底解析关卡 `special` 描述里的中文机制词（"浮空""宝箱""子方块"），再经 `_patternCells(level.id × 盐值 + 5, n, …)` **以关卡 id 为确定性种子**随机铺格——同一关每次进入形状相同，且不与其他机制冲突。

因此**第 3、4 章等关卡的 `board` 机制数组是空的，机制格由 `main.js` 运行时生成**，这是设计而非 bug。程序化生成的 5-8 章 `special` 不含机制词，机制开关完全走结构化字段。高风险（赌局）模式下敌人 HP ×2 在 `main.js` 拷贝敌人时改写，不污染数据文件。

## 7. js/ui/ — 渲染与输入

- `render.js` **性能红线**：滑动卡顿的根因是每帧矢量重绘。解法是精灵缓存 `_spriteCache`——每种 `(color, variant, ice, chain, special, rainbow帧)` 组合按 `cs×dpr` 预渲染到离屏 canvas，主循环只 `drawImage`；`cs` 或 `dpr` 变化（resize/attach）即整体失效重建。**禁止在主循环逐帧 `createLinearGradient` 或画大量 path**；动画时长整体压缩、同帧事件并行播放；伤害飘字 `floatText` 画在画布内，不用 DOM。
- `scenes.js`：DOM 场景切换（home/map/lineup/battle/chars/shop/result 等），移动端竖屏、`100dvh`、禁双击缩放。
- `input.js`：pointerdown/up 判滑动方向触发 swap；点技能/道具后进入目标选择模式。
- `art.js` 预载 `assets/` PNG 立绘/背景，缺失时回退 `avatars.js` 的 Canvas 矢量绘制——删素材文件游戏不会崩，只是降级。

## 8. Service Worker 缓存策略（sw.js）

- **html / js / css / webmanifest → network-first**，断网回退缓存。理由：皮肤与数值改动频繁，若代码也走 cache-first，老用户会永远拿旧文件——这是踩过的坑，别改回去。
- **图片等大资源 → cache-first**，省流量、可离线。
- 更换任何素材图片**必须 bump `sw.js` 顶部的版本号**；新增 JS/CSS 文件要同步加入 precache 清单，否则离线页会缺模块。

## 9. 新增内容该改哪个文件

| 想加的东西 | 改哪里 | 备注 |
|---|---|---|
| 新关卡 | `js/data/levels.js` | 机制格坐标只写显式类；float/treasure/sub 给数量即可 |
| 新敌人技能机制 | `js/game/enemy-skills.js` 注册一条 + 关卡里用该 `id` | 不动 battle.js 调度器 |
| 新角色 | `js/data/characters.js` + `js/game/skills.js`（若用新 effect）+ `js/ui/avatars.js` 或 `assets/` | 立绘缺失自动回退矢量 |
| 新词条（无尽强化） | `js/data/boons.js` | run-mode 自动进三选一池 |
| 新道具 | `js/data/items.js` + `battle.js#useItem` 分支 | |
| 新音效 | `js/game/sfx.js` 的 `SFX` 表加一条合成配方 | 不引入音频文件 |
| 新 BGM | `js/game/sfx.js` 的 `TRACKS` 表加一首 | |
| 新棋盘规则/机制 | `js/core/board.js` + 对应 tests | 事件只增字段语义不改；返回 MoveResult 形状 |
| 新界面/场景 | `js/ui/scenes.js` + `css/game.css`（结构）/`kawaii.css`（皮肤） | 逻辑留在 game 层，UI 只渲染 |

## 10. 测试与运行

- `python server.py 8081` 起本地服务（backlog 坑说明见 README）；测试用 `npm install && npm test`，对应 `tests/` 下 engine / meta / skills / ui（jsdom）四套用例，Node ≥ 20。
- core/game/data 无 DOM 依赖，可被 node 直接 import——新增引擎/战斗行为请连带补用例。
- CI 工作流：CodeQL 安全扫描 + 测试门禁（`.github/workflows/`）。
