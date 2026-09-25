import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { IPC_OPERATIONS } from '../shared/ipc-contract.ts'
const source = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8')

test('legacy Cloud auth keeps its isolated IPC contract without token operations', () => {
  assert.deepEqual(IPC_OPERATIONS.cloudAuth, { status: 'cloudAuth:status', setEnabled: 'cloudAuth:setEnabled' })
  assert.match(source('../preload/index.ts'), /cloudAuth: invokeGroup\('cloudAuth'\)/)
  assert.match(source('./ipc.ts'), /setEnabled: \(_event, enabled\) => setCloudAuthEnabled\(enabled\)/)
  const panel = source('../renderer/components/cloud-auth-panel.tsx')
  assert.match(panel, /No Meetings uploaded/)
  assert.match(panel, /Cancel sign-in/)
  assert.match(panel, /onClick=\{\(\) => void update\(false\)\}>Remove local credentials/)
  assert.match(panel, /new CloudAuthPanelState\(window.gappd.cloudAuth, setStatus\)/)
  assert.match(source('./cloud-auth-service.ts'), /cloud-auth-development\.enc/)
  assert.doesNotMatch(source('../shared/cloud-auth-contract.ts'), /accessToken|refreshToken/)
})

test('release Settings expose real Meeting sync, not the authentication-only preview', () => {
  const settings = source('../renderer/routes/settings-view.tsx')
  assert.doesNotMatch(settings, /CloudAuthPanel/)
  assert.match(settings, /<MeetingUploadPanel \/>/)
  assert.match(source('../../../.github/workflows/desktop-macos-release.yml'), /GAPPD_MEETING_UPLOAD_ENABLED: 'true'/)
  const panel = source('../renderer/components/meeting-upload-panel.tsx')
  assert.match(panel, /api\.connect\(true\)/)
  assert.match(panel, /api\.setConsent\(subject, event\.target\.checked\)/)
  assert.match(source('./meeting-upload-service.ts'), /cloud-upload-development\.enc/)
})
