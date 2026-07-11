import { BrowserWindow, screen } from 'electron'

const PROMPT_WIDTH = 390
const PROMPT_HEIGHT = 76
const PROMPT_TOP_MARGIN = 14
const ACTION_RECORD = 'gappd-prompt://record'
const ACTION_DISMISS = 'gappd-prompt://dismiss'
const ACTION_KEEP = 'gappd-auto-stop://keep'
const ACTION_STOP = 'gappd-auto-stop://stop'
const SCRIPT_NONCE = 'gappd-countdown'

let promptWindow: BrowserWindow | null = null
let promptKey: string | null = null
let autoStopWindow: BrowserWindow | null = null

type PromptInput = {
  key: string
  title: string
  onRecord: () => void
}

type AutoStopInput = {
  title: string
  seconds: number
  onKeep: () => void
  onStop: () => void
}

export function showMeetingPrompt(input: PromptInput): void {
  stopMeetingPrompts()
  const window = createPromptWindow()
  promptWindow = window
  promptKey = input.key
  handlePromptActions(window, input)
  void window.loadURL(promptDataUrl(input)).then(() => window.showInactive())
}

export function dismissMeetingPrompt(key: string): void {
  if (promptKey === key) stopMeetingPrompts()
}

export function stopMeetingPrompts(): void {
  promptWindow?.destroy()
  promptWindow = null
  promptKey = null
  dismissAutoStopPrompt()
}

export function showAutoStopPrompt(input: AutoStopInput): void {
  dismissAutoStopPrompt()
  const window = createPromptWindow()
  autoStopWindow = window
  handleAutoStopActions(window, input)
  void window.loadURL(autoStopDataUrl(input)).then(() => window.showInactive())
}

export function dismissAutoStopPrompt(): void {
  autoStopWindow?.destroy()
  autoStopWindow = null
}

function createPromptWindow(): BrowserWindow {
  const bounds = promptBounds()
  const window = new BrowserWindow({
    ...bounds, show: false, frame: false, transparent: true, resizable: false,
    movable: true, minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, hasShadow: true, backgroundColor: '#00000000',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  window.setAlwaysOnTop(true, 'floating')
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  return window
}

function promptBounds(): { width: number; height: number; x: number; y: number } {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const x = Math.round(display.workArea.x + (display.workArea.width - PROMPT_WIDTH) / 2)
  return { width: PROMPT_WIDTH, height: PROMPT_HEIGHT, x, y: display.workArea.y + PROMPT_TOP_MARGIN }
}

function handlePromptActions(window: BrowserWindow, input: PromptInput): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    stopMeetingPrompts()
    if (url === ACTION_RECORD) input.onRecord()
  })
  window.on('closed', () => {
    if (promptWindow !== window) return
    promptWindow = null
    promptKey = null
  })
}

function handleAutoStopActions(window: BrowserWindow, input: AutoStopInput): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    dismissAutoStopPrompt()
    if (url === ACTION_KEEP) input.onKeep()
    if (url === ACTION_STOP) input.onStop()
  })
  window.on('closed', () => { if (autoStopWindow === window) autoStopWindow = null })
}

function promptDataUrl(input: PromptInput): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(promptHtml(input))}`
}

function autoStopDataUrl(input: AutoStopInput): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(autoStopHtml(input))}`
}

function promptHtml(input: PromptInput): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>
    *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;font-family:"Hanken Grotesk",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    .shell{-webkit-app-region:drag;margin:6px;height:64px;display:flex;align-items:center;gap:11px;padding:8px 8px 8px 11px;color:#dce0e5;background:linear-gradient(180deg,#2f343e,#282c33);border:1px solid #404552;border-radius:14px;box-shadow:inset 0 1px 0 rgba(255,255,255,.05),0 16px 40px -20px rgba(5,7,12,.78)}
    .logo{width:34px;height:34px;flex:none;filter:drop-shadow(0 0 10px rgba(116,173,232,.28))}.wave{stroke:#fff;stroke-width:2;stroke-linecap:round}
    .copy{min-width:0;flex:1;line-height:1.2}.title{font-size:13px;font-weight:650;letter-spacing:-.01em}.subtitle{margin-top:3px;color:#9da5b0;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .action{-webkit-app-region:no-drag;text-decoration:none;display:grid;place-items:center;height:38px;border-radius:10px;font-size:12px;font-weight:650;transition:background .14s ease,border-color .14s ease,color .14s ease}
    .record{padding:0 17px;border:1px solid #74ade8;background:linear-gradient(180deg,#5e9ce0,#4d87cf);color:#fff;box-shadow:0 6px 20px -8px rgba(116,173,232,.58)}.record:hover{background:linear-gradient(180deg,#6aa6e8,#5690d6)}
    .close{width:34px;border:1px solid transparent;color:#9da5b0;font-size:18px}.close:hover{border-color:#404552;color:#dce0e5;background:#343a45}
  </style></head><body><div class="shell"><svg class="logo" viewBox="0 0 32 32" role="img" aria-label="Gappd"><defs><linearGradient id="gappd-tile" x1="16" y1="2" x2="16" y2="30" gradientUnits="userSpaceOnUse"><stop stop-color="#5e9ce0"/><stop offset="1" stop-color="#4d87cf"/></linearGradient></defs><rect x="2" y="2" width="28" height="28" rx="8" fill="url(#gappd-tile)"/><rect x="2" y="2" width="28" height="14" rx="8" fill="#fff" opacity=".06"/><g class="wave"><path d="M8.7 13v6"/><path d="M11.2 11v10"/><path d="M13.7 9v14"/><path d="M18.3 9v14"/><path d="M20.8 11v10"/><path d="M23.3 13v6"/></g></svg><div class="copy"><div class="title">Meeting detected</div><div class="subtitle">${escapeHtml(input.title)}</div></div><a class="action record" href="${ACTION_RECORD}">Record</a><a class="action close" href="${ACTION_DISMISS}" aria-label="Dismiss">×</a></div></body></html>`
}

function autoStopHtml(input: AutoStopInput): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${SCRIPT_NONCE}'"><style>
    *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.shell{-webkit-app-region:drag;margin:6px;height:64px;display:flex;align-items:center;gap:10px;padding:8px 10px;color:#dce0e5;background:#282c33;border:1px solid #404552;border-radius:14px}.copy{min-width:0;flex:1}.title{font-size:13px;font-weight:650}.subtitle{margin-top:3px;color:#9da5b0;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.action{-webkit-app-region:no-drag;text-decoration:none;padding:10px;border-radius:9px;font-size:11px;font-weight:650}.keep{color:#dce0e5;border:1px solid #515867}.stop{color:#fff;background:#c65353}
  </style></head><body><div class="shell"><div class="copy"><div class="title">Meeting ended? Stopping in <span id="count">${input.seconds}</span>s</div><div class="subtitle">${escapeHtml(input.title)}</div></div><a class="action keep" href="${ACTION_KEEP}">Keep recording</a><a class="action stop" href="${ACTION_STOP}">Stop now</a></div><script nonce="${SCRIPT_NONCE}">let n=${input.seconds};setInterval(()=>{n=Math.max(0,n-1);document.getElementById('count').textContent=String(n)},1000)</script></body></html>`
}

function escapeHtml(value: string): string {
  const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  return value.replace(/[&<>"']/g, (character) => entities[character] ?? character)
}
