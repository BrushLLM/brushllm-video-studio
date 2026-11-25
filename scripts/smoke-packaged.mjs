import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const executable = process.argv[2];
if (!executable) throw new Error('Usage: node scripts/smoke-packaged.mjs <app executable>');

const profile = mkdtempSync(join(tmpdir(), 'brushvs-install-smoke-'));
try {
  const result = spawnSync(resolve(executable), [`--user-data-dir=${profile}`], {
    env: { ...process.env, BRUSHVS_SMOKE: '1' },
    encoding: 'utf8',
    timeout: 90000
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || result.status !== 0) throw result.error || new Error(`Smoke test exited with ${result.status}`);
} finally {
  rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
}
