import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node type stripping requires explicit TypeScript extension.
import { agentEffortChoices, agentModelChoices, agentSelectionIsUnavailable, agentSelectionIsValid, defaultAgentSelection, defaultEffortForModel } from '../shared/agent-models.ts'
import type { AgentModelCatalog } from '../shared/ipc-contract'

const catalog: AgentModelCatalog = {
  defaultModel: 'gpt-5.6-terra',
  defaultReasoningEffort: 'medium',
  models: [
    { id: 'gpt-5.6-terra', displayName: 'GPT-5.6-Terra', defaultReasoningEffort: 'medium', reasoningEfforts: ['low', 'medium', 'high'], isDefault: false },
    { id: 'gpt-5.5', displayName: 'GPT-5.5', defaultReasoningEffort: 'low', reasoningEfforts: ['low', 'medium'], isDefault: true },
  ],
}

test('model choices show catalog entries and keep a stale saved model visible', () => {
  assert.deepEqual(agentModelChoices(catalog, 'gpt-5.5').map((choice) => choice.value), ['gpt-5.6-terra', 'gpt-5.5'])
  assert.deepEqual(agentModelChoices(catalog, 'gpt-retired'), [
    { value: 'gpt-retired', label: 'gpt-retired (unavailable)', available: false },
    { value: 'gpt-5.6-terra', label: 'GPT-5.6-Terra (gpt-5.6-terra)', available: true },
    { value: 'gpt-5.5', label: 'GPT-5.5 (gpt-5.5)', available: true },
  ])
  assert.deepEqual(agentModelChoices(null, ''), [])
})

test('effort choices follow the model and keep an unsupported saved effort visible', () => {
  assert.deepEqual(agentEffortChoices(catalog, 'gpt-5.6-terra', ''), ['low', 'medium', 'high'])
  assert.deepEqual(agentEffortChoices(catalog, 'gpt-5.5', 'ultra'), ['ultra', 'low', 'medium'])
  assert.deepEqual(agentEffortChoices(catalog, 'gpt-retired', 'medium'), ['medium'])
})

test('selection validity requires a catalog model with that effort', () => {
  assert.equal(agentSelectionIsValid(catalog, 'gpt-5.6-terra', 'medium'), true)
  assert.equal(agentSelectionIsValid(catalog, 'gpt-5.6-terra', 'ultra'), false)
  assert.equal(agentSelectionIsValid(catalog, 'gpt-retired', 'medium'), false)
  assert.equal(agentSelectionIsValid(null, 'gpt-5.6-terra', 'medium'), false)
})

test('unavailable detection and defaults come from the discovered catalog', () => {
  assert.equal(agentSelectionIsUnavailable(catalog, 'gpt-retired'), true)
  assert.equal(agentSelectionIsUnavailable(catalog, 'gpt-5.5'), false)
  assert.equal(agentSelectionIsUnavailable(catalog, ''), false)
  assert.deepEqual(defaultAgentSelection(catalog), { model: 'gpt-5.6-terra', effort: 'medium' })
  assert.equal(defaultEffortForModel(catalog, 'gpt-5.5'), 'low')
  assert.equal(defaultEffortForModel(catalog, 'gpt-retired'), '')
})
