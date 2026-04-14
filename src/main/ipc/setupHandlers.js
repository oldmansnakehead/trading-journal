import { ipcMain } from 'electron'
import { getDb } from '../database/index.js'

// Removes any existing handler first — prevents "second handler" crash on hot-reload
function handle(channel, fn) {
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, fn)
}

export function registerSetupHandlers() {
  const db = getDb()

  // ── Read ──────────────────────────────────────────────────────────────────

  handle('setups:getAll', () => {
    return db
      .prepare(
        `SELECT ts.*, GROUP_CONCAT(s.name, ', ') AS linkedStrategies
         FROM TradeSetups ts
         LEFT JOIN Setup_Strategies ss ON ts.id = ss.setupId
         LEFT JOIN Strategies s        ON ss.strategyId = s.id
         GROUP BY ts.id
         ORDER BY ts.name`
      )
      .all()
  })

  // KEY HANDLER: returns only strategies linked to the given setupId
  // Used by the Journal Entry form to populate the Strategy dropdown
  // dynamically when a user picks a TradeSetup.
  handle('setups:getStrategies', (_event, setupId) => {
    return db
      .prepare(
        `SELECT s.*
         FROM Strategies s
         INNER JOIN Setup_Strategies ss ON s.id = ss.strategyId
         WHERE ss.setupId = ?
         ORDER BY s.name`
      )
      .all(setupId)
  })

  // ── Create ────────────────────────────────────────────────────────────────

  handle('setups:create', (_event, { name, description, strategyIds = [] }) => {
    const insertSetup = db.prepare(
      'INSERT INTO TradeSetups (name, description) VALUES (?, ?)'
    )
    const linkStrategy = db.prepare(
      'INSERT OR IGNORE INTO Setup_Strategies (setupId, strategyId) VALUES (?, ?)'
    )

    const run = db.transaction((name, description, strategyIds) => {
      const { lastInsertRowid } = insertSetup.run(name, description || null)
      for (const sid of strategyIds) linkStrategy.run(lastInsertRowid, sid)
      return lastInsertRowid
    })

    const id = run(name, description, strategyIds)
    return db.prepare('SELECT * FROM TradeSetups WHERE id = ?').get(id)
  })

  // ── Link / Unlink strategies ──────────────────────────────────────────────

  handle('setups:linkStrategy', (_event, { setupId, strategyId }) => {
    db.prepare(
      'INSERT OR IGNORE INTO Setup_Strategies (setupId, strategyId) VALUES (?, ?)'
    ).run(setupId, strategyId)
    return { ok: true }
  })

  handle('setups:unlinkStrategy', (_event, { setupId, strategyId }) => {
    db.prepare(
      'DELETE FROM Setup_Strategies WHERE setupId = ? AND strategyId = ?'
    ).run(setupId, strategyId)
    return { ok: true }
  })

  // ── Delete ────────────────────────────────────────────────────────────────

  handle('setups:delete', (_event, id) => {
    db.prepare('DELETE FROM TradeSetups WHERE id = ?').run(id)
    return { ok: true }
  })

  // ── Setup Sessions (session time ranges per setup) ────────────────────────

  handle('setupSessions:getForSetup', (_event, setupId) =>
    db.prepare('SELECT * FROM SetupSessions WHERE setupId = ? ORDER BY startTime').all(setupId)
  )

  handle('setupSessions:create', (_event, { setupId, sessionName, startTime, endTime }) => {
    db.prepare(
      'INSERT INTO SetupSessions (setupId, sessionName, startTime, endTime) VALUES (?, ?, ?, ?)'
    ).run(setupId, sessionName, startTime, endTime)
    return db.prepare('SELECT * FROM SetupSessions WHERE setupId = ? ORDER BY startTime').all(setupId)
  })

  handle('setupSessions:delete', (_event, id) => {
    db.prepare('DELETE FROM SetupSessions WHERE id = ?').run(id)
    return { ok: true }
  })

  // ── App Settings (key-value store) ────────────────────────────────────────

  handle('settings:getAll', () => {
    const rows = db.prepare('SELECT key, value FROM Settings').all()
    return Object.fromEntries(rows.map((r) => [r.key, r.value]))
  })

  handle('settings:set', (_event, { key, value }) => {
    db.prepare('INSERT OR REPLACE INTO Settings (key, value) VALUES (?, ?)').run(key, String(value))
    return { ok: true }
  })
}
