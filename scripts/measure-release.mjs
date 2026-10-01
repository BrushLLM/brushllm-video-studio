// Measures release artifacts across all three build targets:
// installers, .app / unpacked .exe dirs, app.asar, staged vendor binaries,
// architectures and a SHA-256 manifest.
// Usage: node scripts/measure-release.mjs
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const release = join(root, 'release');

const mb = (p) => `${(statSync(p).size / 1048576).toFixed(1)} MB`;
const dirMb = (d) => {
  let total = 0;
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else total += statSync(p).size;
    }
  };
  walk(d);
  return `${(total / 1048576).toFixed(1)} MB`;
};
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16);

if (!existsSync(release)) {
  console.error('measure-release: no release/ directory — run npm run dist first');
  process.exit(1);
}

const BUILDS = [
  { label: 'mac-arm64', dir: join(release, 'mac-arm64-build'), app: 'mac-arm64/BrushLLM Video Studio.app', installerExt: '.dmg' },
  { label: 'win-x64', dir: join(release, 'win-x64-build'), app: 'win-unpacked', installerExt: '.exe' },
  { label: 'win-arm64', dir: join(release, 'win-arm64-build'), app: 'win-arm64-unpacked', installerExt: '.exe' }
];

for (const build of BUILDS) {
  if (!existsSync(build.dir)) continue;
  console.log(`\n=== ${build.label} ===`);
  for (const f of readdirSync(build.dir)) {
    if (f.endsWith(build.installerExt)) {
      console.log(`  installer: ${f} — ${mb(join(build.dir, f))}`);
    }
  }
  const appPath = join(build.dir, build.app);
  if (!existsSync(appPath)) continue;
  console.log(`  app bundle: ${dirMb(appPath)}`);

  const resources = build.label.startsWith('mac')
    ? join(appPath, 'Contents', 'Resources')
    : join(appPath, 'resources');
  const asar = join(resources, 'app.asar');
  if (existsSync(asar)) console.log(`  app.asar: ${mb(asar)}`);
  const unpacked = join(resources, 'app.asar.unpacked');
  if (existsSync(unpacked)) {
    console.log(`  app.asar.unpacked: ${dirMb(unpacked)}`);
    const vendor = join(unpacked, 'staging', 'vendor');
    if (existsSync(vendor)) {
      for (const tool of readdirSync(vendor)) {
        const p = join(vendor, tool);
        const info = execSync(`lipo -info "${p}" 2>/dev/null || file "${p}"`).toString().trim().split(': ').pop();
        console.log(`    vendor/${tool}: ${mb(p)} — ${info} — sha256:${sha(p)}`);
      }
    }
    for (const stray of ['node_modules/ffmpeg-static', 'node_modules/@ffprobe-installer']) {
      const p = join(unpacked, stray);
      if (existsSync(p)) console.log(`  ⚠︎ UNEXPECTED fallback shipped: ${stray} (${dirMb(p)})`);
    }
  }
}
