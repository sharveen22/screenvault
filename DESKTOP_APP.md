# ScreenVault Desktop App

## Features

The desktop app adds **system-wide screenshot capture** to ScreenVault:

- **Global Hotkeys**: Press `Ctrl+Shift+S` (or `Cmd+Shift+S` on Mac) **anywhere** to capture a screenshot
- **Automatic Processing**: Every screenshot is automatically:
  - Extracted for text using OCR
  - Auto-named based on content
  - Auto-tagged for easy searching
  - Saved to your ScreenVault account
- **System Tray**: Runs in the background with a tray icon
- **Cross-Platform**: Works on Windows, Mac, and Linux

## Running the Desktop App

### Development Mode

```bash
npm run electron:dev
```

This will:
1. Start the Vite dev server
2. Launch the Electron app
3. Enable hot reload for both

### Building for Production

```bash
npm run electron:build
```

This creates distributable packages in the `release/` folder:
- **Mac**: `.dmg` and `.zip`
- **Windows**: `.exe` installer and portable
- **Linux**: `.AppImage` and `.deb`

## How to Use

### 1. First Time Setup
- Launch the desktop app
- Sign in with your ScreenVault account
- The app will minimize to the system tray

### 2. Taking Screenshots

**Method 1: Global Hotkey (Recommended)**
- Press `Ctrl+Shift+S` (Windows/Linux) or `Cmd+Shift+S` (Mac)
- A crosshair cursor appears
- Select the area you want to capture
- The screenshot is automatically processed and saved

**Method 2: From the App**
- Click the "Capture" button in the header
- Select the area to capture

**Method 3: System Tray**
- Right-click the tray icon
- Click "Take Screenshot"

### 3. Viewing Screenshots
- Press `Ctrl+Shift+A` (or `Cmd+Shift+A`) to show the app
- Or click the tray icon
- All your screenshots appear with OCR text extracted

### 4. Searching
- Press `Ctrl+K` (or `Cmd+K`) to focus the search bar
- Type any text that was **in** the screenshot
- Find it instantly, even if you don't remember the filename

## Keyboard Shortcuts

| Action | Windows/Linux | Mac |
|--------|--------------|-----|
| Capture Screenshot | `Ctrl+Shift+S` | `Cmd+Shift+S` |
| Show App | `Ctrl+Shift+A` | `Cmd+Shift+A` |
| Search | `Ctrl+K` | `Cmd+K` |
| Upload File | `Ctrl+U` | `Cmd+U` |

## System Tray Menu

Right-click the tray icon for quick access:
- **Open ScreenVault**: Show the main window
- **Take Screenshot**: Capture a screenshot
- **Quit**: Exit the app completely

## How It Works

1. **You press the hotkey** anywhere on your computer
2. **Screenshot tool activates** with a selection UI
3. **You select the area** to capture
4. **OCR processes the image** extracting all text
5. **Smart naming** generates a filename from the content
6. **Auto-tagging** adds relevant tags
7. **Uploads to cloud** saves to your Supabase storage
8. **Searchable instantly** find it by searching the text content

## Benefits Over Regular Screenshots

| Regular Screenshots | ScreenVault |
|-------------------|-------------|
| Named "Screenshot 2025-10-01 at 3.45.23 PM.png" | Named "error_database_connection_failed_2025-10-01.png" |
| Can't search by content | Search by any text in the screenshot |
| Manual organization | Auto-tagged and searchable |
| Local storage only | Cloud backup + sync |
| Need to open to remember content | Instantly searchable by what's inside |

## Troubleshooting

### Hotkey not working
- Make sure no other app is using `Ctrl+Shift+S`
- Try restarting the app
- Check the system tray to ensure the app is running

### Screenshots not uploading
- Check your internet connection
- Make sure you're logged in (open the app to verify)
- Check the browser console for errors

### App won't start
- Make sure port 5173 is not in use (dev mode)
- Try deleting `node_modules` and running `npm install` again

## Privacy & Security

- All screenshots are stored in your private Supabase account
- OCR processing happens client-side (nothing sent to external servers)
- Only you can access your screenshots
- Encrypted storage and transmission

## Web App vs Desktop App

**Web App**: Upload screenshots manually (drag & drop or paste)

**Desktop App**: Capture screenshots anywhere with a hotkey

Both share the same database, so all screenshots sync automatically!
