// BrushLLM Video Studio — Electron main process.
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, powerSaveBlocker, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { resolveBinaries } = require('./engine/binaries');
const { probe, previewFrame, summarize } = require('./engine/probe');
const { JobManager } = require('./engine/queue');
const { outputExtFor } = require('./engine/commands');
const { DEFAULT_SETTINGS, normalizeSettings, validateEngine, saveSettingsFile } = require('./settings');
const { processSubtitleBatch } = require('./engine/subtitle-files');
const { createLimiter } = require('./engine/limit');
const { fileKindOf } = require('../shared/media.cjs');
const PROBE_CONCURRENCY = 4;
const limitProbes = createLimiter(PROBE_CONCURRENCY);

let mainWindow = null;
let settings = null;
let manager = null;
let gpuEncoders = []; // honestly detected hardware encoders only
let buildPlan = null; // ESM modules, loaded at boot
let resolveOperation = null;
let supportedGpuEncoders = [];
let engineReady = Promise.resolve();
let settingsUpdate = Promise.resolve();
const probeControllers = new Set();
let quitting = false;
let quitReady = false;
let preparingBatches = 0;

async function readLocalMedia(filePath, read, signal) {
  if (quitting) throw new Error('The application is shutting down');
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('Invalid input path');
  // A batch tracks one controller for all its probes. Standalone imports own theirs.
  const controller = signal ? null : new AbortController();
  if (controller) probeControllers.add(controller);
  signal ??= controller.signal;
  try {
    return await limitProbes(async () => {
      signal.throwIfAborted();
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) throw new Error('Input is not a regular file');
      return read(filePath, signal);
    });
  } finally {
    if (controller) probeControllers.delete(controller);
  }
}

function probeInput(filePath, ffprobe = manager.ffprobe, signal) {
  return readLocalMedia(filePath, (input, activeSignal) => probe(ffprobe, input, { signal: activeSignal }), signal);
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

function resolveOutputPath(op, params, inputPath, summary, outputDir) {
  const baseDir = outputDir || path.dirname(inputPath);
  const baseName = path.basename(inputPath, path.extname(inputPath));
  const suffix = OP_SUFFIX[op] || 'out';

  if (op === 'video.extractFrames') return path.join(baseDir, `${baseName}-frames`);
  const ext = outputExtFor(op, params, inputPath, { probe: summary });
  return path.join(baseDir, `${baseName}-${suffix}${ext}`);
}

// ------------------------------------------------------------------- app

function createWindow() {
  const windowBackground = () => nativeTheme.shouldUseDarkColors ? '#171c19' : '#f5f4ed';
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 680,
    minHeight: 540,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 15 },
    // Follows the system appearance so a dark-mode launch never flashes white.
    backgroundColor: windowBackground(),
    title: 'BrushLLM Video Studio',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Keep the window background in sync when the system appearance flips.
  const syncWindowBackground = () => {
    mainWindow.setBackgroundColor(windowBackground());
  };
  nativeTheme.on('updated', syncWindowBackground);
  mainWindow.on('closed', () => nativeTheme.off('updated', syncWindowBackground));
  const startUrl = !app.isPackaged && process.env.ELECTRON_START_URL;
  if (startUrl) {
    mainWindow.loadURL(startUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  if (process.env.BRUSHVS_SMOKE) {
    mainWindow.webContents.once('did-finish-load', () => require('./smoke')(mainWindow, manager.ffmpeg));
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
      if (changedEngine && (preparingBatches || manager.activeCount())) throw new Error('Finish or cancel active jobs before changing the engine');
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
    const { ffmpeg, ffprobe } = applyBinaries();
    return {
      version: app.getVersion(),
      electron: process.versions.electron,
      node: process.versions.node,
      ffmpegPath: ffmpeg,
      ffprobePath: ffprobe,
      locale: app.getPreferredSystemLanguages()[0] || app.getLocale(),
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

  ipcMain.handle('preview:frame', async (_e, filePath) => {
    await engineReady;
    const { ffmpeg } = manager;
    return readLocalMedia(filePath, (input, signal) => previewFrame(ffmpeg, input, signal));
  });

  // specs: [{ op, params, inputs, outputDir? }]
  ipcMain.handle('jobs:add', async (_e, specs) => {
    await settingsUpdate;
    await engineReady;
    if (quitting) throw new Error('The application is shutting down');
    if (!Array.isArray(specs) || !specs.length || specs.length > 1000) throw new Error('Invalid job batch');
    for (const spec of specs) {
      if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new Error('Invalid job specification');
      if (!Object.hasOwn(OP_SUFFIX, spec.op)) throw new Error('Invalid operation');
      if (!Array.isArray(spec.inputs) || !spec.inputs.length || spec.inputs.length > 100) throw new Error('Invalid inputs');
      if (spec.inputs.some((p) => typeof p !== 'string' || !path.isAbsolute(p) || p.includes('\0'))) throw new Error('Invalid input path');
      if (!spec.params || typeof spec.params !== 'object' || Array.isArray(spec.params)) throw new Error('Invalid params');
      // null/undefined inherit settings; an empty string explicitly selects the source folder.
      if (spec.outputDir != null && (typeof spec.outputDir !== 'string' || (spec.outputDir !== '' && !path.isAbsolute(spec.outputDir)) || spec.outputDir.includes('\0'))) throw new Error('Invalid output directory');
    }

    const ffprobe = manager.ffprobe;
    const encoders = gpuEncoders;
    const defaultOutput = settings.outputDir;
    const controller = new AbortController();
    const { signal } = controller;
    const summaries = new Map();
    const summarizeInput = (filePath) => {
      if (fileKindOf(filePath) === 'subtitle') return null;
      if (!summaries.has(filePath)) {
        summaries.set(filePath, probeInput(filePath, ffprobe, signal).then((raw) => summarize(raw, filePath)));
      }
      return summaries.get(filePath);
    };
    const prepare = async (spec) => {
      const allProbes = await Promise.all(spec.inputs.map(summarizeInput));
      const source = allProbes[0] || {};
      const resolved = resolveOperation(spec.op, spec.params, source, { allProbes, gpuEncoders: encoders });
      if (resolved.error) throw new Error(resolved.error);
      const outputPath = resolveOutputPath(spec.op, resolved.params, spec.inputs[0], source, spec.outputDir ?? defaultOutput);
      return {
        op: spec.op, params: resolved.params, requestedParams: spec.params,
        inputs: spec.inputs, outputPath, gpuEncoders: encoders,
        framesDirectory: spec.op === 'video.extractFrames' ? outputPath : undefined,
        plan: buildPlan(spec.op, spec.params, source, { allProbes, encoding: resolved.encoding, merge: resolved.merge })
      };
    };

    preparingBatches++;
    probeControllers.add(controller);
    try {
      const pending = [];
      for (let i = 0; i < specs.length; i += PROBE_CONCURRENCY) {
        pending.push(...await Promise.all(specs.slice(i, i + PROBE_CONCURRENCY).map(prepare)));
      }
      const added = [];
      for (const spec of pending) added.push(await manager.add(spec));
      return added;
    } catch (error) {
      controller.abort();
      await Promise.allSettled(summaries.values());
      throw error;
    } finally {
      probeControllers.delete(controller);
      preparingBatches--;
    }
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
  const ALLOWED_EXTERNAL = /^https:\/\/(brushllm\.(com|pages\.dev)|www\.brushllm\.(com|pages\.dev)|github\.com\/BrushLLM\/brushllm-video-studio|ffmpeg\.org|www\.ffmpeg\.org)(\/|$)/;
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

  ipcMain.handle('subtitle:process', (_e, batch) => processSubtitleBatch(batch));
}

// ------------------------------------------------------------------ boot

app.whenReady().then(async () => {
  app.setName(require('../package.json').productName);
  try {
    settings = loadSettings();
    const { ffmpeg, ffprobe } = resolveBinaries(settings.ffmpegPath, settings.ffprobePath);
    manager = new JobManager({ ffmpeg, ffprobe, concurrency: settings.concurrency || 1 });
    manager.on('updated', (job, telemetry) => {
      broadcast('jobs:updated', job);
      if (!telemetry) syncSleepBlocker();
    });
    manager.on('removed', (id) => { broadcast('jobs:removed', id); syncSleepBlocker(); });
    // Resolve shared ESM contracts and hardware support before exposing IPC/UI.
    engineReady = (async () => {
      ({ buildPlan } = await import('../shared/plan.mjs'));
      ({ resolveOperation, SUPPORTED_GPU_ENCODERS: supportedGpuEncoders } = await import('../shared/resolve.mjs'));
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
