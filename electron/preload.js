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
      } catch {}
      screenshotListeners.delete(handler);
    };
  },

  offScreenshotCaptured: (callback) => {
    // optional explicit off
    for (const h of screenshotListeners) {
      if (h === callback) {
        try { ipcRenderer.removeListener('screenshot-captured', h); } catch {}
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
  // auth / db / file – tetap sama
  auth: {
    signUp: (email, password) => ipcRenderer.invoke('auth:sign-up', { email, password }),
    signIn: (email, password) => ipcRenderer.invoke('auth:sign-in', { email, password }),
    signOut: () => ipcRenderer.invoke('auth:sign-out'),
    getSession: () => ipcRenderer.invoke('auth:get-session'),
  },
  db: {
    query: (params) => ipcRenderer.invoke('db:query', params),
  },
  file: {
    delete: (filePath) => ipcRenderer.invoke('file:delete', filePath),
    read: (filePath) => ipcRenderer.invoke('file:read', filePath),
  },
});
