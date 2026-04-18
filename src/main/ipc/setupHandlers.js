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
        `SELECT ts.*,
                GROUP_CONCAT(DISTINCT s.name)   AS linkedStrategies,
                GROUP_CONCAT(DISTINCT ct.name)  AS linkedCustomTags,
                GROUP_CONCAT(DISTINCT rrt.name) AS linkedRRTypes
         FROM TradeSetups ts
         LEFT JOIN Setup_Strategies ss  ON ts.id = ss.setupId
         LEFT JOIN Strategies s         ON ss.strategyId = s.id
         LEFT JOIN Setup_CustomTags sct ON ts.id = sct.setupId
         LEFT JOIN CustomTags ct        ON sct.customTagId = ct.id
         LEFT JOIN Setup_RRTypes srt    ON ts.id = srt.setupId
         LEFT JOIN RRTypes rrt          ON srt.rrTypeId = rrt.id
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
        `SELECT s.*, ss.sortOrder
         FROM Strategies s
         INNER JOIN Setup_Strategies ss ON s.id = ss.strategyId
         WHERE ss.setupId = ?
         ORDER BY ss.sortOrder, s.name`
      )
      .all(setupId)
  })

  handle('setups:updateStrategyOrder', (_event, { setupId, strategyId, sortOrder }) => {
    db.prepare(
      'UPDATE Setup_Strategies SET sortOrder = ? WHERE setupId = ? AND strategyId = ?'
    ).run(sortOrder, setupId, strategyId)
    return { ok: true }
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

  // ── Custom Tag link / unlink / get (per-setup) ────────────────────────────

  handle('setups:getCustomTags', (_event, setupId) =>
    db.prepare(
      `SELECT ct.*
       FROM CustomTags ct
       INNER JOIN Setup_CustomTags sct ON ct.id = sct.customTagId
       WHERE sct.setupId = ?
       ORDER BY ct.name`
    ).all(setupId)
  )

  handle('setups:linkCustomTag', (_event, { setupId, customTagId }) => {
    db.prepare(
      'INSERT OR IGNORE INTO Setup_CustomTags (setupId, customTagId) VALUES (?, ?)'
    ).run(setupId, customTagId)
    return { ok: true }
  })

  handle('setups:unlinkCustomTag', (_event, { setupId, customTagId }) => {
    db.prepare(
      'DELETE FROM Setup_CustomTags WHERE setupId = ? AND customTagId = ?'
    ).run(setupId, customTagId)
    return { ok: true }
  })

  // ── Playbook (long-form notes per setup) ─────────────────────────────────

  handle('setups:getPlaybook', (_event, setupId) => {
    const row = db.prepare('SELECT playbook FROM TradeSetups WHERE id = ?').get(setupId)
    return row?.playbook ?? ''
  })

  handle('setups:updatePlaybook', (_event, { setupId, playbook }) => {
    db.prepare('UPDATE TradeSetups SET playbook = ? WHERE id = ?').run(playbook || null, setupId)
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

  // ── RR Types (global CRUD) ────────────────────────────────────────────────────

  handle('rrTypes:getAll', () =>
    db.prepare('SELECT * FROM RRTypes ORDER BY ratio, name').all()
  )

  handle('rrTypes:create', (_event, { name, ratio }) => {
    const { lastInsertRowid } = db
      .prepare('INSERT INTO RRTypes (name, ratio) VALUES (?, ?)')
      .run(name.trim(), Number(ratio))
    return db.prepare('SELECT * FROM RRTypes WHERE id = ?').get(lastInsertRowid)
  })

  handle('rrTypes:delete', (_event, id) => {
    db.prepare('DELETE FROM RRTypes WHERE id = ?').run(id)
    return { ok: true }
  })

  // ── RR Types (per-setup link / unlink / get) ───────────────────────────────

  handle('setups:getRRTypes', (_event, setupId) =>
    db.prepare(
      `SELECT rrt.*
       FROM RRTypes rrt
       INNER JOIN Setup_RRTypes srt ON rrt.id = srt.rrTypeId
       WHERE srt.setupId = ?
       ORDER BY rrt.ratio, rrt.name`
    ).all(setupId)
  )

  handle('setups:linkRRType', (_event, { setupId, rrTypeId }) => {
    db.prepare(
      'INSERT OR IGNORE INTO Setup_RRTypes (setupId, rrTypeId) VALUES (?, ?)'
    ).run(setupId, rrTypeId)
    return { ok: true }
  })

  handle('setups:unlinkRRType', (_event, { setupId, rrTypeId }) => {
    db.prepare(
      'DELETE FROM Setup_RRTypes WHERE setupId = ? AND rrTypeId = ?'
    ).run(setupId, rrTypeId)
    return { ok: true }
  })
}
