// BrushLLM Video Studio — Electron main process.
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, powerSaveBlocker } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { resolveBinaries } = require('./engine/binaries');
const { probe, summarize } = require('./engine/probe');
const { JobManager } = require('./engine/queue');
const { outputExtFor } = require('./engine/commands');
const subs = require('../shared/subtitles');
const { DEFAULT_SETTINGS, normalizeSettings, validateEngine, saveSettingsFile } = require('./settings');
const { writeNewFile, replaceWithBackup } = require('./engine/artifacts');

let mainWindow = null;
let settings = null;
let manager = null;
let gpuEncoders = []; // honestly detected hardware encoders only
let buildPlan = null; // ESM modules, loaded at boot
let resolveEncoding = null;
let applyResolved = null;

let assertValidOperation = null;
let supportedGpuEncoders = [];
let engineReady = Promise.resolve();
let settingsUpdate = Promise.resolve();
const probeControllers = new Set();
let quitting = false;
let quitReady = false;

async function probeInput(filePath) {
  if (quitting) throw new Error('The application is shutting down');
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('Invalid input path');
  if (!fs.statSync(filePath).isFile()) throw new Error('Input is not a regular file');
  const controller = new AbortController();
  probeControllers.add(controller);
  try {
    const { ffprobe } = applyBinaries();
    return await probe(ffprobe, filePath, { signal: controller.signal });
  } finally { probeControllers.delete(controller); }
}

const CPU_COUNT = require('node:os').cpus().length;

function settingsPath() {
  const userData = app.getPath('userData');
  const resolved = path.resolve(userData, 'settings.json');
  if (!resolved.startsWith(userData)) throw new Error('Invalid settings path');
  return resolved;
}

function loadSettings() {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8');
    const loaded = normalizeSettings(JSON.parse(raw));
    for (const [key, name] of [['ffmpegPath', 'ffmpeg'], ['ffprobePath', 'ffprobe']]) {
      try { validateEngine(loaded[key], name); } catch { loaded[key] = ''; }
    }
    return loaded;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings() {
  saveSettingsFile(settingsPath(), settings);
}

function applyBinaries() {
  const { ffmpeg, ffprobe } = resolveBinaries(settings.ffmpegPath, settings.ffprobePath);
  manager.setBinaries({ ffmpeg, ffprobe });
  return { ffmpeg, ffprobe };
}

// Detect hardware encoders that actually exist in the bundled ffmpeg.
// Only these may be surfaced as "GPU" options in the UI — parsed precisely
// from encoder lines, never by substring guessing.
async function detectGpuEncoders() {
  const { ffmpeg } = applyBinaries();
  return new Promise((resolve) => {
    const child = require('node:child_process').spawn(ffmpeg, ['-hide_banner', '-encoders'], { windowsHide: true });
    let out = '';
    let failed = false;
    const timer = setTimeout(() => { failed = true; child.kill('SIGKILL'); }, 5000);
    child.stdout.on('data', (d) => { out = (out + d).slice(-1024 * 1024); });
    child.stderr.resume();
    child.on('error', () => { failed = true; });
    child.on('close', (code) => {
      clearTimeout(timer);
      const names = new Set();
      for (const line of out.split('\n')) {
        const m = line.match(/^\s*[A-Z.]{4,6}\s+([a-zA-Z0-9_]+)\s+\S/);
        if (m) names.add(m[1]);
      }
      gpuEncoders = failed || code !== 0 ? [] : supportedGpuEncoders.filter((e) => names.has(e));
      broadcast('engine:updated', { gpuEncoders, ffmpegPath: ffmpeg });
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

function resolveOutputPath(op, params, inputPath, summary, outputDirOverride) {
  const baseDir = outputDirOverride || settings.outputDir || path.dirname(inputPath);
  const baseName = path.basename(inputPath, path.extname(inputPath));
  const suffix = OP_SUFFIX[op] || 'out';

  if (op === 'video.extractFrames') return path.join(baseDir, `${baseName}-frames`);
  const ext = outputExtFor(op, params, inputPath, { probe: summary });
  return path.join(baseDir, `${baseName}-${suffix}${ext}`);
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
    const update = settingsUpdate.then(async () => {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid settings');
      const next = normalizeSettings({ ...settings, ...patch }, { strict: true });
      const changedEngine = next.ffmpegPath !== settings.ffmpegPath || next.ffprobePath !== settings.ffprobePath;
      if (changedEngine && manager.activeCount()) throw new Error('Finish or cancel active jobs before changing the engine');
      validateEngine(next.ffmpegPath, 'ffmpeg');
      validateEngine(next.ffprobePath, 'ffprobe');
      saveSettingsFile(settingsPath(), next);
      settings = next;
      applyBinaries();
      manager.setConcurrency(settings.concurrency);
      syncSleepBlocker();
      if (changedEngine) { engineReady = detectGpuEncoders(); await engineReady; }
      return settings;
    });
    settingsUpdate = update.catch(() => {});
    return update;
  });

  ipcMain.handle('app:info', async () => {
    await engineReady;
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
    await engineReady;
    const raw = await probeInput(filePath);
    return { raw, summary: summarize(raw, filePath) };
  });

  // specs: [{ op, params, inputs, outputDir? }]
  ipcMain.handle('jobs:add', async (_e, specs) => {
    await settingsUpdate;
    await engineReady;
    if (quitting) throw new Error('The application is shutting down');
    if (!Array.isArray(specs) || !specs.length || specs.length > 1000) throw new Error('Invalid job batch');
    const pending = [];
    for (const spec of specs) {
      if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new Error('Invalid job specification');
      if (!Object.hasOwn(OP_SUFFIX, spec.op)) throw new Error('Invalid operation');
      if (!Array.isArray(spec.inputs) || !spec.inputs.length || spec.inputs.length > 100) throw new Error('Invalid inputs');
      if (spec.inputs.some((p) => typeof p !== 'string' || !path.isAbsolute(p) || p.includes('\0'))) throw new Error('Invalid input path');
      if (!spec.params || typeof spec.params !== 'object' || Array.isArray(spec.params)) throw new Error('Invalid params');
      if (spec.outputDir !== undefined && (typeof spec.outputDir !== 'string' || !path.isAbsolute(spec.outputDir) || spec.outputDir.includes('\0'))) throw new Error('Invalid output directory');
      const allProbes = [];
      for (const input of spec.inputs) {
        if (/\.(srt|vtt|ass|ssa|ttml|xml|dfxp)$/i.test(input)) { allProbes.push(null); continue; }
        allProbes.push(summarize(await probeInput(input), input));
      }
      const summary = allProbes[0] || {};
      assertValidOperation(spec.op, spec.params, summary, { allProbes });
      const resolved = resolveEncoding(spec.op, spec.params, summary, { gpuEncoders });
      if (resolved.error) throw new Error(resolved.error);
      const finalParams = applyResolved(spec.params, resolved);
      const outputPath = resolveOutputPath(spec.op, finalParams, spec.inputs[0], summary, spec.outputDir);
      pending.push({ op: spec.op, params: finalParams, requestedParams: spec.params,
        inputs: spec.inputs, outputPath, gpuEncoders: [...gpuEncoders],
        framesDirectory: spec.op === 'video.extractFrames' ? outputPath : undefined,
        plan: buildPlan(spec.op, spec.params, summary, { allProbes, gpuEncoders }) });
    }
    const added = [];
    for (const spec of pending) added.push(await manager.add(spec));
    return added;
  });

  ipcMain.handle('jobs:list', () => manager.list());
  ipcMain.handle('jobs:cancel', (_e, id) => {
    if (typeof id !== 'string') throw new Error('Invalid job id');
    return manager.cancel(id);
  });
  ipcMain.handle('jobs:retry', (_e, id) => {
    if (typeof id !== 'string') throw new Error('Invalid job id');
    return manager.retry(id);
  });
  ipcMain.handle('jobs:remove', (_e, id) => {
    if (typeof id !== 'string') throw new Error('Invalid job id');
    return manager.remove(id);
  });
  ipcMain.handle('jobs:pause', (_e, id) => {
    if (typeof id !== 'string') throw new Error('Invalid job id');
    return manager.pause(id);
  });
  ipcMain.handle('jobs:resume', (_e, id) => {
    if (typeof id !== 'string') throw new Error('Invalid job id');
    return manager.resume(id);
  });
  ipcMain.handle('jobs:canPause', () => manager.constructor.canPause);

  // Delete a job's output file from disk (delete-confirmation dialog).
  ipcMain.handle('files:delete', (_e, jobId) => {
    if (typeof jobId !== 'string') throw new Error('Invalid job id');
    return manager.deleteOutput(jobId);
  });
  ipcMain.handle('shell:reveal', (_e, jobId) => {
    if (typeof jobId !== 'string') throw new Error('Invalid job id');
    const artifact = manager.jobs.get(jobId)?.artifact;
    if (!artifact) return false;
    shell.showItemInFolder(artifact.directory || artifact.outputPath);
    return true;
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
  const subtitlePath = (filePath) => {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || !fs.statSync(filePath).isFile()) throw new Error('Invalid subtitle path');
    return filePath;
  };
  const assertReadableSubtitle = (result) => {
    if (result.ambiguous) {
      const error = new Error('Subtitle encoding is ambiguous; select the source encoding before changing this file.');
      error.code = 'SUBTITLE_CHARSET_AMBIGUOUS';
      throw error;
    }
    if (!(result.cueCount > 0)) throw new Error('No subtitle cues were parsed; the original file was not changed.');
  };
  ipcMain.handle('subtitle:convert', (_e, { filePath, targetFormat, sourceCharset }) => {
    subtitlePath(filePath);
    const buf = fs.readFileSync(filePath);
    const result = subs.convertBuffer(buf, targetFormat, { sourceCharset });
    assertReadableSubtitle(result);
    const base = path.basename(filePath, path.extname(filePath));
    const out = writeNewFile(path.join(path.dirname(filePath), `${base}${subs.extOfFormat(targetFormat)}`), result.buffer);
    return { outputPath: out, cueCount: result.cueCount, fromFormat: result.fromFormat, charset: result.charset };
  });

  ipcMain.handle('subtitle:shift', (_e, { filePaths, offsetMs, inPlace, sourceCharset }) => {
    if (!Array.isArray(filePaths) || !filePaths.length || !Number.isFinite(Number(offsetMs))) throw new Error('Invalid subtitle shift request');
    const results = [];
    for (const selectedPath of filePaths) {
      const filePath = subtitlePath(selectedPath);
      const buf = fs.readFileSync(filePath);
      const result = subs.shiftBuffer(buf, Number(offsetMs), { sourceCharset });
      assertReadableSubtitle(result);
      const ext = path.extname(filePath);
      const base = path.basename(filePath, ext);
      const outputPath = inPlace
        ? replaceWithBackup(filePath, buf, result.buffer).outputPath
        : writeNewFile(path.join(path.dirname(filePath), `${base}-shifted${ext}`), result.buffer);
      results.push({ input: filePath, outputPath, cueCount: result.cueCount });
    }
    return results;
  });

  ipcMain.handle('subtitle:reencode', (_e, { filePaths, charset, inPlace, sourceCharset }) => {
    if (!Array.isArray(filePaths) || !filePaths.length || typeof charset !== 'string') throw new Error('Invalid subtitle encoding request');
    const results = [];
    for (const selectedPath of filePaths) {
      const filePath = subtitlePath(selectedPath);
      const buf = fs.readFileSync(filePath);
      const result = subs.reencodeBuffer(buf, charset, { sourceCharset });
      const decoded = subs.decodeBuffer(buf, { sourceCharset });
      if (decoded.ambiguous) {
        const error = new Error('Subtitle encoding is ambiguous; select the source encoding before changing this file.');
        error.code = 'SUBTITLE_CHARSET_AMBIGUOUS';
        throw error;
      }
      const ext = path.extname(filePath);
      const base = path.basename(filePath, ext);
      const outputPath = inPlace
        ? replaceWithBackup(filePath, buf, result.buffer).outputPath
        : writeNewFile(path.join(path.dirname(filePath), `${base}-${charset}${ext}`), result.buffer);
      results.push({ input: filePath, outputPath, fromCharset: result.fromCharset });
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
    // Resolve shared ESM contracts and hardware support before exposing IPC/UI.
    engineReady = (async () => {
      ({ buildPlan } = await import('../shared/plan.mjs'));
      ({ resolveEncoding, applyResolved, SUPPORTED_GPU_ENCODERS: supportedGpuEncoders } = await import('../shared/resolve.mjs'));
      ({ assertValidOperation } = await import('../shared/validation.mjs'));
      await detectGpuEncoders();
    })();
    await engineReady;
    registerIpc();
    buildMenu();
    createWindow();
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

app.on('before-quit', (event) => {
  if (quitReady || !manager) return;
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  for (const controller of probeControllers) controller.abort();
  manager.shutdown().finally(() => {
    quitReady = true;
    if (sleepBlockerId != null) {
      powerSaveBlocker.stop(sleepBlockerId);
      sleepBlockerId = null;
    }
    app.quit();
  });
});

app.on('window-all-closed', () => {
  // Quit on all platforms — this is a utility app, not a document editor.
  app.quit();
});
