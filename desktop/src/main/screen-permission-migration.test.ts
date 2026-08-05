import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { designatedRequirement, needsScreenReset } from './screen-permission-migration.ts'

const ADHOC = 'cdhash H"1234"'
const SIGNED = 'identifier "dev.gappd.desktop" and anchor apple generic and certificate leaf[subject.OU] = X95828B7PG'

test('parses signed and ad-hoc code requirements', () => {
  assert.equal(designatedRequirement(`designated => ${SIGNED}`), SIGNED)
  assert.equal(designatedRequirement(`# designated => ${ADHOC}`), ADHOC)
})

test('resets first run and changed code identities only', () => {
  assert.equal(needsScreenReset(null, SIGNED), true)
  assert.equal(needsScreenReset(`${SIGNED}\n`, SIGNED), false)
  assert.equal(needsScreenReset(ADHOC, SIGNED), true)
})
