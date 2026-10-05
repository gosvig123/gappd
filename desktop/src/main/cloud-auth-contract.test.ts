import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
const source = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8')

test('release Settings expose real Meeting sync', () => {
  const settings = source('../renderer/routes/settings-view.tsx')
  assert.match(settings, /<MeetingUploadPanel \/>/)
  const panel = source('../renderer/components/meeting-upload-panel.tsx')
  assert.match(panel, /api\.connect\(true\)/)
  assert.match(panel, /api\.setConsent\(subject, event\.target\.checked\)/)
  assert.match(source('./meeting-upload-service.ts'), /cloud-upload-development\.enc/)
})
