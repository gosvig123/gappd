/**
 * The browser page a Gappd or Google sign-in ends on. It is self-contained (no network, no
 * script) because the loopback server serves it once and then stops.
 */
const LOGO = `<svg viewBox="0 0 32 32" width="40" height="40" fill="none" role="img" aria-label="Gappd" xmlns="http://www.w3.org/2000/svg">
<defs><linearGradient id="tile" x1="16" y1="2" x2="16" y2="30" gradientUnits="userSpaceOnUse"><stop stop-color="#5e9ce0"/><stop offset="1" stop-color="#4d87cf"/></linearGradient></defs>
<rect x="2" y="2" width="28" height="28" rx="8" fill="url(#tile)"/><rect x="2" y="2" width="28" height="14" rx="8" fill="#ffffff" opacity="0.06"/>
<g stroke="#f5f9ff" stroke-width="2" stroke-linecap="round"><path d="M8.7 13v6"/><path d="M11.2 11v10"/><path d="M13.7 9v14"/><path d="M18.3 9v14"/><path d="M20.8 11v10"/><path d="M23.3 13v6"/></g></svg>`

const STYLE = `:root{color-scheme:dark light;--bg:#282c33;--card:#2f343e;--text:#dce0e5;--soft:#b4bac4;--border:#464b57;--accent:#74ade8}
@media (prefers-color-scheme:light){:root{--bg:#f5f6f9;--card:#ffffff;--text:#1b1f27;--soft:#4a5364;--border:#d5d9e1;--accent:#2f6fb5}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--text);font:15px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif}
main{width:min(100%,420px);padding:32px;border:1px solid var(--border);border-radius:14px;background:var(--card);display:grid;gap:12px}
.brand{display:flex;align-items:center;gap:10px;font-size:17px;font-weight:600}h1{margin:8px 0 0;font-size:22px;letter-spacing:-0.01em}p{margin:0;color:var(--soft)}
.problem{border-left:2px solid #e06c75;padding-left:10px;color:var(--text)}`

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
