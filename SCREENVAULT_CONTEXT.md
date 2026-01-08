# ScreenVault - Complete Context Document

## 📱 App Overview

**ScreenVault** is an Electron-based macOS screenshot management application that captures, organizes, and searches screenshots with OCR capabilities.

### Core Functionality
- **Screenshot Capture:** Cmd+Shift+S triggers native macOS screenshot tool
- **Apple-Style Thumbnail Preview:** Small preview appears in bottom-LEFT corner after capture
- **Auto-Save:** Screenshots auto-save after 6 seconds if not clicked
- **Auto-Clipboard:** Screenshots automatically copied to clipboard for immediate pasting
- **Editor Window:** Click thumbnail to open annotation editor
- **OCR Processing:** Automatic text extraction using Tesseract.js (runs in background)
- **Smart Filenames:** OCR-generated filenames sync to local folder
- **Smart Organization:** Folders, favorites, tags, and search
- **Sort Screenshots:** Sort by newest/oldest with dropdown
- **Advanced Editor:** Annotate screenshots with pen, text, shapes, arrows, crop
- **Local Storage:** SQLite database + file system (~/Pictures/ScreenVault/)
- **System Integration:** Menu bar icon, global shortcuts, notifications

---

## 🎯 LATEST FEATURES (January 8, 2026)

### 1. Smart Filenames + OCR Fix (NEW - PR #30)
- **Fixed OCR:** Was completely broken (IPC event never triggered)
- **Smart Filenames Sync:** Local files renamed to match OCR-generated names
- **Processing Indicator:** "Processing..." badge on cards during OCR
- **File Rename IPC:** New `file:rename` handler renames files on disk
- **Storage Path Update:** Database `storage_path` updated when file renamed

### 2. Sort Screenshots (PR #29)
- **Sort Dropdown:** Choose "Newest First" or "Oldest First"
- **Location:** Below title, above search bar in Dashboard
- **Reload Button:** Manual gallery refresh
- **Database-level sorting:** Uses ORDER BY for performance

### 3. Apple-Style Thumbnail Preview
- **Location:** Bottom-LEFT corner (180x120px)
- **Design:** Beige background (#e9e6e4), subtle border, progress bar
- **Auto-Clipboard:** Screenshot immediately copied to clipboard
- **6-Second Timer:** Progress bar shows countdown, then auto-saves
- **Click to Edit:** Opens editor popup (save on "Done", discard on close)

### 4. Responsive Editor Toolbar
- **Apple-style design:** Clean, no grey backgrounds, subtle dividers
- **Dynamic scaling:** Icons/spacing scale based on window width
- **4 breakpoints:** Ultra-tiny (<450px), Tiny (<550px), Very compact (<700px), Compact (<900px)

---

## 🏗️ Technical Architecture

### Frontend
- **Framework:** React 18 + TypeScript + Vite
- **Styling:** Tailwind CSS + custom CSS (monochrome beige/cream design)
- **Icons:** Lucide React
- **Fonts:** Space Grotesk (titles), Inter (body)

### Backend
- **Platform:** Electron 38 (Node.js)
- **Database:** better-sqlite3 (local SQLite)
- **OCR:** Tesseract.js (client-side)
- **Screenshot Tool:** Native macOS `screencapture` command

### Key Files Structure
```
screenvault/
├── electron/
│   ├── main.js           # Main process (thumbnail, editor, IPC, database save, OCR trigger)
│   ├── preload.js        # IPC bridge (includes onOCRProcess, renameFile)
│   └── database.js       # SQLite operations
├── src/
│   ├── components/
│   │   ├── Dashboard.tsx # Main UI with sidebar + gallery + sort controls
│   │   ├── Gallery.tsx   # Screenshot grid view (lazy loading, sorting, OCR indicator)
│   │   ├── Editor.tsx    # Annotation editor (responsive toolbar)
│   │   └── ScreenshotModal.tsx # Detail view
│   ├── hooks/
│   │   └── useElectronScreenshots.ts # Screenshot capture + OCR processing hook
│   ├── lib/
│   │   ├── database.ts   # Database client
│   │   └── ocr.ts        # OCR utilities (extractTextFromImage, generateSmartFilename, generateTags)
│   └── contexts/
│       └── AuthContext.tsx # Auth system (DO NOT REMOVE)
├── db/
│   └── screenvault-dev.db # SQLite database (dev)
└── public/
    └── icon.icns         # App icon
```

---

## 🔄 OCR Flow (IMPORTANT)

The OCR flow was fixed in PR #30. Here's how it works:

1. **Screenshot captured** → saved to disk as `screenshot_YYYY-MM-DD_HH-MM-SS.png`
2. **Database entry created** → `saveScreenshotToDatabase()` in main.js
3. **OCR triggered** → `triggerOCRProcessing()` sends `ocr:process` IPC event
4. **Renderer receives event** → `handleOCRProcess()` in useElectronScreenshots.ts
5. **Tesseract runs** → extracts text from image
6. **Smart filename generated** → from OCR text (e.g., `code_function_import_2026-01-08.png`)
7. **File renamed on disk** → via `file:rename` IPC handler
8. **Database updated** → `file_name`, `storage_path`, `ocr_text`, `custom_tags`
9. **Page reloads** → shows updated data

### Key IPC Channels
- `ocr:process` - Main → Renderer: Trigger OCR processing
- `file:rename` - Renderer → Main: Rename file on disk

---

## 🚀 BUILD & LAUNCH COMMANDS

### Quick Build & Test (USE THIS!)
```bash
pkill -f "ScreenVault" 2>/dev/null; sleep 1; npm run build && npx electron-builder --mac --x64 --dir -c.mac.identity=null 2>&1 | tail -5 && open release/mac/ScreenVault.app
```

### Step by Step
```bash
# 1. Kill existing app
pkill -f "ScreenVault" 2>/dev/null

# 2. Build frontend
npm run build

# 3. Package Electron (skip signing for faster builds)
npx electron-builder --mac --x64 --dir -c.mac.identity=null

# 4. Launch app
open release/mac/ScreenVault.app
```

---

## 🔀 GIT & GITHUB COMMANDS

### Create New Branch & PR
```bash
# 1. Create new branch
git checkout -b feature/your-feature-name

# 2. Stage changes (specific files or all)
git add electron/main.js electron/preload.js src/components/Gallery.tsx
# OR stage all: git add -A

# 3. Commit with descriptive message
git commit -m "feat: Description of your changes

- Detail 1
- Detail 2"

# 4. Push branch to GitHub
git push -u origin feature/your-feature-name

# 5. Create PR (option A: use URL from push output)
# Visit: https://github.com/sharveen22/screenvault/pull/new/feature/your-feature-name

# 5. Create PR (option B: use GitHub CLI)
gh pr create --title "feat: Your PR Title" --body "## Summary
Description of changes

## Changes
- Change 1
- Change 2" --base main
```

### Useful Git Commands
```bash
git status              # Check current status
git branch              # List branches
git checkout main       # Switch to main
git pull origin main    # Pull latest changes
git diff --stat         # See changed files
```

---

## ⚠️ CRITICAL WARNINGS

### DO NOT REMOVE
1. **Auth System (AuthContext.tsx)** - Hidden dependency breaks screenshot saving
2. **useElectronScreenshots() hook call in Dashboard.tsx** - Needed for OCR listener
3. **currentUser variable in main.js** - Used by auth handlers

### File Editing Issue
When using AI assistants, file edits may not persist. Use bash to write directly:
```bash
cat > src/components/YourFile.tsx << 'ENDFILE'
// Your file content here
ENDFILE

# Verify the change
grep "unique string" src/components/YourFile.tsx
```

### Known Issues
- Type errors in Dashboard.tsx for `folder` property (pre-existing, don't affect build)

---

## ✅ COMPLETED FEATURES

### Session 5: Smart Filenames + OCR Fix (January 8, 2026) - PR #30
- ✅ Fixed OCR (was completely broken)
- ✅ Smart filenames sync to local folder
- ✅ "Processing..." indicator during OCR
- ✅ File rename IPC handler
- ✅ Storage path updates in database

### Session 4: Sort Screenshots - PR #29
- ✅ Sort dropdown (Newest First / Oldest First)
- ✅ Reload button for manual refresh

### Session 3: Editor Toolbar Improvements - PR #28
- ✅ Responsive toolbar with dynamic icon scaling
- ✅ Apple-style clean design

### Session 2: Apple-Style Thumbnail Preview - PR #27
- ✅ Thumbnail preview in bottom-left corner
- ✅ Auto-clipboard copy on screenshot
- ✅ 6-second auto-save with progress bar

### Session 1: Performance Optimizations
- ✅ 11 total optimizations (async OCR, lazy loading, debounced search)

---

## 🎨 Design System

### Colors
- Background: `#e9e6e4` (beige/cream)
- Text: `#161419` (dark charcoal)
- Border: `#94918f` (medium gray)

### Typography
- Titles: Space Grotesk (bold)
- Body: Inter (clean)

---

## 📋 COPY THIS FOR NEXT SESSION

```
I'm continuing work on ScreenVault, an Electron-based macOS screenshot management app.

**Current Status:**
- ✅ Apple-style thumbnail preview (bottom-left corner)
- ✅ Auto-clipboard copy on screenshot
- ✅ Auto-save after 6 seconds with progress bar
- ✅ Editor popup on thumbnail click (save on "Done", discard on close)
- ✅ Responsive editor toolbar (Apple-style, scales with window)
- ✅ Sort screenshots (Newest/Oldest dropdown + Reload button)
- ✅ OCR working with smart filenames synced to local folder
- ✅ "Processing..." indicator during OCR
- ✅ 11 performance optimizations complete
- ❌ Auth system removal skipped (breaks screenshot saving - DO NOT ATTEMPT)

**Screenshot Flow:**
1. Cmd+Shift+S → Take screenshot
2. Thumbnail appears in bottom-left (6 second timer with progress bar)
3. Click thumbnail → Opens editor (save on "Done", discard on close)
4. Don't click → Auto-saves after 6 seconds
5. OCR runs in background → generates smart filename + tags
6. Local file renamed to match smart filename

**Key Files:**
- `electron/main.js` - Thumbnail preview, editor popup, database save, OCR trigger, file rename
- `electron/preload.js` - IPC bridge (onOCRProcess, renameFile)
- `src/hooks/useElectronScreenshots.ts` - OCR processing, file rename, event handling
- `src/components/Editor.tsx` - Annotation editor (responsive toolbar)
- `src/components/Dashboard.tsx` - Gallery with sort controls and refresh
- `src/components/Gallery.tsx` - Lazy loading screenshots with sorting + OCR indicator

**Build & Test Command:**
```bash
pkill -f "ScreenVault" 2>/dev/null; sleep 1; npm run build && npx electron-builder --mac --x64 --dir -c.mac.identity=null 2>&1 | tail -5 && open release/mac/ScreenVault.app
```

**Create PR Commands:**
```bash
git checkout -b feature/your-feature-name
git add -A
git commit -m "feat: Description"
git push -u origin feature/your-feature-name
# Then visit: https://github.com/sharveen22/screenvault/pull/new/feature/your-feature-name
```

**IMPORTANT WARNINGS:**
1. DO NOT remove auth system (AuthContext.tsx) - breaks screenshot saving
2. DO NOT remove useElectronScreenshots() hook call - needed for OCR listener
3. If file edits don't persist, use bash `cat > file.tsx << 'EOF'` to write directly
4. Always verify changes with `grep "YourCode" file.tsx` before building
5. Use `-c.mac.identity=null` flag to skip code signing (faster builds)

Please read full context from SCREENVAULT_CONTEXT.md in the workspace.
```

---

**Last Updated:** January 8, 2026  
**Latest PRs:** PR #27, #28, #29, #30
**Current Branch:** feature/smart-filenames-ocr
**Status:** All features working, production-ready
