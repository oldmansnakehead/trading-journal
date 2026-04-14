import { app, shell, BrowserWindow, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import icon from '../../resources/icon.png?asset'

app.commandLine.appendSwitch('disable-features', 'AutofillServerCommunication')

import { getDb } from './database/index.js'
import { registerSetupHandlers } from './ipc/setupHandlers.js'
import { registerStrategyHandlers } from './ipc/strategyHandlers.js'
import { registerJournalHandlers } from './ipc/journalHandlers.js'
import { registerSymbolHandlers } from './ipc/symbolHandlers.js'
import { registerCustomTagHandlers } from './ipc/customTagHandlers.js'
import { registerAppHandlers } from './ipc/appHandlers.js'

function setupAutoUpdater() {
  if (is.dev) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('error', (err) => {
    console.error('[AutoUpdater] Error:', err)
  })

  autoUpdater.on('update-available', (info) => {
    console.log(`[AutoUpdater] Update available: ${info.version}`)
  })

  autoUpdater.on('update-downloaded', async (info) => {
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: 'Update Ready',
      message: `Version ${info.version} has been downloaded.`,
      detail: 'The app will restart to install the update.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1
    })

    if (response === 0) {
      autoUpdater.quitAndInstall()
    }
  })

  autoUpdater.checkForUpdates().catch((err) => {
    console.error('[AutoUpdater] Failed to check updates:', err)
  })
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.trading-journal')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Initialize DB and register all IPC handlers
  // Wrapped in try-catch so createWindow() always runs even if DB init fails
  try {
    getDb()
    registerSetupHandlers()
    registerStrategyHandlers()
    registerJournalHandlers()
    registerSymbolHandlers()
    registerCustomTagHandlers()
    registerAppHandlers()
  } catch (err) {
    console.error('[Main] Failed to initialize DB / IPC handlers:', err)
  }

  createWindow()
  setupAutoUpdater()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
