'use strict';

const { app, BrowserWindow, clipboard, nativeImage, screen } = require('electron');
const { execFile } = require('child_process');

const SCREENSHOT_SOUND = '/System/Library/Components/CoreAudio.component/Contents/SharedSupport/SystemSounds/system/Screen Capture.aif';

const MAX_PAGE_HEIGHT = 16384;
const PAGE_LOAD_TIMEOUT = 30000;
const SETTLE_DELAY = 2000;

/**
 * Show a small loading toast in the bottom-left while capture is in progress.
 */
function showLoadingToast() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { height: screenHeight } = primaryDisplay.workAreaSize;
  const toast = new BrowserWindow({
    width: 200,
    height: 44,
    x: 20,
    y: screenHeight - 64,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  toast.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`
    <!DOCTYPE html><html><head><style>
      * { margin:0; padding:0; }
      html, body { background: transparent; }
      .toast {
        background: rgba(30,28,33,0.92); color: #fff; font: 13px/1 -apple-system, sans-serif;
        padding: 10px 16px; border-radius: 10px; display: flex; align-items: center; gap: 10px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
      }
      .spinner { width:18px; height:18px; border:2px solid rgba(255,255,255,0.3);
        border-top-color:#fff; border-radius:50%; animation: spin .8s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }
    </style></head><body>
      <div class="toast"><div class="spinner"></div>Capturing page…</div>
    </body></html>
  `));
  toast.once('ready-to-show', () => {
    if (!toast.isDestroyed()) toast.showInactive();
  });
  return toast;
}

/**
 * Wait for the offscreen renderer to paint at least once.
 * Returns a promise that resolves when a 'paint' event fires.
 */
function waitForPaint(webContents, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    webContents.on('paint', function onPaint() {
      clearTimeout(timer);
      webContents.removeListener('paint', onPaint);
      resolve();
    });
    // Trigger a repaint by invalidating
    webContents.invalidate();
  });
}

async function captureBrowserPage(url, deps) {
  const { sendLog, saveBufferToFile, saveScreenshotToDatabase, createThumbnailPreview,
          getMainWindow, getIsCapturing, setIsCapturing } = deps;

  let captureWin = null;
  let loadingToast = null;

  try {
    setIsCapturing(true);
    const mainWindow = getMainWindow();

    // Show loading toast immediately, then re-hide dock so app doesn't pop up
    loadingToast = showLoadingToast();
    if (process.platform === 'darwin' && app.dock) app.dock.hide();

    sendLog(`browserCapture: Loading URL: ${url}`);

    // offscreen: true enables headless rendering with paint events
    // show: false keeps it invisible — no window flashes
    captureWin = new BrowserWindow({
      show: false,
      width: 1280,
      height: 800,
      webPreferences: {
        offscreen: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    // Enable offscreen rendering at a good framerate
    captureWin.webContents.setFrameRate(30);

    // Load URL with timeout
    await Promise.race([
      captureWin.loadURL(url),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Page load timeout')), PAGE_LOAD_TIMEOUT)
      ),
    ]);

    sendLog('browserCapture: Page loaded, waiting for initial paint...');

    // Wait for the offscreen renderer to actually paint the page
    await waitForPaint(captureWin.webContents);

    sendLog('browserCapture: Initial paint received, forcing lazy images...');

    // Force lazy-loaded images to eager
    await captureWin.webContents.executeJavaScript(`
      (async () => {
        // Set all images to eager loading
        document.querySelectorAll('img').forEach(img => {
          img.loading = 'eager';
        });

        // Copy data-src variants to src
        document.querySelectorAll('img[data-src]').forEach(img => {
          if (!img.src || img.src.includes('placeholder') || img.src.includes('data:')) {
            img.src = img.dataset.src;
          }
        });
        document.querySelectorAll('img[data-lazy-src]').forEach(img => {
          if (!img.src || img.src.includes('placeholder') || img.src.includes('data:')) {
            img.src = img.dataset.lazySrc;
          }
        });
        document.querySelectorAll('img[data-original]').forEach(img => {
          if (!img.src || img.src.includes('placeholder') || img.src.includes('data:')) {
            img.src = img.dataset.original;
          }
        });
        document.querySelectorAll('[data-srcset]').forEach(el => {
          el.srcset = el.dataset.srcset;
        });

        // Scroll through entire page to trigger IntersectionObserver lazy loaders
        const scrollStep = window.innerHeight;
        const maxScroll = document.body.scrollHeight;
        for (let y = 0; y < maxScroll; y += scrollStep) {
          window.scrollTo(0, y);
          await new Promise(r => setTimeout(r, 100));
        }
        window.scrollTo(0, 0);
      })()
    `);

    // Wait for all images to fully download (Promise.all pattern)
    sendLog('browserCapture: Waiting for images to download...');
    await new Promise(r => setTimeout(r, SETTLE_DELAY));

    await captureWin.webContents.executeJavaScript(`
      Promise.all(
        Array.from(document.images).map(img => {
          if (img.complete) return Promise.resolve();
          return new Promise(res => {
            img.onload = img.onerror = res;
          });
        })
      ).then(() => true).catch(() => true)
    `);
    // Safety timeout fallback
    await new Promise(r => setTimeout(r, 500));

    // Wait for web fonts to finish loading
    sendLog('browserCapture: Waiting for web fonts...');
    await captureWin.webContents.executeJavaScript(`
      document.fonts.ready
    `);

    sendLog('browserCapture: Pre-capture cleanup pipeline...');

    // Step 1: Remove known cookie/consent/overlay elements by selector
    await captureWin.webContents.executeJavaScript(`
      (() => {
        const selectors = [
          '[class*="cookie"]', '[id*="cookie"]',
          '[class*="consent"]', '[id*="consent"]',
          '[class*="gdpr"]', '[id*="gdpr"]',
          '[class*="privacy"]', '[id*="privacy"]',
          '[class*="overlay"]', '[id*="overlay"]',
          '[class*="modal-backdrop"]', '[class*="backdrop"]',
          '[class*="onetrust"]', '#onetrust-banner-sdk', '#onetrust-consent-sdk',
          '[class*="cc-banner"]', '[class*="cc-window"]',
          '[id*="CybotCookiebot"]', '[class*="cmp-"]',
          '.fc-consent-root', '#sp_message_container',
        ];
        document.querySelectorAll(selectors.join(',')).forEach(el => el.remove());
      })()
    `);

    // Step 2: Hide ALL fixed/sticky elements and remove fullscreen overlays
    await captureWin.webContents.executeJavaScript(`
      (() => {
        document.querySelectorAll('*').forEach(el => {
          const style = getComputedStyle(el);

          // Remove fullscreen overlays (fixed elements covering >90% of viewport)
          if (style.position === 'fixed') {
            const isFullscreen = el.offsetWidth >= window.innerWidth * 0.9 &&
                                 el.offsetHeight >= window.innerHeight * 0.9;
            const hasDarkBg = style.backgroundColor.includes('rgba') ||
                              parseFloat(style.opacity) < 1;
            if (isFullscreen || hasDarkBg) {
              el.style.display = 'none';
              return;
            }
          }

          // Hide all fixed/sticky elements (headers, banners, floating buttons)
          if (style.position === 'fixed' || style.position === 'sticky') {
            el.dataset.captureHidden = 'true';
            el.style.visibility = 'hidden';
          }
        });

        // Remove modal-open class from body (many sites add this)
        document.body.classList.remove('modal-open', 'no-scroll', 'overflow-hidden');
        document.body.style.overflow = '';
        document.documentElement.style.overflow = '';
        document.body.style.position = '';
      })()
    `);

    // Step 3: Disable all CSS animations/transitions
    await captureWin.webContents.executeJavaScript(`
      (() => {
        const style = document.createElement('style');
        style.id = 'screenvault-capture-freeze';
        style.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; }';
        document.head.appendChild(style);
      })()
    `);

    // Step 4: Remove blurry CSS transforms (e.g. scale(0.9) makes text fuzzy)
    await captureWin.webContents.executeJavaScript(`
      (() => {
        document.querySelectorAll('*').forEach(el => {
          const t = getComputedStyle(el).transform;
          if (t && t !== 'none') {
            // Only remove scale/rotate transforms, keep translateZ for compositing
            if (!t.includes('matrix(1, 0, 0, 1, 0, 0)') && !t.includes('translateZ')) {
              el.style.transform = 'none';
            }
          }
        });
      })()
    `);

    // Step 6: Force GPU compositing layer flush
    await captureWin.webContents.executeJavaScript(`
      (() => {
        document.body.style.transform = 'translateZ(0)';
        document.body.offsetHeight; // force reflow
        document.body.style.transform = '';
      })()
    `);

    // Step 7: Wait for stable layout + repaint (requestIdleCallback for better timing)
    await captureWin.webContents.executeJavaScript(`
      new Promise(r => {
        if (typeof requestIdleCallback !== 'undefined') {
          requestIdleCallback(r, { timeout: 500 });
        } else {
          setTimeout(r, 300);
        }
      })
    `);
    await waitForPaint(captureWin.webContents, 3000);

    // Get page dimensions
    const pageHeight = await captureWin.webContents.executeJavaScript(
      'Math.min(document.body.scrollHeight, document.documentElement.scrollHeight, ' + MAX_PAGE_HEIGHT + ')'
    );
    const pageWidth = await captureWin.webContents.executeJavaScript(
      'Math.max(document.body.scrollWidth, document.documentElement.scrollWidth)'
    );

    sendLog(`browserCapture: Page dimensions: ${pageWidth}x${pageHeight}`);

    // Attach CDP and capture — NO clip parameter to avoid compositing layer bug
    captureWin.webContents.debugger.attach('1.3');

    // Set 2x device scale factor for Retina-quality capture (biggest quality boost)
    try {
      await captureWin.webContents.debugger.sendCommand(
        'Emulation.setDeviceMetricsOverride',
        {
          width: 0,             // 0 = keep current viewport width
          height: 0,            // 0 = keep current viewport height
          deviceScaleFactor: 2, // 2x for Retina sharpness
          mobile: false,
        }
      );
      sendLog('browserCapture: Set deviceScaleFactor to 2x for Retina capture');

      // Wait for repaint at new scale factor
      await waitForPaint(captureWin.webContents, 3000);
    } catch (dprErr) {
      sendLog(`browserCapture: DPR override failed (non-fatal): ${dprErr.message}`);
    }

    const result = await captureWin.webContents.debugger.sendCommand(
      'Page.captureScreenshot',
      {
        format: 'png',
        captureBeyondViewport: true,
      }
    );

    // Clear emulation override before detaching
    try {
      await captureWin.webContents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride');
    } catch {}

    captureWin.webContents.debugger.detach();

    const buffer = Buffer.from(result.data, 'base64');
    sendLog(`browserCapture: Screenshot captured, size: ${buffer.length} bytes`);

    captureWin.close();
    captureWin = null;

    // Dismiss loading toast
    if (loadingToast && !loadingToast.isDestroyed()) loadingToast.close();
    loadingToast = null;

    // Play screenshot sound
    execFile('afplay', [SCREENSHOT_SOUND], () => {});

    // Save using existing pipeline
    const filePath = saveBufferToFile(buffer);
    const img = nativeImage.createFromBuffer(buffer);
    clipboard.writeImage(img);
    saveScreenshotToDatabase(filePath, 'browser-capture');

    // Notify renderer (without showing the main window — let thumbnail preview be the only UI)
    mainWindow?.webContents?.send?.('screenshot-saved', { filePath });

    // Show thumbnail preview (this must come AFTER, and main window must NOT show)
    createThumbnailPreview(filePath);

    sendLog('browserCapture: Done!');
    setIsCapturing(false);
    if (process.platform === 'darwin' && app.dock) app.dock.show();
    return { success: true, filePath };

  } catch (err) {
    sendLog(`browserCapture: Error — ${err.message}`, 'error');

    if (loadingToast && !loadingToast.isDestroyed()) loadingToast.close();

    if (captureWin && !captureWin.isDestroyed()) {
      try { captureWin.webContents.debugger.detach(); } catch {}
      captureWin.close();
    }

    setIsCapturing(false);
    if (process.platform === 'darwin' && app.dock) app.dock.show();
    return { success: false, error: err.message };
  }
}

module.exports = { captureBrowserPage };
