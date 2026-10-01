// Bridge: the real Electron preload API when available, an in-browser mock
// otherwise (used for GUI development and testing).

const real = typeof window !== 'undefined' ? window.brushvs : null;

function makeMock() {
  const settings = { language: 'system', ffmpegPath: '', ffprobePath: '', outputDir: '', concurrency: 1, preventSleep: true };
  const listeners = { updated: [], removed: [] };
  const jobs = new Map();
  let seq = 0;

  const SAMPLE_PROBE = {
    durationSec: 142.5, bitrate: 2456000, size: 438000000, formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
    video: { codec: 'h264', width: 1920, height: 1080, fps: 25, rotation: 0 },
    audio: { codec: 'aac', sampleRate: 48000, channels: 2 },
    subtitleStreams: [
      { index: 2, codec: 'subrip', language: 'chi' },
      { index: 3, codec: 'ass', language: 'eng' }
    ],
    streamCount: 4
  };

  const emit = (job) => listeners.updated.forEach((cb) => cb(job));

  return {
    __mock: true,
    pathForFile: (file) => file?.path || file?.name || '',
    getSettings: async () => ({ ...settings }),
    setSettings: async (patch) => ({ ...Object.assign(settings, patch) }),
    appInfo: async () => ({
      version: '0.0.1', electron: '33.4.11', node: '22.17.0', cpuCount: 12,
      ffmpegPath: '/usr/local/bin/ffmpeg (mock)', locale: 'zh-CN',
      platform: 'darwin', arch: 'arm64', gpuEncoders: ['h264_videotoolbox', 'hevc_videotoolbox'],
      userData: '~/.mock'
    }),
    openFiles: async (kind) => {
      // Browsers can't hand out real paths; fabricate plausible ones.
      if (kind === 'mediaAndSubs') return ['/Users/demo/subtitle.srt'];
      const names = { media: 'sample.mp4', audio: 'track.mp3', subtitle: 'subtitle.srt', any: 'file.bin' };
      const n = 1 + Math.floor(Math.random() * 2);
      return Array.from({ length: n }, (_, i) => `/Users/demo/${(kind === 'subtitle' ? 'subtitle' : 'sample')}${i ? `-${i + 1}` : ''}.${(names[kind] || 'file.bin').split('.').pop()}`);
    },
    pickDirectory: async () => '/Users/demo/Output',
    probeFile: async () => ({
      raw: {
        format: { duration: '142.500000', bit_rate: '2456000', size: '438000000', format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
        streams: [
          { index: 0, codec_type: 'video', codec_name: 'h264', codec_long_name: 'H.264 / AVC', width: 1920, height: 1080, bit_rate: '2200000' },
          { index: 1, codec_type: 'audio', codec_name: 'aac', codec_long_name: 'AAC (Advanced Audio Coding)', sample_rate: '48000', channels: 2, bit_rate: '256000' },
          { index: 2, codec_type: 'subtitle', codec_name: 'subrip', codec_long_name: 'SubRip subtitle' }
        ]
      },
      summary: SAMPLE_PROBE
    }),
    addJobs: async (specs) => specs.map((spec) => {
      const id = `mock-${++seq}`;
      const base = spec.inputs[0].replace(/\.[^.]+$/, '');
      const job = {
        id, op: spec.op, params: spec.params, inputs: spec.inputs,
        inputNames: spec.inputs.map((p) => p.split(/[/\\]/).pop()),
        outputPath: spec.outputPath || `${base}-${spec.op.split('.').pop()}.mp4`,
        plan: { containerLabel: 'MP4', videoEncoderLabel: 'H.264', qualityLabel: 'CRF 23', durationSec: 142.5, sizeEstimate: null, sizeNoteKey: 'plan.sizeCRF', width: 1920, height: 1080, fps: 25 },
        actual: null,
        status: 'running', progress: 0, speed: 0,
        error: null, commandText: `ffmpeg -i ${spec.inputs[0]} … ${spec.outputPath}`,
        expectedDuration: 142.5, createdAt: Date.now(), startedAt: Date.now(), endedAt: 0
      };
      jobs.set(id, job);
      emit(job);
      // Realistic pacing: ~15 s per job, smooth monotonic progress that
      // never reads as 100% while running, pausable like a real encode.
      const TICK_MS = 300;
      const INCREMENT = 0.0021 + Math.random() * 0.0008;
      const timer = setInterval(() => {
        if (job.status !== 'running') return; // paused: progress freezes
        job.progress = Math.min(0.999, job.progress + INCREMENT);
        job.speed = 1.2 + Math.random() * 2;
        emit(job);
        if (job.progress >= 0.999) {
          clearInterval(timer);
          job.status = 'done';
          job.progress = 1;
          job.endedAt = Date.now();
          job.actual = {
            containerLabel: 'MP4', videoEncoderLabel: 'H.264', audioEncoderLabel: 'AAC',
            width: 1920, height: 1080, fps: 25, durationSec: 142.5,
            bitrate: 2400000, size: 410000000
          };
          emit(job);
        }
      }, TICK_MS);
      return job;
    }),
    listJobs: async () => [...jobs.values()],
    cancelJob: async (id) => {
      const job = jobs.get(id);
      if (!job) return false;
      if (job.status === 'running' || job.status === 'queued' || job.status === 'paused') {
        job.status = 'canceled';
        job.endedAt = Date.now();
        emit(job);
        return true;
      }
      return false;
    },
    pauseJob: async (id) => {
      const job = jobs.get(id);
      if (!job || job.status !== 'running') return false;
      job.status = 'paused';
      job.speed = 0;
      emit(job);
      return true;
    },
    resumeJob: async (id) => {
      const job = jobs.get(id);
      if (!job || job.status !== 'paused') return false;
      job.status = 'running';
      emit(job);
      return true;
    },
    canPauseJobs: async () => true,
    deleteFile: async () => ({ ok: true }),
    retryJob: async (id) => {
      const job = jobs.get(id);
      if (!job) return false;
      job.status = 'queued';
      job.progress = 0;
      job.speed = 0;
      job.error = null;
      job.actual = null;
      job.startedAt = Date.now();
      job.endedAt = 0;
      emit(job);
      // The mock has no queue pump — re-start the simulated encode shortly.
      setTimeout(() => {
        if (job.status !== 'queued') return;
        job.status = 'running';
        emit(job);
        const TICK_MS = 300;
        const INCREMENT = 0.0021 + Math.random() * 0.0008;
        const timer = setInterval(() => {
          if (job.status !== 'running') return;
          job.progress = Math.min(0.999, job.progress + INCREMENT);
          job.speed = 1.2 + Math.random() * 2;
          job.cpuPercent = 560 + Math.floor(Math.random() * 60);
          emit(job);
          if (job.progress >= 0.999) {
            clearInterval(timer);
            job.status = 'done';
            job.progress = 1;
            job.endedAt = Date.now();
            job.actual = {
              containerLabel: 'MP4', videoEncoderLabel: 'H.264', audioEncoderLabel: 'AAC',
              width: 1920, height: 1080, fps: 25, durationSec: 142.5,
              bitrate: 2400000, size: 410000000
            };
            emit(job);
          }
        }, TICK_MS);
      }, 500);
      return true;
    },
    removeJob: async (id) => { jobs.delete(id); listeners.removed.forEach((cb) => cb(id)); return true; },
    revealPath: async () => true,
    openExternal: async (url) => { window.open(url, '_blank'); return true; },
    subtitleConvert: async (filePath) => ({
      outputPath: filePath.replace(/\.[^.]+$/, '.srt'), cueCount: 42, fromFormat: 'vtt', charset: 'utf-8'
    }),
    subtitleShift: async (filePaths) => filePaths.map((p) => ({ input: p, outputPath: p, cueCount: 42 })),
    subtitleReencode: async (filePaths) => filePaths.map((p) => ({ input: p, outputPath: p, fromCharset: 'gbk' })),
    onJobsUpdated: (cb) => { listeners.updated.push(cb); return () => { listeners.updated = listeners.updated.filter((x) => x !== cb); }; },
    onJobsRemoved: (cb) => { listeners.removed.push(cb); return () => { listeners.removed = listeners.removed.filter((x) => x !== cb); }; }
  };
}

export const bridge = real || makeMock();
export const isElectron = Boolean(real);
