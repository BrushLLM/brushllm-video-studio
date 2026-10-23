<p align="center">
  <img src=".github/assets/icon.png" width="128" alt="BrushLLM Video Studio">
</p>

<h1 align="center">BrushLLM Video Studio</h1>

<p align="center">
  <a href="https://github.com/BrushLLM/brushllm-video-studio/releases"><img src="https://img.shields.io/github/v/release/BrushLLM/brushllm-video-studio?style=flat-square&color=orange" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License"></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey?style=flat-square" alt="Platforms">
  <img src="https://img.shields.io/badge/UI-9%20languages-success?style=flat-square" alt="Languages">
</p>

<p align="center">
  <strong><a href="https://www.brushllm.com">🌐 brushllm.com</a></strong> · <a href="https://github.com/BrushLLM/brushllm-video-studio/releases">Releases</a>
</p>

<p align="center">A local-first desktop video toolbox — 33 operations across video, audio and subtitles, all running 100% on your device. Free, offline, private.</p>

<p align="center">
  <img src=".github/assets/screenshot.png" width="800" alt="BrushLLM Video Studio">
</p>

[English](README.md) | [Deutsch](translations/README.de.md) | [Español](translations/README.es.md) | [Français](translations/README.fr.md) | [Português (BR)](translations/README.pt-BR.md) | [日本語](translations/README.ja.md) | [简体中文](translations/README.zh-CN.md) | [繁體中文](translations/README.zh-TW.md) | [한국어](translations/README.ko.md)

---

## ✨ Features

- **Video** (12 tools) — Convert (MP4 / MKV / WebM / MOV / AVI × H.264 / H.265 / VP9 / AV1) · Compress (CRF or bitrate) · Merge (lossless when codecs match) · Trim · Crop · Scale · Rotate / Flip · Speed (0.25–4×) · Extract Frames · GIF / WebP · Metadata · Container swap
- **Audio** (8 tools) — Convert (MP3, M4A, FLAC, WAV, OGG, Opus) · Compress · Trim · Volume · Loudness normalization (EBU R128) · Extract from video · Remove / Replace track
- **Subtitles** (6 tools) — SRT / VTT / ASS / SSA / TTML conversion (instant) · Timing shift · Encoding fix (GBK / Big5 → UTF-8) · Extract from video · Embed · Burn
- **All operations support batch processing** — apply the same settings to an entire file list
- Hardware acceleration with honest GPU detection (VideoToolbox on macOS) · 9-language UI · live CPU utilization · prevent-sleep during processing · pause / resume · zero telemetry

## 📥 Download

Grab the latest installer from [Releases](https://github.com/BrushLLM/brushllm-video-studio/releases):

| Platform | File |
| --- | --- |
| macOS — Apple Silicon (M-series) | `.dmg` (arm64) |
| Windows 10/11 — x64 (Intel/AMD) | `.exe` (x64) |
| Windows 10/11 — ARM64 (Snapdragon) | `.exe` (arm64) |

> **Apps are unsigned.** macOS: right-click the app → **Open** on first launch (Gatekeeper). Windows: choose **Run anyway** when SmartScreen appears — the installer opens with a 9-language selector.

## 🌐 UI Languages

English · Deutsch · Español · Français · Português (BR) · 日本語 · 简体中文 · 繁體中文 · 한국어

Switch instantly in Settings — no restart.

<details>
<summary><strong>🛠 Develop</strong></summary>

```bash
npm install
npm run fetch-binaries   # download pinned FFmpeg/ffprobe (SHA-256 verified)
npm start                # launch the app
```

Tests: `npm test` — unit + end-to-end with real FFmpeg.

</details>

<details>
<summary><strong>🏗 Architecture</strong></summary>

- **UI** — React 18 + Vite in Electron. `src/pages` (tool pages) → `src/components` → `src/lib/bridge.js` (typed IPC wrappers).
- **Engine** (`electron/engine`) — pure Node.js: `commands.js` (pure function: op + params → FFmpeg args, unit-tested), `queue.js` (job lifecycle, progress, pause/resume, CPU sampling), `resolve.mjs` (central encoding resolver shared by UI plan and actual command).
- **Subtitle engine** (`shared/subtitles.js`) — pure JS, no dependencies: parse/write SRT, VTT, ASS, SSA, TTML; charset detection (UTF-8/GBK/Big5/Shift-JIS).
- **Media engine** — pinned FFmpeg/ffprobe binaries per platform (SHA-256 verified), fetched via `scripts/fetch-binaries.mjs`.
- **CI** — GitHub Actions builds all three platform installers on tag push.

</details>

## ⚠️ Known limitations

- Image-based subtitles (PGS/DVD) are not supported yet — planned for the AI version.
- GPU acceleration uses VideoToolbox on macOS; NVENC/QSV/AMF code is ready but untested on Windows.
- Apps are unsigned (code signing can be added to CI later).

## 📄 License

MIT License — see [LICENSE](LICENSE).
