const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { buildJobCommands, outputExtFor } = require('./commands');
const { prepareInputs } = require('./prepare');
const { probe, summarize } = require('./probe');
const { reservePath, publishFile, publishSequence, deleteArtifact } = require('./artifacts');

const TERMINAL = new Set(['done', 'error', 'canceled']);
const concurrencyOf = (n) => Number.isInteger(Number(n)) ? Math.max(1, Math.min(4, Number(n))) : 1;
const canceledError = () => Object.assign(new Error('Job canceled'), { name: 'AbortError' });

function expectedDuration(op, p, probes) {
  let duration = probes[0]?.durationSec || 0;
  if (op === 'video.merge') return probes.reduce((total, s) => total + (s?.durationSec || 0), 0);
  if (op === 'video.replaceAudio' && probes[1]?.durationSec > 0) return duration > 0 ? Math.min(duration, probes[1].durationSec) : 0;
  if (['video.trim', 'audio.trim', 'video.anim'].includes(op)) {
    const end = p.endSec == null || p.endSec === '' ? duration : Number(p.endSec);
    duration = Math.max(0, (duration > 0 ? Math.min(end, duration) : end) - Number(p.startSec || 0));
  }
  if (op === 'video.speed') duration /= Number(p.factor || 1);
  return Number.isFinite(duration) ? duration : 0;
}

class JobManager extends EventEmitter {
  constructor({ ffmpeg, ffprobe, concurrency = 1 } = {}) {
    super();
    this.ffmpeg = ffmpeg;
    this.ffprobe = ffprobe;
    this.concurrency = concurrencyOf(concurrency);
    this.jobs = new Map();
    this.running = 0;
    this._seq = 0;
    this._children = new Map();
    this._reserved = new Set();
    this._runs = new Set();
    this._closing = false;
  }

  setBinaries({ ffmpeg, ffprobe }) { this.ffmpeg = ffmpeg; this.ffprobe = ffprobe; }
  setConcurrency(n) { this.concurrency = concurrencyOf(n); this._pump(); }
  activeCount() { return [...this.jobs.values()].filter((j) => !TERMINAL.has(j.status) || j.attempt).length; }
  list() { return [...this.jobs.values()].map((j) => this._public(j)); }

  _public(j) {
    return {
      id: j.id, op: j.op, params: j.params, inputs: j.inputs,
      inputNames: j.inputs.map((p) => path.basename(p)), outputPath: j.outputPath,
      status: j.status, progress: j.progress, speed: j.speed, error: j.error,
      commandText: j.commandText, expectedDuration: j.expectedDuration,
      plan: j.plan, cpuPercent: j.cpuPercent || 0, actual: j.actual,
      createdAt: j.createdAt, startedAt: j.startedAt, endedAt: j.endedAt,
      settling: Boolean(j.attempt && TERMINAL.has(j.status)),
      fallback: j.fallback || null, hasOutput: Boolean(j.artifact),
      artifactPaths: j.artifacts.map((a) => a.outputPath)
    };
  }

  _emit(job) { this.emit('updated', this._public(job)); }

  async add(spec) {
    if (this._closing) throw new Error('The application is shutting down');
    if (!spec || typeof spec.op !== 'string' || !Array.isArray(spec.inputs) || !spec.inputs.length ||
        spec.inputs.some((p) => typeof p !== 'string' || !path.isAbsolute(p)) ||
        typeof spec.outputPath !== 'string' || !path.isAbsolute(spec.outputPath)) throw new Error('Invalid job specification');
    const requestedSpec = structuredClone(spec);
    requestedSpec.params = Object.freeze(structuredClone(spec.params || {}));
    requestedSpec.requestedParams = spec.requestedParams ? Object.freeze(structuredClone(spec.requestedParams)) : undefined;
    requestedSpec.inputs = Object.freeze([...spec.inputs]);
    Object.freeze(requestedSpec);
    const job = {
      id: `job-${++this._seq}-${Date.now()}`, requestedSpec,
      op: spec.op, params: structuredClone(spec.params || {}), inputs: [...spec.inputs],
      outputPath: spec.outputPath, expectedDuration: 0, plan: spec.plan || null,
      actual: null, artifact: null, artifacts: [], attempt: null,
      status: 'queued', progress: 0, speed: 0, cpuPercent: 0, error: null,
      commandText: '', createdAt: Date.now(), startedAt: 0, endedAt: 0
    };
    this.jobs.set(job.id, job);
    this._emit(job);
    this._pump();
    return this._public(job);
  }

  cancel(id) {
    const job = this.jobs.get(id);
    if (!job || TERMINAL.has(job.status)) return false;
    job.status = 'canceled';
    job.endedAt = Date.now();
    job.speed = 0;
    job.attempt?.controller.abort();
    this._emit(job);
    return true;
  }

  retry(id) {
    const job = this.jobs.get(id);
    if (this._closing || !job || !TERMINAL.has(job.status) || job.attempt) return false;
    Object.assign(job, { status: 'queued', progress: 0, speed: 0, cpuPercent: 0, error: null,
      actual: null, plan: null, fallback: null, startedAt: 0, endedAt: 0, commandText: '' });
    this._emit(job);
    this._pump();
    return true;
  }

  static get canPause() { return process.platform !== 'win32'; }

  pause(id) {
    const job = this.jobs.get(id);
    const child = this._children.get(id);
    if (!JobManager.canPause || job?.status !== 'running' || !child || child !== job.attempt?.child) return false;
    try { if (!child.kill('SIGSTOP')) return false; } catch { return false; }
    job.status = 'paused';
    job.speed = 0;
    this._emit(job);
    return true;
  }

  resume(id) {
    const job = this.jobs.get(id);
    const child = this._children.get(id);
    if (job?.status !== 'paused' || !child || child !== job.attempt?.child) return false;
    try { if (!child.kill('SIGCONT')) return false; } catch { return false; }
    job.status = 'running';
    this._emit(job);
    return true;
  }

  remove(id) {
    const job = this.jobs.get(id);
    if (!job || job.attempt || !TERMINAL.has(job.status)) return false;
    this.jobs.delete(id);
    this.emit('removed', id);
    return true;
  }

  deleteOutput(id) {
    const job = this.jobs.get(id);
    if (!job || job.attempt || !TERMINAL.has(job.status)) return { ok: false, error: 'Job is still active' };
    const result = deleteArtifact(job.artifact, job.inputs);
    if (result.ok) {
      job.artifacts = job.artifacts.filter((a) => a !== job.artifact);
      job.artifact = null;
      this._emit(job);
    }
    return result;
  }

  async shutdown() {
    this._closing = true;
    for (const job of this.jobs.values()) if (!TERMINAL.has(job.status)) this.cancel(job.id);
    await Promise.allSettled([...this._runs]);
  }

  _check(job, attempt) {
    if (job.attempt !== attempt || attempt.controller.signal.aborted) throw canceledError();
  }

  _pump() {
    if (this._closing) return;
    while (this.running < this.concurrency) {
      const job = [...this.jobs.values()].find((j) => j.status === 'queued' && !j.attempt);
      if (!job) break;
      const attempt = { controller: new AbortController(), child: null, ffmpeg: this.ffmpeg, ffprobe: this.ffprobe, reserved: null, tmpDir: null };
      job.attempt = attempt;
      job.status = 'running';
      job.startedAt = Date.now();
      this.running++;
      this._emit(job);
      const run = this._run(job, attempt).catch((error) => {
        if (job.attempt !== attempt) return;
        job.status = attempt.controller.signal.aborted ? 'canceled' : 'error';
        job.error = job.status === 'error' ? error.message || String(error) : null;
        job.endedAt = Date.now();
      }).finally(() => {
        if (attempt.tmpDir) fs.rmSync(attempt.tmpDir, { recursive: true, force: true });
        if (attempt.reserved) this._reserved.delete(attempt.reserved);
        if (job.attempt === attempt) job.attempt = null;
        this.running--;
        this._runs.delete(run);
        this._emit(job);
        this._pump();
      });
      this._runs.add(run);
    }
  }

  async _run(job, attempt) {
    const { buildPlan, buildActual } = await import('../../shared/plan.mjs');
    const { resolveEncoding, applyResolved, isGpuEncoder } = await import('../../shared/resolve.mjs');
    const { assertValidOperation } = await import('../../shared/validation.mjs');
    this._check(job, attempt);
    const spec = job.requestedSpec;
    const probes = [];
    for (const input of job.inputs) {
      this._check(job, attempt);
      const stat = fs.statSync(input);
      if (!stat.isFile()) throw new Error('Input is not a regular file');
      // Text subtitles are decoded by prepareInputs, not every ffprobe build can read TTML.
      if (/\.(srt|vtt|ass|ssa|ttml|xml|dfxp)$/i.test(input)) { probes.push(null); continue; }
      probes.push(summarize(await probe(attempt.ffprobe, input, { signal: attempt.controller.signal }), input));
    }
    this._check(job, attempt);
    const source = probes[0] || {};
    const requested = structuredClone(spec.requestedParams || spec.params || {});
    const ctx = { probe: source, allProbes: probes, hasVideo: Boolean(source.video), hasAudio: Boolean(source.audio), subFormats: [] };
    const opts = { gpuEncoders: spec.gpuEncoders || [], allProbes: probes };
    assertValidOperation(job.op, requested, source, opts);
    let effective = requested;
    if (spec.requestedParams) {
      const resolved = resolveEncoding(job.op, requested, source, opts);
      if (resolved.error) throw new Error(resolved.error);
      effective = applyResolved(requested, resolved);
    }
    job.params = effective;
    job.expectedDuration = expectedDuration(job.op, effective, probes);
    job.plan = buildPlan(job.op, effective, source, opts);
    const frames = job.op === 'video.extractFrames';
    let desired;
    if (frames) {
      desired = spec.framesDirectory || spec.outputPath;
    } else {
      const ext = outputExtFor(job.op, effective, job.inputs[0], ctx);
      desired = path.join(path.dirname(spec.outputPath), `${path.basename(spec.outputPath, path.extname(spec.outputPath))}${ext}`);
    }
    fs.mkdirSync(path.dirname(desired), { recursive: true });
    attempt.reserved = reservePath(desired, this._reserved);
    attempt.tmpDir = fs.mkdtempSync(path.join(path.dirname(attempt.reserved), '.brushvs-work-'));
    const stagedBase = path.join(attempt.tmpDir, frames ? 'frame' : `output${path.extname(attempt.reserved)}`);
    let built;
    let staged;
    for (let pass = 0; pass < 2; pass++) {
      this._check(job, attempt);
      const prepared = prepareInputs(job.op, effective, job.inputs, attempt.tmpDir);
      ctx.subFormats = prepared.subFormats;
      built = buildJobCommands(job.op, effective, prepared.inputs, stagedBase, ctx);
      if (!built) throw new Error('Operation needs no processing');
      staged = built.outputPath || stagedBase;
      if (path.dirname(staged) !== attempt.tmpDir) throw new Error('Command output escaped its staging directory');
      if (!frames && path.extname(staged) !== path.extname(attempt.reserved)) throw new Error('Command changed the reserved output format');
      job.outputPath = frames ? path.join(attempt.reserved, path.basename(staged)) : attempt.reserved;
      job.commandText = built.steps.map((s) => `ffmpeg ${s.commandText}`).join('\n');
      this._emit(job);
      for (const aux of built.auxFiles || []) {
        if (path.basename(aux.name) !== aux.name) throw new Error('Invalid auxiliary filename');
        fs.writeFileSync(path.join(attempt.tmpDir, aux.name), aux.content, 'utf8');
      }
      try {
        for (let i = 0; i < built.steps.length; i++) {
          this._check(job, attempt);
          await this._runStep(job, attempt, built.steps[i], i, built.steps.length);
        }
        break;
      } catch (error) {
        this._check(job, attempt);
        const mayFallback = pass === 0 && spec.requestedParams && (requested.hwStrategy || 'auto') === 'auto' &&
          isGpuEncoder(effective.videoCodec) && /cannot create compression session|failed to (?:create|initializ)|no capable devices|hardware encoder.*(?:busy|not supported)/i.test(error.message + (error.stderr || ''));
        if (!mayFallback) throw error;
        const resolved = resolveEncoding(job.op, { ...requested, hwStrategy: 'cpu' }, source, { ...opts, gpuEncoders: [] });
        if (resolved.error) throw new Error(resolved.error);
        effective = applyResolved({ ...requested, hwStrategy: 'cpu' }, resolved);
        job.params = effective;
        job.fallback = 'cpu';
        job.plan = buildPlan(job.op, effective, source, { ...opts, gpuEncoders: [] });
        if (fs.existsSync(staged)) fs.unlinkSync(staged);
        this._emit(job);
      }
    }
    this._check(job, attempt);
    let actual = null;
    if (!frames) {
      if (!fs.existsSync(staged) || fs.statSync(staged).size === 0) throw new Error('Processing produced no output');
      const raw = await probe(attempt.ffprobe, staged, { signal: attempt.controller.signal });
      const summary = summarize(raw, staged);
      this._validateOutput(job, summary, ctx);
      actual = buildActual(summary, attempt.reserved);
    } else if (effective.mode === 'single' && (!fs.existsSync(staged) || !fs.statSync(staged).size)) {
      throw new Error('No frame exists at the selected time');
    }
    this._check(job, attempt);
    const artifact = frames ? publishSequence(staged, attempt.reserved) : publishFile(staged, attempt.reserved);
    job.artifacts.push(artifact);
    job.artifact = artifact;
    job.outputPath = artifact.outputPath;
    job.actual = actual;
    job.status = 'done';
    job.progress = 1;
    job.endedAt = Date.now();
  }

  _validateOutput(job, actual, ctx) {
    if (job.op === 'subtitle.extract') {
      if (!actual.subtitleStreams?.length) throw new Error('Output contains no subtitle stream');
      return;
    }
    if (job.op.startsWith('audio.') || job.op === 'video.extractAudio') {
      if (!actual.audio) throw new Error('Output contains no audio stream');
    } else if (job.op !== 'video.anim' && !actual.video) throw new Error('Output contains no video stream');
    if (job.op === 'video.merge' && job.expectedDuration > 0) {
      const tolerance = Math.max(0.5, job.expectedDuration * 0.03);
      if (Math.abs(actual.durationSec - job.expectedDuration) > tolerance) throw new Error('Merged output duration does not match its inputs');
      if (actual.video?.durationSec > 0 && Math.abs(actual.video.durationSec - job.expectedDuration) > tolerance) throw new Error('Merged video is incomplete');
      if (ctx.allProbes.some((p) => p?.audio) && !actual.audio) throw new Error('Merged output lost its audio');
    }
  }

  _runStep(job, attempt, step, stepIndex, stepCount) {
    this._check(job, attempt);
    return new Promise((resolve, reject) => {
      const child = spawn(attempt.ffmpeg, step.args, { cwd: attempt.tmpDir, windowsHide: true });
      attempt.child = child;
      this._children.set(job.id, child);
      const signal = attempt.controller.signal;
      const abort = () => child.kill('SIGKILL');
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      let stderr = '';
      let startError = null;
      let criticalError = false;
      let stdoutBuf = '';
      const report = (sec, speed) => {
        if (job.attempt !== attempt || job.status !== 'running' || signal.aborted) return;
        const fraction = job.expectedDuration > 0 ? Math.max(0, Math.min(1, sec / job.expectedDuration)) : 0;
        job.progress = Math.max(job.progress, Math.min(0.999, (stepIndex + fraction) / stepCount));
        if (Number.isFinite(speed)) job.speed = speed;
        this._emit(job);
      };
      const cpuSampler = process.platform !== 'win32' ? setInterval(() => {
        if (job.status !== 'running' || !child.pid) return;
        try {
          const result = spawnSync('ps', ['-o', 'pcpu=', '-p', String(child.pid)], { encoding: 'utf8', timeout: 1000 });
          const pct = parseFloat(result.stdout);
          if (Number.isFinite(pct)) { job.cpuPercent = Math.round(pct); this._emit(job); }
        } catch { /* CPU sampling is optional. */ }
      }, 600) : null;
      child.stdout.on('data', (data) => {
        stdoutBuf += data;
        const lines = stdoutBuf.split('\n');
        stdoutBuf = lines.pop().slice(-8192);
        let sec = 0;
        let speed;
        let hasTime = false;
        for (const line of lines) {
          const time = line.match(/^out_time_(?:us|ms)=(-?\d+)/);
          const sp = line.match(/^speed=\s*([\d.]+)x/);
          if (time) { sec = Number(time[1]) / 1e6; hasTime = true; }
          if (sp) speed = Number(sp[1]);
        }
        if (hasTime) report(sec, speed);
      });
      child.stderr.on('data', (data) => {
        stderr = (stderr + data.toString()).slice(-65536);
        if (/Impossible to open|Error demuxing|Error splitting the input into NAL units|Error while decoding stream/.test(stderr)) criticalError = true;
      });
      child.on('error', (error) => { startError = new Error(`Failed to start ffmpeg: ${error.message}`); });
      child.on('close', (code) => {
        signal.removeEventListener('abort', abort);
        if (cpuSampler) clearInterval(cpuSampler);
        if (this._children.get(job.id) === child) this._children.delete(job.id);
        if (attempt.child === child) attempt.child = null;
        if (signal.aborted) return reject(canceledError());
        if (startError) return reject(startError);
        if (code === 0 && !criticalError) return resolve();
        const error = new Error(extractUsefulError(stderr) || `ffmpeg exited with code ${code}`);
        error.stderr = stderr;
        reject(error);
      });
    });
  }
}

function extractUsefulError(stderr) {
  if (!stderr) return '';
  const lines = stderr.split('\n').map((l) => l.trim()).filter(Boolean);
  const meaningful = lines.filter((l) => /Error|error|Invalid|invalid|Unable|unable|No such|not found|Unknown|unknown|matches no streams|failed|Failed/.test(l));
  return (meaningful.at(-1) || lines.at(-1) || '').slice(0, 300);
}

module.exports = { JobManager, extractUsefulError, expectedDuration };
