// main.js
const { app, BrowserWindow, globalShortcut, Tray, Menu, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { initDatabase, getDatabase, closeDatabase } = require('./database');
const crypto = require('crypto');

let mainWindow;
let tray;
let screenshots;
let currentUser = null;
let isCapturing = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false, // show setelah ready-to-show
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

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

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
  } catch {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open ScreenVault', click: () => !isCapturing && mainWindow && mainWindow.show() },
    { label: 'Take Screenshot (Ctrl+Shift+S)', click: () => takeScreenshot() },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuiting = true; app.quit(); } },
  ]);
  tray.setToolTip('ScreenVault - Screenshot Manager');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (!isCapturing && mainWindow) mainWindow.show();
  });
}
function hideAppWindowForCapture() {
  if (!mainWindow) return;
  try {
    mainWindow._prevAlwaysOnTop = mainWindow.isAlwaysOnTop?.() || false;
    mainWindow.setContentProtection(true);           // cegah isi app ikut ke-capture
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
    mainWindow.setFocusable(false);
    if (mainWindow.setVisibleOnAllWorkspaces) {
      mainWindow.setVisibleOnAllWorkspaces(false, { visibleOnFullScreen: false });
    }
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setOpacity(0);                        // transparan (tidak hide)
    // Jangan panggil mainWindow.hide() / mainWindow.blur()
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
  }, 100);
}
async function initScreenshots() {
  try {
    const Screenshots = require('electron-screenshots');
    const ScreenshotsClass = Screenshots.default || Screenshots;

    screenshots = new ScreenshotsClass({
      singleWindow: false,
      showCrosshair: true,
      showCursor: true,
    });

    screenshots.on('ok', (e, buffer, bounds) => {
      isCapturing = false;
      saveScreenshot(buffer, bounds).finally(() => {
        releaseAppWindowAfterCapture();
      });
    });

    screenshots.on('cancel', () => {
      isCapturing = false;
      releaseAppWindowAfterCapture();
    });

    console.log('Screenshots module initialized successfully');
  } catch (error) {
    console.error('Failed to initialize screenshots:', error);
    console.log('Screenshot functionality will be disabled');
  }
}
async function takeScreenshot() {
  if (!screenshots) {
    console.warn('Screenshots module not initialized');
    return;
  }
  if (isCapturing) return;

  try {
    isCapturing = true;
    hideAppWindowForCapture();

    setTimeout(() => {
      try {
        screenshots.startCapture(); // API paket ini
      } catch (err) {
        console.error('Error starting capture:', err);
        isCapturing = false;
        releaseAppWindowAfterCapture();
      }
    }, 150);
  } catch (error) {
    console.error('Error taking screenshot:', error);
    isCapturing = false;
    releaseAppWindowAfterCapture();
  }
}
async function saveScreenshot(buffer, bounds) {
  try {
    if (!currentUser) {
      console.error('User not logged in');
      return;
    }
    const timestamp = Date.now();
    const filename = `screenshot_${timestamp}.png`;
    const screenshotsDir = path.join(app.getPath('pictures'), 'ScreenVault');
    if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });

    const filePath = path.join(screenshotsDir, filename);
    fs.writeFileSync(filePath, buffer);

    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('screenshot-captured', {
        buffer: Buffer.isBuffer(buffer) ? buffer.toString('base64') : Buffer.from(buffer).toString('base64'),
        filename,
        bounds,
        filePath,
      });
    }

    console.log('Screenshot saved:', filePath);
  } catch (error) {
    console.error('Error saving screenshot:', error);
  }
}
function registerGlobalShortcuts() {
  const screenshotShortcut = globalShortcut.register('CommandOrControl+Shift+S', () => {
    takeScreenshot();
  });

  const showAppShortcut = globalShortcut.register('CommandOrControl+Shift+A', () => {
    if (!isCapturing && mainWindow) mainWindow.show();
  });

  if (!screenshotShortcut) console.error('Failed to register screenshot shortcut');
  if (!showAppShortcut) console.error('Failed to register show app shortcut');

  console.log('Global shortcuts registered:');
  console.log('- Ctrl/Cmd+Shift+S: Take screenshot');
  console.log('- Ctrl/Cmd+Shift+A: Show app');
}

app.whenReady().then(async () => {
  initDatabase();
  createWindow();
  createTray();
  await initScreenshots();
  registerGlobalShortcuts();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  closeDatabase();
});

// IPC
ipcMain.handle('take-screenshot', async () => {
  takeScreenshot();
});

ipcMain.handle('auth:sign-up', async (event, { email, password }) => {
  try {
    const db = getDatabase();
    const id = crypto.randomUUID();
    const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
    const stmt = db.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)');
    stmt.run(id, email, passwordHash);
    const user = db.prepare('SELECT id, email, plan, storage_used, storage_limit, screenshot_count FROM users WHERE id = ?').get(id);
    currentUser = user;
    return { user, error: null };
  } catch (error) {
    return { user: null, error: error.message };
  }
});

ipcMain.handle('auth:sign-in', async (event, { email, password }) => {
  try {
    const db = getDatabase();
    const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
    const user = db
      .prepare('SELECT id, email, plan, storage_used, storage_limit, screenshot_count FROM users WHERE email = ? AND password_hash = ?')
      .get(email, passwordHash);
    if (!user) return { user: null, error: 'Invalid email or password' };
    currentUser = user;
    return { user, error: null };
  } catch (error) {
    return { user: null, error: error.message };
  }
});

ipcMain.handle('auth:sign-out', async () => {
  currentUser = null;
  return { error: null };
});

ipcMain.handle('auth:get-session', async () => {
  return { user: currentUser };
});

ipcMain.handle('db:query', async (event, { table, operation, data, where }) => {
  try {
    const db = getDatabase();

    if (operation === 'select') {
      let query = `SELECT * FROM ${table}`;
      const params = [];
      if (where) {
        const conditions = Object.entries(where).map(([key]) => `${key} = ?`);
        query += ` WHERE ${conditions.join(' AND ')}`;
        params.push(...Object.values(where));
      }
      const stmt = db.prepare(query);
      const rows = stmt.all(...params);

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
      const columns = Object.keys(data);
      const placeholders = columns.map(() => '?').join(', ');
      const query = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;

      const processedData = { ...data };
      if (processedData.ai_tags) processedData.ai_tags = JSON.stringify(processedData.ai_tags);
      if (processedData.custom_tags) processedData.custom_tags = JSON.stringify(processedData.custom_tags);
      if (typeof processedData.is_favorite === 'boolean') processedData.is_favorite = processedData.is_favorite ? 1 : 0;
      if (typeof processedData.is_archived === 'boolean') processedData.is_archived = processedData.is_archived ? 1 : 0;

      const stmt = db.prepare(query);
      stmt.run(...Object.values(processedData));

      return { data: { id: data.id }, error: null };
    }

    if (operation === 'update') {
      const setClauses = Object.keys(data).map(key => `${key} = ?`);
      const whereClause = Object.keys(where).map(key => `${key} = ?`);
      const query = `UPDATE ${table} SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE ${whereClause.join(' AND ')}`;

      const processedData = { ...data };
      if (processedData.ai_tags) processedData.ai_tags = JSON.stringify(processedData.ai_tags);
      if (processedData.custom_tags) processedData.custom_tags = JSON.stringify(processedData.custom_tags);
      if (typeof processedData.is_favorite === 'boolean') processedData.is_favorite = processedData.is_favorite ? 1 : 0;
      if (typeof processedData.is_archived === 'boolean') processedData.is_archived = processedData.is_archived ? 1 : 0;

      const stmt = db.prepare(query);
      stmt.run(...Object.values(processedData), ...Object.values(where));

      return { data: true, error: null };
    }

    if (operation === 'delete') {
      const whereClause = Object.keys(where).map(key => `${key} = ?`);
      const query = `DELETE FROM ${table} WHERE ${whereClause.join(' AND ')}`;
      const stmt = db.prepare(query);
      stmt.run(...Object.values(where));
      return { data: true, error: null };
    }

    return { data: null, error: 'Invalid operation' };
  } catch (error) {
    console.error('Database query error:', error);
    return { data: null, error: error.message };
  }
});

ipcMain.handle('file:read', async (event, filePath) => {
  try {
    const buffer = fs.readFileSync(filePath);
    return { data: buffer.toString('base64'), error: null };
  } catch (error) {
    return { data: null, error: error.message };
  }
});

ipcMain.handle('file:delete', async (event, filePath) => {
  return new Promise((resolve, reject) => {
    fs.unlink(filePath, (err) => {
      if (err) {
        console.error('Failed to delete file:', err);
        reject(err);
      } else {
        resolve(true);
      }
    });
  });
});
