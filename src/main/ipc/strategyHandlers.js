import { ipcMain } from 'electron'
import { getDb } from '../database/index.js'

function handle(channel, fn) {
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, fn)
}

export function registerStrategyHandlers() {
  const db = getDb()

  handle('strategies:getAll', () => {
    return db.prepare('SELECT * FROM Strategies ORDER BY name').all()
  })

  handle('strategies:create', (_event, { name, description }) => {
    const { lastInsertRowid } = db
      .prepare('INSERT INTO Strategies (name, description) VALUES (?, ?)')
      .run(name, description || null)
    return db.prepare('SELECT * FROM Strategies WHERE id = ?').get(lastInsertRowid)
  })

  handle('strategies:delete', (_event, id) => {
    db.prepare('DELETE FROM Strategies WHERE id = ?').run(id)
    return { ok: true }
  })
}
