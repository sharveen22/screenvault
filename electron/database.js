const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');

let db;

function initDatabase() {
  const userDataPath = app.getPath('userData');
  const dbPath = path.join(userDataPath, 'screenvault.db');

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      plan TEXT DEFAULT 'free',
      storage_used INTEGER DEFAULT 0,
      storage_limit INTEGER DEFAULT 1073741824,
      screenshot_count INTEGER DEFAULT 0,
      onboarding_completed INTEGER DEFAULT 0,
      preferences TEXT DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      parent_id TEXT,
      color TEXT DEFAULT '#6366f1',
      icon TEXT DEFAULT 'folder',
      screenshot_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS screenshots (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      file_type TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      storage_path TEXT NOT NULL,
      thumbnail_path TEXT,
      ocr_text TEXT,
      ocr_confidence REAL,
      ai_description TEXT,
      ai_tags TEXT DEFAULT '[]',
      custom_tags TEXT DEFAULT '[]',
      user_notes TEXT DEFAULT '',
      is_favorite INTEGER DEFAULT 0,
      is_archived INTEGER DEFAULT 0,
      folder_id TEXT,
      source TEXT DEFAULT 'desktop',
      view_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_screenshots_user_id ON screenshots(user_id);
    CREATE INDEX IF NOT EXISTS idx_screenshots_created_at ON screenshots(created_at);
    CREATE INDEX IF NOT EXISTS idx_screenshots_folder_id ON screenshots(folder_id);
    CREATE INDEX IF NOT EXISTS idx_folders_user_id ON folders(user_id);
  `);

  console.log('Database initialized at:', dbPath);
  return db;
}

function getDatabase() {
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db;
}

function closeDatabase() {
  if (db) {
    db.close();
  }
}

module.exports = {
  initDatabase,
  getDatabase,
  closeDatabase,
};
