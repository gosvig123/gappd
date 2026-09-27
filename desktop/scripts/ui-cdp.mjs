#!/usr/bin/env node
// Drive only an isolated development fixture. Never expose this CDP port outside localhost.
import { readFileSync, realpathSync } from 'node:fs'
const profile = process.env.GAPPD_SELECTED_FIXTURE_PROFILE
if (!profile || realpathSync(profile) !== profile || readFileSync(`${profile}/selected-fixture`, 'utf8') !== 'gappd-selected-local-fixture-v1\n') {
  throw new Error('Set GAPPD_SELECTED_FIXTURE_PROFILE to an isolated fixture before connecting')
}
const [action = 'inspect', selector] = process.argv.slice(2)
const port = Number(process.env.GAPPD_UI_CDP_PORT || 9337)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid GAPPD_UI_CDP_PORT')
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const target = targets.find((item) => item.type === 'page' && item.url === 'http://127.0.0.1:5173/')
if (!target) throw new Error('No isolated development Gappd page on this port')
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})
let sequence = 0
function send(method, params = {}) {
  const id = ++sequence
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { socket.removeEventListener('message', onMessage); reject(new Error(`${method} timed out`)) }, 5000)
    function onMessage(event) {
      const response = JSON.parse(event.data)
      if (response.id !== id) return
      clearTimeout(timeout)
      socket.removeEventListener('message', onMessage)
      if (response.error) reject(new Error(response.error.message))
      else resolve(response.result)
    }
    socket.addEventListener('message', onMessage)
    socket.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  return result.result.value
}
try {
  if (action === 'inspect') {
    console.log(JSON.stringify(await evaluate(`[...document.querySelectorAll('button, input, select, [role="button"], [role="switch"], h1, h2')].filter(e => e.getBoundingClientRect().width && e.getBoundingClientRect().height).map(e => ({ tag: e.tagName.toLowerCase(), type: e.getAttribute('type'), role: e.getAttribute('role'), text: (e.innerText || e.getAttribute('aria-label') || e.getAttribute('placeholder') || e.closest('label')?.innerText || '').slice(0, 90), id: e.id || undefined, checked: e.type === 'checkbox' ? e.checked : e.getAttribute('aria-checked') })).slice(0, 100)`), null, 2))
  } else if (['click', 'click-text', 'click-prefix', 'click-label'].includes(action) && selector) {
    const lookup = action === 'click'
      ? `document.querySelector(${JSON.stringify(selector)})`
      : `(() => { const matches = [...document.querySelectorAll(${JSON.stringify(action === 'click-label' ? 'label' : 'button, [role="button"]')})].filter(e => ${action === 'click-label' ? 'e.innerText.trim().startsWith' : action === 'click-prefix' ? '(e.innerText || e.getAttribute("aria-label") || "").trim().startsWith' : '(e.innerText || e.getAttribute("aria-label") || "").trim() ==='}(${JSON.stringify(selector)}) && e.getBoundingClientRect().width); if (matches.length !== 1) throw Error('Expected one visible matching control, found ' + matches.length); return ${action === 'click-label' ? '(matches[0].querySelector("input") || matches[0])' : 'matches[0]'} })()`
    const point = await evaluate(`(() => { const e = ${lookup}; if (!e || e.disabled) throw Error('Control not found or disabled'); e.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' }); const r = e.getBoundingClientRect(); if (!r.width || !r.height) throw Error('Control not visible'); const x = r.left + r.width / 2, y = r.top + r.height / 2; if (!e.contains(document.elementFromPoint(x, y))) throw Error('Control is covered by another element'); return { x, y } })()`)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point })
    console.log(`Clicked ${selector}`)
  } else {
    throw new Error('Usage: node scripts/ui-cdp.mjs inspect | click <CSS-selector> | click-text <exact-label> | click-prefix <button-prefix> | click-label <label-prefix>')
  }
} finally {
  socket.close()
}
