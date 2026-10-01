// Transcode benchmark: fixed input, the ACTUAL UI resolution pipeline
// (shared/resolve.mjs -> engine commands.js), 1 warmup + 3 measured runs.
//
// Scenarios: CPU medium (old baseline), CPU fast (new balanced default),
// VideoToolbox H.264 / H.265 (only when really available), bitrate mode.
// Gates: outputs must be ffprobe-readable with the planned encoder, duration
// within one frame, and CPU fast must beat CPU medium at the same CRF.
//
// Usage: node scripts/benchmark-transcode.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolveEncoding, applyResolved } from '../shared/resolve.mjs';
import { buildJobCommands } from '../electron/engine/commands.js';
import { probe, summarize } from '../electron/engine/probe.js';
import { resolveBinaries } from '../electron/engine/binaries.js';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const { ffmpeg, ffprobe } = resolveBinaries();
const work = join(tmpdir(), `brushvs-bench-${Date.now()}`);
mkdirSync(work, { recursive: true });

const INPUT = join(work, 'input.mp4');
const DUR = 10;

function sh(bin, args) {
  const r = spawnSync(bin, args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${bin} failed: ${String(r.stderr || '').slice(-300)}`);
  return r;
}

function detectGpu() {
  const out = spawnSync(ffmpeg, ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout || '';
  const names = new Set();
  for (const line of out.split('\n')) {
    const m = line.match(/^\s*[A-Z.]{4,6}\s+([a-zA-Z0-9_]+)\s+\S/);
    if (m) names.add(m[1]);
  }
  return ['h264_videotoolbox', 'hevc_videotoolbox', 'h264_nvenc', 'hevc_nvenc', 'h264_qsv', 'hevc_qsv'].filter((e) => names.has(e));
}

async function runOnce(scenario) {
  const out = join(work, `out-${scenario.id}-${Date.now()}.mp4`);
  const resolved = resolveEncoding('video.convert', scenario.params, scenario.source, { gpuEncoders: scenario.gpuEncoders });
  const finalParams = applyResolved(scenario.params, resolved);
  const built = buildJobCommands('video.convert', finalParams, [INPUT], out, { probe: scenario.source, hasAudio: true, hasVideo: true });
  const args = built.steps[0].args.filter((a) => a !== '-progress' && a !== 'pipe:1' && a !== '-nostats');

  const t0 = Date.now();
  const r = await new Promise((resolveRun) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-y', ...args]);
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolveRun({ code, stderr }));
  });
  const wallMs = Date.now() - t0;
  if (r.code !== 0) throw new Error(`${scenario.id}: ffmpeg exited ${r.code}: ${r.stderr.slice(-300)}`);

  const speedMatch = [...r.stderr.matchAll(/speed=\s*([\d.]+)x/g)].pop();
  const raw = await probe(ffprobe, out);
  const actual = summarize(raw);
  const size = statSync(out).size;

  // PSNR against the fixed source (same resolution, no filters).
  const psnr = spawnSync(ffmpeg, ['-hide_banner', '-i', INPUT, '-i', out, '-lavfi', '[0:v][1:v]psnr', '-f', 'null', '-'], { encoding: 'utf8' });
  const psnrMatch = psnr.stderr && psnr.stderr.match(/average:([\d.]+)/);

  rmSync(out, { force: true });
  return {
    scenario: scenario.id,
    wallMs,
    ffmpegSpeed: speedMatch ? `${speedMatch[1]}x` : null,
    encoder: actual.video ? actual.video.codec : null,
    plannedEncoder: resolved.videoCodec,
    durationSec: actual.durationSec,
    sizeBytes: size,
    psnrDb: psnrMatch ? Number(psnrMatch[1]) : null
  };
}

async function main() {
  console.log(`ffmpeg: ${ffmpeg}`);
  const gpuEncoders = detectGpu();
  console.log(`hardware encoders: ${gpuEncoders.length ? gpuEncoders.join(', ') : 'none'}`);

  // Fixed input: 10 s 1080p24 + AAC.
  sh(ffmpeg, ['-hide_banner', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=24',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=' + DUR,
    '-t', String(DUR), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'fast',
    '-c:a', 'aac', '-b:a', '128k', INPUT]);
  const source = summarize(await probe(ffprobe, INPUT));
  console.log(`input: ${source.video.width}x${source.video.height} ${source.video.fps}fps ${source.durationSec}s\n`);

  const scenarios = [
    { id: 'cpu-medium', params: { container: 'mp4', videoCodec: 'h264', crf: 23, mode: 'crf', encodeSpeed: 'medium', audioCodec: 'auto', hwStrategy: 'cpu' } },
    { id: 'cpu-fast', params: { container: 'mp4', videoCodec: 'h264', crf: 23, mode: 'crf', encodeSpeed: 'fast', audioCodec: 'auto', hwStrategy: 'cpu' } }
  ];
  if (gpuEncoders.includes('h264_videotoolbox')) {
    scenarios.push({ id: 'gpu-h264', params: { container: 'mp4', videoCodec: 'h264', crf: 23, mode: 'crf', qualityPreset: 'balanced', audioCodec: 'auto', hwStrategy: 'auto' } });
  }
  if (gpuEncoders.includes('hevc_videotoolbox')) {
    scenarios.push({ id: 'gpu-hevc', params: { container: 'mp4', videoCodec: 'hevc', crf: 26, mode: 'crf', qualityPreset: 'small', audioCodec: 'auto', hwStrategy: 'auto' } });
  }
  scenarios.push({ id: 'cpu-bitrate', params: { container: 'mp4', videoCodec: 'h264', mode: 'bitrate', videoBitrate: 5000, encodeSpeed: 'fast', audioCodec: 'auto', hwStrategy: 'cpu' } });

  for (const s of scenarios) {
    s.gpuEncoders = gpuEncoders;
    s.source = source;
  }

  const results = {};
  for (const s of scenarios) {
    await runOnce(s); // warmup
    const runs = [];
    for (let i = 0; i < 3; i++) runs.push(await runOnce(s));
    const median = (key, pick = (x) => x) => {
      const vals = runs.map(pick).filter((v) => v != null).sort((a, b) => a - b);
      return vals.length ? vals[Math.floor(vals.length / 2)] : null;
    };
    results[s.id] = {
      wallMsMedian: median('wall', (r) => r.wallMs),
      ffmpegSpeed: runs[runs.length - 1].ffmpegSpeed,
      encoder: runs[0].encoder,
      plannedEncoder: runs[0].plannedEncoder,
      durationSec: runs[0].durationSec,
      sizeBytesMedian: median('size', (r) => r.sizeBytes),
      psnrDbMedian: median('psnr', (r) => r.psnrDb),
      runs
    };
  }

  // ------------------------------------------------------------ report
  const fmt = (ms) => `${(ms / 1000).toFixed(2)}s`;
  console.log('scenario       | wall (median) | ffmpeg speed | encoder            | size      | PSNR');
  console.log('---------------|---------------|--------------|--------------------|-----------|---------');
  for (const [id, r] of Object.entries(results)) {
    console.log(
      `${id.padEnd(15)}| ${fmt(r.wallMsMedian).padEnd(13)} | ${(r.ffmpegSpeed || '—').padEnd(12)} | ${(r.encoder || '—').padEnd(18)} | ${(r.sizeBytesMedian / 1048576).toFixed(1).padEnd(8)}MB | ${(r.psnrDbMedian ? r.psnrDbMedian.toFixed(1) + ' dB' : '—')}`
    );
  }

  // ------------------------------------------------------------ gates
  const failures = [];
  for (const [id, r] of Object.entries(results)) {
    if (!r.encoder) failures.push(`${id}: output not ffprobe-readable`);
    const planned = { h264: 'h264', hevc: 'hevc', h264_videotoolbox: 'h264', hevc_videotoolbox: 'hevc', vp9: 'vp9', mpeg4: 'mpeg4' }[r.plannedEncoder] || r.plannedEncoder;
    if (r.encoder !== planned) failures.push(`${id}: encoder ${r.encoder} != planned ${planned}`);
    if (Math.abs(r.durationSec - DUR) > 0.05) failures.push(`${id}: duration ${r.durationSec}s off by more than a frame`);
    if (r.psnrDbMedian == null) failures.push(`${id}: PSNR could not be computed`);
  }
  if (results['cpu-fast'] && results['cpu-medium'] && results['cpu-fast'].wallMsMedian >= results['cpu-medium'].wallMsMedian) {
    failures.push('cpu-fast did not beat cpu-medium at the same CRF');
  }

  const report = {
    date: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    ffmpeg: spawnSync(ffmpeg, ['-version'], { encoding: 'utf8' }).stdout.split('\n')[0],
    gpuEncoders,
    input: { resolution: `${source.video.width}x${source.video.height}`, fps: source.video.fps, durationSec: source.durationSec },
    results,
    gates: { failures }
  };
  writeFileSync(join(root, 'benchmark-report.json'), JSON.stringify(report, null, 2));
  console.log(`\nreport: benchmark-report.json`);

  rmSync(work, { recursive: true, force: true });
  if (failures.length) {
    console.error('\nGATE FAILURES:');
    failures.forEach((f) => console.error('  ✗ ' + f));
    process.exit(1);
  }
  console.log('\nall gates passed ✓');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
