// Fetches per-platform, per-arch (thin) ffmpeg / ffprobe binaries into
// vendor/<platform>-<arch>/. Run after install:  npm run fetch-binaries
//
// By default only the CURRENT platform is fetched (dev machines need just
// their own). Options:
//   --platform darwin-arm64            fetch one specific target
//   --platform win32-x64,win32-arm64   comma-separated list
//   --all                               fetch every supported target
//
// Supported targets (the only platforms this product ships on):
//   darwin-arm64  Martin Riedl static FFmpeg 9.1 (GPL)
//   win32-x64     BtbN FFmpeg-Builds n8.1 (zip contains ffmpeg.exe + ffprobe.exe)
//   win32-arm64   BtbN FFmpeg-Builds n8.1 (zip contains ffmpeg.exe + ffprobe.exe)
//
// Sources are pinned with SHA-256 checksums — each binary is verified
// (checksum, architecture and license output on the matching host).
import { execFileSync, spawnSync } from 'node:child_process';
import { createWriteStream, mkdirSync, mkdtempSync, rmSync, chmodSync, statSync, readFileSync, readdirSync, copyFileSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { PINNED, verifyChecksum } from './media-engines.mjs';

const root = join(fileURLToPath(import.meta.url), '..', '..');

async function download(url, dest) {
  const res = await fetch(url, { signal: AbortSignal.timeout(240000) });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  await pipeline(res.body, createWriteStream(dest));
}

// Architecture verification in pure Node — no `file`/`lipo` needed, so this
// works identically on macOS, Linux and Windows CI runners.
function verifyArch(file, platform, expectedArch) {
  const buf = readFileSync(file);
  if (platform === 'win32') {
    // PE: e_lfanew at 0x3C -> 'PE\0\0' -> machine (0xAA64=ARM64, 0x8664=x64).
    const peOff = buf.readUInt32LE(0x3c);
    if (buf.readUInt32LE(peOff) !== 0x00004550) throw new Error(`${file}: not a PE executable`);
    const machine = buf.readUInt16LE(peOff + 4);
    const expected = expectedArch === 'arm64' ? 0xaa64 : 0x8664;
    if (machine !== expected) {
      throw new Error(`${file}: expected PE machine 0x${expected.toString(16)}, got 0x${machine.toString(16)}`);
    }
  } else {
    // Mach-O magic: 0xfeedfacf (64-bit) little/big endian; cputype 0x0100000C=arm64, 0x01000007=x86_64.
    const magicLE = buf.readUInt32LE(0);
    const magicBE = buf.readUInt32BE(0);
    const is64 = magicLE === 0xfeedfacf || magicBE === 0xfeedfacf;
    if (!is64) throw new Error(`${file}: not a 64-bit Mach-O`);
    const cputype = magicLE === 0xfeedfacf ? buf.readUInt32LE(4) : buf.readUInt32BE(4);
    const expected = expectedArch === 'arm64' ? 0x0100000c : 0x01000007;
    if (cputype !== expected) {
      throw new Error(`${file}: expected Mach-O cputype ${expected.toString(16)}, got ${cputype.toString(16)}`);
    }
  }
}

function verifyRuns(file, target) {
  if (target !== `${process.platform}-${process.arch}`) return;
  const r = spawnSync(file, ['-L'], { windowsHide: true, timeout: 10000, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${file}: -L failed`);
  if (/--enable-nonfree|not legally redistributable/i.test(r.stdout + r.stderr)) {
    throw new Error(`${file}: the media engine must be a redistributable build`);
  }
}

function removeWorkDirectory(directory) {
  try {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error) {
    // Windows can still hold a verified executable open after the process exits.
    if (process.platform !== 'win32' || !['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY'].includes(error.code)) throw error;
    console.warn(`Could not remove temporary media engine files in ${directory}: ${error.message}`);
  }
}

async function fetchDarwinArm64(work, destDir, spec) {
  for (const tool of ['ffmpeg', 'ffprobe']) {
    const { url, sha256, archiveSha256 } = spec[tool];
    const archive = join(work, `${tool}.zip`);
    const file = join(work, tool);
    console.log(`downloading ${url}`);
    await download(url, archive);
    await verifyChecksum(archive, archiveSha256);
    execFileSync('tar', ['-xf', archive], { cwd: work });
    await verifyChecksum(file, sha256);
    chmodSync(file, 0o755);
    verifyArch(file, 'darwin', 'arm64');
    verifyRuns(file, 'darwin-arm64');
    rmSync(join(destDir, tool), { force: true });
    copyFileSync(file, join(destDir, tool));
    rmSync(file, { force: true });
    chmodSync(join(destDir, tool), 0o755);
    console.log(`vendor/darwin-arm64/${tool}: ${(statSync(join(destDir, tool)).size / 1048576).toFixed(1)} MB — verified`);
  }
}

async function fetchWindows(work, destDir, spec, arch) {
  const zip = join(work, 'btbn.zip');
  console.log(`downloading ${spec.zip.url}`);
  await download(spec.zip.url, zip);
  await verifyChecksum(zip, spec.zip.sha256);
  // Extract with PowerShell on Windows (tar on Windows runners can't handle
  // large zips reliably); bsdtar on macOS/Linux.
  if (process.platform === 'win32') {
    execFileSync('powershell', ['-NoProfile', '-Command', "Expand-Archive -Path 'btbn.zip' -DestinationPath '.' -Force"], { cwd: work });
  } else {
    execFileSync('tar', ['-xf', zip], { cwd: work });
  }
  const binDir = join(work, readdirSync(work).find((d) => d.startsWith('ffmpeg-') && !d.endsWith('.zip')), 'bin');
  for (const tool of ['ffmpeg', 'ffprobe']) {
    const src = join(binDir, `${tool}.exe`);
    await verifyChecksum(src, spec[tool].sha256);
    verifyArch(src, 'win32', arch);
    verifyRuns(src, `win32-${arch}`);
    rmSync(join(destDir, `${tool}.exe`), { force: true });
    copyFileSync(src, join(destDir, `${tool}.exe`));
    console.log(`vendor/win32-${arch}/${tool}.exe: ${(statSync(join(destDir, `${tool}.exe`)).size / 1048576).toFixed(1)} MB — sha256 + arch verified`);
  }
}

function resolveTargets() {
  const ALL = Object.keys(PINNED);
  const args = process.argv.slice(2);
  const platformArg = args.find((a) => a.startsWith('--platform=') || a === '--platform');
  let value = platformArg
    ? (platformArg.includes('=') ? platformArg.split('=')[1] : args[args.indexOf(platformArg) + 1])
    : null;
  if (args.includes('--all')) return ALL;
  if (!value) return [`${process.platform}-${process.arch}`];
  const wanted = value.split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = wanted.filter((t) => !ALL.includes(t));
  if (unknown.length) {
    throw new Error(`Unknown platform(s): ${unknown.join(', ')}. Supported: ${ALL.join(', ')}`);
  }
  return wanted;
}

async function main() {
  const targets = resolveTargets();
  console.log(`fetching binaries for: ${targets.join(', ')}`);
  const work = mkdtempSync(join(tmpdir(), 'brushvs-bin-'));
  try {
    for (const target of targets) {
      const destDir = join(root, 'vendor', target);
      const targetWork = join(work, target);
      mkdirSync(destDir, { recursive: true });
      mkdirSync(targetWork);
      if (target === 'darwin-arm64') {
        await fetchDarwinArm64(targetWork, destDir, PINNED[target]);
      } else {
        await fetchWindows(targetWork, destDir, PINNED[target], target.slice('win32-'.length));
      }
      removeWorkDirectory(targetWork);
    }
    console.log('done.');
  } finally {
    removeWorkDirectory(work);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
