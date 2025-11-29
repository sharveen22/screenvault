// main.js
const {
  app,
  BrowserWindow,
  globalShortcut,
  Tray,
  Menu,
  ipcMain,
  nativeImage,
  dialog,
  shell,
  clipboard,
  systemPreferences,
  Notification
} = require('electron');

const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
app.setAppUserModelId('com.screenvault.app.taufiq');

// Global error handlers
process.on('unhandledRejection', (reason, promise) => {
  sendLog(`Unhandled Promise Rejection: ${reason}`, 'error');
  console.error('Unhandled Promise Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  sendLog(`Uncaught Exception: ${error}`, 'error');
  console.error('Uncaught Exception:', error);
});

const { initDatabase, getDatabase, closeDatabase } = require('./database');

let mainWindow;
let tray;
let currentUser = null;
let isCapturing = false;
let isQuitting = false; // Flag to track if app is actually quitting

// Enforce menu bar only mode (hidden from dock) immediately
if (process.platform === 'darwin') {
  try {
    app.setActivationPolicy('accessory');
    app.dock.hide();
    console.log('Activation policy set to accessory and dock hidden');
  } catch (e) {
    console.error('Failed to set activation policy:', e);
  }
}

/* ====================== LOG helper ====================== */
function sendLog(msg, level = 'info') {
  const payload = { ts: new Date().toISOString(), level, msg };
  try {
    if (level === 'error') console.error('[ScreenVault]', payload.ts, level.toUpperCase(), msg);
    else console.log('[ScreenVault]', payload.ts, level.toUpperCase(), msg);
    mainWindow?.webContents?.send?.('shot:log', payload);
  } catch { }
}

/* ====================== Path & utils ====================== */
const which = (cmd) => {
  const bin = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(bin, [cmd], { stdio: 'ignore' });
  return r.status === 0;
};

function ensureDir(p) { try { fs.mkdirSync(p, { recursive: true }); } catch { } }

function screenshotsDir() {
  const dir = path.join(app.getPath('pictures'), 'ScreenVault');
  ensureDir(dir);
  return dir;
}

function timestampName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `screenshot_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}.png`;
}

function saveBufferToFile(buf) {
  const out = path.join(screenshotsDir(), timestampName());
  sendLog(`Saving to ${out} (size=${buf?.length ?? 0} bytes)`);
  fs.writeFileSync(out, buf);
  sendLog(`Saved: ${out}`);
  return out;
}

/** emit event ke renderer: bytes (Uint8Array) + base64 (back-compat) */
function emitScreenshotToRenderer(filePath, bounds) {
  try {
    const buffer = fs.readFileSync(filePath);
    const base64 = Buffer.from(buffer).toString('base64');
    // Kirim bytes juga, agar hook bisa pakai jalur cepat (tanpa base64 decode).
    // Electron akan mengirim Buffer sebagai Uint8Array ke renderer (structured clone).
    mainWindow?.webContents?.send?.('screenshot-captured', {
      bytes: Buffer.from(buffer),
      buffer: base64,
      filename: path.basename(filePath),
      bounds: bounds || null,
      filePath
    });
    sendLog(`Emitted screenshot-captured -> ${filePath}`);
  } catch (e) {
    sendLog(`emitScreenshotToRenderer error: ${e}`, 'error');
  }
}

/* ====================== Window & Tray ====================== */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    skipTaskbar: true, // Help prevent dock icon
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: path.join(__dirname, '../public/icon.png'),
  });

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    const indexPath = path.join(app.getAppPath(), "dist", "index.html");
    console.log("Loading index.html from:", indexPath);
    mainWindow.loadFile(indexPath).catch(err => {
      console.error("Failed to load index.html:", err);
    });
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (process.platform === 'darwin') app.dock.hide();
  });

  mainWindow.on('close', (event) => {
    // On macOS, if not quitting, hide the window instead of closing
    if (process.platform === 'darwin' && !isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
  });
}

function getTrayIconPath() {
  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    return path.join(__dirname, '../public/camera2.png');
  } else {
    return path.join(app.getAppPath(), "dist", "camera2.png");
  }
}

function createTray() {
  const iconPath = getTrayIconPath();
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) trayIcon = nativeImage.createEmpty();
  } catch { trayIcon = nativeImage.createEmpty(); }

  tray = new Tray(trayIcon);
  const menu = Menu.buildFromTemplate([
    { label: 'Open ScreenVault', click: () => !isCapturing && mainWindow?.show() },
    { label: 'Take Screenshot (Ctrl/Cmd+Shift+S)', click: () => takeScreenshotSystem() },
    { type: 'separator' },
    { label: 'Open Screen Recording Settings (macOS)', click: () => openMacScreenSettings() },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuiting = true; app.quit(); } },
  ]);
  tray.setToolTip('ScreenVault - Screenshot Manager');
  tray.setContextMenu(menu);
  tray.on('click', () => { if (!isCapturing && mainWindow) mainWindow.show(); });
}

/* Prevent app window ikut ke-capture (opsional) */
function hideAppWindowForCapture() {
  if (!mainWindow) return;
  try {
    mainWindow._prevAlwaysOnTop = mainWindow.isAlwaysOnTop?.() || false;
    mainWindow.setContentProtection(true);
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
    mainWindow.setFocusable(false);
    if (mainWindow.setVisibleOnAllWorkspaces) {
      mainWindow.setVisibleOnAllWorkspaces(false, { visibleOnFullScreen: false });
    }
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setOpacity(0); // jangan hide, biar overlay OS tetap jalan
  } catch { }
}
function releaseAppWindowAfterCapture() {
  setTimeout(() => {
    if (!mainWindow) return;
    try {
      mainWindow.setContentProtection(false);
      mainWindow.setIgnoreMouseEvents(false);
      mainWindow.setFocusable(true);
      if (typeof mainWindow._prevAlwaysOnTop === 'boolean') {
        mainWindow.setAlwaysOnTop(mainWindow._prevAlwaysOnTop);
        delete mainWindow._prevAlwaysOnTop;
      } else {
        mainWindow.setAlwaysOnTop(false);
      }
      mainWindow.setOpacity(1);
    } catch { }
  }, 120);
}

/* ====================== macOS Permission ====================== */
function openMacScreenSettings() {
  if (process.platform !== 'darwin') return;
  shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
    .then(() => sendLog('Opened macOS Screen Recording settings'))
    .catch((e) => sendLog(`Open settings error: ${e}`, 'error'));
}

// auto-prompt sekali saat launch via hidden window yang memanggil getDisplayMedia()
let hasAutoPrompted = false;
async function autoPromptMacScreenPermissionOnce() {
  if (process.platform !== 'darwin' || hasAutoPrompted) return;
  hasAutoPrompted = true;

  const flagFile = path.join(app.getPath('userData'), 'screen_prompted.flag');
  if (fs.existsSync(flagFile)) return;

  sendLog('Auto-prompt macOS Screen Recording permission (hidden window)…');

  try {
    const promptWin = new BrowserWindow({
      show: false,
      width: 300,
      height: 200,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });

    const html = `<!doctype html><meta charset="utf-8"><script>(async () => { try { const s = await navigator.mediaDevices.getDisplayMedia({video:true, audio:false}); s.getTracks().forEach(t => t.stop()); window.close(); } catch (e) { window.close(); } })();</script>ok`;

    await promptWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

    // Auto close window after 5 seconds to prevent hanging
    setTimeout(() => {
      try {
        if (!promptWin.isDestroyed()) {
          promptWin.close();
        }
      } catch (e) {
        sendLog(`Error closing prompt window: ${e}`, 'error');
      }
    }, 5000);

    try { fs.writeFileSync(flagFile, '1'); } catch { }
  } catch (error) {
    sendLog(`Auto-prompt error: ${error}`, 'error');
  }
}
const USE_TEMPLATE = true; // set false kalau ikon full-color (tidak monochrome)

function loadTrayIconCamera() {
  try {
    const p = path.join(__dirname, '../public', 'camera1.png');
    let img = nativeImage.createFromPath(p);
    if (img.isEmpty()) return nativeImage.createEmpty();

    // Pastikan ada representasi kecil (tray mac biasanya 18pt & 36pt untuk retina)
    const rep18 = img.resize({ width: 18, height: 18, quality: 'best' });
    const rep36 = img.resize({ width: 36, height: 36, quality: 'best' });

    // Buat nativeImage dengan multi-representation
    const multi = nativeImage.createEmpty();
    multi.addRepresentation({ scaleFactor: 1, width: 18, height: 18, buffer: rep18.toPNG() });
    multi.addRepresentation({ scaleFactor: 2, width: 36, height: 36, buffer: rep36.toPNG() });

    // Jika ikonnya monochrome dan ingin auto-tint macOS:
    if (process.platform === 'darwin' && USE_TEMPLATE) {
      multi.setTemplateImage(true);
    }
    return multi;
  } catch {
    return nativeImage.createEmpty();
  }
}
// ... existing code ...

/* ====================== Screenshot Popup ====================== */
let popupWindow = null;
let popupTimeout = null;

function createScreenshotPopup(filePath) {
  if (popupWindow) {
    if (!popupWindow.isDestroyed()) {
      popupWindow.close();
    }
    popupWindow = null;
  }

  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  // Read image to get dimensions
  let w = 1200;
  let h = 800;

  try {
    const img = nativeImage.createFromPath(filePath);
    const size = img.getSize();

    if (size.width > 0 && size.height > 0) {
      // Toolbar needs ~900px minimum to show all tools without wrapping
      const toolbarHeight = 56;
      const minPadding = 40; // Padding for window chrome/dock

      // Calculate max available space
      const maxWidth = screenWidth - minPadding * 2;
      const maxHeight = screenHeight - minPadding * 2;

      // Start with actual image size
      let windowWidth = size.width + minPadding; // Add some side padding
      let windowHeight = size.height + toolbarHeight + minPadding;

      // Scale down if larger than screen
      if (windowWidth > maxWidth || windowHeight > maxHeight) {
        const scaleX = maxWidth / windowWidth;
        const scaleY = maxHeight / windowHeight;
        const scale = Math.min(scaleX, scaleY);

        windowWidth = Math.floor(windowWidth * scale);
        windowHeight = Math.floor(windowHeight * scale);
      }

      // Enforce minimums
      w = Math.max(900, windowWidth);
      h = Math.max(600, windowHeight);

      sendLog(`Screenshot size: ${size.width}x${size.height}, Window size: ${w}x${h}`);
    }
  } catch (e) {
    sendLog(`Error reading image dimensions: ${e}`, 'error');
  }

  popupWindow = new BrowserWindow({
    width: w,
    height: h,
    x: Math.floor((screenWidth - w) / 2),
    y: Math.floor((screenHeight - h) / 2),
    frame: false,
    type: 'panel', // Use panel type for accessory app behavior
    resizable: true,
    alwaysOnTop: false,
    show: false,
    skipTaskbar: true, // Help prevent dock icon on some platforms
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    }
  });

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    popupWindow.loadURL('http://localhost:5173/#editor');
  } else {
    const indexPath = path.join(app.getAppPath(), "dist", "index.html");
    popupWindow.loadFile(indexPath, { hash: 'editor' });
  }

  popupWindow.once('ready-to-show', () => {
    if (!popupWindow.isDestroyed()) {
      popupWindow.show();
      if (process.platform === 'darwin') app.dock.hide();
      // Send init data
      // Note: We use the same channel name but now it's handled by Editor.tsx via preload
      // We need to make sure preload.js exposes 'onInit' or similar, OR we use the existing IPC
      // Let's check preload.js. It doesn't have 'onInit'. We should add it or use a generic listener.
      // Actually, let's just send 'popup:init' and add it to preload.js
      popupWindow.webContents.send('popup:init', filePath);
    }
  });

  popupWindow.on('closed', () => {
    popupWindow = null;
  });
}

// We need a variable to store the last screenshot path for the popup actions
let lastScreenshotPath = null;
let screenshotWasSaved = false; // Track if the screenshot was saved

ipcMain.on('popup:close', () => {
  // Only delete if the screenshot was NOT saved
  if (!screenshotWasSaved && lastScreenshotPath && fs.existsSync(lastScreenshotPath)) {
    try {
      fs.unlinkSync(lastScreenshotPath);
      sendLog(`Deleted abandoned screenshot: ${lastScreenshotPath}`);
    } catch (e) {
      sendLog(`Error deleting abandoned screenshot: ${e}`, 'error');
    }
  }

  // Reset flags
  lastScreenshotPath = null;
  screenshotWasSaved = false;

  if (popupWindow && !popupWindow.isDestroyed()) popupWindow.close();
});

ipcMain.on('popup:copy', () => {
  // Logic handled in renderer or main? 
  // Since we have the file path in main, we can do it here if we track currentScreenshotPath
  // But easier to just re-read file or use clipboard API
  // Actually, we need the current screenshot path.
  // Let's store it temporarily or pass it back.
  // For now, let's assume the popup has the path.
  // Simpler: The popup just sends the signal, main process handles it.
  // We need to track the last screenshot path.
});

ipcMain.on('popup:save', (_event, dataUrl) => {
  if (lastScreenshotPath) {
    try {
      const image = nativeImage.createFromDataURL(dataUrl);
      fs.writeFileSync(lastScreenshotPath, image.toPNG());
      sendLog(`Saved edited screenshot to: ${lastScreenshotPath}`);

      // Mark as saved so it won't be deleted on close
      screenshotWasSaved = true;

      // NOW emit to main window
      emitScreenshotToRenderer(lastScreenshotPath, null);

      // Also notify other windows if needed (redundant if emitScreenshotToRenderer handles it)
      // emitScreenshotToRenderer usually sends to mainWindow.webContents
    } catch (e) {
      sendLog(`Save error: ${e}`, 'error');
    }
  }
});

ipcMain.on('popup:copy-data', (_event, dataUrl) => {
  try {
    const image = nativeImage.createFromDataURL(dataUrl);
    clipboard.writeImage(image);
    sendLog('Copied edited screenshot to clipboard');
  } catch (e) {
    sendLog(`Copy error: ${e}`, 'error');
  }
});

ipcMain.on('popup:copy', () => {
  if (lastScreenshotPath) {
    const image = nativeImage.createFromPath(lastScreenshotPath);
    clipboard.writeImage(image);
    sendLog('Copied screenshot to clipboard via popup');
    // Do NOT close window as per user request
  }
});

ipcMain.on('popup:trash', () => {
  if (lastScreenshotPath) {
    try {
      if (fs.existsSync(lastScreenshotPath)) {
        fs.unlinkSync(lastScreenshotPath);
        sendLog(`Deleted screenshot: ${lastScreenshotPath}`);
      }
    } catch (e) {
      sendLog(`Error deleting screenshot: ${e}`, 'error');
    }
  }
  if (popupWindow && !popupWindow.isDestroyed()) popupWindow.close();
});

ipcMain.on('popup:share', () => {
  if (!lastScreenshotPath) return;

  if (process.platform === 'darwin') {
    // On macOS, we can't easily remove the "Share >" submenu without native modules.
    // However, we can make the menu context-aware.
    const shareMenu = Menu.buildFromTemplate([
      {
        label: 'Share Screenshot',
        role: 'shareMenu',
        sharingItem: {
          filePaths: [lastScreenshotPath]
        }
      }
    ]);
    shareMenu.popup({ window: popupWindow });
  } else {
    shell.showItemInFolder(lastScreenshotPath);
  }
});

ipcMain.on('popup:edit', () => {
  if (mainWindow) {
    mainWindow.show();
    // TODO: Send event to open editor
    // mainWindow.webContents.send('open-editor', lastScreenshotPath);
  }
  if (popupWindow && !popupWindow.isDestroyed()) popupWindow.close();
});

/* ====================== Capture via SYSTEM tools ====================== */
async function takeScreenshotSystem() {
  if (isCapturing) return;
  isCapturing = true;
  hideAppWindowForCapture();

  try {
    const outPath = await captureWithSystem();
    if (outPath) {
      // emitScreenshotToRenderer(outPath, null); // Don't emit yet! Wait for popup action.
      lastScreenshotPath = outPath;
      createScreenshotPopup(outPath); // Show popup
    }
    else sendLog('Capture canceled or failed');
  } catch (e) {
    sendLog(`takeScreenshotSystem error: ${e}`, 'error');
    dialog.showErrorBox('Capture error', String(e));
  } finally {
    isCapturing = false;
    releaseAppWindowAfterCapture();
  }
}

// ... rest of existing code ...

async function captureWithSystem() {
  sendLog(`Capture requested on platform=${process.platform}`);
  if (process.platform === 'darwin') return await macCaptureDualPath();
  if (process.platform === 'win32') return await winCaptureClipboard();
  return await linuxCaptureFile();
}

// macOS: clipboard-first (screencapture -ci), fallback file (screencapture -i -t png tmp)
function macCaptureDualPath() {
  return new Promise((resolve) => {
    sendLog('macOS: starting screencapture -ci (clipboard mode)');
    clipboard.clear();
    const p = spawn('screencapture', ['-ci'], { stdio: 'ignore' });

    p.on('error', (err) => { sendLog(`screencapture spawn error: ${err}`, 'error'); resolve(null); });

    const started = Date.now();
    const timeoutMs = 15000;
    const poll = () => {
      try {
        const img = clipboard.readImage();
        if (img && !img.isEmpty()) {
          const buf = img.toPNG();
          sendLog(`macOS: clipboard image detected (bytes=${buf.length}). Saving...`);
          const out = saveBufferToFile(buf);
          return resolve(out);
        }
      } catch (e) {
        sendLog(`macOS: clipboard read error: ${e}`, 'error');
        return resolve(null);
      }
      if (Date.now() - started > timeoutMs) {
        sendLog('macOS: clipboard timeout, falling back to file mode');
        const tmp = path.join(app.getPath('temp'), `sv_${Date.now()}.png`);
        const args = ['-i', '-x', '-r', '-t', 'png', tmp];
        sendLog(`macOS fallback: screencapture ${args.join(' ')}`);
        const pf = spawn('screencapture', args, { stdio: 'ignore' });
        pf.on('error', (err) => { sendLog(`fallback error: ${err}`, 'error'); resolve(null); });
        pf.on('exit', (code) => {
          sendLog(`fallback exit code=${code}`);
          if (code !== 0) return resolve(null);
          try {
            if (fs.existsSync(tmp) && fs.statSync(tmp).size > 0) {
              const out = path.join(screenshotsDir(), timestampName());
              sendLog(`Fallback: moving ${tmp} -> ${out}`);
              fs.renameSync(tmp, out);
              sendLog(`Saved: ${out}`);
              resolve(out);
            } else {
              sendLog('Fallback: tmp missing or zero size', 'error');
              resolve(null);
            }
          } catch (e) {
            sendLog(`Fallback save error: ${e}`, 'error');
            resolve(null);
          }
        });
        return;
      }
      setTimeout(poll, 120);
    };
    poll();
  });
}

// Windows: SnippingTool /clip → clipboard
function winCaptureClipboard() {
  return new Promise((resolve) => {
    const hasSnip = which('snippingtool');
    sendLog(`Windows capture start (hasSnippingTool=${hasSnip})`);
    const prevImg = clipboard.readImage();
    const prevHash = prevImg && !prevImg.isEmpty()
      ? crypto.createHash('md5').update(prevImg.toPNG()).digest('hex')
      : '';
    clipboard.clear();
    sendLog('Clipboard cleared before snip');

    const child = hasSnip
      ? spawn('snippingtool', ['/clip'], { windowsHide: true, stdio: 'ignore', detached: true })
      : spawn('explorer.exe', ['ms-screenclip:'], { windowsHide: true, stdio: 'ignore', detached: true });

    child.on('error', (err) => { sendLog(`snip spawn error: ${err}`, 'error'); resolve(null); });

    const timeoutMs = 45000;
    const start = Date.now();
    const poll = () => {
      try {
        const img = clipboard.readImage();
        if (img && !img.isEmpty()) {
          const curHash = crypto.createHash('md5').update(img.toPNG()).digest('hex');
          sendLog(`Clipboard image detected (hash=${curHash})`);
          if (!prevHash || curHash !== prevHash) {
            const out = saveBufferToFile(img.toPNG());
            sendLog(`Windows: image saved to ${out}`);
            return resolve(out);
          }
        }
      } catch (e) { sendLog(`Clipboard read error: ${e}`, 'error'); return resolve(null); }
      if (Date.now() - start > timeoutMs) { sendLog('Snip timeout (no image in clipboard)', 'error'); return resolve(null); }
      setTimeout(poll, 150);
    };
    poll();
  });
}

// Linux: gnome-screenshot / spectacle → file
function linuxCaptureFile() {
  return new Promise((resolve) => {
    const hasGnome = which('gnome-screenshot');
    const hasSpectacle = which('spectacle');
    sendLog(`Linux capture (gnome=${hasGnome}, spectacle=${hasSpectacle})`);

    if (!hasGnome && !hasSpectacle) {
      sendLog('No gnome-screenshot/spectacle found', 'error');
      dialog.showErrorBox('Screenshot tool tidak ditemukan', 'Install gnome-screenshot (GNOME) atau spectacle (KDE).');
      return resolve(null);
    }

    const tmp = path.join(app.getPath('temp'), `sv_${Date.now()}.png`);
    const cmd = hasGnome ? 'gnome-screenshot' : 'spectacle';
    const args = hasGnome ? ['-a', '-f', tmp] : ['-r', '-b', '-n', '-o', tmp];
    sendLog(`Spawn ${cmd} ${args.join(' ')}`);

    const p = spawn(cmd, args, { stdio: 'ignore' });
    p.on('error', (err) => { sendLog(`linux tool error: ${err}`, 'error'); resolve(null); });
    p.on('exit', (code) => {
      sendLog(`${cmd} exit code=${code}`);
      if (code !== 0) return resolve(null);
      try {
        if (fs.existsSync(tmp) && fs.statSync(tmp).size > 0) {
          const out = path.join(screenshotsDir(), timestampName());
          sendLog(`Renaming tmp -> ${out}`);
          fs.renameSync(tmp, out);
          sendLog(`Linux: image saved to ${out}`);
          resolve(out);
        } else {
          sendLog('tmp missing or zero size', 'error');
          resolve(null);
        }
      } catch (e) { sendLog(`Save error (Linux): ${e}`, 'error'); resolve(null); }
    });
  });
}

/* ====================== Shortcuts & lifecycle ====================== */
function registerGlobalShortcuts() {
  const ok1 = globalShortcut.register('CommandOrControl+Shift+S', () => takeScreenshotSystem());
  const ok2 = globalShortcut.register('CommandOrControl+Shift+A', () => { if (!isCapturing && mainWindow) mainWindow.show(); });

  if (!ok1) sendLog('Failed to register screenshot shortcut', 'error');
  if (!ok2) sendLog('Failed to register show app shortcut', 'error');
  sendLog('Global shortcuts registered');
}

/* ====================== Permissions Check ====================== */
async function checkPermissions() {
  if (process.platform !== 'darwin') return;

  const status = systemPreferences.getMediaAccessStatus('screen');
  sendLog(`Screen Recording permission status: ${status}`);

  if (status !== 'granted') {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title: 'Permissions Required',
      message: 'ScreenVault needs Screen Recording permission to work.',
      detail: 'Please enable "ScreenVault" in System Settings > Privacy & Security > Screen Recording to capture screenshots and system audio.',
      buttons: ['Open Settings', 'Quit'],
      defaultId: 0,
      cancelId: 1
    });

    if (response === 0) {
      await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
      // We don't quit here, user might grant and come back. 
      // But usually they need to restart the app.
      // Let's show another dialog or just let them restart.
    } else {
      app.quit();
    }
  }
}

app.whenReady().then(async () => {
  await checkPermissions();

  initDatabase();
  // Register local-file protocol for loading images
  const { protocol } = require('electron');
  protocol.registerFileProtocol('local-file', (request, callback) => {
    const url = request.url.replace('local-file://', '');
    try {
      return callback(decodeURIComponent(url));
    } catch (error) {
      console.error('Failed to register protocol', error);
    }
  });

  createWindow();
  createTray();
  registerGlobalShortcuts();

  if (process.platform === 'darwin') {
    try {
      const status = systemPreferences.getMediaAccessStatus?.('screen');
      const exe = app.getPath('exe');
      sendLog(`macOS screen status: ${status || 'unknown'} | exec: ${exe}`);
    } catch (e) { sendLog(`getMediaAccessStatus error: ${e}`, 'error'); }
    setTimeout(async () => {
      try {
        await autoPromptMacScreenPermissionOnce();
      } catch (error) {
        sendLog(`Auto-prompt setup error: ${error}`, 'error');
      }
    }, 800);
  }

  app.on('activate', () => {
    if (process.platform === 'darwin') app.dock.hide();
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Persistent dock hiding loop (hack for stubborn dock icon)
  if (process.platform === 'darwin') {
    setInterval(() => {
      app.dock.hide();
    }, 1000);
  }
});

// Handle app quit properly
app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => { globalShortcut.unregisterAll(); closeDatabase(); });

/* ====================== IPC ====================== */
ipcMain.handle('take-screenshot', async () => { await takeScreenshotSystem(); });

ipcMain.handle('auth:sign-up', async (_e, { email, password }) => {
  try {
    const db = getDatabase();
    const id = crypto.randomUUID();
    const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
    const stmt = db.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)');
    stmt.run(id, email, passwordHash);
    const user = db.prepare('SELECT id, email, plan, storage_used, storage_limit, screenshot_count FROM users WHERE id = ?').get(id);
    currentUser = user;
    return { user, error: null };
  } catch (error) { return { user: null, error: error.message }; }
});
ipcMain.handle('auth:sign-in', async (_e, { email, password }) => {
  try {
    const db = getDatabase();
    const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
    const user = db
      .prepare('SELECT id, email, plan, storage_used, storage_limit, screenshot_count FROM users WHERE email = ? AND password_hash = ?')
      .get(email, passwordHash);
    if (!user) return { user: null, error: 'Invalid email or password' };
    currentUser = user;
    return { user, error: null };
  } catch (error) { return { user: null, error: error.message }; }
});
ipcMain.handle('auth:sign-out', async () => { currentUser = null; return { error: null }; });
ipcMain.handle('auth:get-session', async () => ({ user: currentUser }));

ipcMain.handle('notify', (_evt, payload = {}) => {
  // payload: { id?, title, body, silent?, focus?, openPath?, openUrl?, actions?: [{text, openPath?, openUrl?, channel?}], closeButtonText? }
  const iconPath = path.join(__dirname, '../public/icon.png');
  const icon = nativeImage.createFromPath(iconPath);

  const n = new Notification({
    title: payload.title || 'Notification',
    body: payload.body || '',
    silent: !!payload.silent,
    icon: icon.isEmpty() ? undefined : icon,
    // macOS akan menampilkan tombol action jika ada.
    actions: Array.isArray(payload.actions)
      ? payload.actions.map(a => ({ type: 'button', text: a.text?.toString().slice(0, 40) || 'Open' }))
      : undefined,
    closeButtonText: payload.closeButtonText || 'Close',
  });

  // Klik di notifikasi -> fokus app / buka lokasi/URL bila diminta
  n.on('click', () => {
    if (payload.focus && BrowserWindow.getAllWindows()[0]) {
      const win = BrowserWindow.getAllWindows()[0];
      if (win.isMinimized()) win.restore();
      win.show(); win.focus();
    }
    if (payload.openPath) shell.showItemInFolder(payload.openPath);
    if (payload.openUrl) shell.openExternal(payload.openUrl);
  });

  // Klik pada action button (index sesuai urutan actions)
  n.on('action', (_event, index) => {
    const action = Array.isArray(payload.actions) ? payload.actions[index] : null;
    if (!action) return;
    if (action.openPath) shell.showItemInFolder(action.openPath);
    if (action.openUrl) shell.openExternal(action.openUrl);
    // Kirim balik ke renderer jika ingin ditangani lebih lanjut
    const win = BrowserWindow.getAllWindows()[0];
    if (win && action.channel) {
      win.webContents.send('notification-action', { id: payload.id, index, action });
    }
  });

  n.show();
  return true;
});
ipcMain.handle('db:query', async (_e, { table, operation, data, where }) => {
  try {
    const db = getDatabase();

    if (operation === 'select') {
      let query = `SELECT * FROM ${table}`;
      const params = [];
      if (where) {
        const cond = Object.entries(where).map(([k]) => `${k} = ?`);
        query += ` WHERE ${cond.join(' AND ')}`;
        params.push(...Object.values(where));
      }
      const rows = db.prepare(query).all(...params);
      return {
        data: rows.map(row => ({
          ...row,
          ai_tags: row.ai_tags ? JSON.parse(row.ai_tags) : [],
          custom_tags: row.custom_tags ? JSON.parse(row.custom_tags) : [],
          is_favorite: !!row.is_favorite,
          is_archived: !!row.is_archived,
          onboarding_completed: !!row.onboarding_completed,
        })),
        error: null
      };
    }

    if (operation === 'insert') {
      const cols = Object.keys(data);
      const placeholders = cols.map(() => '?').join(', ');
      const q = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`;

      const d2 = { ...data };
      if (d2.ai_tags) d2.ai_tags = JSON.stringify(d2.ai_tags);
      if (d2.custom_tags) d2.custom_tags = JSON.stringify(d2.custom_tags);
      if (typeof d2.is_favorite === 'boolean') d2.is_favorite = d2.is_favorite ? 1 : 0;
      if (typeof d2.is_archived === 'boolean') d2.is_archived = d2.is_archived ? 1 : 0;

      db.prepare(q).run(...Object.values(d2));
      return { data: { id: data.id }, error: null };
    }

    if (operation === 'update') {
      const set = Object.keys(data).map(k => `${k} = ?`);
      const wh = Object.keys(where).map(k => `${k} = ?`);
      const q = `UPDATE ${table} SET ${set.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE ${wh.join(' AND ')}`;

      const d2 = { ...data };
      if (d2.ai_tags) d2.ai_tags = JSON.stringify(d2.ai_tags);
      if (d2.custom_tags) d2.custom_tags = JSON.stringify(d2.custom_tags);
      if (typeof d2.is_favorite === 'boolean') d2.is_favorite = d2.is_favorite ? 1 : 0;

      db.prepare(q).run(...Object.values(d2), ...Object.values(where));
      return { data: true, error: null };
    }

    if (operation === 'delete') {
      const wh = Object.keys(where).map(k => `${k} = ?`);
      const q = `DELETE FROM ${table} WHERE ${wh.join(' AND ')}`;
      db.prepare(q).run(...Object.values(where));
      return { data: true, error: null };
    }

    return { data: null, error: 'Invalid operation' };
  } catch (error) {
    console.error('Database query error:', error);
    return { data: null, error: error.message };
  }
});

ipcMain.handle('file:read', async (_e, filePath) => {
  try { return { data: fs.readFileSync(filePath).toString('base64'), error: null }; }
  catch (error) { return { data: null, error: error.message }; }
});
ipcMain.handle('file:delete', async (_e, filePath) => new Promise((resolve, reject) => {
  fs.unlink(filePath, (err) => err ? reject(err) : resolve(true));
}));

// (opsional) buka Settings dari renderer
ipcMain.handle('perm:open-mac-screen-settings', async () => {
  openMacScreenSettings();
  return true;
});

// Database API endpoints
ipcMain.handle('db:get-info', async () => {
  try {
    const { getDatabaseInfo } = require('./database');
    return { data: getDatabaseInfo(), error: null };
  } catch (error) {
    return { data: null, error: error.message };
  }
});

ipcMain.handle('db:export', async (_e, exportPath) => {
  try {
    const { exportDatabase } = require('./database');
    const result = exportDatabase(exportPath);
    return { data: result, error: null };
  } catch (error) {
    return { data: null, error: error.message };
  }
});

ipcMain.handle('db:import', async (_e, importPath) => {
  try {
    const { importDatabase } = require('./database');
    importDatabase(importPath);
    return { data: true, error: null };
  } catch (error) {
    return { data: null, error: error.message };
  }
});



/* ====================== Folder Handlers ====================== */
ipcMain.handle('folder:list', async () => {
  try {
    const db = getDatabase();
    // Seed default folders if empty
    const count = db.prepare('SELECT COUNT(*) as count FROM folders').get().count;
    if (count === 0) {
      const defaults = ['General', 'Project A', 'Project B'];
      const insert = db.prepare('INSERT INTO folders (id, name, icon, color) VALUES (?, ?, ?, ?)');
      defaults.forEach((name, i) => {
        const colors = ['#6366f1', '#10b981', '#f59e0b'];
        insert.run(crypto.randomUUID(), name, 'folder', colors[i % colors.length]);
      });
    }

    // Get folders with screenshot counts
    const folders = db.prepare(`
      SELECT f.*, COUNT(s.id) as screenshot_count 
      FROM folders f 
      LEFT JOIN screenshots s ON s.folder_id = f.id 
      GROUP BY f.id
      ORDER BY f.name ASC
    `).all();
    return { data: folders, error: null };
  } catch (e) {
    return { data: null, error: e.message };
  }
});

ipcMain.handle('folder:create', async (_e, name) => {
  try {
    const db = getDatabase();
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO folders (id, name) VALUES (?, ?)').run(id, name);
    return { data: { id, name }, error: null };
  } catch (e) {
    return { data: null, error: e.message };
  }
});

ipcMain.handle('folder:rename', async (_e, { id, name }) => {
  try {
    const db = getDatabase();
    db.prepare('UPDATE folders SET name = ? WHERE id = ?').run(name, id);
    return { data: true, error: null };
  } catch (e) {
    return { data: null, error: e.message };
  }
});

ipcMain.handle('folder:delete', async (_e, id) => {
  try {
    const db = getDatabase();
    db.prepare('DELETE FROM folders WHERE id = ?').run(id);
    return { data: true, error: null };
  } catch (e) {
    return { data: null, error: e.message };
  }
});

ipcMain.handle('screenshot:move', async (_e, { screenshotId, folderId }) => {
  try {
    const db = getDatabase();
    db.prepare('UPDATE screenshots SET folder_id = ? WHERE id = ?').run(folderId, screenshotId);
    return { data: true, error: null };
  } catch (e) {
    return { data: null, error: e.message };
  }
});

ipcMain.handle('db:get-path', async () => {
  try {
    const { getDatabaseInfo } = require('./database');
    const info = getDatabaseInfo();
    return { data: info.path, error: null };
  } catch (error) {
    return { data: null, error: error.message };
  }
});
