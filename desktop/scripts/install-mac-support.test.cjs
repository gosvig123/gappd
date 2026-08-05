const assert = require('node:assert/strict')
const test = require('node:test')
const { designatedRequirement, needsScreenReset } = require('./install-mac-support.cjs')

const ADHOC = 'identifier "dev.gappd.desktop"'
const SIGNED = 'identifier "dev.gappd.desktop" and anchor apple generic and certificate leaf[subject.OU] = X95828B7PG'

test('extracts signed and ad-hoc requirements without paths', () => {
  const executable = 'Executable=/tmp/Gappd.app/Contents/MacOS/Gappd\n'
  assert.equal(designatedRequirement(`${executable}designated => ${SIGNED}\n`), SIGNED)
  assert.equal(designatedRequirement(`${executable}# designated => ${ADHOC}\n`), ADHOC)
})

test('resets ScreenCapture only when installed identity changes', () => {
  assert.equal(needsScreenReset(null, SIGNED), false)
  assert.equal(needsScreenReset(SIGNED, SIGNED), false)
  assert.equal(needsScreenReset(ADHOC, SIGNED), true)
})
