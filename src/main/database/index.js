import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { readFileSync } from 'fs'

let db = null

export function getDbPath() {
  const configPath = join(app.getPath('userData'), 'app-config.json')
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    if (config.dbFolder) return join(config.dbFolder, 'trading-journal.db')
  } catch (_) {}
  return join(app.getPath('userData'), 'trading-journal.db')
}

export function closeDb() {
  if (db) { db.close(); db = null }
}

export function getDb() {
  if (!db) {
    const customPath = getDbPath()
    const defaultPath = join(app.getPath('userData'), 'trading-journal.db')
    try {
      db = new Database(customPath)
    } catch (err) {
      console.error('[DB] Cannot open at custom path, falling back to default:', customPath, err.message)
      db = new Database(defaultPath)
    }
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    runMigrations(db)
  }
  return db
}

function runMigrations(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)`)

  const getVersion = () => {
    const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()
    return row.v || 0
  }
  const setVersion = (v) => db.prepare('INSERT OR REPLACE INTO schema_migrations VALUES (?)').run(v)

  const version = getVersion()

  // ── v1: Initial schema (fresh install) ────────────────────────────────────
  if (version < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS TradeSetups (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL UNIQUE,
        description TEXT,
        createdAt   TEXT    DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS Strategies (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL UNIQUE,
        description TEXT,
        createdAt   TEXT    DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS Setup_Strategies (
        setupId    INTEGER NOT NULL REFERENCES TradeSetups(id) ON DELETE CASCADE,
        strategyId INTEGER NOT NULL REFERENCES Strategies(id)  ON DELETE CASCADE,
        PRIMARY KEY (setupId, strategyId)
      );
      CREATE TABLE IF NOT EXISTS Symbols (
        id   INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE
      );
      CREATE TABLE IF NOT EXISTS Journals (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        entryDateTime TEXT    NOT NULL,
        exitDateTime  TEXT,
        symbol        TEXT    NOT NULL,
        session       TEXT    NOT NULL,
        position      TEXT    NOT NULL,
        tf            TEXT,
        rrType        TEXT    NOT NULL,
        result        TEXT    NOT NULL,
        slPoint       REAL,
        tpPoint       REAL,
        imageUrl      TEXT,
        notes         TEXT,
        timeBos       INTEGER,
        setupId       INTEGER NOT NULL REFERENCES TradeSetups(id),
        createdAt     TEXT    DEFAULT (datetime('now')),
        updatedAt     TEXT    DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS Journal_Strategies (
        journalId  INTEGER NOT NULL REFERENCES Journals(id) ON DELETE CASCADE,
        strategyId INTEGER NOT NULL REFERENCES Strategies(id) ON DELETE CASCADE,
        PRIMARY KEY (journalId, strategyId)
      );
      CREATE INDEX IF NOT EXISTS idx_journals_entryDateTime ON Journals(entryDateTime);
      CREATE INDEX IF NOT EXISTS idx_journals_symbol        ON Journals(symbol);
      CREATE INDEX IF NOT EXISTS idx_journals_session       ON Journals(session);
      CREATE INDEX IF NOT EXISTS idx_journals_rrType        ON Journals(rrType);
    `)
    setVersion(1)
    return
  }

  // ── v2: Add Symbols, Journal_Strategies, new Journals columns ─────────────
  // (for databases created with the old v1 schema before this migration)
  if (version < 2) {
    // Disable FK checks during table reconstruction
    db.pragma('foreign_keys = OFF')

    db.exec(`
      CREATE TABLE IF NOT EXISTS Symbols (
        id   INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE
      );

      CREATE TABLE IF NOT EXISTS Journals_new (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        entryDateTime TEXT    NOT NULL,
        exitDateTime  TEXT,
        symbol        TEXT    NOT NULL,
        session       TEXT    NOT NULL,
        position      TEXT    NOT NULL,
        tf            TEXT,
        rrType        TEXT    NOT NULL,
        result        TEXT    NOT NULL,
        slPoint       REAL,
        tpPoint       REAL,
        imageUrl      TEXT,
        notes         TEXT,
        timeBos       INTEGER,
        setupId       INTEGER NOT NULL REFERENCES TradeSetups(id),
        createdAt     TEXT    DEFAULT (datetime('now')),
        updatedAt     TEXT    DEFAULT (datetime('now'))
      );

      INSERT INTO Journals_new
        (id, entryDateTime, exitDateTime, symbol, session, position, rrType, result, notes, setupId, createdAt, updatedAt)
      SELECT
        id, entryDateTime, exitDateTime, symbol, session, position, rrType, result, notes, setupId, createdAt, updatedAt
      FROM Journals;

      CREATE TABLE IF NOT EXISTS Journal_Strategies_tmp (
        journalId  INTEGER,
        strategyId INTEGER,
        PRIMARY KEY (journalId, strategyId)
      );

      INSERT OR IGNORE INTO Journal_Strategies_tmp (journalId, strategyId)
      SELECT id, strategyId FROM Journals WHERE strategyId IS NOT NULL;

      DROP TABLE Journals;
      ALTER TABLE Journals_new RENAME TO Journals;

      CREATE TABLE IF NOT EXISTS Journal_Strategies (
        journalId  INTEGER NOT NULL REFERENCES Journals(id) ON DELETE CASCADE,
        strategyId INTEGER NOT NULL REFERENCES Strategies(id) ON DELETE CASCADE,
        PRIMARY KEY (journalId, strategyId)
      );

      INSERT OR IGNORE INTO Journal_Strategies SELECT journalId, strategyId FROM Journal_Strategies_tmp;
      DROP TABLE Journal_Strategies_tmp;

      CREATE INDEX IF NOT EXISTS idx_journals_entryDateTime ON Journals(entryDateTime);
      CREATE INDEX IF NOT EXISTS idx_journals_symbol        ON Journals(symbol);
      CREATE INDEX IF NOT EXISTS idx_journals_session       ON Journals(session);
      CREATE INDEX IF NOT EXISTS idx_journals_rrType        ON Journals(rrType);
    `)

    db.pragma('foreign_keys = ON')
    setVersion(2)
  }

  // ── v3: SetupSessions, Settings, directionBias ────────────────────────────
  if (version < 3) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS SetupSessions (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        setupId     INTEGER NOT NULL REFERENCES TradeSetups(id) ON DELETE CASCADE,
        sessionName TEXT    NOT NULL,
        startTime   TEXT    NOT NULL,
        endTime     TEXT    NOT NULL
      );

      CREATE TABLE IF NOT EXISTS Settings (
        key   TEXT PRIMARY KEY,
        value TEXT
      );
    `)

    // ADD COLUMN is safe on existing DB — silently skip if already present
    try { db.exec(`ALTER TABLE Journals ADD COLUMN directionBias TEXT`) } catch (_) {}

    setVersion(3)
  }

  // ── v4: CustomTags + Journal_CustomTags junction ───────────────────────────
  if (version < 4) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS CustomTags (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        name      TEXT    NOT NULL UNIQUE,
        createdAt TEXT    DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS Journal_CustomTags (
        journalId   INTEGER NOT NULL REFERENCES Journals(id) ON DELETE CASCADE,
        customTagId INTEGER NOT NULL REFERENCES CustomTags(id) ON DELETE CASCADE,
        PRIMARY KEY (journalId, customTagId)
      );

      INSERT OR IGNORE INTO Settings (key, value) VALUES ('customColumnName', 'Custom Tag');
    `)
    setVersion(4)
  }
}
