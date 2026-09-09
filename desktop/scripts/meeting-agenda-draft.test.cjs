const assert = require('node:assert/strict')
const test = require('node:test')
const path = require('node:path')
const { buildSync } = require('esbuild')
const { createElement } = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

function view() {
  const result = buildSync({ entryPoints: [path.join(__dirname, '../src/renderer/components/meeting-agenda-draft.tsx')], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react', 'react-dom'], jsx: 'automatic' })
  const module = { exports: {} }
  new Function('require', 'module', result.outputFiles[0].text)(require, module)
  return module.exports.MeetingAgendaDraftView
}
const Component = view()
const noop = () => {}
const base = { draft: null, busy: false, error: '', onGenerate: noop, onChange: noop, onOpenMeeting: noop, onOpenSettings: noop }
const render = props => renderToStaticMarkup(createElement(Component, { ...base, ...props }))
const source = { id: 'meeting-1', title: 'Planning source', startedAt: '2026-09-09' }

test('agenda shows idle, loading and recoverable model errors', () => {
  assert.match(render({}), /Generate agenda/)
  assert.match(render({ busy: true }), /disabled=""/)
  assert.match(render({ busy: true }), /role="status"/)
  const error = render({ error: 'Configure your AI model' })
  assert.match(error, /role="alert"/)
  assert.match(error, /Open Settings/)
})

test('agenda distinguishes no matching Meetings from no supported topics', () => {
  assert.match(render({ draft: { items: [], sources: [] } }), /No previous Meetings matched/)
  assert.match(render({ draft: { items: [], sources: [source] } }), /No supported follow-up topics/)
})

test('agenda shows editable grounded draft and source navigation without sharing', () => {
  const draft = { sources: [source], items: [{ topic: 'Has the proposal been sent?', sourceId: source.id, quote: 'Send the proposal tomorrow.' }] }
  const html = render({ draft })
  assert.match(html, /<textarea/)
  assert.match(html, /Has the proposal been sent\?/)
  assert.match(html, /Open Meeting: Planning source/)
  assert.match(html, /Send the proposal tomorrow/)
  assert.match(html, /Nothing is shared or added to Calendar/)
  assert.match(html, /Confirm current status/)
})

function elements(node) {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!node || typeof node !== 'object') return []
  if (typeof node.type === 'function') return elements(node.type(node.props))
  return [node, ...elements(node.props?.children)]
}

test('editing keeps source evidence and source button opens the exact Meeting ID', () => {
  const draft = { sources: [source], items: [{ topic: 'Confirm proposal?', sourceId: source.id, quote: 'Send the proposal tomorrow.' }] }
  let changed
  let opened
  const tree = elements(Component({ ...base, draft, onChange: value => { changed = value }, onOpenMeeting: id => { opened = id } }))
  tree.find(node => node.type === 'textarea').props.onChange({ target: { value: 'Confirm revised proposal?' } })
  assert.equal(changed.items[0].topic, 'Confirm revised proposal?')
  assert.equal(changed.items[0].sourceId, source.id)
  assert.equal(changed.items[0].quote, draft.items[0].quote)
  tree.filter(node => node.type === 'button').at(-1).props.onClick()
  assert.equal(opened, source.id)
})

test('ambiguous Calendar history gives manual linking guidance and exact Meeting navigation', () => {
  const draft = { items: [], sources: [], ambiguousMeetings: [source] }
  const html = render({ draft })
  assert.match(html, /Multiple Calendar events overlap/)
  assert.match(html, /Automatic matching remains unconfirmed/)
  assert.match(html, /People in this meeting/)
  assert.doesNotMatch(html, /No previous Meetings matched/)
  let opened
  const tree = elements(Component({ ...base, draft, onOpenMeeting: id => { opened = id } }))
  tree.filter(node => node.type === 'button').at(-1).props.onClick()
  assert.equal(opened, source.id)
})

test('incomplete draft regeneration confirms replacement and cancellation preserves edits', () => {
  const draft = { historyIncomplete: true, sources: [source], items: [{ topic: 'My local edit', sourceId: source.id, quote: 'Original quote' }] }
  let generated = 0, approved = false, prompt
  const previousWindow = global.window
  global.window = { confirm: message => { prompt = message; return approved } }
  try {
    const button = elements(Component({ ...base, draft, onGenerate: () => generated++ })).find(node => node.type === 'button')
    assert.equal(button.props.disabled, false)
    assert.match(render({ draft }), /Generate again/)
    button.props.onClick()
    assert.equal(generated, 0)
    assert.equal(draft.items[0].topic, 'My local edit')
    assert.match(prompt, /replaces all local topic edits/)
    approved = true; button.props.onClick()
    assert.equal(generated, 1)
    const busyButton = elements(Component({ ...base, draft, busy: true })).find(node => node.type === 'button')
    assert.equal(busyButton.props.disabled, true)
    assert.match(render({ draft, busy: true }), /<textarea readOnly=""/)
  } finally { global.window = previousWindow }
})
