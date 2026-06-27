import path from 'node:path'
import { app, BrowserWindow } from 'electron'
import { stopStaleRecordingRecovery } from './gappd'
import { registerIpc } from './ipc'
import { bootstrapOnboarding } from './onboarding'
import { stopManagedOllama } from './ollama'
import { startAutoUpdateChecks, stopAutoUpdateChecks } from './update'

let mainWindow: BrowserWindow | null = null

function applyDevDockIcon(): void {
  if (process.platform !== 'darwin' || app.isPackaged || !app.dock) return
  app.dock.setIcon(path.join(__dirname, '../../assets/app-icon.png'))
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
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

  registerIpc(mainWindow)

  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl)
    if (process.env.OPEN_DEVTOOLS === '1') mainWindow.webContents.openDevTools({ mode: 'detach' })
    return
  }

  void mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'))
}

app.whenReady().then(() => {
  applyDevDockIcon()
  createWindow()
  void bootstrapOnboarding()
  startAutoUpdateChecks()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  stopStaleRecordingRecovery()
  stopManagedOllama()
  stopAutoUpdateChecks()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
