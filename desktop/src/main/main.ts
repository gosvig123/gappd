import path from 'node:path'
import { app, autoUpdater as nativeAutoUpdater, BrowserWindow, powerMonitor } from 'electron'
import { registerIpc } from './ipc'
import { pauseDrains, resumeDrains, startDrainCoordinator, stopDrainCoordinator } from './drain-coordinator'
import { logMainProcessMemory } from './memory'
import { bootstrapManagedRuntime, managedRuntime } from './managed-runtime'
import { startMeetingPresence, stopMeetingPresence } from './meeting-presence'
import { stopActiveRecordingForQuit } from './recording-process'
import { migrateScreenCaptureIdentity } from './screen-permission-migration'
import { stopStaleRecordingRecovery } from './stale-recording-recovery'
import { initializeStartupSettings, shouldStartHidden } from './startup-settings'
import { startAutoUpdateChecks, stopAutoUpdateChecks } from './update'

const BEFORE_QUIT_FOR_UPDATE_EVENT = 'before-quit-for-update'

let mainWindow: BrowserWindow | null = null
let quitAllowed = false
let shutdownStarted = false
let updateInstallRequested = false

function applyDevDockIcon(): void {
  if (process.platform !== 'darwin' || app.isPackaged || !app.dock) return
  app.dock.setIcon(path.join(__dirname, '../../assets/app-icon.png'))
}

function migrateScreenCapturePermission(): void {
  if (process.platform !== 'darwin' || !app.isPackaged) return
  try { migrateScreenCaptureIdentity(process.execPath, app.getPath('userData')) }
  catch (error) { console.error('ScreenCapture identity migration failed', error) }
}

function createWindow(show = true): void {
  const createdWindow = new BrowserWindow({
    show,
    width: 1200,
    height: 780,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0b1020',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow = createdWindow
  registerIpc(createdWindow)
  createdWindow.on('closed', () => {
    if (mainWindow === createdWindow) mainWindow = null
  })

  loadRenderer(createdWindow)
}

function showMainWindow(): void {
  if (!mainWindow) return createWindow()
  mainWindow.show()
  mainWindow.focus()
}

function loadRenderer(createdWindow: BrowserWindow): void {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  if (devServerUrl) {
    void createdWindow.loadURL(devServerUrl)
    if (process.env.OPEN_DEVTOOLS === '1') createdWindow.webContents.openDevTools({ mode: 'detach' })
    return
  }
  void createdWindow.loadFile(path.join(__dirname, '../../dist/index.html'))
}

app.whenReady().then(async () => {
  applyDevDockIcon()
  migrateScreenCapturePermission()
  const startHidden = shouldStartHidden()
  initializeStartupSettings()
  createWindow(!startHidden)
  await bootstrapManagedRuntime()
  startDrainCoordinator()
  startMeetingPresence(showMainWindow)
  startAutoUpdateChecks()
  logMainProcessMemory('ready')

  app.on('activate', showMainWindow)
  powerMonitor.on('suspend', () => { void pauseDrains().catch((error) => console.error('Failed to pause drains for sleep', error)) })
  powerMonitor.on('resume', resumeDrains)
})

nativeAutoUpdater.on(BEFORE_QUIT_FOR_UPDATE_EVENT, () => { updateInstallRequested = true })

app.on('before-quit', (event) => {
  if (quitAllowed) return
  event.preventDefault()
  if (shutdownStarted) return
  shutdownStarted = true
  void shutdown().finally(quitAfterShutdown)
})

function quitAfterShutdown(): void {
  quitAllowed = true
  if (updateInstallRequested) return nativeAutoUpdater.quitAndInstall()
  app.quit()
}

async function shutdown(): Promise<void> {
  logMainProcessMemory('shutdown:start')
  stopStaleRecordingRecovery()
  await stopDrainCoordinator()
  stopMeetingPresence()
  stopAutoUpdateChecks()
  await stopActiveRecordingForQuit()
  await managedRuntime.close()
  logMainProcessMemory('shutdown:done')
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
