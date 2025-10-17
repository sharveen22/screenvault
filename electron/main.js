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
app.setAppUserModelId('com.screenvault.app'); 

const { initDatabase, getDatabase, closeDatabase } = require('./database');

let mainWindow;
let tray;
let currentUser = null;
let isCapturing = false;

/* ====================== LOG helper ====================== */
function sendLog(msg, level = 'info') {
  const payload = { ts: new Date().toISOString(), level, msg };
  try {
    if (level === 'error') console.error('[ScreenVault]', payload.ts, level.toUpperCase(), msg);
    else console.log('[ScreenVault]', payload.ts, level.toUpperCase(), msg);
    mainWindow?.webContents?.send?.('shot:log', payload);
  } catch {}
}

/* ====================== Path & utils ====================== */
const which = (cmd) => {
  const bin = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(bin, [cmd], { stdio: 'ignore' });
  return r.status === 0;
};

function ensureDir(p) { try { fs.mkdirSync(p, { recursive: true }); } catch {} }

function screenshotsDir() {
  const dir = path.join(app.getPath('pictures'), 'ScreenVault');
  ensureDir(dir);
  return dir;
}

function timestampName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `screenshot_${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}.png`;
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
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.on('close', (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
  });
}

function createTray() {
  const iconPath = path.join(__dirname, '../public/tray-icon.png');
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
  } catch {}
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
    } catch {}
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

  const promptWin = new BrowserWindow({
    show: false,
    width: 300,
    height: 200,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });

  const html = `
    <!doctype html><meta charset="utf-8">
    <script>
      (async () => {
        try {
          const s = await navigator.mediaDevices.getDisplayMedia({video:true, audio:false});
          s.getTracks().forEach(t => t.stop());
          window.close();
        } catch (e) { window.close(); }
      })();
    </script>ok
  `;
  await promptWin.loadURL('data:text/html,' + encodeURIComponent(html));
  try { fs.writeFileSync(flagFile, '1'); } catch {}
}

/* ====================== Capture via SYSTEM tools ====================== */
async function takeScreenshotSystem() {
  if (isCapturing) return;
  isCapturing = true;
  hideAppWindowForCapture();

  try {
    const outPath = await captureWithSystem();
    if (outPath) emitScreenshotToRenderer(outPath, null);
    else sendLog('Capture canceled or failed');
  } catch (e) {
    sendLog(`takeScreenshotSystem error: ${e}`, 'error');
    dialog.showErrorBox('Capture error', String(e));
  } finally {
    isCapturing = false;
    releaseAppWindowAfterCapture();
  }
}

async function captureWithSystem() {
  sendLog(`Capture requested on platform=${process.platform}`);
  if (process.platform === 'darwin') return await macCaptureDualPath();
  if (process.platform === 'win32')  return await winCaptureClipboard();
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
      dialog.showErrorBox('Screenshot tool tidak ditemukan','Install gnome-screenshot (GNOME) atau spectacle (KDE).');
      return resolve(null);
    }

    const tmp = path.join(app.getPath('temp'), `sv_${Date.now()}.png`);
    const cmd  = hasGnome ? 'gnome-screenshot' : 'spectacle';
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

app.whenReady().then(async () => {
  initDatabase();
  createWindow();
  createTray();
  registerGlobalShortcuts();

  if (process.platform === 'darwin') {
    try {
      const status = systemPreferences.getMediaAccessStatus?.('screen');
      const exe = app.getPath('exe');
      sendLog(`macOS screen status: ${status || 'unknown'} | exec: ${exe}`);
    } catch (e) { sendLog(`getMediaAccessStatus error: ${e}`, 'error'); }
    setTimeout(() => autoPromptMacScreenPermissionOnce(), 800);
  }

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
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
