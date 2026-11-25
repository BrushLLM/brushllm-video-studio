# Bundled media engine

Video Studio runs FFmpeg and FFprobe as separate command-line programs. The bundled executables are distributed under the GNU General Public License, version 3 or later. The [license text](GPL-3.0.txt) accompanies the binaries.

| Package | Build | Source and build instructions |
| --- | --- | --- |
| macOS arm64 | Martin Riedl FFmpeg and FFprobe 9.1 | [FFmpeg 9.1 source](https://ffmpeg.org/releases/ffmpeg-9.1.tar.xz) · [Build scripts](https://git.martin-riedl.de/ffmpeg/build-script) · [Build dependencies](https://ffmpeg.martin-riedl.de/download/macos/arm64/1795207104_9.1/versions.txt) |
| Windows x64 and arm64 | FFmpeg-Builds n8.1.3-9-g29e619e767, GPL variant | [FFmpeg source revision](https://github.com/FFmpeg/FFmpeg/tree/29e619e767) · [Build scripts](https://github.com/FFmpeg-Builds/FFmpeg-Builds) · [Build release](https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/tag/autobuild-2026-09-30-13-08) |

The repository pins the download URLs and SHA-256 values in [scripts/media-engines.mjs](../../scripts/media-engines.mjs). The desktop application source uses the MIT license.
