import { ipcMain } from 'electron'
import { getDb } from '../database/index.js'

function handle(channel, fn) {
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, fn)
}

export function registerCustomTagHandlers() {
  const db = getDb()

  handle('customTags:getAll', () => {
    return db.prepare('SELECT * FROM CustomTags ORDER BY name').all()
  })

  handle('customTags:create', (_event, { name }) => {
    const { lastInsertRowid } = db
      .prepare('INSERT INTO CustomTags (name) VALUES (?)').run(name)
    return db.prepare('SELECT * FROM CustomTags WHERE id = ?').get(lastInsertRowid)
  })

  handle('customTags:delete', (_event, id) => {
    db.prepare('DELETE FROM CustomTags WHERE id = ?').run(id)
    return { ok: true }
  })
}
