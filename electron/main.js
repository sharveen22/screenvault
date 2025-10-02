const { app, BrowserWindow, globalShortcut, Tray, Menu, ipcMain, nativeImage } = require('electron');
const path = require('path');
const Screenshots = require('electron-screenshots').default;
const fs = require('fs');
const FormData = require('form-data');
const fetch = require('node-fetch');

let mainWindow;
let tray;
let screenshots;

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://aazoimjhpltdbeuvrpmy.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFhem9pbWpocGx0ZGJldXZycG15Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkyOTU5NTksImV4cCI6MjA3NDg3MTk1OX0.SiqqT8SQfW2jj5WrgF15I3DwvhgmPKNsnCKYZW-6I9Y';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
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
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

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
    if (trayIcon.isEmpty()) {
      trayIcon = nativeImage.createEmpty();
    }
  } catch (error) {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open ScreenVault',
      click: () => {
        mainWindow.show();
      },
    },
    {
      label: 'Take Screenshot (Ctrl+Shift+S)',
      click: () => {
        takeScreenshot();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuiting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip('ScreenVault - Screenshot Manager');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    mainWindow.show();
  });
}

function initScreenshots() {
  screenshots = new Screenshots({
    singleWindow: true,
  });

  screenshots.on('ok', (e, buffer, bounds) => {
    saveScreenshot(buffer, bounds);
  });

  screenshots.on('cancel', () => {
    console.log('Screenshot cancelled');
  });
}

async function takeScreenshot() {
  if (screenshots) {
    screenshots.startCapture();
  }
}

async function saveScreenshot(buffer, bounds) {
  try {
    const timestamp = Date.now();
    const filename = `screenshot_${timestamp}.png`;
    const tempPath = path.join(app.getPath('temp'), filename);

    fs.writeFileSync(tempPath, buffer);

    const token = await mainWindow.webContents.executeJavaScript(
      'localStorage.getItem("supabase.auth.token") ? JSON.parse(localStorage.getItem("supabase.auth.token")).access_token : null'
    );

    if (!token) {
      console.error('User not logged in');
      return;
    }

    const fileBuffer = fs.readFileSync(tempPath);
    const blob = new Blob([fileBuffer], { type: 'image/png' });

    mainWindow.webContents.send('screenshot-captured', {
      buffer: buffer.toString('base64'),
      filename,
      bounds,
    });

    console.log('Screenshot saved and sent to app');

    fs.unlinkSync(tempPath);
  } catch (error) {
    console.error('Error saving screenshot:', error);
  }
}

function registerGlobalShortcuts() {
  const screenshotShortcut = globalShortcut.register('CommandOrControl+Shift+S', () => {
    takeScreenshot();
  });

  const showAppShortcut = globalShortcut.register('CommandOrControl+Shift+A', () => {
    mainWindow.show();
  });

  if (!screenshotShortcut) {
    console.error('Failed to register screenshot shortcut');
  }
  if (!showAppShortcut) {
    console.error('Failed to register show app shortcut');
  }

  console.log('Global shortcuts registered:');
  console.log('- Ctrl+Shift+S: Take screenshot');
  console.log('- Ctrl+Shift+A: Show app');
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  initScreenshots();
  registerGlobalShortcuts();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

ipcMain.handle('take-screenshot', async () => {
  takeScreenshot();
});
