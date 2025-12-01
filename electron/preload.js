// preload.js
const { contextBridge, ipcRenderer } = require('electron');

let screenshotListeners = new Set();

contextBridge.exposeInMainWorld('electronAPI', {
  takeScreenshot: () => ipcRenderer.invoke('take-screenshot'),

  onScreenshotCaptured: (callback) => {
    if (typeof callback !== 'function') return;
    const handler = (_evt, data) => callback(data);
    screenshotListeners.add(handler);
    ipcRenderer.on('screenshot-captured', handler);
    // return off function
    return () => {
      try {
        ipcRenderer.removeListener('screenshot-captured', handler);
      } catch { }
      screenshotListeners.delete(handler);
    };
  },

  offScreenshotCaptured: (callback) => {
    // optional explicit off
    for (const h of screenshotListeners) {
      if (h === callback) {
        try { ipcRenderer.removeListener('screenshot-captured', h); } catch { }
        screenshotListeners.delete(h);
      }
    }
  },

  onLog: (callback) => {
    const handler = (_evt, payload) => callback?.(payload);
    ipcRenderer.on('shot:log', handler);
    return () => ipcRenderer.off('shot:log', handler);
  },

  openMacScreenSettings: () => ipcRenderer.invoke('perm:open-mac-screen-settings'),
  notify: (payload) => ipcRenderer.invoke('notify', payload),
  onNotificationAction: (cb) => {
    const handler = (_e, data) => cb?.(data);
    ipcRenderer.on('notification-action', handler);
    return () => ipcRenderer.removeListener('notification-action', handler);
  },
  onInit: (callback) => {
    const handler = (_evt, filePath) => callback(filePath);
    ipcRenderer.on('popup:init', handler);
    return () => ipcRenderer.removeListener('popup:init', handler);
  },
  copy: () => ipcRenderer.send('popup:copy'),
  copyData: (dataUrl) => ipcRenderer.send('popup:copy-data', dataUrl),
  save: (dataUrl) => ipcRenderer.send('popup:save', dataUrl),
  trash: () => ipcRenderer.send('popup:trash'),
  share: (dataUrl) => ipcRenderer.send('popup:share', dataUrl),
  close: () => ipcRenderer.send('popup:close'),

  // auth / db / file – tetap sama
  auth: {
    signUp: (email, password) => ipcRenderer.invoke('auth:sign-up', { email, password }),
    signIn: (email, password) => ipcRenderer.invoke('auth:sign-in', { email, password }),
    signOut: () => ipcRenderer.invoke('auth:sign-out'),
    getSession: () => ipcRenderer.invoke('auth:get-session'),
  },
  db: {
    query: (params) => ipcRenderer.invoke('db:query', params),
    getInfo: () => ipcRenderer.invoke('db:get-info'),
    export: (exportPath) => ipcRenderer.invoke('db:export', exportPath),
    import: (importPath) => ipcRenderer.invoke('db:import', importPath),
    getPath: () => ipcRenderer.invoke('db:get-path'),
  },
  folder: {
    list: () => ipcRenderer.invoke('folder:list'),
    create: (name) => ipcRenderer.invoke('folder:create', name),
    rename: (id, name) => ipcRenderer.invoke('folder:rename', { id, name }),
    delete: (id) => ipcRenderer.invoke('folder:delete', id),
    moveScreenshot: (screenshotId, folderId) => ipcRenderer.invoke('screenshot:move', { screenshotId, folderId }),
  },
  file: {
    delete: (filePath) => ipcRenderer.invoke('file:delete', filePath),
    read: (filePath) => ipcRenderer.invoke('file:read', filePath),
    reveal: (filePath) => ipcRenderer.invoke('file:reveal', filePath),
    share: (filePath) => ipcRenderer.invoke('file:share', filePath),
  },
});
