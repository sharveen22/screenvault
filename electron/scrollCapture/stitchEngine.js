'use strict';

const { nativeImage } = require('electron');

/**
 * Stitch Engine v10 — Content-aware Row-MAD alignment.
 *
 * Key insight: text-heavy pages have 80%+ whitespace rows where luminance=255
 * everywhere. These rows give MAD=0 at ANY offset, creating false matches.
 *
 * Fix: pre-compute which rows have visual content (pixel range > threshold),
 * and only use content-bearing rows for alignment. This makes the MAD signal
 * come entirely from text/image rows where the correct offset is unambiguous.
 */

// ─── Frame loading ──────────────────────────────────────────────

function loadFrame(filePath) {
  const img = nativeImage.createFromPath(filePath);
  const logicalSize = img.getSize();
  const bitmap = img.toBitmap();
  const totalPixels = bitmap.length / 4;
  const scaleSq = totalPixels / (logicalSize.width * logicalSize.height);
  const scale = Math.round(Math.sqrt(scaleSq));
  const w = logicalSize.width * scale;
  const h = logicalSize.height * scale;

  // Pre-compute grayscale
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const px = i * 4;
    gray[i] = (bitmap[px] + bitmap[px + 1] * 2 + bitmap[px + 2]) >> 2;
  }

  // Pre-compute content rows: a row "has content" if its pixel range > 20
  const hasContent = new Uint8Array(h);
  for (let y = 0; y < h; y++) {
    const off = y * w;
    let mn = 255, mx = 0;
    // Sample every 4th pixel for speed
    for (let x = 0; x < w; x += 4) {
      const v = gray[off + x];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    hasContent[y] = (mx - mn > 20) ? 1 : 0;
  }

  return { width: w, height: h, data: Buffer.from(bitmap), gray, hasContent };
}

// ─── Pixel helpers ──────────────────────────────────────────────

function grayRowMAD(grayA, grayB, w, yA, yB) {
  const offA = yA * w;
  const offB = yB * w;
  let sum = 0;
  for (let x = 0; x < w; x++) {
    sum += Math.abs(grayA[offA + x] - grayB[offB + x]);
  }
  return sum / w;
}

function rowToGray(data, w, y, step = 2) {
  const out = new Uint8Array(Math.ceil(w / step));
  const rowOff = y * w * 4;
  for (let i = 0; i < out.length; i++) {
    const px = rowOff + i * step * 4;
    out[i] = (data[px] + data[px + 1] * 2 + data[px + 2]) >> 2;
  }
  return out;
}

function rowMAD(a, b) {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) sum += Math.abs(a[i] - b[i]);
  return sum / len;
}

// ─── Fixed-element detection ────────────────────────────────────

function detectFixedRows(frameA, frameB, sendLog) {
  const { width: w, height: h } = frameA;
  const threshold = 3.0;

  let topFixed = 0;
  for (let y = 0; y < Math.floor(h * 0.4); y++) {
    if (rowMAD(rowToGray(frameA.data, w, y, 2), rowToGray(frameB.data, w, y, 2)) < threshold) {
      topFixed = y + 1;
    } else break;
  }

  let bottomFixed = 0;
  for (let y = h - 1; y >= Math.floor(h * 0.6); y--) {
    if (rowMAD(rowToGray(frameA.data, w, y, 2), rowToGray(frameB.data, w, y, 2)) < threshold) {
      bottomFixed = h - y;
    } else break;
  }

  if (topFixed > 0 || bottomFixed > 0) {
    sendLog(`Fixed elements: top=${topFixed}px, bottom=${bottomFixed}px`);
  }
  return { topFixed, bottomFixed };
}

// ─── Same-position duplicate check ──────────────────────────────

/**
 * Check if two frames are the same by comparing ONLY content-bearing rows
 * at the same positions. Returns true if they're duplicates.
 */
function isSameFrame(frameA, frameB, scrollTop, scrollBottom) {
  const w = frameA.width;
  let totalMAD = 0;
  let contentRows = 0;

  for (let y = scrollTop; y < scrollBottom; y += 2) {
    // Only compare rows that have content in at least one frame
    if (!frameA.hasContent[y] && !frameB.hasContent[y]) continue;
    totalMAD += grayRowMAD(frameA.gray, frameB.gray, w, y, y);
    contentRows++;
  }

  if (contentRows < 5) return true; // Both frames are blank — treat as same
  return (totalMAD / contentRows) < 0.3;
}

// ─── Content-aware Row-MAD alignment ────────────────────────────

/**
 * Find scroll offset using only content-bearing rows for comparison.
 *
 * For each candidate scroll s, the overlap is regionH - s pixels.
 * We only compare rows where frame B has content (since B's top shows
 * what was below in A). This eliminates whitespace rows that cause
 * false MAD=0 matches.
 *
 * Minimum overlap: 15% of region height.
 */
function findScrollOffset(frameA, frameB, scrollTop, scrollBottom, sendLog) {
  const w = frameA.width;
  const regionH = scrollBottom - scrollTop;

  const minOverlap = Math.max(60, Math.floor(regionH * 0.15));
  const minScroll = 4;
  const maxScroll = regionH - minOverlap;

  // Pre-collect content rows in frame B's scrolling region
  // (these are the rows we'll match against frame A)
  const bContentRows = [];
  for (let r = 0; r < regionH; r++) {
    if (frameB.hasContent[scrollTop + r]) {
      bContentRows.push(r);
    }
  }

  if (bContentRows.length < 5) {
    sendLog(`  Only ${bContentRows.length} content rows in frame B — cannot align`);
    return -1;
  }

  // ── Coarse pass: step=2, content rows only ──
  let bestScroll = -1;
  let bestMAD = Infinity;

  for (let s = minScroll; s <= maxScroll; s += 2) {
    const overlapH = regionH - s;

    let madSum = 0;
    let madCount = 0;

    // Use content rows from B that fall within the overlap
    for (let idx = 0; idx < bContentRows.length; idx += 2) {
      const r = bContentRows[idx];
      if (r >= overlapH) break;

      const rowA = scrollTop + s + r;
      const rowB = scrollTop + r;

      madSum += grayRowMAD(frameA.gray, frameB.gray, w, rowA, rowB);
      madCount++;
    }
    if (madCount < 3) continue;

    const avgMAD = madSum / madCount;
    if (avgMAD < bestMAD) {
      bestMAD = avgMAD;
      bestScroll = s;
    }
  }

  if (bestScroll < 0) {
    sendLog(`  Row-MAD coarse: no valid candidates`);
    return -1;
  }

  // ── Fine pass: ±4, ALL content rows in overlap ──
  const fineMin = Math.max(minScroll, bestScroll - 4);
  const fineMax = Math.min(maxScroll, bestScroll + 4);

  for (let s = fineMin; s <= fineMax; s++) {
    const overlapH = regionH - s;

    let madSum = 0;
    let madCount = 0;

    for (const r of bContentRows) {
      if (r >= overlapH) break;

      const rowA = scrollTop + s + r;
      const rowB = scrollTop + r;

      madSum += grayRowMAD(frameA.gray, frameB.gray, w, rowA, rowB);
      madCount++;
    }
    if (madCount < 3) continue;

    const avgMAD = madSum / madCount;
    if (avgMAD < bestMAD) {
      bestMAD = avgMAD;
      bestScroll = s;
    }
  }

  sendLog(`  Row-MAD: scroll=${bestScroll}px, MAD=${bestMAD.toFixed(2)}, overlap=${regionH - bestScroll}px`);

  if (bestMAD > 5) {
    sendLog(`  Row-MAD rejected: MAD=${bestMAD.toFixed(2)} > 5`);
    return -1;
  }

  return bestScroll;
}

// ─── Main stitch pipeline ───────────────────────────────────────

async function stitchFrames(segments, opts = {}) {
  const sendLog = opts.sendLog || (() => {});

  if (segments.length === 0) throw new Error('No segments to stitch');
  if (segments.length === 1) return nativeImage.createFromPath(segments[0].path).toPNG();

  sendLog(`Loading ${segments.length} frames...`);
  const frames = segments.map(seg => loadFrame(seg.path));
  sendLog(`Loaded: ${frames[0].width}x${frames[0].height} each`);

  // Detect fixed header/footer
  let scrollTop = 0;
  let scrollBottom = frames[0].height;

  for (let i = 1; i < Math.min(frames.length, 15); i++) {
    const testMAD = rowMAD(
      rowToGray(frames[0].data, frames[0].width, Math.floor(frames[0].height / 2), 2),
      rowToGray(frames[i].data, frames[i].width, Math.floor(frames[i].height / 2), 2)
    );
    if (testMAD > 3) {
      const fixed = detectFixedRows(frames[0], frames[i], sendLog);
      scrollTop = fixed.topFixed;
      scrollBottom = frames[0].height - fixed.bottomFixed;
      break;
    }
  }
  sendLog(`Scrolling region: rows ${scrollTop}–${scrollBottom} (${scrollBottom - scrollTop}px)`);

  // ─── Content-aware Row-MAD alignment ──────────────────────────
  const fixedPadding = scrollTop + (frames[0].height - scrollBottom);
  const chain = [];

  let lastAligned = 0;

  for (let i = 1; i < frames.length; i++) {
    // Quick same-frame check using content rows only
    if (isSameFrame(frames[lastAligned], frames[i], scrollTop, scrollBottom)) {
      sendLog(`Frame ${i}: same as ${lastAligned}, skipping`);
      continue;
    }

    sendLog(`Aligning ${lastAligned} → ${i}...`);

    const scrollAmount = findScrollOffset(
      frames[lastAligned], frames[i],
      scrollTop, scrollBottom,
      sendLog
    );

    if (scrollAmount < 0) {
      sendLog(`  Alignment failed — skipping frame ${i}`);
      continue;
    }

    if (scrollAmount < 5) {
      sendLog(`  Scroll=${scrollAmount}px < 5, skipping`);
      continue;
    }

    // Compute full overlap (including fixed header/footer)
    const regionOverlap = (scrollBottom - scrollTop) - scrollAmount;
    const fullOverlap = regionOverlap + fixedPadding;

    const newRows = frames[i].height - fullOverlap;
    if (newRows < 3) {
      sendLog(`  Only ${newRows}px new content, skipping`);
      continue;
    }

    chain.push({ frameIdx: i, fullOverlap, newRows });
    lastAligned = i;
    sendLog(`  Accepted: scroll=${scrollAmount}px, ${newRows}px new`);
  }

  sendLog(`${chain.length + 1}/${frames.length} frames in final stitch`);

  if (chain.length === 0) {
    sendLog('No frames could be aligned — returning first frame');
    return nativeImage.createFromPath(segments[0].path).toPNG();
  }

  // Calculate canvas height
  const frameW = frames[0].width;
  let totalH = frames[0].height;
  for (const c of chain) totalH += c.newRows;

  sendLog(`Canvas: ${frameW}x${totalH}`);
  if (frameW * totalH > 200_000_000) throw new Error('Canvas too large (>200MP)');

  // Composite
  const BLEND_PX = 24;
  const canvas = Buffer.alloc(totalH * frameW * 4, 255);
  frames[0].data.copy(canvas, 0, 0, frames[0].height * frameW * 4);
  let cursorY = frames[0].height;

  for (const { frameIdx, fullOverlap, newRows } of chain) {
    const frame = frames[frameIdx];

    frame.data.copy(canvas, cursorY * frameW * 4, fullOverlap * frameW * 4, frame.height * frameW * 4);

    const blendRows = Math.min(BLEND_PX, fullOverlap, newRows);
    if (blendRows > 2 && fullOverlap > 0) {
      const blendStartY = cursorY - blendRows;
      for (let row = 0; row < blendRows; row++) {
        const alpha = (row + 1) / (blendRows + 1);
        const cOff = (blendStartY + row) * frameW * 4;
        const fOff = (fullOverlap - blendRows + row) * frameW * 4;
        for (let px = 0; px < frameW * 4; px += 4) {
          canvas[cOff + px]     = Math.round(canvas[cOff + px]     * (1 - alpha) + frame.data[fOff + px]     * alpha);
          canvas[cOff + px + 1] = Math.round(canvas[cOff + px + 1] * (1 - alpha) + frame.data[fOff + px + 1] * alpha);
          canvas[cOff + px + 2] = Math.round(canvas[cOff + px + 2] * (1 - alpha) + frame.data[fOff + px + 2] * alpha);
          canvas[cOff + px + 3] = 255;
        }
      }
    }

    cursorY += newRows;
  }

  const finalBuf = canvas.subarray(0, cursorY * frameW * 4);
  sendLog(`Compositing complete: ${frameW}x${cursorY}`);

  const img = nativeImage.createFromBitmap(finalBuf, { width: frameW, height: cursorY });
  const pngBuffer = img.toPNG();
  sendLog(`Final PNG: ${pngBuffer.length} bytes`);
  return pngBuffer;
}

module.exports = { stitchFrames };
