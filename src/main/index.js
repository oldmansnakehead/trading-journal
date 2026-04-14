import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

app.commandLine.appendSwitch('disable-features', 'AutofillServerCommunication')

import { getDb } from './database/index.js'
import { registerSetupHandlers } from './ipc/setupHandlers.js'
import { registerStrategyHandlers } from './ipc/strategyHandlers.js'
import { registerJournalHandlers } from './ipc/journalHandlers.js'
import { registerSymbolHandlers } from './ipc/symbolHandlers.js'
import { registerCustomTagHandlers } from './ipc/customTagHandlers.js'
import { registerAppHandlers } from './ipc/appHandlers.js'

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

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
