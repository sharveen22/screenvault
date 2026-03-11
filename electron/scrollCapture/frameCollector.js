'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Frame Collector — captures screen region frames using macOS `screencapture -R`.
 *
 * This captures EXTERNAL applications (any visible window), not Electron webContents.
 * Retina displays: screencapture uses screen-point coordinates but outputs physical pixels.
 */

/**
 * Capture a specific screen region to a PNG file.
 * @param {number} x - screen x (points)
 * @param {number} y - screen y (points)
 * @param {number} width - region width (points)
 * @param {number} height - region height (points)
 * @param {string} outputPath - where to save the PNG
 * @returns {Promise<string|null>} outputPath on success, null on failure
 */
function captureRegion(x, y, width, height, outputPath) {
  return new Promise((resolve) => {
    const p = spawn('screencapture', [
      '-R', `${x},${y},${width},${height}`,
      '-x', // no sound
      outputPath
    ]);
    p.on('close', (code) => {
      resolve(code === 0 && fs.existsSync(outputPath) ? outputPath : null);
    });
    p.on('error', () => resolve(null));
  });
}

/**
 * Capture a frame and wait for render to stabilize.
 * Takes two quick captures; if they match, the render is stable.
 * @param {object} region - { x, y, width, height }
 * @param {number} [maxWaitMs=1500] - max time to wait for stability
 * @returns {Promise<string|null>} path to stable capture, or null
 */
async function captureStableFrame(region, maxWaitMs = 1500) {
  const tmpA = path.join(os.tmpdir(), `sv_stable_a_${Date.now()}.png`);
  const tmpB = path.join(os.tmpdir(), `sv_stable_b_${Date.now()}.png`);

  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    await captureRegion(region.x, region.y, region.width, region.height, tmpA);
    await sleep(120);
    await captureRegion(region.x, region.y, region.width, region.height, tmpB);

    if (filesIdentical(tmpA, tmpB)) {
      try { fs.unlinkSync(tmpA); } catch {}
      return tmpB;
    }
  }
  // Timeout — return latest capture
  try { fs.unlinkSync(tmpA); } catch {}
  return tmpB;
}

/**
 * Quick single-frame capture (no stabilization).
 * @param {object} region - { x, y, width, height }
 * @param {string} [outputPath] - optional output path
 * @returns {Promise<string|null>}
 */
async function captureFrame(region, outputPath) {
  const outPath = outputPath || path.join(os.tmpdir(), `sv_frame_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.png`);
  return captureRegion(region.x, region.y, region.width, region.height, outPath);
}

function filesIdentical(pathA, pathB) {
  try {
    const a = fs.readFileSync(pathA);
    const b = fs.readFileSync(pathB);
    return a.length === b.length && a.equals(b);
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  captureRegion,
  captureStableFrame,
  captureFrame,
  sleep
};
