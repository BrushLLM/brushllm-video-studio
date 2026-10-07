// Secure bridge between renderer and main.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('brushvs', {
  // Electron 32+ removed File.path; this is the only supported way to get
  // an absolute path from a dragged/dropped File object.
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },

  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),

  appInfo: () => ipcRenderer.invoke('app:info'),
  checkForUpdate: () => ipcRenderer.invoke('update:check'),

  openFiles: (kind) => ipcRenderer.invoke('dialog:openFiles', kind),
  pickDirectory: () => ipcRenderer.invoke('dialog:pickDirectory'),

  probeFile: (filePath) => ipcRenderer.invoke('probe:file', filePath),

  addJobs: (specs) => ipcRenderer.invoke('jobs:add', specs),
  listJobs: () => ipcRenderer.invoke('jobs:list'),
  cancelJob: (id) => ipcRenderer.invoke('jobs:cancel', id),
  retryJob: (id) => ipcRenderer.invoke('jobs:retry', id),
  removeJob: (id) => ipcRenderer.invoke('jobs:remove', id),
  pauseJob: (id) => ipcRenderer.invoke('jobs:pause', id),
  resumeJob: (id) => ipcRenderer.invoke('jobs:resume', id),
  canPauseJobs: () => ipcRenderer.invoke('jobs:canPause'),
  deleteFile: (jobId) => ipcRenderer.invoke('files:delete', jobId),
  revealPath: (jobId) => ipcRenderer.invoke('shell:reveal', jobId),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  subtitleConvert: (filePath, targetFormat, sourceCharset) => {
    if (typeof filePath !== 'string' || typeof targetFormat !== 'string') {
      return Promise.reject(new Error('Invalid subtitle convert parameters'));
    }
    return ipcRenderer.invoke('subtitle:convert', { filePath, targetFormat, sourceCharset });
  },
  subtitleShift: (filePaths, offsetMs, inPlace, sourceCharset) => {
    if (!Array.isArray(filePaths) || !Number.isFinite(Number(offsetMs))) {
      return Promise.reject(new Error('Invalid subtitle shift parameters'));
    }
    return ipcRenderer.invoke('subtitle:shift', { filePaths, offsetMs, inPlace, sourceCharset });
  },
  subtitleReencode: (filePaths, charset, inPlace, sourceCharset) => {
    if (!Array.isArray(filePaths) || typeof charset !== 'string') {
      return Promise.reject(new Error('Invalid subtitle reencode parameters'));
    }
    return ipcRenderer.invoke('subtitle:reencode', { filePaths, charset, inPlace, sourceCharset });
  },

  onJobsUpdated: (cb) => {
    const listener = (_e, job) => cb(job);
    ipcRenderer.on('jobs:updated', listener);
    return () => ipcRenderer.removeListener('jobs:updated', listener);
  },
  onJobsRemoved: (cb) => {
    const listener = (_e, id) => cb(id);
    ipcRenderer.on('jobs:removed', listener);
    return () => ipcRenderer.removeListener('jobs:removed', listener);
  }
});
