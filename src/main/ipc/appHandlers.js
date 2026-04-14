import { ipcMain, dialog, app, shell } from 'electron'
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

  // Open URL in system default browser
  handle('app:openExternal', (_event, url) => {
    shell.openExternal(url)
    return { ok: true }
  })

  // Fetch URL from main process (no CORS) and extract the actual image URL
  handle('app:fetchImageUrl', async (_event, url) => {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
        },
        redirect: 'follow'
      })

      const contentType = res.headers.get('content-type') || ''
      if (contentType.startsWith('image/')) {
        return { ok: true, imageUrl: url }
      }

      const html = await res.text()

      // og:image (two attribute orders)
      const og = html.match(
        /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i
      ) || html.match(
        /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i
      )
      if (og) return { ok: true, imageUrl: og[1] }

      // twitter:image fallback
      const tw = html.match(
        /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i
      ) || html.match(
        /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i
      )
      if (tw) return { ok: true, imageUrl: tw[1] }

      return { ok: false, imageUrl: null }
    } catch (e) {
      return { ok: false, imageUrl: null, error: e.message }
    }
  })

  // Fetch an image URL from main process and return it as a base64 data URL
  // This bypasses Electron CSP that blocks <img src> for external domains.
  handle('app:fetchImageAsBase64', async (_event, url) => {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'image/webp,image/png,image/*,*/*'
        },
        redirect: 'follow'
      })
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
      const contentType = res.headers.get('content-type') || 'image/png'
      const arrayBuffer = await res.arrayBuffer()
      const base64 = Buffer.from(arrayBuffer).toString('base64')
      return { ok: true, dataUrl: `data:${contentType};base64,${base64}` }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })
}
