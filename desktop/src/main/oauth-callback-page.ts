/**
 * The browser page a Gappd or Google sign-in ends on. It is self-contained (no network, no
 * script) because the loopback server serves it once and then stops.
 */
/** The Graphite mark: an ink tile with card-coloured waves, so it follows the page theme. */
const LOGO = `<svg class="logo" viewBox="0 0 32 32" width="36" height="36" fill="none" role="img" aria-label="Gappd" xmlns="http://www.w3.org/2000/svg">
<rect class="tile" x="2" y="2" width="28" height="28" rx="8"/>
<g class="wave" stroke-width="2" stroke-linecap="round"><path d="M8.7 13v6"/><path d="M11.2 11v10"/><path d="M13.7 9v14"/><path d="M18.3 9v14"/><path d="M20.8 11v10"/><path d="M23.3 13v6"/></g></svg>`

/** Graphite colours from desktop/src/renderer/theme.css; the browser picks the theme. */
const STYLE = `:root{color-scheme:dark;--bg:#141415;--card:#1a1a1c;--text:#ededef;--soft:#c3c3c5;--border:#2e2e33;--danger:#f2706a}
@media (prefers-color-scheme:light){:root{color-scheme:light;--bg:#fafafa;--card:#ffffff;--text:#18181b;--soft:#4f4f55;--border:#e4e4e7;--danger:#c8261d}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--text);font:15px/1.5 "Hanken Grotesk",ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif}
main{width:min(100%,420px);padding:32px;border:1px solid var(--border);border-radius:14px;background:var(--card);display:grid;gap:12px}
.brand{display:flex;align-items:center;gap:10px;font-size:17px;font-weight:600}.tile{fill:var(--text)}.wave{stroke:var(--card)}
h1{margin:8px 0 0;font-size:22px;letter-spacing:-0.025em}p{margin:0;color:var(--soft)}
.problem{border-left:2px solid var(--danger);padding-left:10px;color:var(--text)}`

export const CALLBACK_PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:"

export function callbackPage(outcome: { ok: true } | { ok: false; problem: string }): string {
  const body = outcome.ok
    ? '<h1>Almost done</h1><p>Go back to Gappd; it finishes from here. You can close this tab.</p>'
    : `<h1>Sign-in did not finish</h1><p class="problem">${escapeHtml(outcome.problem)}</p><p>You can close this tab and go back to Gappd.</p>`
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gappd</title><style>${STYLE}</style></head>
<body><main><div class="brand">${LOGO}<span>Gappd</span></div>${body}</main></body></html>`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
}
