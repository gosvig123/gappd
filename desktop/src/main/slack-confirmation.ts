import { BrowserWindow } from 'electron'
import type { SlackSendConfirmation } from './slack-send'
import { CONFIRM_SEND_URL, oneShotConfirmation, slackConfirmationOptions } from './slack-confirmation-options'

/** Each main-owned window has one immutable review and no renderer IPC or tokens. */
export function confirmSlackSend(review: SlackSendConfirmation): Promise<boolean> {
  const options = slackConfirmationOptions(review)
  const parent = BrowserWindow.getFocusedWindow()
  const window = new BrowserWindow({
    title: options.title, width: 640, height: 700, minWidth: 480, minHeight: 400,
    show: false, ...(parent ? { parent, modal: true } : {}),
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false },
  })
  return new Promise((resolve) => {
    const settle = oneShotConfirmation((approved) => { resolve(approved); if (!window.isDestroyed()) window.destroy() })
    secureConfirmation(window, settle)
    window.once('ready-to-show', () => window.show())
    window.once('closed', () => settle(false))
    void window.loadURL(options.url).catch(() => settle(false))
  })
}

function secureConfirmation(window: BrowserWindow, settle: (approved: boolean) => void): void {
  const contents = window.webContents
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event, url) => {
    event.preventDefault()
    settle(url === CONFIRM_SEND_URL)
  })
  contents.on('will-redirect', (event) => { event.preventDefault(); settle(false) })
  contents.on('will-attach-webview', (event) => event.preventDefault())
  contents.on('render-process-gone', () => settle(false))
}
