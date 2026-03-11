'use strict';

const { app, globalShortcut, ipcMain, nativeImage, clipboard } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const { captureStableFrame, captureFrame, sleep } = require('./frameCollector');
const { stitchFrames } = require('./stitchEngine');

/**
 * Capture Controller — orchestrates the full scrolling screenshot pipeline.
 *
 * Two-phase architecture:
 *
 *   Phase 1 — RAPID CAPTURE: user scrolls manually, frames captured at ~10fps.
 *   Phase 2 — ROW-MAD STITCHING: content-aware alignment using only content-bearing
 *             rows (ignores whitespace), then composites with alpha blending.
 */

async function takeScrollingScreenshot(deps) {
  const {
    sendLog,
    showRegionSelector,
    showScrollCaptureProgress,
    updateProgressWindow,
    showCaptureBorder,
    saveBufferToFile,
    saveScreenshotToDatabase,
    createThumbnailPreview,
    getMainWindow,
    getIsCapturing,
    setIsCapturing
  } = deps;

  if (getIsCapturing()) return;
  setIsCapturing(true);

  let progressWin = null;
  let borderWins = [];
  let cancelled = false;
  let donePressed = false;
  const tempFiles = [];

  const debugDir = path.join(app.getPath('userData'), 'scroll-debug');
  try { fs.mkdirSync(debugDir, { recursive: true }); } catch {}
  try { for (const f of fs.readdirSync(debugDir)) fs.unlinkSync(path.join(debugDir, f)); } catch {}

  try {
    // 1. Hide ScreenVault windows
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
    if (process.platform === 'darwin') app.dock.hide();

    // 2. Region selection
    const region = await showRegionSelector();
    if (!region) {
      sendLog('Scrolling capture: region selection cancelled');
      return;
    }
    sendLog(`Scrolling capture: region x=${region.x} y=${region.y} w=${region.width} h=${region.height}`);

    // 3. Setup
    const maxRawFrames = 300;
    const captureIntervalMs = 100; // ~10 fps rapid capture

    // 4. Show capture border + progress
    borderWins = showCaptureBorder(region);
    progressWin = showScrollCaptureProgress(region);
    await sleep(200);

    cancelled = false;
    donePressed = false;

    const doneHandler = (_event, data) => {
      if (data && data.x === 0 && data.y === 0 && data.w === 0 && data.h === 0) {
        donePressed = true;
        ipcMain.removeListener('region-selected', doneHandler);
        sendLog('Scrolling capture: Done pressed by user');
      }
    };
    ipcMain.on('region-selected', doneHandler);

    globalShortcut.register('Escape', () => {
      cancelled = true;
      globalShortcut.unregister('Escape');
      ipcMain.removeListener('region-selected', doneHandler);
      sendLog('Scrolling capture: cancelled by user');
    });

    // ============================================================
    // PHASE 1: RAPID CAPTURE (user scrolls manually)
    // ============================================================
    const rawFrames = [];

    // Initial frame — use stable capture to ensure clean baseline
    const initialPath = await captureStableFrame(region, 800);
    if (!initialPath) {
      sendLog('Scrolling capture: initial capture failed', 'error');
      return;
    }
    tempFiles.push(initialPath);
    rawFrames.push({ path: initialPath, timestamp: Date.now() });
    try { fs.copyFileSync(initialPath, path.join(debugDir, 'raw_000.png')); } catch {}
    sendLog('Scrolling capture: initial frame captured — scroll now, press Done when finished');
    updateProgressWindow(progressWin, 0);

    let consecutiveIdentical = 0;

    for (let i = 1; i < maxRawFrames; i++) {
      if (cancelled || donePressed) break;

      // Rapid single capture — no stabilization, no auto-scroll
      const capPath = await captureFrame(region);
      if (!capPath) continue;
      tempFiles.push(capPath);
      rawFrames.push({ path: capPath, timestamp: Date.now() });

      updateProgressWindow(progressWin, rawFrames.length - 1);

      // End-of-page detection: consecutive identical frames
      if (rawFrames.length >= 3) {
        const lastPath = rawFrames[rawFrames.length - 1].path;
        const prevPath = rawFrames[rawFrames.length - 2].path;
        try {
          const lastBuf = fs.readFileSync(lastPath);
          const prevBuf = fs.readFileSync(prevPath);
          if (lastBuf.length === prevBuf.length && lastBuf.equals(prevBuf)) {
            consecutiveIdentical++;
            if (consecutiveIdentical >= 5) {
              sendLog('Scrolling capture: no movement detected for 5 frames');
            }
          } else {
            consecutiveIdentical = 0;
          }
        } catch {}
      }

      // Brief pause to avoid overwhelming CPU (~10 fps)
      await sleep(captureIntervalMs);
    }

    try { globalShortcut.unregister('Escape'); } catch {}
    ipcMain.removeListener('region-selected', doneHandler);

    for (const bw of borderWins) {
      if (bw && !bw.isDestroyed()) bw.close();
    }
    borderWins = [];

    if ((cancelled && !donePressed) || rawFrames.length === 0) {
      sendLog('Scrolling capture: aborted, cleaning up');
      return;
    }

    // Play macOS screenshot sound
    const screenshotSound = '/System/Library/Components/CoreAudio.component/Contents/SharedSupport/SystemSounds/system/Screen Capture.aif';
    execFile('afplay', [screenshotSound], () => {});

    sendLog(`Scrolling capture: Phase 1 complete — ${rawFrames.length} raw frames captured`);

    // ============================================================
    // PHASE 2: ROW-MAD STITCHING
    // ============================================================

    if (progressWin && !progressWin.isDestroyed()) {
      progressWin.webContents.executeJavaScript(
        `document.getElementById('status-text').textContent = 'Compiling';
         document.getElementById('done-btn').style.display = 'none';`
      ).catch(() => {});
    }

    // Save debug copies
    for (let i = 0; i < rawFrames.length; i++) {
      try {
        fs.copyFileSync(rawFrames[i].path, path.join(debugDir, `raw_${String(i).padStart(3, '0')}.png`));
      } catch {}
    }

    // Build segments array — just paths, the stitch engine handles alignment
    const segments = rawFrames.map(f => ({ path: f.path }));

    let finalBuffer;
    if (segments.length === 1) {
      finalBuffer = fs.readFileSync(segments[0].path);
    } else {
      finalBuffer = await stitchFrames(segments, { sendLog });
    }

    sendLog(`Scrolling capture: final ${finalBuffer.length} bytes from ${rawFrames.length} raw frames`);

    // Save and enter existing pipeline
    const filePath = saveBufferToFile(finalBuffer);

    try {
      const img = nativeImage.createFromPath(filePath);
      clipboard.writeImage(img);
      sendLog('Scrolling screenshot copied to clipboard');
    } catch (e) {
      sendLog(`Clipboard copy failed: ${e}`, 'error');
    }

    const savedId = saveScreenshotToDatabase(filePath, 'scrolling-capture');
    createThumbnailPreview(filePath);

    if (progressWin && !progressWin.isDestroyed()) {
      progressWin.close();
      progressWin = null;
    }

    const mw = getMainWindow();
    if (mw && !mw.isDestroyed()) {
      mw.webContents.send('screenshot-saved', { id: savedId });
    }

  } catch (err) {
    sendLog(`Scrolling screenshot error: ${err.stack || err}`, 'error');
  } finally {
    setIsCapturing(false);
    try { globalShortcut.unregister('Escape'); } catch {}

    for (const bw of borderWins) {
      if (bw && !bw.isDestroyed()) bw.close();
    }

    if (progressWin && !progressWin.isDestroyed()) {
      progressWin.close();
    }

    for (const f of tempFiles) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
    }

    // Always restore dock and main window
    if (process.platform === 'darwin') app.dock.show();
    const mainWin = getMainWindow();
    if (mainWin && !mainWin.isDestroyed()) mainWin.show();
  }
}

module.exports = { takeScrollingScreenshot };
