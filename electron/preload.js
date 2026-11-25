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
  previewFrame: (filePath) => ipcRenderer.invoke('preview:frame', filePath),

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

  processSubtitles: (batch) => ipcRenderer.invoke('subtitle:process', batch),

  onJobsUpdated: (cb) => {
    const listener = (_e, job) => cb(job);
    ipcRenderer.on('jobs:updated', listener);
    return () => ipcRenderer.removeListener('jobs:updated', listener);
  },
  onEngineUpdated: (cb) => {
    const listener = (_e, info) => cb(info);
    ipcRenderer.on('engine:updated', listener);
    return () => ipcRenderer.removeListener('engine:updated', listener);
  },
  onJobsRemoved: (cb) => {
    const listener = (_e, id) => cb(id);
    ipcRenderer.on('jobs:removed', listener);
    return () => ipcRenderer.removeListener('jobs:removed', listener);
  }
});
