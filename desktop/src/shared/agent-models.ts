import type { AgentModelCatalog, AgentModelOption } from './ipc-contract'

const UNAVAILABLE_MODEL_SUFFIX = ' (unavailable)'

type AgentModelChoice = { value: string; label: string; available: boolean }

/** Model choices keep a stale saved model visible instead of silently replacing it. */
export function agentModelChoices(catalog: AgentModelCatalog | null, savedModel: string): AgentModelChoice[] {
  const choices = (catalog?.models ?? []).map((model) => ({ value: model.id, label: modelLabel(model), available: true }))
  if (savedModel && !choices.some((choice) => choice.value === savedModel)) {
    choices.unshift({ value: savedModel, label: savedModel + UNAVAILABLE_MODEL_SUFFIX, available: false })
  }
  return choices
}

/** Effort choices come from the selected model; an unsupported saved effort stays visible. */
export function agentEffortChoices(catalog: AgentModelCatalog | null, model: string, savedEffort: string): string[] {
  const supported = agentModel(catalog, model)?.reasoningEfforts ?? []
  if (savedEffort && !supported.includes(savedEffort)) return [savedEffort, ...supported]
  return supported
}

/** A model without effort levels is valid only with no effort. */
export function agentSelectionIsValid(catalog: AgentModelCatalog | null, model: string, effort: string): boolean {
  const selected = agentModel(catalog, model)
  if (!selected) return false
  return selected.reasoningEfforts.length ? selected.reasoningEfforts.includes(effort) : effort === ''
}

export function agentSelectionIsUnavailable(catalog: AgentModelCatalog | null, model: string): boolean {
  return Boolean(model && !agentModel(catalog, model))
}

/** The default selection used when nothing explicit was saved. */
export function defaultAgentSelection(catalog: AgentModelCatalog | null): { model: string; effort: string } {
  return { model: catalog?.defaultModel ?? '', effort: catalog?.defaultReasoningEffort ?? '' }
}

/** Catalog default effort for one model, used when the model changes. */
export function defaultEffortForModel(catalog: AgentModelCatalog | null, model: string): string {
  return agentModel(catalog, model)?.defaultReasoningEffort ?? ''
}

export function agentModelName(catalog: AgentModelCatalog | null, model: string): string {
  return agentModel(catalog, model)?.displayName || model
}

function agentModel(catalog: AgentModelCatalog | null, model: string): AgentModelOption | null {
  return catalog?.models.find((option) => option.id === model) ?? null
}

function modelLabel(model: AgentModelOption): string {
  return model.displayName && model.displayName !== model.id ? `${model.displayName} (${model.id})` : model.id
}
