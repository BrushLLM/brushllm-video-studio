// Resolves ffmpeg / ffprobe binary paths.
// Priority: user override from settings -> per-platform thin binaries in
// vendor/<platform>-<arch>/ (dev) or staged vendor/ (packaged) -> system
// PATH (dev only).
//
// Supported platforms: darwin-arm64, win32-x64, win32-arm64.
// Production packages carry ONLY the target binaries; a missing engine is a
// hard, readable error — never a silent wrong-arch fallback.
const path = require('node:path');
const fs = require('node:fs');

const TARGET = `${process.platform}-${process.arch}`;
const EXE = (name) => process.platform === 'win32' ? `${name}.exe` : name;

function isPackagedElectron() {
  return Boolean(process.versions.electron) && !process.defaultApp;
}

function installedEnginePath(name) {
  const candidate = isPackagedElectron()
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'staging', 'vendor', EXE(name))
    : path.join(__dirname, '..', '..', 'vendor', TARGET, EXE(name));
  return fs.existsSync(candidate) ? candidate : null;
}

function resolveBinaries(userFfmpegPath, userFfprobePath) {
  let ffmpeg = userFfmpegPath || installedEnginePath('ffmpeg');
  let ffprobe = userFfprobePath || installedEnginePath('ffprobe');

  if (!ffmpeg || !ffprobe) {
    if (isPackagedElectron()) {
      const missing = [!ffmpeg && EXE('ffmpeg'), !ffprobe && EXE('ffprobe')].filter(Boolean);
      throw new Error(
        `This package is missing its media engine (${missing.join(', ')}). ` +
        'The package is broken — please re-download or rebuild it.'
      );
    }
    // Dev-only fallback: the system PATH. vendor/ is the single binary
    // source — run `npm run fetch-binaries` when it is missing.
    if (!ffmpeg) ffmpeg = 'ffmpeg';
    if (!ffprobe) ffprobe = 'ffprobe';
  }
  return { ffmpeg, ffprobe };
}

module.exports = { resolveBinaries };
