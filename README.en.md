# Gengling Continent

[简体中文](README.md) | [English](README.en.md)

A **pure front-end H5 match-3 Roguelite**. Zero build step, zero dependencies, zero external audio assets — open `index.html` and play, fully offline-capable.

![CI](https://github.com/wuliao00/gengling-h5/actions/workflows/codeql.yml/badge.svg)
![language](https://img.shields.io/badge/language-JavaScript-f7df1e?logo=javascript&logoColor=black)
![platform](https://img.shields.io/badge/platform-Web-blue)
![render](https://img.shields.io/badge/render-Canvas%202D-orange)
![audio](https://img.shields.io/badge/audio-WebAudio%20fully%20synthesized-blueviolet)
![deps](https://img.shields.io/badge/runtime%20dependencies-0-brightgreen)
![license](https://img.shields.io/badge/license-undeclared%C2%B7all%20rights%20reserved-lightgrey)

The theme: Hajimiao — an orange tabby cat with a honey jar on its head, forever half-asleep — leading six meme-spirits (GengLings) across an eight-chapter continent.

## Play Online

**https://wuliao00.github.io/gengling-h5/** (GitHub Pages, updated automatically on push)

On a phone browser, use "Add to Home Screen / Install app" to run it as a PWA: launched fullscreen, playable offline, with its own save — same codebase as the web version.

## Features

- **Match-3 + turn-based RPG hybrid**: clearing tiles builds energy to cast each character's active/passive skills against enemies; per-character HP — you only lose when the whole team is down
- **156 levels / 8 chapters** (including a hidden chapter), each chapter with its own board mechanics: floating islands, treasure tiles, ice, chains, cursed tiles, terrain rewriting, locked-color recoloring
- **73 enemy configurations across levels** (53 distinct named enemies), each carrying dedicated skills drawn from 17 mechanics (charged ultimates, rage move-swapping, summoning, betting, all-in, etc.) — no filler mobs
- **Endless mode** (roguelike pick-one-of-three buffs, a 12-boon pool) and **Boss Rush** (eight enhanced chapter bosses back to back)
- **Pure WebAudio synthesized audio engine**: 79 sound effects + 14 looping BGM tracks, all synthesized in real time — no audio files loaded
- **Haptic feedback**, **PWA offline support**, **local saves**

## Quick Start

```bash
# Double-clicking index.html also works, but ES Modules are restricted by some browsers under file:// — a static server is recommended:
python server.py 8081
# then open http://127.0.0.1:8081/index.html
```

`server.py` uses `ThreadingHTTPServer` and raises `request_queue_size` to 128 — on page startup a dozen-plus ES modules are fetched concurrently; a single-threaded server or the default backlog overflows, showing up as `ERR_CONNECTION_REFUSED` with **no JS error at all**.

## Running Tests

```bash
npm install   # installs dev dependencies only (jsdom); runtime deps stay at 0
npm test      # runs the engine / meta / skills / UI suites under tests/ with node
```

The logic layers (`js/core`, `js/game`, `js/data`) have no DOM dependency and can be tested directly by node — a direct payoff of the layering convention. Run the suite once before committing any logic change.

## Project Structure

```
index.html              single-page shell + global top bar
css/game.css            layout & structure (mobile portrait first, 390px)
css/kawaii.css          skin layer: macaron palette / rounded cards / scene backgrounds, layered over game.css
js/core/                board engine (8x8 generation, matching, gravity, atomic ops returning MoveResult)
js/game/                battle state machine, skills, enemy-skill registry, save, synthesized audio engine, meta progression
js/data/                pure data: levels, characters, items, boons (start here when adding content)
js/ui/                  DOM rendering layer, world map, Canvas sprites & HiDPI adaptation
assets/                 chibi portraits, enemy art, scene backgrounds
sw.js                   PWA Service Worker (docs/code network-first, images cache-first)
server.py               local static server (cache disabled + large backlog, see the pitfall note above)
```

Layering convention: `core` / `game` / `data` never touch the DOM; `ui` only renders and reads input. The logic layer can therefore be ported wholesale to another tech stack. Read [ARCHITECTURE.md](ARCHITECTURE.md) before deeper changes.

## About the Developer Panel

This repository does **not** include a developer panel. The private edition's debug entry ships with a passphrase check and anti-abuse protection; none of that is worth publishing, and publishing it would hand over the protection scheme along with how it is detected. So in the public edition it is gone **entirely**: `js/game/devguard.js` is a stub keeping the same exports, the unlock entries in `js/main.js` (`?dev=1` and tapping the title 5 times) have been removed, and the related password prompt, panel and warning screens in `js/ui/scenes.js` have been deleted as well. The `🛠` button never renders and no reachable debug dead-end is left behind. The stub itself is still imported directly by the "public-edition contract" cases in `tests/ui.test.mjs`, which keep this boundary from regressing.

The single debugging convenience left in place is the `?goto=<level id>` URL parameter (see `js/main.js`): it raises `unlockedLevels` in your save to that level, tops energy up to 10, and drops you straight on the lineup screen so a level can be tested on its own. It only reads and writes **your own** `localStorage`, makes no network request, and unlocks no debug commands — it is exactly as reachable as editing the save by hand, which is why the public edition puts no protection around it. To opt out, delete the `?goto` block in `js/main.js`.

## Relationship with the Private / Native Versions

- This repo is the **pure-H5 public edition**, and the only publicly maintained codebase.
- The developer panel and its passphrase guard are **not in this repo** (the public `devguard.js` is a stub, see the section above).
- The **native Kotlin Android rewrite**, the WebView shell project, signed APKs, and their build pipelines are all **private**; this repo contains no `android/`, no `release/`, and no corresponding workflows — don't look here for installers.
- The logic layers (board engine / battle / data) are decoupled from the UI, and this public repo is their authoritative source.

## Security Notes

- **Purely client-side**: no backend, no server, no business network requests; saves live in browser `localStorage`.
- **No secrets**: the repo contains no tokens / private keys / API keys.
- **Zero runtime dependencies**: no supply-chain attack surface; GitHub CodeQL scanning is enabled in Actions.

## Known Limits

- Saves live in `localStorage` — purely client-side; clearing site data wipes them
- In Android-WebView-style hosts, `env(safe-area-inset-*)` has been observed to return 0; the host must inject real insets as CSS variables (this repo ships no shell project; browsers/PWA are unaffected)
- Some emoji (e.g. 🪙 U+1FA99) lack glyphs in certain fonts; the coin/energy icons in the UI are drawn with CSS, not emoji

## License

The repository currently ships **no LICENSE file and declares no license**; by default **all rights are reserved**. It is public for showcase, learning, and self-hosted play only. For code reuse or commercial distribution, please contact the author via an Issue to obtain permission first.
