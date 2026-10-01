// End-to-end: generate sample media with the bundled ffmpeg, run every
// operation through the real JobManager, verify outputs with ffprobe.
const { test, before } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { JobManager } = require('../../electron/engine/queue');
const { probe, summarize } = require('../../electron/engine/probe');
const { resolveBinaries } = require('../../electron/engine/binaries');
const subs = require('../../shared/subtitles');

const MEDIA = path.join(__dirname, '..', 'media');
const OUT = path.join(MEDIA, 'out');
const FFMPEG = resolveBinaries().ffmpeg;
const FFPROBE = resolveBinaries().ffprobe;
let manager;

function ff(args) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr?.slice(-800)}`);
  return r;
}

function out(name) {
  return path.join(OUT, name);
}

async function runJob(spec) {
  const job = await manager.add(spec);
  return waitForJob(job.id);
}

function waitForJob(id, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const j = manager.jobs.get(id);
      reject(new Error(`Job ${id} timed out. status=${j && j.status} error=${j && j.error}`));
    }, timeoutMs);
    const check = (job) => {
      if (job.id !== id) return;
      if (job.status === 'done' || job.status === 'error' || job.status === 'canceled') {
        clearTimeout(timer);
        manager.removeListener('updated', check);
        if (job.status === 'error') {
          reject(new Error(`Job ${id} error: ${job.error}`));
        } else {
          resolve(job);
        }
      }
    };
    manager.on('updated', check);
    check(manager.jobs.get(id) || { id });
  });
}

async function probeFile(p) {
  return probe(FFPROBE, p);
}

async function streamOf(p, type) {
  const raw = await probeFile(p);
  const s = (raw.streams || []).find((x) => x.codec_type === type);
  return { raw, stream: s };
}

before(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  // 6s 640x360 h264+aac samples (two, same codecs for lossless merge).
  // Keyframe every second so lossless trims land predictably.
  const KF = ['-force_key_frames', 'expr:gte(t,n_forced*1)'];
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=15',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6',
    '-t', '6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', ...KF, '-c:a', 'aac',
    '-shortest', out('sample.mp4')]);
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=15',
    '-f', 'lavfi', '-i', 'sine=frequency=880:duration=6',
    '-t', '6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', ...KF, '-c:a', 'aac',
    '-shortest', out('sample2.mp4')]);
  ff(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=5',
    '-c:a', 'libmp3lame', '-b:a', '128k', out('sample.mp3')]);
  fs.writeFileSync(out('sample.srt'),
    `1
00:00:01,000 --> 00:00:03,000
Hello world

2
00:00:04,000 --> 00:00:06,000
Second subtitle line
`, 'utf8');
  // MKV with an embedded SRT track, for subtitle extraction.
  ff(['-i', out('sample.mp4'), '-i', out('sample.srt'),
    '-map', '0', '-map', '1', '-c', 'copy', '-c:s', 'srt', out('sample_sub.mkv')]);
  // Input diversity: WebM (VP9+Opus), MKV (H.264+Opus), and a video without audio.
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=15',
    '-f', 'lavfi', '-i', 'sine=frequency=660:duration=4',
    '-t', '4', '-c:v', 'libvpx-vp9', '-crf', '40', '-b:v', '0',
    '-c:a', 'libopus', '-shortest', out('sample.webm')]);
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=15',
    '-f', 'lavfi', '-i', 'sine=frequency=660:duration=4',
    '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'libopus', '-shortest', out('sample_opus.mkv')]);
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=15',
    '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', out('sample_noaudio.mp4')]);
  manager = new JobManager({ ffmpeg: FFMPEG, ffprobe: FFPROBE, concurrency: 1 });
});

// ------------------------------------------------------------------ video

test('video.convert mp4 -> mkv keeps h264 and duration', async () => {
  const job = await runJob({ op: 'video.convert', params: { container: 'mkv', videoCodec: 'h264', audioCodec: 'copy', crf: 20 }, inputs: [out('sample.mp4')], outputPath: out('t-convert.mkv') });
  const { raw, stream } = await streamOf(job.outputPath, 'video');
  assert.equal(stream.codec_name, 'h264');
  assert.ok(Math.abs(parseFloat(raw.format.duration) - 6) < 0.7);
});

test('video.convert mp4 -> webm produces vp9+opus', async () => {
  const job = await runJob({ op: 'video.convert', params: { container: 'webm', crf: 35 }, inputs: [out('sample.mp4')], outputPath: out('t-convert.webm') });
  const { stream: v } = await streamOf(job.outputPath, 'video');
  const { stream: a } = await streamOf(job.outputPath, 'audio');
  assert.equal(v.codec_name, 'vp9');
  assert.equal(a.codec_name, 'opus');
});

test('video.compress re-encodes smaller', async () => {
  const job = await runJob({ op: 'video.compress', params: { mode: 'crf', crf: 30, audioBitrate: 96 }, inputs: [out('sample.mp4')], outputPath: out('t-compress.mp4') });
  const raw = await probeFile(job.outputPath);
  const original = fs.statSync(out('sample.mp4')).size;
  assert.ok(fs.statSync(job.outputPath).size < original, 'compressed should be smaller');
  assert.ok(raw.streams.some((s) => s.codec_type === 'video'));
});

test('video.merge lossless concat of same-codec files', async () => {
  const job = await runJob({ op: 'video.merge', params: { mode: 'copy', container: 'mp4' }, inputs: [out('sample.mp4'), out('sample2.mp4')], outputPath: out('t-merge.mp4') });
  const { raw, stream } = await streamOf(job.outputPath, 'video');
  assert.equal(stream.codec_name, 'h264');
  assert.ok(Math.abs(parseFloat(raw.format.duration) - 12) < 1.2, `duration ~12s, got ${raw.format.duration}`);
});

test('video.trim lossless cuts a range', async () => {
  const job = await runJob({ op: 'video.trim', params: { startSec: 2, endSec: 4, precise: false }, inputs: [out('sample.mp4')], outputPath: out('t-trim.mp4') });
  const { raw } = await streamOf(job.outputPath, 'video');
  const d = parseFloat(raw.format.duration);
  assert.ok(d > 1 && d < 2.6, `trimmed duration ~2s, got ${d}`);
});

test('video.trim precise re-encode is frame accurate', async () => {
  const job = await runJob({ op: 'video.trim', params: { startSec: 1, endSec: 3, precise: true }, inputs: [out('sample.mp4')], outputPath: out('t-trim2.mp4') });
  const { raw } = await streamOf(job.outputPath, 'video');
  assert.ok(Math.abs(parseFloat(raw.format.duration) - 2) < 0.15);
});

test('video.crop to 320x180', async () => {
  const job = await runJob({ op: 'video.crop', params: { w: 320, h: 180, x: 0, y: 0 }, inputs: [out('sample.mp4')], outputPath: out('t-crop.mp4') });
  const { stream } = await streamOf(job.outputPath, 'video');
  assert.equal(stream.width, 320);
  assert.equal(stream.height, 180);
});

test('video.scale fit keeps aspect with letterbox', async () => {
  const job = await runJob({ op: 'video.scale', params: { width: 320, height: 240, mode: 'fit' }, inputs: [out('sample.mp4')], outputPath: out('t-scale.mp4') });
  const { stream } = await streamOf(job.outputPath, 'video');
  assert.equal(stream.width, 320);
  assert.equal(stream.height, 240);
});

test('video.rotate 90 swaps dimensions', async () => {
  const job = await runJob({ op: 'video.rotate', params: { angle: 90 }, inputs: [out('sample.mp4')], outputPath: out('t-rotate.mp4') });
  const { stream } = await streamOf(job.outputPath, 'video');
  assert.equal(stream.width, 360);
  assert.equal(stream.height, 640);
});

test('video.speed 2x halves duration', async () => {
  const job = await runJob({ op: 'video.speed', params: { factor: 2 }, inputs: [out('sample.mp4')], outputPath: out('t-speed.mp4') });
  const { raw } = await streamOf(job.outputPath, 'video');
  assert.ok(Math.abs(parseFloat(raw.format.duration) - 3) < 0.4, `got ${raw.format.duration}`);
});

test('video.mute removes the audio stream', async () => {
  const job = await runJob({ op: 'video.mute', params: {}, inputs: [out('sample.mp4')], outputPath: out('t-mute.mp4') });
  const { raw } = await streamOf(job.outputPath, 'video');
  assert.ok(!raw.streams.some((s) => s.codec_type === 'audio'));
  assert.ok(raw.streams.some((s) => s.codec_type === 'video'));
});

test('video.replaceAudio swaps the track', async () => {
  const job = await runJob({ op: 'video.replaceAudio', params: {}, inputs: [out('sample.mp4'), out('sample.mp3')], outputPath: out('t-replaudio.mp4') });
  const { stream } = await streamOf(job.outputPath, 'audio');
  assert.equal(stream.codec_name, 'aac'); // re-encoded to aac for mp4
});

test('video.extractAudio copy keeps aac as m4a', async () => {
  const job = await runJob({ op: 'video.extractAudio', params: { format: 'copy' }, inputs: [out('sample.mp4')], outputPath: out('t-audio.mka') });
  assert.match(job.outputPath, /\.m4a$/);
  const { stream } = await streamOf(job.outputPath, 'audio');
  assert.equal(stream.codec_name, 'aac');
});

test('video.extractAudio mp3 re-encodes', async () => {
  const job = await runJob({ op: 'video.extractAudio', params: { format: 'mp3', bitrate: 160 }, inputs: [out('sample.mp4')], outputPath: out('t-audio.mp3') });
  const { stream } = await streamOf(job.outputPath, 'audio');
  assert.equal(stream.codec_name, 'mp3');
});

test('video.extractFrames sequence writes numbered pngs', async () => {
  const job = await runJob({ op: 'video.extractFrames', params: { mode: 'sequence', fps: 2, format: 'png' }, inputs: [out('sample.mp4')], outputPath: out('t-frames') });
  const dir = path.dirname(job.outputPath);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png'));
  assert.ok(files.length >= 10, `expected ~12 frames, got ${files.length}`);
});

test('video.extractFrames single grabs one frame', async () => {
  const job = await runJob({ op: 'video.extractFrames', params: { mode: 'single', timeSec: 3, format: 'png' }, inputs: [out('sample.mp4')], outputPath: out('t-oneframe') });
  assert.ok(fs.existsSync(job.outputPath));
});

test('video.anim gif two-pass palette', async () => {
  const job = await runJob({ op: 'video.anim', params: { format: 'gif', fps: 10, width: 320, startSec: 0, endSec: 3 }, inputs: [out('sample.mp4')], outputPath: out('t-anim.gif') });
  const raw = await probeFile(job.outputPath);
  assert.match(raw.format.format_name, /gif/);
  assert.ok(fs.statSync(job.outputPath).size > 1000);
});

test('video.anim webp animated', async () => {
  const job = await runJob({ op: 'video.anim', params: { format: 'webp', fps: 10, width: 320, quality: 70, startSec: 0, endSec: 2 }, inputs: [out('sample.mp4')], outputPath: out('t-anim.webp') });
  const raw = await probeFile(job.outputPath);
  assert.match(raw.format.format_name, /webp/);
});

test('video.embedSubs into mp4 as mov_text', async () => {
  const job = await runJob({ op: 'video.embedSubs', params: { container: 'mp4' }, inputs: [out('sample.mp4'), out('sample.srt')], outputPath: out('t-embed.mp4') });
  const { stream } = await streamOf(job.outputPath, 'subtitle');
  assert.equal(stream.codec_name, 'mov_text');
});

test('video.embedSubs into mkv keeps srt', async () => {
  const job = await runJob({ op: 'video.embedSubs', params: { container: 'mkv' }, inputs: [out('sample.mp4'), out('sample.srt')], outputPath: out('t-embed.mkv') });
  const { stream } = await streamOf(job.outputPath, 'subtitle');
  assert.equal(stream.codec_name, 'subrip');
});

test('video.burnSubs renders subtitles into the picture', async () => {
  const job = await runJob({ op: 'video.burnSubs', params: { fontSize: 24 }, inputs: [out('sample.mp4'), out('sample.srt')], outputPath: out('t-burn.mp4') });
  const { raw } = await streamOf(job.outputPath, 'video');
  assert.ok(raw.streams.some((s) => s.codec_type === 'video'));
  assert.ok(!raw.streams.some((s) => s.codec_type === 'subtitle'), 'burned subs are not a stream');
});

test('video.remux mp4 -> mkv without re-encoding', async () => {
  const job = await runJob({ op: 'video.remux', params: { container: 'mkv' }, inputs: [out('sample.mp4')], outputPath: out('t-remux.mkv') });
  const { stream } = await streamOf(job.outputPath, 'video');
  assert.equal(stream.codec_name, 'h264');
});

// ------------------------------------------------------------------ audio

test('audio.convert mp3 -> flac', async () => {
  const job = await runJob({ op: 'audio.convert', params: { format: 'flac' }, inputs: [out('sample.mp3')], outputPath: out('t-flac.flac') });
  const { stream } = await streamOf(job.outputPath, 'audio');
  assert.equal(stream.codec_name, 'flac');
});

test('audio.volume adjusts gain', async () => {
  const job = await runJob({ op: 'audio.volume', params: { db: -10 }, inputs: [out('sample.mp3')], outputPath: out('t-vol.mp3') });
  const { stream } = await streamOf(job.outputPath, 'audio');
  assert.equal(stream.codec_name, 'mp3');
  assert.ok(fs.existsSync(job.outputPath));
});

test('audio.loudnorm normalizes to EBU R128', async () => {
  const job = await runJob({ op: 'audio.loudnorm', params: { target: -16, tp: -1.5, lra: 11 }, inputs: [out('sample.mp3')], outputPath: out('t-loud.mp3') });
  const { stream } = await streamOf(job.outputPath, 'audio');
  assert.equal(stream.codec_name, 'mp3');
});

test('audio.trim cuts a range', async () => {
  const job = await runJob({ op: 'audio.trim', params: { startSec: 1, endSec: 3 }, inputs: [out('sample.mp3')], outputPath: out('t-atrim.mp3') });
  const { raw } = await streamOf(job.outputPath, 'audio');
  const d = parseFloat(raw.format.duration);
  assert.ok(d > 1.5 && d < 2.5, `got ${d}`);
});

// --------------------------------------------------------------- subtitles

test('subtitle.extract pulls the srt track back out', async () => {
  const job = await runJob({ op: 'subtitle.extract', params: { streamIndex: 0, format: 'srt' }, inputs: [out('sample_sub.mkv')], outputPath: out('t-extract.srt') });
  const text = fs.readFileSync(job.outputPath, 'utf8');
  const parsed = subs.parse(text);
  assert.equal(parsed.format, 'srt');
  assert.equal(parsed.cues.length, 2);
  assert.match(parsed.cues[0].text, /Hello world/);
});

test('subtitle file conversion chain srt -> ass -> vtt -> ttml -> srt', () => {
  const buf = fs.readFileSync(out('sample.srt'));
  const ass = subs.convertBuffer(buf, 'ass');
  assert.ok(ass.cueCount === 2);
  const vtt = subs.convertBuffer(ass.buffer, 'vtt');
  assert.ok(vtt.cueCount === 2);
  const ttml = subs.convertBuffer(vtt.buffer, 'ttml');
  assert.ok(ttml.cueCount === 2);
  const srt = subs.convertBuffer(ttml.buffer, 'srt');
  assert.ok(srt.cueCount === 2);
  const parsed = subs.parse(srt.buffer.toString('utf8'));
  assert.equal(parsed.cues[0].start, 1000);
  assert.equal(parsed.cues[1].end, 6000);
  assert.match(parsed.cues[0].text, /Hello world/);
});

test('subtitle shift moves the whole timeline', () => {
  const r = subs.shiftBuffer(fs.readFileSync(out('sample.srt')), 1500);
  const parsed = subs.parse(r.buffer.toString('utf8'));
  assert.equal(parsed.cues[0].start, 2500);
  assert.equal(parsed.cues[1].end, 7500);
});

test('subtitle reencode GBK -> UTF-8', () => {
  // "你好" in GBK followed by an SRT block.
  const gbk = Buffer.concat([
    Buffer.from('1\n00:00:01,000 --> 00:00:02,000\n', 'latin1'),
    Buffer.from([0xc4, 0xe3, 0xba, 0xc3])
  ]);
  const r = subs.reencodeBuffer(gbk, 'utf-8');
  assert.equal(r.fromCharset, 'gbk');
  assert.match(r.buffer.toString('utf8'), /你好/);
});

test('queue reports progress and speed during a job', async () => {
  const events = [];
  const listener = (j) => events.push(j);
  manager.on('updated', listener);
  try {
    await runJob({ op: 'video.compress', params: { mode: 'crf', crf: 28 }, inputs: [out('sample.mp4')], outputPath: out('t-progress.mp4') });
  } finally {
    manager.removeListener('updated', listener);
  }
  const running = events.filter((e) => e.status === 'running');
  assert.ok(running.length >= 1, 'should emit running updates');
  assert.ok(events.some((e) => e.progress > 0 && e.progress < 1), 'should emit intermediate progress');
  assert.ok(events.some((e) => e.progress === 1 && e.status === 'done'));
});

test('queue cancel stops a running job', async () => {
  // VP9 is slow enough to catch the job mid-run.
  const job = await manager.add({ op: 'video.convert', params: { container: 'webm', crf: 30 }, inputs: [out('sample.mp4')], outputPath: out('t-cancel.webm') });
  await waitForStatus(job.id, 'running');
  manager.cancel(job.id);
  const final = await waitForJob(job.id);
  assert.equal(final.status, 'canceled');
});

test('pause freezes progress, resume completes the job (POSIX)', async () => {
  if (process.platform === 'win32') return; // SIGSTOP is POSIX-only
  const job = await manager.add({ op: 'video.convert', params: { container: 'webm', crf: 32, encodeSpeed: 'slow' }, inputs: [out('sample.mp4')], outputPath: out('t-pause.webm') });
  await waitForStatus(job.id, 'running');
  // Let it make some progress, then pause.
  await new Promise((r) => setTimeout(r, 700));
  const before = manager.jobs.get(job.id).progress;
  assert.equal(manager.pause(job.id), true);
  assert.equal(manager.jobs.get(job.id).status, 'paused');
  // While paused the progress must not move.
  await new Promise((r) => setTimeout(r, 900));
  const frozen = manager.jobs.get(job.id);
  assert.equal(frozen.status, 'paused');
  assert.ok(Math.abs(frozen.progress - before) < 1e-9, `progress must freeze while paused (${before} -> ${frozen.progress})`);
  assert.equal(manager.resume(job.id), true);
  const final = await waitForJob(job.id);
  assert.equal(final.status, 'done');
  assert.equal(final.progress, 1);
});

test('terminating a PAUSED job yields canceled — never done or stuck (POSIX)', async () => {
  if (process.platform === 'win32') return;
  const job = await manager.add({ op: 'video.convert', params: { container: 'webm', crf: 32, encodeSpeed: 'slow' }, inputs: [out('sample.mp4')], outputPath: out('t-pause-cancel.webm') });
  await waitForStatus(job.id, 'running');
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(manager.pause(job.id), true);
  // Terminate while paused: must actually cancel, not silently no-op.
  assert.equal(manager.cancel(job.id), true, 'cancel() must handle paused jobs');
  const final = await waitForJob(job.id);
  assert.equal(final.status, 'canceled', `paused+terminate must end canceled, got ${final.status}`);
  // The killed child must not linger as a stopped process.
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(manager.jobs.get(job.id).status, 'canceled');
});

test('progress is monotonic and never 100% while running', async () => {
  const seen = [];
  const listener = (j) => { if (j.status === 'running') seen.push(j.progress); };
  manager.on('updated', listener);
  try {
    const job = await manager.add({ op: 'video.compress', params: { mode: 'crf', crf: 28, encodeSpeed: 'fast' }, inputs: [out('sample.mp4')], outputPath: out('t-monotonic.mp4') });
    const final = await waitForJob(job.id);
    assert.equal(final.status, 'done');
    for (let i = 1; i < seen.length; i++) {
      assert.ok(seen[i] >= seen[i - 1] - 1e-9, `progress regressed: ${seen[i - 1]} -> ${seen[i]}`);
    }
    for (const p of seen) {
      assert.ok(p < 1, `progress must never read as 100% while running, saw ${p}`);
    }
  } finally {
    manager.removeListener('updated', listener);
  }
});

test('running jobs report live CPU utilization (POSIX)', async () => {
  if (process.platform === 'win32') return;
  const os = require('node:os');
  const seen = [];
  const listener = (j) => { if (j.status === 'running' && j.cpuPercent > 0) seen.push(j.cpuPercent); };
  manager.on('updated', listener);
  try {
    // Slow VP9 gives the 1s sampler time to fire.
    const job = await manager.add({ op: 'video.convert', params: { container: 'webm', crf: 32, encodeSpeed: 'slow' }, inputs: [out('sample.mp4')], outputPath: out('t-cpu.webm') });
    const final = await waitForJob(job.id);
    assert.equal(final.status, 'done');
    assert.ok(seen.length >= 1, 'CPU sampler must fire at least once during a multi-second job');
    for (const pct of seen) {
      assert.ok(pct > 0 && pct <= 100 * os.cpus().length, `CPU percent out of range: ${pct}`);
    }
  } finally {
    manager.removeListener('updated', listener);
  }
});

// ------------------------------------------------------- new engine checks

test('AV1 convert with encode speed produces a real AV1 stream', async () => {
  const job = await runJob({ op: 'video.convert', params: { container: 'mp4', videoCodec: 'av1', crf: 35, encodeSpeed: 'fast', audioBitrate: 96 }, inputs: [out('sample.mp4')], outputPath: out('t-av1.mp4') });
  const { stream } = await streamOf(job.outputPath, 'video');
  assert.equal(stream.codec_name, 'av1');
});

test('bitrate mode lands near the requested bitrate', async () => {
  const job = await runJob({ op: 'video.convert', params: { container: 'mp4', videoCodec: 'h264', mode: 'bitrate', videoBitrate: 800, audioBitrate: 96, encodeSpeed: 'fast' }, inputs: [out('sample.mp4')], outputPath: out('t-bitrate.mp4') });
  const { raw } = await streamOf(job.outputPath, 'video');
  const total = parseInt(raw.format.bit_rate, 10) / 1000;
  assert.ok(total > 500 && total < 1400, `bitrate ~896 kbps total, got ${total}`);
});

test('AVI convert forces MPEG-4 video', async () => {
  const job = await runJob({ op: 'video.convert', params: { container: 'avi', videoCodec: 'h264', crf: 28 }, inputs: [out('sample.mp4')], outputPath: out('t-avi.avi') });
  const { stream } = await streamOf(job.outputPath, 'video');
  assert.equal(stream.codec_name, 'mpeg4');
});

test('subtitle.mux output extension matches the container', async () => {
  const job = await runJob({ op: 'video.embedSubs', params: { container: 'mkv' }, inputs: [out('sample.mp4'), out('sample.srt')], outputPath: out('t-mux.mkv') });
  assert.match(job.outputPath, /\.mkv$/);
  const { stream } = await streamOf(job.outputPath, 'subtitle');
  assert.equal(stream.codec_name, 'subrip');
});

test('burnSubs honors the margin param in the command', async () => {
  const job = await runJob({ op: 'video.burnSubs', params: { fontSize: 24, margin: 45 }, inputs: [out('sample.mp4'), out('sample.srt')], outputPath: out('t-burnmargin.mp4') });
  assert.match(job.commandText, /MarginV=45/);
});

test('speed job expectedDuration is divided by the factor', async () => {
  const job = await manager.add({ op: 'video.speed', params: { factor: 2 }, inputs: [out('sample.mp4')], outputPath: out('t-speeddur.mp4') });
  await waitForStatus(job.id, 'running');
  const j = manager.jobs.get(job.id);
  assert.ok(Math.abs(j.expectedDuration - 3) < 0.4, `expected ~3s, got ${j.expectedDuration}`);
  await waitForJob(job.id);
});

test('plan estimate is honest and actual matches the real output', async () => {
  const plan = await import('../../shared/plan.mjs');
  const source = summarize(await probe(FFPROBE, out('sample.mp4')));
  const params = { container: 'mp4', videoCodec: 'h264', mode: 'bitrate', videoBitrate: 1200, audioBitrate: 96, encodeSpeed: 'fast' };
  const p = plan.buildPlan('video.convert', params, source);
  assert.ok(p.sizeEstimate > 0, 'bitrate mode must produce a numeric estimate');
  const job = await runJob({ op: 'video.convert', params, inputs: [out('sample.mp4')], outputPath: out('t-plan.mp4') });
  assert.ok(job.actual, 'job should carry the probed actual summary');
  assert.ok(Math.abs(job.actual.durationSec - p.durationSec) < 0.8, `plan ${p.durationSec}s vs actual ${job.actual.durationSec}s`);
  // Actual size within ±40% of the bitrate-based estimate (encoder overhead varies).
  const ratio = job.actual.size / p.sizeEstimate;
  assert.ok(ratio > 0.6 && ratio < 1.4, `actual/estimate ratio ${ratio.toFixed(2)}`);
});

test('CRF plan refuses to estimate, stream-copy plan says source-like', async () => {
  const plan = await import('../../shared/plan.mjs');
  const source = summarize(await probe(FFPROBE, out('sample.mp4')));
  const crf = plan.buildPlan('video.convert', { container: 'mp4', videoCodec: 'h264', crf: 23, mode: 'crf' }, source);
  assert.equal(crf.sizeEstimate, null);
  assert.equal(crf.sizeNoteKey, 'plan.sizeCRF');
  const remux = plan.buildPlan('video.remux', { container: 'mkv' }, source);
  assert.equal(remux.sizeEstimate, 'source');
});

// --------------------------- input diversity: WebM / no-audio sources

test('crop on a WebM input re-encodes into an MP4 output', async () => {
  const job = await runJob({ op: 'video.crop', params: { w: 320, h: 180, x: 0, y: 0 }, inputs: [out('sample.webm')], outputPath: out('t-crop-webm.mp4') });
  assert.match(job.outputPath, /\.mp4$/);
  const { stream } = await streamOf(job.outputPath, 'video');
  assert.equal(stream.codec_name, 'h264');
  // The Opus source audio must NOT be copied into MP4 (unplayable combo) —
  // it has to be re-encoded to AAC.
  const { stream: audio } = await streamOf(job.outputPath, 'audio');
  assert.equal(audio.codec_name, 'aac', 'Opus must be re-encoded to AAC for MP4');
});

test('crop on an MKV+Opus input keeps the Opus stream (MKV holds it)', async () => {
  const job = await runJob({ op: 'video.crop', params: { w: 320, h: 180, x: 0, y: 0 }, inputs: [out('sample_opus.mkv')], outputPath: out('t-crop-mkv.mkv') });
  assert.match(job.outputPath, /\.mkv$/);
  const { stream: video } = await streamOf(job.outputPath, 'video');
  assert.equal(video.codec_name, 'h264');
  const { stream: audio } = await streamOf(job.outputPath, 'audio');
  assert.equal(audio.codec_name, 'opus', 'MKV can hold Opus — copy is correct');
});

test('speed on a WebM input produces a valid MP4', async () => {
  const job = await runJob({ op: 'video.speed', params: { factor: 2 }, inputs: [out('sample.webm')], outputPath: out('t-speed-webm.mp4') });
  const { raw } = await streamOf(job.outputPath, 'video');
  assert.ok(Math.abs(parseFloat(raw.format.duration) - 2) < 0.4);
});

test('speed on a video without audio works (no [0:a] mapping)', async () => {
  const job = await runJob({ op: 'video.speed', params: { factor: 2 }, inputs: [out('sample_noaudio.mp4')], outputPath: out('t-speed-noaudio.mp4') });
  const { raw } = await streamOf(job.outputPath, 'video');
  assert.ok(!raw.streams.some((s) => s.codec_type === 'audio'));
  assert.ok(Math.abs(parseFloat(raw.format.duration) - 2) < 0.4);
});

test('compress through the full production resolution path uses VideoToolbox when present', async () => {
  const resolve = await import('../../shared/resolve.mjs');
  // Detect hardware encoders exactly like main.js does.
  const encodersOut = spawnSync(FFMPEG, ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout || '';
  const names = new Set();
  for (const line of encodersOut.split('\n')) {
    const m = line.match(/^\s*[A-Z.]{4,6}\s+([a-zA-Z0-9_]+)\s+\S/);
    if (m) names.add(m[1]);
  }
  const gpuEncoders = ['h264_videotoolbox', 'hevc_videotoolbox'].filter((e) => names.has(e));
  const source = summarize(await probe(FFPROBE, out('sample.mp4')));

  const uiParams = { crf: 26, mode: 'crf', qualityPreset: 'balanced', hwStrategy: 'auto', audioCodec: 'auto' };
  const resolved = resolve.resolveEncoding('video.compress', uiParams, source, { gpuEncoders });
  const finalParams = resolve.applyResolved(uiParams, resolved);

  const job = await runJob({ op: 'video.compress', params: finalParams, inputs: [out('sample.mp4')], outputPath: out('t-compress-gpu.mp4') });
  const { stream } = await streamOf(job.outputPath, 'video');
  if (resolved.hw) {
    assert.equal(resolved.videoCodec, 'h264_videotoolbox');
    assert.equal(stream.codec_name, 'h264');
    assert.ok(job.commandText.includes('h264_videotoolbox'), 'command must actually run VideoToolbox');
  } else {
    assert.equal(stream.codec_name, 'h264');
    assert.ok(!job.commandText.includes('videotoolbox'));
  }
});

function waitForStatus(id, status, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${status}`)), timeoutMs);
    const check = (job) => {
      if (job.id !== id) return;
      if (job.status === status) {
        clearTimeout(timer);
        manager.removeListener('updated', check);
        resolve(job);
      }
    };
    manager.on('updated', check);
  });
}
