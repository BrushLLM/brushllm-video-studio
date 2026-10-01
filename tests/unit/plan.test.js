const { test } = require('node:test');
const assert = require('node:assert');

// shared/plan.mjs is ESM; load it dynamically from CJS tests.
let plan;
test.before(async () => {
  plan = await import('../../shared/plan.mjs');
});

const SOURCE = {
  durationSec: 100,
  size: 50 * 1024 * 1024, // 50 MB
  bitrate: 4 * 1000 * 1000,
  formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
  video: { codec: 'h264', width: 1920, height: 1080, fps: 24, rotation: 0 },
  audio: { codec: 'aac', sampleRate: 48000, channels: 2 },
  subtitleStreams: [],
  streamCount: 2
};

test('convert CRF mode refuses to fake a size estimate', () => {
  const p = plan.buildPlan('video.convert', { container: 'mp4', videoCodec: 'h264', crf: 20, mode: 'crf' }, SOURCE);
  assert.equal(p.containerLabel, 'MP4');
  assert.equal(p.videoEncoderLabel, 'H.264');
  assert.equal(p.qualityLabel, 'CRF 20');
  assert.equal(p.sizeEstimate, null);
  assert.equal(p.sizeNoteKey, 'plan.sizeCRF');
});

test('convert bitrate mode estimates size from kbps × duration', () => {
  const p = plan.buildPlan('video.convert', { container: 'mp4', videoCodec: 'h264', mode: 'bitrate', videoBitrate: 22118, audioBitrate: 160 }, SOURCE);
  // AAC source + MP4 container → audio auto-copies, so only video counts.
  assert.equal(p.audioCopy, true);
  assert.equal(p.qualityLabel, '22118 kbps');
  const expected = 22118 * 1000 * 100 / 8 * 1.05;
  assert.ok(Math.abs(p.sizeEstimate - expected) < 1, `estimate ${expected}, got ${p.sizeEstimate}`);
});

test('remux and mute report source-like size', () => {
  for (const op of ['video.remux', 'video.mute']) {
    const p = plan.buildPlan(op, { container: 'mkv' }, SOURCE);
    assert.equal(p.sizeEstimate, 'source');
    assert.equal(p.sizeNoteKey, 'plan.sizeSource');
    assert.equal(p.qualityLabel, 'stream copy');
  }
});

test('lossless trim estimates the proportional share', () => {
  const p = plan.buildPlan('video.trim', { startSec: 20, endSec: 60, precise: false }, SOURCE);
  assert.equal(p.durationSec, 40);
  assert.equal(p.sizeEstimate, 20 * 1024 * 1024); // 50MB × 40/100
});

test('speed divides the output duration', () => {
  const p = plan.buildPlan('video.speed', { factor: 2 }, SOURCE);
  assert.equal(p.durationSec, 50);
});

test('merge sums durations and sizes in copy mode', () => {
  const other = { ...SOURCE, durationSec: 50, size: 25 * 1024 * 1024 };
  const p = plan.buildPlan('video.merge', { mode: 'copy', container: 'mp4' }, SOURCE, { allProbes: [SOURCE, other] });
  assert.equal(p.durationSec, 150);
  assert.equal(p.sizeEstimate, 75 * 1024 * 1024);
});

test('rotate 90 swaps dimensions, scale sets target size', () => {
  const r = plan.buildPlan('video.rotate', { angle: '90' }, SOURCE);
  assert.equal(r.width, 1080);
  assert.equal(r.height, 1920);
  const s = plan.buildPlan('video.scale', { size: '720p' }, SOURCE);
  assert.equal(s.width, 1280);
  assert.equal(s.height, 720);
});

test('webm plan reflects the forced VP9 + Opus encoders', () => {
  const p = plan.buildPlan('video.convert', { container: 'webm', videoCodec: 'h264', crf: 30, mode: 'crf' }, SOURCE);
  assert.equal(p.videoEncoderLabel, 'VP9');
  assert.equal(p.audioEncoderLabel, 'Opus');
});

test('avi plan reflects the forced MPEG-4 encoder', () => {
  const p = plan.buildPlan('video.convert', { container: 'avi', videoCodec: 'h264', crf: 20, mode: 'crf' }, SOURCE);
  assert.equal(p.videoEncoderLabel, 'MPEG-4');
});

test('GPU codec label is honest and bitrate-driven', () => {
  const p = plan.buildPlan('video.convert', { container: 'mp4', videoCodec: 'h264_videotoolbox', mode: 'bitrate', videoBitrate: 8000, audioBitrate: 160 }, SOURCE);
  assert.equal(p.videoEncoderLabel, 'H.264 (GPU)');
  assert.equal(p.qualityLabel, '8000 kbps');
  assert.ok(p.sizeEstimate > 0);
});

test('extractAudio copy keeps source codec label, no video fields', () => {
  const p = plan.buildPlan('video.extractAudio', { format: 'copy' }, SOURCE);
  assert.equal(p.audioEncoderLabel, 'AAC');
  assert.equal(p.videoEncoderLabel, null);
  assert.equal(p.width, null);
  assert.equal(p.sizeEstimate, 'source');
});

test('buildActual normalizes a probed output', () => {
  const probeSummary = {
    durationSec: 99.7, size: 291 * 1024 * 1024, bitrate: 23400000, formatName: 'mov,mp4,m4a',
    video: { codec: 'h264', width: 1920, height: 1080, fps: 24 },
    audio: { codec: 'aac' }
  };
  const a = plan.buildActual(probeSummary, '/out/converted.mp4');
  assert.equal(a.containerLabel, 'MP4');
  assert.equal(a.videoEncoderLabel, 'H.264');
  assert.equal(a.width, 1920);
  assert.equal(a.size, 291 * 1024 * 1024);
});

test('buildActual labels audio-only outputs by extension', () => {
  const a = plan.buildActual({ durationSec: 100, size: 2400000, audio: { codec: 'mp3' } }, '/out/audio.m4a');
  assert.equal(a.containerLabel, 'M4A');
  assert.equal(a.videoEncoderLabel, null);
});
