# BrushLLM Video Studio

本地、免费、完全离线的视频 / 音频 / 字幕处理工具箱。
配色取自 [brushllm.com](https://brushllm.com),界面遵循 Apple 设计语言(macOS 隐藏标题栏、毛玻璃侧边栏、圆角卡片、分段控件)。

> 当前版本的所有处理都在本机完成;后续 AI 功能(OCR/转写/超分)将按需联网。
> v0.0.1 · 三平台独立安装包:macOS arm64(120 MB)/ Windows x64(166 MB)/ Windows arm64(144 MB),各自只含本平台引擎

## 快速开始

```bash
npm install
npm run fetch-binaries   # 下载固定版本的 FFmpeg/ffprobe(SHA-256 校验)
npm start
```

开发模式(热重载):`npm run dev`

测试:`npm test`(175 项:单元 + 端到端)

打包:`npm run dist`(三平台)

## 架构说明(重要)

- **三平台 thin 打包**:`dist:mac-arm64` / `dist:win-x64` / `dist:win-arm64` 三个独立构建,各自只携带对应架构的 FFmpeg/ffprobe
- 引擎来源**固定版本 + SHA-256 校验**(`scripts/fetch-binaries.mjs`)
- **防睡眠**(默认开启):处理任务期间阻止系统进入睡眠

## 性能与防睡眠

- **线程优化默认常开**:所有 FFmpeg 任务统一注入解码/滤镜/编码三层线程参数,VP9 额外启用 row-mt + tile-columns 并行(实测约 1.9x)
- **防睡眠**(设置页,默认开启):处理任务期间阻止系统进入睡眠(屏幕仍可关闭),队列空闲后自动恢复

## 硬件加速(诚实策略)

- 启动时精确解析 `ffmpeg -encoders`,只把真实存在的 VideoToolbox/NVENC/QSV/AMF 暴露给 UI
- 格式转换/压缩提供「自动 / CPU / GPU」三档
- 带滤镜的操作(裁剪/缩放/旋转/烧录)保持 CPU 路径
- GPU 编码用目标码率控制质量(VideoToolbox 无 CRF 语义)
- 音频「自动」:容器兼容时直接流复制

## 功能一览

### 视频(12 项)
格式转换、压缩、封装转换、裁切/剪辑、合并、调速、裁剪画面、缩放、旋转/翻转、提取帧、GIF/WebP 动图、元数据查看

### 音频(8 项)
格式转换、压缩、裁切、音量、响度标准化(EBU R128)、从视频提取、去除音轨、替换音轨

### 字幕(6 项)
SRT/VTT/ASS/SSA/TTML 互转、时间轴平移、编码转换(GBK/Big5→UTF-8)、字幕抽取、封装进视频、烧录进视频

所有操作都支持**批量处理**。

## 界面语言

按产品标准顺序支持:系统语言(默认)→ Deutsch → English → Español → Français → Português (Brasil) → 日本語 → 简体中文 → 繁體中文 → 한국어

## 灵感与参考

- [LosslessCut](https://github.com/mifi/lossless-cut)(44k⭐)— Electron + FFmpeg 架构
- [HandBrake](https://github.com/HandBrake/HandBrake)(24k⭐)— 预设与批量队列
- [Shutter Encoder](https://github.com/paulpacifico/shutter-encoder)(2.8k⭐)— 字幕/响度功能
- [Subtitle Edit](https://github.com/SubtitleEdit/subtitleedit)(14k⭐)— 字幕转换核心

## 许可

- 应用代码:MIT
- FFmpeg 遵循 GPL,源码可在 [ffmpeg.org](https://ffmpeg.org) 获取
