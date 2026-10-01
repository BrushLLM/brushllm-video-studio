// Stages the target platform/arch thin binaries for electron-builder.
// Usage: node scripts/stage-binaries.mjs <darwin-arm64|win32-x64|win32-arm64>
// Copies vendor/<target>/{ffmpeg,ffprobe}[.exe] -> staging/vendor/ so the
// packaged app contains exactly one target's engine.
import { copyFileSync, mkdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const target = process.argv[2];
const IS_WIN = target?.startsWith('win32');
const EXE = (name) => (IS_WIN ? `${name}.exe` : name);

const TARGETS = ['darwin-arm64', 'win32-x64', 'win32-arm64'];
if (!TARGETS.includes(target)) {
  console.error(`Usage: node scripts/stage-binaries.mjs <${TARGETS.join('|')}>`);
  process.exit(1);
}

const srcDir = join(root, 'vendor', target);
const stagingDir = join(root, 'staging', 'vendor');

const fail = (msg) => {
  console.error(`stage-binaries: ${msg}`);
  process.exit(1);
};

for (const tool of ['ffmpeg', 'ffprobe']) {
  const src = join(srcDir, EXE(tool));
  if (!existsSync(src)) {
    fail(`missing vendor/${target}/${EXE(tool)} — run "npm run fetch-binaries" first`);
  }
  if (statSync(src).size < 1024 * 1024) {
    fail(`vendor/${target}/${EXE(tool)} looks truncated (${statSync(src).size} bytes)`);
  }
}

rmSync(join(root, 'staging'), { recursive: true, force: true });
mkdirSync(stagingDir, { recursive: true });
for (const tool of ['ffmpeg', 'ffprobe']) {
  copyFileSync(join(srcDir, EXE(tool)), join(stagingDir, EXE(tool)));
  const mb = (statSync(join(stagingDir, EXE(tool))).size / 1048576).toFixed(1);
  console.log(`staged ${target}/${EXE(tool)} -> staging/vendor/${EXE(tool)} (${mb} MB)`);
}
