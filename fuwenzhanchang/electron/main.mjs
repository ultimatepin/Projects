import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import electron from 'electron'
import updaterPackage from 'electron-updater'

const { app, BrowserWindow, clipboard, ipcMain } = electron
const { autoUpdater } = updaterPackage
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const hasInstanceLock = app.requestSingleInstanceLock()

let mainWindow = null
let rendererOrigin = null
let serverApi = null
let serverInfo = null
let updateConfigured = false
let updateCheckInFlight = false
let updateState = { status: 'idle', progress: 0 }
let shuttingDown = false

if (!hasInstanceLock) app.quit()

function sendUpdateState(next) {
  updateState = { ...updateState, ...next }
  if (!mainWindow?.isDestroyed()) mainWindow.webContents.send('updates:state', updateState)
  return updateState
}

function trustedSender(event) {
  try { return new URL(event.senderFrame.url).origin === rendererOrigin } catch { return false }
}

function requireTrustedSender(event) {
  if (!trustedSender(event)) throw new Error('This action is only available in the desktop host window.')
}

function canBind(port) {
  return new Promise((resolve) => {
    const tester = net.createServer()
    tester.once('error', () => resolve(false))
    tester.listen(port, '0.0.0.0', () => tester.close(() => resolve(true)))
  })
}

async function findLanPort() {
  for (let port = 3001; port <= 3015; port += 1) {
    if (await canBind(port)) return port
  }
  throw new Error('No local port is available between 3001 and 3015.')
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: '#090b0e',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event, target) => {
    try {
      if (new URL(target).origin !== rendererOrigin) event.preventDefault()
    } catch { event.preventDefault() }
  })
  mainWindow.once('ready-to-show', () => {
    if (process.env.RIFT_DESKTOP_SMOKE !== '1') mainWindow.show()
  })
  mainWindow.webContents.once('did-finish-load', async () => {
    if (process.env.RIFT_DESKTOP_SMOKE === '1') {
      console.log(`Desktop smoke test loaded ${rendererOrigin}`)
      const smokePage = ['discover', 'decks', 'play', 'updates'].includes(process.env.RIFT_DESKTOP_SMOKE_PAGE)
        ? process.env.RIFT_DESKTOP_SMOKE_PAGE
        : null
      if (smokePage) {
        await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-page="${smokePage}"]')?.click()`)
      }
      if (process.env.RIFT_DESKTOP_SCREENSHOT) {
        const requestedDelay = Number(process.env.RIFT_DESKTOP_SMOKE_DELAY || 1800)
        const smokeDelay = Math.min(10000, Math.max(0, Number.isFinite(requestedDelay) ? requestedDelay : 1800))
        await new Promise((resolve) => setTimeout(resolve, smokeDelay))
        const image = await mainWindow.webContents.capturePage()
        fs.writeFileSync(process.env.RIFT_DESKTOP_SCREENSHOT, image.toPNG())
      }
      setTimeout(() => shutdown(), 150)
    }
  })
  mainWindow.loadURL(rendererOrigin)
}

function configureUpdater() {
  const updateConfig = path.join(process.resourcesPath, 'app-update.yml')
  updateConfigured = app.isPackaged && fs.existsSync(updateConfig)
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false

  autoUpdater.on('checking-for-update', () => sendUpdateState({ status: 'checking', message: '', progress: 0 }))
  autoUpdater.on('update-available', (info) => sendUpdateState({ status: 'available', version: info.version, message: `Version ${info.version} is ready to download.` }))
  autoUpdater.on('update-not-available', () => sendUpdateState({ status: 'current', message: 'This is the newest available version.', progress: 0 }))
  autoUpdater.on('download-progress', (progress) => sendUpdateState({ status: 'downloading', progress: progress.percent, message: `${Math.round(progress.percent)}% downloaded` }))
  autoUpdater.on('update-downloaded', (info) => sendUpdateState({ status: 'downloaded', version: info.version, progress: 100, message: `Version ${info.version} is ready. Install when your match is finished.` }))
  autoUpdater.on('error', (error) => sendUpdateState({ status: 'error', message: error?.message || 'The update service could not be reached.' }))
}

ipcMain.handle('clipboard:write', (event, value) => {
  requireTrustedSender(event)
  clipboard.writeText(String(value))
  return true
})

ipcMain.handle('app:get-info', (event) => {
  requireTrustedSender(event)
  return {
    version: app.getVersion(),
    packaged: app.isPackaged,
    updateConfigured,
    localUrls: serverInfo?.urls || [],
  }
})

ipcMain.handle('updates:check', async (event) => {
  requireTrustedSender(event)
  if (!updateConfigured) return sendUpdateState({ status: 'disabled', message: app.isPackaged ? 'This installer was built without an update channel.' : 'Update checks are enabled only in installed release builds.' })
  if (updateCheckInFlight) return updateState
  updateCheckInFlight = true
  try {
    await autoUpdater.checkForUpdates()
    return updateState
  } finally {
    updateCheckInFlight = false
  }
})

ipcMain.handle('updates:download', async (event) => {
  requireTrustedSender(event)
  if (!updateConfigured) throw new Error('This build has no update channel.')
  sendUpdateState({ status: 'downloading', progress: 0, message: 'Starting download…' })
  await autoUpdater.downloadUpdate()
  return updateState
})

ipcMain.handle('updates:install', async (event) => {
  requireTrustedSender(event)
  if (updateState.status !== 'downloaded') throw new Error('Download the update before installing it.')
  if (serverApi?.getServerStatus().activeGames > 0) throw new Error('Finish or leave the active match before installing the update.')
  shuttingDown = true
  await stopServer()
  autoUpdater.quitAndInstall(false, true)
  return true
})

async function startServer() {
  const appRoot = app.getAppPath()
  process.env.RIFT_DIST_DIR = path.join(appRoot, 'dist')
  process.env.RIFT_ACCOUNT_DATA_DIR = path.join(app.getPath('userData'), 'accounts')
  serverApi = await import('../server/index.js')
  const port = await findLanPort()
  serverInfo = await serverApi.startLanServer({ port, host: '0.0.0.0', quiet: true })
  rendererOrigin = `http://127.0.0.1:${serverInfo.port}`
}

async function stopServer() {
  if (!serverApi) return
  const current = serverApi
  serverApi = null
  await current.stopLanServer()
}

async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  await stopServer().catch(() => {})
  app.quit()
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
})

app.whenReady().then(async () => {
  if (!hasInstanceLock) return
  try {
    await startServer()
    configureUpdater()
    createWindow()
  } catch (error) {
    console.error(error)
    app.quit()
  }
})

app.on('window-all-closed', () => shutdown())
