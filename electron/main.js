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
const Tesseract = require('tesseract.js');
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

/* ====================== LRU CACHE ====================== */
// Simple LRU Cache for file reads (50MB limit for instant re-renders)
class LRUCache {
  constructor(maxSize = 50 * 1024 * 1024) { // 50MB default
    this.cache = new Map();
    this.maxSize = maxSize;
    this.currentSize = 0;
  }

  get(key) {
    if (!this.cache.has(key)) return null;

    // Move to end (most recently used)
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);

    return value.data;
  }

  set(key, data) {
    const size = Buffer.byteLength(data);

    // Remove existing key if present
    if (this.cache.has(key)) {
      const oldValue = this.cache.get(key);
      this.currentSize -= oldValue.size;
      this.cache.delete(key);
    }

    // Evict oldest entries until we have space
    while (this.currentSize + size > this.maxSize && this.cache.size > 0) {
      const firstKey = this.cache.keys().next().value;
      const firstValue = this.cache.get(firstKey);
      this.currentSize -= firstValue.size;
      this.cache.delete(firstKey);
      console.log(`[Cache] Evicted: ${firstKey} (${(firstValue.size / 1024).toFixed(1)}KB)`);
    }

    // Add new entry
    if (size <= this.maxSize) {
      this.cache.set(key, { data, size });
      this.currentSize += size;
      console.log(`[Cache] Cached: ${key} (${(size / 1024).toFixed(1)}KB, total: ${(this.currentSize / 1024 / 1024).toFixed(1)}MB)`);
    }
  }

  invalidate(key) {
    if (this.cache.has(key)) {
      const value = this.cache.get(key);
      this.currentSize -= value.size;
      this.cache.delete(key);
      console.log(`[Cache] Invalidated: ${key}`);
    }
  }

  clear() {
    this.cache.clear();
    this.currentSize = 0;
    console.log('[Cache] Cleared all entries');
  }

  getStats() {
    return {
      entries: this.cache.size,
      sizeBytes: this.currentSize,
      sizeMB: (this.currentSize / 1024 / 1024).toFixed(2),
      maxSizeMB: (this.maxSize / 1024 / 1024).toFixed(2)
    };
  }
}

// Create global file cache
const fileCache = new LRUCache(50 * 1024 * 1024); // 50MB

/* ====================== LOG helper ====================== */
function sendLog(msg, level = 'info') {
  const payload = { ts: new Date().toISOString(), level, msg };
  try {
    if (level === 'error') console.error('[ScreenVault]', payload.ts, level.toUpperCase(), msg);
    else console.log('[ScreenVault]', payload.ts, level.toUpperCase(), msg);
    // Only send to renderer if window exists and is not destroyed
    try {
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
        mainWindow.webContents.send('shot:log', payload);
      }
    } catch { }
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

function thumbnailsDir() {
  const dir = path.join(screenshotsDir(), '.thumbnails');
  ensureDir(dir);
  return dir;
}

function getThumbnailPath(originalPath) {
  const fileName = path.basename(originalPath);
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  return path.join(thumbnailsDir(), `${base}_thumb.jpg`);
}

// Generate thumbnail for an image (300x200)
function generateThumbnail(imagePath) {
  try {
    const thumbnailPath = getThumbnailPath(imagePath);

    // Skip if thumbnail already exists
    if (fs.existsSync(thumbnailPath)) {
      return thumbnailPath;
    }

    // Load image and resize
    const img = nativeImage.createFromPath(imagePath);
    if (img.isEmpty()) {
      console.error('[Thumbnail] Failed to load image:', imagePath);
      return null;
    }

    // Resize to 300px width, maintain aspect ratio
    const size = img.getSize();
    const targetWidth = 300;
    const targetHeight = Math.round((size.height / size.width) * targetWidth);

    const resized = img.resize({
      width: targetWidth,
      height: targetHeight,
      quality: 'good'
    });

    // Save as JPEG with 80% quality
    const jpegData = resized.toJPEG(80);
    fs.writeFileSync(thumbnailPath, jpegData);

    console.log(`[Thumbnail] Generated: ${thumbnailPath} (${jpegData.length} bytes)`);
    return thumbnailPath;
  } catch (error) {
    console.error('[Thumbnail] Generation failed:', error);
    return null;
  }
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
      webSecurity: false, // Allow file:// protocol for drag and drop
    },
    icon: path.join(__dirname, '../public/icon.png'),
  });

  // Protect window content from being captured in screenshots
  mainWindow.setContentProtection(true);

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
    // Show window on first launch, dock is already hidden so this won't cause focus issues
    if (process.platform === 'darwin') app.dock.show();
    mainWindow.show();
  });

  // Send focus event to renderer when window gains focus (for auto-refresh)
  mainWindow.on('focus', () => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
      mainWindow.webContents.send('window-focus');
    }
  });

  // Also send when window is shown
  mainWindow.on('show', () => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
      mainWindow.webContents.send('window-focus');
    }
  });

  mainWindow.on('close', (event) => {
    // On macOS, if not quitting, hide the window instead of closing
    if (process.platform === 'darwin' && !isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      // Hide dock icon when window is hidden - back to tray-only mode
      app.dock.hide();
    }
    return false;
  });
}

function getTrayIconPath() {
  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    return path.join(__dirname, '../public/TrayIconTemplate.png');
  } else {
    return path.join(app.getAppPath(), "dist", "TrayIconTemplate.png");
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
    { label: 'Open ScreenVault', click: () => { 
      if (!isCapturing && mainWindow) {
        if (process.platform === 'darwin') app.dock.show();
        mainWindow.show();
      }
    }},
    { label: 'Take Screenshot (Ctrl/Cmd+Shift+S)', click: () => takeScreenshotSystem() },
    { type: 'separator' },
    { label: 'Open Screen Recording Settings (macOS)', click: () => openMacScreenSettings() },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuiting = true; app.quit(); } },
  ]);
  tray.setToolTip('ScreenVault - Screenshot Manager');
  tray.setContextMenu(menu);
  tray.on('click', () => { 
    if (!isCapturing && mainWindow) {
      if (process.platform === 'darwin') app.dock.show();
      mainWindow.show();
    }
  });
}

/* Window content protection is now set permanently in createWindow() */

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
    const p = path.join(__dirname, '../public', 'TrayIconTemplate.png');
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
let thumbnailWindow = null;

// Apple-style thumbnail preview in bottom-left corner
function createThumbnailPreview(filePath) {
  // Close existing thumbnail if any
  if (thumbnailWindow && !thumbnailWindow.isDestroyed()) {
    thumbnailWindow.close();
  }
  thumbnailWindow = null;

  // Clear existing timeout
  if (popupTimeout) {
    clearTimeout(popupTimeout);
    popupTimeout = null;
  }

  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  // Thumbnail size (Apple-style small preview)
  const thumbWidth = 180;
  const thumbHeight = 120;
  const padding = 20;

  // Position in bottom-left corner (like macOS)
  const x = padding;
  const y = screenHeight - thumbHeight - padding;

  thumbnailWindow = new BrowserWindow({
    width: thumbWidth,
    height: thumbHeight,
    x: x,
    y: y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: true,
    skipTaskbar: true,
    hasShadow: true,
    show: false,
    focusable: false, // Don't steal focus
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  // Create simple HTML for thumbnail with click handler
  const img = nativeImage.createFromPath(filePath);
  const dataUrl = img.toDataURL();
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body {
          width: 100%;
          height: 100%;
          overflow: hidden;
          background: transparent;
        }
        body {
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }
        .thumbnail {
          width: 100%;
          height: 100%;
          border-radius: 10px;
          overflow: hidden;
          box-shadow: 0 10px 40px rgba(22, 20, 25, 0.35);
          background: #e9e6e4;
          border: 1px solid #94918f;
          transition: transform 0.15s ease, box-shadow 0.15s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 6px;
          position: relative;
        }
        .thumbnail:hover {
          transform: scale(1.05);
          box-shadow: 0 15px 50px rgba(22, 20, 25, 0.45);
        }
        img {
          max-width: 100%;
          max-height: 100%;
          object-fit: contain;
          border-radius: 4px;
          box-shadow: 0 2px 8px rgba(22, 20, 25, 0.15);
        }
        .progress-bar {
          position: absolute;
          bottom: 0;
          left: 0;
          height: 3px;
          background: #161419;
          border-radius: 0 0 10px 10px;
          animation: shrink 6s linear forwards;
        }
        @keyframes shrink {
          from { width: 100%; }
          to { width: 0%; }
        }
      </style>
    </head>
    <body>
      <div class="thumbnail">
        <img src="${dataUrl}" alt="Screenshot" />
        <div class="progress-bar"></div>
      </div>
    </body>
    </html>
  `;

  thumbnailWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  
  // Handle click - use will-navigate trick
  thumbnailWindow.webContents.on('did-finish-load', () => {
    thumbnailWindow.webContents.executeJavaScript(`
      document.body.addEventListener('click', function() {
        window.location.href = 'thumbnail-click://open';
      });
    `);
  });
  
  // Intercept navigation to detect click
  thumbnailWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('thumbnail-click://')) {
      event.preventDefault();
      handleThumbnailClick(filePath);
    }
  });

  thumbnailWindow.once('ready-to-show', () => {
    if (!thumbnailWindow.isDestroyed()) {
      // Use showInactive() to prevent app activation - keeps app in background
      thumbnailWindow.showInactive();
      sendLog('Thumbnail preview shown (inactive)');
      
      // Auto-dismiss and save after 6 seconds
      popupTimeout = setTimeout(() => {
        sendLog('Thumbnail timeout - auto-saving screenshot');
        if (thumbnailWindow && !thumbnailWindow.isDestroyed()) {
          thumbnailWindow.close();
          thumbnailWindow = null;
        }
        popupTimeout = null;
        
        // Auto-save the screenshot to database
        const savedId = saveScreenshotToDatabase(lastScreenshotPath);
        
        if (savedId) {
          // Notify main window to refresh gallery
          if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
            sendLog('Sending screenshot-saved event to main window');
            mainWindow.webContents.send('screenshot-saved', { id: savedId });
            
            // DON'T reload immediately - let OCR complete first
            // The renderer will refresh after OCR is done
          }
        }
      }, 6000);
    }
  });

  thumbnailWindow.on('closed', () => {
    if (popupTimeout) {
      clearTimeout(popupTimeout);
      popupTimeout = null;
    }
    thumbnailWindow = null;
  });
}

// Handle thumbnail click - open editor popup
function handleThumbnailClick(filePath) {
  sendLog('Thumbnail clicked - opening editor');
  
  // Clear the auto-dismiss timeout
  if (popupTimeout) {
    clearTimeout(popupTimeout);
    popupTimeout = null;
  }
  
  // Close thumbnail
  if (thumbnailWindow && !thumbnailWindow.isDestroyed()) {
    thumbnailWindow.close();
    thumbnailWindow = null;
  }
  
  // Open editor popup (don't save yet - wait for user to click Done)
  lastScreenshotPath = filePath;
  screenshotWasSaved = false;
  createScreenshotPopup(filePath);
}

// Save screenshot directly to database
function saveScreenshotToDatabase(filePath) {
  console.log(`[SaveDB] Saving screenshot: ${filePath}`);
  
  try {
    const db = getDatabase();
    
    // Check if file is already in database (prevent duplicates)
    const existing = db.prepare('SELECT id, ocr_text FROM screenshots WHERE storage_path = ?').get(filePath);
    if (existing) {
      console.log(`[SaveDB] Screenshot already in database: ${filePath}`);
      // Run OCR if it hasn't been processed yet
      if (!existing.ocr_text || existing.ocr_text === '') {
        console.log(`[SaveDB] Running OCR for existing screenshot: ${existing.id}`);
        runOCRInMainProcess(existing.id, filePath);
      }
      return existing.id;
    }
    
    const stats = fs.statSync(filePath);
    const id = crypto.randomUUID();
    const fileName = path.basename(filePath);
    
    // Get image dimensions
    const img = nativeImage.createFromPath(filePath);
    const size = img.getSize();
    
    const stmt = db.prepare(`
      INSERT INTO screenshots (
        id, file_name, file_size, file_type, width, height, 
        storage_path, source, ocr_text, ocr_confidence, 
        custom_tags, ai_tags, user_notes, is_favorite, is_archived,
        thumbnail_path, ai_description, folder_id, view_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      id,
      fileName,
      stats.size,
      'image/png',
      size.width || 0,
      size.height || 0,
      filePath,
      'desktop',
      '',           // ocr_text
      null,         // ocr_confidence
      '[]',         // custom_tags
      '[]',         // ai_tags
      '',           // user_notes
      0,            // is_favorite
      0,            // is_archived
      null,         // thumbnail_path
      null,         // ai_description
      null,         // folder_id
      0             // view_count
    );
    
    console.log(`[SaveDB] Screenshot saved to database: ${id} - ${fileName}`);

    // Generate thumbnail in background (don't block)
    setTimeout(() => {
      const thumbPath = generateThumbnail(filePath);
      if (thumbPath) {
        try {
          db.prepare('UPDATE screenshots SET thumbnail_path = ? WHERE id = ?').run(thumbPath, id);
          console.log(`[SaveDB] Thumbnail generated and saved: ${thumbPath}`);
        } catch (err) {
          console.error(`[SaveDB] Failed to update thumbnail_path:`, err);
        }
      }
    }, 0);

    // Trigger OCR processing in main process (runs in background)
    console.log(`[SaveDB] Starting OCR for ${id}`);
    runOCRInMainProcess(id, filePath);

    return id;
  } catch (e) {
    console.error(`[SaveDB] Error: ${e}`);
    return null;
  }
}

// Generate smart filename from OCR text
function generateSmartFilename(ocrText, originalName) {
  if (!ocrText || !ocrText.trim()) return originalName;
  
  // Extract first meaningful line/phrase (up to 50 chars)
  const lines = ocrText.split('\n').filter(l => l.trim().length > 3);
  let smartPart = (lines[0] || '').trim().slice(0, 50);
  
  // Clean up: remove special chars, replace spaces with underscores
  smartPart = smartPart
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
  
  if (!smartPart || smartPart.length < 3) return originalName;
  
  // Get extension from original
  const ext = path.extname(originalName) || '.png';
  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  
  return `${smartPart}_${timestamp}${ext}`;
}

// Generate tags from OCR text with smart keyword extraction
function generateTags(ocrText) {
  if (!ocrText || !ocrText.trim()) return [];

  const categoryTags = [];
  const keywordTags = [];
  const lowerText = ocrText.toLowerCase();

  // Phase 1: Pattern-based category detection (PRIORITY)
  // Error/Status patterns
  if (/error|exception|failed|failure|crash|bug|issue/i.test(lowerText)) categoryTags.push('error');
  if (/warning|warn|caution|alert/i.test(lowerText)) categoryTags.push('warning');
  if (/success|completed|done|passed|approved|confirmed/i.test(lowerText)) categoryTags.push('success');

  // Development/Code patterns
  if (/function|const|let|var|import|export|class|def |return|async|await|=>|interface|type /i.test(lowerText)) categoryTags.push('code');
  if (/console|terminal|bash|shell|command|npm|yarn|git|brew|sudo/i.test(lowerText)) categoryTags.push('terminal');
  if (/debug|log|trace|stack|breakpoint/i.test(lowerText)) categoryTags.push('debug');
  if (/test|spec|jest|mocha|cypress|unit test|integration/i.test(lowerText)) categoryTags.push('testing');
  if (/api|endpoint|request|response|json|xml|rest|graphql/i.test(lowerText)) categoryTags.push('api');
  if (/database|sql|query|table|mongodb|postgres|mysql|redis/i.test(lowerText)) categoryTags.push('database');

  // Web/URL patterns
  if (/http|https|www\.|\.com|\.org|\.io|\.dev|\.app|localhost|127\.0\.0\.1/i.test(lowerText)) categoryTags.push('web');
  if (/login|signin|signup|password|auth|account|authentication|oauth/i.test(lowerText)) categoryTags.push('auth');
  if (/dashboard|admin|panel|analytics|metrics/i.test(lowerText)) categoryTags.push('dashboard');

  // Communication patterns
  if (/@|email|inbox|gmail|outlook|mail|mailto/i.test(lowerText)) categoryTags.push('email');
  if (/chat|message|slack|discord|teams|conversation|whatsapp/i.test(lowerText)) categoryTags.push('chat');
  if (/notification|notify|alert|reminder|push/i.test(lowerText)) categoryTags.push('notification');

  // Document/Content patterns
  if (/document|doc|pdf|file|folder|directory|upload|download/i.test(lowerText)) categoryTags.push('document');
  if (/video|youtube|vimeo|mp4|stream|watch|play/i.test(lowerText)) categoryTags.push('video');
  if (/table|spreadsheet|excel|csv|data|rows|columns/i.test(lowerText)) categoryTags.push('data');

  // UI/Design patterns
  if (/button|click|menu|dropdown|modal|popup|dialog|tooltip/i.test(lowerText)) categoryTags.push('ui');
  if (/design|figma|sketch|adobe|photoshop|canva|prototype/i.test(lowerText)) categoryTags.push('design');
  if (/settings|preferences|config|options|setup|configuration/i.test(lowerText)) categoryTags.push('settings');

  // Business/Finance patterns
  if (/\$|price|cost|payment|invoice|billing|subscription|paypal|stripe/i.test(lowerText)) categoryTags.push('finance');
  if (/order|cart|checkout|purchase|buy|shop|ecommerce/i.test(lowerText)) categoryTags.push('shopping');

  // Social/Platform patterns
  if (/github|gitlab|bitbucket|repo|repository|commit|pull|merge|branch/i.test(lowerText)) categoryTags.push('github');
  if (/twitter|tweet|facebook|instagram|linkedin|social media/i.test(lowerText)) categoryTags.push('social');
  if (/google|chrome|safari|firefox|edge|browser/i.test(lowerText)) categoryTags.push('browser');
  if (/vscode|visual studio|intellij|xcode|editor|ide|sublime/i.test(lowerText)) categoryTags.push('editor');

  // Phase 2: Smart keyword extraction (SECONDARY - only if we have space)
  // Expanded noise words list
  const noiseWords = new Set([
    'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
    'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
    'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
    'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their',
    'what', 'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go',
    'when', 'make', 'can', 'like', 'time', 'no', 'just', 'him', 'know',
    'take', 'people', 'into', 'year', 'your', 'good', 'some', 'could',
    'them', 'see', 'other', 'than', 'then', 'now', 'look', 'only', 'come',
    'its', 'over', 'think', 'also', 'back', 'after', 'use', 'two', 'how',
    'our', 'work', 'first', 'well', 'way', 'even', 'new', 'want', 'because',
    'any', 'these', 'give', 'day', 'most', 'us', 'is', 'was', 'are', 'been',
    'has', 'had', 'were', 'said', 'did', 'having', 'may', 'should', 'am'
  ]);

  // Extract meaningful words (nouns, verbs, adjectives)
  const words = lowerText
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4 && !noiseWords.has(w)); // Increased min length to 4

  // Calculate word frequency
  const wordFreq = new Map();
  words.forEach(word => {
    wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
  });

  // Sort by frequency and uniqueness (prefer words that appear 2-3 times, not too common)
  const sortedWords = Array.from(wordFreq.entries())
    .filter(([word, count]) => count >= 1 && count <= 5) // Not too rare, not too common
    .sort((a, b) => b[1] - a[1])
    .map(([word]) => word);

  // Add top keywords
  keywordTags.push(...sortedWords.slice(0, 3));

  // Phase 3: Extract capitalized words (app/product names) if needed
  if (categoryTags.length === 0 && keywordTags.length === 0) {
    const capitalizedWords = ocrText.match(/\b[A-Z][a-z]{2,}\b/g) || [];
    const uniqueCapitalized = [...new Set(capitalizedWords)]
      .filter(word => word.length >= 3 && word.length <= 15)
      .slice(0, 3)
      .map(w => w.toLowerCase());
    keywordTags.push(...uniqueCapitalized);
  }

  // Combine: Category tags first (priority), then keyword tags (fill remaining slots)
  const finalTags = [
    ...new Set(categoryTags), // Remove duplicates from categories
    ...keywordTags.filter(kw => !categoryTags.includes(kw)) // Add keywords not already in categories
  ];

  return finalTags.slice(0, 8);
}

// Run OCR in main process (background, doesn't require window)
async function runOCRInMainProcess(screenshotId, filePath) {
  console.log(`[OCR-Main] Starting OCR for ${screenshotId}: ${filePath}`);
  
  try {
    // Verify file exists
    if (!fs.existsSync(filePath)) {
      console.error(`[OCR-Main] File not found: ${filePath}`);
      notifyRendererOCRComplete(screenshotId, null, []);
      return;
    }
    
    console.log(`[OCR-Main] File exists, starting Tesseract...`);

    // Use simpler recognize API
    const result = await Tesseract.recognize(filePath, 'eng', {
      logger: m => {
        if (m.status === 'recognizing text' && m.progress) {
          console.log(`[OCR-Main] Progress: ${Math.round(m.progress * 100)}%`);
        }
      }
    });

    const ocrText = result.data.text || '';
    const ocrConf = result.data.confidence || null;

    console.log(`[OCR-Main] Extracted ${ocrText.length} chars, confidence: ${ocrConf}`);

    // Log sample of OCR text for debugging
    if (ocrText.length > 0) {
      const sample = ocrText.slice(0, 150).replace(/\n/g, ' ');
      console.log(`[OCR-Main] Text sample: "${sample}${ocrText.length > 150 ? '...' : ''}"`);
    }

    if (!ocrText.trim()) {
      console.log('[OCR-Main] No text found, skipping update');
      // Notify renderer that OCR is complete (even if no text)
      notifyRendererOCRComplete(screenshotId, null, []);
      return;
    }

    // Generate smart filename and tags
    const originalName = path.basename(filePath);
    const smartName = generateSmartFilename(ocrText, originalName);
    const tags = generateTags(ocrText);

    console.log(`[OCR-Main] Smart name: ${smartName}, Tags (${tags.length}): ${tags.join(', ')}`);
    
    // Rename file on disk
    let newStoragePath = filePath;
    if (smartName !== originalName) {
      const dir = path.dirname(filePath);
      const newPath = path.join(dir, smartName);
      
      // Check if new path already exists
      if (!fs.existsSync(newPath) || filePath === newPath) {
        try {
          fs.renameSync(filePath, newPath);
          newStoragePath = newPath;
          console.log(`[OCR-Main] Renamed: ${filePath} -> ${newPath}`);
        } catch (renameErr) {
          console.error(`[OCR-Main] Rename failed: ${renameErr}`);
        }
      } else {
        // Add timestamp to make unique
        const ext = path.extname(smartName);
        const base = path.basename(smartName, ext);
        const uniqueName = `${base}_${Date.now()}${ext}`;
        const uniquePath = path.join(dir, uniqueName);
        try {
          fs.renameSync(filePath, uniquePath);
          newStoragePath = uniquePath;
          console.log(`[OCR-Main] Renamed (unique): ${filePath} -> ${uniquePath}`);
        } catch (renameErr) {
          console.error(`[OCR-Main] Rename failed: ${renameErr}`);
        }
      }
    }
    
    // Update database
    const db = getDatabase();
    db.prepare(`
      UPDATE screenshots 
      SET file_name = ?, storage_path = ?, ocr_text = ?, ocr_confidence = ?, custom_tags = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(
      path.basename(newStoragePath),
      newStoragePath,
      ocrText,
      ocrConf,
      JSON.stringify(tags),
      screenshotId
    );
    
    console.log(`[OCR-Main] Database updated for ${screenshotId}`);
    
    // Notify renderer that OCR is complete
    notifyRendererOCRComplete(screenshotId, path.basename(newStoragePath), tags);
    
  } catch (e) {
    console.error(`[OCR-Main] Error: ${e}`);
    // Still notify renderer so it can clear processing state
    notifyRendererOCRComplete(screenshotId, null, []);
  }
}

// Notify renderer that OCR is complete (for UI refresh)
function notifyRendererOCRComplete(screenshotId, smartName, tags) {
  console.log(`[OCR-Main] notifyRendererOCRComplete called:`, { screenshotId, smartName, tags });
  try {
    const windowExists = mainWindow && !mainWindow.isDestroyed();
    const hasWebContents = windowExists && mainWindow.webContents;
    console.log(`[OCR-Main] Window state: exists=${windowExists}, hasWebContents=${hasWebContents}`);
    
    if (hasWebContents) {
      console.log(`[OCR-Main] Sending ocr:complete event NOW`);
      mainWindow.webContents.send('ocr:complete', { screenshotId, smartName, tags });
      sendLog(`[OCR-Main] Sent ocr:complete to renderer for ${screenshotId}`);
    } else {
      console.log(`[OCR-Main] Cannot send - window not available`);
    }
  } catch (e) {
    console.error(`[OCR-Main] Failed to notify renderer:`, e);
    sendLog(`[OCR-Main] Failed to notify renderer: ${e}`, 'error');
  }
}

// Keep the old popup for editor functionality (but won't be used for initial capture)
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

      // Send init data with a small delay to ensure renderer is ready
      setTimeout(() => {
        if (popupWindow && !popupWindow.isDestroyed()) {
          sendLog(`Sending popup:init with filePath: ${filePath}`);
          popupWindow.webContents.send('popup:init', filePath);
        }
      }, 100);
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

ipcMain.on('popup:save', (_event, dataUrl) => {
  if (lastScreenshotPath) {
    try {
      const db = getDatabase();
      const dir = path.dirname(lastScreenshotPath);
      
      // Try to find existing screenshot (might have been renamed by OCR)
      let existingScreenshot = db.prepare('SELECT id, storage_path FROM screenshots WHERE storage_path = ?').get(lastScreenshotPath);
      
      // If not found by exact path, search for most recent in same directory
      if (!existingScreenshot) {
        existingScreenshot = db.prepare(`
          SELECT id, storage_path FROM screenshots 
          WHERE storage_path LIKE ? 
          ORDER BY created_at DESC 
          LIMIT 1
        `).get(`${dir}/%`);
        
        if (existingScreenshot) {
          sendLog(`Found existing screenshot by directory: ${existingScreenshot.storage_path}`);
        }
      }
      
      const image = nativeImage.createFromDataURL(dataUrl);
      
      if (existingScreenshot) {
        // Update existing file
        fs.writeFileSync(existingScreenshot.storage_path, image.toPNG());
        sendLog(`Updated existing screenshot: ${existingScreenshot.storage_path}`);
        
        // Update database entry (update file_size and dimensions)
        const stats = fs.statSync(existingScreenshot.storage_path);
        const size = image.getSize();
        db.prepare(`
          UPDATE screenshots 
          SET file_size = ?, width = ?, height = ?, updated_at = CURRENT_TIMESTAMP 
          WHERE id = ?
        `).run(stats.size, size.width || 0, size.height || 0, existingScreenshot.id);
        
        sendLog(`Updated database entry for ID: ${existingScreenshot.id}`);
      } else {
        // No existing entry, save as new (shouldn't happen in normal flow)
        fs.writeFileSync(lastScreenshotPath, image.toPNG());
        sendLog(`Saved new screenshot to: ${lastScreenshotPath}`);
        
        const savedId = saveScreenshotToDatabase(lastScreenshotPath);
        if (savedId) {
          sendLog(`Created new database entry: ${savedId}`);
        }
      }

      // Mark as saved so it won't be deleted on close
      screenshotWasSaved = true;

      // Close the editor popup
      if (popupWindow && !popupWindow.isDestroyed()) {
        popupWindow.close();
      }
      
      // Notify main window to refresh
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
        mainWindow.webContents.send('screenshot-saved', { id: existingScreenshot?.id });
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
            mainWindow.webContents.reload();
          }
        }, 100);
      }
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

ipcMain.on('popup:trash', (_event, filePath) => {
  const pathToDelete = filePath || lastScreenshotPath;
  sendLog(`popup:trash called with filePath: ${pathToDelete}`);
  
  if (pathToDelete) {
    try {
      const db = getDatabase();
      
      // Try to find the screenshot in database
      let screenshot = db.prepare('SELECT id, storage_path FROM screenshots WHERE storage_path = ?').get(pathToDelete);
      
      // If found in database, delete it
      if (screenshot) {
        const deleted = db.prepare('DELETE FROM screenshots WHERE id = ?').run(screenshot.id);
        sendLog(`Deleted ${deleted.changes} database entries for ID: ${screenshot.id}, path: ${screenshot.storage_path}`);
        
        // Delete the actual file
        if (fs.existsSync(screenshot.storage_path)) {
          fs.unlinkSync(screenshot.storage_path);
          sendLog(`Deleted screenshot file: ${screenshot.storage_path}`);
        }
      } else {
        // Not in database yet (user clicked trash before clicking Done)
        // Just delete the physical file
        sendLog(`Screenshot not in database, deleting file only: ${pathToDelete}`);
        if (fs.existsSync(pathToDelete)) {
          fs.unlinkSync(pathToDelete);
          sendLog(`Deleted screenshot file: ${pathToDelete}`);
        }
      }
      
      // Notify main window to refresh
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
        sendLog('Sending screenshot-deleted event and reloading main window');
        mainWindow.webContents.send('screenshot-deleted', { filePath: pathToDelete });
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
            mainWindow.webContents.reload();
          }
        }, 100);
      }
    } catch (e) {
      sendLog(`Error deleting screenshot: ${e}`, 'error');
    }
  }
  if (popupWindow && !popupWindow.isDestroyed()) popupWindow.close();
});

ipcMain.on('popup:share', (_event, dataUrl) => {
  let filePathToShare = lastScreenshotPath;
  let isTemp = false;

  if (dataUrl) {
    try {
      const image = nativeImage.createFromDataURL(dataUrl);
      const tempPath = path.join(app.getPath('temp'), `share-${Date.now()}.png`);
      fs.writeFileSync(tempPath, image.toPNG());
      filePathToShare = tempPath;
      isTemp = true;
    } catch (e) {
      sendLog(`Error creating temp file for share: ${e}`, 'error');
    }
  }

  if (!filePathToShare) return;

  if (process.platform === 'darwin') {
    const shareMenu = Menu.buildFromTemplate([
      {
        label: 'Share Screenshot',
        role: 'shareMenu',
        sharingItem: {
          filePaths: [filePathToShare]
        }
      }
    ]);
    shareMenu.popup({ window: popupWindow });

    // Clean up temp file after menu closes (approximate)
    if (isTemp) {
      setTimeout(() => {
        try { fs.unlinkSync(filePathToShare); } catch { }
      }, 60000); // 1 minute delay to ensure share service has accessed it
    }
  } else {
    shell.showItemInFolder(filePathToShare);
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

  try {
    const outPath = await captureWithSystem();
    if (outPath) {
      lastScreenshotPath = outPath;
      
      // Auto-copy to clipboard immediately (so user can paste right away)
      try {
        const img = nativeImage.createFromPath(outPath);
        clipboard.writeImage(img);
        sendLog('Screenshot auto-copied to clipboard');
      } catch (e) {
        sendLog(`Failed to copy to clipboard: ${e}`, 'error');
      }
      
      // Show Apple-style thumbnail preview (bottom-left corner)
      createThumbnailPreview(outPath);
    }
    else sendLog('Capture canceled or failed');
  } catch (e) {
    sendLog(`takeScreenshotSystem error: ${e}`, 'error');
    dialog.showErrorBox('Capture error', String(e));
  } finally {
    isCapturing = false;
  }
}

// ... rest of existing code ...

async function captureWithSystem() {
  sendLog(`Capture requested on platform=${process.platform}`);
  if (process.platform === 'darwin') return await macCaptureDualPath();
  if (process.platform === 'win32') return await winCaptureClipboard();
  return await linuxCaptureFile();
}

// macOS: clipboard-first (screencapture -ci)
function macCaptureDualPath() {
  return new Promise((resolve) => {
    sendLog('macOS: starting screencapture -ci (clipboard mode)');
    clipboard.clear();
    const p = spawn('screencapture', ['-ci'], { stdio: 'ignore' });

    let processExited = false;
    let exitCode = null;
    let resolved = false;
    let postExitAttempts = 0;
    const MAX_POST_EXIT_ATTEMPTS = 8; // ~1 second max wait after exit

    const safeResolve = (value) => {
      if (!resolved) {
        resolved = true;
        resolve(value);
      }
    };

    // Hard timeout safety net (30s)
    setTimeout(() => {
      if (!resolved) {
        sendLog('macOS: Hard timeout reached in capture', 'error');
        safeResolve(null);
      }
    }, 30000);

    p.on('error', (err) => {
      sendLog(`screencapture spawn error: ${err}`, 'error');
      processExited = true;
      safeResolve(null);
    });

    p.on('exit', (code) => {
      processExited = true;
      exitCode = code;
      sendLog(`screencapture exited with code ${code}`);

      // If user cancelled (non-zero exit code), stop immediately
      if (code !== 0) {
        sendLog('User cancelled screenshot (Escape pressed)');
        safeResolve(null);
      }
    });

    const poll = () => {
      // Stop polling if already resolved
      if (resolved) {
        return;
      }

      // Stop polling if process exited with error
      if (processExited && exitCode !== 0) {
        return;
      }

      // If process exited successfully but no clipboard content yet, wait a bit more
      if (processExited && exitCode === 0) {
        postExitAttempts++;
        if (postExitAttempts > MAX_POST_EXIT_ATTEMPTS) {
          sendLog('macOS: No clipboard content found after process exit', 'error');
          safeResolve(null);
          return;
        }

        try {
          const img = clipboard.readImage();
          if (img && !img.isEmpty()) {
            const buf = img.toPNG();
            sendLog(`macOS: clipboard image detected (bytes=${buf.length}). Saving...`);
            const out = saveBufferToFile(buf);
            return safeResolve(out);
          }
        } catch (e) {
          sendLog(`macOS: clipboard read error: ${e}`, 'error');
          return safeResolve(null);
        }

        // Give it a few more attempts after process exit
        setTimeout(poll, 120);
        return;
      }

      try {
        const img = clipboard.readImage();
        if (img && !img.isEmpty()) {
          const buf = img.toPNG();
          sendLog(`macOS: clipboard image detected (bytes=${buf.length}). Saving...`);
          const out = saveBufferToFile(buf);
          return safeResolve(out);
        }
      } catch (e) {
        sendLog(`macOS: clipboard read error: ${e}`, 'error');
        return safeResolve(null);
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
  const ok2 = globalShortcut.register('CommandOrControl+Shift+A', () => { 
    if (!isCapturing && mainWindow) {
      if (process.platform === 'darwin') app.dock.show();
      mainWindow.show();
    }
  });

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
  // Hide dock icon - make this a tray-only app like CleanShot X / Shottr
  if (process.platform === 'darwin') {
    app.dock.hide();
    sendLog('Dock icon hidden - running as menu bar app');
  }

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
  startFolderWatcher();

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
    // On macOS, clicking dock icon should show the window
    if (mainWindow) {
      if (process.platform === 'darwin') app.dock.show();
      mainWindow.show();
    } else {
      createWindow();
    }
  });


});

// Handle app quit properly
app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (folderWatcher) folderWatcher.close();
  closeDatabase();
});

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
ipcMain.handle('db:query', async (_e, { table, operation, data, where, orderBy, limit }) => {
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
      // Add ORDER BY clause
      if (orderBy && orderBy.column) {
        const direction = (orderBy.direction || 'desc').toUpperCase();
        const safeDirection = direction === 'ASC' ? 'ASC' : 'DESC';
        query += ` ORDER BY ${orderBy.column} ${safeDirection}`;
      }
      // Add LIMIT clause
      if (limit && typeof limit === 'number' && limit > 0) {
        query += ` LIMIT ${Math.floor(limit)}`;
      }
      console.log('[db:query] Executing:', query, params);
      const rows = db.prepare(query).all(...params);
      return {
        data: rows.map(row => ({
          ...row,
          ai_tags: row.ai_tags ? JSON.parse(row.ai_tags) : [],
          custom_tags: row.custom_tags ? JSON.parse(row.custom_tags) : [],
          note_history: row.note_history ? JSON.parse(row.note_history) : [],
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
      if (d2.note_history) d2.note_history = JSON.stringify(d2.note_history);
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
      if (d2.note_history) d2.note_history = JSON.stringify(d2.note_history);
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

ipcMain.handle('file:read', async (_e, filePath, useThumbnail = true) => {
  try {
    let pathToRead = filePath;

    // Try to use thumbnail if requested
    if (useThumbnail) {
      const thumbPath = getThumbnailPath(filePath);
      if (fs.existsSync(thumbPath)) {
        pathToRead = thumbPath;
        console.log(`[FileRead] Using thumbnail: ${path.basename(thumbPath)}`);
      } else {
        // Generate thumbnail if it doesn't exist
        const generated = generateThumbnail(filePath);
        if (generated && fs.existsSync(generated)) {
          pathToRead = generated;
          console.log(`[FileRead] Generated thumbnail: ${path.basename(generated)}`);
        } else {
          console.log(`[FileRead] No thumbnail, using original: ${path.basename(filePath)}`);
        }
      }
    } else {
      console.log(`[FileRead] Loading FULL-RES: ${path.basename(filePath)}`);
    }

    // Check cache first for instant re-renders
    const cacheKey = pathToRead;
    const cachedData = fileCache.get(cacheKey);
    if (cachedData) {
      console.log(`[FileRead] Cache HIT: ${path.basename(pathToRead)}`);
      return { data: cachedData, error: null };
    }

    // Cache miss - read from disk and cache it
    console.log(`[FileRead] Cache MISS: ${path.basename(pathToRead)}`);
    const data = fs.readFileSync(pathToRead).toString('base64');
    fileCache.set(cacheKey, data);

    return { data, error: null };
  }
  catch (error) { return { data: null, error: error.message }; }
});

ipcMain.handle('file:exists', async (_e, filePath) => {
  try { return { data: fs.existsSync(filePath), error: null }; }
  catch (error) { return { data: false, error: error.message }; }
});

// Batch file existence check - much faster than individual checks
ipcMain.handle('file:existsBatch', async (_e, filePaths) => {
  try {
    if (!Array.isArray(filePaths)) {
      return { data: [], error: 'filePaths must be an array' };
    }

    // Check all files and return array of booleans in same order
    const results = filePaths.map(filePath => {
      try {
        return fs.existsSync(filePath);
      } catch {
        return false;
      }
    });

    return { data: results, error: null };
  } catch (error) {
    return { data: [], error: error.message };
  }
});

ipcMain.handle('file:reveal', async (_e, filePath) => {
  try {
    shell.showItemInFolder(filePath);
    return { data: true, error: null };
  } catch (error) {
    return { data: null, error: error.message };
  }
});

ipcMain.handle('file:open-screenshots-folder', async () => {
  try {
    const dir = screenshotsDir();
    shell.openPath(dir);
    return { data: true, error: null };
  } catch (error) {
    return { data: null, error: error.message };
  }
});

ipcMain.handle('cache:stats', async () => {
  try {
    return { data: fileCache.getStats(), error: null };
  } catch (error) {
    return { data: null, error: error.message };
  }
});

ipcMain.handle('cache:clear', async () => {
  try {
    fileCache.clear();
    return { data: true, error: null };
  } catch (error) {
    return { data: null, error: error.message };
  }
});

ipcMain.handle('file:share', async (_e, filePath) => {
  try {
    if (process.platform === 'darwin') {
      const shareMenu = Menu.buildFromTemplate([
        {
          label: 'Share Screenshot',
          role: 'shareMenu',
          sharingItem: {
            filePaths: [filePath]
          }
        }
      ]);
      shareMenu.popup({ window: mainWindow });
      return { data: true, error: null };
    } else {
      shell.showItemInFolder(filePath);
      return { data: true, error: null };
    }
  } catch (error) {
    return { data: null, error: error.message };
  }
});

ipcMain.handle('file:delete', async (_e, filePath) => new Promise((resolve, reject) => {
  fs.unlink(filePath, (err) => {
    if (!err) {
      // Invalidate cache entries for this file and its thumbnail
      fileCache.invalidate(filePath);
      const thumbPath = getThumbnailPath(filePath);
      fileCache.invalidate(thumbPath);
    }
    err ? reject(err) : resolve(true);
  });
}));

ipcMain.handle('file:rename', async (_e, { oldPath, newName }) => {
  try {
    if (!oldPath || !newName) {
      return { newPath: null, error: 'Missing oldPath or newName' };
    }
    
    // Get directory from old path
    const dir = path.dirname(oldPath);
    const newPath = path.join(dir, newName);
    
    // Check if old file exists
    if (!fs.existsSync(oldPath)) {
      return { newPath: null, error: 'Original file not found' };
    }
    
    // Check if new path already exists (avoid overwriting)
    if (fs.existsSync(newPath) && oldPath !== newPath) {
      // Add timestamp suffix to make unique
      const ext = path.extname(newName);
      const base = path.basename(newName, ext);
      const uniqueName = `${base}_${Date.now()}${ext}`;
      const uniquePath = path.join(dir, uniqueName);
      fs.renameSync(oldPath, uniquePath);

      // Invalidate cache for old path and its thumbnail
      fileCache.invalidate(oldPath);
      const oldThumbPath = getThumbnailPath(oldPath);
      fileCache.invalidate(oldThumbPath);

      sendLog(`Renamed file: ${oldPath} -> ${uniquePath}`);
      return { newPath: uniquePath, error: null };
    }

    fs.renameSync(oldPath, newPath);

    // Invalidate cache for old path and its thumbnail
    fileCache.invalidate(oldPath);
    const oldThumbPath = getThumbnailPath(oldPath);
    fileCache.invalidate(oldThumbPath);

    sendLog(`Renamed file: ${oldPath} -> ${newPath}`);
    return { newPath, error: null };
  } catch (error) {
    sendLog(`file:rename error: ${error}`, 'error');
    return { newPath: null, error: error.message };
  }
});

ipcMain.on('file:start-drag', (event, filePath) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      sendLog(`file:start-drag error: File not found at ${filePath}`, 'error');
      return;
    }

    event.sender.startDrag({
      file: filePath,
      icon: nativeImage.createFromPath(filePath).resize({ width: 64, height: 64 })
    });
    sendLog(`Started drag for file: ${filePath}`);
  } catch (error) {
    sendLog(`file:start-drag error: ${error}`, 'error');
  }
});

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

/* ====================== Folder Helpers ====================== */
// Get the filesystem path for a folder (builds path from parent chain)
function getFolderPath(folderId) {
  if (!folderId) return screenshotsDir();
  
  const db = getDatabase();
  const folder = db.prepare('SELECT id, name, parent_id FROM folders WHERE id = ?').get(folderId);
  if (!folder) return screenshotsDir();
  
  // Build path by traversing up the parent chain
  const pathParts = [folder.name];
  let currentParentId = folder.parent_id;
  
  while (currentParentId) {
    const parent = db.prepare('SELECT id, name, parent_id FROM folders WHERE id = ?').get(currentParentId);
    if (!parent) break;
    pathParts.unshift(parent.name);
    currentParentId = parent.parent_id;
  }
  
  return path.join(screenshotsDir(), ...pathParts);
}

// Ensure folder exists on filesystem
function ensureFolderOnDisk(folderId) {
  const folderPath = getFolderPath(folderId);
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
    sendLog(`Created folder on disk: ${folderPath}`);
  }
  return folderPath;
}

// Move all screenshots in a folder to new path
function moveScreenshotsToNewPath(folderId, newFolderPath) {
  const db = getDatabase();
  const screenshots = db.prepare('SELECT id, storage_path, file_name FROM screenshots WHERE folder_id = ?').all(folderId);
  
  for (const screenshot of screenshots) {
    const oldPath = screenshot.storage_path;
    const newPath = path.join(newFolderPath, screenshot.file_name);
    
    if (fs.existsSync(oldPath) && oldPath !== newPath) {
      try {
        // Ensure unique filename
        let finalPath = newPath;
        if (fs.existsSync(newPath)) {
          const ext = path.extname(screenshot.file_name);
          const base = path.basename(screenshot.file_name, ext);
          finalPath = path.join(newFolderPath, `${base}_${Date.now()}${ext}`);
        }
        
        fs.renameSync(oldPath, finalPath);
        db.prepare('UPDATE screenshots SET storage_path = ?, file_name = ? WHERE id = ?')
          .run(finalPath, path.basename(finalPath), screenshot.id);
        sendLog(`Moved screenshot: ${oldPath} -> ${finalPath}`);
      } catch (e) {
        sendLog(`Failed to move screenshot ${screenshot.id}: ${e}`, 'error');
      }
    }
  }
}

// Recursively move subfolders and their contents
function moveSubfoldersRecursively(parentId, newParentPath) {
  const db = getDatabase();
  const subfolders = db.prepare('SELECT id, name FROM folders WHERE parent_id = ?').all(parentId);
  
  for (const subfolder of subfolders) {
    const newSubfolderPath = path.join(newParentPath, subfolder.name);
    ensureDir(newSubfolderPath);
    
    // Move screenshots in this subfolder
    moveScreenshotsToNewPath(subfolder.id, newSubfolderPath);
    
    // Recursively handle nested subfolders
    moveSubfoldersRecursively(subfolder.id, newSubfolderPath);
  }
}

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
        const id = crypto.randomUUID();
        insert.run(id, name, 'folder', colors[i % colors.length]);
        // Create folder on disk
        ensureFolderOnDisk(id);
      });
    }

    // Get folders with screenshot counts and parent info
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

ipcMain.handle('folder:create', async (_e, name, parentId = null) => {
  try {
    const db = getDatabase();
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO folders (id, name, parent_id) VALUES (?, ?, ?)').run(id, name, parentId);
    
    // Create folder on disk
    const folderPath = ensureFolderOnDisk(id);
    sendLog(`Created folder: ${name} at ${folderPath}`);
    
    return { data: { id, name, parent_id: parentId }, error: null };
  } catch (e) {
    return { data: null, error: e.message };
  }
});

ipcMain.handle('folder:rename', async (_e, { id, name }) => {
  try {
    const db = getDatabase();
    const folder = db.prepare('SELECT name, parent_id FROM folders WHERE id = ?').get(id);
    if (!folder) return { data: null, error: 'Folder not found' };
    
    const oldPath = getFolderPath(id);
    
    // Update database
    db.prepare('UPDATE folders SET name = ? WHERE id = ?').run(name, id);
    
    // Rename folder on disk
    const newPath = getFolderPath(id);
    if (fs.existsSync(oldPath) && oldPath !== newPath) {
      try {
        fs.renameSync(oldPath, newPath);
        
        // Update all screenshot paths in this folder and subfolders
        const updateScreenshotPaths = (folderId, folderPath) => {
          const screenshots = db.prepare('SELECT id, storage_path, file_name FROM screenshots WHERE folder_id = ?').all(folderId);
          for (const s of screenshots) {
            const newScreenshotPath = path.join(folderPath, s.file_name);
            db.prepare('UPDATE screenshots SET storage_path = ? WHERE id = ?').run(newScreenshotPath, s.id);
          }
          
          // Handle subfolders
          const subfolders = db.prepare('SELECT id, name FROM folders WHERE parent_id = ?').all(folderId);
          for (const sub of subfolders) {
            updateScreenshotPaths(sub.id, path.join(folderPath, sub.name));
          }
        };
        
        updateScreenshotPaths(id, newPath);
        sendLog(`Renamed folder: ${oldPath} -> ${newPath}`);
      } catch (e) {
        sendLog(`Failed to rename folder on disk: ${e}`, 'error');
      }
    }
    
    return { data: true, error: null };
  } catch (e) {
    return { data: null, error: e.message };
  }
});

ipcMain.handle('folder:delete', async (_e, id) => {
  try {
    const db = getDatabase();
    const folderPath = getFolderPath(id);
    
    // Move screenshots to root folder (unassign from folder)
    db.prepare('UPDATE screenshots SET folder_id = NULL WHERE folder_id = ?').run(id);
    
    // Recursively unassign screenshots from subfolders
    const unassignSubfolders = (parentId) => {
      const subfolders = db.prepare('SELECT id FROM folders WHERE parent_id = ?').all(parentId);
      for (const sub of subfolders) {
        db.prepare('UPDATE screenshots SET folder_id = NULL WHERE folder_id = ?').run(sub.id);
        unassignSubfolders(sub.id);
      }
    };
    unassignSubfolders(id);
    
    // Delete folder and subfolders from database (CASCADE should handle this)
    db.prepare('DELETE FROM folders WHERE id = ?').run(id);
    
    // Delete folder from disk (if empty after moving screenshots)
    if (fs.existsSync(folderPath)) {
      try {
        fs.rmSync(folderPath, { recursive: true, force: true });
        sendLog(`Deleted folder from disk: ${folderPath}`);
      } catch (e) {
        sendLog(`Failed to delete folder from disk: ${e}`, 'error');
      }
    }
    
    return { data: true, error: null };
  } catch (e) {
    return { data: null, error: e.message };
  }
});

// Move folder into another folder (nesting)
ipcMain.handle('folder:move', async (_e, { folderId, targetParentId }) => {
  try {
    const db = getDatabase();
    
    // Prevent moving folder into itself or its descendants
    if (folderId === targetParentId) {
      return { data: null, error: 'Cannot move folder into itself' };
    }
    
    // Check if target is a descendant of the folder being moved
    const isDescendant = (parentId, checkId) => {
      if (!parentId) return false;
      if (parentId === checkId) return true;
      const parent = db.prepare('SELECT parent_id FROM folders WHERE id = ?').get(parentId);
      return parent ? isDescendant(parent.parent_id, checkId) : false;
    };
    
    if (isDescendant(targetParentId, folderId)) {
      return { data: null, error: 'Cannot move folder into its own subfolder' };
    }
    
    const folder = db.prepare('SELECT name FROM folders WHERE id = ?').get(folderId);
    if (!folder) return { data: null, error: 'Folder not found' };
    
    const oldPath = getFolderPath(folderId);
    
    // Update parent in database
    db.prepare('UPDATE folders SET parent_id = ? WHERE id = ?').run(targetParentId, folderId);
    
    // Move folder on disk
    const newPath = getFolderPath(folderId);
    if (fs.existsSync(oldPath) && oldPath !== newPath) {
      try {
        ensureDir(path.dirname(newPath));
        fs.renameSync(oldPath, newPath);
        
        // Update all screenshot paths recursively
        const updatePaths = (fId, fPath) => {
          const screenshots = db.prepare('SELECT id, file_name FROM screenshots WHERE folder_id = ?').all(fId);
          for (const s of screenshots) {
            const newScreenshotPath = path.join(fPath, s.file_name);
            db.prepare('UPDATE screenshots SET storage_path = ? WHERE id = ?').run(newScreenshotPath, s.id);
          }
          const subfolders = db.prepare('SELECT id, name FROM folders WHERE parent_id = ?').all(fId);
          for (const sub of subfolders) {
            updatePaths(sub.id, path.join(fPath, sub.name));
          }
        };
        updatePaths(folderId, newPath);
        
        sendLog(`Moved folder: ${oldPath} -> ${newPath}`);
      } catch (e) {
        sendLog(`Failed to move folder on disk: ${e}`, 'error');
        // Rollback database change
        db.prepare('UPDATE folders SET parent_id = ? WHERE id = ?').run(null, folderId);
        return { data: null, error: `Failed to move folder: ${e.message}` };
      }
    }
    
    return { data: true, error: null };
  } catch (e) {
    return { data: null, error: e.message };
  }
});

ipcMain.handle('screenshot:move', async (_e, { screenshotId, folderId }) => {
  try {
    const db = getDatabase();
    const screenshot = db.prepare('SELECT storage_path, file_name FROM screenshots WHERE id = ?').get(screenshotId);
    if (!screenshot) return { data: null, error: 'Screenshot not found' };
    
    const oldPath = screenshot.storage_path;
    const newFolderPath = folderId ? ensureFolderOnDisk(folderId) : screenshotsDir();
    let newPath = path.join(newFolderPath, screenshot.file_name);
    
    // Handle filename conflicts
    if (fs.existsSync(newPath) && oldPath !== newPath) {
      const ext = path.extname(screenshot.file_name);
      const base = path.basename(screenshot.file_name, ext);
      newPath = path.join(newFolderPath, `${base}_${Date.now()}${ext}`);
    }
    
    // Move file on disk
    if (fs.existsSync(oldPath) && oldPath !== newPath) {
      try {
        fs.renameSync(oldPath, newPath);
        sendLog(`Moved screenshot: ${oldPath} -> ${newPath}`);
      } catch (e) {
        sendLog(`Failed to move screenshot file: ${e}`, 'error');
        return { data: null, error: `Failed to move file: ${e.message}` };
      }
    }
    
    // Update database
    db.prepare('UPDATE screenshots SET folder_id = ?, storage_path = ?, file_name = ? WHERE id = ?')
      .run(folderId, newPath, path.basename(newPath), screenshotId);
    
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

/* ====================== Import Screenshots/Folders ====================== */
const chokidar = require('chokidar');
let folderWatcher = null;

// Import single or multiple files
ipcMain.handle('import:files', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Screenshots',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }
      ]
    });

    if (result.canceled || !result.filePaths.length) {
      return { data: [], error: null };
    }

    const imported = [];
    for (const filePath of result.filePaths) {
      const id = await importSingleFile(filePath, null);
      if (id) imported.push(id);
    }

    sendLog(`Imported ${imported.length} files`);
    return { data: imported, error: null };
  } catch (error) {
    sendLog(`import:files error: ${error}`, 'error');
    return { data: null, error: error.message };
  }
});

// Import a folder (creates folder in app + imports all images into subfolder)
ipcMain.handle('import:folder', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Folder',
      properties: ['openDirectory']
    });

    if (result.canceled || !result.filePaths.length) {
      return { data: null, error: null };
    }

    const sourceFolderPath = result.filePaths[0];
    const folderName = path.basename(sourceFolderPath);
    
    // Create folder in database
    const db = getDatabase();
    const folderId = crypto.randomUUID();
    db.prepare('INSERT INTO folders (id, name) VALUES (?, ?)').run(folderId, folderName);
    
    // Create physical subfolder in ScreenVault directory
    const destFolderPath = path.join(screenshotsDir(), folderName);
    if (!fs.existsSync(destFolderPath)) {
      fs.mkdirSync(destFolderPath, { recursive: true });
    }
    
    // Import all images from folder into the subfolder
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];
    const files = fs.readdirSync(sourceFolderPath);
    const imported = [];
    
    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (imageExtensions.includes(ext)) {
        const sourceFilePath = path.join(sourceFolderPath, file);
        const stat = fs.statSync(sourceFilePath);
        if (stat.isFile()) {
          const id = await importSingleFileToFolder(sourceFilePath, folderId, destFolderPath);
          if (id) imported.push(id);
        }
      }
    }

    sendLog(`Imported folder "${folderName}" with ${imported.length} images into ${destFolderPath}`);
    mainWindow?.webContents.send('folder-created', { folderId, folderName });
    return { data: { folderId, folderName, imported }, error: null };
  } catch (error) {
    sendLog(`import:folder error: ${error}`, 'error');
    return { data: null, error: error.message };
  }
});

// Import a single file into a specific folder
async function importSingleFileToFolder(sourcePath, folderId, destFolderPath) {
  try {
    const db = getDatabase();
    const fileName = path.basename(sourcePath);
    const destPath = path.join(destFolderPath, fileName);
    
    // Copy file to destination folder
    let finalPath = destPath;
    if (fs.existsSync(destPath)) {
      const ext = path.extname(fileName);
      const base = path.basename(fileName, ext);
      finalPath = path.join(destFolderPath, `${base}_${Date.now()}${ext}`);
    }
    fs.copyFileSync(sourcePath, finalPath);
    
    const stats = fs.statSync(finalPath);
    const id = crypto.randomUUID();
    const finalFileName = path.basename(finalPath);
    
    // Get image dimensions
    const img = nativeImage.createFromPath(finalPath);
    const size = img.getSize();
    
    const stmt = db.prepare(`
      INSERT INTO screenshots (
        id, file_name, file_size, file_type, width, height, 
        storage_path, source, ocr_text, ocr_confidence, 
        custom_tags, ai_tags, user_notes, is_favorite, is_archived,
        thumbnail_path, ai_description, folder_id, view_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const ext = path.extname(finalFileName).toLowerCase();
    const mimeTypes = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp'
    };
    
    stmt.run(
      id,
      finalFileName,
      stats.size,
      mimeTypes[ext] || 'image/png',
      size.width || 0,
      size.height || 0,
      finalPath,
      'import',
      '',
      null,
      '[]',
      '[]',
      '',
      0,
      0,
      null,
      null,
      folderId,
      0
    );
    
    sendLog(`Imported file ${finalFileName} to folder ${path.basename(destFolderPath)}`);

    // Generate thumbnail in background
    setTimeout(() => {
      const thumbPath = generateThumbnail(finalPath);
      if (thumbPath) {
        try {
          db.prepare('UPDATE screenshots SET thumbnail_path = ? WHERE id = ?').run(thumbPath, id);
          console.log(`[ImportFolder] Thumbnail generated: ${thumbPath}`);
        } catch (err) {
          console.error(`[ImportFolder] Failed to update thumbnail_path:`, err);
        }
      }
    }, 0);

    // Trigger OCR processing
    runOCRInMainProcess(id, finalPath);

    return id;
  } catch (error) {
    sendLog(`importSingleFileToFolder error: ${error}`, 'error');
    return null;
  }
}

// Import a single file into the database (copy to ScreenVault folder)
async function importSingleFile(sourcePath, folderId = null) {
  try {
    const db = getDatabase();
    const fileName = path.basename(sourcePath);
    const destPath = path.join(screenshotsDir(), fileName);
    
    // Copy file to ScreenVault folder (if not already there)
    if (sourcePath !== destPath && !sourcePath.startsWith(screenshotsDir())) {
      // Check if file with same name exists, add timestamp if so
      let finalPath = destPath;
      if (fs.existsSync(destPath)) {
        const ext = path.extname(fileName);
        const base = path.basename(fileName, ext);
        finalPath = path.join(screenshotsDir(), `${base}_${Date.now()}${ext}`);
      }
      fs.copyFileSync(sourcePath, finalPath);
      sourcePath = finalPath;
    }
    
    const stats = fs.statSync(sourcePath);
    const id = crypto.randomUUID();
    const finalFileName = path.basename(sourcePath);
    
    // Get image dimensions
    const img = nativeImage.createFromPath(sourcePath);
    const size = img.getSize();
    
    const stmt = db.prepare(`
      INSERT INTO screenshots (
        id, file_name, file_size, file_type, width, height, 
        storage_path, source, ocr_text, ocr_confidence, 
        custom_tags, ai_tags, user_notes, is_favorite, is_archived,
        thumbnail_path, ai_description, folder_id, view_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const ext = path.extname(finalFileName).toLowerCase();
    const mimeTypes = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp'
    };
    
    stmt.run(
      id,
      finalFileName,
      stats.size,
      mimeTypes[ext] || 'image/png',
      size.width || 0,
      size.height || 0,
      sourcePath,
      'import',
      '',
      null,
      '[]',
      '[]',
      '',
      0,
      0,
      null,
      null,
      folderId,
      0
    );
    
    sendLog(`Imported file: ${finalFileName} (id: ${id})`);

    // Generate thumbnail in background
    setTimeout(() => {
      const thumbPath = generateThumbnail(sourcePath);
      if (thumbPath) {
        try {
          db.prepare('UPDATE screenshots SET thumbnail_path = ? WHERE id = ?').run(thumbPath, id);
          console.log(`[Import] Thumbnail generated: ${thumbPath}`);
        } catch (err) {
          console.error(`[Import] Failed to update thumbnail_path:`, err);
        }
      }
    }, 0);

    // Trigger OCR processing
    runOCRInMainProcess(id, sourcePath);
    
    return id;
  } catch (e) {
    sendLog(`importSingleFile error: ${e}`, 'error');
    return null;
  }
}

// Watch ScreenVault folder for new files/folders
function startFolderWatcher() {
  const watchDir = screenshotsDir();
  sendLog(`Starting folder watcher on: ${watchDir}`);
  
  if (folderWatcher) {
    folderWatcher.close();
  }
  
  folderWatcher = chokidar.watch(watchDir, {
    ignored: /(^|[\/\\])\../, // ignore dotfiles
    persistent: true,
    ignoreInitial: true,
    depth: 1, // Watch one level deep for subfolders
    awaitWriteFinish: {
      stabilityThreshold: 1000,
      pollInterval: 100
    }
  });
  
  const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];
  
  folderWatcher.on('add', async (filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (!imageExtensions.includes(ext)) return;
    
    // Check if file is already in database
    const db = getDatabase();
    const existing = db.prepare('SELECT id FROM screenshots WHERE storage_path = ?').get(filePath);
    if (existing) return;
    
    sendLog(`Detected new file: ${filePath}`);
    
    // Check if file is in a subfolder
    const relativePath = path.relative(watchDir, filePath);
    const parts = relativePath.split(path.sep);
    
    let folderId = null;
    if (parts.length > 1) {
      // File is in a subfolder - create or find folder
      const folderName = parts[0];
      let folder = db.prepare('SELECT id FROM folders WHERE name = ?').get(folderName);
      if (!folder) {
        folderId = crypto.randomUUID();
        db.prepare('INSERT INTO folders (id, name) VALUES (?, ?)').run(folderId, folderName);
        sendLog(`Created folder: ${folderName}`);
      } else {
        folderId = folder.id;
      }
    }
    
    // Import the file (don't copy since it's already in ScreenVault folder)
    const id = await importFileInPlace(filePath, folderId);
    
    if (id && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('screenshot-imported', { id, filePath });
    }
  });
  
  folderWatcher.on('addDir', (dirPath) => {
    if (dirPath === watchDir) return;

    const folderName = path.basename(dirPath);
    const db = getDatabase();

    // Check if folder already exists
    const existing = db.prepare('SELECT id FROM folders WHERE name = ?').get(folderName);
    if (existing) return;

    // Create folder in database
    const folderId = crypto.randomUUID();
    db.prepare('INSERT INTO folders (id, name) VALUES (?, ?)').run(folderId, folderName);
    sendLog(`Detected new folder: ${folderName}`);

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('folder-created', { id: folderId, name: folderName });
    }
  });

  // Invalidate cache when files change or are deleted
  folderWatcher.on('change', (filePath) => {
    fileCache.invalidate(filePath);
    const thumbPath = getThumbnailPath(filePath);
    fileCache.invalidate(thumbPath);
    sendLog(`File changed, cache invalidated: ${path.basename(filePath)}`);
  });

  folderWatcher.on('unlink', (filePath) => {
    fileCache.invalidate(filePath);
    const thumbPath = getThumbnailPath(filePath);
    fileCache.invalidate(thumbPath);
    sendLog(`File deleted, cache invalidated: ${path.basename(filePath)}`);
  });

  folderWatcher.on('error', (error) => {
    sendLog(`Folder watcher error: ${error}`, 'error');
  });
}

// Import file that's already in ScreenVault folder (no copy needed)
async function importFileInPlace(filePath, folderId = null) {
  try {
    const db = getDatabase();
    const fileName = path.basename(filePath);
    const stats = fs.statSync(filePath);
    const id = crypto.randomUUID();
    
    const img = nativeImage.createFromPath(filePath);
    const size = img.getSize();
    
    const ext = path.extname(fileName).toLowerCase();
    const mimeTypes = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp'
    };
    
    const stmt = db.prepare(`
      INSERT INTO screenshots (
        id, file_name, file_size, file_type, width, height, 
        storage_path, source, ocr_text, ocr_confidence, 
        custom_tags, ai_tags, user_notes, is_favorite, is_archived,
        thumbnail_path, ai_description, folder_id, view_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      id,
      fileName,
      stats.size,
      mimeTypes[ext] || 'image/png',
      size.width || 0,
      size.height || 0,
      filePath,
      'folder-watch',
      '',
      null,
      '[]',
      '[]',
      '',
      0,
      0,
      null,
      null,
      folderId,
      0
    );
    
    sendLog(`Auto-imported file: ${fileName}`);
    
    // Trigger OCR
    runOCRInMainProcess(id, filePath);
    
    return id;
  } catch (e) {
    sendLog(`importFileInPlace error: ${e}`, 'error');
    return null;
  }
}

// Get ScreenVault folder path
ipcMain.handle('import:getScreenVaultPath', async () => {
  return { data: screenshotsDir(), error: null };
});

// Open ScreenVault folder in Finder
ipcMain.handle('import:openScreenVaultFolder', async () => {
  try {
    shell.openPath(screenshotsDir());
    return { data: true, error: null };
  } catch (error) {
    return { data: null, error: error.message };
  }
});
