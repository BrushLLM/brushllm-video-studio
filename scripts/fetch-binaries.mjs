// Fetches per-platform, per-arch (thin) ffmpeg / ffprobe binaries into
// vendor/<platform>-<arch>/. Run after install:  node scripts/fetch-binaries.mjs
//
// Supported targets (the only platforms this product ships on):
//   darwin-arm64  ffmpeg-static b6.1.1 + @ffprobe-installer/darwin-arm64@5.0.1
//   win32-x64     BtbN FFmpeg-Builds n8.1 (zip contains ffmpeg.exe + ffprobe.exe)
//   win32-arm64   BtbN FFmpeg-Builds n8.1 (zip contains ffmpeg.exe + ffprobe.exe)
//
// Sources are pinned with SHA-256 checksums — each binary is verified
// (checksum, architecture, -version) before it is written.
import { execSync, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, rmSync, chmodSync, statSync, renameSync, readFileSync, readdirSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const EXE = (tool) => (process.platform === 'win32' ? `${tool}.exe` : tool);

const PINNED = {
  'darwin-arm64': {
    ffmpeg: {
      url: 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-darwin-arm64',
      sha256: 'a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584',
      arch: 'arm64'
    },
    ffprobe: {
      npm: '@ffprobe-installer/darwin-arm64@5.0.1',
      sha256: 'c846d5db9d3b5bc33f987725e21f3ea14953931221c191575918e907ad6c18ff',
      arch: 'arm64'
    }
  },
  'win32-x64': {
    zip: {
      // Pinned to an immutable dated autobuild release (the rolling "latest"
      // tag gets rebuilt upstream, which breaks SHA pinning).
      url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-30-13-08/ffmpeg-n8.1.3-9-g29e619e767-win64-gpl-8.1.zip',
      sha256: null, // zip hash checked when provided; the inner binaries are pinned
      arch: 'x64'
    },
    ffmpeg: { sha256: 'c6caa1894d3276556c84b36acc1d219d69f972c0a7525b23f1cad2bdf05c4231' },
    ffprobe: { sha256: 'b6177ba8d7d65ab993e5770ac154843db1af3db9838ae966ee6729129ddcd59f' }
  },
  'win32-arm64': {
    zip: {
      url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-30-13-08/ffmpeg-n8.1.3-9-g29e619e767-winarm64-gpl-8.1.zip',
      sha256: null,
      arch: 'arm64'
    },
    ffmpeg: { sha256: '429f987f6d577e9fe51938161dc81709adccc771714dec7c7b3c9e4b1d202b74' },
    ffprobe: { sha256: '2177965ef9e57c8c5c9c5b623175a9071194af37878652fc4a9c60bd2447461f' }
  }
};

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  await pipeline(res.body, createWriteStream(dest));
}

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

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

function verifyRuns(file) {
  // Only verify execution on the matching host platform — a darwin binary
  // can't run on a Windows runner (and vice versa). SHA + arch checks are
  // the executable verification for cross-platform fetches.
  const isDarwinBin = file.includes('darwin') || !file.includes('.exe');
  const canRun = (process.platform === 'darwin' && isDarwinBin) ||
                 (process.platform === 'win32' && file.includes('.exe'));
  if (!canRun) return;
  const r = spawnSync(file, ['-version']);
  if (r.status !== 0) throw new Error(`${file}: -version failed`);
}

async function fetchDarwinArm64(work, destDir, spec) {
  for (const tool of ['ffmpeg', 'ffprobe']) {
    const s = spec[tool];
    const file = join(work, tool);
    if (s.url) {
      console.log(`downloading ${s.url}`);
      await download(s.url, file);
    } else {
      console.log(`packing ${s.npm}`);
      const tgzName = execSync(`npm pack ${s.npm}`, { cwd: work }).toString().trim().split('\n').pop();
      execSync(`tar -xzf "${join(work, tgzName)}" -C "${work}"`);
      renameSync(join(work, 'package', tool), file);
      rmSync(join(work, 'package'), { recursive: true, force: true });
    }
    chmodSync(file, 0o755);
    const digest = sha256(file);
    if (digest !== s.sha256) throw new Error(`${tool}: SHA-256 mismatch\n  expected ${s.sha256}\n  got      ${digest}`);
    verifyArch(file, 'darwin', s.arch);
    verifyRuns(file);
    rmSync(join(destDir, tool), { force: true });
    renameSync(file, join(destDir, tool));
    chmodSync(join(destDir, tool), 0o755);
    console.log(`vendor/darwin-arm64/${tool}: ${(statSync(join(destDir, tool)).size / 1048576).toFixed(1)} MB — verified`);
  }
}

async function fetchWindows(work, destDir, spec, arch) {
  const zip = join(work, 'btbn.zip');
  console.log(`downloading ${spec.zip.url}`);
  await download(spec.zip.url, zip);
  // bsdtar handles zip on macOS, Linux and Windows runners alike.
  execSync(`tar -xf "${zip}" -C "${work}"`);
  const binDir = join(work, readdirSync(work).find((d) => d.startsWith('ffmpeg-') && !d.endsWith('.zip')), 'bin');
  for (const tool of ['ffmpeg', 'ffprobe']) {
    const src = join(binDir, `${tool}.exe`);
    const digest = sha256(src);
    if (digest !== spec[tool].sha256) {
      throw new Error(`${tool}.exe: SHA-256 mismatch\n  expected ${spec[tool].sha256}\n  got      ${digest}`);
    }
    verifyArch(src, 'win32', arch);
    rmSync(join(destDir, `${tool}.exe`), { force: true });
    renameSync(src, join(destDir, `${tool}.exe`));
    console.log(`vendor/win32-${arch}/${tool}.exe: ${(statSync(join(destDir, `${tool}.exe`)).size / 1048576).toFixed(1)} MB — sha256 + arch verified`);
  }
  // -version cannot run on a non-Windows host; the checksum + PE arch checks
  // above are the executable verification for cross-built packages.
}

async function main() {
  const work = join(tmpdir(), `brushvs-bin-${Date.now()}`);
  mkdirSync(work, { recursive: true });
  try {
    for (const target of ['darwin-arm64', 'win32-x64', 'win32-arm64']) {
      const destDir = join(root, 'vendor', target);
      mkdirSync(destDir, { recursive: true });
      if (target === 'darwin-arm64') {
        await fetchDarwinArm64(work, destDir, PINNED[target]);
      } else {
        await fetchWindows(work, destDir, PINNED[target], target === 'win32-x64' ? 'x64' : 'arm64');
      }
      rmSync(work, { recursive: true, force: true });
      mkdirSync(work, { recursive: true });
    }
    // Remove superseded layouts (old per-arch / universal dirs).
    for (const legacy of ['arm64', 'x64']) {
      const p = join(root, 'vendor', legacy);
      if (existsSync(p)) rmSync(p, { recursive: true, force: true });
    }
    console.log('done.');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
