<img src="../build/video-studio.svg" width="72" height="72" alt="">

# BrushLLM Video Studio

在本机转换、编辑和导出视频、音频与字幕。把一套参数应用到多个文件，处理在设备上完成。安装包内含 FFmpeg 和 FFprobe。

[最新版本](https://github.com/BrushLLM/brushllm-video-studio/releases/latest) · [官网产品页](https://brushllm.com/zh-CN/video-studio/)

[English](../README.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Français](README.fr.md) | [Português (Brasil)](README.pt-BR.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [한국어](README.ko.md)

![视频工作区显示四个源文件、源画面和输出预估](../.github/assets/workspace.svg)

[查看处理队列截图](../.github/assets/queue.svg) · 预览素材来自 [MDN CC0 flower sample](https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4).

## 主要功能

- **视频** — 转换和压缩 MP4、MKV、WebM、MOV、AVI。支持裁切、裁剪、缩放、旋转、兼容片段无损合并，以及导出单帧或动图。
- **音频** — 转换、裁切音频，调整音量和响度，或提取、替换视频音轨。
- **字幕** — 转换 SRT、VTT、ASS、SSA 和 TTML，平移时间轴和修复编码。支持提取文本字幕轨、封装及烧录字幕。
- **批量队列** — 批量导入，核对输出设置与进度。在队列中暂停、取消或重试任务，查看结果和失败原因。

## 下载

从最新版本页面选择与设备架构相符的安装包。

| 支持平台 | 安装包 |
| --- | --- |
| macOS 12+（Apple 芯片） | `BrushLLM.Video.Studio-<version>-arm64.dmg` |
| Windows x64（Intel / AMD） | `BrushLLM.Video.Studio-<version>-x64.exe` |
| Windows ARM64 | `BrushLLM.Video.Studio-<version>-arm64.exe` |

发布页的 `SHA256SUMS` 包含三个安装包的校验值。macOS 应用未公证，Windows 安装包未签名。

## 界面语言

English · Deutsch · Español · Français · Português (Brasil) · 日本語 · 简体中文 · 繁體中文 · 한국어

## 本地开发

使用 Node.js 22。桌面开发命令会同时启动 Vite 和 Electron。

```bash
npm ci
npm run fetch-binaries
npm run dev
```

`npm test` 运行单元测试和真实 FFmpeg 集成测试。依次执行 `npm run build` 和 `npm start` 可运行生产渲染界面。

## 许可证

应用源代码采用 MIT 许可证。随包 FFmpeg 与 FFprobe 遵循各自的上游许可证。 [MIT](../LICENSE) · [FFmpeg](media-engine/NOTICE.md)
