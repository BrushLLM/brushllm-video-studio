// BrushLLM Video Studio — Electron main process.
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, powerSaveBlocker } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { resolveBinaries } = require('./engine/binaries');
const { probe, summarize } = require('./engine/probe');
const { JobManager } = require('./engine/queue');
const { outputExtFor } = require('./engine/commands');
const subs = require('../shared/subtitles');

let mainWindow = null;
let settings = null;
let manager = null;
let gpuEncoders = []; // honestly detected hardware encoders only
let buildPlan = null; // ESM modules, loaded at boot
let resolveEncoding = null;
let applyResolved = null;

const DEFAULT_SETTINGS = {
  language: 'system',
  ffmpegPath: '',
  ffprobePath: '',
  outputDir: '',
  concurrency: 1,
  preventSleep: true
};

const CPU_COUNT = require('node:os').cpus().length;

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8');
    const loaded = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    delete loaded.fullSpeed; // legacy key from the removed full-speed mode
    return loaded;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings() {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), 'utf8');
}

function applyBinaries() {
  const { ffmpeg, ffprobe } = resolveBinaries(settings.ffmpegPath, settings.ffprobePath);
  manager.setBinaries({ ffmpeg, ffprobe });
  return { ffmpeg, ffprobe };
}

// Detect hardware encoders that actually exist in the bundled ffmpeg.
// Only these may be surfaced as "GPU" options in the UI — parsed precisely
// from encoder lines, never by substring guessing.
const KNOWN_GPU_ENCODERS = ['h264_videotoolbox', 'hevc_videotoolbox', 'h264_nvenc', 'hevc_nvenc', 'h264_qsv', 'hevc_qsv', 'h264_amf', 'hevc_amf'];

async function detectGpuEncoders() {
  const { ffmpeg } = applyBinaries();
  return new Promise((resolve) => {
    const child = require('node:child_process').spawn(ffmpeg, ['-hide_banner', '-encoders']);
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('error', () => resolve([]));
    child.on('close', () => {
      // Encoder lines look like: " V....D h264_videotoolbox    VideoToolbox H.264 Encoder (codec h264)"
      const names = new Set();
      for (const line of out.split('\n')) {
        const m = line.match(/^\s*[A-Z.]{4,6}\s+([a-zA-Z0-9_]+)\s+\S/);
        if (m) names.add(m[1]);
      }
      gpuEncoders = KNOWN_GPU_ENCODERS.filter((e) => names.has(e));
      resolve(gpuEncoders);
    });
  });
}

// ------------------------------------------------------------ output paths

const OP_SUFFIX = {
  'video.convert': 'converted',
  'video.compress': 'compressed',
  'video.merge': 'merged',
  'video.trim': 'cut',
  'video.crop': 'cropped',
  'video.scale': 'scaled',
  'video.rotate': 'rotated',
  'video.speed': 'speed',
  'video.mute': 'muted',
  'video.replaceAudio': 'newaudio',
  'video.extractAudio': 'audio',
  'video.extractFrames': 'frames',
  'video.anim': 'anim',
  'video.embedSubs': 'subs',
  'video.burnSubs': 'burned',
  'video.remux': 'remuxed',
  'audio.convert': 'converted',
  'audio.compress': 'compressed',
  'audio.trim': 'cut',
  'audio.extract': 'audio',
  'audio.volume': 'volume',
  'audio.loudnorm': 'normalized',
  'audio.removeTrack': 'noaudio',
  'audio.replaceTrack': 'newaudio',
  'subtitle.extract': 'subs',
  'subtitle.mux': 'subs',
  'subtitle.burn': 'burned'
};

function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const dir = path.dirname(p);
  const ext = path.extname(p);
  const base = path.basename(p, ext);
  for (let i = 1; i < 1000; i++) {
    const candidate = path.join(dir, `${base}-${i}${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return path.join(dir, `${base}-${Date.now()}${ext}`);
}

function resolveOutputPath(op, params, inputPath, summary, outputDirOverride) {
  const baseDir = outputDirOverride || settings.outputDir || path.dirname(inputPath);
  const baseName = path.basename(inputPath, path.extname(inputPath));
  const suffix = OP_SUFFIX[op] || 'out';

  if (op === 'video.extractFrames') {
    const dir = uniquePath(path.join(baseDir, `${baseName}-frames`));
    return path.join(dir, 'frame');
  }
  const ext = outputExtFor(op, params, inputPath, { probe: summary });
  return uniquePath(path.join(baseDir, `${baseName}-${suffix}${ext}`));
}

// ------------------------------------------------------------------- app

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 1000,
    minHeight: 660,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    vibrancy: 'sidebar',
    backgroundColor: '#ffffff',
    title: 'BrushLLM Video Studio',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  const startUrl = process.env.ELECTRON_START_URL;
  if (startUrl) {
    mainWindow.loadURL(startUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // Headless smoke check: BRUSHVS_SMOKE=1 electron . → exercises the preload
  // bridge end-to-end (incl. a REAL ffmpeg job) and exits with a summary.
  if (process.env.BRUSHVS_SMOKE) {
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        const { spawnSync } = require('node:child_process');
        const { ffmpeg } = applyBinaries();
        const smokeDir = path.join(app.getPath('userData'), 'smoke');
        fs.rmSync(smokeDir, { recursive: true, force: true });
        fs.mkdirSync(smokeDir, { recursive: true });
        const testVideo = path.join(smokeDir, 'input.mp4');
        const gen = spawnSync(ffmpeg, ['-hide_banner', '-y',
          '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=10',
          '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
          '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
          '-shortest', testVideo]);
        if (gen.status !== 0) throw new Error(`smoke media generation failed: ${String(gen.stderr || '').slice(-300)}`);

        const r = await mainWindow.webContents.executeJavaScript(`(async () => {
          const b = window.brushvs;
          if (!b) return { ok: false, error: 'preload bridge missing' };
          if (typeof b.pathForFile !== 'function') return { ok: false, error: 'pathForFile missing (drag&drop broken)' };
          const settings = await b.getSettings();
          const info = await b.appInfo();
          const rendered = !!document.querySelector('.sidebar') && !!document.querySelector('.nav');
          // Run one REAL job through the full IPC + queue + ffmpeg path.
          const added = await b.addJobs([{ op: 'video.mute', params: {}, inputs: [${JSON.stringify(testVideo)}] }]);
          const id = added[0].id;
          const deadline = Date.now() + 60000;
          let job = null;
          while (Date.now() < deadline) {
            const jobs = await b.listJobs();
            job = jobs.find((j) => j.id === id);
            if (job && ['done', 'error', 'canceled'].includes(job.status)) break;
            await new Promise((res) => setTimeout(res, 250));
          }
          return {
            ok: rendered && job && job.status === 'done',
            rendered,
            language: settings.language,
            locale: info.locale,
            arch: info.arch,
            gpuEncoders: info.gpuEncoders,
            jobStatus: job ? job.status : 'missing',
            jobError: job && job.error ? job.error : null,
            outputPath: job ? job.outputPath : null,
            actual: job && job.actual ? { size: job.actual.size, durationSec: job.actual.durationSec } : null
          };
        })()`);

        const outputOk = r.outputPath ? fs.existsSync(r.outputPath) : false;
        const ok = Boolean(r.ok) && outputOk;
        console.log('SMOKE', JSON.stringify({ ...r, outputExists: outputOk, ok }));
        app.exit(ok ? 0 : 1);
      } catch (e) {
        console.error('SMOKE FAIL', e && e.message ? e.message : String(e));
        app.exit(1);
      }
    });
  }
}

function buildMenu() {
  const template = [
    { role: 'appMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Semantic version comparison: returns >0 if a > b, 0 if equal, <0 if a < b.
function compareVersions(a, b) {
  const pa = String(a || '').split('.').map(Number);
  const pb = String(b || '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

function broadcast(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

// Prevent system sleep while jobs are in flight (user-toggleable, default on).
// 'prevent-app-suspension' keeps the system awake but lets the display sleep.
let sleepBlockerId = null;

function syncSleepBlocker() {
  const wantBlock = Boolean(settings.preventSleep) && manager && manager.activeCount() > 0;
  if (wantBlock && sleepBlockerId == null) {
    sleepBlockerId = powerSaveBlocker.start('prevent-app-suspension');
  } else if (!wantBlock && sleepBlockerId != null) {
    powerSaveBlocker.stop(sleepBlockerId);
    sleepBlockerId = null;
  }
}

// ------------------------------------------------------------------- ipc

function registerIpc() {
  ipcMain.handle('settings:get', () => settings);
  ipcMain.handle('settings:set', (_e, patch) => {
    settings = { ...settings, ...patch };
    saveSettings();
    applyBinaries();
    manager.setConcurrency(settings.concurrency);
    syncSleepBlocker();
    return settings;
  });

  ipcMain.handle('app:info', () => {
    const { ffmpeg } = applyBinaries();
    return {
      version: app.getVersion(),
      electron: process.versions.electron,
      node: process.versions.node,
      ffmpegPath: ffmpeg,
      locale: app.getLocale(),
      platform: process.platform,
      arch: process.arch,
      cpuCount: CPU_COUNT,
      gpuEncoders,
      userData: app.getPath('userData')
    };
  });

  const FILTERS = {
    media: [
      { name: 'Media', extensions: ['mp4', 'mkv', 'mov', 'avi', 'webm', 'm4v', 'mpg', 'mpeg', 'ts', 'flv', 'wmv', 'mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus', 'wma', 'aiff'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    subtitle: [
      { name: 'Subtitles', extensions: ['srt', 'vtt', 'ass', 'ssa', 'ttml', 'xml', 'dfxp'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    mediaAndSubs: [
      { name: 'Media & Subtitles', extensions: ['mp4', 'mkv', 'mov', 'avi', 'webm', 'm4v', 'mpg', 'mpeg', 'ts', 'flv', 'wmv', 'mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus', 'srt', 'vtt', 'ass', 'ssa', 'ttml', 'xml', 'dfxp'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    audio: [
      { name: 'Audio', extensions: ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus', 'wma', 'aiff', 'mp4', 'mkv', 'mov', 'avi', 'webm'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    any: [{ name: 'All Files', extensions: ['*'] }]
  };

  ipcMain.handle('dialog:openFiles', async (_e, kind) => {
    const r = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: FILTERS[kind] || FILTERS.any
    });
    return r.canceled ? [] : r.filePaths;
  });

  ipcMain.handle('dialog:pickDirectory', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('probe:file', async (_e, filePath) => {
    const { ffprobe } = applyBinaries();
    const raw = await probe(ffprobe, filePath);
    return { raw, summary: summarize(raw) };
  });

  // specs: [{ op, params, inputs, outputDir? }]
  ipcMain.handle('jobs:add', async (_e, specs) => {
    const added = [];
    for (const spec of specs) {
      if (!Array.isArray(spec.inputs) || !spec.inputs.length) continue;
      const { ffprobe } = applyBinaries();
      let summary = {};
      let allProbes = [];
      try {
        allProbes = [];
        for (const input of spec.inputs) {
          allProbes.push(summarize(await probe(ffprobe, input)));
        }
        summary = allProbes[0] || {};
      } catch {
        /* ffmpeg will surface the error */
      }
      const outputPath = resolveOutputPath(spec.op, spec.params, spec.inputs[0], summary, spec.outputDir);

      // Central resolution: the job enters the queue with the SAME effective
      // encoder/quality the plan preview showed (GPU strategy, audio auto-copy,
      // CRF-vs-bitrate). commands.js keeps its own constraints as defense.
      let finalParams = spec.params;
      if (resolveEncoding) {
        const resolved = resolveEncoding(spec.op, spec.params, summary, { gpuEncoders });
        if (resolved.error === 'gpu-unavailable') {
          throw new Error('GPU_UNAVAILABLE');
        }
        finalParams = applyResolved(spec.params, resolved);
      }
      const plan = buildPlan ? buildPlan(spec.op, spec.params, summary, { allProbes, gpuEncoders }) : null;
      const job = await manager.add({
        op: spec.op,
        params: finalParams,
        inputs: spec.inputs,
        outputPath,
        expectedDuration: summary.durationSec || 0,
        plan,
        probes: allProbes
      });
      added.push(job);
    }
    return added;
  });

  ipcMain.handle('jobs:list', () => manager.list());
  ipcMain.handle('jobs:cancel', (_e, id) => manager.cancel(id));
  ipcMain.handle('jobs:retry', (_e, id) => manager.retry(id));
  ipcMain.handle('jobs:remove', (_e, id) => manager.remove(id));
  ipcMain.handle('jobs:pause', (_e, id) => manager.pause(id));
  ipcMain.handle('jobs:resume', (_e, id) => manager.resume(id));
  ipcMain.handle('jobs:canPause', () => manager.constructor.canPause);

  // Delete a job's output file from disk (delete-confirmation dialog).
  ipcMain.handle('files:delete', (_e, filePath) => {
    const p = String(filePath || '');
    if (!p) return { ok: false, error: 'empty path' };
    try {
      if (p.includes('%05d')) {
        // Frame-sequence outputs live in their own generated directory.
        const dir = path.dirname(p);
        if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
        return { ok: true };
      }
      if (fs.existsSync(p)) {
        const stat = fs.statSync(p);
        if (!stat.isFile()) return { ok: false, error: 'not a file' };
        fs.rmSync(p, { force: true });
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('shell:reveal', (_e, p) => {
    const target = String(p).replace(/%05d[^/]*$/, '');
    shell.showItemInFolder(fs.existsSync(target) ? target : path.dirname(target));
  });

  // External links (e.g. brushllm.com, GitHub releases) open in the browser.
  const ALLOWED_EXTERNAL = /^https:\/\/(brushllm\.(com|pages\.dev)|www\.brushllm\.(com|pages\.dev)|github\.com\/BrushLLM\/brushllm-video-studio)(\/|$)/;
  ipcMain.handle('shell:openExternal', (_e, url) => {
    const target = String(url);
    if (!ALLOWED_EXTERNAL.test(target)) return false;
    shell.openExternal(target);
    return true;
  });

  // ---- Update check: queries the GitHub latest release and compares ----
  ipcMain.handle('update:check', async () => {
    const current = app.getVersion();
    try {
      const res = await fetch('https://api.github.com/repos/BrushLLM/brushllm-video-studio/releases/latest', {
        headers: { 'User-Agent': 'BrushLLM-Video-Studio' },
        signal: AbortSignal.timeout(10000)
      });
      if (!res.ok) return { hasUpdate: false, currentVersion: current, error: `HTTP ${res.status}` };
      const release = await res.json();
      const latest = (release.tag_name || '').replace(/^v/, '');
      const hasUpdate = compareVersions(latest, current) > 0;
      return {
        hasUpdate,
        currentVersion: current,
        latestVersion: latest || current,
        releaseUrl: release.html_url || '',
        releaseNotes: (release.body || '').slice(0, 2000)
      };
    } catch (e) {
      return { hasUpdate: false, currentVersion: current, error: e.message || 'network error' };
    }
  });

  // ---- JS-side subtitle operations (instant, no queue) ----
  ipcMain.handle('subtitle:convert', (_e, { filePath, targetFormat }) => {
    const buf = fs.readFileSync(filePath);
    const result = subs.convertBuffer(buf, targetFormat);
    const dir = path.dirname(filePath);
    const base = path.basename(filePath, path.extname(filePath));
    const out = uniquePath(path.join(dir, `${base}${subs.extOfFormat(targetFormat)}`));
    fs.writeFileSync(out, result.buffer);
    return { outputPath: out, cueCount: result.cueCount, fromFormat: result.fromFormat, charset: result.charset };
  });

  ipcMain.handle('subtitle:shift', (_e, { filePaths, offsetMs, inPlace }) => {
    const results = [];
    for (const filePath of filePaths) {
      const buf = fs.readFileSync(filePath);
      const result = subs.shiftBuffer(buf, offsetMs);
      const dir = path.dirname(filePath);
      const ext = path.extname(filePath);
      const base = path.basename(filePath, ext);
      const out = inPlace ? filePath : uniquePath(path.join(dir, `${base}-shifted${ext}`));
      fs.writeFileSync(out, result.buffer);
      results.push({ input: filePath, outputPath: out, cueCount: result.cueCount });
    }
    return results;
  });

  ipcMain.handle('subtitle:reencode', (_e, { filePaths, charset, inPlace }) => {
    const results = [];
    for (const filePath of filePaths) {
      const buf = fs.readFileSync(filePath);
      const result = subs.reencodeBuffer(buf, charset);
      const dir = path.dirname(filePath);
      const ext = path.extname(filePath);
      const base = path.basename(filePath, ext);
      const out = inPlace ? filePath : uniquePath(path.join(dir, `${base}-${charset}${ext}`));
      fs.writeFileSync(out, result.buffer);
      results.push({ input: filePath, outputPath: out, fromCharset: result.fromCharset });
    }
    return results;
  });
}

// ------------------------------------------------------------------ boot

app.whenReady().then(async () => {
  try {
    settings = loadSettings();
    const { ffmpeg, ffprobe } = resolveBinaries(settings.ffmpegPath, settings.ffprobePath);
    manager = new JobManager({ ffmpeg, ffprobe, concurrency: settings.concurrency || 1 });
    manager.on('updated', (job) => { broadcast('jobs:updated', job); syncSleepBlocker(); });
    manager.on('removed', (id) => { broadcast('jobs:removed', id); syncSleepBlocker(); });
    registerIpc();
    buildMenu();
    createWindow();
    // shared/plan.mjs and resolve.mjs are ESM (shared with the renderer); CJS
    // loads them dynamically.
    ({ buildPlan } = await import('../shared/plan.mjs'));
    ({ resolveEncoding, applyResolved } = await import('../shared/resolve.mjs'));
    await detectGpuEncoders();
  } catch (e) {
    const { dialog } = require('electron');
    dialog.showErrorBox('BrushLLM Video Studio', String(e.message || e));
    app.exit(1);
    return;
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
