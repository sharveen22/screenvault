const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  takeScreenshot: () => ipcRenderer.invoke('take-screenshot'),
  onScreenshotCaptured: (callback) =>
    ipcRenderer.on('screenshot-captured', (_, data) => callback(data)),
  takeScreenshot: () => ipcRenderer.invoke('take-screenshot'),
  Buffer: Buffer,
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
