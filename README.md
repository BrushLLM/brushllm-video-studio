# BrushLLM Video Studio

本地、免费、完全离线的视频 / 音频 / 字幕处理工具箱。
配色取自 [brushllm.pages.dev](https://brushllm.pages.dev),界面遵循 Apple 设计语言(macOS 隐藏标题栏、毛玻璃侧边栏、圆角卡片、分段控件)。

> 当前版本的所有处理都在本机完成;后续 AI 功能(OCR/转写/超分)将按需联网。
> v0.0.1 · 三平台独立安装包:macOS arm64(120 MB)/ Windows x64(166 MB)/ Windows arm64(144 MB),各自只含本平台引擎

## 架构说明(重要)

- **三平台 thin 打包**:`dist:mac-arm64` / `dist:win-x64` / `dist:win-arm64` 三个独立构建,各自只携带对应架构的 FFmpeg/ffprobe,不含其他架构代码,也不含开发用的 npm fallback 二进制
- 引擎来源:macOS arm64 用 ffmpeg-static 6.0 + @ffprobe-installer(固定版本);Windows x64/arm64 统一用 BtbN FFmpeg-Builds n8.1(原生双架构,zip 内含 ffmpeg.exe + ffprobe.exe)
- 二进制来源**固定版本 + SHA-256 校验**(`scripts/fetch-binaries.mjs`),下载后校验校验和、Mach-O/PE 架构并试运行(macOS 侧);`npm run dist` 前置校验 vendor 完整性,不在打包过程中隐式联网
- `npm run fetch-binaries` 重建 `vendor/{darwin-arm64,win32-x64,win32-arm64}/`;`npm run measure` 输出各构件体积、二进制架构与 SHA-256 清单
- 首次打开未签名应用:macOS 若被 Gatekeeper 拦截,执行 `xattr -cr "BrushLLM Video Studio.app"`;Windows 在 SmartScreen 提示中选择"仍要运行"
- **Windows 发布门禁**:mac 上只能校验 Windows 二进制的架构与 SHA-256,无法执行;正式发布前请在真实 Windows 机器上跑一次 `npm run test:e2e` 和 `BRUSHVS_SMOKE=1` 冒烟测试

## 性能与防睡眠

- **线程优化默认常开**:所有 FFmpeg 任务统一注入解码/滤镜/编码三层线程参数,VP9 额外启用 row-mt + tile-columns 并行(实测约 1.9x)。质量参数不受影响,无需任何设置。
- **防睡眠**(设置页,默认开启):处理任务期间阻止系统进入睡眠(屏幕仍可关闭),队列空闲后自动恢复。

## 硬件加速(诚实策略)

- 启动时精确解析 `ffmpeg -encoders`,只有真实存在的 VideoToolbox/NVENC/QSV/AMF 才会出现在 UI
- 格式转换/压缩提供「自动 / CPU / GPU」三档:自动 = 有硬件编码器就用(计划摘要显示 `H.264 (GPU)` + 实际码率),没有就明确标注「CPU 软件编码」;选 GPU 但不可用是硬错误,绝不静默回退
- 带滤镜的操作(裁剪/缩放/旋转/烧录)保持 CPU 路径,避免硬件像素格式兼容性回归
- GPU 编码用目标码率控制质量(VideoToolbox 无 CRF 语义),码率按分辨率自动缩放
- 音频「自动」:容器兼容时直接流复制(计划显示「直接复制」),不兼容才重编码

## 性能基准

`npm run benchmark` 用**真实 UI 解析管线**(resolve → commands)对固定输入做 1 次预热 + 3 次取中位的转码基准,并带质量门禁(输出可探测、编码器与计划一致、时长误差 ≤1 帧、PSNR):

| 场景 | 耗时(中位) | 编码器 | PSNR |
|---|---|---|---|
| CPU medium(旧默认) | 1.43s | libx264 | 45.6 dB |
| CPU fast(新平衡默认) | 1.34s | libx264 | 45.5 dB |
| GPU H.264(VideoToolbox) | 1.16s | h264_videotoolbox | 42.9 dB |
| GPU H.265(VideoToolbox) | 1.23s | hevc_videotoolbox | 40.7 dB |

(合成测试源,实际视频的 GPU 优势通常更明显;报告存于 `benchmark-report.json`)

## 功能一览

### 视频(12 项,纯视频处理)

按「转换 / 剪辑 / 画面 / 导出」分组;音轨与字幕操作分别在音频、字幕页(提供跨页快捷入口,不重复注册)。

| 功能 | 说明 |
|---|---|
| 格式转换 | 四档用户预设(兼容性优先/平衡/高质量/小体积)+ 高级模式(codec/CRF/码率/编码速度);GPU 编码仅在真实检测到 VideoToolbox 等编码器时出现 |
| 压缩 | 同上,保留源编码族 |
| 封装转换 | 不重编码直接换容器 |
| 裁切 / 剪辑 | 默认关键帧无损,可切精确模式(重编码) |
| 合并 | concat 多段合一;编码一致时自动无损拼接 |
| 调速 | 0.25–4×,视频音频同步变速(atempo 自动链式) |
| 裁剪画面 | 自定义宽高偏移 + 比例预设 |
| 缩放 | 1080p–360p 预设或自定义,保持比例或拉伸 |
| 旋转 / 翻转 | 90 / 180 / 270° + 水平 / 垂直镜像 |
| 提取帧 | 连拍序列(可调 fps)或单帧,PNG / JPG |
| GIF / WebP 动图 | GIF 两遍调色板法,WebP 动画编码 |
| 元数据查看 | ffprobe 流 / 编码 / 码率 / 标签,含原始 JSON |

### 音频(8 项)

转换 / 压缩 / 裁切 / 音量 / 响度标准化(EBU R128)处理音频文件;「音轨」组(从视频提取、去除音轨、替换音轨)以视频为主输入。

### 字幕(6 项)

- **格式互转**:SRT / VTT / ASS / SSA / TTML,自研解析引擎,即时完成
- **时间轴平移**:整体提前 / 延后,可覆盖原文件
- **编码转换**:自动检测 GBK / Big5 / Shift-JIS / EUC-KR / UTF-16,转 UTF-8
- **字幕抽取 / 封装进视频 / 烧录进视频**(图形字幕 PGS/DVD 留待 AI 版)

### 统一媒体摘要(source → plan → actual)

选择操作后即显示输出预估卡:实际输出容器、编码器、质量/码率、时长、分辨率。CRF 模式如实显示「无法可靠预估大小」;目标码率模式给出估算;流复制显示「接近源文件大小」。任务完成后自动重新探测输出文件,在队列中显示**真实**的容器/大小/时长/码率。

## 快速开始

```bash
npm install     # 安装依赖(含内置 ffmpeg / ffprobe 二进制)
npm start       # 启动应用
```

开发模式(热重载):

```bash
npm run dev     # Vite dev server + Electron
```

测试:

```bash
npm test                    # 全部(单元 + 端到端)
npm run test:unit           # 命令生成器 + 字幕引擎
npm run test:e2e            # 真实 ffmpeg 跑全部操作并用 ffprobe 验证
BRUSHVS_SMOKE=1 npx electron .   # 应用冒烟测试(渲染 + IPC)
```

打包:

```bash
npm run dist    # electron-builder → release/ 下的 dmg + zip
```

## 架构

```
electron/                  主进程(CJS)
├── main.js                窗口、IPC、设置持久化、GPU 编码器精确检测、入队前集中解析
├── preload.js             contextBridge 安全 API(含 webUtils.getPathForFile)
└── engine/
    ├── binaries.js        ffmpeg/ffprobe 路径(vendor/<arch> → staging → 开发 fallback)
    ├── probe.js           ffprobe 元数据
    ├── commands.js        纯函数:操作+参数 → ffmpeg 参数(CRF/码率语义正确)
    ├── prepare.js         字幕预处理(转 UTF-8、格式适配)
    └── queue.js           任务队列、进度、取消/重试、失败清理、完成后 actual 探测

shared/
├── subtitles.js           字幕引擎:5 种格式解析/写出、平移、编码检测(CJS)
├── resolve.mjs            集中式编码解析器:硬件策略/容器约束/GPU 码率/音频 auto(ESM)
├── plan.mjs               source/plan/actual 三层媒体摘要(调用 resolve,与命令一致)
└── media.mjs              文件类型识别 + 各页面 accept 过滤(ESM)

vendor/<platform>-<arch>/  三平台 thin 二进制(固定版本 + SHA-256)

src/                       渲染进程(React + Vite)
├── i18n/                  9 语言 + 系统语言(280+ 键 × 9,含 parity 测试)
├── ops.js                 操作注册表(分组/预设/硬件策略/高级模式)
├── theme.css              brushllm 色板 + Apple 风格组件 + 窗口拖拽区
├── components/            ToolPage / ParamPanel / MediaSummary / ExtraInput / …
└── pages/                 Queue / Settings

scripts/
├── fetch-binaries.mjs     固定版本下载 + SHA-256/架构/试运行三重校验
├── stage-binaries.mjs     按目标平台/架构 staging,供 electron-builder 打包
├── benchmark-transcode.mjs 转码基准 + 质量门禁(PSNR/编码器一致性/时长)
└── measure-release.mjs    发布包体积/架构/SHA-256 测量

tests/                     node:test(153 项)
├── unit/                  109 项:命令 + 字幕 + plan + media + resolve + i18n parity
└── e2e/                   44 项:真实 ffmpeg 全操作 + plan/actual 一致性 + webm/无音轨输入
```

设计要点:

- **无损优先**:裁切、合并、封装转换默认 stream copy,不重编码(参考 LosslessCut)
- **命令可复现**:每个任务展示完整 ffmpeg 命令,可直接复制到终端
- **纯函数命令构建**:`commands.js` 不做 IO,153 项测试直接覆盖参数正确性
- **计划=命令=实际**:集中解析器(`shared/resolve.mjs`)统一决定实际编码器,UI 计划、命令文本、输出探测三者由测试保证一致;CRF 模式绝不携带默认码率
- **诚实 UI**:GPU 选项只在真实检测到硬件编码器时出现;CRF 模式不伪造文件大小预估;WebM/AVI 强制换编码器时明确提示
- **码率带单位**:所有码率输入以 kbps 为单位并校验范围,"1500" 永远是 1500 kbps
- **字幕双引擎**:文本格式互转走自研 JS 引擎(即时、无依赖);抽取/封装/烧录走 ffmpeg
- **浏览器可开发**:渲染层带 mock bridge,`npx vite` 即可在浏览器里开发调试 UI

## 界面语言

按产品标准顺序支持:系统语言(默认,跟随 macOS)→ Deutsch → English → Español → Français → Português (Brasil) → 日本語 → 简体中文 → 繁體中文 → 한국어。

## 灵感与参考

本项目站在以下杰出开源项目的肩膀上:

- [LosslessCut](https://github.com/mifi/lossless-cut)(44k⭐)— Electron + FFmpeg 架构、无损优先、命令日志
- [HandBrake](https://github.com/HandBrake/HandBrake)(24k⭐)— 预设与批量队列模型
- [Shutter Encoder](https://github.com/paulpacifico/shutter-encoder)(2.8k⭐)— 字幕内嵌/烧录、响度标准化、音轨替换
- [Subtitle Edit](https://github.com/SubtitleEdit/subtitleedit)(14k⭐)— 字幕格式转换核心

## AI 路线图(后期)

当前版本完全本地免费。后续计划接入的 AI 能力(架构已预留扩展点):

- 图形字幕 OCR(PGS/DVD → SRT,参考 Subtitle Edit 的 OCR 方向)
- 语音转写字幕(Whisper 类本地模型)
- 视频超分辨率、降噪、语音分离

## 许可

- 应用代码:MIT
- 内置 FFmpeg 二进制遵循 GPL,源码可在 [ffmpeg.org](https://ffmpeg.org) 获取;分发时请保留本说明
