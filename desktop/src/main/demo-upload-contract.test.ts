import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { IPC_OPERATIONS } from '../shared/ipc-contract.ts'
const source = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8')

test('demo uses typed IPC without caller text or token exposure and is explicitly gated', () => {
  assert.deepEqual(Object.keys(IPC_OPERATIONS.demoUpload), ['status', 'connect', 'setConsent', 'upload', 'setDeleteConsent', 'deleteCopy'])
  assert.match(source('../preload/index.ts'), /demoUpload: invokeGroup\('demoUpload'\)/)
  assert.match(source('./ipc.ts'), /upload: \(_event, subject\) => demoUpload\(\).upload\(subject\)/)
  assert.match(source('./demo-upload-service.ts'), /GAPPD_SYNTHETIC_UPLOAD_ENABLED === 'true'/)
  assert.match(source('./demo-upload-service.ts'), /cloud-demo-development\.enc/)
  assert.doesNotMatch(source('../shared/demo-upload-contract.ts'), /accessToken|refreshToken/)
  assert.match(source('../renderer/components/demo-upload-panel.tsx'), /checked=\{status.consent\}/)
  assert.match(source('../renderer/components/demo-upload-panel.tsx'), /Upload demo Meeting/)
  assert.doesNotMatch(source('./demo-upload.ts'), /from ['"].*(?:meetings|backend|db)/)
})
