const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
  sendRegion: (x, y, w, h) => ipcRenderer.send('region-selected', { x, y, w, h }),
  cancel: () => ipcRenderer.send('region-cancelled'),
});
