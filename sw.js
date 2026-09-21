// sw.js — 梗灵大陆 PWA Service Worker
// 策略：
//   代码/样式/文档（html・js・css・webmanifest）→ network-first，断网回退缓存。
//     否则每次改皮肤/数值，老用户都会一直拿到旧缓存（cache-first 的坑）。
//   图片等大资源 → cache-first（内容不变，省流量、可离线）。
const CACHE = 'gengling-v12';   // v12：全场景紧凑化（一屏放下）+ AI 糖果背景分层 + 音效触点补全

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/game.css',
  './css/kawaii.css',
  './js/main.js',
  './js/core/rng.js',
  './js/core/board.js',
  './js/data/characters.js',
  './js/data/levels.js',
  './js/data/items.js',
  './js/data/boons.js',
  './js/game/save.js',
  './js/game/meta.js',
  './js/game/battle.js',
  './js/game/enemy-skills.js',
  './js/game/run-mode.js',
  './js/game/haptics.js',
  './js/game/skills.js',
  './js/game/sfx.js',
  './js/game/devguard.js',
  './js/ui/render.js',
  './js/ui/scenes.js',
  './js/ui/input.js',
  './js/ui/avatars.js',
  './js/ui/map.js',
  './js/ui/art.js',
  './assets/icon-1024.png',
  // 场景背景：预缓存，否则断网时首页/战斗会退回纯色底
  './assets/bg_menu.jpg',
  './assets/bg_battle.jpg',
  './assets/bg_boss.jpg',
  './assets/bg_char.jpg'
];

// 需要"每次联网优先"的资源：代码与样式
const FRESH = /\.(?:js|mjs|css|webmanifest)$/i;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // 仅处理同域资源

  // 文档与代码样式：网络优先，失败回退缓存（离线仍可玩）
  const isDoc = req.mode === 'navigate' || req.destination === 'document';
  if (isDoc || FRESH.test(url.pathname)) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }

  // 图片等静态大资源：缓存优先
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
