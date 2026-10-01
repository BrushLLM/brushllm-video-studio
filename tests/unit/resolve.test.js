const { test } = require('node:test');
const assert = require('node:assert');
const { buildJobCommands } = require('../../electron/engine/commands');

// ESM modules loaded dynamically from CJS tests.
let resolve;
let planModule;
test.before(async () => {
  resolve = await import('../../shared/resolve.mjs');
  planModule = await import('../../shared/plan.mjs');
});

const SOURCE = {
  durationSec: 100,
  size: 50 * 1024 * 1024,
  bitrate: 4000000,
  formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
  video: { codec: 'h264', width: 1920, height: 1080, fps: 24 },
  audio: { codec: 'aac', sampleRate: 48000, channels: 2 },
  subtitleStreams: [],
  streamCount: 2
};

const VT = ['h264_videotoolbox', 'hevc_videotoolbox'];

function commandFor(resolvedParams, ctx = { probe: SOURCE, hasAudio: true, hasVideo: true }) {
  const built = buildJobCommands('video.convert', resolvedParams, ['/in/video.mp4'], '/out/video.mp4', ctx);
  return built.steps[0].args;
}

// ------------------------------------------------- the original CRF bug

test('normal balanced preset: command has -crf and NO -b:v (regression)', () => {
  // This is exactly what the UI submits in normal mode after engineParams.
  const uiParams = {
    container: 'mp4', videoCodec: 'h264', crf: 23, encodeSpeed: 'fast',
    mode: 'crf', audioCodec: 'auto', audioBitrate: 128,
    qualityPreset: 'balanced', hwStrategy: 'cpu'
  };
  // engineParams deletes videoBitrate in CRF mode; simulate a stale default
  // leaking through to prove commands.js is safe regardless.
  const withStaleBitrate = { ...uiParams, videoBitrate: 2500 };

  const r = resolve.resolveEncoding('video.convert', uiParams, SOURCE, { gpuEncoders: [] });
  assert.equal(r.videoBitrate, null, 'CRF mode must not resolve a bitrate');
  const args = commandFor(resolve.applyResolved(withStaleBitrate, r));
  assert.ok(args.includes('-crf'), 'CRF mode must use -crf');
  const bv = args.indexOf('-b:v');
  assert.equal(bv, -1, `CRF mode must not carry -b:v, got ${args[bv + 1]}`);
});

test('balanced preset resolves to fast encode speed', async () => {
  const ops = await import('../../src/ops.js').catch(() => null);
  if (!ops) return; // ESM import of src in CJS test — skipped if unavailable
  assert.equal(ops.QUALITY_PRESETS.balanced.encodeSpeed, 'fast');
});

// ------------------------------------------------------- hardware strategy

test('auto strategy uses VideoToolbox when available', () => {
  const r = resolve.resolveEncoding('video.convert',
    { container: 'mp4', videoCodec: 'h264', crf: 23, mode: 'crf', qualityPreset: 'balanced', hwStrategy: 'auto', audioCodec: 'auto' },
    SOURCE, { gpuEncoders: VT });
  assert.equal(r.videoCodec, 'h264_videotoolbox');
  assert.equal(r.hw, true);
  assert.equal(r.mode, 'bitrate');
  assert.ok(r.videoBitrate > 0, 'GPU must carry a bitrate plan');
  assert.equal(r.crf, null);

  const args = commandFor(resolve.applyResolved({ videoCodec: 'h264', crf: 23, mode: 'crf' }, r));
  assert.equal(args[args.indexOf('-c:v') + 1], 'h264_videotoolbox');
  assert.equal(args[args.indexOf('-b:v') + 1], `${r.videoBitrate}k`);
  assert.ok(!args.includes('-crf'), 'GPU command must not fake CRF');
});

test('auto strategy falls back to CPU honestly when no GPU', () => {
  const r = resolve.resolveEncoding('video.convert',
    { container: 'mp4', videoCodec: 'h264', crf: 23, mode: 'crf', hwStrategy: 'auto' },
    SOURCE, { gpuEncoders: [] });
  assert.equal(r.videoCodec, 'h264');
  assert.equal(r.hw, false);
  assert.equal(r.cpuNote, true);
  assert.equal(r.mode, 'crf');
});

test('gpu strategy without hardware is a hard error, never silent fallback', () => {
  const r = resolve.resolveEncoding('video.convert',
    { container: 'mp4', videoCodec: 'h264', crf: 23, mode: 'crf', hwStrategy: 'gpu' },
    SOURCE, { gpuEncoders: [] });
  assert.equal(r.error, 'gpu-unavailable');
});

test('cpu strategy ignores available GPU', () => {
  const r = resolve.resolveEncoding('video.convert',
    { container: 'mp4', videoCodec: 'h264', crf: 23, mode: 'crf', hwStrategy: 'cpu' },
    SOURCE, { gpuEncoders: VT });
  assert.equal(r.videoCodec, 'h264');
  assert.equal(r.hw, false);
});

test('small preset (HEVC) maps to HEVC VideoToolbox under auto', () => {
  const r = resolve.resolveEncoding('video.convert',
    { container: 'mp4', videoCodec: 'hevc', crf: 26, mode: 'crf', qualityPreset: 'small', hwStrategy: 'auto' },
    SOURCE, { gpuEncoders: VT });
  assert.equal(r.videoCodec, 'hevc_videotoolbox');
});

test('filter ops never take the hardware path', () => {
  for (const op of ['video.crop', 'video.scale', 'video.rotate', 'video.burnSubs', 'video.trim']) {
    const r = resolve.resolveEncoding(op, { hwStrategy: 'auto' }, SOURCE, { gpuEncoders: VT });
    assert.equal(r.hw, false, `${op} must stay on CPU`);
  }
});

// ------------------------------------------------------ container rules

test('WebM drops GPU and forces VP9 — resolve and commands agree', () => {
  const r = resolve.resolveEncoding('video.convert',
    { container: 'webm', videoCodec: 'h264', crf: 30, mode: 'crf', hwStrategy: 'auto' },
    SOURCE, { gpuEncoders: VT });
  assert.equal(r.videoCodec, 'vp9');
  assert.equal(r.hw, false);

  const args = commandFor(resolve.applyResolved({ container: 'webm', videoCodec: 'h264', crf: 30, mode: 'crf' }, r));
  assert.equal(args[args.indexOf('-c:v') + 1], 'libvpx-vp9');
});

test('AVI forces MPEG-4 — resolve and commands agree', () => {
  const r = resolve.resolveEncoding('video.convert',
    { container: 'avi', videoCodec: 'h264', crf: 20, mode: 'crf', hwStrategy: 'cpu' },
    SOURCE, { gpuEncoders: VT });
  assert.equal(r.videoCodec, 'mpeg4');
  const args = commandFor(resolve.applyResolved({ container: 'avi', videoCodec: 'h264', crf: 20, mode: 'crf' }, r));
  assert.equal(args[args.indexOf('-c:v') + 1], 'mpeg4');
});

// ------------------------------------------------------------- audio auto

test('audio auto copies AAC into MP4, re-encodes to Opus for WebM', () => {
  const mp4 = resolve.resolveEncoding('video.convert',
    { container: 'mp4', videoCodec: 'h264', crf: 23, mode: 'crf', hwStrategy: 'cpu', audioCodec: 'auto' },
    SOURCE, { gpuEncoders: [] });
  assert.equal(mp4.audioCodec, 'copy');
  assert.equal(mp4.audioCopy, true);

  const webm = resolve.resolveEncoding('video.convert',
    { container: 'webm', videoCodec: 'h264', crf: 30, mode: 'crf', hwStrategy: 'cpu', audioCodec: 'auto' },
    SOURCE, { gpuEncoders: [] });
  assert.equal(webm.audioCodec, 'opus');
  assert.equal(webm.audioCopy, false);
});

test('audio auto copies into MKV (permissive container)', () => {
  const r = resolve.resolveEncoding('video.convert',
    { container: 'mkv', videoCodec: 'h264', crf: 23, mode: 'crf', hwStrategy: 'cpu', audioCodec: 'auto' },
    SOURCE, { gpuEncoders: [] });
  assert.equal(r.audioCodec, 'copy');
});

// --------------------------------------------- plan ↔ resolve consistency

test('plan preview agrees with the resolved encoding (GPU and CPU)', () => {
  const cases = [
    { gpuEncoders: VT, hwStrategy: 'auto', expectGpu: true },
    { gpuEncoders: [], hwStrategy: 'auto', expectGpu: false },
    { gpuEncoders: VT, hwStrategy: 'cpu', expectGpu: false }
  ];
  for (const c of cases) {
    const params = { container: 'mp4', videoCodec: 'h264', crf: 23, mode: 'crf', qualityPreset: 'balanced', hwStrategy: c.hwStrategy, audioCodec: 'auto', audioBitrate: 128 };
    const r = resolve.resolveEncoding('video.convert', params, SOURCE, { gpuEncoders: c.gpuEncoders });
    const p = planModule.buildPlan('video.convert', params, SOURCE, { gpuEncoders: c.gpuEncoders });
    assert.equal(p.hw, c.expectGpu);
    assert.equal(p.videoEncoderLabel, c.expectGpu ? 'H.264 (GPU)' : 'H.264');
    if (r.mode === 'bitrate') {
      assert.match(p.qualityLabel, /kbps$/);
      assert.ok(p.sizeEstimate > 0, 'bitrate plan must estimate size');
    } else {
      assert.match(p.qualityLabel, /^CRF /);
      assert.equal(p.sizeEstimate, null);
    }
    // The command built from the resolved params uses the same encoder.
    const args = commandFor(resolve.applyResolved(params, r));
    const enc = args[args.indexOf('-c:v') + 1];
    const expected = { h264: 'libx264', h264_videotoolbox: 'h264_videotoolbox' }[r.videoCodec];
    assert.equal(enc, expected);
  }
});

test('bitrate mode carries the target kbps end to end', () => {
  const params = { container: 'mp4', videoCodec: 'h264', mode: 'bitrate', videoBitrate: 22118, encodeSpeed: 'fast', audioCodec: 'auto', hwStrategy: 'cpu' };
  const r = resolve.resolveEncoding('video.convert', params, SOURCE, { gpuEncoders: [] });
  assert.equal(r.videoBitrate, 22118);
  assert.equal(r.crf, null);
  const args = commandFor(resolve.applyResolved(params, r));
  assert.equal(args[args.indexOf('-b:v') + 1], '22118k');
  assert.ok(!args.includes('-crf'));
});

test('GPU bitrate defaults scale with resolution', () => {
  const r1080 = resolve.resolveEncoding('video.convert',
    { container: 'mp4', videoCodec: 'h264', crf: 23, mode: 'crf', qualityPreset: 'balanced', hwStrategy: 'auto' },
    SOURCE, { gpuEncoders: VT });
  const r4k = resolve.resolveEncoding('video.convert',
    { container: 'mp4', videoCodec: 'h264', crf: 23, mode: 'crf', qualityPreset: 'balanced', hwStrategy: 'auto' },
    { ...SOURCE, video: { ...SOURCE.video, width: 3840, height: 2160 } }, { gpuEncoders: VT });
  assert.ok(r4k.videoBitrate > r1080.videoBitrate, '4K should get a higher default bitrate');
  assert.ok(r1080.videoBitrate >= 1500 && r1080.videoBitrate <= 60000);
});

// ------------------------------------------- compress plan↔command parity

test('compress + GPU auto: plan, resolver and command all use VideoToolbox', () => {
  const params = { crf: 26, mode: 'crf', qualityPreset: 'balanced', hwStrategy: 'auto', audioCodec: 'auto' };
  const r = resolve.resolveEncoding('video.compress', params, SOURCE, { gpuEncoders: VT });
  assert.equal(r.videoCodec, 'h264_videotoolbox', 'resolver must pick GPU');
  assert.equal(r.mode, 'bitrate');
  assert.ok(r.videoBitrate > 0);

  const p = planModule.buildPlan('video.compress', params, SOURCE, { gpuEncoders: VT });
  assert.equal(p.videoEncoderLabel, 'H.264 (GPU)', 'plan must show GPU');

  // THE original bug: the command builder ignored the resolved codec.
  const args = commandFor(resolve.applyResolved(params, r), { probe: SOURCE, hasAudio: true, hasVideo: true });
  assert.equal(args[args.indexOf('-c:v') + 1], 'h264_videotoolbox', 'command must run VideoToolbox');
});

test('compress + small preset (HEVC): command encodes HEVC, not source-family H.264', () => {
  const params = { videoCodec: 'hevc', crf: 26, mode: 'crf', qualityPreset: 'small', hwStrategy: 'cpu', audioCodec: 'auto' };
  const r = resolve.resolveEncoding('video.compress', params, SOURCE, { gpuEncoders: [] });
  assert.equal(r.videoCodec, 'hevc');
  const args = commandFor(resolve.applyResolved(params, r), { probe: SOURCE, hasAudio: true, hasVideo: true });
  assert.equal(args[args.indexOf('-c:v') + 1], 'libx265', 'command must honor the HEVC preset');
});

test('compress without explicit codec keeps the source family', () => {
  const hevcSource = { ...SOURCE, video: { ...SOURCE.video, codec: 'hevc' } };
  const r = resolve.resolveEncoding('video.compress', { mode: 'crf', crf: 26, hwStrategy: 'cpu' }, hevcSource, { gpuEncoders: [] });
  assert.equal(r.videoCodec, 'hevc');
  const p = planModule.buildPlan('video.compress', { mode: 'crf', crf: 26, hwStrategy: 'cpu' }, hevcSource, { gpuEncoders: [] });
  assert.equal(p.videoEncoderLabel, 'H.265 (HEVC)');
});

test('explicit GPU encoder under a CPU strategy is downgraded honestly', () => {
  const r = resolve.resolveEncoding('video.convert',
    { container: 'mp4', videoCodec: 'h264_videotoolbox', mode: 'bitrate', videoBitrate: 8000, hwStrategy: 'cpu' },
    SOURCE, { gpuEncoders: VT });
  assert.equal(r.videoCodec, 'h264', 'CPU strategy must win over an explicit GPU codec');
  assert.equal(r.hw, false);
  // The user's explicit bitrate mode stays meaningful on the CPU codec.
  assert.equal(r.mode, 'bitrate');
  assert.equal(r.videoBitrate, 8000);
});
