import path from 'node:path'
import { app, BrowserWindow } from 'electron'
import { registerIpc } from './ipc'
import { logMainProcessMemory } from './memory'
import { bootstrapLocalAISetup } from './local-ai-setup-operation'
import { stopManagedLlamaCpp } from './llamacpp'
import { stopActiveRecordingForQuit } from './recording-process'
import { stopStaleRecordingRecovery } from './stale-recording-recovery'
import { startAutoUpdateChecks, stopAutoUpdateChecks } from './update'

let mainWindow: BrowserWindow | null = null
let shutdownStarted = false

function applyDevDockIcon(): void {
  if (process.platform !== 'darwin' || app.isPackaged || !app.dock) return
  app.dock.setIcon(path.join(__dirname, '../../assets/app-icon.png'))
}

function createWindow(): void {
  const createdWindow = new BrowserWindow({
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

function loadRenderer(createdWindow: BrowserWindow): void {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  if (devServerUrl) {
    void createdWindow.loadURL(devServerUrl)
    if (process.env.OPEN_DEVTOOLS === '1') createdWindow.webContents.openDevTools({ mode: 'detach' })
    return
  }
  void createdWindow.loadFile(path.join(__dirname, '../../dist/index.html'))
}

app.whenReady().then(() => {
  applyDevDockIcon()
  createWindow()
  void bootstrapLocalAISetup()
  startAutoUpdateChecks()
  logMainProcessMemory('ready')

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', (event) => {
  if (shutdownStarted) return
  event.preventDefault()
  shutdownStarted = true
  void shutdown().finally(() => app.quit())
})

async function shutdown(): Promise<void> {
  logMainProcessMemory('shutdown:start')
  stopStaleRecordingRecovery()
  stopAutoUpdateChecks()
  await stopActiveRecordingForQuit()
  await stopManagedLlamaCpp()
  logMainProcessMemory('shutdown:done')
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
