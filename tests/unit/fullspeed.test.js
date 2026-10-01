const { test } = require('node:test');
const assert = require('node:assert');
const { buildJobCommands, injectThreading } = require('../../electron/engine/commands');
const { JobManager } = require('../../electron/engine/queue');

const baseCtx = { probe: { video: { codec: 'h264' }, audio: { codec: 'aac' } }, hasAudio: true, hasVideo: true };

function argsOf(op, params = {}, ctx = baseCtx, inputs = ['/in/video.mp4'], out = '/out/video.mp4') {
  const built = buildJobCommands(op, params, inputs, out, ctx);
  return built.steps[0].args;
}

// Threading optimizations are ALWAYS on (no setting gates them).

test('injectThreading adds filter/decoder/encoder threads', () => {
  const out = injectThreading(['-hide_banner', '-y', '-i', 'a.mp4', '-c:v', 'libx264', 'out.mp4']);
  assert.deepEqual(out, [
    '-filter_threads', '0', '-filter_complex_threads', '0',
    '-hide_banner', '-y',
    '-threads', '0', '-i', 'a.mp4',
    '-c:v', 'libx264',
    '-threads', '0', 'out.mp4'
  ]);
});

test('injectThreading threads every input of multi-input commands', () => {
  const out = injectThreading(['-y', '-i', 'a.mp4', '-i', 'b.mp3', '-shortest', 'out.mp4']);
  const inputCount = out.filter((a) => a === '-i').length;
  assert.equal(inputCount, 2);
  for (let i = 0; i < out.length; i++) {
    if (out[i] === '-i') assert.equal(out[i - 1], '0', 'every -i must be preceded by -threads 0');
  }
  assert.equal(out[out.length - 2], '0');
  assert.equal(out[out.length - 3], '-threads');
});

test('every op gets threading without any opt-in', () => {
  const cases = [
    ['video.convert', { container: 'mp4', videoCodec: 'h264', crf: 23, mode: 'crf', hwStrategy: 'cpu' }],
    ['video.compress', { mode: 'crf', crf: 26, hwStrategy: 'cpu' }],
    ['video.crop', { w: 320, h: 180 }],
    ['video.scale', { size: '720p', mode: 'fit' }],
    ['video.rotate', { angle: '90' }],
    ['video.speed', { factor: 2 }],
    ['video.trim', { startSec: 1, endSec: 2, precise: true }],
    ['video.replaceAudio', {}, ['/in/a.mp4', '/in/b.mp3']],
    ['video.extractAudio', { format: 'mp3' }],
    ['video.extractFrames', { mode: 'sequence', fps: 1 }]
  ];
  for (const [op, params, inputs] of cases) {
    const args = argsOf(op, params, baseCtx, inputs);
    assert.ok(args.includes('-filter_threads'), `${op}: filter threads missing`);
    assert.ok(args.includes('-filter_complex_threads'), `${op}: filter_complex threads missing`);
    const iIdx = args.indexOf('-i');
    assert.equal(args[iIdx - 1], '0', `${op}: decoder threads must precede -i`);
  }
});

test('both steps of two-pass GIF jobs are threaded', () => {
  const built = buildJobCommands('video.anim', { format: 'gif', fps: 10, width: 320 }, ['/in/a.mp4'], '/out/a.gif', baseCtx);
  assert.equal(built.steps.length, 2);
  for (const step of built.steps) {
    assert.ok(step.args.includes('-filter_threads'), 'palette pass must be threaded');
    assert.ok(step.commandText.includes('-threads 0'));
  }
});

test('injectThreading adds VP9 row-mt + tile-columns (the real VP9 parallelism)', () => {
  const out = injectThreading(['-y', '-i', 'a.mp4', '-c:v', 'libvpx-vp9', '-crf', '35', 'out.webm']);
  assert.ok(out.includes('-row-mt'), 'VP9 needs -row-mt 1');
  assert.ok(out.includes('-tile-columns'), 'VP9 needs -tile-columns');
  const h264 = injectThreading(['-y', '-i', 'a.mp4', '-c:v', 'libx264', 'out.mp4']);
  assert.ok(!h264.includes('-row-mt'));
  assert.ok(!h264.includes('-tile-columns'));
});

test('VP9 tile-columns scale with source resolution', () => {
  const args = ['-y', '-i', 'a.mp4', '-c:v', 'libvpx-vp9', 'out.webm'];
  const hd = injectThreading(args, 1920);
  assert.equal(hd[hd.indexOf('-tile-columns') + 1], '2', '1080p -> 4 tiles');
  const uhd = injectThreading(args, 3840);
  assert.equal(uhd[uhd.indexOf('-tile-columns') + 1], '3', '4K -> 8 tiles');
});

// ------------------------------------------------------ concurrency control

test('setConcurrency clamps to 1-4 and applies immediately', () => {
  const m = new JobManager({ ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', concurrency: 1 });
  assert.equal(m.concurrency, 1);
  m.setConcurrency(3);
  assert.equal(m.concurrency, 3);
  m.setConcurrency(99);
  assert.equal(m.concurrency, 4, 'clamped to 4');
  m.setConcurrency(0);
  assert.equal(m.concurrency, 1, 'clamped to 1');
});

test('activeCount tracks queued/running/paused jobs', () => {
  const m = new JobManager({ ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' });
  assert.equal(m.activeCount(), 0);
  const job = { id: 'x', op: 'video.mute', params: {}, inputs: ['/a'], outputPath: '/o',
    status: 'queued', progress: 0, speed: 0, error: null, commandText: '', expectedDuration: 0,
    plan: null, cpuPercent: 0, createdAt: 0, startedAt: 0, endedAt: 0 };
  m.jobs.set('x', job);
  assert.equal(m.activeCount(), 1);
  job.status = 'running';
  assert.equal(m.activeCount(), 1);
  job.status = 'paused';
  assert.equal(m.activeCount(), 1);
  job.status = 'done';
  assert.equal(m.activeCount(), 0);
  job.status = 'canceled';
  assert.equal(m.activeCount(), 0);
});
