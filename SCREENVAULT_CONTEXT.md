# ScreenVault - Complete Context Document

## 📱 App Overview

**ScreenVault** is an Electron-based macOS screenshot management application that captures, organizes, and searches screenshots with OCR capabilities.

### Core Functionality
- **Screenshot Capture:** Cmd+Shift+S triggers native macOS screenshot tool
- **Apple-Style Thumbnail Preview:** Small preview appears in bottom-LEFT corner after capture
- **Auto-Save:** Screenshots auto-save after 6 seconds if not clicked
- **Auto-Clipboard:** Screenshots automatically copied to clipboard for immediate pasting
- **Editor Window:** Click thumbnail to open annotation editor (NO delete button - delete from main app)
- **OCR Processing:** Automatic text extraction using Tesseract.js (runs in background)
- **Smart Filenames:** OCR-generated filenames sync to local folder
- **Import Screenshots/Folders:** Import existing screenshots or entire folders
- **Smart Organization:** Folders, favorites, tags, and search
- **Sort Screenshots:** Sort by newest/oldest with dropdown
- **Advanced Editor:** Annotate screenshots with pen, text, shapes, arrows, crop
- **Local Storage:** SQLite database + file system (~/Pictures/ScreenVault/)
- **System Integration:** Menu bar icon, global shortcuts, notifications

---

## 🎯 LATEST FEATURES (January 9, 2026)

### 1. Fixed Duplicate Screenshots & Editor Save (NEW - PR #32)
- **No More Duplicates:** Added duplicate check in saveScreenshotToDatabase() to prevent double-saving
- **Editor Save Fixed:** When saving from editor, updates existing screenshot instead of creating duplicate
- **Handles OCR Renames:** Editor properly finds and updates screenshots even after OCR renames them
- **File Existence Check:** Gallery filters out screenshots whose files don't exist on disk
- **Removed Delete Button:** Simplified editor by removing delete functionality (users delete from main app)
- **Real-time Sync:** Gallery always shows only files that actually exist in the folder

---

## 🚀 BUILD & LAUNCH COMMANDS

### Quick Build & Test (USE THIS!)
```bash
pkill -f "ScreenVault" 2>/dev/null; sleep 1; npm run build && npx electron-builder --mac --x64 --dir -c.mac.identity=null 2>&1 | tail -5 && open release/mac/ScreenVault.app
```

---

## 🔀 GIT & GITHUB COMMANDS

### Create New Branch & PR
```bash
git checkout -b feature/your-feature-name
git add -A
git commit -m "feat: Description

- Detail 1
- Detail 2"
git push -u origin feature/your-feature-name
gh pr create --title "feat: Your title" --body "Description" --base main
```

---

## 📋 COPY THIS FOR NEXT SESSION

I'm continuing work on ScreenVault, an Electron-based macOS screenshot management app.

**Current Status:**
- ✅ Apple-style thumbnail preview (bottom-left corner)
- ✅ Auto-clipboard copy on screenshot
- ✅ Auto-save after 6 seconds with progress bar
- ✅ Editor popup on thumbnail click (save on "Done", NO delete button)
- ✅ Responsive editor toolbar (Apple-style, scales with window)
- ✅ Sort screenshots (Newest/Oldest dropdown + Reload button)
- ✅ OCR working with smart filenames synced to local folder
- ✅ Import Files button (import individual screenshots)
- ✅ Import Folder button (import folders with structure mirroring)
- ✅ File watcher (auto-import from ~/Pictures/ScreenVault)
- ✅ Fixed duplicate screenshots (duplicate check in saveScreenshotToDatabase)
- ✅ Fixed editor save (updates existing screenshot instead of creating duplicate)
- ✅ Gallery shows only files that exist on disk (file existence check)
- ❌ Auth system removal skipped (breaks screenshot saving - DO NOT ATTEMPT)

**Build & Test:**
```bash
pkill -f "ScreenVault" 2>/dev/null; sleep 1; npm run build && npx electron-builder --mac --x64 --dir -c.mac.identity=null 2>&1 | tail -5 && open release/mac/ScreenVault.app
```

**Create PR:**
```bash
git checkout -b feature/your-feature-name
git add -A
git commit -m "feat: Description"
git push -u origin feature/your-feature-name
gh pr create --title "feat: Your title" --body "Description" --base main
```

**Latest PRs:** #27, #28, #29, #30, #31, #32  
**Current Branch:** feature/fix-duplicate-screenshots-and-editor  
**Status:** All features working, no duplicates, production-ready

Please read full context from SCREENVAULT_CONTEXT.md in the workspace.
