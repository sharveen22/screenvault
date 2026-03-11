'use strict';

const { nativeImage } = require('electron');

/**
 * Overlap Detection — finds how many rows overlap between consecutive frames.
 *
 * Strategy: NCC (Normalized Cross-Correlation) with multi-strip validation.
 *
 *   1. Convert frames to greyscale → apply Sobel edge detection
 *   2. Extract 3 reference strips from frame A at different vertical positions
 *   3. Coarse pass: slide primary strip against frame B (stride 4) → keep top 5 candidates
 *   4. Fine pass: refine each candidate to pixel precision (±8px)
 *   5. Multi-strip validation: verify each candidate with 2 additional strips
 *   6. Combined score ranking with RGB MAD validation
 *
 * NCC is far more robust than MAD (Mean Absolute Difference) for matching
 * because it normalizes for brightness variations and provides a 0..1 score
 * where values above 0.75 indicate strong matches.
 *
 * Multi-strip validation prevents false matches on repeating content (paragraphs,
 * list items, similar code blocks) by requiring consistency across 3 positions.
 *
 * Margin masking: excludes right 15% (scrollbar) and left 5% (edge artifacts).
 * Unstable zone: ignores top/bottom 60px of each frame (scroll animation artifacts).
 */

const STRIP_HEIGHT = 200;            // Primary reference strip height
const VALIDATION_STRIP_HEIGHT = 120; // Validation strip height
const UNSTABLE_ZONE = 60;            // Pixels to ignore at top/bottom of frames
const TOP_N_CANDIDATES = 5;          // Number of coarse-pass candidates to refine
const MIN_NCC = 0.65;                // Minimum NCC for primary strip to be a candidate
const MIN_VALIDATION_NCC = 0.55;     // Minimum NCC for validation strips
const MAX_MAD = 40;                  // Maximum RGB MAD for final validation

/**
 * Load a PNG and return { width, height, bitmap } with physical pixel dimensions.
 */
function loadFrame(filePath) {
  const img = nativeImage.createFromPath(filePath);
  const logicalSize = img.getSize();
  const bitmap = img.toBitmap();

  const totalPixels = bitmap.length / 4;
  const scaleSq = totalPixels / (logicalSize.width * logicalSize.height);
  const scale = Math.round(Math.sqrt(scaleSq));
  const width = logicalSize.width * scale;
  const height = logicalSize.height * scale;

  return { width, height, bitmap };
}

/**
 * Convert RGBA bitmap to greyscale Float32Array.
 */
function toGreyscale(bitmap, width, height) {
  const grey = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const bi = i * 4;
    grey[i] = 0.299 * bitmap[bi] + 0.587 * bitmap[bi + 1] + 0.114 * bitmap[bi + 2];
  }
  return grey;
}

/**
 * Apply Sobel edge detection.
 */
function sobelEdges(grey, width, height) {
  const edges = new Float32Array(width * height);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const gx =
        -grey[(y - 1) * width + (x - 1)] + grey[(y - 1) * width + (x + 1)]
        - 2 * grey[y * width + (x - 1)] + 2 * grey[y * width + (x + 1)]
        - grey[(y + 1) * width + (x - 1)] + grey[(y + 1) * width + (x + 1)];

      const gy =
        -grey[(y - 1) * width + (x - 1)] - 2 * grey[(y - 1) * width + x] - grey[(y - 1) * width + (x + 1)]
        + grey[(y + 1) * width + (x - 1)] + 2 * grey[(y + 1) * width + x] + grey[(y + 1) * width + (x + 1)];

      edges[y * width + x] = Math.sqrt(gx * gx + gy * gy);
    }
  }

  return edges;
}

/**
 * Normalized Cross-Correlation between a reference strip in A and a position in B.
 *
 * NCC = Σ((a - μa)(b - μb)) / √(Σ(a - μa)² × Σ(b - μb)²)
 *
 * Returns 0..1 (1 = perfect match). Returns 0 for flat/zero-variance regions.
 */
function compareStripNCC(dataA, dataB, width, stripStartA, stripHeight, posB, xStart, xEnd, xStep, rowStep) {
  // Pass 1: compute means
  let sumA = 0, sumB = 0, count = 0;

  for (let r = 0; r < stripHeight; r += rowStep) {
    const aBase = (stripStartA + r) * width;
    const bBase = (posB + r) * width;

    for (let x = xStart; x < xEnd; x += xStep) {
      sumA += dataA[aBase + x];
      sumB += dataB[bBase + x];
      count++;
    }
  }

  if (count === 0) return 0;

  const meanA = sumA / count;
  const meanB = sumB / count;

  // Pass 2: compute NCC
  let sumAB = 0, sumAA = 0, sumBB = 0;

  for (let r = 0; r < stripHeight; r += rowStep) {
    const aBase = (stripStartA + r) * width;
    const bBase = (posB + r) * width;

    for (let x = xStart; x < xEnd; x += xStep) {
      const da = dataA[aBase + x] - meanA;
      const db = dataB[bBase + x] - meanB;
      sumAB += da * db;
      sumAA += da * da;
      sumBB += db * db;
    }
  }

  const denom = Math.sqrt(sumAA * sumBB);
  if (denom < 0.001) return 0; // flat region — no confidence

  return Math.max(0, sumAB / denom);
}

/**
 * Compare using raw RGB pixels — returns MAD per sample (lower = better).
 */
function compareStripRGB(bmpA, bmpB, width, stripStartA, stripHeight, posB, xStart, xEnd, xStep, rowStep) {
  let totalDiff = 0;
  let samples = 0;

  for (let r = 0; r < stripHeight; r += rowStep) {
    const aBase = (stripStartA + r) * width * 4;
    const bBase = (posB + r) * width * 4;

    for (let x = xStart; x < xEnd; x += xStep) {
      const ai = aBase + x * 4;
      const bi = bBase + x * 4;
      totalDiff += Math.abs(bmpA[ai] - bmpB[bi])
                 + Math.abs(bmpA[ai + 1] - bmpB[bi + 1])
                 + Math.abs(bmpA[ai + 2] - bmpB[bi + 2]);
      samples++;
    }
  }

  return samples > 0 ? totalDiff / samples : Infinity;
}

/**
 * Detect overlap between two consecutive frame images.
 *
 * Algorithm:
 *   1. Extract 3 reference strips from frame A at different vertical positions
 *   2. Coarse pass with primary strip → top N candidates
 *   3. Fine pass on each candidate
 *   4. Multi-strip validation on each candidate
 *   5. Best combined score wins
 */
async function detectOverlap(prevPath, newPath, opts = {}) {
  const sendLog = opts.sendLog || (() => {});

  const prev = loadFrame(prevPath);
  const next = loadFrame(newPath);

  const width = prev.width;
  const prevHeight = prev.height;
  const newHeight = next.height;
  const prevBmp = prev.bitmap;
  const newBmp = next.bitmap;

  sendLog(`overlapDetect: ${width}x${prevHeight} -> ${width}x${newHeight}`);

  if (width <= 0 || prevHeight <= 0 || newHeight <= 0) {
    return { overlapRows: 0, isIdentical: false, stickyRows: 0, movedPx: 0, score: 0, confidence: 0 };
  }

  // Check identical frames
  if (prevBmp.length === newBmp.length && prevBmp.equals(newBmp)) {
    sendLog('overlapDetect: identical frames — bottom reached');
    return { overlapRows: 0, isIdentical: true, stickyRows: 0, movedPx: 0, score: 1.0, confidence: 1 };
  }

  // Detect sticky header
  const minFrameH = Math.min(prevHeight, newHeight);
  const maxStickyRows = Math.floor(minFrameH * 0.15);
  const rawStickyRows = detectStickyHeader(prevBmp, newBmp, width, minFrameH);
  const stickyRows = Math.min(rawStickyRows, maxStickyRows);
  if (stickyRows > 0) sendLog(`overlapDetect: ${stickyRows} sticky header rows`);

  // Margin masking
  const xStart = Math.floor(width * 0.05);
  const xEnd = Math.floor(width * 0.85);

  // Unstable zone (scale-aware)
  const unstable = Math.min(UNSTABLE_ZONE, Math.floor(minFrameH * 0.08));

  // Available space in frame A for strips
  const availableA = prevHeight - unstable * 2;
  const stripH = Math.min(STRIP_HEIGHT, Math.floor(availableA * 0.35));
  const valStripH = Math.min(VALIDATION_STRIP_HEIGHT, Math.floor(availableA * 0.20));

  if (stripH < 30) {
    sendLog('overlapDetect: frame too small for overlap detection');
    return { overlapRows: 0, isIdentical: false, stickyRows, movedPx: 0, score: 0, confidence: 0 };
  }

  // Define 3 reference strips in frame A
  //   Strip 1 (primary): bottom of A, above unstable zone
  //   Strip 2 (validation): 40% higher than strip 1
  //   Strip 3 (validation): 20% higher than strip 1
  const strip1Start = prevHeight - unstable - stripH;
  const gap = strip1Start - unstable - stickyRows; // available space above strip 1
  const strip2Start = Math.max(unstable + stickyRows, strip1Start - Math.floor(gap * 0.6));
  const strip3Start = Math.max(unstable + stickyRows, strip1Start - Math.floor(gap * 0.3));

  // Search range in frame B
  const searchStartB = Math.max(stickyRows, unstable);
  const searchEndB = Math.min(newHeight - stripH - unstable, Math.floor(newHeight * 0.85));

  // Constrain by opts
  const maxMove = opts.maxMove || (prevHeight * 0.8);
  const minMove = opts.minMove || 0;

  if (searchStartB >= searchEndB) {
    sendLog('overlapDetect: search range too small');
    return { overlapRows: 0, isIdentical: false, stickyRows, movedPx: 0, score: 0, confidence: 0 };
  }

  sendLog(`overlapDetect: strip1=${strip1Start}..${strip1Start + stripH}, strip2=${strip2Start}..${strip2Start + valStripH}, strip3=${strip3Start}..${strip3Start + valStripH}, searchB=${searchStartB}..${searchEndB}`);

  // Compute edge maps
  const prevGrey = toGreyscale(prevBmp, width, prevHeight);
  const nextGrey = toGreyscale(newBmp, width, newHeight);
  const prevEdges = sobelEdges(prevGrey, width, prevHeight);
  const nextEdges = sobelEdges(nextGrey, width, newHeight);

  // Helper: compute overlap and movedPx from a posB match
  function getOverlap(posB) {
    const overlap = prevHeight - strip1Start + posB;
    const moved = prevHeight - overlap;
    return { overlap, moved };
  }

  // --- Pass 1: Coarse scan with primary strip (NCC on edges, stride 4) ---
  const candidates = [];

  for (let posB = searchStartB; posB <= searchEndB; posB += 4) {
    // Check move constraints
    const { moved } = getOverlap(posB);
    if (moved < minMove || moved > maxMove) continue;

    const ncc = compareStripNCC(prevEdges, nextEdges, width, strip1Start, stripH, posB, xStart, xEnd, 6, 3);

    if (ncc >= MIN_NCC) {
      // Insert into sorted candidates, keep top N
      candidates.push({ posB, ncc });
      candidates.sort((a, b) => b.ncc - a.ncc);
      if (candidates.length > TOP_N_CANDIDATES) candidates.length = TOP_N_CANDIDATES;
    }
  }

  sendLog(`overlapDetect: coarse pass found ${candidates.length} candidates`);

  if (candidates.length === 0) {
    // Fall back to greyscale NCC if edges produced nothing (flat content)
    sendLog('overlapDetect: no edge candidates, trying greyscale NCC');
    for (let posB = searchStartB; posB <= searchEndB; posB += 4) {
      const { moved } = getOverlap(posB);
      if (moved < minMove || moved > maxMove) continue;

      const ncc = compareStripNCC(prevGrey, nextGrey, width, strip1Start, stripH, posB, xStart, xEnd, 6, 3);

      if (ncc >= MIN_NCC) {
        candidates.push({ posB, ncc });
        candidates.sort((a, b) => b.ncc - a.ncc);
        if (candidates.length > TOP_N_CANDIDATES) candidates.length = TOP_N_CANDIDATES;
      }
    }
    sendLog(`overlapDetect: greyscale coarse found ${candidates.length} candidates`);
  }

  if (candidates.length === 0) {
    sendLog('overlapDetect: no candidates found');
    return { overlapRows: 0, isIdentical: false, stickyRows, movedPx: 0, score: 0, confidence: 0 };
  }

  // --- Pass 2: Fine refinement (±8px around each candidate) ---
  for (const c of candidates) {
    const fineStart = Math.max(c.posB - 8, searchStartB);
    const fineEnd = Math.min(c.posB + 8, searchEndB);

    for (let posB = fineStart; posB <= fineEnd; posB++) {
      const ncc = compareStripNCC(prevEdges, nextEdges, width, strip1Start, stripH, posB, xStart, xEnd, 4, 2);
      if (ncc > c.ncc) {
        c.ncc = ncc;
        c.posB = posB;
      }
    }
  }

  // --- Pass 3: Multi-strip validation ---
  let bestCandidate = null;
  let bestCombined = -1;
  let secondBestCombined = -1;

  for (const c of candidates) {
    // The offset from strip1Start to posB tells us the translation.
    // For validation strips at different positions in A, the corresponding
    // position in B is: posB + (validStripStart - strip1Start)
    const offset2 = strip2Start - strip1Start;
    const offset3 = strip3Start - strip1Start;
    const posB2 = c.posB + offset2;
    const posB3 = c.posB + offset3;

    let ncc2 = 0, ncc3 = 0;

    // Only validate if the derived positions are within frame B bounds
    if (posB2 >= 0 && posB2 + valStripH <= newHeight) {
      ncc2 = compareStripNCC(prevEdges, nextEdges, width, strip2Start, valStripH, posB2, xStart, xEnd, 4, 2);
    }
    if (posB3 >= 0 && posB3 + valStripH <= newHeight) {
      ncc3 = compareStripNCC(prevEdges, nextEdges, width, strip3Start, valStripH, posB3, xStart, xEnd, 4, 2);
    }

    // Count how many strips pass the validation threshold
    const passCount = (c.ncc >= MIN_NCC ? 1 : 0) + (ncc2 >= MIN_VALIDATION_NCC ? 1 : 0) + (ncc3 >= MIN_VALIDATION_NCC ? 1 : 0);

    // Combined score: weighted average
    const combined = 0.5 * c.ncc + 0.25 * ncc2 + 0.25 * ncc3;

    c.ncc2 = ncc2;
    c.ncc3 = ncc3;
    c.combined = combined;
    c.passCount = passCount;

    if (combined > bestCombined) {
      secondBestCombined = bestCombined;
      bestCombined = combined;
      bestCandidate = c;
    } else if (combined > secondBestCombined) {
      secondBestCombined = combined;
    }
  }

  if (!bestCandidate) {
    sendLog('overlapDetect: no valid candidate after multi-strip validation');
    return { overlapRows: 0, isIdentical: false, stickyRows, movedPx: 0, score: 0, confidence: 0 };
  }

  // Require at least 2 of 3 strips to pass
  if (bestCandidate.passCount < 2) {
    sendLog(`overlapDetect: best candidate only passed ${bestCandidate.passCount}/3 strips (NCC1=${bestCandidate.ncc.toFixed(3)}, NCC2=${bestCandidate.ncc2.toFixed(3)}, NCC3=${bestCandidate.ncc3.toFixed(3)})`);
    return { overlapRows: 0, isIdentical: false, stickyRows, movedPx: 0, score: 0, confidence: 0 };
  }

  // RGB validation
  const { overlap, moved } = getOverlap(bestCandidate.posB);
  const rgbDiff = compareStripRGB(prevBmp, newBmp, width, strip1Start, stripH, bestCandidate.posB, xStart, xEnd, 4, 2);
  const mad = rgbDiff / 3;

  const confidence = secondBestCombined > 0
    ? Math.min(1, (bestCombined - secondBestCombined) / (bestCombined + 0.001))
    : 1;

  sendLog(`overlapDetect: best posB=${bestCandidate.posB}, overlap=${overlap}, moved=${moved}px, NCC=[${bestCandidate.ncc.toFixed(3)},${bestCandidate.ncc2.toFixed(3)},${bestCandidate.ncc3.toFixed(3)}], combined=${bestCombined.toFixed(3)}, MAD=${mad.toFixed(1)}, confidence=${confidence.toFixed(3)}`);

  if (overlap > 0 && moved > 0 && moved < prevHeight && mad < MAX_MAD) {
    sendLog(`overlapDetect: MATCH overlap=${overlap}, moved=${moved}px`);
    return {
      overlapRows: overlap,
      isIdentical: false,
      stickyRows,
      movedPx: moved,
      score: 1.0 - (mad / 255.0),
      confidence
    };
  }

  // If MAD is too high but NCC is strong, still accept with lower confidence
  // (this handles cases where rendering differences cause MAD to spike but alignment is correct)
  if (overlap > 0 && moved > 0 && moved < prevHeight && mad < 80 && bestCombined > 0.80) {
    sendLog(`overlapDetect: MATCH (high MAD but strong NCC) overlap=${overlap}, moved=${moved}px, MAD=${mad.toFixed(1)}`);
    return {
      overlapRows: overlap,
      isIdentical: false,
      stickyRows,
      movedPx: moved,
      score: 1.0 - (mad / 255.0),
      confidence: confidence * 0.5 // reduce confidence for high-MAD matches
    };
  }

  sendLog(`overlapDetect: rejected (MAD=${mad.toFixed(1)}, combined=${bestCombined.toFixed(3)})`);
  return { overlapRows: 0, isIdentical: false, stickyRows, movedPx: 0, score: 0, confidence: 0 };
}

/**
 * Detect sticky header: consecutive rows from top nearly identical across frames.
 */
function detectStickyHeader(prevBmp, newBmp, width, height) {
  const maxCheck = Math.floor(height * 0.25);
  const xStart = Math.floor(width * 0.15);
  const xEnd = Math.floor(width * 0.85);
  const step = 3;

  let stickyRows = 0;
  let gapRows = 0;

  for (let y = 0; y < maxCheck; y++) {
    const rowBase = y * width * 4;
    let matches = 0;
    let samples = 0;

    for (let x = xStart; x < xEnd; x += step) {
      const pi = rowBase + x * 4;
      samples++;
      const diff = Math.abs(prevBmp[pi] - newBmp[pi])
                 + Math.abs(prevBmp[pi + 1] - newBmp[pi + 1])
                 + Math.abs(prevBmp[pi + 2] - newBmp[pi + 2]);
      if (diff <= 24) {
        matches++;
      }
    }

    if (samples > 0 && (matches / samples) > 0.92) {
      stickyRows = y + 1;
      gapRows = 0;
    } else {
      gapRows++;
      if (gapRows > 3) break;
    }
  }

  return stickyRows;
}

/**
 * Check if two frames are nearly identical (for duplicate detection).
 */
async function framesNearlyIdentical(pathA, pathB) {
  const a = loadFrame(pathA);
  const b = loadFrame(pathB);

  if (a.bitmap.length !== b.bitmap.length) return false;

  const step = 200;
  let totalDiff = 0;
  let samples = 0;

  for (let i = 0; i < a.bitmap.length; i += step) {
    totalDiff += Math.abs(a.bitmap[i] - b.bitmap[i]);
    samples++;
  }

  const mad = totalDiff / samples;
  return mad < 3;
}

module.exports = {
  detectOverlap,
  detectStickyHeader,
  framesNearlyIdentical
};
