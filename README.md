<img src="build/video-studio.svg" width="72" height="72" alt="">

# BrushLLM Video Studio

Free desktop tools for video, audio and subtitles. Work on local files and apply the same settings to a batch. FFmpeg and FFprobe are included.

[Latest release](https://github.com/BrushLLM/brushllm-video-studio/releases/latest) · [Product page](https://brushllm.com/video-studio/)

[English](README.md) | [Deutsch](docs/README.de.md) | [Español](docs/README.es.md) | [Français](docs/README.fr.md) | [Português (Brasil)](docs/README.pt-BR.md) | [日本語](docs/README.ja.md) | [简体中文](docs/README.zh-CN.md) | [繁體中文](docs/README.zh-TW.md) | [한국어](docs/README.ko.md)

![Video workspace with four source files, a source frame and output estimate](.github/assets/workspace.svg)

[See the processing queue](.github/assets/queue.svg) · Preview footage from the [MDN CC0 flower sample](https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4).

## What you can do

- **Video** — Convert and compress MP4, MKV, WebM, MOV and AVI. Trim, crop, resize, rotate, merge compatible clips without re-encoding, and export frames or animations.
- **Audio** — Convert audio, trim it, adjust volume and loudness, or extract and replace an audio track in a video.
- **Subtitles** — Convert SRT, VTT, ASS, SSA and TTML, shift timing and repair text encoding. Extract text tracks, embed subtitles, or burn them into the picture.
- **Batch queue** — Import a list of files, review the output settings and monitor progress. Pause, cancel or retry jobs and inspect results and errors in the queue.

## Download

Choose the installer for your device from the latest release.

| Platform | Installer |
| --- | --- |
| macOS 12+ (Apple Silicon) | `BrushLLM.Video.Studio-<version>-arm64.dmg` |
| Windows x64 (Intel / AMD) | `BrushLLM.Video.Studio-<version>-x64.exe` |
| Windows ARM64 | `BrushLLM.Video.Studio-<version>-arm64.exe` |

The release includes `SHA256SUMS` for all three installers. The macOS build is distributed without notarization and the Windows builds are unsigned.

## Interface languages

English · Deutsch · Español · Français · Português (Brasil) · 日本語 · 简体中文 · 繁體中文 · 한국어

## Develop locally

Use Node.js 22. The desktop dev launcher starts Vite and Electron together.

```bash
npm ci
npm run fetch-binaries
npm run dev
```

`npm test` runs unit tests and integration tests against FFmpeg. Use `npm run build` followed by `npm start` to run the production renderer locally.

## License

The application source is MIT-licensed. Bundled FFmpeg and FFprobe follow their upstream licenses. [MIT](LICENSE) · [Media engine sources and license](docs/media-engine/NOTICE.md)
