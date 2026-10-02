#!/usr/bin/env node
// Drive only an isolated development fixture. Never expose this CDP port outside localhost.
import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
const profile = process.env.GAPPD_SELECTED_FIXTURE_PROFILE
if (!profile || realpathSync(profile) !== profile || readFileSync(`${profile}/selected-fixture`, 'utf8') !== 'gappd-selected-local-fixture-v1\n') {
  throw new Error('Set GAPPD_SELECTED_FIXTURE_PROFILE to an isolated fixture before connecting')
}
const [action = 'inspect', selector, size] = process.argv.slice(2)
const port = Number(process.env.GAPPD_UI_CDP_PORT || 9337)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid GAPPD_UI_CDP_PORT')
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const vitePort = Number(process.env.GAPPD_UI_VITE_PORT || 5173)
if (!Number.isInteger(vitePort) || vitePort < 1 || vitePort > 65535) throw new Error('Invalid GAPPD_UI_VITE_PORT')
const target = targets.find((item) => item.type === 'page' && item.url === `http://127.0.0.1:${vitePort}/`)
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
    const timeout = setTimeout(() => { socket.removeEventListener('message', onMessage); reject(new Error(`${method} timed out`)) }, 15000)
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
// Runs in the page. Composites every background layer behind each text element; a gradient
// counts at its worst stop. Disabled controls are exempt, as in WCAG 1.4.3.
function measureTextContrast() {
  const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  const parse = (css) => {
    context.clearRect(0, 0, 1, 1)
    context.fillStyle = '#000'
    context.fillStyle = css
    context.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data
    return [r, g, b, a / 255]
  }
  const over = (top, bottom) => [0, 1, 2].map((i) => top[i] * top[3] + bottom[i] * (1 - top[3])).concat(1)
  const luminance = (c) => c.slice(0, 3).map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
  const ratio = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
  const hex = (c) => '#' + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
  const name = (e) => e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '')
  const colorPattern = /(?:rgba?|color|hsla?|oklab|oklch|lab|lch)\([^()]*\)|#[0-9a-f]{3,8}\b/gi
  const findings = new Map()
  for (const element of document.querySelectorAll('body *')) {
    if (![...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim())) continue
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    if (!rect.width || !rect.height || style.visibility !== 'visible' || element.closest('[aria-hidden="true"], :disabled, [aria-disabled="true"]')) continue
    let stacks = [[]]
    let opacity = 1
    for (let node = element; node; node = node.parentElement) {
      const nodeStyle = getComputedStyle(node)
      opacity *= Number(nodeStyle.opacity)
      const color = parse(nodeStyle.backgroundColor)
      const stops = nodeStyle.backgroundImage.includes('gradient') ? (nodeStyle.backgroundImage.match(colorPattern) || []).map(parse) : []
      if (stops.length) stacks = stacks.flatMap((stack) => stops.map((stop) => [...stack, stop]))
      if (color[3] > 0) stacks = stacks.map((stack) => [...stack, color])
      if (stacks.every((stack) => stack.some((layer) => layer[3] === 1))) break
    }
    if (opacity < 0.1) continue
    const size = parseFloat(style.fontSize)
    const weight = Number(style.fontWeight)
    const required = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5
    const ink = parse(style.color)
    const worst = stacks.map((stack) => {
      const background = stack.reduceRight((below, layer) => over(layer, below), [255, 255, 255, 1])
      const foreground = over([ink[0], ink[1], ink[2], ink[3] * opacity], background)
      return { foreground, background, value: Math.round(ratio(foreground, background) * 100) / 100 }
    }).sort((a, b) => a.value - b.value)[0]
    if (worst.value >= required) continue
    const key = [name(element.parentElement) + ' > ' + name(element), hex(worst.foreground), hex(worst.background)].join('|')
    const previous = findings.get(key)
    if (previous) { previous.count += 1; continue }
    findings.set(key, { selector: key.split('|')[0], text: element.innerText.trim().slice(0, 80), ratio: worst.value, required, fontSize: size, foreground: hex(worst.foreground), background: hex(worst.background), count: 1 })
  }
  return [...findings.values()].sort((a, b) => a.ratio - b.ratio)
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
  } else if (action === 'key' && selector) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: selector, code: selector, windowsVirtualKeyCode: selector === 'Escape' ? 27 : 0 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: selector, code: selector, windowsVirtualKeyCode: selector === 'Escape' ? 27 : 0 })
    console.log(`Pressed ${selector}`)
  } else if (action === 'theme' && ['dark', 'light'].includes(selector)) {
    // Same storage key as hooks/use-theme.ts, so a reload keeps the theme.
    await evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(selector)}; localStorage.setItem('gappd.theme', ${JSON.stringify(selector)})`)
    console.log(`Theme ${selector}`)
  } else if (action === 'screenshot' && selector) {
    // An emulated size lasts only for this CDP session, so it is part of the capture.
    const [width, height] = (size || '').split('x').map(Number)
    if (size && !(width > 0 && height > 0)) throw new Error('Size must be WIDTHxHEIGHT, for example 1280x800')
    if (size) await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 0, mobile: false })
    await evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    const { data } = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(selector, Buffer.from(data, 'base64'))
    console.log(`Saved ${selector}`)
  } else if (action === 'audit') {
    // Electron's CDP has no Audits.checkContrast, so the page measures WCAG contrast itself.
    const contrast = await evaluate(`(${measureTextContrast})()`)
    const interactive = new Set(['button', 'link', 'textbox', 'searchbox', 'checkbox', 'switch', 'combobox', 'menuitem', 'tab', 'radio', 'slider'])
    const { nodes } = await send('Accessibility.getFullAXTree')
    const unnamed = nodes.filter((node) => !node.ignored && interactive.has(node.role?.value) && !node.name?.value?.trim()).map((node) => ({ role: node.role.value, backendNodeId: node.backendDOMNodeId }))
    for (const item of unnamed) {
      const { object } = await send('DOM.resolveNode', { backendNodeId: item.backendNodeId })
      const { result } = await send('Runtime.callFunctionOn', { objectId: object.objectId, returnByValue: true, functionDeclaration: 'function () { return this.outerHTML.slice(0, 160) }' })
      item.html = result.value
      delete item.backendNodeId
    }
    console.log(JSON.stringify({ contrast, unnamed }, null, 2))
  } else {
    throw new Error('Usage: node scripts/ui-cdp.mjs inspect | click <CSS-selector> | click-text <exact-label> | click-prefix <button-prefix> | click-label <label-prefix> | key <Key> | theme <dark|light> | screenshot <file.png> [WIDTHxHEIGHT] | audit')
  }
} finally {
  socket.close()
}
