#!/usr/bin/env node
// UI review of an isolated development fixture: every view in both themes and two window
// sizes, plus a contrast and accessible-name audit, collected in one HTML contact sheet.
// Every step goes through ui-cdp.mjs, so its fixture guard applies.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const outDir = process.argv[2]
if (!outDir) throw new Error('Usage: node scripts/ui-review.mjs <output-directory>')
mkdirSync(outDir, { recursive: true })

const helper = new URL('./ui-cdp.mjs', import.meta.url).pathname
const run = (...args) => execFileSync(process.execPath, [helper, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const tryRun = (...args) => { try { run(...args) } catch { /* Control is absent in this state. */ } }
const settle = () => new Promise((done) => setTimeout(done, 800))

const meeting = [['click-prefix', 'Meetings'], ['click-prefix', 'SYNTHETIC']]
const settings = [['click-text', 'Settings']]
const views = [
  { name: 'Today', steps: [['click-prefix', 'Today']] },
  { name: 'Meetings', steps: [['click-prefix', 'Meetings']] },
  { name: 'Meeting summary', steps: [...meeting, ['click-text', 'Summary']] },
  { name: 'Meeting agenda', steps: [...meeting, ['click-text', 'Agenda']] },
  { name: 'Meeting transcript', steps: [...meeting, ['click-text', 'Transcript']] },
  { name: 'People', steps: [['click-prefix', 'People']] },
  { name: 'Settings general', steps: [...settings, ['click-text', 'General']] },
  { name: 'Settings processing', steps: [...settings, ['click-text', 'Meeting processing']] },
  { name: 'Settings connections', steps: [...settings, ['click-text', 'Connections']] },
]
const themes = ['dark', 'light']
const sizes = ['1280x800', '960x640']

const results = []
for (const theme of themes) {
  run('theme', theme)
  for (const view of views) {
    // Start every view from the same state: no open dialog, no open Meeting.
    tryRun('click-text', 'Close settings')
    tryRun('click-text', 'Close Meeting')
    let error
    try {
      for (const step of view.steps) { run(...step); await settle() }
    } catch (failure) {
      error = String(failure.stderr || failure.message).split('\n').find((line) => line.startsWith('Error')) || 'Navigation failed'
    }
    const slug = view.name.toLowerCase().replaceAll(' ', '-')
    const shots = sizes.map((size) => {
      const file = `${slug}-${theme}-${size}.png`
      run('screenshot', join(outDir, file), size)
      return { size, file }
    })
    const audit = JSON.parse(run('audit'))
    results.push({ view: view.name, theme, error, shots, ...audit })
    console.log(`${view.name} (${theme}): ${audit.contrast.length} contrast, ${audit.unnamed.length} unnamed${error ? `, ${error}` : ''}`)
  }
}
run('theme', 'dark')
writeFileSync(join(outDir, 'findings.json'), JSON.stringify(results, null, 2))

const escape = (value) => String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const swatch = (color) => `<span class="swatch" style="background:${color}"></span>${color}`
const findingsTable = (result) => {
  const rows = result.contrast.map((f) => `<tr><td class="bad">${f.ratio}</td><td>${f.required}</td><td>${escape(f.text)}</td><td>${swatch(f.foreground)}</td><td>${swatch(f.background)}</td><td>${f.fontSize}px</td><td><code>${escape(f.selector)}</code></td><td>${f.count}</td></tr>`)
  const unnamed = result.unnamed.map((u) => `<tr><td colspan="8">Unnamed ${escape(u.role)}: <code>${escape(u.html)}</code></td></tr>`)
  if (!rows.length && !unnamed.length) return '<p class="ok">No contrast or accessible-name findings.</p>'
  return `<table><tr><th>Ratio</th><th>Needs</th><th>Text</th><th>Text colour</th><th>Background</th><th>Size</th><th>Element</th><th>Count</th></tr>${rows.join('')}${unnamed.join('')}</table>`
}
const sections = views.map((view) => {
  const perTheme = themes.map((theme) => results.find((r) => r.view === view.name && r.theme === theme))
  const images = sizes.flatMap((size) => perTheme.map((r) => {
    const shot = r.shots.find((s) => s.size === size)
    return `<figure><a href="${shot.file}"><img src="${shot.file}" loading="lazy"></a><figcaption>${r.theme} · ${size}</figcaption></figure>`
  }))
  const errors = perTheme.filter((r) => r.error).map((r) => `<p class="bad">${r.theme}: ${escape(r.error)}</p>`)
  const tables = perTheme.map((r) => `<h3>${r.theme}</h3>${findingsTable(r)}`)
  return `<section id="${escape(view.name)}"><h2>${escape(view.name)}</h2>${errors.join('')}<div class="grid">${images.join('')}</div>${tables.join('')}</section>`
})
const summary = themes.map((theme) => {
  const unique = new Map()
  for (const r of results.filter((item) => item.theme === theme)) for (const f of r.contrast) unique.set(`${f.selector}|${f.foreground}|${f.background}`, f)
  const unnamed = results.filter((r) => r.theme === theme).reduce((sum, r) => sum + r.unnamed.length, 0)
  return `<li><b>${theme}</b>: ${unique.size} distinct low-contrast text styles, ${unnamed} unnamed controls</li>`
})
writeFileSync(join(outDir, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Gappd UI review</title>
<style>
body { font: 14px system-ui; margin: 24px; background: #f4f5f7; color: #1b1f27 }
section { background: #fff; border-radius: 10px; padding: 16px 20px; margin: 20px 0 }
.grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px }
figure { margin: 0 } img { width: 100%; border: 1px solid #d2d7df; border-radius: 6px }
figcaption { color: #555; font-size: 12px } table { border-collapse: collapse; width: 100%; font-size: 12px }
td, th { border-bottom: 1px solid #e5e7eb; padding: 4px 6px; text-align: left; vertical-align: top }
.swatch { display: inline-block; width: 12px; height: 12px; border: 1px solid #888; margin-right: 4px; vertical-align: -2px }
.bad { color: #b42331; font-weight: 600 } .ok { color: #2f855a }
nav a { margin-right: 12px }
</style>
<h1>Gappd UI review</h1>
<p>Generated ${new Date().toISOString()} from an isolated fixture. Contrast uses WCAG AA on rendered colours; a gradient counts at its worst stop.</p>
<ul>${summary.join('')}</ul>
<nav>${views.map((v) => `<a href="#${escape(v.name)}">${escape(v.name)}</a>`).join('')}</nav>
${sections.join('\n')}`)
console.log(`Contact sheet: ${resolve(outDir, 'index.html')}`)
