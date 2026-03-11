'use strict';

const { execFile } = require('child_process');

// Bundle IDs for Chromium-based browsers that support AppleScript tab URL access
const CHROMIUM_BROWSERS = {
  'com.google.Chrome': 'Google Chrome',
  'com.google.Chrome.canary': 'Google Chrome Canary',
  'com.microsoft.edgemac': 'Microsoft Edge',
  'com.brave.Browser': 'Brave Browser',
  'com.vivaldi.Vivaldi': 'Vivaldi',
  'com.operasoftware.Opera': 'Opera',
};

// Internal URL schemes that can't be loaded in Electron
const INTERNAL_SCHEMES = ['chrome://', 'edge://', 'brave://', 'vivaldi://', 'opera://', 'chrome-extension://', 'about:'];

function runAppleScript(script) {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], { timeout: 5000 }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout.trim());
    });
  });
}

/**
 * Get the frontmost application's bundle ID and name.
 * Returns { bundleId, name } or null on failure.
 */
async function getFrontmostApp() {
  try {
    const script = `
tell application "System Events"
  set frontApp to first application process whose frontmost is true
  set appName to name of frontApp
  set bundleId to bundle identifier of frontApp
end tell
return bundleId & "|" & appName`;
    const result = await runAppleScript(script);
    const [bundleId, ...nameParts] = result.split('|');
    return { bundleId, name: nameParts.join('|') };
  } catch {
    return null;
  }
}

/**
 * Check if a bundle ID belongs to a supported Chromium browser.
 */
function isChromiumBrowser(bundleId) {
  return bundleId in CHROMIUM_BROWSERS;
}

/**
 * Get the active tab URL from a Chromium browser via AppleScript.
 * Returns the URL string or null on failure.
 */
async function getActiveTabURL(bundleId) {
  const appName = CHROMIUM_BROWSERS[bundleId];
  if (!appName) return null;

  try {
    const script = `tell application "${appName}" to return URL of active tab of front window`;
    const url = await runAppleScript(script);
    if (!url || url === 'missing value') return null;
    if (INTERNAL_SCHEMES.some(s => url.startsWith(s))) return null;
    return url;
  } catch {
    return null;
  }
}

module.exports = { getFrontmostApp, isChromiumBrowser, getActiveTabURL };
