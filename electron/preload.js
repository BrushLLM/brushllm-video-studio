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
  deleteFile: (filePath) => ipcRenderer.invoke('files:delete', filePath),
  revealPath: (p) => ipcRenderer.invoke('shell:reveal', p),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  subtitleConvert: (filePath, targetFormat) =>
    ipcRenderer.invoke('subtitle:convert', { filePath, targetFormat }),
  subtitleShift: (filePaths, offsetMs, inPlace) =>
    ipcRenderer.invoke('subtitle:shift', { filePaths, offsetMs, inPlace }),
  subtitleReencode: (filePaths, charset, inPlace) =>
    ipcRenderer.invoke('subtitle:reencode', { filePaths, charset, inPlace }),

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
