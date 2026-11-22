import { BrowserWindow, screen } from 'electron'

const PROMPT_WIDTH = 390
// Prompts with two text buttons (auto-stop, Join & record) need more room than one Record button.
const WIDE_PROMPT_WIDTH = 490
const PROMPT_HEIGHT = 76
const PROMPT_TOP_MARGIN = 14
const ACTION_RECORD = 'gappd-prompt://record'
const ACTION_JOIN = 'gappd-prompt://join'
const ACTION_DISMISS = 'gappd-prompt://dismiss'
const ACTION_KEEP = 'gappd-auto-stop://keep'
const ACTION_STOP = 'gappd-auto-stop://stop'
const SCRIPT_NONCE = 'gappd-countdown'

let promptWindow: BrowserWindow | null = null
let promptKey: string | null = null
let autoStopWindow: BrowserWindow | null = null

type PromptInput = {
  key: string
  /** Bold first line; defaults to "Meeting detected". */
  heading?: string
  title: string
  onRecord: () => void
  /** Adds a Join & record button; Record becomes the secondary button. */
  onJoin?: () => void
}

type AutoStopInput = {
  title: string
  seconds: number
  onKeep: () => void
  onStop: () => void
}

export function showMeetingPrompt(input: PromptInput): void {
  stopMeetingPrompts()
  // Two buttons need the wider prompt.
  const window = createPromptWindow(input.onJoin ? WIDE_PROMPT_WIDTH : PROMPT_WIDTH)
  promptWindow = window
  promptKey = input.key
  handlePromptActions(window, input)
  showWhenLoaded(window, promptDataUrl(input))
}

/** True while the prompt with this key is on screen (not dismissed or replaced). */
export function meetingPromptShown(key: string): boolean {
  return promptKey === key && !!promptWindow && !promptWindow.isDestroyed()
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
  const window = createPromptWindow(WIDE_PROMPT_WIDTH)
  autoStopWindow = window
  handleAutoStopActions(window, input)
  showWhenLoaded(window, autoStopDataUrl(input))
}

/** A prompt can be dismissed while it loads; then its load is cancelled and it must stay hidden. */
function showWhenLoaded(window: BrowserWindow, url: string): void {
  window.loadURL(url).then(() => { if (!window.isDestroyed()) window.showInactive() }, () => {})
}

export function dismissAutoStopPrompt(): void {
  autoStopWindow?.destroy()
  autoStopWindow = null
}

function createPromptWindow(width = PROMPT_WIDTH): BrowserWindow {
  const bounds = promptBounds(width)
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

function promptBounds(width: number): { width: number; height: number; x: number; y: number } {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const x = Math.round(display.workArea.x + (display.workArea.width - width) / 2)
  return { width, height: PROMPT_HEIGHT, x, y: display.workArea.y + PROMPT_TOP_MARGIN }
}

function handlePromptActions(window: BrowserWindow, input: PromptInput): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    stopMeetingPrompts()
    if (url === ACTION_RECORD) input.onRecord()
    if (url === ACTION_JOIN) input.onJoin?.()
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

/**
 * Graphite theme colours from renderer/theme.css. A data: URL page cannot load the app
 * stylesheet, so the prompts copy the tokens they use; prefers-color-scheme follows the
 * app theme through nativeTheme.themeSource (system:setTheme).
 */
const PROMPT_STYLE = `:root{color-scheme:dark;--card:#1a1a1c;--border:#46464c;--text:#ededef;--muted:#a4a4a7;--hover:#28282a;--mark-wave:#1a1a1c;--record:#dc2f26;--record-hover:#c4261e;--shadow:0 1px 2px rgba(5,7,12,.55),0 16px 40px -20px rgba(5,7,12,.75)}
    @media (prefers-color-scheme:light){:root{color-scheme:light;--card:#ffffff;--border:#d0d0d4;--text:#18181b;--muted:#5f5f63;--hover:#f3f3f4;--mark-wave:#ffffff;--shadow:0 1px 2px rgba(24,24,27,.08),0 16px 40px -20px rgba(24,24,27,.22)}}
    *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;font-family:"Hanken Grotesk",ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    .shell{-webkit-app-region:drag;margin:6px;height:64px;display:flex;align-items:center;gap:10px;padding:8px 8px 8px 11px;color:var(--text);background:var(--card);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow)}
    .logo{width:32px;height:32px;flex:none}.tile{fill:var(--text)}.wave{stroke:var(--mark-wave);stroke-width:2;stroke-linecap:round}
    .copy{min-width:0;flex:1;line-height:1.3}.title{font-size:13px;font-weight:600;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.subtitle{margin-top:2px;color:var(--muted);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .action{-webkit-app-region:no-drag;text-decoration:none;display:grid;place-items:center;height:34px;padding:0 12px;border-radius:10px;border:1px solid transparent;font-size:12px;font-weight:600;white-space:nowrap;transition:background .14s ease,border-color .14s ease,color .14s ease}
    .action:focus-visible{outline:none;box-shadow:0 0 0 2px var(--card),0 0 0 4px var(--text)}
    .record{padding:0 16px;background:var(--record);color:#fff}.record:hover{background:var(--record-hover)}
    .secondary{color:var(--text);border-color:var(--border);background:var(--card)}.secondary:hover{background:var(--hover)}
    .close{width:32px;padding:0;color:var(--muted);font-size:18px}.close:hover{color:var(--text);background:var(--hover)}`

const MARK = '<svg class="logo" viewBox="0 0 32 32" role="img" aria-label="Gappd"><rect class="tile" x="2" y="2" width="28" height="28" rx="8"/><g class="wave"><path d="M8.7 13v6"/><path d="M11.2 11v10"/><path d="M13.7 9v14"/><path d="M18.3 9v14"/><path d="M20.8 11v10"/><path d="M23.3 13v6"/></g></svg>'

function promptHtml(input: PromptInput): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>${PROMPT_STYLE}</style></head><body><div class="shell">${MARK}<div class="copy"><div class="title">${escapeHtml(input.heading ?? 'Meeting detected')}</div><div class="subtitle">${escapeHtml(input.title)}</div></div>${input.onJoin ? `<a class="action secondary" href="${ACTION_RECORD}">Record</a><a class="action record" href="${ACTION_JOIN}">Join &amp; record</a>` : `<a class="action record" href="${ACTION_RECORD}">Record</a>`}<a class="action close" href="${ACTION_DISMISS}" aria-label="Dismiss">×</a></div></body></html>`
}

function autoStopHtml(input: AutoStopInput): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${SCRIPT_NONCE}'"><style>${PROMPT_STYLE}</style></head><body><div class="shell"><div class="copy"><div class="title">Meeting ended? Stopping in <span id="count">${input.seconds}</span>s</div><div class="subtitle">${escapeHtml(input.title)}</div></div><a class="action secondary" href="${ACTION_KEEP}">Keep recording</a><a class="action record" href="${ACTION_STOP}">Stop now</a></div><script nonce="${SCRIPT_NONCE}">let n=${input.seconds};setInterval(()=>{n=Math.max(0,n-1);document.getElementById('count').textContent=String(n)},1000)</script></body></html>`
}

function escapeHtml(value: string): string {
  const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  return value.replace(/[&<>"']/g, (character) => entities[character] ?? character)
}
