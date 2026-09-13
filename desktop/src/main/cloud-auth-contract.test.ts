import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { IPC_OPERATIONS } from '../shared/ipc-contract.ts'
const source = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8')

test('Cloud auth Settings, preload and main share the typed IPC contract without token operations', () => {
  assert.deepEqual(IPC_OPERATIONS.cloudAuth, { status: 'cloudAuth:status', setEnabled: 'cloudAuth:setEnabled' })
  assert.match(source('../preload/index.ts'), /cloudAuth: invokeGroup\('cloudAuth'\)/)
  assert.match(source('./ipc.ts'), /setEnabled: \(_event, enabled\) => setCloudAuthEnabled\(enabled\)/)
  assert.match(source('../renderer/routes/settings-view.tsx'), /<CloudAuthPanel \/>/)
  const panel = source('../renderer/components/cloud-auth-panel.tsx')
  assert.match(panel, /No Meetings uploaded/)
  assert.match(panel, /Cancel sign-in/)
  assert.match(panel, /onClick=\{\(\) => void update\(false\)\}>Remove local credentials/)
  assert.match(panel, /new CloudAuthPanelState\(window.gappd.cloudAuth, setStatus\)/)
  assert.match(source('./cloud-auth-service.ts'), /cloud-auth-development\.enc/)
  assert.doesNotMatch(source('../shared/cloud-auth-contract.ts'), /accessToken|refreshToken/)
})
