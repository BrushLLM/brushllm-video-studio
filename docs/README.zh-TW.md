<img src="../build/video-studio.svg" width="72" height="72" alt="">

# BrushLLM Video Studio

在裝置上轉換、編輯及匯出影片、音訊與字幕。將同一組設定套用到多個檔案，並在本機完成處理。安裝程式內含 FFmpeg 和 FFprobe。

[最新版本](https://github.com/BrushLLM/brushllm-video-studio/releases/latest) · [官方產品頁](https://brushllm.com/zh-TW/video-studio/)

[English](../README.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [Português (Brasil)](README.pt-BR.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [한국어](README.ko.md)

![影片工作區顯示四個原始檔案、來源影格及輸出預估](../.github/assets/workspace.svg)

[查看處理佇列畫面](../.github/assets/queue.svg) · 預覽素材來自 [MDN CC0 flower sample](https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4).

## 主要功能

- **影片** — 轉換和壓縮 MP4、MKV、WebM、MOV、AVI。支援裁切、裁剪、縮放、旋轉、相容片段無損合併，以及匯出影格或動畫。
- **音訊** — 轉換、裁切音訊，調整音量和響度，或擷取、替換影片音軌。
- **字幕** — 轉換 SRT、VTT、ASS、SSA 和 TTML，平移時間軸及修復編碼。支援擷取文字字幕軌、封裝及燒錄字幕。
- **批次佇列** — 批次匯入，核對輸出設定與進度。在佇列中暫停、取消或重試工作，查看結果與失敗原因。

## 下載

從最新版本頁面選擇符合裝置架構的安裝檔。

| 支援平台 | 安裝檔 |
| --- | --- |
| macOS 12+（Apple 晶片） | `BrushLLM.Video.Studio-<version>-arm64.dmg` |
| Windows x64（Intel / AMD） | `BrushLLM.Video.Studio-<version>-x64.exe` |
| Windows ARM64 | `BrushLLM.Video.Studio-<version>-arm64.exe` |

發佈頁的 `SHA256SUMS` 包含三個安裝檔的校驗值。macOS 應用程式未經公證，Windows 安裝檔未簽署。

## 介面語言

English · Deutsch · Español · Français · Português (Brasil) · 日本語 · 简体中文 · 繁體中文 · 한국어

## 本機開發

使用 Node.js 22。桌面開發指令會同時啟動 Vite 和 Electron。

```bash
npm ci
npm run fetch-binaries
npm run dev
```

`npm test` 執行單元測試及實際 FFmpeg 整合測試。依序執行 `npm run build` 和 `npm start` 可啟動正式版介面。

## 授權

應用程式原始碼採 MIT 授權。隨附的 FFmpeg 與 FFprobe 遵循各自的上游授權。 [MIT](../LICENSE) · [FFmpeg](media-engine/NOTICE.md)
