import { ipcMain, dialog, app } from 'electron'
import { join } from 'path'
import { writeFileSync, copyFileSync } from 'fs'
import { getDb, closeDb } from '../database/index.js'

function handle(channel, fn) {
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, fn)
}

export function registerAppHandlers() {
  // Return current DB file path
  handle('app:getDbPath', () => getDb().name)

  // Open folder picker → save config → relaunch
  handle('app:chooseDbFolder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose Database Folder'
    })
    if (canceled || !filePaths.length) return { ok: false }
    const configPath = join(app.getPath('userData'), 'app-config.json')
    writeFileSync(configPath, JSON.stringify({ dbFolder: filePaths[0] }, null, 2))
    app.relaunch()
    app.exit(0)
    return { ok: true }
  })

  // Save dialog → copy DB file to chosen location
  handle('app:exportDb', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: 'trading-journal-backup.db',
      filters: [{ name: 'SQLite Database', extensions: ['db'] }],
      title: 'Export Database'
    })
    if (canceled || !filePath) return { ok: false }
    copyFileSync(getDb().name, filePath)
    return { ok: true, path: filePath }
  })

  // Open dialog → close DB → copy chosen file → relaunch
  handle('app:importDb', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      filters: [{ name: 'SQLite Database', extensions: ['db'] }],
      properties: ['openFile'],
      title: 'Import Database'
    })
    if (canceled || !filePaths.length) return { ok: false }
    const destPath = getDb().name
    closeDb()
    copyFileSync(filePaths[0], destPath)
    app.relaunch()
    app.exit(0)
    return { ok: true }
  })
}
