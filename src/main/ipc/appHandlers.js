import { ipcMain, dialog, app } from 'electron'
import { join } from 'path'
import { writeFileSync, copyFileSync, rmSync } from 'fs'
import { getDb, closeDb } from '../database/index.js'

function handle(channel, fn) {
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, fn)
}

function removeSqliteSidecarFiles(dbPath) {
  for (const suffix of ['-wal', '-shm']) {
    try {
      rmSync(`${dbPath}${suffix}`, { force: true })
    } catch {
      // Ignore if sidecar files do not exist or are already removed.
    }
  }
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
    const db = getDb()
    // Ensure latest WAL pages are merged into the main db file before copying.
    db.pragma('wal_checkpoint(TRUNCATE)')
    copyFileSync(db.name, filePath)
    removeSqliteSidecarFiles(filePath)
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
    removeSqliteSidecarFiles(destPath)
    copyFileSync(filePaths[0], destPath)
    removeSqliteSidecarFiles(destPath)
    app.relaunch()
    app.exit(0)
    return { ok: true }
  })
}
