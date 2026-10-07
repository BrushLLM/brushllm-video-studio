'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { JobManager } = require('../../electron/engine/queue');
const { deferred, waitFor } = require('../helpers/deferred');

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'brushvs-q-test-'));
}

function touch(filePath, content = 'data') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

// Mock ffmpeg/ffprobe that just write output without actual encoding
const mockFfmpeg = path.join(__dirname, '../helpers/mock-ffmpeg.js');
const mockFfprobe = path.join(__dirname, '../helpers/mock-ffprobe.js');

function setupMockBinaries() {
  if (!fs.existsSync(mockFfmpeg)) {
    fs.writeFileSync(mockFfmpeg, `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const outIdx = args.lastIndexOf('-y') !== -1 ? args.indexOf('-y') + 1 : args.length - 1;
const out = args[outIdx];
if (out && !out.startsWith('-')) {
  if (out.includes('%05d')) {
    const dir = require('path').dirname(out);
    fs.writeFileSync(require('path').join(dir, 'frame00001.png'), 'f1');
  } else {
    fs.writeFileSync(out, 'mock output');
  }
}
process.stdout.write('out_time_us=1000000\\nspeed=1.0x\\n');
`, { mode: 0o755 });
  }
  if (!fs.existsSync(mockFfprobe)) {
    fs.writeFileSync(mockFfprobe, `#!/usr/bin/env node
console.log(JSON.stringify({
  streams: [
    { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, duration: '10.0' },
    { codec_type: 'audio', codec_name: 'aac', duration: '10.0' }
  ],
  format: { duration: '10.0', size: '1000000' }
}));
`, { mode: 0o755 });
  }
}

// ── Concurrency clamping ──────────────────────────────────────────────────────

test('JobManager clamps concurrency to [1, 4]', () => {
  assert.equal(new JobManager({ concurrency: 0 }).concurrency, 1);
  assert.equal(new JobManager({ concurrency: -5 }).concurrency, 1);
  assert.equal(new JobManager({ concurrency: 1 }).concurrency, 1);
  assert.equal(new JobManager({ concurrency: 2 }).concurrency, 2);
  assert.equal(new JobManager({ concurrency: 4 }).concurrency, 4);
  assert.equal(new JobManager({ concurrency: 10 }).concurrency, 4);
  assert.equal(new JobManager({ concurrency: 'invalid' }).concurrency, 1);
  assert.equal(new JobManager({ concurrency: 2.5 }).concurrency, 1);
});

test('setConcurrency clamps to [1, 4]', () => {
  const mgr = new JobManager({ concurrency: 1 });
  mgr.setConcurrency(5);
  assert.equal(mgr.concurrency, 4);
  mgr.setConcurrency(0);
  assert.equal(mgr.concurrency, 1);
});

// ── Cancel and retry ──────────────────────────────────────────────────────────

test('cancel marks job as canceled and attempt is eventually cleared', async () => {
  setupMockBinaries();
  const dir = makeTmp();
  const input = path.join(dir, 'in.mp4');
  touch(input, 'input data');
  const mgr = new JobManager({ ffmpeg: mockFfmpeg, ffprobe: mockFfprobe, concurrency: 1 });
  
  const job = await mgr.add({
    op: 'video.convert',
    params: { container: 'mp4', videoCodec: 'h264', audioCodec: 'aac' },
    inputs: [input],
    outputPath: path.join(dir, 'out.mp4')
  });

  await waitFor(() => mgr.jobs.get(job.id).status === 'running', { timeout: 1000 });
  const canceled = mgr.cancel(job.id);
  assert.ok(canceled, 'cancel should return true for a running job');
  
  await waitFor(() => mgr.jobs.get(job.id).status === 'canceled' && !mgr.jobs.get(job.id).attempt, { timeout: 2000 });
  const final = mgr.jobs.get(job.id);
  assert.equal(final.status, 'canceled');
  assert.equal(final.attempt, null, 'attempt should be cleared after cancel settles');
});

test('retry queues a canceled job again', async () => {
  setupMockBinaries();
  const dir = makeTmp();
  const input = path.join(dir, 'in.mp4');
  touch(input, 'input');
  const mgr = new JobManager({ ffmpeg: mockFfmpeg, ffprobe: mockFfprobe, concurrency: 1 });
  
  const job = await mgr.add({
    op: 'video.convert',
    params: { container: 'mp4', videoCodec: 'h264' },
    inputs: [input],
    outputPath: path.join(dir, 'out.mp4')
  });

  await waitFor(() => mgr.jobs.get(job.id).status === 'running');
  mgr.cancel(job.id);
  await waitFor(() => mgr.jobs.get(job.id).status === 'canceled' && !mgr.jobs.get(job.id).attempt);

  const retried = mgr.retry(job.id);
  assert.ok(retried, 'retry should return true for a settled canceled job');
  const state = mgr.jobs.get(job.id);
  assert.ok(['queued', 'running'].includes(state.status), 'retry restarts the job');
  assert.equal(state.error, null);
  assert.equal(state.progress, 0);
});

test('retry does NOT work while job.attempt still exists (settling phase)', async () => {
  setupMockBinaries();
  const dir = makeTmp();
  const input = path.join(dir, 'in.mp4');
  touch(input, 'input');
  const mgr = new JobManager({ ffmpeg: mockFfmpeg, ffprobe: mockFfprobe, concurrency: 1 });
  
  const job = await mgr.add({
    op: 'video.convert',
    params: { container: 'mp4', videoCodec: 'h264' },
    inputs: [input],
    outputPath: path.join(dir, 'out.mp4')
  });

  await waitFor(() => mgr.jobs.get(job.id).status === 'running');
  mgr.cancel(job.id);
  
  // Immediately after cancel, job.status is 'canceled' but job.attempt may still exist briefly
  const immediately = mgr.jobs.get(job.id);
  if (immediately.attempt) {
    const retried = mgr.retry(job.id);
    assert.equal(retried, false, 'retry must refuse when attempt still exists');
  }
  
  // Wait for settlement
  await waitFor(() => !mgr.jobs.get(job.id).attempt, { timeout: 2000 });
  const retried = mgr.retry(job.id);
  assert.ok(retried, 'retry should work after settlement');
});

test('retry refuses when job is paused (not terminal)', () => {
  if (!JobManager.canPause) return; // skip on Windows
  const mgr = new JobManager({ ffmpeg: mockFfmpeg, ffprobe: mockFfprobe });
  // Manually construct a paused job state to test the guard
  mgr.jobs.set('test-id', {
    id: 'test-id', status: 'paused', attempt: null,
    op: 'video.convert', params: {}, inputs: ['/fake.mp4'], outputPath: '/out.mp4',
    artifacts: [], artifact: null, progress: 0.5, speed: 0, error: null,
    commandText: '', createdAt: Date.now(), startedAt: Date.now(), endedAt: 0
  });
  const result = mgr.retry('test-id');
  assert.equal(result, false, 'retry must refuse paused jobs');
});

test('retry on error job preserves old artifact and does not delete it', async () => {
  setupMockBinaries();
  const dir = makeTmp();
  const input = path.join(dir, 'in.mp4');
  touch(input, 'input');
  
  // Use a real failing command (invalid ffmpeg args)
  const badFfmpeg = path.join(dir, 'bad-ffmpeg.js');
  fs.writeFileSync(badFfmpeg, `#!/usr/bin/env node
process.exit(1);
`, { mode: 0o755 });
  
  const mgr = new JobManager({ ffmpeg: badFfmpeg, ffprobe: mockFfprobe, concurrency: 1 });
  const job = await mgr.add({
    op: 'video.convert',
    params: { container: 'mp4', videoCodec: 'h264' },
    inputs: [input],
    outputPath: path.join(dir, 'out.mp4')
  });

  await waitFor(() => mgr.jobs.get(job.id).status === 'error', { timeout: 2000 });
  const errored = mgr.jobs.get(job.id);
  assert.equal(errored.status, 'error');
  const oldArtifacts = [...errored.artifacts];
  
  // Now retry - old artifacts should remain
  const retried = mgr.retry(job.id);
  assert.ok(retried);
  const afterRetry = mgr.jobs.get(job.id);
  assert.ok(['queued', 'running'].includes(afterRetry.status), 'retry restarts the job');
  assert.deepEqual(afterRetry.artifacts, oldArtifacts, 'retry must preserve old artifacts array');
});

// ── Shutdown waiting for all runs ─────────────────────────────────────────────

test('shutdown waits for all running jobs to finish', async () => {
  setupMockBinaries();
  const dir = makeTmp();
  const input = path.join(dir, 'in.mp4');
  touch(input, 'input');
  
  const mgr = new JobManager({ ffmpeg: mockFfmpeg, ffprobe: mockFfprobe, concurrency: 2 });
  
  const j1 = await mgr.add({
    op: 'video.convert',
    params: { container: 'mp4', videoCodec: 'h264' },
    inputs: [input],
    outputPath: path.join(dir, 'out1.mp4')
  });
  const j2 = await mgr.add({
    op: 'video.convert',
    params: { container: 'mp4', videoCodec: 'h264' },
    inputs: [input],
    outputPath: path.join(dir, 'out2.mp4')
  });

  await waitFor(() => mgr.jobs.get(j1.id).status === 'running' && mgr.jobs.get(j2.id).status === 'running', { timeout: 1000 });
  
  const shutdownPromise = mgr.shutdown();
  // Both jobs should be canceled
  await waitFor(() => mgr.jobs.get(j1.id).status === 'canceled' && mgr.jobs.get(j2.id).status === 'canceled', { timeout: 1000 });
  
  // shutdown should not resolve until attempts are cleared
  await shutdownPromise;
  assert.equal(mgr.jobs.get(j1.id).attempt, null, 'j1 attempt should be cleared after shutdown');
  assert.equal(mgr.jobs.get(j2.id).attempt, null, 'j2 attempt should be cleared after shutdown');
  assert.equal(mgr._runs.size, 0, 'all runs should be settled');
});

test('add rejects new jobs during shutdown', async () => {
  const mgr = new JobManager({ ffmpeg: mockFfmpeg, ffprobe: mockFfprobe });
  mgr._closing = true;
  await assert.rejects(
    async () => mgr.add({
      op: 'video.convert',
      params: {},
      inputs: ['/fake.mp4'],
      outputPath: '/out.mp4'
    }),
    /shutting down/i
  );
});

test('retry refuses new work during shutdown', async () => {
  setupMockBinaries();
  const dir = makeTmp();
  const input = path.join(dir, 'in.mp4');
  touch(input, 'input');
  
  const mgr = new JobManager({ ffmpeg: mockFfmpeg, ffprobe: mockFfprobe });
  const job = await mgr.add({
    op: 'video.convert',
    params: { container: 'mp4', videoCodec: 'h264' },
    inputs: [input],
    outputPath: path.join(dir, 'out.mp4')
  });
  
  await waitFor(() => mgr.jobs.get(job.id).status === 'running');
  mgr.cancel(job.id);
  await waitFor(() => !mgr.jobs.get(job.id).attempt);
  
  mgr._closing = true;
  const result = mgr.retry(job.id);
  assert.equal(result, false, 'retry must refuse during shutdown');
});

// ── Cancel does not affect new retry attempt ──────────────────────────────────

test('cancel→retry: old attempt abort does not affect new attempt', async () => {
  setupMockBinaries();
  const dir = makeTmp();
  const input = path.join(dir, 'in.mp4');
  touch(input, 'input');
  
  const mgr = new JobManager({ ffmpeg: mockFfmpeg, ffprobe: mockFfprobe, concurrency: 1 });
  
  const job = await mgr.add({
    op: 'video.convert',
    params: { container: 'mp4', videoCodec: 'h264' },
    inputs: [input],
    outputPath: path.join(dir, 'out.mp4')
  });

  await waitFor(() => mgr.jobs.get(job.id).status === 'running');
  const oldAttempt = mgr.jobs.get(job.id).attempt;
  mgr.cancel(job.id);
  
  // Wait for old attempt to clear
  await waitFor(() => !mgr.jobs.get(job.id).attempt, { timeout: 2000 });
  assert.ok(oldAttempt.controller.signal.aborted, 'old controller should be aborted');
  
  // Retry creates a new attempt
  mgr.retry(job.id);
  await waitFor(() => mgr.jobs.get(job.id).status === 'running');
  const newAttempt = mgr.jobs.get(job.id).attempt;
  assert.notEqual(newAttempt, oldAttempt, 'new attempt must be a different object');
  assert.ok(!newAttempt.controller.signal.aborted, 'new attempt controller must not be aborted');
});

// ── remove/deleteOutput guards ────────────────────────────────────────────────

test('remove refuses to remove a job while attempt exists', async () => {
  setupMockBinaries();
  const dir = makeTmp();
  const input = path.join(dir, 'in.mp4');
  touch(input, 'input');
  
  const mgr = new JobManager({ ffmpeg: mockFfmpeg, ffprobe: mockFfprobe });
  const job = await mgr.add({
    op: 'video.convert',
    params: { container: 'mp4', videoCodec: 'h264' },
    inputs: [input],
    outputPath: path.join(dir, 'out.mp4')
  });

  await waitFor(() => mgr.jobs.get(job.id).status === 'running');
  mgr.cancel(job.id);
  
  // Before settlement
  if (mgr.jobs.get(job.id).attempt) {
    const removed = mgr.remove(job.id);
    assert.equal(removed, false, 'remove must refuse while attempt exists');
  }
  
  // After settlement
  await waitFor(() => !mgr.jobs.get(job.id).attempt);
  const removed = mgr.remove(job.id);
  assert.ok(removed, 'remove should succeed after settlement');
});

test('deleteOutput refuses to delete while attempt exists', async () => {
  setupMockBinaries();
  const dir = makeTmp();
  const input = path.join(dir, 'in.mp4');
  touch(input, 'input');
  
  const mgr = new JobManager({ ffmpeg: mockFfmpeg, ffprobe: mockFfprobe });
  const job = await mgr.add({
    op: 'video.convert',
    params: { container: 'mp4', videoCodec: 'h264' },
    inputs: [input],
    outputPath: path.join(dir, 'out.mp4')
  });

  await waitFor(() => mgr.jobs.get(job.id).status === 'running');
  mgr.cancel(job.id);
  
  // Before settlement
  if (mgr.jobs.get(job.id).attempt) {
    const result = mgr.deleteOutput(job.id);
    assert.equal(result.ok, false);
    assert.match(result.error, /still active/i);
  }
});

// ── Input validation ──────────────────────────────────────────────────────────

test('add validates spec structure', async () => {
  const mgr = new JobManager({ ffmpeg: mockFfmpeg, ffprobe: mockFfprobe });
  
  await assert.rejects(() => mgr.add(null), /invalid job specification/i);
  await assert.rejects(() => mgr.add({ op: 'video.convert' }), /invalid/i); // no inputs
  await assert.rejects(() => mgr.add({ op: 'video.convert', inputs: [] }), /invalid/i); // empty inputs
  await assert.rejects(() => mgr.add({ op: 'video.convert', inputs: ['relative.mp4'], outputPath: '/out.mp4' }), /invalid/i); // relative input
  await assert.rejects(() => mgr.add({ op: 'video.convert', inputs: ['/in.mp4'], outputPath: 'relative.mp4' }), /invalid/i); // relative output
});
