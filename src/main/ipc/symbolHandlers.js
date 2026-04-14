import { ipcMain } from 'electron'
import { getDb } from '../database/index.js'

function handle(channel, fn) {
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, fn)
}

export function registerSymbolHandlers() {
  const db = getDb()

  handle('symbols:getAll', () =>
    db.prepare('SELECT * FROM Symbols ORDER BY name').all()
  )

  handle('symbols:create', (_event, name) => {
    db.prepare('INSERT INTO Symbols (name) VALUES (?)').run(name.trim().toUpperCase())
    return db.prepare('SELECT * FROM Symbols ORDER BY name').all()
  })

  handle('symbols:delete', (_event, id) => {
    db.prepare('DELETE FROM Symbols WHERE id = ?').run(id)
    return { ok: true }
  })
}
