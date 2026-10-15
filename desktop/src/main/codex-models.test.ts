import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { codexEffortChoices, codexModelChoices, codexSelectionIsUnavailable, codexSelectionIsValid, defaultCodexSelection, defaultEffortForModel } from '../shared/codex-models.ts'
import type { CodexModelCatalog } from '../shared/ipc-contract'

const catalog: CodexModelCatalog = {
  defaultModel: 'gpt-5.6-terra',
  defaultReasoningEffort: 'medium',
  models: [
    { id: 'gpt-5.6-terra', displayName: 'GPT-5.6-Terra', defaultReasoningEffort: 'medium', reasoningEfforts: ['low', 'medium', 'high'], isDefault: false },
    { id: 'gpt-5.5', displayName: 'GPT-5.5', defaultReasoningEffort: 'low', reasoningEfforts: ['low', 'medium'], isDefault: true },
  ],
}

test('model choices show catalog entries and keep a stale saved model visible', () => {
  assert.deepEqual(codexModelChoices(catalog, 'gpt-5.5').map((choice) => choice.value), ['gpt-5.6-terra', 'gpt-5.5'])
  assert.deepEqual(codexModelChoices(catalog, 'gpt-retired'), [
    { value: 'gpt-retired', label: 'gpt-retired (unavailable)', available: false },
    { value: 'gpt-5.6-terra', label: 'GPT-5.6-Terra (gpt-5.6-terra)', available: true },
    { value: 'gpt-5.5', label: 'GPT-5.5 (gpt-5.5)', available: true },
  ])
  assert.deepEqual(codexModelChoices(null, ''), [])
})

test('effort choices follow the model and keep an unsupported saved effort visible', () => {
  assert.deepEqual(codexEffortChoices(catalog, 'gpt-5.6-terra', ''), ['low', 'medium', 'high'])
  assert.deepEqual(codexEffortChoices(catalog, 'gpt-5.5', 'ultra'), ['ultra', 'low', 'medium'])
  assert.deepEqual(codexEffortChoices(catalog, 'gpt-retired', 'medium'), ['medium'])
})

test('selection validity requires a catalog model with that effort', () => {
  assert.equal(codexSelectionIsValid(catalog, 'gpt-5.6-terra', 'medium'), true)
  assert.equal(codexSelectionIsValid(catalog, 'gpt-5.6-terra', 'ultra'), false)
  assert.equal(codexSelectionIsValid(catalog, 'gpt-retired', 'medium'), false)
  assert.equal(codexSelectionIsValid(null, 'gpt-5.6-terra', 'medium'), false)
})

test('unavailable detection and defaults come from the discovered catalog', () => {
  assert.equal(codexSelectionIsUnavailable(catalog, 'gpt-retired'), true)
  assert.equal(codexSelectionIsUnavailable(catalog, 'gpt-5.5'), false)
  assert.equal(codexSelectionIsUnavailable(catalog, ''), false)
  assert.deepEqual(defaultCodexSelection(catalog), { model: 'gpt-5.6-terra', effort: 'medium' })
  assert.equal(defaultEffortForModel(catalog, 'gpt-5.5'), 'low')
  assert.equal(defaultEffortForModel(catalog, 'gpt-retired'), '')
})
