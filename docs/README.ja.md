<img src="../build/video-studio.svg" width="72" height="72" alt="">

# BrushLLM Video Studio

動画、音声、字幕を処理する無料のデスクトップツールです。ローカルのファイルに同じ設定を適用して一括処理できます。FFmpeg と FFprobe を同梱しています。

[最新リリース](https://github.com/BrushLLM/brushllm-video-studio/releases/latest) · [製品ページ](https://brushllm.com/ja/video-studio/)

[English](../README.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [Português (Brasil)](README.pt-BR.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [한국어](README.ko.md)

![4 つの素材、元のフレーム、出力見積もりを表示する動画の作業画面](../.github/assets/workspace.svg)

[処理キューの画面を見る](../.github/assets/queue.svg) · プレビュー素材 [MDN CC0 flower sample](https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4).

## 主な機能

- **動画** — MP4、MKV、WebM、MOV、AVI の変換と圧縮。切り出し、クロップ、拡大縮小、回転、互換クリップの無劣化結合、静止画・アニメーションの書き出し。
- **音声** — 音声の変換と切り出し、音量とラウドネスの調整、動画の音声トラックの抽出と置き換え。
- **字幕** — SRT、VTT、ASS、SSA、TTML の変換、タイミング調整、文字コード修正。テキストトラック抽出、字幕の埋め込みと焼き付け。
- **処理キュー** — 複数ファイルを読み込み、出力設定と進捗を確認できます。キューで一時停止、取り消し、再試行を行い、結果やエラーを確認できます。

## ダウンロード

最新リリースからお使いの端末に合うインストーラーを選んでください。

| 対応環境 | インストーラー |
| --- | --- |
| macOS 12+（Apple Silicon） | `BrushLLM.Video.Studio-<version>-arm64.dmg` |
| Windows x64（Intel / AMD） | `BrushLLM.Video.Studio-<version>-x64.exe` |
| Windows ARM64 | `BrushLLM.Video.Studio-<version>-arm64.exe` |

`SHA256SUMS` に 3 つのインストーラーのチェックサムが記載されています。macOS 版は公証されておらず、Windows 版は署名されていません。

## 対応言語

English · Deutsch · Español · Français · Português (Brasil) · 日本語 · 简体中文 · 繁體中文 · 한국어

## ローカル開発

Node.js 24 LTS を使います。開発コマンドは Vite と Electron をまとめて起動します。

```bash
npm ci
npm run fetch-binaries
npm run dev
```

`npm test` で単体テストと FFmpeg を使った結合テストが実行されます。`npm run build` の後に `npm start` で本番用の画面を確認できます。

## ライセンス

アプリのソースコードは MIT ライセンスです。同梱の FFmpeg と FFprobe はそれぞれのライセンスに従います。 [MIT](../LICENSE) · [FFmpeg](media-engine/NOTICE.md)
