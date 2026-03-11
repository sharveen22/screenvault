# ScreenVault - Complete Context Document

Last updated: March 10, 2026

---

## App Overview

**ScreenVault** is an Electron-based macOS screenshot management application that captures, organizes, and searches screenshots with OCR capabilities.

### Core Functionality
- **Screenshot Capture:** Cmd+Shift+S triggers native macOS screenshot tool
- **Fullscreen Capture:** Cmd+Shift+D captures entire screen instantly
- **Scrolling Screenshot:** Cmd+Shift+W captures scrollable content (manual scroll + stitch)
- **Browser Full-Page Capture:** Auto-detects Chromium browsers and captures full page via CDP
- **Apple-Style Thumbnail Preview:** Small preview appears in bottom-left corner after capture
- **Auto-Save:** Screenshots auto-save after 6 seconds if not clicked
- **Auto-Clipboard:** Screenshots automatically copied to clipboard for immediate pasting
- **Editor Window:** Click thumbnail to open annotation editor
- **OCR Processing:** Automatic text extraction using Tesseract.js with smart 3-phase tag generation
- **Smart Filenames:** OCR-generated filenames sync to local folder
- **Import Screenshots/Folders:** Import existing screenshots or entire folders
- **Smart Organization:** Folders (including nested subfolders), favorites, tags, and search
- **Sort Screenshots:** Sort by newest/oldest with dropdown
- **Advanced Editor:** Annotate screenshots with pen, text, shapes, arrows, crop
- **Drag-and-Drop:** Drag screenshots to external apps and between folders
- **Folder Access:** Quick access button to open local screenshots folder
- **Local Storage:** SQLite database + file system (~/Pictures/ScreenVault/)
- **System Integration:** Menu bar tray icon, global shortcuts, notifications

### Keyboard Shortcuts
| Shortcut | Action |
|----------|--------|
| Cmd+Shift+S | Interactive screenshot (native macOS tool) |
| Cmd+Shift+D | Fullscreen screenshot |
| Cmd+Shift+W | Scrolling screenshot |
| Cmd+Shift+A | Show/focus ScreenVault app |
| Cmd+R | Refresh gallery |

---

## Scrolling Screenshot Architecture

### How It Works (Current — March 2026)

**Two-phase pipeline:**

1. **Phase 1 — Rapid Manual Capture:** User selects a region, then scrolls manually. The app captures frames rapidly (~10 fps using `captureFrame`) until user presses Done or Escape. No auto-scrolling — user controls the scroll entirely.

2. **Phase 2 — Content-Aware Stitching:** The stitch engine (v10) aligns and composites all captured frames using Row-MAD (Mean Absolute Difference) alignment.

### Stitch Engine v10 — Content-Aware Row-MAD

**Location:** `electron/scrollCapture/stitchEngine.js`

**Key insight:** Text-heavy pages have 80%+ whitespace rows (luminance=255 everywhere). These give MAD=0 at ANY offset, creating false matches. The fix: pre-compute which rows have visual content (pixel range > 20), and only use content-bearing rows for alignment.

**Algorithm:**
1. Load frames, convert to grayscale, detect content rows (pixel range > 20)
2. Detect fixed headers/footers (rows identical across frames)
3. For each frame pair, check if same-frame duplicate (isSameFrame threshold: 0.3 MAD)
4. Coarse pass: every 2nd content row, step=2 across candidate scroll offsets
5. Fine pass: all content rows, +/-4 around best coarse result
6. Reject if best MAD > 5
7. Composite with 24px alpha blending at seams

**Key parameters:**
- Content detection: row pixel range > 20
- isSameFrame threshold: 0.3 (tightened from 1.5 to fix "repeated passages" bug)
- Minimum overlap: 15% of scrolling region (or 60px minimum)
- MAD rejection threshold: > 5

### Evolution of Stitch Approaches (What Failed → What Worked)

| Version | Approach | Result |
|---------|----------|--------|
| v7 | Row-MAD basic | Failed: framesIdentical threshold too loose (4.0) |
| v8 | Removed pre-filter | Failed: green-channel-only caused false MAD=0 |
| v9 | Full luminance | Failed: whitespace rows drown out the signal |
| **v10** | **Content-aware Row-MAD** | **Works:** Only uses content rows for alignment |

### Browser Full-Page Capture (CDP)

**Location:** `electron/scrollCapture/browserCapture.js`

When Cmd+Shift+W is pressed and a Chromium browser is frontmost, the app auto-detects it and captures the full page via Chrome DevTools Protocol (CDP):
- Creates offscreen BrowserWindow, loads the URL
- Forces lazy images to load, removes cookie banners/overlays
- Captures at 2x scale for Retina quality via `Page.captureScreenshot`
- Falls back to manual scroll capture if CDP fails

**Browser detection:** `electron/scrollCapture/browserDetect.js`

### Important Discovery: Python Ground Truth is Wrong

`test-stitch.py` uses only 4 sample rows at [0.2, 0.4, 0.6, 0.8] of overlap on the full frame. Exhaustive testing (`test-deep.js`) proved it gives incorrect scroll values. The engine v10's offsets are the correct ones.

---

## Capture Pipeline Files

### Active Files
| File | Purpose |
|------|---------|
| `electron/scrollCapture/captureController.js` | Orchestrates capture loop (rapid manual capture + stitch) |
| `electron/scrollCapture/stitchEngine.js` | Content-aware Row-MAD alignment & compositing (v10) |
| `electron/scrollCapture/frameCollector.js` | Screen capture via macOS `screencapture -R` command |
| `electron/scrollCapture/browserCapture.js` | CDP-based full-page capture for Chromium browsers |
| `electron/scrollCapture/browserDetect.js` | Detects frontmost app and browser type |

### Dead Code (Safe to Remove)
| File | Why Dead |
|------|----------|
| `electron/scrollCapture/scrollDriver.js` | Auto-scroll driver — removed, user scrolls manually now |
| `electron/scrollCapture/cvAlignment.js` | Old OpenCV ORB+RANSAC alignment — replaced by Row-MAD |
| `electron/scrollCapture/cvWorker.js` | Worker thread for old OpenCV alignment |
| `electron/scrollhelper.swift` | Swift scroll helper source — only used by scrollDriver |
| `electron/scrollhelper` (binary) | Compiled scroll helper — orphaned |

### Test/Debug Files (Dev Only, Not in CI)
| File | Purpose |
|------|---------|
| `test-stitch-verify.js` | Compares engine vs brute-force ground truth (pure Node, pngjs) |
| `test-deep.js` | Exhaustive all-row brute force on specific pairs |
| `test-debug.js` | Content analysis showing whitespace dominance |
| `test-stitch-node.js` | Node stitch test (requires Electron, doesn't run standalone) |
| `test-stitch.js` | Basic stitch test |
| `test-stitch.py` | Python ground truth — WRONG, don't trust results |

Test files read debug frames from `~/Library/Application Support/screenvault/scroll-debug/`.

---

## Project Structure

```
screenvault/
├── electron/
│   ├── main.js                    # Main process: IPC, windows, shortcuts, thumbnails, OCR
│   ├── preload.js                 # Bridge: exposes APIs to renderer
│   ├── preload-overlay.js         # Preload for region selector overlay
│   ├── database.js                # SQLite setup and migrations
│   └── scrollCapture/
│       ├── captureController.js   # Scrolling screenshot orchestrator
│       ├── stitchEngine.js        # v10 content-aware Row-MAD stitching
│       ├── frameCollector.js      # Screen region capture (screencapture -R)
│       ├── browserCapture.js      # CDP full-page capture
│       └── browserDetect.js       # Browser detection
├── src/
│   ├── components/
│   │   ├── Dashboard.tsx          # Main UI (toolbar, folders, gallery)
│   │   ├── Gallery.tsx            # Screenshot grid with virtual scrolling
│   │   ├── Editor.tsx             # Screenshot annotation editor
│   │   └── ScreenshotModal.tsx    # Screenshot viewer modal
│   ├── hooks/
│   │   └── useElectronScreenshots.ts
│   └── lib/
│       └── database.ts
├── website/                       # Marketing site (tryscreenvault.com)
│   ├── index.html
│   ├── download.html
│   └── assets/
├── scripts/
│   └── notarize.js                # Apple notarization (skips for local dev builds)
├── release/                       # Build output
├── db/                            # SQLite database files
├── entitlements.mac.plist         # macOS entitlements for signing
├── vercel.json                    # Vercel deployment config
└── package.json                   # Dependencies and build config
```

---

## Brand & Design System

### Colors
| Token | Value | Usage |
|-------|-------|-------|
| Background primary | `#e9e6e4` | Website bg, light surfaces |
| Text primary / Dark | `#161419` | Text, dark UI elements |
| Dark gradient | `#2a2730` → `#161419` | Folder cards, overlay banners, progress UI |
| Border | `rgba(22, 20, 25, 0.1)` | Subtle borders |

### Fonts
| Font | Usage |
|------|-------|
| **Space Grotesk** | Titles, headings, UI labels |
| **Inter** | Body text, descriptions |
| **Playfair Display** (italic) | Decorative/accent text on website |

### UI Conventions
- Scrolling screenshot overlay: transparent body (no tint), black selection border
- Instruction banners: dark gradient bg, Space Grotesk, `#e9e6e4` text, blur backdrop
- Progress UI: same dark gradient style as instruction banners
- Folder cards: dark gradient, 120px tiles, no image loading
- Custom scrollbars: 10px width, transparent track, `#94918f` thumb

---

## Build & Launch Commands

### Development Build (Fast, Unsigned — For Testing)

```bash
cd /Users/sharveen/Downloads/screenvault
export PATH="/opt/homebrew/bin:/usr/bin:/bin:$PATH"

# Build frontend + Electron app
npx vite build && CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --dir -c.mac.identity=null

# Ad-hoc codesign (required because no Apple dev cert for local builds)
APP="release/mac-arm64/ScreenVault.app"
codesign --force --sign - "$APP/Contents/Frameworks/Electron Framework.framework"
codesign --force --sign - "$APP/Contents/Frameworks/"*.framework
codesign --force --sign - "$APP/Contents/Frameworks/"*.helper.app 2>/dev/null || true
codesign --force --sign - "$APP"

# Launch
open "$APP"
```

**Note:** The `CSC_IDENTITY_AUTO_DISCOVERY=false` env var also triggers the notarize script to skip (see `scripts/notarize.js`).

### Development Mode (Hot Reload)
```bash
npm run dev
```

### Production Build (Signed & Notarized)

Requires `.env` file with Apple Developer credentials:
```
APPLE_ID=sharveenkumar@gmail.com
APPLE_APP_SPECIFIC_PASSWORD=<app-specific-password>
APPLE_TEAM_ID=YG5879BX5G
```

```bash
rm -rf release/
npm run build && npx electron-builder --mac --x64 --arm64
```

### Verify Signing
```bash
codesign -dv --verbose=4 "release/mac-arm64/ScreenVault.app"
spctl -a -vv -t install "release/mac-arm64/ScreenVault.app"
```

---

## Git & GitHub Workflow

### Current State (March 10, 2026)
- **Branch:** `main`
- **Latest release pushed:** v1.0.4
- **Unpushed changes:** All scrolling screenshot enhancements from this session

### Standard PR Workflow
```bash
git checkout main && git pull origin main
git checkout -b feature/your-feature-name
# ... make changes ...
git add <specific files>
git commit -m "feat: Description

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
git push -u origin feature/your-feature-name
gh pr create --title "Title" --body "..."
```

### Release Workflow
1. Update version in `package.json`
2. Build signed & notarized: `npm run build && npx electron-builder --mac --x64 --arm64`
3. Create GitHub release: `gh release create v1.0.X --title "v1.0.X" release/*.dmg release/*.zip`
4. Update website download links in `website/index.html` and `website/download.html`
5. Deploy website (Vercel auto-deploys from main)

---

## Version History

### v1.0.4 (Latest Released — January 17, 2026)
- Added Cmd+Shift+D fullscreen capture to toolbar
- Fixed import menu buttons being unclickable (z-index issue)

### v1.0.3 (January 2026)
- Fixed editor window popping up main window
- Fixed editor staying on top during Cmd+Tab
- Fixed OCR file rename race condition
- Added fullscreen screenshot (Cmd+Shift+D)
- Enhanced image sharpness in editor
- Fixed arrow annotation precision

### Earlier Versions
- Performance optimizations (Phases 1-3): virtual scrolling, LRU cache, thumbnail generation
- Gallery load: 60-80s → 3-5s for 1000 screenshots
- Memory usage: 300MB → 15MB + 50MB cache

---

## Scrolling Screenshot Enhancements (March 10, 2026 — NOT YET PUSHED)

### Changes Made This Session

1. **Stitch engine v10 — content-aware Row-MAD** (stitchEngine.js)
   - Complete rewrite from NCC-based approach
   - Only uses content-bearing rows for alignment (eliminates whitespace noise)
   - Proven correct via exhaustive brute-force testing

2. **isSameFrame threshold tightened** (stitchEngine.js)
   - Changed from 1.5 → 0.3
   - Fixes "repeated passages" bug where genuinely different frames were marked as duplicates

3. **Removed auto-scrolling, switched to manual scroll capture** (captureController.js)
   - Removed programmatic scrolling via Swift scrollhelper (scrollDriver.js)
   - App now captures frames rapidly (~10fps) while user scrolls manually
   - Uses fast `captureFrame()` instead of slow `captureStableFrame()` (except first frame)
   - Increased max frames from 150 → 300

4. **Fixed region selector coordinate offset** (main.js)
   - Selection was shifting up ~2cm due to menu bar offset
   - Fix: convert `clientX/clientY` to screen coords using `overlayWin.getContentBounds()`

5. **Brand-consistent overlay UI** (main.js)
   - Instruction banner: Space Grotesk font, dark gradient (`#2a2730` → `#161419`)
   - Selection border: black, no overlay tint
   - Progress bar: matching dark gradient style, simplified messages ("Capturing" / "Compiling")

6. **Screenshot sound on Done** (captureController.js)
   - Plays macOS `Screen Capture.aif` via `afplay` when user presses Done

7. **Fixed dock icon disappearing** (captureController.js, browserCapture.js)
   - `app.dock.hide()` was called but `dock.show()` not called in all code paths
   - Moved dock restore to `finally` block in captureController
   - Added dock restore to both success and error paths in browserCapture

8. **Notarize script local dev skip** (scripts/notarize.js)
   - Skips notarization when `CSC_IDENTITY_AUTO_DISCOVERY=false` (local dev builds)

### Files Modified (Unpushed)
- `electron/main.js` — region selector coords fix, brand UI, progress bar, capture border
- `electron/scrollCapture/captureController.js` — manual scroll capture, screenshot sound, dock fix
- `electron/scrollCapture/stitchEngine.js` — v10 content-aware Row-MAD (previous session)
- `electron/scrollCapture/browserCapture.js` — dock restore fix
- `scripts/notarize.js` — local dev build skip

---

## Known Issues & Notes

### DO NOT
- **Don't trust test-stitch.py** — its ground truth is wrong (only samples 4 rows)
- **Don't use `pkill -f "ScreenVault"` in build scripts** — kills the running app unexpectedly
- **Don't try `require('electron')` outside Electron** — resolves to npm package path string, not built-in module. Use pngjs for pure Node testing.
- **Don't touch captureController's `captureStableFrame` for initial frame** — it needs stability check for the first baseline frame
- **Don't remove auth system** — breaks screenshot saving functionality
- **Don't attempt OCR worker caching** — previously tried, caused slower OCR

### Build Notes
- Always use `--dir` flag for unsigned dev builds
- `webSecurity: false` is required for drag-and-drop file:// protocol support
- `scrollhelper.swift` is still listed in `package.json` `asarUnpack` — should be removed when cleaning dead code

### Performance
- Gallery load (1000 screenshots): 3-5s
- Folder switching (cached): <100ms
- Memory usage: ~15MB + 50MB LRU cache
- DOM nodes (1000 screenshots): ~600 (virtual scrolling)
