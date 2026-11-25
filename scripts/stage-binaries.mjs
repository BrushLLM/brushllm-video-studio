// Stages the target platform/arch thin binaries for electron-builder.
// Usage: node scripts/stage-binaries.mjs <darwin-arm64|win32-x64|win32-arm64>
// Copies vendor/<target>/{ffmpeg,ffprobe}[.exe] -> staging/vendor/ so the
// packaged app contains exactly one target's engine.
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
import { PINNED, verifyChecksum } from './media-engines.mjs';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const target = process.argv[2];
const IS_WIN = target?.startsWith('win32');
const EXE = (name) => (IS_WIN ? `${name}.exe` : name);

if (!Object.hasOwn(PINNED, target)) {
  console.error(`Usage: node scripts/stage-binaries.mjs <${Object.keys(PINNED).join('|')}>`);
  process.exit(1);
}

const srcDir = join(root, 'vendor', target);
const staging = join(root, 'staging');
const stagingDir = join(staging, 'vendor');

const fail = (msg) => {
  console.error(`stage-binaries: ${msg}`);
  process.exit(1);
};

for (const tool of ['ffmpeg', 'ffprobe']) {
  const src = join(srcDir, EXE(tool));
  if (!existsSync(src)) {
    fail(`missing vendor/${target}/${EXE(tool)} — run "npm run fetch-binaries" first`);
  }
  try {
    await verifyChecksum(src, PINNED[target][tool].sha256);
  } catch (error) {
    fail(`${error.message}\nRefresh the engine with npm run fetch-binaries -- --platform ${target}`);
  }
}

rmSync(staging, { recursive: true, force: true });
mkdirSync(stagingDir, { recursive: true });

const profile = mkdtempSync(join(tmpdir(), 'brushvs-icon-'));
try {
  const render = spawnSync(electron, [
    join(root, 'scripts', 'render-icon.cjs'), join(staging, 'icon.png'), `--user-data-dir=${profile}`
  ], { stdio: 'inherit', timeout: 30000 });
  if (render.error || render.status !== 0) throw render.error || new Error('Could not render the installer icon');
} finally {
  rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
}

for (const tool of ['ffmpeg', 'ffprobe']) {
  copyFileSync(join(srcDir, EXE(tool)), join(stagingDir, EXE(tool)));
  const mb = (statSync(join(stagingDir, EXE(tool))).size / 1048576).toFixed(1);
  console.log(`staged ${target}/${EXE(tool)} -> staging/vendor/${EXE(tool)} (${mb} MB)`);
}
