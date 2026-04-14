import { ipcMain } from 'electron'
import { getDb } from '../database/index.js'

function handle(channel, fn) {
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, fn)
}

// Shared SELECT for journal rows (includes comma-separated strategy + custom tag names)
const JOURNAL_SELECT = `
  SELECT j.*,
         ts.name AS setupName,
         GROUP_CONCAT(DISTINCT s.name)  AS strategyNames,
         GROUP_CONCAT(DISTINCT ct.name) AS customTagNames
  FROM   Journals j
  LEFT JOIN TradeSetups ts         ON j.setupId      = ts.id
  LEFT JOIN Journal_Strategies js  ON j.id           = js.journalId
  LEFT JOIN Strategies  s          ON js.strategyId  = s.id
  LEFT JOIN Journal_CustomTags jct ON j.id           = jct.journalId
  LEFT JOIN CustomTags ct          ON jct.customTagId = ct.id
`

export function registerJournalHandlers() {
  const db = getDb()

  function withImageUrls(rows) {
    if (!rows.length) return rows

    const ids = rows.map((row) => row.id)
    const placeholders = ids.map(() => '?').join(',')
    const imageRows = db
      .prepare(
        `SELECT journalId, url
         FROM Journal_Images
         WHERE journalId IN (${placeholders})
         ORDER BY journalId ASC, sortOrder ASC, id ASC`
      )
      .all(...ids)
    const byJournalId = new Map()

    for (const image of imageRows) {
      if (!byJournalId.has(image.journalId)) byJournalId.set(image.journalId, [])
      byJournalId.get(image.journalId).push(image.url)
    }

    return rows.map((row) => ({
      ...row,
      imageUrls: byJournalId.get(row.id) ?? []
    }))
  }

  // ── Create ────────────────────────────────────────────────────────────────

  handle('journals:create', (_event, data) => {
    const { strategyIds = [], customTagIds = [], imageUrls = [], ...rest } = data

    const stmt = db.prepare(`
      INSERT INTO Journals
        (entryDateTime, exitDateTime, symbol, session, position, tf,
         rrType, result, slPoint, tpPoint, imageUrl, notes, setupId, directionBias, hasNews, colorRating)
      VALUES
        (@entryDateTime, @exitDateTime, @symbol, @session, @position, @tf,
         @rrType, @result, @slPoint, @tpPoint, @imageUrl, @notes, @setupId, @directionBias, @hasNews, @colorRating)
    `)
    const insertLink = db.prepare(
      'INSERT OR IGNORE INTO Journal_Strategies (journalId, strategyId) VALUES (?, ?)'
    )
    const insertTag = db.prepare(
      'INSERT OR IGNORE INTO Journal_CustomTags (journalId, customTagId) VALUES (?, ?)'
    )
    const insertImage = db.prepare(
      'INSERT INTO Journal_Images (journalId, url, sortOrder) VALUES (?, ?, ?)'
    )

    const run = db.transaction(() => {
      const normalizedImageUrls = imageUrls
        .map((url) => String(url || '').trim())
        .filter(Boolean)
      const payload = {
        ...rest,
        imageUrl: normalizedImageUrls[0] ?? null
      }
      const { lastInsertRowid } = stmt.run(payload)
      for (const sid of strategyIds)  insertLink.run(lastInsertRowid, sid)
      for (const tid of customTagIds) insertTag.run(lastInsertRowid, tid)
      normalizedImageUrls.forEach((url, index) => {
        insertImage.run(lastInsertRowid, url, index)
      })
      return lastInsertRowid
    })

    const id = run()
    const created = db.prepare(`${JOURNAL_SELECT} WHERE j.id = ? GROUP BY j.id`).get(id)
    return withImageUrls([created])[0]
  })

  // ── Dashboard query with dynamic multi-filters ────────────────────────────

  // Shared filter builder for list and summary
  function buildFilterConditions(filters) {
    const {
      sessions = [],
      rrTypes = [],
      symbols = [],
      setupId,
      strategyId,
      customTagId,
      hasNews,
      colorRatings = [],
      dateFrom,
      dateTo
    } = filters

    const conditions = []
    const params = []

    if (sessions.length > 0) {
      conditions.push(`j.session IN (${sessions.map(() => '?').join(',')})`)
      params.push(...sessions)
    }
    if (rrTypes.length > 0) {
      conditions.push(`j.rrType IN (${rrTypes.map(() => '?').join(',')})`)
      params.push(...rrTypes)
    }
    if (symbols.length > 0) {
      conditions.push(`j.symbol IN (${symbols.map(() => '?').join(',')})`)
      params.push(...symbols)
    }
    if (setupId) {
      conditions.push('j.setupId = ?')
      params.push(setupId)
    }
    if (strategyId) {
      conditions.push('j.id IN (SELECT journalId FROM Journal_Strategies WHERE strategyId = ?)')
      params.push(strategyId)
    }
    if (customTagId) {
      conditions.push('j.id IN (SELECT journalId FROM Journal_CustomTags WHERE customTagId = ?)')
      params.push(customTagId)
    }
    if (hasNews !== null && hasNews !== undefined) {
      conditions.push('j.hasNews = ?')
      params.push(Number(hasNews))
    }
    if (colorRatings.length > 0) {
      conditions.push(`j.colorRating IN (${colorRatings.map(() => '?').join(',')})`)
      params.push(...colorRatings)
    }
    if (dateFrom) {
      conditions.push('j.entryDateTime >= ?')
      params.push(dateFrom)
    }
    if (dateTo) {
      conditions.push('j.entryDateTime <= ?')
      params.push(dateTo)
    }
    return { conditions, params }
  }

  handle('journals:query', (_event, filters = {}) => {
    const { conditions, params } = buildFilterConditions(filters)
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const rows = db
      .prepare(`${JOURNAL_SELECT} ${where} GROUP BY j.id ORDER BY j.entryDateTime ASC`)
      .all(...params)
    return withImageUrls(rows)
  })

  // ── Summary stats ─────────────────────────────────────────────────────────

  handle('journals:getSummary', (_event, filters = {}) => {
    const { conditions, params } = buildFilterConditions(filters)
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    return db.prepare(`
      SELECT
        COUNT(*)                                                AS total,
        SUM(CASE WHEN j.result = 'Win'       THEN 1 ELSE 0 END) AS wins,
        SUM(CASE WHEN j.result = 'Loss'      THEN 1 ELSE 0 END) AS losses,
        SUM(CASE WHEN j.result = 'Breakeven' THEN 1 ELSE 0 END) AS breakevens,
        ROUND(
          100.0 * SUM(CASE WHEN j.result = 'Win' THEN 1 ELSE 0 END) /
          NULLIF(SUM(CASE WHEN j.result IN ('Win','Loss') THEN 1 ELSE 0 END), 0)
        , 2) AS winRate
      FROM Journals j
      ${where}
    `).get(...params)
  })

  // ── Distinct symbols (from journal data) ─────────────────────────────────

  handle('journals:getDistinctSymbols', () =>
    db.prepare('SELECT DISTINCT symbol FROM Journals ORDER BY symbol').all().map((r) => r.symbol)
  )

  // ── Update ────────────────────────────────────────────────────────────────

  handle('journals:update', (_event, data) => {
    const { id, strategyIds = [], customTagIds = [], imageUrls = [], ...rest } = data

    const updateStmt = db.prepare(`
      UPDATE Journals SET
        entryDateTime = @entryDateTime,
        exitDateTime  = @exitDateTime,
        symbol        = @symbol,
        session       = @session,
        position      = @position,
        tf            = @tf,
        rrType        = @rrType,
        result        = @result,
        slPoint       = @slPoint,
        tpPoint       = @tpPoint,
        notes         = @notes,
        setupId       = @setupId,
        directionBias = @directionBias,
        hasNews       = @hasNews,
        colorRating   = @colorRating,
        updatedAt     = datetime('now')
      WHERE id = @id
    `)
    const delStrategies = db.prepare('DELETE FROM Journal_Strategies WHERE journalId = ?')
    const insStrategy   = db.prepare('INSERT OR IGNORE INTO Journal_Strategies (journalId, strategyId) VALUES (?, ?)')
    const delTags       = db.prepare('DELETE FROM Journal_CustomTags WHERE journalId = ?')
    const insTag        = db.prepare('INSERT OR IGNORE INTO Journal_CustomTags (journalId, customTagId) VALUES (?, ?)')
    const delImages     = db.prepare('DELETE FROM Journal_Images WHERE journalId = ?')
    const insImage      = db.prepare('INSERT INTO Journal_Images (journalId, url, sortOrder) VALUES (?, ?, ?)')

    db.transaction(() => {
      const normalizedUrls = imageUrls.map((u) => String(u || '').trim()).filter(Boolean)
      updateStmt.run({ id, ...rest, imageUrl: normalizedUrls[0] ?? null })
      delStrategies.run(id)
      for (const sid of strategyIds) insStrategy.run(id, sid)
      delTags.run(id)
      for (const tid of customTagIds) insTag.run(id, tid)
      delImages.run(id)
      normalizedUrls.forEach((url, idx) => insImage.run(id, url, idx))
    })()

    const updated = db.prepare(`${JOURNAL_SELECT} WHERE j.id = ? GROUP BY j.id`).get(id)
    return withImageUrls([updated])[0]
  })

  // ── Delete ────────────────────────────────────────────────────────────────

  handle('journals:delete', (_event, id) => {
    db.prepare('DELETE FROM Journals WHERE id = ?').run(id)
    return { ok: true }
  })
}
