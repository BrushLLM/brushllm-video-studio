// Job queue: sequential ffmpeg execution with progress, cancel, retry.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { buildJobCommands } = require('./commands');
const { prepareInputs } = require('./prepare');
const { probe, summarize } = require('./probe');

class JobManager extends EventEmitter {
  constructor({ ffmpeg, ffprobe, concurrency = 1 } = {}) {
    super();
    this.ffmpeg = ffmpeg;
    this.ffprobe = ffprobe;
    this.concurrency = concurrency;
    this.jobs = new Map();
    this.running = 0;
    this._seq = 0;
    this._children = new Map(); // jobId -> child process
  }

  setBinaries({ ffmpeg, ffprobe }) {
    this.ffmpeg = ffmpeg;
    this.ffprobe = ffprobe;
  }

  setConcurrency(n) {
    this.concurrency = Math.max(1, Math.min(4, n | 0));
    this._pump();
  }

  // How many jobs are queued/running/paused right now — used by main.js to
  // hold a powerSaveBlocker while work is in flight.
  activeCount() {
    let n = 0;
    for (const j of this.jobs.values()) {
      if (j.status === 'queued' || j.status === 'running' || j.status === 'paused') n++;
    }
    return n;
  }

  list() {
    return [...this.jobs.values()].map((j) => this._public(j));
  }

  _public(j) {
    return {
      id: j.id,
      op: j.op,
      params: j.params,
      inputs: j.inputs,
      inputNames: j.inputs.map((p) => path.basename(p)),
      outputPath: j.outputPath,
      status: j.status,
      progress: j.progress,
      speed: j.speed,
      error: j.error,
      commandText: j.commandText,
      expectedDuration: j.expectedDuration,
      plan: j.plan,
      cpuPercent: j.cpuPercent || 0,
      actual: j.actual,
      createdAt: j.createdAt,
      startedAt: j.startedAt,
      endedAt: j.endedAt
    };
  }

  // spec: { op, params, inputs, outputPath, expectedDuration?, plan?, probes? }
  async add(spec) {
    const id = `job-${++this._seq}-${Date.now()}`;
    const job = {
      id,
      op: spec.op,
      params: spec.params || {},
      inputs: spec.inputs,
      outputPath: spec.outputPath,
      expectedDuration: spec.expectedDuration || 0,
      plan: spec.plan || null,
      probes: spec.probes || null, // pre-probed by main.js; skips re-probing
      actual: null,
      status: 'queued',
      progress: 0,
      speed: 0,
      error: null,
      commandText: '',
      createdAt: Date.now(),
      startedAt: 0,
      endedAt: 0
    };
    this.jobs.set(id, job);
    this.emit('updated', this._public(job));
    this._pump();
    return this._public(job);
  }

  cancel(id) {
    const job = this.jobs.get(id);
    if (!job) return false;
    // SIGKILL terminates a SIGSTOPped process too — paused jobs must be
    // terminable, otherwise "terminate" silently no-ops and the job later
    // completes as if nothing happened.
    if (job.status === 'running' || job.status === 'paused') {
      const child = this._children.get(id);
      if (child) child.kill('SIGKILL');
      job.status = 'canceled';
      job.endedAt = Date.now();
      this._cleanupPartial(job);
    } else if (job.status === 'queued') {
      job.status = 'canceled';
      job.endedAt = Date.now();
    } else {
      return false;
    }
    this.emit('updated', this._public(job));
    return true;
  }

  retry(id) {
    const job = this.jobs.get(id);
    if (!job || !['error', 'canceled', 'done', 'paused'].includes(job.status)) return false;
    job.status = 'queued';
    job.progress = 0;
    job.speed = 0;
    job.error = null;
    job.startedAt = 0;
    job.endedAt = 0;
    this.emit('updated', this._public(job));
    this._pump();
    return true;
  }

  // Real pause/resume via SIGSTOP/SIGCONT (POSIX only — not on Windows).
  static get canPause() {
    return process.platform !== 'win32';
  }

  pause(id) {
    if (!JobManager.canPause) return false;
    const job = this.jobs.get(id);
    if (!job || job.status !== 'running') return false;
    const child = this._children.get(id);
    if (!child) return false;
    try {
      child.kill('SIGSTOP');
    } catch {
      return false;
    }
    job.status = 'paused';
    job.speed = 0;
    this.emit('updated', this._public(job));
    return true;
  }

  resume(id) {
    const job = this.jobs.get(id);
    if (!job || job.status !== 'paused') return false;
    const child = this._children.get(id);
    if (!child) return false;
    try {
      child.kill('SIGCONT');
    } catch {
      return false;
    }
    job.status = 'running';
    this.emit('updated', this._public(job));
    return true;
  }

  remove(id) {
    const job = this.jobs.get(id);
    if (!job || job.status === 'running' || job.status === 'paused') return false;
    this.jobs.delete(id);
    this.emit('removed', id);
    return true;
  }

  _cleanupPartial(job) {
    try {
      if (job.outputPath && fs.existsSync(job.outputPath)) {
        fs.rmSync(job.outputPath, { force: true });
      }
    } catch {
      /* best effort */
    }
  }

  _pump() {
    while (this.running < this.concurrency) {
      const next = [...this.jobs.values()].find((j) => j.status === 'queued');
      if (!next) break;
      this.running++;
      next.status = 'running';
      next.startedAt = Date.now();
      this.emit('updated', this._public(next));
      this._run(next)
        .catch((err) => {
          next.status = 'error';
          next.error = err.message || String(err);
          next.endedAt = Date.now();
          // A failed job must not leave a broken partial output behind.
          this._cleanupPartial(next);
          this.emit('updated', this._public(next));
        })
        .finally(() => {
          this.running--;
          this._pump();
        });
    }
  }

  async _run(job) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brushvs-'));
    try {
      // Probe inputs for ctx (hasAudio, codecs, merge compatibility).
      // main.js already probed them at submission time — reuse when present.
      const probes = [];
      if (job.probes && job.probes.length === job.inputs.length) {
        probes.push(...job.probes);
      } else {
        for (const input of job.inputs) {
          try {
            probes.push(summarize(await probe(this.ffprobe, input)));
          } catch {
            probes.push(null);
          }
        }
      }
      const primary = probes[0] || {};
      const ctx = {
        hasAudio: !!(primary.audio && primary.audio.codec),
        hasVideo: !!(primary.video && primary.video.codec),
        probe: primary,
        allProbes: probes,
        subFormats: []
      };
      if (!job.expectedDuration) {
        if (job.op === 'video.merge') {
          job.expectedDuration = probes.reduce((acc, p) => acc + ((p && p.durationSec) || 0), 0);
        } else {
          job.expectedDuration = primary.durationSec || 0;
        }
        // Trim / anim jobs only process a sub-range.
        const p = job.params;
        if (p.startSec != null && p.startSec > 0) {
          job.expectedDuration = Math.max(
            0.1,
            job.expectedDuration - Number(p.startSec)
          );
        }
        if (p.endSec != null && p.endSec > 0) {
          job.expectedDuration = Math.max(0.1, Math.min(job.expectedDuration, Number(p.endSec) - Number(p.startSec || 0)));
        }
        // Speed changes scale the output duration.
        if (job.op === 'video.speed' && p.factor > 0) {
          job.expectedDuration = Math.max(0.1, job.expectedDuration / Number(p.factor));
        }
      }

      const prepared = prepareInputs(job.op, job.params, job.inputs, tmpDir);
      ctx.subFormats = prepared.subFormats;
      const inputs = prepared.inputs;

      const built = buildJobCommands(job.op, job.params, inputs, job.outputPath, ctx);
      if (!built) throw new Error('Operation needs no processing');
      if (built.outputPath && built.outputPath !== job.outputPath) {
        job.outputPath = built.outputPath;
      }
      job.commandText = built.steps.map((s) => `ffmpeg ${s.commandText}`).join('\n');
      this.emit('updated', this._public(job));

      // Materialize aux files (concat lists etc.).
      for (const aux of built.auxFiles || []) {
        fs.writeFileSync(path.join(tmpDir, aux.name), aux.content, 'utf8');
      }
      // Ensure the output directory exists.
      const outDir = path.dirname(job.outputPath.replace(/%05d[^/]*$/, 'x'));
      fs.mkdirSync(outDir, { recursive: true });

      for (let i = 0; i < built.steps.length; i++) {
        if (job.status === 'canceled') return;
        await this._runStep(job, built.steps[i], tmpDir, i, built.steps.length);
      }
      // A cancel that landed in the gap between the last step finishing and
      // this line must NOT be overwritten by "done".
      if (job.status === 'canceled') return;
      job.status = 'done';
      job.progress = 1;
      job.endedAt = Date.now();
      // actual layer: re-probe the finished output (single files only).
      if (job.outputPath && !job.outputPath.includes('%05d')) {
        try {
          const raw = await probe(this.ffprobe, job.outputPath);
          job.actual = summarize(raw);
        } catch {
          /* probing the output is best-effort */
        }
      }
      this.emit('updated', this._public(job));
    } finally {
      fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  _runStep(job, step, cwd, stepIndex, stepCount) {
    return new Promise((resolve, reject) => {
      const child = spawn(this.ffmpeg, step.args, { cwd });
      this._children.set(job.id, child);
      let stderrTail = '';
      let stderrAll = '';

      const stepBase = stepIndex / stepCount;
      const stepSpan = 1 / stepCount;
      const report = (sec, speed) => {
        let frac = 0;
        if (job.expectedDuration > 0 && sec != null && isFinite(sec)) {
          frac = Math.max(0, Math.min(1, sec / job.expectedDuration));
        }
        // Monotonic: progress never goes backwards, and never reads as 100%
        // while the job is still running.
        const next = Math.min(0.999, stepBase + stepSpan * frac);
        job.progress = Math.max(job.progress || 0, next);
        if (speed != null) job.speed = speed;
        this.emit('updated', this._public(job));
      };

      // Live CPU utilization of the ffmpeg child (POSIX only) — makes
      // hardware usage visible in the queue instead of guessable.
      let cpuSampler = null;
      if (process.platform !== 'win32') {
        cpuSampler = setInterval(() => {
          try {
            const out = require('node:child_process')
              .spawnSync('ps', ['-o', 'pcpu=', '-p', String(child.pid)], { encoding: 'utf8' });
            const pct = parseFloat(out.stdout);
            if (isFinite(pct)) {
              job.cpuPercent = Math.round(pct);
              this.emit('updated', this._public(job));
            }
          } catch {
            /* sampling is best-effort */
          }
        }, 600);
      }

      let stdoutBuf = '';
      child.stdout.on('data', (chunk) => {
        stdoutBuf += chunk;
        const lines = stdoutBuf.split('\n');
        stdoutBuf = lines.pop();
        let sec = null;
        let speed = null;
        for (const line of lines) {
          const mUs = line.match(/^out_time_us=(\d+)/);
          // NB: ffmpeg's out_time_ms is actually microseconds (upstream quirk).
          const mMs = line.match(/^out_time_ms=(\d+)/);
          const mSp = line.match(/^speed=\s*([\d.]+)x/);
          if (mUs) sec = parseInt(mUs[1], 10) / 1e6;
          else if (mMs) sec = parseInt(mMs[1], 10) / 1e6;
          if (mSp) speed = parseFloat(mSp[1]);
        }
        if (sec != null || speed != null) report(sec, speed);
      });

      child.stderr.on('data', (chunk) => {
        const s = chunk.toString();
        stderrAll += s;
        stderrTail = (stderrTail + s).slice(-4000);
        // Fallback progress from the stats line when -progress is unavailable.
        const mTime = s.match(/time=(\d+):(\d{2}):([\d.]+)/);
        const mSp = s.match(/speed=\s*([\d.]+)x/);
        if (mTime) {
          const sec = +mTime[1] * 3600 + +mTime[2] * 60 + parseFloat(mTime[3]);
          report(sec, mSp ? parseFloat(mSp[1]) : null);
        }
      });

      child.on('error', (e) => {
        this._children.delete(job.id);
        reject(new Error(`Failed to start ffmpeg: ${e.message}`));
      });

      child.on('close', (code) => {
        this._children.delete(job.id);
        if (cpuSampler) clearInterval(cpuSampler);
        if (job.status === 'canceled') {
          resolve();
          return;
        }
        if (code === 0) {
          resolve();
        } else {
          const hint = extractUsefulError(stderrAll);
          reject(new Error(hint || `ffmpeg exited with code ${code}`));
        }
      });
    });
  }
}

function extractUsefulError(stderr) {
  if (!stderr) return '';
  const lines = stderr.split('\n').map((l) => l.trim()).filter(Boolean);
  // Prefer lines that describe the actual failure.
  const meaningful = lines.filter(
    (l) =>
      /Error|error|Invalid|invalid|Unable|unable|No such|not found|Unknown|unknown|matches no streams|failed|Failed/.test(l)
  );
  const pick = meaningful.length ? meaningful[meaningful.length - 1] : lines[lines.length - 1];
  return pick.slice(0, 300);
}

module.exports = { JobManager, extractUsefulError };
