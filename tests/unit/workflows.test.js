const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildJobCommands, outputExtFor } = require('../../electron/engine/commands');
const { createLimiter } = require('../../electron/engine/limit');
let ops, validation, resolve, plan;
test.before(async () => {
  [ops, validation, resolve, plan] = await Promise.all([
    import('../../src/ops.js'), import('../../shared/validation.mjs'),
    import('../../shared/resolve.mjs'), import('../../shared/plan.mjs')
  ]);
});

const source = {
  container: 'mp4', sourcePath: '/in/source.mp4', durationSec: 10, size: 1000000,
  bitrate: 800000,
  video: { codec: 'h264', width: 640, height: 360, fps: 24, bitrate: 672000 },
  audio: { codec: 'aac', sampleRate: 44100, channels: 1, bitrate: 128000 },
  streams: [
    { type: 'video', codec: 'h264', timeBase: '1/12288', width: 640, height: 360, pixFmt: 'yuv420p', sampleAspectRatio: '1:1', frameRate: '24/1', extradataSize: 1, extradataHash: 'a' },
    { type: 'audio', codec: 'aac', timeBase: '1/44100', sampleRate: 44100, channels: 1, channelLayout: 'mono', sampleFormat: 'fltp', extradataSize: 1, extradataHash: 'b' }
  ]
};
const valueOf = (args, name) => args[args.indexOf(name) + 1];

test('all audio conversion formats accept the UI defaults and preserve source rate/channels', () => {
  const op = ops.OPS.find(o => o.id === 'audio.convert');
  for (const format of ['mp3', 'm4a', 'flac', 'wav', 'ogg', 'opus']) {
    const params = ops.engineParams(op.id, { ...ops.defaultParams(op), format }, []);
    assert.deepEqual(validation.validateOperation(op.id, params, source), [], format);
    const { args } = buildJobCommands(op.id, params, ['/in/audio.mp3'], `/out/audio.${format}`, {}).steps[0];
    assert.ok(!args.includes('-ar'), format);
    assert.ok(!args.includes('-ac'), format);
  }
  assert.ok(validation.validateOperation('audio.convert', { sampleRate: 0, channels: 0 }, source).length);
});

test('WebM AV1 stays AV1 across resolution, plan and command; AVI copy keeps compatible audio', () => {
  const params = { container: 'webm', videoCodec: 'av1', hwStrategy: 'cpu', audioCodec: 'auto' };
  const resolved = resolve.resolveEncoding('video.convert', params, source);
  const args = buildJobCommands('video.convert', resolve.applyResolved(params, resolved), ['/in/a.mp4'], '/out/a.webm', { probe: source }).steps[0].args;
  assert.equal(plan.buildPlan('video.convert', params, source).videoEncoderLabel, 'AV1');
  assert.equal(valueOf(args, '-c:v'), 'libsvtav1');
  assert.equal(valueOf(args, '-c:a'), 'libopus');
  const avi = resolve.resolveEncoding('video.convert', { container: 'avi', hwStrategy: 'cpu', audioCodec: 'copy' }, source);
  const aviArgs = buildJobCommands('video.convert', avi, ['/in/a.mp4'], '/out/a.avi', { probe: source }).steps[0].args;
  assert.equal(avi.audioCodec, 'copy');
  assert.equal(valueOf(aviArgs, '-c:a'), 'copy');
});

test('WebM editing plans match the actual MP4 output and audio conversion', () => {
  const webm = { ...source, container: 'webm', sourcePath: '/in/a.webm', video: { ...source.video, codec: 'vp9' }, audio: { codec: 'opus' } };
  for (const op of ['video.crop', 'video.scale', 'video.rotate', 'video.burnSubs', 'video.trim']) {
    const p = { precise: true, w: 320, h: 180, width: 320, height: 180 };
    const summary = plan.buildPlan(op, p, webm);
    assert.equal(summary.containerLabel, 'MP4', op);
    assert.equal(summary.audioEncoderLabel, 'AAC', op);
    assert.equal(outputExtFor(op, p, '/in/a.webm', { probe: webm }), '.mp4', op);
  }
  assert.equal(plan.buildPlan('audio.trim', {}, { container: 'mp3', audio: { codec: 'mp3' } }).containerLabel, 'MP3');
  assert.equal(plan.buildActual({ ...webm, container: 'mov' }, '/out/a.mov').containerLabel, 'MOV');
});

test('merge planning uses the same full stream compatibility as command execution', () => {
  const other = structuredClone(source);
  for (const different of [false, true]) {
    other.streams[0].width = different ? 1280 : 640;
    other.video.width = other.streams[0].width;
    const allProbes = [source, other];
    const summary = plan.buildPlan('video.merge', { mode: 'auto' }, source, { allProbes });
    const built = buildJobCommands('video.merge', { mode: 'auto' }, ['/in/a.mp4', '/in/b.mp4'], '/out/c.mp4', { allProbes });
    assert.equal(built.steps[0].args.includes('-filter_complex'), different);
    assert.equal(summary.qualityLabel === 'stream copy', !different);
  }
});

test('audio processing plans, reserved extensions and commands agree for AAC, Vorbis and PCM', () => {
  for (const [codec, extension, label] of [['aac', '.m4a', 'AAC'], ['vorbis', '.ogg', 'Vorbis'], ['pcm_s16le', '.wav', 'PCM']]) {
    for (const op of ['audio.compress', 'audio.volume', 'audio.loudnorm']) {
      const probe = { durationSec: 10, audio: { codec } };
      const ctx = { probe };
      const ext = outputExtFor(op, {}, '/in/a.mka', ctx);
      const out = `/out/a${ext}`;
      const built = buildJobCommands(op, {}, ['/in/a.mka'], out, ctx);
      assert.equal(ext, extension);
      assert.equal(built.outputPath, out);
      assert.equal(plan.buildPlan(op, {}, probe).audioEncoderLabel, label);
    }
  }
});

test('automatic GPU compression respects source bitrate and includes copied audio in its estimate', () => {
  const params = { hwStrategy: 'auto', qualityPreset: 'balanced' };
  const opts = { gpuEncoders: ['h264_videotoolbox'] };
  const resolved = resolve.resolveEncoding('video.compress', params, source, opts);
  assert.ok(resolved.videoBitrate < source.video.bitrate / 1000);
  const summary = plan.buildPlan('video.compress', params, source, opts);
  assert.equal(summary.sizeEstimate, plan.estimateFromBitrate(resolved.videoBitrate, 128, 10));
  const explicit = plan.buildPlan('video.compress', { ...params, mode: 'bitrate', videoBitrate: 3000 }, source, opts);
  assert.equal(explicit.qualityLabel, '3000 kbps');
  assert.equal(explicit.warningKey, 'plan.compressionLarger');
});

test('probe limiter bounds concurrent subprocess work and continues after rejection', async () => {
  const limit = createLimiter(4);
  let active = 0, peak = 0;
  const gates = [];
  const promises = Array.from({ length: 9 }, (_, i) => limit(async () => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => gates.push(resolve));
    active--;
    if (i === 2) throw new Error('probe failed');
    return i;
  }));
  const done = Promise.allSettled(promises);
  for (let wave = 0; wave < 3; wave++) {
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(active <= 4);
    gates.splice(0).forEach(resolve => resolve());
  }
  const results = await done;
  assert.equal(peak, 4);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 8);
  assert.equal(results[2].status, 'rejected');
});

test('resolved video jobs reject output encoded with a different codec', () => {
  const { JobManager } = require('../../electron/engine/queue');
  const manager = new JobManager();
  const job = { op: 'video.convert', params: { videoCodec: 'av1' }, requestedSpec: { requestedParams: { videoCodec: 'av1' } } };
  assert.throws(() => manager._validateOutput(job, { video: { codec: 'vp9' } }, { probe: source }), /does not match requested av1/);
  assert.doesNotThrow(() => manager._validateOutput(job, { video: { codec: 'av1' } }, { probe: source }));
});
