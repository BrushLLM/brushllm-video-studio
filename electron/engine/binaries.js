// Resolves ffmpeg / ffprobe binary paths.
// Priority: user override from settings -> per-platform thin binaries in
// vendor/<platform>-<arch>/ (dev) or staged vendor/ (packaged) -> dev-only
// npm fallbacks.
//
// Supported platforms: darwin-arm64, win32-x64, win32-arm64.
// Production packages carry ONLY the target binaries; a missing engine is a
// hard, readable error — never a silent wrong-arch fallback.
const path = require('node:path');
const fs = require('node:fs');

const SUPPORTED = new Set(['darwin-arm64', 'win32-x64', 'win32-arm64']);
const TARGET = `${process.platform}-${process.arch}`;
const IS_WINDOWS = process.platform === 'win32';
const EXE = (name) => (IS_WINDOWS ? `${name}.exe` : name);

function unpacked(p) {
  // In packaged builds the binaries live in app.asar.unpacked (see electron-builder.yml).
  if (p && p.includes('app.asar')) {
    return p.replace(/app\.asar/g, 'app.asar.unpacked');
  }
  return p;
}

function isPackagedElectron() {
  return Boolean(process.versions.electron) && !process.defaultApp && !process.env.ELECTRON_START_URL;
}

function vendorPath(name) {
  // Dev: vendor/<platform>-<arch>/<name>. Packaged: staged vendor/<name>.
  const candidates = [
    path.join(__dirname, '..', '..', 'vendor', TARGET, EXE(name)),
    unpacked(path.join(__dirname, '..', '..', 'staging', 'vendor', EXE(name)))
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function safeRequire(id) {
  try {
    return require(id);
  } catch {
    return null;
  }
}

function resolveBinaries(userFfmpegPath, userFfprobePath) {
  let ffmpeg = userFfmpegPath || vendorPath('ffmpeg') || null;
  let ffprobe = userFfprobePath || vendorPath('ffprobe') || null;

  if (!ffmpeg || !ffprobe) {
    if (isPackagedElectron()) {
      const missing = [!ffmpeg && `vendor/${TARGET}/ffmpeg`, !ffprobe && `vendor/${TARGET}/ffprobe`].filter(Boolean);
      throw new Error(
        `This package is missing its media engine (${missing.join(', ')}). ` +
        'The package is broken — please re-download or rebuild it.'
      );
    }
    // Dev-only fallbacks (devDependencies, never shipped in production).
    if (!ffmpeg) ffmpeg = unpacked(safeRequire('ffmpeg-static')) || 'ffmpeg';
    if (!ffprobe) {
      ffprobe = unpacked(safeRequire('@ffprobe-installer/ffprobe')?.path)
        || unpacked(safeRequire('ffprobe-static')?.path)
        || 'ffprobe';
    }
  }
  return { ffmpeg, ffprobe };
}

function supportedTarget() {
  return SUPPORTED.has(TARGET);
}

module.exports = { resolveBinaries, unpacked, supportedTarget, TARGET };
