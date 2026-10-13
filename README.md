# 梗灵大陆 · Gengling Continent

[简体中文](README.md) | [English](README.en.md)

一款**纯前端 H5 三消 Roguelite**。零构建、零依赖、零外部音频资源 —— 打开 `index.html` 就能玩，离线可用。

![CI](https://github.com/wuliao00/gengling-h5/actions/workflows/codeql.yml/badge.svg)
![tests](https://github.com/wuliao00/gengling-h5/actions/workflows/test.yml/badge.svg)
![language](https://img.shields.io/badge/language-JavaScript-f7df1e?logo=javascript&logoColor=black)
![platform](https://img.shields.io/badge/platform-Web-blue)
![render](https://img.shields.io/badge/render-Canvas%202D-orange)
![audio](https://img.shields.io/badge/audio-WebAudio%20%E5%85%A8%E5%90%88%E6%88%90-blueviolet)
![deps](https://img.shields.io/badge/runtime%20dependencies-0-brightgreen)
![license](https://img.shields.io/badge/license-%E4%B8%8D%E5%BC%80%E6%BA%90%C2%B7%E4%BF%9D%E7%95%99%E6%89%80%E6%9C%89%E6%9D%83%E5%88%A9-red)

主题是一只头顶蜂蜜罐、永远睡不醒的橘猫「哈基喵」，带六只梗灵伙伴闯八章大陆。

## 在线玩

**https://wuliao00.github.io/gengling-h5/** （GitHub Pages，随 push 自动更新）

手机浏览器打开后，用「添加到主屏幕 / 安装应用」即可当 PWA 用：全屏启动、离线可玩、存档独立，与网页版同一套代码。

## 特性

- **三消 + 回合制 RPG 混合**：消除累积能量，释放各角色主动/被动技能对敌人造成伤害；逐角色 HP，全员倒下才算战败
- **156 关 / 8 章**（含隐藏章），每章有专属棋盘机制：浮空岛、宝箱、冰块、锁链、诅咒方块、地形改造、锁色换色
- **73 个关卡敌人配置**（按名字区分共 53 种），各挂专属技能，技能机制共 17 种（蓄力大招、狂暴换招、召唤、押注、全押等），没有白板怪
- **无尽模式**（肉鸽三选一强化词条，12 条词条池）与 **Boss Rush**（连打 8 章 Boss 强化版）
- **纯 WebAudio 合成音频引擎**：79 个音效 + 14 首循环 BGM 全部实时合成，不加载任何音频文件
- **可震动反馈**、**PWA 离线**、**本地存档**

## 快速开始

```bash
# 直接双击 index.html 也可以，但 ES Module 在 file:// 下部分浏览器会限制，推荐起个静态服务：
python server.py 8081
# 然后打开 http://127.0.0.1:8081/index.html
```

`server.py` 用 `ThreadingHTTPServer` 且把 `request_queue_size` 调到 128 —— 页面启动会并发拉十几个 ES 模块，单线程或默认 backlog 会溢出，表现为 `ERR_CONNECTION_REFUSED` 且**没有任何 JS 报错**。

## 运行测试

```bash
npm install   # 只装开发依赖（jsdom），运行时依赖恒为 0
npm test      # node 跑 tests/ 下的引擎 / 元系统 / 技能 / UI 四套用例
```

引擎层（`js/core`、`js/game`、`js/data`）不依赖 DOM，可以直接被 node 测试 —— 这是分层约定的直接收益，改逻辑后请先跑一遍再提交。

## 目录结构

```
index.html              单页外壳 + 全局顶栏
css/game.css            布局与结构（390px 竖屏优先）
css/kawaii.css          皮肤层：马卡龙色板 / 圆角卡片 / 场景背景，靠层叠覆盖 game.css
js/core/                棋盘引擎（8x8 生成、匹配、重力、原子操作返回 MoveResult）
js/game/                战斗状态机、技能、敌人技能注册表、存档、合成音频引擎、局外成长
js/data/                纯数据：关卡、角色、道具、词条（新增内容优先改这里）
js/ui/                  DOM 渲染层、世界地图、Canvas 精灵与高分屏适配
assets/                 Q 版立绘、敌人图、场景背景
sw.js                   PWA Service Worker（文档/代码 network-first，图片 cache-first）
server.py               本地静态服务（禁缓存 + 大 backlog，见上文坑说明）
```

分层约定：`core` / `game` / `data` 不碰 DOM，`ui` 只做渲染与输入。所以逻辑层可以整体平移到别的技术栈。深入改造前请先读 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 关于开发者面板

本仓库**不含**开发者面板。私有版的调试入口带口令校验与防护实现，那部分内容没有公开的必要，也一旦公开就等于把防护手段连判据一起交出去，所以公开版里它**整体不存在**：`js/game/devguard.js` 是保留同名导出的空壳，`js/main.js` 里的解锁入口（`?dev=1` 与连点标题 5 次）已移除，`js/ui/scenes.js` 里相关的密码框、面板与警示页代码也一并删净。因此 `🛠` 按钮不会渲染，也不留任何可被触发的调试死路。空壳本身仍由 `tests/ui.test.mjs` 的「公开版契约」用例直接引用，守住这条边界不被回退。

唯一保留的调试便利是 URL 参数 `?goto=关卡id`（见 `js/main.js`）：它把存档里的 `unlockedLevels` 抬到该关并补满 10 点体力，然后直接进编队页，方便逐关自测。它只读写**你自己本机**的 `localStorage`，不发网络请求，也不解锁任何调试指令——和手动改存档的门槛完全等价，所以公开版没有为它加防护。不想要这个行为的人，删掉 `js/main.js` 里那一段 `?goto` 处理即可。

## 与私有 / 原生版本的关系

- 本仓库是**纯 H5 公开版**，也是唯一公开维护的代码。
- 开发者面板与口令校验**不在本仓**（公开版 `devguard.js` 是空壳，见上一节）。
- Android **原生 Kotlin 重写版**、WebView 壳工程、签名 APK 与相关构建流水线均为**私有**，本仓不含 `android/`、`release/` 或对应工作流；请勿在此寻找安装包。
- 逻辑层（棋盘引擎 / 战斗 / 数据）与 UI 解耦，公开版即其权威来源。

## 安全说明

- **纯客户端**：无后端、无服务器、无业务网络请求；存档在浏览器 `localStorage`。
- **无密钥**：仓库不含任何 token / 私钥 / API key。
- **零运行时依赖**：没有供应链攻击面；GitHub CodeQL 扫描已在 Actions 启用。

## 已知边界

- 存档在 `localStorage`，纯客户端，清站点数据即清空
- 安卓 WebView 类宿主里 `env(safe-area-inset-*)` 实测可能返回 0，需要宿主把真实 inset 注入 CSS 变量（本仓不含任何壳工程，浏览器 / PWA 无此问题）
- 部分 emoji（如 🪙 U+1FA99）在少数字体缺字形，界面里的金币/能量图标是 CSS 画的，不依赖 emoji

## 许可

本项目**不开源**，为作者私人用途。仓库不附带 LICENSE 文件、不授予任何许可证，**保留所有权利**。

公开到这里仅用于展示与作者自行部署试玩，不构成任何授权：不得复制、改写、再分发、镜像转发，
不得用于商业或任何对外产品，也不得把其中的代码、美术与音频资源当作素材取用。
「fork」「下载 zip」「另存网页」在技术上可行，不代表被许可。

需要授权（复用、二次开发、商用）请通过 Issue 或作者联系方式另行取得书面同意。
