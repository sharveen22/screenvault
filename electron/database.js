// database.js
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const crypto = require('crypto');

let db;
let dbPath;

function getLocalDatabasePath() {
  let dbFolder;

  if (app.isPackaged) {
    // Untuk aplikasi yang sudah di-build, gunakan userData directory
    dbFolder = path.join(app.getPath('userData'), 'data');
  } else {
    // Untuk development, gunakan folder db di project root
    const projectRoot = path.join(__dirname, '..');
    dbFolder = path.join(projectRoot, 'db');
  }

  // buat folder db jika belum ada
  if (!fs.existsSync(dbFolder)) {
    fs.mkdirSync(dbFolder, { recursive: true });
  }

  // Generate unique database name untuk setiap instalasi
  const appId = app.isPackaged ? 'screenvault' : 'screenvault-dev';
  const dbName = `${appId}.db`;
  return path.join(dbFolder, dbName);
}

function initDatabase() {
  dbPath = getLocalDatabasePath();

  // Cek apakah database sudah ada
  const dbExists = fs.existsSync(dbPath);

  console.log('Initializing database at:', dbPath);
  console.log('Database exists:', dbExists);

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');     // performa & durability lebih baik
  db.pragma('foreign_keys = ON');      // jaga FK constraint
  db.pragma('busy_timeout = 3000');    // elak "database is locked" singkat

  // Inisialisasi database dengan migrasi
  initializeDatabaseSchema();

  // Set metadata untuk database
  setDatabaseMetadata();

  console.log('Database initialized successfully at:', dbPath);
  return db;
}

function initializeDatabaseSchema() {
  // Buat tabel metadata untuk tracking versi database
  db.exec(`
    CREATE TABLE IF NOT EXISTS database_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Cek versi database saat ini
  const currentVersion = getDatabaseVersion();
  console.log('Current database version:', currentVersion);

  // Jika database baru, buat schema lengkap
  if (currentVersion === null) {
    createInitialSchema();
    setDatabaseVersion('1.0.0');
  }

  // Jalankan migrasi jika diperlukan
  runMigrations(currentVersion);
}

function getDatabaseVersion() {
  try {
    const result = db.prepare('SELECT value FROM database_metadata WHERE key = ?').get('version');
    return result ? result.value : null;
  } catch (error) {
    return null;
  }
}

function setDatabaseVersion(version) {
  db.prepare(`
    INSERT OR REPLACE INTO database_metadata (key, value) 
    VALUES ('version', ?)
  `).run(version);
}

function createInitialSchema() {
  console.log('Creating initial database schema...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      parent_id TEXT,
      color TEXT DEFAULT '#6366f1',
      icon TEXT DEFAULT 'folder',
      screenshot_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS screenshots (
      id TEXT PRIMARY KEY,
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
      FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_screenshots_created_at ON screenshots(created_at);
    CREATE INDEX IF NOT EXISTS idx_screenshots_folder_id ON screenshots(folder_id);
  `);
}

function setDatabaseMetadata() {
  // Set metadata untuk database
  const installId = crypto.randomUUID();
  const installDate = new Date().toISOString();

  db.prepare(`
    INSERT OR REPLACE INTO database_metadata (key, value) 
    VALUES ('install_id', ?)
  `).run(installId);

  db.prepare(`
    INSERT OR REPLACE INTO database_metadata (key, value) 
    VALUES ('install_date', ?)
  `).run(installDate);

  db.prepare(`
    INSERT OR REPLACE INTO database_metadata (key, value) 
    VALUES ('app_version', ?)
  `).run(app.getVersion());

  console.log('Database metadata set - Install ID:', installId);
}

function runMigrations(currentVersion) {
  // Sistem migrasi database untuk update di masa depan
  const migrations = [
    {
      version: '1.0.1',
      description: 'Add app settings table',
      up: () => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
        `);
      }
    },
    {
      version: '1.0.2',
      description: 'Add note_history column to screenshots table',
      up: () => {
        // Check if column exists first
        const columns = db.prepare("PRAGMA table_info(screenshots)").all();
        const hasNoteHistory = columns.some(col => col.name === 'note_history');

        if (!hasNoteHistory) {
          db.exec(`ALTER TABLE screenshots ADD COLUMN note_history TEXT DEFAULT '[]';`);
          console.log('Added note_history column to screenshots table');

          // Migrate existing user_notes to note_history
          const screenshots = db.prepare('SELECT id, user_notes, created_at FROM screenshots WHERE user_notes != \'\'').all();
          const updateStmt = db.prepare('UPDATE screenshots SET note_history = ? WHERE id = ?');

          screenshots.forEach(screenshot => {
            const noteHistory = [{
              text: screenshot.user_notes,
              timestamp: screenshot.created_at
            }];
            updateStmt.run(JSON.stringify(noteHistory), screenshot.id);
          });

          console.log(`Migrated ${screenshots.length} existing notes to note_history`);
        }
      }
    }
  ];

  for (const migration of migrations) {
    if (shouldRunMigration(currentVersion, migration.version)) {
      console.log(`Running migration to version ${migration.version}: ${migration.description}`);
      migration.up();
      setDatabaseVersion(migration.version);
    }
  }
}

function shouldRunMigration(currentVersion, targetVersion) {
  if (!currentVersion) return false;

  const current = parseVersion(currentVersion);
  const target = parseVersion(targetVersion);

  return current < target;
}

function parseVersion(version) {
  return version.split('.').map(Number);
}

function getDatabase() {
  if (!db) throw new Error('Database not initialized');
  return db;
}

function getDatabaseInfo() {
  if (!db) throw new Error('Database not initialized');

  const metadata = db.prepare('SELECT * FROM database_metadata').all();
  const info = {};

  metadata.forEach(row => {
    info[row.key] = row.value;
  });

  return {
    path: dbPath,
    version: info.version || 'unknown',
    installId: info.install_id || 'unknown',
    installDate: info.install_date || 'unknown',
    appVersion: info.app_version || 'unknown',
    size: fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0
  };
}

function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  initDatabase,
  getDatabase,
  getDatabaseInfo,
  closeDatabase,
};
